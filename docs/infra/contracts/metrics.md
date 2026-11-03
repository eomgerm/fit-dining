# 지표 계약 (BE)

BE가 `/actuator/prometheus`로 내야 하는 지표의 이름이다. 알림 규칙([infra/obs/prometheus/rules](../../../infra/obs/prometheus/rules))이 이 이름을 그대로 쓴다. 이름이 다르면 알림이 조용히 멈추므로, 반드시 있어야 하는 지표는 사라지면 `absent()` 알림이 운다([design.md](../design.md) 9.4절).

- 상태: **제안**. BE·AI 팀과 M1 전에 합의한다([README.md](README.md)).
- 노출: 관리 포트 8081의 `/actuator/prometheus`. 공개하지 않는다(Prometheus가 `be-prod-blue:8081`, `be-prod-green:8081`, `be-dev:8081`을 긁는다). `env`(prod, dev)와 `color` 라벨은 Prometheus가 붙인다. BE가 내지 않는다.
- 형식: heartbeat 지표는 counter가 아니라 gauge로 만든다(시계열이 처음부터 존재해야 `absent()`가 쓸모 있다. design.md 9.4절).
- 이행 상태(2026-11-03): BE가 `batch_last_success_timestamp_seconds`, `modal_daily_budget_used_ratio`, Modal 호출·폴백 지표를 아직 내지 않고 당분간 낼 계획도 없다. 그동안 `FitBatchMetricMissing`과 `FitModalMetricMissing`은 7일 안에 낸 적이 있는 지표가 사라질 때만 울린다(처음부터 없는 지표로 매일 울리는 알림이 일일 요약을 채워 진짜 알림을 가렸다). 지표가 없는 동안은 `FitBatchStale`, `FitModalBudgetHigh`, `FitModalFallbackHigh`도 볼 값이 없어 울릴 수 없다. 이 공백은 알려진 것이고, BE가 지표를 내면 규칙을 고치지 않아도 모두 일한다.

## 필수 지표

| 지표 | 종류 | 라벨 | 뜻 | 쓰는 알림 |
|---|---|---|---|---|
| `http_server_requests_seconds_count`, `http_server_requests_seconds_bucket` | counter, histogram | `status`(예: `200`, `503`), `uri`(경로 템플릿. 예: `/api/v1/search`), `method` | Spring Boot Micrometer의 기본 HTTP 서버 지표. 히스토그램 버킷을 켠다(`management.metrics.distribution.percentiles-histogram.http.server.requests=true`) | `FitHttp5xxHigh`, `FitSearchLatencyHigh`, `FitHttpLatencyHigh`, `FitHttpMetricMissing` |
| `batch_last_success_timestamp_seconds` | gauge | 없음 | 새벽 배치가 마지막으로 성공한 시각(UTC epoch 초). 기동 직후에도 값이 있어야 한다(재시작해도 마지막 성공 시각을 이어 낸다) | `FitBatchStale`(26시간), `FitBatchMetricMissing` |
| `modal_daily_budget_used_ratio` | gauge | 없음 | Modal 일일 호출 예산 사용 비율(0~1, Redis 카운터) | `FitModalBudgetHigh`(80%), `FitModalMetricMissing` |

검색 경로의 `uri`는 `/api/v1/search`로 시작해야 검색 지연 알림이 따로 센다(design.md 9.2절).

## Modal 호출 지표

구성요소는 `embedding`, `reranker`, `llm` 셋이다. 호출 횟수와 폴백 횟수를 구성요소마다 counter로 낸다. 폴백 비율은 Prometheus의 기록 규칙(recording rule)이 15분 비율로 만든다.

| 지표 | 종류 | 뜻 |
|---|---|---|
| `modal_embedding_calls_total`, `modal_reranker_calls_total`, `modal_llm_calls_total` | counter | Modal 호출 시도 수(성공과 실패 모두) |
| `modal_embedding_fallback_total`, `modal_reranker_fallback_total`, `modal_llm_fallback_total` | counter | 폴백(키워드 검색 등)으로 내려간 수 |

알림 `FitModalFallbackHigh`는 15분 폴백 비율이 30%를 넘고 호출이 초당 0.01건을 넘을 때 울린다.

## 합의할 점

- 지표 이름과 라벨(위 표)을 BE가 그대로 내는지. 이름을 바꾸면 알림 규칙과 대시보드(`infra/obs/grafana/dashboards`)를 함께 고친다.
- `uri` 라벨이 경로 변수를 템플릿(`/api/v1/restaurants/{id}`)으로 내는지(원래 값을 그대로 내면 계열 수가 폭발한다. Spring MVC의 기본 동작이 템플릿이다).
- 배치 성공 시각을 재시작해도 이어 내는 방법(DB나 Redis에 저장)과 `*_ENABLED` 스위치가 꺼진 환경(dev)의 처리. 알림은 prod만 본다.
