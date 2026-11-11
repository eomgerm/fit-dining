"use client";

import { useState } from "react";

import { isApiError } from "@/shared/api/api-error";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { Note } from "@/shared/ui/display/note";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";
import { useToast } from "@/shared/ui/overlay/toast";

import { conflictOf, useUpdateMeetup, type WithSession } from "../api/queries";
import { isPastTime, type CreateForm } from "../model/create-form";
import {
  canSave,
  formFromInfo,
  toUpdateRequest,
  whenChanged,
} from "../model/edit-form";
import type { MeetupSnapshot } from "../model/meetup";
import { formatExpiresOn, lastOpenDay } from "../model/meetup-date";
import { MeetupInfoFields, useClientNow } from "./meetup-info-fields";

function note(snapshot: MeetupSnapshot, dateOnly: boolean) {
  if (dateOnly) {
    return snapshot.phase === "DECIDED"
      ? "장소를 정해서 날짜와 시간만 바꿀 수 있어요."
      : "투표가 열려 있어 날짜와 시간만 바꿀 수 있어요.";
  }
  return snapshot.resultCalculationId !== undefined
    ? "추천 결과가 있어요. 고친 내용은 다시 추천받으면 반영돼요."
    : null;
}

// 모임 정보 수정(상태 모음 5, AC-22, AC-30). EDIT_INFO면 모든 항목을, EDIT_DATE만 있으면 날짜·시간만 고친다.
// 고른 날짜로 열 수 있는 마지막 날을 미리 보인다
export function MeetupEditForm({
  code,
  snapshot,
  withSession,
  onBack,
  onSaved,
  onUnauthorized,
  now = () => new Date(),
}: {
  code: string;
  snapshot: MeetupSnapshot;
  withSession: WithSession;
  onBack: () => void;
  onSaved: () => void;
  onUnauthorized: () => void;
  now?: () => Date;
}) {
  const dateOnly = !snapshot.allowed.includes("EDIT_INFO");
  const [initial] = useState(() => formFromInfo(snapshot.info));
  const [form, setForm] = useState<CreateForm>(initial);
  const save = useUpdateMeetup(code);
  const toast = useToast();
  const today = useClientNow(now);
  const savable =
    today !== null &&
    canSave(form, initial, today, dateOnly) &&
    !save.isPending;
  const expiry = today && formatExpiresOn(lastOpenDay(form.date, today));
  const message = note(snapshot, dateOnly);

  const submit = () => {
    if (!savable) return;
    save.mutate(toUpdateRequest(form, initial, dateOnly), {
      onSuccess: onSaved,
      onError: (error) => {
        if (isApiError(error) && error.status === 401) onUnauthorized();
        else if (conflictOf(error) === "phase")
          toast("지금은 날짜와 시간만 바꿀 수 있어요");
        else if (isApiError(error) && error.status === 400)
          toast("넣은 내용을 다시 확인해 주세요");
        else toast("모임 정보를 고치지 못했어요. 잠시 뒤 다시 시도해 주세요");
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
        title="모임 정보 수정"
      />
      <div className="flex flex-col gap-6 px-5 pt-5 pb-4">
        {message && <Note>{message}</Note>}
        <MeetupInfoFields
          form={form}
          onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
          today={today}
          pastTime={
            today !== null &&
            whenChanged(form, initial) &&
            isPastTime(form, today)
          }
          withSession={withSession}
          onUnauthorized={onUnauthorized}
          dateOnly={dateOnly}
          dateNote={
            expiry && (dateOnly ? `날짜를 바꾸면 ${expiry}.` : `${expiry}.`)
          }
        />
      </div>
      <BottomBar>
        <Button disabled={!savable} onClick={submit}>
          {save.isPending && (
            <span
              className="mr-2 size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {save.isPending ? "저장하는 중" : "저장"}
        </Button>
      </BottomBar>
    </Screen>
  );
}
