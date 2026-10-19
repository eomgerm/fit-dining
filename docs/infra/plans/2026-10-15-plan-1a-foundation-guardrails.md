# 인프라 기반과 가드레일 구현 계획 (Plan 1A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스펙의 불변식(CRLF·env 형식, 포트 노출, 마이그레이션 불변성, 이미지 아키텍처, 시크릿)을 강제하는 가드 스크립트와 단위 테스트, 이를 서버 없이 이 PC에서 한 번에 돌리는 러너, 그리고 CI의 `lint:*` 잡 정의를 만든다.

**Architecture:** 가드는 Python 3.9 이상의 표준 라이브러리만 쓰는 독립 CLI(`infra/ci/*.py`)이고 `unittest`로 검증한다. 린터(shellcheck, hadolint, yamllint, gitleaks)는 버전을 핀한 컨테이너로 돈다. 로컬은 `docker run -v`로, CI는 도구마다 job image로 같은 도구를 쓴다. 러너가 docker executor라 job 컨테이너 안에서 `docker run -v $PWD`로 도구 컨테이너를 띄우면 워크스페이스가 호스트 경로가 아니라 마운트되지 않기 때문이다. 가드는 저장소 전체를, 린터(shellcheck·hadolint·yamllint)는 인프라 소유 파일(`infra/`와 루트 설정)을 본다. 검사가 침묵 통과하지 않는지 확인하는 음성 자가 테스트(`--self-test`)를 포함한다.

**Tech Stack:** Python 3.9+(stdlib, unittest), bash, Docker Compose v2+, shellcheck 0.11, hadolint 2.15, yamllint(이미지 `pipelinecomponents/yamllint:0.35.27`), gitleaks 8.30, GitLab CI.

**Spec:** [docs/infra/design.md](../design.md) (3절 호스트 기반, 6절 CI/CD, 12.4절 env 계약, 13절 보안)

## 한눈에 보기

각 Task는 실패하는 테스트 작성, 구현, 통과 확인, 커밋 순서다(커밋은 허용된 경우에만).

| Task | 만드는 것 | 막는 사고 |
|---|---|---|
| 1 | 저장소 기반 파일, CRLF 검사 | CRLF가 env 값과 셸 스크립트를 깨뜨림 |
| 2 | env 형식 가드 | env 형식 오류와 값 누락이 조용히 통과 |
| 3 | 포트 불변식 가드 | 컨테이너 포트가 0.0.0.0에 공개돼 ufw를 우회 |
| 4 | 마이그레이션 불변성 가드 | 적용된 Flyway 파일 수정, 버전 중복·순서 역전으로 기동 실패 |
| 5 | 이미지 아키텍처 가드 | B(Arm)에 amd64 전용 이미지 |
| 6 | compose 프로젝트 순회 | 새 compose 파일이 포트 검사에서 빠짐 |
| 7 | 도구 이미지 핀, 린터 설정, 로컬 러너, pre-commit 훅 | 서버 없이는 검사를 못 돌림, 시크릿 커밋 |
| 8 | `.gitlab-ci.yml`의 `lint:*` 잡, 핀 동기화 테스트 | CI와 로컬의 도구 버전 불일치 |
| 9 | `infra/README.md`, 최종 게이트 | 문서와 구현의 불일치 |

이 계획은 가드와 CI의 lint만 만든다. compose 파일, Caddyfile, 배포 스크립트 같은 서버 구성은 후속 계획이 만든다.

## 검증 결과

이 계획의 코드는 저장소를 clone한 임시 복사본(저장소 밖)에서 실행해 확인했다.

- 단위 테스트 69개, 러너 정상 실행, 자가 테스트 7종이 통과한다. 러너는 도구 이미지 8개가 `linux/amd64`와 `linux/arm64`를 모두 지원함을 실제 레지스트리로 확인한다.
- `lint:*` 잡의 스크립트 줄을 핀한 이미지 안에서 실행해 확인했다.
  - `lint:guards`와 `lint:image-arch`는 docker 소켓 없이 `docker:29.9.0-cli`에서 통과한다. 이 이미지에 compose v5.6.0과 buildx v0.38.0이 들어 있어 데몬 없이 `compose config`와 `imagetools inspect`가 돈다.
  - 팀원 코드 모양의 파일(경고만 있는 Dockerfile·셸·YAML)은 통과하고, `be/`의 오류 수준 Dockerfile(`sudo`)만 막는다.
- 시크릿을 추가했다가 지운 MR은 `gitleaks dir`로는 안 보이고 `gitleaks git --log-opts`로 잡힌다. pre-commit 훅은 토큰을 막고 깨끗한 변경은 통과시킨다.
- 러너의 파일 목록 수집 루프(`while read`)는 `bash:3.2` 이미지에서 빈 목록까지 돈다.
- GitLab CE 18.11.5에 이 PC의 임시 러너(gitlab-runner 18.11.4, docker executor, 태그 `verify`)를 등록해 MR 파이프라인을 돌렸고 `lint:*` 잡 7개가 모두 통과했다.
- 팀원이 올린 `prototypes/`, `be/`(Gradle Spring Boot), `fe/`(Next.js·pnpm) 초기 프로젝트를 포함한 저장소(origin/master 4acf654)에서도 모든 검사가 통과한다. `be/`에는 Dockerfile이 아직 없어 `hadolint(be)`는 SKIP이다.

아래 코드를 그대로 옮기면 같은 결과가 나와야 한다. 다르면 코드를 고치기 전에 원인을 먼저 확인한다.

**아직 확인하지 못한 것**

- 실제 verify 러너(B, Arm)에서의 파이프라인 실행. 지금까지는 이 PC의 임시 러너(amd64)로만 돌렸다
- GitLab이 `git fetch --depth=1 origin <sha>`를 허용하는지(Task 4의 `ensure_commit`이 쓰며, CI는 `GIT_DEPTH: "0"`이라 이 경로는 아직 실행되지 않았다)
- macOS의 `tar --null -T -`(러너의 시크릿 스캔)

## Global Constraints

스펙의 프로젝트 전역 요구사항이다. 모든 Task가 암묵적으로 포함한다.

- 텍스트 파일은 LF만 쓴다. CRLF 금지 (스펙 12.4절, 부록 A).
- env 파일은 `KEY=VALUE`만 쓴다. 공백·따옴표·CRLF·`#` 금지 (스펙 12.4절). 이 계획은 `$`, 백슬래시, 백틱, 주석 줄, BOM, 전각 공백·NBSP 같은 비출력 문자도 금지한다. 예제 env에는 주석을 쓰지 않고 설명은 `docs/infra/contracts/env.md`에 둔다.
- 컨테이너의 호스트 게시 포트는 `127.0.0.1:`만 쓴다. 공개는 caddy의 80/443/8443뿐이다 (스펙 13.1절).
- 이미지 태그는 핀한다. A는 `linux/amd64`, B는 `linux/arm64`다. CI 도구 이미지는 B에서 돌므로 둘 다 지원해야 한다. B에 올라갈 이미지(ops 스택)의 arm64 검사는 그 compose 파일을 만드는 계획(1E)이 `lint:image-arch`에 추가한다 (스펙 3절, 6.1절, 6.6절).
- 시크릿과 실제 env는 커밋하지 않는다. `*.env.example`만 커밋한다 (스펙 13.2절). 프런트는 빌드타임 env 파일을 쓰지 않는다. 환경 값은 `/config.json`으로 받는다(설계 6.8절).
- 줄번호를 인용하지 않는다. 상태를 단언하는 대신 확인 명령을 적는다 (스펙 문서 규칙).
- 가드의 출력에 값을 싣지 않는다. 파일:줄과 규칙 이름만 출력한다.
- 실행 환경: Windows 11, Git Bash 또는 WSL, Docker Desktop(Docker 29.x), `python`은 3.12다. Git Bash의 `python3`는 스토어 바로가기라 실제 Python이 아닐 수 있다. Git Bash에서 Python이 출력하는 한글이 깨져 보이면(콘솔이 cp949, 터미널이 UTF-8) `export PYTHONUTF8=1`을 먼저 실행한다. 러너는 스스로 설정한다.
- 작업 규칙: 검증은 이 계획의 게이트에 필요한 것만 돌린다. 범위를 넓히는 조사는 사용자에게 묻고 시작한다. 로컬에서 띄운 컨테이너는 `--rm`이고, 임시 디렉터리는 정확한 경로만 지운다(이름 패턴 일괄 삭제 금지).
- 커밋은 사용자가 허용한 경우에만 하고, 기본 브랜치(master)에 직접 하지 않는다. 아래 커밋 단계는 모두 "허용된 경우에만"이다.
- 커밋 메시지는 `type(scope): 설명`(scope는 `infra`)이고, 이모지와 Jira 키는 팀의 lefthook이 브랜치 이름에서 채운다. 브랜치는 `infra/<타입>/<설명>-<Jira키>`다(저장소 루트 `CONTRIBUTING.md`, 설계 10.8절).

## 파일 구조

모든 경로는 저장소 루트(`C:\Users\SSAFY\ssafy\S15P31A302`) 기준이다.

| 파일 | 책임 |
|---|---|
| `.gitattributes`, `.gitignore`, `.editorconfig` | LF 강제, 시크릿 무시, 편집기 일관성 |
| `infra/ci/check_eol.py` | 추적 파일의 CRLF 검사 |
| `infra/ci/check_env_files.py` | env 형식과 필수 키 검사 (값 비출력) |
| `infra/ci/ports_invariant.py` | compose 포트 노출 불변식 |
| `infra/ci/migration_immutability.py` | 적용된 마이그레이션 수정 금지 |
| `infra/ci/images_arch.py` | 이미지의 플랫폼 지원 검사 |
| `infra/ci/check_compose_projects.py`, `compose-projects.txt` | 프로젝트 목록을 순회해 포트 불변식 적용 |
| `infra/ci/tool-images.sh` | 도구 이미지 핀 (로컬 러너와 CI 공유) |
| `infra/ci/run-local-checks.sh` | 서버 없이 로컬에서 CI lint를 돌리는 러너, `--self-test` |
| `infra/ci/tests/test_*.py` | 위 가드들의 단위 테스트와 핀 동기화 테스트 |
| `.yamllint.yaml`, `.gitleaks.toml` | 린터 설정 |
| `infra/ci/pre-commit-secrets.sh`, `.githooks/pre-commit` | 커밋 전 시크릿 검사 훅(선택) |
| `.gitlab-ci.yml` | `lint:*` 잡 |
| `infra/README.md` | 구조와 사용법 |

## 후속 계획

이 계획은 사전 작업의 기반이다. 아래 계획은 이 계획이 끝난 뒤 순서대로 쓴다.

| 계획 | 내용 |
|---|---|
| 1B 로컬 개발 환경과 서비스 계약 | `infra/local/compose.yml`(profile `core`: Postgres(pgvector)·Redis·Garage, `search`: nori를 넣은 OpenSearch), `docs/infra/contracts/`(env.md, BE·AI(Modal 호출)·프런트 계약, 설계 12절), `*.env.example`. BE·FE 팀이 이미 개발 중이라 서버 없이도 가장 먼저 쓰이는 산출물이고, 계약은 M1 전에 합의해야 한다 |
| 1C 엣지와 배포 | Caddyfile(PWA 정적 서빙, dev 쿠키 게이트, 사진 업로드·읽기 프록시), `deploy.sh`(BE Blue/Green과 PWA 릴리스 링크 전환)·`rollback.sh`·`preflight.sh`(다운그레이드 가드 포함)·`smoke.sh`(검색 1건의 폴백 표시 확인 포함), `.gitlab-ci.yml`의 `be:test`·`fe:test`·`fe:build`(PWA 산출물 검사 포함)·`build`·`deploy`(`environment`, 환경별 `resource_group`)·`smoke` 잡, 로컬 시뮬레이션. 이 계획의 `check_env_files.py`, `ports_invariant.py`를 호출한다 |
| 1D 데이터와 백업 | compose.data.yml, `ensure-databases.sh`, 백업·검증·전송·복원 스크립트 |
| 1E 관측성 | A와 B의 Prometheus·Alertmanager·blackbox 설정, 알림 규칙(Modal 폴백·예산 알림, B 도달 알림 포함)과 `promtool test`, 포트 노출 감사, 대시보드. B의 ops 스택 compose가 생기면 그 이미지의 arm64 검사를 `lint:image-arch`에 추가한다 |
| 1F 호스트 부트스트랩 | `infra/host/`(`bootstrap.sh` ROLE=app\|ops, `verify-host.sh`, daemon.json, sysctl, sshd drop-in, fail2ban, systemd 유닛, `fit-up.sh`). 설계 3절 |
| 1G 런북과 포팅 매뉴얼 | 런북 초안 RB-01~13(설계 10.2절), 포팅 매뉴얼 골격(설계 17절) |
| 2 (M0~M4) | 서버 수령일이 정해진 뒤에 쓴다 |

GitLab 프로젝트 설정과 러너 등록은 코드가 아니라 GitLab 화면과 API로 하는 작업이라 계획 대신 [gitlab-setup.md](../gitlab-setup.md)로 관리한다. 권한 확인과 브랜치 보호·병합 규칙(0~1단계)은 지금 할 수 있다. 러너 등록과 "Pipelines must succeed"(2단계)는 서버 수령 뒤이고, `process_mode`(3단계)는 1C의 첫 배포 파이프라인 뒤다. 러너가 생기기 전에는 이 계획의 `lint:*` 잡이 pending으로 멈춘다.

---

### Task 1: 저장소 기반 파일과 CRLF 검사

**목표:** LF를 강제하고, 커밋될 내용에 CRLF가 들어가면 실패시킨다.

**Files:**
- Create: `.gitattributes`
- Modify: `.gitignore` (팀원이 만든 루트 파일에 인프라 섹션을 덧붙인다)
- Create: `.editorconfig`
- Create: `infra/ci/check_eol.py`
- Test: `infra/ci/tests/test_check_eol.py`

