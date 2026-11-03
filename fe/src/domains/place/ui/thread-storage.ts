import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useId, useRef, useState } from "react";

import { isApiError } from "@/shared/api/api-error";

import {
  deleteAllThreads,
  deleteThread,
  fetchThread,
  fetchThreadPage,
  putTurn,
  TURN_CONFLICT_TYPE,
  type ThreadPage,
} from "../api/search-thread-api";
import {
  appendTurn,
  mergeSummaries,
  parseThreads,
  sortThreads,
  summarizeThread,
  type ThreadSummary,
  type ThreadTurn,
} from "../model/search-threads";

// 검색 thread 저장소. 화면은 이 모듈로만 thread를 읽고 쓴다(search-thread D-9).
// 검색을 시작할 때의 세션 키로 저장 위치를 고른다. 회원이면 서버, 비회원이면 기기, 아직 모르면 저장하지 않는다(D-6).
// 회원 turn은 thread마다 만든 순서대로 하나씩 보내고, 연결 오류와 5xx만 같은 id로 정해진 횟수까지 다시 보낸다(D-5).
// 대기분은 메모리에만 있어 세션이 바뀌거나 페이지가 끝나면 버린다. 보관 기한은 없다(D-12).
// thread는 회원(서버)과 비회원(기기) 모두 최근 20개만 남는다(D-19).
// 사용자가 최근 검색에서 지운 thread는 그 페이지 세션 동안 다시 저장하지 않는다(D-18)

export type MemberKey = { kind: "member"; userId: string; sessionId: string };

// 회원이면 (userId, sessionId), 비회원이면 세션 없음(guest), 아직 확인하지 못했으면 모름(unknown)
export type SessionKey = MemberKey | { kind: "guest" } | { kind: "unknown" };

// place는 auth를 import하지 않으므로 app 계층이 인증을 이어 준다
export type ThreadAuth = {
  // 지금 확인된 세션 키. 확인 전이면 unknown
  current(): SessionKey;
  // 세션 키를 확인한다. 세션이 없으면 복원을 한 번 시도하고, 시간 초과나 연결 오류면 unknown이다
  resolve(): Promise<SessionKey>;
  // key 세션의 AT로 보낸다. 만료면 한 번 갱신한다. 처음 토큰이나 갱신 결과가 key와 다른 세션이면 보내지 않고 던진다
  send<T>(
    key: MemberKey,
    request: (accessToken: string) => Promise<T>,
  ): Promise<T>;
};

const GUEST: SessionKey = { kind: "guest" };

// 주인 표시 없이 쌓인 예전 기기 기록. 읽지도 올리지도 않고 지운다(D-8)
const LEGACY_KEY = "fit-dining:search-threads";
const GUEST_KEY = "fit-dining:guest-search-threads";

// 기기에 남기는 thread 수. 서버(BE MAX_THREADS)와 같다(D-19)
const MAX_THREADS = 20;

// 재전송 사이의 기다림. 길이가 다시 보내는 횟수다
const RETRY_DELAYS_MS = [1_000, 3_000, 9_000];

let legacyDropped = false;

// 페이지에서 이 모듈을 처음 쓸 때 한 번 지운다. 실패해도 화면과 검색은 동작한다
function dropLegacyKey() {
  if (legacyDropped) return;
  legacyDropped = true;
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // 저장소를 쓸 수 없으면 지울 것도 없다
  }
}

function readDevice() {
  try {
    return parseThreads(localStorage.getItem(GUEST_KEY));
  } catch {
    return [];
  }
}

// 저장소가 가득 찼거나 쓸 수 없으면 저장하지 않을 뿐 검색은 그대로 동작한다
function saveDeviceTurn(threadId: string, turn: ThreadTurn) {
  const threads = readDevice();
  const thread = appendTurn(
    threads.find(({ id }) => id === threadId),
    threadId,
    turn,
  );
  // 지금 thread는 남기고, 나머지는 최근 것부터 상한까지만 둔다
  const others = sortThreads(threads.filter(({ id }) => id !== threadId)).slice(
    0,
    MAX_THREADS - 1,
  );
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify([thread, ...others]));
  } catch {
    // 새 기록만 남지 않고 옛 기록은 그대로다
  }
}

