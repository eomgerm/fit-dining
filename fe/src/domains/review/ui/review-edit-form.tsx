"use client";

import { useEffect, useState, type ReactNode } from "react";

import { isApiError } from "@/shared/api/api-error";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { Textarea } from "@/shared/ui/form/textarea";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { EditIcon } from "@/shared/ui/icon/icons/edit";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";
import { WifiOffIcon } from "@/shared/ui/icon/icons/wifi-off";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { SectionHeader } from "@/shared/ui/layout/section-header";
import { TopBar } from "@/shared/ui/layout/top-bar";
import { AlertDialog } from "@/shared/ui/overlay/alert-dialog";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";
import { useToast } from "@/shared/ui/overlay/toast";

import {
  useReviewDetail,
  useUpdateReview,
  type WithAccessToken,
} from "../api/queries";
import {
  isDescriptionChanged,
  isSamePhotos,
  type ReviewDetailResponse,
  type ReviewUpdateRequest,
} from "../model/review";
import { editFailure, type EditFailure } from "./edit-failure";
import { ReviewPhotoField } from "./review-photo-field";
import { UNREADABLE_PHOTO, useReviewPhotos } from "./use-review-photos";

type ReviewEditFormProps = {
  reviewId: number;
  // 요청에 AT를 붙인다. 인증 도메인을 쓰는 app이 넘긴다
  withAccessToken: WithAccessToken;
  // 화면 이동은 부르는 쪽(app)이 정한다
  onSuccess: () => void;
  onClose: () => void;
  onSignedOut: () => void;
};

// 리뷰 수정(6-07, D-44, D-45). 내 리뷰를 받은 뒤 본문과 사진 칸을 그린다
export function ReviewEditForm({
  reviewId,
  withAccessToken,
  onSuccess,
  onClose,
  onSignedOut,
}: ReviewEditFormProps) {
  const detail = useReviewDetail(reviewId, withAccessToken);
  const signedOut = isApiError(detail.error) && detail.error.status === 401;

  useEffect(() => {
    if (signedOut) onSignedOut();
  }, [signedOut, onSignedOut]);

  // 다시 받는 동안에는 입력칸을 내려, 다시 열면 늘 지금 저장된 본문으로 시작한다
  const review = detail.data;
  if (review && !detail.isFetching && !detail.isError) {
    return (
      <ReviewEditFields
        review={review}
        withAccessToken={withAccessToken}
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );
  }
  const back = <BackButton onClick={onClose} />;
  if (!detail.isError || signedOut) {
    return (
      <EditFrame start={back}>
        <div aria-busy="true" className="flex-1">
          <span className="sr-only">리뷰를 불러오는 중이에요</span>
        </div>
      </EditFrame>
    );
  }
  // 남의 리뷰(403)도 고칠 수 없는 리뷰라 없는 리뷰와 같이 안내한다
  const notFound =
    isApiError(detail.error) &&
    (detail.error.status === 404 || detail.error.status === 403);
  return (
    <EditFrame start={back}>
      <main className="flex flex-1 flex-col justify-center">
        {notFound ? (
          <EmptyState
            icon={<WarningIcon />}
            title="리뷰를 찾을 수 없어요"
            description="삭제됐거나 고칠 수 없는 리뷰예요"
          />
        ) : (
          <EmptyState
            tone="warn"
            icon={<WifiOffIcon />}
            title="리뷰를 불러오지 못했어요"
            description="잠시 후 다시 시도해 주세요"
            action={
              <Button
                variant="outline"
                size="md"
                onClick={() => detail.refetch()}
              >
                다시 시도
              </Button>
            }
          />
        )}
      </main>
    </EditFrame>
  );
}

type ReviewEditFieldsProps = {
  review: ReviewDetailResponse;
  withAccessToken: WithAccessToken;
  onSuccess: () => void;
  onClose: () => void;
};

