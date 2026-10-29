"""장소 페르소나 생성 프롬프트를 GEPA로 최적화한다(S15P31A302-106).

평가셋은 data/persona.jsonl이다. 실제 네이버 리뷰가 아닌 합성 장소라 레포에 둔다.
한 행이 장소 하나다. 리뷰 번호는 순서대로 r1, r2 …이고, 항목은
[칸, 코드, 방향, 리뷰 구절, 정리 문장]이다. 키워드 투표는 {키워드: 개수}다.

채점은 둘이다.
- persona_rules(코드): 버려진 페르소나, like와 인용 리뷰 방향, 근거 특징을 빠짐없이 다뤘는지, 형식
- search(임베딩): 이 장소의 좋았어요 구절을 검색어로 넣었을 때, 같은 업종 다른 장소의 구절보다
  좋아할 손님 페르소나에 더 가깝게 걸리는지. 41이 페르소나 벡터로 취향과 맞대는 방식을 따른다

grounded(LLM judge)도 정의해 두었지만 목표에서 뺐다. judge 점수는 0.47 → 0.72로 올랐는데
사람 블라인드 비교 25곳에서는 기존 프롬프트가 20:5로 이겼고, judge는 장소별로 사람과 4/24만 일치했다.
judge가 근거 밖 사소한 덧붙임까지 실패로 쳐서 건조한 템플릿 문장으로 최적화됐다.
search는 같은 비교에서 사람과 같은 방향이었다(test 평균 기존 0.811, 최적화 0.723).

임베딩은 EMBED_URL(SSH 터널로 연 GPU 서버의 /encode)이 있으면 그쪽을, 없으면 fit_ai.embedding을 쓴다.

    python persona.py              # 최적화
    python persona.py baseline 2   # 지금 프롬프트를 2번 돌려 split·slice별 점수와 낮은 것
    python persona.py test 3       # 등록된 프롬프트 3번 버전을 test로 TEST_RUNS번
    python persona.py show r-001   # 평가셋 개수와 그 장소의 모델 입력(GMS 안 부름)
"""

import json
import os
import random
import re
import sys
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from functools import cache
from pathlib import Path

import mlflow
import numpy as np
from common import DIR, optimize, setup
from mlflow.entities import Feedback
from mlflow.genai.judges import make_judge
from mlflow.genai.scorers import scorer

from fit_ai import gms
from fit_ai.features import FEATURES
from fit_ai.place import persona as ps
from fit_ai.place.extract import SLOTS
from fit_ai.place.profile import Evidence
from fit_ai.place.rules import KEYWORD_CODES

NAME = "place-persona"
# judge도 이 모델로 한다. GMS 크레딧 때문에 gpt-5.5는 쓰지 않는다
REFLECTION_MODEL = "openai:/gpt-6.1-sol"
# 한 번 평가에 GMS 생성 1번이 든다(채점은 코드와 임베딩). val 전체 평가 한 번이 50번이다
MAX_METRIC_CALLS = 500
TEST_RUNS = 2
# GMS가 가끔 응답하지 않는다. judge 요청에는 시간 제한이 없어 이만큼 기다리고 다시 부른다
JUDGE_TIMEOUT = 150
JUDGE_TRIES = 3
# 크레딧을 줄이려 val은 slice마다 앞에서 이만큼만 쓴다(10 slice × 5 = 50곳)
VAL_PER_SLICE = 5
DATA = Path(__file__).parent / "data" / "persona.jsonl"
SPLITS = ("train", "val", "test")
# 반성 한 번에 보는 장소 수. 기본 3개면 장소 하나에만 맞춘 규칙이 생기기 쉽다(107)
REFLECTION_MINIBATCH = 6
# 평가 결과(장소별 출력·점수·이유). 사람 비교 표본을 여기서 뽑는다
OUT = DIR.parent / "prompt_opt"
# 지시문에 이만큼 긴 리뷰 구절이 그대로 있으면 평가셋을 외운 것으로 본다
LEAK_MIN = 10
# search에서 장소마다 섞는 같은 업종 다른 장소의 구절 수
SEARCH_NEG = 40
# 동시에 처리하는 장소 수. GEPA 쪽은 MLFLOW_GENAI_EVAL_MAX_WORKERS로 맞춘다
WORKERS = 16
EMBED_URL = os.environ.get("EMBED_URL")
# 리뷰 두 개 이상에 나온 (코드, 방향)은 그 방향 페르소나가 다뤄야 한다
COVER_MIN = 2

