# 배포 스크립트 구현 계획 (Plan 1C-2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버 A에서 BE·FE를 배포하고 되돌리는 스크립트를 만든다. prod는 BE와 FE를 차례로 반대 색으로 띄워 확인한 뒤 엣지를 전환하고(Blue/Green), dev는 단일 색을 교체한다. 실패하면 자동으로 이전 상태로 돌아가고, 직전 배포로 즉시 되돌리는 `rollback.sh`, 재부팅 뒤 순서대로 올리는 `fit-up.sh`, 배포 전 점검과 배포 뒤 스모크를 함께 만든다. 서버 없이 실제 Caddy와 목 BE·FE 이미지로 배포·롤백·실패 복구 시나리오를 노트북에서 시험한다.

**Architecture:** `infra/app/compose.app.yml` 하나가 prod(blue·green × BE·FE)와 dev(BE·FE) 컨테이너를 프로필로 나눠 정의한다. 이미지 태그와 활성 색은 `/srv/fit/state/deploy-<환경>.env`(compose의 `--env-file`이기도 하다)가 정하고, `infra/deploy/`의 스크립트가 이 파일과 엣지의 upstream 파일을 원자적으로 바꾼다. 서비스 점검은 호스트에 게시하지 않는 포트를 위해 같은 망의 caddy 컨테이너 안에서 `wget`으로 한다. 시험 환경(`infra/deploy/test/`)은 1C-1의 엣지와 1F의 공유 망 스크립트를 그대로 쓰고 목 BE·FE 이미지(실패 모드를 이미지에 넣는다)와 시험용 git 저장소로 서버 A를 흉내 낸다.

**Tech Stack:** bash, Docker Compose v2(2.24 이상. `env_file`의 `required: false`, `!override`), Caddy 2.11.7(1C-1), git, curl, python 3.9 이상(env 형식 검사와 웹훅 대역), 목 이미지용 `python:3.12.15-slim`과 `node:22-alpine`.

**Spec:** [docs/infra/design.md](../design.md) (2.2절 네트워크, 4.1절 메모리, 5.5절 전환, 6.4절 배포, 6.8절 프런트, 12절 서비스 계약, 13.2절 시크릿)

## 한눈에 보기

각 Task는 구현, 통과 확인, 커밋 순서다(커밋은 허용된 경우에만). Task 1은 검사를 먼저 쓴다.

| Task | 만드는 것 | 막는 사고 |
|---|---|---|
| 1 | `compose.app.yml`(BE·FE 컨테이너 정의) | 환경마다 메모리·로그·읽기 전용·망 설정이 달라짐, 컨테이너가 호스트에 포트를 게시함 |
| 2 | `lib.sh`, `notify.sh`, `preflight.sh` | 자리표시자나 다른 환경의 env로 배포, 이미 새 커밋이 배포된 환경에 옛 커밋을 배포(다운그레이드), 메모리·디스크 부족 상태의 겹침 배포, prod FE가 dev BE를 부름 |
| 3 | `smoke.sh`, `deploy.sh` | 새 색이 준비되기 전에 트래픽을 옮김, 엣지 전환 뒤 문제를 모르고 지나감, 열려 있는 탭의 이전 해시 자산이 404가 됨, 마이그레이션 실패나 덤프 실패 뒤에 배포가 이어짐 |
| 4 | `rollback.sh`, `fit-up.sh` | 문제가 생긴 배포를 되돌리는 절차가 사람마다 다름, 재부팅 뒤 기동 순서가 흐트러짐 |
| 5 | 시험 환경(`test/`) | 서버가 없으면 전환·실패 복구·롤백을 확인할 길이 없음 |
| 6 | 문서 동기화와 검사 연결 | 문서와 구현이 어긋남 |

이 계획은 서버 A의 배포만 만든다. CI 잡(`be:test`, `fe:test`, `fe:build`, `build:images`, `deploy`, `smoke`)과 이미지 조립은 계획 1C-3이, 마이그레이션 전 덤프를 뜨는 `infra/backup/pg-backup.sh`는 계획 1D가, data·obs compose는 1D·1E가 만든다.

## 검증 결과

이 계획의 코드는 저장소를 clone한 임시 복사본(저장소 밖)에서 계획의 코드 블록만으로 다시 만들어 실행해 확인했다.

- 시나리오 시험(`test-deploy.sh run`)은 처음 상태에서 구역 15개, `PASS` 76개, `FAIL` 0개로 통과한다. 실제 Caddy와 목 BE·FE 컨테이너, 시험용 git 저장소를 쓴다.
- 시험이 죽은 검사가 아닌지 확인하려고 배포 스크립트의 핵심 로직을 6곳 일부러 망가뜨렸다(정적 자산 풀 쌓기 끄기, 엣지 전환 뒤 실패 때 엣지 되돌리기 삭제, 다운그레이드 가드 무력화, 잠금 해제 삭제, 마이그레이션 변경 판정을 항상 거짓으로, 배포 뒤 이전 색 정지 삭제). 모든 경우에 해당 점검이 실패로 잡았다.
- prod 배포: 첫 배포는 blue로 가고 두 번째는 green으로 전환한다. 전환 뒤 이전 색은 멈추되 컨테이너는 남는다. 이전 릴리스(c1)의 해시 자산은 풀에서 계속 서빙된다(c1 FE 컨테이너가 멈춘 뒤에도 200). 오래된 풀 파일은 지워지고 이번 릴리스가 가진 공용 자산은 남는다. 마이그레이션 파일이 바뀐 배포(첫 배포, c4)만 사전 덤프와 마이그레이션이 실행되고 안 바뀐 배포(c2)는 실행하지 않는다.
- 실패 복구: BE가 준비되지 않으면(c3) 트래픽을 옮기지 않고 새 컨테이너를 치우며 태그를 되돌린다. 엣지 전환 뒤 FE 확인이 실패하면(c4) FE는 이전 색으로 돌아오고 BE는 새 버전으로 남는다. 사전 덤프가 실패하거나 마이그레이션이 실패하면(c5) 서비스를 건드리지 않고 잠금도 남지 않는다.
- 롤백: `rollback.sh prod be`는 BE만 이전 색으로, `rollback.sh prod`는 BE와 FE를 이전 색으로 되돌리고 상태의 `DEPLOYED_SHA`와 `PREVIOUS_SHA`를 맞바꾼다. dev는 직전 태그로 교체한다.
- 다운그레이드 가드: 현재(c2)보다 오래된 커밋(c1)과 현재의 후손이 아닌 갈래(s1)는 거부하고 서비스를 건드리지 않는다. 같은 SHA 재배포와 `SKIP_VERIFY` 사유가 있는 CI 밖 배포는 통과하고 사유가 이력에 남는다. 사유 없이 CI 밖에서 직접 배포하면 거부한다.
- 사전 점검 실패: env 파일 없음, 자리표시자(`REPLACE_ME`), prod 파일의 `APP_ENV=dev`, 필수 키 누락, prod FE가 dev 내부 리스너(8082)를 가리킴, 메모리 부족, 이미지·커밋 없음, 모두 점검이 실패한다.
- dev: 첫 배포와 교체가 되고 직전 태그가 남는다. FE 화면 오류(c7)와 검색 폴백(c8, 스모크의 `X-Fallback` 점검)은 직전 이미지로 복귀한다. 게이트 쿠키 없이는 404다.
- `fit-up.sh`: 앱과 엣지 컨테이너를 모두 멈춘 뒤 실행하면 엣지와 활성 색이 전과 같은 버전으로 응답하고 활성이 아닌 색은 멈춘 채로 있으며 아직 없는 data·obs는 건너뛴다.
- 위생: 스크립트 출력과 웹훅 본문에 dev 게이트 키가 없다. 메모리 한도(be-prod 1536m, fe-prod 512m, be-dev 1024m), FE 읽기 전용 루트가 compose대로 걸려 있고 앱 컨테이너가 게시한 포트가 없다. 알림은 웹훅 대역이 받았다.
- 컴포즈와 정적 검사: `compose.app.yml`은 prod·dev 두 프로필 모두 `config`가 통과하고 포트 불변식이 6개 서비스를 검사한다. 러너와 러너 자가 테스트 10종이 통과하고 새 스크립트·Dockerfile·compose는 `lint:shell`·`lint:docker`·`lint:yaml`이 자동으로 검사한다.
- 파일 권한 판정(`mode_is_private`)은 NTFS에 권한 비트가 없어 Linux 컨테이너에서 640·600·660은 통과, 644·604는 거부함을 확인했다.
- Windows(Git Bash)에서 시험하며 겪은 것: 네이티브 프로그램(`docker`, `python`, `curl`)에 `/c/...`나 `/tmp/...` 경로를 주면 읽지 못해(env 점검과 스모크가 처음에 모두 실패했다) `native_path`를 거치게 했다. 한글을 `curl` 인자로 주면 깨져서 웹훅 본문을 파일로 보낸다. `docker inspect`는 없는 컨테이너에도 빈 줄을 출력하고 `flock`이 없어 잠금은 `mkdir`로 한다. Docker Desktop의 포트 포워더는 새 연결을 간헐적으로 거부하므로 스모크와 시험이 연결 실패만 다시 시도한다.

아래 코드를 그대로 옮기면 같은 결과가 나와야 한다. 다르면 코드를 고치기 전에 원인을 먼저 확인한다.

**아직 확인하지 못한 것**

- 실제 BE(Spring)와 FE(Next.js) 이미지. 준비 시간(BE 150초 한도), 메모리 한도 안에서의 동작, FE 이미지의 `/app/.next/static` 구조는 목 이미지로만 확인했다(이미지 계약은 `infra/deploy/README.md`).
- 실제 Postgres와 사전 덤프. 시험의 덤프 스크립트는 대역이다(`infra/backup/pg-backup.sh predeploy <환경> <sha>`는 계획 1D가 만든다).
- 실제 도메인과 공개 CA 인증서를 거친 스모크. 시험은 `localhost`와 Caddy 내부 CA(`-k`)다.
- 서버의 파일 권한(`root:docker 0640`)과 `/proc/meminfo`의 `MemAvailable`. 권한 비트 판정 함수는 Linux 컨테이너에서 확인했고 NTFS에서는 env 파일 권한 점검을 건너뛰었다.
- 재부팅 뒤 `fit-up.sh`. 시험은 컨테이너를 모두 멈췄다가 올리는 것으로 갈음했고 호스트 재부팅과 `restart: unless-stopped` 자동 기동은 서버에서 본다.
- 실제 트래픽 중 전환의 끊김 없음. `reload` 자체는 1C-1에서 확인했다(망 안 요청 150건 성공).
- GitLab 파이프라인과의 연결(계획 1C-3), Mattermost 실제 수신(웹훅은 대역으로 확인).

## Global Constraints

1A·1B·1C-1·1F의 전역 제약이 모두 적용된다([plan 1A](2026-10-15-plan-1a-foundation-guardrails.md), [plan 1B](2026-10-19-plan-1b-local-env-contracts.md), [plan 1C-1](2026-10-20-plan-1c1-edge.md), [plan 1F](2026-10-20-plan-1f-host.md)). 이 계획에서 더 지키는 것은 다음과 같다.

- 호스트에 게시하는 포트는 없다(앱 컨테이너). 서비스 이름과 컨테이너 이름은 환경 접두사로 고정한다(`be-prod-blue`, `fe-dev` 등).
- 상태 파일과 엣지 upstream 파일은 임시 이름으로 쓴 뒤 `mv`로 바꾼다(원자적).
- 점검 스크립트는 값(키, 비밀번호)을 출력하지 않는다. 알림 웹훅 주소도 출력하지 않는다.
- 실패 경로가 정상 경로보다 중요하다. 모든 실패는 트래픽을 건드리기 전에 멈추거나 이전 상태로 되돌려야 하고, 마이그레이션은 되돌리지 않는다(forward-fix 원칙).
- Windows(Git Bash)에서 시험이 돌아야 한다. 네이티브 프로그램(`docker`, `python`, `curl`)에 넘기는 파일 경로는 `native_path`를 거치고(`/c/...`나 `/tmp/...` 모양을 읽지 못한다), 한글을 명령행 인자로 `curl`에 주지 않고 파일로 준다. NTFS에는 권한 비트가 없다.
- 시험용 값(`DEV_GATE_KEY` 등)은 엔트로피가 낮은 값이라 시크릿 검사에 걸리지 않는다. 서버 값으로 쓰지 않는다.
- 시험용 컨테이너·이미지·망은 `fit-deploytest` 접두사로 만들고 `down`으로 지운다(이름 패턴 일괄 삭제 금지). 시험 디렉터리는 저장소 안의 `.tmp-deploytest/`다.
- 커밋 메시지와 브랜치는 1B와 같은 규칙이다. 브랜치는 `infra/feat/deploy-scripts-S15P31A302-19`다.

## 파일 구조

모든 경로는 저장소 루트(`C:\Users\SSAFY\ssafy\S15P31A302`) 기준이다.

| 파일 | 책임 |
|---|---|
| `infra/app/compose.app.yml` | BE·FE 컨테이너 정의(프로필 `prod`·`dev`) |
| `infra/ci/compose-projects.txt` | (수정) 포트 불변식이 이 compose를 검사한다 |
| `infra/deploy/lib.sh` | 공통 함수: 상태 파일, 이름 규칙, 준비·직접 확인, 엣지 전환, 잠금, 마이그레이션 변경 판정 |
| `infra/deploy/notify.sh` | Mattermost 웹훅 알림(실패해도 배포를 막지 않는다) |
| `infra/deploy/preflight.sh` | 배포 전 점검(읽기 전용) |
| `infra/deploy/smoke.sh` | 엣지를 거친 서비스 확인 |
| `infra/deploy/deploy.sh` | 배포(prod Blue/Green, dev 교체), 정적 자산 풀, 마이그레이션 |
| `infra/deploy/rollback.sh` | 직전 배포로 복귀 |
| `infra/deploy/fit-up.sh` | 재부팅·장애 뒤 기동 순서 |
| `infra/deploy/test/` | 시험 환경(`test-deploy.sh`, 목 BE·FE 이미지, 엣지 오버라이드, 덤프·웹훅 대역) |
| `infra/deploy/README.md`, `infra/README.md`, `docs/infra/design.md`, `docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md` | (신규·수정) 문서 |

## 후속 계획

| 계획 | 이 계획의 산출물을 쓰는 방식 |
|---|---|
| 1C-3 CI 파이프라인 | `build:images`가 `be:<SHA>`, `fe:<SHA>`를 조립하고 `deploy:dev`·`deploy:prod` 잡이 `deploy.sh`를, `smoke:public` 잡이 `smoke.sh`를 부른다. `FIT_SMOKE_SEARCH_PATH`는 BE의 검색 API 경로가 정해지면 CI 변수로 준다. `fe:build`의 산출물 검사는 FE 이미지 계약(`/app/.next/static`)과 맞춘다 |
| 1D 데이터와 백업 | `infra/backup/pg-backup.sh predeploy <환경> <sha>`(마이그레이션 전 덤프)를 만든다. `fit-up.sh`가 `infra/data/compose.data.yml`을 올린다 |
| 1E 관측성 | `fit-up.sh`가 `infra/obs/compose.obs.yml`을 올린다. 알림 키 `MATTERMOST_WEBHOOK_URL`을 `obs` 그룹 계약에 더한다 |
| 계획 2(서버 수령 후) | 첫 배포를 이 스크립트로 한다. 첫 배포 전에 `infra/edge/state-sample/`을 `/srv/fit/state/`에 복사해 둔다 |

---

### Task 1: BE·FE 컨테이너 정의

**목표:** prod(blue·green)와 dev의 BE·FE 컨테이너를 하나의 compose 파일로 정의한다. 메모리·CPU·로그·읽기 전용·망은 설계 4.1절과 2.2절, 6.8절을 그대로 옮긴다.

**Files:**
- Create: `infra/app/compose.app.yml`
- Modify: `infra/ci/compose-projects.txt`

**Interfaces:**
- Consumes: 1F의 공유 망(`net-prod`, `net-dev`, `net-data`. 이름은 `FIT_NET_PROD`·`FIT_NET_DEV`·`FIT_NET_DATA`로 바꾼다), 1C-1의 엣지가 서비스 이름(`be-prod-blue:8080`, `fe-prod-blue:3000` 등)으로 프록시한다
- Produces: 서비스 `be-prod-blue`, `be-prod-green`, `fe-prod-blue`, `fe-prod-green`(프로필 `prod`), `be-dev`, `fe-dev`(프로필 `dev`). 컨테이너 이름은 서비스 이름과 같다. 이미지는 `${FIT_BE_IMAGE:-be}:${BE_BLUE_TAG:-none}` 같은 모양이고 태그는 상태 파일이 정한다
- 한도: be-prod 1536m, fe-prod 512m, be-dev 1024m(`cpus` 1.0), fe-dev 400m(`cpus` 0.5). prod는 `cpu_shares` 2048

핵심 결정:

- 프로필로 환경을 나눠 한 파일에 모은다. prod와 dev의 정의가 어긋나지 않는다. 호출은 항상 `docker compose -p fit-app-<환경> --profile <환경> --env-file <상태 파일>`이다.
- 아직 배포하지 않은 색의 태그는 `none`이라 `config`는 통과하고 `up`은 하지 않는다.
- `/etc/fit`의 env 파일은 없어도 `config`가 통과하도록 `required: false`다. 파일이 없으면 `preflight.sh`가 배포를 막는다.
- JVM 플래그와 Hikari 풀 크기는 compose의 `environment`로 준다(BE 계약 #10). `environment`가 `env_file`보다 우선해서 BE 쪽 설정이 이 값을 덮지 못한다.
- FE는 루트 파일시스템이 읽기 전용이고 `/app/.next/cache`와 `/tmp`만 tmpfs다. healthcheck는 이미지에 `node`가 있다는 가정으로 `node -e fetch(...)`를 쓴다(이미지 도구에 기대지 않는다).
- 컨테이너 종료 대기(`stop_grace_period`)는 BE 30초 종료 단계와 FE 30초 드레인에 맞춰 40초다.

- [ ] **Step 1: 환경 확인과 브랜치**

Run (저장소 루트, Git Bash):

```bash
python --version
docker version --format 'server={{.Server.Version}}'
docker compose version
git status --short
```

Expected: Python 3.9 이상, Docker 서버 버전 출력, Compose v2.24 이상, 작업 트리가 깨끗하다. Compose가 2.24보다 낮으면 `env_file`의 `required: false`를 못 읽으니 Docker Desktop을 올린다.

사용자에게 커밋 허용 여부를 한 번 묻는다. 허용하면 `git switch -c infra/feat/deploy-scripts-S15P31A302-19`로 브랜치를 만든 뒤 시작한다. 허용하지 않으면 모든 커밋 단계를 건너뛴다.

- [ ] **Step 2: 검사 대상에 먼저 등록하고 실패 확인**

````diff
diff --git a/infra/ci/compose-projects.txt b/infra/ci/compose-projects.txt
--- a/infra/ci/compose-projects.txt
+++ b/infra/ci/compose-projects.txt
@@ -4,3 +4,4 @@
 local infra/local/compose.yml --env-file infra/local/local.env.example
 edge infra/edge/compose.edge.yml --env-file infra/edge/edge.env.example
 edge-test infra/edge/compose.edge.yml infra/edge/test/compose.test.yml --env-file infra/edge/edge.env.example
+app infra/app/compose.app.yml
````

Run: `python infra/ci/check_compose_projects.py; echo "exit=$?"`

Expected: `== app` 아래에 `FAIL docker compose config failed: …compose.app.yml…`(파일을 열 수 없다는 오류)이 나오고 `exit=1`이다.

- [ ] **Step 3: compose 파일 작성**

````yaml
# 앱(BE, FE) 컨테이너. 서버 A의 fit-app-prod, fit-app-dev 프로젝트다(설계 2.2절, 6.4절, 6.8절).
# 환경마다 프로젝트를 따로 띄운다. 직접 부르지 않고 infra/deploy/ 스크립트가 부른다.
#   docker compose -p fit-app-prod -f compose.app.yml --env-file /srv/fit/state/deploy-prod.env --profile prod ...
#   docker compose -p fit-app-dev  -f compose.app.yml --env-file /srv/fit/state/deploy-dev.env  --profile dev ...
# prod는 BE·FE가 각각 blue와 green 두 색이고 deploy.sh가 반대 색만 띄워 전환한다. dev는 색이 하나다.
# 이미지 태그는 상태 파일(deploy.sh가 쓴다)이 정한다. 아직 배포하지 않은 색은 태그가 none이라 `config`는 통과하고 `up`은 하지 않는다.
# /etc/fit의 env 파일은 없어도 `config`가 통과하도록 required: false로 둔다. 파일이 없으면 preflight.sh가 배포를 막는다.
# 호스트에 게시하는 포트는 없다. Caddy가 compose 망 안에서 서비스 이름으로 프록시한다.

x-logging: &logging
  driver: json-file
  options:
    max-size: 50m
    max-file: "5"

# BE: 포트 8080(공개 API), 8081(관리, 프록시하지 않는다). JVM 힙은 컨테이너 한도에 비례시킨다(BE 계약 #10).
x-be: &be
  restart: unless-stopped
  logging: *logging
  stop_grace_period: 40s
  init: true

x-be-env: &be-env
  TZ: Asia/Seoul
  JAVA_TOOL_OPTIONS: -XX:InitialRAMPercentage=25 -XX:MaxRAMPercentage=60 -XX:MaxMetaspaceSize=192m -XX:+UseSerialGC

# FE: Next.js standalone(`node server.js`, 포트 3000). 루트 파일시스템은 읽기 전용이고 .next/cache만 tmpfs로 쓴다(설계 6.8절).
x-fe: &fe
  restart: unless-stopped
  logging: *logging
  stop_grace_period: 40s
  init: true
  read_only: true
  tmpfs:
    - /app/.next/cache
    - /tmp
  environment:
    TZ: Asia/Seoul
  healthcheck:
    test: [CMD, node, -e, "fetch('http://127.0.0.1:3000/fe-healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
    interval: 10s
    timeout: 5s
    retries: 6
    start_period: 20s

services:
  be-prod-blue:
    <<: *be
    profiles: [prod]
    container_name: be-prod-blue
    image: ${FIT_BE_IMAGE:-be}:${BE_BLUE_TAG:-none}
    env_file:
      - path: ${FIT_ENV_DIR:-/etc/fit}/prod.env
        required: false
    environment:
      <<: *be-env
      SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE: "10"
    mem_limit: 1536m
    cpu_shares: 2048
    networks: [net-prod, net-data]
    labels: &labels-be-prod
      com.fit.service: be
      com.fit.env: prod

  be-prod-green:
    <<: *be
    profiles: [prod]
    container_name: be-prod-green
    image: ${FIT_BE_IMAGE:-be}:${BE_GREEN_TAG:-none}
    env_file:
      - path: ${FIT_ENV_DIR:-/etc/fit}/prod.env
        required: false
    environment:
      <<: *be-env
      SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE: "10"
    mem_limit: 1536m
    cpu_shares: 2048
    networks: [net-prod, net-data]
    labels: *labels-be-prod

  fe-prod-blue:
    <<: *fe
    profiles: [prod]
    container_name: fe-prod-blue
    image: ${FIT_FE_IMAGE:-fe}:${FE_BLUE_TAG:-none}
    env_file:
      - path: ${FIT_ENV_DIR:-/etc/fit}/fe-prod.env
        required: false
    mem_limit: 512m
    cpu_shares: 2048
    networks: [net-prod]
    labels: &labels-fe-prod
      com.fit.service: fe
      com.fit.env: prod

  fe-prod-green:
    <<: *fe
    profiles: [prod]
    container_name: fe-prod-green
    image: ${FIT_FE_IMAGE:-fe}:${FE_GREEN_TAG:-none}
    env_file:
      - path: ${FIT_ENV_DIR:-/etc/fit}/fe-prod.env
        required: false
    mem_limit: 512m
    cpu_shares: 2048
    networks: [net-prod]
    labels: *labels-fe-prod

  be-dev:
    <<: *be
    profiles: [dev]
    container_name: be-dev
    image: ${FIT_BE_IMAGE:-be}:${BE_DEV_TAG:-none}
    env_file:
      - path: ${FIT_ENV_DIR:-/etc/fit}/dev.env
        required: false
    environment:
      <<: *be-env
      SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE: "5"
    mem_limit: 1024m
    cpus: 1.0
    networks: [net-dev, net-data]
    labels:
      com.fit.service: be
      com.fit.env: dev

  fe-dev:
    <<: *fe
    profiles: [dev]
    container_name: fe-dev
    image: ${FIT_FE_IMAGE:-fe}:${FE_DEV_TAG:-none}
    env_file:
      - path: ${FIT_ENV_DIR:-/etc/fit}/fe-dev.env
        required: false
    mem_limit: 400m
    cpus: 0.5
    networks: [net-dev]
    labels:
      com.fit.service: fe
      com.fit.env: dev

networks:
  net-prod:
    name: ${FIT_NET_PROD:-net-prod}
    external: true
  net-dev:
    name: ${FIT_NET_DEV:-net-dev}
    external: true
  net-data:
    name: ${FIT_NET_DATA:-net-data}
    external: true
````

- [ ] **Step 4: 정적 검증 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
docker compose -f infra/app/compose.app.yml --profile prod config -q && echo "prod config OK"
docker compose -f infra/app/compose.app.yml --profile dev config -q && echo "dev config OK"
python infra/ci/check_compose_projects.py | tail -3
docker compose -f infra/app/compose.app.yml --profile prod config --format json | python -c "
import json,sys
c=json.load(sys.stdin)
for n,s in c['services'].items():
    print(n, s['image'], s.get('mem_limit'), s.get('cpu_shares'), sorted(s['networks']), s.get('read_only'))
"
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml infra/app/compose.app.yml; echo "yamllint exit=$?"
```

Expected:

```text
prod config OK
dev config OK
OK ports (8 service(s))
== app
OK ports (6 service(s))
be-prod-blue be:none 1610612736 2048 ['net-data', 'net-prod'] None
be-prod-green be:none 1610612736 2048 ['net-data', 'net-prod'] None
fe-prod-blue fe:none 536870912 2048 ['net-prod'] True
fe-prod-green fe:none 536870912 2048 ['net-prod'] True
yamllint exit=0
```

- [ ] **Step 5: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/app/compose.app.yml infra/ci/compose-projects.txt
git commit -m "feat(infra): BE·FE 컨테이너 정의(compose.app.yml) 추가"
```

---

### Task 2: 공통 함수, 알림, 배포 전 점검

**목표:** 배포 스크립트가 함께 쓰는 함수(`lib.sh`), 알림(`notify.sh`), 읽기 전용 사전 점검(`preflight.sh`)을 만든다.

**Files:**
- Create: `infra/deploy/lib.sh`, `infra/deploy/notify.sh`, `infra/deploy/preflight.sh`

**Interfaces:**
- `lib.sh`(source해서 쓴다): 환경변수 `FIT_ENV_DIR`(`/etc/fit`), `FIT_STATE_DIR`(`/srv/fit/state`), `FIT_WEB_DIR`(`/srv/fit/web`), `FIT_REPO_DIR`(저장소 루트), `FIT_EDGE_PROJECT`(`fit-edge`), `FIT_BE_IMAGE`(`be`), `FIT_FE_IMAGE`(`fe`), `FIT_DRAIN_SECONDS`(30), `FIT_BE_READY_TIMEOUT`(150), `FIT_FE_READY_TIMEOUT`(60). 함수: `state_get/state_set/state_init`, `compose`, `svc_name`·`tag_key`, `probe`·`wait_ready`·`smoke_idle`, `write_upstream`·`reload_edge`, `acquire_lock`·`release_lock`, `migrations_changed`, `history_add`, `notify`, `native_path`, `mode_is_private`, `sha_match`, `json_string`
- `notify.sh ok|fail|info "메시지"`: 웹훅 주소는 `FIT_NOTIFY_WEBHOOK` 또는 `/etc/fit/obs.env`의 `MATTERMOST_WEBHOOK_URL`이다. 항상 종료 코드 0이다
- `preflight.sh <prod|dev> <sha> [--rollback]`: 점검마다 `PASS`·`FAIL`·`SKIP`을 출력하고 하나라도 FAIL이면 종료 코드 1이다. `FIT_MIN_DISK_GB`(5), `FIT_MIN_MEM_MB`(prod 2560, dev 512), `FIT_MEM_AVAILABLE_MB`, `FIT_PREDEPLOY_DUMP`, `FIT_SKIP_PERM=1`(시험용)

핵심 결정:

- **상태 파일** `/srv/fit/state/deploy-<환경>.env`는 compose의 `--env-file`이기도 하다. prod는 서비스별 활성 색(`BE_ACTIVE`, `FE_ACTIVE`), 색별 태그(`BE_BLUE_TAG` 등), dev는 `BE_DEV_TAG`, `BE_DEV_PREV_TAG` 등, 공통으로 `DEPLOYED_SHA`, `PREVIOUS_SHA`를 둔다. 처음에는 활성이 green이라 첫 배포가 blue로 간다(엣지 견본이 blue를 가리킨다).
- **점검은 caddy 컨테이너 안에서** `wget`으로 한다. 앱 컨테이너는 호스트에 게시하지 않고 BE 이미지에 curl이 없어도 되며, 같은 망에서 서비스 이름으로 닿는다.
- **다운그레이드 가드:** 배포할 커밋이 현재 배포된 커밋의 후손(또는 같은 커밋)이어야 한다. 얕은 clone이면 현재 SHA를 먼저 fetch한다. 되돌리기는 `rollback.sh`로만 한다.
- **환경 격리:** env 파일의 `APP_ENV`가 대상 환경과 같아야 하고, FE env의 `BE_INTERNAL_URL`은 그 환경의 엣지 내부 리스너(prod `http://caddy:8081`, dev `http://caddy:8082`)여야 한다. 같은 망의 컨테이너는 포트만 맞으면 어느 환경의 리스너에도 닿으므로 여기서 막는다.
- **env 점검은 계약에서:** 필수 키는 `docs/infra/contracts/env.md` 표에서 그룹별로 뽑고 `check_env_files.py`로 형식과 필수 키를 본다. `REPLACE_ME`가 남아 있으면 실패한다. 값은 출력하지 않는다.
- **잠금은 `mkdir`:** `flock`이 없는 환경(Git Bash)에서도 같게 돈다. 프로세스가 죽어 남은 잠금은 pid로 알아보고 지운다.
- **마이그레이션 변경 판정:** 이전 배포 SHA와 새 SHA 사이에 `be/src/main/resources/db/migration`이 바뀌었을 때(첫 배포 포함)만 참이다. prod는 그때 사전 덤프 스크립트(`infra/backup/pg-backup.sh`)가 실행 가능해야 한다.

- [ ] **Step 1: 공통 함수 작성**

````bash
# shellcheck shell=bash disable=SC2034
# infra/deploy 스크립트가 함께 쓰는 함수다. 스크립트가 source한다(직접 실행하지 않는다). 설계 6.4절.
#
# 경로와 이름은 환경변수로 바꿀 수 있다(시험 환경이 쓴다). 서버에서는 기본값을 쓴다.
#   FIT_ENV_DIR(/etc/fit) FIT_STATE_DIR(/srv/fit/state) FIT_WEB_DIR(/srv/fit/web) FIT_REPO_DIR(저장소 루트)
#   FIT_EDGE_PROJECT(fit-edge) FIT_BE_IMAGE(be) FIT_FE_IMAGE(fe) FIT_NET_PROD·FIT_NET_DEV·FIT_NET_DATA(망 이름)
# 상태 파일 $STATE_DIR/deploy-<환경>.env는 compose의 --env-file이기도 하다. 이미지 태그와 활성 색이 여기에 있다.

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DEPLOY_DIR/../.." && pwd)"
ENV_DIR="${FIT_ENV_DIR:-/etc/fit}"
STATE_DIR="${FIT_STATE_DIR:-/srv/fit/state}"
WEB_DIR="${FIT_WEB_DIR:-/srv/fit/web}"
REPO_DIR="${FIT_REPO_DIR:-$ROOT_DIR}"
EDGE_PROJECT="${FIT_EDGE_PROJECT:-fit-edge}"
BE_IMAGE="${FIT_BE_IMAGE:-be}"
FE_IMAGE="${FIT_FE_IMAGE:-fe}"
BE_READY_TIMEOUT="${FIT_BE_READY_TIMEOUT:-150}"
FE_READY_TIMEOUT="${FIT_FE_READY_TIMEOUT:-60}"
DRAIN_SECONDS="${FIT_DRAIN_SECONDS:-30}"
MIGRATION_DIR="${FIT_MIGRATION_DIR:-be/src/main/resources/db/migration}"
export FIT_ENV_DIR="$ENV_DIR"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac

log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }
die() {
  printf 'FAIL %s\n' "$*" >&2
  exit 1
}

# Windows의 python3는 스토어 바로가기라 실행해 보고 고른다
find_python() {
  local c
  for c in "${PYTHON:-}" python3 python; do
    [ -n "$c" ] || continue
    if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
      printf '%s' "$c"
      return 0
    fi
  done
  return 1
}

# docker.exe(Windows)에 넘길 경로. Git Bash의 /tmp/...를 C:/... 모양으로 바꾼다. Linux에서는 그대로다
native_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# mode_is_private 파일: 다른 사용자(others)가 아무 권한도 없으면 성공한다(env 파일은 root:docker 0640, 설계 13.2절)
mode_is_private() {
  local mode
  mode="$(stat -c %a "$1")"
  [ "${mode: -1}" = 0 ]
}

valid_env() { case "$1" in prod | dev) return 0 ;; *) return 1 ;; esac; }
other_color() { if [ "$1" = blue ]; then echo green; else echo blue; fi; }
upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

# ---- 상태 파일 ----------------------------------------------------------------
state_file() { printf '%s/deploy-%s.env' "$STATE_DIR" "$1"; }

state_get() { # state_get 환경 키 [기본값]
  local f v=""
  f="$(state_file "$1")"
  if [ -f "$f" ]; then v="$(awk -v k="$2" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$f")"; fi
  printf '%s' "${v:-${3:-}}"
}

state_set() { # state_set 환경 KEY=VALUE...: 임시 파일에 쓴 뒤 mv로 바꾼다(원자적). 같은 키는 나중 값이 이긴다
  local env="$1" f tmp pair
  shift
  f="$(state_file "$env")"
  mkdir -p "$STATE_DIR"
  tmp="$(mktemp "$f.XXXXXX")"
  {
    if [ -f "$f" ]; then cat "$f"; fi
    for pair in "$@"; do printf '%s\n' "$pair"; done
  } | awk -F= '{ k = $1; v[k] = substr($0, length(k) + 2) } END { for (k in v) print k "=" v[k] }' | sort >"$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$f"
}

state_init() { # 처음 배포하는 환경의 상태 파일을 만든다. prod는 활성이 green이라 첫 배포가 blue로 간다(엣지 견본의 upstream과 같다)
  if [ -f "$(state_file "$1")" ]; then return 0; fi
  if [ "$1" = prod ]; then
    state_set prod BE_ACTIVE=green FE_ACTIVE=green BE_BLUE_TAG=none BE_GREEN_TAG=none FE_BLUE_TAG=none FE_GREEN_TAG=none DEPLOYED_SHA=none PREVIOUS_SHA=none
  else
    state_set dev BE_DEV_TAG=none BE_DEV_PREV_TAG=none FE_DEV_TAG=none FE_DEV_PREV_TAG=none DEPLOYED_SHA=none PREVIOUS_SHA=none
  fi
}

# ---- 이름 규칙 ----------------------------------------------------------------
svc_name() { # svc_name be|fe 환경 [색] → be-prod-blue, be-dev
  if [ "$2" = dev ]; then printf '%s-dev' "$1"; else printf '%s-prod-%s' "$1" "$3"; fi
}
svc_port() { if [ "$1" = be ]; then printf 8080; else printf 3000; fi; }
tag_key() { # tag_key be|fe 환경 [색] → BE_BLUE_TAG, BE_DEV_TAG
  if [ "$2" = dev ]; then printf '%s_DEV_TAG' "$(upper "$1")"; else printf '%s_%s_TAG' "$(upper "$1")" "$(upper "$3")"; fi
}
image_of() { if [ "$1" = be ]; then printf '%s' "$BE_IMAGE"; else printf '%s' "$FE_IMAGE"; fi; }

# docker에 넘기는 파일 경로는 native_path를 거친다(Windows의 docker.exe는 /c/... 모양을 읽지 못한다)
app_compose_file() { native_path "$ROOT_DIR/infra/app/compose.app.yml"; }
compose() { # compose 환경 인자...
  local env="$1"
  shift
  docker compose -p "fit-app-$env" -f "$(app_compose_file)" --env-file "$(native_path "$(state_file "$env")")" --profile "$env" "$@"
}

# ---- 엣지와 점검 ----------------------------------------------------------------
caddy_container() {
  docker ps -q --filter "label=com.docker.compose.project=$EDGE_PROJECT" --filter "label=com.docker.compose.service=caddy" | head -n 1
}

# 컨테이너는 호스트에 게시하지 않으므로 같은 망에 있는 caddy 컨테이너 안에서 요청한다. 2xx가 아니면 실패한다
probe() {
  local c
  c="$(caddy_container)"
  [ -n "$c" ] || return 1
  docker exec "$c" wget -q -T 5 -O - "$1"
}

container_running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true)" = true ]; }

sha_match() { # sha_match 앞 뒤: 한쪽이 다른 쪽의 앞부분이면 같은 커밋으로 본다(7자 이상)
  local a="$1" b="$2"
  [ "${#a}" -ge 7 ] && [ "${#b}" -ge 7 ] || return 1
  case "$a" in "$b"*) return 0 ;; esac
  case "$b" in "$a"*) return 0 ;; esac
  return 1
}

json_string() { # json_string 키 본문: 첫 번째 "키": "값"의 값
  printf '%s' "$2" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
}

wait_ready() { # wait_ready be|fe 컨테이너: 준비될 때까지 2초 간격으로 본다. 컨테이너가 죽으면 바로 실패한다
  local svc="$1" name="$2" timeout limit now body
  if [ "$svc" = be ]; then timeout="$BE_READY_TIMEOUT"; else timeout="$FE_READY_TIMEOUT"; fi
  limit=$(($(date +%s) + timeout))
  while :; do
    container_running "$name" || {
      log "$name 컨테이너가 실행 중이 아니다"
      return 1
    }
    if [ "$svc" = be ]; then
      body="$(probe "http://$name:8081/actuator/health/readiness" 2>/dev/null || true)"
      if printf '%s' "$body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"UP"'; then return 0; fi
    elif probe "http://$name:3000/fe-healthz" >/dev/null 2>&1; then
      return 0
    fi
    now="$(date +%s)"
    if [ "$now" -ge "$limit" ]; then
      log "$name 준비 시간 초과(${timeout}초)"
      return 1
    fi
    sleep 2
  done
}

# 반대 색을 전환하기 전에 직접 확인한다. BE는 헬스와 버전, FE는 SSR 페이지와 /config.json이다(설계 6.4절 4단계)
smoke_idle() { # smoke_idle be|fe 환경 컨테이너 sha
  local svc="$1" env="$2" name="$3" sha="$4" body got
  if [ "$svc" = be ]; then
    probe "http://$name:8080/healthz" >/dev/null 2>&1 || {
      log "$name /healthz 실패"
      return 1
    }
    body="$(probe "http://$name:8080/api/v1/version" 2>/dev/null || true)"
    got="$(json_string sha "$body")"
    sha_match "$got" "$sha" || {
      log "$name 버전이 배포할 SHA와 다르다"
      return 1
    }
  else
    probe "http://$name:3000/" >/dev/null 2>&1 || {
      log "$name 첫 화면(SSR) 실패"
      return 1
    }
    body="$(probe "http://$name:3000/config.json" 2>/dev/null || true)"
    printf '%s' "$body" | grep -Eq "\"env\"[[:space:]]*:[[:space:]]*\"$env\"" || {
      log "$name /config.json의 env가 $env가 아니다"
      return 1
    }
  fi
}

write_upstream() { # write_upstream 환경 be|fe 호스트 포트: 엣지 상태 파일(infra/edge/state-sample과 같은 형식)을 원자적으로 바꾼다
  local f="$STATE_DIR/upstream-$1-$2.caddy"
  mkdir -p "$STATE_DIR"
  printf '%s\nreverse_proxy %s:%s {\n\tlb_try_duration 5s\n\tlb_try_interval 250ms\n}\n' \
    '# 활성 색 upstream. deploy.sh와 rollback.sh가 쓴다(설계 5.5절).' "$3" "$4" >"$f.new"
  mv -f "$f.new" "$f"
}
reload_edge() { bash "$ROOT_DIR/infra/edge/edgectl.sh" reload >/dev/null; }

# ---- 기록과 알림 ----------------------------------------------------------------
history_add() { # history_add 환경 동작 서비스 sha 결과
  mkdir -p "$STATE_DIR"
  printf '%s %s %s %s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" "$3" "$4" "$5" "$(id -un)" >>"$STATE_DIR/history-$1.log"
}
notify() { bash "$DEPLOY_DIR/notify.sh" "$@" || true; }

# ---- 잠금: flock이 없는 곳(Git Bash)에서도 되도록 mkdir로 한다. 프로세스가 죽어 남은 잠금은 pid로 알아본다 ----
LOCK_DIR=""
acquire_lock() { # acquire_lock 환경
  local pid
  mkdir -p "$STATE_DIR"
  LOCK_DIR="$STATE_DIR/deploy-$1.lock"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ >"$LOCK_DIR/pid"
    return 0
  fi
  pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    LOCK_DIR=""
    die "다른 배포가 돌고 있다(pid $pid)"
  fi
  log "프로세스가 죽어 남은 잠금을 지운다(pid ${pid:-?})"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  echo $$ >"$LOCK_DIR/pid"
}
release_lock() {
  if [ -n "$LOCK_DIR" ]; then rm -rf "$LOCK_DIR"; fi
  return 0
}

# 마이그레이션 파일이 바뀌었는가. 이전 SHA를 모르거나 커밋이 없으면 바뀐 것으로 본다(첫 배포)
migrations_changed() { # migrations_changed 이전sha 새sha
  if [ "${FIT_FORCE_MIGRATE:-0}" = 1 ]; then return 0; fi
  if [ "$1" = none ] || ! git -C "$REPO_DIR" cat-file -e "$1^{commit}" 2>/dev/null; then return 0; fi
  ! git -C "$REPO_DIR" diff --quiet "$1" "$2" -- "$MIGRATION_DIR"
}
````

- [ ] **Step 2: 알림과 사전 점검 작성**

`infra/deploy/notify.sh`:

````bash
#!/usr/bin/env bash
# Mattermost 수신 웹훅으로 한 줄을 보낸다(설계 6.4절 7단계). 실패해도 배포를 막지 않는다(항상 종료 코드 0).
#   bash infra/deploy/notify.sh ok|fail|info "메시지"
# 웹훅 주소는 환경변수 FIT_NOTIFY_WEBHOOK, 없으면 /etc/fit/obs.env의 MATTERMOST_WEBHOOK_URL이다.
# 둘 다 없으면 화면에만 출력한다. 주소는 출력하지 않는다.
set -uo pipefail

level="${1:-info}"
shift || true
msg="$*"
case "$level" in
  ok) icon=":white_check_mark:" ;;
  fail) icon=":x:" ;;
  *) icon=":information_source:" ;;
