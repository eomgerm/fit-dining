# AI API 명세

Status: 초안 v0.3 · Jira: S15P31A302-41 · 작성일: 2026-10-23 · 고친 날: 2026-10-27
코드: `ai/server/`, `ai/src/fit_ai/match/pg_store.py`

BE는 검색 한 번에 AI를 한 번 부른다. AI가 요청 해석, 요청문 인코딩, 거르기와 후보 뽑기, 정렬, 카드 만들기를 모두 하고 카드의 AI 필드를 돌려준다. 장소는 AI가 들고 있지 않고 검색마다 Postgres 뷰 하나(5장)에서 pgvector로 읽는다. 인프라 설계 12.2절이 AI 팀에 맡긴 명세(요청·응답, 오류 코드, 입력 상한, 모델 버전)다. 흐름은 [spec.md](spec.md)에 있다.

v0.2(해석과 정렬 두 번 호출, BE가 장소를 거르고 프로필째 보냄)에서 바뀌었다. 인프라가 Modal에서 Postgres에 붙을 수 있게 하기로 해서(10-26) BE가 하던 거르기와 프로필 보내기가 없어졌다.

## 1. 주소와 인증

| 주소 | 하는 일 |
| --- | --- |
| `POST /v1/search` | 검색 요청 하나에 카드 목록을 돌려준다 |
| `GET /healthz` | 준비됐으면 200 `{"status": "ok"}`, 아니면 503과 이유 코드 |

Modal에 올리면 엔드포인트를 `requires_proxy_auth=True`로 두고 BE가 `Modal-Key`, `Modal-Secret` 헤더로 부른다(인프라 설계 11.2, 12.2-1). SSAFY GPU 서버에 올리면 인증 방식을 따로 정한다. URL과 토큰은 BE 서버 env에 둔다.

JSON 이름은 BE와 같은 camelCase다. 요청에 모르는 속성이 있으면 400이다(검색 spec D-41). 응답에서 null인 필드는 빠진다.

## 2. BE가 할 일

1. 검색 요청(첫 페이지)을 받으면 `query`, `previousConditions`, `mapBounds`, 취향 프로필을 `/v1/search`에 그대로 보낸다.
2. 응답으로 검색 응답을 만든다.

| 검색 응답 | 가져오는 곳 |
| --- | --- |
| `conditions`, `nearby`, `changeSummary`, `emptyReason` | AI 응답의 같은 필드 그대로 |
| `items` | AI 응답 `items`의 `placeId`로 장소 이름·좌표·사진을 찾아 붙이고 영업 상태를 계산해 넣는다 |
| `totalCount` | `items` 수 |
| `nextCursor` | 없다. 일반 검색은 20개, 근처 검색은 100개까지다 |

