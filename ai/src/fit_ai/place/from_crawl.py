"""fitcrawl(자체 수집기)의 raw Apollo JSON을 place-catalog clean/ CSV 모양으로 뽑는다.

범위(2026-11-05, 강남/역삼/선릉 7,325곳 전체로 확장): 이름·카테고리·주소·좌표·연락처·영업시간·메뉴·
사진·편의시설·결제수단·부가링크·키워드·주차·반려동물·콜키지·교통(지하철/버스)·좌석·방송출연.
리뷰는 장소 분석(clean.places)만 읽는 두 파일(external_reviews, external_review_keywords)로 review_rows가
만든다. place-catalog 스펙 AC-15가 적재 스크립트는 이 파일들을 절대 열지 않는다고 못박아 둔 항목이라
(리뷰 본문이 DB 문자열에 섞이지 않게) 적재 쪽은 바뀌지 않는다. 답글·블로그 요약 등 다른 리뷰 CSV는 안 만든다.
full_address(행정구역 전체 이름 "서울특별시"+지번+층수 조합)는 raw JSON에서 출처를 확인 못 해 계속 None이다.
station_code/station_name은 장소에서 가장 가까운 역이다(profile-storage D-16, D-17). subwayStations 중 걷는
거리(walkingDistance)가 가장 짧은 역의 네이버 역 ID를 STATION_CODE_BY_NAVER_ID로 코드로 바꾼다(nearest_station).
가장 가까운 역이 표에 없거나 지하철 항목이 없으면 NULL이다. place_subways 테이블(여러 역/노선)과는 다른 값이다.

실제 샘플(강남/역삼/선릉, 400~1500곳 단위 스캔)로 확인한 것과 확인 못 한 것:
- 단일 영업시간표 장소는 이름이 ""/"기본" 등 제각각이어도 그 표가 DEFAULT다(확인됨).
- 브레이크타임·라스트오더 모양은 실제 샘플(우나기와)로 확인됨.
- 영업시간의 day 글자는 세 모양이 있다: 그냥 요일("화"), "매일"(24시간 연중무휴, 7일로 펼침),
  요일에 날짜가 붙은 모양("화(11/3)", 돌아가며 보여주는 집 -- 그 날짜를 label_date로 뽑는다).
  모르는 모양이 오면 조용히 넘기지 않고 KeyError로 드러낸다(export 스크립트가 건너뛴 장소로 남긴다).
- categoryCodeList의 첫 코드는 음식점/카페/술집 모두 "220036"이라 group을 못 가른다. 둘째 코드가
  가른다: 카페는 "220052", 술집은 "220051"(술집·바(BAR) 둘 다 이 코드), 그 밖은 전부 음식점이다
  (이 크롤러는 음식점·카페·술집만 수집하므로 "그 밖"이 안전한 기본값이다). 실제 샘플로 확인됨.
- 여러 영업시간표가 있는 장소(스타벅스류)의 이름 -> service_type 매핑은 그런 샘플을 아직 못 봐서 추정이다.
- 좌표는 base.coordinate(x=lng, y=lat, 문자열). 전화는 virtualPhone(안심번호, 없으면 phone). 길
  안내 글은 base.road(긴 자유 텍스트). 대표 사진은 topPhotos 첫 장(출처 안 가림, 대표 노출 그대로).
  메뉴 갱신일·방송 출연일은 두 자리 연도("26.04.16", "15.06.29.")라 20XX로 본다(실제 샘플 전부
  2000년대). 모두 37792495/19899218/11727915/1888406465/2025404315 등 실제 샘플로 확인됨.
- subwayStations[i].transfers(같은 역의 다른 노선)는 다루지 않는다 -- 한 역에 노선이 여럿인 실제
  샘플을 확인 못 해 transfers를 추가 행으로 펼치는 규칙을 확정 못 했다(known gap).
- ref 자리 주의: subwayStations[i] 자신과 informationTab.* 는 ref가 아니지만, busStations[i] 전체와
  restaurantInfoTabDetails.seat[i] 전체는 각각 ref다(BusStation:*, RestaurantSeatItems:*). 처음엔
  이걸 놓쳐서 place_transit.csv의 BUS 행과 place_seat_types.csv가 전부 빈 칸으로 나갔다(실제 샘플
  37792495/1185221694로 발견, 7,325곳 실행 결과를 보고 잡음).
"""

