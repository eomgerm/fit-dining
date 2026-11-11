import { isSelectable } from "./meetup-date";
import {
  DESCRIPTION_MAX,
  HEADCOUNT_MAX,
  HEADCOUNT_MIN,
  type MeetupArea,
  type MeetupCategory,
  type MeetupCreateRequest,
} from "./meetup";

export type CreateForm = {
  area: MeetupArea | null;
  category: MeetupCategory;
  date?: string;
  time?: string;
  headcount: number | null;
  description: string;
};

export const EMPTY_FORM: CreateForm = {
  area: null,
  category: "RESTAURANT",
  headcount: null,
  description: "",
};

// 인원 스테퍼의 다음 값. 정하지 않음 → 2명 → … → 8명
export function nextHeadcount(value: number | null) {
  if (value === null) return HEADCOUNT_MIN;
  return Math.min(value + 1, HEADCOUNT_MAX);
}

// 2명에서 줄이면 정하지 않음으로 돌아간다
export function previousHeadcount(value: number | null) {
  if (value === null || value <= HEADCOUNT_MIN) return null;
  return value - 1;
}

export function isPastTime(form: CreateForm, now: Date) {
  return !!form.date && !isSelectable(form.date, form.time, now);
}

// 지역을 골랐고, 날짜·시간을 고를 수 있고, 설명이 길지 않을 때 보낼 수 있다(AC-25)
export function canSubmit(form: CreateForm, now: Date) {
  return (
    form.area !== null &&
    isSelectable(form.date, form.time, now) &&
    form.description.trim().length <= DESCRIPTION_MAX
  );
}

export function toRequest(form: CreateForm): MeetupCreateRequest {
  const description = form.description.trim();
  return {
    area: form.area!,
    category: form.category,
    ...(form.date && { date: form.date }),
    ...(form.date && form.time && { time: form.time }),
    ...(form.headcount !== null && { headcount: form.headcount }),
    ...(description && { description }),
  };
}
