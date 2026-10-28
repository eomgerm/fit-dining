AI 관련 작업을 진행할 디렉토리입니다.

## 시작하기

[uv](https://docs.astral.sh/uv/)가 필요합니다. Python 3.12는 uv가 받아 줍니다.

```bash
cd ai
uv sync                # .venv 생성, 개발 의존성(pytest, ruff) 포함
cp .env.example .env   # GMS를 부를 때만 필요
uv run pytest
uv run ruff check --fix . && uv run ruff format .
```

커밋할 때 lefthook이 스테이징한 `ai/` 파이썬 파일에 ruff를 돌립니다. 그래서 `uv sync`를 먼저 해 둬야 합니다.

임베딩 모델(`dragonkue/snowflake-arctic-embed-l-v2.0-ko`)은 처음 쓸 때 Hugging Face 캐시로 내려받습니다.

## 구조

uv 프로젝트 하나(`fit-ai`)에 라이브러리 패키지 `fit_ai`와 그것을 가져다 쓰는 앱을 함께 둡니다. 폴더는 처음 쓸 때 만듭니다.

```
ai/
├─ src/fit_ai/   # 라이브러리. 공유 모듈(features, embedding, gms)과 기능별 하위 패키지
│  ├─ taste/     #   취향 분석(S15P31A302-39)
│  ├─ place/     #   가게 특징 분석(S15P31A302-40)
│  └─ match/     #   취향-가게 비교(S15P31A302-41)
├─ server/       # AI 서버 앱. fit_ai를 import한다
├─ scripts/      # 실행 진입점: 샘플 생성, 배치, 적재
├─ experiments/  # 측정·비교 실험. 제품 코드(fit_ai, server)는 여기를 import하지 않는다
├─ samples/      # 작은 산출물
├─ data/         # 쓰지 않는다. 실수로 넣어도 git이 무시한다(아래 "데이터" 참고)
└─ tests/        # src/fit_ai와 server의 구조를 그대로 따른다(tests/taste/ 등)
```

- `fit_ai`는 `server`, `scripts`, `experiments`를 import하지 않습니다. 의존은 앱에서 라이브러리 방향으로만 흐릅니다.
- 같은 모델로 만드는 벡터는 서버와 배치 모두 `fit_ai.embedding`을 거칩니다. 질의·문서 인코딩 규칙을 한 곳에 둡니다.
- 모듈 사이의 경계(41은 `taste` 내부가 아니라 프로필 JSON만 읽는다 등)는 `docs/specs/`의 각 스펙을 따릅니다.

## 데이터

수집 데이터는 레포 밖 `~/fit-ai-data/`에 둡니다. 워크스페이스(worktree)를 새로 만들어도 같은 데이터를 보게 하려는 것입니다. 다른 곳에 두려면 환경변수 `FIT_AI_DATA_DIR`로 바꿉니다. `.env`는 워크스페이스를 따라가지 않으므로 사용자 환경변수로 설정합니다.

```
~/fit-ai-data/
├─ raw/<출처>-<수집일>/   # 받은 그대로. 고치거나 덮어쓰지 않는다 (예: raw/apify-20261023/)
└─ archives/              # 공유용 압축 원본
```

팀 공유는 구글 드라이브 공유 폴더(팀원만)로 합니다. 받은 압축 파일은 `archives/`에 두고 `raw/`에 풉니다. 원본에는 리뷰 작성자 정보가 있어 레포에 넣지 않습니다.

## 취향 프로필 샘플 만들기

```bash
uv run --env-file .env python scripts/build_sample_taste_profiles.py
```

`samples/taste/`에 `profiles.json`(샘플 사용자 7명)과 `code_vectors.json`을 만듭니다. `profiles.json`은 41이 읽을 출력 형식의 스냅숏이라 커밋합니다. GMS 응답이 실행마다 조금 달라질 수 있으니 프롬프트나 출력 형식을 바꿀 때만 다시 만듭니다. `code_vectors.json`은 장소 벡터와 같은 환경에서 만들어야 해서(아래 "GPU로 돌리기") 그때 커밋합니다. `GMS_ENABLED`가 `true`가 아니면 직접 입력은 해석 대기(`like: null`)로 남습니다. 규칙은 `docs/specs/taste-profile/spec.md`에 있습니다.

## 프롬프트 최적화

MLflow의 GEPA(`mlflow.genai.optimize_prompts`)로 GMS 프롬프트를 최적화합니다. mlflow와 gepa는 실행할 때만 `--with`로 덧씌웁니다. `pyproject.toml`과 `uv.lock`에 넣지 않으므로 배포 이미지에 들어가지 않습니다.

```bash
uv run --env-file .env --with mlflow==3.17.2 --with "gepa[full]==0.1.4" \
  python experiments/prompt_opt/direct_input.py
```

기록은 `~/fit-ai-data/mlflow/`(SQLite와 아티팩트)에 남습니다. trace에 입력 원문이 들어가므로 레포 안에 두지 않습니다. 결과는 MLflow UI로 봅니다.

```bash
uv run --with mlflow==3.17.2 mlflow ui --backend-store-uri sqlite:///$HOME/fit-ai-data/mlflow/mlflow.db
```

judge·반성 모델과 연결 방식은 `experiments/prompt_opt/common.py`에 있습니다. GMS 호출 수는 스크립트의 `MAX_METRIC_CALLS`로 제한합니다.

## 임베딩 서버(Modal)

`server/embed.py`가 `POST /embed`(`docs/infra/design.md` 12.3절)를 Modal GPU(T4, 모자라면 L4·A10)에서 띄웁니다. 인코딩은 `fit_ai.embedding`을 그대로 씁니다. 모델 가중치는 고정 리비전으로 이미지에 넣습니다.

```bash
uv run modal token new                              # 처음 한 번
uv run modal serve --env fit-test -m server.embed   # AI 팀 시험용. 끄면 내려간다
uv run modal deploy --env fit-dev -m server.embed   # BE dev가 부른다. prod는 --env fit-prod
```

한국어 Windows에서는 앞에 `PYTHONUTF8=1`을 붙입니다. Modal이 `pyproject.toml`을 시스템 인코딩(cp949)으로 읽다가 한글 주석에서 실패합니다.

Modal Environment는 `fit-test`·`fit-dev`·`fit-prod`이고 앱 이름은 모두 `fit-embed`입니다(설계 11.2절). 같은 커밋을 fit-test에서 대조한 뒤 fit-dev, fit-prod 순서로 올립니다.

- 요청: `{"texts": [...], "kind": "query|passage"}`. 텍스트는 1~64개, 각 2000자 이하이고 넘으면 422입니다.
- 응답: `{"model": "<모델>@<리비전>", "dim": 1024, "vectors": [...]}`, 헤더 `X-Model-Version`. 벡터는 단위 길이이고 소수 6자리로 반올림됩니다.
- 인증: `requires_proxy_auth=True`. BE는 Modal 대시보드에서 만든 프록시 토큰을 `Modal-Key`·`Modal-Secret` 헤더로 보냅니다.

## 검색 API(비교) 로컬 실행

비교(S15P31A302-41)의 검색 API는 `server/`에 있고 명세는 `docs/comparison/api.md`입니다. Docker 없이 개발용 Postgres(pgvector)를 띄워 BE Mock 장소 30곳으로 처음부터 끝까지 돌려 볼 수 있습니다.

```bash
uv run python scripts/dev_db.py                  # 개발 DB를 띄우고 예시 장소를 채운다
# 마지막 줄의 DATABASE_URL과 EMBEDDING_ENABLED=true를 .env에 넣는다(GMS 설정도 .env에 둔다)
uv run --env-file .env uvicorn server.main:app   # 검색 API를 띄운다
uv run python scripts/dev_db.py --stop           # 개발 DB를 멈춘다
```

개발 DB에는 회원 취향 예시(샘플 사용자 7명, 회원 id `"1"`~`"7"`)도 들어 있어 요청에 `"userId": "1"`을 넣으면 취향을 읽습니다.

Postgres 없이 띄우려면 `.env`의 `DATABASE_URL`을 비우고 `PLACES_FILE=samples/place/mock.json`, `TASTE_FILE=samples/taste/profiles.json`을 넣습니다. 같은 BE Mock 장소 30곳과 샘플 사용자 7명을 파일에서 읽습니다. 실제 장소 DB가 생기기 전에 배포할 때도 이 방법을 씁니다. 인코더 모델이나 Mock 장소가 바뀌면 `uv run python scripts/dev_db.py --json samples/place/mock.json`으로 다시 만듭니다.

요청 해석 평가는 `experiments/interpretation/`에 있습니다.

## GPU로 돌리기

기본 `uv sync`는 PyPI의 torch를 씁니다(Windows는 CPU, Linux는 CUDA 13 빌드). GPU를 쓰려면 CUDA 12.8 빌드를 고릅니다. 드라이버가 CUDA 12.8 이상이면 됩니다(`nvidia-smi` 오른쪽 위 `CUDA Version`).

```bash
uv sync --extra cu128                         # torch 2.11.0+cu128
CUDA_VISIBLE_DEVICES=5 uv run python ...      # SSAFY GPU 서버는 5번만 사용
```

SSAFY GPU 서버는 여러 팀이 함께 씁니다. 우리 팀은 5번 GPU만 씁니다. 실행할 때마다 `CUDA_VISIBLE_DEVICES=5`를 붙이고, 다른 번호는 비어 있어도 쓰지 않습니다.

Linux CPU 환경(Docker, CI)은 `uv sync --extra cpu`로 CUDA 라이브러리 없이 설치합니다. 기본 환경으로 돌아가려면 extra 없이 `uv sync`를 다시 합니다.

환경마다 torch 빌드는 달라도 됩니다. 다만 저장해 두고 서로 비교하는 벡터(장소 벡터, `code_vectors.json` 등)는 한 환경에서 한 번에 만들고, 여러 기기에서 만든 벡터를 섞지 않습니다.