import math
import re
from collections import defaultdict

_YY_MM_DD = re.compile(r"(\d{2})\.(\d{2})\.(\d{2})\.?$")

# 네이버 역 ID -> places.station 코드(BE PlaceSummary.Station). 호선마다 ID가 다른 같은 역은 코드 하나에 ID가 여럿이다
# (강남은 2호선 222와 신분당선 1910). ID는 2026-11-03 수집분 서울 강남권과 대전·구미·부산·하남산단에서 장소의
# 가장 가까운 역으로 나온 것이다. 코드를 더하면 여기에도 ID를 더한다(tests/match/test_station_contract.py가 견준다).
STATION_CODE_BY_NAVER_ID = {
    # 서울 강남권
    222: "GANGNAM",
    1910: "GANGNAM",
    221: "YEOKSAM",
    220: "SEOLLEUNG",
    1515: "SEOLLEUNG",
    925: "SINNONHYEON",
    1909: "SINNONHYEON",
    732: "NONHYEON",
    1908: "NONHYEON",
    926: "EONJU",
    1516: "HANTI",
    928: "SAMSEONG_JUNGANG",
    223: "GYODAE",
    340: "GYODAE",
    927: "SEONJEONGNEUNG",
    1514: "SEONJEONGNEUNG",
    219: "SAMSEONG",
    731: "HAKDONG",
    924: "SAPYEONG",
    344: "DOGOK",
    1517: "DOGOK",
    929: "BONGEUNSA",
    # 대전
    30116: "YUSEONG_ONCHEON",
    30117: "GUAM",
    30120: "NOEUN",
    30122: "BANSEOK",
    30119: "DAEJEON_WORLDCUP_STADIUM",
    30121: "JIJOK",
    30115: "GAPCHEON",
    30118: "HYEONCHUNGWON",
    30114: "WOLPYEONG",
    # 구미
    40810: "GUMI",
    40811: "SAGOK",
    # 부산
    70218: "JEONPO",
    70119: "SEOMYEON",
    70219: "SEOMYEON",
    70227: "SASANG",
    70210: "GEUMNYEONSAN",
    70102: "HADAN",
    70209: "GWANGAN",
    70111: "NAMPO",
    70402: "DONGNAE",
}

DAY_CODE = {
    "월": "MON",
    "화": "TUE",
    "수": "WED",
    "목": "THU",
    "금": "FRI",
    "토": "SAT",
    "일": "SUN",
}

_GROUP_BY_SECOND_CODE = {
    "220052": ("CAFE", "카페"),
    "220051": ("BAR", "술집"),
}

_SERVICE_TYPE_BY_NAME = {
    "매장": "DINE_IN",
    "배달": "DELIVERS",
    "포장": "TAKEOUT",
    "드라이브스루": "DRIVE_THROUGH",
    "워크스루": "WALK_THROUGH",
}

_DATE_IN_TEXT = re.compile(r"(\d{1,2})\s*[/.]\s*(\d{1,2})")
_DAY_WITH_DATE = re.compile(r"^([월화수목금토일])(?:\((\d{1,2})/(\d{1,2})\))?$")

_PHOTO_KIND_BY_SOURCE = {"business": "BUSINESS", "menuBoard": "MENU_BOARD"}


def place_detail(state: dict) -> dict:
    """ROOT_QUERY 밑 placeDetail(...) 결과. 없으면 StopIteration."""
    root = next(v for k, v in state.items() if k.startswith("ROOT_QUERY"))
    key = next(k for k in root if k.startswith("placeDetail("))
    return root[key]


