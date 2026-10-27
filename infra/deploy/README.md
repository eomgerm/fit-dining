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

## CI에서 배포하기

`.gitlab-ci.yml`이 위 스크립트를 부른다(설계 6.3절). `develop`에 병합하면 `be:build`와 `fe:build`가 jar와 번들을 만들고 `build:images` → `deploy:dev` → `smoke:dev`가 돌고, `master`에서는 같은 이미지로 수동 `deploy:prod` → `smoke:prod`다. 배포 단계(`be:build`, `fe:build`부터 `smoke`까지)는 변수 `FIT_CD_ENABLED`가 `"true"`일 때만 나타난다. MR 파이프라인은 바뀐 경로의 검사만 돌려 빠르게 끝나고(jar는 만들지 않는다), `develop`·`master`는 항상 전체를 돌린다(설계 6.3절). 2026-10-26에 켰다(비상으로 끄려면 프로젝트 CI/CD 변수 `FIT_CD_ENABLED=false`). 켜기 전에 확인한 일은 [계획 1C-3의 체크리스트](../../docs/infra/plans/2026-10-23-plan-1c3-ci-pipeline.md)에 있다.

- 잡은 서버 A의 `fit-deploy` 러너(shell, 보호된 브랜치만)에서 돌고 `gitlab-runner` 계정이 docker 그룹이라 `deploy.sh`를 그대로 실행한다. `/srv/fit/state`와 `/srv/fit/web`은 `root:docker 2775`여야 쓸 수 있다(`infra/host/bootstrap.sh`가 만든다).
- 배포 잡은 전체 clone(`GIT_DEPTH: "0"`)을 쓴다. 얕은 clone이면 `preflight.sh`의 다운그레이드 가드와 마이그레이션 비교가 틀린다.
- prod는 사람이 `master`의 최신 파이프라인에서 `deploy:prod`를 눌러야 한다(누를 때까지 파이프라인이 멈춘다).
- 같은 SHA를 다시 배포하려면 그 파이프라인의 배포 잡을 **Retry**한다(이미지는 있으면 다시 조립하지 않는다). 이미 더 새로운 SHA가 배포돼 있으면 다운그레이드 가드가 거부한다.
- **이미 떠 있는 SHA를 다시 배포해도 롤백 대상은 그대로다.** `PREVIOUS_SHA`는 바뀌지 않고, dev는 `BE_DEV_PREV_TAG`·`FE_DEV_PREV_TAG`를, prod는 직전 릴리스 태그를 `BE_PROD_PREV_TAG`·`FE_PROD_PREV_TAG`에 따로 적어 둔다(두 색이 같은 태그가 되기 때문이다). 그 뒤의 `rollback.sh`는 재배포 전의 직전 릴리스로 돌아간다. env 값을 바꾼 뒤 같은 SHA를 다시 배포해도 롤백 지점을 잃지 않는다.

## env 파일을 바꾼 뒤 반영하기

BE·FE 컨테이너는 만들어질 때 `env_file`을 한 번만 읽는다. `/etc/fit/<env>.env`나 `fe-<env>.env`를 바꿔도 떠 있는 컨테이너는 그대로이고 `docker restart`도 다시 읽지 않는다. 배포한 적이 있으면 같은 SHA를 다시 배포한다(prod는 반대 색을 새 값으로 띄워 전환하므로 끊기지 않고, dev는 컨테이너를 교체하는 동안 잠깐 끊긴다). 아직 배포한 적이 없으면 첫 배포에 반영된다. 값을 넣고 점검하는 도구는 [infra/host/envset.py](../host/README.md)다.

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
- prod 마이그레이션이 있는 배포는 사전 덤프 스크립트가 있어야 한다. 기본은 `infra/backup/pg-backup.sh`이고 `predeploy <환경> <sha>`로 부른다(결과는 `/srv/fit/predeploy/`, [backup](../backup/README.md)). `FIT_PREDEPLOY_DUMP`로 바꿀 수 있다
- 데이터 스택(`infra/data/`)과 `/etc/fit/data.env`. `fit-up.sh`가 올리고 DB·버킷 초기화까지 한다([data](../data/README.md))
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

