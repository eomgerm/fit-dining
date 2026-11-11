"use client";

import { useEffect, useId, useState } from "react";

import { isApiError } from "@/shared/api/api-error";
import { cn } from "@/shared/lib/cn";
import { PinIcon } from "@/shared/ui/icon/icons/pin";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";

import { useAreaSearch, type WithSession } from "../api/queries";
import { areaLabel, type MeetupArea } from "../model/meetup";

const DEBOUNCE_MS = 250;

function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

// 모임 지역 칸(모임장 3). 넣은 말로 장소가 있는 역·동을 찾아 고르게 하고, 찾는 곳이 없으면 칸 아래에 알린다
// (화면 예시 상태 모음 1 "장소가 없는 지역"). 이름이 목록의 한 곳과 꼭 같으면 바로 고른다
export function AreaField({
  value,
  onChange,
  withSession,
  onUnauthorized,
}: {
  value: MeetupArea | null;
  onChange: (area: MeetupArea | null) => void;
  withSession: WithSession;
  onUnauthorized: () => void;
}) {
  const id = useId();
  const listId = `${id}-options`;
  const [text, setText] = useState(value ? areaLabel(value) : "");
  const [open, setOpen] = useState(false);
  const typed = text.trim();
  const query = useDebounced(typed);
  const search = useAreaSearch(value ? "" : query, withSession);
  const items = search.data?.items ?? [];
  const settled = !value && query === typed && typed.length > 0;
  const noPlaces = settled && search.isSuccess && items.length === 0;
  const failed = settled && search.isError;

  useEffect(() => {
    if (isApiError(search.error) && search.error.status === 401) {
      onUnauthorized();
    }
  }, [search.error, onUnauthorized]);

  // 고르면 목록은 값이 있어 저절로 닫힌다
  useEffect(() => {
    if (value || !search.data) return;
    const exact = search.data.items.find((area) => areaLabel(area) === typed);
    if (exact) onChange(exact);
  }, [search.data, typed, value, onChange]);

  const choose = (area: MeetupArea) => {
    onChange(area);
    setText(areaLabel(area));
    setOpen(false);
  };

  const showList = open && !value && settled && items.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-label-md">
        지역 <span className="text-primary">필수</span>
      </label>
      <div className="relative">
        <div
          className={cn(
            "flex h-13 items-center gap-2 rounded-md border bg-surface px-3.5",
            noPlaces
              ? "border-1.5 border-danger"
              : "border-line-strong focus-within:border-1.5 focus-within:border-primary-strong",
          )}
        >
          <PinIcon size="md" className="shrink-0 text-icon-subtle" />
          <input
            id={id}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-invalid={noPlaces || undefined}
            autoComplete="off"
            enterKeyHint="search"
            placeholder="예: 선릉역, 역삼동"
            value={text}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onChange={(event) => {
              setText(event.target.value);
              setOpen(true);
              if (value) onChange(null);
            }}
            className="min-w-0 flex-1 bg-transparent text-body-md text-ink outline-none placeholder:text-ink-subtle"
          />
        </div>
        {showList && (
          <ul
            id={listId}
            role="listbox"
            aria-label="찾은 지역"
            className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-line bg-surface shadow-2"
          >
            {items.map((area) => (
              <li
                key={`${area.kind}:${area.name}`}
                role="option"
                aria-selected={false}
                className="flex h-12 cursor-pointer items-center gap-2 px-4 text-body-md active:bg-surface-sunken"
                // 입력칸이 먼저 포커스를 잃어 목록이 닫히지 않게 누르는 순간에 고른다
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(area);
                }}
              >
                <PinIcon size="sm" className="shrink-0 text-icon-subtle" />
                {areaLabel(area)}
              </li>
            ))}
          </ul>
        )}
      </div>
      {noPlaces ? (
        <p className="flex items-start gap-1.5 text-caption-md text-danger">
          <WarningIcon size="sm" className="mt-px shrink-0" />
          {typed} 근처에는 아직 장소가 없어요. 다른 역이나 동을 넣어 주세요.
        </p>
      ) : failed ? (
        <p className="flex items-start gap-1.5 text-caption-md text-danger">
          <WarningIcon size="sm" className="mt-px shrink-0" />
          지역을 찾지 못했어요. 잠시 뒤 다시 넣어 주세요.
        </p>
      ) : (
        <p className="text-caption-sm text-ink-subtle">
          역이나 동 이름을 넣어 주세요
        </p>
      )}
    </div>
  );
}
