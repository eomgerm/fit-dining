"use client";

import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";

import { isApiError } from "@/shared/api/api-error";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { StepProgress } from "@/shared/ui/display/step-progress";
import { CalendarIcon } from "@/shared/ui/icon/icons/calendar";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { CloseIcon } from "@/shared/ui/icon/icons/close";
import { EditIcon } from "@/shared/ui/icon/icons/edit";
import { PinOffIcon } from "@/shared/ui/icon/icons/pin-off";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";
import { WifiOffIcon } from "@/shared/ui/icon/icons/wifi-off";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { SectionHeader } from "@/shared/ui/layout/section-header";
import { TopBar } from "@/shared/ui/layout/top-bar";
import { AlertDialog } from "@/shared/ui/overlay/alert-dialog";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";
import { useToast } from "@/shared/ui/overlay/toast";

import {
  useCreateReview,
  useReviewForm,
  type WithAccessToken,
} from "../api/queries";
import type { ReviewFormResponse } from "../model/review";
import {
  canLeaveGoodPage,
  hasDetail,
  initialDraft,
  isDirty,
  normalizeSpent,
  reconcileDraft,
  toCreateRequest,
  type ReviewDraft,
} from "../model/review-draft";
import { disabledTagCodes, toggleTag } from "../model/review-tags";
import {
  DetailFields,
  PlaceRow,
  ReasonTagGroups,
  VisitDateButton,
} from "./review-write-parts";
import { submitFailure, type SubmitFailure } from "./submit-failure";
import { clearVisitEntry, useVisitEntry } from "./visit-entry-store";
import { VisitDateSheet } from "./visit-calendar";

type ReviewFormProps = {
  placeId: number;
  // 요청에 AT를 붙인다. 인증 도메인을 쓰는 app이 넘긴다
  withAccessToken: WithAccessToken;
  // 화면 이동은 부르는 쪽(app)이 정한다
  onSuccess: (reviewId: number) => void;
  onClose: () => void;
  onSignedOut: () => void;
};

// 방문 평가 2단계 작성(7-01~7-05, D-41). 작성 화면 데이터를 받은 뒤 흐름을 그린다
export function ReviewForm({
  placeId,
  withAccessToken,
  onSuccess,
  onClose,
  onSignedOut,
}: ReviewFormProps) {
  const form = useReviewForm(placeId, withAccessToken);
  // 등록하거나 닫은 뒤 Next가 숨겨 둔 화면을 다시 열면 빈 입력으로 시작하도록 흐름을 새로 만든다
  const [round, setRound] = useState(0);
  // 쓰는 중에 다시 받다가 난 401은 입력을 지키려고 넘기고, 등록할 때 다시 로그인하라고 안내한다
  const signedOut =
    !form.data && isApiError(form.error) && form.error.status === 401;

  useEffect(() => {
    if (signedOut) onSignedOut();
  }, [signedOut, onSignedOut]);

  const close = () => {
    clearVisitEntry(placeId);
    setRound(round + 1);
    onClose();
  };

  if (form.data) {
    return (
      <ReviewWriteFlow
        key={round}
        placeId={placeId}
        form={form.data}
        withAccessToken={withAccessToken}
        onSuccess={(reviewId) => {
          clearVisitEntry(placeId);
          setRound(round + 1);
          onSuccess(reviewId);
        }}
        onClose={close}
        onReload={() => form.refetch()}
      />
    );
  }
  if (form.isPending || signedOut) {
    return <FormFrame start={<CloseButton onClick={close} />} step={1} />;
  }
  const notFound = isApiError(form.error) && form.error.status === 404;
  return (
    <FormFrame start={<CloseButton onClick={close} />} step={1}>
      <main className="flex flex-1 flex-col justify-center">
        {notFound ? (
          <EmptyState
            icon={<PinOffIcon />}
            title="장소를 찾을 수 없어요"
            description="주소가 맞는지 확인해 주세요"
          />
        ) : (
          <EmptyState
            tone="warn"
            icon={<WifiOffIcon />}
            title="작성 화면을 불러오지 못했어요"
            description="잠시 후 다시 시도해 주세요"
            action={
              <Button
                variant="outline"
                size="md"
                onClick={() => form.refetch()}
              >
                다시 시도
              </Button>
            }
          />
        )}
      </main>
    </FormFrame>
  );
}