esac
echo "알림($level): $msg"

url="${FIT_NOTIFY_WEBHOOK:-}"
obs_env="${FIT_ENV_DIR:-/etc/fit}/obs.env"
if [ -z "$url" ] && [ -f "$obs_env" ]; then
  url="$(sed -n 's/^MATTERMOST_WEBHOOK_URL=//p' "$obs_env" | head -n 1)"
fi
[ -n "$url" ] || exit 0

# JSON 문자열로 쓸 수 있게 역슬래시와 따옴표를 이스케이프한다
esc="$(printf '%s %s' "$icon" "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')"
# 본문은 파일로 보낸다. 명령행 인자로 주면 Windows용 curl이 한글을 깨뜨린다
body="$(mktemp)"
trap 'rm -f "$body"' EXIT
printf '{"text":"%s"}' "$esc" >"$body"
body_path="$body"
if command -v cygpath >/dev/null 2>&1; then body_path="$(cygpath -m "$body")"; fi
curl -sS --max-time 10 -X POST -H 'Content-Type: application/json' --data-binary "@$body_path" "$url" >/dev/null 2>&1 ||
  echo "알림 전송에 실패했다(무시한다)"
exit 0
````

`infra/deploy/preflight.sh`:

````bash
#!/usr/bin/env bash
# 배포 전 점검(설계 6.4절 1단계). 읽기만 하고 아무것도 바꾸지 않는다. 점검마다 PASS, FAIL, SKIP만 출력하고 값은 찍지 않는다.
#   bash infra/deploy/preflight.sh <prod|dev> <sha>              # 배포 전
#   bash infra/deploy/preflight.sh <prod|dev> - --rollback       # 롤백 전(이미지·다운그레이드·마이그레이션 검사는 생략)
# 하나라도 FAIL이면 종료 코드 1이다. 임계값은 환경변수로 바꾼다: FIT_MIN_DISK_GB(5), FIT_MIN_MEM_MB(prod 2560, dev 512),
# 현재 여유 메모리를 직접 줄 때 FIT_MEM_AVAILABLE_MB, 마이그레이션 전 덤프 스크립트 FIT_PREDEPLOY_DUMP,
# 파일 권한 점검을 건너뛸 때 FIT_SKIP_PERM=1(권한 비트가 없는 NTFS의 시험용. 서버에서는 쓰지 않는다).
set -uo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENVN="${1:-}"
SHA="${2:-}"
ROLLBACK=0
if [ "${3:-}" = "--rollback" ]; then ROLLBACK=1; fi
valid_env "$ENVN" || {
  echo "사용: bash infra/deploy/preflight.sh <prod|dev> <sha> [--rollback]" >&2
  exit 2
}

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }
succeeds() { if "$@" >/dev/null 2>&1; then echo 1; else echo 0; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 계약 표(docs/infra/contracts/env.md)에서 그룹의 필수 키를 한 줄에 하나씩 뽑는다
required_keys() {
  awk -F'|' -v g="$1" '
    $2 ~ /^ *`[A-Z][A-Z0-9_]*` *$/ {
      k = $2; gsub(/[ `]/, "", k)
      flag = $4; gsub(/ /, "", flag)
      n = split($3, a, ",")
      for (i = 1; i <= n; i++) { x = a[i]; gsub(/ /, "", x); if (x == g && flag == "O") print k }
    }' "$ROOT_DIR/docs/infra/contracts/env.md"
}

check_env_file() { # check_env_file 파일 그룹
  local f="$1" group="$2" name PY
  name="$(basename "$f")"
  if [ ! -f "$f" ]; then
    fail "$name: 파일이 없다"
    return
  fi
  if [ "${FIT_SKIP_PERM:-0}" = 1 ]; then
    skip "$name: 파일 권한 (FIT_SKIP_PERM=1, NTFS에는 권한 비트가 없는 시험용)"
  else
    ok_if "$name: 다른 사용자가 읽을 수 없다" "$(succeeds mode_is_private "$f")"
  fi
  ok_if "$name: APP_ENV가 $ENVN이다" "$(succeeds grep -qx "APP_ENV=$ENVN" "$f")"
  ok_if "$name: 자리표시자(REPLACE_ME)가 남아 있지 않다" "$([ "$(grep -c 'REPLACE_ME' "$f")" = 0 ] && echo 1 || echo 0)"
  required_keys "$group" >"$TMP/required.$group"
  if PY="$(find_python)"; then
    ok_if "$name: 형식과 필수 키(그룹 $group)가 맞다" \
      "$(succeeds "$PY" "$(native_path "$ROOT_DIR/infra/ci/check_env_files.py")" "$(native_path "$f")" --required "$(native_path "$TMP/required.$group")")"
  else
    skip "$name: 형식과 필수 키 (python 3.9 이상 없음)"
  fi
}

echo "-- 환경 파일"
check_env_file "$ENV_DIR/$ENVN.env" app
check_env_file "$ENV_DIR/fe-$ENVN.env" fe
# FE 서버가 BE를 부르는 주소는 이 환경의 엣지 내부 리스너여야 한다. 같은 망의 컨테이너는 어느 환경의 리스너에도 닿으므로 환경이 섞이지 않게 여기서 막는다
want_port=8081
if [ "$ENVN" = dev ]; then want_port=8082; fi
be_url="$(sed -n 's/^BE_INTERNAL_URL=//p' "$ENV_DIR/fe-$ENVN.env" 2>/dev/null | head -n 1)"
ok_if "fe-$ENVN.env: BE_INTERNAL_URL이 이 환경의 엣지 내부 리스너(http://caddy:$want_port)다" "$([ "$be_url" = "http://caddy:$want_port" ] && echo 1 || echo 0)"
if [ "$ROLLBACK" = 0 ]; then check_env_file "$ENV_DIR/migrate-$ENVN.env" migrate; fi

echo "-- Docker와 compose"
ok_if "docker가 응답한다" "$(succeeds docker info)"
STATE_FOR_CONFIG="$(state_file "$ENVN")"
if [ ! -f "$STATE_FOR_CONFIG" ]; then
  : >"$TMP/empty.env"
  STATE_FOR_CONFIG="$TMP/empty.env"
fi
ok_if "compose 설정이 올바르다(config -q)" \
  "$(succeeds docker compose -p "fit-app-$ENVN" -f "$(app_compose_file)" --env-file "$(native_path "$STATE_FOR_CONFIG")" --profile "$ENVN" config -q)"
net_prod="${FIT_NET_PROD:-net-prod}" net_dev="${FIT_NET_DEV:-net-dev}" net_data="${FIT_NET_DATA:-net-data}"
net_env="$net_prod"
if [ "$ENVN" = dev ]; then net_env="$net_dev"; fi
ok_if "공유 망이 있다($ENVN 망과 데이터 망)" "$(succeeds docker network inspect "$net_env" "$net_data")"
ok_if "엣지(caddy)가 돌고 있다(배포가 이 컨테이너로 서비스를 점검한다)" "$([ -n "$(caddy_container)" ] && echo 1 || echo 0)"

echo "-- 자원"
min_disk="${FIT_MIN_DISK_GB:-5}"
mkdir -p "$STATE_DIR" 2>/dev/null || true
free_gb=$(($(df -Pk "$STATE_DIR" | awk 'NR == 2 { print $4 }') / 1024 / 1024))
ok_if "디스크 여유가 ${min_disk}GB 이상이다" "$([ "$free_gb" -ge "$min_disk" ] && echo 1 || echo 0)"
min_mem="${FIT_MIN_MEM_MB:-512}"
if [ "$ENVN" = prod ]; then min_mem="${FIT_MIN_MEM_MB:-2560}"; fi
mem_mb="${FIT_MEM_AVAILABLE_MB:-}"
if [ -z "$mem_mb" ]; then mem_mb="$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null)"; fi
if [ -z "$mem_mb" ]; then
  skip "메모리 여유 (MemAvailable을 읽을 수 없다)"
else
  ok_if "메모리 여유가 ${min_mem}MB 이상이다(겹침 배포에 필요한 양)" "$([ "$mem_mb" -ge "$min_mem" ] && echo 1 || echo 0)"
fi

if [ "$ROLLBACK" = 0 ]; then
  echo "-- 이미지와 커밋"
  [ -n "$SHA" ] || {
    echo "SHA가 필요하다" >&2
    exit 2
  }
  ok_if "이미지 $BE_IMAGE:$SHA 가 있다" "$(succeeds docker image inspect "$BE_IMAGE:$SHA")"
  ok_if "이미지 $FE_IMAGE:$SHA 가 있다" "$(succeeds docker image inspect "$FE_IMAGE:$SHA")"
  ok_if "저장소에 커밋 $SHA 가 있다" "$(succeeds git -C "$REPO_DIR" rev-parse --verify -q "$SHA^{commit}")"
  cur="$(state_get "$ENVN" DEPLOYED_SHA none)"
  if [ "$cur" = none ]; then
    skip "다운그레이드 가드 (아직 배포한 적이 없다)"
  else
    # 얕은 clone이면 현재 배포된 커밋을 먼저 가져온다(실패해도 아래 판정이 막는다)
    git -C "$REPO_DIR" cat-file -e "$cur^{commit}" 2>/dev/null || git -C "$REPO_DIR" fetch --quiet origin "$cur" 2>/dev/null || true
    ok_if "다운그레이드가 아니다(현재 $cur 의 후손이거나 같은 커밋)" "$(succeeds git -C "$REPO_DIR" merge-base --is-ancestor "$cur" "$SHA")"
  fi
  if migrations_changed "$cur" "$SHA"; then
    if [ "$ENVN" = prod ]; then
      dump="${FIT_PREDEPLOY_DUMP:-$ROOT_DIR/infra/backup/pg-backup.sh}"
      ok_if "마이그레이션이 있어 사전 덤프 스크립트가 필요하다(있다)" "$([ -x "$dump" ] && echo 1 || echo 0)"
    else
      pass "마이그레이션이 있다(dev는 사전 덤프 없이 실행한다)"
    fi
  else
    pass "마이그레이션 변경이 없다"
  fi
fi

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d개 점검 실패\n' "$FAILED"
  exit 1
fi
printf '\n배포 사전 점검 통과\n'
````

- [ ] **Step 3: shellcheck 확인**

Run:

```bash
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/deploy/lib.sh infra/deploy/notify.sh infra/deploy/preflight.sh; echo "shellcheck exit=$?"
```

Expected: `shellcheck exit=0`

- [ ] **Step 4: 공통 함수 빠른 확인 (게이트)**

서버나 시험 환경이 없어도 되는 함수만 임시 디렉터리에서 확인한다. 전체 시나리오는 Task 5가 확인한다.

Run:

```bash
export PYTHONUTF8=1
D="$(mktemp -d)"
FIT_STATE_DIR="$D" bash -c '
. infra/deploy/lib.sh
sha_match abc1234 abc1234567 && echo "sha_match 같은 커밋 OK"
sha_match abc1234 def1234567 || echo "sha_match 다른 커밋 OK"
sha_match abc123 abc1234567 || echo "sha_match 7자 미만 거부 OK"
[ "$(json_string sha "{\"sha\": \"ab12\", \"x\": \"y\"}")" = ab12 ] && echo "json_string OK"
state_set prod K=one OTHER=2; state_set prod K=two
[ "$(state_get prod K)$(state_get prod OTHER)" = two2 ] && echo "state_set 나중 값 우선 OK"
state_init dev; [ "$(state_get dev DEPLOYED_SHA)" = none ] && echo "state_init OK"
mkdir "$FIT_STATE_DIR/deploy-prod.lock"; echo 99999999 > "$FIT_STATE_DIR/deploy-prod.lock/pid"
acquire_lock prod && echo "남은 잠금 정리 OK"; release_lock'
rm -rf "$D"
bash infra/deploy/notify.sh ok "시험 메시지"; echo "notify exit=$?"
bash infra/deploy/preflight.sh; echo "preflight exit=$?"
```

Expected: `OK`로 끝나는 줄 7개(`sha_match 같은 커밋 OK`, `sha_match 다른 커밋 OK`, `sha_match 7자 미만 거부 OK`, `json_string OK`, `state_set 나중 값 우선 OK`, `state_init OK`, `남은 잠금 정리 OK`), `알림(ok): 시험 메시지`와 `notify exit=0`, 사용법과 `preflight exit=2`

- [ ] **Step 5: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/deploy/lib.sh infra/deploy/notify.sh infra/deploy/preflight.sh
git update-index --chmod=+x infra/deploy/notify.sh infra/deploy/preflight.sh
git commit -m "feat(infra): 배포 공통 함수, 알림, 배포 전 점검 추가"
```

---

### Task 3: 스모크와 배포

**목표:** 엣지를 거친 서비스 확인(`smoke.sh`)과 배포(`deploy.sh`)를 만든다.

**Files:**
- Create: `infra/deploy/smoke.sh`, `infra/deploy/deploy.sh`

**Interfaces:**
- `smoke.sh <prod|dev> [--sha SHA] [--only be|fe]`: 점검마다 `PASS`·`FAIL`·`SKIP`을 출력하고 하나라도 FAIL이면 종료 코드 1이다. 주소는 `/etc/fit/edge.env`의 `PROD_HOST`·`DEV_HOST`(`FIT_EDGE_ENV`로 경로를 바꾼다)로 `https://<호스트>`를 만들고 서버 자신(`FIT_SMOKE_ADDR`, 기본 127.0.0.1)으로 연결한다. `FIT_SMOKE_PORT`(443), `FIT_SMOKE_INSECURE=1`, `FIT_SMOKE_SEARCH_PATH`(검색 폴백 점검), `FIT_SMOKE_RETRIES`(2, 연결 실패만 다시 시도). dev는 `DEV_GATE_KEY` 쿠키를 보내고 키는 출력하지 않는다
- `deploy.sh <prod|dev> <sha>`: 이미지 `be:<sha>`, `fe:<sha>`가 있어야 한다. CI 밖에서는 `SKIP_VERIFY=<사유>`가 필요하다. 실패하면 종료 코드 1이고 실패한 서비스는 이전 상태로 돌아가 있다. 이력은 `/srv/fit/state/history-<환경>.log`
- Consumes: Task 2의 `lib.sh`, `preflight.sh`, `notify.sh`, 1C-1의 `edgectl.sh reload`

핵심 결정:

- **prod 순서(서비스마다 BE, FE 순):** 반대 색의 태그를 상태에 쓰고 → (FE는 정적 자산을 풀에 쌓은 뒤) 컨테이너를 `--force-recreate`로 띄우고 → 준비 확인 → idle 색 직접 확인 → upstream 파일을 바꿔 `edgectl.sh reload` → `smoke.sh`(엣지 경유, 새 SHA인지) → 활성 색 기록 → 드레인 → 이전 색 정지(컨테이너는 남긴다).
- **실패 복구:** 새 색 확인에 실패하면 새 컨테이너를 지우고 태그를 되돌리며 트래픽은 옮기지 않는다. 엣지 전환 뒤 확인에 실패하면 upstream을 이전 색으로 되돌려 reload한 뒤 새 색을 지운다. BE가 성공하고 FE가 실패하면 BE는 새 버전으로 남는다(새 BE는 직전 FE와 호환돼야 한다. BE 계약 #16).
- **마이그레이션:** 파일이 바뀌었을 때만, 서비스를 건드리기 전에 한다. prod는 사전 덤프(`predeploy <환경> <sha>`) 후 `fit-migrate-<환경>` 일회성 컨테이너(`migrate-<환경>.env`, 데이터 망)를 돌린다. 덤프나 마이그레이션이 실패하면 거기서 멈춘다.
- **정적 자산 풀:** FE 이미지의 `/app/.next/static`을 `docker cp`로 꺼내 `/srv/fit/web/<환경>/pool/_next/static/`에 이미 있는 파일은 덮어쓰지 않고 쌓는다(해시 이름은 내용이 같다). 이번 릴리스가 가진 파일의 수정 시각을 갱신하고 `FIT_POOL_KEEP_DAYS`(14)일 넘게 어느 릴리스에도 없던 파일은 지운다.
- **dev:** 색이 없어 `up --force-recreate`로 교체한다. 확인에 실패하면 직전 태그로 다시 교체한다(없으면 지운다). 직전 태그는 `*_DEV_PREV_TAG`에 둔다.
- **스모크의 검색 폴백 점검:** `FIT_SMOKE_SEARCH_PATH`가 있을 때만 검색 1건을 호출해 `X-Fallback` 헤더가 없는지 본다(Modal 연동이 폴백에 가려지지 않게. BE 계약 #17).

- [ ] **Step 1: 스모크 작성**

````bash
#!/usr/bin/env bash
# 배포한 서비스를 엣지(Caddy)를 거쳐 확인한다(설계 6.3절 smoke:public, 6.4절 5단계). 서버 안에서 돌린다.
#   bash infra/deploy/smoke.sh <prod|dev> [--sha SHA] [--only be|fe]
# 점검마다 PASS, FAIL, SKIP만 출력하고 dev 게이트 키는 출력하지 않는다. 하나라도 FAIL이면 종료 코드 1이다.
# 주소는 /etc/fit/edge.env의 PROD_HOST·DEV_HOST로 만들고(https://<호스트>) 서버 자신(127.0.0.1)으로 연결한다.
# 시험이나 다른 곳에서는 환경변수로 바꾼다: FIT_EDGE_ENV(edge.env 경로), FIT_SMOKE_PORT(443), FIT_SMOKE_ADDR(연결할 IP, 기본 127.0.0.1.
# 빈 값이면 DNS를 쓴다), FIT_SMOKE_INSECURE=1(인증서를 검증하지 않는다. 시험용 내부 CA)
# 검색 폴백 점검은 FIT_SMOKE_SEARCH_PATH(예: "/api/v1/search?q=김치")를 줄 때만 한다(없으면 SKIP).
set -uo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENVN="${1:-}"
shift || true
SHA="" ONLY=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --sha) SHA="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
done
valid_env "$ENVN" || {
  echo "사용: bash infra/deploy/smoke.sh <prod|dev> [--sha SHA] [--only be|fe]" >&2
  exit 2
}

EDGE_ENV="${FIT_EDGE_ENV:-$ENV_DIR/edge.env}"
edge_value() { sed -n "s/^$1=//p" "$EDGE_ENV" 2>/dev/null | head -n 1; }
host="$(edge_value PROD_HOST)"
if [ "$ENVN" = dev ]; then host="$(edge_value DEV_HOST)"; fi
[ -n "$host" ] || die "$EDGE_ENV에서 ${ENVN}의 호스트를 읽지 못했다"
port="${FIT_SMOKE_PORT:-443}"
addr="${FIT_SMOKE_ADDR-127.0.0.1}"
BASE="https://$host"
if [ "$port" != 443 ]; then BASE="$BASE:$port"; fi
CURL=(-sS --max-time 20)
if [ -n "$addr" ]; then CURL+=(--resolve "$host:$port:$addr"); fi
if [ "${FIT_SMOKE_INSECURE:-0}" = 1 ]; then CURL+=(-k); fi
if [ "$ENVN" = dev ]; then
  key="$(edge_value DEV_GATE_KEY)"
  [ -n "$key" ] && CURL+=(-b "fit_dev=$key")
fi

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# get 경로: STATUS, HEADERS(소문자), BODY를 채운다. 연결 실패(종료 코드 7)는 다시 시도한다
STATUS="" HEADERS="" BODY=""
get() {
  local rc=0 n=0
  while :; do
    # curl.exe(Windows)가 쓸 파일은 native_path로 넘긴다
    STATUS="$(curl "${CURL[@]}" -D "$(native_path "$TMP/h")" -o "$(native_path "$TMP/b")" -w '%{http_code}' "$BASE$1" 2>/dev/null)" && break
    rc=$?
    if [ "$rc" = 7 ] && [ "$n" -lt "${FIT_SMOKE_RETRIES:-2}" ]; then
      n=$((n + 1))
      sleep 1
      continue
    fi
    STATUS="000"
    HEADERS=""
    BODY=""
    return 0
  done
  HEADERS="$(tr -d '\r' <"$TMP/h" | tr '[:upper:]' '[:lower:]')"
  BODY="$(cat "$TMP/b")"
}
header_value() { printf '%s\n' "$HEADERS" | awk -F': ' -v k="$1" '$1 == k { print $2; exit }'; }

check_be() {
  local got
  get /healthz
  ok_if "BE: /healthz 가 200이다" "$([ "$STATUS" = 200 ] && echo 1 || echo 0)"
  get /api/v1/version
  got="$(json_string sha "$BODY")"
  [ -n "$got" ] || got="$(header_value x-app-version)"
  if [ -n "$SHA" ]; then
    ok_if "BE: 엣지 경유 버전이 배포한 SHA다" "$([ "$STATUS" = 200 ] && sha_match "$got" "$SHA" && echo 1 || echo 0)"
  else
    ok_if "BE: /api/v1/version 이 200이고 SHA를 준다" "$([ "$STATUS" = 200 ] && [ -n "$got" ] && echo 1 || echo 0)"
  fi
  if [ -n "${FIT_SMOKE_SEARCH_PATH:-}" ]; then
    get "$FIT_SMOKE_SEARCH_PATH"
    ok_if "BE: 검색 1건이 200이다" "$([ "$STATUS" = 200 ] && echo 1 || echo 0)"
    fb="$(header_value x-fallback)"
    ok_if "BE: 검색이 폴백으로 처리되지 않았다(Modal 연동 확인)${fb:+. X-Fallback: $fb}" "$([ -z "$fb" ] && echo 1 || echo 0)"
  else
    skip "BE: 검색 폴백 점검 (FIT_SMOKE_SEARCH_PATH 없음)"
  fi
}

check_fe() {
  get /
  ok_if "FE: / 가 200이고 HTML이다(SSR 페이지)" "$([ "$STATUS" = 200 ] && printf '%s' "$HEADERS" | grep -q 'content-type: text/html' && echo 1 || echo 0)"
  get /fe-healthz
  ok_if "FE: /fe-healthz 가 200이다" "$([ "$STATUS" = 200 ] && echo 1 || echo 0)"
  get /config.json
  ok_if "FE: /config.json 이 200이고 env가 $ENVN이다" \
    "$([ "$STATUS" = 200 ] && printf '%s' "$BODY" | grep -Eq "\"env\"[[:space:]]*:[[:space:]]*\"$ENVN\"" && echo 1 || echo 0)"
}

case "$ONLY" in
  be) check_be ;;
  fe) check_fe ;;
  "")
    check_be
    check_fe
    ;;
  *)
    echo "--only는 be 또는 fe다" >&2
    exit 2
    ;;
esac

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d개 점검 실패\n' "$FAILED"
  exit 1
fi
printf '\n스모크 통과\n'
````

- [ ] **Step 2: 배포 작성**

````bash
#!/usr/bin/env bash
# 배포(설계 6.4절). GitLab이 죽어도 서버에서 직접 실행할 수 있다.
#   bash infra/deploy/deploy.sh <prod|dev> <sha>
# prod는 BE와 FE를 차례로 반대 색으로 띄워 전환하고(Blue/Green) dev는 단일 색을 교체한다. 이미지는 be:<sha>, fe:<sha>로 이미 조립돼 있어야 한다.
# CI가 아닌 곳(환경변수 CI가 없음)에서 직접 실행하려면 SKIP_VERIFY=<사유>를 줘야 한다(긴급 수동 배포, RB-02b). 사유는 이력에 남는다.
# 환경변수: FIT_DRAIN_SECONDS(30) FIT_BE_READY_TIMEOUT(150) FIT_FE_READY_TIMEOUT(60) FIT_POOL_KEEP_DAYS(14)
#          FIT_PREDEPLOY_DUMP(prod 마이그레이션 전 덤프 스크립트) FIT_FORCE_MIGRATE=1
# 실패하면 자동으로 이전 상태로 돌아가고 종료 코드 1이다. 마이그레이션은 되돌리지 않는다(forward-fix 원칙, 설계 6.5절).
set -euo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENVN="${1:-}"
SHA="${2:-}"
if ! valid_env "$ENVN" || ! printf '%s' "$SHA" | grep -Eq '^[0-9a-fA-F]{7,40}$'; then
  echo "사용: bash infra/deploy/deploy.sh <prod|dev> <sha(7~40자리 16진수)>" >&2
  exit 2
fi
if [ -z "${CI:-}" ] && [ -z "${SKIP_VERIFY:-}" ]; then
  die "CI 밖에서 직접 배포하려면 SKIP_VERIFY=<사유>를 준다. CI의 verify 단계를 건너뛰는 긴급 배포다(RB-02b)"
fi

bash "$DEPLOY_DIR/preflight.sh" "$ENVN" "$SHA" || die "사전 점검에 실패했다"

acquire_lock "$ENVN"
trap release_lock EXIT
state_init "$ENVN"
PREV="$(state_get "$ENVN" DEPLOYED_SHA none)"
START="$(date +%s)"
WHO="${GITLAB_USER_LOGIN:-$(id -un)}"
NOTE="${SKIP_VERIFY:+ skip-verify:$SKIP_VERIFY}"
history_add "$ENVN" deploy-start all "$SHA" "start$NOTE"

# 마이그레이션이 바뀌었으면 prod는 사전 덤프 뒤에, dev는 바로 일회성 컨테이너로 실행한다. 실패하면 트래픽을 건드리기 전에 멈춘다
run_migrations() {
  if ! migrations_changed "$PREV" "$SHA"; then
    log "마이그레이션 변경 없음"
    return 0
  fi
  if [ "$ENVN" = prod ]; then
    local dump="${FIT_PREDEPLOY_DUMP:-$ROOT_DIR/infra/backup/pg-backup.sh}"
    log "마이그레이션 전 덤프"
    "$dump" predeploy "$ENVN" "$SHA" || {
      log "사전 덤프에 실패했다"
      return 1
    }
  fi
  log "마이그레이션 실행(일회성 컨테이너)"
  docker rm -f "fit-migrate-$ENVN" >/dev/null 2>&1 || true
  docker run --rm --name "fit-migrate-$ENVN" --network "${FIT_NET_DATA:-net-data}" \
    --env-file "$ENV_DIR/migrate-$ENVN.env" "$BE_IMAGE:$SHA" || {
    log "마이그레이션에 실패했다"
    return 1
  }
}

# FE 이미지의 정적 자산(/app/.next/static)을 누적 풀에 쌓는다. 열려 있는 탭이 이전 릴리스의 해시 자산을 요청해도 404가 나지 않게 한다(설계 5.3절).
# 이미 있는 파일은 덮어쓰지 않고(해시 이름은 내용이 같다) 이번 릴리스가 가진 파일의 수정 시각을 갱신한다. 오래 안 쓰인 파일은 지운다
sync_pool() {
  local sha="$1" dest id tmp f days
  dest="$WEB_DIR/$ENVN/pool/_next/static"
  days="${FIT_POOL_KEEP_DAYS:-14}"
  mkdir -p "$dest" "$STATE_DIR"
  tmp="$(mktemp -d "$STATE_DIR/pool.XXXXXX")"
  id="$(docker create "$FE_IMAGE:$sha")" || {
    rm -rf "$tmp"
    return 1
  }
  if ! docker cp "$id:/app/.next/static/." "$(native_path "$tmp")"; then
    docker rm "$id" >/dev/null 2>&1 || true
    rm -rf "$tmp"
    log "FE 이미지에 /app/.next/static이 없다"
    return 1
  fi
  docker rm "$id" >/dev/null 2>&1 || true
  if [ -z "$(find "$tmp" -type f | head -n 1)" ]; then
    rm -rf "$tmp"
    log "FE 이미지의 정적 자산이 비어 있다"
    return 1
  fi
  while IFS= read -r -d '' f; do
    if [ ! -e "$dest/$f" ]; then
      mkdir -p "$dest/$(dirname "$f")"
      cp "$tmp/$f" "$dest/$f"
    fi
    touch "$dest/$f"
  done < <(cd "$tmp" && find . -type f -print0)
  chmod -R a+rX "$dest"
  find "$dest" -type f -mtime +"$days" -delete
  find "$dest" -mindepth 1 -type d -empty -delete
  rm -rf "$tmp"
  log "정적 자산 풀 갱신($dest)"
}

# prod: 반대 색을 띄우고 확인한 뒤 엣지를 전환한다. 어느 단계든 실패하면 새 색을 치우고 엣지를 원래대로 돌린다
deploy_color() { # deploy_color be|fe
  local svc="$1" S active new name oldname tagk oldtag activetag
  S="$(upper "$svc")"
  active="$(state_get prod "${S}_ACTIVE" green)"
  new="$(other_color "$active")"
  name="$(svc_name "$svc" prod "$new")"
  oldname="$(svc_name "$svc" prod "$active")"
  tagk="$(tag_key "$svc" prod "$new")"
  oldtag="$(state_get prod "$tagk" none)"
  activetag="$(state_get prod "$(tag_key "$svc" prod "$active")" none)"
  log "[$svc] $active → $new ($name)"
  if [ "$svc" = fe ]; then sync_pool "$SHA" || return 1; fi
  state_set prod "$tagk=$SHA"
  discard_new() {
    compose prod rm -sf "$name" >/dev/null 2>&1 || true
    state_set prod "$tagk=$oldtag"
  }
  if ! compose prod up -d --no-deps --force-recreate "$name"; then
    discard_new
    return 1
  fi
  if ! wait_ready "$svc" "$name" || ! smoke_idle "$svc" prod "$name" "$SHA"; then
    log "[$svc] 새 색($name) 확인에 실패했다. 트래픽은 옮기지 않았다"
    discard_new
    return 1
  fi
  write_upstream prod "$svc" "$name" "$(svc_port "$svc")"
  if ! reload_edge || ! bash "$DEPLOY_DIR/smoke.sh" prod --sha "$SHA" --only "$svc"; then
    log "[$svc] 엣지 전환 뒤 확인에 실패했다. 이전 색으로 돌린다"
    if [ "$activetag" != none ]; then
      write_upstream prod "$svc" "$oldname" "$(svc_port "$svc")"
      reload_edge || log "경고: 엣지를 되돌리는 reload에 실패했다. 수동으로 확인한다"
    fi
    discard_new
    return 1
  fi
  state_set prod "${S}_ACTIVE=$new"
  history_add prod switch "$svc" "$SHA" "$new"
  if [ "$activetag" != none ]; then
    log "[$svc] 드레인 ${DRAIN_SECONDS}초 뒤 이전 색($oldname)을 멈춘다"
    sleep "$DRAIN_SECONDS"
    compose prod stop -t 40 "$oldname" >/dev/null
  fi
}

# dev: 단일 색을 교체한다. 확인에 실패하면 직전 이미지로 돌아간다
deploy_dev() { # deploy_dev be|fe
  local svc="$1" S name tagk oldtag oldprev
  S="$(upper "$svc")"
  name="$(svc_name "$svc" dev)"
  tagk="$(tag_key "$svc" dev)"
  oldtag="$(state_get dev "$tagk" none)"
  oldprev="$(state_get dev "${S}_DEV_PREV_TAG" none)"
  log "[$svc] dev 교체 $oldtag → $SHA"
  if [ "$svc" = fe ]; then sync_pool "$SHA" || return 1; fi
  state_set dev "$tagk=$SHA" "${S}_DEV_PREV_TAG=$oldtag"
  if compose dev up -d --no-deps --force-recreate "$name" && wait_ready "$svc" "$name" &&
    smoke_idle "$svc" dev "$name" "$SHA" && bash "$DEPLOY_DIR/smoke.sh" dev --sha "$SHA" --only "$svc"; then
    return 0
  fi
  log "[$svc] dev 확인에 실패했다. 직전 이미지로 돌린다"
  state_set dev "$tagk=$oldtag" "${S}_DEV_PREV_TAG=$oldprev"
  if [ "$oldtag" = none ]; then
    compose dev rm -sf "$name" >/dev/null 2>&1 || true
  elif ! { compose dev up -d --no-deps --force-recreate "$name" >/dev/null && wait_ready "$svc" "$name"; }; then
    log "경고: 직전 이미지로 돌린 뒤에도 준비되지 않았다"
  fi
  return 1
}

main() {
  run_migrations || return 1
  local svc
  for svc in be fe; do
    if [ "$ENVN" = prod ]; then deploy_color "$svc" || return 1; else deploy_dev "$svc" || return 1; fi
  done
  state_set "$ENVN" "DEPLOYED_SHA=$SHA" "PREVIOUS_SHA=$PREV"
}

if main; then
  elapsed=$(($(date +%s) - START))
  history_add "$ENVN" deploy-end all "$SHA" "ok$NOTE"
  notify ok "배포 완료: $ENVN ${SHA:0:12} (작성자 $WHO, ${elapsed}초)"
  log "배포 완료: $ENVN $SHA"
else
  history_add "$ENVN" deploy-end all "$SHA" "fail$NOTE"
  notify fail "배포 실패: $ENVN ${SHA:0:12} (작성자 $WHO). 실패한 서비스는 이전 상태로 돌렸다. 상태는 'bash infra/edge/edgectl.sh status'와 이력($STATE_DIR/history-$ENVN.log)을 본다"
  die "배포에 실패했다. 실패한 서비스는 이전 상태로 돌렸다(BE만 성공하고 FE가 실패했다면 BE는 새 버전으로 남는다)"
fi
````

- [ ] **Step 3: shellcheck와 입력 거부 확인 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/deploy/smoke.sh infra/deploy/deploy.sh; echo "shellcheck exit=$?"
bash infra/deploy/deploy.sh prod; echo "exit=$?"
bash infra/deploy/deploy.sh prod 0123456; echo "exit=$?"
bash infra/deploy/smoke.sh nope; echo "exit=$?"
```

Expected: `shellcheck exit=0`, 첫 명령은 사용법과 `exit=2`, 둘째 명령은 `FAIL CI 밖에서 직접 배포하려면 SKIP_VERIFY=<사유>를 준다 …`와 `exit=1`, 셋째 명령은 사용법과 `exit=2`. 실제 배포는 Task 5의 시험 환경에서 확인한다.

- [ ] **Step 4: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/deploy/smoke.sh infra/deploy/deploy.sh
git update-index --chmod=+x infra/deploy/smoke.sh infra/deploy/deploy.sh
git commit -m "feat(infra): 배포 후 스모크와 배포 스크립트(Blue/Green, dev 교체, 마이그레이션, 정적 자산 풀) 추가"
```

---

### Task 4: 롤백과 기동 순서

**목표:** 직전 배포로 즉시 되돌리는 `rollback.sh`와 재부팅·장애 뒤 순서대로 올리는 `fit-up.sh`를 만든다.

**Files:**
- Create: `infra/deploy/rollback.sh`, `infra/deploy/fit-up.sh`

**Interfaces:**
- `rollback.sh <prod|dev> [be|fe|all]`(기본 all): prod는 이전 색(컨테이너와 이미지가 남아 있다)을 다시 띄워 확인한 뒤 엣지를 옮기고 지금 색을 멈춘다. dev는 `*_DEV_PREV_TAG`로 교체한다. 실패하면 지금 상태를 그대로 두고 종료 코드 1이다. 전체 롤백이면 상태의 `DEPLOYED_SHA`와 `PREVIOUS_SHA`를 맞바꾼다. 긴급 복구라 `SKIP_VERIFY`가 필요 없다
- `fit-up.sh`: 공유 망(`networks.sh`) → data → edge(`up -d --wait`) → app(prod·dev의 활성 색만, 상태 파일이 없으면 건너뜀) → obs → 스모크(실패는 경고만). data·obs compose 파일이 없으면 건너뛴다(1D, 1E가 만든다)

핵심 결정:

- 롤백은 `preflight.sh --rollback`을 거친다(이미지·다운그레이드·마이그레이션 검사는 생략하고 env, 엣지, 디스크, 메모리만 본다).
- 이전 색이 준비되지 않거나 엣지를 옮긴 뒤 확인에 실패하면 지금 색으로 되돌린다.
- DB 마이그레이션은 되돌리지 않는다. expand/contract 원칙이라 이전 버전이 새 스키마에서도 돌아야 한다(설계 6.5절).
- `fit-up.sh`는 활성이 아닌 색을 올리지 않는다.

- [ ] **Step 1: 롤백과 기동 스크립트 작성**

`infra/deploy/rollback.sh`:

````bash
#!/usr/bin/env bash
# 직전 배포로 즉시 되돌린다(설계 6.4절 6단계). 이전 색의 컨테이너와 이미지가 남아 있어서 빠르다.
#   bash infra/deploy/rollback.sh <prod|dev> [be|fe|all]      # 기본은 all
# prod는 이전 색을 다시 띄워 확인한 뒤 엣지를 옮기고 지금 색을 멈춘다. dev는 직전 이미지로 교체한다.
# DB 마이그레이션은 되돌리지 않는다. expand/contract 원칙이라 이전 버전이 새 스키마에서도 돌아야 한다(설계 6.5절).
# 되돌리기에 실패하면 지금 상태를 그대로 두고 종료 코드 1이다. 직접 실행에는 SKIP_VERIFY 같은 사유가 필요 없다(긴급 복구).
set -euo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENVN="${1:-}"
WHICH="${2:-all}"
case "$WHICH" in be | fe | all) ;; *) WHICH="" ;; esac
if ! valid_env "$ENVN" || [ -z "$WHICH" ]; then
  echo "사용: bash infra/deploy/rollback.sh <prod|dev> [be|fe|all]" >&2
  exit 2
