import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const NAME = "3f2a1b4c-0000-4000-8000-000000000001.thumb.jpg";

function get(name: string) {
  return GET(
    new Request(`http://localhost:3000/photos/dev/confirmed/${name}`),
    {
      params: Promise.resolve({ env: "dev", name }),
    },
  );
}

describe("로컬 사진 읽기 경로", () => {
  let server: Server;
  let host: string | undefined;

  beforeEach(async () => {
    host = undefined;
    server = createServer((request, response) => {
      host = request.headers.host;
      response.setHeader("Content-Type", "image/jpeg");
      response.statusCode = request.url === `/confirmed/${NAME}` ? 200 : 404;
      response.end(response.statusCode === 200 ? "jpeg" : "not found");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_PHOTO_WEB_URL", `http://127.0.0.1:${port}`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    server.close();
  });

  it("next dev에서는 버킷 웹 Host를 붙여 확정 사진을 넘긴다", async () => {
    const response = await get(NAME);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("jpeg");
    expect(host).toBe("fit-dev-photos.web.garage.localhost");
  });

  it("없는 사진이면 업스트림의 404를 그대로 돌려준다", async () => {
    const missing = "3f2a1b4c-0000-4000-8000-000000000002.jpg";

    const response = await get(missing);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("사진 이름 꼴이 아니면 넘기지 않는다", async () => {
    expect((await get("..%2Fsecret.jpg")).status).toBe(404);
    expect(host).toBeUndefined();
  });

  it("next dev가 아니면 404다. 서버에서는 Caddy가 이 경로를 맡는다", async () => {
    vi.stubEnv("NODE_ENV", "production");

    expect((await get(NAME)).status).toBe(404);
    expect(host).toBeUndefined();
  });
});
