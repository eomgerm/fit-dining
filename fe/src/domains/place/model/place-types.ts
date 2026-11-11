// BE place DTO(kr.co.fitdining.api.place.dto)의 TS 타입. ?는 BE가 null이면 생략하는 선택 필드다

export type CategoryGroup = "RESTAURANT" | "CAFE" | "BAR";
// 장소에서 가장 가까운 역. BE PlaceSummary.Station과 코드와 순서가 같아야 한다
// (ai/tests/match/test_station_contract.py가 견준다)
export type Station =
  | "GANGNAM"
  | "YEOKSAM"
  | "SEOLLEUNG"
  | "SINNONHYEON"
  | "NONHYEON"
  | "EONJU"
  | "HANTI"
  | "SAMSEONG_JUNGANG"
  | "GYODAE"
  | "SEONJEONGNEUNG"
  | "SAMSEONG"
  | "HAKDONG"
  | "SAPYEONG"
  | "DOGOK"
  | "BONGEUNSA"
  | "YUSEONG_ONCHEON"
  | "GUAM"
  | "NOEUN"
  | "BANSEOK"
  | "DAEJEON_WORLDCUP_STADIUM"
  | "JIJOK"
  | "GAPCHEON"
  | "HYEONCHUNGWON"
  | "WOLPYEONG"
  | "GUMI"
  | "SAGOK"
  | "JEONPO"
  | "SEOMYEON"
  | "GEUMNYEONSAN"
  | "SASANG"
  | "HADAN"
  | "GWANGAN"
  | "NAMPO"
  | "DONGNAE";
export type OpenStatus =
  "OPEN" | "CLOSING_SOON" | "BREAK" | "CLOSED" | "UNKNOWN";
export type EvidenceSource = "REQUEST" | "PREFERENCE";
export type DayCode = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export type LatLng = { lat: number; lng: number };

export type PlaceSummary = LatLng & {
  id: number;
  name: string;
  categoryGroup: CategoryGroup;
  // 가까운 역이 없는 장소는 BE가 생략한다
  station?: Station;
  thumbnailUrl?: string;
};

export type PlaceSuggestion =
  | { type: "PLACE"; place: PlaceSummary; matchedMenu?: string }
  | { type: "ACTION"; label: string };

// 검색 대상 지역(지도에 보이는 사각형). 기기 위치가 아니다
export type MapBounds = {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
};

// 홈 주변 카드 요청(POST /places/nearby). 영역은 정규화한 값이다(spec 70번, 71번)
export type NearbyRequest = {
  mapBounds: MapBounds;
};

// BE와 FE가 해석하지 않고 다음 후속 요청에 그대로 돌려보내는 값
export type SearchConditions = Record<string, unknown>;

// 화면 상태와 검색 기록에 남는 요청. 비회원 답(preferences)은 보낼 때만 붙이므로 여기에 없다(place-ai-search D-16)
export type PlaceSearchRequest = {
  query: string;
  previousConditions?: SearchConditions;
  mapBounds?: MapBounds;
  cursor?: string;
};

// "이 지역에서 검색"(POST /places/search/region). BE는 conditions를 선택으로 받지만 FE는 늘 보낸다(D-109)
export type RegionSearchRequest = {
  query: string;
  conditions: SearchConditions;
  mapBounds: MapBounds;
  cursor?: string;
};

// 요청 기록 항목의 실행 요청. 항목 종류(new·followUp, region)가 API를 고른다
export type SearchRequest = PlaceSearchRequest | RegionSearchRequest;

// 비회원이 기기에 저장한 온보딩 답. 가입의 preferences와 같은 모양이다
export type SearchPreferences = {
  mood: string | null;
  priorities: string[];
  purposes: string[];
  tastes: {
    polarity: "LIKE" | "DISLIKE";
    label: string;
    code?: string | null;
    vector?: number[] | null;
  }[];
};

export type ReasonTag = { source: EvidenceSource; label: string };

export type Reason = {
  title: string;
  tags: ReasonTag[];
  quote?: string;
  quoteSource?: string;
};

// 상세가 보이는 핏 점수, 추천 이유, 주의점. 검색 카드가 주고, 모임에서 열면 모임 결과의 카드가 준다(모임 D-22)
export type PlaceFit = Pick<PlaceCard, "score" | "reasons" | "caution">;

export type ScoreItem = {
  source: EvidenceSource;
  label: string;
  matched: boolean;
  evidenceCount: number;
};

export type PlaceCard = {
  place: PlaceSummary;
  // AI 엔진이 붙기 전에는 BE가 생략한다. 없으면 핏 점수 영역을 그리지 않는다
  score?: number;
  labels: string[];
  caution?: string;
  openStatus: OpenStatus;
  reasons: Reason[];
  scoreItems: ScoreItem[];
};

export type PlaceSearchResponse = {
  conditions: SearchConditions;
  nearby: boolean;
  totalCount: number;
  items: PlaceCard[];
  nextCursor?: string;
  emptyReason?: { cause: string; suggestion: string };
  changeSummary?: string;
};

// 시각은 HH:mm. close가 open과 같거나 이르면 다음 날 마감이고, 24시간 영업은 둘 다 "00:00"이다.
// 휴무일은 closed가 true이고, 영업시간 정보가 없는 요일은 closed가 false인데 open과 close가 없다
export type Hours = {
  dayOfWeek: DayCode;
  open?: string;
  close?: string;
  breaks: Break[];
  lastOrders: string[];
  closed: boolean;
};

export type Break = { start: string; end: string };

export type Menu = {
  category?: string;
  name: string;
  description?: string;
  // 정가일 때만 있다. 화면의 가격은 priceText(원문)다
  price?: number;
  priceText?: string;
  labels: string[];
  representative: boolean;
  photoUrl?: string;
};

// line은 네이버 값 그대로("2", "신분당")
export type Subway = {
  station: string;
  line?: string;
  exit?: string;
  walkMinutes?: number;
};

export type Parking = { free?: boolean; note?: string; valet: boolean };
export type Pet = { allowed?: boolean; note?: string };
export type Corkage = { allowed?: boolean; note?: string };
export type Seat = { name: string; description?: string };

export type Broadcast = {
  channel?: string;
  program?: string;
  episode?: string;
  airedOn?: string;
  menu?: string;
};

export type PlaceDetail = {
  place: PlaceSummary;
  address: string;
  tags: string[];
  photos: string[];
  phone?: string;
  website?: string;
  openStatus: OpenStatus;
  hours: Hours[];
  closedDayNote?: string;
  menus: Menu[];
  // 네이버 시설 이름 그대로
  facilities: string[];
  // 도보 거리순
  subways: Subway[];
  directions?: string;
  parking?: Parking;
  pet?: Pet;
  noKidsZone: boolean;
  corkage?: Corkage;
  bookingUrl?: string;
  seats: Seat[];
  description?: string;
  paymentMethods: string[];
  broadcasts: Broadcast[];
  extraLinks: string[];
};
