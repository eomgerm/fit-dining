# AI 검색 API 명세

Status: 초안 v0.5 · Jira: S15P31A302-41 · 작성일: 2026-10-23 · 고친 날: 2026-10-30

BE는 검색 첫 페이지마다 AI를 한 번 부른다. AI는 요청을 해석하고 DB에서 후보를 뽑아 정렬한 뒤 카드의 AI 필드를 돌려준다. BE는 카드에 장소 정보와 영업 상태를 붙여 FE에 준다.

## 1. 주소

| 주소 | 하는 일 |
| --- | --- |
| `POST /v1/search` | 검색 한 번. 요청문으로 카드 목록을 만든다 |
| `GET /healthz` | 검색할 준비가 됐는지 알려 준다 |

JSON 이름은 camelCase다. 요청에 모르는 속성이 있으면 400이고(검색 spec D-41), 응답에서 값이 없는 필드는 null 대신 빠진다. 오류는 ProblemDetail로 온다(4장).

## 2. `POST /v1/search`

### 요청

```json
{
  "query": "역삼역 조용하게 대화하기 좋은 식당",
  "mapBounds": {"swLat": 37.49, "swLng": 127.02, "neLat": 37.51, "neLng": 127.05},
  "userId": "0b6f3c1e-8a4d-4c2b-9f7e-2d5a1c9e4b10"
}
```

| 필드 | 필수 | 내용 | BE `PlaceSearchRequest`에서 |
| --- | --- | --- | --- |
| `query` | O | 요청문. 1~200자, 공백만은 안 된다 | `query` |
| `previousConditions` | | 후속 검색이면 직전 응답의 `conditions`. 읽지 못하면 새 검색으로 본다 | `previousConditions` |
| `mapBounds` | | 지도 영역(숫자). 있으면 역 대신 이 영역으로 거른다. 빠진 값은 제한하지 않고 `{}`는 없는 것으로 본다 | `mapBounds` |
| `userId` | | 회원 id(1~64자). BE가 로그인으로 확인한 id만 보낸다. 있으면 AI가 회원 취향(`user_preferences`)을 직접 읽고 `tasteProfile`은 읽지 않는다. 취향이 저장돼 있지 않으면 취향 없이 정렬한다 | 로그인 사용자 |
| `tasteProfile` | | 비회원 취향. 기기가 저장한 온보딩 답을 BE가 그대로 넘긴다(아래 예). 없으면 취향 없이 정렬한다. 모양이 틀리면 취향 없이 정렬하고 `TASTE_INVALID`를 담는다 | 없음(5장) |

비회원 취향은 이렇게 보낸다. 회원 `user_preferences` 행에서 `features`를 뺀 모양이고, 취향 프로필 계산 API(`POST /v1/taste/profile`) 요청에 칩 벡터가 더해진 모양이다. 모든 필드는 빠져도 된다.

```json
"tasteProfile": {
  "mood": "QUIET",
  "priorities": ["SPACIOUS"],
  "purposes": ["DATE"],
  "tastes": [
    {"polarity": "LIKE", "label": "조용한 곳", "code": "QUIET"},
    {"polarity": "LIKE", "label": "창가 자리", "code": null, "vector": [0.01, 0.02]}
  ]
}
```

- AI는 취향 프로필 계산 API와 같은 계산으로 `features`를 만든다. 회원은 가입 때 BE가 저장해 둔 `features`를 읽으므로 같은 답이면 같은 취향이 된다.
- `vector`는 온보딩 담당이 코드 없는 좋아함 칩에 붙인다(길이 1024). 회원 행처럼 그 칩의 벡터만 쓰고 다른 칩에 붙은 벡터는 버린다. 벡터가 없는 칩은 보관만 하고 정렬에 쓰지 않는다.
- 모양이 틀린 경우: 모르는 필드(`features` 포함), 목록에 없는 값, 칩 20개 초과, 문구 1~100자 밖, 벡터 길이가 1024가 아님

`conditions`에는 해석 결과만 있다. 후속 검색 때도 `userId`(또는 `tasteProfile`)와 `mapBounds`는 다시 보내야 한다. BE의 `preferences`와 `cursor`는 null이라도 넣으면 400이므로 AI 요청용 DTO를 따로 둔다.

### 응답

로컬 DB(BE Mock 장소 30곳)에서 받은 응답이다. 카드는 하나만 남겼다.

