#!/usr/bin/env python3
"""서버의 /etc/fit/*.env에 환경변수를 넣고, 바꾸고, 지우고, 상태를 본다.

값은 화면, 셸 기록, 명령 인자, 출력 어디에도 남기지 않는다(출력은 키 이름과 글자 수뿐이다).

  sudo python3 envset.py list                                      # 이 서버의 env 파일과 키 개수, REPLACE_ME 개수
  sudo python3 envset.py status fe-prod                            # 계약의 필수 키가 다 있는지, 형식이 맞는지
  sudo python3 envset.py set fe-prod,fe-dev NAVER_MAP_CLIENT_ID=abc123   # 비밀이 아닌 값은 바로 줄 수 있다
  sudo python3 envset.py set prod MODAL_KEY MODAL_SECRET           # 키 이름만 주면 숨김 입력으로 받는다(비밀은 이 방식만)
  sudo python3 envset.py unset dev REVIEW_MOCK_ENABLED             # 키를 지운다

파일 이름은 prod, dev, fe-prod, fe-dev, migrate-prod, migrate-dev, data, edge, obs, backup(서버 A)과 ops(서버 B)다. 쉼표로 여러 파일에
같은 값을 한 번에 넣는다. 이미 값이 있는 키를 바꿀 때는 확인을 묻는다(--yes로 생략). 파일을 새로 만들지는 않는다(bootstrap과 각 스택의 설정이 만든다).
계약 표(docs/infra/contracts/env.md)를 찾으면 키가 계약에 있는지, 필수인지 알려 준다(없으면 이 안내만 건너뛴다).
형식 규칙은 infra/ci/check_env_files.py와 같다(시험이 둘이 같은지 검사한다).

환경변수(시험용): FIT_ENV_DIR(기본 /etc/fit), FIT_ENV_CONTRACT(계약 표 파일)
"""
from __future__ import annotations

import argparse
import getpass
import os
import re
import sys
import tempfile
from pathlib import Path

KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
FORBIDDEN_VALUE_CHARS = frozenset(" \t\"'#$`\\")
SECRET_WORDS = frozenset({"KEY", "SECRET", "PASSWORD", "TOKEN", "HASH", "WEBHOOK"})
# 이름에는 비밀 단어가 없지만 값에 비밀번호가 들어 있는 키(AI 컨테이너의 접속 주소)
SECRET_KEYS = frozenset({"DATABASE_URL"})
CONTRACT_KEY_RE = re.compile(r"^`([A-Z][A-Z0-9_]*)`$")

# 파일 이름 → 계약 표의 그룹. 이 목록 밖의 이름은 받지 않는다(경로를 줄 수 없다)
FILES = {
    "prod": "app",
    "dev": "app",
    "fe-prod": "fe",
    "fe-dev": "fe",
    "ai-prod": "ai",
    "ai-dev": "ai",
    "migrate-prod": "migrate",
    "migrate-dev": "migrate",
    "data": "data",
    "edge": "edge",
    "obs": "obs",
    "backup": "backup",
    "ops": "ops",
}

APPLY = {
    "app": "BE는 컨테이너를 만들 때 한 번 읽는다. 배포한 적이 있으면 같은 SHA를 다시 배포한다(infra/deploy/README.md). 아직 배포 전이면 첫 배포에 반영된다",
    "fe": "FE는 컨테이너를 만들 때 한 번 읽는다. 배포한 적이 있으면 같은 SHA를 다시 배포한다(infra/deploy/README.md). 아직 배포 전이면 첫 배포에 반영된다",
    "migrate": "다음 배포의 마이그레이션 컨테이너가 읽는다",
    "ai": "AI API는 컨테이너를 만들 때 한 번 읽는다. 배포한 적이 있으면 같은 SHA를 다시 배포한다(infra/deploy/README.md). 아직 배포하지 않았으면 첫 배포가 읽는다",
    "edge": "sudo docker compose -p fit-edge -f <저장소>/infra/edge/compose.edge.yml --env-file /etc/fit/edge.env up -d --force-recreate",
    "obs": "sudo docker compose -p fit-obs -f <저장소>/infra/obs/compose.obs.yml --env-file /etc/fit/obs.env up -d --force-recreate obs-init prometheus alertmanager (일일 점검 요약은 실행할 때마다 읽는다)",
    "ops": "sudo docker compose -p fit-ops -f <저장소>/infra/ops/compose.ops.yml --env-file /etc/fit/ops.env up -d --force-recreate ops-init prometheus-b alertmanager-b",
    "backup": "다음 백업 실행부터 반영된다",
    "data": "주의: 비밀번호는 DB 역할과 prod, dev, migrate 파일의 값이 같아야 한다(docs/infra/contracts/env.md). 바꾸려면 데이터 스택과 짝 파일을 함께 고치고 다시 만든다",
}