REFLECTION_TEMPLATE = """너는 프롬프트 개선 담당이다. 아래 지시문을 받은 작은 모델(gpt-4o-mini)이
음식점·카페·술집의 리뷰 근거를 읽고 "이 장소를 좋아할(또는 아쉬워할) 손님" 페르소나를
2~7개 만든다. 페르소나 문장은 추천 이유로 사용자 화면에 나간다.

현재 지시문:
```
<curr_param>
```

이 지시문으로 처리한 장소 입력, 모델 출력, 채점 피드백:
```
<side_info>
```

채점 기준:
- persona_rules(코드): 버려진 페르소나가 없는가, like true는 좋았어요·false는 아쉬웠어요
  근거가 있는 리뷰를 인용했는가, 리뷰 두 개 이상에 나온 특징을 그 방향 페르소나가 다뤘는가,
  name 2~4단어·description과 reason 각 3문장인가.
- search(임베딩 검색): 페르소나 문장은 벡터로 바뀌어 사용자가 자연어로 찾는 취향과 맞대어진다.
  이 장소 리뷰의 좋았어요 구절을 검색어로 넣었을 때 같은 업종 다른 장소의 구절보다 좋아할 손님
  페르소나에 더 가깝게 걸려야 한다. 근거의 메뉴·상황·분위기를 사람이 검색할 법한 풍부한
  자연어로 담을수록 오르고, 어느 가게에나 붙는 흐린 말이나 근거에 없는 내용은 다른 장소와
  겹쳐 점수를 깎는다. 피드백의 "검색에 약한 근거"가 잘 걸리지 않은 구절이다.

모델 출력 뒤에 붙는 코드 규칙(지시문으로 바꿀 수 없다):
- review_ids가 비었거나 입력에 없는 번호가 있으면 그 페르소나가 버려진다.
- 문장이 리뷰 원문과 연속 20자 이상 겹치거나 따옴표 안 구절이 원문에 있으면 버려진다.
- 개수가 2~7개를 벗어나면 다시 요청하고, 또 벗어나면 그 장소는 페르소나가 없다.

할 일:
1. 낮은 점수의 원인을 일반적인 오류 유형으로 묶는다. 장소 하나에만 해당하는 원인으로 보지 않는다.
2. 그 오류 유형을 막는 일반 규칙을 지시문에 반영한다. 맞게 동작하는 기존 규칙은 유지하고
   필요한 부분만 고치거나 더한다.
3. 새 지시문 전체를 ``` 블록 하나에 담아 출력한다.

제약:
- 위 장소의 메뉴·근거 문장·페르소나 이름을 지시문에 그대로, 또는 단어만 바꿔 넣지 않는다.
  예시가 필요하면 위 사례와 다른 새 장소로 쓴다.
- 특정 장소의 정답을 고정하는 규칙을 쓰지 않는다. 처음 보는 장소에도 통하는 원칙으로 쓴다.
- 예시는 모두 합쳐 10개 이하로 둔다.
- 근거에 없는 메뉴·시간대·동행·시설을 지어내게 하는 규칙을 쓰지 않는다. 문장은 화면에 나간다.
- 검색어를 나열하듯 단어를 늘어놓게 하지 않는다. 사람이 읽는 자연스러운 문장이어야 한다.
- 응답의 JSON 스키마는 실행할 때 따로 강제되므로 출력 형식을 길게 설명하지 않는다."""

