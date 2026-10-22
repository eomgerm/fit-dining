import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

// connection()은 Next 요청 범위 밖에서 던진다. 빌드 때 미리 렌더링되지 않는지는 수동으로 확인한다
vi.mock("next/server", () => ({ connection: async () => {} }));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function getConfig() {
  const response = await GET();
  return { response, body: await response.json() };
}

describe("GET /config.json", () => {
  it("요청 때의 환경변수에서 env와 naverMapClientId만 돌려준다", async () => {
    vi.stubEnv("APP_ENV", "prod");
    vi.stubEnv("NAVER_MAP_CLIENT_ID", "abc123");
    vi.stubEnv("BE_INTERNAL_URL", "http://be:8080");

    const { body } = await getConfig();

    expect(body).toEqual({ env: "prod", naverMapClientId: "abc123" });
  });

  it("값을 바꾸면 다음 요청에 새 값이 나온다", async () => {
    vi.stubEnv("NAVER_MAP_CLIENT_ID", "first");
    expect((await getConfig()).body.naverMapClientId).toBe("first");

    vi.stubEnv("NAVER_MAP_CLIENT_ID", "second");
    expect((await getConfig()).body.naverMapClientId).toBe("second");
  });

  it("APP_ENV가 비어 있어도 dev다", async () => {
    vi.stubEnv("APP_ENV", "");

    expect((await getConfig()).body.env).toBe("dev");
  });

  it("APP_ENV가 없으면 dev, 지도 키가 비어 있으면 생략한다", async () => {
    vi.stubEnv("APP_ENV", undefined);
    vi.stubEnv("NAVER_MAP_CLIENT_ID", "");

    const { body } = await getConfig();

    expect(body).toEqual({ env: "dev" });
  });

  it("캐시하지 않는다", async () => {
    const { response } = await getConfig();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