class UsageError(Exception):
    pass


def env_dir() -> Path:
    return Path(os.environ.get("FIT_ENV_DIR", "/etc/fit"))


def is_secret(key: str) -> bool:
    return key in SECRET_KEYS or any(w in SECRET_WORDS for w in key.split("_"))


def check_value(key: str, value: str) -> tuple[str, str | None]:
    """(정리한 값, 오류). 오류 문구에 값을 넣지 않는다. *_BASE_URL은 끝의 /를 지운다(계약)."""
    if key.endswith("_BASE_URL"):
        value = value.rstrip("/")
    if value == "":
        return value, "값이 비어 있다"
    if "REPLACE_ME" in value:
        return value, "자리표시자(REPLACE_ME)는 쓸 수 없다"
    if any(c in FORBIDDEN_VALUE_CHARS or not c.isprintable() for c in value):
        return value, "공백, 따옴표, #, $, 백슬래시, 백틱, 보이지 않는 글자는 쓸 수 없다($가 필요한 값은 base64로 바꾼다)"
    if key.endswith("_BASE_URL") and not re.match(r"^https?://[^/]", value):
        return value, "http:// 또는 https://로 시작해야 한다"
    return value, None


def base_url_warning(key: str, value: str) -> str | None:
    """이미 파일에 있는 *_BASE_URL이 계약(끝에 /가 없고 http(s)://로 시작)에 맞는지. 값은 문구에 넣지 않는다."""
    if not key.endswith("_BASE_URL") or value == "" or "REPLACE_ME" in value:
        return None
    if value.endswith("/"):
        return "끝에 /가 있다(계약: 붙이지 않는다). set으로 다시 넣으면 지운다"
    return check_value(key, value)[1]