JUDGE_INSTRUCTIONS = """너는 장소 페르소나 채점자다. {{ inputs }}의 place_input은 생성 모델이 받은 입력이다.
장소 요약(참고용), 두드러진 특징, 네이버 키워드 투표, 리뷰 번호(r1, r2 …)별 근거가 있다.
{{ outputs }}의 personas가 생성 결과이고, 각 페르소나는 name, description, reason, like,
review_ids(근거로 든 리뷰 번호)를 가진다. dropped는 코드 검사에서 버려진 페르소나라 채점하지 않는다.

페르소나마다 다음 네 항목을 통과·실패로 판정한다.
A. 뒷받침: description과 reason의 주장 하나하나를 그 페르소나의 review_ids에 든 리뷰 근거가
   뒷받침한다. 키워드 투표와 두드러진 특징은 보조 근거로 인정한다. 장소 요약의 업종·메뉴 이름은
   배경으로 써도 되지만, 요약에만 있는 사실을 손님이 겪은 평가처럼 쓰면 실패다.
B. 지어내기 없음: 입력 어디에도 없는 메뉴, 맛, 시간대, 동행, 공간, 가격, 감정을 사실처럼
   단정하지 않는다. "~일 것이다"처럼 짐작으로 쓴 것도 근거가 없으면 실패다.
C. 구체성: 이 장소의 메뉴나 방문 상황 근거를 들어, 다른 가게에도 그대로 붙는 흐린 설명이 아니다.
D. 겹침 없음: 같은 장소의 다른 페르소나와 손님 유형과 근거가 거의 같지 않다.

value는 통과한 (페르소나, 항목) 수를 전체 (페르소나 수 × 4)로 나눈 0~1 값이다.
personas가 비었으면 0이다.
rationale에는 실패한 것만 "이름 / 항목 / 이유" 한 줄씩 쓴다. 이유에는 어느 주장이 어느 근거와
어긋나는지 구체적으로 적는다. 모두 통과했으면 "모두 통과"라고 쓴다."""

_SENTENCE_END = re.compile(r"[.!?。](?=\s|$)")


def _evidence(row: dict) -> tuple[list[Evidence], dict[str, str]]:
    """(근거 행, 리뷰 번호 → 본문). 본문은 그 리뷰 구절을 이어 붙여 대신한다."""
    rows, bodies = [], {}
    for i, review in enumerate(row["reviews"], 1):
        rid = f"r{i}"
        for slot, code, direction, quote, text in review["items"]:
            rows.append(
                Evidence(
                    review_id=rid,
                    source=review["source"],
                    code=code,
                    direction=direction,
                    slot=slot,
                    quote=quote,
                    text=text,
                )
            )
        if review["source"] == "naver_text":
            bodies[rid] = " ".join(it[3] for it in review["items"])
    # 키워드만 있는 리뷰는 번호를 받지 않는다(build_messages가 개수로만 센다)
    for k, (kw, n) in enumerate(row["keywords"].items()):
        rows += [
            Evidence(
                review_id=f"k{k}-{j}",
                source="naver_keyword",
                code=KEYWORD_CODES[kw],
                direction=1,
                slot=None,
                quote=kw,
                text=None,
            )
            for j in range(n)
        ]
    return rows, bodies


def _features(row: dict) -> list[dict]:
    return [{"code": c, "label": True} for c in row["standout"]]


def _check(row: dict) -> None:
    """합성 데이터가 실제 파이프라인에서 나올 수 있는 모양인지."""
    rid = row["id"]
    if row["split"] not in SPLITS or not row["reviews"]:
        raise ValueError(f"{rid}: split이 틀렸거나 리뷰가 없다")
    if any(c not in FEATURES for c in row["standout"]):
        raise ValueError(f"{rid}: 없는 두드러진 특징 코드")
    if any(kw not in KEYWORD_CODES for kw in row["keywords"]):
        raise ValueError(f"{rid}: 코드 대응표에 없는 키워드")
    for review in row["reviews"]:
        source, items = review["source"], review["items"]
        if source not in ("naver_text", "app_text", "app_tag") or not items:
            raise ValueError(f"{rid}: 리뷰 출처가 틀렸거나 항목이 없다")
        for slot, code, direction, quote, text in items:
            ok = direction in (1, -1) and bool(quote)
            if source == "app_tag":
                ok = ok and slot is None and code in FEATURES and text is None
            else:  # 3단계 규칙: 그 칸의 코드면 text는 null, 코드가 없으면 text가 있다
                ok = ok and slot in SLOTS and (code is None) == bool(text)
                ok = ok and (code is None or code in SLOTS[slot])
            if not ok:
                raise ValueError(f"{rid}: 항목 모양이 3단계 규칙과 다르다 {quote}")