function deviceSummaries() {
  return sortThreads(readDevice()).map(summarizeThread);
}

type TurnQueue = {
  turns: ThreadTurn[];
  running: boolean;
  // 보내는 중일 때, 대기열이 빌 때까지
  idle?: Promise<void>;
  failed: boolean;
};

// 세션이 바뀌면 올린다. 그 전에 시작한 저장은 끝나도 아무것도 하지 않는다
let generation = 0;
// 페이지 종료 신호를 받은 뒤에는 보내지 않는다
let pageEnded = false;
let watchingPage = false;
// 세션 키와 thread별 대기열. 끝내 실패한 thread는 페이지 세션이 끝날 때까지 뒤 turn을 보내지 않는다
const queues = new Map<string, TurnQueue>();
// 이 페이지 세션에서 저장하거나 연 thread와, 그중 사용자가 지운 thread. 키는 storeId다
const touched = new Set<string>();
const removed = new Set<string>();
// 저장 위치를 확인하는 동안에도 turn이 만든 순서대로 대기열에 들어가게 잇는다
let ordering: Promise<void> = Promise.resolve();

function watchPage() {
  if (watchingPage || typeof window === "undefined") return;
  watchingPage = true;
  window.addEventListener("pagehide", () => {
    pageEnded = true;
    queues.clear();
  });
  // 뒤로 가기 캐시에서 돌아오면 새 저장은 다시 보낸다. 버린 대기분은 돌아오지 않는다
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) pageEnded = false;
  });
}

// 로그인 세션이 바뀌면 app 계층이 부른다. 대기분과 실패 표시를 버린다
export function resetThreadSession() {
  generation += 1;
  queues.clear();
  touched.clear();
  removed.clear();
}

// 세션 키와 thread를 함께 가리키는 키. 회원은 세션마다 따로다
function storeId(key: SessionKey, threadId: string) {
  return key.kind === "member"
    ? `${key.userId}\n${key.sessionId}\n${threadId}`
    : `${key.kind}\n${threadId}`;
}

// 검색을 시작할 때 저장 위치(세션 키)를 확인하기 시작한다. 인증이 이어지지 않은 화면은 비회원이다
export function beginSave(auth?: ThreadAuth): Promise<SessionKey> {
  dropLegacyKey();
  watchPage();
  if (!auth) return Promise.resolve(GUEST);
  return auth.resolve().catch(() => ({ kind: "unknown" }) as const);
}

// 성공한 첫 페이지 turn 하나를 저장한다. 저장 실패는 화면에 알리지 않는다(D-5)
export function saveTurn(
  target: Promise<SessionKey>,
  threadId: string,
  turn: ThreadTurn,
  auth?: ThreadAuth,
) {
  const started = generation;
  // appendTurn이 다시 열 때 다음 페이지를 부르지 않도록 커서를 버린다
  const [stored] = appendTurn(undefined, threadId, turn).turns;
  ordering = ordering.then(async () => {
    const key = await target;
    if (started !== generation || pageEnded) return;
    const id = storeId(key, threadId);
    touched.add(id);
    // 지운 thread는 화면에 남아 있어도 이어 검색을 저장하지 않는다(D-18)
    if (removed.has(id)) return;
    if (key.kind === "guest") saveDeviceTurn(threadId, stored);
    if (key.kind === "member" && auth) enqueue(auth, key, threadId, stored);
  });
}

function enqueue(
  auth: ThreadAuth,
  key: MemberKey,
  threadId: string,
  turn: ThreadTurn,
) {
  const id = storeId(key, threadId);
  const queue = queues.get(id) ?? { turns: [], running: false, failed: false };
  queues.set(id, queue);
  if (queue.failed) return;
  queue.turns.push(turn);
  if (!queue.running)
    queue.idle = drain(auth, key, threadId, queue, generation);
}

