"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { cn } from "@/shared/lib/cn";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ArrowUpIcon } from "@/shared/ui/icon/icons/arrow-up";
import { ChevronRightIcon } from "@/shared/ui/icon/icons/chevron-right";
import { CloseIcon } from "@/shared/ui/icon/icons/close";
import { HistoryIcon } from "@/shared/ui/icon/icons/history";
import { InfoIcon } from "@/shared/ui/icon/icons/info";
import { PinIcon } from "@/shared/ui/icon/icons/pin";
import { SearchIcon } from "@/shared/ui/icon/icons/search";
import { SparkleIcon } from "@/shared/ui/icon/icons/sparkle";

import { highlightParts } from "../model/highlight";
import type { PlaceSuggestion } from "../model/place-types";
import { QUERY_MAX_LENGTH } from "../model/search-request";
import { actionFirst } from "../model/suggestions";
import { PlaceMeta } from "./place-parts";
import { useHere } from "./use-search-store";
import { useSuggest } from "./use-suggest";

// 후보를 받지 못했을 때 혼자 보이는 "이 조건으로 추천받기"(BE ACTION과 같은 문구)
const FALLBACK_ACTION: PlaceSuggestion = {
  type: "ACTION",
  label: "이 조건으로 추천받기",
};

type SearchBarProps = {
  // 새 검색. 공백뿐인 입력은 부르지 않는다
  onSearch: (input: string) => void;
  disabled?: boolean;
  // 최근 검색 시트를 연다
  onOpenRecent: () => void;
};

// 결과가 없을 때 화면 아래쪽에 떠 있는 검색창(5-01, 와이어프레임 Start, Typing).
// 입력하는 동안 자동완성 후보를 검색창 위에 띄우고 그 뒤 화면을 어둡게 가린다
export function SearchBar({
  onSearch,
  disabled,
  onOpenRecent,
}: SearchBarProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const suggest = useSuggest(input);
  // 후보를 받지 못해도 지금 입력으로 추천받기는 할 수 있다(5-E01)
  const suggestions = suggest.failed
    ? [FALLBACK_ACTION]
    : actionFirst(suggest.suggestions);
  const here = useHere();
  const empty = !input.trim();
  // 초점이 있고 입력이 있는 동안. 막을 누르면 초점이 풀려 닫힌다
  const typing = focused && !empty && !disabled;

  function submit() {
    if (!disabled && !empty) onSearch(input);
  }

  function pick(suggestion: PlaceSuggestion) {
    if (suggestion.type === "PLACE") {
      router.push(`/place?id=${suggestion.place.id}`);
    } else {
      submit();
    }
  }

  return (
    // 입력하는 동안은 검색창과 후보가 화면 가장자리에 더 붙는다(5-01)
    <div className={cn("relative flex flex-col gap-2", typing && "-mx-1")}>
      {typing && (
        <div
          aria-hidden
          data-testid="search-scrim"
          // 검색창보다 앞에 그려 주변 카드와 지도 버튼만 가린다
          onPointerDown={() => inputRef.current?.blur()}
          className="fixed inset-0 bg-scrim"
        />
      )}
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className={cn(
          "relative flex h-13 items-center gap-1 rounded-md bg-surface pr-1 pl-4 shadow-2",
          focused && "ring-2 ring-primary-strong",
          // 연결이 없을 때 꺼진 검색창(4-E02)
          disabled &&
            "bg-surface-sunken shadow-none inset-ring inset-ring-line",
        )}
      >
        {/* 돋보기는 입력 중에만 보인다(D-6, 5-01) */}
        {typing && <SearchIcon size="md" className="mr-1 text-icon" />}
        <input
          ref={inputRef}
          aria-label="장소 검색"
          placeholder="분위기나 목적을 말해 보세요"
          maxLength={QUERY_MAX_LENGTH}
          enterKeyHint="search"
          value={input}
          disabled={disabled}
          onChange={(event) => setInput(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="min-w-0 flex-1 bg-transparent text-body-md text-ink outline-none placeholder:text-ink-subtle"
        />
        {empty ? (
          !disabled && (
            <IconButton label="최근 검색" onClick={onOpenRecent}>
              <HistoryIcon size="md" className="text-icon" />
            </IconButton>
          )
        ) : (
          <IconButton
            label="입력 지우기"
            // 누르는 동안 초점이 검색창을 떠나지 않게 한다
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              setInput("");
              inputRef.current?.focus();
            }}
          >
            <CloseIcon size="md" className="text-ink-subtle" />
          </IconButton>
        )}
        <button
          type="submit"
          aria-label="추천받기"
          disabled={disabled || empty}
          className={cn(
            "flex size-11 items-center justify-center rounded-md bg-primary text-on-primary transition active:bg-primary-pressed disabled:bg-primary-disabled",
            disabled && "disabled:bg-line disabled:text-surface",
          )}
        >
          <ArrowUpIcon size="md" />
        </button>
      </form>
      {typing && suggestions.length > 0 && (
        <ul
          aria-label="검색 추천"
          // 화면 아래 검색창이라 후보는 검색창 바로 위에 띄운다
          className="absolute inset-x-0 bottom-full mb-2 flex flex-col divide-y divide-line overflow-hidden rounded-lg bg-surface shadow-3"
        >
          {suggestions.map((suggestion) => (
            <li
              key={
                suggestion.type === "PLACE"
                  ? suggestion.place.id
                  : suggestion.type
              }
            >
              <button
                type="button"
                // 누르는 동안 초점이 풀려 후보가 먼저 닫히지 않게 한다
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => pick(suggestion)}
                className={cn(
                  "flex min-h-15 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-sunken",
                  suggestion.type === "ACTION" && "bg-surface-warm",
                )}
              >
                {suggestion.type === "PLACE" ? (
                  <PlaceSuggestionRow
                    suggestion={suggestion}
                    input={input}
                    here={here}
                  />
                ) : (
                  <>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <SparkleIcon size="md" />
                    </span>
                    <span className="flex-1 text-title-sm text-ink">
                      {suggestion.label}
                    </span>
                    <ChevronRightIcon size="md" className="text-icon" />
                  </>
                )}
              </button>
            </li>
          ))}
          {suggest.failed && (
            <li className="flex min-h-14 items-center gap-3 px-4 py-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center text-ink-subtle">
                <InfoIcon size="md" />
              </span>
              <span className="text-body-sm text-ink-muted">
                지금은 후보를 보여 드릴 수 없어요
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function PlaceSuggestionRow({
  suggestion,
  input,
  here,
}: {
  suggestion: Extract<PlaceSuggestion, { type: "PLACE" }>;
  input: string;
  here: ReturnType<typeof useHere>;
}) {
  const { place, matchedMenu } = suggestion;
  return (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">
        <PinIcon size="md" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-body-md text-ink">
          <Highlighted text={place.name} input={input} />
        </span>
        <PlaceMeta
          place={place}
          here={here}
          extra={
            matchedMenu && (
              <>
                메뉴: <Highlighted text={matchedMenu} input={input} />
              </>
            )
          }
        />
      </span>
    </>
  );
}

function Highlighted({ text, input }: { text: string; input: string }) {
  return highlightParts(text, input).map(({ text: part, match }, index) =>
    match ? (
      <mark
        key={index}
        className="bg-transparent font-bold text-primary-strong"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