def _resolve(state: dict, value):
    if isinstance(value, dict) and "__ref" in value:
        return state[value["__ref"]]
    return value


def _address_parts(common_address: str | None) -> tuple[str | None, str | None]:
    """ "서울 강남구 역삼동" 같은 짧은 주소에서 구·동을 뽑는다."""
    if not common_address:
        return None, None
    district = next((t for t in common_address.split() if t.endswith("구")), None)
    dong = next((t for t in common_address.split() if t.endswith("동")), None)
    return district, dong


def category_group(code_list: list[str] | None) -> tuple[str | None, str | None]:
    """categoryCodeList의 둘째 코드로 category_group_code/name을 고른다(첫 코드는 셋 다 "220036").

    카페·술집 코드가 아니면 음식점으로 본다(이 크롤러는 음식점·카페·술집만 수집한다). 둘째 코드가
    없으면 모른다."""
    if not code_list or len(code_list) < 2:
        return None, None
    return _GROUP_BY_SECOND_CODE.get(code_list[1], ("RESTAURANT", "음식점"))


def _yy_mm_dd(text: str | None) -> str | None:
    """두 자리 연도 날짜("26.04.16", "15.06.29.")를 ISO 날짜로. 실제 샘플이 전부 2000년대라 20XX로 본다."""
    if not text:
        return None
    m = _YY_MM_DD.search(text)
    if not m:
        return None
    yy, mm, dd = m.groups()
    return f"20{yy}-{mm}-{dd}"


def _nearest_subway_station(subway_stations: list[dict] | None) -> dict | None:
    """걷는 거리가 가장 짧은 지하철역(풀린 station 딕셔너리). 거리가 같으면 네이버 목록 순서가 앞선 역이고,
    거리를 모르는 역은 뒤로 보낸다. 지하철 항목이 없으면 None이다."""
    stations = [s.get("station") or {} for s in subway_stations or []]
    if not stations:
        return None
    return min(
        stations,
        key=lambda s: (
            math.inf if s.get("walkingDistance") is None else s["walkingDistance"]
        ),
    )


def nearest_station(
    subway_stations: list[dict] | None,
) -> tuple[str | None, str | None]:
    """장소에서 가장 가까운 역의 (places.station 코드, 역 이름). 가장 가까운 역이 STATION_CODE_BY_NAVER_ID에
    없거나 지하철 항목이 없으면 (None, None)이다. 코드 없는 역이면 두 번째로 가까운 역으로 넘어가지 않는다."""
    station = _nearest_subway_station(subway_stations)
    code = STATION_CODE_BY_NAVER_ID.get(station.get("id")) if station else None
    if code is None:
        return None, None
    return code, station.get("displayName") or f"{station.get('name')}역"


def place_row(
    place_id: str,
    base: dict,
    common_address: str | None,
    pd: dict,
    photo_items: list[dict],
    subway_stations: list[dict] | None = None,
) -> dict:
    """places.csv 한 줄. full_address는 출처를 확인 못 해 None으로 남는다. station_code/station_name은
    subway_stations(station이 풀린 subwayStations)에서 가장 가까운 역(nearest_station)이다."""
    group_code, group_name = category_group(base.get("categoryCodeList"))
    district, dong = _address_parts(common_address)
    coordinate = base.get("coordinate") or {}
    lat = float(coordinate["y"]) if coordinate.get("y") is not None else None
    lng = float(coordinate["x"]) if coordinate.get("x") is not None else None
    station_code, station_name = nearest_station(subway_stations)
    homepage = (pd.get("homepages") or {}).get("repr") or {}
    naver_booking = pd.get("naverBooking") or {}
    menu_updated_at = (pd.get("placeMenus") or {}).get("updatedAt")
    return {
        "naver_place_id": place_id,
        "name": base.get("name"),
        "category_group_code": group_code,
        "category_group_name": group_name,
        "category_name": base.get("category"),
        "category_code": base.get("categoryCode"),
        "lat": lat,
        "lng": lng,
        "road_address": base.get("roadAddress"),
        "jibun_address": base.get("address"),
        "full_address": None,
        "district_name": district,
        "dong_name": dong,
        "station_code": station_code,
        "station_name": station_name,
        "directions_text": base.get("road"),
        "place_description": pd.get("description"),
        "primary_phone": base.get("virtualPhone") or base.get("phone"),
        "homepage_url": homepage.get("url"),
        "naver_booking_url": naver_booking.get("naverBookingUrl"),
        "representative_photo_url": photo_items[0]["originalUrl"]
        if photo_items
        else None,
        "menu_updated_on": _yy_mm_dd(menu_updated_at),
    }


