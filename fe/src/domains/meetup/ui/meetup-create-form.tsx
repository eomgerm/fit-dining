"use client";

import { useState, type ReactNode } from "react";

import { isApiError } from "@/shared/api/api-error";
import { Button } from "@/shared/ui/button/button";
import { Chip } from "@/shared/ui/button/chip";
import { IconButton } from "@/shared/ui/button/icon-button";
import { PickerField } from "@/shared/ui/form/picker-field";
import { Stepper } from "@/shared/ui/form/stepper";
import { CalendarIcon } from "@/shared/ui/icon/icons/calendar";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { ClockIcon } from "@/shared/ui/icon/icons/clock";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";
import { useToast } from "@/shared/ui/overlay/toast";

import { useCreateMeetup, type WithSession } from "../api/queries";
import {
  canSubmit,
  EMPTY_FORM,
  isPastTime,
  nextHeadcount,
  previousHeadcount,
  toRequest,
  type CreateForm,
} from "../model/create-form";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  DESCRIPTION_MAX,
  HEADCOUNT_MAX,
} from "../model/meetup";
import { formatDate, formatTime, selectableRange } from "../model/meetup-date";
import { AreaField } from "./area-field";

function Optional() {
  return <span className="font-normal text-ink-subtle">선택</span>;
}

function FieldLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="text-label-md">
      {children}
    </span>
  );
}

// 모임 만들기(모임장 3, AC-25). 지역만 필수다. 만들면 onCreated로 코드를 넘긴다
export function MeetupCreateForm({
  withSession,
  onBack,
  onCreated,
  onUnauthorized,
  now = () => new Date(),
}: {
  withSession: WithSession;
  onBack: () => void;
  onCreated: (code: string) => void;
  onUnauthorized: () => void;
  now?: () => Date;
}) {
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const create = useCreateMeetup(withSession);
  const toast = useToast();
  const update = (patch: Partial<CreateForm>) =>
    setForm((current) => ({ ...current, ...patch }));
  const today = now();
  const range = selectableRange(today);
  const pastTime = isPastTime(form, today);
  const submittable = canSubmit(form, today) && !create.isPending;

  const submit = () => {
    if (!submittable) return;
    create.mutate(toRequest(form), {
      onSuccess: ({ code }) => onCreated(code),
      onError: (error) => {
        if (isApiError(error) && error.status === 401) onUnauthorized();
        else if (isApiError(error) && error.status === 400)
          toast("넣은 내용을 다시 확인해 주세요");
        else toast("모임을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요");
      },
    });
  };

  return (
    <Screen>
      <TopBar
        start={
          <IconButton label="뒤로" onClick={onBack}>
            <ChevronLeftIcon className="text-icon" />
          </IconButton>
        }
        title="모임 장소 정하기"
      />
      <div className="flex flex-col gap-6 px-5 pt-5 pb-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-headline-md">
            친구들과 갈 곳을
            <br />
            같이 정해요
          </h2>
          <p className="text-body-sm text-ink-muted">
            친구들이 취향을 남기면 모두에게 잘 맞는 곳을 찾아 드려요.
          </p>
        </div>

        <AreaField
          value={form.area}
          onChange={(area) => update({ area })}
          withSession={withSession}
          onUnauthorized={onUnauthorized}
        />

        <div className="flex flex-col gap-1">
          <FieldLabel id="meetup-category">어떤 곳을 찾나요</FieldLabel>
          <div
            role="group"
            aria-labelledby="meetup-category"
            className="flex flex-wrap gap-x-2"
          >
            {CATEGORIES.map((category) => (
              <Chip
                key={category}
                pressed={form.category === category}
                onPressedChange={(pressed) => pressed && update({ category })}
              >
                {CATEGORY_LABELS[category]}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <FieldLabel>
            언제 모이나요 <Optional />
          </FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            <PickerField
              type="date"
              label="모임 날짜"
              value={form.date ?? ""}
              display={form.date && formatDate(form.date)}
              placeholder="날짜"
              icon={<CalendarIcon size="md" />}
              min={range.min}
              max={range.max}
              clearLabel="날짜 지우기"
              onChange={(date) =>
                update(date ? { date } : { date: undefined, time: undefined })
              }
            />
            <PickerField
              type="time"
              label="모임 시각"
              value={form.time ?? ""}
              display={form.time && formatTime(form.time)}
              placeholder="시간"
              icon={<ClockIcon size="md" />}
              disabled={!form.date}
              clearLabel="시간 지우기"
              onChange={(time) => update({ time: time || undefined })}
            />
          </div>
          {pastTime && (
            <p className="flex items-start gap-1.5 text-caption-md text-danger">
              <WarningIcon size="sm" className="mt-px shrink-0" />
              지난 시각이에요. 다른 시각을 골라 주세요.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <FieldLabel>
            몇 명이 모이나요 <Optional />
          </FieldLabel>
          <Stepper
            label="인원"
            value={form.headcount}
            format={(value) => (value === null ? "정하지 않음" : `${value}명`)}
            onPrevious={() =>
              update({ headcount: previousHeadcount(form.headcount) })
            }
            onNext={() => update({ headcount: nextHeadcount(form.headcount) })}
            canPrevious={form.headcount !== null}
            canNext={form.headcount !== HEADCOUNT_MAX}
            previousLabel="한 명 줄이기"
            nextLabel="한 명 늘리기"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="meetup-description" className="text-label-md">
            어떤 모임인가요 <Optional />
          </label>
          <textarea
            id="meetup-description"
            rows={2}
            maxLength={DESCRIPTION_MAX}
            placeholder="예: 편하게 얘기하면서 저녁 먹을 곳"
            aria-describedby="meetup-description-help"
            value={form.description}
            onChange={(event) => update({ description: event.target.value })}
            className="resize-none rounded-md border border-line-strong bg-surface px-3.5 py-3 text-body-md text-ink outline-none placeholder:text-ink-subtle focus:border-1.5 focus:border-primary-strong"
          />
          <p
            id="meetup-description-help"
            className="flex justify-between gap-2 text-caption-sm text-ink-subtle"
          >
            <span>메뉴, 분위기, 목적을 적어 주세요</span>
            <span>
              {form.description.length}/{DESCRIPTION_MAX}
            </span>
          </p>
        </div>
      </div>
      <BottomBar>
        <Button disabled={!submittable} onClick={submit}>
          {create.isPending && (
            <span
              className="mr-2 size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {create.isPending ? "모임을 만드는 중" : "다음: 내 취향 남기기"}
        </Button>
      </BottomBar>
    </Screen>
  );
}
