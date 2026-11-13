"""LLM 해석. 프롬프트, 이전 조건 보여 주기, LLM 출력(JSON) 읽기.

출력은 꼴만 검사하고 규칙으로 고치지 않는다. 규칙이 하던 보정(근처 말, 부정, 싼 곳과
가성비 등)은 프롬프트 지시로 옮겼다. 프롬프트 예시는 평가 질의(experiments/interpretation)와
겹치지 않게 고른다.
"""

import json
import re
from dataclasses import asdict, replace

from fit_ai.match.conditions import (
    CATEGORY_NAMES,
    SIDO_NAMES,
    STATION_NAMES,
    standard_sido,
)
from fit_ai.match.interpretation.codes import (
    FACILITY_CODES,
    FEATURE_CODES,
    FLAVOR_CODES,
    FOOD_CODES,
)
from fit_ai.match.interpretation.request import (
    CODE_PHRASES,
    MAX_WALK_MINUTES,
    Conditions,
    _assemble,
    _join,
)
from fit_ai.match.interpretation.segments import (
    DAYS,
    MAX_SEGMENT_LENGTH,
    MAX_SEGMENTS,
    MAX_SPELLINGS,
    Feature,
    FeatureKind,
    FeatureText,
    Hours,
    Location,
    LocationKind,
    Menu,
    PlaceName,
    Price,
)

FEATURE_KINDS = frozenset(k.value for k in FeatureKind)
"""LLM이 낼 수 있는 코드 없는 특징의 종류"""

SLOTS = (
    "categories",
    "locations",
    "features",
    "facilities",
    "party_size",
    "food_types",
    "flavors",
    "menus",
    "hours",
    "price",
    "place_name",
)
"""후속에서 LLM이 바꾼 칸으로 적을 수 있는 이름. 출력 칸 이름이자 `Conditions` 속성 이름이다."""

MAX_PARTY_SIZE = 100
"""인원 상한. 넘으면 인원이 없는 것으로 본다."""

MAX_CHANGE_SUMMARY_LENGTH = 60
"""LLM이 쓴 바뀐 점 문구의 길이 상한. 넘으면 기본 문구를 쓴다."""


DEFAULT_CHANGE_SUMMARY = "요청하신 조건을 반영했어요"
"""LLM이 바뀐 점을 쓰지 못했을 때의 문구. BE Mock과 같다."""


