# AI 검색 API 명세

Status: 초안 v0.4 · Jira: S15P31A302-41 · 작성일: 2026-10-23 · 고친 날: 2026-10-27

BE는 검색 첫 페이지마다 AI를 한 번 부른다. AI는 요청을 해석하고, DB에서 후보를 뽑아 정렬한 뒤, 카드의 AI 필드를 돌려준다. BE는 카드에 장소 정보와 영업 상태를 붙여 FE에 준다.

## 1. 주소

| 주소 | 하는 일 | 상태 |
| --- | --- | --- |
| `POST /v1/search` | 검색 한 번. 요청문으로 카드 목록을 만든다 | 구현됨 |
| `GET /healthz` | 검색할 준비가 됐는지 알려 준다 | 구현됨 |

모든 주소에 해당하는 규칙:

- JSON 이름은 BE와 같은 camelCase다.
- 요청에 모르는 속성이 있으면 400이다(검색 spec D-41).
- 응답에서 값이 없는 필드는 빠진다. null로 오지 않는다.
- 오류는 ProblemDetail로 온다(4장).
- 인증은 배포 위치에 따라 다르다(5장).

## 2. `POST /v1/search`

### 2.1 요청

새 검색:

```json
{
  "query": "역삼역 조용하게 대화하기 좋은 식당",
  "tasteProfile": {
    "schema": "taste-profile/v0",
    "user_id": "u1",
    "features": [
      {"code": "QUIET", "layer": "axis", "like": true, "weight": 1},
      {"code": "LIVELY", "layer": "axis", "like": false, "weight": 1},
      {"code": "VALUE_FOR_MONEY", "layer": "importance", "like": true, "weight": 2}
    ],
    "free_texts": []
  }
}
```

후속 검색도 요청 모양은 같고, 직전 응답의 `conditions`를 `previousConditions`로 더 보낸다. `conditions`에는 해석 결과만 들어 있고 취향과 지도 영역은 없다. 그래서 `tasteProfile`과 `mapBounds`는 후속 검색 때도 매번 다시 보낸다.

- `tasteProfile`을 빼면 그 검색은 취향 없이 정렬한다.
- `mapBounds`를 빼면 이전 조건의 역으로 거른다. 이전 조건에 역도 없으면 지역을 제한하지 않는다.

```json
{
  "query": "넓은 곳이면 좋겠어",
  "previousConditions": {
    "text": "역삼역 조용하게 대화하기 좋은 식당",
    "embeddingText": "조용하고 대화하기 좋은 식당",
    "codes": ["QUIET", "PURPOSE_TALK"],
    "categoryGroup": "RESTAURANT",
    "station": "YEOKSAM",
    "nearby": false
  },
  "tasteProfile": {
    "schema": "taste-profile/v0",
    "user_id": "u1",
    "features": [{"code": "QUIET", "layer": "axis", "like": true, "weight": 1}],
    "free_texts": []
  }
}
```

| 필드 | 타입 | 필수 | 설명 | BE `PlaceSearchRequest`에서 |
| --- | --- | --- | --- | --- |
| `query` | string | O | 사용자가 이번에 입력한 요청문. 1~200자, 공백만은 안 된다 | `query` 그대로 |
| `previousConditions` | object | | 후속 검색일 때 직전 응답의 `conditions`. 내용을 읽지 못하면 새 검색으로 본다 | `previousConditions` 그대로 |
| `mapBounds` | object | | 지도 영역 `{swLat, swLng, neLat, neLng}`(숫자). 있으면 역 대신 이 영역으로 거른다. 빠진 값은 그쪽을 제한하지 않는다. 값이 하나도 없으면(`{}`) 영역이 없는 것으로 본다 | `mapBounds` 그대로 |
| `tasteProfile` | object | | 그 사용자의 39 취향 프로필 내용 전체. 없으면 취향 없이 정렬한다 | 없음(5장 취향 전달) |

BE 요청의 `preferences`와 `cursor`는 보내지 않는다. AI는 모르는 속성을 400으로 거부하므로 값이 null이어도 넣지 않는다. 그래서 `PlaceSearchRequest`를 그대로 직렬화하지 말고 AI 요청용 DTO를 따로 둔다. 응답도 마찬가지다. `PlaceCard`는 `placeId` 대신 `place`를 가지므로 AI 응답은 AI 응답용 DTO로 받는다.

