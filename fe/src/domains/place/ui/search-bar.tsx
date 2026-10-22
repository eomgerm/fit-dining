"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { IconButton } from "@/shared/ui/button/icon-button";
import { RequestHistoryIcon } from "@/shared/ui/icon/icons/request-history";
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
  // 기록이 있을 때만 요청 기록 버튼을 보인다
  onOpenHistory?: () => void;
  // 검색창 아래 한 줄(오류 문구)
  message?: ReactNode;
};

// 결과가 없을 때 화면 위쪽의 검색창(5-01). 입력하는 동안 자동완성 후보를 보여 준다
export function SearchBar({
  onSearch,
  disabled,
  onOpenHistory,
  message,
}: SearchBarProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const suggestions = useSuggest(input);
  const here = useHere();

  function submit() {
    if (!disabled && input.trim()) onSearch(input);
  }

  function pick(suggestion: PlaceSuggestion) {
    if (suggestion.type === "PLACE") {
      router.push(`/place?id=${suggestion.place.id}`);
    } else {
      submit();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex h-13 items-center gap-2 rounded-md bg-surface pr-1 pl-3.5 shadow-2"
      >
        <SearchIcon size="md" className="text-icon" />
        <input
          aria-label="장소 검색"
          placeholder="가고 싶은 곳을 말해 보세요"
          maxLength={QUERY_MAX_LENGTH}
          enterKeyHint="search"
          value={input}
          disabled={disabled}
          onChange={(event) => setInput(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-body-md text-ink outline-none placeholder:text-ink-subtle"
        />
        {onOpenHistory && (
          <IconButton label="요청 기록" onClick={onOpenHistory}>
            <RequestHistoryIcon size="md" className="text-icon" />
          </IconButton>
        )}
      </form>
      {message}
      {suggestions.length > 0 && !disabled && (
        <ul
          aria-label="검색 추천"
          className="flex flex-col overflow-hidden rounded-md bg-surface py-1 shadow-2"
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
