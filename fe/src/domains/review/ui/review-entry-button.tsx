"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { isApiError } from "@/shared/api/api-error";
import { Button } from "@/shared/ui/button/button";
import { CalendarIcon } from "@/shared/ui/icon/icons/calendar";
import { PinIcon } from "@/shared/ui/icon/icons/pin";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";

import { reviewKeys, type WithSession } from "../api/queries";
import { fetchReviewForm } from "../api/review-api";
import type { DevicePosition } from "../model/nearby-check";
import type { ReviewFormResponse } from "../model/review";
import {
  entryCheck,
  reviewedToday,
  type VisitEntry,
} from "../model/visit-entry";
import { SignInPrompt } from "./sign-in-prompt";
import { saveVisitEntry } from "./visit-entry-store";

const LOCATION_TIMEOUT_MS = 10_000;
// 위치 요청의 timeout은 권한 창에서 기다린 시간을 세지 않아, 답하지 않은 권한 창에도 끝나도록 따로 마감을 둔다
const LOCATION_DEADLINE_MS = 20_000;
// 위치를 이보다 오래 기다리면 대기 창을 띄운다(D-53)
const WAITING_NOTICE_MS = 3_000;

// 누른 순간의 위치를 새로 받는다. 권한 거절, 오류, 시간 초과, 위치 기능이 없으면 null이다
function currentPosition() {
  return new Promise<DevicePosition | null>((resolve) => {
    const deadline = setTimeout(() => resolve(null), LOCATION_DEADLINE_MS);
    const done = (position: DevicePosition | null) => {
      clearTimeout(deadline);
      resolve(position);
    };
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) =>
          done({
            lat: coords.latitude,
            lng: coords.longitude,
            accuracy: coords.accuracy,
          }),
        () => done(null),
        {
          enableHighAccuracy: true,
          timeout: LOCATION_TIMEOUT_MS,
          maximumAge: 0,
        },
      );
    } catch {
      done(null);
    }
  });
}

type ReviewEntryButtonProps = {
  placeId: number;
  // 작성 화면 데이터에 AT를 붙인다. 인증 도메인을 쓰는 app이 넘긴다
  authenticated: WithSession;
  // 작성 화면으로 간다. 화면 이동은 app이 정한다
  onEnter: () => void;
  // 로그인 안내(6-E05)에서 "로그인"을 누르면 부른다. 화면 이동은 app이 정한다
  onSignIn: () => void;
};

