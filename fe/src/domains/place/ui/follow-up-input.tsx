"use client";

import { useState, type Ref } from "react";

import { cn } from "@/shared/lib/cn";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ArrowUpIcon } from "@/shared/ui/icon/icons/arrow-up";
import { HistoryIcon } from "@/shared/ui/icon/icons/history";

import { QUERY_MAX_LENGTH } from "../model/search-request";

type FollowUpInputProps = {
  inputRef?: Ref<HTMLInputElement>;
  // 후속 조건. 공백뿐인 입력은 부르지 않는다. 보낸 뒤 입력을 비운다
  onSubmit: (input: string) => void;
  // 최근 검색 시트를 연다
  onOpenRecent: () => void;
  disabled?: boolean;
};

// 결과 패널 아래 입력창(5-04). 자동완성 없이 항상 후속 조건으로 보낸다
export function FollowUpInput({
  inputRef,
  onSubmit,
  onOpenRecent,
  disabled,
}: FollowUpInputProps) {
  const [input, setInput] = useState("");
  const empty = !input.trim();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || empty) return;
        onSubmit(input);
        setInput("");
      }}
      // 검색 중에는 흐리게 막고 최근 검색 버튼을 숨긴다(와이어프레임 Loading)
      className={cn(
        "flex h-13 items-center gap-1 rounded-md border border-line-strong bg-surface pr-1 pl-4",
        disabled && "opacity-60",
      )}
    >
      <input
        ref={inputRef}
        aria-label="후속 조건"
        placeholder="조건을 더 말해 보세요"
        maxLength={QUERY_MAX_LENGTH}
        enterKeyHint="send"
        value={input}
        disabled={disabled}
        onChange={(event) => setInput(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-body-md text-ink outline-none placeholder:text-ink-subtle"
      />
      {!disabled && (
        <IconButton label="최근 검색" onClick={onOpenRecent}>
          <HistoryIcon size="md" className="text-icon" />
        </IconButton>
      )}
      <button
        type="submit"
        aria-label="보내기"
        disabled={disabled || empty}
        className="flex size-11 items-center justify-center rounded-md bg-primary text-on-primary transition active:bg-primary-pressed disabled:bg-primary-disabled"
      >
        <ArrowUpIcon size="md" />
      </button>
    </form>
  );
}
