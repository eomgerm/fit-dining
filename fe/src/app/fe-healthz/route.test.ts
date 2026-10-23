import { expect, it } from "vitest";

import { GET } from "./route";

it("GET /fe-healthz는 의존성 없이 상태만 반환하고 캐시하지 않는다", async () => {
  const response = GET();

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("ok");
  expect(response.headers.get("Content-Type")).toBe("text/plain");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
