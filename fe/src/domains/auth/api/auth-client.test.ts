import { test, vi } from "vitest";
import assert from "node:assert/strict";

// 로그인 표시 쿠키(next.config의 / rewrite가 읽는다). 이 파일은 node 환경이라 document가 없다
const cookie = vi.hoisted(() => ({
  markSignedIn: vi.fn(),
  clearSignedIn: vi.fn(),
  signedInMarks: vi.fn(() => ""),
}));
vi.mock("../model/signed-in-cookie", () => cookie);

const load = () => {
  vi.resetModules();
  return import("./auth-client");
};
const value = () => ({
  userId: "user-1",
  nickname: "demo",
  sessionExpiresAt: Date.now() / 1000 + 86400,
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function environment(
  mockFetch: (
    url: string,
    options: RequestInit & { headers: Record<string, string> },
  ) => Promise<Response>,
  supportsLocks = true,
) {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldFetch = globalThis.fetch,
    oldChannel = globalThis.BroadcastChannel;
  let queue: Promise<unknown> = Promise.resolve();
  const messages: string[] = [];
  let receive: (() => void) | undefined;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: supportsLocks
        ? {
            request: (_name: string, work: () => Promise<unknown>) => {
              const next = queue.then(work);
              queue = next.catch(() => {});
              return next;
            },
          }
        : undefined,
    },
  });
  vi.stubGlobal("fetch", mockFetch);
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      set onmessage(listener: () => void) {
        receive = listener;
      }
      postMessage(message: string) {
        messages.push(message);
      }
    },
  );
  return {
    messages,
    receive: () => receive?.(),
    reset() {
      if (oldNavigator)
        Object.defineProperty(globalThis, "navigator", oldNavigator);
      else Reflect.deleteProperty(globalThis, "navigator");
      globalThis.fetch = oldFetch;
      globalThis.BroadcastChannel = oldChannel;
    },
  };
}

test("clearSession removes the in-memory session and notifies subscribers", async () => {
  const env = environment(async () => json(value()));
  try {
    const auth = await load();
    await auth.login("demo@example.com", "password123");
    const listener = vi.fn();
    const unsubscribe = auth.subscribe(listener);
    auth.clearSession();
    assert.equal(auth.getSession(), null);
    assert.equal(listener.mock.calls.length, 1);
    unsubscribe();
  } finally {
    env.reset();
  }
});

test("endSession clears the session and notifies other tabs", async () => {
  const env = environment(async () => json(value()));
  try {
    const auth = await load();
    await auth.login("demo@example.com", "password123");
    env.messages.length = 0;
    const listener = vi.fn();
    const unsubscribe = auth.subscribe(listener);
    auth.endSession();
    assert.equal(auth.getSession(), null);
    assert.equal(listener.mock.calls.length, 1);
    assert.deepEqual(env.messages, ["session-changed"]);
    unsubscribe();
  } finally {
    env.reset();
  }
});

// 여러 화면의 동시 세션 확인 요청은 GET /me 한 번으로 합친다
test("simultaneous checks share one me request", async () => {
  let checks = 0;
  const env = environment(async (url) => {
    if (url.endsWith("/me")) {
      checks++;
      return json(value());
    }
    return json(value());
  });
  try {
    const auth = await load();
    const [first, second] = await Promise.all([
      auth.checkSession(),
      auth.checkSession(),
    ]);
    assert.equal(checks, 1);
    assert.equal(first, second);
    assert.equal(auth.getSession()?.userId, "user-1");
  } finally {
    env.reset();
  }
});

test("logout uses its session cookie and clears memory", async () => {
  const calls: string[] = [];
  const env = environment(async (url, options) => {
    const path = new URL(url, "http://localhost:3000").pathname;
    calls.push(path);
    if (url.endsWith("/login")) return json(value());
    if (url.endsWith("/me")) return json(value());
    assert.equal(new Headers(options.headers).has("Authorization"), false);
    assert.equal(options.credentials, "include");
    return new Response(null, { status: 204 });
  });
  try {
    const auth = await load();
    await auth.login("demo", "password");
    cookie.clearSignedIn.mockClear();
    await auth.logout();
    assert.deepEqual(cookie.clearSignedIn.mock.calls, [[]]);
    assert.deepEqual(calls, ["/api/auth/login", "/api/auth/logout"]);
    assert.equal(auth.getSession(), null);
    assert.equal(env.messages.length, 2);
  } finally {
    env.reset();
  }
});

