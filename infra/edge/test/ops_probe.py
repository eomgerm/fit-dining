"""엣지의 /_ops 경로를 compose 망 안의 컨테이너(고정 IP)에서 부른다(infra/edge/test). B의 IP(remote_ip)를 흉내 내려는 것이다.

사용: python ops_probe.py <엣지 IP> <SNI 호스트> <경로> [사용자:비밀번호]
출력 한 줄: <상태 코드> www-authenticate=<yes|no> body=<본문 앞부분>. 인증서는 시험용 내부 CA라 검증하지 않는다.
"""
import base64
import socket
import ssl
import sys

ip, host, path = sys.argv[1:4]
auth = sys.argv[4] if len(sys.argv) > 4 else ""
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

request = f"GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n"
if auth:
    request += "Authorization: Basic " + base64.b64encode(auth.encode()).decode() + "\r\n"
raw = socket.create_connection((ip, 443), timeout=15)
conn = ctx.wrap_socket(raw, server_hostname=host)
conn.sendall((request + "\r\n").encode())
data = b""
while True:
    chunk = conn.recv(65536)
    if not chunk:
        break
    data += chunk
head, _, body = data.partition(b"\r\n\r\n")
lines = head.decode("latin-1").split("\r\n")
status = lines[0].split(" ")[1]
www = "yes" if any(line.lower().startswith("www-authenticate:") for line in lines[1:]) else "no"
print(f"{status} www-authenticate={www} body={body.decode('utf-8', 'replace').strip()[:80]!r}")
