"use client";

import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/button/button";
import { Chip } from "@/shared/ui/button/chip";
import { IconButton } from "@/shared/ui/button/icon-button";
import { TextButton } from "@/shared/ui/button/text-button";
import { StepProgress } from "@/shared/ui/display/step-progress";
import { Textarea } from "@/shared/ui/form/textarea";
import { TopBar, TopBarAction } from "@/shared/ui/layout/top-bar";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { CheckIcon } from "@/shared/ui/icon/icons/check";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { ClearIcon } from "@/shared/ui/icon/icons/clear";
import { CloseIcon } from "@/shared/ui/icon/icons/close";
import { MoonIcon } from "@/shared/ui/icon/icons/moon";
import { SunIcon } from "@/shared/ui/icon/icons/sun";
import { SparklesIcon } from "@/shared/ui/icon/icons/sparkles";
import { InfoIcon } from "@/shared/ui/icon/icons/info";
import { EditIcon } from "@/shared/ui/icon/icons/edit";
import { AlertDialog } from "@/shared/ui/overlay/alert-dialog";
import { cn } from "@/shared/lib/cn";
import { analyzeTaste } from "../api/analyze-taste";
import {
  canContinue,
  collectAnswers,
  moods,
  priorities,
  purposes,
  toggleSelection,
  type OnboardingAnswers,
} from "../model/answers";

const titles = [
  "",
  "어떤 분위기를\n좋아하세요?",
  "장소를 고를 때\n중요하게 보는 게 있나요?",
  "주로 어떤 때\n장소를 찾나요?",
  "더 알려 주고 싶은\n취향이 있나요?",
];

function IntroBackground() {
  const [allowMotion, setAllowMotion] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!window.matchMedia) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    function update() {
      setAllowMotion(!preference.matches);
      setPlaying(false);
    }
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  return (
    <>
      <Image
        src="/onboarding/intro-poster.jpg"
        alt=""
        fill
        sizes="(max-width: 440px) 100vw, 440px"
        className="object-cover"
        loading="eager"
      />
      {allowMotion && !failed && (
        <video
          src="/onboarding/intro.mp4"
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
          onPlaying={() => setPlaying(true)}
          onError={() => setFailed(true)}
          className={cn(
            "absolute inset-0 size-full object-cover",
            !playing && "opacity-0",
          )}
        />
      )}
    </>
  );
}

