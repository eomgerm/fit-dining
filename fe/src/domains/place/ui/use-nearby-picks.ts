import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { showsAiFallback } from "../api/place-api";
import { placeQueries } from "../api/place-queries";
import type { MapBounds, PlaceSearchResponse } from "../model/place-types";
import { searchStore } from "../model/search-store";

// 장소별 최근 카드에 이미 넣은 응답. 상세에서 돌아와 다시 그려질 때 더 최근 검색의 카드를 덮어쓰지 않게 한다
const recorded = new WeakSet<PlaceSearchResponse>();

// 영역이 정해지기 전에 쓰는 자리 key. enabled가 꺼져 있어 받지 않는다
const NO_AREA: MapBounds = { swLat: 0, swLng: 0, neLat: 0, neLng: 0 };

// 첫 화면 주변 카드. 확정한 홈 영역(정규화)으로 /places/nearby를 받고 서버 순서 그대로 보인다(spec 54번, 70번).
// 영역이 없으면(지금 홈 진입의 영역을 확정하기 전) 이전 영역의 카드, 빈 안내, 오류를 돌려주지 않는다(spec 73번)
export function useNearbyPicks(enabled: boolean, area: MapBounds | undefined) {
  const { data, error, refetch } = useQuery({
    ...placeQueries.nearby(area ?? NO_AREA),
    enabled: enabled && area !== undefined,
  });
  const current = area ? data : undefined;

  // 상세 화면이 핏 점수와 추천 이유를 쓰도록 받은 카드를 둔다
  useEffect(() => {
    if (!current || recorded.has(current)) return;
    recorded.add(current);
    searchStore.recordCards(current.items);
  }, [current]);

  const failure = area && !current ? error : null;
  return {
    cards: current?.items ?? [],
    // 영역을 확정하기 전이거나, 그 영역의 카드를 아직 받지 못했다(받는 중). skeleton을 보인다
    loading: !current && !failure,
    // 영역 안에 장소가 없을 때의 이유(spec 75번)
    emptyReason:
      current && current.items.length === 0 ? current.emptyReason : undefined,
    // BE가 AI 대신 지도 영역 안 장소를 준 결과라 카드 위에 안내를 띄운다
    aiFallback: showsAiFallback(current),
    // 받은 카드가 없을 때의 실패만 알린다. 다시 받다가 실패해도 이전 카드는 그대로 보인다
    error: failure,
    retry: () => void refetch(),
  };
}
