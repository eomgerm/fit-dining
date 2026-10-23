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

## GPU로 돌리기

기본 `uv sync`는 PyPI의 torch를 씁니다(Windows는 CPU, Linux는 CUDA 13 빌드). GPU를 쓰려면 CUDA 12.8 빌드를 고릅니다. 드라이버가 CUDA 12.8 이상이면 됩니다(`nvidia-smi` 오른쪽 위 `CUDA Version`).

```bash
uv sync --extra cu128                         # torch 2.11.0+cu128
CUDA_VISIBLE_DEVICES=5 uv run python ...      # SSAFY GPU 서버는 5번만 사용
```

SSAFY GPU 서버는 여러 팀이 함께 씁니다. 우리 팀은 5번 GPU만 씁니다. 실행할 때마다 `CUDA_VISIBLE_DEVICES=5`를 붙이고, 다른 번호는 비어 있어도 쓰지 않습니다.

Linux CPU 환경(Docker, CI)은 `uv sync --extra cpu`로 CUDA 라이브러리 없이 설치합니다. 기본 환경으로 돌아가려면 extra 없이 `uv sync`를 다시 합니다.

환경마다 torch 빌드는 달라도 됩니다. 다만 저장해 두고 서로 비교하는 벡터(장소 벡터, `code_vectors.json` 등)는 한 환경에서 한 번에 만들고, 여러 기기에서 만든 벡터를 섞지 않습니다.
