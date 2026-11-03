"use client";

import { startAsGuest } from "@/domains/onboarding/model/storage";
import { TermsModal } from "@/domains/auth/ui/terms-modal";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { TextButton } from "@/shared/ui/button/text-button";
import { Carousel } from "@/shared/ui/display/carousel";
import { SignupIntroMotion } from "@/domains/auth/ui/signup-intro-motion";
import { AlertDialog } from "@/shared/ui/overlay/alert-dialog";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBarAction } from "@/shared/ui/layout/top-bar";
import { SocialButtons } from "@/domains/auth/ui/social-buttons";
import { SocialError } from "@/domains/auth/ui/social-error";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { UserIcon } from "@/shared/ui/icon/icons/user";

const slides = [
  {
    title: (
      <>
        변화하는 내 취향으로{" "}
        <em className="block text-primary-strong not-italic">검색</em>
      </>
    ),
    description: (
      <>
        핏다이닝은 변하는 내 취향을 반영해
        <br />
        나에게 “딱” 맞는 곳을 추천해 줘요
      </>
    ),
  },
  {
    title: (
      <>
        다른 기기에서도{" "}
        <em className="block text-primary-strong not-italic">내 취향 그대로</em>
      </>
    ),
    description: (
      <>
        로그인만 하면 다른 기기에서도
        <br />내 취향이 그대로 반영돼요
      </>
    ),
  },
  {
    title: (
      <>
        마음에 쏙 드는 곳은{" "}
        <em className="block text-primary-strong not-italic">저장</em>
      </>
    ),
    description: (
      <>
        내 취향에 맞는 장소였나요?
        <br />
        다음에 방문하기 쉽게 저장해 보세요
      </>
    ),
  },
];
export default function SignupPage() {
  const [index, setIndex] = useState(0);
  const [skip, setSkip] = useState(false);
  return (
    <Screen bottom="md" className="relative">
      <SocialError />
      <header className="absolute inset-x-0 top-safe-0 z-10 flex min-h-14 items-center justify-between px-2">
        <IconButton
          label="처음 화면으로"
          role="link"
          nativeButton={false}
          render={<Link href="/" />}
        >
          <ChevronLeftIcon />
        </IconButton>
        <TopBarAction onClick={() => setSkip(true)}>건너뛰기</TopBarAction>
      </header>
      <h1 className="sr-only">가입하고 모든 기능을 이용해 보세요</h1>
      <Carousel
        label="회원가입 기능 소개"
        options={{ duration: 24 }}
        index={index}
        onIndexChange={setIndex}
        slideClassName="basis-full"
        className="shrink-0"
      >
        {slides.map((slide, i) => (
          <div key={i}>
            <SignupIntroMotion slide={i} playing={index === i} />
            <h2
              style={{ letterSpacing: "-0.02em" }}
              className="mt-6 px-6 text-center text-headline-md leading-8 font-bold"
            >
              {slide.title}
            </h2>
            <p className="mx-auto mt-2 max-w-70 text-center text-body-sm leading-5.5 break-keep text-ink-muted">
              {slide.description}
            </p>
          </div>
        ))}
      </Carousel>
      <div aria-hidden="true" className="mt-5 mb-6 flex justify-center gap-1.5">
        {slides.map((_, dot) => (
          <span
            key={dot}
            className={
              dot === index
                ? "h-2 w-5 rounded-full bg-primary-strong"
                : "size-2 rounded-full bg-line-strong"
            }
          />
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-3 px-5 pt-5 sm:px-8">
        <SocialButtons from="signup" />
        <TextButton
          variant="muted"
          role="link"
          nativeButton={false}
          render={<Link href="/signup/email" />}
        >
          이메일로 가입하기
        </TextButton>
      </div>
      <AlertDialog
        open={skip}
        onOpenChange={setSkip}
        title="가입하지 않고 시작할까요?"
        icon={<UserIcon />}
        description={
          <>
            <span>
              가입하면 내 취향이 쌓여 더 정확한 장소 추천을 받아볼 수 있어요.
            </span>
          </>
        }
        action={
          <div className="flex w-full flex-col gap-4">
            <div className="flex w-full gap-2">
              <Button
                variant="outline"
                size="md"
                className="min-w-0 grow-131 basis-0"
                onClick={startAsGuest}
                role="link"
                nativeButton={false}
                render={<Link href="/location" />}
              >
                가입 없이 시작
              </Button>
              <Button
                size="md"
                className="min-w-0 grow-121 basis-0"
                onClick={() => setSkip(false)}
              >
                가입하기
              </Button>
            </div>
            <p className="text-caption-sm leading-4.5 text-ink-muted">
              시작하면{" "}
              <TermsModal kind="terms" variant="caption">
                이용약관
              </TermsModal>
              과{" "}
              <TermsModal kind="privacy" variant="caption">
                개인정보처리방침
              </TermsModal>
              에<br /> 동의한 것으로 간주해요.
            </p>
          </div>
        }
      />
    </Screen>
  );
}
