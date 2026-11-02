"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { termsContent, type TermsKind } from "../model/terms-content";
import { Button } from "@/shared/ui/button/button";

// Base UI가 중첩 팝업의 포커스와 Esc를 관리하도록 루트를 부모 팝업 안에 둔다.
export function TermsModal({
  kind,
  disabled,
  children,
  variant = "view",
}: {
  kind: TermsKind;
  disabled?: boolean;
  children: ReactNode;
  variant?: "view" | "caption";
}) {
  const content = termsContent[kind];
  return (
    <Dialog.Root>
      <Dialog.Trigger
        disabled={disabled}
        className={
          variant === "caption"
            ? "inline text-caption-sm font-normal text-ink-muted underline underline-offset-2"
            : "inline-flex min-h-11 min-w-11 items-center justify-center text-body-sm font-normal text-ink-muted"
        }
      >
        {children}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-scrim transition-opacity duration-240 ease-enter data-ending-style:opacity-0 data-ending-style:duration-220 data-ending-style:ease-exit data-starting-style:opacity-0 motion-reduce:duration-120 motion-reduce:data-ending-style:duration-120" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 flex max-h-4/5 w-75 -translate-1/2 flex-col gap-3 rounded-xl bg-surface px-5 pt-6 pb-5 text-ink shadow-3 transition delay-80 duration-240 ease-enter data-ending-style:scale-96 data-ending-style:opacity-0 data-ending-style:delay-0 data-ending-style:duration-220 data-ending-style:ease-exit data-starting-style:scale-96 data-starting-style:opacity-0 motion-reduce:transition-opacity motion-reduce:delay-0 motion-reduce:duration-120 motion-reduce:data-ending-style:scale-100 motion-reduce:data-ending-style:duration-120 motion-reduce:data-starting-style:scale-100">
          <Dialog.Title className="shrink-0 text-title-sm">
            {content.title}
          </Dialog.Title>
          <div
            className="min-h-0 space-y-3 overflow-y-auto overscroll-contain"
            tabIndex={0}
            role="region"
            aria-label={`${content.title} 본문`}
          >
            <p className="text-body-md whitespace-pre-wrap">{content.body}</p>
            <p className="text-body-sm text-ink-muted">
              시행일:{" "}
              <time dateTime={content.effectiveDate}>
                {content.effectiveDate}
              </time>
            </p>
          </div>
          <Dialog.Close render={<Button />} className="shrink-0">
            닫기
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