SYSTEM_PROMPT = f"""\
너는 장소 검색 서비스의 요청 해석기다. 사용자의 검색 요청을 아래 칸으로 나눠 JSON으로 낸다.

공통 규칙
- 요청에서 말한 것만 넣는다. 말하지 않은 지역, 코드, 메뉴, 시간을 짐작해 넣지 않는다. 이전 \
조건이 있으면 아래 "이전 조건이 있을 때"를 따른다.
- 조각의 text에는 요청문에 나온 말을 고치지 않고 그대로 옮긴다. 철자가 틀렸거나 줄여 쓴 \
말은 value에 바로잡은 표준 이름으로 쓴다("건대잎구역"은 text "건대잎구역", value "건대입구역").
- want는 원하면 true다. "말고", "빼고", "싫어", "않은", "없는", "대신"처럼 피한다고 분명히 \
말한 것만 false다. "매운 거 당긴다"처럼 바라는 말은 true다.
- 부정은 바로 앞의 말에만 걸린다. "A 말고 B"는 A만 피하고 B는 원한다.
- 피함(want false)을 담는 칸은 categories, food_types, flavors, menus뿐이다. 다른 칸에는 \
원하는 것만 넣는다.
  - 뺀 지역은 locations에 넣지 않는다("합정역 말고 망원역"은 망원역만 넣는다).
  - 뺀 특징은 반대쪽 코드로 넣는다("북적이는 데 말고"는 QUIET, "차분한 데 말고"는 LIVELY, \
"줄 서는 데 싫어"는 SHORT_WAIT). 반대쪽이 없으면("데이트 말고") 넣지 않는다. 뺀 특징의 \
코드를 그대로 넣지 않는다.
  - 뺀 시설은 넣지 않는다.

칸
- categories: 업종 [{{"code", "want"}}]. code는 RESTAURANT(식당), CAFE(카페), BAR(술집)다. \
원하는 업종은 하나까지다. 업종을 알 수 있으면 비우지 않는다. 알 수 없을 때만 빈 목록이다.
  - 음식 종류, 식사 메뉴(돈가스, 국수), 맛집, 밥집, 매운 음식처럼 식사하는 곳이나 밥, \
끼니(아침, 점심, 저녁)를 먹을 곳을 찾으면 RESTAURANT다.
  - 술 마시는 곳(이자카야, 포차, 호프, 와인바, 칵테일바)과 술 메뉴(하이볼, 와인)는 BAR다.
  - 커피, 음료, 디저트 메뉴(케이크, 빙수)는 CAFE다.
  - 업종 이름을 뺄 때만 want false다("카페 말고"는 CAFE false). "양식 말고"는 음식 종류를 \
빼는 말이라 RESTAURANT를 빼지 않는다.
- locations: 지역 [{{"text", "kind", "value", "walk_minutes", "exit", "sido", "district", \
"dong"}}]. 여럿이면("○○역이나 △△역") 모두 넣는다. 없으면 빈 목록이다.
  - kind는 이름의 종류로 정한다. STATION은 지하철역이다. "강남", "합정"처럼 "역"을 빼고 \
역 이름만 쓰면 동네 이름과 같아도 STATION이다. 철자가 틀려도 역 이름이면 STATION이고, \
가장 적게 고쳐서 되는 역 이름으로 고친다. value는 "○○역"이다. AREA는 행정 구역인 시·도, \
시·군·구, 동·읍·면이다(대전, 송파구, 성수동). PLACE는 거리, 상권, 랜드마크, 학교다(경리단길, \
홍대, 롯데월드타워). AREA와 PLACE의 value는 표준 이름이다. HERE는 이름 없이 "근처", "주변", \
"여기"만 말해 지금 보는 곳을 뜻할 때다. \
UNKNOWN은 "회사 앞", "집 근처"처럼 어딘지 알 수 없는 곳이다. HERE와 UNKNOWN의 value는 null이다.
  - 이름 뒤에 "근처", "주변", "쪽", "앞"이 붙어도 kind는 이름을 따른다. "삼성역 근처"는 \
STATION, "성수동 근처"는 AREA, "코엑스 근처"는 PLACE다.
  - AREA는 sido, district, dong에 단계별 표준 이름을 넣는다. sido는 시·도로 \
{", ".join(SIDO_NAMES)} 중 하나다(광주와 전남은 "전남광주"). district는 구, 구가 없으면 \
시·군이다("유성구", "구미시"). dong은 주소에 쓰는 동·읍·면이다("봉명동", "산동읍"). 줄여 \
말해도 표준 이름으로 쓴다("대전" → sido "대전", "유성" → district "유성구", "역삼1동" → dong \
"역삼동"). 사용자가 말한 단계만 넣고 말하지 않은 위 단계는 짐작해 넣지 않는다("송정동"은 \
dong만). 여러 단계를 이어 말하면 조각 하나에 모두 넣는다("대구 수성구"는 조각 하나). \
STATION과 PLACE 앞에 시·도나 시·군·구를 붙여 말해도 따로 조각을 만들지 않고 그 조각의 \
sido, district에 넣는다. "역"을 뺀 역 이름도 그대로 STATION이다("부산 서면역", "서울 \
합정"은 STATION 하나에 sido, "부산 광안리"는 PLACE 하나에 sido). STATION과 PLACE의 dong, \
HERE와 UNKNOWN의 세 칸은 null이다.
  - walk_minutes는 "걸어서 5분", "도보 10분"의 분, exit는 "3번 출구"의 "3"이다. 없으면 null이다.
- features: 장소 특징 [{{"text", "value", "code", "kind"}}]. 요청에 있는 특징을 빠짐없이 넣는다.
  - code는 아래 특징 코드표에서 고른다. 표현이 달라도 코드표 문구와 뜻이 같으면 그 코드다. \
코드가 있으면 kind는 null이다.
  - 비슷하기만 하고 뜻이 다르거나 코드표에 없는 특징이면 code는 null이다. value는 그 특징을 \
"~곳"으로 끝나는 짧은 문구로 정리한 것이다("책 읽을 만한"은 "책 읽기 좋은 곳", "충전"은 \
"콘센트 있는 곳", "강아지랑"은 "반려견과 갈 수 있는 곳"). kind는 그 문구의 종류다.
    - TASTE: 손님이 그곳을 즐기는 방식. 분위기, 목적, 먹을거리다("책 읽기 좋은 곳", \
"브런치 먹기 좋은 곳", "아이와 가기 좋은 곳").
    - FACILITY: 있고 없음이 정해진 시설이나 사실이다("콘센트 있는 곳", "룸 있는 곳", \
"창가 자리 있는 곳", "반려견과 갈 수 있는 곳").
    - QUALITY: 거의 모든 가게가 내세우는 품질이나 예산이다("맛있는 곳", "친절한 곳", \
"깨끗한 곳").
  - "모임", "회식"은 PURPOSE_GROUP, "혼자"는 PURPOSE_SOLO다.
  - "가성비"는 VALUE_FOR_MONEY다. 싼 곳을 찾는 말("저렴한", "싼", "비싸지 않은", 비싼 \
곳을 빼 달라는 말)은 가성비가 아니라 price의 cheap이다. "가성비"라는 말이 없으면 \
VALUE_FOR_MONEY를 넣지 않는다.
  - 주차, 와이파이, 단체석, 예약은 features가 아니라 facilities다.
- facilities: 시설 코드 목록. PARKING(주차), WIFI(와이파이), GROUP(단체석, 단체 예약), \
RESERVATION(예약). 그 시설을 직접 말했을 때만 넣는다. "모임", "회식", 인원만으로 GROUP을 \
넣지 않는다. 없으면 빈 목록이다.
- party_size: 인원 수("5명"이면 5, "혼자"면 1). 없으면 null이다.
- food_types: 음식 종류 [{{"code", "want"}}]. code는 FOOD_KOREAN(한식), FOOD_JAPANESE(일식), \
FOOD_CHINESE(중식), FOOD_WESTERN(양식), FOOD_ASIAN(아시아 음식). "한식", "중국집", \
"베트남 음식"처럼 음식 종류나 나라를 직접 말했을 때만 넣는다. 메뉴 이름(돈가스, 마라탕, \
버거)이나 "식당"이라는 말만으로 넣지 않는다. 메뉴가 어느 음식 종류인지 알아도 사용자가 음식 \
종류를 말하지 않았으면 넣지 않는다. "양식 말고"는 FOOD_WESTERN want false다. \
없으면 빈 목록이다.
- flavors: 맛 [{{"code", "want"}}]. code는 SPICY(매운맛)다. 매운 음식을 원하면 true, \
"안 매운", "맵지 않은", "매운 건 빼고"는 false다. 없으면 빈 목록이다.
- menus: 먹고 마시는 메뉴 [{{"text", "value", "spellings", "want"}}]. 돈가스, 하이볼, 케이크, \
커피, 술처럼 먹고 마시는 것은 모두 여기다. 음식 종류(한식, 일식)와 매운맛은 menus가 \
아니다. 없으면 빈 목록이다.
  - 가게 종류를 뜻하는 말에 든 메뉴도 넣는다("곱창집"은 곱창, "횟집"은 회, "칵테일바"는 \
칵테일). 가게 종류 이름 자체(이자카야, 포차, 맛집, 카페)와 끼니(아침, 점심, 저녁)는 메뉴가 \
아니다.
  - value는 메뉴판에 가장 흔히 쓰는 이름이다("스파게티"는 "파스타"). spellings는 메뉴판에서 \
같은 메뉴를 부르는 다른 표기와 다른 이름이다("돈가스"는 ["돈까스", "돈카츠"], "사시미"는 \
value "회"에 ["사시미"]). 다른 메뉴나 더 넓은 말은 넣지 않고 없으면 빈 목록이다.
  - 뺀 메뉴("오이 빼고")는 want false다.
- hours: 영업시간 [{{"text", "day", "open_until", "open_from", "now"}}]. 없으면 빈 목록이다. \
요일과 시각을 함께 말하면 둘 다 담는다. day는 MON, TUE, WED, THU, FRI, SAT, SUN이고 없으면 \
null이다. open_until은 그 시각 이후까지 여는 곳이다("늦게까지"는 "23:00", "새벽까지"는 \
"02:00", "밤 10시까지"는 "22:00"). open_from은 그 시각 이전부터 여는 곳이다("아침 8시 전에 \
여는"은 "08:00"). 지금 여는 곳을 찾으면 now는 true다.
- price: 가격. 없으면 null이다. {{"text", "min_won", "max_won", "cheap"}}. "만원 이하"는 \
max_won 10000, "2만원대"는 min_won 20000과 max_won 29999다. 싼 곳을 찾으면 cheap은 true다.
- place_name: 가게 이름이나 체인 이름. 없으면 null이다. {{"text", "value"}}. value는 표준 \
이름이다("투썸"은 "투썸플레이스"). "○○ 같은 곳"처럼 비슷한 곳을 찾는 말은 가게 이름이 아니다.
- embedding_text: 장소 설명과 견줄 긍정형 검색어다. 리뷰에서 실제로 쓰는 말로 쓴다. \
지역(역, 동네, 근처)은 빼고 업종, 메뉴, 특징은 남긴다. 부정 표현은 바라는 쪽으로 바꾼다 \
("북적이는 데 말고"는 "조용한 곳", "줄 서는 데 싫어"는 "웨이팅 없이 바로 들어가는 곳", \
"안 매운"은 "담백한"). 비우지 않고 "찾고 있어요" 같은 말은 붙이지 않는다.
- change_summary: 이전 조건이 있을 때만 바뀐 점을 "~했어요"로 끝나는 짧은 한 문장으로 \
쓴다. 이전 조건이 없으면 null이다.
- location_said: 이전 조건이 있을 때만 쓴다. 새 요청에서 지역(역, 동네, 근처 등)을 말했으면 \
true다. 이전 지역과 같은 곳을 다시 말해도 true다. 이전 조건이 없으면 null이다.
- changed: 이전 조건이 있을 때만 쓴다(아래 "이전 조건이 있을 때"). 이전 조건이 없으면 null이다.

이전 조건이 있을 때
- 새 요청은 이전 검색을 고치는 말이다. 이전 조건에 새 요청을 반영한 지금의 조건 전체를 낸다.
  - 새 요청이 건드리지 않은 이전 조건은 그대로 옮긴다. 옮긴 조각의 text도 이전 그대로 둔다.
  - 새 요청이 바꾼 것은 바꾸고 더한 것은 더한다. 새 요청이 뺀 이전 조건은 지운다. 뺀 특징의 \
반대쪽 코드를 넣을 때는 이전의 그 특징을 지운다(이전에 QUIET였는데 "차분한 데 말고"면 QUIET를 \
지우고 LIVELY만 둔다). QUIET와 LIVELY처럼 반대되는 특징은 함께 두지 않는다.
  - 풀어 달라고 한 조건은 뺀다("예산은 신경 안 써"면 price를 null로, "와이파이는 없어도 돼"면 \
WIFI를, "중식도 괜찮아"면 중식의 피함을 뺀다).
  - 바뀐 조건과 맞지 않게 된 조건은 뺀다. 음식 종류를 바꾸면 그 음식 종류에 딸린 이전 메뉴도 \
빼고(라멘을 찾다가 "양식으로"면 라멘을 뺀다), 업종을 바꾸면 그 업종에 딸린 음식 종류와 메뉴도 \
뺀다(중식당을 찾다가 "술집으로"면 중식을 뺀다). 맞는 조건은 남긴다("식당 말고 카페로"여도 \
조용함은 남긴다).
- embedding_text는 지금 조건 전체를 담은 긍정형 검색어로 새로 쓴다. 바뀌거나 뺀 조건의 말은 \
넣지 않는다.
- changed는 새 요청 때문에 값이 달라진 칸의 이름 목록이다. 더하거나 바꾸거나 뺀 칸과, 딸려서 \
정리한 칸을 모두 넣는다(음식 종류를 바꾸며 이전 메뉴를 뺐으면 food_types와 menus를 둘 다 \
넣는다). 칸 이름은 categories, locations, features, facilities, party_size, food_types, flavors, \
menus, hours, price, place_name이다. 목록에 없는 칸은 이전 조건 값을 그대로 쓴다.

특징 코드표:
{chr(10).join(f"{code}: {CODE_PHRASES[code]}" for code in FEATURE_CODES)}

예시:
- "삼성역 근처 줄 안 서는 돈가스집" → categories [{{"code": "RESTAURANT", "want": true}}], \
locations [{{"text": "삼성역 근처", "kind": "STATION", "value": "삼성역"}}], \
features [{{"text": "줄 안 서는", "value": "웨이팅 없이 바로 들어가는 곳", "code": "SHORT_WAIT"}}], \
menus [{{"text": "돈가스", "value": "돈가스", "spellings": ["돈까스", "돈카츠"], "want": true}}], \
embedding_text "웨이팅 없이 바로 들어가는 돈가스집"
- "성수동 근처 북적이는 데 말고 대화하기 좋은 카페" → categories [{{"code": "CAFE", \
"want": true}}], locations [{{"text": "성수동 근처", "kind": "AREA", "value": "성수동", \
"sido": null, "district": null, "dong": "성수동"}}], \
features [{{"text": "북적이는 데 말고", "value": "조용한 곳", "code": "QUIET"}}, \
{{"text": "대화하기 좋은", "value": "대화하기 좋은 곳", "code": "PURPOSE_TALK"}}], \
embedding_text "조용하고 대화하기 좋은 카페"
- "조용하고 책 읽기 좋은 카페" → categories [{{"code": "CAFE", "want": true}}], \
features [{{"text": "조용하고", "value": "조용한 곳", "code": "QUIET"}}, \
{{"text": "책 읽기 좋은", "value": "책 읽기 좋은 곳", "code": null, "kind": "TASTE"}}], \
embedding_text "조용하고 책 읽기 좋은 카페"
- "건대잎구역 2번 출구 걸어서 3분 하이볼" → categories [{{"code": "BAR", "want": true}}], \
locations [{{"text": "건대잎구역 2번 출구 걸어서 3분", "kind": "STATION", "value": "건대입구역", \
"walk_minutes": 3, "exit": "2"}}], menus [{{"text": "하이볼", "value": "하이볼", "spellings": [], \
"want": true}}], embedding_text "하이볼 술집"
- "합정역 말고 망원역 쪽 저렴한 횟집 금요일 밤 10시까지" → categories [{{"code": \
"RESTAURANT", "want": true}}], locations [{{"text": "망원역 쪽", "kind": "STATION", \
"value": "망원역"}}], menus [{{"text": "횟집", "value": "회", "spellings": ["사시미"], "want": true}}], \
hours [{{"text": "금요일", "day": "FRI"}}, {{"text": "밤 10시까지", "open_until": "22:00"}}], \
price {{"text": "저렴한", "cheap": true}}, embedding_text "저렴한 횟집"
- "회사 앞 8명 송년회 예약되는 곳" → locations [{{"text": "회사 앞", "kind": "UNKNOWN"}}], \
features [{{"text": "송년회", "value": "단체 모임 하기 좋은 곳", "code": "PURPOSE_GROUP"}}], \
facilities ["RESERVATION"], party_size 8, embedding_text "8명이 송년회 하기 좋은 곳"
- "인천 연수구 송도동 브런치 카페" → categories [{{"code": "CAFE", "want": true}}], \
locations [{{"text": "인천 연수구 송도동", "kind": "AREA", "value": "인천 연수구 송도동", \
"sido": "인천", "district": "연수구", "dong": "송도동"}}], menus [{{"text": "브런치", \
"value": "브런치", "spellings": [], "want": true}}], embedding_text "브런치 카페"
- "서울 합정 와인바" → categories [{{"code": "BAR", "want": true}}], \
locations [{{"text": "서울 합정", "kind": "STATION", "value": "합정역", "sido": "서울", \
"district": null, "dong": null}}], menus [{{"text": "와인", "value": "와인", "spellings": [], \
"want": true}}], embedding_text "와인바"
- "투썸 신논현 3번 출구" → categories [{{"code": "CAFE", "want": true}}], \
locations [{{"text": "신논현 3번 출구", "kind": "STATION", "value": "신논현역", \
"exit": "3"}}], place_name {{"text": "투썸", "value": "투썸플레이스"}}, \
embedding_text "투썸플레이스"
- "폴바셋 같은 디저트 카페" → categories [{{"code": "CAFE", "want": true}}], \
menus [{{"text": "디저트", "value": "디저트", "spellings": [], "want": true}}], \
embedding_text "폴바셋 같은 디저트 카페"
- "맵지 않은 떡볶이" → categories [{{"code": "RESTAURANT", "want": true}}], \
flavors [{{"code": "SPICY", "want": false}}], menus [{{"text": "떡볶이", "value": "떡볶이", \
"spellings": [], "want": true}}], embedding_text "순한 떡볶이"
- 이전 조건이 "을지로 조용한 술집"일 때 "술집 말고 빙수 맛집으로" → \
categories [{{"code": "CAFE", "want": true}}, {{"code": "BAR", "want": false}}], \
locations [{{"text": "을지로", "kind": "PLACE", "value": "을지로", "sido": null, \
"district": null, "dong": null}}], \
features [{{"text": "조용한", "value": "조용한 곳", "code": "QUIET"}}], \
menus [{{"text": "빙수", "value": "빙수", "spellings": [], "want": true}}], \
embedding_text "조용한 빙수 카페", location_said false, changed ["categories", "menus"], \
change_summary "술집 대신 빙수 카페로 바꿨어요"
- 이전 조건이 "망원역 2만원 이하 주차되는 곱창집"일 때 "예산은 신경 안 써" → \
categories [{{"code": "RESTAURANT", "want": true}}], \
locations [{{"text": "망원역", "kind": "STATION", "value": "망원역"}}], facilities ["PARKING"], \
menus [{{"text": "곱창", "value": "곱창", "spellings": [], "want": true}}], price null, \
embedding_text "주차되는 곱창집", location_said false, changed ["price"], \
change_summary "가격 조건을 뺐어요"

아래 형식의 JSON만 출력한다. 값이 없는 칸도 빼지 않는다.
{{"embedding_text": "<긍정형 검색어>", "categories": [], "locations": [], "features": [], \
"facilities": [], "party_size": null, "food_types": [], "flavors": [], "menus": [], \
"hours": [], "price": null, "place_name": null, "change_summary": null, "location_said": null, "changed": null}}"""

