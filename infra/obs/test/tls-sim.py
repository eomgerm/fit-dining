"""시험용 TLS 서버(infra/obs/test). 주어진 인증서로 핸드셰이크만 받고 닫는다. 일일 점검 요약의 인증서 잔여일 읽기를 시험하려는 것이다.

사용: python tls-sim.py <포트> <인증서 PEM> <개인키 PEM>
"""
import socket
import ssl
import sys
import threading

port, cert, key = int(sys.argv[1]), sys.argv[2], sys.argv[3]
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(cert, key)


def handle(conn):
    try:
        with ctx.wrap_socket(conn, server_side=True) as tls:
            tls.recv(1)
    except (OSError, ssl.SSLError):
        pass


srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("0.0.0.0", port))
srv.listen(16)
while True:
    conn, _ = srv.accept()
    threading.Thread(target=handle, args=(conn,), daemon=True).start()
