"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/button/button";
import { TextButton } from "@/shared/ui/button/text-button";
import { PinIcon } from "@/shared/ui/icon/icons/pin";
import { locateDevice } from "./locate-device";

function PermissionIllustration() {
  return (
    <div aria-hidden className="relative h-64 w-full overflow-hidden">
      <div className="absolute top-7 left-1/2 h-60 w-38 -translate-x-1/2 rounded-xl border-3 border-line-strong bg-surface p-3 pt-7">
        <div className="h-full rounded-t-lg border-2 border-line" />
      </div>
      <div className="absolute top-26 left-1/2 w-59 -translate-x-1/2 rounded-lg bg-surface p-4 shadow-3">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-primary">
            <PinIcon />
          </span>
          <div className="flex-1 space-y-2">
            <div className="h-2 rounded-full bg-surface-sunken" />
            <div className="h-2 w-7/10 rounded-full bg-surface-sunken" />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="h-2 w-18 rounded-full bg-surface-sunken" />
          <span className="text-label-sm text-primary-strong">허용</span>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-14 bg-linear-to-b from-transparent to-surface-warm" />
    </div>
  );
}

export function LocationScreen() {
  const router = useRouter();
  const requested = useRef(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    async function checkPermission() {
      try {
        const permission = await navigator.permissions.query({
          name: "geolocation",
        });
        if (active && !requested.current && permission.state === "granted")
          router.replace("/");
      } catch {
        // 권한 조회를 지원하지 않는 브라우저에서도 안내와 직접 요청은 제공한다.
      }
    }
    void checkPermission();
    return () => {
      active = false;
    };
  }, [router]);

  async function allowLocation() {
    if (requested.current) return;
    requested.current = true;
    setPending(true);
    await locateDevice();
    router.replace("/");
  }

  function skipLocation() {
    if (requested.current) return;
    requested.current = true;
    router.replace("/");
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-110 flex-col bg-linear-to-b from-primary-soft via-surface-warm to-surface px-5 pb-6 text-ink sm:px-8">
      <header className="-mx-3 flex min-h-14 items-center justify-end">
        <TextButton variant="muted" disabled={pending} onClick={skipLocation}>
          건너뛰기
        </TextButton>
      </header>
      <h1 className="mt-7 text-center text-headline-md">
        {pending ? (
          <>
            가까운 곳부터
            <br />
            보여 드릴게요
          </>
        ) : (
          <>
            위치 권한을
            <br />
            허용해 주세요
          </>
        )}
      </h1>
      <div className="flex flex-1 flex-col items-center justify-center py-6">
        {pending ? (
          <PermissionIllustration />
        ) : (
          <Image
            src="/onboarding/location-illust.webp"
            alt=""
            width={1080}
            height={546}
            className="h-auto w-full"
          />
        )}
        <p
          aria-live="polite"
          className="mt-5 text-center text-body-sm leading-5.5 text-ink-muted"
        >
          {pending ? (
            <>
              위치는 기기 안에서만 쓰고 저장하지 않아요.
              <br />
              허용하지 않으면 역삼역 주변을 보여 드려요.
            </>
          ) : (
            <>
              내 주변 장소를 찾기 위해서
              <br />
              위치 정보가 필요해요.
            </>
          )}
        </p>
      </div>
      <div className="sticky bottom-0 pt-4 pb-0">
        <Button
          className="w-full"
          disabled={pending}
          focusableWhenDisabled
          onClick={allowLocation}
        >
          위치 허용하기
        </Button>
      </div>
    </main>
  );
}