AI는 사용자 정보를 조회하지 않는다. DB에서 읽는 것은 장소 뷰(부록 A)뿐이다. 취향은 BE가 `tasteProfile`에 실어 보낸 내용만 쓴다. `schema`는 요청 필드가 아니라 프로필 안의 형식 버전이다. AI는 이 값으로 읽을 수 있는 형식인지 확인한다.

`tasteProfile`에서 AI가 읽는 필드는 아래뿐이다. 다른 필드(`embedding`, `evidence` 등)는 있어도 무시한다.

| 필드 | 설명 |
| --- | --- |
| `schema` | `taste-profile/v0`이어야 한다 |
| `user_id` | 사용자 id |
| `features[]` | 취향 `{code, layer, like, weight}`. 50개까지. `code`는 문자열, `like`는 참거짓, `weight`는 1~3 정수 |
| `free_texts[]` | 코드가 없는 취향 문장 `{text, like, vector}`. 20개까지. `text`는 100자까지, `like`는 참거짓이나 null, `vector`는 숫자 목록이나 null. `vector`가 있는 문장만 쓴다 |

`previousConditions`나 `tasteProfile`이 객체가 아니면 400이다. 객체인데 내용을 읽지 못하면(형식 버전이 다르거나, 필드가 없거나, 타입과 범위가 위와 다르면) 오류로 끝내지 않고 없는 것으로 본다. 대신 응답의 `fallbacks`에 남긴다.

### 2.2 응답

새 검색의 응답이다. 로컬 DB(BE Mock 장소 30곳)에서 받았고, 카드는 하나만 남겼다.

```json
{
  "conditions": {
    "text": "역삼역 조용하게 대화하기 좋은 식당",
    "embeddingText": "조용하고 대화하기 좋은 식당",
    "codes": ["QUIET", "PURPOSE_TALK"],
    "categoryGroup": "RESTAURANT",
    "station": "YEOKSAM",
    "nearby": false
  },
  "nearby": false,
  "items": [
    {
      "placeId": 1,
      "score": 100,
      "labels": ["가격만큼 만족해요", "대화하기 좋아요"],
      "reasons": [
        {"title": "리뷰에서 \"조용해요\"라는 말이 많아요", "tags": [{"source": "REQUEST", "label": "조용해요"}]},
        {"title": "리뷰에서 \"대화하기 좋아요\"라는 말이 많아요", "tags": [{"source": "REQUEST", "label": "대화하기 좋아요"}]},
        {"title": "리뷰에서 \"가격만큼 만족해요\"라는 말이 많아요", "tags": [{"source": "PREFERENCE", "label": "가격만큼 만족해요"}]}
      ],
      "scoreItems": [
        {"source": "REQUEST", "label": "조용해요", "matched": true, "evidenceCount": 4},
        {"source": "REQUEST", "label": "대화하기 좋아요", "matched": true, "evidenceCount": 12},
        {"source": "PREFERENCE", "label": "가격만큼 만족해요", "matched": true, "evidenceCount": 14}
      ]
    }
  ],
  "interpretedBy": "LLM",
  "rankedBy": "LLM",
  "fallbacks": [],
  "models": {
    "embedding": "dragonkue/snowflake-arctic-embed-l-v2.0-ko@55ec6e9358a56d56af759bc8372e970caf8c305f",
    "llm": "gpt-4o-mini"
  }
}
```

후속 검색이면 `conditions`가 이전 조건과 합쳐지고 `changeSummary`가 붙는다. `items` 등 나머지는 새 검색과 같아서 뺐다.

```json
{
  "conditions": {
    "text": "역삼역 조용하게 대화하기 좋은 넓은 식당",
    "embeddingText": "조용하고 대화하기 좋은 넓은 식당",
    "codes": ["QUIET", "PURPOSE_TALK", "SPACIOUS_SEATING"],
    "categoryGroup": "RESTAURANT",
    "station": "YEOKSAM",
    "nearby": false
  },
  "nearby": false,
  "changeSummary": "넓은 곳이면 좋겠어요"
}
```

결과가 없으면 `items`가 비고 `emptyReason`이 붙는다. `rankedBy`는 빠진다.

