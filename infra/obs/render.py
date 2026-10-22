"""관측 스택이 뜨기 전에 환경변수에서 설정 파일을 만든다(설계 9절). compose의 obs-init 서비스가 실행한다.

Prometheus는 설정 파일에 환경변수를 풀어 주지 않고 Alertmanager는 웹훅 주소를 파일(api_url_file)로만 읽는다.
그래서 값이 서버마다 다른 것(B의 주소, Mattermost 웹훅)만 이 스크립트가 /generated에 만들고 나머지 설정은 저장소 파일 그대로 쓴다.

입력(환경변수, 값은 출력하지 않는다)
  B_IP                          B 서버의 주소(공인 IP나 호스트 이름). A가 TCP 22로 B에 닿는지 본다.
  MATTERMOST_WEBHOOK_URL        prod와 A·B 알림을 받는 Mattermost 수신 웹훅
  MATTERMOST_WEBHOOK_URL_DEV    dev 알림을 받는 웹훅(같은 주소를 써도 된다)
출력(/generated, 기본값. GENERATED_DIR로 바꾼다)
  targets/vault-ssh.yml         blackbox가 B의 22번 포트를 보게 하는 Prometheus file_sd 대상
  secrets/mattermost_url        Alertmanager의 api_url_file
  secrets/mattermost_url_dev
"""
import os
import pathlib
import re
import sys

HOST = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")
URL = re.compile(r"^https?://[^\s'\"]+$")


def fail(msg: str) -> None:
    print(f"FAIL {msg}", file=sys.stderr)
    sys.exit(1)


def need(name: str) -> str:
    value = os.environ.get(name, "")
    if not value or "REPLACE_ME" in value:
        fail(f"{name}이(가) 비었거나 자리표시자(REPLACE_ME)다")
    return value


def write(path: pathlib.Path, text: str) -> None:
    """임시 파일에 쓴 뒤 이름을 바꿔 넣는다(읽는 쪽이 쓰다 만 파일을 보지 않게). Alertmanager(nobody)가 읽을 수 있게 0644다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.chmod(0o644)
    tmp.replace(path)
    print(f"만들었다: {path}")


def main() -> None:
    out = pathlib.Path(os.environ.get("GENERATED_DIR", "/generated"))
    b_ip = need("B_IP")
    if not HOST.match(b_ip):
        fail("B_IP는 IP 주소나 호스트 이름이어야 한다")
    for name in ("MATTERMOST_WEBHOOK_URL", "MATTERMOST_WEBHOOK_URL_DEV"):
        if not URL.match(need(name)):
            fail(f"{name}은(는) http(s):// 주소여야 한다")
    write(
        out / "targets" / "vault-ssh.yml",
        f'- targets: ["{b_ip}:22"]\n  labels:\n    probe: vault-ssh\n    target_site: B\n',
    )
    write(out / "secrets" / "mattermost_url", os.environ["MATTERMOST_WEBHOOK_URL"])
    write(out / "secrets" / "mattermost_url_dev", os.environ["MATTERMOST_WEBHOOK_URL_DEV"])


if __name__ == "__main__":
    main()