"""요청 해석 시스템 지시. 예시 문장은 평가 질의(experiments/interpretation)와
겹치지 않게 고른다."""


_CLOCK = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d")
"""시간 조각의 시각 형식("HH:MM")"""


def _user_prompt(query: str, previous: Conditions | None) -> str:
    if previous is None:
        return f"요청: {query}"
    # 이전 조건은 LLM이 낼 꼴과 같게 보여 준다. LLM은 여기에 새 요청을 반영해 조건 전체를
    # 다시 낸다. 칸 이름이 다르면 LLM이 이전 역을 잇지 못했다(2026-11-02 평가, 후속 12번 중
    # 10번). 후보 추출용 문장은 보여 주지 않는다. LLM이 지금 조건으로 새로 쓴다.
    data = {
        key: value for key, value in asdict(previous).items() if key != "embedding_text"
    }
    # 이전 조건은 FE가 돌려보낸 값이지만 읽을 때 모르는 코드는 이미 걸렀다.
    return "\n".join(
        [f"이전 조건: {json.dumps(data, ensure_ascii=False)}", f"새 요청: {query}"]
    )


def _parse(
    data: object, query: str, previous: Conditions | None
) -> tuple[Conditions, Conditions, str | None]:
    """LLM 출력(JSON을 읽은 값)을 조건으로 바꾼다. 형식이 틀리면 실패다.

    출력은 분류별 조각이다. 새 검색이면 이번 요청의 조각이고, 후속이면 이전 조건에 새
    요청을 반영한 조건 전체다(2026-11-05. 전에는 이번 요청만 내고 코드가 합쳤는데, 조건을
    풀거나 딸린 조건을 정리하는 맥락을 다루지 못했다). 모르는 코드는 버리고, 분류별 조각은
    꼴이 틀린 조각만 버린다. 2차 꼴(`codes`, `category_group`, `avoid_foods`)로 내도 읽는다.
    읽은 조각은 규칙으로 고치지 않고 그대로 조건으로 모은다(규칙 보정은 2026-11-05에 뺐다).
    메시지는 로그에 남으므로 출력 내용을 넣지 않는다.

    Returns:
        (이번 요청의 조건, 합친 조건, 바뀐 점). 새 검색이면 둘이 같다. 후속이면 이번 요청의
        조건은 합친 조건에서 이번 요청에 지역을 말하지 않았을 때 지역을 비운 것이다(지역
        고르기가 이번 요청의 지역을 볼 때 쓴다).
    """
    if not isinstance(data, dict):
        raise TypeError("JSON 객체가 아니다")
    embedding_text = data.get("embedding_text")
    if not isinstance(embedding_text, str):
        raise TypeError("embedding_text가 문자열이 아니다")
    if not isinstance(data.get("codes", []), list):
        raise TypeError("codes가 목록이 아니다")
    # 위치 말이 없을 때 null을 내는 일이 잦아서 근처 검색이 아닌 것으로 본다.
    nearby = data.get("nearby") or False
    if not isinstance(nearby, bool):
        raise TypeError("nearby가 참거짓이 아니다")
    locations = _items(data.get("locations"), _location) or _legacy_locations(
        data.get("station"), nearby, previous
    )

    categories = [c for c in _choices(data.get("categories")) if c[0] in CATEGORY_NAMES]
    category_group = next((code for code, want in categories if want), None)
    if category_group is None and data.get("category_group") in CATEGORY_NAMES:
        category_group = data["category_group"]
    foods = [
        (FLAVOR_CODES.get(code, code), want)
        for code, want in (
            *_choices(data.get("food_types")),
            *_choices(data.get("flavors")),
        )
    ]
    features = _items(data.get("features"), _feature)
    codes = [
        *(f.code for f in features if isinstance(f, Feature)),
        *(c for c in _list(data.get("facilities")) if c in FACILITY_CODES),
        *(code for code, want in foods if want and code in FOOD_CODES),
        *(c for c in _list(data.get("codes")) if isinstance(c, str)),
    ]

    summary = None
    if previous is not None:
        summary = data.get("change_summary")
        if not _is_text(summary) or len(summary) > MAX_CHANGE_SUMMARY_LENGTH:
            summary = DEFAULT_CHANGE_SUMMARY
    # 짧은 요청에서 "..."처럼 글자 없는 문장을 내는 일이 있다(10-27 평가 216번 중
    # 12번). 그대로 인코딩하면 유사도가 무의미해져서 요청문으로 대신한다.
    if not any(ch.isalnum() for ch in embedding_text):
        embedding_text = query
    party_size = data.get("party_size")
    conditions = _assemble(
        text=query if previous is None else _join(previous.text, query),
        embedding_text=embedding_text,
        codes=codes,
        category_group=category_group,
        locations=locations,
        menus=_items(data.get("menus"), _menu),
        hours=_items(data.get("hours"), _hours),
        price=_price(data.get("price")),
        place_name=_place_name(data.get("place_name")),
        features=features,
        avoid_categories=tuple(
            dict.fromkeys(
                [code for code, want in categories if not want]
                + [
                    c
                    for c in _list(data.get("avoid_categories"))
                    if c in CATEGORY_NAMES
                ]
            )
        ),
        avoid_foods=tuple(
            dict.fromkeys(
                [code for code, want in foods if not want and code in FOOD_CODES]
                + [c for c in _list(data.get("avoid_foods")) if c in FOOD_CODES]
            )
        ),
        party_size=party_size
        if _won(party_size) and party_size <= MAX_PARTY_SIZE
        else None,
    )
    if previous is None:
        return conditions, conditions, None
    # 후속이면 LLM이 이전 조건에 새 요청을 반영한 조건 전체를 낸다. 지역 고르기는 이번
    # 요청에 말한 지역만 앞세우므로, 지역을 말하지 않았으면 이번 요청의 조건에서 지역을
    # 비운다. LLM이 표시를 빠뜨리면 이전 지역과 다를 때 말한 것으로 본다.
    changed = _changed(data.get("changed"))
    if changed is not None:
        # LLM이 건드리지 않았다고 한 칸은 이전 값을 쓴다. 조건 전체를 다시 쓰다 이전 조건을
        # 빠뜨리는 일을 막는다(2026-11-05, 후속 112번 중 1번 가격을 빠뜨렸다).
        conditions = replace(
            conditions,
            **{slot: getattr(previous, slot) for slot in SLOTS if slot not in changed},
        )
    said = data.get("location_said")
    if not isinstance(said, bool):
        said = conditions.locations != previous.locations
    turn = conditions if said else replace(conditions, locations=())
    return turn, conditions, summary


