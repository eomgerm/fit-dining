"""AI API 앱의 공통 동작을 확인한다.

기능과 상관없는 오류 응답(형식 오류, 없는 주소, 예상 못 한 예외)을 본다. 앱에 시험용
엔드포인트를 더해서 본다. 검색 엔드포인트와 상태 확인은 test_search.py에서 본다.
"""

import logging

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.common import Body, Dependencies

SECRET = "비밀 원문"


class Echo(Body):
    text: str


def client(*, raise_server_exceptions: bool = False) -> TestClient:
    app = create_app(Dependencies())

    @app.post("/echo")
    def echo(body: Echo) -> dict:
        return {"text": body.text}

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError(SECRET)

    return TestClient(app, raise_server_exceptions=raise_server_exceptions)


class TestErrors:
    """오류 응답"""

    def test_unknown_field_is_invalid_request(self) -> None:
        """오류_모르는속성이있으면_입력을되풀이하지않는400INVALID_REQUEST다"""
        response = client().post("/echo", json={"text": "조용한 곳", "extra": 1})

        assert response.status_code == 400
        assert response.headers["content-type"] == "application/problem+json"
        assert response.json()["code"] == "INVALID_REQUEST"
        assert "조용한 곳" not in response.text

    @pytest.mark.parametrize("content", [b"{", b'{"text": "\xff\xfe"}'])
    def test_unreadable_body_is_invalid_request(self, content: bytes) -> None:
        """오류_본문을JSON으로읽지못하면_HTTP_ERROR가아니라INVALID_REQUEST다"""
        response = client().post(
            "/echo", content=content, headers={"content-type": "application/json"}
        )

        assert response.status_code == 400
        assert response.json()["code"] == "INVALID_REQUEST"

    def test_unknown_path(self) -> None:
        """오류_없는주소면_404ProblemDetail이다"""
        response = client().get("/v1/unknown")

        assert response.status_code == 404
        assert response.headers["content-type"] == "application/problem+json"
        assert response.json()["code"] == "HTTP_ERROR"

    def test_unexpected_error_hides_message(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """오류_예상못한예외면_500이고응답과로그에는예외종류만남긴다"""
        caplog.set_level(logging.INFO)

        response = client().get("/boom")

        assert response.status_code == 500
        assert response.headers["content-type"] == "application/problem+json"
        assert response.json()["code"] == "INTERNAL_ERROR"
        assert SECRET not in response.text
        assert "RuntimeError" in caplog.text
        assert SECRET not in caplog.text

    def test_unexpected_error_is_not_reraised(self) -> None:
        """오류_예상못한예외면_다시던지지않는다"""
        # 다시 던지면 uvicorn이 예외 메시지(입력이 섞일 수 있다)를 traceback으로 남긴다.
        response = client(raise_server_exceptions=True).get("/boom")

        assert response.status_code == 500
        assert response.json()["code"] == "INTERNAL_ERROR"