type Page = "good" | "bad" | "detail";

type ReviewWriteFlowProps = {
  placeId: number;
  form: ReviewFormResponse;
  withAccessToken: WithAccessToken;
  onSuccess: (reviewId: number) => void;
  onClose: () => void;
  onReload: () => void;
};

export function ReviewWriteFlow({
  placeId,
  form,
  withAccessToken,
  onSuccess,
  onClose,
  onReload,
}: ReviewWriteFlowProps) {
  const [initial] = useState(() => initialDraft(form));
  const [draft, setDraft] = useState(initial);
  // 작성 화면 데이터를 다시 받으면(400·409 뒤, 창 복귀) 고를 수 없게 된 입력을 뺀다
  const [reconciledForm, setReconciledForm] = useState(form);
  if (reconciledForm !== form) {
    setReconciledForm(form);
    setDraft((current) => reconcileDraft(current, form));
  }
  const [page, setPage] = useState<Page>("good");
  const [sheetOpen, setSheetOpen] = useState(false);
  // 장소 상세에서 확인한 결과(D-43)는 새로 들어올 때만 이 흐름으로 옮기고 저장소에서 지운다.
  // 7-E01의 "다른 날 고르기"로 들어오면 방문일 시트를 연다
  const entry = useVisitEntry(placeId);
  const [verified, setVerified] = useState(false);
  const [openedEntry, setOpenedEntry] = useState<number>();
  if (entry && entry.seq !== openedEntry) {
    setOpenedEntry(entry.seq);
    setVerified(entry.verified);
    if (entry.pickDate) {
      setPage("good");
      setSheetOpen(true);
    }
  }
  useEffect(() => {
    if (entry) clearVisitEntry(placeId);
  }, [entry, placeId]);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // 닫히는 동안 문구가 바뀌지 않게 마지막 실패 종류는 남겨 둔다
  const [failure, setFailure] = useState<SubmitFailure>("server");
  const [failureOpen, setFailureOpen] = useState(false);
  const createReview = useCreateReview(placeId, withAccessToken);
  const toast = useToast();
  const allTags = [...form.tags.good, ...form.tags.bad];
  const disabled = disabledTagCodes(draft.tagCodes, allTags);
  const today = form.visitDate.max;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [page]);

  const update = (patch: Partial<ReviewDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  function close() {
    // 다시 받은 데이터 때문에 비워진 방문일은 쓴 내용으로 보지 않는다
    if (isDirty(draft, reconcileDraft(initial, form))) setConfirmingClose(true);
    else onClose();
  }

  function submit() {
    if (createReview.isPending) return;
    setFailureOpen(false);
    // 다시 받은 데이터에 맞춰 방문일이나 좋았어요 태그가 빠졌으면 7-01에서 다시 고르게 한다
    if (draft.visitedAt === null || !canLeaveGoodPage(draft, form)) {
      setPage("good");
      setSheetOpen(draft.visitedAt === null);
      return;
    }
    createReview.mutate(
      toCreateRequest({ ...draft, visitedAt: draft.visitedAt }),
      {
        onSuccess: ({ reviewId }) => {
          // 토스트는 앱 전체에 하나라 화면을 옮겨도 이어서 보인다(Figma 7-06)
          toast("리뷰가 등록됐어요");
          onSuccess(reviewId);
        },
        onError: (error) => {
          const kind = submitFailure(error);
          if (kind === "duplicate" || kind === "invalid") onReload();
          setFailure(kind);
          setFailureOpen(true);
        },
      },
    );
  }

  function changeDateAfterDuplicate() {
    setFailureOpen(false);
    update({ visitedAt: null });
    setPage("good");
    setSheetOpen(true);
  }

  const header =
    page === "good" ? (
      <CloseButton onClick={close} />
    ) : (
      <IconButton
        label="이전"
        onClick={() => setPage(page === "detail" ? "bad" : "good")}
      >
        <ChevronLeftIcon />
      </IconButton>
    );

  const footer =
    page === "detail" ? (
      <BottomBar>
        <Button
          disabled={createReview.isPending}
          onClick={submit}
          className="w-full"
        >
          {createReview.isPending
            ? "등록하는 중"
            : hasDetail(draft)
              ? "등록하기"
              : "건너뛰고 등록하기"}
        </Button>
      </BottomBar>
    ) : (
      <BottomBar tone="surface-warm">
        <Button
          disabled={page === "good" && !canLeaveGoodPage(draft, form)}
          onClick={() => setPage(page === "good" ? "bad" : "detail")}
          className="w-full"
        >
          다음
        </Button>
      </BottomBar>
    );

  return (
    <FormFrame
      start={header}
      step={page === "detail" ? 2 : 1}
      warm={page !== "detail"}
      scrollRef={scrollRef}
      pinned={
        page !== "detail" && (
          <>
            <section className="flex flex-col gap-4 bg-surface px-5 pt-2 pb-5">
              <PlaceRow
                place={form.place}
                // 지난 방문은 지금 위치로 확인할 수 없어 방문일이 오늘일 때만 보인다
                verified={verified && draft.visitedAt === today}
              />
              <VisitDateButton
                value={draft.visitedAt}
                today={today}
                onClick={() => setSheetOpen(true)}
              />
            </section>
            <div className="px-5 pt-7 pb-5">
              {page === "good" ? (
                <SectionHeader title="어떤 점이 좋았나요?" />
              ) : (
                <SectionHeader
                  title="아쉬운 점도 있었나요?"
                  description="없으면 바로 넘어가도 돼요."
                />
              )}
            </div>
          </>
        )
      }
      footer={footer}
    >
      {page === "detail" ? (
        <DetailFields
          revisitIntent={draft.revisitIntent}
          description={draft.description}
          spentPerPerson={draft.spentPerPerson}
          limits={form.limits}
          onRevisitIntentChange={(revisitIntent) => update({ revisitIntent })}
          onDescriptionChange={(description) => update({ description })}
          onSpentPerPersonChange={(raw) => {
            const spentPerPerson = normalizeSpent(
              raw,
              form.limits.spentPerPersonMax,
            );
            if (spentPerPerson !== null) update({ spentPerPerson });
          }}
          onAddPhoto={() => toast("사진은 아직 올릴 수 없어요")}
        />
      ) : (
        <div className="px-5 pb-6">
          <ReasonTagGroups
            tags={page === "good" ? form.tags.good : form.tags.bad}
            selected={draft.tagCodes}
            disabled={disabled}
            onToggle={(code) =>
              update({ tagCodes: toggleTag(draft.tagCodes, code) })
            }
          />
        </div>
      )}
      <VisitDateSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        range={form.visitDate}
        reviewedDates={form.reviewedDates}
        today={today}
        value={draft.visitedAt}
        onConfirm={(visitedAt) => {
          update({ visitedAt });
          setSheetOpen(false);
        }}
      />
      <ConfirmDialog
        open={confirmingClose}
        onOpenChange={setConfirmingClose}
        icon={<EditIcon />}
        title="작성한 내용이 사라져요"
        description="지금 나가면 작성한 내용이 사라져요."
        secondaryAction={
          <Button variant="outline" size="md" onClick={onClose}>
            나가기
          </Button>
        }
        action={
          <Button size="md" onClick={() => setConfirmingClose(false)}>
            계속 쓰기
          </Button>
        }
      />
      <SubmitFailureDialog
        failure={failure}
        open={failureOpen}
        onOpenChange={setFailureOpen}
        onRetry={submit}
        onChangeDate={changeDateAfterDuplicate}
        onLeave={onClose}
      />
    </FormFrame>
  );
}

