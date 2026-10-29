// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/domains/auth/api/auth-client";
import type { BookmarkAccess } from "@/domains/place/model/bookmark";
import type {
  PlaceCard,
  PlaceSearchResponse,
} from "@/domains/place/model/place-types";
import { NEARBY_QUERY } from "@/domains/place/model/search-request";
import { searchStore } from "@/domains/place/model/search-store";
import type { ThreadTurn } from "@/domains/place/model/search-threads";
import { SearchScreen } from "@/domains/place/ui/search-screen";
import { resetThreadSession } from "@/domains/place/ui/thread-storage";
import { useStoredCard } from "@/domains/place/ui/use-stored-card";

import { Providers } from "./providers";
import { threadAuth } from "./search-thread-auth";

// 회원 검색 기록을 실제 검색 화면, store, 쿼리 캐시, Providers의 비우기 연결과 함께 돌린다(search-thread D-16).
// auth-client와 서버(검색 API, 기록 API)만 가짜다
const auth = vi.hoisted(() => ({
  session: null as AuthSession | null,
  listeners: new Set<() => void>(),
}));

function setSession(next: AuthSession | null) {
  auth.session = next;
  auth.listeners.forEach((listener) => listener());
}

vi.mock("@/domains/auth/api/auth-client", () => ({
  ACCESS_TOKEN_EXPIRED_TYPE: "urn:fitdining:auth:access-token-expired",
  getSession: () => auth.session,
  restore: async () => {
    if (auth.session) return auth.session;
    const { ApiError } = await import("@/shared/api/api-error");
    throw new ApiError("http", "x", { status: 401 });
  },
  refresh: async () => {
    throw new Error("갱신하지 않는다");
  },
  clearSession: () => setSession(null),
  subscribe: (listener: () => void) => {
    auth.listeners.add(listener);
    return () => auth.listeners.delete(listener);
  },
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/shared/lib/runtime-config", () => ({
  loadRuntimeConfig: async () => undefined,
}));

const member = (userId: string, sessionId = "s1"): AuthSession => ({
  userId,
  sessionId,
  accessToken: `at.${userId}.${sessionId}`,
  nickname: userId,
  accessExpiresAt: 0,
  sessionExpiresAt: 0,
});

function card(id: number): PlaceCard {
  return {
    place: {
      id,
      name: `장소 ${id}`,
      categoryGroup: "CAFE",
      station: "YEOKSAM",
      lat: 37.5,
      lng: 127.03,
    },
    score: 80 + id,
    labels: ["조용해요"],
    openStatus: "OPEN",
    reasons: [],
    scoreItems: [],
  };
}

