"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { Note } from "@/shared/ui/display/note";
import { Textarea } from "@/shared/ui/form/textarea";
import { CloseIcon } from "@/shared/ui/icon/icons/close";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { SectionHeader } from "@/shared/ui/layout/section-header";
import { TopBar } from "@/shared/ui/layout/top-bar";
import { useToast } from "@/shared/ui/overlay/toast";

import { useCreateReview } from "../api/queries";
import { DESCRIPTION_MAX, toCreateRequest } from "../model/review";
import { submitErrorMessage } from "./submit-error-message";

type SimpleReviewFormProps = {
  placeId: number;
  // 등록에 성공하면 부른다. 화면 이동은 부르는 쪽(app)이 정한다
  onSuccess: (reviewId: number) => void;
  onClose: () => void;
};

// Walking Skeleton의 한 화면 작성 폼(D-31). 1차 후속에서 Figma 2단계 흐름(ReviewForm)으로 바뀐다
export function SimpleReviewForm({
  placeId,
  onSuccess,
  onClose,
}: SimpleReviewFormProps) {
  const [draft, setDraft] = useState("");
  const createReview = useCreateReview(placeId);
  const toast = useToast();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 처리 중에는 버튼이 비활성이지만 Enter 같은 다른 제출 경로도 막는다
    if (createReview.isPending) return;
    createReview.mutate(toCreateRequest(draft), {
      onSuccess: ({ reviewId }) => {
        // 이동한 뒤에도 Next가 이 화면을 숨겨 둔 채 보존하므로, 다시 열었을 때 빈 폼이 되도록 비운다
        setDraft("");
        createReview.reset();
        // 토스트는 앱 전체에 하나라 화면을 옮겨도 이어서 보인다(Figma 7-06)
        toast("리뷰가 등록됐어요");
        onSuccess(reviewId);
      },
    });
  }

  return (
    <div className="flex flex-1 flex-col bg-surface">
      <TopBar
        tone="surface"
        title="방문 평가"
        className="sticky top-0 z-1"
        end={
          <IconButton label="닫기" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        }
      />
      <form noValidate onSubmit={handleSubmit} className="flex flex-1 flex-col">
        <div className="flex flex-col gap-4 px-5 pt-2 pb-6">
          <SectionHeader size="md" title="리뷰" hint="선택" />
          <Textarea
            label="리뷰"
            maxLength={DESCRIPTION_MAX}
            placeholder="다녀온 경험을 자유롭게 남겨 주세요"
            value={draft}
            onValueChange={(value) => setDraft(value)}
          />
          {createReview.isError && (
            <Note tone="warn" role="alert">
              {submitErrorMessage(createReview.error)}
            </Note>
          )}
        </div>
        <BottomBar>
          <Button
            type="submit"
            disabled={createReview.isPending}
            className="w-full"
          >
            {createReview.isPending ? "등록하는 중" : "등록하기"}
          </Button>
        </BottomBar>
      </form>
    </div>
  );
}