export function OnboardingScreen({
  onComplete,
  interceptIntro,
  initialStep = 0,
}: {
  onComplete: (answers: OnboardingAnswers) => void;
  // 처음 화면의 [시작하기]·[기존 계정으로 로그인]을 가로챈다(홈 화면 추가 안내 1-01a).
  // 가로챘으면 true를 돌려주고, 안내가 끝나면 proceed로 그 버튼이 하던 일을 이어 간다
  interceptIntro?: (from: "start" | "login", proceed: () => void) => boolean;
  // 1이면 최초화면을 건너뛰고 첫 질문부터 보여 준다(홈 화면 추가 가이드에서 돌아왔을 때)
  initialStep?: number;
}) {
  const [step, setStep] = useState(initialStep);
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    mood: null,
    priorities: [],
    purposes: [],
    tastes: [],
  });
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "analyzing" | "error">("idle");
  const [dialog, setDialog] = useState(false);
  const loginLink = useRef<HTMLAnchorElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const chipButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const pendingChipFocus = useRef<number | null>(null);
  const previousStep = useRef(step);
  const previousStatus = useRef(status);
  useEffect(() => {
    if (step === 0 && previousStep.current === 1) startButton.current?.focus();
    else if (step !== 0) heading.current?.focus();
    previousStep.current = step;
  }, [step]);
  useLayoutEffect(() => {
    // 분석 덮개가 사라진 직후, 다음 입력 전에 포커스를 복구한다.
    if (previousStatus.current === "analyzing" && status !== "analyzing")
      heading.current?.focus();
    previousStatus.current = status;
  }, [status]);
  useLayoutEffect(() => {
    if (pendingChipFocus.current === null) return;
    const index = pendingChipFocus.current;
    pendingChipFocus.current = null;
    if (answers.tastes.length === 0) input.current?.focus();
    else
      chipButtons.current[Math.min(index, answers.tastes.length - 1)]?.focus();
  }, [answers.tastes]);
  useEffect(() => () => request.current?.abort(), []);
  function complete() {
    request.current?.abort();
    onComplete(
      collectAnswers({
        mood: answers.mood,
        priorities: step >= 2 ? answers.priorities : [],
        purposes: step >= 3 ? answers.purposes : [],
        tastes: step >= 4 ? answers.tastes : [],
      }),
    );
  }
  function edit(next: string) {
    setText(next);
    setAnswers((previous) => ({ ...previous, tastes: [] }));
    setStatus("idle");
  }
  async function analyze() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setDialog(false);
    setStatus("analyzing");
    const minimum = new Promise<void>((resolve) => setTimeout(resolve, 600));
    try {
      const [tastes] = await Promise.all([
        analyzeTaste(text, { signal: controller.signal }),
        minimum,
      ]);
      if (!controller.signal.aborted) {
        setAnswers((previous) => ({ ...previous, tastes }));
        setStatus("idle");
      }
    } catch {
      await minimum;
      if (!controller.signal.aborted) setStatus("error");
    }
  }
  if (step === 0)
    return (
      <main className="relative mx-auto flex min-h-svh w-full max-w-110 flex-col bg-secondary">
        <IntroBackground />
        <div className="absolute inset-0 bg-linear-to-b from-photo-shade/50 via-transparent to-photo-shade" />
        <h1 className="relative m-5">
          <Image
            src="/brand/fitdining-white.svg"
            alt="핏다이닝"
            width={123}
            height={36}
            loading="eager"
          />
        </h1>
        <div className="relative mt-auto flex flex-col gap-3 p-6">
          <Button
            ref={startButton}
            className="w-full"
            onClick={() => {
              const start = () => setStep(1);
              if (!interceptIntro?.("start", start)) start();
            }}
          >
            시작하기
          </Button>
          <TextButton
            render={<a ref={loginLink} href="/login" />}
            nativeButton={false}
            variant="inverse"
            onClick={(event) => {
              // 이어 갈 때는 같은 링크를 다시 눌러 원래대로 이동한다. 가로채는 쪽은 두 번째에는 가로채지 않는다
              const login = () => loginLink.current?.click();
              if (interceptIntro?.("login", login)) event.preventDefault();
            }}
            // eslint-disable-next-line shadcn/no-restyle -- Main 시안의 로그인 링크만 15px/600으로 표시한다.
            className="text-body-md font-semibold"
          >
            기존 계정으로 로그인
          </TextButton>
        </div>
      </main>
    );
  const busy = status === "analyzing";
  return (
    <main className="mx-auto min-h-svh w-full max-w-110 bg-surface">
      <div
        inert={busy}
        aria-hidden={busy || undefined}
        className="flex min-h-svh flex-col"
      >
        <TopBar
          start={
            <IconButton
              label={step === 1 ? "처음 화면으로" : "이전"}
              onClick={() => {
                request.current?.abort();
                setStep(step - 1);
              }}
            >
              <ChevronLeftIcon />
            </IconButton>
          }
          end={
            step < 4 ? (
              <TopBarAction onClick={complete}>건너뛰기</TopBarAction>
            ) : (
              <span className="w-18" />
            )
          }
        >
          <StepProgress
            step={step}
            total={4}
            label="온보딩 진행"
            className="flex-1"
          />
        </TopBar>
        <section className="flex-1 px-5 pt-9 pb-6">
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-headline-md whitespace-pre-line outline-none"
          >
            {titles[step]}
          </h1>
          {step === 1 && (
            <div
              role="radiogroup"
              aria-label="분위기"
              className="mt-8 flex flex-col gap-3"
            >
              {moods.map((mood, index) => (
                <button
                  key={mood.id}
                  type="button"
                  role="radio"
                  aria-checked={answers.mood === mood.id}
                  tabIndex={
                    answers.mood === mood.id || (!answers.mood && index === 0)
                      ? 0
                      : -1
                  }
                  onClick={() => setAnswers({ ...answers, mood: mood.id })}
                  onKeyDown={(event) => {
                    if (
                      ![
                        "ArrowDown",
                        "ArrowUp",
                        "ArrowLeft",
                        "ArrowRight",
                        "Home",
                        "End",
                      ].includes(event.key)
                    )
                      return;
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? 1
                          : (index + 1) % 2;
                    setAnswers({ ...answers, mood: moods[next].id });
                    (
                      event.currentTarget.parentElement?.children[
                        next
                      ] as HTMLElement
                    )?.focus();
                  }}
                  className={cn(
                    "relative flex items-center gap-4 rounded-lg border border-line-strong p-5 text-left transition-colors duration-200 motion-safe:active:scale-98",
                    answers.mood === mood.id &&
                      "border-primary bg-primary-soft",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-13 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-muted",
                      answers.mood === mood.id && "bg-surface text-primary",
                    )}
                  >
                    {index === 0 ? <MoonIcon /> : <SunIcon />}
                  </span>
                  <span className="text-title-md">{mood.label}</span>
                  {answers.mood === mood.id && (
                    <span className="absolute top-3 right-3 flex size-6 items-center justify-center rounded-full bg-primary text-on-primary">
                      <CheckIcon size="sm" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {(step === 2 || step === 3) && (
            <div className="mt-7 flex flex-wrap gap-2">
              {step === 2
                ? priorities.map((option) => (
                    <Chip
                      size="lg"
                      key={option.id}
                      pressed={answers.priorities.includes(option.id)}
                      onPressedChange={() =>
                        setAnswers({
                          ...answers,
                          priorities: toggleSelection(
                            answers.priorities,
                            option.id,
                          ),
                        })
                      }
                    >
                      {option.label}
                    </Chip>
                  ))
                : purposes.map((option) => (
                    <Chip
                      size="lg"
                      key={option.id}
                      pressed={answers.purposes.includes(option.id)}
                      onPressedChange={() =>
                        setAnswers({
                          ...answers,
                          purposes: toggleSelection(
                            answers.purposes,
                            option.id,
                          ),
                        })
                      }
                    >
                      {option.label}
                    </Chip>
                  ))}
            </div>
          )}
          {step === 4 && (
            <div className="mt-6">
              <Textarea
                // eslint-disable-next-line shadcn/no-arbitrary-values, shadcn/no-restyle -- 공통 Textarea 변경 없이 Onb4 시안 높이를 적용한다.
                className="[&>div]:h-[133px]"
                label="취향 직접 적기"
                value={text}
                inputRef={input}
                emphasis={text.length > 0}
                onValueChange={edit}
                maxLength={100}
                placeholder="맛이나 분위기를 자유롭게 적어 주세요"
                aria-invalid={status === "error" || undefined}
                aria-describedby={
                  status === "error" ? "taste-error" : undefined
                }
                trailingAction={
                  text && (
                    <IconButton
                      label="입력한 내용 모두 지우기"
                      onClick={() => {
                        edit("");
                        input.current?.focus();
                      }}
                    >
                      <ClearIcon size="md" className="text-ink-disabled" />
                    </IconButton>
                  )
                }
                footerAction={
                  <button
                    type="button"
                    disabled={!text.trim() || answers.tastes.length > 0}
                    onClick={analyze}
                    className="-mt-1.5 -mr-2 -mb-2 inline-flex h-11 items-center gap-1.5 rounded-full bg-primary-soft px-4 text-body-md font-semibold text-primary-strong disabled:bg-surface-sunken disabled:text-ink-disabled"
                  >
                    <SparklesIcon size="md" />
                    AI 분석
                  </button>
                }
              />
              {status === "error" && (
                <p
                  id="taste-error"
                  role="alert"
                  className="mt-2 flex items-center gap-1 text-caption-md text-danger"
                >
                  <InfoIcon size="sm" />
                  잠시 후 다시 시도해 주세요
                </p>
              )}
              {answers.tastes.length > 0 && (
                <section
                  className="onboarding-result mt-6 rounded-lg bg-surface-warm p-4"
                  aria-label="취향 분석 결과"
                >
                  <h2 className="onboarding-result-title flex items-center gap-1.5 text-label-md text-primary-strong">
                    <SparklesIcon size="md" />
                    이렇게 이해했어요
                  </h2>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {answers.tastes.map((taste, index) => (
                      <span
                        key={`${taste.polarity}-${taste.label}`}
                        style={{
                          animationDelay: `${240 + Math.min(index, 4) * 60}ms`,
                        }}
                        className={cn(
                          "onboarding-result-chip inline-flex min-h-11 max-w-full items-center rounded-sm border border-line-strong bg-surface pl-3 text-body-sm",
                          taste.polarity === "LIKE" &&
                            "border-primary bg-primary-soft leading-5 font-semibold text-primary-strong",
                        )}
                      >
                        <span className="min-w-0 wrap-anywhere">
                          {taste.polarity === "LIKE" ? "좋아요" : "별로예요"} ·{" "}
                          {taste.label}
                        </span>
                        <IconButton
                          ref={(element) => {
                            chipButtons.current[index] = element;
                          }}
                          label={`${taste.label} 지우기`}
                          onClick={() => {
                            pendingChipFocus.current = index;
                            setAnswers({
                              ...answers,
                              tastes: answers.tastes.filter(
                                (_, i) => i !== index,
                              ),
                            });
                          }}
                        >
                          <CloseIcon size="sm" />
                        </IconButton>
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </section>
        <BottomBar>
          <Button
            className="w-full"
            disabled={!canContinue(step, answers)}
            onClick={() => {
              if (step < 4) setStep(step + 1);
              else if (text.trim() && answers.tastes.length === 0)
                setDialog(true);
              else complete();
            }}
          >
            {step < 4 ? "다음" : "시작하기"}
          </Button>
        </BottomBar>
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {busy ? "AI가 취향을 분석하고 있어요. 잠시만 기다려 주세요" : ""}
      </div>
      {busy && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-1.5 bg-secondary/75 text-center text-on-secondary"
        >
          <span className="onboarding-orb relative mb-5 flex size-18 items-center justify-center rounded-full bg-primary">
            <SparklesIcon size="lg" />
          </span>
          <b className="text-title-md">AI가 취향을 분석하고 있어요</b>
          <span className="text-body-sm leading-5 text-on-secondary/80">
            잠시만 기다려 주세요
          </span>
        </div>
      )}
      <AlertDialog
        open={dialog}
        onOpenChange={setDialog}
        title="작성 중인 내용이 있어요"
        description="AI 분석을 하지 않고 시작하면 적은 내용은 저장되지 않아요."
        icon={<EditIcon className="text-primary-strong" />}
        action={
          <>
            <Button variant="outline" size="md" onClick={complete}>
              그냥 시작하기
            </Button>
            <Button size="md" onClick={analyze}>
              AI 분석하기
            </Button>
          </>
        }
      />
    </main>
  );
}
