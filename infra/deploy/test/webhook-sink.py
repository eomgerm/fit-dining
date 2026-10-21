"""시험용 Mattermost 웹훅 대역(infra/deploy/test). POST 본문을 파일에 한 줄씩 적는다.

사용: python webhook-sink.py <포트> <출력 파일>
"""
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

port, out = int(sys.argv[1]), sys.argv[2]


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8", errors="replace")
        with open(out, "a", encoding="utf-8") as f:
            f.write(body + "\n")
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, fmt, *args):
        pass


HTTPServer(("127.0.0.1", port), Handler).serve_forever()