function deferred() {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

type StoredThread = {
  id: string;
  title: string;
  lastAt: number;
  turns: ThreadTurn[];
};

// 기록 API와 검색 API를 흉내 낸다. 기록은 AT의 사용자별로 따로 둔다
const server = {
  threads: new Map<string, StoredThread[]>(),
  searches: [] as Record<string, unknown>[],
  lists: [] as { user: string; cursor?: string }[],
  reads: [] as string[],
  puts: [] as { user: string; thread: string; body: ThreadTurn }[],
  failList: () => false,
  failThread: () => false,
  putStatus: (() => 204) as (body: ThreadTurn) => number,
  gate: {} as {
    search?: Promise<void>;
    thread?: Promise<void>;
    list?: Promise<void>;
  },
};

const userOf = (init?: RequestInit) =>
  new Headers(init?.headers).get("Authorization")?.split(".")[1] ?? "";

function threadsOf(user: string) {
  const threads = server.threads.get(user) ?? [];
  server.threads.set(user, threads);
  return threads;
}

function seedThread(user: string, id: string, turns: ThreadTurn[]) {
  threadsOf(user).push({
    id,
    title: turns[0].request.query,
    lastAt: turns[turns.length - 1].at,
    turns,
  });
}

async function handle(url: string, init?: RequestInit): Promise<Response> {
  if (url.startsWith("/api/v1/places/suggest")) return Response.json([]);
  if (url === "/api/v1/places/search") {
    const body = JSON.parse(String(init?.body));
    if (body.query === NEARBY_QUERY) {
      return Response.json({
        conditions: {},
        nearby: true,
        totalCount: 1,
        items: [card(9)],
      } satisfies PlaceSearchResponse);
    }
    server.searches.push(body);
    await server.gate.search;
    // 400은 쿼리 클라이언트가 다시 시도하지 않아 곧바로 실패한다
    if (body.query === "실패")
      return Response.json({ status: 400 }, { status: 400 });
    if (body.cursor) {
      return Response.json({
        conditions: {},
        nearby: false,
        totalCount: 3,
        items: [card(3)],
      } satisfies PlaceSearchResponse);
    }
    const followUp = body.previousConditions !== undefined;
    return Response.json({
      conditions: followUp
        ? { ...body.previousConditions, quiet: true }
        : { area: "역삼", price: null, mood: {} },
      nearby: false,
      totalCount: 3,
      items: followUp ? [card(2)] : [card(1), card(2)],
      ...(!followUp && { nextCursor: "Mg" }),
    } satisfies PlaceSearchResponse);
  }
  const user = userOf(init);
  const list = url.match(/^\/api\/v1\/me\/search-threads(?:\?cursor=(.*))?$/);
  if (list) {
    const cursor = list[1];
    server.lists.push({ user, cursor });
    await server.gate.list;
    if (server.failList())
      return Response.json({ status: 500 }, { status: 500 });
    const sorted = [...threadsOf(user)].sort(
      (a, b) => b.lastAt - a.lastAt || b.id.localeCompare(a.id),
    );
    const start = cursor ? Number(cursor) : 0;
    return Response.json({
      items: sorted
        .slice(start, start + 20)
        .map(({ id, title, lastAt }) => ({ id, title, lastAt })),
      ...(start + 20 < sorted.length && { nextCursor: String(start + 20) }),
    });
  }
  const read = url.match(/^\/api\/v1\/me\/search-threads\/([^/]+)$/);
  if (read) {
    server.reads.push(read[1]);
    await server.gate.thread;
    if (server.failThread())
      return Response.json({ status: 500 }, { status: 500 });
    const thread = threadsOf(user).find(({ id }) => id === read[1]);
    if (!thread) return Response.json({ status: 404 }, { status: 404 });
    return Response.json({ id: thread.id, turns: thread.turns });
  }
  const put = url.match(
    /^\/api\/v1\/me\/search-threads\/([^/]+)\/turns\/([^/]+)$/,
  );
  if (put && init?.method === "PUT") {
    const body: ThreadTurn = JSON.parse(String(init.body));
    server.puts.push({ user, thread: put[1], body });
    const status = server.putStatus(body);
    if (status !== 204) return Response.json({ status }, { status });
    let thread = threadsOf(user).find(({ id }) => id === put[1]);
    if (!thread) {
      thread = {
        id: put[1],
        title: body.request.query,
        lastAt: body.at,
        turns: [],
      };
      threadsOf(user).push(thread);
    }
    if (!thread.turns.some(({ id }) => id === body.id)) {
      thread.turns.push(body);
      thread.lastAt = body.at;
    }
    return new Response(null, { status: 204 });
  }
  throw new Error(`예상 밖 요청 ${url}`);
}

const GUEST_KEY = "fit-dining:guest-search-threads";

// 저장한 장소는 이 테스트의 관심 밖이라 비로그인으로 둔다
const noBookmarks: BookmarkAccess = {
  session: { status: "guest" },
  currentUserId: () => undefined,
  send: () => Promise.reject(new Error("비로그인")),
  endSession: () => {},
  login: () => {},
};

function renderApp() {
  return render(
    <Providers>
      <SearchScreen bookmarks={noBookmarks} threadAuth={threadAuth} />
    </Providers>,
  );
}

async function newSearch(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
    target: { value: text },
  });
  fireEvent.submit(screen.getByRole("search"));
}

async function followUp(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "후속 조건" }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: `“${text}”` })).toBeTruthy(),
  );
}

const results = () => screen.findByRole("list", { name: "추천 장소" });

async function openRecent() {
  fireEvent.click(screen.getAllByRole("button", { name: "최근 검색" })[0]);
  return screen.findByRole("dialog", { name: "최근 검색" });
}

const rowsOf = (sheet: HTMLElement) =>
  within(
    within(sheet).getByRole("list", { name: "최근 검색 목록" }),
  ).getAllByRole("button");

const firstScreen = () =>
  waitFor(() =>
    expect(screen.getByRole("textbox", { name: "장소 검색" })).toBeTruthy(),
  );

