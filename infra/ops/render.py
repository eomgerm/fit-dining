"""B의 감시 스택이 뜨기 전에 환경변수에서 설정 파일을 만든다(설계 9.3절). compose의 ops-init 서비스가 실행한다.

A의 주소, `/_ops` 자격, Mattermost 웹훅은 서버마다 다르고 비밀이다. Prometheus는 설정에 환경변수를 풀어 주지 않고 Alertmanager는 웹훅 주소를 파일로만 읽는다.
그래서 이 값들만 /generated에 만들고 나머지 설정은 저장소 파일 그대로 쓴다.

입력(환경변수, 값은 출력하지 않는다)
  PROD_HOST, DEV_HOST           A의 prod·dev 호스트 이름(바깥에서 보는 주소). B가 이 주소로 A를 프로브한다.
  OPS_BASIC_AUTH_USER           A의 /_ops 경로 접근 자격. 비밀번호 해시는 A의 edge.env(OPS_BASIC_AUTH_HASH)에 있다.
  OPS_BASIC_AUTH_PASSWORD
  MATTERMOST_WEBHOOK_URL        알림을 받는 Mattermost 수신 웹훅
  PROBE_INSECURE_TLS            1이면 프로브가 인증서 검증을 건너뛴다. 시험 전용이다(운영에서는 설정하지 않는다)
  BLACKBOX_TEMPLATE             blackbox 설정 견본 경로(기본 /blackbox.yml)
출력(/generated, 기본값. GENERATED_DIR로 바꾼다)
  targets/a-probes.yml          blackbox가 A를 보게 하는 Prometheus file_sd 대상(모듈은 라벨 module)
  blackbox.yml                  견본의 @@OPS_BASIC_AUTH_USER@@를 채운 blackbox 설정
  secrets/mattermost_url, secrets/ops_password
"""
import os
import pathlib
import re
import sys

HOST = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")
URL = re.compile(r"^https?://[^\s'\"]+$")
USER = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def fail(msg: str) -> None:
    print(f"FAIL {msg}", file=sys.stderr)
    sys.exit(1)


def need(name: str) -> str:
    value = os.environ.get(name, "")
    if not value or "REPLACE_ME" in value:
        fail(f"{name}이(가) 비었거나 자리표시자(REPLACE_ME)다")
    return value


def write(path: pathlib.Path, text: str) -> None:
    """임시 파일에 쓴 뒤 이름을 바꿔 넣는다. 읽는 쪽(nobody)이 읽을 수 있게 0644다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.chmod(0o644)
    tmp.replace(path)
    print(f"만들었다: {path}")


def probes(prod: str, dev: str) -> str:
    rows = [
        (f"https://{prod}/healthz", "a-healthz", "http_2xx"),
        (f"https://{prod}/", "a-fe", "http_2xx"),
        (f"{prod}:80", "a-tcp-80", "tcp_connect"),
        (f"{prod}:443", "a-tcp-443", "tcp_connect"),
        (f"{prod}:443", "a-tls-prod", "tcp_tls"),
        (f"{dev}:443", "a-tls-dev", "tcp_tls"),
        (f"https://{prod}/_ops/prometheus/healthy", "a-prometheus", "http_ops"),
        (f"https://{prod}/_ops/alertmanager/healthy", "a-alertmanager", "http_ops"),
    ]
    return "".join(f'- targets: ["{t}"]\n  labels:\n    probe: {p}\n    module: {m}\n' for t, p, m in rows)


def main() -> None:
    out = pathlib.Path(os.environ.get("GENERATED_DIR", "/generated"))
    prod, dev = need("PROD_HOST"), need("DEV_HOST")
    for name, value in (("PROD_HOST", prod), ("DEV_HOST", dev)):
        if not HOST.match(value):
            fail(f"{name}은(는) 호스트 이름이어야 한다")
    user, password = need("OPS_BASIC_AUTH_USER"), need("OPS_BASIC_AUTH_PASSWORD")
    if not USER.match(user):
        fail("OPS_BASIC_AUTH_USER는 영문, 숫자, ._-만 쓴다")
    if not re.match(r"^[A-Za-z0-9._~-]{16,}$", password):
        fail("OPS_BASIC_AUTH_PASSWORD는 영문, 숫자, ._~- 만 쓴 16자 이상이어야 한다")
    if not URL.match(need("MATTERMOST_WEBHOOK_URL")):
        fail("MATTERMOST_WEBHOOK_URL은 http(s):// 주소여야 한다")
    template = pathlib.Path(os.environ.get("BLACKBOX_TEMPLATE", "/blackbox.yml")).read_text(encoding="utf-8")
    if "@@OPS_BASIC_AUTH_USER@@" not in template:
        fail("blackbox 견본에 @@OPS_BASIC_AUTH_USER@@ 자리가 없다")
    conf = template.replace("@@OPS_BASIC_AUTH_USER@@", user)
    if os.environ.get("PROBE_INSECURE_TLS") == "1":
        conf = conf.replace("insecure_skip_verify: false", "insecure_skip_verify: true")
    write(out / "targets" / "a-probes.yml", probes(prod, dev))
    write(out / "blackbox.yml", conf)
    write(out / "secrets" / "mattermost_url", os.environ["MATTERMOST_WEBHOOK_URL"])
    write(out / "secrets" / "ops_password", password)


if __name__ == "__main__":
    main()