def category_rows(place_id: str, code_list: list[str] | None) -> list[dict]:
    return [
        {
            "naver_place_id": place_id,
            "position": str(i + 1),
            "category_code": code,
            "is_category_path": "true",
        }
        for i, code in enumerate(code_list or [])
    ]


def facility_rows(place_id: str, conveniences: list[str] | None) -> list[dict]:
    """시설은 base.conveniences에서만 오므로 in_conveniences는 항상 true다(clean.places가 이 열로 거른다)."""
    return [
        {"naver_place_id": place_id, "facility_label": label, "in_conveniences": "true"}
        for label in conveniences or []
    ]


def payment_rows(place_id: str, payment_info: list[str] | None) -> list[dict]:
    return [
        {"naver_place_id": place_id, "payment_label": label}
        for label in payment_info or []
    ]


def link_rows(place_id: str, homepages_etc: list[dict] | None) -> list[dict]:
    """홈페이지 외 부가 링크(homepages.etc). 대표 링크(homepages.repr)는 place_row의 homepage_url이다."""
    return [
        {
            "naver_place_id": place_id,
            "link_order": str(link.get("order")),
            "url": link.get("url"),
            "is_dead_url": "true" if link.get("isDeadUrl") else "false",
        }
        for link in homepages_etc or []
    ]


def keyword_rows(place_id: str, keyword_list: list[str] | None) -> list[dict]:
    return [
        {"naver_place_id": place_id, "position": str(i + 1), "keyword": kw}
        for i, kw in enumerate(keyword_list or [])
    ]


def parking_rows(place_id: str, parking_info: dict | None) -> list[dict]:
    """informationTab.parkingInfo. 기본 주차 정보가 없으면 무료 여부는 모른다(None)."""
    if not parking_info:
        return []
    basic_parking = parking_info.get("basicParking")
    return [
        {
            "naver_place_id": place_id,
            "description": parking_info.get("description"),
            "basic_parking_is_free": ("true" if basic_parking["isFree"] else "false")
            if basic_parking
            else None,
        }
    ]


def policy_rows(place_id: str, pet: dict | None, corkage: dict | None) -> list[dict]:
    """informationTab.pet과 restaurantInfoTabDetails.alcoholCorkage.corkage를 한 줄로 합친다."""
    if not pet and not corkage:
        return []
    return [
        {
            "naver_place_id": place_id,
            "pet_allowed": ("true" if pet["isAllowed"] else "false") if pet else None,
            "pet_description": pet.get("description") if pet else None,
            "corkage_available": ("true" if corkage["isAvailable"] else "false")
            if corkage
            else None,
            "corkage_description": corkage.get("description") if corkage else None,
            "corkage_status_description": corkage.get("statusDescription")
            if corkage
            else None,
        }
    ]


