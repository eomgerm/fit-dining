"""시험용 목 BE·FE(infra/edge/test). MOCK_KIND(be, fe)와 MOCK_NAME(blue, green, dev)으로 정해진다.

실제 서비스를 흉내 내는 최소한만 한다: 헬스, 색 표시, 받은 헤더 되돌리기, 본문 끝까지 읽기,
FE의 스트리밍 응답과 서버 쪽 BE 호출(BE_INTERNAL_URL).
"""
import os
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KIND = os.environ["MOCK_KIND"]
NAME = os.environ["MOCK_NAME"]
APP_ENV = os.environ.get("APP_ENV", "dev")
BE_INTERNAL_URL = os.environ.get("BE_INTERNAL_URL", "")
PORT = 3000 if KIND == "fe" else 8080

PAGE = (
    '<!doctype html><html><head><link rel="manifest" href="/manifest.webmanifest">'
    '<script src="/_next/static/chunks/app-1a2b3c4d.js" defer></script>'
    '<script src="/_next/static/chunks/fe-only.js" defer></script></head>'
    "<body>mock-fe {name} {env}</body></html>"
)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def reply(self, status, body, ctype="text/plain; charset=utf-8", headers=()):
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if KIND == "fe":
            self.send_header("X-Powered-By", "Next.js")  # Caddy가 지우는지 본다
        for key, value in headers:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def echo(self):
        return "\n".join(
            [
                f"name={NAME}",
                f"cookie={self.headers.get('Cookie', '')}",
                f"xff={self.headers.get('X-Forwarded-For', '')}",
                f"proto={self.headers.get('X-Forwarded-Proto', '')}",
                f"host={self.headers.get('Host', '')}",
            ]
        )

    def drain_body(self):
        remaining = int(self.headers.get("Content-Length", 0))
        while remaining > 0:
            chunk = self.rfile.read(min(65536, remaining))
            if not chunk:
                break
            remaining -= len(chunk)

    def do_POST(self):
        self.drain_body()
        self.reply(200, "ok")

    do_PUT = do_POST

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if KIND == "be":
            self.be(path)
        else:
            self.fe(path)

    def be(self, path):
        if path == "/healthz":
            self.reply(200, f"ok {NAME}")
        elif path == "/api/v1/version":
            self.reply(200, f'{{"color":"{NAME}"}}', "application/json", [("X-App-Version", NAME)])
        elif path == "/api/echo":
            self.reply(200, self.echo())
        else:
            self.reply(404, "not found")

    def fe(self, path):
        if path == "/fe-healthz":
            self.reply(200, f"ok {NAME}")
        elif path == "/config.json":
            self.reply(200, f'{{"env":"{APP_ENV}"}}', "application/json")
        elif path in ("/sw.js", "/manifest.webmanifest") or path.startswith("/icons/"):
            self.reply(200, f"public {path}", "application/octet-stream", [("Cache-Control", "public, max-age=0")])
        elif path == "/_next/static/chunks/fe-only.js":
            # 풀에 없는 자산은 FE가 대신 응답한다
            self.reply(200, f"fe-only {NAME}", "text/javascript", [("Cache-Control", "public, max-age=31536000, immutable")])
        elif path.startswith("/_next/static/"):
            self.reply(404, "not found")
        elif path == "/echo":
            self.reply(200, self.echo())
        elif path == "/ssr-probe":
            # 서버 쪽 호출: BE_INTERNAL_URL(Caddy 내부 리스너)을 거쳐 활성 색 BE의 색을 읽는다
            with urllib.request.urlopen(BE_INTERNAL_URL + "/api/v1/version", timeout=5) as r:
                self.reply(200, f"be={r.headers.get('X-App-Version')}")
        elif path == "/stream":
            self.stream()
        else:
            self.reply(
                200,
                PAGE.format(name=NAME, env=APP_ENV),
                "text/html; charset=utf-8",
                [("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate")],
            )

    def stream(self):
        # 첫 덩어리를 보낸 뒤 1.5초 있다가 나머지를 보낸다. Caddy가 모아서 한 번에 내보내면 첫 바이트가 늦다
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        def chunk(data):
            self.wfile.write(b"%x\r\n" % len(data) + data + b"\r\n")
            self.wfile.flush()

        chunk(b"<!-- first -->" + b"x" * 4096)
        time.sleep(1.5)
        chunk(b"<!-- last -->")
        self.wfile.write(b"0\r\n\r\n")

    def log_message(self, fmt, *args):
        pass


ThreadingHTTPServer(("", PORT), Handler).serve_forever()