fi
[ -f "$(state_file "$ENVN")" ] || die "$ENVN에는 배포 기록(상태 파일)이 없다"

bash "$DEPLOY_DIR/preflight.sh" "$ENVN" - --rollback || die "사전 점검에 실패했다"

acquire_lock "$ENVN"
trap release_lock EXIT
WHO="${GITLAB_USER_LOGIN:-$(id -un)}"

rollback_color() { # rollback_color be|fe
  local svc="$1" S active prev name oldname prevtag activetag
  S="$(upper "$svc")"
  active="$(state_get prod "${S}_ACTIVE" green)"
  prev="$(other_color "$active")"
  name="$(svc_name "$svc" prod "$prev")"
  oldname="$(svc_name "$svc" prod "$active")"
  prevtag="$(state_get prod "$(tag_key "$svc" prod "$prev")" none)"
  activetag="$(state_get prod "$(tag_key "$svc" prod "$active")" none)"
  [ "$prevtag" != none ] || {
    log "[$svc] 되돌릴 이전 색이 없다"
    return 1
  }
  docker image inspect "$(image_of "$svc"):$prevtag" >/dev/null 2>&1 || {
    log "[$svc] 이전 이미지 $(image_of "$svc"):$prevtag 가 없다"
    return 1
  }
  log "[$svc] $active($activetag) → $prev($prevtag)"
  if ! compose prod up -d --no-deps "$name" || ! wait_ready "$svc" "$name" || ! smoke_idle "$svc" prod "$name" "$prevtag"; then
    log "[$svc] 이전 색($name)이 준비되지 않았다. 지금 상태를 그대로 둔다"
    compose prod stop -t 40 "$name" >/dev/null 2>&1 || true
    return 1
  fi
  write_upstream prod "$svc" "$name" "$(svc_port "$svc")"
  if ! reload_edge || ! bash "$DEPLOY_DIR/smoke.sh" prod --sha "$prevtag" --only "$svc"; then
    log "[$svc] 엣지를 옮긴 뒤 확인에 실패했다. 지금 색으로 다시 돌린다"
    write_upstream prod "$svc" "$oldname" "$(svc_port "$svc")"
    reload_edge || log "경고: 엣지를 되돌리는 reload에 실패했다. 수동으로 확인한다"
    compose prod stop -t 40 "$name" >/dev/null 2>&1 || true
    return 1
  fi
  state_set prod "${S}_ACTIVE=$prev"
  history_add prod rollback "$svc" "$prevtag" "$prev"
  compose prod stop -t 40 "$oldname" >/dev/null
}

rollback_dev() { # rollback_dev be|fe
  local svc="$1" S name tagk cur prev
  S="$(upper "$svc")"
  name="$(svc_name "$svc" dev)"
  tagk="$(tag_key "$svc" dev)"
  cur="$(state_get dev "$tagk" none)"
  prev="$(state_get dev "${S}_DEV_PREV_TAG" none)"
  [ "$prev" != none ] || {
    log "[$svc] 되돌릴 이전 이미지가 없다"
    return 1
  }
  docker image inspect "$(image_of "$svc"):$prev" >/dev/null 2>&1 || {
    log "[$svc] 이전 이미지 $(image_of "$svc"):$prev 가 없다"
    return 1
  }
  log "[$svc] dev $cur → $prev"
  state_set dev "$tagk=$prev" "${S}_DEV_PREV_TAG=$cur"
  if compose dev up -d --no-deps --force-recreate "$name" && wait_ready "$svc" "$name" && smoke_idle "$svc" dev "$name" "$prev"; then
    history_add dev rollback "$svc" "$prev" ok
    return 0
  fi
  log "[$svc] 되돌린 이미지가 준비되지 않았다. 원래 이미지로 복구한다"
  state_set dev "$tagk=$cur" "${S}_DEV_PREV_TAG=$prev"
  if ! { compose dev up -d --no-deps --force-recreate "$name" >/dev/null && wait_ready "$svc" "$name"; }; then
    log "경고: 복구한 뒤에도 준비되지 않았다"
  fi
  return 1
}

services="be fe"
if [ "$WHICH" != all ]; then services="$WHICH"; fi
failed=0
for svc in $services; do
  if [ "$ENVN" = prod ]; then rollback_color "$svc" || failed=1; else rollback_dev "$svc" || failed=1; fi
done

if [ "$failed" = 0 ]; then
  if [ "$WHICH" = all ]; then
    cur="$(state_get "$ENVN" DEPLOYED_SHA none)"
    prev="$(state_get "$ENVN" PREVIOUS_SHA none)"
    state_set "$ENVN" "DEPLOYED_SHA=$prev" "PREVIOUS_SHA=$cur"
  fi
  notify ok "롤백 완료: $ENVN $WHICH (실행 $WHO). DB 마이그레이션은 되돌리지 않았다"
  log "롤백 완료"
else
  notify fail "롤백 실패: $ENVN $WHICH (실행 $WHO). 지금 상태를 확인한다"
  die "롤백에 실패했다. 실패한 서비스는 지금 상태 그대로다"
fi
````

`infra/deploy/fit-up.sh`:

````bash
#!/usr/bin/env bash
# 호스트를 재부팅했거나 장애를 복구한 뒤 서비스를 순서대로 올린다(설계 10.2절).
#   bash infra/deploy/fit-up.sh
# 순서: 공유 망 → data → edge → app(prod·dev의 활성 색만) → obs → 스모크(실패는 알리기만 한다).
# 아직 없는 프로젝트(data, obs)는 건너뛴다. 이 스크립트는 상태를 바꾸지 않고 멈춘 컨테이너를 올리기만 한다.
# 활성이 아닌 색(이전 배포)은 올리지 않는다. 롤백이 필요하면 rollback.sh를 쓴다.
# 시험 환경은 FIT_EDGE_COMPOSE_ARGS(edgectl.sh와 같다), FIT_NET_PREFIX(networks.sh와 같다), lib.sh의 환경변수를 쓴다.
set -uo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

WARN=0
warn() {
  log "경고: $*"
  WARN=1
}