def transit_rows(
    place_id: str, subway_stations: list[dict] | None, bus_stations: list[dict] | None
) -> list[dict]:
    """지하철(subwayStations, station은 미리 resolve된 상태)과 버스(busStations)를 한 테이블로 합친다.

    지하철의 position·버스의 position은 각자 1부터 따로 센다(실제 CSV 로더가 종류별로 다시 정렬한다)."""
    rows = []
    for pos, s in enumerate(subway_stations or [], start=1):
        station = s.get("station") or {}
        rows.append(
            {
                "naver_place_id": place_id,
                "kind": "SUBWAY",
                "position": str(pos),
                "stop_name": station.get("name"),
                "line_name": s.get("name"),
                "exit_number": station.get("nearestExit"),
                "stop_code": None,
                "walk_minutes": station.get("walkTime"),
                "walk_meters": station.get("walkingDistance"),
            }
        )
    for pos, b in enumerate(bus_stations or [], start=1):
        rows.append(
            {
                "naver_place_id": place_id,
                "kind": "BUS",
                "position": str(pos),
                "stop_name": b.get("name"),
                "line_name": None,
                "exit_number": None,
                "stop_code": b.get("displayCode"),
                "walk_minutes": b.get("walkTime"),
                "walk_meters": b.get("walkingDistance"),
            }
        )
    return rows


def seat_rows(place_id: str, seats: list[dict] | None) -> list[dict]:
    return [
        {
            "naver_place_id": place_id,
            "position": str(i + 1),
            "seat_name": s.get("name"),
            "description": s.get("description"),
        }
        for i, s in enumerate(seats or [])
    ]


def broadcast_rows(place_id: str, broadcasts: list[dict] | None) -> list[dict]:
    return [
        {
            "naver_place_id": place_id,
            "position": str(i + 1),
            "channel": b.get("channel"),
            "program": b.get("program"),
            "episode": b.get("episode"),
            "aired_on": _yy_mm_dd(b.get("date")),
            "menu": b.get("menu"),
        }
        for i, b in enumerate(broadcasts or [])
    ]


def _label_date(text: str | None, year: int) -> str | None:
    """설명 글에서 날짜(예: "10/23")를 찾아 label_date로 만든다. 못 찾으면 None(정기휴무/날짜 없음)."""
    if not text:
        return None
    m = _DATE_IN_TEXT.search(text)
    if not m:
        return None
    month, day = int(m.group(1)), int(m.group(2))
    return f"{year:04d}-{month:02d}-{day:02d}"


def _service_type(name: str | None, only_schedule: bool) -> str:
    if only_schedule:
        return "DEFAULT"
    return _SERVICE_TYPE_BY_NAME.get(name or "", name or "DEFAULT")


def _day_entries(
    raw_day: str, description: str | None, year: int
) -> list[tuple[str, str | None]]:
    """(day_of_week, label_date) 목록. 보통 한 쌍이지만 "매일"은 7쌍이다.

    실제 샘플에서 본 day 모양 셋: "화"(그냥 요일), "매일"(24시간 연중무휴, 요일 구분 없음),
    "화(11/3)"(날짜가 요일 글자에 바로 붙어 옴 -- description이 아니라 여기서 label_date를 뽑는다)."""
    if raw_day == "매일":
        return [(code, _label_date(description, year)) for code in DAY_CODE.values()]
    m = _DAY_WITH_DATE.match(raw_day)
    if not m:
        raise KeyError(f"모르는 요일 모양: {raw_day!r}")
    day_code = DAY_CODE[m.group(1)]
    label_date = (
        f"{year:04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        if m.group(2)
        else _label_date(description, year)
    )
    return [(day_code, label_date)]