// 장소 상세 하단의 "방문 평가 남기기"(D-12, D-43, D-47). 작성 화면 데이터를 먼저 받아 로그인하지 않았으면 로그인 안내(6-E05),
// 오늘 이미 썼으면 7-E01, 아니면 기기 위치를 받아 근처면 바로 작성 화면, 근처가 아니면 7-E02를 띄운다.
// 위치를 3초 넘게 기다리면 7-E02와 같은 구성의 대기 창을 띄우고, 결과가 나오면 같은 창의 내용만 바꾼다(D-53)
export function ReviewEntryButton({
  placeId,
  authenticated,
  onEnter,
  onSignIn,
}: ReviewEntryButtonProps) {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [dialog, setDialog] = useState<
    "signIn" | "reviewedToday" | "waiting" | "notNearby" | null
  >(null);
  // 대기 창·7-E02가 닫히는 동안에도 마지막 내용을 보이도록 dialog와 따로 둔다
  const [visitView, setVisitView] = useState<"waiting" | "notNearby">(
    "waiting",
  );
  if ((dialog === "waiting" || dialog === "notNearby") && dialog !== visitView)
    setVisitView(dialog);
  const [form, setForm] = useState<ReviewFormResponse | null>(null);
  // 확인하는 동안 상세를 떠나거나(숨김·언마운트) 확인을 멈추면 그 결과로 화면을 옮기지 않는다
  const attempt = useRef(0);
  const waitingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      attempt.current += 1;
      clearTimeout(waitingTimer.current);
    },
    [],
  );

  const stop = () => {
    attempt.current += 1;
    clearTimeout(waitingTimer.current);
    setChecking(false);
  };

  const enter = (entry: VisitEntry) => {
    setDialog(null);
    saveVisitEntry(placeId, entry);
    onEnter();
  };

  const decide = (
    data: ReviewFormResponse,
    position: DevicePosition | null,
  ) => {
    const check = entryCheck(data, position);
    if (check === "nearby") enter({ verified: true, pickDate: false });
    else setDialog(check);
  };

  // 대기 창이 이미 열려 있으면(다시 확인) 바로 대기 창 내용으로 바꾸고, 아니면 3초 뒤에 띄운다
  const locate = async (
    id: number,
    data: ReviewFormResponse,
    waitingNow: boolean,
  ) => {
    if (waitingNow) setDialog("waiting");
    else
      waitingTimer.current = setTimeout(() => {
        if (id === attempt.current) setDialog("waiting");
      }, WAITING_NOTICE_MS);
    const position = await currentPosition();
    clearTimeout(waitingTimer.current);
    if (id === attempt.current) decide(data, position);
  };

  const start = async () => {
    const id = ++attempt.current;
    setChecking(true);
    try {
      const data = await queryClient.fetchQuery({
        queryKey: reviewKeys.form(placeId),
        queryFn: ({ signal }) =>
          authenticated(() => fetchReviewForm(placeId, signal)),
        staleTime: 0,
        // 작성 화면처럼 다시 시도하지 않고, 오프라인이면 기다리지 않고 바로 실패한다
        retry: false,
        networkMode: "always",
      });
      if (id !== attempt.current) return;
      setForm(data);
      // 데이터를 받은 뒤, 오늘 쓴 장소가 아닐 때만 위치를 묻는다
      if (reviewedToday(data)) {
        setDialog("reviewedToday");
        return;
      }
      await locate(id, data, false);
    } catch (error) {
      if (id !== attempt.current) return;
      // 데이터를 받지 못했으면 작성 화면이 오류 안내를 맡는다
      if (isApiError(error) && error.status === 401) setDialog("signIn");
      else enter({ verified: false, pickDate: false });
    } finally {
      if (id === attempt.current) setChecking(false);
    }
  };

  const recheck = async () => {
    if (!form) return;
    const id = ++attempt.current;
    setChecking(true);
    try {
      await locate(id, form, true);
    } finally {
      if (id === attempt.current) setChecking(false);
    }
  };

  const writeUnverified = () => {
    stop();
    enter({ verified: false, pickDate: false });
  };

  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  // 대기 창을 닫으면 확인을 멈추고 장소 상세에 남는다
  const closeVisit = (open: boolean) => {
    if (open) return;
    if (dialog === "waiting") stop();
    setDialog(null);
  };

  const waiting = visitView === "waiting";

  return (
    <>
      <Button
        className="w-full"
        disabled={checking}
        focusableWhenDisabled
        aria-busy={checking}
        onClick={start}
      >
        {checking && <Spinner />}
        {checking ? "방문 확인 중" : "방문 평가 남기기"}
      </Button>
      <span role="status" className="sr-only">
        {checking ? "방문을 확인하고 있어요" : ""}
      </span>
      <SignInPrompt
        open={dialog === "signIn"}
        description="방문 평가는 로그인해야 이용할 수 있어요."
        onClose={() => setDialog(null)}
        onSignIn={onSignIn}
      />
      <ConfirmDialog
        open={dialog === "reviewedToday"}
        onOpenChange={close}
        icon={<CalendarIcon />}
        title="오늘은 이미 리뷰를 남겼어요"
        description="다른 방문일로 남길 수 있어요."
        secondaryAction={
          <Button variant="outline" size="md" onClick={() => setDialog(null)}>
            닫기
          </Button>
        }
        action={
          <Button
            size="md"
            onClick={() => enter({ verified: false, pickDate: true })}
          >
            다른 날 고르기
          </Button>
        }
      />
      <ConfirmDialog
        open={dialog === "waiting" || dialog === "notNearby"}
        onOpenChange={closeVisit}
        tone={waiting ? "primary" : "warn"}
        icon={<PinIcon />}
        title={
          waiting ? "방문을 확인하고 있어요" : "근처에서 확인하지 못했어요"
        }
        description="확인하지 않아도 리뷰를 남길 수 있어요."
        secondaryAction={
          <Button variant="outline" size="md" onClick={writeUnverified}>
            그냥 쓰기
          </Button>
        }
        action={
          <Button
            size="md"
            disabled={waiting}
            focusableWhenDisabled
            aria-busy={waiting}
            onClick={recheck}
          >
            {waiting && <Spinner />}
            {waiting ? "확인 중" : "다시 확인"}
          </Button>
        }
      />
    </>
  );
}

function Spinner() {
  return (
    <span
      className="mr-2 size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
      aria-hidden="true"
    />
  );
}