@cache
def load_all() -> dict[str, dict]:
    rows = [json.loads(line) for line in DATA.read_text(encoding="utf-8").splitlines()]
    for row in rows:
        _check(row)
    by_id = {r["id"]: r for r in rows}
    if len(by_id) != len(rows):
        raise ValueError("id가 겹친다")
    return by_id


def load(split: str | None = None) -> list[dict]:
    return [r for r in load_all().values() if split is None or r["split"] == split]


def _messages(row: dict) -> tuple[list[dict], dict[str, str], dict[str, str]]:
    evidence, bodies = _evidence(row)
    messages, ids = ps.build_messages(row["summary"], evidence, _features(row))
    return messages, ids, bodies


def _call(system: str, row: dict) -> dict | None:
    """검사를 통과한 personas와, 버려진 페르소나의 이름과 이유(dropped)."""
    messages, ids, bodies = _messages(row)
    messages[0] = {"role": "system", "content": system}

    def parse(resp: dict) -> dict:
        kept = ps.parse_personas(resp, ids, list(bodies.values()))
        names = {p["name"] for p in kept}
        reviews = "\n".join(bodies.values())
        dropped = []
        for p in resp["personas"]:
            if p["name"] in names:
                continue
            if not p["review_ids"] or any(r not in ids for r in p["review_ids"]):
                why = f"없는 리뷰 번호 {p['review_ids']}"
            else:
                fields = [
                    f
                    for f in ("name", "description", "reason")
                    if ps._copied(p[f], reviews)
                ]
                why = f"리뷰 원문을 옮겨 적음({', '.join(fields)})"
            dropped.append(f"{p['name']}: {why}")
        return {"personas": kept, "dropped": dropped}

    return gms.call_json(
        messages, parse, response_format=ps.RESPONSE_FORMAT, timeout=ps.TIMEOUT
    )


def predict(place: str, place_input: str) -> dict | None:
    """MLflow가 inputs 키를 인자로 넘긴다. place_input은 judge에 보여 주려고 둔 것이다."""
    system = mlflow.genai.load_prompt(f"prompts:/{NAME}@latest").format()
    return _call(system, load_all()[place])


def _sentences(text: str) -> int:
    return len(_SENTENCE_END.findall(text.strip()))


def rules(outputs: dict | None, row: dict) -> tuple[float, str]:
    """코드로 재는 점수와 이유. 버려짐·방향·특징 누락·형식 네 비율의 평균이다."""
    if outputs is None:
        return 0.0, "응답이 출력 검사(JSON, 개수 2~7개)를 두 번 다 통과하지 못했다"
    kept, dropped = outputs["personas"], outputs["dropped"]
    why = [f"버려짐: {d}" for d in dropped]
    # 리뷰 번호 → 그 리뷰의 (코드, 방향)과 방향
    marks: dict[str, set[tuple[str | None, int]]] = {}
    for i, review in enumerate(row["reviews"], 1):
        marks[f"r{i}"] = {(code, d) for _, code, d, _, _ in review["items"]}

    polarity_ok = 0
    for p in kept:
        want = 1 if p["like"] else -1
        if any(d == want for r in p["review_ids"] for _, d in marks[r]):
            polarity_ok += 1
        else:
            mood = "좋았어요" if p["like"] else "아쉬웠어요"
            why.append(
                f"방향: {p['name']}(like {p['like']})가 {mood} 근거 없는 리뷰만 들었다"
            )

    support: dict[tuple[str, int], list[str]] = defaultdict(list)
    for r, ms in marks.items():
        for code, d in ms:
            if code:
                support[(code, d)].append(r)
    needed = {k: rs for k, rs in support.items() if len(rs) >= COVER_MIN}
    covered = 0
    for (code, d), rs in needed.items():
        if any(p["like"] == (d == 1) and set(p["review_ids"]) & set(rs) for p in kept):
            covered += 1
        else:
            mood = "좋았어요" if d == 1 else "아쉬웠어요"
            why.append(
                f"빠짐: {FEATURES[code].label}({mood}, {', '.join(rs)})을 다룬 페르소나가 없다"
            )

    format_ok = 0
    for p in kept:
        bad = []
        if not 2 <= len(p["name"].split()) <= 4:
            bad.append("name이 2~4단어가 아니다")
        for f in ("description", "reason"):
            if _sentences(p[f]) != 3:
                bad.append(f"{f}가 {_sentences(p[f])}문장이다")
        if bad:
            why.append(f"형식: {p['name']}: {', '.join(bad)}")
        else:
            format_ok += 1

    n = len(kept)
    parts = [
        n / (n + len(dropped)) if n + len(dropped) else 0.0,
        polarity_ok / n if n else 0.0,
        covered / len(needed) if needed else 1.0,
        format_ok / n if n else 0.0,
    ]
    return sum(parts) / len(parts), "\n".join(why) or "모두 통과"