def _changed(data: object) -> frozenset[str] | None:
    """LLM이 낸 바꾼 칸 목록을 읽는다. 목록이 아니면 None이다(조건 전체를 그대로 쓴다)."""
    if not isinstance(data, list):
        return None
    return frozenset(slot for slot in data if slot in SLOTS)


def _choices(data: object) -> list[tuple[str, bool]]:
    """코드 항목 목록(`[{"code", "want"}]`)을 읽는다. 꼴이 틀린 항목은 버린다."""
    return [
        (item["code"], item.get("want") is not False)
        for item in _list(data)
        if isinstance(item, dict) and isinstance(item.get("code"), str)
    ]


def _legacy_locations(
    station: object, nearby: bool, previous: Conditions | None
) -> tuple[Location, ...]:
    """지역 목록 없이 1차 꼴(station, nearby)로 낸 출력을 지역으로 바꾼다."""
    if station in STATION_NAMES:
        if nearby and previous is not None and station == previous.station:
            # 역 검색 뒤 "근처로"라고 했는데 LLM이 이전 역을 남긴 경우다.
            return (Location("근처", LocationKind.HERE),)
        # "강남역 근처"는 역을 기준으로 찾는 말이다(규칙 해석과 같다).
        name = STATION_NAMES[station]
        return (Location(name, LocationKind.STATION, name),)
    return (Location("근처", LocationKind.HERE),) if nearby else ()


