import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

// connection()은 Next 요청 범위 밖에서 던진다. 빌드 때 미리 렌더링되지 않는지는 수동으로 확인한다
vi.mock("next/server", () => ({ connection: async () => {} }));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of [
    "APP_ENV",
    "NAVER_MAP_CLIENT_ID",
    "POSTHOG_KEY",
    "POSTHOG_HOST",
    "PUSH_PUBLIC_KEY",
  ]) {
    vi.stubEnv(key, undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function getConfig() {
  const response = await GET();
  return { response, body: await response.json() };
}

describe("GET /config.json", () => {
  it("요청 때의 공개 환경변수만 돌려주고 비밀값은 노출하지 않는다", async () => {
    vi.stubEnv("APP_ENV", "prod");
    vi.stubEnv("NAVER_MAP_CLIENT_ID", "abc123");
    vi.stubEnv("BE_INTERNAL_URL", "http://be:8080");
    vi.stubEnv("POSTHOG_KEY", "public-key");
    vi.stubEnv("POSTHOG_HOST", "https://posthog.example.com");
    vi.stubEnv("PUSH_PUBLIC_KEY", "push-key");
    vi.stubEnv("JWT_SECRET", "secret");

    const { body } = await getConfig();

    expect(body).toEqual({
      env: "prod",
      naverMapClientId: "abc123",
      posthogKey: "public-key",
      posthogHost: "https://posthog.example.com",
      pushPublicKey: "push-key",
    });
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
    vi.stubEnv("POSTHOG_KEY", "");
    vi.stubEnv("POSTHOG_HOST", "");
    vi.stubEnv("PUSH_PUBLIC_KEY", "");

    const { body } = await getConfig();

    expect(body).toEqual({ env: "dev" });
  });

  it("캐시하지 않는다", async () => {
    const { response } = await getConfig();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each(["dev", "prod"])(
    "production에서도 유효한 APP_ENV=%s를 쓴다",
    async (env) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_ENV", env);

      const { response, body } = await getConfig();

      expect(response.status).toBe(200);
      expect(body).toEqual({ env });
    },
  );

  it.each([
    ["production", undefined],
    ["production", ""],
    ["production", "staging"],
    ["development", "staging"],
    ["test", " "],
  ])(
    "NODE_ENV=%s, APP_ENV=%s는 내부 정보 없이 실패한다",
    async (nodeEnv, appEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("APP_ENV", appEnv);
      vi.stubEnv("BE_INTERNAL_URL", "http://private-be:8080");
      vi.stubEnv("POSTHOG_KEY", "public-key");

      const { response, body } = await getConfig();

      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(body).toEqual({ error: "Invalid runtime configuration" });
    },
  );
});
