"""시험용 가짜 AI API. 실제 ai/server/main.py처럼 `server.main:app`이고 /healthz가 200이다."""

from fastapi import FastAPI

app = FastAPI()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