function turn(
  id: string,
  at: number,
  query: string,
  extra: Partial<ThreadTurn> = {},
): ThreadTurn {
  return {
    id,
    kind: "new",
    at,
    request: { query },
    response: {
      conditions: { area: "역삼", price: null, mood: {} },
      nearby: false,
      totalCount: 1,
      items: [card(5)],
    },
    ...extra,
  };
}

beforeEach(() => {
  cleanup();
  server.threads = new Map();
  server.searches = [];
  server.lists = [];
  server.reads = [];
  server.puts = [];
  server.failList = () => false;
  server.failThread = () => false;
  server.putStatus = () => 204;
  server.gate = {};
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, init) => handle(String(input), init)),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  localStorage.clear();
  // 앞 테스트의 화면 상태와 대기분을 버리고 이 테스트의 세션으로 시작한다
  searchStore.reset();
  resetThreadSession();
  setSession(member("u1"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("회원 검색 기록 저장", () => {
  it("성공한 첫 페이지마다 같은 thread에 turn을 서버에 저장하고 기기에는 쓰지 않는다", async () => {
    renderApp();
    await newSearch("역삼 카페");
    await results();
    await followUp("더 조용하게");

    await waitFor(() => expect(server.puts).toHaveLength(2));
    const [first, second] = server.puts;
    expect(first.user).toBe("u1");
    expect(second.thread).toBe(first.thread);
    expect(first.thread).toBe(searchStore.getSnapshot().threadId);
    expect(second.body).toMatchObject({
      kind: "followUp",
      baseId: first.body.id,
    });
    expect(first.body.response).not.toHaveProperty("nextCursor");
    expect(localStorage.getItem(GUEST_KEY)).toBeNull();
  });

  it("다음 페이지, 첫 화면 주변 카드, 실패하거나 취소한 검색은 저장하지 않는다", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          private readonly callback: (e: { isIntersecting: boolean }[]) => void,
        ) {}
        observe() {
          this.callback([{ isIntersecting: true }]);
        }
        disconnect() {}
      },
    );
    renderApp();
    await screen.findByText("장소 9");
    await newSearch("역삼 카페");
    await screen.findByText("장소 3");
    await waitFor(() => expect(server.puts).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
    await newSearch("실패");
    await screen.findByText("추천을 불러오지 못했어요");
    const gate = deferred();
    server.gate.search = gate.promise;
    fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
    await newSearch("취소할 검색");
    // '검색 취소'는 3초가 지나야 보인다
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "검색 취소" },
        { timeout: 3500 },
      ),
    );
    gate.release();
    await firstScreen();

    expect(server.puts).toHaveLength(1);
  }, 10_000);

  it("저장에 실패해도 검색 결과는 그대로이고 실패를 알리지 않는다", async () => {
    server.putStatus = () => 400;
    renderApp();
    await newSearch("역삼 카페");
    await results();

    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(screen.getByRole("heading", { name: "“역삼 카페”" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/저장/)).toBeNull();
  });
});

