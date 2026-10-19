# infra

Fit Dining 인프라 코드. 설계는 [docs/infra/design.md](../docs/infra/design.md), 구현 계획은 `docs/infra/plans/`에 있다.

## 지금 있는 것

- `ci/` 가드 스크립트(Python 표준 라이브러리만), 단위 테스트, 로컬 러너, 도구 이미지 핀
- `local/` 로컬 개발 스택(Postgres, Redis, Garage, OpenSearch). 사용법은 [local/README.md](local/README.md)
- `app/` BE의 환경변수 예제(`app.env.example`, `migrate.env.example`). 키 계약은 [docs/infra/contracts/env.md](../docs/infra/contracts/env.md)

가드가 강제하는 규칙:

| 가드 | 규칙 | 스펙 |
|---|---|---|
| `check_eol.py` | 커밋될 내용(git 인덱스)에 CRLF 금지. 경로를 주면 그 파일의 실제 바이트를 검사 | 12.4절 |
| `check_env_files.py` | env는 `KEY=VALUE`만, 주석·공백·따옴표·`#`·`$`·백슬래시·백틱 금지, 필수 키 검사. 값은 출력하지 않는다 | 12.4절 |
| `ports_invariant.py` | 호스트 게시 포트는 `127.0.0.1:`만, 예외는 caddy의 80/443/8443 | 13.1절 |
| `check_env_contract.py` | 환경변수 계약 표(`docs/infra/contracts/env.md`)와 `*.env.example`의 키가 같음, 필수 키 존재 | 12.4절 |
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

팀의 lefthook(저장소 루트 `CONTRIBUTING.md`)이 커밋할 때 `lefthook.yml`의 pre-commit으로 `infra/ci/pre-commit-secrets.sh`를 불러 스테이징한 변경에서 시크릿을 찾는다. clone한 뒤 `npm install`을 한 번 실행하면 켜진다. gitleaks 실행 파일이나 Docker가 있어야 하고 둘 다 없으면 경고만 하고 통과한다. CI의 `lint:secrets`가 다시 본다.

```bash
sh infra/ci/pre-commit-secrets.sh   # 스테이징한 변경을 직접 검사
```

시크릿이 아닌데 걸리는 값(프런트의 공개 키 등)은 그 줄에 `gitleaks:allow` 주석을 붙이거나 `.gitleaksignore`에 지문을 적는다.

## 규칙

- 린트 범위: shellcheck·hadolint·yamllint는 `infra/`와 루트 설정만 엄격하게 본다. be의 Dockerfile은 오류만 막고, be·fe·ai의 나머지 코드는 각 팀 린트가 맡는다.
- env 가드는 `infra/**/*.env.example`만 본다. 프런트·백엔드의 `.env.example`은 각 도구의 형식을 따른다.

- 도구 이미지는 `ci/tool-images.sh`에서 핀하고 `.gitlab-ci.yml`의 `variables`와 같게 유지한다(테스트가 검사한다).
- 컨테이너는 `127.0.0.1:` 바인딩만 쓴다. 공개 포트는 caddy 하나다.
- 실제 env 파일은 커밋하지 않는다(`*.env.example`만). 값은 로그·문서·채팅에 출력하지 않는다.
- 새 compose 프로젝트를 만들면 `ci/compose-projects.txt`에 한 줄을 추가한다.
