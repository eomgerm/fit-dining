# Fit Dining

<div align="center">

<img src="docs/fitdining-banner.png" alt="핏다이닝 — 내 취향에 맞는 미식 여정. 지도 추천과 시작 화면." width="760" />

---

> **SSAFY 자율 프로젝트** <br/>
> 팀 **움칫땃쥐** ( A302 ) · 2026.10.06 ~ ing

**내 취향 맞춤 맛집 추천 서비스**

<br />

</div>

**목차** · [주요 기능](#features) · [주요 문제 해결](#technical-cases) · [기술 스택과 구성](#system) · [실행 방법](#local-run) · [팀과 협업](#team)

<a name="features"></a>

## 📍 핏다이닝의 주요 기능


| 기능           | 사용 방법                                                                  |
| ------------ | ---------------------------------------------------------------------- |
| 자연어 장소 검색    | “강남역 근처 조용한 파스타집”처럼 원하는 조건을 문장으로 입력합니다. 결과를 본 뒤 조건을 추가해 다시 검색할 수 있습니다. |
| 점수와 근거로 맛집 확인 | 장소 상세에서 내 취향에 얼마나 맞는지 핏 점수와 AI 추천 이유로 확인해 원하는 장소를 빠르게 알아볼 수 있습니다. |
| 모임 장소 추천     | 모임을 만들고 친구들의 취향을 모아 함께 갈 장소를 고를 수 있습니다.                                     |


<br />

<a name="technical-cases"></a>

## 🧪 주요 문제 해결

### 1. GEPA로 기존 프롬프트를 고도화하고 검색에 맞는 평가 기준 마련

사용자의 취향 자유 입력을 저장하기 위해 LLM을 사용하였습니다. 사용자의 취향을 더욱 세밀하게 수집하고, 취향과 근거를 연결하기 위해서 프롬프트를 강화할 필요가 있었습니다. 이를 위해 합성 평가셋과 채점 기준을 만들고, 기존 프롬프트를 개선하기 위해 GEPA를 적용했습니다.

MLflow의 GEPA로 프롬프트 후보를 만들었습니다. 예측과 정답의 `(kind, code, like)` 집합을 자카드 점수로 비교하고, 검증셋을 따로 사용했습니다. 모델을 고정한 채 합성 문장 108개에서 각 프롬프트를 3회씩 측정했습니다.


| 프롬프트       | 회차별 평균 자카드 점수 범위 |
| ---------- | ----------------: |
| 최적화 전      | 0.665\~0.684     |
| GEPA 최적화 후 | **0.846\~0.855** |


같은 108개로 후보를 비교해 채택한 프롬프트를 서비스에 적용했습니다. [평가 및 적용 커밋](https://github.com/eomgerm/fit-dining/commit/e33712f) · [취향 프로필 명세](docs/specs/taste-profile/spec.md)

같은 최적화 과정을 장소 페르소나 생성에도 적용하면서 평가 기준을 점검했습니다. LLM 측정 점수는 0.47에서 0.72로 올랐지만, 25곳을 대상으로 한 블라인드 테스트에서는 기존 프롬프트의 결과가 20곳에서 선택됐습니다.

이에 최적화 목표를 **코드 규칙과 임베딩 검색 점수**로 바꿨습니다. 같은 업종의 다른 장소 리뷰와 비교했을 때, 해당 장소의 긍정 리뷰 구절이 그 장소의 페르소나에 더 가깝게 검색되는지를 평가합니다. 추천 검색에 쓰이는 페르소나인 만큼, 장소를 구별하는 데 도움이 되는지를 평가에 반영했습니다. [평가 기준 변경 커밋](https://github.com/eomgerm/fit-dining/commit/28846ef) · [페르소나 실험 코드](ai/experiments/prompt_opt/persona.py)

### 2. `gpt-6-luna` 모델 변경을 통한 추론 시간 개선

GEPA 적용 이후에는 취향 입력 프롬프트와 출력 스키마를 고정하고 모델과 추론 강도를 비교했습니다. 합성 문장 108개를 설정별로 3회씩 실행했습니다.


| 직접 입력 해석                 | 회차별 완전 일치         | 응답 p95    | 3초 초과       |
| ------------------------ | -----------------: | ---------: | -----------: |
| `gpt-4o-mini`            | 87\~90 / 108      | 2.34초     | 5 / 324     |
| `gpt-6-luna` · 추론 `none` | **98\~100 / 108** | **1.87초** | **1 / 324** |


`gpt-6-luna` `medium` 설정은 평균 점수가 더 높았지만 추론 과정 때문에 응답 324건 중 68건이 3초를 넘겼습니다. 사용자 입력 후 빠르게 결과를 보여주어야 했기에 추론하지 않도록 설정했습니다. 

리뷰 추출과 장소 페르소나 생성에도 같은 모델 설정을 적용했습니다. 리뷰  추출 시간을 중앙값 12.6초에서 8.1초로 줄일 수 있었습니다. 페르소나에서는 luna 모델이 리뷰 번호나 집계 과정을 추천 문구에 쓰는 문제가 있었습니다. 평가셋에 없는 예시로 프롬프트를 보완한 뒤 20곳을 비교하니 그런 표현이 포함된 결과가 72/93건에서 0/84건으로 줄었습니다. [모델 비교 기록](ai/experiments/prompt_opt/README.md) · [측정 및 결정 커밋](https://github.com/eomgerm/fit-dining/commit/9b7d625)

<a name="system"></a>

## 🥢 기술 스택


| 영역     | 기술                                                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 웹      | ![Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white) ![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) · Tailwind CSS · TanStack Query · 네이버 지도 |
| API    | ![Java 21](https://img.shields.io/badge/Java_21-007396?logo=openjdk&logoColor=white) ![Spring Boot](https://img.shields.io/badge/Spring_Boot-6DB33F?logo=springboot&logoColor=white) · Spring Security · Flyway                                                                                              |
| AI     | Python 3.12 · FastAPI · GMS · Modal · MLflow GEPA                                                                                                                                                                                                                                                            |
| 데이터·배포 | ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white) ![Redis](https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white) ![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white) · pgvector · Garage · GitLab CI               |


## 🗺 시스템 아키텍처

![Fit Dining 시스템 아키텍처](exec/images/01-architecture.png)

 [장소 검색 설계](docs/specs/place-ai-search/spec.md)

### ERD

![회원, 장소, 리뷰, 검색, 모임을 묶은 ERD](exec/images/erd-0-overview.png)


| 영역     | 대표 테이블                           | 저장하는 내용       |
| ------ | -------------------------------- | ------------- |
| 회원     | `auth_users`, `user_preferences` | 계정과 취향 설정     |
| 장소     | `places`, `feature_codes`        | 장소 정보와 특징 코드  |
| 리뷰     | `reviews`, `review_reason_tags`  | 방문 평가와 이유 태그  |
| 검색·북마크 | `search_threads`, `bookmarks`    | 검색 대화와 저장한 장소 |
| 모임     | `meetups`, `meetup_profiles`     | 모임 조건과 참여자 취향 |


<a name="local-run"></a>

## 🍽 로컬 실행 방법

```bash
# 1. 저장소 루트에서 개발용 데이터 서비스를 시작합니다.
test -e infra/local/.env || cp infra/local/local.env.example infra/local/.env
bash infra/local/fit-local.sh up

# 2. 별도 터미널에서 백엔드를 실행합니다.
cd be
test -e .env || cp .env.example .env
AUTH_COOKIE_SECURE=false PLACE_MOCK_ENABLED=true ./gradlew bootRun

# 3. 저장소 루트에서 새 터미널을 열고 웹을 실행합니다.
cd fe
pnpm install
pnpm dev
```

<a name="team"></a>

## 👥 팀 움칫땃쥐


| [RaonJena99](https://github.com/RaonJena99)                                                     | [eomgerm](https://github.com/eomgerm)                                                       | [kanggihoo](https://github.com/kanggihoo)                                                      | [minjae5024](https://github.com/minjae5024)                                                     | [balbi-hw](https://github.com/balbi-hw)                                                       | [dutjddnr0916-art](https://github.com/dutjddnr0916-art)                                               | [WinterI5Coming](https://github.com/WinterI5Coming)                                                 |
| :-----------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------: |
| <img src="https://avatars.githubusercontent.com/u/126668487?v=4" alt="RaonJena99" width="80" /> | <img src="https://avatars.githubusercontent.com/u/52905679?v=4" alt="eomgerm" width="80" /> | <img src="https://avatars.githubusercontent.com/u/103605005?v=4" alt="kanggihoo" width="80" /> | <img src="https://avatars.githubusercontent.com/u/166333923?v=4" alt="minjae5024" width="80" /> | <img src="https://avatars.githubusercontent.com/u/254788199?v=4" alt="balbi-hw" width="80" /> | <img src="https://avatars.githubusercontent.com/u/255274149?v=4" alt="dutjddnr0916-art" width="80" /> | <img src="https://avatars.githubusercontent.com/u/151032546?v=4" alt="WinterI5Coming" width="80" /> |


### 협업 규칙

- 브랜치는 `<Jira 키>/<타입>/<작업명>`을 사용합니다.
- 커밋 메시지는 `[<Jira 키>] <타입>: <설명>` 형식으로 작성합니다. [협업 규칙](CONTRIBUTING.md)
- GitLab CI에서 검증, 이미지 빌드, 배포, 배포 후 점검을 실행합니다. [파이프라인 구성](.gitlab-ci.yml)
