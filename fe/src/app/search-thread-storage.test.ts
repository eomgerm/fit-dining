// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/domains/auth/api/auth-client";
import type { ThreadTurn } from "@/domains/place/model/search-threads";
import type { ApiError as ApiErrorClass } from "@/shared/api/api-error";

// 검색 기록 저장소(thread-storage)와 app 계층의 인증 연결을 함께 돌린다. auth-client와 기록 API 응답만 가짜다.
// 두 모듈 모두 페이지 세션 동안의 상태를 모듈에 두므로 테스트마다 새로 불러온다
const auth = vi.hoisted(() => ({
  session: null as AuthSession | null,
  listeners: new Set<() => void>(),
  restore: vi.fn<() => Promise<AuthSession>>(),
  checkSession: vi.fn<() => Promise<AuthSession>>(),
  clearSession: vi.fn(),
}));

function setSession(session: AuthSession | null) {
  auth.session = session;
  auth.listeners.forEach((listener) => listener());
}

vi.mock("@/domains/auth/api/auth-client", () => ({
  getSession: () => auth.session,
  restore: () => auth.restore(),
  checkSession: () => auth.checkSession(),
  clearSession: () => {
    auth.clearSession();
    setSession(null);
  },
  subscribe: (listener: () => void) => {
    auth.listeners.add(listener);
    return () => auth.listeners.delete(listener);
  },
}));

const session = (userId: string, sessionId = "s1"): AuthSession => ({
  userId,
  nickname: userId,
  sessionExpiresAt: Number(sessionId.replace(/\D/g, "")) || 1,
});

// 모듈을 테스트마다 새로 불러오므로 instanceof가 맞도록 오류 클래스도 그때 불러온다
let ApiError: typeof ApiErrorClass;

const unauthorized = (type?: string) =>
  new ApiError("http", "x", { status: 401, problem: { status: 401, type } });

function turn(id: string, kind: ThreadTurn["kind"] = "new", baseId?: string) {
  return {
    id,
    kind,
    ...(baseId && { baseId }),
    at: 1_761_700_000_000,
    request: { query: "역삼 카페" },
    response: {
      conditions: { area: null },
      nearby: false,
      totalCount: 1,
      items: [],
      nextCursor: "MjA",
    },
  } satisfies ThreadTurn;
}

type Put = { thread: string; turn: string; token: string; body: ThreadTurn };
type Responder = (put: Put) => Response | Promise<Response>;

let puts: Put[];
let responder: Responder;
// 지우기 요청의 경로. 응답은 deleteResponder가 정한다
let deletes: string[];
let deleteResponder: () => Response | Promise<Response>;

function stubFetch() {
  puts = [];
  responder = () => new Response(null, { status: 204 });
  deletes = [];
  deleteResponder = () => new Response(null, { status: 204 });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        deletes.push(url);
        return deleteResponder();
      }
      const match = url.match(
        /^\/api\/v1\/me\/search-threads\/([^/]+)\/turns\/([^/]+)$/,
      );
      if (!match || init?.method !== "PUT") throw new Error(`예상 밖 ${url}`);
      const put: Put = {
        thread: match[1],
        turn: match[2],
        token: new Headers(init.headers).get("X-XSRF-TOKEN") ?? "",
        body: JSON.parse(String(init.body)),
      };
      puts.push(put);
      return responder(put);
    }),
  );
}

const problem = (status: number, type?: string) =>
  Response.json({ status, type }, { status });