def parse_values(text: str) -> dict[str, str]:
    """{키: 값}. 같은 키가 여러 번이면 첫 줄이다."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        key, sep, value = line.partition("=")
        if sep and KEY_RE.match(key) and key not in out:
            out[key] = value
    return out


def format_issues(text: str) -> list[tuple[int, str]]:
    """check_env_files.check_text와 같은 규칙으로 (줄, 규칙)을 돌려준다."""
    issues: list[tuple[int, str]] = []
    if text.startswith("﻿"):
        issues.append((1, "bom"))
        text = text[1:]
    if "\r" in text:
        issues.append((0, "crlf"))
    seen: set[str] = set()
    for n, line in enumerate(text.replace("\r", "").split("\n"), start=1):
        if line == "":
            continue
        if "=" not in line:
            issues.append((n, "not-key-value"))
            continue
        key, value = line.split("=", 1)
        if not KEY_RE.match(key):
            issues.append((n, "bad-key"))
            continue
        if key in seen:
            issues.append((n, "duplicate-key"))
        if any(c in FORBIDDEN_VALUE_CHARS or not c.isprintable() for c in value):
            issues.append((n, "forbidden-char-in-value"))
        seen.add(key)
    return issues


def parse_contract(text: str) -> dict[str, dict[str, bool]]:
    """{그룹: {키: 필수인가}}. '| `KEY` | 그룹, 그룹 | O 또는 X | 설명 |' 행만 읽는다(infra/deploy/preflight.sh와 같은 규칙)."""
    out: dict[str, dict[str, bool]] = {}
    for line in text.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3 or cells[2] not in ("O", "X"):
            continue
        m = CONTRACT_KEY_RE.match(cells[0])
        if not m:
            continue
        for g in (g.strip() for g in cells[1].split(",")):
            if g:
                out.setdefault(g, {})[m.group(1)] = cells[2] == "O"
    return out


def load_contract() -> dict[str, dict[str, bool]] | None:
    here = Path(__file__).resolve().parent
    candidates = [os.environ.get("FIT_ENV_CONTRACT", ""), str(here / "env.md"), str(here.parent.parent / "docs/infra/contracts/env.md")]
    sudo_user = os.environ.get("SUDO_USER", "")
    if sudo_user:
        candidates.append(os.path.expanduser(f"~{sudo_user}/fit-repo/docs/infra/contracts/env.md"))
    candidates.append(os.path.expanduser("~/fit-repo/docs/infra/contracts/env.md"))
    for c in candidates:
        if c and Path(c).is_file():
            table = parse_contract(Path(c).read_text(encoding="utf-8"))
            if table:
                return table
    return None


def read_secret(prompt: str) -> str:
    """터미널이면 입력이 보이지 않는다. 파이프로 받을 때는 한 줄을 읽는다."""
    if sys.stdin.isatty():
        return getpass.getpass(prompt)
    sys.stderr.write(prompt)
    sys.stderr.flush()
    return sys.stdin.readline().rstrip("\r\n")


def ask_yes(question: str) -> bool:
    sys.stderr.write(question + " [y/N] ")
    sys.stderr.flush()
    return sys.stdin.readline().strip().lower() in ("y", "yes")


def resolve_files(spec: str) -> list[str]:
    names: list[str] = []
    for name in (s.strip() for s in spec.split(",")):
        if name not in FILES:
            raise UsageError(f"알 수 없는 파일 이름이다(쓸 수 있는 것: {', '.join(FILES)})")
        if not (env_dir() / f"{name}.env").is_file():
            raise UsageError(f"{name}.env가 이 서버에 없다(이 도구는 파일을 새로 만들지 않는다)")
        if name not in names:
            names.append(name)
    if not names:
        raise UsageError("파일 이름을 준다")
    return names


def parse_key_args(args: list[str], allow_value: bool) -> list[tuple[str, str | None]]:
    out: list[tuple[str, str | None]] = []
    for n, arg in enumerate(args, start=1):
        key, sep, value = arg.partition("=")
        if not KEY_RE.match(key):
            # 값이 키 자리에 잘못 들어왔을 수 있어 내용을 찍지 않는다
            raise UsageError(f"{n}번째 키 이름이 올바르지 않다(대문자, 숫자, _만 쓰고 첫 글자는 대문자다)")
        if sep and not allow_value:
            raise UsageError(f"{key}: 이 명령은 키 이름만 받는다")
        if any(key == k for k, _ in out):
            raise UsageError(f"{key}: 키가 두 번 들어 있다")
        out.append((key, value if sep else None))
    return out


def write_atomic(path: Path, text: str) -> None:
    """같은 디렉터리의 임시 파일에 쓰고 바꿔 끼운다. 모드와 소유자는 원래 파일을 따른다."""
    st = path.stat()
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".envset.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.chmod(tmp, st.st_mode & 0o7777)
        if hasattr(os, "chown"):
            try:
                os.chown(tmp, st.st_uid, st.st_gid)
            except PermissionError:
                pass  # root가 아닌 시험. 서버에서는 root라 항상 된다
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def require_writable() -> None:
    d = env_dir()
    if not os.access(d, os.W_OK):
        raise UsageError(f"{d}에 쓸 권한이 없다. sudo로 실행한다")


def replace_or_append(text: str, key: str, value: str) -> tuple[str, bool]:
    """(새 내용, 이미 있던 키인가). 첫 줄을 바꾸고 중복 줄은 지운다."""
    lines = text.splitlines()
    out: list[str] = []
    found = False
    for line in lines:
        if line.partition("=")[0] == key and "=" in line:
            if not found:
                out.append(f"{key}={value}")
                found = True
            continue
        out.append(line)
    if not found:
        out.append(f"{key}={value}")
    return "\n".join(out) + "\n", found


def remove_key(text: str, key: str) -> str:
    out = [line for line in text.splitlines() if not (line.partition("=")[0] == key and "=" in line)]
    return ("\n".join(out) + "\n") if out else ""


def apply_hint(name: str) -> str:
    return f"적용({name}.env): {APPLY[FILES[name]]}"


def contract_warn(contract: dict[str, dict[str, bool]] | None, name: str, key: str) -> str | None:
    if contract is None:
        return None
    group = FILES[name]
    if key not in contract.get(group, {}):
        return f"WARN  {key}: 계약 표(그룹 {group})에 없다. 계약 MR을 먼저 올린다(docs/infra/contracts/env.md)"
    return None


def cmd_set(args: argparse.Namespace) -> int:
    require_writable()
    names = resolve_files(args.files)
    specs = parse_key_args(args.keys, allow_value=True)
    contract = load_contract()
    values: dict[str, str] = {}
    errors: list[str] = []
    for key, inline in specs:
        if inline is not None and is_secret(key):
            errors.append(f"{key}: 비밀 값은 명령줄에 쓰지 않는다(셸 기록과 프로세스 목록에 남는다). 키 이름만 주면 숨김 입력으로 받는다")
            continue
        raw = inline
        if raw is None:
            raw = read_secret(f"[{','.join(names)}] {key} (비우면 건너뜀): ")
            if raw == "":
                print(f"건너뜀  {key}")
                continue
        value, err = check_value(key, raw)
        if err:
            errors.append(f"{key}: {err}")
        else:
            values[key] = value
    if errors:
        for e in errors:
            print(f"FAIL  {e}")
        print("아무것도 쓰지 않았다")
        return 1
    if not values:
        print("바꾼 것이 없다")
        return 0

    new_texts: dict[str, str] = {}
    report: list[str] = []
    for name in names:
        path = env_dir() / f"{name}.env"
        original = path.read_text(encoding="utf-8")
        text = original
        current = parse_values(text)
        for key, value in values.items():
            had = current.get(key)
            real = had is not None and had != "" and "REPLACE_ME" not in had
            if real and not args.yes and not ask_yes(f"{name}.env의 {key}에는 이미 값이 있다. 바꿀까요?"):
                report.append(f"{name}.env: 그대로 둠 {key}")
                continue
            text, existed = replace_or_append(text, key, value)
            report.append(f"{name}.env: {'바꿈' if existed else '추가'} {key} ({len(value)}자)")
        if text != original:
            new_texts[name] = text
    for name, text in new_texts.items():
        write_atomic(env_dir() / f"{name}.env", text)
    for line in report:
        print(line)
    for name in new_texts:
        for key in values:
            w = contract_warn(contract, name, key)
            if w:
                print(w)
        for ln, rule in format_issues(new_texts[name]):
            print(f"WARN  {name}.env 형식 문제: {ln}줄 {rule} (status로 확인한다)")
        print(apply_hint(name))
    return 0


def cmd_unset(args: argparse.Namespace) -> int:
    require_writable()
    names = resolve_files(args.files)
    specs = parse_key_args(args.keys, allow_value=False)
    contract = load_contract()
    report: list[str] = []
    new_texts: dict[str, str] = {}
    for name in names:
        path = env_dir() / f"{name}.env"
        text = path.read_text(encoding="utf-8")
        present = parse_values(text)
        for key, _ in specs:
            if key not in present:
                report.append(f"{name}.env: 없음 {key}")
                continue
            required = bool(contract and contract.get(FILES[name], {}).get(key))
            if required:
                print(f"WARN  {key}는 {name}.env의 필수 키다. 지우면 배포 사전 점검이 실패한다")
            if not args.yes and not ask_yes(f"{name}.env에서 {key}를 지울까요?"):
                report.append(f"{name}.env: 그대로 둠 {key}")
                continue
            text = remove_key(text, key)
            report.append(f"{name}.env: 삭제 {key}")
        if text != path.read_text(encoding="utf-8"):
            new_texts[name] = text
    for name, text in new_texts.items():
        write_atomic(env_dir() / f"{name}.env", text)
    for line in report:
        print(line)
    for name in new_texts:
        print(apply_hint(name))
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    names = resolve_files(args.files) if args.files else [n for n in FILES if (env_dir() / f"{n}.env").is_file()]
    if not names:
        print("이 서버에 env 파일이 없다")
        return 1
    contract = load_contract()
    failed = 0
    for name in names:
        path = env_dir() / f"{name}.env"
        group = FILES[name]
        text = path.read_text(encoding="utf-8")
        values = parse_values(text)
        print(f"== {name} (그룹 {group}, {path})")
        for ln, rule in format_issues(text):
            print(f"FAIL  형식: {ln}줄 {rule}" if ln else f"FAIL  형식: {rule}")
            failed += 1
        for key, value in values.items():
            warning = base_url_warning(key, value)
            if warning:
                print(f"WARN  {key}: {warning}")
        spec = contract.get(group) if contract else None
        if spec is None:
            print("SKIP  계약 표를 찾지 못했거나 이 그룹이 없어 필수 키는 점검하지 않았다")
        else:
            for key, required in spec.items():
                if not required:
                    continue
                if key not in values:
                    print(f"FAIL  {key} (필수): 없다")
                    failed += 1
                elif values[key] == "":
                    print(f"FAIL  {key} (필수): 비어 있다")
                    failed += 1
                elif "REPLACE_ME" in values[key]:
                    print(f"FAIL  {key} (필수): REPLACE_ME")
                    failed += 1
                else:
                    print(f"OK    {key} (필수)")
            for key, required in spec.items():
                if required or key not in values:
                    continue
                if "REPLACE_ME" in values[key]:
                    print(f"FAIL  {key} (선택): REPLACE_ME")
                    failed += 1
                else:
                    print(f"OK    {key} (선택)")
            for key in sorted(values):
                if key not in spec:
                    print(f"WARN  {key}: 계약 표에 없다")
            missing_optional = [k for k, req in spec.items() if not req and k not in values]
            if missing_optional:
                print(f"      넣을 수 있는 선택 키: {', '.join(missing_optional)}")
        for key in sorted(values):
            if "REPLACE_ME" in values[key] and (spec is None or key not in spec):
                print(f"FAIL  {key}: REPLACE_ME")
                failed += 1
    print(f"\n{failed}개 실패" if failed else "\n점검 통과")
    return 1 if failed else 0


def cmd_list(args: argparse.Namespace) -> int:
    found = False
    for name in FILES:
        path = env_dir() / f"{name}.env"
        if not path.is_file():
            continue
        found = True
        text = path.read_text(encoding="utf-8")
        placeholders = sum(1 for v in parse_values(text).values() if "REPLACE_ME" in v)
        print(f"{name:<13} 키 {len(parse_values(text))}개, REPLACE_ME {placeholders}개")
    if not found:
        print("이 서버에 env 파일이 없다")
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="envset.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("set", help="키를 넣거나 바꾼다")
    p.add_argument("files", help="파일 이름. 쉼표로 여러 개(예: fe-prod,fe-dev)")
    p.add_argument("keys", nargs="+", help="KEY(숨김 입력) 또는 KEY=VALUE(비밀이 아닌 값만)")
    p.add_argument("--yes", action="store_true", help="이미 값이 있는 키를 바꿀 때 묻지 않는다")
    p.set_defaults(func=cmd_set)
    p = sub.add_parser("unset", help="키를 지운다")
    p.add_argument("files")
    p.add_argument("keys", nargs="+")
    p.add_argument("--yes", action="store_true", help="묻지 않는다")
    p.set_defaults(func=cmd_unset)
    p = sub.add_parser("status", help="형식과 계약의 필수 키를 점검한다(값은 찍지 않는다)")
    p.add_argument("files", nargs="?", help="파일 이름. 없으면 이 서버의 모든 파일")
    p.set_defaults(func=cmd_status)
    p = sub.add_parser("list", help="이 서버의 env 파일과 키 개수")
    p.set_defaults(func=cmd_list)
    return ap


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except UsageError as e:
        print(f"FAIL  {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
