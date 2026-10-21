"""Garage(S3 호환)를 서명한 요청으로 다루는 도구(표준 라이브러리만 쓴다). 설계 7.4절.

호스트에는 S3 도구가 없고 Garage의 S3 포트는 호스트에 게시하지 않으므로, init-garage.sh·verify-data.sh·files-backup.sh가
python 이미지 컨테이너를 net-data에 붙여 이 파일을 표준 입력으로 실행한다: docker run --rm -i --network net-data python - <명령> ...
접속 정보는 환경변수다: S3_ENDPOINT(기본 http://garage:3900), S3_REGION(garage), S3_ACCESS_KEY, S3_SECRET_KEY.
키 값은 출력하지 않는다.

명령
  put BUCKET KEY TEXT          객체를 올린다. 첫 줄에 `HTTP <코드>`를 출력한다
  get BUCKET KEY               객체를 읽는다. 첫 줄에 `HTTP <코드>`, 이어서 본문
  anon-get URL [HOST]          서명 없이 읽는다(웹 엔드포인트나 S3 API의 익명 접근 시험). 첫 줄에 `HTTP <코드>`
  delete BUCKET KEY            객체를 지운다
  lifecycle-set BUCKET         pending/ 접두사의 객체와 끝나지 않은 멀티파트를 1일 뒤 지운다
  lifecycle-get BUCKET         수명주기 설정을 읽는다
  tar-stdout BUCKET PREFIX     PREFIX 아래 모든 객체를 tar로 표준 출력에 낸다(사진 백업)
"""
import datetime
import hashlib
import hmac
import io
import os
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ENDPOINT = os.environ.get("S3_ENDPOINT", "http://garage:3900")
REGION = os.environ.get("S3_REGION", "garage")
ACCESS = os.environ.get("S3_ACCESS_KEY", "")
SECRET = os.environ.get("S3_SECRET_KEY", "")
HOST = urllib.parse.urlparse(ENDPOINT).netloc

LIFECYCLE = (
    "<LifecycleConfiguration><Rule><ID>pending-expire</ID><Status>Enabled</Status>"
    "<Filter><Prefix>pending/</Prefix></Filter><Expiration><Days>1</Days></Expiration>"
    "<AbortIncompleteMultipartUpload><DaysAfterInitiation>1</DaysAfterInitiation></AbortIncompleteMultipartUpload>"
    "</Rule></LifecycleConfiguration>"
)


def _hmac(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def request(method, path, query=None, body=b""):
    """SigV4(헤더 서명, path-style)로 서명해 보낸다. (상태 코드, 본문 바이트 읽는 응답)을 돌려준다."""
    query = query or {}
    now = datetime.datetime.now(datetime.timezone.utc)
    amzdate, datestamp = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()
    canonical_query = "&".join(
        f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}" for k, v in sorted(query.items())
    )
    canonical_path = urllib.parse.quote(path, safe="/-_.~")
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical = "\n".join(
        [
            method,
            canonical_path,
            canonical_query,
            f"host:{HOST}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amzdate}\n",
            signed_headers,
            payload_hash,
        ]
    )
    scope = f"{datestamp}/{REGION}/s3/aws4_request"
    to_sign = f"AWS4-HMAC-SHA256\n{amzdate}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    key = _hmac(_hmac(_hmac(_hmac(("AWS4" + SECRET).encode(), datestamp), REGION), "s3"), "aws4_request")
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    headers = {
        "x-amz-date": amzdate,
        "x-amz-content-sha256": payload_hash,
        "Authorization": f"AWS4-HMAC-SHA256 Credential={ACCESS}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
    }
    url = ENDPOINT + canonical_path + ("?" + canonical_query if query else "")
    req = urllib.request.Request(url, data=body if method in ("PUT", "POST") else None, method=method, headers=headers)
    try:
        return urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        return e


def status_and_body(resp):
    return resp.getcode(), resp.read()


def list_keys(bucket, prefix):
    token = None
    while True:
        query = {"list-type": "2", "prefix": prefix}
        if token:
            query["continuation-token"] = token
        code, data = status_and_body(request("GET", f"/{bucket}", query))
        if code != 200:
            raise SystemExit(f"목록 조회 실패(HTTP {code})")
        root = ET.fromstring(data)
        ns = {"s": root.tag.split("}")[0].strip("{")} if "}" in root.tag else {}
        tag = (lambda n: f"s:{n}") if ns else (lambda n: n)
        for item in root.findall(tag("Contents"), ns):
            yield item.find(tag("Key"), ns).text
        if (root.findtext(tag("IsTruncated"), namespaces=ns) or "false") != "true":
            return
        token = root.findtext(tag("NextContinuationToken"), namespaces=ns)


def tar_stdout(bucket, prefix):
    out = sys.stdout.buffer
    count = 0
    with tarfile.open(fileobj=out, mode="w|") as tar:
        for key in list_keys(bucket, prefix):
            code, data = status_and_body(request("GET", f"/{bucket}/{key}"))
            if code != 200:
                raise SystemExit(f"{key} 읽기 실패(HTTP {code})")
            info = tarfile.TarInfo(name=key)
            info.size = len(data)
            info.mtime = int(datetime.datetime.now().timestamp())
            tar.addfile(info, io.BytesIO(data))
            count += 1
    print(f"객체 {count}개", file=sys.stderr)


def main(argv):
    cmd = argv[0] if argv else ""
    if cmd == "put":
        resp = request("PUT", f"/{argv[1]}/{argv[2]}", body=argv[3].encode())
        print(f"HTTP {resp.getcode()}")
    elif cmd == "get":
        code, data = status_and_body(request("GET", f"/{argv[1]}/{argv[2]}"))
        print(f"HTTP {code}")
        print(data.decode("utf-8", errors="replace"))
    elif cmd == "anon-get":
        headers = {"Host": argv[2]} if len(argv) > 2 else {}
        try:
            resp = urllib.request.urlopen(urllib.request.Request(argv[1], headers=headers), timeout=30)
            print(f"HTTP {resp.getcode()}")
            print(resp.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code}")
    elif cmd == "delete":
        print(f"HTTP {request('DELETE', f'/{argv[1]}/{argv[2]}').getcode()}")
    elif cmd == "lifecycle-set":
        print(f"HTTP {request('PUT', f'/{argv[1]}', {'lifecycle': ''}, LIFECYCLE.encode()).getcode()}")
    elif cmd == "lifecycle-get":
        code, data = status_and_body(request("GET", f"/{argv[1]}", {"lifecycle": ""}))
        print(f"HTTP {code}")
        print(data.decode("utf-8", errors="replace"))
    elif cmd == "tar-stdout":
        tar_stdout(argv[1], argv[2])
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
