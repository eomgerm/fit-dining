"use client";
import { Button } from "@/shared/ui/button/button";
import { TermsModal } from "./terms-modal";
import { Checkbox } from "@/shared/ui/form/checkbox";
import { BottomSheet } from "@/shared/ui/overlay/bottom-sheet";
import type { Dispatch, SetStateAction } from "react";
export type Agreements = {
  ageOver14: boolean;
  terms: boolean;
  privacy: boolean;
};
const agreementLabels = {
  ageOver14: "만 14세 이상이에요",
  terms: "서비스 이용약관",
  privacy: "개인정보 수집·이용",
};
export function SignupTerms({
  open,
  setOpen,
  busy,
  agreements,
  setAgreements,
  start,
}: {
  open: boolean;
  setOpen: (value: boolean) => void;
  busy: boolean;
  agreements: Agreements;
  setAgreements: Dispatch<SetStateAction<Agreements>>;
  start: () => void;
}) {
  const allAgreed = Object.values(agreements).every(Boolean);
  return (
    <BottomSheet
      title="약관에 동의하고 시작해요"
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <p className="mb-4 text-body-sm text-ink-muted">
        핏다이닝을 쓰려면 아래 약관에 동의해 주세요.
      </p>
      <Checkbox
        checked={allAgreed}
        indeterminate={!allAgreed && Object.values(agreements).some(Boolean)}
        disabled={busy}
        onCheckedChange={(checked) =>
          setAgreements({
            ageOver14: checked,
            terms: checked,
            privacy: checked,
          })
        }
      >
        <span className="font-semibold">전체 동의</span>
      </Checkbox>
      <div className="my-3" />
      {(Object.keys(agreementLabels) as (keyof typeof agreements)[]).map(
        (field) => (
          <div key={field} className="flex items-center justify-between gap-2">
            <Checkbox
              checked={agreements[field]}
              disabled={busy}
              onCheckedChange={(checked) =>
                setAgreements((previous) => ({
                  ...previous,
                  [field]: checked,
                }))
              }
            >
              <span className="text-body-md">
                <span className="mr-2 font-semibold text-primary-strong">
                  필수
                </span>
                {agreementLabels[field]}
              </span>
            </Checkbox>
            {field !== "ageOver14" && (
              <TermsModal kind={field} disabled={busy}>
                보기
              </TermsModal>
            )}
          </div>
        ),
      )}
      <Button
        className="mt-5 w-full"
        disabled={!allAgreed || busy}
        onClick={start}
      >
        {busy ? "가입 중" : "동의하고 시작하기"}
      </Button>
    </BottomSheet>
  );
}
