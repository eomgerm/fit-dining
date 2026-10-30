"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

import { cn } from "@/shared/lib/cn";
import { CameraIcon } from "@/shared/ui/icon/icons/camera";
import { CloseIcon } from "@/shared/ui/icon/icons/close";
import { RefreshIcon } from "@/shared/ui/icon/icons/refresh";
import { SectionHeader } from "@/shared/ui/layout/section-header";
import { useToast } from "@/shared/ui/overlay/toast";

import type { PhotoTile, ReviewPhotos } from "./use-review-photos";

// 작성 2/2(7-04·7-05)와 수정(6-07)의 사진 칸. 고른 사진은 바로 줄여서 올린다(D-45).
// 올리는 동안 칸을 흐리게 두고, 올리지 못하면 칸을 눌러 다시 올린다. 칸을 빼면 옆 칸의 빼기 버튼이나 추가 버튼으로
// 포커스를 옮겨, 누른 버튼이 사라져도 포커스를 잃지 않는다
export function ReviewPhotoField({
  photos,
  hint,
  addLabel,
}: {
  photos: ReviewPhotos;
  hint?: string;
  // 추가 버튼 글자. 없으면 "0/5"처럼 장수를 보인다(6-07). 작성 화면은 "추가"다(7-04)
  addLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const focusAfterRemove = useRef<number | null>(null);
  const toast = useToast();
  const count = photos.tiles.length;

  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null) return;
    focusAfterRemove.current = null;
    const buttons =
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-photo-remove]",
      ) ?? [];
    (buttons[Math.min(index, buttons.length - 1)] ?? addRef.current)?.focus();
  }, [count]);
  return (
    <div className="flex flex-col gap-3">
      <SectionHeader size="md" title="사진" hint={hint} />
      <ul ref={listRef} className="flex flex-wrap gap-2">
        {photos.tiles.map((tile, index) => (
          <PhotoTileView
            key={tile.key}
            tile={tile}
            label={`사진 ${index + 1}`}
            onRemove={() => {
              focusAfterRemove.current = index;
              photos.remove(tile.key);
            }}
            onRetry={() => photos.retry(tile.key)}
          />
        ))}
        {count < photos.max && (
          <li>
            <button
              ref={addRef}
              type="button"
              onClick={() => inputRef.current?.click()}
              aria-label={`사진 추가, ${count}/${photos.max}장`}
              className="flex size-20 flex-col items-center justify-center gap-0.5 rounded-md border border-line-strong bg-surface text-ink-muted"
            >
              <CameraIcon size="md" />
              <span className="text-caption-sm">
                {addLabel ?? `${count}/${photos.max}`}
              </span>
            </button>
          </li>
        )}
      </ul>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // 같은 사진을 다시 골라도 change가 오도록 비운다
          event.target.value = "";
          if (photos.add(files) > 0) {
            toast(`사진은 ${photos.max}장까지 올릴 수 있어요`);
          }
        }}
      />
      <span role="status" className="sr-only">
        {photos.busy
          ? "사진을 올리고 있어요"
          : photos.failed
            ? "올리지 못한 사진이 있어요. 다시 올리거나 빼 주세요"
            : ""}
      </span>
    </div>
  );
}

function PhotoTileView({
  tile,
  label,
  onRemove,
  onRetry,
}: {
  tile: PhotoTile;
  label: string;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const working = tile.status === "processing" || tile.status === "uploading";
  return (
    <li className="relative size-20 overflow-hidden rounded-md bg-surface-sunken">
      {tile.previewUrl ? (
        <Image
          src={tile.previewUrl}
          alt={label}
          fill
          unoptimized
          className={cn("object-cover", working && "opacity-50")}
        />
      ) : (
        <div aria-hidden className="size-full skeleton" />
      )}
      {tile.status === "failed" && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={`${label} 다시 올리기`}
          className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-scrim text-caption-sm text-on-primary"
        >
          <RefreshIcon size="md" />
          다시 시도
        </button>
      )}
      <button
        type="button"
        data-photo-remove
        onClick={onRemove}
        aria-label={`${label} 빼기`}
        className="absolute top-0 right-0 flex size-7 items-center justify-center"
      >
        <span className="flex size-5 items-center justify-center rounded-full bg-scrim text-on-primary">
          <CloseIcon size="sm" />
        </span>
      </button>
    </li>
  );
}