**Interfaces:**
- Produces:
  - `check_eol.files_with_crlf(paths: list[Path]) -> list[Path]`: 작업 트리의 실제 바이트를 검사한다.
  - `check_eol.index_crlf_files(cwd: str | None = None) -> list[Path]`: git 인덱스(커밋될 내용)를 검사한다.
  - `check_eol.main(argv: list[str]) -> int`
- CLI: `python infra/ci/check_eol.py [paths...]`
  - 경로가 없으면 인덱스(`git ls-files --eol`의 `i/` 값)를 확장자와 무관하게 검사한다. `eol=crlf`나 `-text` 속성으로 CR을 허용한 파일은 제외한다.
  - 경로가 있으면 그 파일의 실제 바이트를 검사한다.
  - CR이 있는 파일마다 `FAIL <경로> crlf`를 출력하고, 하나라도 있으면 종료 코드 1이다.
- 기본 모드가 인덱스를 보는 이유: Windows의 `core.autocrlf=true`는 작업 트리만 CRLF로 바꾸고 인덱스는 LF로 둔다. 작업 트리 바이트를 보면 커밋될 내용과 무관한 오탐이 나서 사람들이 실패를 무시하게 된다. 이 저장소의 `README.md`가 실제로 그렇다(인덱스 LF, 작업 트리 CRLF). 인덱스를 보면 `.gitattributes`가 빠지는 문제도 잡힌다. 서버에 올릴 env 파일처럼 인덱스 밖 파일은 경로를 줘서 실제 바이트를 본다.

- [ ] **Step 1: 환경 확인 (읽기 전용)**

Run (저장소 루트, Git Bash 또는 PowerShell):

```bash
python --version
docker version --format 'server={{.Server.Version}}'
docker compose version
bash --version | head -n 1
git status --short
```

Expected: Python 3.9 이상(이 PC는 3.12.x), Docker 서버 버전 출력(29.x), Compose v2 이상, bash 5.x. `docs/infra/` 아래 파일이 미추적으로 보일 수 있다. Docker 서버 버전이 안 나오면 Docker Desktop을 먼저 켠다.

사용자에게 커밋 허용 여부를 한 번 묻는다. 허용하면 `git switch -c infra/chore/foundation-guardrails-S15P31A302-19`로(브랜치 이름 규칙은 설계 10.8절) 브랜치를 만든 뒤 시작한다. 허용하지 않으면 커밋 단계를 모두 건너뛴다.

- [ ] **Step 2: 저장소 기반 파일 3개 작성**

`.gitattributes`: Windows 체크아웃에서도 LF가 유지되게 한다(선배 팀에서 CRLF가 env 값과 셸 스크립트를 깨뜨린 교훈).

````text
* text=auto eol=lf
*.sh text eol=lf
*.py text eol=lf
*.env.example text eol=lf
Caddyfile text eol=lf
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.pdf binary
````

`.gitignore`: 루트에 팀원이 만든 파일이 이미 있다(IDE·OS·`.env` 섹션). 그 섹션은 그대로 두고 인프라 섹션(실제 env와 키 차단, 도구 산출물)을 덧붙인다. 완성본은 다음과 같다. `fe/.gitignore`와 `be/.gitignore`는 각 팀 소유라 건드리지 않는다.

````text
### IDE ###
.idea/
*.iml
out/
.vscode/

### OS ###
.DS_Store
Thumbs.db
desktop.ini

### 로컬 설정·비밀값 ###
.env
.env.*
!.env.example

### 인프라: 실제 env와 키는 git에 올리지 않는다. 예제(*.env.example)만 추적한다. ###
*.env
!*.env.example
/infra/**/secrets/
*.pem
*.key
id_ed25519
id_rsa

### 도구 산출물 ###
.tmp-selftest/
.tmp-gitleaks/
__pycache__/
*.pyc
.venv/
node_modules/
````

`.editorconfig`:

````ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.py]
indent_size = 4

[*.md]
trim_trailing_whitespace = false
````

- [ ] **Step 3: 실패하는 테스트 작성**

````python
import contextlib
import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_eol  # noqa: E402


class CheckEolTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name: str, data: bytes) -> Path:
        p = self.dir / name
        p.write_bytes(data)
        return p

    def test_lf_file_passes(self):
        p = self.write("ok.sh", b"#!/bin/sh\necho hi\n")
        self.assertEqual(check_eol.files_with_crlf([p]), [])

    def test_crlf_shell_script_is_flagged(self):
        p = self.write("bad.sh", b"#!/bin/sh\r\necho hi\r\n")
        self.assertEqual(check_eol.files_with_crlf([p]), [p])

    def test_crlf_env_example_is_flagged(self):
        p = self.write("prod.env.example", b"A=1\r\n")
        self.assertEqual(check_eol.files_with_crlf([p]), [p])

    def test_dockerfile_variants_are_checked(self):
        p = self.write("Dockerfile.prod", b"FROM x\r\n")
        self.assertEqual(check_eol.files_with_crlf([p]), [p])

    def test_binary_suffix_is_ignored(self):
        p = self.write("img.png", b"\x89PNG\r\n")
        self.assertEqual(check_eol.files_with_crlf([p]), [])

    def test_main_with_paths_checks_actual_bytes(self):
        bad = self.write("bad.yml", b"a: 1\r\n")
        good = self.write("good.yml", b"a: 1\n")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(check_eol.main([str(bad)]), 1)
            self.assertEqual(check_eol.main([str(good)]), 0)


@unittest.skipUnless(shutil.which("git"), "git 없음")
class IndexCheckTest(unittest.TestCase):
    """인덱스(커밋될 내용)의 EOL을 본다. 작업 트리만 CRLF인 Windows 체크아웃은 통과해야 한다."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@t.t")
        self.git("config", "user.name", "t")
        self.git("config", "core.autocrlf", "false")

    def tearDown(self):
        self._tmp.cleanup()

    def git(self, *args: str) -> None:
        subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True)

    def test_crlf_in_index_without_attributes_is_flagged(self):
        (self.repo / "run.sh").write_bytes(b"#!/bin/sh\r\necho hi\r\n")
        self.git("add", "run.sh")
        self.assertEqual(check_eol.index_crlf_files(str(self.repo)), [Path("run.sh")])

    def test_crlf_in_file_without_a_known_suffix_is_flagged(self):
        (self.repo / "gradlew").write_bytes(b"#!/bin/sh\r\necho hi\r\n")
        self.git("add", "gradlew")
        self.assertEqual(check_eol.index_crlf_files(str(self.repo)), [Path("gradlew")])

    def test_crlf_allowed_by_eol_attribute_is_not_flagged(self):
        (self.repo / "run.bat").write_bytes(b"@echo off\r\n")
        self.git("add", "run.bat")  # 속성이 생기기 전에 커밋돼 인덱스에 CRLF가 남은 파일
        (self.repo / ".gitattributes").write_bytes(b"*.bat eol=crlf\n")
        self.git("add", ".gitattributes")
        self.assertEqual(check_eol.index_crlf_files(str(self.repo)), [])

    def test_gitattributes_normalizes_crlf_so_index_is_clean(self):
        (self.repo / ".gitattributes").write_bytes(b"* text=auto eol=lf\n")
        (self.repo / "run.sh").write_bytes(b"#!/bin/sh\r\necho hi\r\n")
        self.git("add", ".gitattributes", "run.sh")
        self.assertEqual(check_eol.index_crlf_files(str(self.repo)), [])


if __name__ == "__main__":
    unittest.main()
````

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `python infra/ci/tests/test_check_eol.py`

Expected: `ModuleNotFoundError: No module named 'check_eol'`

- [ ] **Step 5: 구현**

````python
#!/usr/bin/env python3
"""CRLF 검사.

  인자 없음: 커밋될 내용(git 인덱스)에 CRLF가 있는 파일을 확장자와 무관하게 찾는다. `git ls-files --eol`의 i/ 값을 본다.
             Windows의 core.autocrlf=true는 작업 트리만 CRLF로 바꾸고 인덱스는 LF라서 통과한다.
             .gitattributes(`* text=auto eol=lf`)가 없거나 -text로 빠진 파일이 있으면 인덱스에 CRLF가 남아 실패한다.
  경로 지정: 그 파일의 실제 바이트에 CR이 있으면 실패한다(인덱스 밖 파일, 서버에 올릴 env 파일 등).

env 파일의 CRLF는 값을 깨뜨리고(A603), 셸 스크립트는 줄 끝에 \\r이 붙어 실행이 실패한다.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

TEXT_SUFFIXES = {
    ".sh", ".py", ".yml", ".yaml", ".toml", ".md", ".json", ".sql", ".conf",
    ".env", ".example", ".caddy", ".txt", ".cfg", ".ini",
}
TEXT_NAMES = {"Caddyfile", ".gitattributes", ".gitignore", ".editorconfig"}


def is_text_candidate(path: Path) -> bool:
    return (
        path.suffix in TEXT_SUFFIXES
        or path.name in TEXT_NAMES
        or path.name.startswith("Dockerfile")
    )


def files_with_crlf(paths: list[Path]) -> list[Path]:
    """작업 트리의 실제 바이트에 CR이 있는 텍스트 파일."""
    bad = []
    for p in paths:
        if p.is_file() and is_text_candidate(p) and b"\r" in p.read_bytes():
            bad.append(p)
    return bad


def index_crlf_files(cwd: str | None = None) -> list[Path]:
    """git 인덱스(커밋될 내용)에 CRLF가 있는 파일. 확장자와 무관하게 본다(gradlew, application.properties 등).

    CR을 일부러 허용한 파일(`eol=crlf`나 `-text` 속성)은 제외한다. 바이너리는 git이 i/-text로 분류해 걸리지 않는다.
    """
    out = subprocess.run(
        ["git", "ls-files", "--eol", "-z"], cwd=cwd, capture_output=True, check=True
    ).stdout
    bad = []
    for rec in out.split(b"\0"):
        if not rec:
            continue
        meta, _, path = rec.partition(b"\t")
        info = meta.decode()
        index_eol = info.split()[0]  # 예: i/lf, i/crlf, i/mixed
        if index_eol in ("i/crlf", "i/mixed") and "eol=crlf" not in info and "-text" not in info:
            bad.append(Path(path.decode()))
    return bad


