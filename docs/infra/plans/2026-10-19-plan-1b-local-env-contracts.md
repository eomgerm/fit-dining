# 로컬 개발 환경과 서비스 계약 구현 계획 (Plan 1B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BE·FE 팀이 서버 없이 노트북에서 개발할 수 있는 로컬 스택(Postgres, Redis, Garage, OpenSearch+nori)과 한 명령으로 켜고 점검하는 스크립트, 그리고 서비스가 읽는 환경변수 계약(문서, 예제 파일, 계약과 예제의 일치 검사)을 만든다.

**Architecture:** `infra/local/compose.yml`은 profile 두 개(`core`: postgres·redis·garage, `search`: nori를 넣은 opensearch)를 가진 compose 프로젝트(`fit-local`)이고 모든 게시 포트는 `127.0.0.1`이다. `infra/local/fit-local.sh`가 기동, 헬스 대기, DB·role·버킷 초기화(멱등), 점검을 맡는다. 환경변수 계약은 `docs/infra/contracts/env.md`의 표 한 곳이고, `infra/ci/check_env_contract.py`가 표와 `*.env.example`의 키를 맞춰 본다. 새 compose 프로젝트와 이미지는 1A의 검사(포트 불변식, 이미지 아키텍처)에 등록한다.

**Tech Stack:** Docker Compose v2, bash, Python 3.9+(stdlib, unittest), pgvector 0.8.7(PG16), Redis 7.4.9, Garage v2.4.1, OpenSearch 3.9.0(+analysis-nori).

**Spec:** [docs/infra/design.md](../design.md) (2.2·2.3절 compose와 환경 분리, 7절 데이터 서비스, 10.5절 로컬 개발, 12절 서비스 계약)

## 한눈에 보기

각 Task는 실패하는 테스트나 점검 작성, 구현, 통과 확인, 커밋 순서다(커밋은 허용된 경우에만).

| Task | 만드는 것 | 막는 사고 |
|---|---|---|
| 1 | 이미지 아키텍처 검사가 `build` 서비스를 건너뜀 | 로컬에서 만드는 이미지를 레지스트리에서 찾다가 검사가 깨짐 |
| 2 | env 계약 문서, 예제 파일 3개, 계약 일치 검사 | 팀마다 다른 키 이름을 쓰고 예제가 계약과 어긋남 |
| 3 | 로컬 스택 구성 파일(compose, Garage 설정, OpenSearch 이미지) | 호스트 포트가 0.0.0.0에 공개되고 서버와 다른 이미지를 씀 |
| 4 | `fit-local.sh`(기동, 초기화, 점검)와 실제 기동 확인 | 로컬에서 서버 구조(DDL·DML role 분리, Redis `noeviction`, nori)를 못 써 보고 서버에 올림 |
| 5 | 검사 연결, 문서 동기화, 최종 게이트 | 새 검사가 CI와 로컬 러너에서 빠지고 문서와 구현이 어긋남 |

이 계획은 로컬 스택과 계약만 만든다. 서버용 compose(`fit-data`, `fit-app-*`), Caddyfile, 배포 스크립트는 후속 계획이 만든다.

## 검증 결과

이 계획의 코드는 저장소를 clone한 임시 복사본(저장소 밖)에서 실행해 확인했다.

- 단위 테스트 83개(1A의 69개, env 계약 13개, 이미지 검사 1개), 러너 정상 실행, 자가 테스트 8종이 통과한다.
- 로컬 스택은 빈 상태에서 `up --search`로 켜서 점검 16개가 통과했다. 같은 `up`을 다시 실행해도 같은 결과다. 잘못된 비밀번호를 준 env로 `verify`하면 실패 7개와 종료 코드 1이 나온다.
- 도구 이미지 8개와 로컬 스택 이미지 4개(pgvector, redis, garage, opensearch 기반)가 `linux/amd64`와 `linux/arm64`를 모두 지원한다.
- `lint:*` 잡의 스크립트 줄을 핀한 이미지 안에서 docker 소켓 없이 실행해 통과했다.
- 호스트 포트를 `0.0.0.0`으로 바꾼 compose는 포트 불변식이, 계약에 없는 키를 더한 예제는 계약 검사가 거부한다.
- 측정한 메모리: core는 유휴 상태에서 약 70MB(postgres 51MB, redis 9MB, garage 6MB), OpenSearch는 한도 1GiB 중 974MiB.
- OpenSearch 3.9.0에 `analysis-nori`를 설치할 수 있고 `opensearch-knn`은 기본으로 들어 있으며 nori 분석기가 동작한다.
- Garage v2.4.1에서 레이아웃 적용, 버킷 생성, 키 가져오기, 권한 부여, 웹 엔드포인트 허용이 동작한다. 웹 엔드포인트로 공개 읽기가 되고 서명 없는 S3 GET은 403이다.
- 공식 pgvector 이미지(postgres)는 컨테이너 안에서 localhost로 접속하면 비밀번호가 틀려도 통과시키고, 컨테이너 주소로 접속하면 비밀번호를 요구한다.
- gitleaks는 무작위처럼 보이는 16진수 예제 값을 시크릿으로 판정한다. 그래서 개발용 값은 엔트로피가 낮은 값으로 둔다.

아래 코드를 그대로 옮기면 같은 결과가 나와야 한다. 다르면 코드를 고치기 전에 원인을 먼저 확인한다.

**아직 확인하지 못한 것**

- Apple Silicon·Intel Mac·Linux에서의 실제 기동. 이미지는 두 아키텍처를 지원하지만 이 PC는 Windows(Git Bash)다.
- Linux 호스트에서 OpenSearch의 `vm.max_map_count`. Docker Desktop(WSL2)에서는 설정 없이 떴다. 서버 설정은 계획 1F가 맡는다.
- Garage의 PostObject `content-length-range`, Caddy 경유 presigned 서명, 수명주기(설계 7.4절의 서버 스파이크).
- BE·프런트 팀의 계약 합의. `env.md`는 제안 상태다.

## Global Constraints

1A의 전역 제약이 모두 적용된다([plan 1A](2026-10-15-plan-1a-foundation-guardrails.md)). 이 계획에서 더 지키는 것은 다음과 같다.

- 로컬 스택의 값은 개발용 가짜 값이다. 예제 값은 gitleaks가 시크릿으로 보지 않도록 엔트로피가 낮은 값을 쓴다.
- 호스트 게시 포트는 `127.0.0.1:`만 쓴다. 기본 포트는 PC에 설치한 Postgres(5432) 등과 겹치지 않는 번호(15432 계열)다.
- env 파일(예제 포함)은 `KEY=VALUE`만 쓴다. 설명은 `docs/infra/contracts/env.md`에 둔다.
- 환경변수 키를 더하거나 바꾸면 `env.md`의 표와 예제 파일을 함께 고친다. 검사가 둘의 일치를 본다.
- 검증용 기동은 `FIT_LOCAL_PROJECT=fit-local-verify`로 한다. 개발자가 쓰는 `fit-local` 스택과 볼륨을 건드리지 않는다. 정리는 `reset`과 정확한 이미지 이름 삭제로 한다(이름 패턴 일괄 삭제 금지).
- 커밋 메시지는 `type(scope): 설명`(scope는 `infra`)이고 이모지와 Jira 키는 팀의 lefthook이 브랜치 이름에서 채운다. 브랜치는 `infra/<타입>/<설명>-<Jira키>`다(저장소 루트 `CONTRIBUTING.md`, 설계 10.8절).
- Windows(Git Bash)에서 `curl -o /dev/null`은 쓰기 오류가 나고, 인자의 한글은 ANSI 코드페이지로 전달돼 JSON이 깨진다. 스크립트는 이를 피한다(상태 코드는 `-w`로 받고, 한글 요청은 컨테이너 안의 curl로 보낸다).

## 파일 구조

모든 경로는 저장소 루트(`C:\Users\SSAFY\ssafy\S15P31A302`) 기준이다.

| 파일 | 책임 |
|---|---|
| `infra/ci/images_arch.py`, `infra/ci/tests/test_images_arch.py` | (수정) `build`가 있는 compose 서비스는 레지스트리 조회에서 제외 |
| `docs/infra/contracts/env.md` | 환경변수 키 계약(표). 그룹별 필수 여부 |
| `docs/infra/contracts/README.md` | 계약 목록과 합의 상태 |
| `infra/app/app.env.example`, `infra/app/migrate.env.example` | BE 웹 컨테이너와 마이그레이션 컨테이너의 env 예제 |
| `infra/local/local.env.example` | 로컬 스택의 env 예제(개발용 가짜 값) |
| `infra/ci/check_env_contract.py`, `infra/ci/tests/test_check_env_contract.py` | 계약 표와 예제 파일의 키 일치 검사 |
| `infra/local/compose.yml` | 로컬 스택(profile `core`, `search`) |
| `infra/local/garage/garage.toml` | Garage 설정(단일 노드) |
| `infra/local/opensearch/Dockerfile` | nori를 넣은 OpenSearch 이미지 |
| `infra/local/fit-local.sh` | 기동, DB·role·버킷 초기화, 점검, 중지, 초기화 |
| `infra/local/README.md` | 로컬 스택 사용법과 접속 값 |
| `infra/ci/compose-projects.txt`, `infra/ci/run-local-checks.sh`, `.gitlab-ci.yml` | (수정) 새 검사와 compose 프로젝트 연결 |
| `infra/README.md`, `docs/infra/design.md` | (수정) 문서 동기화 |

## 후속 계획

| 계획 | 이 계획의 산출물을 쓰는 방식 |
|---|---|
| 1C 엣지와 배포 | `infra/app/app.env.example`을 `compose.app.yml`의 `env_file` 기준으로 쓰고, `check_env_contract.py`와 `check_env_files.py`를 `preflight.sh`가 호출한다. `edge` 그룹의 키를 `env.md`에 더한다 |
| 1D 데이터와 백업 | 서버용 `ensure-databases.sh`와 Garage 초기화를 `fit-local.sh`와 같은 순서(role·DB·권한, 레이아웃·버킷·키)로 만든다. `data` 그룹의 키를 `env.md`에 더한다 |
| 1E 관측성 | `obs`, `ops` 그룹의 키를 `env.md`에 더한다 |

---

### Task 1: 이미지 아키텍처 검사가 `build` 서비스를 건너뜀

**목표:** 로컬에서 Dockerfile로 만드는 compose 서비스의 `image:` 이름은 레지스트리에 없으므로 조회 대상에서 뺀다. 그 Dockerfile의 `FROM`은 `--dockerfile`로 따로 검사한다.

**Files:**
- Modify: `infra/ci/images_arch.py`
- Test: `infra/ci/tests/test_images_arch.py`

**Interfaces:**
- Produces: `images_arch.images_from_compose_config(config)`는 `build`가 있는 서비스를 제외한 `image` 값의 집합을 돌려준다.

- [ ] **Step 1: 환경 확인과 브랜치**

Run (저장소 루트, Git Bash):

```bash
python --version
docker version --format 'server={{.Server.Version}}'
docker compose version
git status --short
```

Expected: Python 3.9 이상, Docker 서버 버전 출력, Compose v2 이상, 작업 트리가 깨끗하다. Docker 서버 버전이 안 나오면 Docker Desktop을 먼저 켠다.

