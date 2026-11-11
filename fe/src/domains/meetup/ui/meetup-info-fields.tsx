"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import { Chip } from "@/shared/ui/button/chip";
import { TextButton } from "@/shared/ui/button/text-button";
import { PickerField } from "@/shared/ui/form/picker-field";
import { Stepper } from "@/shared/ui/form/stepper";
import { CalendarIcon } from "@/shared/ui/icon/icons/calendar";
import { ClockIcon } from "@/shared/ui/icon/icons/clock";
import { PinIcon } from "@/shared/ui/icon/icons/pin";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";

import type { WithSession } from "../api/queries";
import {
  nextHeadcount,
  previousHeadcount,
  type CreateForm,
} from "../model/create-form";
import {
  areaLabel,
  CATEGORIES,
  CATEGORY_LABELS,
  DESCRIPTION_MAX,
  HEADCOUNT_MAX,
} from "../model/meetup";
import { formatDate, formatTime, selectableRange } from "../model/meetup-date";
import { AreaField } from "./area-field";

const subscribeNothing = () => () => {};

// 지금 시각은 브라우저에서만 읽는다. 미리 렌더링에서는 null이다. 분 단위 값을 돌려줘 다시 그릴 때마다 같은 값이다
export function useClientNow(now: () => Date) {
  const minute = useSyncExternalStore(
    subscribeNothing,
    () => Math.floor(now().getTime() / 60_000),
    () => null,
  );
  return minute === null ? null : new Date(minute * 60_000);
}

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

// 모임 만들기와 모임 정보 수정의 입력 칸. dateOnly면 날짜·시간만 고치고 지역·업종은 읽기만, 인원·설명은 감춘다(AC-30)
export function MeetupInfoFields({
  form,
  onChange,
  today,
  pastTime,
  withSession,
  onUnauthorized,
  dateOnly = false,
  dateNote,
}: {
  form: CreateForm;
  onChange: (patch: Partial<CreateForm>) => void;
  today: Date | null;
  pastTime: boolean;
  withSession: WithSession;
  onUnauthorized: () => void;
  dateOnly?: boolean;
  // 날짜 아래 안내(고른 날짜로 열 수 있는 마지막 날)
  dateNote?: ReactNode;
}) {
  const range = today ? selectableRange(today) : undefined;
  return (
    <>
      {dateOnly ? (
        <div className="flex flex-col gap-1">
          <FieldLabel>지역</FieldLabel>
          <p className="flex h-12 items-center gap-2 rounded-md border border-line bg-surface-sunken px-3.5 text-body-md text-ink-muted">
            <PinIcon size="md" className="shrink-0" />
            {form.area ? areaLabel(form.area) : ""}
          </p>
        </div>
      ) : (
        <AreaField
          value={form.area}
          onChange={(area) => onChange({ area })}
          withSession={withSession}
          onUnauthorized={onUnauthorized}
        />
      )}

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
              disabled={dateOnly}
              onPressedChange={(pressed) => pressed && onChange({ category })}
            >
              {CATEGORY_LABELS[category]}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {/* 날짜 칸이 반 폭이라 칸 안에 지우기를 두면 "11월 14일 (토)"가 잘린다 */}
        <div className="-my-3 flex min-h-11 items-center justify-between">
          <FieldLabel>언제 모이나요 {!dateOnly && <Optional />}</FieldLabel>
          {form.date && !dateOnly && (
            <TextButton
              variant="muted"
              aria-label="날짜와 시간 지우기"
              onClick={() => onChange({ date: undefined, time: undefined })}
            >
              지우기
            </TextButton>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PickerField
            type="date"
            label="모임 날짜"
            value={form.date ?? ""}
            display={form.date && formatDate(form.date)}
            placeholder="날짜"
            icon={<CalendarIcon size="md" />}
            min={range?.min}
            max={range?.max}
            onChange={(date) =>
              onChange(date ? { date } : { date: undefined, time: undefined })
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
            onChange={(time) => onChange({ time: time || undefined })}
          />
        </div>
        {pastTime && (
          <p className="flex items-start gap-1.5 text-caption-md text-danger">
            <WarningIcon size="sm" className="mt-px shrink-0" />
            지난 시각이에요. 다른 시각을 골라 주세요.
          </p>
        )}
        {dateNote && (
          <p className="text-caption-md text-ink-muted">{dateNote}</p>
        )}
      </div>

      {!dateOnly && (
        <>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>
              몇 명이 모이나요 <Optional />
            </FieldLabel>
            <Stepper
              label="인원"
              value={form.headcount}
              format={(value) =>
                value === null ? "정하지 않음" : `${value}명`
              }
              onPrevious={() =>
                onChange({ headcount: previousHeadcount(form.headcount) })
              }
              onNext={() =>
                onChange({ headcount: nextHeadcount(form.headcount) })
              }
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
              onChange={(event) =>
                onChange({ description: event.target.value })
              }
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
        </>
      )}
    </>
  );
}