up_project() { # up_project 이름 compose파일 env파일: 파일이 없으면 건너뛴다
  local name="$1" file="$2" envfile="$3"
  if [ ! -f "$file" ]; then
    log "$name: 건너뜀($file 없음)"
    return 0
  fi
  log "$name: 올린다"
  docker compose -p "fit-$name" -f "$file" --env-file "$envfile" up -d --wait || warn "$name를 올리지 못했다"
}

log "== 공유 Docker 망"
bash "$ROOT_DIR/infra/host/networks.sh" || {
  echo "FAIL 공유 망이 설계와 다르다. 망을 먼저 바로잡는다" >&2
  exit 1
}

log "== data"
up_project data "$ROOT_DIR/infra/data/compose.data.yml" "$ENV_DIR/data.env"

log "== edge"
if [ -n "${FIT_EDGE_COMPOSE_ARGS:-}" ]; then
  read -r -a EDGE_DC <<<"docker compose $FIT_EDGE_COMPOSE_ARGS"
else
  EDGE_DC=(docker compose --env-file "$ENV_DIR/edge.env" -f "$ROOT_DIR/infra/edge/compose.edge.yml")
fi
"${EDGE_DC[@]}" up -d --wait || {
  echo "FAIL 엣지를 올리지 못했다(app은 엣지가 있어야 확인할 수 있다)" >&2
  exit 1
}

log "== app"
for env in prod dev; do
  if [ ! -f "$(state_file "$env")" ]; then
    log "$env: 건너뜀(배포한 적이 없다)"
    continue
  fi
  for svc in be fe; do
    if [ "$env" = prod ]; then
      name="$(svc_name "$svc" prod "$(state_get prod "$(upper "$svc")_ACTIVE" green)")"
      tag="$(state_get prod "$(tag_key "$svc" prod "$(state_get prod "$(upper "$svc")_ACTIVE" green)")" none)"
    else
      name="$(svc_name "$svc" dev)"
      tag="$(state_get dev "$(tag_key "$svc" dev)" none)"
    fi
    if [ "$tag" = none ]; then
      log "$name: 건너뜀(배포한 적이 없다)"
      continue
    fi
    log "$name: 올린다($tag)"
    if compose "$env" up -d --no-deps "$name" >/dev/null && wait_ready "$svc" "$name"; then
      log "$name: 준비됨"
    else
      warn "$name가 준비되지 않았다"
    fi
  done
done

log "== obs"
up_project obs "$ROOT_DIR/infra/obs/compose.obs.yml" "$ENV_DIR/obs.env"

log "== 스모크"
for env in prod dev; do
  if [ ! -f "$(state_file "$env")" ]; then continue; fi
  if bash "$DEPLOY_DIR/smoke.sh" "$env"; then log "$env: 스모크 통과"; else warn "$env 스모크가 실패했다"; fi
done

if [ "$WARN" = 0 ]; then log "모두 올라왔다"; else log "일부에 경고가 있다. 위 로그를 확인한다"; fi
````

- [ ] **Step 2: shellcheck와 입력 거부 확인 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/deploy/rollback.sh infra/deploy/fit-up.sh; echo "shellcheck exit=$?"
bash infra/deploy/rollback.sh nope; echo "exit=$?"
bash infra/deploy/rollback.sh prod sideways; echo "exit=$?"
```

Expected: `shellcheck exit=0`, 나머지 두 명령은 사용법과 `exit=2`

- [ ] **Step 3: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/deploy/rollback.sh infra/deploy/fit-up.sh
git update-index --chmod=+x infra/deploy/rollback.sh infra/deploy/fit-up.sh
git commit -m "feat(infra): 롤백과 재부팅 뒤 기동 순서 스크립트 추가"
```

---

### Task 5: 시험 환경

**목표:** 서버 없이 실제 Caddy와 목 BE·FE 이미지로 배포·롤백·실패 복구·기동 시나리오를 시험한다.

**Files:**
- Create: `infra/deploy/test/mock-be/Dockerfile`, `infra/deploy/test/mock-be/mock_be.py`
- Create: `infra/deploy/test/mock-fe/Dockerfile`, `infra/deploy/test/mock-fe/server.js`
- Create: `infra/deploy/test/compose.sim-edge.yml`, `infra/deploy/test/fake-dump.sh`, `infra/deploy/test/webhook-sink.py`
- Create: `infra/deploy/test/test-deploy.sh`

**Interfaces:**
- `test-deploy.sh up|run|down`: `up`은 가짜 서버 디렉터리(`.tmp-deploytest/`의 env 파일, 상태, 풀, 시험용 git 저장소), 공유 망(`fit-deploytest-net-*`, 1F의 `networks.sh`), 엣지(1C-1의 compose에 포트만 얹는다), 목 이미지를 만든다. `run`은 시나리오를 돌려 `PASS`·`FAIL`을 내고 마지막 줄이 `배포 시험 통과`다. `down`은 시험이 만든 것을 모두 지운다. `run`은 처음 상태에서 한 번만 돌릴 수 있다(상태가 쌓인다). 다시 하려면 `down`, `up` 뒤에 한다
- 목 이미지: BE(python)는 모드 `ok`, `unready`, `proxy-fail`(엣지를 거치면 버전 조회 500), `migrate-fail`, `fallback`(검색에 `X-Fallback`). FE(node)는 모드 `ok`, `broken`, `no-config`, `proxy-fail`. 정적 자산은 `/app/.next/static`에 있고(`app-<sha 7자리>.js`는 릴리스마다 다르고 `shared.js`는 같다) 이미지는 `fit-deploytest/be:<sha>`, `fit-deploytest/fe:<sha>`다
- 시험용 저장소: 커밋 c1~c8과 c1에서 갈라진 s1. c4는 마이그레이션 파일을 더한다. 이미지는 c3=BE 준비 안 됨, c4=FE 엣지 경유 실패, c5=BE 마이그레이션 실패, c7=FE 화면 오류, c8=BE 폴백, 나머지는 정상
- 시험 주소: `https://localhost:18443`(prod), `https://dev.localhost:18443`(dev, 게이트 쿠키)

시험이 확인하는 것:

- 공통 함수와 잠금(살아 있는 pid면 거부, 죽은 pid면 정리), 권한 판정 함수(Linux 컨테이너에서 실제 권한 비트로)
- 사전 점검: 인자 부족, CI 밖 직접 배포 거부, env 파일 없음·자리표시자·다른 환경의 `APP_ENV`·필수 키 누락, prod FE가 dev 내부 리스너를 가리킴, 메모리 부족, 이미지·커밋 없음
- prod: 첫 배포(c1, 사전 덤프와 마이그레이션, 풀, 이력), 두 번째 배포(c2, 반대 색 전환·이전 색 정지·이전 릴리스 자산을 풀에서 계속 서빙·풀 정리·알림), BE 준비 실패(c3, 새 색을 치우고 서비스는 그대로), 엣지 전환 뒤 FE 실패(c4, FE는 이전 색, BE는 새 버전), BE만 롤백, 덤프 실패와 마이그레이션 실패(c5, 서비스는 그대로·잠금이 남지 않음), 정상 배포(c6)와 전체 롤백, 다운그레이드 가드(오래된 커밋과 갈라진 커밋 거부), `SKIP_VERIFY`로 CI 밖 배포와 이력 기록
- dev: 첫 배포, 교체, FE 화면 오류(c7)는 직전 이미지로 복귀, 검색 폴백(c8)은 스모크가 잡아 복귀, 롤백, 게이트 쿠키 없이는 404
- `fit-up.sh`: 컨테이너를 모두 멈춘 뒤 올리면 엣지와 활성 색이 전과 같은 버전으로 응답하고 활성이 아닌 색은 멈춘 채이며 data·obs는 건너뛴다
- 위생: 출력과 알림에 dev 게이트 키가 없다, 메모리·CPU 한도와 읽기 전용 루트가 걸려 있다, 앱 컨테이너가 게시한 포트가 없다

- [ ] **Step 1: 목 BE 작성**

`infra/deploy/test/mock-be/Dockerfile`:

````dockerfile
FROM python:3.12.15-slim
ARG SHA
ARG MODE=ok
ENV MOCK_SHA=$SHA MOCK_MODE=$MODE
COPY mock_be.py /app/mock_be.py
CMD ["python", "/app/mock_be.py"]
````

`infra/deploy/test/mock-be/mock_be.py`:

````python
"""시험용 목 BE(infra/deploy/test). 이미지를 만들 때 정한 MOCK_SHA와 MOCK_MODE로 동작한다.

모드
  ok            정상
  unready       준비 상태가 UP이 되지 않는다(배포가 새 색을 치워야 한다)
  proxy-fail    엣지(X-Forwarded-For가 붙은 요청)를 거치면 버전 조회가 500이다(엣지 전환 뒤 확인이 실패해야 한다)
  migrate-fail  마이그레이션 컨테이너(SPRING_PROFILES_ACTIVE=migrate)가 실패한다
  fallback      검색 응답에 X-Fallback 헤더를 붙인다(Modal 폴백 표시, BE 계약 #17)
SPRING_PROFILES_ACTIVE=migrate이면 서버를 띄우지 않고 마이그레이션을 흉내 낸 뒤 끝난다(BE 계약 #9).
공개 포트 8080(/healthz, /api/v1/version, /api/v1/search), 관리 포트 8081(/actuator/health/readiness).
"""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SHA = os.environ["MOCK_SHA"]
MODE = os.environ.get("MOCK_MODE", "ok")

if os.environ.get("SPRING_PROFILES_ACTIVE") == "migrate":
    if MODE == "migrate-fail":
        print("migration failed", file=sys.stderr)
        sys.exit(1)
    print("migrated")
    sys.exit(0)


class Base(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def reply(self, status, body, ctype="text/plain; charset=utf-8", headers=()):
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for key, value in headers:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass


class App(Base):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/healthz":
            self.reply(200, "ok")
        elif path == "/api/v1/version":
            if MODE == "proxy-fail" and self.headers.get("X-Forwarded-For"):
                self.reply(500, "proxy-fail")
            else:
                self.reply(200, json.dumps({"sha": SHA, "builtAt": "2026-10-20T00:00:00Z"}), "application/json", [("X-App-Version", SHA)])
        elif path == "/api/v1/search":
            headers = [("X-Fallback", "modal-disabled")] if MODE == "fallback" else []
            self.reply(200, "[]", "application/json", headers)
        else:
            self.reply(404, "not found")


class Management(Base):
    def do_GET(self):
        if self.path.split("?", 1)[0] == "/actuator/health/readiness":
            if MODE == "unready":
                self.reply(503, '{"status":"OUT_OF_SERVICE"}', "application/json")
            else:
                self.reply(200, '{"status":"UP"}', "application/json")
        else:
            self.reply(404, "not found")


threading.Thread(target=ThreadingHTTPServer(("", 8081), Management).serve_forever, daemon=True).start()
ThreadingHTTPServer(("", 8080), App).serve_forever()
````

- [ ] **Step 2: 목 FE 작성**

`infra/deploy/test/mock-fe/Dockerfile`:

````dockerfile
FROM node:22-alpine
ARG SHA
ARG MODE=ok
ENV MOCK_SHA=$SHA MOCK_MODE=$MODE
WORKDIR /app
COPY server.js /app/server.js
# 실제 FE 이미지처럼 정적 자산이 /app/.next/static에 있다. app-<sha 7자리>.js는 릴리스마다 다르고 shared.js는 모든 릴리스가 같다
RUN mkdir -p .next/static/chunks \
 && echo "// app $SHA" > ".next/static/chunks/app-$(printf '%.7s' "$SHA").js" \
 && echo "// shared" > .next/static/chunks/shared.js
CMD ["node", "server.js"]
````

`infra/deploy/test/mock-fe/server.js`:

````javascript
// 시험용 목 FE(infra/deploy/test). Next.js standalone의 `node server.js`를 흉내 낸다(포트 3000).
// 모드(MOCK_MODE): ok, broken(첫 화면이 500), no-config(/config.json에 env가 없다), proxy-fail(엣지를 거치면 첫 화면이 500)
// 정적 자산은 /app/.next/static에서 준다. 풀에 없는 자산을 FE가 대신 응답하는 경로를 시험한다.
const http = require('http');
const fs = require('fs');
const path = require('path');

const SHA = process.env.MOCK_SHA;
const MODE = process.env.MOCK_MODE || 'ok';
const APP_ENV = process.env.APP_ENV || 'dev';
const SHORT = SHA.slice(0, 7);
const STATIC_ROOT = '/app/.next/static';

http
  .createServer((req, res) => {
    const url = req.url.split('?')[0];
    const send = (code, body, type = 'text/plain; charset=utf-8', headers = {}) => {
      res.writeHead(code, { 'Content-Type': type, ...headers });
      res.end(body);
    };
    if (url === '/fe-healthz') return send(200, 'ok');
    if (url === '/config.json') {
      return send(200, MODE === 'no-config' ? '{}' : JSON.stringify({ env: APP_ENV }), 'application/json');
    }
    if (url.startsWith('/_next/static/')) {
      const file = path.join(STATIC_ROOT, url.slice('/_next/static/'.length));
      if (!file.startsWith(STATIC_ROOT)) return send(404, 'not found');
      return fs.readFile(file, (err, data) =>
        err
          ? send(404, 'not found')
          : send(200, data, 'text/javascript', { 'Cache-Control': 'public, max-age=31536000, immutable' }),
      );
    }
    if (url === '/') {
      if (MODE === 'broken') return send(500, 'broken');
      if (MODE === 'proxy-fail' && req.headers['x-forwarded-proto']) return send(500, 'proxy-fail');
      return send(
        200,
        `<!doctype html><html><head><script src="/_next/static/chunks/app-${SHORT}.js"></script><script src="/_next/static/chunks/shared.js"></script></head><body>mock-fe ${SHA} ${APP_ENV}</body></html>`,
        'text/html; charset=utf-8',
        { 'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate' },
      );
    }
    return send(404, 'not found');
  })
  .listen(3000, '0.0.0.0');

process.on('SIGTERM', () => process.exit(0));
````

- [ ] **Step 3: 엣지 오버라이드와 대역 작성**

`infra/deploy/test/compose.sim-edge.yml`:

````yaml
# 배포 시험(test-deploy.sh)에서 엣지를 노트북의 127.0.0.1 높은 포트에 게시하는 오버라이드다. compose.edge.yml 위에 얹는다.
services:
  caddy:
    ports: !override
      - 127.0.0.1:${FIT_DEPLOY_TEST_HTTP_PORT:-18080}:80
      - 127.0.0.1:${FIT_DEPLOY_TEST_HTTPS_PORT:-18443}:443
````

`infra/deploy/test/fake-dump.sh`: 마이그레이션 전 덤프의 대역이다(진짜는 계획 1D).

````bash
#!/usr/bin/env bash
# 시험용 마이그레이션 전 덤프(infra/backup/pg-backup.sh의 대역, 계획 1D가 진짜를 만든다). 인자: predeploy <환경> <sha>
# FAKE_DUMP_FAIL=1이면 실패한다. 덤프 대신 인자를 적은 파일을 $FIT_BACKUP_DIR에 남긴다.
set -eu
if [ "${FAKE_DUMP_FAIL:-0}" = 1 ]; then
  echo "시험용 덤프 실패" >&2
  exit 1
fi
mkdir -p "${FIT_BACKUP_DIR:?}"
echo "$*" >"$FIT_BACKUP_DIR/predeploy-$2-$3.dump"
````

`infra/deploy/test/webhook-sink.py`: Mattermost 웹훅의 대역이다.

````python
"""시험용 Mattermost 웹훅 대역(infra/deploy/test). POST 본문을 파일에 한 줄씩 적는다.

사용: python webhook-sink.py <포트> <출력 파일>
"""
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

port, out = int(sys.argv[1]), sys.argv[2]


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8", errors="replace")
        with open(out, "a", encoding="utf-8") as f:
            f.write(body + "\n")
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, fmt, *args):
        pass


HTTPServer(("127.0.0.1", port), Handler).serve_forever()
````

- [ ] **Step 4: 시험 스크립트 작성**

````bash
#!/usr/bin/env bash
# 배포 스크립트를 노트북에서 시험한다(설계 10.5절). 실제 Caddy와 목 BE·FE 이미지로 서버 A를 흉내 낸다.
#   bash infra/deploy/test/test-deploy.sh up     # 가짜 서버 디렉터리, 공유 망, 엣지, 시험용 저장소와 목 이미지를 만든다
#   bash infra/deploy/test/test-deploy.sh run    # 배포·롤백·실패 복구·기동 시나리오를 돌린다
#   bash infra/deploy/test/test-deploy.sh down   # 시험이 만든 컨테이너, 이미지, 망, 디렉터리를 지운다
# 필요한 것: docker compose(2.24 이상), curl, git, python 3.9 이상. 시험용 이름은 접두사 fit-deploytest로 시작한다.
# 시험용 서버는 저장소 안의 .tmp-deploytest/에 있다(env 파일, 상태, 정적 자산 풀, 시험용 git 저장소).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
W="$(pwd -W 2>/dev/null || pwd)"
T="$W/.tmp-deploytest"
PREFIX=fit-deploytest-
HTTPS_PORT=18443
# 시험용 값이다. 엔트로피가 낮은 값이라 시크릿 검사에 걸리지 않는다
KEY="local-test-dev-gate-key-aaaaaaaaaaaaaaaaaaaa"

# 서버에서는 기본값을 쓰는 경로와 이름을 시험용으로 바꾼다
export FIT_ENV_DIR="$T/etc" FIT_STATE_DIR="$T/state" FIT_WEB_DIR="$T/web" FIT_BACKUP_DIR="$T/backups" FIT_REPO_DIR="$T/repo"
export FIT_NET_PREFIX="$PREFIX" FIT_NET_EDGE="${PREFIX}net-edge" FIT_NET_PROD="${PREFIX}net-prod" FIT_NET_DEV="${PREFIX}net-dev"
export FIT_NET_DATA="${PREFIX}net-data" FIT_NET_OBS="${PREFIX}net-obs"
export FIT_BE_IMAGE=fit-deploytest/be FIT_FE_IMAGE=fit-deploytest/fe FIT_EDGE_PROJECT=fit-deploytest-edge
export FIT_EDGE_COMPOSE_ARGS="-p $FIT_EDGE_PROJECT -f $W/infra/edge/compose.edge.yml -f $W/infra/deploy/test/compose.sim-edge.yml"
export FIT_DEPLOY_TEST_HTTPS_PORT="$HTTPS_PORT"
export PROD_HOST=localhost DEV_HOST=dev.localhost ACME_EMAIL=ops@example.test ACME_MODE=production HSTS_MODE=off DEV_GATE_KEY="$KEY"
export FIT_EDGE_ENV="$T/etc/edge.env" FIT_SMOKE_PORT="$HTTPS_PORT" FIT_SMOKE_INSECURE=1 FIT_SMOKE_RETRIES=3
export FIT_SMOKE_SEARCH_PATH="/api/v1/search?q=a"
export FIT_DRAIN_SECONDS=1 FIT_BE_READY_TIMEOUT=40 FIT_FE_READY_TIMEOUT=30
export FIT_MEM_AVAILABLE_MB=8000 FIT_SKIP_PERM=1 FIT_PREDEPLOY_DUMP="$ROOT/infra/deploy/test/fake-dump.sh"
export FIT_NOTIFY_WEBHOOK=http://127.0.0.1:18099/hook

PY=""
for c in "${PYTHON:-}" python3 python; do
  [ -n "$c" ] || continue
  if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
    PY="$c"
    break
  fi
done
[ -n "$PY" ] || {
  echo "python 3.9 이상이 필요하다 (PYTHON=경로 로 지정할 수 있다)" >&2
  exit 2
}

dc_edge() {
  local -a args
  read -r -a args <<<"docker compose $FIT_EDGE_COMPOSE_ARGS"
  "${args[@]}" "$@"
}

# 시험용 git 저장소: c1~c8과 c1에서 갈라진 s1. c4는 마이그레이션 파일을 더한다
make_repo() {
  rm -rf "$T/repo"
  mkdir -p "$T/repo/be/src/main/resources/db/migration"
  git -C "$T/repo" init -q -b main
  git -C "$T/repo" config user.email t@t.t
  git -C "$T/repo" config user.name t
  git -C "$T/repo" config commit.gpgsign false
  git -C "$T/repo" config core.autocrlf false
  echo "create table a();" >"$T/repo/be/src/main/resources/db/migration/V1__init.sql"
  git -C "$T/repo" add -A
  git -C "$T/repo" commit -q -m c1
  local n
  for n in 2 3; do git -C "$T/repo" commit -q --allow-empty -m "c$n"; done
  echo "alter table a add column b int;" >"$T/repo/be/src/main/resources/db/migration/V2__b.sql"
  git -C "$T/repo" add -A
  git -C "$T/repo" commit -q -m c4
  for n in 5 6 7 8; do git -C "$T/repo" commit -q --allow-empty -m "c$n"; done
  git -C "$T/repo" checkout -q -b side "$(git -C "$T/repo" rev-list --max-parents=0 HEAD)"
  git -C "$T/repo" commit -q --allow-empty -m s1
  git -C "$T/repo" checkout -q main
  {
    for n in 1 2 3 4 5 6 7 8; do echo "C$n=$(git -C "$T/repo" rev-parse "main~$((8 - n))")"; done
    echo "S1=$(git -C "$T/repo" rev-parse side)"
  } >"$T/shas.env"
}

