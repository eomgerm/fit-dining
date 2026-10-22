"""시험용 가짜 지표 서버(infra/obs/test, infra/ops/test). 디렉터리 안의 파일을 Prometheus 지표 형식으로 내준다.
시험이 파일을 바꾸면 다음 수집부터 값이 바뀐다. 파일이 없으면 404라 수집이 실패(up=0)한다.
예: BE 흉내는 <dir>/actuator/prometheus, Caddy 흉내는 <dir>/metrics.

사용: python mock-exporter.py <포트> <디렉터리>
"""
import pathlib
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

port, root = int(sys.argv[1]), pathlib.Path(sys.argv[2])


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        f = (root / self.path.split("?")[0].lstrip("/")).resolve()
        if root.resolve() not in f.parents or not f.is_file():
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        data = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass


HTTPServer(("0.0.0.0", port), Handler).serve_forever()