상태 파일은 `/srv/fit/state/deploy-<환경>.env`다(compose의 `--env-file`이기도 하다). 서비스별 활성 색(`BE_ACTIVE`, `FE_ACTIVE`), 색별 이미지 태그(`BE_BLUE_TAG` 등), `DEPLOYED_SHA`, `PREVIOUS_SHA`가 있다. dev는 서비스별 직전 이미지 태그(`BE_DEV_PREV_TAG`, `FE_DEV_PREV_TAG`)를, prod는 같은 SHA를 다시 배포했을 때만 쓰는 직전 릴리스 태그(`BE_PROD_PREV_TAG`, `FE_PROD_PREV_TAG`, 평소에는 `none`)를 더 갖는다.

## 환경변수

| 이름 | 기본 | 뜻 |
|---|---|---|
| `FIT_DRAIN_SECONDS` | 30 | 전환 뒤 이전 색을 멈추기까지 기다리는 시간 |
| `FIT_BE_READY_TIMEOUT`, `FIT_FE_READY_TIMEOUT` | 150, 60 | 준비 확인 제한 시간(초) |
| `FIT_POOL_KEEP_DAYS` | 14 | 정적 자산 풀에서 이 기간 동안 어느 릴리스에도 없던 파일을 지운다 |
| `FIT_MIN_DISK_GB`, `FIT_MIN_MEM_MB` | 5, prod 2560 / dev 512 | 사전 점검의 여유 기준 |
| `FIT_FORCE_MIGRATE=1` | | 마이그레이션 파일이 안 바뀌어도 마이그레이션을 실행한다 |
| `FIT_SMOKE_SEARCH_PATH` | 없음 | 검색 1건을 호출해 `X-Fallback` 헤더가 없는지 본다(예: `/api/v1/search?q=김치`). 없으면 건너뛴다 |
| `FIT_DATA_COMPOSE`, `FIT_OBS_COMPOSE` | `infra/data/compose.data.yml`, `infra/obs/compose.obs.yml` | `fit-up.sh`가 올릴 data·obs compose 파일. 파일이 없으면 건너뛴다(시험이 없는 파일을 가리킨다) |
| `FIT_ENV_CONTRACT` | `docs/infra/contracts/env.md` | 사전 점검이 필수 키 표를 읽는 파일. 읽지 못하면 env 점검이 통과하지 않고 실패한다(저장소 일부만 복사한 서버에서 가짜 통과가 난 적이 있다) |
| `FIT_ENV_DIR`, `FIT_STATE_DIR`, `FIT_WEB_DIR`, `FIT_REPO_DIR`, `FIT_EDGE_PROJECT`, `FIT_NET_PROD`·`FIT_NET_DEV`·`FIT_NET_DATA` | `/etc/fit`, `/srv/fit/state`, `/srv/fit/web`, 저장소 루트, `fit-edge`, 망 이름 | 시험 환경이 바꾼다 |

## 노트북에서 시험하기

```bash
bash infra/deploy/test/test-deploy.sh up     # 가짜 서버(공유 망, 엣지, 목 이미지, 시험용 저장소)
bash infra/deploy/test/test-deploy.sh run    # 배포·롤백·실패 복구·fit-up 시나리오 전부
bash infra/deploy/test/test-deploy.sh run guard   # 구역만 골라 돌린다(unit guard prod dev fit_up hygiene, 여러 개 가능)
bash infra/deploy/test/test-deploy.sh down   # 시험이 만든 것을 모두 지운다
```

시험은 실제 Caddy와 목 BE·FE 컨테이너로 돌고 `https://localhost:18443`(prod), `https://dev.localhost:18443`(dev)에 뜬다. 목 이미지의 모드(준비 안 됨, 엣지 경유 시 실패, 마이그레이션 실패, 폴백 표시, 화면 오류)로 각 실패 경로를 만든다. Windows(Git Bash)의 NTFS에는 권한 비트가 없어서 env 파일 권한 점검은 `FIT_SKIP_PERM=1`로 건너뛰고, 그 함수는 Linux 컨테이너에서 따로 시험한다.

## 서버에서만 확인되는 것

실제 BE(Spring)와 FE(Next.js) 이미지의 준비 시간과 메모리, 실제 BE 마이그레이션과 사전 덤프의 조합(사전 덤프 스크립트 자체는 실제 Postgres로 시험했다. [backup](../backup/README.md)), 이 시험이 건너뛰는 data 스택의 기동과 초기화(`infra/data/test/test-data.sh`가 따로 시험한다), 실제 도메인과 인증서를 거친 스모크, 서버의 파일 권한(`root:docker 0640`), 메모리 여유 판정(`MemAvailable`), 재부팅 뒤 `fit-up.sh`의 실제 기동 순서.
