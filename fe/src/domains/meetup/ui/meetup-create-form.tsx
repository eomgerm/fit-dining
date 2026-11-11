"use client";

import { useState } from "react";

import { isApiError } from "@/shared/api/api-error";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";
import { useToast } from "@/shared/ui/overlay/toast";

import { useCreateMeetup, type WithSession } from "../api/queries";
import {
  canSubmit,
  EMPTY_FORM,
  isPastTime,
  toRequest,
  type CreateForm,
} from "../model/create-form";
import { MeetupInfoFields, useClientNow } from "./meetup-info-fields";

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
  const today = useClientNow(now);
  const submittable =
    today !== null && canSubmit(form, today) && !create.isPending;

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
        <MeetupInfoFields
          form={form}
          onChange={update}
          today={today}
          pastTime={today !== null && isPastTime(form, today)}
          withSession={withSession}
          onUnauthorized={onUnauthorized}
        />
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
