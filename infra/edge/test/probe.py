"""스트리밍 응답의 첫 본문 바이트와 마지막 바이트가 도착한 시간을 잰다(infra/edge/test).

사용: python probe.py <포트> <호스트> <경로>
출력: first=<초> total=<초>. 인증서는 시험용 내부 CA라 검증하지 않는다. 압축을 받는 상태(Accept-Encoding)로 요청한다.
"""
import socket
import ssl
import sys
import time

port, host, path = int(sys.argv[1]), sys.argv[2], sys.argv[3]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

start = time.monotonic()
raw = socket.create_connection(("127.0.0.1", port), timeout=30)
conn = ctx.wrap_socket(raw, server_hostname=host)
conn.sendall(f"GET {path} HTTP/1.1\r\nHost: {host}\r\nAccept-Encoding: gzip\r\nConnection: close\r\n\r\n".encode())

buf = b""
first = None
while True:
    data = conn.recv(65536)
    if not data:
        break
    buf += data
    if first is None and b"\r\n\r\n" in buf and len(buf.split(b"\r\n\r\n", 1)[1]) > 0:
        first = time.monotonic() - start
total = time.monotonic() - start
print(f"first={first if first is not None else total:.2f} total={total:.2f}")