def main(argv: list[str]) -> int:
    if argv:
        bad = files_with_crlf([Path(a) for a in argv])
        scope = f"{len(argv)} file(s) checked"
    else:
        bad = index_crlf_files()
        scope = "index"
    for p in bad:
        print(f"FAIL {p.as_posix()} crlf")
    if bad:
        print(f"{len(bad)} file(s) contain CR. Fix: sed -i 's/\\r$//' <file> (인덱스라면 .gitattributes 확인)")
        return 1
    print(f"OK eol ({scope})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
````

- [ ] **Step 6: 테스트 통과 확인**

Run: `python infra/ci/tests/test_check_eol.py`

Expected: `Ran 10 tests` 다음에 `OK`

- [ ] **Step 7: 새 파일에 CRLF가 없는지 확인**

Run:

```bash
python infra/ci/check_eol.py .gitattributes .gitignore .editorconfig infra/ci/check_eol.py infra/ci/tests/test_check_eol.py
```

Expected: `OK eol (5 file(s) checked)`

- [ ] **Step 8: 커밋 (사용자가 허용한 경우에만)**

```bash
git add .gitattributes .gitignore .editorconfig infra/ci/check_eol.py infra/ci/tests/test_check_eol.py
git commit -m "chore(infra): 저장소 기반 파일과 CRLF 검사 추가"
```

---

### Task 2: env 형식 가드

**목표:** env 파일이 `KEY=VALUE` 한 줄 형식을 지키는지 값을 출력하지 않고 검사한다.

**Files:**
- Create: `infra/ci/check_env_files.py`
- Test: `infra/ci/tests/test_check_env_files.py`

**Interfaces:**
- Produces:
  - `check_env_files.check_text(raw: bytes, path: str = "<memory>") -> tuple[list[Issue], dict[str, bool]]`: 두 번째 값은 `{키: 값이 비어 있지 않은가}`다.
  - `check_file(path: Path, required: set[str] | None = None) -> list[Issue]`, `read_required(path: Path) -> set[str]`, `Issue(path: str, line: int, rule: str)`
- CLI: `python infra/ci/check_env_files.py [--required 파일] FILE...`. Plan 1C의 `preflight.sh`가 서버의 `/etc/fit/*.env`를 검사할 때 이 CLI를 호출한다.
- 규칙 이름: `crlf`, `bom`, `not-key-value`, `bad-key`, `duplicate-key`, `forbidden-char-in-value`, `missing-required:<키>`, `empty-required:<키>`.
- 값에 비출력 문자(전각 공백, NBSP)가 있으면 `forbidden-char-in-value`다. compose의 `env_file:`은 그 공백을 잘라내고 `docker run --env-file`은 남겨 두 소비자의 값이 갈리기 때문이다.

- [ ] **Step 1: 실패하는 테스트 작성**

````python
import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_env_files as env  # noqa: E402


def rules(raw: bytes) -> list[tuple[int, str]]:
    issues, _ = env.check_text(raw)
    return [(i.line, i.rule) for i in issues]


class CheckTextTest(unittest.TestCase):
    def test_valid_file_has_no_issues(self):
        self.assertEqual(rules(b"A=1\nB_2=hello\n\nC=\n"), [])

    def test_base64_padding_and_url_values_are_allowed(self):
        self.assertEqual(rules(b"K=abc==\nU=https://x.y/z?a=b&c=d\n"), [])

    def test_comment_line_is_rejected(self):
        self.assertEqual(rules(b"# note\nA=1\n"), [(1, "not-key-value")])

    def test_quotes_are_rejected(self):
        self.assertEqual(rules(b'A="x"\nB=\'y\'\n'), [(1, "forbidden-char-in-value"), (2, "forbidden-char-in-value")])

    def test_space_and_trailing_space_are_rejected(self):
        self.assertEqual(rules(b"A=a b\nB=c \n"), [(1, "forbidden-char-in-value"), (2, "forbidden-char-in-value")])

    def test_dollar_hash_backslash_backtick_are_rejected(self):
        for ch in ("$", "#", "\\", "`"):
            with self.subTest(ch=ch):
                self.assertEqual(rules(f"A=x{ch}y\n".encode()), [(1, "forbidden-char-in-value")])

    def test_unicode_whitespace_is_rejected(self):
        # 한글 IME의 전각 공백과 NBSP는 compose(env_file)가 잘라내고 docker run --env-file은 남긴다
        self.assertEqual(rules("A=abc\u3000\n".encode()), [(1, "forbidden-char-in-value")])
        self.assertEqual(rules("A=x\u00a0\n".encode()), [(1, "forbidden-char-in-value")])
        self.assertEqual(rules("A=한글\n".encode()), [])

    def test_lowercase_key_is_rejected(self):
        self.assertEqual(rules(b"abc=1\n"), [(1, "bad-key")])

    def test_duplicate_key_is_rejected_on_second_occurrence(self):
        self.assertEqual(rules(b"A=1\nB=2\nA=3\n"), [(3, "duplicate-key")])

    def test_crlf_is_reported_once_without_noise(self):
        self.assertEqual(rules(b"A=1\r\nB=2\r\n"), [(0, "crlf")])

    def test_bom_is_reported_without_breaking_first_key(self):
        self.assertEqual(rules(b"\xef\xbb\xbfA=1\n"), [(1, "bom")])

    def test_issue_text_never_contains_the_value(self):
        issues, _ = env.check_text(b"PASSWORD=super secret value\n", "x.env")
        self.assertEqual(len(issues), 1)
        self.assertNotIn("super", str(issues[0]))
        self.assertNotIn("secret", str(issues[0]))


class RequiredKeysTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_missing_and_empty_required_keys(self):
        f = self.dir / "prod.env"
        f.write_bytes(b"A=1\nB=\n")
        issues = env.check_file(f, {"A", "B", "C"})
        self.assertEqual(sorted(i.rule for i in issues), ["empty-required:B", "missing-required:C"])

    def test_read_required_ignores_comments_and_blanks(self):
        f = self.dir / "env.required"
        f.write_text("# 필수 키\nA\n\n  B  \n", encoding="utf-8")
        self.assertEqual(env.read_required(f), {"A", "B"})

    def test_main_exit_codes(self):
        good = self.dir / "good.env"
        good.write_bytes(b"A=1\n")
        bad = self.dir / "bad.env"
        bad.write_bytes(b'A="1"\n')
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(env.main([str(good)]), 0)
            self.assertEqual(env.main([str(bad)]), 1)


if __name__ == "__main__":
    unittest.main()
````

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `python infra/ci/tests/test_check_env_files.py`

Expected: `ModuleNotFoundError: No module named 'check_env_files'`

- [ ] **Step 3: 구현**

````python
#!/usr/bin/env python3
"""env 파일 형식과 필수 키 검사. 값은 절대 출력하지 않는다.

규칙(스펙 12.4): KEY=VALUE 한 줄씩만 쓴다. 주석, 공백, 따옴표, CRLF, BOM, '#', '$', 백슬래시, 백틱을 금지한다.
소비자가 셋(compose --env-file 보간, 서비스 env_file:, docker run --env-file)이라 가장 보수적인 형식을 쓴다.
출력은 파일:줄과 규칙 이름뿐이며, 필수 키가 없을 때만 키 이름(비밀이 아님)을 적는다.
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
FORBIDDEN_VALUE_CHARS = frozenset(" \t\"'#$`\\")
BOM = b"\xef\xbb\xbf"


@dataclass(frozen=True)
class Issue:
    path: str
    line: int  # 0이면 파일 전체
    rule: str

    def __str__(self) -> str:
        where = f"{self.path}:{self.line}" if self.line else self.path
        return f"FAIL {where} {self.rule}"


def check_text(raw: bytes, path: str = "<memory>") -> tuple[list[Issue], dict[str, bool]]:
    """내용을 검사해 (이슈 목록, {키: 값이 비어 있지 않은가})를 돌려준다."""
    issues: list[Issue] = []
    keys: dict[str, bool] = {}
    if raw.startswith(BOM):
        issues.append(Issue(path, 1, "bom"))
        raw = raw[len(BOM):]
    if b"\r" in raw:
        issues.append(Issue(path, 0, "crlf"))
    text = raw.decode("utf-8", errors="replace").replace("\r", "")
    for n, line in enumerate(text.split("\n"), start=1):
        if line == "":
            continue
        if "=" not in line:
            issues.append(Issue(path, n, "not-key-value"))
            continue
        key, value = line.split("=", 1)
        if not KEY_RE.match(key):
            issues.append(Issue(path, n, "bad-key"))
            continue
        if key in keys:
            issues.append(Issue(path, n, "duplicate-key"))
        if any(c in FORBIDDEN_VALUE_CHARS or not c.isprintable() for c in value):  # 전각·NBSP 같은 공백 포함
            issues.append(Issue(path, n, "forbidden-char-in-value"))
        keys[key] = value != ""
    return issues, keys


def check_file(path: Path, required: set[str] | None = None) -> list[Issue]:
    issues, keys = check_text(path.read_bytes(), path.as_posix())
    for k in sorted(required or ()):
        if k not in keys:
            issues.append(Issue(path.as_posix(), 0, f"missing-required:{k}"))
        elif not keys[k]:
            issues.append(Issue(path.as_posix(), 0, f"empty-required:{k}"))
    return issues


def read_required(path: Path) -> set[str]:
    """필수 키 목록 파일: 한 줄에 키 하나, '#'로 시작하는 줄과 빈 줄은 무시."""
    lines = (l.strip() for l in path.read_text(encoding="utf-8").splitlines())
    return {l for l in lines if l and not l.startswith("#")}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--required", help="필수 키 목록 파일(한 줄에 키 하나)")
    args = ap.parse_args(argv)
    required = read_required(Path(args.required)) if args.required else None
    issues: list[Issue] = []
    for f in args.files:
        issues += check_file(Path(f), required)
    for i in issues:
        print(i)
    if issues:
        print(f"{len(issues)} issue(s). 값은 출력하지 않는다. 형식 규칙은 docs/infra/design.md 12.4절.")
        return 1
    print(f"OK env ({len(args.files)} file(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
````

- [ ] **Step 4: 테스트 통과 확인**

Run: `python infra/ci/tests/test_check_env_files.py`

Expected: `Ran 15 tests` 다음에 `OK`

- [ ] **Step 5: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/ci/check_env_files.py infra/ci/tests/test_check_env_files.py
git commit -m "chore(infra): env 형식 가드 추가"
```

---

### Task 3: 포트 불변식 가드

**목표:** 호스트에 게시하는 포트가 `127.0.0.1`이 아니면(caddy의 80·443·8443 제외) 실패시킨다.

**Files:**
- Create: `infra/ci/ports_invariant.py`
- Test: `infra/ci/tests/test_ports_invariant.py`

**Interfaces:**
- Produces:
  - `ports_invariant.violations(config: dict, allow: dict[str, set[int]] | None = None, allow_host_network: set[str] | None = None) -> list[str]`
  - `load_config(compose_files: list[str], env_files: list[str] | None = None) -> dict`: `docker compose config --format json`을 실행한다.
  - `parse_allow(items: list[str]) -> dict[str, set[int]]`, `main(argv) -> int`
- CLI: `python infra/ci/ports_invariant.py [--env-file F]... [--allow 서비스=포트,포트]... [--allow-host-network 서비스]... COMPOSE_FILE...`. 위반마다 `FAIL <서비스>: <host_ip>:<포트> -> <컨테이너 포트>`를 출력한다.
- 기본 허용은 caddy의 tcp 80·443·8443뿐이다. UDP 443은 h3를 열지 않으므로(스펙 5절) 위반이다.
- `load_config`는 `--profile '*'`로 compose profile 뒤에 숨은 서비스까지 본다.

- [ ] **Step 1: 실패하는 테스트 작성**

통합 테스트 5개는 실제 `docker compose config`를 쓴다(데몬은 필요 없고 Docker CLI만 필요하다). Docker CLI가 없으면 자동으로 건너뛴다.

````python
import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ports_invariant as pi  # noqa: E402


def svc(**kw):
    return {"services": {"s": kw}}


class ViolationsTest(unittest.TestCase):
    def test_short_syntax_without_host_ip_is_a_violation(self):
        cfg = svc(ports=[{"target": 80, "published": "8080", "protocol": "tcp"}])
        self.assertEqual(pi.violations(cfg), ["s: 0.0.0.0:8080 -> 80"])

    def test_loopback_binding_is_allowed(self):
        cfg = svc(ports=[{"host_ip": "127.0.0.1", "target": 80, "published": "3000"}])
        self.assertEqual(pi.violations(cfg), [])

    def test_explicit_all_interfaces_is_a_violation(self):
        cfg = svc(ports=[{"host_ip": "0.0.0.0", "target": 80, "published": "9000"}])
        self.assertEqual(pi.violations(cfg), ["s: 0.0.0.0:9000 -> 80"])

    def test_caddy_may_publish_80_443_8443(self):
        cfg = {"services": {"caddy": {"ports": [
            {"target": 80, "published": "80"},
            {"target": 443, "published": "443"},
            {"target": 8443, "published": "8443"},
        ]}}}
        self.assertEqual(pi.violations(cfg), [])

    def test_caddy_publishing_another_port_is_a_violation(self):
        cfg = {"services": {"caddy": {"ports": [{"target": 2019, "published": "2019"}]}}}
        self.assertEqual(pi.violations(cfg), ["caddy: 0.0.0.0:2019 -> 2019"])

    def test_caddy_publishing_udp_443_is_a_violation(self):
        cfg = {"services": {"caddy": {"ports": [{"target": 443, "published": "443", "protocol": "udp"}]}}}
        self.assertEqual(pi.violations(cfg), ["caddy: 0.0.0.0:443 -> 443"])

    def test_other_service_cannot_reuse_the_caddy_exception(self):
        cfg = {"services": {"be": {"ports": [{"target": 443, "published": "443"}]}}}
        self.assertEqual(pi.violations(cfg), ["be: 0.0.0.0:443 -> 443"])

    def test_port_range_and_random_host_port_are_violations(self):
        cfg = svc(ports=[{"target": 80, "published": "8000-8010"}, {"target": 81}])
        self.assertEqual(len(pi.violations(cfg)), 2)

    def test_host_network_is_a_violation_unless_allowed(self):
        cfg = svc(network_mode="host")
        self.assertEqual(pi.violations(cfg), ["s: network_mode host"])
        self.assertEqual(pi.violations(cfg, allow_host_network={"s"}), [])

    def test_service_without_ports_is_fine(self):
        self.assertEqual(pi.violations(svc(image="x")), [])

    def test_parse_allow_merges_with_defaults(self):
        allow = pi.parse_allow(["grafana=3000,3001"])
        self.assertEqual(allow["caddy"], {80, 443, 8443})
        self.assertEqual(allow["grafana"], {3000, 3001})


@unittest.skipUnless(shutil.which("docker"), "docker CLI 없음")
class ComposeIntegrationTest(unittest.TestCase):
    """docker compose config의 실제 JSON 형태로 검증한다(데몬 불필요)."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name: str, text: str) -> str:
        p = self.dir / name
        p.write_text(text, encoding="utf-8")
        return str(p)

    def test_short_syntax_is_detected_through_real_compose(self):
        f = self.write(
            "c.yml",
            'services:\n  a:\n    image: x\n    ports: ["8080:80"]\n  b:\n    image: x\n    ports: ["127.0.0.1:3000:80"]\n',
        )
        bad = pi.violations(pi.load_config([f]))
        self.assertEqual(bad, ["a: 0.0.0.0:8080 -> 80"])

    def test_service_behind_a_profile_is_checked(self):
        f = self.write(
            "p.yml",
            'services:\n  a:\n    image: x\n    profiles: ["debug"]\n    ports: ["5005:5005"]\n',
        )
        self.assertEqual(pi.violations(pi.load_config([f])), ["a: 0.0.0.0:5005 -> 5005"])

    def test_env_file_satisfies_required_interpolation(self):
        f = self.write("c.yml", "services:\n  a:\n    image: ${IMG:?required}\n")
        e = self.write("t.env", "IMG=nginx:1\n")
        self.assertEqual(pi.violations(pi.load_config([f], [e])), [])

    def test_missing_required_variable_raises(self):
        f = self.write("c.yml", "services:\n  a:\n    image: ${IMG:?required}\n")
        with self.assertRaises(RuntimeError):
            pi.load_config([f])

    def test_main_exit_codes(self):
        bad = self.write("bad.yml", 'services:\n  a:\n    image: x\n    ports: ["8080:80"]\n')
        good = self.write("good.yml", 'services:\n  a:\n    image: x\n    ports: ["127.0.0.1:3000:80"]\n')
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(pi.main([bad]), 1)
            self.assertEqual(pi.main([good]), 0)


if __name__ == "__main__":
    unittest.main()
````

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `python infra/ci/tests/test_ports_invariant.py`

Expected: `ModuleNotFoundError: No module named 'ports_invariant'`

- [ ] **Step 3: 구현**

````python
#!/usr/bin/env python3
"""compose 포트 노출 불변식 검사 (스펙 13.1).

규칙
  1. 호스트에 게시하는 포트는 host_ip가 127.0.0.1이어야 한다. host_ip가 없는 짧은 문법(`8080:80`)은 0.0.0.0이다.
  2. 예외는 (서비스, 호스트 포트) 조합으로 명시한 것뿐이다. 기본값은 caddy=80,443,8443이고 --allow로 더한다.
  3. network_mode: host는 모든 포트를 노출하므로 --allow-host-network로 명시한 서비스만 허용한다.

Docker가 게시한 포트는 ufw를 우회하므로 이 검사가 노출 사고(A603)를 막는 1차 방어선이다.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys

LOOPBACK = frozenset({"127.0.0.1", "::1", "localhost"})
DEFAULT_ALLOW: dict[str, set[int]] = {"caddy": {80, 443, 8443}}


def violations(
    config: dict,
    allow: dict[str, set[int]] | None = None,
    allow_host_network: set[str] | None = None,
) -> list[str]:
    allow = DEFAULT_ALLOW if allow is None else allow
    allow_host_network = allow_host_network or set()
    out: list[str] = []
    for name, svc in sorted((config.get("services") or {}).items()):
        if svc.get("network_mode") == "host" and name not in allow_host_network:
            out.append(f"{name}: network_mode host")
        for p in svc.get("ports") or []:
            host_ip = p.get("host_ip") or ""
            if host_ip in LOOPBACK:
                continue
            published = p.get("published")
            try:
                port = int(published) if published not in (None, "") else None
            except ValueError:  # "8000-8010" 같은 범위
                port = None
            if port is not None and port in allow.get(name, set()) and p.get("protocol", "tcp") == "tcp":
                continue
            out.append(f"{name}: {host_ip or '0.0.0.0'}:{published or '?'} -> {p.get('target')}")
    return out


def load_config(compose_files: list[str], env_files: list[str] | None = None) -> dict:
    cmd = ["docker", "compose"]
    for e in env_files or []:
        cmd += ["--env-file", e]
    for f in compose_files:
        cmd += ["-f", f]
    cmd += ["--profile", "*", "config", "--format", "json"]  # profile 뒤에 숨은 서비스도 검사한다
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("docker compose config failed: " + r.stderr.decode(errors="replace").strip())
    return json.loads(r.stdout)


def parse_allow(items: list[str]) -> dict[str, set[int]]:
    allow = {k: set(v) for k, v in DEFAULT_ALLOW.items()}
    for item in items:
        name, _, ports = item.partition("=")
        allow.setdefault(name, set()).update(int(p) for p in ports.split(",") if p)
    return allow


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("compose_files", nargs="+", help="한 프로젝트를 이루는 compose 파일들(병합해서 검사)")
    ap.add_argument("--env-file", action="append", default=[])
    ap.add_argument("--allow", action="append", default=[], metavar="SERVICE=PORT[,PORT]")
    ap.add_argument("--allow-host-network", action="append", default=[], metavar="SERVICE")
    args = ap.parse_args(argv)
    try:
        config = load_config(args.compose_files, args.env_file)
    except RuntimeError as e:
        print(f"FAIL {e}")
        return 1
    bad = violations(config, parse_allow(args.allow), set(args.allow_host_network))
    for v in bad:
        print(f"FAIL {v}")
    if bad:
        print("호스트 게시 포트는 127.0.0.1:로 바인딩해야 한다(공개는 caddy만). 스펙 13.1절.")
        return 1
    print(f"OK ports ({len(config.get('services') or {})} service(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
````

- [ ] **Step 4: 테스트 통과 확인**

Run: `python infra/ci/tests/test_ports_invariant.py`

Expected: `Ran 16 tests` 다음에 `OK` (Docker CLI가 없으면 통합 5개는 skipped)

- [ ] **Step 5: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/ci/ports_invariant.py infra/ci/tests/test_ports_invariant.py
git commit -m "chore(infra): compose 포트 노출 불변식 가드 추가"
```

---

### Task 4: 마이그레이션 불변성 가드

**목표:** MR이 적용된 Flyway 마이그레이션을 수정하거나 버전을 충돌시키면 실패시킨다.

**Files:**
- Create: `infra/ci/migration_immutability.py`
- Test: `infra/ci/tests/test_migration_immutability.py`

**Interfaces:**
- Produces:
  - `migration_immutability.changed_migrations(base, directory, cwd=None) -> list[str]`: `git diff --name-status` 줄. 반복 마이그레이션 `R__*`의 수정은 제외한다.
  - `version_problems(base, directory, cwd=None) -> list[str]`: `duplicate-version`, `out-of-order`
  - `ensure_commit(base, cwd=None)`: base 커밋이 얕은 clone에 없으면 그 커밋만 fetch한다.
  - `default_base() -> str`, `main(argv) -> int`
- CLI: `python infra/ci/migration_immutability.py [--base REF] [--dir DIR]`. 기본 디렉터리는 `be/src/main/resources/db/migration`이고 환경변수 `MIGRATION_DIR`로 바꿀 수 있다. 기본 base는 `CI_MERGE_REQUEST_DIFF_BASE_SHA`, 없으면 `origin/develop`이다.
- 새 버전 파일의 추가만 허용한다. 아래가 있으면 종료 코드 1이다.
  - 버전 마이그레이션(`V*`)의 수정(M), 삭제(D), 이름 변경(D로 보인다)
  - HEAD의 중복 버전
  - base의 최대 버전 이하인 새 버전
- 버전 충돌을 검사하는 이유: 같은 번호를 두 MR이 쓰거나 이미 적용된 최대 번호보다 낮은 번호를 추가하면 Flyway의 validate가 기동을 막는다(A603 사고). 반복 마이그레이션(`R__*`)은 고쳐서 다시 적용하는 것이 정상이다. base는 MR의 병합 기준점(`CI_MERGE_REQUEST_DIFF_BASE_SHA`)이라 두 점 diff로 충분하다.

- [ ] **Step 1: 실패하는 테스트 작성**

테스트는 임시 git 저장소를 만들어 실제 `git diff`로 검증한다.

````python
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import migration_immutability as mi  # noqa: E402

DIR = "be/src/main/resources/db/migration"


@unittest.skipUnless(shutil.which("git"), "git 없음")
class MigrationImmutabilityTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@t.t")
        self.git("config", "user.name", "t")
        self.git("config", "commit.gpgsign", "false")
        self.put(f"{DIR}/V1__init.sql", "create table a(id int);\n")
        self.put(f"{DIR}/V3__third.sql", "create table c(id int);\n")
        self.put(f"{DIR}/R__views.sql", "create or replace view v as select 1;\n")
        self.put("README.md", "x\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "base")
        self.git("checkout", "-q", "-b", "feature")

    def tearDown(self):
        self._tmp.cleanup()

    def git(self, *args: str) -> None:
        subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True)

    def put(self, rel: str, text: str) -> None:
        p = self.repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8", newline="\n")

    def commit(self) -> None:
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "change")

    def changed(self) -> list[str]:
        return mi.changed_migrations("main", DIR, cwd=str(self.repo))

    def problems(self) -> list[str]:
        return mi.version_problems("main", DIR, cwd=str(self.repo))

    def test_adding_a_new_migration_is_allowed(self):
        self.put(f"{DIR}/V4__add_b.sql", "create table b(id int);\n")
        self.commit()
        self.assertEqual(self.changed(), [])
        self.assertEqual(self.problems(), [])

    def test_modifying_an_existing_migration_is_flagged(self):
        self.put(f"{DIR}/V1__init.sql", "create table a(id bigint);\n")
        self.commit()
        self.assertEqual(self.changed(), [f"M\t{DIR}/V1__init.sql"])

    def test_editing_a_repeatable_migration_is_allowed(self):
        self.put(f"{DIR}/R__views.sql", "create or replace view v as select 2;\n")
        self.commit()
        self.assertEqual(self.changed(), [])

    def test_deleting_an_existing_migration_is_flagged(self):
        (self.repo / DIR / "V1__init.sql").unlink()
        self.commit()
        self.assertEqual(self.changed(), [f"D\t{DIR}/V1__init.sql"])

    def test_renaming_an_existing_migration_is_flagged_as_a_delete(self):
        self.git("mv", f"{DIR}/V1__init.sql", f"{DIR}/V1__renamed.sql")
        self.commit()
        self.assertEqual(self.changed(), [f"D\t{DIR}/V1__init.sql"])

    def test_changes_outside_the_directory_are_ignored(self):
        self.put("README.md", "changed\n")
        self.commit()
        self.assertEqual(self.changed(), [])

    def test_duplicate_version_is_flagged(self):
        self.put(f"{DIR}/V4__one.sql", "select 1;\n")
        self.put(f"{DIR}/V4__two.sql", "select 2;\n")
        self.commit()
        self.assertTrue(any(p.startswith("duplicate-version") for p in self.problems()), self.problems())

    def test_version_below_the_applied_maximum_is_flagged(self):
        self.put(f"{DIR}/V2__late.sql", "select 2;\n")
        self.commit()
        self.assertEqual(self.problems(), [f"out-of-order\t{DIR}/V2__late.sql"])

    def test_unknown_base_raises(self):
        with self.assertRaises(RuntimeError):
            mi.changed_migrations("nope", DIR, cwd=str(self.repo))

    def test_ensure_commit_is_a_noop_for_refs_and_present_commits(self):
        mi.ensure_commit("main", cwd=str(self.repo))
        head = subprocess.run(["git", "rev-parse", "main"], cwd=self.repo, capture_output=True, text=True).stdout.strip()
        mi.ensure_commit(head, cwd=str(self.repo))


if __name__ == "__main__":
    unittest.main()
````

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `python infra/ci/tests/test_migration_immutability.py`

Expected: `ModuleNotFoundError: No module named 'migration_immutability'`

- [ ] **Step 3: 구현**

````python
#!/usr/bin/env python3
"""적용된 Flyway 마이그레이션 수정 금지와 버전 충돌 검사 (스펙 6.5).

base와 HEAD를 비교해 아래를 실패로 본다. 새 버전 파일의 추가만 정상이다.
  - 버전 마이그레이션(V*)의 수정(M), 삭제(D), 이름 변경(D로 보인다). 반복 마이그레이션(R__*)의 수정은 정상이다.
  - HEAD에서 같은 버전이 둘 이상(duplicate-version)
  - base의 최대 버전 이하인 새 버전(out-of-order). 이미 적용된 DB에서 Flyway validate가 기동을 막는다(A603 사고).
base는 MR의 병합 기준점(CI_MERGE_REQUEST_DIFF_BASE_SHA)이라 3점 diff가 필요 없다. 그 커밋이 얕은 clone에 없으면 하나만 가져온다.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import PurePosixPath

DEFAULT_DIR = "be/src/main/resources/db/migration"
VERSIONED_RE = re.compile(r"^V(\d+(?:[._]\d+)*)__")
SHA_RE = re.compile(r"^[0-9a-f]{7,40}$")


def git(args: list[str], cwd: str | None) -> str:
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {args[0]} failed: " + r.stderr.strip())
    return r.stdout


def ensure_commit(base: str, cwd: str | None = None) -> None:
    """base가 커밋 해시이고 로컬에 없으면(얕은 clone) 그 커밋 하나만 가져온다."""
    if not SHA_RE.match(base):
        return
    have = subprocess.run(["git", "cat-file", "-e", f"{base}^{{commit}}"], cwd=cwd, capture_output=True)
    if have.returncode != 0:
        git(["fetch", "--quiet", "--depth=1", "origin", base], cwd)


def version_of(path: str) -> tuple[int, ...] | None:
    m = VERSIONED_RE.match(PurePosixPath(path).name)
    return tuple(int(x) for x in re.split(r"[._]", m.group(1))) if m else None


def changed_migrations(base: str, directory: str, cwd: str | None = None) -> list[str]:
    """base 대비 수정·삭제·이름 변경된 마이그레이션(git diff --name-status 줄). 반복 마이그레이션의 수정은 뺀다."""
    out = git(["diff", "--name-status", "--no-renames", "--diff-filter=a", base, "HEAD", "--", directory], cwd)
    lines = [ln for ln in out.splitlines() if ln.strip()]
    return [ln for ln in lines if not (ln[0] == "M" and PurePosixPath(ln.split("\t")[-1]).name.startswith("R__"))]


def version_problems(base: str, directory: str, cwd: str | None = None) -> list[str]:
    """HEAD의 중복 버전과, base의 최대 버전 이하인 새 버전."""

    def versions(ref: str) -> dict[str, tuple[int, ...]]:
        names = git(["ls-tree", "-r", "--name-only", ref, "--", directory], cwd).splitlines()
        return {n: v for n in names if (v := version_of(n)) is not None}

    head, old = versions("HEAD"), versions(base)
    problems: list[str] = []
    seen: dict[tuple[int, ...], str] = {}
    for name, v in sorted(head.items()):
        if v in seen:
            problems.append(f"duplicate-version\t{name} = {seen[v]}")
        seen.setdefault(v, name)
    top = max(old.values(), default=())
    for name in sorted(set(head) - set(old)):
        if head[name] <= top:
            problems.append(f"out-of-order\t{name}")
    return problems


def default_base() -> str:
    return os.environ.get("CI_MERGE_REQUEST_DIFF_BASE_SHA") or "origin/develop"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default=default_base(), help="비교 기준 ref (기본: MR diff base 또는 origin/develop)")
    ap.add_argument("--dir", default=os.environ.get("MIGRATION_DIR", DEFAULT_DIR), dest="directory")
    args = ap.parse_args(argv)
    try:
        ensure_commit(args.base)
        problems = changed_migrations(args.base, args.directory) + version_problems(args.base, args.directory)
    except RuntimeError as e:
        print(f"FAIL {e}")
        return 1
    for line in problems:
        print(f"FAIL {line}")
    if problems:
        print("적용된 마이그레이션은 고치지 않는다. 새 파일을 추가하세요(V<다음 번호>__설명.sql). 번호는 기존 최대값보다 커야 하고 겹치면 안 된다.")
        return 1
    print(f"OK migrations (base={args.base}, dir={args.directory})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
````

- [ ] **Step 4: 테스트 통과 확인**

Run: `python infra/ci/tests/test_migration_immutability.py`

Expected: `Ran 10 tests` 다음에 `OK`

- [ ] **Step 5: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/ci/migration_immutability.py infra/ci/tests/test_migration_immutability.py
git commit -m "chore(infra): 마이그레이션 불변성 가드 추가"
```

---

### Task 5: 이미지 아키텍처 가드

**목표:** 이미지가 대상 호스트 플랫폼(amd64, arm64)을 지원하는지 레지스트리로 확인한다.

**Files:**
- Create: `infra/ci/images_arch.py`
- Test: `infra/ci/tests/test_images_arch.py`

**Interfaces:**
- Produces:
  - `images_arch.check(images: set[str], platforms: list[str], inspector: Callable[[str], set[str]] = inspect_platforms) -> list[str]`
  - `inspect_platforms(image: str) -> set[str]`: `docker buildx imagetools inspect`를 쓴다.
  - `images_from_dockerfile(text) -> tuple[set[str], set[str]]`, `images_from_compose_config(config) -> set[str]`, `images_from_shell_vars(text) -> set[str]`, `InspectError`
- CLI: `python infra/ci/images_arch.py --platform linux/arm64 [--platform linux/amd64] [--image IMG]... [--images-from-sh FILE]... [--dockerfile F]... [--compose F]... [--env-file F]...`. 문제마다 `FAIL <이미지>: missing <플랫폼> (has: ...)` 또는 `FAIL <이미지>: inspect-error ...`를 출력한다.
- 이미지당 한 번만 조회한다(Docker Hub 익명 pull 한도 절약).

- [ ] **Step 1: 실패하는 테스트 작성**

레지스트리 접근 없이 가짜 조회 함수를 주입해 검증한다.

````python
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import images_arch as ia  # noqa: E402


class PlatformsFromIndexTest(unittest.TestCase):
    def test_collects_platforms_and_skips_attestation_entries(self):
        index = {"manifests": [
            {"platform": {"architecture": "amd64", "os": "linux"}},
            {"platform": {"architecture": "arm64", "os": "linux", "variant": "v8"}},
            {"platform": {"architecture": "unknown", "os": "unknown"}},
        ]}
        self.assertEqual(ia.platforms_from_index(index), {"linux/amd64", "linux/arm64"})

    def test_empty_index_gives_no_platforms(self):
        self.assertEqual(ia.platforms_from_index({}), set())


class DockerfileParsingTest(unittest.TestCase):
    def test_multistage_platform_flag_alias_and_scratch(self):
        text = (
            "FROM --platform=$BUILDPLATFORM golang:1.22 AS build\n"
            "RUN go build\n"
            "FROM build AS test\n"
            "FROM scratch\n"
            "FROM gcr.io/distroless/static:nonroot AS final\n"
        )
        resolved, unresolved = ia.images_from_dockerfile(text)
        self.assertEqual(resolved, {"golang:1.22", "gcr.io/distroless/static:nonroot"})
        self.assertEqual(unresolved, set())

    def test_variable_image_is_reported_as_unresolved(self):
        resolved, unresolved = ia.images_from_dockerfile("ARG BASE=x\nFROM ${BASE}\nfrom alpine:3.20\n")
        self.assertEqual(resolved, {"alpine:3.20"})
        self.assertEqual(unresolved, {"${BASE}"})


class SourcesTest(unittest.TestCase):
    def test_compose_config_images(self):
        cfg = {"services": {"a": {"image": "x:1"}, "b": {"build": {"context": "."}}, "c": {"image": "y:2"}}}
        self.assertEqual(ia.images_from_compose_config(cfg), {"x:1", "y:2"})

    def test_shell_vars_images_ignore_comments_and_other_variables(self):
        text = "# comment\nFOO_IMAGE=a/b:1\nBAR=not-an-image\nBAZ_IMAGE=c:2\n"
        self.assertEqual(ia.images_from_shell_vars(text), {"a/b:1", "c:2"})


class CheckTest(unittest.TestCase):
    def fake(self, table, calls=None):
        def inspector(image):
            if calls is not None:
                calls.append(image)
            v = table[image]
            if isinstance(v, Exception):
                raise v
            return v
        return inspector

    def test_all_images_support_all_platforms(self):
        table = {"a": {"linux/amd64", "linux/arm64"}, "b": {"linux/arm64", "linux/amd64"}}
        self.assertEqual(ia.check({"a", "b"}, ["linux/arm64", "linux/amd64"], self.fake(table)), [])

    def test_missing_platform_is_reported_with_what_exists(self):
        table = {"a": {"linux/amd64"}}
        self.assertEqual(
            ia.check({"a"}, ["linux/arm64"], self.fake(table)),
            ["a: missing linux/arm64 (has: linux/amd64)"],
        )

    def test_each_image_is_inspected_once_even_for_several_platforms(self):
        calls = []
        table = {"a": {"linux/amd64", "linux/arm64"}}
        ia.check({"a"}, ["linux/arm64", "linux/amd64"], self.fake(table, calls))
        self.assertEqual(calls, ["a"])

    def test_inspect_error_is_reported_once(self):
        table = {"a": ia.InspectError("denied")}
        self.assertEqual(
            ia.check({"a"}, ["linux/amd64", "linux/arm64"], self.fake(table)),
            ["a: inspect-error denied"],
        )


if __name__ == "__main__":
    unittest.main()
````

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `python infra/ci/tests/test_images_arch.py`

Expected: `ModuleNotFoundError: No module named 'images_arch'`

- [ ] **Step 3: 구현**

`inspect_platforms`는 두 경로를 처리한다. 이미지 인덱스는 `--raw`의 `manifests[].platform`에서, 단일 매니페스트는 platform 정보가 없어서 `--format '{{json .Image}}'`의 `architecture`·`os`에서 읽는다. 이 두 출력 형태는 실제 레지스트리로 확인했다.

````python
#!/usr/bin/env python3
"""이미지가 대상 호스트 플랫폼(linux/amd64, linux/arm64)을 지원하는지 검사 (스펙 3절).

검사 대상: compose 설정의 services.*.image, Dockerfile의 FROM, tool-images.sh 같은 *_IMAGE=값 파일, --image로 직접 준 이미지.
변수로 치환되는 이미지(`FROM ${BASE}`)는 판정할 수 없어 SKIP으로 알린다.
이미지당 한 번만 조회한다(`docker buildx imagetools inspect`, 레지스트리 접근 필요. 익명 pull 한도를 아끼기 위해).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable

Inspector = Callable[[str], "set[str]"]
PLATFORMS = ["linux/amd64", "linux/arm64"]


class InspectError(RuntimeError):
    pass


def platform_key(p: dict) -> str:
    return f"{p.get('os', '')}/{p.get('architecture', '')}"


def platforms_from_index(index: dict) -> set[str]:
    """이미지 인덱스의 manifests에서 platform을 모은다(attestation의 unknown/unknown은 제외)."""
    out = set()
    for m in index.get("manifests") or []:
        p = m.get("platform") or {}
        if p.get("architecture") and p.get("architecture") != "unknown":
            out.add(platform_key(p))
    return out


def inspect_platforms(image: str) -> set[str]:
    def run(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(["docker", "buildx", "imagetools", "inspect", *args, image], capture_output=True, timeout=90)

    raw = run("--raw")
    if raw.returncode != 0:
        raw = run("--raw")  # 레지스트리 일시 오류를 한 번 재시도
    if raw.returncode != 0:
        lines = raw.stderr.decode(errors="replace").strip().splitlines()
        raise InspectError(lines[-1][:200] if lines else "inspect failed")
    data = json.loads(raw.stdout)
    if "manifests" in data:
        return platforms_from_index(data)
    # 단일 매니페스트: platform 정보가 없으므로 이미지 설정에서 읽는다
    cfg = run("--format", "{{json .Image}}")
    if cfg.returncode != 0:
        raise InspectError("cannot read image config")
    img = json.loads(cfg.stdout)
    if "architecture" in img and "os" in img:
        return {platform_key(img)}
    return {k for k in img if "/" in k}


FROM_RE = re.compile(r"^\s*FROM\s+(?P<rest>.+?)\s*$", re.IGNORECASE)
SHELL_IMAGE_RE = re.compile(r"^[A-Z][A-Z0-9_]*_IMAGE=(\S+)\s*$", re.MULTILINE)


def images_from_dockerfile(text: str) -> tuple[set[str], set[str]]:
    """(판정 가능한 이미지, 변수라 판정 못 하는 이미지)를 돌려준다. 앞선 스테이지 이름과 scratch는 제외한다."""
    resolved: set[str] = set()
    unresolved: set[str] = set()
    stages: set[str] = set()
    for line in text.splitlines():
        m = FROM_RE.match(line)
        if not m:
            continue
        tokens = [t for t in m.group("rest").split() if not t.startswith("--")]
        if not tokens:
            continue
        image = tokens[0]
        alias = tokens[2].lower() if len(tokens) >= 3 and tokens[1].upper() == "AS" else None
        if image.lower() != "scratch" and image.lower() not in stages:
            (unresolved if "$" in image else resolved).add(image)
        if alias:
            stages.add(alias)
    return resolved, unresolved


def images_from_compose_config(config: dict) -> set[str]:
    return {s["image"] for s in (config.get("services") or {}).values() if s.get("image")}


def images_from_shell_vars(text: str) -> set[str]:
    return set(SHELL_IMAGE_RE.findall(text))


def check(images: set[str], platforms: list[str], inspector: Inspector = inspect_platforms) -> list[str]:
    problems = []
    for image in sorted(images):
        try:
            have = inspector(image)
        except (InspectError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
            problems.append(f"{image}: inspect-error {e}")
            continue
        for platform in platforms:
            if platform not in have:
                problems.append(f"{image}: missing {platform} (has: {','.join(sorted(have)) or 'unknown'})")
    return problems


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--platform", action="append", required=True, choices=PLATFORMS)
    ap.add_argument("--image", action="append", default=[])
    ap.add_argument("--images-from-sh", action="append", default=[], metavar="FILE", help="*_IMAGE=값 형식의 셸 파일")
    ap.add_argument("--dockerfile", action="append", default=[])
    ap.add_argument("--compose", action="append", default=[], help="한 프로젝트의 compose 파일(병합). 여러 프로젝트면 따로 실행")
    ap.add_argument("--env-file", action="append", default=[])
    args = ap.parse_args(argv)

    images = set(args.image)
    for sh in args.images_from_sh:
        images |= images_from_shell_vars(Path(sh).read_text(encoding="utf-8"))
    for df in args.dockerfile:
        resolved, unresolved = images_from_dockerfile(Path(df).read_text(encoding="utf-8"))
        images |= resolved
        for u in sorted(unresolved):
            print(f"SKIP {df}: unresolved image {u}")
    if args.compose:
        import ports_invariant  # compose 로딩을 공유한다

        images |= images_from_compose_config(ports_invariant.load_config(args.compose, args.env_file))
    if not images:
        print("OK arch (no images)")
        return 0
    problems = check(images, args.platform)
    for p in problems:
        print(f"FAIL {p}")
    if problems:
        return 1
    print(f"OK arch {','.join(args.platform)} ({len(images)} image(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
````

- [ ] **Step 4: 단위 테스트 통과 확인**

Run: `python infra/ci/tests/test_images_arch.py`

Expected: `Ran 10 tests` 다음에 `OK`

- [ ] **Step 5: 실제 레지스트리로 조회 방식 확인 (게이트, 3회만 조회)**

이 확인은 파싱 방식이 실제 출력과 맞는지 보는 일회성 게이트다. 조회는 아래 세 번뿐이다.

```bash
python infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --image caddy:2.11.7
python infra/ci/images_arch.py --platform linux/arm64 --image gcr.io/google-containers/pause-amd64:3.2
python infra/ci/images_arch.py --platform linux/arm64 --image docker.io/library/this-image-does-not-exist-xyz:1
```

Expected, 순서대로:

```text
OK arch linux/arm64,linux/amd64 (1 image(s))
FAIL gcr.io/google-containers/pause-amd64:3.2: missing linux/arm64 (has: linux/amd64)
FAIL docker.io/library/this-image-does-not-exist-xyz:1: inspect-error ERROR: pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed
```

두 번째와 세 번째는 종료 코드 1이다. 두 번째가 단일 매니페스트 경로다. 오프라인이거나 `gcr.io`에 접근할 수 없으면 두 번째 확인은 건너뛰고 사용자에게 알린다.

- [ ] **Step 6: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/ci/images_arch.py infra/ci/tests/test_images_arch.py
git commit -m "chore(infra): 이미지 아키텍처 가드 추가"
```

---

### Task 6: compose 프로젝트 순회

**목표:** compose 프로젝트 목록을 순회하며 포트 검사를 적용한다.

**Files:**
- Create: `infra/ci/check_compose_projects.py`
- Create: `infra/ci/compose-projects.txt`
- Test: `infra/ci/tests/test_check_compose_projects.py`

**Interfaces:**
- Consumes: `ports_invariant.main(argv) -> int` (Task 3)
- Produces: `check_compose_projects.parse_manifest(text: str) -> list[tuple[str, list[str]]]`, `main(argv: list[str]) -> int`
- CLI: `python infra/ci/check_compose_projects.py [매니페스트 경로]`. 기본값은 같은 디렉터리의 `compose-projects.txt`다. 이후 계획이 compose 파일을 만들 때마다 매니페스트에 한 줄을 추가한다. 로컬 러너와 CI가 이 스크립트를 공통으로 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

````python
import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_compose_projects as ccp  # noqa: E402


class ParseManifestTest(unittest.TestCase):
    def test_skips_comments_and_blank_lines_and_splits_args(self):
        text = "# c\n\nedge infra/edge/c.yml --env-file infra/ci/ci.env\napp 'a b.yml' --allow x=1,2\n"
        self.assertEqual(
            ccp.parse_manifest(text),
            [
                ("edge", ["infra/edge/c.yml", "--env-file", "infra/ci/ci.env"]),
                ("app", ["a b.yml", "--allow", "x=1,2"]),
            ],
        )


class MainTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def run_main(self, manifest_text: str) -> int:
        m = self.dir / "projects.txt"
        m.write_text(manifest_text, encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            return ccp.main([str(m)])

    def test_empty_manifest_passes(self):
        self.assertEqual(self.run_main("# nothing\n"), 0)

    @unittest.skipUnless(shutil.which("docker"), "docker CLI 없음")
    def test_bad_project_fails_and_good_project_passes(self):
        bad = self.dir / "bad.yml"
        bad.write_text('services:\n  a:\n    image: x\n    ports: ["8080:80"]\n', encoding="utf-8")
        good = self.dir / "good.yml"
        good.write_text('services:\n  a:\n    image: x\n    ports: ["127.0.0.1:3000:80"]\n', encoding="utf-8")
        self.assertEqual(self.run_main(f"good {good.as_posix()}\n"), 0)
        self.assertEqual(self.run_main(f"good {good.as_posix()}\nbad {bad.as_posix()}\n"), 1)


if __name__ == "__main__":
    unittest.main()
````

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `python infra/ci/tests/test_check_compose_projects.py`

Expected: `ModuleNotFoundError: No module named 'check_compose_projects'`

- [ ] **Step 3: 구현과 빈 매니페스트**

````python
#!/usr/bin/env python3
"""compose-projects.txt의 각 프로젝트에 포트 불변식(ports_invariant.py)을 적용한다.

로컬 러너와 CI가 같은 코드로 프로젝트 목록을 순회하도록 셸 루프 대신 이 스크립트를 쓴다.
경로는 저장소 루트 기준이므로 루트에서 실행한다.
"""
from __future__ import annotations

import shlex
import sys
from pathlib import Path

import ports_invariant

MANIFEST = Path(__file__).with_name("compose-projects.txt")


def parse_manifest(text: str) -> list[tuple[str, list[str]]]:
    projects = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        label, *args = shlex.split(line)
        projects.append((label, args))
    return projects


def main(argv: list[str]) -> int:
    manifest = Path(argv[0]) if argv else MANIFEST
    projects = parse_manifest(manifest.read_text(encoding="utf-8"))
    if not projects:
        print("SKIP ports (compose 프로젝트 없음)")
        return 0
    failed = 0
    for label, args in projects:
        print(f"== {label}")
        if ports_invariant.main(args) != 0:
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
````

````text
# 포트 불변식(ports_invariant.py)을 검사할 compose 프로젝트 목록. 한 줄이 한 프로젝트다.
# 형식: <라벨> <compose 파일>... [--env-file <경로>]... [--allow 서비스=포트,포트]...
# 예:   edge infra/edge/compose.edge.yml --env-file infra/ci/ci.env
````

- [ ] **Step 4: 테스트 통과 확인**

Run: `python infra/ci/tests/test_check_compose_projects.py`

Expected: `Ran 3 tests` 다음에 `OK` (Docker CLI가 없으면 1개는 skipped)

- [ ] **Step 5: 기본 매니페스트 실행 확인**

Run: `python infra/ci/check_compose_projects.py`

Expected: `SKIP ports (compose 프로젝트 없음)`

- [ ] **Step 6: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/ci/check_compose_projects.py infra/ci/compose-projects.txt infra/ci/tests/test_check_compose_projects.py
git commit -m "chore(infra): compose 프로젝트 순회 스크립트 추가"
```

---

### Task 7: 도구 이미지 핀, 린터 설정, 로컬 러너

**목표:** 서버 없이 이 PC에서 CI의 lint를 그대로 돌리는 러너, 린터 도구 이미지 핀, 커밋 전 시크릿 검사 훅을 만든다.

**Files:**
- Create: `infra/ci/tool-images.sh`
- Create: `.yamllint.yaml`
- Create: `.gitleaks.toml`
- Create: `infra/ci/run-local-checks.sh`
- Create: `infra/ci/pre-commit-secrets.sh`
- Create: `.githooks/pre-commit`

**Interfaces:**
- Consumes: Task 1~6의 가드 CLI 전부
- Produces:
  - `bash infra/ci/run-local-checks.sh [--self-test]`: 정상 실행은 각 검사에 `PASS`, `FAIL`, `SKIP`을 출력하고 하나라도 FAIL이면 종료 코드 1이다. `--self-test`는 나쁜 입력을 만들어 각 검사가 거부하는지 확인한다.
  - `infra/ci/tool-images.sh`: `*_IMAGE=값` 형식이고 Task 8의 `.gitlab-ci.yml` `variables`와 같아야 한다.
  - `infra/ci/pre-commit-secrets.sh`와 `.githooks/pre-commit`: 스테이징한 변경에서 시크릿을 찾는 훅이다(선택, Step 8).

- [ ] **Step 1: 도구 이미지 핀 작성**

````sh
# shellcheck shell=sh disable=SC2034
# CI와 로컬 러너(run-local-checks.sh)가 함께 쓰는 도구 이미지 핀.
# 바꾸면 .gitlab-ci.yml의 variables도 같은 값으로 바꾼다 (tests/test_tool_images_sync.py가 검사한다).
# 이 이미지들은 Arm인 B에서도 돌므로 amd64와 arm64를 모두 지원해야 한다 (images_arch.py로 확인).
SHELLCHECK_IMAGE=koalaman/shellcheck-alpine:v0.11.0
HADOLINT_IMAGE=hadolint/hadolint:v2.15.1-alpine
YAMLLINT_IMAGE=pipelinecomponents/yamllint:0.35.27
GITLEAKS_IMAGE=zricethezav/gitleaks:v8.30.1
CADDY_IMAGE=caddy:2.11.7
PROMETHEUS_IMAGE=prom/prometheus:v3.15.0
DOCKER_CLI_IMAGE=docker:29.9.0-cli
PYTHON_IMAGE=python:3.12.15-slim
````

- [ ] **Step 2: 핀한 이미지가 amd64와 arm64를 모두 지원하는지 확인 (게이트)**

CI 잡은 Arm인 B에서 돌기 때문에 필수 확인이다.

Run: `python infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --images-from-sh infra/ci/tool-images.sh`

Expected: `OK arch linux/arm64,linux/amd64 (8 image(s))`

- [ ] **Step 3: 린터 설정 작성**

`.yamllint.yaml`. `ignore`에 자가 테스트 디렉터리를 넣지 않는다. 명시한 파일에도 ignore가 적용돼 yamllint가 아예 돌지 않는다.

````yaml
extends: default

ignore: |
  .git/
  node_modules/

rules:
  line-length: disable
  document-start: disable
  comments:
    min-spaces-from-content: 1
  comments-indentation: disable
  truthy:
    check-keys: false
````

`.gitleaks.toml`. 자가 테스트 파일을 allowlist에 넣지 않는다. 넣으면 가짜 토큰이 통과해 자가 테스트가 죽은 검사로 오판한다.

````toml
title = "fit gitleaks config"

[extend]
useDefault = true

[allowlist]
description = "env 예제의 자리표시자와 .git 디렉터리"
regexes = [
  '''CHANGE_ME[A-Z0-9_]*''',
]
paths = [
  '''(^|/)\.git/''',
]
````

- [ ] **Step 4: 로컬 러너 작성**

러너 코드에는 아래 여섯 가지 처리가 들어 있다. 모두 실제로 문제가 나는 것을 확인한 대응이므로 단순화하지 않는다.

- **Python 탐색:** `command -v`가 아니라 실제로 실행해 본다. Windows의 `python3` 스토어 바로가기는 실행하면 설치 안내만 출력한다.
- **자가 테스트의 나쁜 스크립트:** 따옴표 닫은 here-doc으로 만든다. `printf '...$UNQUOTED...'`로 만들면 러너 자신이 shellcheck SC2016에 걸린다.
- **가짜 토큰:** 리터럴을 둘로 쪼개 만든다. 이 파일 자체가 gitleaks에 걸리지 않게 하려는 것이다.
- **파일 목록 수집:** `mapfile` 대신 `while read`를 쓴다. macOS의 bash 3.2에는 `mapfile`이 없어 검사가 아무 출력 없이 건너뛰어지고 종료 코드 0이 된다.
- **린트 범위:** 인프라 소유 파일(`infra/`와 루트 설정)만 본다. be의 Dockerfile만 오류 수준으로 본다. 전형적인 Spring Boot `application.yml`, Gradle 다단계 Dockerfile, 셸 스크립트가 기본 규칙에 모두 걸리고, 팀원의 코드가 경고만으로 CI를 막으면 CI를 무시하게 된다.
- **시크릿 스캔:** 커밋할 수 있는 파일만 임시 디렉터리에 복사해 gitleaks로 본다. `gitleaks dir .`는 .gitignore된 로컬 env 파일과 빌드 산출물까지 읽어 로컬에서만 실패한다.

````bash
#!/usr/bin/env bash
# 서버 없이 이 PC에서 CI의 lint 단계를 그대로 돌리는 러너.
#   bash infra/ci/run-local-checks.sh              # 모든 검사
#   bash infra/ci/run-local-checks.sh --self-test  # 검사가 나쁜 입력을 거부하는지(죽은 검사 방지) 확인
#   SKIP_ARCH=1 bash infra/ci/run-local-checks.sh  # 오프라인일 때 이미지 아키텍처 조회를 건너뜀
# 필요한 것: git, python 3.9 이상, docker, tar. 린터는 핀한 컨테이너로 돈다(tool-images.sh). macOS의 bash 3.2에서도 돈다.
set -u -o pipefail
# Windows의 Python은 콘솔 코드 페이지(cp949)로 출력해 UTF-8 터미널(Git Bash)에서 한글이 깨지므로 UTF-8로 고정한다.
export PYTHONUTF8=1

ROOT="$(git rev-parse --show-toplevel)" || exit 2
cd "$ROOT" || exit 2
# shellcheck source=infra/ci/tool-images.sh
. infra/ci/tool-images.sh

PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3 python; do
    # Windows의 python3 스토어 바로가기는 실행하면 설치 안내만 출력하므로 실제로 실행해 확인한다
    if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
      PY="$c"
      break
    fi
  done
fi
if [ -z "$PY" ]; then
  echo "python 3.9 이상이 필요하다 (PYTHON=경로 로 지정할 수 있다)" >&2
  exit 2
fi

# Git Bash(Windows)는 docker -v에 Windows 경로를 줘야 하고 인자 경로 자동 변환을 꺼야 한다.
case "$(uname -s)" in
  MINGW* | MSYS*)
    WORKDIR="$(pwd -W)"
    export MSYS_NO_PATHCONV=1
    ;;
  *) WORKDIR="$(pwd)" ;;
esac

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }

# drun IMAGE CMD ARGS... : 이미지의 entrypoint를 비우고 CMD를 실행한다. 작업 디렉터리는 /work.
drun() {
  local image="$1"
  shift
  docker run --rm --entrypoint "" -v "$WORKDIR:/work" -w /work "$image" "$@"
}

# 추적 중인 파일과 아직 git add 하지 않은 새 파일(.gitignore 제외)을 모두 대상으로 한다. 인덱스를 건드리지 않는다.
list_files() { git ls-files --cached --others --exclude-standard -- "$@"; }

run_step() { # run_step NAME CMD ARGS... : 실패하면 출력을 보여 준다
  local name="$1" out
  shift
  if out="$("$@" 2>&1)"; then
    pass "$name"
  else
    printf '%s\n' "$out"
    fail "$name"
  fi
}

check_tool() { # check_tool NAME IMAGE GLOB... -- CMD ARGS...(추적 중인 파일 목록이 뒤에 붙는다)
  local name="$1" image="$2"
  shift 2
  local globs=() cmd=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    globs+=("$1")
    shift
  done
  shift
  cmd=("$@")
  local files=() f
  while IFS= read -r f; do files+=("$f"); done < <(list_files "${globs[@]}")
  if [ "${#files[@]}" -eq 0 ]; then
    skip "$name (대상 파일 없음)"
    return
  fi
  run_step "$name" drun "$image" "${cmd[@]}" "${files[@]}"
}

# 커밋할 수 있는 파일(추적 중인 것과 새 파일, .gitignore 제외)만 복사해 gitleaks로 본다.
# `gitleaks dir .`는 .gitignore된 로컬 env 파일과 빌드 산출물까지 읽어 로컬에서만 실패한다.
scan_secrets() {
  local d=".tmp-gitleaks" rc
  rm -rf "${ROOT:?}/$d"
  mkdir -p "$d"
  git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf - | tar -xf - -C "$d"
  drun "$GITLEAKS_IMAGE" gitleaks dir --config .gitleaks.toml --redact --no-banner "$d"
  rc=$?
  rm -rf "${ROOT:?}/$d"
  return "$rc"
}

check_all() {
  run_step "guards unit tests" "$PY" -m unittest discover -s infra/ci/tests
  run_step "eol (CRLF 금지)" "$PY" infra/ci/check_eol.py
  local envs=() f
  while IFS= read -r f; do envs+=("$f"); done < <(list_files 'infra/*.env.example')
  if [ "${#envs[@]}" -eq 0 ]; then
    skip "env 형식 (대상 파일 없음)"
  else
    run_step "env 형식" "$PY" infra/ci/check_env_files.py "${envs[@]}"
  fi
  run_step "ports (compose 프로젝트)" "$PY" infra/ci/check_compose_projects.py
  if [ "${SKIP_ARCH:-0}" = "1" ]; then
    skip "arch (SKIP_ARCH=1)"
  else
    run_step "arch (도구 이미지)" "$PY" infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --images-from-sh infra/ci/tool-images.sh
  fi
  # 인프라 소유 파일만 엄격하게 본다. be·fe·ai는 각 팀 린트가 맡는다(스펙 6.3, 12.2). be의 Dockerfile은 오류만 막는다.
  check_tool shellcheck "$SHELLCHECK_IMAGE" 'infra/*.sh' -- shellcheck -x
  check_tool hadolint "$HADOLINT_IMAGE" 'infra/*Dockerfile*' -- hadolint
  check_tool "hadolint(be)" "$HADOLINT_IMAGE" 'be/*Dockerfile*' -- hadolint --failure-threshold error
  check_tool yamllint "$YAMLLINT_IMAGE" 'infra/*.yml' 'infra/*.yaml' '.gitlab-ci.yml' '.yamllint.yaml' -- yamllint -c .yamllint.yaml
  run_step "gitleaks" scan_secrets
}

expect_fail() { # expect_fail NAME CMD ARGS... : 나쁜 입력을 거부해야 통과
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    fail "self-test $name: 나쁜 입력을 통과시켰다(죽은 검사)"
  else
    pass "self-test $name: 나쁜 입력을 거부"
  fi
}

self_test() {
  local d=".tmp-selftest"
  rm -rf "${ROOT:?}/$d"
  mkdir -p "$d"
  trap 'rm -rf "${ROOT:?}/.tmp-selftest"' EXIT
  cat >"$d/bad.sh" <<'EOF'
#!/bin/bash
rm -rf $UNQUOTED/*
EOF
  printf 'FROM ubuntu:latest\nRUN apt-get install curl\n' >"$d/Dockerfile"
  printf 'a: [1, 2\n' >"$d/bad.yml"
  # 가짜 토큰은 리터럴을 쪼개 만든다(이 파일 자체가 gitleaks에 걸리지 않게)
  printf 'GITLAB_TOKEN=%s%s\n' 'glpat-' 'Zr8Q2mXk5LnV9tYb3HcD' >"$d/leak.txt"
  printf 'A="x"\n' >"$d/bad.env"
  printf 'services:\n  a:\n    image: x\n    ports: ["8080:80"]\n' >"$d/bad-compose.yml"
  printf 'a: 1\r\n' >"$d/crlf.yml"
  expect_fail shellcheck drun "$SHELLCHECK_IMAGE" shellcheck "$d/bad.sh"
  expect_fail hadolint drun "$HADOLINT_IMAGE" hadolint "$d/Dockerfile"
  expect_fail yamllint drun "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml "$d/bad.yml"
  expect_fail gitleaks drun "$GITLEAKS_IMAGE" gitleaks dir --config .gitleaks.toml --redact --no-banner "$d"
  expect_fail env-format "$PY" infra/ci/check_env_files.py "$d/bad.env"
  expect_fail ports "$PY" infra/ci/ports_invariant.py "$d/bad-compose.yml"
  expect_fail eol "$PY" infra/ci/check_eol.py "$d/crlf.yml"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
else
  check_all
fi

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d개 검사 실패\n' "$FAILED"
  exit 1
fi
printf '\n모든 검사 통과\n'
````

- [ ] **Step 5: 러너가 아직 추가하지 않은 새 파일을 대상으로 잡는지 확인**

러너는 `git ls-files --cached --others --exclude-standard`로 검사 대상을 정한다. 추적 중인 파일과 아직 `git add` 하지 않은 새 파일(`.gitignore` 제외)을 모두 보므로 인덱스를 건드리지 않고, 커밋하지 않는 실행에서도 새 파일이 검사된다.

Run: `git ls-files --cached --others --exclude-standard -- 'infra/ci/*.sh' 'infra/ci/*.py'`

Expected: `infra/ci/check_eol.py`, `infra/ci/run-local-checks.sh`, `infra/ci/tool-images.sh` 등 Task 1~7에서 만든 파일이 보인다.

- [ ] **Step 6: 러너 정상 실행**

Run: `bash infra/ci/run-local-checks.sh`

Expected (이미지는 처음 한 번 pull한다):

```text
PASS  guards unit tests
PASS  eol (CRLF 금지)
SKIP  env 형식 (대상 파일 없음)
PASS  ports (compose 프로젝트)
PASS  arch (도구 이미지)
PASS  shellcheck
SKIP  hadolint (대상 파일 없음)
SKIP  hadolint(be) (대상 파일 없음)
PASS  yamllint
PASS  gitleaks

모든 검사 통과
```

`.gitlab-ci.yml`이 아직 없으므로 yamllint 대상은 `.yamllint.yaml` 하나다. 오프라인이면 `SKIP_ARCH=1 bash infra/ci/run-local-checks.sh`로 돌린다.

- [ ] **Step 7: 자가 테스트 (게이트)**

Run: `bash infra/ci/run-local-checks.sh --self-test`

Expected:

```text
PASS  self-test shellcheck: 나쁜 입력을 거부
PASS  self-test hadolint: 나쁜 입력을 거부
PASS  self-test yamllint: 나쁜 입력을 거부
PASS  self-test gitleaks: 나쁜 입력을 거부
PASS  self-test env-format: 나쁜 입력을 거부
PASS  self-test ports: 나쁜 입력을 거부
PASS  self-test eol: 나쁜 입력을 거부

모든 검사 통과
```

종료 후 `.tmp-selftest/` 디렉터리가 남아 있지 않아야 한다(`ls -a | grep tmp-selftest`에 출력이 없어야 한다). `self-test ... 죽은 검사`가 나오면 해당 린터 설정(ignore, allowlist)을 먼저 의심한다.

- [ ] **Step 8: pre-commit 훅 (스펙 13.2)**

스펙은 gitleaks를 CI와 pre-commit 양쪽에 두라고 한다. 훅은 스테이징한 변경만 검사하고, 켜는 것은 각자의 선택이다(`git config core.hooksPath .githooks`). 훅 로직은 `.sh`로 두어 shellcheck가 검사하게 하고 `.githooks/pre-commit`은 그것을 부르는 래퍼로 둔다. gitleaks 실행 파일이나 docker가 있으면 쓰고 둘 다 없으면 경고만 하고 통과한다(CI의 `lint:secrets`가 다시 본다).

`infra/ci/pre-commit-secrets.sh`:

````sh
#!/bin/sh
# 스테이징된 변경에서 시크릿을 찾는다(스펙 13.2). 켜기: git config core.hooksPath .githooks
# gitleaks 실행 파일이 있으면 그것을, 없으면 핀한 이미지를 쓴다. 둘 다 없으면 경고만 하고 통과한다(CI lint:secrets가 다시 본다).
set -u
# shellcheck source=infra/ci/tool-images.sh
. infra/ci/tool-images.sh
if command -v gitleaks >/dev/null 2>&1; then
  exec gitleaks git --pre-commit --staged --redact --no-banner --config .gitleaks.toml .
fi
if docker info >/dev/null 2>&1; then
  W="$(pwd -W 2>/dev/null || pwd)"
  MSYS_NO_PATHCONV=1 exec docker run --rm -v "$W:/work" -w /work \
    -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/work \
    "$GITLEAKS_IMAGE" git --pre-commit --staged --redact --no-banner --config .gitleaks.toml .
fi
echo "pre-commit: gitleaks와 docker가 없어 시크릿 검사를 건너뛴다(CI에서 다시 검사한다)" >&2
exit 0
````

`.githooks/pre-commit`:

````sh
#!/bin/sh
# 켜기: git config core.hooksPath .githooks
exec sh infra/ci/pre-commit-secrets.sh
````

게이트: 훅 로직이 가짜 토큰을 막고 깨끗한 상태는 통과시키는지 확인한다. 커밋은 만들지 않는다. 스테이징해 둔 다른 변경이 없을 때 실행한다.

```bash
mkdir -p .tmp-hook && printf 'GITLAB_TOKEN=%s%s\n' 'glpat-' 'Zr8Q2mXk5LnV9tYb3HcD' > .tmp-hook/leak.txt
git add -f .tmp-hook/leak.txt
sh infra/ci/pre-commit-secrets.sh >/dev/null 2>&1; echo "토큰 있음 exit=$?"
git reset -q .tmp-hook/leak.txt && rm -rf .tmp-hook
sh infra/ci/pre-commit-secrets.sh >/dev/null 2>&1; echo "깨끗함 exit=$?"
```

Expected:

```text
토큰 있음 exit=1
깨끗함 exit=0
```

`.tmp-hook/`는 이 확인을 위한 임시 디렉터리이며 마지막에 정확히 그 경로만 지운다.

- [ ] **Step 9: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/ci/tool-images.sh .yamllint.yaml .gitleaks.toml infra/ci/run-local-checks.sh infra/ci/pre-commit-secrets.sh .githooks/pre-commit
git update-index --chmod=+x .githooks/pre-commit
git commit -m "chore(infra): 도구 이미지 핀, 로컬 검사 러너, pre-commit 훅 추가"
```

---

### Task 8: `.gitlab-ci.yml`과 핀 동기화 테스트

**목표:** CI의 `lint:*` 잡을 정의하고, 로컬 러너와 CI의 도구 핀이 어긋나지 않게 지키는 테스트를 만든다.

**Files:**
- Create: `.gitlab-ci.yml`
- Test: `infra/ci/tests/test_tool_images_sync.py`

**Interfaces:**
- Consumes: `infra/ci/tool-images.sh`(Task 7), `infra/ci/check_*.py`, `images_arch.py`, `migration_immutability.py`
- Produces: GitLab CI 잡 `lint:guards`, `lint:image-arch`, `lint:shell`, `lint:docker`, `lint:yaml`, `lint:secrets`, `lint:migrations`. 모두 태그 `verify`(B의 verify 러너)에서 돈다. 이후 계획이 `build`, `deploy`, `smoke` 스테이지의 잡을 추가한다.

- [ ] **Step 1: 실패하는 테스트 작성**

이 테스트는 `.gitlab-ci.yml`의 `variables`가 `tool-images.sh`와 같은지, 모든 `image:`가 핀 변수를 거치는지 검사한다. 핀을 우회한 리터럴 이미지나 한쪽만 바뀐 핀을 잡는다.

````python
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SH_RE = re.compile(r"^([A-Z][A-Z0-9_]*_IMAGE)=(\S+)\s*$", re.MULTILINE)
CI_VAR_RE = re.compile(r"^  ([A-Z][A-Z0-9_]*_IMAGE): (\S+)\s*$", re.MULTILINE)
# image: 값, services의 `- name: 값`, `image:` 바로 아래의 `name: 값`만 이미지 참조로 본다(environment·artifacts의 name:은 제외).
CI_IMAGE_REF_RE = re.compile(
    r"^\s+(?:image:|-\s+name:)[ \t]*(\S+)[ \t]*$|^\s+image:[ \t]*\n\s+name:[ \t]*(\S+)[ \t]*$", re.MULTILINE
)
USED_VAR_RE = re.compile(r"\$([A-Z][A-Z0-9_]*_IMAGE)")


class ToolImagesSyncTest(unittest.TestCase):
    def setUp(self):
        self.sh = dict(SH_RE.findall((ROOT / "infra/ci/tool-images.sh").read_text(encoding="utf-8")))
        self.ci_text = (ROOT / ".gitlab-ci.yml").read_text(encoding="utf-8")
        self.ci = dict(CI_VAR_RE.findall(self.ci_text))

    def test_pins_are_parsed(self):
        self.assertGreaterEqual(len(self.sh), 8)

    def test_gitlab_ci_variables_match_tool_images_sh(self):
        self.assertEqual(self.ci, self.sh)

    def test_every_job_image_uses_a_pinned_variable(self):
        refs = [a or b for a, b in CI_IMAGE_REF_RE.findall(self.ci_text)]
        self.assertTrue(refs, "image 참조를 찾지 못했다")
        literal = [r for r in refs if not r.startswith("$")]
        self.assertEqual(literal, [], "핀을 거치지 않은 image 리터럴이 있다")

    def test_regex_ignores_environment_and_artifact_names_but_catches_service_images(self):
        text = "deploy:\n  environment:\n    name: dev\n  artifacts:\n    name: x\n  services:\n    - name: postgres:16\n"
        self.assertEqual([a or b for a, b in CI_IMAGE_REF_RE.findall(text)], ["postgres:16"])

    def test_used_variables_are_defined(self):
        used = set(USED_VAR_RE.findall(self.ci_text))
        self.assertTrue(used <= set(self.ci), f"정의되지 않은 변수: {used - set(self.ci)}")


if __name__ == "__main__":
    unittest.main()
````

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `python infra/ci/tests/test_tool_images_sync.py`

Expected: `FileNotFoundError` (`.gitlab-ci.yml`이 아직 없음)

- [ ] **Step 3: `.gitlab-ci.yml` 작성**

설계 판단과 주의점:

- **도구마다 job image:** 러너가 docker executor라 job 안에서 `docker run -v $PWD`로 도구 컨테이너를 띄우면 워크스페이스가 호스트 경로가 아니라 마운트되지 않는다(A503의 교훈).
- **데몬 불필요:** `lint:guards`의 포트 규칙 검사(`docker compose config`)와 `lint:image-arch`(`docker buildx imagetools inspect`)는 docker 데몬이 필요 없다. `docker:29.9.0-cli` 이미지에 compose와 buildx가 들어 있어 소켓 없이도 돈다(소켓 없이 실행해 확인했다). verify 러너는 docker.sock을 마운트하지만(설계 6.1절) 이 잡들은 거기에 의존하지 않는다.
- **린트 범위:** `lint:shell`·`lint:docker`·`lint:yaml`은 `infra/`와 루트 설정만 본다. 기본 규칙은 전형적인 Spring Boot `application.yml`, Gradle 다단계 Dockerfile, Node Dockerfile, 셸 스크립트를 모두 실패시켜(재현했다) 팀원의 MR을 막는다. be의 Dockerfile만 `hadolint --failure-threshold error`로 오류(`sudo`, 로컬 파일 `ADD` 등)를 막고 경고는 출력만 한다. `lint:secrets`와 `lint:guards`의 CRLF 검사는 저장소 전체를 보고, env 예제 검사는 `infra/**/*.env.example`만 본다.
- **`lint:image-arch`의 실행 조건:** 이 잡만 파일 변경 조건(`rules: changes`)을 쓴다. 레지스트리 조회가 필요하고 Docker Hub 익명 pull 한도가 있기 때문이다. 스크립트가 읽는 `tool-images.sh`와 `images_arch.py`가 바뀔 때만 돈다(`.gitlab-ci.yml`의 핀은 동기화 테스트가 지킨다). 나머지 `lint:*`는 항상 전체를 실행한다.
- **`interruptible`:** `.verify`에만 둔다. `default:`에 두면 이후 계획의 deploy 잡이 새 푸시에 자동 취소돼 Blue/Green 전환 도중에 끊긴다.
- **중복 파이프라인:** develop→master MR의 파이프라인은 `workflow:rules`에서 `when: never`로 뺀다. 같은 커밋을 develop 브랜치 파이프라인이 이미 검사하고, 둘 다 돌리면 B(4GB, `concurrent 1`)에서 `be:test`가 두 번 돈다.
- **시크릿 이력 검사:** `lint:secrets`는 MR 커밋 이력도 본다(`GIT_DEPTH: "0"`). 추가했다가 지운 시크릿은 `gitleaks dir`에는 안 보이고 이력에 남는다(A603 유형).
- **`find` 괄호:** `find`의 괄호는 `\(`와 `\)`로 이스케이프한다. 러너의 `sh`에서 이스케이프하지 않으면 문법 오류다.

````yaml
stages:
  - verify
  - build
  - deploy
  - smoke

workflow:
  rules:
    # develop→master MR은 같은 커밋을 develop 브랜치 파이프라인이 이미 검사한다(중복 방지)
    - if: $CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == "develop"
      when: never
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "develop" || $CI_COMMIT_BRANCH == "master"

# deploy·smoke 단계 잡은 tags를 직접 지정한다(여기 기본값은 verify 러너다).
default:
  tags:
    - verify

variables:
  GIT_DEPTH: "20"
  # 도구 이미지 핀. infra/ci/tool-images.sh와 같아야 한다(tests/test_tool_images_sync.py가 검사한다).
  # 러너가 docker executor라 job 컨테이너 안에서 `docker run -v $PWD`로 도구 컨테이너를 띄울 수 없다
  # (워크스페이스가 호스트 경로가 아니다). 그래서 도구마다 job image를 따로 쓴다.
  SHELLCHECK_IMAGE: koalaman/shellcheck-alpine:v0.11.0
  HADOLINT_IMAGE: hadolint/hadolint:v2.15.1-alpine
  YAMLLINT_IMAGE: pipelinecomponents/yamllint:0.35.27
  GITLEAKS_IMAGE: zricethezav/gitleaks:v8.30.1
  CADDY_IMAGE: caddy:2.11.7
  PROMETHEUS_IMAGE: prom/prometheus:v3.15.0
  DOCKER_CLI_IMAGE: docker:29.9.0-cli
  PYTHON_IMAGE: python:3.12.15-slim

# interruptible은 verify 잡에만 둔다. deploy 잡이 새 푸시에 자동 취소되면 전환 도중에 끊긴다.
.verify:
  stage: verify
  interruptible: true

lint:guards:
  extends: .verify
  image: $DOCKER_CLI_IMAGE
  before_script:
    - apk add --no-cache python3 git
  script:
    - python3 -m unittest discover -s infra/ci/tests -v
    - python3 infra/ci/check_eol.py
    - python3 infra/ci/check_compose_projects.py
    - |
      files=$(git ls-files 'infra/*.env.example')
      if [ -n "$files" ]; then python3 infra/ci/check_env_files.py $files; fi

# 레지스트리 조회가 필요하다(익명 pull 한도). docker 데몬은 필요 없다(imagetools는 레지스트리에 직접 묻는다).
# 핀이나 이미지 참조가 바뀔 때만 실행한다.
lint:image-arch:
  extends: .verify
  image: $DOCKER_CLI_IMAGE
  before_script:
    - apk add --no-cache python3
  script:
    - python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --images-from-sh infra/ci/tool-images.sh
  rules:
    - changes:
        - infra/ci/tool-images.sh
        - infra/ci/images_arch.py

# 인프라 소유 파일만 엄격하게 검사한다. be·fe·ai는 각 팀 린트가 맡는다(스펙 6.3, 12.2).
lint:shell:
  extends: .verify
  image: $SHELLCHECK_IMAGE
  script:
    - find infra -type f -name '*.sh' -print0 | xargs -0 -r shellcheck -x

lint:docker:
  extends: .verify
  image: $HADOLINT_IMAGE
  script:
    - find infra -type f \( -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name '*.Dockerfile' \) -print0 | xargs -0 -r hadolint
    # be의 Dockerfile은 오류(sudo, ADD 등)만 막고 경고(버전 핀 등)는 출력만 한다
    - find be -type f \( -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name '*.Dockerfile' \) -print0 | xargs -0 -r hadolint --failure-threshold error

lint:yaml:
  extends: .verify
  image: $YAMLLINT_IMAGE
  script:
    - yamllint -c .yamllint.yaml .gitlab-ci.yml .yamllint.yaml infra

lint:secrets:
  extends: .verify
  image:
    name: $GITLEAKS_IMAGE
    entrypoint: [""]
  variables:
    GIT_DEPTH: "0"
  script:
    - gitleaks dir --config .gitleaks.toml --redact --no-banner .
    # MR 커밋 이력도 본다. 추가했다가 지운 시크릿은 dir 검사에 안 보이지만 이력에 남는다
    - if [ -n "${CI_MERGE_REQUEST_DIFF_BASE_SHA:-}" ]; then gitleaks git --config .gitleaks.toml --redact --no-banner --log-opts="$CI_MERGE_REQUEST_DIFF_BASE_SHA..HEAD" .; fi

lint:migrations:
  extends: .verify
  image: $DOCKER_CLI_IMAGE
  variables:
    GIT_DEPTH: "0"
  before_script:
    - apk add --no-cache python3 git
  script:
    - python3 infra/ci/migration_immutability.py
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
````

- [ ] **Step 4: 테스트 통과 확인**

Run: `python infra/ci/tests/test_tool_images_sync.py`

Expected: `Ran 5 tests` 다음에 `OK`

- [ ] **Step 5: CI 스크립트 한 줄들을 핀한 이미지 안에서 실행해 확인 (게이트)**

`.gitlab-ci.yml`의 `script:` 한 줄들이 실제 job 이미지에서 의도대로 동작하는지 확인한다. 파일이 0개일 때 통과하고 나쁜 Dockerfile에서는 실패해야 한다.

```bash
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
run() { docker run --rm --entrypoint "" -v "$W:/work" -w /work "$@"; }

run "$SHELLCHECK_IMAGE" sh -c "find infra -type f -name '*.sh' -print0 | xargs -0 -r shellcheck -x"; echo "lint:shell exit=$?"
run "$HADOLINT_IMAGE" sh -c "find infra -type f \( -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name '*.Dockerfile' \) -print0 | xargs -0 -r hadolint"; echo "lint:docker(0개) exit=$?"
mkdir -p infra/.tmp-ci && printf 'FROM ubuntu:latest\nRUN apt-get install curl\n' > infra/.tmp-ci/Dockerfile
run "$HADOLINT_IMAGE" sh -c "find infra -type f \( -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name '*.Dockerfile' \) -print0 | xargs -0 -r hadolint" >/dev/null 2>&1; echo "lint:docker(나쁜 파일) exit=$?"
rm -rf infra/.tmp-ci
run "$HADOLINT_IMAGE" sh -c "find be -type f \( -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name '*.Dockerfile' \) -print0 | xargs -0 -r hadolint --failure-threshold error"; echo "lint:docker(be) exit=$?"
run "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml .gitlab-ci.yml .yamllint.yaml infra; echo "lint:yaml exit=$?"
# lint:guards와 lint:image-arch의 script 줄. docker 소켓을 마운트하지 않는다(CI와 같은 조건).
# check_eol.py는 git 인덱스를 보므로 여기서 빼고, 러너(Step 6)가 확인한다. 실패를 가리지 않게 파이프를 쓰지 않는다.
run "$DOCKER_CLI_IMAGE" sh -ec '
  apk add --no-cache python3 git >/dev/null
  git config --global --add safe.directory /work
  python3 -m unittest discover -s infra/ci/tests
  python3 infra/ci/check_compose_projects.py
  python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --images-from-sh infra/ci/tool-images.sh'; echo "lint:guards+image-arch exit=$?"
```

Expected:

```text
lint:shell exit=0
lint:docker(0개) exit=0
lint:docker(나쁜 파일) exit=123
lint:docker(be) exit=0
lint:yaml exit=0
```

마지막 `docker:cli` 실행은 `Ran 69 tests` 다음에 `OK`, `SKIP ports (compose 프로젝트 없음)`, `OK arch linux/arm64,linux/amd64 (8 image(s))`를 출력하고 `lint:guards+image-arch exit=0`으로 끝나야 한다. 이 이미지에 compose와 buildx가 들어 있어 데몬 없이 통합 테스트(`docker compose config`)와 `imagetools inspect`가 돈다.

`infra/.tmp-ci/`는 이 확인을 위한 임시 디렉터리이며 마지막에 정확히 그 경로만 지운다.

- [ ] **Step 6: 러너로 `.gitlab-ci.yml`까지 검사**

Run: `bash infra/ci/run-local-checks.sh`

Expected: Task 7 Step 6과 같은 출력이고 `guards unit tests`가 새 테스트를 포함해 통과한다. yamllint 대상에 `.gitlab-ci.yml`이 포함된다.

- [ ] **Step 7: 커밋 (사용자가 허용한 경우에만)**

```bash
git add .gitlab-ci.yml infra/ci/tests/test_tool_images_sync.py
git commit -m "chore(infra): CI lint 잡과 도구 이미지 핀 동기화 테스트 추가"
```

---

### Task 9: 문서 동기화와 최종 게이트

**목표:** `infra/README.md`를 쓰고, 최종 게이트를 돌려 전체가 통과하는지 확인한다.

**Files:**
- Modify: `infra/README.md` (팀원이 만든 한 줄짜리 자리표시자를 대체한다)

**Interfaces:**
- Consumes: Task 1~8의 모든 산출물

- [ ] **Step 1: `infra/README.md` 작성**

저장소에는 이미 팀원이 만든 한 줄짜리 `infra/README.md`("인프라 관련 작업을 진행할 디렉토리입니다.")가 있다. 아래 내용으로 바꿔 쓴다.

````markdown
# infra

Fit Dining 인프라 코드. 설계는 [docs/infra/design.md](../docs/infra/design.md), 구현 계획은 `docs/infra/plans/`에 있다.

## 지금 있는 것

- `ci/` 가드 스크립트(Python 표준 라이브러리만), 단위 테스트, 로컬 러너, 도구 이미지 핀

가드가 강제하는 규칙:

| 가드 | 규칙 | 스펙 |
|---|---|---|
| `check_eol.py` | 커밋될 내용(git 인덱스)에 CRLF 금지. 경로를 주면 그 파일의 실제 바이트를 검사 | 12.4절 |
| `check_env_files.py` | env는 `KEY=VALUE`만, 주석·공백·따옴표·`#`·`$`·백슬래시·백틱 금지, 필수 키 검사. 값은 출력하지 않는다 | 12.4절 |
| `ports_invariant.py` | 호스트 게시 포트는 `127.0.0.1:`만, 예외는 caddy의 80/443/8443 | 13.1절 |
| `migration_immutability.py` | 적용된 마이그레이션 수정·삭제·이름 변경 금지(MR) | 6.5절 |
| `images_arch.py` | 이미지가 대상 호스트 플랫폼(A amd64, B arm64)을 지원 | 3절 |

## 로컬에서 검사하기

서버가 없어도 이 PC에서 CI의 lint 단계를 그대로 돌릴 수 있다. 필요한 것은 git, python 3.9 이상, Docker(Docker Desktop)다. Windows에서는 Git Bash나 WSL에서 실행한다.

러너는 추적 중인 파일과 아직 `git add` 하지 않은 새 파일(`.gitignore` 제외)을 모두 검사한다. 인덱스는 건드리지 않는다.

```bash
bash infra/ci/run-local-checks.sh              # 모든 검사
bash infra/ci/run-local-checks.sh --self-test  # 검사가 나쁜 입력을 거부하는지(죽은 검사 방지)
SKIP_ARCH=1 bash infra/ci/run-local-checks.sh  # 오프라인일 때 이미지 아키텍처 조회를 건너뜀
```

## 커밋 전 시크릿 검사

clone한 뒤 한 번만 켠다(선택). gitleaks 실행 파일이나 Docker가 있어야 하고 둘 다 없으면 경고만 하고 통과한다. CI의 `lint:secrets`가 다시 본다.

```bash
git config core.hooksPath .githooks
```

시크릿이 아닌데 걸리는 값(프런트의 공개 키 등)은 그 줄에 `gitleaks:allow` 주석을 붙이거나 `.gitleaksignore`에 지문을 적는다.

## 규칙

- 린트 범위: shellcheck·hadolint·yamllint는 `infra/`와 루트 설정만 엄격하게 본다. be의 Dockerfile은 오류만 막고, be·fe·ai의 나머지 코드는 각 팀 린트가 맡는다.
- env 가드는 `infra/**/*.env.example`만 본다. 프런트·백엔드의 `.env.example`은 각 도구의 형식을 따른다.

- 도구 이미지는 `ci/tool-images.sh`에서 핀하고 `.gitlab-ci.yml`의 `variables`와 같게 유지한다(테스트가 검사한다).
- 컨테이너는 `127.0.0.1:` 바인딩만 쓴다. 공개 포트는 caddy 하나다.
- 실제 env 파일은 커밋하지 않는다(`*.env.example`만). 값은 로그·문서·채팅에 출력하지 않는다.
- 새 compose 프로젝트를 만들면 `ci/compose-projects.txt`에 한 줄을 추가한다.
````

- [ ] **Step 2: 설계 문서가 구현과 일치하는지 확인 (읽기 전용)**

design.md의 3절 이미지 아키텍처 항목, 6.3절 `lint:*` 목록, 17절 `ci/` 항목에는 이 계획의 결과가 이미 적혀 있다. design.md를 고치지 않고 일치만 확인한다.

Run: `grep -n "lint:image-arch\|images_arch.py\|run-local-checks.sh" docs/infra/design.md`

Expected: 3절과 6.3절에 `lint:image-arch`가, 17절 `ci/` 항목에 `images_arch.py`와 `run-local-checks.sh`가 나온다. 일치하지 않으면 design.md를 직접 고치지 말고 구현이나 이 계획이 틀렸는지 먼저 확인한 뒤 사용자와 합의해 고친다.

- [ ] **Step 3: 최종 게이트 실행**

```bash
python -m unittest discover -s infra/ci/tests
bash infra/ci/run-local-checks.sh
bash infra/ci/run-local-checks.sh --self-test
```

Expected:
- 단위 테스트: `Ran 69 tests` 다음에 `OK` (Docker CLI가 없으면 통합 테스트 일부가 skipped)
- 러너 정상 실행: Task 7 Step 6의 출력과 같고 마지막 줄이 `모든 검사 통과`
- 자가 테스트: 7종 모두 PASS

- [ ] **Step 4: 남은 임시 파일 확인**

Run: `git status --short`

Expected: 이 계획이 만든 파일(`.gitattributes`, `.gitignore`, `.editorconfig`, `.gitlab-ci.yml`, `.yamllint.yaml`, `.gitleaks.toml`, `.githooks/`, `infra/`, `docs/infra/`)만 보이고 `.tmp-selftest/`, `.tmp-gitleaks/`, `.tmp-hook/`, `infra/.tmp-ci/`는 없어야 한다.

- [ ] **Step 5: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/README.md
git commit -m "docs(infra): infra README 추가"
```
