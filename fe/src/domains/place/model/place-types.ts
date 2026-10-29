// BE place DTO(kr.co.fitdining.api.place.dto)의 TS 타입. ?는 BE가 null이면 생략하는 선택 필드다

export type CategoryGroup = "RESTAURANT" | "CAFE" | "BAR";
export type Station = "GANGNAM" | "YEOKSAM" | "SEOLLEUNG";
export type OpenStatus =
  "OPEN" | "CLOSING_SOON" | "BREAK" | "CLOSED" | "UNKNOWN";
export type EvidenceSource = "REQUEST" | "PREFERENCE";
export type DayCode = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export type LatLng = { lat: number; lng: number };

export type PlaceSummary = LatLng & {
  id: number;
  name: string;
  categoryGroup: CategoryGroup;
  station: Station;
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

// BE와 FE가 해석하지 않고 다음 후속 요청에 그대로 돌려보내는 값
export type SearchConditions = Record<string, unknown>;

export type PlaceSearchRequest = {
  query: string;
  preferences?: string[];
  previousConditions?: SearchConditions;
  mapBounds?: MapBounds;
  cursor?: string;
};

export type ReasonTag = { source: EvidenceSource; label: string };

export type Reason = {
  title: string;
  tags: ReasonTag[];
  quote?: string;
  quoteSource?: string;
};

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
