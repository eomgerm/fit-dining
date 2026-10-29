// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/api/api-error";

import type { WithAccessToken } from "../api/queries";
import { UnreadablePhotoError } from "../model/photo-compress";
import { useReviewPhotos } from "./use-review-photos";

const api = vi.hoisted(() => ({
  fetchPhotoUploads: vi.fn(),
  putPhoto: vi.fn(),
}));
vi.mock("../api/review-api", () => api);

const compress = vi.hoisted(() => ({ compressPhoto: vi.fn() }));
vi.mock("../model/photo-compress", async (original) => ({
  ...(await original<typeof import("../model/photo-compress")>()),
  compressPhoto: compress.compressPhoto,
}));

const withAccessToken: WithAccessToken = (send) => send("token");
const file = (name: string) => new File(["x"], name, { type: "image/jpeg" });
let issued = 0;

function mount(
  saved: { photoId: string; url: string; thumbUrl: string }[] = [],
) {
  const onUnreadable = vi.fn();
  const view = renderHook(() =>
    useReviewPhotos({ saved, max: 5, withAccessToken, onUnreadable }),
  );
  return { ...view, onUnreadable };
}

beforeEach(() => {
  issued = 0;
  compress.compressPhoto.mockReset().mockResolvedValue({
    photo: new Blob(["photo"]),
    thumb: new Blob(["thumb"]),
  });
  api.fetchPhotoUploads.mockReset().mockImplementation(async () => {
    issued += 1;
    return {
      uploads: [
        {
          photoId: `photo-${issued}`,
          uploadUrl: `/fit-dev-photos/pending/photo-${issued}.jpg?sig`,
          thumbUploadUrl: `/fit-dev-photos/pending/photo-${issued}.thumb.jpg?sig`,
          expiresAt: "2026-10-21T12:10:00+09:00",
        },
      ],
    };
  });
  api.putPhoto.mockReset().mockResolvedValue(undefined);
});