function ReviewEditFields({
  review,
  withAccessToken,
  onSuccess,
  onClose,
}: ReviewEditFieldsProps) {
  const [description, setDescription] = useState(review.description ?? "");
  const [confirmingClose, setConfirmingClose] = useState(false);
  // 닫히는 동안 문구가 바뀌지 않게 마지막 실패 종류는 남겨 둔다
  const [failure, setFailure] = useState<EditFailure>("server");
  const [failureOpen, setFailureOpen] = useState(false);
  const updateReview = useUpdateReview(review, withAccessToken);
  const toast = useToast();
  const photos = useReviewPhotos({
    saved: review.photos,
    max: review.limits.photoMax,
    withAccessToken,
    onUnreadable: () => toast(UNREADABLE_PHOTO),
  });
  const descriptionChanged = isDescriptionChanged(
    review.description,
    description,
  );
  const photosChanged = !isSamePhotos(
    review.photos.map((photo) => photo.photoId),
    photos.photoIds,
  );
  // 올리는 중이거나 올리지 못한 사진도 고친 것으로 본다
  const changed =
    descriptionChanged || photosChanged || photos.busy || photos.failed;
  const pending = updateReview.isPending || photos.busy;

  // Figma에 수정 중 나가기 화면이 없어 작성 중 닫기(7-E03)와 같은 꼴로 묻는다.
  // 보내는 중에는 "<"를 막는다. 나가도 요청은 저장되므로 "사라져요"라고 물을 수 없다
  function close() {
    if (updateReview.isPending) return;
    if (changed) setConfirmingClose(true);
    else onClose();
  }

  function submit() {
    if (pending) return;
    if (photos.failed) {
      toast("올리지 못한 사진을 다시 올리거나 빼 주세요");
      return;
    }
    setFailureOpen(false);
    // 바꾼 것만 보낸다. 사진은 고친 뒤의 사진 전체다(D-45)
    const body: ReviewUpdateRequest = {
      ...(descriptionChanged && { description }),
      ...(photosChanged && { photos: photos.photoIds }),
    };
    updateReview.mutate(body, {
      onSuccess: () => {
        // 등록(7-06)·삭제(6-09)처럼 토스트로 알린다. 토스트는 앱 전체에 하나라 화면을 옮겨도 보인다
        toast("리뷰를 수정했어요");
        onSuccess();
      },
      onError: (error) => {
        setFailure(editFailure(error));
        setFailureOpen(true);
      },
    });
  }

  return (
    <EditFrame
      start={<BackButton onClick={close} disabled={updateReview.isPending} />}
      footer={
        <BottomBar>
          <Button
            // 바뀐 것이 없으면 보낼 것이 없다. 보내거나 사진을 올리는 동안에는 막되 포커스는 남긴다
            disabled={!changed || pending}
            focusableWhenDisabled={pending}
            aria-busy={pending}
            onClick={submit}
            className="w-full"
          >
            {updateReview.isPending
              ? "수정하는 중"
              : photos.busy
                ? "사진 올리는 중"
                : "수정하기"}
          </Button>
          <span role="status" className="sr-only">
            {updateReview.isPending ? "리뷰를 수정하고 있어요" : ""}
          </span>
        </BottomBar>
      }
    >
      <div className="flex flex-col gap-7 px-5 pt-7 pb-6">
        <div className="flex flex-col gap-3">
          <SectionHeader size="md" title="리뷰" />
          <Textarea
            label="리뷰"
            maxLength={review.limits.descriptionMax}
            placeholder="자유롭게 적어 주세요"
            value={description}
            onValueChange={(value) => setDescription(value)}
          />
        </div>
        <ReviewPhotoField photos={photos} />
      </div>
      <ConfirmDialog
        open={confirmingClose}
        onOpenChange={setConfirmingClose}
        icon={<EditIcon />}
        title="수정한 내용이 사라져요"
        description="지금 나가면 수정한 내용이 사라져요."
        secondaryAction={
          <Button variant="outline" size="md" onClick={onClose}>
            나가기
          </Button>
        }
        action={
          <Button size="md" onClick={() => setConfirmingClose(false)}>
            계속 수정
          </Button>
        }
      />
      <EditFailureDialog
        failure={failure}
        open={failureOpen}
        onOpenChange={setFailureOpen}
        onRetry={submit}
        onLeave={onClose}
      />
    </EditFrame>
  );
}

// 6-E07과 연결 끊김·401·403·404 안내. 고칠 수 없게 된 리뷰(403·404)만 빼고 입력은 그대로 남는다
function EditFailureDialog({
  failure,
  open,
  onOpenChange,
  onRetry,
  onLeave,
}: {
  failure: EditFailure;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onLeave: () => void;
}) {
  const onDismiss = () => onOpenChange(false);

  if (failure === "server") {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        tone="warn"
        icon={<WarningIcon />}
        title="리뷰를 수정하지 못했어요"
        description="잠시 후 다시 시도해 주세요."
        secondaryAction={
          <Button variant="outline" size="md" onClick={onDismiss}>
            닫기
          </Button>
        }
        action={
          <Button size="md" onClick={onRetry}>
            다시 수정
          </Button>
        }
      />
    );
  }
  // 불러올 때의 403·404 안내와 같다
  if (failure === "notFound" || failure === "forbidden") {
    return (
      <AlertDialog
        open={open}
        onOpenChange={onOpenChange}
        tone="warn"
        icon={<WarningIcon />}
        title="리뷰를 찾을 수 없어요"
        description="삭제됐거나 고칠 수 없는 리뷰예요."
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
          description: "연결을 확인하고 다시 수정해 주세요.",
        }
      : failure === "photo"
        ? {
            icon: <WarningIcon />,
            title: "올릴 수 없는 사진이 있어요",
            description:
              "사진을 빼거나 다른 사진으로 바꾼 뒤 다시 수정해 주세요.",
          }
        : failure === "signedOut"
          ? {
              icon: <WarningIcon />,
              title: "로그인이 끝났어요",
              description:
                "다시 로그인한 뒤 수정해 주세요. 입력한 내용은 그대로 있어요.",
            }
          : {
              icon: <WarningIcon />,
              title: "수정하지 못했어요",
              description: "입력한 내용을 확인해 주세요.",
            };
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warn"
      {...content}
      action={
        <Button size="md" onClick={onDismiss}>
          확인
        </Button>
      }
    />
  );
}

function BackButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <IconButton
      label="뒤로"
      onClick={onClick}
      disabled={disabled}
      focusableWhenDisabled
    >
      <ChevronLeftIcon />
    </IconButton>
  );
}

// 작성 화면처럼 높이를 뷰포트에 맞추고 가운데(children)만 스크롤한다
function EditFrame({
  start,
  footer,
  children,
}: {
  start: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col bg-surface">
      <TopBar
        tone="surface"
        start={start}
        title="리뷰 수정"
        className="shrink-0"
      />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
      {footer}
    </div>
  );
}