# 예제 env 파일에서 시험용 env 파일을 만든다. 자리표시자를 채우고 환경 이름을 맞춘다
make_envs() {
  mkdir -p "$T/etc"
  local env
  for env in prod dev; do
    sed -e 's/REPLACE_ME/test-value/' -e "s/dev/$env/g" infra/app/app.env.example >"$T/etc/$env.env"
    sed -e 's/REPLACE_ME/test-value/' -e "s/dev/$env/g" -e "s/8082/$([ "$env" = prod ] && echo 8081 || echo 8082)/" infra/app/fe.env.example >"$T/etc/fe-$env.env"
    sed -e 's/REPLACE_ME/test-value/' -e "s/dev/$env/g" infra/app/migrate.env.example >"$T/etc/migrate-$env.env"
    chmod 640 "$T/etc/$env.env" "$T/etc/fe-$env.env" "$T/etc/migrate-$env.env"
  done
  # migrate 프로필 이름은 환경과 상관없이 migrate다
  sed -i 's/^SPRING_PROFILES_ACTIVE=.*/SPRING_PROFILES_ACTIVE=migrate/' "$T/etc/migrate-prod.env" "$T/etc/migrate-dev.env"
  printf 'PROD_HOST=%s\nDEV_HOST=%s\nACME_EMAIL=%s\nACME_MODE=%s\nHSTS_MODE=%s\nDEV_GATE_KEY=%s\n' \
    "$PROD_HOST" "$DEV_HOST" "$ACME_EMAIL" "$ACME_MODE" "$HSTS_MODE" "$DEV_GATE_KEY" >"$T/etc/edge.env"
}

build_images() { # build_images sha BE모드 FE모드
  docker build -q -t "$FIT_BE_IMAGE:$1" --build-arg "SHA=$1" --build-arg "MODE=$2" infra/deploy/test/mock-be >/dev/null
  docker build -q -t "$FIT_FE_IMAGE:$1" --build-arg "SHA=$1" --build-arg "MODE=$3" infra/deploy/test/mock-fe >/dev/null
}

up() {
  down >/dev/null 2>&1 || true
  mkdir -p "$T/state" "$T/web" "$T/backups"
  make_repo
  make_envs
  # shellcheck source=/dev/null
  . "$T/shas.env"
  bash infra/host/networks.sh
  # 엣지의 첫 상태 파일은 견본 그대로다(prod는 blue, dev는 be-dev·fe-dev를 가리킨다)
  cp infra/edge/state-sample/upstream-*.caddy "$T/state/"
  dc_edge up -d --wait
  build_images "$C1" ok ok
  build_images "$C2" ok ok
  build_images "$C3" unready ok
  build_images "$C4" ok proxy-fail
  build_images "$C5" migrate-fail ok
  build_images "$C6" ok ok
  build_images "$C7" ok broken
  build_images "$C8" fallback ok
  build_images "$S1" ok ok
  echo "배포 시험 환경이 떴다: https://$PROD_HOST:$HTTPS_PORT (prod), https://$DEV_HOST:$HTTPS_PORT (dev)"
}

down() {
  local c n
  for c in be-prod-blue be-prod-green fe-prod-blue fe-prod-green be-dev fe-dev; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  dc_edge down -v >/dev/null 2>&1 || true
  docker rm -f fit-migrate-prod fit-migrate-dev >/dev/null 2>&1 || true
  for r in "$FIT_BE_IMAGE" "$FIT_FE_IMAGE"; do
    docker image ls "$r" -q 2>/dev/null | sort -u | xargs -r docker image rm -f >/dev/null 2>&1 || true
  done
  for n in net-edge net-prod net-dev net-data net-obs net-dbaccess; do docker network rm "$PREFIX$n" >/dev/null 2>&1 || true; done
  if [ -f "$T/sink.pid" ]; then kill "$(cat "$T/sink.pid")" >/dev/null 2>&1 || true; fi
  rm -rf "$T"
  echo "정리했다"
}

# ---- 시나리오 ----------------------------------------------------------------
FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); if [ -n "${out:-}" ]; then printf '%s\n' "$out" | tail -n 8 | sed 's/^/FAIL  > /'; fi; }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }
is() { if [ "$1" = "$2" ]; then echo 1; else echo 0; fi; }
has() { case "$1" in *"$2"*) echo 1 ;; *) echo 0 ;; esac; }

PROD="https://$PROD_HOST:$HTTPS_PORT"
DEVU="https://$DEV_HOST:$HTTPS_PORT"
RESOLVE=(--resolve "$PROD_HOST:$HTTPS_PORT:127.0.0.1" --resolve "$DEV_HOST:$HTTPS_PORT:127.0.0.1")
# Docker Desktop(Windows)의 포트 포워더는 새 연결을 간헐적으로 거부한다(Caddy 쪽 원인이 아니다). 연결 실패(종료 코드 7)만 다시 시도한다
curl_retry() {
  local rc=0 _
  for _ in 1 2 3 4; do
    curl -sk --max-time 30 "${RESOLVE[@]}" "$@" && return 0
    rc=$?
    [ "$rc" = 7 ] || return "$rc"
    sleep 1
  done
  return "$rc"
}
sha_of() { sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p'; }
be_sha() { curl_retry "$PROD/api/v1/version" | sha_of; }
fe_sha() { curl_retry "$PROD/" | sed -n 's/.*mock-fe \([0-9a-f]*\) prod.*/\1/p'; }
dev_be_sha() { curl_retry -b "fit_dev=$KEY" "$DEVU/api/v1/version" | sha_of; }
dev_fe_sha() { curl_retry -b "fit_dev=$KEY" "$DEVU/" | sed -n 's/.*mock-fe \([0-9a-f]*\) dev.*/\1/p'; }
# 상태 코드만 본다(Git Bash의 Windows용 curl은 -o /dev/null이 쓰기 오류를 낸다)
code_of() { curl_retry -o "$T/code.out" -w '%{http_code}' "$@" 2>/dev/null || true; }
# 컨테이너 상태: true, false 또는 없으면 missing(Windows의 docker inspect는 없는 컨테이너에도 빈 줄을 출력한다)
running() {
  local r
  r="$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null | tr -d '\r\n')"
  echo "${r:-missing}"
}
st() { state_get "$@"; } # st 환경 키
OUT_ALL=""

run_deploy() { # run_deploy 인자...: out, rc를 채운다. CI=true로 돌린다
  out="$(CI=true bash infra/deploy/deploy.sh "$@" 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
}

run_unit_checks() {
  echo "--- 공통 함수"
  ok_if "sha_match: 앞부분이 같으면 같은 커밋이다" "$(sha_match abc1234 abc1234567 && echo 1 || echo 0)"
  ok_if "sha_match: 다르면 다르다" "$(sha_match abc1234 def1234567 && echo 0 || echo 1)"
  ok_if "sha_match: 7자 미만은 거부한다" "$(sha_match abc123 abc1234567 && echo 0 || echo 1)"
  ok_if "json_string: 키의 값을 뽑는다" "$(is "$(json_string sha '{"sha": "ab12", "x": "y"}')" ab12)"
  state_set prod DEMO_KEY=one OTHER=2
  state_set prod DEMO_KEY=two
  ok_if "state_set: 같은 키는 나중 값이 이기고 다른 키는 남는다" "$(is "$(st prod DEMO_KEY)$(st prod OTHER)" two2)"
  rm -f "$FIT_STATE_DIR/deploy-prod.env"
  ok_if "migrations_changed: 마이그레이션 파일이 바뀐 구간과 첫 배포만 참이다" \
    "$(is "$(migrations_changed "$C1" "$C2" && echo 0 || echo 1)$(migrations_changed "$C2" "$C4" && echo 1 || echo 0)$(migrations_changed none "$C1" && echo 1 || echo 0)" 111)"
  echo "--- 잠금"
  mkdir -p "$FIT_STATE_DIR/deploy-prod.lock"
  sleep 60 &
  local live=$!
  echo "$live" >"$FIT_STATE_DIR/deploy-prod.lock/pid"
  out="$(bash -c ". infra/deploy/lib.sh; acquire_lock prod" 2>&1)" && rc=0 || rc=$?
  ok_if "살아 있는 프로세스가 쥔 잠금이 있으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '다른 배포가 돌고 있다')" = 1 ] && echo 1 || echo 0)"
  kill "$live" 2>/dev/null || true
  echo 99999999 >"$FIT_STATE_DIR/deploy-prod.lock/pid"
  out="$(bash -c ". infra/deploy/lib.sh; acquire_lock prod; echo got" 2>&1)" && rc=0 || rc=$?
  ok_if "프로세스가 죽어 남은 잠금은 지우고 새로 잡는다" "$([ "$rc" = 0 ] && [ "$(has "$out" got)" = 1 ] && echo 1 || echo 0)"
  rm -rf "$FIT_STATE_DIR/deploy-prod.lock"
  echo "--- 파일 권한 점검(Linux 컨테이너에서 실제 권한 비트로 확인한다)"
  out="$(docker run --rm -v "$W/infra/deploy:/d:ro" ubuntu:24.04 bash -c '
    . /d/lib.sh
    cp /d/lib.sh /tmp/a; chmod 640 /tmp/a; mode_is_private /tmp/a && echo "640:private"
    chmod 600 /tmp/a; mode_is_private /tmp/a && echo "600:private"
    chmod 644 /tmp/a; mode_is_private /tmp/a || echo "644:open"
    chmod 660 /tmp/a; mode_is_private /tmp/a && echo "660:private"
    chmod 604 /tmp/a; mode_is_private /tmp/a || echo "604:open"' 2>&1)"
  ok_if "mode_is_private: 640·600·660은 통과하고 644·604는 거부한다" \
    "$([ "$(has "$out" 640:private)$(has "$out" 600:private)$(has "$out" 660:private)$(has "$out" 644:open)$(has "$out" 604:open)" = 11111 ] && echo 1 || echo 0)"
}

run_guard_checks() {
  echo "--- 입력과 사전 점검"
  # shellcheck source=/dev/null
  . "$T/shas.env"
  out="$(bash infra/deploy/deploy.sh prod 2>&1)" && rc=0 || rc=$?
  ok_if "인자가 모자라면 종료 코드 2다" "$(is "$rc" 2)"
  out="$(bash infra/deploy/deploy.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "CI 밖에서 SKIP_VERIFY 없이 직접 배포하면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" SKIP_VERIFY)" = 1 ] && echo 1 || echo 0)"
  out="$(bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "정상 상태에서 사전 점검이 통과한다" "$(is "$rc" 0)"
  mv "$T/etc/prod.env" "$T/prod.env.bak"
  out="$(bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "env 파일이 없으면 사전 점검이 실패한다" "$([ "$rc" = 1 ] && [ "$(has "$out" 'FAIL  prod.env: 파일이 없다')" = 1 ] && echo 1 || echo 0)"
  mv "$T/prod.env.bak" "$T/etc/prod.env"
  cp "$T/etc/prod.env" "$T/prod.env.bak"
  sed -i 's/^JWT_SECRET=.*/JWT_SECRET=REPLACE_ME/' "$T/etc/prod.env"
  out="$(bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "자리표시자(REPLACE_ME)가 남아 있으면 사전 점검이 실패한다" "$([ "$rc" = 1 ] && [ "$(has "$out" '자리표시자')" = 1 ] && echo 1 || echo 0)"
  cp "$T/prod.env.bak" "$T/etc/prod.env"
  sed -i 's/^APP_ENV=.*/APP_ENV=dev/' "$T/etc/prod.env"
  out="$(bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "prod 파일에 APP_ENV=dev가 있으면 사전 점검이 실패한다(환경이 섞이지 않게)" "$([ "$rc" = 1 ] && [ "$(has "$out" 'FAIL  prod.env: APP_ENV가 prod이다')" = 1 ] && echo 1 || echo 0)"
  cp "$T/prod.env.bak" "$T/etc/prod.env"
  sed -i '/^JWT_SECRET=/d' "$T/etc/prod.env"
  out="$(bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "필수 키가 빠지면 사전 점검이 실패한다" "$([ "$rc" = 1 ] && [ "$(has "$out" 'FAIL  prod.env: 형식과 필수 키')" = 1 ] && echo 1 || echo 0)"
  cp "$T/prod.env.bak" "$T/etc/prod.env"
  rm -f "$T/prod.env.bak"
  cp "$T/etc/fe-prod.env" "$T/fe-prod.env.bak"
  sed -i 's/^BE_INTERNAL_URL=.*/BE_INTERNAL_URL=http:\/\/caddy:8082/' "$T/etc/fe-prod.env"
  out="$(bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "prod의 FE가 dev 내부 리스너(8082)를 가리키면 사전 점검이 실패한다(환경이 섞이지 않게)" "$([ "$rc" = 1 ] && [ "$(has "$out" 'FAIL  fe-prod.env: BE_INTERNAL_URL')" = 1 ] && echo 1 || echo 0)"
  cp "$T/fe-prod.env.bak" "$T/etc/fe-prod.env"
  rm -f "$T/fe-prod.env.bak"
  out="$(FIT_MEM_AVAILABLE_MB=100 bash infra/deploy/preflight.sh prod "$C1" 2>&1)" && rc=0 || rc=$?
  ok_if "메모리 여유가 모자라면 사전 점검이 실패한다" "$([ "$rc" = 1 ] && [ "$(has "$out" 'FAIL  메모리 여유')" = 1 ] && echo 1 || echo 0)"
  out="$(bash infra/deploy/preflight.sh prod aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2>&1)" && rc=0 || rc=$?
  ok_if "이미지나 커밋이 없는 SHA는 사전 점검이 실패한다" "$([ "$rc" = 1 ] && [ "$(has "$out" 'FAIL  이미지')" = 1 ] && [ "$(has "$out" 'FAIL  저장소에 커밋')" = 1 ] && echo 1 || echo 0)"
}

run_prod_checks() {
  echo "--- prod 첫 배포(c1)"
  # shellcheck source=/dev/null
  . "$T/shas.env"
  run_deploy prod "$C1"
  ok_if "첫 배포가 성공한다" "$(is "$rc" 0)"
  ok_if "엣지 경유 BE 버전과 FE 페이지가 c1이다" "$(is "$(be_sha)$(fe_sha)" "$C1$C1")"
  ok_if "blue만 떠 있고 green은 만들어지지 않았다" "$(is "$(running be-prod-blue)$(running fe-prod-blue)$(running be-prod-green)" truetruemissing)"
  ok_if "상태: 활성 blue, 배포한 SHA c1" "$(is "$(st prod BE_ACTIVE)$(st prod FE_ACTIVE)$(st prod DEPLOYED_SHA)" "blueblue$C1")"
  ok_if "마이그레이션 전 사전 덤프가 실행됐다(첫 배포)" "$([ -f "$FIT_BACKUP_DIR/predeploy-prod-$C1.dump" ] && echo 1 || echo 0)"
  ok_if "정적 자산 풀에 c1의 자산과 공용 자산이 쌓였다" \
    "$([ -f "$FIT_WEB_DIR/prod/pool/_next/static/chunks/app-${C1:0:7}.js" ] && [ -f "$FIT_WEB_DIR/prod/pool/_next/static/chunks/shared.js" ] && echo 1 || echo 0)"
  ok_if "이력에 배포 시작·전환·끝이 남았다" \
    "$([ "$(grep -c "deploy-start all $C1" "$FIT_STATE_DIR/history-prod.log")" = 1 ] && [ "$(grep -c "switch be $C1 blue" "$FIT_STATE_DIR/history-prod.log")" = 1 ] && [ "$(grep -c "deploy-end all $C1 ok" "$FIT_STATE_DIR/history-prod.log")" = 1 ] && echo 1 || echo 0)"

  echo "--- prod 두 번째 배포(c2): 반대 색으로 전환"
  # 정리 시험: 오래된 풀 파일은 지워지고 이번 릴리스가 가진 공용 자산은 남는다
  echo "// stale" >"$FIT_WEB_DIR/prod/pool/_next/static/chunks/stale.js"
  touch -d '40 days ago' "$FIT_WEB_DIR/prod/pool/_next/static/chunks/stale.js"
  run_deploy prod "$C2"
  ok_if "두 번째 배포가 성공한다" "$(is "$rc" 0)"
  ok_if "엣지 경유 BE와 FE가 c2다" "$(is "$(be_sha)$(fe_sha)" "$C2$C2")"
  ok_if "green이 새 색이고 blue(c1)는 멈췄다(컨테이너는 남아 있다)" \
    "$(is "$(running be-prod-green)$(running fe-prod-green)$(running be-prod-blue)$(running fe-prod-blue)" truetruefalsefalse)"
  ok_if "상태: 활성 green, 이전 SHA c1" "$(is "$(st prod BE_ACTIVE)$(st prod FE_ACTIVE)$(st prod DEPLOYED_SHA)$(st prod PREVIOUS_SHA)" "greengreen$C2$C1")"
  ok_if "마이그레이션 변경이 없으면 사전 덤프를 만들지 않는다" "$([ ! -e "$FIT_BACKUP_DIR/predeploy-prod-$C2.dump" ] && echo 1 || echo 0)"
  ok_if "누적 풀: 이전 릴리스(c1)의 해시 자산을 Caddy가 계속 준다(열려 있는 탭이 404를 만나지 않는다)" \
    "$(is "$(code_of "$PROD/_next/static/chunks/app-${C1:0:7}.js")$(code_of "$PROD/_next/static/chunks/app-${C2:0:7}.js")" 200200)"
  ok_if "풀 정리: 오래된 파일은 지우고 공용 자산(shared.js)은 남긴다" \
    "$([ ! -e "$FIT_WEB_DIR/prod/pool/_next/static/chunks/stale.js" ] && [ -f "$FIT_WEB_DIR/prod/pool/_next/static/chunks/shared.js" ] && echo 1 || echo 0)"
  ok_if "알림: 배포 완료 메시지가 웹훅으로 갔다" "$(has "$(cat "$T/webhook.log" 2>/dev/null)" '배포 완료: prod')"

  echo "--- BE가 준비되지 않는 배포(c3): 트래픽을 옮기지 않고 치운다"
  run_deploy prod "$C3"
  ok_if "배포가 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '새 색')" = 1 ] && echo 1 || echo 0)"
  ok_if "서비스는 c2 그대로다" "$(is "$(be_sha)$(fe_sha)" "$C2$C2")"
  ok_if "새 색 컨테이너를 치웠고 상태의 태그를 되돌렸다" "$(is "$(running be-prod-blue)$(st prod BE_BLUE_TAG)$(st prod BE_ACTIVE)" "missing${C1}green")"
  ok_if "알림: 배포 실패 메시지가 웹훅으로 갔다" "$(has "$(cat "$T/webhook.log" 2>/dev/null)" '배포 실패: prod')"

  echo "--- 엣지 전환 뒤 FE 확인이 실패하는 배포(c4): FE는 이전 색으로 돌아간다"
  run_deploy prod "$C4"
  ok_if "배포가 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '엣지 전환 뒤 확인에 실패')" = 1 ] && echo 1 || echo 0)"
  ok_if "마이그레이션이 있어 사전 덤프와 마이그레이션을 먼저 실행했다" "$([ -f "$FIT_BACKUP_DIR/predeploy-prod-$C4.dump" ] && [ "$(has "$out" '마이그레이션 실행')" = 1 ] && echo 1 || echo 0)"
  ok_if "BE는 c4로 전환됐고 FE는 c2로 돌아왔다(새 BE는 이전 FE와 호환돼야 한다)" "$(is "$(be_sha)$(fe_sha)" "$C4$C2")"
  ok_if "상태: BE blue, FE green, 마지막 완전한 배포 SHA는 c2" "$(is "$(st prod BE_ACTIVE)$(st prod FE_ACTIVE)$(st prod DEPLOYED_SHA)" "bluegreen$C2")"
  ok_if "실패한 FE 새 색 컨테이너를 치웠다" "$(is "$(running fe-prod-blue)" missing)"

  echo "--- 롤백: BE만 이전 색으로"
  out="$(bash infra/deploy/rollback.sh prod be 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "롤백이 성공한다" "$(is "$rc" 0)"
  ok_if "BE가 c2로 돌아왔고 FE는 그대로다" "$(is "$(be_sha)$(fe_sha)" "$C2$C2")"
  ok_if "상태: BE green, 이력에 롤백이 남았다" "$([ "$(st prod BE_ACTIVE)" = green ] && [ "$(grep -c "rollback be $C2 green" "$FIT_STATE_DIR/history-prod.log")" = 1 ] && echo 1 || echo 0)"

  echo "--- 사전 덤프 실패와 마이그레이션 실패(c5): 트래픽을 건드리기 전에 멈춘다"
  out="$(FAKE_DUMP_FAIL=1 CI=true bash infra/deploy/deploy.sh prod "$C5" 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "사전 덤프가 실패하면 배포가 멈춘다" "$([ "$rc" != 0 ] && [ "$(has "$out" '사전 덤프에 실패')" = 1 ] && echo 1 || echo 0)"
  run_deploy prod "$C5"
  ok_if "마이그레이션이 실패하면 배포가 멈춘다" "$([ "$rc" != 0 ] && [ "$(has "$out" '마이그레이션에 실패')" = 1 ] && echo 1 || echo 0)"
  ok_if "두 경우 모두 서비스는 c2 그대로다" "$(is "$(be_sha)$(fe_sha)" "$C2$C2")"
  ok_if "배포 잠금이 남지 않았다" "$([ ! -e "$FIT_STATE_DIR/deploy-prod.lock" ] && echo 1 || echo 0)"

  echo "--- 정상 배포(c6)와 전체 롤백"
  run_deploy prod "$C6"
  ok_if "배포가 성공한다" "$(is "$rc" 0)"
  ok_if "엣지 경유 BE와 FE가 c6이고 상태의 이전 SHA는 c2다" "$(is "$(be_sha)$(fe_sha)$(st prod DEPLOYED_SHA)$(st prod PREVIOUS_SHA)" "$C6$C6$C6$C2")"
  ok_if "검색 폴백 점검이 통과했다(X-Fallback 없음)" "$(has "$out" 'BE: 검색이 폴백으로 처리되지 않았다')"
  out="$(bash infra/deploy/rollback.sh prod 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "rollback.sh prod가 성공한다" "$(is "$rc" 0)"
  ok_if "BE와 FE가 c2로 돌아오고 상태의 배포 SHA도 c2다" "$(is "$(be_sha)$(fe_sha)$(st prod DEPLOYED_SHA)" "$C2$C2$C2")"

  echo "--- 다운그레이드 가드와 재배포"
  run_deploy prod "$C1"
  ok_if "현재(c2)보다 오래된 커밋은 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" '다운그레이드가 아니다')" = 1 ] && [ "$(has "$out" 'FAIL')" = 1 ] && echo 1 || echo 0)"
  run_deploy prod "$S1"
  ok_if "현재의 후손이 아닌 커밋(다른 갈래)도 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  ok_if "거부한 배포는 서비스를 건드리지 않았다" "$(is "$(be_sha)$(fe_sha)" "$C2$C2")"
  out="$(env -u CI SKIP_VERIFY='시험용 긴급 배포' bash infra/deploy/deploy.sh prod "$C6" 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "SKIP_VERIFY 사유를 주면 CI 밖에서도 배포하고 이력에 사유가 남는다" \
    "$([ "$rc" = 0 ] && [ "$(be_sha)$(fe_sha)" = "$C6$C6" ] && grep -q 'skip-verify:시험용 긴급 배포' "$FIT_STATE_DIR/history-prod.log" && echo 1 || echo 0)"
}

