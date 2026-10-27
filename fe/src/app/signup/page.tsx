"use client";

import { startAsGuest } from "@/domains/onboarding/model/storage";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/shared/ui/button/button";
import { TextButton } from "@/shared/ui/button/text-button";
import { Carousel } from "@/shared/ui/display/carousel";
import { CarouselDots } from "@/shared/ui/display/carousel-dots";
import { AlertDialog } from "@/shared/ui/overlay/alert-dialog";
import { useToast } from "@/shared/ui/overlay/toast";
import { SocialButtons } from "@/domains/auth/ui/social-buttons";
import { SocialError } from "@/domains/auth/ui/social-error";
import { BookmarkFilledIcon } from "@/shared/ui/icon/icons/bookmark-filled";

const slides = [
  {
    title: (
      <>
        변화하는 내 취향으로{" "}
        <em className="block text-primary-strong not-italic">검색</em>
      </>
    ),
    description:
      "핏다이닝은 변하는 내 취향을 반영해 나에게 “딱” 맞는 곳을 추천해 줘요",
  },
  {
    title: (
      <>
        다른 기기에서도{" "}
        <em className="block text-primary-strong not-italic">내 취향 그대로</em>
      </>
    ),
    description: "로그인만 하면 다른 기기에서도 내 취향이 그대로 반영돼요",
  },
  {
    title: (
      <>
        마음에 쏙 드는 곳은{" "}
        <em className="block text-primary-strong not-italic">저장</em>
      </>
    ),
    description:
      "내 취향에 맞는 장소였나요? 다음에 방문하기 쉽게 저장해 보세요",
  },
];
function Illustration({ index }: { index: number }) {
  return (
    <div
      aria-hidden
      className="mx-3 my-5 flex h-60 items-center justify-center rounded-xl bg-surface-sunken p-5"
    >
      {index === 0 ? (
        <div className="w-full space-y-3">
          <div className="flex justify-between text-caption-sm text-ink-muted">
            <span>3월</span>
            <span>6월</span>
            <span>9월</span>
          </div>
          <div className="flex h-12 items-end justify-around gap-3">
            {["h-6", "h-10", "h-8", "h-12", "h-9"].map((height, i) => (
              <span
                key={i}
                className={`${height} w-8 rounded-t-sm bg-primary`}
              />
            ))}
          </div>
          <div className="rounded-md bg-surface p-3 text-body-sm shadow-1">
            “조용히 대화하기 좋은 카페”
          </div>
          <div className="flex flex-wrap gap-2 text-caption-sm text-primary-strong">
            <span className="rounded-full bg-primary-soft px-3 py-1">
              조용한 곳
            </span>
            <span className="rounded-full bg-primary-soft px-3 py-1">
              대화하기 좋은 곳
            </span>
          </div>
        </div>
      ) : index === 1 ? (
        <div className="flex w-full items-center justify-center gap-3">
          <div className="w-1/2 rounded-md border border-line-strong bg-surface p-3 shadow-1">
            <p className="mb-3 text-label-sm">내 취향</p>
            <p className="rounded-sm bg-primary-soft p-2 text-caption-sm text-primary-strong">
              조용한 곳<br />
              대화하기 좋은 곳<br />
              자리가 넉넉한 곳
            </p>
          </div>
          <span className="text-title-lg text-primary">↔</span>
          <div className="w-1/3 rounded-md border border-line-strong bg-surface p-2 shadow-1">
            <p className="text-caption-sm">내 취향</p>
            <div className="mt-2 h-14 rounded-sm bg-primary-soft" />
          </div>
        </div>
      ) : (
        <div className="w-4/5 overflow-hidden rounded-lg bg-surface shadow-1">
          <div className="flex h-20 items-center justify-center bg-primary-soft text-primary">
            <BookmarkFilledIcon size="lg" />
          </div>
          <div className="p-4">
            <p className="text-title-sm">카페 온담</p>
            <p className="mt-1 text-caption-sm text-ink-muted">
              조용하고 차분한 곳
            </p>
            <p className="mt-3 text-label-sm text-primary-strong">저장했어요</p>
          </div>
        </div>
      )}
    </div>
  );
}
export default function SignupPage() {
  const toast = useToast();
  const [index, setIndex] = useState(0);
  const [skip, setSkip] = useState(false);
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-110 flex-col bg-surface px-5 pb-6 text-ink sm:px-8">
      <SocialError />
      <header className="flex min-h-14 justify-end">
        <TextButton onClick={() => setSkip(true)}>건너뛰기</TextButton>
      </header>
      <h1 className="mt-3 text-center text-title-md">
        가입하고 모든 기능을 이용해 보세요
      </h1>
      <Carousel
        label="회원가입 기능 소개"
        index={index}
        onIndexChange={setIndex}
        slideClassName="basis-full"
      >
        {slides.map((slide, i) => (
          <div key={i}>
            <Illustration index={i} />
            <h2 className="text-center text-title-lg">{slide.title}</h2>
            <p className="mt-3 px-4 text-center text-body-sm text-ink-muted">
              {slide.description}
            </p>
          </div>
        ))}
      </Carousel>
      <CarouselDots
        count={3}
        index={index}
        tone="surface"
        className="my-6 justify-center"
      />
      <div className="mt-auto flex flex-col gap-3 pt-5">
        <SocialButtons from="signup" />
        <TextButton render={<Link href="/signup/email" />}>
          이메일로 가입하기
        </TextButton>
      </div>
      <AlertDialog
        open={skip}
        onOpenChange={setSkip}
        title="가입하지 않고 시작할까요?"
        description={
          <>
            <span>
              가입하면 내 취향이 쌓여 더 정확한 장소 추천을 받아볼 수 있어요.
            </span>
            <span className="mt-3 block text-caption-sm">
              시작하면{" "}
              <TextButton
                type="button"
                onClick={() => toast("이용약관은 준비 중이에요.")}
              >
                이용약관
              </TextButton>
              과{" "}
              <TextButton
                type="button"
                onClick={() => toast("개인정보처리방침은 준비 중이에요.")}
              >
                개인정보처리방침
              </TextButton>
              에 동의한 것으로 간주해요.
            </span>
          </>
        }
        action={
          <div className="flex w-full gap-2">
            <Button
              variant="outline"
              size="md"
              onClick={startAsGuest}
              render={<Link href="/" />}
            >
              가입 없이 시작
            </Button>
            <Button size="md" onClick={() => setSkip(false)}>
              가입하기
            </Button>
          </div>
        }
      />
    </main>
  );
}