describe("회원 최근 검색 시트", () => {
  it("받는 동안 불러오는 중을 보이고, 기록이 없으면 빈 안내를 보인다", async () => {
    const gate = deferred();
    server.gate.list = gate.promise;
    renderApp();

    const sheet = await openRecent();
    expect(
      within(sheet).getByText("최근 검색을 불러오는 중이에요"),
    ).toBeTruthy();
    gate.release();

    expect(
      await within(sheet).findByText(
        "아직 검색한 요청이 없어요. 원하는 분위기나 목적을 말해 보세요.",
      ),
    ).toBeTruthy();
  });

  it("받지 못하면 빈 목록과 다른 실패 안내를 보이고, 다시 시도하면 목록을 보인다", async () => {
    seedThread("u1", "thread-a", [turn("entry-a", 1_000, "역삼 카페")]);
    let fail = true;
    server.failList = () => fail;
    renderApp();

    const sheet = await openRecent();
    expect(
      await within(sheet).findByText("최근 검색을 불러오지 못했어요"),
    ).toBeTruthy();
    expect(within(sheet).queryByText(/아직 검색한 요청이 없어요/)).toBeNull();
    fail = false;
    fireEvent.click(within(sheet).getByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(rowsOf(sheet)).toHaveLength(1));
  });

  it("더 보기로 다음 페이지를 잇고 같은 id는 먼저 받은 것만 보이며, 실패하면 받은 목록을 두고 다시 시도한다", async () => {
    for (let i = 0; i < 25; i++) {
      seedThread("u1", `thread-${String(i).padStart(2, "0")}`, [
        turn(`entry-${i}`, 1_000 + i, `질문 ${i}`),
      ]);
    }
    renderApp();
    const sheet = await openRecent();
    await waitFor(() => expect(rowsOf(sheet)).toHaveLength(20));
    // 첫 페이지를 받은 뒤 다른 기기에서 새 thread가 생겨 첫 페이지 마지막 thread가 다음 페이지에 다시 나온다
    seedThread("u1", "thread-new", [turn("entry-new", 9_000, "새 질문")]);
    let fail = true;
    server.failList = () => fail;

    fireEvent.click(within(sheet).getByRole("button", { name: "더 보기" }));
    expect(
      await within(sheet).findByText("최근 검색을 더 불러오지 못했어요"),
    ).toBeTruthy();
    expect(rowsOf(sheet)).toHaveLength(20);
    fail = false;
    fireEvent.click(within(sheet).getByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(rowsOf(sheet)).toHaveLength(25));
    expect(server.lists.at(-1)?.cursor).toBe("20");
    expect(within(sheet).getAllByText("질문 5")).toHaveLength(1);
    expect(within(sheet).queryByRole("button", { name: "더 보기" })).toBeNull();
  });

  it("시트를 다시 열면 첫 페이지부터 다시 받고, 열린 동안 저장이 끝나도 다시 받지 않는다", async () => {
    renderApp();
    await newSearch("역삼 카페");
    await results();
    await waitFor(() => expect(server.puts).toHaveLength(1));

    let sheet = await openRecent();
    await waitFor(() => expect(rowsOf(sheet)).toHaveLength(1));
    expect(within(rowsOf(sheet)[0]).getByText("보는 중")).toBeTruthy();
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    sheet = await openRecent();
    await waitFor(() => expect(rowsOf(sheet)).toHaveLength(1));

    expect(server.lists).toEqual([{ user: "u1" }, { user: "u1" }]);
  });

  it("고른 줄에 불러오는 중을 보이는 동안 지금 결과를 두고, 받으면 시트를 닫고 검색 호출 없이 그 thread로 바꾼다", async () => {
    seedThread("u1", "thread-a", [
      turn("entry-a1", 1_000, "강남 술집"),
      turn("entry-a2", 2_000, "더 조용하게", {
        kind: "followUp",
        baseId: "entry-a1",
        request: {
          query: "더 조용하게",
          previousConditions: { area: "역삼", price: null, mood: {} },
        },
        response: {
          conditions: { area: "역삼", price: null, mood: {}, quiet: true },
          nearby: false,
          totalCount: 9,
          items: [card(7)],
        },
      }),
    ]);
    renderApp();
    await newSearch("역삼 카페");
    await results();
    const searches = server.searches.length;
    const gate = deferred();
    server.gate.thread = gate.promise;

    const sheet = await openRecent();
    await waitFor(() => expect(rowsOf(sheet)).toHaveLength(2));
    fireEvent.click(within(sheet).getByRole("button", { name: /강남 술집/ }));
    expect(await within(sheet).findByText("불러오는 중")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "“역삼 카페”", hidden: true }),
    ).toBeTruthy();
    gate.release();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "“더 조용하게”" }),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("장소 7")).toBeTruthy();
    expect(server.searches).toHaveLength(searches);

    // 저장된 첫 페이지만 보이고 다음 페이지를 부르지 않는다. 후속은 저장된 conditions를 안쪽 null까지 그대로 보낸다
    await followUp("카페 말고 식당");
    expect(server.searches.at(-1)).toEqual({
      query: "카페 말고 식당",
      previousConditions: { area: "역삼", price: null, mood: {}, quiet: true },
    });
    expect(server.searches.filter((body) => body.cursor)).toEqual([]);
    await waitFor(() =>
      expect(server.puts.at(-1)).toMatchObject({
        thread: "thread-a",
        body: { kind: "followUp", baseId: "entry-a2" },
      }),
    );
  });

  it("받지 못하면 지금 결과를 두고 그 줄에서 다시 시도할 수 있다", async () => {
    seedThread("u1", "thread-a", [turn("entry-a1", 1_000, "강남 술집")]);
    let fail = true;
    server.failThread = () => fail;
    renderApp();
    await newSearch("역삼 카페");
    await results();

    const sheet = await openRecent();
    await waitFor(() => expect(rowsOf(sheet)).toHaveLength(2));
    fireEvent.click(within(sheet).getByRole("button", { name: /강남 술집/ }));
    expect(
      await within(sheet).findByText("불러오지 못했어요. 눌러서 다시 시도"),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "“역삼 카페”", hidden: true }),
    ).toBeTruthy();
    fail = false;
    fireEvent.click(within(sheet).getByRole("button", { name: /강남 술집/ }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "“강남 술집”" })).toBeTruthy(),
    );
  });

  it("받는 동안 다른 줄을 고르면 마지막 것만 반영하고, 시트를 닫으면 받던 것을 버린다", async () => {
    seedThread("u1", "thread-a", [turn("entry-a1", 1_000, "강남 술집")]);
    seedThread("u1", "thread-b", [turn("entry-b1", 2_000, "홍대 카페")]);
    renderApp();
    let gate = deferred();
    server.gate.thread = gate.promise;

    let sheet = await openRecent();
    await waitFor(() => expect(rowsOf(sheet)).toHaveLength(2));
    fireEvent.click(within(sheet).getByRole("button", { name: /강남 술집/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: /홍대 카페/ }));
    gate.release();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "“홍대 카페”" })).toBeTruthy(),
    );
    expect(searchStore.getSnapshot().threadId).toBe("thread-b");

    gate = deferred();
    server.gate.thread = gate.promise;
    sheet = await openRecent();
    await waitFor(() => expect(rowsOf(sheet)).toHaveLength(2));
    fireEvent.click(within(sheet).getByRole("button", { name: /강남 술집/ }));
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    gate.release();
    await act(() => gate.promise);

    expect(searchStore.getSnapshot().threadId).toBe("thread-b");
  });

  it("'보는 중'인 thread를 고르면 다시 받지 않고 시트만 닫는다", async () => {
    renderApp();
    await newSearch("역삼 카페");
    await results();
    await waitFor(() => expect(server.puts).toHaveLength(1));

    const sheet = await openRecent();
    await waitFor(() => expect(rowsOf(sheet)).toHaveLength(1));
    fireEvent.click(rowsOf(sheet)[0]);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.reads).toEqual([]);
  });

  it("다시 열면 서버에 저장된 turn만 보인다", async () => {
    server.putStatus = (body) => (body.kind === "followUp" ? 500 : 204);
    renderApp();
    await newSearch("역삼 카페");
    await results();
    await followUp("더 조용하게");
    const thread = searchStore.getSnapshot().threadId!;
    fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
    await newSearch("강남 술집");
    await results();
    await waitFor(() => expect(server.threads.get("u1")).toHaveLength(2));

    const sheet = await openRecent();
    await waitFor(() => expect(rowsOf(sheet)).toHaveLength(2));
    fireEvent.click(within(sheet).getByRole("button", { name: /역삼 카페/ }));

    await waitFor(() =>
      expect(searchStore.getSnapshot().threadId).toBe(thread),
    );
    expect(
      searchStore.getSnapshot().entries.map(({ sentence }) => sentence),
    ).toEqual(["역삼 카페"]);
  });
});