def hour_rows(place_id: str, new_business_hours: list[dict] | None, year: int):
    """(place_hours 행, place_hours_breaks 행, place_hours_last_orders 행)."""
    hours, breaks, orders = [], [], []
    schedules = new_business_hours or []
    for sched in schedules:
        service_type = _service_type(sched.get("name"), len(schedules) == 1)
        for day in sched.get("businessHours") or []:
            bh = day.get("businessHours")
            for day_code, label_date in _day_entries(
                day["day"], day.get("description"), year
            ):
                hours.append(
                    {
                        "naver_place_id": place_id,
                        "service_type": service_type,
                        "day_of_week": day_code,
                        "label_date": label_date,
                        "is_closed": "true" if bh is None else "false",
                        "open_time": bh["start"] if bh else None,
                        "close_time": bh["end"] if bh else None,
                    }
                )
                for seq, b in enumerate(day.get("breakHours") or [], start=1):
                    breaks.append(
                        {
                            "naver_place_id": place_id,
                            "service_type": service_type,
                            "day_of_week": day_code,
                            "break_seq": str(seq),
                            "break_start": b.get("start"),
                            "break_end": b.get("end"),
                        }
                    )
                for seq, lo in enumerate(day.get("lastOrderTimes") or [], start=1):
                    orders.append(
                        {
                            "naver_place_id": place_id,
                            "service_type": service_type,
                            "day_of_week": day_code,
                            "seq": str(seq),
                            "last_order_time": lo.get("time")
                            if isinstance(lo, dict)
                            else lo,
                        }
                    )
    return hours, breaks, orders


def menu_rows(place_id: str, place_menus: dict, items_by_id: dict[str, dict]):
    """(menu_items 행, menu_item_labels 행, menu_item_images 행). items_by_id는 item id -> 다 푼 dict."""
    normal_categories = [
        c for c in (place_menus.get("categories") or []) if c.get("kind") == "normal"
    ]
    category_of: dict[str, str] = {}
    for cat in normal_categories:
        for item_id in cat.get("itemIds") or []:
            category_of.setdefault(item_id, cat.get("name"))

    items, labels, images = [], [], []
    for pos, ref in enumerate(place_menus.get("items") or [], start=1):
        item_id = ref["__ref"].split(":", 1)[1]
        m = items_by_id[item_id]
        price = m.get("price") or {}
        price_type = (price.get("priceType") or "").upper() or None
        display = price.get("displayText")
        price_value = None
        if price_type == "FIXED" and display:
            digits = re.sub(r"[^0-9]", "", display)
            price_value = int(digits) if digits else None
        items.append(
            {
                "naver_place_id": place_id,
                "menu_item_id": item_id,
                "position": str(pos),
                "name": m.get("name"),
                "description": m.get("description"),
                "price_type": price_type,
                "price": price_value,
                "price_text": display,
                "is_representative": "true"
                if "repr" in (m.get("badges") or [])
                else "false",
                "category_name": category_of.get(item_id),
            }
        )
        for lpos, label in enumerate(m.get("labels") or [], start=1):
            labels.append(
                {
                    "naver_place_id": place_id,
                    "menu_item_id": item_id,
                    "position": str(lpos),
                    "label": label,
                }
            )
        for ipos, img in enumerate(m.get("images") or [], start=1):
            images.append(
                {
                    "naver_place_id": place_id,
                    "menu_item_id": item_id,
                    "position": str(ipos),
                    "url": img.get("url"),
                }
            )
    return items, labels, images


def photo_rows(place_id: str, top_photo_items: list[dict]) -> list[dict]:
    """업체·메뉴판 사진만(D-4, D-7). 각 mediaSource마다 원본 순서로 1부터 센다.
    originalUrl이 없는 사진은 보여 줄 수 없고 place_photos.url이 NOT NULL이라 건너뛴다(번호는 이어 센다)."""
    rows = []
    seen: dict[str, int] = defaultdict(int)
    for item in top_photo_items:
        media = item.get("mediaSource")
        kind = _PHOTO_KIND_BY_SOURCE.get(media)
        if kind is None or not item.get("originalUrl"):
            continue
        seen[media] += 1
        rows.append(
            {
                "naver_place_id": place_id,
                "photo_kind": kind,
                "media_source": media,
                "position": str(seen[media]),
                "original_url": item.get("originalUrl"),
            }
        )
    return rows


