"use client";

import { RadioGroup } from "@base-ui/react/radio-group";
import { useState, type ComponentProps } from "react";

import { Button } from "@/shared/ui/button/button";
import { Radio } from "@/shared/ui/form/radio";
import { Textarea } from "@/shared/ui/form/textarea";
import { BottomSheet } from "@/shared/ui/overlay/bottom-sheet";

import {
  REPORT_DETAIL_MAX,
  REPORT_REASONS,
  reportRequest,
  type ReportReason,
  type ReviewReportRequest,
} from "../model/review";

type ReviewReportSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSubmit: (body: ReviewReportRequest) => void;
  // 닫힐 때 포커스를 보낼 곳. 신고한 리뷰가 목록에서 빠졌을 때(404) 쓴다
  finalFocus?: ComponentProps<typeof BottomSheet>["finalFocus"];
};

// 6-11 신고 사유. 보내는 동안에는 닫히지 않는다.
// 다 닫히면 시트가 내용을 치워 다시 열 때 빈 선택으로 시작한다
export function ReviewReportSheet({
  open,
  onOpenChange,
  pending,
  onSubmit,
  finalFocus,
}: ReviewReportSheetProps) {
  return (
    <BottomSheet
      title="리뷰 신고"
      open={open}
      finalFocus={finalFocus}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <ReportForm pending={pending} onSubmit={onSubmit} />
    </BottomSheet>
  );
}

function ReportForm({
  pending,
  onSubmit,
}: Pick<ReviewReportSheetProps, "pending" | "onSubmit">) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  return (
    <form
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason && !pending) onSubmit(reportRequest(reason, detail));
      }}
    >
      <RadioGroup
        aria-label="신고 사유"
        value={reason}
        onValueChange={(value) => setReason(value as ReportReason)}
        disabled={pending}
        className="flex flex-col"
      >
        {REPORT_REASONS.map(({ value, label }) => (
          <Radio key={value} value={value}>
            {label}
          </Radio>
        ))}
      </RadioGroup>
      {/* 6-11: "기타"를 고를 때만 설명칸이 나온다. 설명은 고르지 않아도 된다 */}
      {reason === "OTHER" && (
        <Textarea
          label="신고 설명"
          placeholder="어떤 점이 문제인지 적어 주세요 (선택)"
          maxLength={REPORT_DETAIL_MAX}
          value={detail}
          onValueChange={setDetail}
          disabled={pending}
          className="mt-2"
        />
      )}
      <Button
        type="submit"
        className="mt-5 w-full"
        disabled={reason === null || pending}
        focusableWhenDisabled
        aria-busy={pending}
      >
        {pending ? "신고하는 중" : "신고하기"}
      </Button>
    </form>
  );
}
