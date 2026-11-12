import type { CreateForm } from "./create-form";
import {
  DESCRIPTION_MAX,
  RADII,
  type MeetupArea,
  type MeetupInfo,
  type MeetupRadius,
  type MeetupUpdateRequest,
} from "./meetup";
import { isSelectable } from "./meetup-date";

// 모임 정보 수정 화면의 처음 값. 스냅숏의 모임 정보 그대로다
export function formFromInfo(info: MeetupInfo): CreateForm {
  return {
    area: areaFromInfo(info.area),
    category: info.category,
    date: info.date,
    time: info.time,
    headcount: info.headcount ?? null,
    description: info.description ?? "",
  };
}

function areaFromInfo(area: MeetupInfo["area"]): MeetupArea | null {
  const { kind, name, lat, lng, radiusM } = area;
  if (kind !== "POINT") return name ? { kind, name } : null;
  if (lat === undefined || lng === undefined || !isRadius(radiusM)) return null;
  return { kind, lat, lng, radiusM, ...(name && { name }) };
}

function isRadius(value: number | undefined): value is MeetupRadius {
  return RADII.some((radius) => radius === value);
}

// 날짜나 시각을 바꿨는지. 바꾸지 않았으면 지난 날짜여도 다른 항목을 고칠 수 있다
export function whenChanged(form: CreateForm, initial: CreateForm) {
  return form.date !== initial.date || form.time !== initial.time;
}

// 날짜·시간만 고칠 때는 날짜를 비울 수 없다(AC-22)
export function canSave(
  form: CreateForm,
  initial: CreateForm,
  now: Date,
  dateOnly: boolean,
) {
  if (whenChanged(form, initial) && !isSelectable(form.date, form.time, now))
    return false;
  if (dateOnly) return !!form.date;
  return (
    form.area !== null && form.description.trim().length <= DESCRIPTION_MAX
  );
}

// PATCH 본문. 빠진 속성은 그대로이고 null은 비운다. 날짜·시각은 바꿨을 때만 보낸다
export function toUpdateRequest(
  form: CreateForm,
  initial: CreateForm,
  dateOnly: boolean,
): MeetupUpdateRequest {
  const when = whenChanged(form, initial)
    ? { date: form.date ?? null, time: (form.date && form.time) || null }
    : {};
  if (dateOnly) return when;
  const description = form.description.trim();
  return {
    area: form.area!,
    category: form.category,
    headcount: form.headcount,
    description: description || null,
    ...when,
  };
}