async function drain(
  auth: ThreadAuth,
  key: MemberKey,
  threadId: string,
  queue: TurnQueue,
  started: number,
) {
  queue.running = true;
  while (queue.turns.length > 0) {
    const outcome = await send(auth, key, threadId, queue.turns[0], started);
    if (started !== generation || pageEnded) return;
    if (outcome === "saved") {
      queue.turns.shift();
      continue;
    }
    // 앞 turn이 저장되지 않았으면 뒤 turn도 보내지 않아 서버에 고아 turn이 생기지 않는다
    queue.turns = [];
    if (outcome === "failed") queue.failed = true;
  }
  queue.running = false;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransient(error: unknown) {
  return (
    isApiError(error) && (error.kind !== "http" || (error.status ?? 0) >= 500)
  );
}

// saved: 저장됐거나 이미 있다. failed: 끝내 실패했다. stopped: 인증을 잃었거나 다른 세션이라 멈춘다
async function send(
  auth: ThreadAuth,
  key: MemberKey,
  threadId: string,
  turn: ThreadTurn,
  started: number,
): Promise<"saved" | "failed" | "stopped"> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await auth.send(key, (accessToken) =>
        putTurn(threadId, turn, accessToken),
      );
      return "saved";
    } catch (error) {
      if (!isApiError(error)) return "stopped";
      if (error.status === 409 && error.problem?.type === TURN_CONFLICT_TYPE)
        return "saved";
      if (error.status === 401) return "stopped";
      if (!isTransient(error) || attempt >= RETRY_DELAYS_MS.length)
        return "failed";
    }
    await wait(RETRY_DELAYS_MS[attempt]);
    if (
      started !== generation ||
      pageEnded ||
      removed.has(storeId(key, threadId))
    )
      return "stopped";
  }
}

// 지울 thread의 대기분을 버리고, 보내는 중인 저장이 있으면 끝날 때까지 기다린다.
// 늦게 도착한 저장이 지운 기록을 되살리지 않게 한다(D-18)
async function settle(ids: string[]) {
  const sending: Promise<void>[] = [];
  for (const id of ids) {
    const queue = queues.get(id);
    if (!queue) continue;
    queue.turns = [];
    if (queue.running && queue.idle) sending.push(queue.idle);
  }
  await Promise.all(sending);
}

function forget(key: SessionKey, threadIds: string[]) {
  const ids = threadIds.map((threadId) => storeId(key, threadId));
  const added = ids.filter((id) => !removed.has(id));
  added.forEach((id) => removed.add(id));
  // 지우지 못하면 그 thread는 계속 저장한다
  return { ids, restore: () => added.forEach((id) => removed.delete(id)) };
}

// 최근 검색에서 thread 하나를 지운다. 회원은 서버에서, 비회원은 기기에서 지운다(D-18)
export async function removeThread(
  key: SessionKey,
  threadId: string,
  auth?: ThreadAuth,
) {
  const { ids, restore } = forget(key, [threadId]);
  try {
    if (key.kind === "guest") {
      const threads = readDevice().filter(({ id }) => id !== threadId);
      localStorage.setItem(GUEST_KEY, JSON.stringify(threads));
      return;
    }
    if (key.kind === "unknown" || !auth)
      throw new Error("로그인 상태를 확인하지 못했어요");
    await settle(ids);
    await auth.send(key, (accessToken) => deleteThread(threadId, accessToken));
  } catch (error) {
    restore();
    throw error;
  }
}

// 최근 검색을 모두 지운다. 이 페이지 세션에서 저장하거나 연 thread도 다시 저장하지 않는다(D-18)
export async function removeAllThreads(key: SessionKey, auth?: ThreadAuth) {
  // 앞서 시작한 저장이 대기열에 들어간 뒤에 고른다
  await ordering;
  const prefix = storeId(key, "");
  const threadIds = [...touched]
    .filter((id) => id.startsWith(prefix))
    .map((id) => id.slice(prefix.length));
  const { ids, restore } = forget(key, threadIds);
  try {
    if (key.kind === "guest") {
      localStorage.removeItem(GUEST_KEY);
      return;
    }
    if (key.kind === "unknown" || !auth)
      throw new Error("로그인 상태를 확인하지 못했어요");
    await settle(ids);
    await auth.send(key, (accessToken) => deleteAllThreads(accessToken));
  } catch (error) {
    restore();
    throw error;
  }
}