사용자에게 커밋 허용 여부를 한 번 묻는다. 허용하면 `git switch -c infra/feat/local-stack-contracts-S15P31A302-19`로 브랜치를 만든 뒤 시작한다. 허용하지 않으면 커밋 단계를 모두 건너뛴다.

- [ ] **Step 2: 실패하는 테스트 추가**

````diff
diff --git a/infra/ci/tests/test_images_arch.py b/infra/ci/tests/test_images_arch.py
--- a/infra/ci/tests/test_images_arch.py
+++ b/infra/ci/tests/test_images_arch.py
@@ -43,6 +43,10 @@ class SourcesTest(unittest.TestCase):
         cfg = {"services": {"a": {"image": "x:1"}, "b": {"build": {"context": "."}}, "c": {"image": "y:2"}}}
         self.assertEqual(ia.images_from_compose_config(cfg), {"x:1", "y:2"})
 
+    def test_compose_service_with_build_is_not_looked_up_in_a_registry(self):
+        cfg = {"services": {"a": {"image": "x:1"}, "b": {"image": "fit/b:1", "build": {"context": "."}}}}
+        self.assertEqual(ia.images_from_compose_config(cfg), {"x:1"})
+
     def test_shell_vars_images_ignore_comments_and_other_variables(self):
         text = "# comment\nFOO_IMAGE=a/b:1\nBAR=not-an-image\nBAZ_IMAGE=c:2\n"
         self.assertEqual(ia.images_from_shell_vars(text), {"a/b:1", "c:2"})
````

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `python infra/ci/tests/test_images_arch.py`

Expected: `FAIL: test_compose_service_with_build_is_not_looked_up_in_a_registry`, `Items in the first set but not the second: 'fit/b:1'`, 마지막 줄 `FAILED (failures=1)`

- [ ] **Step 4: 구현**

````diff
diff --git a/infra/ci/images_arch.py b/infra/ci/images_arch.py
--- a/infra/ci/images_arch.py
+++ b/infra/ci/images_arch.py
@@ -86,7 +86,9 @@ def images_from_dockerfile(text: str) -> tuple[set[str], set[str]]:
 
 
 def images_from_compose_config(config: dict) -> set[str]:
-    return {s["image"] for s in (config.get("services") or {}).values() if s.get("image")}
+    """services.*.image. build가 있는 서비스의 image는 이 저장소의 Dockerfile이 만드는 이름이라 레지스트리에 없으므로 제외한다.
+    그 Dockerfile의 FROM은 --dockerfile로 검사한다."""
+    return {s["image"] for s in (config.get("services") or {}).values() if s.get("image") and not s.get("build")}
 
 
 def images_from_shell_vars(text: str) -> set[str]:
````

- [ ] **Step 5: 테스트 통과 확인**

Run: `python infra/ci/tests/test_images_arch.py`

Expected: `Ran 11 tests` 다음에 `OK`