test("logout without a memory session does not restore", async () => {
  const calls: string[] = [];
  const env = environment(async (url) => {
    calls.push(url);
    return new Response(null, { status: 204 });
  });
  try {
    const auth = await load();
    await auth.logout();
    assert.deepEqual(calls, ["/api/auth/logout"]);
    assert.equal(auth.getSession(), null);
  } finally {
    env.reset();
  }
});

test("failed logout clears stale local session on unauthorized", async () => {
  const env = environment(async (url) =>
    url.endsWith("/login")
      ? json(value())
      : json({ status: 401, detail: "expired" }, 401),
  );
  try {
    const auth = await load();
    await auth.login("demo", "password");
    await assert.rejects(auth.logout(), { status: 401 });
    assert.equal(auth.getSession(), null);
  } finally {
    env.reset();
  }
});

test("signup normalizes inputs, stores nickname and broadcasts the cookie change", async () => {
  const env = environment(async (url, options) => {
    assert.equal(url, "/api/auth/signup");
    assert.equal(options.credentials, "include");
    assert.deepEqual(JSON.parse(String(options.body)), {
      email: "new@example.com",
      password: "password1",
      nickname: "new",
      agreements: { ageOver14: true, terms: true, privacy: true },
      verificationToken: "verified-token",
    });
    return json({ ...value(), nickname: "new" }, 201);
  });
  try {
    const auth = await load();
    await auth.signup({
      email: " NEW@Example.com ",
      password: "password1",
      nickname: " new ",
      agreements: { ageOver14: true, terms: true, privacy: true },
      verificationToken: "verified-token",
    });
    assert.equal(auth.getSession()?.nickname, "new");
    assert.deepEqual(env.messages, ["session-changed"]);
  } finally {
    env.reset();
  }
});

test("signup failure preserves current session and does not broadcast", async () => {
  const env = environment(async (url) =>
    url.endsWith("/login")
      ? json(value())
      : json({ type: "urn:fitdining:auth:email-taken", status: 409 }, 409),
  );
  try {
    const auth = await load();
    await auth.login("demo@example.com", "password1");
    await assert.rejects(
      auth.signup({
        email: "demo@example.com",
        password: "password1",
        nickname: "new",
        agreements: { ageOver14: true, terms: true, privacy: true },
        verificationToken: "verified-token",
      }),
      { status: 409 },
    );
    assert.equal(auth.getSession()?.nickname, "demo");
    assert.equal(env.messages.length, 1);
  } finally {
    env.reset();
  }
});

test("login works when Web Locks is unavailable", async () => {
  let calls = 0;
  const env = environment(async () => {
    calls++;
    return json(value());
  }, false);
  try {
    const auth = await load();
    await auth.login("demo", "password");
    assert.equal(calls, 1);
  } finally {
    env.reset();
  }
});

test("social signup saves session and broadcasts the cookie change", async () => {
  const env = environment(async (url, options) => {
    assert.equal(url, "/api/auth/social/signup");
    assert.equal(options.credentials, "include");
    assert.deepEqual(JSON.parse(options.body as string), {
      agreements: { ageOver14: true, terms: true, privacy: true },
    });
    return json(value(), 201);
  });
  try {
    const auth = await load();
    await auth.socialSignup({
      agreements: { ageOver14: true, terms: true, privacy: true },
    });
    assert.equal(auth.getSession()?.userId, "user-1");
    assert.deepEqual(env.messages, ["session-changed"]);
  } finally {
    env.reset();
  }
});