```json
{
  "conditions": {"text": "역삼역 조용하게 대화하기 좋은 식당", "embeddingText": "조용하고 대화하기 좋은 식당", "codes": ["QUIET", "PURPOSE_TALK"], "categoryGroup": "RESTAURANT", "station": "YEOKSAM", "nearby": false},
  "nearby": false,
  "items": [
    {
      "placeId": 1,
      "score": 100,
      "labels": ["가격만큼 만족해요", "대화하기 좋아요"],
      "reasons": [{"title": "리뷰에서 \"조용해요\"라는 말이 많아요", "tags": [{"source": "REQUEST", "label": "조용해요"}]}],
      "scoreItems": [{"source": "REQUEST", "label": "조용해요", "matched": true, "evidenceCount": 4}]
    }
  ],
  "interpretedBy": "LLM",
  "rankedBy": "LLM",
  "fallbacks": [],
  "models": {"embedding": "dragonkue/snowflake-arctic-embed-l-v2.0-ko@55ec6e9358a56d56af759bc8372e970caf8c305f", "llm": "gpt-4o-mini"}
}
```

| 필드 | 내용 | BE `PlaceSearchResponse`로 |
| --- | --- | --- |
| `conditions` | 해석한 조건. BE와 FE는 해석하지 않는다 | 그대로. FE가 후속 검색 때 돌려보낸다 |
| `nearby` | 근처 검색인지 | 그대로 |
| `changeSummary` | 후속 검색에서 바뀐 점. 새 검색이면 빠진다 | 그대로 |
| `items` | 카드. `score` 내림차순, 일반 검색 20개·근처 검색 100개까지 | `placeId`로 `PlaceSummary`와 `openStatus`를 붙인다 |
| `emptyReason` | 결과가 없을 때 `{cause, suggestion}` | 그대로 |
| `interpretedBy`, `rankedBy` | `LLM` 또는 `RULE`, `LLM` 또는 `SIMILARITY`. 결과가 없으면 `rankedBy`가 빠진다 | 지표에 쓴다 |
| `fallbacks` | 대신 처리한 이유(아래 표) | 하나라도 있으면 `X-Fallback` 헤더에 쉼표로 붙인다(인프라 BE 계약 #17) |
| `models` | 결과를 낸 모델 | 로그에 쓴다 |

`totalCount`는 `items` 수이고 `nextCursor`는 없다. `PlaceCard`에는 `placeId`가 없으므로 응답도 AI 응답용 DTO로 받는다.

카드 필드는 `PlaceCard`의 AI 필드와 이름이 같다. `labels`는 2개, `reasons`는 3개까지다. `scoreItems`는 요청 조건, 그다음 좋아하는 취향 순서이고 카드 조건(코드표 14개와 시설 4개)만 들어간다. `caution`과 `quote`는 MVP에 없다. 아래 두 필드는 BE Javadoc과 뜻이 달라 화면 문구를 맞춰야 한다.

- `matched=false`: 근거가 부족할 때뿐 아니라 아니라는 리뷰가 더 많거나 장소 정보에 없다고 나올 때도 false다. 이때는 점수를 낮춘다.
- `evidenceCount`: 앱 리뷰와 외부 리뷰를 합친 수다.

| `fallbacks` 값 | AI가 대신 한 일 |
| --- | --- |
| `PREVIOUS_INVALID` | 이전 조건을 읽지 못해 새 검색으로 했다 |
| `TASTE_INVALID` | 취향을 읽지 못해(형식이 깨짐, 취향 저장소가 없거나 장애) 취향 없이 정렬했다 |
| `INTERPRET_LLM_FAILED` | 해석 LLM이 실패해 낱말 규칙으로 해석했다 |
| `PROFILE_INVALID` | 40 프로필을 읽지 못한 장소를 뺐다 |
| `RANK_LLM_FAILED` | 정렬 LLM이 실패했거나 시간이 모자라 유사도로 정렬했다 |

BE는 검색마다 `modal_llm_calls_total`과 `modal_embedding_calls_total`을 센다. 결과가 있고 근처 검색이 아니면 `modal_reranker_calls_total`도 센다. `INTERPRET_LLM_FAILED`, `EMBEDDING_UNAVAILABLE`, `RANK_LLM_FAILED`는 각각 llm, embedding, reranker의 `_fallback_total`로 센다(`contracts/metrics.md`).

### 경우별 응답

로컬 DB에서 받은 실제 요청과 응답이다. 카드는 하나만 남겼다.

#### 후속 검색

직전 응답의 `conditions`를 `previousConditions`로 그대로 보낸다. 응답의 `conditions`는 이전 조건과 합쳐지고 `changeSummary`가 붙는다. 더한 조건(`SPACIOUS_SEATING`)은 근거가 없으면 `matched: false`로 들어가고 점수를 낮춘다.

```json
{
  "query": "넓은 곳이면 좋겠어",
  "previousConditions": {"text": "역삼역 조용하게 대화하기 좋은 식당", "embeddingText": "조용하게 대화하기 좋은 식당", "codes": ["QUIET", "PURPOSE_TALK"], "categoryGroup": "RESTAURANT", "station": "YEOKSAM", "nearby": false}
}
```

```json
{
  "conditions": {"text": "역삼역 조용하게 대화하기 좋은 식당 넓은 곳이면 좋겠어", "embeddingText": "조용하게 대화하기 좋은 넓은 곳", "codes": ["QUIET", "PURPOSE_TALK", "SPACIOUS_SEATING"], "categoryGroup": "RESTAURANT", "station": "YEOKSAM", "nearby": false},
  "nearby": false,
  "changeSummary": "넓은 곳이면 좋겠어요",
  "items": [
    {
      "placeId": 1,
      "score": 84,
      "labels": ["가격만큼 만족해요", "대화하기 좋아요"],
      "reasons": [{"title": "리뷰에서 \"조용해요\"라는 말이 많아요", "tags": [{"source": "REQUEST", "label": "조용해요"}]}, {"title": "리뷰에서 \"대화하기 좋아요\"라는 말이 많아요", "tags": [{"source": "REQUEST", "label": "대화하기 좋아요"}]}],
      "scoreItems": [{"source": "REQUEST", "label": "조용해요", "matched": true, "evidenceCount": 4}, {"source": "REQUEST", "label": "대화하기 좋아요", "matched": true, "evidenceCount": 12}, {"source": "REQUEST", "label": "자리가 넉넉해요", "matched": false, "evidenceCount": 0}]
    }
  ],
  "interpretedBy": "LLM",
  "rankedBy": "LLM",
  "fallbacks": [],
  "models": {"embedding": "dragonkue/snowflake-arctic-embed-l-v2.0-ko@55ec6e9358a56d56af759bc8372e970caf8c305f", "llm": "gpt-4o-mini"}
}
```

#### 결과 없음

뽑힌 장소가 없으면 `items`가 비고 `emptyReason`이 붙는다. `rankedBy`는 빠진다.

```json
{"query": "선릉역 주차되는 카페"}
```

```json
{
  "conditions": {"text": "선릉역 주차되는 카페", "embeddingText": "주차할 수 있는 카페", "codes": ["PARKING"], "categoryGroup": "CAFE", "station": "SEOLLEUNG", "nearby": false},
  "nearby": false,
  "items": [],
  "emptyReason": {"cause": "선릉역 카페 중 주차할 수 있는 곳이 없어요", "suggestion": "주차 조건을 빼고 다시 찾아 보세요"},
  "interpretedBy": "LLM",
  "fallbacks": [],
  "models": {"embedding": "dragonkue/snowflake-arctic-embed-l-v2.0-ko@55ec6e9358a56d56af759bc8372e970caf8c305f", "llm": "gpt-4o-mini"}
}
```

#### 근처 검색

역 없이 근처를 찾으면 역으로 거르지 않고 100곳까지 준다. FE가 현재 위치로 반경 안만 남긴다. 정렬은 LLM 없이 유사도로 하지만 폴백이 아니라서 `fallbacks`는 비어 있다. 따질 조건이 없으면 `reasons`와 `scoreItems`도 비고 점수는 100점부터 순위대로 내려간다.

```json
{"query": "근처 카페"}
```

```json
{
  "conditions": {"text": "근처 카페", "embeddingText": "카페", "codes": [], "categoryGroup": "CAFE", "nearby": true},
  "nearby": true,
  "items": [{"placeId": 29, "score": 100, "labels": ["자리가 넉넉해요", "조용해요"], "reasons": [], "scoreItems": []}],
  "interpretedBy": "LLM",
  "rankedBy": "SIMILARITY",
  "fallbacks": [],
  "models": {"embedding": "dragonkue/snowflake-arctic-embed-l-v2.0-ko@55ec6e9358a56d56af759bc8372e970caf8c305f", "llm": "gpt-4o-mini"}
}
```

#### 입력을 읽지 못함

아래부터는 달라지는 필드만 보인다. 이전 조건이나 취향 프로필이 깨져 있으면 없는 것으로 보고 검색은 그대로 한다.

```json
{"interpretedBy": "LLM", "rankedBy": "LLM", "fallbacks": ["PREVIOUS_INVALID", "TASTE_INVALID"]}
```

#### GMS 장애

해석은 낱말 규칙으로, 정렬은 유사도로 한다. `models.llm`이 빠진다.

```json
{"conditions": {"text": "역삼역 조용한 술집", "codes": ["QUIET"], "categoryGroup": "BAR", "station": "YEOKSAM", "nearby": false}, "items": [{"placeId": 17, "score": 64}, {"placeId": 21, "score": 52}], "interpretedBy": "RULE", "rankedBy": "SIMILARITY", "fallbacks": ["INTERPRET_LLM_FAILED", "RANK_LLM_FAILED"], "models": {"embedding": "dragonkue/snowflake-arctic-embed-l-v2.0-ko@55ec6e9358a56d56af759bc8372e970caf8c305f"}}
```

## 3. `GET /healthz`

준비됐으면 200 `{"status": "ok"}`, 아니면 503 ProblemDetail이다. 인코더를 못 올렸으면 `EMBEDDING_UNAVAILABLE`, DB 주소가 없거나 못 읽으면 `PLACES_UNAVAILABLE`, 모든 장소의 벡터 모델이 다르면 `MODEL_MISMATCH`다. 일부 장소만 다르면 200이고 그 장소만 검색에서 빠진다.

## 4. 오류

```json
{"type": "about:blank", "title": "Bad Request", "status": 400, "detail": "요청 형식이 올바르지 않다", "code": "INVALID_REQUEST"}
```

| 상태 | `code` | 언제 | BE가 할 일(제안) |
| --- | --- | --- | --- |
| 400 | `INVALID_REQUEST` | 요청 형식이 틀림(길이, 모르는 속성, 타입, 읽을 수 없는 본문) | BE 버그다. 로그를 남긴다 |
| 404, 405 | `HTTP_ERROR` | 없는 주소이거나 메서드가 틀림 | 설정을 확인한다 |
| 503 | `BUSY` | 동시 처리 상한을 넘음. `Retry-After: 1` | 한 번 다시 부르거나 대신 처리한다 |
| 503 | `EMBEDDING_UNAVAILABLE` | 요청문 인코더가 없거나 인코딩이 실패함 | 대신 처리하고 임베딩 폴백으로 센다 |
| 503 | `PLACES_UNAVAILABLE` | DB 주소가 없거나 DB를 읽지 못함 | 대신 처리하고 알림 |
| 503 | `MODEL_MISMATCH` | `/healthz`만. 모든 장소의 벡터 모델이 다름 | 40 프로필을 같은 모델로 다시 만든다 |
| 500 | `INTERNAL_ERROR` | 예상하지 못한 오류 | 대신 처리하고 알림 |

LLM 실패와 읽지 못한 입력은 오류가 아니라 200과 `fallbacks`로 온다.

## 5. 임시로 정한 값

| 항목 | 지금 값 |
| --- | --- |
| 결과 수 | 일반 검색 20곳, 근처 검색 100곳 |
| 시간 | 검색 예산 9초, 가장 오래 걸려도 약 10초. 실제 응답은 1.7~8.6초(중앙값 3.4초) |
| BE 타임아웃(제안) | 12초 |
| 동시 처리 상한 | 컨테이너마다 8개 |
| 점수 구간 | 딱 맞음 85~100, 대체로 65~84, 일부 40~64, 안 맞음 0~39. 따질 조건이 없으면 모두 딱 맞음 |
| 모델 | LLM `gpt-4o-mini`, 인코더 arctic-ko 리비전 `55ec6e9`. 40 장소 벡터도 같은 인코더로 만든다 |
| 인증 | BE가 `Modal-Key`, `Modal-Secret` 헤더로 부른다(인프라 설계 11.2). 없거나 틀리면 Modal 프록시가 401을 낸다 |
| 취향 전달 | 회원은 `userId`로 보내고 AI가 `user_preferences`(저장 설계 V6)를 읽는다. 비회원은 기기가 저장한 온보딩 답(칩 벡터 포함)을 `tasteProfile`로 보내고 AI가 `features`를 계산한다(10-30). FE 저장 검사는 아직 칩의 `vector`를 받지 않는다 |