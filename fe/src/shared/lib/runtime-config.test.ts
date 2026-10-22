import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 모듈이 받은 값을 메모리에 두므로 테스트마다 새로 불러온다
async function load() {
  const { loadRuntimeConfig } = await import("./runtime-config");
  return loadRuntimeConfig;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadRuntimeConfig", () => {
  it("/config.json을 한 번만 받는다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ env: "dev", naverMapClientId: "abc" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const loadRuntimeConfig = await load();

    await expect(loadRuntimeConfig()).resolves.toEqual({
      env: "dev",
      naverMapClientId: "abc",
    });
    await loadRuntimeConfig();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/config.json");
  });

  it("오류 응답이나 연결 실패면 undefined다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(null, { status: 500 })),
    );
    await expect((await load())()).resolves.toBeUndefined();

    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect((await load())()).resolves.toBeUndefined();
  });
});