test("email verification request and confirm send normalized email without cookie lock", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const env = environment(async (url, options) => {
    calls.push({ url, body: JSON.parse(String(options.body)) });
    return url.endsWith("/confirm")
      ? json({
          verificationToken: "token-1",
          expiresAt: "2026-11-03T00:30:00Z",
        })
      : json(
          {
            expiresAt: "2026-11-03T00:10:00Z",
            resendAvailableAt: "2026-11-03T00:01:00Z",
          },
          202,
        );
  }, false);
  try {
    const auth = await load();
    assert.equal(
      (await auth.requestEmailVerification(" New@Example.com ")).expiresAt,
      "2026-11-03T00:10:00Z",
    );
    assert.equal(
      (await auth.confirmEmailVerification("New@Example.com", "123456"))
        .verificationToken,
      "token-1",
    );
    assert.deepEqual(calls, [
      {
        url: "/api/auth/email-verifications",
        body: { email: "new@example.com" },
      },
      {
        url: "/api/auth/email-verifications/confirm",
        body: { email: "new@example.com", code: "123456" },
      },
    ]);
    assert.equal(auth.getSession(), null);
    assert.deepEqual(env.messages, []);
  } finally {
    env.reset();
  }
});

test("email verification failure keeps problem type", async () => {
  const env = environment(async () =>
    json(
      { type: "urn:fitdining:auth:verification-code-mismatch", status: 400 },
      400,
    ),
  );
  try {
    const auth = await load();
    await assert.rejects(
      auth.confirmEmailVerification("new@example.com", "000000"),
      (error: unknown) =>
        error instanceof auth.AuthError &&
        error.status === 400 &&
        error.problem?.type === "urn:fitdining:auth:verification-code-mismatch",
    );
  } finally {
    env.reset();
  }
});

// 홈(/)이 첫 HTML부터 맞는 화면을 고르도록 세션이 생기거나 끝날 때 로그인 표시를 맞춘다
// 표시 수명은 기기 시계가 아니라 응답의 Date(서버 시각)로 잰다. 시계가 하루 넘게 빠른 기기에서도 표시가 남게
test("session start marks signed in until the session expires by server time", async () => {
  const serverNow = Date.parse("Wed, 04 Nov 2026 01:00:00 GMT");
  const expires = serverNow / 1000 + 86400;
  const env = environment(
    async () =>
      new Response(JSON.stringify({ ...value(), sessionExpiresAt: expires }), {
        headers: {
          "Content-Type": "application/json",
          Date: new Date(serverNow).toUTCString(),
        },
      }),
  );
  try {
    const auth = await load();
    for (const start of [
      () => auth.login("demo", "password"),
      () =>
        auth.signup({
          email: "a@b.c",
          password: "password123",
          nickname: "demo",
          agreements: { ageOver14: true, terms: true, privacy: true },
          verificationToken: "token",
        }),
      () =>
        auth.socialSignup({
          agreements: { ageOver14: true, terms: true, privacy: true },
        }),
      () => auth.checkSession(),
    ]) {
      cookie.markSignedIn.mockClear();
      await start();
      assert.deepEqual(cookie.markSignedIn.mock.calls, [[expires, serverNow]]);
    }
    assert.equal(cookie.clearSignedIn.mock.calls.length, 0);
  } finally {
    env.reset();
  }
});

test("session end clears the signed-in mark", async () => {
  const env = environment(async (url) =>
    url.endsWith("/me")
      ? json({ status: 401, detail: "expired" }, 401)
      : new Response(null, { status: 204 }),
  );
  try {
    const auth = await load();
    for (const end of [
      () => auth.checkSession().catch(() => {}),
      () => auth.logout(),
      async () => auth.endSession(),
    ]) {
      cookie.clearSignedIn.mockClear();
      await end();
      assert.equal(cookie.clearSignedIn.mock.calls.length, 1);
    }
  } finally {
    env.reset();
  }
});

