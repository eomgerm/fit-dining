"use client";

import { useId, useState, type ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button/button";
import { Chip } from "@/shared/ui/button/chip";
import { IconButton } from "@/shared/ui/button/icon-button";
import { Icon } from "@/shared/ui/icon/icon";
import { CheckIcon } from "@/shared/ui/icon/icons/check";
import { ChevronDownIcon } from "@/shared/ui/icon/icons/chevron-down";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { InfoIcon } from "@/shared/ui/icon/icons/info";
import { MoonIcon } from "@/shared/ui/icon/icons/moon";
import { SunIcon } from "@/shared/ui/icon/icons/sun";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";

import {
  canSubmit,
  PRICE_PRESETS,
  type JoinForm,
  type PriceChoice,
} from "../model/join-form";
import {
  FOOD_LABELS,
  FOOD_TYPES,
  NAME_MAX,
  WANT_MENU_MAX,
  type FoodType,
  type MeetupQuestions,
  type Mood,
} from "../model/meetup";
import { MOOD_LABELS } from "../model/taste";

// guest: 처음 참여(참여자 4), host: 모임장의 취향 남기기, edit: 내 취향 수정
export type JoinMode = "guest" | "host" | "edit";

const MOODS: { mood: Mood; icon: ReactNode }[] = [
  { mood: "QUIET", icon: <MoonIcon size="md" /> },
  {
    mood: "ANY",
    icon: (
      <Icon size="md">
        <path d="M5 12H19" />
      </Icon>
    ),
  },
  { mood: "LIVELY", icon: <SunIcon size="md" /> },
];

const PRICE_LABELS: Record<(typeof PRICE_PRESETS)[number], string> = {
  10000: "1만 원",
  20000: "2만 원",
  30000: "3만 원",
};

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md bg-surface-sunken px-3.5 py-3 text-caption-md text-ink-muted">
      <InfoIcon size="sm" className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function SectionTitle({
  children,
  description,
}: {
  children: ReactNode;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="text-title-md">{children}</h3>
      {description && (
        <p className="text-caption-md text-ink-muted">{description}</p>
      )}
    </div>
  );
}

function toggle(list: FoodType[], food: FoodType) {
  return list.includes(food)
    ? list.filter((item) => item !== food)
    : [...list, food];
}

// 모임 질문지(AC-27). 이름 말고는 모두 건너뛸 수 있고, 스냅숏의 questions가 true인 질문만 보인다
export function JoinFormView({
  mode,
  hostNickname,
  questions,
  initial,
  signedIn,
  pending,
  takenName,
  onSubmit,
  onBack,
  onSignIn,
  onPickName,
}: {
  mode: JoinMode;
  hostNickname?: string;
  questions: MeetupQuestions;
  initial: JoinForm;
  signedIn: boolean;
  pending: boolean;
  // 서버가 이미 있는 이름이라고 한 이름(409 name-taken). 그 이름 그대로면 칸 아래에 안내한다
  takenName?: string;
  onSubmit: (form: JoinForm) => void;
  onBack: () => void;
  // 비회원이 질문지에서 로그인하러 갈 때 쓰던 답을 넘긴다(AC-28)
  onSignIn?: (form: JoinForm) => void;
  onPickName?: () => void;
}) {
  const id = useId();
  const [form, setForm] = useState(initial);
  const update = (patch: Partial<JoinForm>) =>
    setForm((current) => ({ ...current, ...patch }));
  const withName = mode !== "edit";
  const nameTaken = !!takenName && form.name.trim() === takenName;
  const submittable = canSubmit(form, questions, withName) && !nameTaken;
  const foodQuestions = questions.food || questions.spicy;

  return (
    <Screen>
      <TopBar
        tone="surface"
        start={
          <IconButton
            label={mode === "guest" ? "프로필 목록으로" : "뒤로"}
            onClick={onBack}
          >
            <ChevronLeftIcon className="text-icon" />
          </IconButton>
        }
        title={
          mode === "guest"
            ? "처음 참여하기"
            : mode === "host"
              ? "내 취향 남기기"
              : "내 취향 수정"
        }
      />
      <div className="flex flex-col gap-7 px-5 pt-4 pb-4">
        {mode !== "edit" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <h2 className="text-headline-md">
                {mode === "host" ? (
                  "내 취향부터 남겨요"
                ) : (
                  <>
                    {hostNickname ? `${hostNickname}님이` : "친구가"} 모임
                    장소를
                    <br />
                    같이 정하자고 해요
                  </>
                )}
              </h2>
              <p className="text-body-sm text-ink-muted">
                {mode === "host"
                  ? "친구들도 같은 질문에 답해요. 남긴 취향은 서로 볼 수 있어요."
                  : "이름 말고는 모두 건너뛸 수 있어요. 가입하지 않아도 돼요."}
              </p>
            </div>
            {mode === "guest" && !signedIn && onSignIn && (
              <div className="flex items-center gap-3 rounded-md py-2.5 pr-2.5 pl-3.5 ring-1 ring-line ring-inset">
                <p className="flex-1 text-caption-md text-ink-muted">
                  회원이면 로그인해서 평소 취향도 함께 반영할 수 있어요
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSignIn(form)}
                >
                  로그인
                </Button>
              </div>
            )}
          </div>
        )}

        {withName && (
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-name`} className="text-label-md">
              이름 <span className="text-primary">필수</span>
            </label>
            <input
              id={`${id}-name`}
              type="text"
              autoComplete="nickname"
              maxLength={NAME_MAX}
              value={form.name}
              aria-invalid={nameTaken || undefined}
              aria-describedby={`${id}-name-help`}
              onChange={(event) => update({ name: event.target.value })}
              className={cn(
                "h-13 rounded-md border bg-surface px-3.5 text-body-md text-ink outline-none",
                nameTaken
                  ? "border-1.5 border-warning"
                  : "border-line-strong focus:border-1.5 focus:border-primary-strong",
              )}
            />
            {nameTaken ? (
              <div id={`${id}-name-help`} className="flex flex-col items-start">
                <p className="flex items-start gap-1.5 text-caption-md text-warning">
                  <WarningIcon size="sm" className="mt-px shrink-0" />
                  <span>
                    &apos;{takenName}&apos;은 이미 있는 이름이에요. {takenName}
                    님이라면 목록에서 고르고, 아니라면 이름을 바꿔 주세요.
                  </span>
                </p>
                {onPickName && (
                  <button
                    type="button"
                    onClick={onPickName}
                    className="h-11 px-0.5 text-label-md text-ink"
                  >
                    이름 고르기
                  </button>
                )}
              </div>
            ) : (
              <p
                id={`${id}-name-help`}
                className="text-caption-sm text-ink-subtle"
              >
                {mode === "host"
                  ? "회원 닉네임을 그대로 넣었어요. 바꿀 수 있어요."
                  : "친구들이 알아볼 수 있게 적어 주세요."}
              </p>
            )}
          </div>
        )}

        {questions.mood && (
          <section className="flex flex-col gap-3">
            <SectionTitle>어떤 분위기를 좋아하세요?</SectionTitle>
            <div
              role="radiogroup"
              aria-label="분위기"
              className="flex flex-col gap-2"
            >
              {MOODS.map(({ mood, icon }) => {
                const checked = form.mood === mood;
                return (
                  <button
                    key={mood}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => update({ mood })}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-4 py-3.5 text-left transition duration-200 motion-safe:active:scale-98 motion-reduce:duration-120",
                      checked
                        ? "border-primary bg-primary-soft"
                        : "border-line-strong bg-surface",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-full",
                        checked
                          ? "bg-surface text-primary"
                          : "bg-surface-sunken text-ink-muted",
                      )}
                    >
                      {icon}
                    </span>
                    <span
                      className={cn(
                        "flex-1 text-body-md",
                        checked && "font-semibold",
                      )}
                    >
                      {MOOD_LABELS[mood]}
                    </span>
                    {checked && (
                      <span className="flex size-6 items-center justify-center rounded-full bg-primary text-on-primary">
                        <CheckIcon size="sm" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {foodQuestions && (
          <section className="flex flex-col gap-2">
            {questions.food ? (
              <>
                <SectionTitle description="여러 개 고를 수 있어요. 고른 음식을 먼저 보여 드려요.">
                  먹고 싶은 음식이 있나요?
                </SectionTitle>
                <div className="flex flex-wrap gap-x-2">
                  {FOOD_TYPES.map((food) => (
                    <Chip
                      key={food}
                      pressed={!form.anyFood && form.likeFoods.includes(food)}
                      onPressedChange={() =>
                        update({
                          anyFood: false,
                          likeFoods: toggle(form.likeFoods, food),
                        })
                      }
                    >
                      {FOOD_LABELS[food]}
                    </Chip>
                  ))}
                  <Chip
                    pressed={form.anyFood}
                    onPressedChange={(pressed) =>
                      update({ anyFood: pressed, likeFoods: [] })
                    }
                  >
                    상관없어요
                  </Chip>
                </div>
                <div className="mt-1 flex flex-col gap-1.5">
                  <label htmlFor={`${id}-menu`} className="text-label-md">
                    먹고 싶은 메뉴가 있나요?
                  </label>
                  <input
                    id={`${id}-menu`}
                    type="text"
                    maxLength={WANT_MENU_MAX}
                    placeholder="예: 곱창, 마라탕"
                    value={form.wantMenu}
                    aria-describedby={`${id}-menu-help`}
                    onChange={(event) =>
                      update({ wantMenu: event.target.value })
                    }
                    className="h-13 rounded-md border border-line-strong bg-surface px-3.5 text-body-md text-ink outline-none placeholder:text-ink-subtle focus:border-1.5 focus:border-primary-strong"
                  />
                  <p
                    id={`${id}-menu-help`}
                    className="flex justify-between gap-2 text-caption-sm text-ink-subtle"
                  >
                    <span>
                      파는 곳을 먼저 보여 드려요. 없는 곳을 빼지는 않아요.
                    </span>
                    <span>
                      {form.wantMenu.length}/{WANT_MENU_MAX}
                    </span>
                  </p>
                </div>
                <div className="mt-1 rounded-md border border-line">
                  <button
                    type="button"
                    aria-expanded={form.avoidOpen}
                    onClick={() => update({ avoidOpen: !form.avoidOpen })}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                  >
                    <span className="flex flex-1 flex-col">
                      <span className="text-title-sm">
                        빼고 싶은 음식 종류가 있어요
                      </span>
                      <span className="text-caption-md text-ink-muted">
                        고른 종류의 가게는 추천에서 빼요
                      </span>
                    </span>
                    <span
                      className={cn(
                        "flex text-icon-subtle transition-transform duration-200 motion-reduce:transition-none",
                        form.avoidOpen && "rotate-180",
                      )}
                    >
                      <ChevronDownIcon size="md" />
                    </span>
                  </button>
                  {form.avoidOpen && (
                    <div
                      role="group"
                      aria-label="빼고 싶은 음식 종류"
                      className="flex flex-wrap gap-x-2 px-3.5 pb-2"
                    >
                      {FOOD_TYPES.map((food) => (
                        <Chip
                          key={food}
                          pressed={form.avoidFoods.includes(food)}
                          onPressedChange={() =>
                            update({
                              avoidFoods: toggle(form.avoidFoods, food),
                            })
                          }
                        >
                          {FOOD_LABELS[food]}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <SectionTitle>음식</SectionTitle>
            )}
            {questions.spicy && (
              <button
                type="button"
                role="checkbox"
                aria-checked={form.noSpicy}
                onClick={() => update({ noSpicy: !form.noSpicy })}
                className="flex items-center gap-3 rounded-md border border-line px-3.5 py-3 text-left"
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-checkbox border-1.5",
                    form.noSpicy
                      ? "border-primary bg-primary text-on-primary"
                      : "border-ink-subtle bg-surface",
                  )}
                >
                  {form.noSpicy && <CheckIcon size="sm" />}
                </span>
                <span className="flex flex-col">
                  <span className="text-title-sm">매운 걸 잘 못 먹어요</span>
                  <span className="text-caption-md text-ink-muted">
                    매운 메뉴가 많은 곳은 덜 추천해요
                  </span>
                </span>
              </button>
            )}
          </section>
        )}

        {questions.price && (
          <section className="flex flex-col gap-2">
            <SectionTitle description="대표 메뉴 한 개 가격 기준이에요.">
              메뉴 하나에 얼마까지 괜찮아요?
            </SectionTitle>
            <div
              role="group"
              aria-label="메뉴 가격"
              className="flex flex-wrap gap-x-2"
            >
              {([...PRICE_PRESETS, "custom", "any"] as PriceChoice[]).map(
                (choice) => (
                  <Chip
                    key={choice}
                    pressed={form.price === choice}
                    onPressedChange={(pressed) =>
                      update({ price: pressed ? choice : undefined })
                    }
                  >
                    {choice === "custom"
                      ? "직접 입력"
                      : choice === "any"
                        ? "상관없어요"
                        : PRICE_LABELS[choice]}
                  </Chip>
                ),
              )}
            </div>
            {form.price === "custom" && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-price`} className="text-label-md">
                  금액
                </label>
                <div className="flex h-13 items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 focus-within:border-1.5 focus-within:border-primary-strong">
                  <input
                    id={`${id}-price`}
                    type="text"
                    inputMode="numeric"
                    value={form.customPrice}
                    aria-describedby={`${id}-price-help`}
                    onChange={(event) =>
                      update({
                        customPrice: event.target.value.replace(/\D/g, ""),
                      })
                    }
                    className="min-w-0 flex-1 bg-transparent text-body-md text-ink outline-none"
                  />
                  <span className="text-body-md text-ink-muted">원 이하</span>
                </div>
                <p
                  id={`${id}-price-help`}
                  className="text-caption-sm text-ink-subtle"
                >
                  5천 원부터 10만 원까지 1천 원 단위로 넣어 주세요
                </p>
              </div>
            )}
            <Note>
              가격을 모르는 곳은 그대로 보여요. 고른 금액보다 조금 비싼
              곳(10%)까지 보여요.
            </Note>
          </section>
        )}

        <div className="flex flex-col gap-2">
          {foodQuestions && (
            <Note>
              해산물·견과류 같은 재료나 알레르기는 확인할 수 없어요. 꼭 피해야
              하면 친구들에게 따로 알려 주세요.
            </Note>
          )}
          <Note>
            남긴 취향은 모임 링크를 가진 사람에게 보여요. 이 모임에만 쓰고, 모임
            날로부터 7일 뒤 지워요.
          </Note>
        </div>
      </div>
      <BottomBar>
        <Button
          disabled={!submittable || pending}
          onClick={() => onSubmit(form)}
        >
          {pending && (
            <span
              className="mr-2 size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {mode === "edit" ? "저장" : "취향 남기기"}
        </Button>
      </BottomBar>
    </Screen>
  );
}