// 7-E05, 7-E06과 409·401·404·400 안내. 없는 장소(404)만 빼고 입력은 그대로 남는다
export function SubmitFailureDialog({
  failure,
  open,
  onOpenChange,
  onRetry,
  onChangeDate,
  onLeave,
}: {
  failure: SubmitFailure;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onChangeDate: () => void;
  onLeave: () => void;
}) {
  const onDismiss = () => onOpenChange(false);
  const ok = (
    <Button size="md" onClick={onDismiss}>
      확인
    </Button>
  );

  if (failure === "server") {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        tone="warn"
        icon={<WarningIcon />}
        title="리뷰를 등록하지 못했어요"
        description="잠시 후 다시 시도해 주세요."
        secondaryAction={
          <Button variant="outline" size="md" onClick={onDismiss}>
            닫기
          </Button>
        }
        action={
          <Button size="md" onClick={onRetry}>
            다시 등록
          </Button>
        }
      />
    );
  }
  if (failure === "duplicate") {
    return (
      <AlertDialog
        open={open}
        onOpenChange={onOpenChange}
        icon={<CalendarIcon />}
        title="이 날짜에는 이미 리뷰를 남겼어요"
        description="다른 방문일을 골라 주세요."
        action={
          <Button size="md" onClick={onChangeDate}>
            방문일 바꾸기
          </Button>
        }
      />
    );
  }
  if (failure === "placeNotFound") {
    return (
      <AlertDialog
        open={open}
        onOpenChange={onOpenChange}
        icon={<PinOffIcon />}
        title="장소를 찾을 수 없어요"
        description="장소 정보가 바뀌어 리뷰를 남길 수 없어요."
        action={
          <Button size="md" onClick={onLeave}>
            나가기
          </Button>
        }
      />
    );
  }
  const content =
    failure === "offline"
      ? {
          icon: <WifiOffIcon />,
          title: "인터넷에 연결되어 있지 않아요",
          description: "연결을 확인하고 다시 등록해 주세요.",
        }
      : failure === "signedOut"
        ? {
            icon: <WarningIcon />,
            title: "로그인이 끝났어요",
            description:
              "다시 로그인한 뒤 등록해 주세요. 입력한 내용은 그대로 있어요.",
          }
        : {
            icon: <WarningIcon />,
            title: "등록하지 못했어요",
            description: "입력한 내용을 확인해 주세요.",
          };
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warn"
      {...content}
      action={ok}
    />
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="닫기" onClick={onClick}>
      <CloseIcon />
    </IconButton>
  );
}

// 화면 높이를 뷰포트에 맞추고 가운데(children)만 스크롤해 스크롤 막대가 움직이는 범위와 같다
function FormFrame({
  start,
  step,
  warm,
  pinned,
  footer,
  scrollRef,
  children,
}: {
  start: ReactNode;
  step: 1 | 2;
  warm?: boolean;
  // 상단 막대 아래에서 스크롤하지 않는 내용(7-01·7-02의 장소·방문일 줄과 질문)
  pinned?: ReactNode;
  footer?: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
}) {
  return (
    <div
      className={
        warm
          ? "flex h-dvh flex-col bg-surface-warm"
          : "flex h-dvh flex-col bg-surface"
      }
    >
      <div className="shrink-0">
        <TopBar tone="surface" start={start}>
          <StepProgress
            step={step}
            total={2}
            label="방문 평가 진행"
            className="mx-auto w-64"
          />
        </TopBar>
        {pinned}
      </div>
      <div
        ref={scrollRef}
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {children}
      </div>
      {footer}
    </div>
  );
}
