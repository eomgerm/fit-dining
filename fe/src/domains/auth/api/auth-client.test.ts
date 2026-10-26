import { test, vi } from "vitest";
import assert from "node:assert/strict";

const load = () => {
  vi.resetModules();
  return import("./auth-client");
};
const value = (token = "at-1", expires = Date.now() / 1000 + 1800) => ({
  userId: "user-1",
  accessToken: token,
  nickname: "demo",
  sessionId: "sid-1",
  accessExpiresAt: expires,
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
      postMessage(message: string) {
        messages.push(message);
      }
    },
  );
  return {
    messages,
    reset() {
      if (oldNavigator)
        Object.defineProperty(globalThis, "navigator", oldNavigator);
      else Reflect.deleteProperty(globalThis, "navigator");
      globalThis.fetch = oldFetch;
      globalThis.BroadcastChannel = oldChannel;
    },
  };
}

test("simultaneous expired API requests share one refresh and retry once", async () => {
  let refreshes = 0;
  const env = environment(async (url, options) => {
    if (url.endsWith("/login")) return json(value());
    if (url.endsWith("/refresh")) {
      refreshes++;
      return json(value("at-2"));
    }
    if (options.headers.Authorization === "Bearer at-1")
      return json(
        {
          type: "urn:fitdining:auth:access-token-expired",
          status: 401,
          detail: "expired",
        },
        401,
      );
    return json({ message: "ok" });
  });
  try {
    const auth = await load();
    await auth.login("demo", "password");
    const results = await Promise.all([
      auth.authenticated("/protected"),
      auth.authenticated("/me"),
    ]);
    assert.equal(refreshes, 1);
    assert.deepEqual(results, [{ message: "ok" }, { message: "ok" }]);
    assert.equal(auth.getSession()?.accessToken, "at-2");
    assert.equal(auth.getSession()?.userId, "user-1");
  } finally {
    env.reset();
  }
});

test("revoked sessions never automatically refresh and discard the access token", async () => {
  let refreshes = 0;
  const env = environment(async (url) => {
    if (url.endsWith("/login")) return json(value());
    if (url.endsWith("/refresh")) refreshes++;
    return json({ status: 401, detail: "revoked" }, 401);
  });
  try {
    const auth = await load();
    await auth.login("demo", "password");
    await assert.rejects(auth.authenticated("/me"), {
      status: 401,
    });
    assert.equal(refreshes, 0);
    assert.equal(auth.getSession(), null);
  } finally {
    env.reset();
  }
});

test("logout uses only its cookie even with expired AT then clears memory", async () => {
  const calls: string[] = [];
  const env = environment(async (url, options) => {
    const path = new URL(url, "http://localhost:3000").pathname;
    calls.push(path);
    if (url.endsWith("/login")) return json(value("old", 0));
    if (url.endsWith("/refresh")) return json(value("new"));
    assert.equal(options.headers, undefined);
    assert.equal(options.credentials, "include");
    return new Response(null, { status: 204 });
  });
  try {
    const auth = await load();
    await auth.login("demo", "password");
    await auth.logout();
    assert.deepEqual(calls, ["/api/auth/login", "/api/auth/logout"]);
    assert.equal(auth.getSession(), null);
    assert.equal(env.messages.length, 2);
  } finally {
    env.reset();
  }
});

test("logout without a memory session does not refresh", async () => {
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
      ? json(value("old", 0))
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

test("signup normalizes inputs, stores nickname and broadcasts under cookie lock", async () => {
  const env = environment(async (url, options) => {
    assert.equal(url, "/api/auth/signup");
    assert.equal(options.credentials, "include");
    assert.deepEqual(JSON.parse(String(options.body)), {
      email: "new@example.com",
      password: "password1",
      nickname: "new",
      agreements: { ageOver14: true, terms: true, privacy: true },
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
      }),
      { status: 409 },
    );
    assert.equal(auth.getSession()?.nickname, "demo");
    assert.equal(env.messages.length, 1);
  } finally {
    env.reset();
  }
});

test("missing browser locks fails before sending credentials", async () => {
  let calls = 0;
  const env = environment(async () => {
    calls++;
    return json(value());
  }, false);
  try {
    const auth = await load();
    await assert.rejects(auth.login("demo", "password"), {
      status: 0,
    });
    assert.equal(calls, 0);
  } finally {
    env.reset();
  }
});