def _location(data: dict) -> Location | None:
    """LLM이 낸 지역을 읽는다. 형식이 틀리면 버린다."""
    text = _segment(data.get("text"))
    try:
        kind = LocationKind(data.get("kind"))
    except ValueError:
        return None
    if text is None:
        return None
    value = _segment(data.get("value"))
    if kind in (LocationKind.HERE, LocationKind.UNKNOWN):
        value = None
    minutes = _won(data.get("walk_minutes"))
    exit_ = data.get("exit")
    # 행정 구역 칸은 행정 구역(AREA)과, 앞에 붙인 상위 지역("부산 서면역")을 담는 역·장소에만
    # 둔다. 동은 행정 구역에만 둔다. 시·도는 주소 첫 낱말 꼴로 맞춘다("대전광역시" → "대전").
    area = kind is LocationKind.AREA
    levels = area or kind in (LocationKind.STATION, LocationKind.PLACE)
    sido = _segment(data.get("sido")) if levels else None
    return Location(
        text,
        kind,
        value,
        walk_minutes=minutes if minutes and minutes <= MAX_WALK_MINUTES else None,
        # bool은 int의 하위 타입이라 따로 막는다.
        exit=_segment(str(exit_))
        if isinstance(exit_, str | int) and not isinstance(exit_, bool)
        else None,
        sido=standard_sido(sido) if sido else None,
        district=_segment(data.get("district")) if levels else None,
        dong=_segment(data.get("dong")) if area else None,
    )


