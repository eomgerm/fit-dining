// BE place DTO(kr.co.fitdining.api.place.dto)의 TS 타입. ?는 BE가 null이면 생략하는 선택 필드다

export type CategoryGroup = "RESTAURANT" | "CAFE" | "BAR";
export type Station = "GANGNAM" | "YEOKSAM" | "SEOLLEUNG";
export type OpenStatus =
  "OPEN" | "CLOSING_SOON" | "BREAK" | "CLOSED" | "UNKNOWN";
export type EvidenceSource = "REQUEST" | "PREFERENCE";
export type DayCode = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export type Facility = "PARKING" | "WIFI" | "GROUP" | "RESERVATION";

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
  score: number;
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

export type Hours = {
  dayOfWeek: DayCode;
  open?: string;
  close?: string;
  breakStart?: string;
  breakEnd?: string;
  lastOrders: string[];
  closed: boolean;
};

export type Menu = {
  category: string;
  name: string;
  price?: number;
  photoUrl?: string;
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
  facilities: Facility[];
};
