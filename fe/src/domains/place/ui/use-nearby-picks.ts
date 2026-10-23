import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { placeQueries } from "../api/place-queries";
import { pickNearby, YEOKSAM_STATION } from "../model/nearby";
import type { PlaceSearchResponse } from "../model/place-types";
import { searchStore } from "../model/search-store";
import { useHere } from "./use-search-store";

// 장소별 최근 카드에 이미 넣은 응답. 상세에서 돌아와 다시 그려질 때 더 최근 검색의 카드를 덮어쓰지 않게 한다
const recorded = new WeakSet<PlaceSearchResponse>();

// 첫 화면 주변 카드. 기기 위치가 있으면 그 위치, 없으면 역삼역을 기준 지점으로 거른다
export function useNearbyPicks(enabled: boolean) {
  const here = useHere();
  const { data } = useQuery({ ...placeQueries.nearby(), enabled });

  // 상세 화면이 핏 점수와 추천 이유를 쓰도록 받은 카드를 둔다
  useEffect(() => {
    if (!data || recorded.has(data)) return;
    recorded.add(data);
    searchStore.recordCards(data.items);
  }, [data]);

  const origin = here ?? YEOKSAM_STATION;
  return {
    cards: data ? pickNearby(data.items, origin) : [],
    origin,
    // 기준 지점이 역삼역이면 거리 앞에 "역삼역"을 붙인다
    originLabel: here ? undefined : "역삼역",
  };
}
