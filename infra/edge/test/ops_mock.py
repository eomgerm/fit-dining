"""시험용 감시 체계 대역(infra/edge/test). A의 Prometheus와 Alertmanager처럼 /-/healthy에만 200을 주고 나머지는 본문이 있는 404를 준다.
엣지가 /_ops 요청을 /-/healthy로만 보내는지(그 밖의 경로는 upstream에 닿지 않는지) 본문으로 구분하려는 것이다.

사용: python ops_mock.py <포트> <이름>
"""
import http.server
import sys

port, name = int(sys.argv[1]), sys.argv[2]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        ok = self.path == "/-/healthy"
        body = f"{name} is Healthy.\n" if ok else f"{name} upstream: not found {self.path}\n"
        data = body.encode()
        self.send_response(200 if ok else 404)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass


http.server.HTTPServer(("0.0.0.0", port), Handler).serve_forever()