export type ThreadListState =
  | { status: "loading" }
  | { status: "failed"; error: unknown; retry: () => void }
  | {
      status: "ready";
      items: ThreadSummary[];
      hasMore: boolean;
      loadingMore: boolean;
      loadMoreFailed: boolean;
      loadMore: () => void;
    };

// 최근 검색 시트의 목록과 thread 열기. 시트를 열 때의 세션 키로 비회원은 기기, 회원은 서버에서 읽는다.
// 시트를 열 때마다 첫 페이지부터 다시 받고, 열린 동안 저장이 끝나도 다시 받지 않는다(D-9)
export function useThreadList(auth?: ThreadAuth) {
  dropLegacyKey();
  const [opened] = useState(() => auth?.current() ?? GUEST);
  // 목록을 읽은 세션 키. thread 열기도 이 키로 한다
  const source = useRef<SessionKey>(opened);
  // 시트를 열 때마다 새 키라 이전에 열었을 때 받은 페이지를 쓰지 않는다
  const openId = useId();
  const queryKey = ["search-threads", "list", openId];
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam, signal }): Promise<ThreadPage> => {
      const key =
        source.current.kind === "unknown" && auth
          ? await auth.resolve()
          : source.current;
      source.current = key;
      if (key.kind === "guest") return { items: deviceSummaries() };
      if (key.kind === "unknown" || !auth)
        throw new Error("로그인 상태를 확인하지 못했어요");
      return auth.send(key, (accessToken) =>
        fetchThreadPage(accessToken, pageParam, signal),
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    // 비회원은 기기 목록이라 열자마자 보인다
    initialData:
      opened.kind === "guest"
        ? { pages: [{ items: deviceSummaries() }], pageParams: [undefined] }
        : undefined,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  async function load(threadId: string, signal?: AbortSignal) {
    const key = source.current;
    if (key.kind === "member" && auth) {
      const data = await auth.send(key, (accessToken) =>
        fetchThread(threadId, accessToken, signal),
      );
      const [thread] = parseThreads(JSON.stringify([data]));
      if (thread?.id !== threadId)
        throw new Error("검색 기록이 올바르지 않아요");
      touched.add(storeId(key, threadId));
      return thread;
    }
    const thread = readDevice().find(({ id }) => id === threadId);
    if (!thread) throw new Error("검색 기록을 찾지 못했어요");
    touched.add(storeId(key, threadId));
    return thread;
  }

  // 지운 뒤 다시 받지 않고 받은 목록에서 뺀다. 남은 줄의 cursor는 그대로 쓸 수 있다
  function drop(keep: (item: ThreadSummary) => boolean) {
    queryClient.setQueryData<InfiniteData<ThreadPage>>(
      queryKey,
      (data) =>
        data && {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.filter(keep),
          })),
        },
    );
  }

  async function remove(threadId: string) {
    await removeThread(source.current, threadId, auth);
    drop(({ id }) => id !== threadId);
  }

  async function removeAll() {
    await removeAllThreads(source.current, auth);
    queryClient.setQueryData<InfiniteData<ThreadPage>>(queryKey, {
      pages: [{ items: [] }],
      pageParams: [undefined],
    });
  }

  let state: ThreadListState;
  if (query.data) {
    state = {
      status: "ready",
      items: mergeSummaries(query.data.pages.map(({ items }) => items)),
      hasMore: query.hasNextPage,
      loadingMore: query.isFetchingNextPage,
      loadMoreFailed: query.isFetchNextPageError,
      loadMore: () => void query.fetchNextPage(),
    };
  } else if (query.isError) {
    state = {
      status: "failed",
      error: query.error,
      retry: () => void query.refetch(),
    };
  } else {
    state = { status: "loading" };
  }
  return { state, load, remove, removeAll };
}
