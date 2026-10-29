import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compressPhoto,
  fitJpeg,
  PHOTO_TARGET,
  THUMB_TARGET,
  UnreadablePhotoError,
  type Encode,
} from "./photo-compress";

// 긴 변과 품질로 크기가 정해지는 가짜 인코더. 호출한 순서를 남긴다
function encoder(size: (edge: number, quality: number) => number) {
  const calls: [number, number][] = [];
  const encode: Encode = vi.fn(async (edge, quality) => {
    calls.push([edge, quality]);
    return new Blob([new Uint8Array(size(edge, quality))]);
  });
  return { encode, calls };
}

describe("fitJpeg", () => {
  it("품질 0.85로 상한 안이면 그대로 쓴다", async () => {
    const { encode, calls } = encoder(() => 500_000);

    const blob = await fitJpeg(4000, PHOTO_TARGET, encode);

    expect(blob.size).toBe(500_000);
    expect(calls).toEqual([[1600, 0.85]]);
  });

  it("상한을 넘으면 0.75, 0.65로 품질을 낮춘다", async () => {
    const { encode, calls } = encoder((_, quality) =>
      quality > 0.7 ? 2_000_000 : 900_000,
    );

    await fitJpeg(4000, PHOTO_TARGET, encode);

    expect(calls).toEqual([
      [1600, 0.85],
      [1600, 0.75],
      [1600, 0.65],
    ]);
  });

  it("품질 하한에서도 넘으면 긴 변을 0.8배씩 줄인다", async () => {
    const { encode, calls } = encoder((edge) =>
      edge > 1300 ? 2_000_000 : 900_000,
    );

    await fitJpeg(4000, PHOTO_TARGET, encode);

    expect(calls.slice(3)).toEqual([[1280, 0.65]]);
  });

  it("작은 사진은 키우지 않는다", async () => {
    const { encode, calls } = encoder(() => 10_000);

    await fitJpeg(300, THUMB_TARGET, encode);

    expect(calls).toEqual([[300, 0.85]]);
  });

  it("줄여도 끝내 넘으면 읽을 수 없는 사진으로 본다", async () => {
    const { encode } = encoder(() => 2_000_000);

    await expect(fitJpeg(4000, PHOTO_TARGET, encode)).rejects.toBeInstanceOf(
      UnreadablePhotoError,
    );
  });
});

describe("compressPhoto", () => {
  const canvases: { width: number; height: number }[] = [];

  // 브라우저의 createImageBitmap과 OffscreenCanvas를 흉내 낸다
  function stubBrowser({
    rejectOrientation = false,
    context = true,
  }: { rejectOrientation?: boolean; context?: boolean } = {}) {
    const decode = vi.fn(async (_file: Blob, options?: object) => {
      if (options && rejectOrientation) throw new TypeError("imageOrientation");
      return { width: 4000, height: 3000, close: vi.fn() };
    });
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {
          canvases.push(this);
        }
        getContext() {
          return context
            ? { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() }
            : null;
        }
        async convertToBlob() {
          return new Blob([new Uint8Array(10)], { type: "image/jpeg" });
        }
      },
    );
    return decode;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    canvases.length = 0;
  });

  it("방향 옵션을 모르는 브라우저면 옵션 없이 다시 읽는다", async () => {
    const decode = stubBrowser({ rejectOrientation: true });

    await compressPhoto(new Blob(["x"]));

    expect(decode).toHaveBeenCalledTimes(2);
    expect(decode.mock.calls[1]).toHaveLength(1);
  });

  it("그리지 못하면 읽을 수 없는 사진으로 본다", async () => {
    stubBrowser({ context: false });

    await expect(compressPhoto(new Blob(["x"]))).rejects.toBeInstanceOf(
      UnreadablePhotoError,
    );
  });

  it("다 쓴 canvas는 바로 비운다", async () => {
    stubBrowser();

    await compressPhoto(new Blob(["x"]));

    expect(canvases.length).toBeGreaterThan(0);
    expect(canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  });
});