- [ ] **Step 6: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/ci/images_arch.py infra/ci/tests/test_images_arch.py
git commit -m "feat(infra): compose에서 build가 있는 서비스는 이미지 조회에서 제외"
```

---

### Task 2: env 계약, 예제 파일, 계약 일치 검사

**목표:** 서비스가 읽는 환경변수의 키를 문서 한 곳(`env.md`)에 정하고, 예제 파일이 그 표와 어긋나지 않게 검사한다.

**Files:**
- Create: `docs/infra/contracts/env.md`
- Create: `docs/infra/contracts/README.md`
- Create: `infra/app/app.env.example`
- Create: `infra/app/migrate.env.example`
- Create: `infra/local/local.env.example`
- Create: `infra/ci/check_env_contract.py`
- Test: `infra/ci/tests/test_check_env_contract.py`

**Interfaces:**
- Produces:
  - `check_env_contract.check_contract(text: str, root: Path, contract_path: str = "<contract>") -> list[Issue]`, `Issue(path, line, rule, detail)`
  - `check_env_contract.main(argv: list[str]) -> int`
- CLI: `python infra/ci/check_env_contract.py [--contract 문서] [--root 디렉터리]`. 기본은 `docs/infra/contracts/env.md`와 현재 디렉터리다. 문제마다 `FAIL <파일> <규칙> <키·그룹·경로>`를 출력하고 하나라도 있으면 종료 코드 1이다. 값은 출력하지 않는다.
- 규칙 이름: `unknown-key`, `missing-required`, `missing-file`, `unknown-group`, `duplicate-row`, `bad-required-flag`, `empty-contract`.
- 계약 문서의 표 두 개를 읽는다. 첫 칸이 소문자 `그룹`이고 둘째 칸이 예제 파일 경로인 행은 파일 대응, 첫 칸이 대문자 `KEY`이고 둘째 칸이 그룹(쉼표로 여러 개)이고 셋째 칸이 `O`(필수) 또는 `X`(선택)인 행은 키 목록이다.

키 이름은 Spring Boot의 relaxed binding(`SPRING_DATASOURCE_URL` 등)을 따라 BE 코드가 따로 매핑하지 않아도 되게 했다. 나머지 이름과 필수 여부는 BE·프런트 팀과 합의해야 하는 제안이다.

- [ ] **Step 1: 계약 문서 작성**

`docs/infra/contracts/env.md`:

````markdown
# 환경변수 계약

서비스가 읽는 환경변수의 키 목록이다. 값은 서버의 `/etc/fit/*.env`에만 두고 저장소에는 `*.env.example`(키와 자리표시자)만 둔다([design.md](../design.md) 12.4절, 13.2절).

- 상태: **제안**. BE·프런트 팀과 M1 전에 합의한다([README.md](README.md)).
- 형식: `KEY=VALUE`만 쓴다. 공백, 따옴표, `#`, `$`, 백슬래시, 백틱, CRLF를 금지한다. `check_env_files.py`가 검사한다.
- 일치: 아래 표와 예제 파일의 키는 `infra/ci/check_env_contract.py`가 맞춰 본다. 예제 파일에 있는 키는 표에 있어야 하고, 필수 키는 예제 파일에 있어야 한다. 키를 바꾸면 이 표와 예제 파일을 함께 고친다.
- 자리표시자: 예제의 `REPLACE_ME`는 비밀이 아직 없다는 표시다. BE는 이 값이나 비어 있는 값으로는 기동을 거부한다(BE 계약 #8).
- `$`가 필요한 값(bcrypt 해시 등)은 base64로 인코딩해 둔다(design.md 13.2절).

## 파일 대응

| 그룹 | 예제 파일 | 소비자 |
|---|---|---|
| `app` | `infra/app/app.env.example` | BE 웹 컨테이너(`/etc/fit/dev.env`, `/etc/fit/prod.env`) |
| `migrate` | `infra/app/migrate.env.example` | 마이그레이션 일회성 컨테이너. DDL 자격만 담고 웹 컨테이너에는 넣지 않는다 |
| `local` | `infra/local/local.env.example` | 로컬 개발 스택(`infra/local/compose.yml`) |

이 문서를 만든 계획 이후의 계획이 `data`, `edge`, `obs`, `ops` 그룹을 같은 표에 더한다(design.md 13.2절의 파일 구분).

## 키 목록

필수가 `O`이면 그 그룹의 예제 파일에 반드시 있어야 하고 `X`이면 선택이다.

| 키 | 그룹 | 필수 | 설명 |
|---|---|---|---|
| `APP_ENV` | app, migrate | O | 환경 이름 `dev` 또는 `prod`. 부팅 때 DB 이름, Redis 호스트, OpenSearch 접두사가 이 값과 맞는지 검사한다 |
| `SPRING_PROFILES_ACTIVE` | app, migrate | O | 웹은 `dev` 또는 `prod`, 마이그레이션 컨테이너는 `migrate` |
| `TZ` | app, migrate | O | `Asia/Seoul` |
| `SPRING_DATASOURCE_URL` | app, migrate | O | JDBC URL. 환경별 DB는 `fit_dev`, `fit_prod` |
| `SPRING_DATASOURCE_USERNAME` | app, migrate | O | app은 `fit_dev_app`·`fit_prod_app`(DML), migrate는 `fit_migrator`(DDL) |
| `SPRING_DATASOURCE_PASSWORD` | app, migrate | O | 비밀 |
| `SPRING_DATA_REDIS_HOST` | app | O | `redis-dev` 또는 `redis-prod` |
| `SPRING_DATA_REDIS_PORT` | app | O | `6379` |
| `SPRING_DATA_REDIS_PASSWORD` | app | O | 비밀(requirepass) |
| `OPENSEARCH_URL` | app | O | `http://opensearch:9200` |
| `OPENSEARCH_INDEX_PREFIX` | app | O | `dev-` 또는 `prod-` |
| `S3_ENDPOINT` | app | O | Garage S3 API. 서버는 `http://garage:3900` |
| `S3_REGION` | app | O | `garage` |
| `S3_BUCKET` | app, local | O | `fit-dev-photos` 또는 `fit-prod-photos` |
| `S3_ACCESS_KEY` | app, local | O | 환경 전용 키 |
| `S3_SECRET_KEY` | app, local | O | 비밀 |
| `S3_PATH_STYLE` | app | O | `true`. Garage는 path-style을 쓴다 |
| `JWT_SECRET` | app | O | 비밀. 서명 방식은 BE 팀이 정한다 |
| `MODAL_BASE_URL` | app | O | Modal 엔드포인트의 기준 URL. 환경별 앱이 다르다 |
| `MODAL_KEY` | app | O | `Modal-Key` 헤더 값. 비밀 |
| `MODAL_SECRET` | app | O | `Modal-Secret` 헤더 값. 비밀 |
| `MODAL_ENABLED` | app | O | 킬스위치. `false`면 키워드 검색으로 대체한다 |
| `GMS_BASE_URL` | app | O | GMS(SSAFY LLM API) 기준 URL |
| `GMS_API_KEY` | app | O | 비밀 |
| `GMS_ENABLED` | app | O | 킬스위치 |
| `BATCH_ENABLED` | app | O | 새벽 배치. dev 기본값은 `false` |
| `MODAL_TIMEOUT_MS` | app | X | 일반 호출 타임아웃 |
| `MODAL_COLD_START_TIMEOUT_MS` | app | X | 첫 호출(콜드 스타트) 타임아웃 |
| `MODAL_DAILY_CALL_BUDGET` | app | X | 하루 호출 예산(Redis 카운터) |
| `GMS_DAILY_CALL_BUDGET` | app | X | 하루 호출 예산 |
| `APIFY_TOKEN` | app | X | 비밀. 리뷰 수집을 쓸 때만 |
| `APIFY_ENABLED` | app | X | 킬스위치 |
| `PUSH_ENABLED` | app | X | 웹 푸시 킬스위치. 방식은 미정이다(design.md 16절) |
| `PUSH_VAPID_PUBLIC_KEY` | app | X | VAPID 방식일 때 |
| `PUSH_VAPID_PRIVATE_KEY` | app | X | VAPID 방식일 때. 비밀 |
| `PUSH_VAPID_SUBJECT` | app | X | VAPID 방식일 때 `mailto:` 주소 |
| `FIT_LOCAL_PG_PORT` | local | X | 호스트에 게시하는 Postgres 포트. 기본 `15432` |
| `FIT_LOCAL_REDIS_PORT` | local | X | Redis 포트. 기본 `16379` |
| `FIT_LOCAL_S3_PORT` | local | X | Garage S3 API 포트. 기본 `13900` |
| `FIT_LOCAL_S3_WEB_PORT` | local | X | Garage 웹 엔드포인트 포트. 기본 `13902` |
| `FIT_LOCAL_OPENSEARCH_PORT` | local | X | OpenSearch 포트. 기본 `19200` |
| `POSTGRES_PASSWORD` | local | O | Postgres 관리자(`postgres`) 비밀번호 |
| `FIT_MIGRATOR_PASSWORD` | local | O | `fit_migrator` 비밀번호 |
| `FIT_DEV_APP_PASSWORD` | local | O | `fit_dev_app` 비밀번호 |
| `REDIS_PASSWORD` | local | O | Redis 비밀번호 |
| `GARAGE_RPC_SECRET` | local | O | Garage RPC 비밀. 64자리 16진수 |
| `GARAGE_ADMIN_TOKEN` | local | O | Garage 관리 API 토큰 |

로컬 그룹의 값은 개발용 가짜 값이다. 서버 값으로 쓰지 않는다.

## 프런트 런타임 설정 (`/config.json`)

번들에는 환경 값을 넣지 않고 시작할 때 `/config.json`을 받아 쓴다(design.md 12.5절 #3). 브라우저에 공개되는 값만 둔다. 이 표는 파일이 없어 검사기가 보지 않는다.

| 키 | 필수 | 설명 |
|---|---|---|
| `env` | O | `dev` 또는 `prod` |
| `posthogKey` | X | PostHog 공개 키 |
| `posthogHost` | X | PostHog 호스트 |
| `pushPublicKey` | X | 웹 푸시 공개 키 |
````

`docs/infra/contracts/README.md`:

````markdown
# 서비스 계약

BE, AI, 프런트 팀과 인프라가 서로 지켜야 할 규약이다. 서버에서 돌기 전에 팀이 합의해야 해서 M1 전에 검토한다([design.md](../design.md) 12절).

## 상태

| 계약 | 위치 | 합의할 팀 | 상태 | 합의일 |
|---|---|---|---|---|
| 환경변수 | [env.md](env.md) | BE, 프런트 | 제안 | |
| BE | design.md 12.1절 | BE | 제안 | |
| AI(Modal 호출) | design.md 12.2절, 12.3절 | AI, BE | 제안 | |
| 프런트 | design.md 12.5절 | 프런트 | 제안 | |

- 상태는 `제안`(합의 전)과 `합의`다.
- 합의되면 이 표의 상태와 합의일을 고치고, design.md 12절의 해당 내용을 이 폴더의 문서로 옮긴다. 옮기면 design.md에는 링크만 남긴다. 12절을 가리키는 다른 절의 참조도 함께 고친다.
- 합의 뒤에 계약을 바꾸려면 영향을 받는 팀에 먼저 알린다.

## 검사

- `infra/ci/check_env_files.py`는 예제 파일의 형식을 본다.
- `infra/ci/check_env_contract.py`는 [env.md](env.md)의 표와 예제 파일의 키가 같은지 본다. 두 검사는 CI의 `lint:guards`와 `bash infra/ci/run-local-checks.sh`에서 돈다.
````

- [ ] **Step 2: 예제 파일 3개 작성**

`infra/app/app.env.example`:

````text
APP_ENV=dev
SPRING_PROFILES_ACTIVE=dev
TZ=Asia/Seoul
SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/fit_dev
SPRING_DATASOURCE_USERNAME=fit_dev_app
SPRING_DATASOURCE_PASSWORD=REPLACE_ME
SPRING_DATA_REDIS_HOST=redis-dev
SPRING_DATA_REDIS_PORT=6379
SPRING_DATA_REDIS_PASSWORD=REPLACE_ME
OPENSEARCH_URL=http://opensearch:9200
OPENSEARCH_INDEX_PREFIX=dev-
S3_ENDPOINT=http://garage:3900
S3_REGION=garage
S3_BUCKET=fit-dev-photos
S3_ACCESS_KEY=REPLACE_ME
S3_SECRET_KEY=REPLACE_ME
S3_PATH_STYLE=true
JWT_SECRET=REPLACE_ME
MODAL_BASE_URL=REPLACE_ME
MODAL_KEY=REPLACE_ME
MODAL_SECRET=REPLACE_ME
MODAL_ENABLED=true
GMS_BASE_URL=REPLACE_ME
GMS_API_KEY=REPLACE_ME
GMS_ENABLED=true
BATCH_ENABLED=false
````

`infra/app/migrate.env.example`:

````text
APP_ENV=dev
SPRING_PROFILES_ACTIVE=migrate
TZ=Asia/Seoul
SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/fit_dev
SPRING_DATASOURCE_USERNAME=fit_migrator
SPRING_DATASOURCE_PASSWORD=REPLACE_ME
````

`infra/local/local.env.example`: 개발용 가짜 값이다. 16진수 값은 gitleaks가 시크릿으로 판정하지 않도록 엔트로피가 낮은 값이다.

````text
FIT_LOCAL_PG_PORT=15432
FIT_LOCAL_REDIS_PORT=16379
FIT_LOCAL_S3_PORT=13900
FIT_LOCAL_S3_WEB_PORT=13902
FIT_LOCAL_OPENSEARCH_PORT=19200
POSTGRES_PASSWORD=local-postgres-password
FIT_MIGRATOR_PASSWORD=local-migrator-password
FIT_DEV_APP_PASSWORD=local-app-password
REDIS_PASSWORD=local-redis-password
GARAGE_RPC_SECRET=0000000000000000000000000000000000000000000000000000000000000000
GARAGE_ADMIN_TOKEN=local-admin-token
S3_BUCKET=fit-dev-photos
S3_ACCESS_KEY=GK000000000000000000000000
S3_SECRET_KEY=1111111111111111111111111111111111111111111111111111111111111111
````

예제 파일의 형식을 확인한다.

Run: `python infra/ci/check_env_files.py infra/app/app.env.example infra/app/migrate.env.example infra/local/local.env.example`

Expected: `OK env (3 file(s))`

- [ ] **Step 3: 실패하는 테스트 작성**

````python
import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_env_contract as ec  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]

CONTRACT = """\
## 파일 대응

| 그룹 | 예제 파일 | 소비자 |
|---|---|---|
| `app` | `infra/app/app.env.example` | BE |
| `local` | `infra/local/local.env.example` | 로컬 |

## 키 목록

| 키 | 그룹 | 필수 | 설명 |
|---|---|---|---|
| `APP_ENV` | app | O | 환경 |
| `DB_URL` | app, local | O | 연결 |
| `DEBUG_FLAG` | app | X | 선택 |
"""


class Workspace(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, rel: str, text: str) -> None:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8", newline="\n")

    def issues(self, contract: str = CONTRACT) -> list[tuple[str, str]]:
        return [(i.rule, i.detail) for i in ec.check_contract(contract, self.root)]


class CheckContractTest(Workspace):
    def test_consistent_contract_and_examples_pass(self):
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        self.assertEqual(self.issues(), [])

    def test_optional_key_may_be_absent_or_present(self):
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\nDEBUG_FLAG=1\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        self.assertEqual(self.issues(), [])

    def test_key_missing_from_contract_is_unknown(self):
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\nNEW_KEY=1\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        self.assertEqual(self.issues(), [("unknown-key", "NEW_KEY")])

    def test_key_listed_only_for_another_group_is_unknown(self):
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.write("infra/local/local.env.example", "DB_URL=y\nAPP_ENV=dev\n")
        self.assertEqual(self.issues(), [("unknown-key", "APP_ENV")])

    def test_missing_required_key_is_reported_per_group(self):
        self.write("infra/app/app.env.example", "DEBUG_FLAG=1\n")
        self.write("infra/local/local.env.example", "\n")
        self.assertEqual(
            sorted(self.issues()),
            [("missing-required", "APP_ENV"), ("missing-required", "DB_URL"), ("missing-required", "DB_URL")],
        )

    def test_missing_example_file_is_reported(self):
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.assertEqual(self.issues(), [("missing-file", "infra/local/local.env.example")])

    def test_group_without_file_mapping_is_reported(self):
        contract = CONTRACT + "| `EXTRA` | ghost | X | 설명 |\n"
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        self.assertEqual(self.issues(contract), [("unknown-group", "ghost")])

    def test_duplicate_row_is_reported(self):
        contract = CONTRACT + "| `APP_ENV` | app | O | 또 |\n"
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        self.assertEqual(self.issues(contract), [("duplicate-row", "APP_ENV/app")])

    def test_bad_required_flag_is_reported(self):
        contract = CONTRACT.replace("| `DEBUG_FLAG` | app | X |", "| `DEBUG_FLAG` | app | maybe |")
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        self.assertEqual(self.issues(contract), [("bad-required-flag", "DEBUG_FLAG")])

    def test_contract_without_keys_is_an_error(self):
        self.assertEqual(self.issues("# 비어 있음\n"), [("empty-contract", "-")])


class MainTest(Workspace):
    def run_main(self, *argv: str) -> tuple[int, str]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = ec.main(list(argv))
        return code, out.getvalue()

    def test_main_ok_and_fail_exit_codes(self):
        self.write("docs/contract.md", CONTRACT)
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        code, out = self.run_main("--contract", str(self.root / "docs/contract.md"), "--root", str(self.root))
        self.assertEqual(code, 0)
        self.assertIn("OK env-contract", out)
        self.write("infra/app/app.env.example", "APP_ENV=dev\n")
        code, out = self.run_main("--contract", str(self.root / "docs/contract.md"), "--root", str(self.root))
        self.assertEqual(code, 1)
        self.assertIn("missing-required DB_URL", out)

    def test_output_never_contains_values(self):
        self.write("docs/contract.md", CONTRACT)
        self.write("infra/app/app.env.example", "APP_ENV=dev\nDB_URL=x\nSTRAY=super-secret-value\n")
        self.write("infra/local/local.env.example", "DB_URL=y\n")
        _, out = self.run_main("--contract", str(self.root / "docs/contract.md"), "--root", str(self.root))
        self.assertIn("unknown-key STRAY", out)
        self.assertNotIn("super-secret-value", out)


class RepositoryContractTest(unittest.TestCase):
    def test_real_contract_matches_real_examples(self):
        text = (ROOT / "docs/infra/contracts/env.md").read_text(encoding="utf-8")
        problems = [str(i) for i in ec.check_contract(text, ROOT, "docs/infra/contracts/env.md")]
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
````

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `python infra/ci/tests/test_check_env_contract.py`

Expected: `ModuleNotFoundError: No module named 'check_env_contract'`

- [ ] **Step 5: 구현**

````python
#!/usr/bin/env python3
"""env 계약(docs/infra/contracts/env.md)과 예제 파일(*.env.example)의 키가 일치하는지 검사한다. 값은 읽어도 출력하지 않는다.

계약 문서의 표를 읽는다.
  파일 대응 표: 첫 칸이 `그룹`(소문자), 둘째 칸이 `예제 파일 경로`인 행
  키 목록 표:   첫 칸이 `KEY`(대문자), 둘째 칸이 그룹(쉼표로 여러 개), 셋째 칸이 필수 여부(O 또는 X)인 행

규칙(출력은 `FAIL <파일>[:줄] <규칙> <키·그룹·경로>` 형식이고 값은 싣지 않는다):
  unknown-key        예제 파일에 있는 키가 계약에 없다(그 그룹의 키가 아니어도 같다)
  missing-required   계약에서 필수인 키가 예제 파일에 없다
  missing-file       계약이 가리키는 예제 파일이 없다
  unknown-group      키 목록이 파일 대응 표에 없는 그룹을 쓴다
  duplicate-row      같은 키와 그룹이 두 번 나온다
  bad-required-flag  필수 칸이 O나 X가 아니다
  empty-contract     키 목록이 비어 있다
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import check_env_files

DEFAULT_CONTRACT = "docs/infra/contracts/env.md"
GROUP_RE = re.compile(r"^`([a-z][a-z0-9-]*)`$")
KEY_RE = re.compile(r"^`([A-Z][A-Z0-9_]*)`$")
PATH_RE = re.compile(r"^`([^`]+)`$")


@dataclass(frozen=True)
class Issue:
    path: str
    line: int  # 0이면 파일 전체
    rule: str
    detail: str

    def __str__(self) -> str:
        where = f"{self.path}:{self.line}" if self.line else self.path
        return f"FAIL {where} {self.rule} {self.detail}"


def split_cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def check_contract(text: str, root: Path, contract_path: str = "<contract>") -> list[Issue]:
    issues: list[Issue] = []
    files: dict[str, str] = {}
    rows: list[tuple[int, str, list[str], bool]] = []  # (줄, 키, 그룹들, 필수)
    seen: set[tuple[str, str]] = set()
    for n, line in enumerate(text.splitlines(), start=1):
        if not line.startswith("|"):
            continue
        cells = split_cells(line)
        if len(cells) < 2:
            continue
        group = GROUP_RE.match(cells[0])
        key = KEY_RE.match(cells[0])
        if group and PATH_RE.match(cells[1]):
            files[group.group(1)] = PATH_RE.match(cells[1]).group(1)
        elif key and len(cells) >= 3:
            groups = [g.strip() for g in cells[1].split(",") if g.strip()]
            if cells[2] not in ("O", "X"):
                issues.append(Issue(contract_path, n, "bad-required-flag", key.group(1)))
            for g in groups:
                if (key.group(1), g) in seen:
                    issues.append(Issue(contract_path, n, "duplicate-row", f"{key.group(1)}/{g}"))
                seen.add((key.group(1), g))
            rows.append((n, key.group(1), groups, cells[2] == "O"))
    if not rows:
        return [Issue(contract_path, 0, "empty-contract", "-")]

    for n, key, groups, _ in rows:
        for g in groups:
            if g not in files:
                issues.append(Issue(contract_path, n, "unknown-group", g))

    for group, rel in sorted(files.items()):
        example = root / rel
        if not example.is_file():
            issues.append(Issue(contract_path, 0, "missing-file", rel))
            continue
        _, present = check_env_files.check_text(example.read_bytes(), rel)
        allowed = {key for _, key, groups, _ in rows if group in groups}
        required = {key for _, key, groups, req in rows if group in groups and req}
        for key in sorted(present):
            if key not in allowed:
                issues.append(Issue(rel, 0, "unknown-key", key))
        for key in sorted(required - set(present)):
            issues.append(Issue(rel, 0, "missing-required", key))
    return issues


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--contract", default=DEFAULT_CONTRACT, help="계약 문서 경로")
    ap.add_argument("--root", default=".", help="예제 파일 경로의 기준 디렉터리(저장소 루트)")
    args = ap.parse_args(argv)
    contract = Path(args.contract)
    issues = check_contract(contract.read_text(encoding="utf-8"), Path(args.root), contract.as_posix())
    for i in issues:
        print(i)
    if issues:
        print(f"{len(issues)} issue(s). 계약 표와 예제 파일을 함께 고친다")
        return 1
    print("OK env-contract")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
````

- [ ] **Step 6: 테스트 통과 확인**

Run: `python infra/ci/tests/test_check_env_contract.py`

Expected: `Ran 13 tests` 다음에 `OK`. 마지막 테스트(`RepositoryContractTest`)는 이 저장소의 실제 계약과 예제를 검사한다.

Run: `python infra/ci/check_env_contract.py`

Expected: `OK env-contract`

- [ ] **Step 7: 새 파일에 CRLF가 없는지 확인**

Run:

```bash
python infra/ci/check_eol.py docs/infra/contracts/env.md docs/infra/contracts/README.md infra/app/app.env.example infra/app/migrate.env.example infra/local/local.env.example infra/ci/check_env_contract.py infra/ci/tests/test_check_env_contract.py
```

Expected: `OK eol (7 file(s) checked)`

- [ ] **Step 8: 커밋 (사용자가 허용한 경우에만)**

```bash
git add docs/infra/contracts infra/app infra/local/local.env.example infra/ci/check_env_contract.py infra/ci/tests/test_check_env_contract.py
git commit -m "feat(infra): env 계약 문서, 예제 파일, 계약 일치 검사 추가"
```

---

### Task 3: 로컬 스택 구성 파일

**목표:** Postgres, Redis, Garage, OpenSearch+nori를 profile로 나눠 켤 수 있는 compose 프로젝트를 만든다.

**Files:**
- Create: `infra/local/compose.yml`
- Create: `infra/local/garage/garage.toml`
- Create: `infra/local/opensearch/Dockerfile`

**Interfaces:**
- Consumes: `infra/local/local.env.example`(Task 2), `images_arch.py`(Task 1)
- Produces: compose 프로젝트 `fit-local`. profile `core`(postgres, redis, garage)와 `search`(opensearch). 호스트 게시 포트는 `127.0.0.1:${FIT_LOCAL_*_PORT:-기본값}`.

설계와 같게 한 것: Postgres는 `command:` 플래그로 튜닝하고(7.1절), Redis는 `maxmemory-policy noeviction`과 AOF everysec와 requirepass(7.3절), OpenSearch는 single-node에 보안 플러그인을 끄고 `action.destructive_requires_name=true`(7.2절), Garage는 설정을 디렉터리로 마운트한다(7.4절). 줄인 것: 노트북에 맞춰 OpenSearch 힙은 512MB(서버는 768MB), Redis는 한 개, 망은 나누지 않는다.

- [ ] **Step 1: compose 파일 작성**

````yaml
# 로컬 개발용 스택. 서버 A의 fit-data와 같은 이미지·설정 방향을 쓰되 노트북에 맞게 줄였다.
# profile: core(postgres, redis, garage), search(nori를 넣은 opensearch). 사용법은 infra/local/README.md.
# 모든 호스트 게시는 127.0.0.1 바인딩이다(ports_invariant.py가 검사한다).
name: fit-local

services:
  postgres:
    image: pgvector/pgvector:0.8.7-pg16
    profiles: [core]
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?}
    command:
      - postgres
      - -c
      - shared_buffers=128MB
      - -c
      - max_connections=60
      - -c
      - idle_in_transaction_session_timeout=60000
      - -c
      - shared_preload_libraries=pg_stat_statements
    ports:
      - 127.0.0.1:${FIT_LOCAL_PG_PORT:-15432}:5432
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: [CMD-SHELL, pg_isready -U postgres -d postgres]
      interval: 5s
      timeout: 3s
      retries: 12

  redis:
    image: redis:7.4.9-alpine
    profiles: [core]
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:?}
      REDISCLI_AUTH: ${REDIS_PASSWORD:?}
    command:
      - sh
      - -c
      - exec redis-server --requirepass "$$REDIS_PASSWORD" --maxmemory 96mb --maxmemory-policy noeviction --appendonly yes --appendfsync everysec
    ports:
      - 127.0.0.1:${FIT_LOCAL_REDIS_PORT:-16379}:6379
    volumes:
      - redisdata:/data
    healthcheck:
      test: [CMD, redis-cli, ping]
      interval: 5s
      timeout: 3s
      retries: 12

  garage:
    image: dxflrs/garage:v2.4.1
    profiles: [core]
    command: [/garage, -c, /etc/garage/garage.toml, server]
    environment:
      GARAGE_RPC_SECRET: ${GARAGE_RPC_SECRET:?}
      GARAGE_ADMIN_TOKEN: ${GARAGE_ADMIN_TOKEN:?}
    ports:
      - 127.0.0.1:${FIT_LOCAL_S3_PORT:-13900}:3900
      - 127.0.0.1:${FIT_LOCAL_S3_WEB_PORT:-13902}:3902
    volumes:
      - ./garage:/etc/garage:ro
      - garage-meta:/var/lib/garage/meta
      - garage-data:/var/lib/garage/data
    healthcheck:
      test: [CMD, /garage, -c, /etc/garage/garage.toml, status]
      interval: 5s
      timeout: 5s
      retries: 12

  opensearch:
    build:
      context: ./opensearch
    profiles: [search]
    environment:
      discovery.type: single-node
      DISABLE_SECURITY_PLUGIN: "true"
      DISABLE_INSTALL_DEMO_CONFIG: "true"
      OPENSEARCH_JAVA_OPTS: -Xms512m -Xmx512m
      action.destructive_requires_name: "true"
    mem_limit: 1g
    ports:
      - 127.0.0.1:${FIT_LOCAL_OPENSEARCH_PORT:-19200}:9200
    volumes:
      - osdata:/usr/share/opensearch/data
    healthcheck:
      test: [CMD-SHELL, "curl -fsS 'http://localhost:9200/_cluster/health?wait_for_status=yellow&timeout=5s' >/dev/null"]
      interval: 10s
      timeout: 8s
      retries: 18

volumes:
  pgdata:
  redisdata:
  garage-meta:
  garage-data:
  osdata:
````

- [ ] **Step 2: Garage 설정 작성**

비밀(`GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`)은 설정 파일이 아니라 환경변수로 받는다.

````toml
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "lmdb"
replication_factor = 1

rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"

[s3_web]
bind_addr = "[::]:3902"
root_domain = ".web.garage.localhost"
index = "index.html"

[admin]
api_bind_addr = "[::]:3903"
````

- [ ] **Step 3: OpenSearch 이미지 작성**

````dockerfile
FROM opensearchproject/opensearch:3.9.0
RUN /usr/share/opensearch/bin/opensearch-plugin install --batch analysis-nori
````

- [ ] **Step 4: 정적 검증 (컨테이너를 켜지 않는다)**

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
docker compose -f infra/local/compose.yml --env-file infra/local/local.env.example --profile '*' config -q && echo "compose config OK"
python infra/ci/ports_invariant.py --env-file infra/local/local.env.example infra/local/compose.yml
python infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/local/compose.yml --env-file infra/local/local.env.example --dockerfile infra/local/opensearch/Dockerfile
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml infra/local/compose.yml; echo "yamllint exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$HADOLINT_IMAGE" hadolint infra/local/opensearch/Dockerfile; echo "hadolint exit=$?"
```

Expected:

```text
compose config OK
OK ports (4 service(s))
OK arch linux/arm64,linux/amd64 (4 image(s))
yamllint exit=0
hadolint exit=0
```

`OK arch`의 4개는 pgvector, redis, garage와 OpenSearch 기반 이미지다. `build`가 있는 opensearch 서비스는 Task 1 덕분에 compose에서는 빠지고 Dockerfile의 `FROM`으로 검사된다.

- [ ] **Step 5: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/local/compose.yml infra/local/garage infra/local/opensearch
git commit -m "feat(infra): 로컬 개발 스택 compose 구성 추가"
```

---

### Task 4: `fit-local.sh`와 실제 기동 확인

**목표:** 한 명령으로 스택을 켜고 DB·role·버킷을 만들고 서버와 같은 구조가 동작하는지 점검한다.

**Files:**
- Create: `infra/local/fit-local.sh`

**Interfaces:**
- Consumes: `infra/local/compose.yml`, `infra/local/local.env.example`(Task 2, 3)
- Produces: `bash infra/local/fit-local.sh up [--search] | verify | down | reset`
  - `up`: 컨테이너를 켜고(`--wait`로 헬스 대기) DB·role(`fit_migrator`는 DDL, `fit_dev_app`은 DML)과 버킷·키를 만들고 점검한다. 몇 번 실행해도 같은 결과다.
  - `verify`: 점검만 한다. 실행 중인 서비스만 보고 나머지는 SKIP이다. 하나라도 FAIL이면 종료 코드 1이다.
  - `down`은 중지(데이터 유지), `reset`은 중지하고 볼륨을 지운다.
- 설정은 `infra/local/.env`(env 예제를 복사, git이 무시)이고 `FIT_LOCAL_ENV`로 다른 파일을, `FIT_LOCAL_PROJECT`로 다른 프로젝트 이름을 줄 수 있다.
- 점검 항목: Postgres(두 role의 비밀번호 접속, pgvector 확장, migrator의 DDL, app role의 DML 가능과 DDL 거부), Redis(비밀번호 접속, 비밀번호 없이는 거부, `noeviction`), Garage(서명한 PUT, 서명 없는 GET 거부, 웹 엔드포인트 읽기, 서명한 DELETE), OpenSearch(`analysis-nori`, `opensearch-knn`, nori 분석기).

postgres의 `pg_hba`는 컨테이너 안의 localhost 접속을 비밀번호 없이 허용한다. 그래서 점검은 호스트 이름(`postgres`)으로 접속해 비밀번호를 실제로 확인한다.

- [ ] **Step 1: 스크립트 작성**

````bash
#!/usr/bin/env bash
# 로컬 개발 스택(infra/local/compose.yml) 관리.
#   bash infra/local/fit-local.sh up [--search]  # 기동, 헬스 대기, DB·버킷 초기화, 점검
#   bash infra/local/fit-local.sh verify         # 떠 있는 스택 점검
#   bash infra/local/fit-local.sh down           # 중지(데이터 유지)
#   bash infra/local/fit-local.sh reset          # 중지하고 볼륨 삭제(데이터 초기화)
# 설정은 infra/local/.env다(infra/local/local.env.example을 복사한다). FIT_LOCAL_PROJECT로 프로젝트 이름을 바꿔 여러 벌을 띄울 수 있다.
# 필요한 것: docker compose, curl 7.75 이상(garage 점검). bash 3.2(macOS)에서도 돈다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
ENV_FILE="${FIT_LOCAL_ENV:-infra/local/.env}"
PROJECT="${FIT_LOCAL_PROJECT:-fit-local}"
if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE 이 없다. cp infra/local/local.env.example $ENV_FILE 로 만든다" >&2
  exit 2
fi
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac

dc() { docker compose -p "$PROJECT" -f infra/local/compose.yml --env-file "$ENV_FILE" "$@"; }

# env 파일은 KEY=VALUE만 허용하는 보수적 형식(check_env_files.py)이라 셸에서 그대로 읽어도 안전하다.
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

psql_admin() { dc exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

# 멱등이다. role 비밀번호는 매번 env 값으로 맞춘다. 서버의 ensure-databases.sh(계획 1D)와 같은 role 구조를 쓴다.
ensure_databases() {
  psql_admin -d postgres <<SQL
SELECT 'CREATE ROLE fit_migrator LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_migrator') \gexec
SELECT 'CREATE ROLE fit_dev_app LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_dev_app') \gexec
ALTER ROLE fit_migrator PASSWORD '${FIT_MIGRATOR_PASSWORD}';
ALTER ROLE fit_dev_app PASSWORD '${FIT_DEV_APP_PASSWORD}';
ALTER ROLE fit_dev_app SET statement_timeout = '30s';
SELECT 'CREATE DATABASE fit_dev OWNER fit_migrator' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fit_dev') \gexec
SQL
  psql_admin -d fit_dev <<SQL
SET client_min_messages = warning;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
REVOKE ALL ON DATABASE fit_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE fit_dev TO fit_dev_app;
GRANT USAGE ON SCHEMA public TO fit_dev_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fit_dev_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fit_dev_app;
SQL
}

# RUST_LOG=warn: garage CLI가 매 호출마다 내는 INFO 로그를 줄인다.
garage() { dc exec -T -e RUST_LOG=warn garage /garage -c /etc/garage/garage.toml "$@"; }

# 멱등이다. 단일 노드라도 레이아웃을 한 번 적용해야 버킷을 만들 수 있다.
init_garage() {
  local node
  if garage status 2>/dev/null | grep -q "NO ROLE ASSIGNED"; then
    node="$(garage status 2>/dev/null | awk '/^[0-9a-f]{16}/ {print $1; exit}')"
    garage layout assign -z dc1 -c 1G "$node" >/dev/null
    garage layout apply --version 1 >/dev/null
  fi
  garage bucket info "$S3_BUCKET" >/dev/null 2>&1 || garage bucket create "$S3_BUCKET" >/dev/null
  garage key info "$S3_ACCESS_KEY" >/dev/null 2>&1 || garage key import --yes -n fit-local "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
  garage bucket allow --read --write --owner "$S3_BUCKET" --key "$S3_ACCESS_KEY" >/dev/null
  garage bucket website --allow "$S3_BUCKET" >/dev/null
}

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }
check() { # check NAME CMD ARGS... : 명령이 성공하면 통과
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name"; fi
}

# 같은 컨테이너 안에서도 호스트 이름(postgres)으로 접속하면 pg_hba가 비밀번호를 요구한다(localhost는 trust).
pg_as() { # pg_as ROLE PASSWORD SQL
  dc exec -T -e "PGPASSWORD=$2" postgres psql -h postgres -U "$1" -d fit_dev -v ON_ERROR_STOP=1 -qAt -c "$3"
}

verify_postgres() {
  check "postgres: fit_migrator가 비밀번호로 접속" pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" "select 1"
  check "postgres: fit_dev_app이 비밀번호로 접속" pg_as fit_dev_app "$FIT_DEV_APP_PASSWORD" "select 1"
  check "postgres: pgvector 확장" pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" "select 1 from pg_extension where extname = 'vector'"
  check "postgres: fit_migrator가 DDL 가능" pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" "drop table if exists _verify_probe; create table _verify_probe (id int)"
  check "postgres: fit_dev_app이 migrator의 새 테이블에 DML 가능" pg_as fit_dev_app "$FIT_DEV_APP_PASSWORD" "insert into _verify_probe values (1); select id from _verify_probe; delete from _verify_probe"
  if pg_as fit_dev_app "$FIT_DEV_APP_PASSWORD" "create table _verify_denied (id int)" >/dev/null 2>&1; then
    fail "postgres: fit_dev_app의 DDL은 거부돼야 한다"
    pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" "drop table if exists _verify_denied" >/dev/null 2>&1 || true
  else
    pass "postgres: fit_dev_app의 DDL 거부"
  fi
  pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" "drop table if exists _verify_probe" >/dev/null 2>&1 || true
}

verify_redis() {
  local out
  out="$(dc exec -T redis redis-cli ping 2>&1 || true)"
  if [ "$out" = "PONG" ]; then pass "redis: 비밀번호로 접속"; else fail "redis: 비밀번호로 접속"; fi
  out="$(dc exec -T -e REDISCLI_AUTH= redis redis-cli ping 2>&1 || true)"
  case "$out" in
    *NOAUTH*) pass "redis: 비밀번호 없이는 거부" ;;
    *) fail "redis: 비밀번호 없이는 거부" ;;
  esac
  out="$(dc exec -T redis redis-cli config get maxmemory-policy 2>&1 | tail -n 1 || true)"
  if [ "$out" = "noeviction" ]; then pass "redis: maxmemory-policy noeviction"; else fail "redis: maxmemory-policy noeviction"; fi
}

# 상태 코드는 -w로 마지막 줄에 받는다(curl의 `-o /dev/null`은 Git Bash의 Windows용 curl에서 쓰기 오류가 난다).
STATUS_FMT='\n%{http_code}'
http_code() { curl -sS "$@" -w "$STATUS_FMT" | tail -n 1; }
s3_code() { curl -sS --aws-sigv4 "aws:amz:garage:s3" --user "$S3_ACCESS_KEY:$S3_SECRET_KEY" "$@" -w "$STATUS_FMT" | tail -n 1; }

verify_garage() {
  local base="http://127.0.0.1:${FIT_LOCAL_S3_PORT}/${S3_BUCKET}/confirmed/_verify.txt" code body
  if ! curl --help all 2>/dev/null | grep -q -- --aws-sigv4; then
    skip "garage: curl이 --aws-sigv4를 지원하지 않아 건너뜀(curl 7.75 이상 필요)"
    return
  fi
  code="$(printf 'fit-local-ok' | s3_code -X PUT --data-binary @- "$base" || true)"
  if [ "$code" = "200" ]; then pass "garage: 서명한 S3 PUT"; else fail "garage: 서명한 S3 PUT (HTTP $code)"; fi
  code="$(http_code "$base" || true)"
  if [ "$code" = "403" ]; then pass "garage: 익명 S3 GET 거부"; else fail "garage: 익명 S3 GET 거부 (HTTP $code)"; fi
  body="$(curl -sS -H "Host: ${S3_BUCKET}.web.garage.localhost" "http://127.0.0.1:${FIT_LOCAL_S3_WEB_PORT}/confirmed/_verify.txt" || true)"
  if [ "$body" = "fit-local-ok" ]; then pass "garage: 웹 엔드포인트 공개 읽기"; else fail "garage: 웹 엔드포인트 공개 읽기"; fi
  code="$(s3_code -X DELETE "$base" || true)"
  if [ "$code" = "204" ]; then pass "garage: 서명한 S3 DELETE"; else fail "garage: 서명한 S3 DELETE (HTTP $code)"; fi
}

# 컨테이너 안의 curl로 호출한다. Windows용 curl은 인자의 한글을 ANSI 코드페이지로 보내 JSON이 깨진다.
os() { dc exec -T opensearch curl -fsS "$@"; }

verify_opensearch() {
  local out
  out="$(os 'http://localhost:9200/_cat/plugins?h=component' 2>&1 || true)"
  case "$out" in *analysis-nori*) pass "opensearch: analysis-nori 설치" ;; *) fail "opensearch: analysis-nori 설치" ;; esac
  case "$out" in *opensearch-knn*) pass "opensearch: k-NN 플러그인" ;; *) fail "opensearch: k-NN 플러그인" ;; esac
  out="$(os -H 'Content-Type: application/json' -d '{"analyzer":"nori","text":"맛집 추천"}' http://localhost:9200/_analyze 2>&1 || true)"
  case "$out" in *'"token"'*) pass "opensearch: nori 분석기 동작" ;; *) fail "opensearch: nori 분석기 동작" ;; esac
}

verify() {
  local running
  running="$(dc --profile '*' ps --services --status running 2>/dev/null || true)"
  FAILED=0
  case "$running" in *postgres*) verify_postgres ;; *) skip "postgres (실행 중 아님)" ;; esac
  case "$running" in *redis*) verify_redis ;; *) skip "redis (실행 중 아님)" ;; esac
  case "$running" in *garage*) verify_garage ;; *) skip "garage (실행 중 아님)" ;; esac
  case "$running" in *opensearch*) verify_opensearch ;; *) skip "opensearch (search 프로필 아님)" ;; esac
  if [ "$FAILED" -gt 0 ]; then
    printf '\n%d개 점검 실패\n' "$FAILED"
    return 1
  fi
  printf '\n로컬 스택 정상\n'
}

up() {
  local profiles=(--profile core)
  if [ "${1:-}" = "--search" ]; then profiles+=(--profile search); fi
  dc "${profiles[@]}" up -d --build --wait
  ensure_databases
  init_garage
  verify
}

case "${1:-}" in
  up) shift; up "$@" ;;
  verify) verify ;;
  down) dc --profile '*' down ;;
  reset) dc --profile '*' down -v ;;
  *)
    echo "사용: bash infra/local/fit-local.sh up [--search] | verify | down | reset" >&2
    exit 2
    ;;
esac
````

- [ ] **Step 2: shellcheck 확인**

Run:

```bash
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/local/fit-local.sh; echo "shellcheck exit=$?"
```

Expected: `shellcheck exit=0`

- [ ] **Step 3: core를 빈 상태에서 켜기 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1 FIT_LOCAL_PROJECT=fit-local-verify
cp infra/local/local.env.example infra/local/.env
bash infra/local/fit-local.sh up
```

Expected(마지막 부분. 앞에는 컨테이너 상태 줄이 나온다):

```text
PASS  postgres: fit_migrator가 비밀번호로 접속
PASS  postgres: fit_dev_app이 비밀번호로 접속
PASS  postgres: pgvector 확장
PASS  postgres: fit_migrator가 DDL 가능
PASS  postgres: fit_dev_app이 migrator의 새 테이블에 DML 가능
PASS  postgres: fit_dev_app의 DDL 거부
PASS  redis: 비밀번호로 접속
PASS  redis: 비밀번호 없이는 거부
PASS  redis: maxmemory-policy noeviction
PASS  garage: 서명한 S3 PUT
PASS  garage: 익명 S3 GET 거부
PASS  garage: 웹 엔드포인트 공개 읽기
PASS  garage: 서명한 S3 DELETE
SKIP  opensearch (search 프로필 아님)

로컬 스택 정상
```

- [ ] **Step 4: 같은 `up`을 다시 실행 (멱등 확인)**

Run: `bash infra/local/fit-local.sh up`

Expected: Step 3과 같은 PASS 줄과 `로컬 스택 정상`. 오류 없이 끝난다.

- [ ] **Step 5: search를 더해 켜기 (게이트)**

처음에는 OpenSearch 이미지를 만든다(nori 플러그인 내려받기, 몇 분).

Run: `bash infra/local/fit-local.sh up --search`

Expected: Step 3의 PASS 줄에 이어 아래 세 줄이 나오고 `SKIP  opensearch` 줄은 없다.

```text
PASS  opensearch: analysis-nori 설치
PASS  opensearch: k-NN 플러그인
PASS  opensearch: nori 분석기 동작

로컬 스택 정상
```

- [ ] **Step 6: 점검이 죽은 검사가 아닌지 확인 (게이트)**

잘못된 비밀번호를 담은 env로 `verify`하면 실패해야 한다.

Run:

```bash
sed 's/^FIT_MIGRATOR_PASSWORD=.*/FIT_MIGRATOR_PASSWORD=wrong/; s/^S3_SECRET_KEY=.*/S3_SECRET_KEY=2222222222222222222222222222222222222222222222222222222222222222/' infra/local/local.env.example > infra/local/.wrong.env
FIT_LOCAL_ENV=infra/local/.wrong.env bash infra/local/fit-local.sh verify; echo "exit=$?"
rm -f infra/local/.wrong.env
```

Expected: `FAIL` 줄 7개(postgres 4개, garage 3개), `7개 점검 실패`, `exit=1`. redis 점검 3개는 PASS다(컨테이너 안의 값을 쓰므로 영향이 없다).

`infra/local/.wrong.env`는 이 확인을 위한 임시 파일이며 마지막에 정확히 그 경로만 지운다.

- [ ] **Step 7: 정리**

Run:

```bash
bash infra/local/fit-local.sh reset
rm -f infra/local/.env
docker image rm fit-local-verify-opensearch
docker volume ls --format '{{.Name}}' | grep '^fit-local-verify_' ; echo "(남은 볼륨 없음이면 위에 출력이 없다)"
```

Expected: 컨테이너, 볼륨, 망 삭제 줄이 나오고 `Untagged:`·`Deleted:` 줄이 나온 뒤 남은 볼륨 출력이 없다.

- [ ] **Step 8: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/local/fit-local.sh
git update-index --chmod=+x infra/local/fit-local.sh
git commit -m "feat(infra): 로컬 스택 기동·점검 스크립트 추가"
```

