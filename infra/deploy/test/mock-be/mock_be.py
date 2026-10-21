"""시험용 목 BE(infra/deploy/test). 이미지를 만들 때 정한 MOCK_SHA와 MOCK_MODE로 동작한다.

모드
  ok            정상
  unready       준비 상태가 UP이 되지 않는다(배포가 새 색을 치워야 한다)
  proxy-fail    엣지(X-Forwarded-For가 붙은 요청)를 거치면 버전 조회가 500이다(엣지 전환 뒤 확인이 실패해야 한다)
  migrate-fail  마이그레이션 컨테이너(SPRING_PROFILES_ACTIVE=migrate)가 실패한다
  fallback      검색 응답에 X-Fallback 헤더를 붙인다(Modal 폴백 표시, BE 계약 #17)
SPRING_PROFILES_ACTIVE=migrate이면 서버를 띄우지 않고 마이그레이션을 흉내 낸 뒤 끝난다(BE 계약 #9).
공개 포트 8080(/healthz, /api/v1/version, /api/v1/search), 관리 포트 8081(/actuator/health/readiness).
"""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SHA = os.environ["MOCK_SHA"]
MODE = os.environ.get("MOCK_MODE", "ok")

if os.environ.get("SPRING_PROFILES_ACTIVE") == "migrate":
    if MODE == "migrate-fail":
        print("migration failed", file=sys.stderr)
        sys.exit(1)
    print("migrated")
    sys.exit(0)


class Base(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def reply(self, status, body, ctype="text/plain; charset=utf-8", headers=()):
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for key, value in headers:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass


class App(Base):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/healthz":
            self.reply(200, "ok")
        elif path == "/api/v1/version":
            if MODE == "proxy-fail" and self.headers.get("X-Forwarded-For"):
                self.reply(500, "proxy-fail")
            else:
                self.reply(200, json.dumps({"sha": SHA, "builtAt": "2026-10-20T00:00:00Z"}), "application/json", [("X-App-Version", SHA)])
        elif path == "/api/v1/search":
            headers = [("X-Fallback", "modal-disabled")] if MODE == "fallback" else []
            self.reply(200, "[]", "application/json", headers)
        else:
            self.reply(404, "not found")


class Management(Base):
    def do_GET(self):
        if self.path.split("?", 1)[0] == "/actuator/health/readiness":
            if MODE == "unready":
                self.reply(503, '{"status":"OUT_OF_SERVICE"}', "application/json")
            else:
                self.reply(200, '{"status":"UP"}', "application/json")
        else:
            self.reply(404, "not found")


threading.Thread(target=ThreadingHTTPServer(("", 8081), Management).serve_forever, daemon=True).start()
ThreadingHTTPServer(("", 8080), App).serve_forever()