describe("useReviewPhotos", () => {
  it("고른 사진을 줄여 두 주소에 올리고, 다 올리면 사진 id를 요청에 담는다", async () => {
    const { result } = mount();

    act(() => {
      result.current.add([file("a.jpg")]);
    });
    expect(result.current.busy).toBe(true);

    await waitFor(() => expect(result.current.photoIds).toEqual(["photo-1"]));
    expect(result.current.busy).toBe(false);
    expect(api.fetchPhotoUploads).toHaveBeenCalledWith(
      1,
      "token",
      expect.any(AbortSignal),
    );
    expect(api.putPhoto.mock.calls.map(([url]) => url)).toEqual([
      "/fit-dev-photos/pending/photo-1.jpg?sig",
      "/fit-dev-photos/pending/photo-1.thumb.jpg?sig",
    ]);
    // 미리보기는 해제할 필요가 없는 data URL이라 화면이 숨었다 돌아와도 깨지지 않는다
    expect(result.current.tiles[0].previewUrl).toMatch(/^data:/);
  });

  it("남은 칸만큼만 받고 받지 못한 수를 돌려준다", async () => {
    const saved = ["s1", "s2", "s3", "s4"].map((photoId) => ({
      photoId,
      url: `/photos/dev/confirmed/${photoId}.jpg`,
      thumbUrl: `/photos/dev/confirmed/${photoId}.thumb.jpg`,
    }));
    const { result } = mount(saved);

    let skipped = 0;
    act(() => {
      skipped = result.current.add([file("a.jpg"), file("b.jpg")]);
    });

    expect(skipped).toBe(1);
    await waitFor(() => expect(result.current.tiles).toHaveLength(5));
  });

  it("읽을 수 없는 사진이 아닌 다른 압축 실패도 칸을 빼고 알린다(7-E04)", async () => {
    compress.compressPhoto.mockRejectedValue(new TypeError("OffscreenCanvas"));
    const { result, onUnreadable } = mount();

    act(() => {
      result.current.add([file("a.jpg")]);
    });

    await waitFor(() => expect(onUnreadable).toHaveBeenCalledTimes(1));
    expect(result.current.tiles).toEqual([]);
  });

  it("여러 장을 고르면 한 장씩 차례로 줄인다", async () => {
    const pending: (() => void)[] = [];
    compress.compressPhoto.mockImplementation(
      () =>
        new Promise((resolve) =>
          pending.push(() =>
            resolve({ photo: new Blob(["p"]), thumb: new Blob(["t"]) }),
          ),
        ),
    );
    const { result } = mount();

    act(() => {
      result.current.add([file("a.jpg"), file("b.jpg")]);
    });
    await waitFor(() =>
      expect(compress.compressPhoto).toHaveBeenCalledTimes(1),
    );
    await act(async () => pending[0]());

    await waitFor(() =>
      expect(compress.compressPhoto).toHaveBeenCalledTimes(2),
    );
  });

  it("올리는 중에 빼면 요청을 멈추고 늦게 온 결과를 무시한다", async () => {
    let signal: AbortSignal | undefined;
    api.putPhoto.mockImplementation(
      (_url: string, _body: Blob, abort: AbortSignal) => {
        signal = abort;
        return new Promise(() => {});
      },
    );
    const { result } = mount();
    act(() => {
      result.current.add([file("a.jpg")]);
    });
    await waitFor(() => expect(signal).toBeDefined());

    act(() => {
      result.current.remove(result.current.tiles[0].key);
    });

    expect(signal?.aborted).toBe(true);
    expect(result.current.tiles).toEqual([]);
  });

  it("화면을 떠나면 올리던 요청을 멈춘다", async () => {
    let signal: AbortSignal | undefined;
    api.putPhoto.mockImplementation(
      (_url: string, _body: Blob, abort: AbortSignal) => {
        signal = abort;
        return new Promise(() => {});
      },
    );
    const { result, unmount } = mount();
    act(() => {
      result.current.add([file("a.jpg")]);
    });
    await waitFor(() => expect(signal).toBeDefined());

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it("읽을 수 없는 사진은 칸을 빼고 알린다(7-E04)", async () => {
    compress.compressPhoto.mockRejectedValue(new UnreadablePhotoError());
    const { result, onUnreadable } = mount();

    act(() => {
      result.current.add([file("a.heic")]);
    });

    await waitFor(() => expect(onUnreadable).toHaveBeenCalledTimes(1));
    expect(result.current.tiles).toEqual([]);
    expect(api.fetchPhotoUploads).not.toHaveBeenCalled();
  });

  it("올리지 못하면 칸에 남기고, 다시 올리면 새 주소로 올린다", async () => {
    api.putPhoto.mockRejectedValueOnce(new ApiError("network", ""));
    const { result } = mount();

    act(() => {
      result.current.add([file("a.jpg")]);
    });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.photoIds).toEqual([]);

    act(() => {
      result.current.retry(result.current.tiles[0].key);
    });

    await waitFor(() => expect(result.current.photoIds).toEqual(["photo-2"]));
    expect(result.current.failed).toBe(false);
  });

  it("저장된 사진으로 시작하고, 빼면 요청에서도 빠진다", () => {
    const { result } = mount([
      { photoId: "s1", url: "/s1.jpg", thumbUrl: "/s1.thumb.jpg" },
      { photoId: "s2", url: "/s2.jpg", thumbUrl: "/s2.thumb.jpg" },
    ]);
    expect(result.current.photoIds).toEqual(["s1", "s2"]);

    act(() => {
      result.current.remove("s1");
    });

    expect(result.current.photoIds).toEqual(["s2"]);
    expect(result.current.tiles[0].previewUrl).toBe("/s2.thumb.jpg");
  });

  it("줄이는 동안 빼면 올리지 않는다", async () => {
    let finish: (value: { photo: Blob; thumb: Blob }) => void = () => {};
    compress.compressPhoto.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = mount();

    act(() => {
      result.current.add([file("a.jpg")]);
    });
    act(() => {
      result.current.remove(result.current.tiles[0].key);
    });
    await act(async () => {
      finish({ photo: new Blob(["p"]), thumb: new Blob(["t"]) });
    });

    expect(result.current.tiles).toEqual([]);
    expect(api.fetchPhotoUploads).not.toHaveBeenCalled();
  });
});
