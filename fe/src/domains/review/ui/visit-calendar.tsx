"use client";

import { useState } from "react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { ChevronRightIcon } from "@/shared/ui/icon/icons/chevron-right";
import { BottomSheet } from "@/shared/ui/overlay/bottom-sheet";

import {
  WEEKDAYS,
  calendarWeeks,
  dayOfMonth,
  dayState,
  formatDay,
  formatMonth,
  monthOf,
  monthsBetween,
  type YearMonth,
} from "../model/visit-calendar";

type VisitCalendarProps = {
  month: YearMonth;
  range: { min: string; max: string };
  reviewedDates: readonly string[];
  today: string;
  selected: string | null;
  onSelect: (date: string) => void;
};

// 7-03의 한 달 칸. 범위 밖은 비활성, 이미 쓴 날은 취소선으로 막는다(D-4)
export function VisitCalendar({
  month,
  range,
  reviewedDates,
  today,
  selected,
  onSelect,
}: VisitCalendarProps) {
  return (
    <div role="grid" aria-label={formatMonth(month)}>
      <div role="row" className="grid grid-cols-7 text-center">
        {WEEKDAYS.map((weekday) => (
          <span
            key={weekday}
            role="columnheader"
            className="text-caption-sm leading-7 text-ink-muted"
          >
            {weekday}
          </span>
        ))}
      </div>
      {calendarWeeks(month).map((week, index) => (
        <div
          key={index}
          role="row"
          className="grid grid-cols-7 justify-items-center"
        >
          {week.map((date, column) =>
            date === null ? (
              <span key={column} role="gridcell" />
            ) : (
              <span key={date} role="gridcell">
                <DayButton
                  date={date}
                  state={dayState(date, range, reviewedDates)}
                  today={date === today}
                  selected={date === selected}
                  onSelect={onSelect}
                />
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function DayButton({
  date,
  state,
  today,
  selected,
  onSelect,
}: {
  date: string;
  state: ReturnType<typeof dayState>;
  today: boolean;
  selected: boolean;
  onSelect: (date: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={state !== "available"}
      aria-pressed={selected}
      aria-label={`${formatDay(date)}${state === "reviewed" ? " 작성함" : ""}`}
      onClick={() => onSelect(date)}
      className={cn(
        "my-0.5 flex size-11 items-center justify-center rounded-full text-body-md text-ink transition-colors duration-200",
        state === "outside" && "text-ink-subtle",
        state === "reviewed" && "text-ink-subtle line-through",
        today && !selected && "bg-info-soft font-bold text-info",
        selected && "bg-primary font-semibold text-on-primary",
      )}
    >
      {dayOfMonth(date)}
    </button>
  );
}

type VisitDateSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  range: { min: string; max: string };
  reviewedDates: readonly string[];
  today: string;
  value: string | null;
  onConfirm: (date: string) => void;
};

// 7-03 방문일 고르기. 시트 안에서 고른 날은 "선택"을 눌러야 반영된다.
// 닫히는 동안에도 달력을 그려 두고, 다 닫히면 시트가 내용을 치워 다시 열 때 지금 값으로 시작한다
export function VisitDateSheet({
  open,
  onOpenChange,
  ...props
}: VisitDateSheetProps) {
  return (
    <BottomSheet title="방문일" open={open} onOpenChange={onOpenChange}>
      <VisitDatePicker {...props} />
    </BottomSheet>
  );
}

function VisitDatePicker({
  range,
  reviewedDates,
  today,
  value,
  onConfirm,
}: Omit<VisitDateSheetProps, "open" | "onOpenChange">) {
  const months = monthsBetween(range.min, range.max);
  // 고를 수 없는 값이면 고르지 않은 채 오늘이 있는 달을 연다
  const initial =
    value !== null && dayState(value, range, reviewedDates) === "available"
      ? value
      : null;
  const [pending, setPending] = useState(initial);
  const [index, setIndex] = useState(() => {
    const target = monthOf(initial ?? range.max);
    return months.findIndex(
      (month) => month.year === target.year && month.month === target.month,
    );
  });
  const month = months[index];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <IconButton
          label="이전 달"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
        >
          <ChevronLeftIcon className={cn(index === 0 && "text-ink-disabled")} />
        </IconButton>
        <p className="text-title-sm text-ink">{formatMonth(month)}</p>
        <IconButton
          label="다음 달"
          disabled={index === months.length - 1}
          onClick={() => setIndex(index + 1)}
        >
          <ChevronRightIcon
            className={cn(index === months.length - 1 && "text-ink-disabled")}
          />
        </IconButton>
      </div>
      <VisitCalendar
        month={month}
        range={range}
        reviewedDates={reviewedDates}
        today={today}
        selected={pending}
        onSelect={setPending}
      />
      <p className="flex items-center gap-2 text-caption-md text-ink-muted">
        <span aria-hidden className="h-0.5 w-3 shrink-0 bg-ink-muted" />
        같은 날에 또 리뷰를 작성할 수 없어요.
      </p>
      <Button
        disabled={pending === null}
        onClick={() => pending && onConfirm(pending)}
        className="mt-2 w-full"
      >
        {pending ? `${formatDay(pending)} 선택` : "방문일을 골라 주세요"}
      </Button>
    </div>
  );
}
