import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { placeQueries } from "../api/place-queries";
import type { PlaceSuggestion } from "../model/place-types";

const DEBOUNCE_MS = 300;

// 입력이 멈추고 300ms 뒤의 값(앞뒤 공백 제거)을 쿼리 키로 쓴다.
// 키가 바뀌면 이전 쿼리의 관찰자가 사라져 Query가 그 요청을 signal로 중단하고,
// 지금 키가 아닌 응답은 화면에 쓰지 않는다. 입력이 비면 기다리지 않고 비운다.
// failed는 지금 키의 요청이 실패했을 때다(5-E01)
export function useSuggest(input: string): {
  suggestions: PlaceSuggestion[];
  failed: boolean;
} {
  const trimmed = input.trim();
  const [debounced, setDebounced] = useState(trimmed);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebounced(trimmed),
      trimmed ? DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [trimmed]);

  const key = trimmed ? debounced : "";
  const { data, isError } = useQuery({
    ...placeQueries.suggest(key),
    enabled: key !== "",
  });
  return {
    suggestions: (key && data) || [],
    failed: key !== "" && isError,
  };
}