def review_rows(
    place_id: str, visitor_items: list[dict]
) -> tuple[list[dict], list[dict]]:
    """(external_reviews 행, external_review_keywords 행). 리뷰 원본(reviews/ 파일의 visitor.items)에서 뽑는다.

    장소 분석(clean.places)만 읽는 파일이다. 리뷰 ID는 reviewId이고(id는 다른 값), 본문이 빈 리뷰도 키워드
    근거와 리뷰 수에 들어가므로 남긴다. 키워드는 votedKeywords[].name을 네이버 순서대로 센다."""
    reviews, keywords = [], []
    for item in visitor_items:
        review_id = item["reviewId"]
        reviews.append(
            {
                "naver_place_id": place_id,
                "review_id": review_id,
                "body": item.get("body") or "",
            }
        )
        for pos, kw in enumerate(item.get("votedKeywords") or [], start=1):
            keywords.append(
                {
                    "naver_place_id": place_id,
                    "review_id": review_id,
                    "position": str(pos),
                    "keyword": kw["name"],
                }
            )
    return reviews, keywords


def extract(state: dict, place_id: str, common_address: str | None, year: int) -> dict:
    """한 장소의 raw Apollo 상태에서 clean/ CSV 행들을 전부 뽑는다."""
    pd = place_detail(state)
    base = _resolve(state, pd["base"])
    place_menus = pd.get("placeMenus") or {"items": [], "categories": []}
    items_by_id = {
        ref["__ref"].split(":", 1)[1]: _resolve(state, ref)
        for ref in place_menus.get("items") or []
    }
    top_photos = pd.get("topPhotos") or {"items": []}
    photo_items = [_resolve(state, ref) for ref in top_photos.get("items") or []]
    subway_stations = [
        {**s, "station": _resolve(state, s.get("station"))}
        for s in pd.get("subwayStations") or []
    ]
    bus_stations = [_resolve(state, b) for b in pd.get("busStations") or []]

    information_tab = pd.get("informationTab") or {}
    restaurant_info = pd.get("restaurantInfoTabDetails") or {}
    corkage = (restaurant_info.get("alcoholCorkage") or {}).get("corkage")

    hours, breaks, orders = hour_rows(place_id, pd.get("newBusinessHours"), year)
    menu_items, menu_labels, menu_images = menu_rows(place_id, place_menus, items_by_id)
    place = place_row(place_id, base, common_address, pd, photo_items, subway_stations)
    nearest = _nearest_subway_station(subway_stations)
    return {
        "place": place,
        # 가장 가까운 역이 있는데 코드가 없을 때 그 역 이름. export가 보고서에 세어서 코드를 더할 역을 알려 준다
        "station_without_code": (
            (nearest.get("displayName") or nearest.get("name"))
            if nearest and place["station_code"] is None
            else None
        ),
        "categories": category_rows(place_id, base.get("categoryCodeList")),
        "facilities": facility_rows(place_id, base.get("conveniences")),
        "hours": hours,
        "hour_breaks": breaks,
        "hour_last_orders": orders,
        "menu_items": menu_items,
        "menu_labels": menu_labels,
        "menu_images": menu_images,
        "photos": photo_rows(place_id, photo_items),
        "payments": payment_rows(place_id, base.get("paymentInfo")),
        "links": link_rows(place_id, (pd.get("homepages") or {}).get("etc")),
        "keywords": keyword_rows(place_id, information_tab.get("keywordList")),
        "parking": parking_rows(place_id, information_tab.get("parkingInfo")),
        "policies": policy_rows(place_id, information_tab.get("pet"), corkage),
        "transit": transit_rows(place_id, subway_stations, bus_stations),
        "seats": seat_rows(
            place_id, [_resolve(state, s) for s in restaurant_info.get("seat") or []]
        ),
        "broadcasts": broadcast_rows(place_id, pd.get("broadcastInfos")),
    }