run_dev_checks() {
  echo "--- dev: 단일 색 교체와 직전 이미지 복귀"
  # shellcheck source=/dev/null
  . "$T/shas.env"
  run_deploy dev "$C1"
  ok_if "dev 첫 배포가 성공한다(게이트 쿠키로 접속)" "$([ "$rc" = 0 ] && [ "$(dev_be_sha)$(dev_fe_sha)" = "$C1$C1" ] && echo 1 || echo 0)"
  ok_if "dev 엣지는 쿠키가 없으면 404다(게이트가 살아 있다)" "$(is "$(code_of "$DEVU/api/v1/version")" 404)"
  run_deploy dev "$C2"
  ok_if "dev 교체가 성공하고 직전 태그가 c1로 남는다" \
    "$([ "$rc" = 0 ] && [ "$(dev_be_sha)$(dev_fe_sha)" = "$C2$C2" ] && [ "$(st dev BE_DEV_PREV_TAG)$(st dev FE_DEV_PREV_TAG)" = "$C1$C1" ] && echo 1 || echo 0)"
  run_deploy dev "$C7"
  ok_if "FE가 망가진 배포(c7)는 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'dev 확인에 실패했다')" = 1 ] && echo 1 || echo 0)"
  ok_if "BE는 c7로 갔고 FE는 직전 이미지(c2)로 복귀해 응답한다" "$(is "$(dev_be_sha)$(dev_fe_sha)" "$C7$C2")"
  run_deploy dev "$C8"
  ok_if "검색이 폴백으로 처리되는 BE(c8)는 스모크가 잡아 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'FAIL  BE: 검색이 폴백으로 처리되지 않았다')" = 1 ] && echo 1 || echo 0)"
  ok_if "BE는 직전 이미지(c7)로 복귀했고 FE는 c2다" "$(is "$(dev_be_sha)$(dev_fe_sha)" "$C7$C2")"
  out="$(bash infra/deploy/rollback.sh dev 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "rollback.sh dev가 직전 이미지로 되돌린다(BE c2, FE c1)" "$([ "$rc" = 0 ] && [ "$(dev_be_sha)$(dev_fe_sha)" = "$C2$C1" ] && echo 1 || echo 0)"
}

run_fit_up_checks() {
  echo "--- fit-up: 전부 멈춘 뒤 순서대로 올린다"
  local ids
  ids="$(docker ps -q --filter label=com.fit.service)"
  # shellcheck disable=SC2086 # 컨테이너 ID를 단어로 나눠 넘긴다
  docker stop -t 5 $ids >/dev/null
  docker stop -t 5 "$(docker ps -q --filter "label=com.docker.compose.project=$FIT_EDGE_PROJECT")" >/dev/null
  out="$(bash infra/deploy/fit-up.sh 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" >>"$OUT_ALL"
  ok_if "fit-up이 끝나고 경고가 없다" "$([ "$rc" = 0 ] && [ "$(has "$out" '모두 올라왔다')" = 1 ] && echo 1 || echo 0)"
  ok_if "엣지가 다시 떴고 prod·dev 서비스가 전과 같은 버전으로 응답한다" \
    "$(is "$(be_sha)$(fe_sha)$(dev_be_sha)$(dev_fe_sha)" "$C6$C6$C2$C1")"
  ok_if "활성이 아닌 prod 색은 올리지 않는다(green은 멈춘 채)" "$(is "$(running be-prod-green)$(running fe-prod-green)" falsefalse)"
  ok_if "data·obs 프로젝트는 아직 없어서 건너뛴다고 알린다" "$([ "$(has "$out" 'data: 건너뜀')$(has "$out" 'obs: 건너뜀')" = 11 ] && echo 1 || echo 0)"
}

run_hygiene_checks() {
  echo "--- 출력과 알림"
  ok_if "스크립트 출력 어디에도 dev 게이트 키가 없다" "$([ "$(grep -c "$KEY" "$OUT_ALL")" = 0 ] && echo 1 || echo 0)"
  ok_if "알림 웹훅 본문에도 dev 게이트 키가 없다" "$([ "$(grep -c "$KEY" "$T/webhook.log")" = 0 ] && echo 1 || echo 0)"
  ok_if "메모리와 CPU 한도가 compose대로 걸려 있다(be-prod 1536m, fe-prod 512m, be-dev 1024m)" \
    "$(is "$(docker inspect -f '{{.HostConfig.Memory}}' be-prod-green)$(docker inspect -f '{{.HostConfig.Memory}}' fe-prod-green)$(docker inspect -f '{{.HostConfig.Memory}}' be-dev)" "$((1536 * 1048576))$((512 * 1048576))$((1024 * 1048576))")"
  ok_if "FE는 읽기 전용 루트 파일시스템이다" "$(is "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' fe-prod-green)" true)"
  ok_if "호스트에 게시한 포트가 없다(앱 컨테이너)" "$([ -z "$(docker ps -q --filter label=com.fit.service | xargs -r -n1 docker port)" ] && echo 1 || echo 0)"
}

run() {
  # shellcheck source=infra/deploy/lib.sh
  . infra/deploy/lib.sh
  # shellcheck source=/dev/null
  . "$T/shas.env"
  OUT_ALL="$T/all-output.log"
  : >"$OUT_ALL"
  : >"$T/webhook.log"
  "$PY" infra/deploy/test/webhook-sink.py 18099 "$T/webhook.log" &
  echo $! >"$T/sink.pid"
  sleep 1
  set +e
  run_unit_checks
  run_guard_checks
  run_prod_checks
  run_dev_checks
  run_fit_up_checks
  run_hygiene_checks
  set -e
  kill "$(cat "$T/sink.pid")" >/dev/null 2>&1 || true
  if [ "$FAILED" -gt 0 ]; then
    printf '\n%d개 점검 실패\n' "$FAILED"
    return 1
  fi
  printf '\n배포 시험 통과\n'
}

case "${1:-}" in
  up) up ;;
  run) run ;;
  down) down ;;
  *)
    echo "사용: bash infra/deploy/test/test-deploy.sh up | run | down" >&2
    exit 2
    ;;
esac
````

- [ ] **Step 5: shellcheck와 hadolint 확인**

Run:

```bash
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/deploy/test/test-deploy.sh infra/deploy/test/fake-dump.sh; echo "shellcheck exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$HADOLINT_IMAGE" hadolint infra/deploy/test/mock-be/Dockerfile infra/deploy/test/mock-fe/Dockerfile; echo "hadolint exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml infra/deploy/test/compose.sim-edge.yml; echo "yamllint exit=$?"
```

Expected: 세 줄 모두 `exit=0`

- [ ] **Step 6: 시험 환경 켜기 (게이트)**

처음에는 `python:3.12.15-slim`과 `node:22-alpine` 이미지를 받고 목 이미지 9쌍을 만든다.

Run: `bash infra/deploy/test/test-deploy.sh up`

Expected: `만듦  fit-deploytest-net-edge` 등 여섯 줄과 엣지 컨테이너 `Healthy`에 이어 마지막 줄이 `배포 시험 환경이 떴다: https://localhost:18443 (prod), https://dev.localhost:18443 (dev)`이다.

- [ ] **Step 7: 시나리오 실행 (게이트)**

Run: `bash infra/deploy/test/test-deploy.sh run 2>&1 | grep -E "^---|^FAIL|^배포 시험|개 점검 실패"`

Expected: `--- 공통 함수`부터 `--- 출력과 알림`까지 구역 제목 15개가 나오고 `FAIL`은 하나도 없으며 마지막 줄이 `배포 시험 통과`다. 전체 `PASS` 줄은 76개다(`bash infra/deploy/test/test-deploy.sh run`의 출력에서 센다). 도중에 `curl: (7)` 같은 줄이 보일 수 있다. Docker Desktop(Windows)의 포트 포워더가 새 연결을 간헐적으로 거부하는 것이고 시험이 연결 실패만 다시 시도한다.

- [ ] **Step 8: 정리와 남은 것 확인**

Run:

```bash
bash infra/deploy/test/test-deploy.sh down
docker ps -a --format '{{.Names}}' | grep -E 'be-prod|fe-prod|be-dev|fe-dev|fit-deploytest|fit-migrate'
docker image ls --format '{{.Repository}}' | grep -c '^fit-deploytest/'
docker network ls --format '{{.Name}}' | grep -c '^fit-deploytest-'
docker volume ls --format '{{.Name}}' | grep -c '^fit-deploytest'
ls -d .tmp-deploytest 2>&1 | head -1
echo "(컨테이너 이름이 없고 세 숫자가 0이고 디렉터리가 없으면 정리됨)"
```

Expected: `정리했다` 다음에 컨테이너 이름 출력이 없고 세 숫자가 `0`이며 `.tmp-deploytest`는 `No such file or directory`다.

- [ ] **Step 9: 시험이 죽은 검사가 아닌지 확인 (게이트, 선택)**

배포 스크립트를 일부러 망가뜨려 시험이 잡는지 본다. 예로 정적 자산 풀 쌓기를 끄고 `down`, `up`, `run`을 다시 돌린다.

```bash
cp infra/deploy/deploy.sh .tmp-deploy.sh.bak
sed -i 's/sync_pool "\$SHA" || return 1/true/' infra/deploy/deploy.sh
bash infra/deploy/test/test-deploy.sh down; bash infra/deploy/test/test-deploy.sh up >/dev/null; bash infra/deploy/test/test-deploy.sh run 2>&1 | grep "^FAIL  [^>]" | head -4
mv .tmp-deploy.sh.bak infra/deploy/deploy.sh   # 원래 파일로 되돌린다
bash infra/deploy/test/test-deploy.sh down
```

Expected: `FAIL  정적 자산 풀에 c1의 자산과 공용 자산이 쌓였다`, `FAIL  누적 풀: 이전 릴리스(c1)의 해시 자산을 Caddy가 계속 준다…`, `FAIL  풀 정리: 오래된 파일은 지우고 공용 자산(shared.js)은 남긴다` 세 줄이 나온다.

- [ ] **Step 10: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/deploy/test
git update-index --chmod=+x infra/deploy/test/test-deploy.sh infra/deploy/test/fake-dump.sh
git commit -m "feat(infra): 배포 스크립트 시험 환경(목 BE·FE, 시나리오) 추가"
```

---

### Task 6: 문서 동기화와 검사 연결

**목표:** README와 설계·로드맵 문서를 구현과 맞추고, 새 스크립트·Dockerfile·compose가 러너와 CI에 걸리는지 확인한다.

**Files:**
- Create: `infra/deploy/README.md`
- Modify: `infra/README.md`, `docs/infra/design.md`, `docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md`

**Interfaces:**
- `lint:shell`, `lint:docker`, `lint:yaml`(각각 `infra`의 `*.sh`, `Dockerfile*`, `*.yml`을 찾는다)과 러너의 해당 단계는 파일을 새로 등록하지 않아도 새 파일을 검사한다. 포트 불변식은 Task 1에서 등록한 `app` 프로젝트를 본다.

- [ ] **Step 1: README 작성**

````markdown
# 배포 (deploy)

서버 A에서 BE·FE를 배포하고 되돌린다. prod는 Blue/Green, dev는 단일 색 교체다. 설계는 [design.md](../../docs/infra/design.md) 6.4절과 6.8절이다. GitLab이 죽어도 서버에서 직접 실행할 수 있다.

## 자주 하는 일

| 하고 싶은 일 | 명령 |
|---|---|
| 배포 | `bash infra/deploy/deploy.sh <prod\|dev> <sha>`(이미지 `be:<sha>`, `fe:<sha>`가 있어야 한다) |
| 직전으로 되돌리기 | `bash infra/deploy/rollback.sh <prod\|dev> [be\|fe\|all]` |
| 배포 전 점검만 | `bash infra/deploy/preflight.sh <prod\|dev> <sha>` |
| 배포한 서비스 확인 | `bash infra/deploy/smoke.sh <prod\|dev> [--sha <sha>] [--only be\|fe]` |
| 지금 활성 색 보기 | `bash infra/edge/edgectl.sh status` |
| 재부팅·장애 뒤에 전체 올리기 | `bash infra/deploy/fit-up.sh` |
| 이력 보기 | `cat /srv/fit/state/history-<환경>.log` |

CI가 아닌 곳에서 `deploy.sh`를 직접 실행하려면 `SKIP_VERIFY=<사유>`를 줘야 한다(CI의 verify 단계를 건너뛰는 긴급 배포, RB-02b). 사유는 이력에 남는다. `rollback.sh`는 긴급 복구라 사유가 필요 없다.

## 배포가 하는 일 (prod)

1. `preflight.sh`: env 파일(권한, `APP_ENV`, 자리표시자, 필수 키), FE의 `BE_INTERNAL_URL`이 이 환경의 엣지 내부 리스너(prod `caddy:8081`, dev `caddy:8082`)인지, compose 설정, 공유 망과 엣지, 디스크와 메모리 여유, 이미지와 커밋, **다운그레이드 가드**(현재 배포된 커밋의 후손이거나 같은 커밋만 허용), 마이그레이션이 있으면 사전 덤프 스크립트
2. 잠금(`/srv/fit/state/deploy-<환경>.lock`). 다른 배포가 돌고 있으면 거부한다
3. 마이그레이션 파일이 바뀌었으면 사전 덤프(prod만) 뒤 일회성 컨테이너로 마이그레이션. 실패하면 트래픽을 건드리기 전에 멈춘다
4. BE, FE 순서로 서비스마다: 반대 색을 띄운다(FE는 먼저 정적 자산을 풀에 쌓는다) → 준비 확인 → 그 색을 직접 확인 → 엣지 전환 → 엣지를 거친 확인
5. 30초 드레인 뒤 이전 색을 멈춘다(컨테이너와 이미지는 남겨서 롤백이 빠르다)
6. 상태 파일, 이력, Mattermost 알림

## 실패하면

| 단계 | 일어나는 일 |
|---|---|
| 사전 점검, 잠금, 사전 덤프, 마이그레이션 | 서비스를 건드리지 않고 멈춘다 |
| 새 색이 안 뜨거나 준비·직접 확인에 실패 | 새 색을 지우고 트래픽은 옮기지 않는다 |
| 엣지 전환 뒤 확인에 실패 | 엣지를 이전 색으로 되돌리고 새 색을 지운다 |
| BE는 성공했는데 FE가 실패 | FE만 이전 색이다. BE는 새 버전으로 남는다(새 BE는 직전 FE와 호환돼야 한다. BE 계약 #16). 문제를 고쳐 같은 SHA로 다시 배포하거나 `rollback.sh prod be`로 BE를 되돌린다 |

dev는 같은 흐름이지만 색이 없어서 교체하고, 확인에 실패하면 직전 이미지로 다시 교체한다. DB 마이그레이션은 어느 경우에도 되돌리지 않는다(forward-fix 원칙).

## 서버가 갖출 것

- 이미지 `be:<sha>`, `fe:<sha>`(CI의 `build:images`가 만든다. 환경변수 `FIT_BE_IMAGE`, `FIT_FE_IMAGE`로 저장소 이름을 바꿀 수 있다)
- `/etc/fit/<env>.env`, `fe-<env>.env`, `migrate-<env>.env`(키는 [env.md](../../docs/infra/contracts/env.md)의 `app`, `fe`, `migrate` 그룹). 다른 사용자가 읽을 수 없어야 한다
- 호스트 설정(`infra/host/`)과 엣지(`infra/edge/`)가 먼저 떠 있어야 한다. 엣지의 첫 상태 파일은 `infra/edge/state-sample/`을 `/srv/fit/state/`에 복사한 것이다(prod는 blue를 가리킨다)
- prod 마이그레이션이 있는 배포는 사전 덤프 스크립트가 있어야 한다. 기본은 `infra/backup/pg-backup.sh`이고 `predeploy <환경> <sha>`로 부른다(계획 1D가 만든다). `FIT_PREDEPLOY_DUMP`로 바꿀 수 있다
- 웹훅 알림은 `FIT_NOTIFY_WEBHOOK` 또는 `/etc/fit/obs.env`의 `MATTERMOST_WEBHOOK_URL`을 읽는다(없으면 화면에만 출력)

## 이미지 계약

- **BE:** `SPRING_PROFILES_ACTIVE=migrate`로 실행하면 서버 없이 마이그레이션 뒤 종료한다. 공개 8080(`/healthz`, `/api/v1/version`), 관리 8081(`/actuator/health/readiness`)
- **FE:** `WORKDIR /app`, `server.js`와 `.next/static`이 `/app` 아래에 있다(배포가 `docker cp`로 정적 자산을 꺼낸다). 컨테이너 안에 `node`가 있어야 한다(healthcheck). 루트는 읽기 전용이고 `/app/.next/cache`만 tmpfs다
- 서비스 점검은 호스트에 게시하지 않는 포트를 위해 같은 망의 엣지(caddy) 컨테이너 안에서 `wget`으로 한다

## 파일

| 경로 | 내용 |
|---|---|
| `lib.sh` | 공통 함수(상태 파일, 이름 규칙, 점검, 엣지 전환, 잠금). 직접 실행하지 않는다 |
| `deploy.sh`, `rollback.sh`, `preflight.sh`, `smoke.sh`, `notify.sh`, `fit-up.sh` | 위 표의 명령 |
| `../app/compose.app.yml` | BE·FE 컨테이너 정의(`fit-app-prod`, `fit-app-dev`, 프로필 `prod`·`dev`) |
| `test/` | 노트북 시험(목 BE·FE 이미지, 시험용 엣지) |

상태 파일은 `/srv/fit/state/deploy-<환경>.env`다(compose의 `--env-file`이기도 하다). 서비스별 활성 색(`BE_ACTIVE`, `FE_ACTIVE`), 색별 이미지 태그(`BE_BLUE_TAG` 등), `DEPLOYED_SHA`, `PREVIOUS_SHA`가 있다.

## 환경변수

| 이름 | 기본 | 뜻 |
|---|---|---|
| `FIT_DRAIN_SECONDS` | 30 | 전환 뒤 이전 색을 멈추기까지 기다리는 시간 |
| `FIT_BE_READY_TIMEOUT`, `FIT_FE_READY_TIMEOUT` | 150, 60 | 준비 확인 제한 시간(초) |
| `FIT_POOL_KEEP_DAYS` | 14 | 정적 자산 풀에서 이 기간 동안 어느 릴리스에도 없던 파일을 지운다 |
| `FIT_MIN_DISK_GB`, `FIT_MIN_MEM_MB` | 5, prod 2560 / dev 512 | 사전 점검의 여유 기준 |
| `FIT_FORCE_MIGRATE=1` | | 마이그레이션 파일이 안 바뀌어도 마이그레이션을 실행한다 |
| `FIT_SMOKE_SEARCH_PATH` | 없음 | 검색 1건을 호출해 `X-Fallback` 헤더가 없는지 본다(예: `/api/v1/search?q=김치`). 없으면 건너뛴다 |
| `FIT_ENV_DIR`, `FIT_STATE_DIR`, `FIT_WEB_DIR`, `FIT_REPO_DIR`, `FIT_EDGE_PROJECT`, `FIT_NET_PROD`·`FIT_NET_DEV`·`FIT_NET_DATA` | `/etc/fit`, `/srv/fit/state`, `/srv/fit/web`, 저장소 루트, `fit-edge`, 망 이름 | 시험 환경이 바꾼다 |

## 노트북에서 시험하기

```bash
bash infra/deploy/test/test-deploy.sh up     # 가짜 서버(공유 망, 엣지, 목 이미지, 시험용 저장소)
bash infra/deploy/test/test-deploy.sh run    # 배포·롤백·실패 복구·fit-up 시나리오
bash infra/deploy/test/test-deploy.sh down   # 시험이 만든 것을 모두 지운다
```

시험은 실제 Caddy와 목 BE·FE 컨테이너로 돌고 `https://localhost:18443`(prod), `https://dev.localhost:18443`(dev)에 뜬다. 목 이미지의 모드(준비 안 됨, 엣지 경유 시 실패, 마이그레이션 실패, 폴백 표시, 화면 오류)로 각 실패 경로를 만든다. Windows(Git Bash)의 NTFS에는 권한 비트가 없어서 env 파일 권한 점검은 `FIT_SKIP_PERM=1`로 건너뛰고, 그 함수는 Linux 컨테이너에서 따로 시험한다.

## 서버에서만 확인되는 것

실제 BE(Spring)와 FE(Next.js) 이미지의 준비 시간과 메모리, 실제 Postgres와 사전 덤프(계획 1D), 실제 도메인과 인증서를 거친 스모크, 서버의 파일 권한(`root:docker 0640`), 메모리 여유 판정(`MemAvailable`), 재부팅 뒤 `fit-up.sh`의 실제 기동 순서.
````