---

### Task 5: 검사 연결, 문서 동기화, 최종 게이트

**목표:** 새 compose 프로젝트와 이미지, env 계약 검사를 1A의 검사에 연결하고 문서를 구현과 맞춘다.

**Files:**
- Modify: `infra/ci/compose-projects.txt`, `infra/ci/run-local-checks.sh`, `.gitlab-ci.yml`
- Create: `infra/local/README.md`
- Modify: `infra/README.md`, `docs/infra/design.md`

**Interfaces:**
- Consumes: Task 1~4의 산출물
- Produces:
  - 포트 불변식이 `local` 프로젝트를 검사한다(`compose-projects.txt`).
  - 로컬 러너와 CI의 `lint:guards`가 `check_env_contract.py`를 돌린다. `lint:image-arch`와 러너의 `arch (로컬 스택)`이 로컬 스택 이미지를 검사한다.
  - 러너의 `--self-test`에 계약 검사의 음성 확인(`env-contract`)이 더해져 8종이 된다.

- [ ] **Step 1: 포트 검사 대상, 러너, CI 연결**

`infra/ci/compose-projects.txt`:

````diff
diff --git a/infra/ci/compose-projects.txt b/infra/ci/compose-projects.txt
--- a/infra/ci/compose-projects.txt
+++ b/infra/ci/compose-projects.txt
@@ -1,3 +1,4 @@
 # 포트 불변식(ports_invariant.py)을 검사할 compose 프로젝트 목록. 한 줄이 한 프로젝트다.
 # 형식: <라벨> <compose 파일>... [--env-file <경로>]... [--allow 서비스=포트,포트]...
 # 예:   edge infra/edge/compose.edge.yml --env-file infra/ci/ci.env