def _menu(data: dict) -> Menu | None:
    """LLM이 낸 메뉴를 읽는다. 음식 코드(`code`)를 내도 버린다. 메뉴에는 음식 종류를 붙이지
    않는다."""
    text = _segment(data.get("text"))
    if text is None:
        return None
    value = _segment(data.get("value")) or text
    spellings = (_segment(s) for s in _list(data.get("spellings")))
    return Menu(
        text=text,
        value=value,
        spellings=tuple(
            dict.fromkeys(
                s for s in spellings if s is not None and s not in (text, value)
            )
        )[:MAX_SPELLINGS],
        want=data.get("want") is not False,
    )


def _hours(data: dict) -> Hours | None:
    text = _segment(data.get("text"))
    day = data.get("day") if data.get("day") in DAYS else None
    until = _clock(data.get("open_until"))
    since = _clock(data.get("open_from"))
    now = data.get("now") is True
    # 무엇을 바라는지 알 수 없는 조각은 버린다.
    if text is None or not (day or until or since or now):
        return None
    return Hours(text, day, until, since, now)


def _price(data: object) -> Price | None:
    """LLM이 낸 가격을 읽는다. 금액도 싼 곳 여부도 없으면 가격이 없는 것으로 본다."""
    if not isinstance(data, dict):
        return None
    text = _segment(data.get("text"))
    low, high = _won(data.get("min_won")), _won(data.get("max_won"))
    if low is not None and high is not None and low > high:
        low = high = None
    cheap = data.get("cheap") is True
    if text is None or not (low is not None or high is not None or cheap):
        return None
    return Price(text, low, high, cheap)


