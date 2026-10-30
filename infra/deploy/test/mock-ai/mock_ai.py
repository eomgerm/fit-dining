"""시험용 목 AI API(infra/deploy/test). 이미지를 만들 때 정한 MOCK_SHA와 MOCK_MODE로 동작한다.

모드
  ok       /healthz가 200이다
  unready  /healthz가 503이다(저장소나 임베딩에 연결하지 못한 AI API. 배포가 직전 이미지로 돌려야 한다)
포트 8000(/healthz, /v1/search). 응답 본문은 ai/server/app.py의 모양을 따른다.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SHA = os.environ["MOCK_SHA"]
MODE = os.environ.get("MOCK_MODE", "ok")


class App(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/healthz":
            if MODE == "unready":
                self.reply(503, {"code": "NOT_READY", "message": "AI 서비스가 준비되지 않았다"})
            else:
                self.reply(200, {"status": "ok"})
        else:
            self.reply(404, {"code": "HTTP_ERROR", "message": "요청을 처리할 수 없다"})


ThreadingHTTPServer(("", 8000), App).serve_forever()
