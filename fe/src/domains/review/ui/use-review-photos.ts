"use client";

import { useEffect, useRef, useState } from "react";

import type { WithAccessToken } from "../api/queries";
import { fetchPhotoUploads, putPhoto } from "../api/review-api";
import { compressPhoto } from "../model/photo-compress";
import type { PhotoView } from "../model/review";

// 사진 칸 하나. 저장된 사진(수정 화면)이거나, 고른 사진을 줄이는 중·올리는 중·다 올림·올리지 못함이다
export type PhotoTile = {
  key: string;
  status: "saved" | "processing" | "uploading" | "uploaded" | "failed";
  // 저장된 사진은 사진 id, 다 올린 사진은 업로드 id다. 요청에는 이 값을 담는다(D-45)
  photoId?: string;
  // 저장된 사진은 썸네일 주소, 고른 사진은 줄인 썸네일의 data URL. 줄이는 동안은 없다
  previewUrl?: string;
};

export type ReviewPhotos = ReturnType<typeof useReviewPhotos>;

// 7-E04. 읽을 수 없는 사진(HEIC를 지원하지 않는 브라우저, 깨진 파일 등)을 골랐을 때의 토스트
export const UNREADABLE_PHOTO = "이 사진은 올릴 수 없어요";

type Blobs = { photo: Blob; thumb: Blob };

// 작성·수정 화면의 사진 칸(D-45). 고르는 즉시 줄여서 올리고, 등록·수정 요청에는 다 올린 사진의 id만 담는다.
// 줄이기는 메모리를 아끼려고 한 장씩 차례로 한다. 미리보기는 해제할 필요가 없는 data URL이라
// Next가 화면을 숨겼다 다시 보여도 깨지지 않는다. 올리지 못한 사진은 칸에 남겨 다시 올리거나 뺄 수 있게 하고,
// 읽을 수 없는 사진은 칸을 빼고 알린다(7-E04). 빼거나 화면을 떠나면 올리던 요청을 멈춘다
export function useReviewPhotos({
  saved,
  max,
  withAccessToken,
  onUnreadable,
}: {
  saved: readonly PhotoView[];
  max: number;
  withAccessToken: WithAccessToken;
  onUnreadable: () => void;
}) {
  const [tiles, setTiles] = useState<PhotoTile[]>(() =>
    saved.map((photo) => ({
      key: photo.photoId,
      status: "saved",
      photoId: photo.photoId,
      previewUrl: photo.thumbUrl,
    })),
  );
  const blobs = useRef(new Map<string, Blobs>());
  const uploads = useRef(new Map<string, AbortController>());
  const removed = useRef(new Set<string>());
  const compressing = useRef<Promise<unknown>>(Promise.resolve());
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    const running = uploads.current;
    return () => {
      active.current = false;
      running.forEach((controller) => controller.abort());
    };
  }, []);

  const patch = (key: string, next: Partial<PhotoTile>) =>
    setTiles((current) =>
      current.map((tile) => (tile.key === key ? { ...tile, ...next } : tile)),
    );

  async function upload(key: string) {
    const files = blobs.current.get(key);
    if (!files) return;
    const controller = new AbortController();
    uploads.current.set(key, controller);
    patch(key, { status: "uploading" });
    try {
      const {
        uploads: [target],
      } = await withAccessToken((accessToken) =>
        fetchPhotoUploads(1, accessToken, controller.signal),
      );
      await putPhoto(target.uploadUrl, files.photo, controller.signal);
      await putPhoto(target.thumbUploadUrl, files.thumb, controller.signal);
      patch(key, { status: "uploaded", photoId: target.photoId });
    } catch {
      patch(key, { status: "failed" });
    } finally {
      if (uploads.current.get(key) === controller) uploads.current.delete(key);
    }
  }

  // 앞 사진을 다 줄인 뒤에 줄인다. 원본 크기 비트맵을 여러 장 동시에 들고 있지 않게 한다
  function compressInTurn(file: File) {
    const run = compressing.current.then(() => compressPhoto(file));
    compressing.current = run.catch(() => undefined);
    return run;
  }

  async function prepare(key: string, file: File) {
    let files: Blobs;
    let previewUrl: string;
    try {
      files = await compressInTurn(file);
      previewUrl = await dataUrl(files.thumb);
    } catch {
      if (!removed.current.has(key)) {
        remove(key);
        onUnreadable();
      }
      return;
    }
    if (removed.current.has(key)) return;
    blobs.current.set(key, files);
    patch(key, { previewUrl });
    // 줄이는 사이 화면을 떠났으면 올리지 않고 다시 올리기를 남긴다
    if (!active.current) {
      patch(key, { status: "failed" });
      return;
    }
    await upload(key);
  }

  // 남은 칸만큼만 받는다. 받지 못한 수를 돌려준다
  function add(files: readonly File[]) {
    const accepted = files.slice(0, Math.max(0, max - tiles.length));
    const added = accepted.map((file) => ({
      file,
      tile: { key: crypto.randomUUID(), status: "processing" } as PhotoTile,
    }));
    setTiles((current) => [...current, ...added.map(({ tile }) => tile)]);
    for (const { file, tile } of added) void prepare(tile.key, file);
    return files.length - accepted.length;
  }

  function remove(key: string) {
    removed.current.add(key);
    blobs.current.delete(key);
    uploads.current.get(key)?.abort();
    uploads.current.delete(key);
    setTiles((current) => current.filter((tile) => tile.key !== key));
  }

  function retry(key: string) {
    void upload(key);
  }

  return {
    tiles,
    add,
    remove,
    retry,
    // 요청에 담을 사진 id. 다 올렸거나 저장된 사진만 화면 순서대로다
    photoIds: tiles.flatMap((tile) =>
      tile.photoId && (tile.status === "saved" || tile.status === "uploaded")
        ? [tile.photoId]
        : [],
    ),
    busy: tiles.some(
      (tile) => tile.status === "processing" || tile.status === "uploading",
    ),
    failed: tiles.some((tile) => tile.status === "failed"),
    max,
  };
}

function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
