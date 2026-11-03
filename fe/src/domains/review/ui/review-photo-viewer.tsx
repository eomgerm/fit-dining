"use client";

import { Dialog } from "@base-ui/react/dialog";
import Image from "next/image";
import { useState } from "react";

import { IconButton } from "@/shared/ui/button/icon-button";
import { Carousel } from "@/shared/ui/display/carousel";
import { CloseIcon } from "@/shared/ui/icon/icons/close";

import type { PhotoView } from "../model/review";

// 목록 항목의 사진 줄(6-03). 썸네일을 보이고, 누르면 그 사진부터 1,600px 사진을 넘겨 본다(D-9)
export function ReviewPhotoStrip({
  photos,
  label,
}: {
  photos: readonly PhotoView[];
  // 어느 리뷰의 사진인지(예: "밤산책의 10월 12일 방문 리뷰")
  label: string;
}) {
  const [opened, setOpened] = useState<number | null>(null);
  return (
    <>
      <ul aria-label={`${label} 사진`} className="flex gap-1.5 overflow-x-auto">
        {photos.map((photo, index) => (
          <li
            key={photo.photoId}
            className="relative size-18 shrink-0 overflow-hidden rounded-md bg-surface-sunken"
          >
            <button
              type="button"
              onClick={() => setOpened(index)}
              aria-label={`사진 ${index + 1}/${photos.length} 크게 보기`}
              className="size-full"
            >
              <Image
                src={photo.thumbUrl}
                alt=""
                fill
                unoptimized
                className="object-cover"
              />
            </button>
          </li>
        ))}
      </ul>
      <Dialog.Root
        open={opened !== null}
        onOpenChange={(open) => {
          if (!open) setOpened(null);
        }}
      >
        <Dialog.Portal>
          {/* 뒤의 장소 상세가 비치도록 반투명하게 깐다. 흰 닫기 아이콘의 대비를 지키는 값이다(D-54) */}
          <Dialog.Backdrop className="fixed inset-0 bg-surface-inverse/80 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:duration-120" />
          <Dialog.Popup className="fixed inset-0 flex flex-col transition-opacity duration-200 outline-none data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:duration-120">
            <div className="flex shrink-0 items-center justify-end px-2 pt-2">
              {/* 화면에는 보이지 않고 화면 낭독기가 창 이름으로 읽는다 */}
              <Dialog.Title className="sr-only">사진</Dialog.Title>
              <Dialog.Close
                render={
                  <IconButton label="닫기">
                    <CloseIcon className="text-on-primary" />
                  </IconButton>
                }
              />
            </div>
            {opened !== null && (
              <Carousel
                label={`${label} 사진`}
                index={opened}
                slideClassName="basis-full"
                className="my-auto"
              >
                {photos.map((photo, index) => (
                  <div
                    key={photo.photoId}
                    className="relative aspect-square w-full"
                  >
                    <Image
                      src={photo.url}
                      alt={`사진 ${index + 1}/${photos.length}`}
                      fill
                      unoptimized
                      className="object-contain"
                    />
                  </div>
                ))}
              </Carousel>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
