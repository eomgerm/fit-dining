"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { TopBar } from "@/shared/ui/layout/top-bar";
import { peekResume, takeResume } from "../model/storage";

export type InstallStep = {
  text: ReactNode;
  // public/install/의 브라우저 화면 캡처. 폭은 모두 592px(2배)이다
  image: { src: string; height: number };
};

// 1-01c·1-01d 홈 화면 추가 가이드. 브라우저 메뉴를 실제 화면 캡처로 단계마다 보여 준다
export function InstallGuide({ steps }: { steps: InstallStep[] }) {
  const router = useRouter();
  return (
    <main className="mx-auto min-h-svh w-full max-w-110 bg-surface-warm text-ink">
      <TopBar
        start={
          <IconButton
            label="이전"
            onClick={() => {
              // 로그인하려다 온 거면 최초화면을 거치지 않고 바로 간다. 거치면 최초화면이 비쳤다 바뀌어 깜빡인다
              if (peekResume() === "login") {
                takeResume();
                router.replace("/login");
              } else if (window.history.length > 1) router.back();
              else router.replace("/");
            }}
          >
            <ChevronLeftIcon />
          </IconButton>
        }
      />
      <div className="px-5 pt-1">
        <h1 className="mt-3 text-headline-md">
          홈 화면에 핏다이닝을
          <br />
          추가하세요
        </h1>
        <ol className="mt-4 flex flex-col gap-2">
          {steps.map((step, index) => (
            <li
              key={step.image.src}
              className="rounded-lg bg-surface p-3 shadow-1"
            >
              <div className="flex items-center gap-2 text-body-sm">
                <span
                  aria-hidden="true"
                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-label-sm text-primary-pressed"
                >
                  {index + 1}
                </span>
                <span>{step.text}</span>
              </div>
              <Image
                src={step.image.src}
                alt=""
                width={592}
                height={step.image.height}
                className="mt-2 h-auto w-full rounded-md"
              />
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
