// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { csrfHeaders } from "./csrf";
import { request } from "./client";

beforeEach(() => {
  document.cookie = "XSRF-TOKEN=; Max-Age=0; Path=/";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser CSRF", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "%s sends the decoded cookie and preserves headers",
    async (method) => {
      document.cookie = "XSRF-TOKEN=a%2Bb; Path=/";
      const headers = await csrfHeaders(method, {
        "Content-Type": "application/json",
      });
      expect(headers.get("X-XSRF-TOKEN")).toBe("a+b");
      expect(headers.get("Content-Type")).toBe("application/json");
    },
  );
  it("GET neither bootstraps nor sends the header", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await csrfHeaders("GET")).has("X-XSRF-TOKEN")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("concurrent first mutations share one bootstrap then send their headers", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, headers: new Headers(init?.headers) });
        if (url === "/api/auth/csrf") {
          await Promise.resolve();
          document.cookie = "XSRF-TOKEN=issued; Path=/";
        }
        return new Response(null, { status: 204 });
      }),
    );
    await Promise.all([
      request("/one", { method: "POST" }),
      request("/two", { method: "DELETE" }),
    ]);
    expect(calls.filter(({ url }) => url === "/api/auth/csrf")).toHaveLength(1);
    expect(
      calls.slice(1).map(({ headers }) => headers.get("X-XSRF-TOKEN")),
    ).toEqual(["issued", "issued"]);
  });
  it("a failed bootstrap prevents mutation and can be retried", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockImplementationOnce(async () => {
        document.cookie = "XSRF-TOKEN=recovered; Path=/";
        return new Response(null, { status: 204 });
      });
    vi.stubGlobal("fetch", fetchMock);
    await expect(csrfHeaders("POST")).rejects.toMatchObject({ status: 503 });
    expect((await csrfHeaders("POST")).get("X-XSRF-TOKEN")).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("a cookie rotated after login is read again", async () => {
    document.cookie = "XSRF-TOKEN=before; Path=/";
    expect((await csrfHeaders("POST")).get("X-XSRF-TOKEN")).toBe("before");
    document.cookie = "XSRF-TOKEN=after; Path=/";
    expect((await csrfHeaders("POST")).get("X-XSRF-TOKEN")).toBe("after");
  });
});
