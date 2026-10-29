"""GPU 서버에서 arctic-ko 임베딩만 해 주는 HTTP 서버. 127.0.0.1에만 열고 SSH 터널로 쓴다.

POST /encode {"texts": [...], "query": bool} -> {"vectors": [[...], ...]}
인코딩 규칙은 ai/src/fit_ai/embedding.py와 같다(query: 접두사, L2 정규화, 소수 6자리).
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_ID = "dragonkue/snowflake-arctic-embed-l-v2.0-ko"
REVISION = "55ec6e9358a56d56af759bc8372e970caf8c305f"
QUERY_PREFIX = "query: "

model = SentenceTransformer(MODEL_ID, revision=REVISION, device="cuda")
lock = Lock()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        texts = [QUERY_PREFIX + t if body.get("query") else t for t in body["texts"]]
        with lock:
            vecs = np.asarray(model.encode(texts, batch_size=64), dtype=np.float64)
        vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
        out = json.dumps({"vectors": np.round(vecs, 6).tolist()}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
