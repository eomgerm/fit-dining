"""GMS를 MLflow judge·GEPA 반성 모델로 연결해 프롬프트를 최적화한다(S15P31A302-105).

mlflow·gepa는 제품 의존성이 아니다. 실행할 때 `uv run --with`로만 덧씌워
uv.lock과 배포 이미지에 들어가지 않게 한다. 실행법은 ai/README.md "프롬프트 최적화".
"""

import os
from pathlib import Path

import mlflow
from mlflow.genai.optimize import GepaPromptOptimizer

from fit_ai import gms

# 반성은 강한 모델로 한다. judge는 대상(gms.MODEL)과 다른 모델을 써서
# 자기 선호 편향(arXiv 2404.13076)을 피한다
REFLECTION_MODEL = os.environ.get("REFLECTION_MODEL", "openai:/gpt-5.5")
JUDGE_MODEL = "openai:/gpt-5.5"

# trace에 리뷰 원문이 들어가므로 기록은 레포 밖에 둔다(README "데이터")
DIR = Path(os.environ.get("FIT_AI_DATA_DIR", Path.home() / "fit-ai-data")) / "mlflow"
TRACKING_URI = f"sqlite:///{(DIR / 'mlflow.db').as_posix()}"


def setup(experiment: str) -> None:
    """GMS 설정을 MLflow judge와 GEPA(litellm)가 읽는 OpenAI 환경변수로 옮기고 실험을 연다."""
    if os.environ.get("GMS_ENABLED") != "true":
        raise SystemExit("GMS_ENABLED=true여야 한다")
    gms.check_config()
    base = os.environ["GMS_BASE_URL"].rstrip("/").removesuffix("/chat/completions")
    os.environ["OPENAI_API_BASE"] = base
    os.environ["OPENAI_API_KEY"] = os.environ["GMS_API_KEY"]

    DIR.mkdir(parents=True, exist_ok=True)
    mlflow.set_tracking_uri(TRACKING_URI)
    # 아티팩트 기본 위치는 실행한 폴더(레포 안)라 실험을 만들 때 밖으로 뺀다
    if mlflow.get_experiment_by_name(experiment) is None:
        mlflow.create_experiment(
            experiment, artifact_location=(DIR / "artifacts").as_uri()
        )
    mlflow.set_experiment(experiment)


def optimize(
    name, template, predict_fn, train, scorers, *, max_metric_calls: int, **gepa_kwargs
):
    """프롬프트를 등록하고 GEPA로 한 번 최적화한다.

    `predict_fn`은 `mlflow.genai.load_prompt(f"prompts:/{name}@latest").format(...)`로
    프롬프트를 읽어야 한다. 최적화 중에는 이름이 같은 프롬프트의 템플릿이 후보로 바뀐다.
    GMS 호출은 대략 max_metric_calls × (1 + LLM judge 수)에 반성 호출 몇 번이 더해진다.

    `gepa_kwargs`는 `gepa.optimize`에 그대로 간다. `valset`이 없으면 GEPA는 train으로
    후보를 고른다. valset 모양은 MLflow가 train을 바꾼 것과 같은 inputs·expectations 레코드다.
    """
    prompt = mlflow.genai.register_prompt(name=name, template=template)
    return mlflow.genai.optimize_prompts(
        predict_fn=predict_fn,
        train_data=train,
        prompt_uris=[prompt.uri],
        optimizer=GepaPromptOptimizer(
            reflection_model=REFLECTION_MODEL,
            max_metric_calls=max_metric_calls,
            gepa_kwargs=gepa_kwargs,
        ),
        scorers=scorers,
    )