async function load() {
  const storage = await import("@/domains/place/ui/thread-storage");
  const { threadAuth } = await import("./search-thread-auth");
  return {
    ...storage,
    threadAuth,
    // 검색을 시작한 때 저장 위치를 정하고, 첫 페이지를 받은 뒤 저장한다
    begin: () => storage.beginSave(threadAuth),
    save: (
      target: ReturnType<typeof storage.beginSave>,
      thread: string,
      t: ThreadTurn,
    ) => storage.saveTurn(target, thread, t, threadAuth),
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(async () => {
  vi.resetModules();
  ({ ApiError } = await import("@/shared/api/api-error"));
  vi.useFakeTimers();
  auth.session = null;
  auth.listeners.clear();
  auth.clearSession.mockReset();
  auth.checkSession.mockReset().mockImplementation(async () => {
    setSession(null);
    throw unauthorized();
  });
  auth.restore
    .mockReset()
    .mockImplementation(async () => auth.session ?? auth.checkSession());
  localStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("비회원", () => {
  it("서버가 세션 없음을 확인하면 기기에만 새 키로 저장하고 기록 API를 부르지 않는다", async () => {
    const { begin, save } = await load();

    save(begin(), "thread-1", turn("entry-1"));
    await flush();

    expect(puts).toEqual([]);
    const stored = JSON.parse(
      localStorage.getItem("fit-dining:guest-search-threads")!,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].turns[0].response).not.toHaveProperty("nextCursor");
  });

  it("세션 없음이 확인된 뒤에는 인증 알림이 와도 다시 복원하지 않는다", async () => {
    const { begin, save } = await load();
    save(begin(), "thread-1", turn("entry-1"));
    await flush();
    setSession(null);

    save(begin(), "thread-1", turn("entry-2", "followUp", "entry-1"));
    await flush();

    expect(auth.restore).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(localStorage.getItem("fit-dining:guest-search-threads")!)[0]
        .turns,
    ).toHaveLength(2);
  });

  it("옛 키는 읽지도 올리지도 않고 처음 쓸 때 지운다", async () => {
    localStorage.setItem(
      "fit-dining:search-threads",
      JSON.stringify([{ id: "thread-old", turns: [turn("entry-old")] }]),
    );
    const { begin, save } = await load();

    save(begin(), "thread-1", turn("entry-1"));
    await flush();

    expect(localStorage.getItem("fit-dining:search-threads")).toBeNull();
    const stored = JSON.parse(
      localStorage.getItem("fit-dining:guest-search-threads")!,
    );
    expect(stored.map(({ id }: { id: string }) => id)).toEqual(["thread-1"]);
  });

  it("thread가 상한 20개를 넘으면 가장 오래된 것부터 빼고, 지금 thread는 시각이 가장 일러도 남긴다(D-19)", async () => {
    const { begin, save } = await load();
    const at = (index: number) => 1_761_700_000_000 + index;
    for (let index = 0; index <= 20; index += 1) {
      save(begin(), `thread-${index}`, {
        ...turn(`entry-${index}`),
        at: at(index),
      });
    }
    await flush();

    const ids = () =>
      JSON.parse(localStorage.getItem("fit-dining:guest-search-threads")!).map(
        ({ id }: { id: string }) => id,
      );
    expect(ids()).toHaveLength(20);
    expect(ids()).not.toContain("thread-0");
    expect(ids()).toContain("thread-20");

    save(begin(), "thread-past", { ...turn("entry-past"), at: at(-1) });
    await flush();

    expect(ids()).toHaveLength(20);
    expect(ids()).toContain("thread-past");
    expect(ids()).not.toContain("thread-1");
  });

  it("저장소가 가득 차면 새 기록은 남지 않고 옛 기록은 그대로다", async () => {
    const { begin, save } = await load();
    save(begin(), "thread-1", turn("entry-1"));
    await flush();
    const before = localStorage.getItem("fit-dining:guest-search-threads");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    save(begin(), "thread-2", turn("entry-2"));
    await flush();

    expect(localStorage.getItem("fit-dining:guest-search-threads")).toBe(
      before,
    );
  });

  it("값이 깨졌거나 저장소를 쓸 수 없어도 저장 호출은 던지지 않는다", async () => {
    localStorage.setItem("fit-dining:guest-search-threads", "{");
    const { begin, save } = await load();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    expect(() => save(begin(), "thread-1", turn("entry-1"))).not.toThrow();
    await flush();
  });
});

describe("세션을 모를 때", () => {
  it("복원이 시간 초과면 어디에도 저장하지 않고, 다음 저장 때 다시 확인한다", async () => {
    auth.restore.mockImplementationOnce(() => new Promise(() => {}));
    const { begin, save } = await load();

    save(begin(), "thread-1", turn("entry-1"));
    await vi.advanceTimersByTimeAsync(3_000);

    expect(puts).toEqual([]);
    expect(localStorage.getItem("fit-dining:guest-search-threads")).toBeNull();
    auth.session = session("u1");
    save(begin(), "thread-2", turn("entry-2"));
    await flush();
    expect(puts.map(({ thread }) => thread)).toEqual(["thread-2"]);
  });

  it("복원이 연결 오류면 어디에도 저장하지 않는다", async () => {
    auth.restore.mockRejectedValueOnce(new ApiError("network", "x"));
    const { begin, save } = await load();

    save(begin(), "thread-1", turn("entry-1"));
    await flush();

    expect(puts).toEqual([]);
    expect(localStorage.getItem("fit-dining:guest-search-threads")).toBeNull();
  });
});

describe("회원", () => {
  beforeEach(() => {
    auth.session = session("u1");
  });

  it("검색을 시작한 세션에서 CSRF 헤더로 보내고 기기에는 쓰지 않는다", async () => {
    const { begin, save } = await load();

    save(begin(), "thread-1", turn("entry-1"));
    await flush();

    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({
      thread: "thread-1",
      turn: "entry-1",
      token: "test-csrf",
    });
    expect(puts[0].body).not.toHaveProperty("nextCursor");
    expect(puts[0].body.response).not.toHaveProperty("nextCursor");
    expect(localStorage.getItem("fit-dining:guest-search-threads")).toBeNull();
  });

  it("한 thread의 turn은 앞 turn이 저장된 뒤에 만든 순서대로 하나씩 보낸다", async () => {
    let release: () => void = () => {};
    responder = ({ turn: id }) =>
      id === "entry-1"
        ? new Promise((resolve) => {
            release = () => resolve(new Response(null, { status: 204 }));
          })
        : new Response(null, { status: 204 });
    const { begin, save } = await load();

    save(begin(), "thread-1", turn("entry-1"));
    save(begin(), "thread-1", turn("entry-2", "followUp", "entry-1"));
    save(begin(), "thread-2", turn("entry-3"));
    await flush();

    expect(puts.map(({ turn: id }) => id)).toEqual(["entry-1", "entry-3"]);
    release();
    await flush();
    expect(puts.map(({ turn: id }) => id)).toEqual([
      "entry-1",
      "entry-3",
      "entry-2",
    ]);
  });

  it("연결 오류와 5xx는 같은 id로 정해진 횟수만 다시 보내고, 끝내 실패하면 그 thread의 뒤 turn은 보내지 않는다", async () => {
    responder = ({ thread }) =>
      thread === "thread-1"
        ? problem(503)
        : new Response(null, { status: 204 });
    const { begin, save } = await load();

    save(begin(), "thread-1", turn("entry-1"));
    await vi.advanceTimersByTimeAsync(60_000);
    save(begin(), "thread-1", turn("entry-2", "followUp", "entry-1"));
    save(begin(), "thread-2", turn("entry-3"));
    await vi.advanceTimersByTimeAsync(60_000);

    const attempts = puts.filter(({ turn: id }) => id === "entry-1");
    expect(attempts).toHaveLength(4);
    expect(new Set(attempts.map(({ body }) => JSON.stringify(body))).size).toBe(
      1,
    );
    expect(puts.map(({ turn: id }) => id)).not.toContain("entry-2");
    expect(puts.map(({ turn: id }) => id)).toContain("entry-3");
  });

  it("다시 보내다 성공하면 뒤 turn을 이어서 보낸다", async () => {
    let failures = 2;
    responder = () => {
      if (failures-- > 0) throw new TypeError("Failed to fetch");
      return new Response(null, { status: 204 });
    };
    const { begin, save } = await load();

    save(begin(), "thread-1", turn("entry-1"));
    save(begin(), "thread-1", turn("entry-2", "followUp", "entry-1"));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(puts.map(({ turn: id }) => id)).toEqual([
      "entry-1",
      "entry-1",
      "entry-1",
      "entry-2",
    ]);
  });

  it("409 conflict는 저장된 것으로 보고 다음 turn을 보낸다", async () => {
    responder = ({ turn: id }) =>
      id === "entry-1"
        ? problem(409, "urn:fitdining:search-thread:conflict")
        : new Response(null, { status: 204 });
    const { begin, save } = await load();

    save(begin(), "thread-1", turn("entry-1"));
    save(begin(), "thread-1", turn("entry-2", "followUp", "entry-1"));
    await flush();

    expect(puts.map(({ turn: id }) => id)).toEqual(["entry-1", "entry-2"]);
  });

  it("401이 아닌 4xx면 다시 보내지 않고 그 thread만 멈추며 다른 thread는 계속 보낸다", async () => {
    responder = ({ thread }) =>
      thread === "thread-1"
        ? problem(409, "urn:fitdining:search-thread:base-missing")
        : new Response(null, { status: 204 });
    const { begin, save } = await load();

    save(begin(), "thread-1", turn("entry-1"));
    await vi.advanceTimersByTimeAsync(60_000);
    save(begin(), "thread-1", turn("entry-2", "followUp", "entry-1"));
    save(begin(), "thread-2", turn("entry-3"));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(puts.map(({ turn: id }) => id)).toEqual(["entry-1", "entry-3"]);
  });

  it("처음 받은 토큰이 다른 계정이면 보내지 않는다", async () => {
    const { begin, save } = await load();
    const target = begin();
    await flush();
    // 검색 도중 다른 계정으로 바뀌었다
    auth.session = session("u2");

    save(target, "thread-1", turn("entry-1"));
    await flush();

    expect(puts).toEqual([]);
  });

  // session 인증(a05ed87) 뒤로는 401에 만료와 그 밖의 구분이 없고, 401에서 checkSession으로 갱신하지 않는다
  it("401이면 다시 보내지 않고, 이 탭의 세션과 이전 회원 화면 상태를 비우며 그 뒤 turn은 보내지 않는다", async () => {
    responder = () => problem(401);
    const { begin, save } = await load();
    const { clearOnSessionChange } = await import("./search-thread-auth");
    const queryClient = { clear: vi.fn() };
    clearOnSessionChange(queryClient as never);

    save(begin(), "thread-1", turn("entry-1"));
    await flush();
    // 서버가 받아 주더라도 같은 turn을 다시 보내지 않는다
    responder = () => new Response(null, { status: 204 });
    save(begin(), "thread-1", turn("entry-2", "followUp", "entry-1"));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(puts.map(({ token, turn: id }) => [token, id])).toEqual([
      ["test-csrf", "entry-1"],
    ]);
    expect(auth.clearSession).toHaveBeenCalledTimes(1);
    expect(queryClient.clear).toHaveBeenCalledTimes(1);
    expect(auth.checkSession).not.toHaveBeenCalled();
  });

  it("세션이 바뀌면 다시 보내려던 대기분을 버린다", async () => {
    responder = () => problem(503);
    const { begin, save, resetThreadSession } = await load();

    save(begin(), "thread-1", turn("entry-1"));
    save(begin(), "thread-1", turn("entry-2", "followUp", "entry-1"));
    await flush();
    resetThreadSession();
    responder = () => new Response(null, { status: 204 });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(puts.map(({ turn: id }) => id)).toEqual(["entry-1"]);
  });

  it("세션이 바뀌기 전에 시작한 저장은 바뀐 뒤에 보내지 않는다", async () => {
    let resolveKey: () => void = () => {};
    const { saveTurn, resetThreadSession, threadAuth } = await load();
    const target = new Promise<never>((resolve) => {
      resolveKey = () =>
        resolve({ kind: "member", userId: "u1", sessionId: "1" } as never);
    });

    saveTurn(target, "thread-1", turn("entry-1"), threadAuth);
    resetThreadSession();
    resolveKey();
    await flush();

    expect(puts).toEqual([]);
  });

  it("페이지 종료 신호 뒤에는 대기분을 보내지 않고 기기에도 남기지 않는다", async () => {
    responder = () => problem(503);
    const { begin, save } = await load();

    save(begin(), "thread-1", turn("entry-1"));
    await flush();
    window.dispatchEvent(new Event("pagehide"));
    responder = () => new Response(null, { status: 204 });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(puts).toHaveLength(1);
    expect(localStorage.length).toBe(0);
  });
});

describe("세션 전환 감지", () => {
  async function watch() {
    const { clearOnSessionChange } = await import("./search-thread-auth");
    const { searchStore } = await import("@/domains/place/model/search-store");
    const queryClient = { clear: vi.fn() };
    clearOnSessionChange(queryClient as never);
    return { queryClient, searchStore };
  }

  it("로그아웃, 다른 계정, 같은 사용자의 새 세션, 비회원의 로그인 때마다 비운다", async () => {
    auth.session = session("u1");
    const { queryClient, searchStore } = await watch();

    setSession(null);
    setSession(session("u2"));
    setSession(session("u2", "s2"));

    expect(queryClient.clear).toHaveBeenCalledTimes(3);
    expect(searchStore.getSnapshot().epoch).toBe(3);
  });

  it("모름에서 확인된 값이 되는 것과 같은 세션의 AT 갱신은 비우지 않는다", async () => {
    const { queryClient } = await watch();

    setSession(session("u1"));
    setSession(session("u1", "s1"));

    expect(queryClient.clear).not.toHaveBeenCalled();
  });
});

describe("최근 검색 지우기(D-18)", () => {
  const member = { kind: "member", userId: "u1", sessionId: "1" } as const;
  const guestIds = () =>
    JSON.parse(
      localStorage.getItem("fit-dining:guest-search-threads") ?? "[]",
    ).map(({ id }: { id: string }) => id);

  describe("회원", () => {
    beforeEach(() => {
      auth.session = session("u1");
    });

    it("대기분을 버리고 보내는 중인 저장이 끝난 뒤 지우며, 그 뒤 그 thread의 이어 검색은 저장하지 않는다", async () => {
      let release: () => void = () => {};
      responder = ({ turn: id }) =>
        id === "entry-1"
          ? new Promise((resolve) => {
              release = () => resolve(new Response(null, { status: 204 }));
            })
          : new Response(null, { status: 204 });
      const { begin, save, removeThread, threadAuth } = await load();
      save(begin(), "thread-1", turn("entry-1"));
      save(begin(), "thread-1", turn("entry-2", "followUp", "entry-1"));
      await flush();

      const removing = removeThread(member, "thread-1", threadAuth);
      await flush();
      expect(deletes).toEqual([]);
      release();
      await flush();
      await removing;

      expect(deletes).toEqual(["/api/v1/me/search-threads/thread-1"]);
      save(begin(), "thread-1", turn("entry-3", "followUp", "entry-1"));
      await flush();
      expect(puts.map(({ turn: id }) => id)).toEqual(["entry-1"]);
    });

    it("다시 보내려고 기다리던 turn도 지우면 다시 보내지 않는다", async () => {
      responder = () => problem(503);
      const { begin, save, removeThread, threadAuth } = await load();
      save(begin(), "thread-1", turn("entry-1"));
      await flush();

      const removing = removeThread(member, "thread-1", threadAuth);
      await vi.advanceTimersByTimeAsync(60_000);
      await removing;

      expect(puts).toHaveLength(1);
      expect(deletes).toEqual(["/api/v1/me/search-threads/thread-1"]);
    });

    it("지우지 못하면 던지고, 그 thread는 계속 저장한다", async () => {
      deleteResponder = () => problem(500);
      const { begin, save, removeThread, threadAuth } = await load();
      save(begin(), "thread-1", turn("entry-1"));
      await flush();

      await expect(
        removeThread(member, "thread-1", threadAuth),
      ).rejects.toBeInstanceOf(ApiError);
      save(begin(), "thread-1", turn("entry-2", "followUp", "entry-1"));
      await flush();

      expect(puts.map(({ turn: id }) => id)).toEqual(["entry-1", "entry-2"]);
    });

    it("모두 지우면 이 페이지에서 저장한 thread는 다시 저장하지 않고, 새 thread는 저장한다", async () => {
      const { begin, save, removeAllThreads, threadAuth } = await load();
      save(begin(), "thread-1", turn("entry-1"));
      await flush();

      await removeAllThreads(member, threadAuth);
      save(begin(), "thread-1", turn("entry-2", "followUp", "entry-1"));
      save(begin(), "thread-2", turn("entry-3"));
      await flush();

      expect(deletes).toEqual(["/api/v1/me/search-threads"]);
      expect(puts.map(({ turn: id }) => id)).toEqual(["entry-1", "entry-3"]);
    });
  });

  describe("비회원", () => {
    it("지운 thread는 기기에서 빠지고, 그 화면에서 이어 검색해도 다시 생기지 않는다", async () => {
      const { begin, save, removeThread } = await load();
      save(begin(), "thread-1", turn("entry-1"));
      save(begin(), "thread-2", turn("entry-2"));
      await flush();

      await removeThread({ kind: "guest" }, "thread-1");
      save(begin(), "thread-1", turn("entry-3", "followUp", "entry-1"));
      await flush();

      expect(guestIds()).toEqual(["thread-2"]);
      expect(deletes).toEqual([]);
    });

    it("모두 지우면 기기 기록을 지운다", async () => {
      const { begin, save, removeAllThreads } = await load();
      save(begin(), "thread-1", turn("entry-1"));
      await flush();

      await removeAllThreads({ kind: "guest" });

      expect(
        localStorage.getItem("fit-dining:guest-search-threads"),
      ).toBeNull();
    });
  });
});