```json
{
  "conditions": {"text": "주차되는 술집", "embeddingText": "주차할 수 있는 술집", "codes": ["PARKING"], "categoryGroup": "BAR", "nearby": false},
  "nearby": false,
  "items": [],
  "emptyReason": {"cause": "이 지역 술집 중 주차할 수 있는 곳이 없어요", "suggestion": "주차 조건을 빼고 다시 찾아 보세요"},
  "interpretedBy": "LLM",
  "fallbacks": [],
  "models": {"embedding": "dragonkue/snowflake-arctic-embed-l-v2.0-ko@55ec6e9358a56d56af759bc8372e970caf8c305f", "llm": "gpt-4o-mini"}
}
```

| 필드 | 타입 | 설명 | BE `PlaceSearchResponse`로 |
| --- | --- | --- | --- |
| `conditions` | object | 해석한 조건. BE와 FE는 해석하지 않는다 | `conditions` 그대로. FE가 다음 후속 검색 때 돌려보낸다 |
| `nearby` | boolean | 근처 검색인지 | `nearby` 그대로 |
| `changeSummary` | string | 후속 검색에서 바뀐 점. 새 검색이면 빠진다 | `changeSummary` 그대로 |
| `items` | array | 카드 목록(아래 표). `score` 내림차순. 일반 검색 20개, 근처 검색 100개까지 | `items`. `placeId`로 `PlaceSummary`를 붙이고 `openStatus`를 계산한다. 순서는 그대로 |
| `emptyReason` | object | 결과가 없을 때 `{cause, suggestion}`. 결과가 있으면 빠진다 | `emptyReason` 그대로 |
| `interpretedBy` | string | `LLM`, 또는 LLM이 실패해 낱말 규칙으로 해석했으면 `RULE` | 지표에 쓴다 |
| `rankedBy` | string | `LLM` 또는 `SIMILARITY`(유사도). 결과가 없으면 빠진다. 근처 검색은 늘 `SIMILARITY`다 | 지표에 쓴다 |
| `fallbacks` | string[] | 대신 처리한 이유(아래 표). 없으면 빈 목록 | 하나라도 있으면 `X-Fallback` 헤더에 쉼표로 이어 붙인다(인프라 BE 계약 #17) |
| `models` | object | 결과를 낸 모델 `{embedding, llm}`. 해석과 정렬 모두 LLM이 실패했으면 `llm`이 빠진다 | 로그에 쓴다 |

`totalCount`는 `items` 수다. AI는 다음 페이지를 주지 않으므로 `nextCursor`는 없다.

`conditions` 안의 필드(참고용, BE는 해석하지 않는다):

| 필드 | 설명 |
| --- | --- |
| `text` | 정렬에 쓰는 요청문. 후속 검색이면 이전 요청과 합친 문장이다 |
| `embeddingText` | 후보를 찾을 때 벡터로 바꾸는 문장. 부정 표현은 긍정형으로 바꿨다 |
| `codes` | 요청 조건 코드(39 코드표와 시설 코드) |
| `categoryGroup` | 업종. 요청에 없으면 빠진다 |
| `station` | 역. 요청에 없으면 빠진다 |
| `nearby` | 근처 검색인지 |

카드(`items[]`) 필드. 이름은 BE `PlaceCard`와 같다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `placeId` | number | BE 장소 id |
| `score` | number | 핏 점수 0~100. 맞음 등급마다 구간이 있다(5장) |
| `labels` | string[] | 장소 특징 2개. 근거가 모자라면 업종이나 역 이름으로 채운다 |
| `reasons[]` | array | 추천 이유. 근거가 충분한 조건마다 하나, 3개까지. 없으면 빈 목록이다 |
| `reasons[].title` | string | 이유 문장 |
| `reasons[].tags[]` | array | 근거 칩 `{source, label}`. `source`는 `REQUEST`(요청) 또는 `PREFERENCE`(취향) |
| `scoreItems[]` | array | 점수를 이루는 조건. 요청 조건 먼저, 그다음 좋아하는 취향 순서다. 같은 조건은 요청 쪽에 한 번만 들어간다 |
| `scoreItems[].source` | string | `REQUEST` 또는 `PREFERENCE` |
| `scoreItems[].label` | string | 조건 이름 |
| `scoreItems[].matched` | boolean | 근거가 충분하거나 장소 정보로 확인되면 true. 리뷰가 적거나, 아니라는 리뷰가 더 많거나, 장소 정보에 없다고 나오면 false |
| `scoreItems[].evidenceCount` | number | 그 조건을 채웠다고 말한 리뷰 수. 40이 앱 리뷰와 외부 리뷰를 합쳐 센 값이다 |

`scoreItems`에는 카드 조건(39 코드표의 온보딩 코드 14개와 시설 4개)만 들어간다. "파스타"처럼 음식 종류만 말한 요청은 `scoreItems`가 비어 있을 수 있다. `caution`, `reasons[].quote`, `reasons[].quoteSource`는 MVP에 없어 빠진다.

`fallbacks` 값:

| 값 | 언제 | AI가 대신 한 일 |
| --- | --- | --- |
| `PREVIOUS_INVALID` | `previousConditions`를 읽지 못했다 | 새 검색으로 봤다 |
| `TASTE_INVALID` | `tasteProfile`을 읽지 못했거나 상한을 넘었다 | 취향 없이 정렬했다 |
| `INTERPRET_LLM_FAILED` | 해석 LLM이 실패했다 | 낱말 규칙으로 해석했다 |
| `PROFILE_INVALID` | 40 프로필을 읽지 못한 장소가 있다 | 그 장소만 뺐다 |
| `RANK_LLM_FAILED` | 정렬 LLM이 실패했거나, 해석에서 GMS가 실패했거나 시간 예산이 모자라 부르지 않았다 | 유사도 순서로 정렬했다 |

BE가 셀 지표(`contracts/metrics.md`):

- 검색마다 `modal_llm_calls_total`, `modal_embedding_calls_total`에 하나씩 더한다. `INTERPRET_LLM_FAILED`면 `modal_llm_fallback_total`, `EMBEDDING_UNAVAILABLE`이면 `modal_embedding_fallback_total`에도 더한다.
- 결과가 있고 근처 검색이 아니면 `modal_reranker_calls_total`에 더한다. `RANK_LLM_FAILED`면 `modal_reranker_fallback_total`에도 더한다.

### 2.3 처리 순서

| 순서 | 단계 | 실패하면 |
| --- | --- | --- |
| 1 | 요청 검사 | 400 `INVALID_REQUEST` |
| 2 | 동시 처리 상한 확인 | 503 `BUSY` |
| 3 | 준비 확인(인코더, DB 접속 주소) | 503 `EMBEDDING_UNAVAILABLE`, `PLACES_UNAVAILABLE` |
| 4 | 이전 조건 읽기 | 새 검색으로 하고 `PREVIOUS_INVALID` |
| 5 | 취향 프로필 읽기 | 취향 없이 하고 `TASTE_INVALID` |
| 6 | 요청 해석(GMS). 후속이면 이전 조건과 합친다 | 낱말 규칙으로 하고 `INTERPRET_LLM_FAILED` |
| 7 | 요청문을 벡터로 바꾸기 | 503 `EMBEDDING_UNAVAILABLE` |
| 8 | DB에서 후보 뽑기(20곳, 근처 검색 100곳) | 503 `PLACES_UNAVAILABLE`. 못 읽은 장소만 빼면 `PROFILE_INVALID` |
| 9 | 0곳이면 `emptyReason`을 만들고 끝낸다 | |
| 10 | 쓸 취향 고르기. 요청과 겹치는 묶음(소음, 목적, 음식 종류, 매운맛)의 취향은 뺀다 | |
| 11 | 정렬(GMS). 근처 검색은 LLM 없이 유사도로 한다. 6에서 GMS가 실패했거나 남은 시간이 모자라면 부르지 않는다 | 유사도로 하고 `RANK_LLM_FAILED` |
| 12 | 카드 만들기 | |
| 13 | 응답하고 로그 한 줄 남기기(요청문과 취향 내용은 남기지 않는다) | |

## 3. `GET /healthz`

요청 본문은 없다. 준비됐으면 200이다.

```json
{"status": "ok"}
```

준비되지 않았으면 503 ProblemDetail이다. 아래 순서로 보고 처음 걸린 이유를 준다.

| 순서 | 확인 | 걸리면 `code` |
| --- | --- | --- |
| 1 | 요청문 인코더를 올렸는지 | `EMBEDDING_UNAVAILABLE` |
| 2 | DB 접속 주소가 있는지 | `PLACES_UNAVAILABLE` |
| 3 | DB를 읽을 수 있는지 | `PLACES_UNAVAILABLE` |
| 4 | 요청문 인코더와 같은 모델·리비전의 벡터를 가진 장소가 하나라도 있는지 | `MODEL_MISMATCH` |

```json
{"type": "about:blank", "title": "Service Unavailable", "status": 503, "detail": "장소 30곳 모두 벡터가 요청문 인코더와 맞지 않는다", "code": "MODEL_MISMATCH"}
```

일부 장소만 벡터가 없거나 모델이 다르면 200이다. 그 장소는 검색에서 빠지고, 빠진 장소 수는 로그(`places_mismatched`)에 경고로 남는다. 프로필이 아직 없는 새 장소 하나 때문에 서비스가 내려간 것처럼 보이지 않게 하려는 것이다.

`/healthz`는 동시 처리 상한에 걸리지 않는다.

## 4. 오류

오류는 BE 컨벤션과 같은 ProblemDetail(`application/problem+json`)이다. BE가 분기할 `code`가 붙는다. `detail`에는 요청 내용을 넣지 않는다.

```json
{"type": "about:blank", "title": "Bad Request", "status": 400, "detail": "요청 형식이 올바르지 않다", "code": "INVALID_REQUEST"}
```

| 상태 | `code` | 언제 | 주소 | BE가 할 일(제안) |
| --- | --- | --- | --- | --- |
| 400 | `INVALID_REQUEST` | `query`가 없거나 비었거나 공백뿐이거나 200자를 넘음. 모르는 속성이 있음(`mapBounds` 안 포함, null 값도 해당). 타입이 틀림(`previousConditions`, `tasteProfile`이 객체가 아님, `mapBounds` 값이 숫자가 아니거나 NaN·Infinity). 본문이 JSON이 아니거나 읽을 수 없음(깨진 UTF-8 포함) | search | BE 버그다. 로그를 남긴다 |
| 404, 405 | `HTTP_ERROR` | 없는 주소이거나 메서드가 틀림 | 모두 | 설정을 확인한다 |
| 503 | `BUSY` | 컨테이너가 동시 처리 상한만큼 일하는 중. `Retry-After: 1` 헤더가 붙는다 | search | 한 번 다시 부르거나 대신 처리한다 |
| 503 | `EMBEDDING_UNAVAILABLE` | 요청문 인코더를 올리지 못했거나, 요청문을 벡터로 바꾸다 실패함 | 모두 | 대신 처리하고 임베딩 폴백으로 센다 |
| 503 | `PLACES_UNAVAILABLE` | DB 접속 주소가 없거나, DB를 읽지 못함(접속 실패, 2초 넘는 쿼리, 3초 넘게 접속을 기다림) | 모두 | 대신 처리하고 알림 |
| 503 | `MODEL_MISMATCH` | 모든 장소의 벡터가 없거나 모델·리비전이 다름. 일부만 그러면 200이다 | healthz | 설정 문제다. 40 프로필을 같은 모델로 다시 만든다 |
| 500 | `INTERNAL_ERROR` | 예상하지 못한 오류 | 모두 | 대신 처리하고 알림 |

아래는 오류가 아니다. 200으로 답하고 `fallbacks`에 남긴다.

- 해석 LLM이나 정렬 LLM이 실패했을 때(GMS가 꺼졌을 때 포함)
- `previousConditions`나 `tasteProfile`의 내용을 읽지 못했을 때
- 40 프로필을 읽지 못한 장소가 있을 때

## 5. 임시로 정한 값

검증 전에 정한 값이다. 바뀌면 이 문서와 BE 설정을 같이 고친다.

| 항목 | 지금 값 | BE에 미치는 영향 |
| --- | --- | --- |
| 결과 수 | 일반 검색 20곳, 근처 검색 100곳 | `items` 최대 수. 다음 페이지는 없다 |
| 검색 시간 예산 | 9초. 정렬 LLM은 남은 예산의 절반까지만 기다리고, 모자라면 부르지 않는다 | 해석이 GMS를 기다리다 실패해도 정렬 LLM을 건너뛰므로 가장 오래 걸려도 약 10초다 |
| GMS 대기 시간 | 한 번에 5초. 호출이 실패하면 한 번 더 부른다 | 실제 GMS로 받은 200 응답 64건이 1.7~8.6초였다(중앙값 3.4초, 90% 4.3초, 10-27) |
| BE 타임아웃(제안) | 12초 | 넘으면 대신 처리한다. 배포 위치와 콜드 스타트를 재고 다시 정한다 |
| 동시 처리 상한 | 컨테이너마다 8개 | 넘으면 503 `BUSY` |
| 입력 상한 | 요청문 200자(BE와 같음). `previousConditions`는 합친 요청문 400자, 조건 30개. `tasteProfile`은 취향 50개, 문장 20개 | 요청문은 넘으면 400이다. `previousConditions`와 `tasteProfile`은 넘으면 읽지 않고 `fallbacks`에 남긴다. AI가 만드는 `conditions`도 이 상한 안으로 자른다 |
| 점수 구간 | 딱 맞음 85~100, 대체로 65~84, 일부 40~64, 안 맞음 0~39 | 화면의 점수 해석. 체크할 조건이 없는 요청("선릉역 식당")은 걸러진 곳이 모두 요청에 맞으므로 모두 딱 맞음이고, 순위대로 100~85점이다 |
| 근거가 충분한 기준 | 긍정 리뷰 2개 이상이고 부정 리뷰의 2배 이상 | `matched`, `reasons` |
| 카드 문구 수 | 특징 라벨 2개, 추천 이유 3개까지 | 카드 화면 |
| DB 시간 제한 | 쿼리 2초, 접속 기다리기 3초. 컨테이너마다 접속 2개 | 넘으면 503 `PLACES_UNAVAILABLE` |
| 모델 | LLM `gpt-4o-mini`, 인코더 arctic-ko 리비전 `55ec6e9` | `models`. 40의 장소 벡터도 같은 인코더로 만들어야 한다 |
| 인증 | Modal에 올리면 `Modal-Key`, `Modal-Secret` 헤더(인프라 설계 11.2, 12.2-1). SSAFY GPU 서버는 정하지 않았다 | BE가 헤더를 붙인다. URL과 키는 BE env에 둔다 |
| 취향 전달 | `tasteProfile`(39 취향 프로필 전체)로 받는다 | BE 요청에는 `preferences`(태그 코드)만 있어 아직 보낼 수 없다. 보내지 않으면 취향 없이 정렬한다 |

## 부록 A. AI가 읽는 DB 뷰

AI는 뷰 `ai_place_search` 하나만 읽는다. 테이블을 어떻게 나누든 BE와 40이 이 컬럼만 맞춘 뷰를 만들어 주면 된다. 로컬 예시는 `ai/scripts/dev_db.py`가 만든다.

| 컬럼 | 타입 | 내용 | 채우는 쪽 |
| --- | --- | --- | --- |
| `place_id` | `bigint` | BE 장소 id. 카드의 `placeId`가 된다 | BE |
| `category_group` | `text` | `RESTAURANT`, `CAFE`, `BAR` | BE |
| `station` | `text` | `GANGNAM`, `YEOKSAM`, `SEOLLEUNG` | BE |
| `lat`, `lng` | `double precision` | 좌표. 지도 영역으로 거를 때 쓴다 | BE |
| `facilities` | `jsonb` | 시설 코드별 유무 객체(`{"PARKING": true, "WIFI": false}`). 없는 코드, null, true·false가 아닌 값은 모름이다. 객체가 아니면(배열 등) 그 장소는 빠지고 `PROFILE_INVALID`가 붙는다 | BE |
| `profile` | `jsonb` | 40 프로필 JSON 그대로(`place-profile/v0`). AI는 `summary.text`, `embedding`, `features`를 읽는다 | 40 |
| `summary_vector` | `vector(1024)` | `profile.summary.vector`와 같은 값 | 40 |

AI는 SQL 한 번으로 거르고 뽑는다.

- 업종이 있으면 같은 업종만 남긴다.
- 지도 영역이 있으면 영역 안만, 없으면 같은 역만 남긴다. 근처 검색은 역으로 거르지 않는다.
- 요청한 시설이 `false`인 장소를 뺀다. 모르는 장소는 남긴다.
- `profile.embedding`의 모델·리비전이 요청문 인코더와 같고 `prompt`가 `document`인 장소만 비교한다.
- 요청문 벡터와 코사인 거리가 가까운 순서로 20곳(근처 검색 100곳)을 뽑는다.

인프라에 필요한 것: AI가 도는 곳에서 붙을 수 있는 접속 주소(TLS), 이 뷰만 읽는 계정, 컨테이너 수 × 2개 접속을 받을 여유(Postgres 상한 60).