+local infra/local/compose.yml --env-file infra/local/local.env.example
````

`infra/ci/run-local-checks.sh`: `env 계약`과 `arch (로컬 스택)` 단계, 자가 테스트의 `env-contract` 항목을 더한다.

````diff
diff --git a/infra/ci/run-local-checks.sh b/infra/ci/run-local-checks.sh
--- a/infra/ci/run-local-checks.sh
+++ b/infra/ci/run-local-checks.sh
@@ -105,11 +105,14 @@ check_all() {
   else
     run_step "env 형식" "$PY" infra/ci/check_env_files.py "${envs[@]}"
   fi
+  run_step "env 계약 (표와 예제 파일)" "$PY" infra/ci/check_env_contract.py
   run_step "ports (compose 프로젝트)" "$PY" infra/ci/check_compose_projects.py
   if [ "${SKIP_ARCH:-0}" = "1" ]; then
     skip "arch (SKIP_ARCH=1)"
   else
     run_step "arch (도구 이미지)" "$PY" infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --images-from-sh infra/ci/tool-images.sh
+    # 로컬 스택은 개발자 PC(Windows·Intel Mac은 amd64, Apple Silicon은 arm64)에서 돈다
+    run_step "arch (로컬 스택)" "$PY" infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/local/compose.yml --env-file infra/local/local.env.example --dockerfile infra/local/opensearch/Dockerfile
   fi
   # 인프라 소유 파일만 엄격하게 본다. be·fe·ai는 각 팀 린트가 맡는다(스펙 6.3, 12.2). be의 Dockerfile은 오류만 막는다.
   check_tool shellcheck "$SHELLCHECK_IMAGE" 'infra/*.sh' -- shellcheck -x
@@ -145,6 +148,9 @@ EOF
   printf 'A="x"\n' >"$d/bad.env"
   printf 'services:\n  a:\n    image: x\n    ports: ["8080:80"]\n' >"$d/bad-compose.yml"
   printf 'a: 1\r\n' >"$d/crlf.yml"
+  # shellcheck disable=SC2016 # 백틱은 마크다운 표의 일부이며 확장하지 않는다
+  printf '| `A_KEY` | app | O | 설명 |\n| `app` | `x.env.example` | 소비자 |\n' >"$d/contract.md"
+  printf 'STRAY_KEY=1\n' >"$d/x.env.example"
   expect_fail shellcheck drun "$SHELLCHECK_IMAGE" shellcheck "$d/bad.sh"
   expect_fail hadolint drun "$HADOLINT_IMAGE" hadolint "$d/Dockerfile"
   expect_fail yamllint drun "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml "$d/bad.yml"
@@ -152,6 +158,7 @@ EOF
   expect_fail env-format "$PY" infra/ci/check_env_files.py "$d/bad.env"
   expect_fail ports "$PY" infra/ci/ports_invariant.py "$d/bad-compose.yml"
   expect_fail eol "$PY" infra/ci/check_eol.py "$d/crlf.yml"
+  expect_fail env-contract "$PY" infra/ci/check_env_contract.py --contract "$d/contract.md" --root "$d"
 }
 
 if [ "${1:-}" = "--self-test" ]; then