@scorer
def persona_rules(inputs, outputs) -> Feedback:
    score, why = rules(outputs, load_all()[inputs["place"]])
    return Feedback(value=score, rationale=why)


grounded = make_judge(
    name="grounded",
    instructions=JUDGE_INSTRUCTIONS,
    model=REFLECTION_MODEL,
    feedback_value_type=float,
    generate_rationale_first=True,
)


def _inputs(row: dict) -> dict:
    """judge가 생성 모델과 같은 입력을 보게 렌더링한 문장을 함께 넘긴다."""
    return {"place": row["id"], "place_input": _messages(row)[0][1]["content"]}


def _judge(inputs: dict, outputs: dict | None) -> tuple[float, str]:
    if outputs is None or not outputs["personas"]:
        return 0.0, "페르소나 없음"
    errors = []
    for _ in range(JUDGE_TRIES):
        # 시간이 지난 호출은 끊을 수 없어 스레드에 남겨 두고 새로 부른다
        fut = _judge_pool.submit(grounded, inputs=inputs, outputs=outputs)
        try:
            fb = fut.result(timeout=JUDGE_TIMEOUT)
        except FutureTimeout:
            errors.append(f"{JUDGE_TIMEOUT}초 동안 응답 없음")
            continue
        except Exception as e:  # noqa: BLE001 - 한 장소 때문에 최적화 전체가 멈추지 않게 한다
            errors.append(f"{type(e).__name__}: {e}")
            continue
        if fb.value is None:
            errors.append(f"judge 오류: {fb.error}")
            continue
        return float(fb.value), fb.rationale
    return 0.0, "judge 실패(0점 처리): " + "; ".join(errors)


_judge_pool = ThreadPoolExecutor(32)


@scorer(name="grounded", timeout=0)
def grounded_score(inputs, outputs) -> Feedback:
    """grounded judge를 시간 제한·재시도로 감싼다. MLflow 기본 제한(300초)에 걸리면 최적화가 멈춘다."""
    score, why = _judge(inputs, outputs)
    return Feedback(value=score, rationale=why)