describe("로그인 세션이 바뀔 때", () => {
  it("로그아웃하면 화면과 캐시를 비워 첫 화면으로 돌아가고, 최근 검색에는 기기의 비회원 기록이 보인다", async () => {
    localStorage.setItem(
      GUEST_KEY,
      JSON.stringify([
        { id: "thread-g", turns: [turn("entry-g", 1_000, "비회원 검색")] },
      ]),
    );
    renderApp();
    await newSearch("역삼 카페");
    await results();
    const sheet = await openRecent();
    await waitFor(() => expect(rowsOf(sheet)).toHaveLength(1));

    act(() => setSession(null));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await firstScreen();
    expect(searchStore.getSnapshot().entries).toEqual([]);
    const guestSheet = await openRecent();
    expect(rowsOf(guestSheet).map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^비회원 검색/),
    ]);
    expect(server.lists).toHaveLength(1);
  });

  it("다른 계정으로 바뀌면 이전 계정의 목록을 쓰지 않고 새 계정 것을 받는다", async () => {
    seedThread("u2", "thread-z", [turn("entry-z", 1_000, "다른 계정 검색")]);
    renderApp();
    await newSearch("역삼 카페");
    await results();
    await waitFor(() => expect(server.puts).toHaveLength(1));

    act(() => setSession(member("u2")));
    await firstScreen();
    const sheet = await openRecent();

    await waitFor(() =>
      expect(rowsOf(sheet).map((row) => row.textContent)).toEqual([
        expect.stringMatching(/^다른 계정 검색/),
      ]),
    );
    expect(server.lists.at(-1)).toEqual({ user: "u2" });
  });

  it("같은 사용자의 새 세션도 비우지만, 같은 세션의 AT 갱신은 화면을 그대로 둔다", async () => {
    renderApp();
    await newSearch("역삼 카페");
    await results();

    act(() => setSession({ ...member("u1"), accessToken: "at.u1.renewed" }));
    expect(screen.getByRole("heading", { name: "“역삼 카페”" })).toBeTruthy();

    act(() => setSession(member("u1", "s2")));
    await firstScreen();
  });

  it("바뀌기 전에 시작한 검색의 응답이 늦게 와도 화면에도 기록에도 남지 않는다", async () => {
    renderApp();
    const gate = deferred();
    server.gate.search = gate.promise;
    await newSearch("역삼 카페");
    await waitFor(() => expect(server.searches).toHaveLength(1));

    act(() => setSession(member("u2")));
    gate.release();
    await act(() => gate.promise);

    await firstScreen();
    expect(screen.queryByRole("list", { name: "추천 장소" })).toBeNull();
    expect(searchStore.getSnapshot().entries).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(server.puts).toEqual([]);
  });

  it("비회원일 때 시작한 검색이 로그인 뒤에 끝나면 화면에도 기록에도 남지 않는다", async () => {
    act(() => setSession(null));
    renderApp();
    const gate = deferred();
    server.gate.search = gate.promise;
    await newSearch("역삼 카페");
    await waitFor(() => expect(server.searches).toHaveLength(1));

    act(() => setSession(member("u1")));
    gate.release();
    await act(() => gate.promise);

    await firstScreen();
    expect(searchStore.getSnapshot().entries).toEqual([]);
    expect(localStorage.getItem(GUEST_KEY)).toBeNull();
    expect(server.puts).toEqual([]);
  });

  it("바뀌기 전에 시작한 thread 읽기는 끝나도 화면을 바꾸지 않는다", async () => {
    seedThread("u1", "thread-a", [turn("entry-a1", 1_000, "강남 술집")]);
    renderApp();
    const gate = deferred();
    server.gate.thread = gate.promise;
    const sheet = await openRecent();
    await waitFor(() => expect(rowsOf(sheet)).toHaveLength(1));
    fireEvent.click(rowsOf(sheet)[0]);
    await waitFor(() => expect(server.reads).toHaveLength(1));

    act(() => setSession(member("u2")));
    gate.release();
    await act(() => gate.promise);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(searchStore.getSnapshot().threadId).toBeUndefined();
  });

  it("기록 API가 만료가 아닌 401을 주면 이 탭의 세션을 지우고 화면을 비운다", async () => {
    server.putStatus = () => 401;
    renderApp();
    await newSearch("역삼 카페");

    await waitFor(() => expect(server.puts).toHaveLength(1));
    await firstScreen();
    expect(auth.session).toBeNull();
    expect(searchStore.getSnapshot().entries).toEqual([]);
  });

  it("검색 화면이 떠 있지 않을 때 바뀌어도 장소 상세가 이전 카드를 보이지 않는다", async () => {
    function StoredCard() {
      const stored = useStoredCard(1);
      return <p>{stored ? `카드 ${stored.place.name}` : "카드 없음"}</p>;
    }
    const { rerender } = renderApp();
    await newSearch("역삼 카페");
    await results();
    rerender(
      <Providers>
        <StoredCard />
      </Providers>,
    );
    expect(screen.getByText("카드 장소 1")).toBeTruthy();

    act(() => setSession(null));

    expect(screen.getByText("카드 없음")).toBeTruthy();
  });
});
