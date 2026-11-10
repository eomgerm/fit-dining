import type {
  LatLng,
  MapBounds,
  PlaceSearchRequest,
  RegionSearchRequest,
  SearchConditions,
  SearchRequest,
} from "./place-types";
import type { EntryKind } from "./search-store";

// 다음 검색 요청 본문을 만든다. 기기 위치 좌표는 어떤 본문에도 넣지 않는다.
// 검색 대상 지역(mapBounds)만 예외다(D-109)

// 검색 입력의 최대 길이(UTF-16 문자 수). BE의 @Size(max = 200)와 같다
export const QUERY_MAX_LENGTH = 200;

export type LocationState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "ok"; here: LatLng }
  | { status: "failed" };

// 새 검색. 지도 영역은 보내는 순간 사용자에게 보이는 영역이다(spec 64번)
export function newSearchRequest(
  input: string,
  mapBounds?: MapBounds,
): PlaceSearchRequest {
  return { query: input.trim(), ...(mapBounds && { mapBounds }) };
}

// 기준 요청 첫 페이지의 conditions를 빈 객체여도 그대로 돌려보낸다. 지도 영역은 지금 지도가 아니라
// 기준 항목 실행 요청의 영역을 잇는다. 기준에 없거나 실행 불가 기록이면(요청 없음) 담지 않는다(spec 64번)
export function followUpRequest(
  input: string,
  base: { conditions: SearchConditions; request?: SearchRequest },
): PlaceSearchRequest {
  return {
    ...newSearchRequest(input, base.request?.mapBounds),
    previousConditions: base.conditions,
  };
}

// 첫 화면 주변 카드의 고정 문장. "근처"가 있어 근처 응답(후보 전체, 커서 없음)이 온다
export const NEARBY_QUERY = "근처 맛집";

// 첫 화면 주변 카드 요청. 문장만 보내고 좌표도 지도 영역도 담지 않는다
export function nearbyRequest(): PlaceSearchRequest {
  return { query: NEARBY_QUERY };
}

export function nextPageRequest<T extends SearchRequest>(
  first: T,
  cursor: string,
): T {
  return { ...first, cursor };
}

// "이 지역에서 검색". 보던 항목의 문장과 첫 페이지 응답 conditions에 지도 영역을 담는다.
// previousConditions는 보내지 않는다. 지역을 지우는 일은 AI가 한다(spec 66번)
export function regionRequest(
  viewing: { sentence: string; conditions: SearchConditions },
  mapBounds: MapBounds,
): RegionSearchRequest {
  return { query: viewing.sentence, conditions: viewing.conditions, mapBounds };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BOUND_KEYS = ["swLat", "swLng", "neLat", "neLng"] as const;

// 네 값이 모두 유한한 숫자면 그 네 값만 옮긴다
function finiteBounds(value: unknown): MapBounds | undefined {
  if (!isObject(value)) return;
  const [swLat, swLng, neLat, neLng] = BOUND_KEYS.map((key) => value[key]);
  if (
    ![swLat, swLng, neLat, neLng].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    )
  ) {
    return;
  }
  return { swLat, swLng, neLat, neLng } as MapBounds;
}

// region API가 받는 영역이면 그 네 값. BE 검증(place-ai-search AC-29)과 같고 경계값은 받는다
function regionBounds(value: unknown): MapBounds | undefined {
  const bounds = finiteBounds(value);
  if (!bounds) return;
  const { swLat, swLng, neLat, neLng } = bounds;
  const lat = (n: number) => n >= -90 && n <= 90;
  const lng = (n: number) => n >= -180 && n <= 180;
  const valid =
    lat(swLat) &&
    lat(neLat) &&
    lng(swLng) &&
    lng(neLng) &&
    swLat < neLat &&
    swLng < neLng;
  return valid ? bounds : undefined;
}

export function isValidBounds(value: unknown) {
  return regionBounds(value) !== undefined;
}

// 저장된 thread turn의 요청. 형식 검사는 query만 보므로 나머지 값은 무엇이든 올 수 있다.
// region은 새 모양 {query, conditions?, mapBounds}이거나 옛 모양 {query, previousConditions?, mapBounds?}다
export type StoredSearchRequest = { query: string; [key: string]: unknown };

// 저장된 기록을 실행 요청으로 바꾼다. 저장된 값은 바꾸지 않고 아는 필드만 옮긴다.
// region은 응답 conditions로 대신하고 영역이 규칙에 어긋나면 실행 불가(undefined)다(spec 67번)
export function runnableRequest(turn: {
  kind: EntryKind;
  request: StoredSearchRequest;
  response: { conditions: SearchConditions };
}): SearchRequest | undefined {
  const { kind, request, response } = turn;
  if (kind === "region") {
    const mapBounds = regionBounds(request.mapBounds);
    if (!mapBounds) return;
    return {
      query: request.query,
      conditions: isObject(request.conditions)
        ? request.conditions
        : response.conditions,
      mapBounds,
    };
  }
  const mapBounds = finiteBounds(request.mapBounds);
  return {
    query: request.query,
    ...(isObject(request.previousConditions) && {
      previousConditions: request.previousConditions,
    }),
    ...(mapBounds && { mapBounds }),
  };
}