````

`.gitlab-ci.yml`: `lint:guards`에 계약 검사를, `lint:image-arch`에 로컬 스택 검사와 실행 조건(로컬 스택 파일이 바뀔 때)을 더한다.

````diff
diff --git a/.gitlab-ci.yml b/.gitlab-ci.yml
--- a/.gitlab-ci.yml
+++ b/.gitlab-ci.yml
@@ -45,6 +45,7 @@ lint:guards:
     - python3 -m unittest discover -s infra/ci/tests -v
     - python3 infra/ci/check_eol.py
     - python3 infra/ci/check_compose_projects.py
+    - python3 infra/ci/check_env_contract.py
     - |
       files=$(git ls-files 'infra/*.env.example')
       if [ -n "$files" ]; then python3 infra/ci/check_env_files.py $files; fi
@@ -58,10 +59,13 @@ lint:image-arch:
     - apk add --no-cache python3
   script:
     - python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --images-from-sh infra/ci/tool-images.sh
+    - python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/local/compose.yml --env-file infra/local/local.env.example --dockerfile infra/local/opensearch/Dockerfile
   rules:
     - changes:
         - infra/ci/tool-images.sh
         - infra/ci/images_arch.py
+        - infra/local/compose.yml
+        - infra/local/opensearch/Dockerfile
 
 # 인프라 소유 파일만 엄격하게 검사한다. be·fe·ai는 각 팀 린트가 맡는다(스펙 6.3, 12.2).
 lint:shell:
````

- [ ] **Step 2: 로컬 스택 README 작성**

````markdown
# 로컬 개발 스택

서버 없이 노트북에서 BE·FE를 개발할 때 쓰는 Postgres, Redis, Garage(S3), OpenSearch다. AI는 Modal의 dev 앱을 쓰므로 여기에 없다. 설계는 [design.md](../../docs/infra/design.md) 10.5절이다.

## 필요한 것

Docker(Compose v2 이상), bash(Windows는 Git Bash나 WSL), git, curl 7.75 이상(garage 점검). 메모리는 core가 유휴 상태에서 약 70MB(측정), search를 더하면 OpenSearch가 한도 1GB 가까이(측정 974MiB)를 쓴다.

## 처음 켜기

```bash
cp infra/local/local.env.example infra/local/.env
bash infra/local/fit-local.sh up            # core: postgres, redis, garage
bash infra/local/fit-local.sh up --search   # core에 nori를 넣은 opensearch를 더한다(처음에는 이미지를 만든다)
```

`up`은 컨테이너를 켜고 헬스체크를 기다린 뒤 DB·role·버킷을 만들고 점검한다. 몇 번 실행해도 같은 결과다. `infra/local/.env`는 git이 무시한다.

| 명령 | 하는 일 |
|---|---|
| `bash infra/local/fit-local.sh verify` | 떠 있는 서비스를 점검한다 |
| `bash infra/local/fit-local.sh down` | 중지한다. 데이터는 남는다 |
| `bash infra/local/fit-local.sh reset` | 중지하고 볼륨을 지워 데이터를 초기화한다 |

`FIT_LOCAL_PROJECT=이름`으로 compose 프로젝트 이름을 바꾸면 여러 벌을 따로 띄울 수 있다(기본 `fit-local`). 볼륨도 프로젝트마다 따로다.

## 접속 값

모든 포트는 `127.0.0.1`에만 게시된다. 기본값이 PC에 설치한 Postgres(5432) 등과 겹치지 않게 15432 같은 번호를 쓴다. 바꾸려면 `.env`의 `FIT_LOCAL_*_PORT`를 고친다.

| 서비스 | 값 |
|---|---|
| Postgres | `jdbc:postgresql://127.0.0.1:15432/fit_dev`. 앱은 `fit_dev_app`, Flyway는 `fit_migrator`. 비밀번호는 `.env`의 `FIT_DEV_APP_PASSWORD`, `FIT_MIGRATOR_PASSWORD` |
| Redis | `127.0.0.1:16379`, 비밀번호는 `REDIS_PASSWORD`. maxmemory 96MB, `noeviction` |
| S3(Garage) | 엔드포인트 `http://127.0.0.1:13900`, 리전 `garage`, path-style. 버킷·키는 `.env`의 `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| 사진 웹 읽기 | `http://127.0.0.1:13902`. Host 헤더가 `<버킷>.web.garage.localhost`여야 한다 |
| OpenSearch | `http://127.0.0.1:19200`. 보안 플러그인이 꺼져 있고 인증이 없다 |

환경변수 이름은 [env.md](../../docs/infra/contracts/env.md)의 `app` 그룹을 따른다.

## 서버와 같은 것, 다른 것

- 같다: 이미지 계열과 버전(pgvector, Redis, Garage, OpenSearch+nori), DB·role 구조(DDL 전용 `fit_migrator`, DML 전용 `fit_dev_app`), Redis 정책, Garage 레이아웃.
- 다르다: 컨테이너 망을 나누지 않는다. Redis는 한 개다. 메모리와 힙을 줄였다. 값은 개발용 가짜 값이다.
- 포트 불변식(호스트 게시는 `127.0.0.1`만)은 서버와 같고 `infra/ci/ports_invariant.py`가 검사한다.
````

- [ ] **Step 3: `infra/README.md`와 설계 문서 동기화**

`infra/README.md`:

````diff
diff --git a/infra/README.md b/infra/README.md
--- a/infra/README.md
+++ b/infra/README.md
@@ -5,6 +5,8 @@ Fit Dining 인프라 코드. 설계는 [docs/infra/design.md](../docs/infra/desi
 ## 지금 있는 것
 
 - `ci/` 가드 스크립트(Python 표준 라이브러리만), 단위 테스트, 로컬 러너, 도구 이미지 핀
+- `local/` 로컬 개발 스택(Postgres, Redis, Garage, OpenSearch). 사용법은 [local/README.md](local/README.md)
+- `app/` BE의 환경변수 예제(`app.env.example`, `migrate.env.example`). 키 계약은 [docs/infra/contracts/env.md](../docs/infra/contracts/env.md)
 
 가드가 강제하는 규칙:
 
@@ -13,6 +15,7 @@ Fit Dining 인프라 코드. 설계는 [docs/infra/design.md](../docs/infra/desi
 | `check_eol.py` | 커밋될 내용(git 인덱스)에 CRLF 금지. 경로를 주면 그 파일의 실제 바이트를 검사 | 12.4절 |
 | `check_env_files.py` | env는 `KEY=VALUE`만, 주석·공백·따옴표·`#`·`$`·백슬래시·백틱 금지, 필수 키 검사. 값은 출력하지 않는다 | 12.4절 |
 | `ports_invariant.py` | 호스트 게시 포트는 `127.0.0.1:`만, 예외는 caddy의 80/443/8443 | 13.1절 |
+| `check_env_contract.py` | 환경변수 계약 표(`docs/infra/contracts/env.md`)와 `*.env.example`의 키가 같음, 필수 키 존재 | 12.4절 |
 | `migration_immutability.py` | 적용된 마이그레이션 수정·삭제·이름 변경 금지(MR) | 6.5절 |
 | `images_arch.py` | 이미지가 대상 호스트 플랫폼(A amd64, B arm64)을 지원 | 3절 |
 
````

`docs/infra/design.md`: 7절의 이미지 핀과 확인 결과, 10.5절의 실행 방법, 12절의 계약 위치, 6.3절의 `lint:*` 설명, 17절의 파일 구조를 구현과 맞춘다.

````diff
diff --git a/docs/infra/design.md b/docs/infra/design.md
--- a/docs/infra/design.md
+++ b/docs/infra/design.md
@@ -413,8 +413,8 @@ Caddy 컨테이너(`caddy:2.x`, 구현 시 최신 2.x를 핀)가 A의 80·443·8
 
 **`lint:*` 잡**
 
-- `lint:guards`: 단위 테스트, CRLF, `infra/`의 env 예제 형식, 포트 규칙
-- `lint:image-arch`: 도구 이미지 핀이 바뀔 때만 돈다
+- `lint:guards`: 단위 테스트, CRLF, `infra/`의 env 예제 형식, env 계약과 예제 파일의 키 일치, 포트 규칙
+- `lint:image-arch`: 도구 이미지 핀이나 로컬 스택 이미지가 바뀔 때만 돈다
 - `lint:shell`, `lint:docker`, `lint:yaml`: `infra/`와 루트 설정만 엄격하게 본다. be의 Dockerfile은 오류 수준만 막는다. 다른 팀 코드는 각자의 잡이 맡는다
 - `lint:secrets`: 저장소 전체와 MR 커밋 이력
 - `lint:migrations`: MR에서만 돈다. 적용된 Flyway 파일의 수정, 버전 중복, 순서 역전을 막는다
@@ -472,14 +472,14 @@ PWA는 `fe/`를 정적 산출물로 빌드해 A의 Caddy가 서빙한다(5절).
 
 ### 7.1 Postgres
 
-- 이미지는 `pgvector/pgvector:pg16`이고 버전을 핀한다.
+- 이미지는 `pgvector/pgvector:0.8.7-pg16`으로 핀한다(로컬 스택과 같다).
 - 튜닝은 mount한 설정 파일이 아니라 `command:` 플래그로 한다(shared_buffers 256MB, max_connections 60, `idle_in_transaction_session_timeout`, `pg_stat_statements`).
 - 환경별 DB·role은 init 스크립트가 아니라 멱등 `ensure-databases.sh`로 만든다. init 스크립트는 빈 볼륨에서 한 번만 돌기 때문이다(A503 함정). dev role에는 `statement_timeout`을 건다.
 - 개발자용 dev DB 접근은 SSH 터널 → `127.0.0.1:5432`이고 dev role 비밀번호만 공유한다.
 
 ### 7.2 OpenSearch
 
-- 공식 이미지에 `analysis-nori`를 설치한 커스텀 이미지다(버전 핀, 힙 768MB). 설치는 `opensearch-plugin install --batch analysis-nori`이며 nori 전용 근거는 못 찾았고 일반 패턴이다. `opensearch-plugin list`로 nori와 k-NN을 확인한다 (미확인).
+- 공식 이미지(`opensearchproject/opensearch:3.9.0`)에 `analysis-nori`를 설치한 커스텀 이미지다(힙 768MB). 설치는 `opensearch-plugin install --batch analysis-nori`다. 로컬에서 빌드해 `analysis-nori`와 `opensearch-knn` 플러그인이 있고 nori 분석기가 동작함을 확인했다 (확인: `infra/local/fit-local.sh`).
 - single-node이고 보안 플러그인은 끈다. 내부 망이고 호스트 게시가 없다는 전제이며 잔여 위험은 13절에 있다.
 - `action.destructive_requires_name=true`, 인덱스 템플릿은 `replicas: 0`이다(아니면 yellow).
 - 무중단 재색인은 별칭 전환이다(BE 계약).
@@ -493,16 +493,16 @@ PWA는 `fe/`를 정적 산출물로 빌드해 A의 Caddy가 서빙한다(5절).
 
 ### 7.4 사진 저장소 (Garage)
 
-Garage(버전 핀, 데이터·메타 볼륨, 설정은 디렉터리 마운트)를 쓴다. 공식 문서 기준으로 기획서의 업로드 흐름에 필요한 기능을 지원한다 (확인).
+Garage(`dxflrs/garage:v2.4.1`, 데이터·메타 볼륨, 설정은 디렉터리 마운트)를 쓴다. 공식 문서 기준으로 기획서의 업로드 흐름에 필요한 기능을 지원한다 (확인).
 
 - **지원:** SigV4 presigned URL, PostObject, 멀티파트, Head/Copy/Delete, 수명주기의 `Expiration`과 `AbortIncompleteMultipartUpload`(접두사는 `Filter` 안에), CORS, ListObjectsV2, path-style
 - **미지원:** 버킷 정책, 태깅, 버저닝(접두사로 대체)
 - **흐름:** 업로드는 `pending/`, 리뷰 등록이 확정되면 `confirmed/`로 Copy 후 Delete, `pending/`는 수명주기로 자동 정리
 - **읽기:** 확정된 사진(`confirmed/`)만 웹 엔드포인트로 공개 읽기한다(5절). 업로드는 S3 API, 읽기는 웹 엔드포인트로 경로가 갈린다
 
-**첫 주 스파이크(2시간):** PostObject의 `content-length-range` 강제 여부, presigned PUT/POST가 Caddy 경유(Host 보존)로 서명이 통과하는지, 수명주기 동작, 웹 엔드포인트(3902)로 `confirmed/` 공개 읽기가 되고 익명 S3 GET은 거부되는지를 확인한다. 실패하면 Cloudflare R2나 Firebase Storage로 간다(계정·결제수단 필요, 국외 이전이면 처리방침 고지).
+**첫 주 스파이크(2시간):** PostObject의 `content-length-range` 강제 여부, presigned PUT/POST가 Caddy 경유(Host 보존)로 서명이 통과하는지, 수명주기 동작, 웹 엔드포인트(3902)로 `confirmed/` 공개 읽기가 되고 익명 S3 GET은 거부되는지를 확인한다. 웹 엔드포인트의 공개 읽기와 익명 S3 GET 거부는 로컬 스택 점검에서 확인했다 (확인). 나머지는 서버에서 확인한다. 실패하면 Cloudflare R2나 Firebase Storage로 간다(계정·결제수단 필요, 국외 이전이면 처리방침 고지).
 
-Garage는 단일 노드라도 레이아웃 설정이 필요하다(`layout assign/apply`, 버킷·키 생성). Garage 퀵스타트 기준이며 구현 시 확인한다. 이 과정을 멱등 스크립트로 만들고 키는 `/etc/fit/*.env`에 둔다. 메모리는 작을 것으로 보고(추정) 0.25GB를 잡았다.
+Garage는 단일 노드라도 레이아웃 설정이 필요하다(`layout assign/apply`, 버킷·키 생성). 로컬에서 v2.4.1로 확인했고 멱등 스크립트는 `infra/local/fit-local.sh`의 `init_garage`다 (확인). 서버용 스크립트는 계획 1D가 같은 순서로 만들고 키는 `/etc/fit/*.env`에 둔다. 메모리는 작을 것으로 보고(추정) 0.25GB를 잡았다.
 
 ## 8. 백업·복구
 
@@ -628,7 +628,7 @@ Grafana는 팀원에게 viewer 계정을 준다. A503에서는 SSH 보유자만
 
 ### 10.5 로컬 개발·사전 검증
 
-- 로컬 개발용 `infra/local/compose.yml`은 profile(`core`, `search`)로 나눠 노트북 메모리에 맞게 고르게 한다. AI는 Modal의 dev 앱을 쓴다.
+- 로컬 개발용 `infra/local/compose.yml`은 profile(`core`, `search`)로 나눠 노트북 메모리에 맞게 고르게 한다. AI는 Modal의 dev 앱을 쓴다. 켜고 점검하는 명령은 `bash infra/local/fit-local.sh`이고 접속 값은 `infra/local/README.md`에 있다. 환경변수 이름은 `docs/infra/contracts/env.md`를 따른다.
 - 서버 수령 전에는 이 PC의 Docker Desktop(Docker 29.7.2, Compose v5.4.0)과 WSL Ubuntu로 compose·스크립트·알림 규칙·Caddy 설정을 검증한다. shellcheck, promtool, age는 컨테이너로 돌린다.
 - 서버에서만 확인되는 것은 ufw, sysctl, 실제 TLS 발급, CPU 버스트, 외부 포트 노출이다.
 
@@ -755,7 +755,7 @@ Grafana는 팀원에게 viewer 계정을 준다. A503에서는 SSH 보유자만
 
 ## 12. 서비스 계약
 
-BE·AI·프런트 팀과 M1 전에 합의한다. 합의되면 `docs/infra/contracts/`로 분리한다. AI는 Modal에서 도는 서비스라 AI 계약은 BE가 Modal을 호출하는 규약이다(12.2·12.3절).
+BE·AI·프런트 팀과 M1 전에 합의한다. 합의되면 `docs/infra/contracts/`로 분리한다. 환경변수 계약은 [contracts/env.md](contracts/env.md)에 있고 합의 상태는 [contracts/README.md](contracts/README.md)에 적는다. AI는 Modal에서 도는 서비스라 AI 계약은 BE가 Modal을 호출하는 규약이다(12.2·12.3절).
 
 ### 12.1 BE (Spring Boot, Java 21)
 
@@ -804,7 +804,7 @@ AI 팀과 M1 전에 합의한다. FastAPI는 Modal에서 돌고 A·B에는 AI 
 ### 12.4 공통 환경변수
 
 - `KEY=VALUE`만 쓴다. 공백·따옴표·CRLF·`#`을 금지한다.
-- 필수·선택·빌드타임을 구분한 목록을 `docs/infra/contracts/env.md`에 둔다.
+- 필수·선택을 구분한 목록은 [contracts/env.md](contracts/env.md)에 있고 `check_env_contract.py`가 예제 파일과 맞춰 본다.
 - 파일 소비자가 셋(compose 보간, 서비스 `env_file:`, 마이그레이션 일회성 컨테이너)이라 가장 보수적인 형식을 쓴다.
 - compose `env_file`은 컨테이너 생성 시점에 굳으므로 파일만 고치면 반영되지 않고 재생성이 필요하다.
 - `$`를 쓰는 값(bcrypt 해시 등)은 base64로 인코딩해 둔다(13.2절).
@@ -972,14 +972,14 @@ infra/
   ops/         (B) compose.ops.yml, prometheus/, alertmanager/, blackbox, port-audit.sh, vault-ingest.sh
   deploy/      deploy.sh, rollback.sh, preflight.sh, smoke.sh, notify.sh, fit-up.sh
   backup/      pg-backup.sh, verify-dump.sh, push-vault.sh, photos-backup.sh, restore-check.sh(노트북용)
-  ci/          ports_invariant.py, check_compose_projects.py, check_env_files.py, check_eol.py, migration_immutability.py, images_arch.py, run-local-checks.sh, tool-images.sh, compose-projects.txt, tests/
-  local/       compose.yml (profile: core, search)
+  ci/          ports_invariant.py, check_compose_projects.py, check_env_files.py, check_env_contract.py, check_eol.py, migration_immutability.py, images_arch.py, run-local-checks.sh, tool-images.sh, compose-projects.txt, tests/
+  local/       compose.yml (profile: core, search), fit-local.sh, local.env.example, garage/, opensearch/Dockerfile, README.md
 .gitlab-ci.yml
 docs/infra/
   design.md    이 문서
   runbooks/    RB-01 ~ RB-13
   porting/     포팅 매뉴얼 초안(버전, 환경변수, 외부 서비스, DB 덤프, 시연)
-  contracts/   env.md, BE·AI(Modal 호출)·프런트 계약
+  contracts/   README.md(합의 상태), env.md. BE·AI(Modal 호출)·프런트 계약은 합의되면 이 폴더로 옮긴다
   ssh-matrix.md
   gitlab-setup.md  GitLab 프로젝트 설정·러너 등록 체크리스트
 ```
````

- [ ] **Step 4: 최종 게이트 실행**

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
python -m unittest discover -s infra/ci/tests
bash infra/ci/run-local-checks.sh
bash infra/ci/run-local-checks.sh --self-test
```

Expected:
- 단위 테스트: `Ran 83 tests` 다음에 `OK`
- 러너 정상 실행: 아래 출력이고 마지막 줄이 `모든 검사 통과`
- 자가 테스트: 8종 모두 PASS(`self-test env-contract: 나쁜 입력을 거부` 포함)

```text
PASS  guards unit tests
PASS  eol (CRLF 금지)
PASS  env 형식
PASS  env 계약 (표와 예제 파일)
PASS  ports (compose 프로젝트)
PASS  arch (도구 이미지)
PASS  arch (로컬 스택)
PASS  shellcheck
PASS  hadolint
SKIP  hadolint(be) (대상 파일 없음)
PASS  yamllint
PASS  gitleaks
```

- [ ] **Step 5: CI 스크립트 줄을 핀한 이미지 안에서 실행 (게이트)**

`.gitlab-ci.yml`의 `lint:*` 줄이 docker 소켓 없이 도는지 확인한다(1A와 같은 방식에 새 줄을 더했다). `check_eol.py`는 git 인덱스를 보므로 여기서 빼고 러너가 확인한다.

```bash
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
run() { docker run --rm --entrypoint "" -v "$W:/work" -w /work "$@"; }

run "$SHELLCHECK_IMAGE" sh -c "find infra -type f -name '*.sh' -print0 | xargs -0 -r shellcheck -x"; echo "lint:shell exit=$?"
run "$HADOLINT_IMAGE" sh -c "find infra -type f \( -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name '*.Dockerfile' \) -print0 | xargs -0 -r hadolint"; echo "lint:docker exit=$?"
run "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml .gitlab-ci.yml .yamllint.yaml infra; echo "lint:yaml exit=$?"
run "$DOCKER_CLI_IMAGE" sh -ec '
  apk add --no-cache python3 git >/dev/null
  git config --global --add safe.directory /work
  python3 -m unittest discover -s infra/ci/tests
  python3 infra/ci/check_compose_projects.py
  python3 infra/ci/check_env_contract.py
  python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --images-from-sh infra/ci/tool-images.sh
  python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/local/compose.yml --env-file infra/local/local.env.example --dockerfile infra/local/opensearch/Dockerfile'; echo "lint:guards+image-arch exit=$?"
```

Expected:

```text
lint:shell exit=0
lint:docker exit=0
lint:yaml exit=0
```

마지막 `docker:cli` 실행은 `Ran 83 tests` 다음에 `OK`, `== local`과 `OK ports (4 service(s))`, `OK env-contract`, `OK arch linux/arm64,linux/amd64 (8 image(s))`, `OK arch linux/arm64,linux/amd64 (4 image(s))`를 출력하고 `lint:guards+image-arch exit=0`으로 끝나야 한다.

- [ ] **Step 6: 남은 임시 파일 확인**

Run: `git status --short`

Expected: 이 계획이 만든 파일만 보이거나(커밋하지 않은 경우) 아무것도 없다(커밋한 경우). `infra/local/.env`, `infra/local/.wrong.env`, `.tmp-selftest/`, `.tmp-gitleaks/`는 없어야 한다.

- [ ] **Step 7: 커밋 (사용자가 허용한 경우에만)**

```bash
git add infra/ci/compose-projects.txt infra/ci/run-local-checks.sh .gitlab-ci.yml infra/local/README.md infra/README.md docs/infra/design.md
git commit -m "chore(infra): 로컬 스택과 env 계약을 검사에 연결하고 문서 동기화"
```
