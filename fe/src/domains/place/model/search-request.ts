import type {
  LatLng,
  MapBounds,
  PlaceSearchRequest,
  SearchConditions,
} from "./place-types";

// 다음 검색 요청 본문을 만든다. 기기 위치 좌표는 어떤 본문에도 넣지 않는다.
// 검색 대상 지역(mapBounds)만 예외다

// 검색 입력의 최대 길이(UTF-16 문자 수). BE의 @Size(max = 200)와 같다
export const QUERY_MAX_LENGTH = 200;

export type LocationState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "ok"; here: LatLng }
  | { status: "failed" };

export function newSearchRequest(
  input: string,
  mapBounds?: MapBounds,
): PlaceSearchRequest {
  return { query: input.trim(), ...(mapBounds && { mapBounds }) };
}

// 기준 요청 첫 페이지의 conditions를 빈 객체여도 그대로 돌려보낸다
export function followUpRequest(
  input: string,
  base: { conditions: SearchConditions },
  mapBounds?: MapBounds,
): PlaceSearchRequest {
  return {
    ...newSearchRequest(input, mapBounds),
    previousConditions: base.conditions,
  };
}

export function nextPageRequest(
  first: PlaceSearchRequest,
  cursor: string,
): PlaceSearchRequest {
  return { ...first, cursor };
}

// "이 지역에서 검색". 지금 보는 요청을 지도 영역만 바꿔 첫 페이지부터 다시 보낸다
export function regionRequest(
  viewing: PlaceSearchRequest,
  mapBounds: MapBounds,
): PlaceSearchRequest {
  const { query, preferences, previousConditions } = viewing;
  return {
    query,
    ...(preferences && { preferences }),
    ...(previousConditions && { previousConditions }),
    mapBounds,
  };
}

// 첫 페이지 요청에 현재 지도 영역을 담을지. 지역을 고정했거나 위치를 얻지 못한 것이 확인된 뒤에만 담는다
export function shouldSendMapBounds({
  regionLocked,
  location,
}: {
  regionLocked: boolean;
  location: LocationState;
}) {
  return regionLocked || location.status === "failed";
}