// 기다리는 사이 새로 심은 표시(소셜 버튼)는 남도록 요청을 보낼 때의 표시 횟수를 넘긴다
test("me 401 clears only the mark that existed when it was sent", async () => {
  const env = environment(async () =>
    json({ status: 401, detail: "expired" }, 401),
  );
  try {
    const auth = await load();
    cookie.clearSignedIn.mockClear();
    cookie.signedInMarks.mockReturnValueOnce("mark-7");
    await assert.rejects(auth.checkSession(), { status: 401 });
    assert.deepEqual(cookie.clearSignedIn.mock.calls, [["mark-7"]]);
  } finally {
    env.reset();
  }
});

test("unauthorized logout also clears the signed-in mark", async () => {
  const env = environment(async () =>
    json({ status: 401, detail: "expired" }, 401),
  );
  try {
    const auth = await load();
    cookie.clearSignedIn.mockClear();
    await assert.rejects(auth.logout(), { status: 401 });
    assert.equal(cookie.clearSignedIn.mock.calls.length, 1);
  } finally {
    env.reset();
  }
});

// AT만 거절된 경우(clearSession)와 연결 실패는 세션이 끝난 게 아니다. RT로 다시 갱신할 수 있다
test("local invalidation or network failure keeps the signed-in mark", async () => {
  const env = environment(async () => {
    throw new TypeError("offline");
  });
  try {
    const auth = await load();
    cookie.clearSignedIn.mockClear();
    auth.clearSession();
    await assert.rejects(auth.checkSession(), { kind: "network" });
    assert.equal(cookie.clearSignedIn.mock.calls.length, 0);
  } finally {
    env.reset();
  }
});

test("session checks use GET me without Web Locks", async () => {
  const env = environment(async (url, options) => {
    assert.equal(url, "/api/auth/me");
    assert.equal(options.method ?? "GET", "GET");
    assert.equal(new Headers(options.headers).has("Authorization"), false);
    return json(value());
  }, false);
  try {
    const auth = await load();
    assert.equal((await auth.restore()).userId, "user-1");
  } finally {
    env.reset();
  }
});

test("a server error checking me keeps login marks and remains unknown", async () => {
  const env = environment(async () => json({ status: 503 }, 503));
  try {
    const auth = await load();
    cookie.clearSignedIn.mockClear();
    await assert.rejects(auth.restore(), { status: 503 });
    assert.equal(auth.getSession(), null);
    assert.equal(cookie.clearSignedIn.mock.calls.length, 0);
  } finally {
    env.reset();
  }
});

test("a late me response cannot restore a locally ended session", async () => {
  let respond!: (response: Response) => void;
  const env = environment(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  try {
    const auth = await load();
    const checking = auth.restore();
    await Promise.resolve();
    auth.endSession();
    respond(json(value()));
    await assert.rejects(checking, { status: 401 });
    assert.equal(auth.getSession(), null);
  } finally {
    env.reset();
  }
});

test.each([
  [200, false],
  [401, false],
  [200, true],
  [401, true],
])(
  "another tab login supersedes an in-flight me response (status=%s, newFirst=%s)",
  async (status, newFirst) => {
    const responses: Array<(response: Response) => void> = [];
    const env = environment(
      async () => new Promise<Response>((resolve) => responses.push(resolve)),
    );
    try {
      const auth = await load();
      const unsubscribe = auth.subscribe(() => {});
      const original = auth.restore();
      await Promise.resolve();
      env.receive();
      const replacement = auth.restore();
      await Promise.resolve();
      assert.equal(responses.length, 2);
      const member = { ...value(), userId: "other-tab-user" };
      if (newFirst) {
        responses[1](json(member));
        await replacement;
        assert.equal(auth.getSession()?.userId, member.userId);
        responses[0](
          status === 401 ? json({ status: 401 }, 401) : json(value()),
        );
      } else {
        responses[0](
          status === 401 ? json({ status: 401 }, 401) : json(value()),
        );
        await Promise.resolve();
        responses[1](json(member));
      }
      assert.equal((await original).userId, member.userId);
      assert.equal((await replacement).userId, member.userId);
      assert.equal(auth.getSession()?.userId, member.userId);
      unsubscribe();
    } finally {
      env.reset();
    }
  },
);