def _place_name(data: object) -> PlaceName | None:
    if not isinstance(data, dict):
        return None
    text = _segment(data.get("text"))
    if text is None:
        return None
    return PlaceName(text, _segment(data.get("value")) or text)


def _feature(data: dict) -> Feature | FeatureText | None:
    """LLM이 낸 특징을 읽는다. 특징 코드표의 코드가 있으면 코드 특징이고, 없으면 코드 없는
    특징이다. 코드 없는 특징의 종류를 모르면 None이다. 2차 꼴의 `want`가 거짓이면 피하는
    특징이다."""
    text = _segment(data.get("text"))
    if text is None:
        return None
    value = _segment(data.get("value")) or text
    if data.get("code") in FEATURE_CODES:
        return Feature(text, value, data["code"])
    kind = data.get("kind")
    return FeatureText(
        text,
        value,
        data.get("want") is not False,
        FeatureKind(kind) if kind in FEATURE_KINDS else None,
    )


def _items(data: object, read) -> tuple:
    """조각 목록을 읽는다. 형식이 틀린 조각만 버리고, 같은 조각은 한 번만 남긴다."""
    items = (read(item) for item in _list(data) if isinstance(item, dict))
    return tuple(dict.fromkeys(item for item in items if item is not None))[
        :MAX_SEGMENTS
    ]


def _list(data: object) -> list:
    return data if isinstance(data, list) else []


def _segment(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()[:MAX_SEGMENT_LENGTH]


def _clock(value: object) -> str | None:
    if isinstance(value, str) and _CLOCK.fullmatch(value.strip()):
        return value.strip()
    return None


def _won(value: object) -> int | None:
    # bool은 int의 하위 타입이라 따로 막는다.
    if isinstance(value, bool) or not isinstance(value, int | float) or value < 0:
        return None
    return int(value)


def _is_text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())