- [ ] **Step 2: 문서 동기화**

`infra/README.md`:

````diff
diff --git a/infra/README.md b/infra/README.md
--- a/infra/README.md
+++ b/infra/README.md
@@ -8,7 +8,8 @@ Fit Dining 인프라 코드. 설계는 [docs/infra/design.md](../docs/infra/desi
 - `local/` 로컬 개발 스택(Postgres, Redis, Garage, OpenSearch). 사용법은 [local/README.md](local/README.md)
 - `edge/` 엣지(Caddy) 설정, 운영 명령(`edgectl.sh`), 점검, 노트북 시험 환경. 사용법은 [edge/README.md](edge/README.md)
 - `host/` 서버 부트스트랩(`bootstrap.sh`)과 점검(`verify-host.sh`), 공유 Docker 망, 컨테이너 시험. 사용법은 [host/README.md](host/README.md)
-- `app/` BE·FE의 환경변수 예제(`app.env.example`, `migrate.env.example`, `fe.env.example`). 키 계약은 [docs/infra/contracts/env.md](../docs/infra/contracts/env.md)
+- `app/` BE·FE 컨테이너 정의(`compose.app.yml`)와 환경변수 예제(`app.env.example`, `migrate.env.example`, `fe.env.example`). 키 계약은 [docs/infra/contracts/env.md](../docs/infra/contracts/env.md)
+- `deploy/` 배포·롤백·사전 점검·스모크·재부팅 뒤 기동(`deploy.sh` 등)과 노트북 시험 환경. 사용법은 [deploy/README.md](deploy/README.md)
 
 가드가 강제하는 규칙:
 
````

`docs/infra/design.md`: 6.4절의 구현 메모와 확인 표시(실패 복구, 풀, 마이그레이션 판정, 환경 격리 점검), 6.8절의 이미지 이름(`fe:<SHA>`), 10.5절, 12.5절의 이미지 계약(#14), 13.2절의 `migrate-<env>.env`, 17절의 산출물 목록을 구현과 맞춘다.

````diff
diff --git a/docs/infra/design.md b/docs/infra/design.md
--- a/docs/infra/design.md
+++ b/docs/infra/design.md
@@ -465,6 +465,16 @@ GitLab이 죽어도 서버에서 직접 실행할 수 있다.
 
 BE와 FE는 같은 절차로 전환하되 BE가 먼저, FE가 나중이다. 새 BE는 직전 FE와 하위호환이어야 한다(BE 계약 #16).
 
+**구현 메모** (확인: `infra/deploy/test/test-deploy.sh`)
+
+- `fit-app-prod`와 `fit-app-dev`는 `infra/app/compose.app.yml` 하나를 프로필(`prod`, `dev`)로 나눠 쓴다. 이미지 태그와 활성 색은 상태 파일 `/srv/fit/state/deploy-<환경>.env`가 정하고(compose의 `--env-file`), 처음 배포는 활성이 green으로 시작해 blue로 간다(엣지 견본의 upstream과 같다).
+- 준비 확인과 idle 색 확인은 호스트에 게시하지 않는 포트를 위해 같은 망의 caddy 컨테이너 안에서 `wget`으로 한다. BE는 `/actuator/health/readiness`, `/healthz`, `/api/v1/version`(SHA), FE는 `/fe-healthz`, `/`, `/config.json`(`env`)이다.
+- 마이그레이션은 이전 배포 SHA와 새 SHA 사이에 `be/src/main/resources/db/migration`이 바뀌었을 때(첫 배포 포함)만 실행한다. prod는 그 전에 `infra/backup/pg-backup.sh predeploy <환경> <sha>`(계획 1D)로 덤프하고, 덤프나 마이그레이션이 실패하면 트래픽을 건드리기 전에 멈춘다.
+- 새 색의 준비·직접 확인이나 엣지 전환 뒤 확인에 실패하면 새 색을 치우고 엣지를 이전 색으로 되돌린다. BE는 성공하고 FE가 실패하면 BE는 새 버전, FE는 이전 버전으로 남는다(새 BE가 직전 FE와 호환돼야 한다). `rollback.sh`는 서비스별로 이전 색(컨테이너와 이미지가 남아 있다)으로 옮기고, 전체 롤백이면 `DEPLOYED_SHA`와 `PREVIOUS_SHA`를 맞바꾼다.
+- 사전 점검은 FE env의 `BE_INTERNAL_URL`이 이 환경의 엣지 내부 리스너(prod `caddy:8081`, dev `caddy:8082`)인지 확인한다. 같은 망의 컨테이너는 어느 환경의 리스너에도 닿으므로 환경 간 호출을 여기서 막는다.
+- 정적 자산 풀(`/srv/fit/web/<환경>/pool/_next/static`)은 FE 이미지의 `/app/.next/static`을 `docker cp`로 꺼내 이미 있는 파일은 덮어쓰지 않고 쌓는다. 이번 릴리스가 가진 파일의 수정 시각을 갱신하고, 14일 넘게 어느 릴리스에도 없던 파일은 지운다.
+- 잠금은 `mkdir`로 잡는다(프로세스가 죽어 남은 잠금은 pid로 알아본다). `flock`이 없는 환경에서도 같게 돈다. CI 밖에서 직접 실행하려면 `SKIP_VERIFY=<사유>`가 필요하고 사유는 이력에 남는다.
+
 dev는 같은 스크립트를 단일 색으로 돌린다. 교체형이고 헬스 실패 시 직전 이미지로 복귀한다. 일정상 Blue/Green(P1)이 어려우면 prod도 이 교체형(헬스 게이트 + 직전 이미지 복귀)으로 먼저 배포한다(P0).
 
 ### 6.5 DB 마이그레이션
@@ -491,7 +501,7 @@ FE는 `fe/`의 Next.js를 `output: 'standalone'`으로 빌드한 Node 컨테이
 - **빌드:** `fe:build`가 B에서 `next build`로 번들을 **한 번만** 만든다. 환경별 값은 번들에 넣지 않는다(`NEXT_PUBLIC_*`에 환경별 값을 두지 않는다). dev에서 검증한 이미지가 곧 prod 이미지다. `generateBuildId`와 `deploymentId`는 커밋 SHA다. 시크릿은 어디에도 넣지 않는다.
 - **아키텍처:** B(Arm)에서 만든 번들을 A(x86)에서 돌린다. standalone 번들에는 `sharp`의 플랫폼 전용 네이티브 모듈이 들어가고 이미지 최적화를 꺼도 빠지지 않는다(확인: Linux x64 빌드에서 `images.unoptimized: true`여도 `@img/sharp-linux-x64`가 들어간다). 그래서 이미지 최적화 기본 로더를 쓰지 않는다(`unoptimized: true` 또는 커스텀 로더). 사진은 Garage가 제공한다.
 - **산출물 검사(P0):** 번들에 `localhost`·mock 값이 없는지, `.next/images-manifest.json`의 `unoptimized`가 `true`인지(확인: 설정에 따라 `false`나 `true`로 기록된다), 네이티브 모듈이 `sharp-*`뿐인지, `server.js`와 `.next/static`이 있는지 확인한다. 배치 뒤 smoke는 `/config.json`에 필수 키가 모두 있는지 확인한다. A503이 빌드타임 설정 누락으로 빈 번들을 6회 배포한 교훈이다.
-- **배치:** `fit-fe:<SHA>` 이미지로 반대 색 FE를 띄우고 idle 색에서 SSR 페이지(`/`)와 `/config.json`을 확인한 뒤 전환한다. 정적 자산은 색을 띄우기 전에 `.next/static`을 풀(`/srv/fit/web/<env>/pool/`)에 쌓는다.
+- **배치:** `fe:<SHA>` 이미지로 반대 색 FE를 띄우고 idle 색에서 SSR 페이지(`/`)와 `/config.json`을 확인한 뒤 전환한다. 정적 자산은 색을 띄우기 전에 `.next/static`을 풀(`/srv/fit/web/<env>/pool/`)에 쌓는다.
 - **운영:** 루트 파일시스템은 읽기 전용이고 `.next/cache`만 tmpfs다(확인: 쓰기 불가이면 `/app/.next/cache`를 만들지 못해 오류가 난다). 컨테이너 메모리 한도(4.1절)와 `NODE_OPTIONS=--max-old-space-size`로 힙을 묶고, 로그는 JSON을 stdout으로 낸다. 종료는 SIGTERM이며 진행 중 요청을 끝낼 시간으로 30초 드레인을 둔다(Next.js 문서는 10~30초를 권장한다).
 - **버전 스큐:** `deploymentId`가 있으면 Next가 어긋남을 감지해 전체 새로고침을 한다(Next.js 문서). 이전 릴리스 자산은 풀에 남아 있고, API는 직전 배포의 FE와 하위호환을 유지한다(BE 계약 #16).
 - **푸시와 설치:** 웹 푸시와 설치 흐름은 프런트 팀 몫이다. 인프라는 HTTPS, 캐시 정책, 푸시 키 보관을 맡는다(11.3절).
@@ -656,7 +666,7 @@ Grafana는 팀원에게 viewer 계정을 준다. A503에서는 SSH 보유자만
 
 ### 10.5 로컬 개발·사전 검증
 
-- 로컬 개발용 `infra/local/compose.yml`은 profile(`core`, `search`)로 나눠 노트북 메모리에 맞게 고르게 한다. AI는 Modal의 dev 앱을 쓴다. 켜고 점검하는 명령은 `bash infra/local/fit-local.sh`이고 접속 값은 `infra/local/README.md`에 있다. 환경변수 이름은 `docs/infra/contracts/env.md`를 따른다. 엣지는 `bash infra/edge/test/test-edge.sh up|verify|down`으로 목 BE·FE와 시험용 풀, 로컬 스택의 garage를 붙여 시험한다.
+- 로컬 개발용 `infra/local/compose.yml`은 profile(`core`, `search`)로 나눠 노트북 메모리에 맞게 고르게 한다. AI는 Modal의 dev 앱을 쓴다. 켜고 점검하는 명령은 `bash infra/local/fit-local.sh`이고 접속 값은 `infra/local/README.md`에 있다. 환경변수 이름은 `docs/infra/contracts/env.md`를 따른다. 엣지는 `bash infra/edge/test/test-edge.sh up|verify|down`으로 목 BE·FE와 시험용 풀, 로컬 스택의 garage를 붙여 시험한다. 배포는 `bash infra/deploy/test/test-deploy.sh up|run|down`으로 실제 Caddy와 목 BE·FE 이미지를 띄워 배포·롤백·실패 복구를 시험한다.
 - 서버 수령 전에는 이 PC의 Docker Desktop(Docker 29.7.2, Compose v5.4.0)과 Ubuntu 컨테이너(호스트 스크립트)로 compose·스크립트·알림 규칙·Caddy 설정을 검증한다. shellcheck, promtool, age는 컨테이너로 돌린다.
 - 서버에서만 확인되는 것은 스왑·sysctl 적용, ufw의 실제 차단, 실제 TLS 발급, CPU 버스트, 외부 포트 노출, 클라우드 방화벽이다.
 
@@ -859,6 +869,7 @@ AI 팀과 M1 전에 합의한다. FastAPI는 Modal에서 돌고 A·B에는 AI 
 | 11 | 푸시 | 방식(FCM 웹 푸시 또는 VAPID)은 프런트·BE 팀이 정하고 키는 서버 env에 둔다 | 11.3절, 16절 |
 | 12 | 공유 | 장소 공유는 외부 지도(네이버) 링크를 Web Share API(`navigator.share`)로 보내고, 미지원 환경은 클립보드 복사로 대체한다. Fit Dining URL 자체를 공유해야 하면 FE가 OG 메타를 렌더링한다. 장소 ID 확보는 16절 #19 | SSR이라 별도 공유 페이지가 필요 없다 |
 | 13 | 런타임 | 로그는 JSON 한 줄을 stdout으로 내고 토큰·개인정보를 마스킹한다. SIGTERM을 받으면 진행 중 요청을 끝내고 내려간다. 쓰기는 `.next/cache`뿐이며 운영이 tmpfs로 준다 | 4.1절, 6.8절. 읽기 전용 루트 |
+| 14 | 이미지 | `WORKDIR /app`, `server.js`와 `.next/static`이 `/app` 아래에 있고 컨테이너 안에 `node`가 있다 | 배포가 `docker cp`로 정적 자산을 풀에 쌓고(6.4절) compose healthcheck가 `node`로 `/fe-healthz`를 부른다. 읽기 전용 루트에서 쓰기는 `/app/.next/cache`(tmpfs)와 `/tmp`뿐이다 |
 
 ## 13. 보안 요약
 
@@ -881,6 +892,7 @@ AI 팀과 M1 전에 합의한다. FastAPI는 Modal에서 돌고 A·B에는 AI 
 |---|---|---|---|
 | `/etc/fit/prod.env`, `dev.env` | A | root:docker 0640 | 앱 env(Modal URL·토큰 포함) |
 | `/etc/fit/fe-prod.env`, `fe-dev.env` | A | root:docker 0640 | FE env(비밀 없음. 내부 BE 주소, 브라우저에 공개되는 키) |
+| `/etc/fit/migrate-prod.env`, `migrate-dev.env` | A | root:docker 0640 | 마이그레이션 일회성 컨테이너의 DDL 자격(웹 컨테이너에는 넣지 않는다) |
 | `/etc/fit/data.env` | A | root:docker 0640 | DB·Redis·Garage 자격 |
 | `/etc/fit/edge.env` | A | root:docker 0640 | `ACME_EMAIL`, `ACME_MODE`, `HSTS_MODE`, `PROD_HOST`, `DEV_HOST`, B의 IP, `/_ops` basic auth 해시, dev 게이트 키(`?k=` 쿠키 발급용) |
 | `/etc/fit/obs.env` | A | root:docker 0640 | Grafana admin, Mattermost 웹훅 |
@@ -1005,10 +1017,10 @@ infra/
   host/        bootstrap.sh, verify-host.sh, networks.sh, docker-prune.sh, README.md, conf/(sshd, sysctl, daemon.json, fail2ban, apt, systemd units), test/(test-host.sh, run-in-container.sh)
   edge/        compose.edge.yml, conf/(Caddyfile, acme/, hsts/), state-sample/, edge.env.example, edgectl.sh, verify-edge.sh, README.md, test/(compose.test.yml, test-edge.sh, 목 BE·FE)
   data/        compose.data.yml, ensure-databases.sh, opensearch/Dockerfile, garage/ 설정과 초기화 스크립트
-  app/         compose.app.yml, compose.prod.yml, compose.dev.yml, *.env.example
+  app/         compose.app.yml(프로필 prod·dev), *.env.example
   obs/         compose.obs.yml, prometheus/(rules, tests), alertmanager/, grafana/(provisioning, dashboards), blackbox/
   ops/         (B) compose.ops.yml, prometheus/, alertmanager/, blackbox, port-audit.sh, vault-ingest.sh
-  deploy/      deploy.sh, rollback.sh, preflight.sh, smoke.sh, notify.sh, fit-up.sh
+  deploy/      deploy.sh, rollback.sh, preflight.sh, smoke.sh, notify.sh, fit-up.sh, lib.sh, README.md, test/(test-deploy.sh, 목 BE·FE 이미지)
   backup/      pg-backup.sh, verify-dump.sh, push-vault.sh, photos-backup.sh, restore-check.sh(노트북용)
   ci/          ports_invariant.py, check_compose_projects.py, check_env_files.py, check_env_contract.py, check_eol.py, check_linear_history.py, no-merge-commit.sh, check-caddy.sh, migration_immutability.py, images_arch.py, run-local-checks.sh, tool-images.sh, compose-projects.txt, tests/
   local/       compose.yml (profile: core, search), fit-local.sh, local.env.example, garage/, opensearch/Dockerfile, README.md
````

`docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md`: 로드맵의 1C-2 행에 이 계획의 링크를 단다.

````diff
diff --git a/docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md b/docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md
--- a/docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md
+++ b/docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md
@@ -93,7 +93,7 @@
 | 계획 | 내용 |
 |---|---|
 | [1B 로컬 개발 환경과 서비스 계약](2026-10-19-plan-1b-local-env-contracts.md) | `infra/local/compose.yml`(profile `core`: Postgres(pgvector)·Redis·Garage, `search`: nori를 넣은 OpenSearch)과 `fit-local.sh`, `docs/infra/contracts/`(env.md와 합의 상태 목록. BE·AI(Modal 호출)·프런트 계약은 합의되면 옮긴다), `*.env.example`, 계약과 예제의 일치 검사. BE·FE 팀이 이미 개발 중이라 서버 없이도 가장 먼저 쓰이는 산출물이고, 계약은 M1 전에 합의해야 한다 |
-| 1C 엣지와 배포(셋으로 나눈다) | **1C-1 엣지**([계획](2026-10-20-plan-1c1-edge.md)): Caddyfile(호스트별 사이트, Next.js SSR 프록시와 정적 자산 풀, dev 쿠키 게이트, 사진 업로드·읽기 프록시), `compose.edge.yml`, `edgectl.sh`, `verify-edge.sh`, 노트북 시험 환경. **1C-2 배포 스크립트**: `compose.app.yml`(be, fe), `deploy.sh`(BE·FE Blue/Green과 정적 자산 풀 동기화)·`rollback.sh`·`preflight.sh`(다운그레이드 가드, `BE_INTERNAL_URL` 포트 확인 포함)·`smoke.sh`(검색 1건의 폴백 표시 확인 포함)·`fit-up.sh`(재부팅 뒤 기동 순서), 로컬 시뮬레이션. **1C-3 CI 파이프라인**: `.gitlab-ci.yml`의 `be:test`·`fe:test`·`fe:build`(FE 산출물 검사 포함)·`build`·`deploy`(`environment`, 환경별 `resource_group`)·`smoke` 잡. 이 계획의 `check_env_files.py`, `ports_invariant.py`를 호출한다 |
+| 1C 엣지와 배포(셋으로 나눈다) | **1C-1 엣지**([계획](2026-10-20-plan-1c1-edge.md)): Caddyfile(호스트별 사이트, Next.js SSR 프록시와 정적 자산 풀, dev 쿠키 게이트, 사진 업로드·읽기 프록시), `compose.edge.yml`, `edgectl.sh`, `verify-edge.sh`, 노트북 시험 환경. **1C-2 배포 스크립트**([계획](2026-10-21-plan-1c2-deploy.md)): `compose.app.yml`(be, fe), `deploy.sh`(BE·FE Blue/Green과 정적 자산 풀 동기화)·`rollback.sh`·`preflight.sh`(다운그레이드 가드, `BE_INTERNAL_URL` 포트 확인 포함)·`smoke.sh`(검색 1건의 폴백 표시 확인 포함)·`fit-up.sh`(재부팅 뒤 기동 순서), 로컬 시뮬레이션. **1C-3 CI 파이프라인**: `.gitlab-ci.yml`의 `be:test`·`fe:test`·`fe:build`(FE 산출물 검사 포함)·`build`·`deploy`(`environment`, 환경별 `resource_group`)·`smoke` 잡. 이 계획의 `check_env_files.py`, `ports_invariant.py`를 호출한다 |
 | 1D 데이터와 백업 | compose.data.yml, `ensure-databases.sh`, 백업·검증·전송·복원 스크립트 |
 | 1E 관측성 | A와 B의 Prometheus·Alertmanager·blackbox 설정, 알림 규칙(Modal 폴백·예산 알림, B 도달 알림 포함)과 `promtool test`, 포트 노출 감사, 대시보드. B의 ops 스택 compose가 생기면 그 이미지의 arm64 검사를 `lint:image-arch`에 추가한다 |
 | 1F 호스트 부트스트랩([계획](2026-10-20-plan-1f-host.md)) | `infra/host/`(`bootstrap.sh` ROLE=app\|ops, `verify-host.sh`, `networks.sh`, `docker-prune.sh`, daemon.json, sysctl, sshd drop-in, fail2ban, 자동 업데이트, systemd 유닛), 컨테이너 시험. 설계 3절 |
````

- [ ] **Step 3: 최종 게이트 실행**

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
python -m unittest discover -s infra/ci/tests
bash infra/ci/run-local-checks.sh
bash infra/ci/run-local-checks.sh --self-test
```

Expected:
- 단위 테스트: `Ran 92 tests` 다음에 `OK`
- 러너 정상 실행: 마지막 줄이 `모든 검사 통과`이고 `PASS  shellcheck`, `PASS  hadolint`, `PASS  yamllint`, `PASS  ports (compose 프로젝트)`가 있다(`history`는 저장소에 `origin/master`가 있어야 PASS이고 없으면 SKIP이다). 나머지 단계는 1F와 같다.
- 자가 테스트: 10종 모두 PASS

- [ ] **Step 4: CI의 lint 줄을 핀한 이미지 안에서 실행 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" sh -ec "find infra -type f -name '*.sh' -print0 | xargs -0 -r shellcheck -x"; echo "lint:shell exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$HADOLINT_IMAGE" sh -ec "find infra -type f \( -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name '*.Dockerfile' \) -print0 | xargs -0 -r hadolint"; echo "lint:docker exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml .gitlab-ci.yml .yamllint.yaml infra; echo "lint:yaml exit=$?"
```

Expected: 세 줄 모두 `exit=0`

- [ ] **Step 5: 남은 임시 파일 확인**

Run: `git status --short`

Expected: 이 계획이 만든 파일만 보이거나(커밋하지 않은 경우) 아무것도 없다(커밋한 경우). `.tmp-selftest/`, `.tmp-gitleaks/`, `.tmp-deploytest/`는 없어야 한다.

- [ ] **Step 6: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/deploy/README.md infra/README.md docs/infra/design.md docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md
git commit -m "docs(infra): 배포 스크립트 문서와 설계·로드맵 동기화"
```