`fallbacks`가 비어 있지 않으면 `X-Fallback` 헤더를 붙인다(인프라 BE 계약 #17). BE는 `conditions`를 해석하지 않는다.

## 3. 검색 요청

| 필드 | 필수 | 내용 |
| --- | --- | --- |
| `query` | O | 사용자가 이번에 입력한 요청문. 1~200자, 공백만은 안 된다 |
| `previousConditions` | | 후속 조건이면 FE가 돌려보낸 기준 요청의 `conditions`. 읽지 못하면 새 검색으로 본다 |
| `mapBounds` | | 지도 영역 `{swLat, swLng, neLat, neLng}`. 있으면 역 대신 좌표로 거른다. 빠진 값은 그쪽을 제한하지 않는다 |
| `tasteProfile` | | 취향 프로필(`taste-profile/v0`) JSON 그대로. 읽지 못하거나 취향 50개·문장 20개를 넘으면 취향 없이 정렬한다 |

## 4. 검색 응답

| 필드 | 내용 |
| --- | --- |
| `conditions` | 해석한 조건. BE와 FE에는 불투명하다 |
| `nearby` | 근처 검색인지 |
| `changeSummary` | 후속 조건에서 바뀐 점. 새 검색이면 빠진다 |
| `items` | 카드 목록. `score` 내림차순. 일반 검색 20개, 근처 검색 100개까지 |
| `items[].placeId` | BE 장소 id(뷰의 `place_id`) |
| `items[].score`, `labels`, `reasons`, `scoreItems` | BE `PlaceCard`의 같은 이름 필드. `caution`, `reasons[].quote`, `quoteSource`는 MVP에 없어 빠진다 |
| `emptyReason` | 결과가 없을 때 `{cause, suggestion}`. 결과가 있으면 빠진다 |
| `interpretedBy` | `LLM` 또는 `RULE`(LLM이 실패해 낱말 규칙으로 해석) |
| `rankedBy` | `LLM` 또는 `SIMILARITY`. 결과가 없으면 빠진다. 근처 검색은 늘 `SIMILARITY`이고 폴백이 아니다 |
| `fallbacks` | 아래 표 |
| `models.embedding` | 요청문을 인코딩한 모델(`이름@리비전`) |
| `models.llm` | 해석이나 정렬에 결과를 쓴 LLM. 둘 다 LLM이 실패했으면 빠진다 |

| `fallbacks` 값 | 뜻 |
| --- | --- |
| `INTERPRET_LLM_FAILED` | 해석 LLM이 실패해 낱말 규칙으로 해석했다 |
| `RANK_LLM_FAILED` | 정렬 LLM이 실패해 유사도 순서로 정렬했다 |
| `PREVIOUS_INVALID` | 이전 조건을 읽지 못해 새 검색으로 봤다 |
| `TASTE_INVALID` | 취향 프로필을 읽지 못해 취향 없이 정렬했다 |
| `PROFILE_INVALID` | 40 프로필을 읽지 못한 장소를 뺐다 |

로컬 DB(BE Mock 장소 30곳)에서 실제로 받은 응답이다. 카드는 하나만 남겼다.

```json
{
  "conditions": {
    "text": "역삼역 조용하게 대화하기 좋은 식당",
    "embeddingText": "역삼역 조용하게 대화하기 좋은 식당",
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
        {"title": "리뷰에서 \"대화하기 좋아요\"라는 말이 많아요", "tags": [{"source": "REQUEST", "label": "대화하기 좋아요"}]}
      ],
      "scoreItems": [
        {"source": "REQUEST", "label": "조용해요", "matched": true, "evidenceCount": 4},
        {"source": "REQUEST", "label": "대화하기 좋아요", "matched": true, "evidenceCount": 12}
      ]
    }
  ],
  "interpretedBy": "LLM",
  "rankedBy": "LLM",
  "fallbacks": [],
  "models": {"embedding": "dragonkue/snowflake-arctic-embed-l-v2.0-ko@55ec6e9358a56d56af759bc8372e970caf8c305f", "llm": "gpt-4o-mini"}
}
```

## 5. AI가 읽는 DB 뷰

AI는 뷰 `ai_place_search` 하나만 읽는다. 테이블을 어떻게 나누든 BE와 40이 이 컬럼만 맞춘 뷰를 만들어 주면 된다. 로컬 예시는 `scripts/dev_db.py`가 BE 장소 테이블과 40 프로필 테이블을 조인해 만든다.

| 컬럼 | 타입 | 내용 | 채우는 쪽 |
| --- | --- | --- | --- |
| `place_id` | `bigint` | BE 장소 id. 카드의 `placeId`가 된다 | BE |
| `category_group` | `text` | `RESTAURANT`, `CAFE`, `BAR` | BE |
| `station` | `text` | `GANGNAM`, `YEOKSAM`, `SEOLLEUNG` | BE |
| `lat`, `lng` | `double precision` | 좌표. 지도 영역으로 거를 때 쓴다 | BE |
| `facilities` | `jsonb` | 시설 코드별 유무(`{"PARKING": true, "WIFI": false}`). 없는 코드나 null은 모름이다 | BE |
| `profile` | `jsonb` | 40 프로필 JSON 그대로(`place-profile/v0`). AI는 `summary.text`, `embedding`, `features`를 읽는다 | 40 |
| `summary_vector` | `vector(1024)` | `profile.summary.vector`와 같은 값 | 40 |

AI는 SQL 한 번으로 거르고 뽑는다.

- 업종이 있으면 같은 업종만, 지도 영역이 있으면 좌표 안만, 없으면 같은 역만 남긴다. 근처 검색은 역으로 거르지 않는다.
- 요청한 시설이 `false`인 장소를 뺀다. 모르는 장소는 남긴다.
- `profile.embedding`의 모델·리비전이 요청문 인코더와 같고 `prompt`가 `document`인 장소만 비교한다.
- `summary_vector <=> 요청문 벡터`(코사인 거리)가 가까운 순서로 20곳(근처 검색 100곳)을 뽑는다. 장소가 300곳 남짓이라 인덱스는 없어도 된다.

인프라에 필요한 것:

- AI가 도는 곳(Modal 또는 SSAFY GPU 서버)에서 붙을 수 있는 접속 주소(`DATABASE_URL`, TLS).
- 이 뷰만 `SELECT`할 수 있는 읽기 전용 계정. AI도 접속마다 `default_transaction_read_only`와 `statement_timeout`(2초)을 건다.
- 접속 수: 컨테이너마다 풀 크기 `DB_POOL_SIZE`(기본 2)만큼 연다. Postgres 상한(60)을 넘지 않게 컨테이너 수와 함께 정한다.

## 6. 오류

오류는 BE 컨벤션과 같은 ProblemDetail(`application/problem+json`)이고 BE가 분기할 `code`가 붙는다. `detail`에는 요청 내용을 넣지 않는다.

```json
{"type": "about:blank", "title": "Service Unavailable", "status": 503, "detail": "장소 저장소를 읽지 못했다", "code": "PLACES_UNAVAILABLE"}
```

| 상태 | `code` | 언제 | BE가 할 일(제안) |
| --- | --- | --- | --- |
| 400 | `INVALID_REQUEST` | 형식이 틀림(길이, 모르는 속성, 타입) | BE 버그다. 로그를 남긴다 |
| 503 | `EMBEDDING_UNAVAILABLE` | 요청문 인코더가 없거나 인코딩이 실패함 | 대신 처리하고 임베딩 폴백으로 센다 |
| 503 | `PLACES_UNAVAILABLE` | DB 접속 주소가 없거나 읽지 못함 | 대신 처리하고 알림 |
| 503 | `MODEL_MISMATCH` | `/healthz`만. 벡터가 없거나 모델·리비전이 다른 장소가 있음. 그 장소는 검색에서 빠진다 | 설정 문제다. 알림. 40 프로필을 같은 모델로 다시 만든다 |
| 503 | `BUSY` | 컨테이너의 동시 처리 상한을 넘음. `Retry-After: 1` | 한 번 다시 부르거나 대신 처리한다 |
| 500 | `INTERNAL_ERROR` | 예상하지 못한 오류 | 대신 처리하고 알림 |

LLM이 실패하면 오류가 아니라 낱말 규칙과 유사도로 답하고 `fallbacks`에 남긴다.

## 7. 환경변수

배포 환경의 비밀 저장소(Modal Secret 등)에 넣는다. 로컬에서는 `ai/.env`에 두고 `ai/`에서 `uv run --env-file .env uvicorn server.main:app`으로 띄운다. GPU를 쓰려면 `CUDA_VISIBLE_DEVICES`로 고른다(SSAFY GPU 서버는 5번). 드라이버가 CUDA 12.8까지인 GPU 서버는 `uv sync --extra cu128`로 설치한다.

| 이름 | 기본값 | 내용 |
| --- | --- | --- |
| `GMS_BASE_URL` | 없음 | GMS 기준 URL(`https://gms.ssafy.io/gmsapi/api.openai.com/v1`). 공유 모듈 `fit_ai.gms`가 뒤에 `/chat/completions`를 붙여 부른다 |
| `GMS_API_KEY` | 없음 | GMS 키 |
| `GMS_ENABLED` | 꺼짐 | `true`일 때만 GMS를 부른다. 꺼지면 해석은 규칙으로, 정렬은 유사도로 한다. 켰는데 주소나 키가 틀리면 서버가 시작할 때 멈춘다 |
| `GMS_TIMEOUT_SECONDS` | `5.0` | GMS 한 번 부를 때 기다리는 시간. 공유 모듈은 실패하면 한 번 더 부른다 |
| `EMBEDDING_ENABLED` | 꺼짐 | `true`일 때만 요청문 인코더(공유 모듈 `fit_ai.embedding`)를 시작할 때 올린다 |
| `DATABASE_URL` | 없음 | Postgres 접속 주소 |
| `DB_POOL_SIZE` | `2` | 컨테이너 하나가 여는 DB 접속 수 상한 |
| `MAX_CONCURRENT_REQUESTS` | `8` | 컨테이너 하나가 동시에 처리하는 요청 수(임시 값) |

모델(`gpt-4o-mini`, arctic-ko 리비전 `55ec6e9`)은 공유 모듈에 고정돼 있어 환경변수로 바꾸지 않는다.

## 8. 운영 약속

- **지표(`contracts/metrics.md`):** BE가 응답을 보고 센다.
  - 검색마다 `modal_llm_calls_total`, `modal_embedding_calls_total`에 하나씩 더한다. `INTERPRET_LLM_FAILED`면 `modal_llm_fallback_total`, `EMBEDDING_UNAVAILABLE`이면 `modal_embedding_fallback_total`에도 더한다.
  - 결과가 있고 근처 검색이 아니면 `modal_reranker_calls_total`에 더하고, `RANK_LLM_FAILED`면 `modal_reranker_fallback_total`에도 더한다.
- **시간:** 로컬에서 검색 한 번이 1.2~3.6초였다(해석 1.3~2.9초, 인코딩 0.1~0.5초, DB 0.01초 미만, 정렬 0.8~2.6초). 모델을 올려 둔 뒤 요청문 인코딩만 재면 GPU에서 15ms쯤이다(SSAFY GPU 서버 H200, RTX 4070 모두). GMS는 한 번에 5초를 넘기면 끊고, 공유 모듈이 실패하면 한 번 더 부르므로 해석과 정렬이 각각 최대 10초다. 정상일 때는 5초 안팎이니 BE 타임아웃은 12초쯤으로 잡고, 넘으면 대신 처리한다. 다시 부르지 않는 선택지를 39에 요청했다. 배포 위치와 DB 사이 지연, 콜드 스타트, 늘 켜 둘 컨테이너 수는 배포 뒤 재고 정한다(인프라 설계 12.2-3).
- **요청당 비용 상한(12.2-4):** 요청문 200자, 합친 요청문 400자, 조건 30개, 취향 50개·문장 20개. 정렬 LLM 입력은 후보 20곳이고 LLM은 10곳까지만 고른다. 공유 GMS 모듈은 출력 토큰 상한을 두지 않아 39에 요청했다.
- **로그(12.2-5):** 검색마다 JSON 한 줄이다. 요청문과 취향 내용은 남기지 않는다. 조건 코드, 업종·역, 단계별 시간을 남긴다. 정렬 LLM 응답은 검사를 통과했을 때만 남긴다(후보 번호, 등급을 LLM이 매겼으면 등급까지). 실패한 응답은 길이만 남긴다.
- **모델 버전(12.2-7):** 응답에 싣는다. 장소 벡터의 모델·리비전이 요청문 인코더와 다르면 그 장소는 비교하지 않고 `/healthz`가 503이다.

## 9. 정하지 않은 것

- 뷰를 누가 만들고 어떻게 채우는지, 40 프로필의 갱신 주기, 40 `place_id`와 BE 장소 id를 잇는 방법. BE와 40이 정한다.
- AI 배포 위치(Modal dev 또는 SSAFY GPU 서버)와 거기서 DB로 붙는 방법(공개 범위, TLS, 허용 IP, 읽기 전용 계정). 인프라가 정한다.
- 검색이 503일 때 BE가 대신 보여 줄 것.
- 취향 프로필 전달. BE 요청의 `preferences`(코드 목록)로는 `tasteProfile`을 만들 수 없다.
- 배포 설정(GPU 여부, 늘 켜 둘 컨테이너 수, 콜드 스타트 상한)과 BE 타임아웃 값.
- 공유 GMS 모듈의 다시 부르기, 토큰 수, 출력 토큰 상한. 39와 정한다.
