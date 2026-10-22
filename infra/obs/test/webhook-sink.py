"""시험용 Mattermost 웹훅 대역(infra/obs/test, infra/ops/test). 0.0.0.0에서 POST를 받고 요청마다 {"path": ..., "body": ...}를 한 줄씩 적는다.
Alertmanager가 보내는 Slack 형식 JSON을 그대로 body 문자열에 담는다(경로로 수신자 main(/hook)과 dev(/hook-dev)를 구분한다).

사용: python webhook-sink.py <포트> <출력 파일>
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

port, out = int(sys.argv[1]), sys.argv[2]


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8", errors="replace")
        with open(out, "a", encoding="utf-8") as f:
            f.write(json.dumps({"path": self.path, "body": body}, ensure_ascii=False) + "\n")
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, fmt, *args):
        pass


HTTPServer(("0.0.0.0", port), Handler).serve_forever()
