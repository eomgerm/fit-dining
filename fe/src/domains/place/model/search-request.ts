import type {
  LatLng,
  MapBounds,
  NearbyRequest,
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

// 첫 화면 주변 카드 요청(POST /places/nearby). 정규화한 영역 객체 하나만 담는다.
// 문장("근처 맛집")은 BE가 채우고 기기 좌표는 담지 않는다(spec 70번)
export function nearbyRequest(mapBounds: MapBounds): NearbyRequest {
  return { mapBounds };
}

// 격자 위의 값이 부동소수 오차로 한 칸 아래·위로 밀리지 않게 하는 여유(0.001도의 1/10000)
const GRID_EPSILON = 1e-4;
const toGrid = (value: number) => value * 1000;
// -0은 0으로 둔다(JSON과 key 비교에서 같게)
const fromGrid = (steps: number) => steps / 1000 + 0;

// 홈 영역 정규화(spec 71번). 네 좌표를 0.001도에서 가까운 값으로 반올림하고(가운데는 큰 쪽),
// 반올림으로 폭이 0이 된 축만 원본 SW를 내림, NE를 올림한다. cache key와 요청 본문에 이 결과를 그대로 쓴다
export function normalizeBounds(bounds: MapBounds): MapBounds {
  const axis = (sw: number, ne: number) => {
    const low = Math.round(toGrid(sw));
    const high = Math.round(toGrid(ne));
    if (low !== high) return [fromGrid(low), fromGrid(high)];
    const floor = Math.floor(toGrid(sw) + GRID_EPSILON);
    const ceil = Math.ceil(toGrid(ne) - GRID_EPSILON);
    return [fromGrid(floor), fromGrid(ceil > floor ? ceil : floor + 1)];
  };
  const [swLat, neLat] = axis(bounds.swLat, bounds.neLat);
  const [swLng, neLng] = axis(bounds.swLng, bounds.neLng);
  return { swLat, swLng, neLat, neLng };
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
