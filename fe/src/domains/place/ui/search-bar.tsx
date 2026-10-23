"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { IconButton } from "@/shared/ui/button/icon-button";
import { ArrowUpIcon } from "@/shared/ui/icon/icons/arrow-up";
import { HistoryIcon } from "@/shared/ui/icon/icons/history";
import { SearchIcon } from "@/shared/ui/icon/icons/search";
import { SparklesIcon } from "@/shared/ui/icon/icons/sparkles";

import { highlightParts } from "../model/highlight";
import type { PlaceSuggestion } from "../model/place-types";
import { QUERY_MAX_LENGTH } from "../model/search-request";
import { PlaceMeta } from "./place-parts";
import { useHere } from "./use-search-store";
import { useSuggest } from "./use-suggest";

type SearchBarProps = {
  // 새 검색. 공백뿐인 입력은 부르지 않는다
  onSearch: (input: string) => void;
  disabled?: boolean;
  // 최근 검색 시트를 연다
  onOpenRecent: () => void;
  // 검색창 위 한 줄(오류 문구)
  message?: ReactNode;
};

// 결과가 없을 때 화면 아래쪽에 떠 있는 검색창(5-01, 와이어프레임 Start). 입력하는 동안 자동완성 후보를 검색창 위에 보여 준다
export function SearchBar({
  onSearch,
  disabled,
  onOpenRecent,
  message,
}: SearchBarProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const suggestions = useSuggest(input);
  const here = useHere();
  const empty = !input.trim();

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
    <div className="relative flex flex-col gap-2">
      {message}
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex h-13 items-center gap-1 rounded-md bg-surface pr-1 pl-3.5 shadow-2"
      >
        <SearchIcon size="md" className="mr-1 text-icon" />
        <input
          aria-label="장소 검색"
          placeholder="분위기나 목적을 말해 보세요"
          maxLength={QUERY_MAX_LENGTH}
          enterKeyHint="search"
          value={input}
          disabled={disabled}
          onChange={(event) => setInput(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-body-md text-ink outline-none placeholder:text-ink-subtle"
        />
        <IconButton label="최근 검색" onClick={onOpenRecent}>
          <HistoryIcon size="md" className="text-icon" />
        </IconButton>
        <button
          type="submit"
          aria-label="추천받기"
          disabled={disabled || empty}
          className="flex size-11 items-center justify-center rounded-md bg-primary text-on-primary transition active:bg-primary-pressed disabled:bg-primary-disabled"
        >
          <ArrowUpIcon size="md" />
        </button>
      </form>
      {suggestions.length > 0 && !disabled && (
        <ul
          aria-label="검색 추천"
          // 화면 아래 검색창이라 후보는 검색창 바로 위에 띄운다
          className="absolute inset-x-0 bottom-full mb-2 flex flex-col overflow-hidden rounded-md bg-surface py-1 shadow-2"
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
                onClick={() => pick(suggestion)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-sunken"
              >
                {suggestion.type === "PLACE" ? (
                  <PlaceSuggestionRow
                    suggestion={suggestion}
                    input={input}
                    here={here}
                  />
                ) : (
                  <>
                    <SparklesIcon size="md" className="text-primary" />
                    <span className="text-label-md text-primary-strong">
                      {suggestion.label}
                    </span>
                  </>
                )}
              </button>
            </li>
          ))}
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
      <SearchIcon size="md" className="text-icon-subtle" />
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
        className="bg-transparent font-semibold text-primary-strong"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