def _encode(texts: list[str], query: bool) -> np.ndarray:
    if not EMBED_URL:
        from fit_ai import embedding

        f = embedding.encode_queries if query else embedding.encode_documents
        return np.array(f(texts))
    body = json.dumps({"texts": texts, "query": query}).encode()
    req = urllib.request.Request(EMBED_URL, body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return np.array(json.load(resp)["vectors"])


_query_cache: dict[str, np.ndarray] = {}


def _queries(texts: list[str]) -> np.ndarray:
    """검색어 벡터. 평가셋 구절은 정해져 있어 한 번만 인코딩한다."""
    new = [t for t in dict.fromkeys(texts) if t not in _query_cache]
    if new:
        _query_cache.update(zip(new, _encode(new, query=True), strict=True))
    return np.array([_query_cache[t] for t in texts])


def _group(row: dict) -> str:
    return row["summary"].split(". ")[1].split(",")[0]


def _phrases(row: dict) -> list[str]:
    """검색어로 쓰는 이 장소의 좋았어요 리뷰 구절."""
    return sorted({it[3] for rv in row["reviews"] for it in rv["items"] if it[2] == 1})


@cache
def _distractors(rid: str) -> tuple[str, ...]:
    """같은 업종 다른 장소의 좋았어요 구절 SEARCH_NEG개. 장소마다 고정한다."""
    row = load_all()[rid]
    pool = {
        q
        for r in load_all().values()
        if r["id"] != rid and _group(r) == _group(row)
        for q in _phrases(r)
    }
    pool = sorted(pool - set(_phrases(row)))
    return tuple(random.Random(rid).sample(pool, min(SEARCH_NEG, len(pool))))


def search(outputs: dict | None, row: dict) -> tuple[float, str]:
    """검색어마다 방해 구절보다 좋아할 손님 페르소나에 가깝게 걸린 비율의 평균(AUC)."""
    likes = [
        ps.persona_text(p) for p in (outputs or {}).get("personas", []) if p["like"]
    ]
    if not likes:
        return 0.0, "좋아할 손님 페르소나가 없다"
    pos, neg = _phrases(row), list(_distractors(row["id"]))
    sims = (_queries(pos + neg) @ _encode(likes, query=False).T).max(axis=1)
    wins = (sims[: len(pos), None] > sims[None, len(pos) :]).mean(axis=1)
    weak = [f"'{q}'({w:.0%})" for q, w in zip(pos, wins, strict=True) if w < 0.8]
    why = "검색에 약한 근거: " + ", ".join(weak) if weak else "모두 잘 걸림"
    return float(wins.mean()), why


@scorer(name="search", timeout=0)
def persona_search(inputs, outputs) -> Feedback:
    score, why = search(outputs, load_all()[inputs["place"]])
    return Feedback(value=score, rationale=why)


def evaluate(system: str, rows: list[dict], runs: int, label: str) -> None:
    """split·slice별 두 점수와, 둘 중 하나라도 0.8 미만인 장소의 이유를 출력한다.

    장소별 출력과 점수는 OUT/persona-{label}.jsonl에 남긴다.
    """
    by = defaultdict(list)  # (run, group) → (rules, search)
    low = defaultdict(list)

    def one(row):
        out = _call(system, row)
        return out, rules(out, row), search(out, row)

    OUT.mkdir(parents=True, exist_ok=True)
    log = (OUT / f"persona-{label}.jsonl").open("w", encoding="utf-8")
    with log, ThreadPoolExecutor(WORKERS) as pool:
        for run in range(runs):
            for row, (out, (rs, rwhy), (gs, gwhy)) in zip(
                rows, pool.map(one, rows), strict=True
            ):
                rec = {"id": row["id"], "run": run, "outputs": out}
                rec |= {"rules": rs, "rules_why": rwhy}
                rec |= {"search": gs, "search_why": gwhy}
                log.write(json.dumps(rec, ensure_ascii=False) + "\n")
                for group in ("all", row["split"], row["slice"]):
                    by[(run, group)].append((rs, gs))
                if min(rs, gs) < 0.8:
                    low[row["id"]].append(
                        f"run{run} rules {rs:.2f} search {gs:.2f}\n"
                        f"      {rwhy}\n      {gwhy}".replace("\n", "\n      ")
                    )
    print(
        "group               " + "  ".join(f"run{r} rules/search" for r in range(runs))
    )
    for g in dict.fromkeys(g for _, g in by):
        cells = []
        for r in range(runs):
            s = by[(r, g)]
            rs = sum(x for x, _ in s) / len(s)
            gs = sum(y for _, y in s) / len(s)
            cells.append(f"{rs:.3f} / {gs:.3f} (n={len(s)})")
        print(f"{g:<20}" + "  ".join(cells))
    print()
    for row in rows:
        for w in low.get(row["id"], []):
            print(f"[{row['split']}] {row['id']} {row['slice']}  {w}")
    log_run(label, system)


def log_run(label: str, system: str) -> None:
    """OUT/persona-{label}.jsonl을 MLflow run 하나로 올린다. 실행 회차는 step이다."""
    path = OUT / f"persona-{label}.jsonl"
    by = defaultdict(list)  # (run, group) → (rules, search)
    for line in path.read_text(encoding="utf-8").splitlines():
        rec = json.loads(line)
        row = load_all()[rec["id"]]
        for group in ("all", row["split"], row["slice"]):
            by[(rec["run"], group)].append((rec["rules"], rec["search"]))
    with mlflow.start_run(run_name=f"persona-{label}"):
        mlflow.log_text(system, "system.txt")
        mlflow.log_artifact(str(path))
        for (run, g), s in by.items():
            mlflow.log_metric(f"{g}/rules", sum(x for x, _ in s) / len(s), step=run)
            mlflow.log_metric(f"{g}/search", sum(y for _, y in s) / len(s), step=run)


def leaks(system: str) -> list[str]:
    """지시문에 그대로 들어간 평가셋 장소 이름과 리뷰 구절."""
    found = []
    for r in load():
        phrases = [r["summary"].split(". ")[0]] + [
            q
            for review in r["reviews"]
            for it in review["items"]
            for q in (it[3], it[4])
            if q and len(q) >= LEAK_MIN
        ]
        found += [f"{r['id']}: {q}" for q in phrases if q in system]
    return found


def report(system: str, label: str) -> None:
    """test 점수와 평가셋 외움 여부. test는 GEPA에 넘기지 않고 여기서만 잰다."""
    evaluate(system, load("test"), TEST_RUNS, label)
    print("평가셋에서 옮긴 구절:", leaks(system) or "없음")


def _val() -> list[dict]:
    seen = defaultdict(int)
    rows = []
    for r in load("val"):
        seen[r["slice"]] += 1
        if seen[r["slice"]] <= VAL_PER_SLICE:
            rows.append(r)
    return rows


def _records(rows: list[dict]) -> list[dict]:
    return [{"inputs": _inputs(r), "expectations": {}} for r in rows]


def show(rid: str | None) -> None:
    counts = defaultdict(int)
    for r in load():
        counts[(r["split"], r["slice"])] += 1
    for split in SPLITS:
        print(split, sum(n for (s, _), n in counts.items() if s == split))
    for (s, sl), n in sorted(counts.items()):
        print(f"  {s:<6}{sl:<20}{n}")
    if rid:
        print()
        print(_inputs(load_all()[rid])["place_input"])


if __name__ == "__main__":
    if sys.argv[1:2] == ["show"]:
        show(sys.argv[2] if len(sys.argv) > 2 else None)
        sys.exit()
    setup("prompt-opt")
    if sys.argv[1:2] == ["baseline"]:
        runs = int(sys.argv[2]) if len(sys.argv) > 2 else 1
        evaluate(ps._SYSTEM, load(), runs, "baseline")
        sys.exit()
    if sys.argv[1:2] == ["test"]:
        v = sys.argv[2]
        report(mlflow.genai.load_prompt(f"prompts:/{NAME}/{v}").format(), f"test-v{v}")
        sys.exit()
    result = optimize(
        NAME,
        ps._SYSTEM,
        predict,
        _records(load("train")),
        [persona_rules, persona_search],
        max_metric_calls=MAX_METRIC_CALLS,
        reflection_model=REFLECTION_MODEL,
        valset=_records(_val()),
        reflection_prompt_template=REFLECTION_TEMPLATE,
        reflection_minibatch_size=REFLECTION_MINIBATCH,
    )
    print(f"val 점수 {result.initial_eval_score} → {result.final_eval_score}")
    optimized = result.optimized_prompts[0]
    print(optimized.uri)
    for label, system in [("before", ps._SYSTEM), ("after", optimized.format())]:
        print(f"\n== test {label} ==")
        report(system, f"test-{label}")
