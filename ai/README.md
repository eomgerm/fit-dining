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
├─ data/         # 원본 데이터. 리뷰 작성자 정보가 있어 git이 무시한다
└─ tests/        # src/fit_ai와 server의 구조를 그대로 따른다(tests/taste/ 등)
```

- `fit_ai`는 `server`, `scripts`, `experiments`를 import하지 않습니다. 의존은 앱에서 라이브러리 방향으로만 흐릅니다.
- 같은 모델로 만드는 벡터는 서버와 배치 모두 `fit_ai.embedding`을 거칩니다. 질의·문서 인코딩 규칙을 한 곳에 둡니다.
- 모듈 사이의 경계(41은 `taste` 내부가 아니라 프로필 JSON만 읽는다 등)는 `docs/specs/`의 각 스펙을 따릅니다.

## 취향 프로필 샘플 만들기

```bash
uv run --env-file .env python scripts/build_sample_taste_profiles.py
```

`samples/taste/`에 `profiles.json`(샘플 사용자 7명)과 `code_vectors.json`을 만듭니다. `GMS_ENABLED`가 `true`가 아니면 직접 입력은 해석 대기(`like: null`)로 남습니다. 규칙은 `docs/specs/taste-profile/spec.md`에 있습니다.

## GPU로 돌리기

기본 `uv sync`는 PyPI의 torch를 씁니다(Windows는 CPU, Linux는 CUDA 13 빌드). GPU를 쓰려면 CUDA 12.8 빌드를 고릅니다. 드라이버가 CUDA 12.8 이상이면 됩니다(`nvidia-smi` 오른쪽 위 `CUDA Version`).

```bash
uv sync --extra cu128                         # torch 2.11.0+cu128
CUDA_VISIBLE_DEVICES=5 uv run python ...      # SSAFY GPU 서버는 5번만 사용
```

SSAFY GPU 서버는 여러 팀이 함께 씁니다. 우리 팀은 5번 GPU만 씁니다. 실행할 때마다 `CUDA_VISIBLE_DEVICES=5`를 붙이고, 다른 번호는 비어 있어도 쓰지 않습니다.

Linux CPU 환경(Docker, CI)은 `uv sync --extra cpu`로 CUDA 라이브러리 없이 설치합니다. 기본 환경으로 돌아가려면 extra 없이 `uv sync`를 다시 합니다.

환경마다 torch 빌드는 달라도 됩니다. 다만 저장해 두고 서로 비교하는 벡터(장소 벡터, `code_vectors.json` 등)는 한 환경에서 한 번에 만들고, 여러 기기에서 만든 벡터를 섞지 않습니다.
