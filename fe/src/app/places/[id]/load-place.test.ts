import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPlace } from "./load-place";

afterEach(() => {
  vi.unstubAllGlobals();
});

function serve(response: () => Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("loadPlace", () => {
  it("받은 장소 상세를 돌려준다", async () => {
    serve(() => Response.json({ place: { id: 1, name: "카페 온담" } }));

    expect(await loadPlace(1)).toMatchObject({ place: { name: "카페 온담" } });
  });

  it("BE가 404면 not-found다", async () => {
    serve(() => Response.json({ status: 404 }, { status: 404 }));

    expect(await loadPlace(2)).toBe("not-found");
  });

  // dev 엣지 게이트처럼 BE 앞단이 본문 없이 404를 주면 장소가 없는지 알 수 없다. 브라우저가 다시 받게 둔다
  it("ProblemDetail 없는 404는 not-found가 아니라 failed다", async () => {
    serve(() => new Response(null, { status: 404 }));

    expect(await loadPlace(5)).toBe("failed");
  });

  it("그 밖의 실패는 던지지 않고 failed다", async () => {
    serve(() => Response.json({ status: 503 }, { status: 503 }));

    expect(await loadPlace(3)).toBe("failed");
  });

  // 서버가 BE를 오래 기다리면 장소로의 이동이 그만큼 멈춘다. 3초에 끊고 브라우저가 다시 받게 둔다
  it("BE 요청에 3초 제한 신호를 붙인다", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    serve(() => Response.json({ place: { id: 4 } }));

    await loadPlace(4);

    expect(timeout).toHaveBeenCalledWith(3_000);
    timeout.mockRestore();
  });
});
