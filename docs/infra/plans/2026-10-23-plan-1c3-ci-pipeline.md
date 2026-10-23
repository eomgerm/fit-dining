# CI 파이프라인 구현 계획 (Plan 1C-3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitLab 파이프라인이 BE·FE를 테스트하고 빌드해 서버 A에 배포한다. `develop`에 병합하면 dev가 자동으로, `master`에서는 사람이 누르면 prod가 배포되고, 배포 뒤 스모크까지 돈다. 배포 스크립트(`deploy.sh`, `smoke.sh`)는 1C-2가 이미 만들었으므로 이 계획은 그것을 부르는 잡과 그 사이의 이미지 조립, 검사, 권한을 만든다.

**Architecture:** 검증(`be:test`, `fe:test`, `fe:build`)은 B의 verify 러너에서, 이미지 조립·배포·스모크는 A의 deploy 러너에서 돈다. B(Arm)가 만든 jar와 Next.js standalone 번들을 GitLab 아티팩트로 A(x86)에 넘기고, A는 `COPY`만 하는 Dockerfile로 `be:<SHA>`, `fe:<SHA>`를 조립한다(빌드 메모리와 CPU 크레딧이 A에 오지 않는다). BE·FE 코드가 아직 서비스 계약(설계 12.1, 12.5)을 이행하지 않았으므로 배포 단계는 파일 한 줄의 스위치(`FIT_CD_ENABLED`)로 켜고 끈다. 꺼져 있는 동안에도 `be:test`와 `fe:test`는 모든 파이프라인에서 돌고, 켜는 일은 MR 한 줄이라 기록이 남는다.

**Tech Stack:** GitLab CI(CE 18.11), 러너 2개(`fit-verify` docker executor, `fit-deploy` shell executor), Gradle(`be/`, Java 21), pnpm(`fe/`, `packageManager` 필드), Docker, bash, python 3(표준 라이브러리와 PyYAML).

**Spec:** [docs/infra/design.md](../design.md) (6.1절 러너, 6.2절 브랜치와 환경, 6.3절 파이프라인, 6.4절 배포 스크립트, 6.8절 프런트, 12.1절 BE 계약, 12.5절 프런트 계약). 이어서 읽을 문서: [plan 1C-2](2026-10-21-plan-1c2-deploy.md)(배포 스크립트), [gitlab-setup.md](../gitlab-setup.md)(프로젝트 설정), [infra/host/README.md](../../../infra/host/README.md)(러너 설치).

## 한눈에 보기

| Task | 만드는 것 | 막는 사고 |
|---|---|---|
| 1 | 도구 이미지 핀 셋(`JDK_IMAGE`, `JRE_IMAGE`, `NODE_IMAGE`) | 태그가 바뀐 이미지로 빌드가 달라짐, Arm 변형이 없는 이미지가 B에서 돔 |
| 2 | `infra/ci/check_fe_bundle.py`와 단위 시험 | 빈 번들이나 `localhost`·mock 값이 박힌 번들을 배포함(A503의 6회 연속 사고), x86에서 못 도는 네이티브 모듈이 섞임 |
| 3 | `infra/app/Dockerfile.be`, `Dockerfile.fe`, `infra/ci/build-images.sh`와 컨테이너 시험 | 이미지가 root로 돔, 멀티스테이지로 A에서 빌드해 CPU 크레딧을 씀, 같은 SHA를 다시 조립함 |
| 4 | 호스트 권한 변경(`bootstrap.sh`, `verify-host.sh`) | deploy 러너가 상태 디렉터리에 쓰지 못해 첫 배포가 실패함 |
| 5 | `.gitlab-ci.yml`의 잡 9개와 구조 시험 | 배포 잡이 보호 안 된 브랜치에서 돎, prod가 자동으로 나감, 같은 환경의 배포가 겹침, 새 푸시에 배포가 중간에 취소됨 |
| 6 | 문서 동기화, 계약 이행 체크리스트, 서버 적용 절차 | 스위치를 켜기 전에 무엇이 되어 있어야 하는지 모름 |

이 계획은 **파이프라인과 그 부품**만 만든다. 서버에서 러너를 등록하는 일(토큰은 사람이 입력)과 스위치를 켜는 일은 아래 "서버 적용 절차"에 있다. BE·FE 코드를 계약에 맞추는 일은 각 팀의 몫이고 이 계획은 그 목록과 확인 방법을 준다.

## 확인한 현재 상태 (2026-10-23)

- `.gitlab-ci.yml`에는 `lint:*` 잡 12개뿐이다. `be:test`, `fe:test`, `fe:build`, `build:images`, `deploy`, `smoke`가 없다.
- `be/`와 `fe/`에는 Dockerfile이 없다(저장소 전체에 있는 것은 인프라의 시험용과 로컬 OpenSearch뿐). BE 계약 #20은 "CI가 만든 jar를 `COPY`만 한다"고 정하지만 누가 파일을 두는지는 정하지 않았다.
- BE는 Gradle 래퍼와 Spring Boot 4.1.1, Java 21이다. `/healthz`와 `/api/v1/version`이 소스에 없다(BE 계약 #2, #3).
- FE는 pnpm 11.13.0(`packageManager`)이고 `lint`, `test`(vitest) 스크립트가 있다. `next.config.ts`에는 `output: 'standalone'`, `generateBuildId`/`deploymentId`, `images.unoptimized`가 없고 `/fe-healthz` 라우트도 없다(FE 계약 #1, #6, #7). `/config.json` 라우트는 있다.
- 서버 A의 `/srv/fit/state`와 `/srv/fit/web`은 `root:root 755`다. `deploy.sh`는 거기에 상태 파일과 정적 자산 풀을 쓰는데 deploy 러너(`gitlab-runner`, docker 그룹)는 쓰지 못한다. `/etc/fit/*.env`는 `root:docker 640`, `/srv/fit/predeploy`는 `root:docker 2770`이라 읽기와 덤프는 된다.
- 러너는 두 서버에 설치만 돼 있고(`infra/host/runner.sh`) GitLab에 등록돼 있지 않다.

## 결정과 근거

1. **Dockerfile은 인프라가 `infra/app/`에 둔다.** BE·FE에 아직 없고, 계약상 `COPY`만 하는 파일이라 팀마다 다르게 쓸 이유가 없다. 설정(JVM 플래그, 포트, 사용자)은 compose가 정하므로 Dockerfile은 파일 복사, 비root 사용자, 버전 표시만 한다. 팀이 자기 Dockerfile을 원하면 계약(COPY만, 핀한 베이스)을 지키는 조건으로 바꾼다.
2. **배포 스위치는 `.gitlab-ci.yml`의 변수 한 줄이다(`FIT_CD_ENABLED: "false"`).** 시크릿이 아니라서 GitLab 변수에 두지 않고 파일에 둔다(설계 6.2절 "시크릿은 GitLab 변수에 넣지 않는다"와 같은 원칙으로, 바꾸는 일이 MR로 남는다). 꺼져 있으면 `fe:build`부터 `smoke`까지 파이프라인에 나타나지 않는다. 계약이 이행되기 전에 `fe:build`의 산출물 검사가 모든 MR을 막는 일을 피한다.
3. **스모크는 환경별로 두 잡이다(`smoke:dev`, `smoke:prod`).** 설계 6.3절의 `smoke:public` 한 줄을 나눈다. 환경마다 선행 잡과 규칙이 다르기 때문이다.
4. **`fe:bundle-check`는 `fe:build`와 별도 잡이다(python 이미지).** 검사 도구를 Node 이미지에 python을 설치해 돌리는 것보다 빠르고, 검사가 실패해도 빌드 로그와 섞이지 않는다. 설계 6.3절의 "산출물 검사를 거쳐 아티팩트로 넘긴다"는 `build:images`가 `fe:bundle-check`를 `needs`로 걸어 같은 효과를 낸다.
5. **jar와 번들은 GitLab 아티팩트로 넘긴다.** CE의 아티팩트 최대 크기는 확인하지 못했다(설계 6.3절 "미확인"). 첫 실행에서 크기를 로그에 찍고, 한도에 걸리면 그때 B에서 A로 `rsync`하는 후속 계획을 만든다(지금은 만들지 않는다).
6. **이미지 태그는 커밋 SHA 전체다.** `deploy.sh`와 `preflight.sh`가 `<서비스>:<sha>`를 찾는다(1C-2). 이미 있는 이미지는 다시 조립하지 않는다. MR을 fast-forward로 병합해 `develop`과 `master`의 SHA가 같으므로 prod 배포는 dev에서 검증한 이미지를 그대로 쓴다.
7. **러너 계정에 권한을 주는 대신 디렉터리를 docker 그룹이 쓰게 한다.** `/srv/fit/state`, `/srv/fit/web`을 `root:docker 2775`로 한다(setgid라 새 파일이 docker 그룹을 물려받고 Caddy 컨테이너는 읽기만 하므로 others는 읽기 가능). `gitlab-runner`는 이미 docker 그룹이라 root와 같은 권한이다(설계 6.1절에 적힌 위험이다). sudo 규칙을 늘리는 것보다 적게 연다.

## 파일 구조

| 경로 | 구분 | 책임 |
|---|---|---|
| `.gitlab-ci.yml` | 수정 | 변수(스위치와 핀), 잡 9개: `be:test`, `fe:test`, `fe:build`, `fe:bundle-check`, `build:images`, `deploy:dev`, `deploy:prod`, `smoke:dev`, `smoke:prod` |
| `infra/ci/tool-images.sh` | 수정 | `JDK_IMAGE`, `JRE_IMAGE`, `NODE_IMAGE` 핀 추가(단일 출처) |
| `infra/ci/check_fe_bundle.py` | 신규 | FE 번들 산출물 검사(설계 6.8절 P0) |
| `infra/ci/tests/test_check_fe_bundle.py` | 신규 | 위 검사의 단위 시험(임시 디렉터리 번들) |
| `infra/ci/tests/test_pipeline_structure.py` | 신규 | `.gitlab-ci.yml`의 구조 규칙 시험 |
| `infra/ci/tests/test_tool_images_sync.py` | 수정 아님 | 새 핀도 자동으로 검사한다(기존 시험이 `*_IMAGE` 전체를 비교) |
| `infra/app/Dockerfile.be` | 신규 | jar를 `COPY`만 하는 BE 이미지 |
| `infra/app/Dockerfile.fe` | 신규 | standalone 번들을 `COPY`만 하는 FE 이미지(`/app/.next/static` 구조) |
| `infra/ci/build-images.sh` | 신규 | `be:<sha>`, `fe:<sha>` 조립(이미 있으면 건너뜀) |
| `infra/ci/test/test-images.sh` | 신규 | 가짜 jar·번들로 이미지를 만들어 compose와 같은 조건(읽기 전용, tmpfs)으로 돌려 본다 |
| `infra/host/bootstrap.sh`, `verify-host.sh`, `test/` | 수정 | `/srv/fit/state`, `/srv/fit/web`을 `root:docker 2775`로 |
| `docs/infra/gitlab-setup.md`, `docs/infra/design.md`, `infra/deploy/README.md`, `infra/host/README.md` | 수정 | 3단계(프로젝트 설정, 스위치), 6.3절 표, 연결 안내 |

## Global Constraints

1A·1B·1C-1·1C-2·1D·1E·1F의 전역 제약이 모두 적용된다. 이 계획에서 특히 지킬 것:

- 도구와 베이스 이미지는 핀하고 amd64와 arm64를 모두 지원해야 한다(B가 Arm이다). 핀은 `infra/ci/tool-images.sh`와 `.gitlab-ci.yml`의 `variables`가 같아야 한다(`test_tool_images_sync.py`가 검사한다).
- 도구마다 job image를 따로 쓴다. docker executor의 job 컨테이너 안에서 `docker run -v $PWD`로 도구 컨테이너를 띄우지 않는다(설계 6.3절).
- `interruptible: true`는 verify 단계 잡에만 둔다. build·deploy·smoke는 새 푸시에 취소되면 안 된다.
- deploy 러너는 보호된 브랜치(`develop`, `master`)만 받는다. 배포 잡의 `rules`는 브랜치를 한 번 더 확인한다.
- 시크릿은 GitLab 변수에 두지 않는다. 이 계획이 추가하는 변수는 모두 비밀이 아니다.
- 모든 출력과 로그에 시크릿(dev 게이트 키, 웹훅, 토큰)을 찍지 않는다.
- 새 셸 스크립트는 shellcheck(`-x`)를 통과해야 하고, 새 Dockerfile은 hadolint를 통과해야 한다(`infra/` 아래는 엄격하게 검사한다).
- 문서에는 현재 사실만 쓴다. 커밋은 `:이모지: 유형(infra): 설명 (S15P31A302-19)` 형식이다.

---

### Task 1: 도구 이미지 핀 셋

**Files:**
- Modify: `infra/ci/tool-images.sh`
- Modify: `.gitlab-ci.yml` (`variables`)
- Test: `infra/ci/tests/test_tool_images_sync.py`(수정 없이 통과해야 한다), `python3 infra/ci/images_arch.py`

**Interfaces:**
- Produces: `JDK_IMAGE`, `JRE_IMAGE`, `NODE_IMAGE`. 이후 Task가 `$JDK_IMAGE`(be:test), `$NODE_IMAGE`(fe:test, fe:build), `$JRE_IMAGE`와 `$NODE_IMAGE`(이미지 조립의 베이스)로 쓴다.

핀 값(2026-10-23에 레지스트리에서 amd64와 arm64/v8을 모두 확인했다):

```sh
JDK_IMAGE=eclipse-temurin:21.0.12_8-jdk-noble
JRE_IMAGE=eclipse-temurin:21.0.12_8-jre-noble
NODE_IMAGE=node:22.23.4-bookworm-slim
```

- [ ] **Step 1:** 위 세 줄을 `tool-images.sh`에, 같은 값을 `.gitlab-ci.yml`의 `variables` 블록에 더한다(`  JDK_IMAGE: eclipse-temurin:21.0.12_8-jdk-noble` 형식, 들여쓰기 2칸).
- [ ] **Step 2:** `python3 -m unittest infra/ci/tests/test_tool_images_sync.py -v`가 통과한다.
- [ ] **Step 3:** `python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --images-from-sh infra/ci/tool-images.sh`가 새 이미지 셋을 포함해 통과한다(`lint:image-arch`의 조건 목록에 `tool-images.sh`가 이미 있어 CI도 같은 검사를 돈다).
- [ ] **Step 4:** 커밋 `:wrench: chore(infra): BE·FE 빌드와 이미지 조립용 베이스 이미지 핀 추가 (S15P31A302-19)`

---

### Task 2: FE 번들 산출물 검사 (TDD)

**Files:**
- Create: `infra/ci/check_fe_bundle.py`
- Create: `infra/ci/tests/test_check_fe_bundle.py`

**Interfaces:**
- Produces: `python3 infra/ci/check_fe_bundle.py <번들 디렉터리> --sha <커밋 SHA>`. 번들 디렉터리는 `standalone/`(Next가 만든 `.next/standalone` 그대로), `static/`(`.next/static`), 선택으로 `public/`을 가진다. 검사마다 `PASS`, `FAIL`, `WARN`, `SKIP`을 한 줄로 찍고 하나라도 FAIL이면 종료 코드 1이다. 함수 `check_bundle(root: Path, sha: str) -> list[tuple[str, str, str]]`(상태, 검사 이름, 설명)를 시험이 직접 부른다.

검사 항목(설계 6.8절 P0). **실제 Next 16 번들(2026-10-23, `fe/`를 임시 복사본에서 계약대로 패치해 빌드)에서 확인한 모양**을 따른다:

1. `server.js`: `standalone/server.js`가 있다.
2. `static`: `static/`에 파일이 하나 이상 있다(빈 번들 방지).
3. `build-id`: `standalone/.next/BUILD_ID`가 `--sha`와 같다(`generateBuildId`가 커밋 SHA, FE 계약 #1). 빈 값끼리는 같다고 보지 않는다(`DEPLOYMENT_VERSION`이 비어 빌드된 번들이 그대로 나가는 사고를 막는다).
4. `deployment-id`: `standalone/.next/required-server-files.json`의 `config.deploymentId`가 `--sha`와 같다(FE 계약 #1). 빈 값 불가.
5. `images-unoptimized`: 같은 파일의 `config.images.unoptimized`가 `true`다(FE 계약 #7). 이 Next 버전의 standalone에는 `images-manifest.json`이 들어 있지 않아서 설계 6.8절이 말한 그 파일 대신 `required-server-files.json`을 읽는다.
6. `native-modules`: `standalone/node_modules` 아래 `*.node`는 경로에 `/@img/sharp-`가 있는 것만 허용한다(B의 Arm 산출물에 다른 플랫폼 전용 모듈이 섞이면 x86에서 돌지 않는다).
7. `no-local-urls`: `standalone/server.js`, `standalone/.next/server/**`, `static/**`의 텍스트 파일에 `http(s)://localhost`, `127.0.0.1`, `0.0.0.0` **주소**가 없다. `node_modules`는 보지 않는다. 실제 번들에서 Next 런타임이 `hostname="localhost"` 비교, 템플릿으로 조립하는 `://localhost:` 주소, URL 파서 때문에 `localhost`라는 글자를 포함했다(오탐). 그래서 글자가 아니라 **스킴이 붙은 주소**만 실패로 본다.
8. `mock-words`: 같은 범위에 `mock`이라는 글자가 있으면 **`WARN`**으로 드러내고 막지 않는다. 실제 FE 코드에 개발용 mock 스위치(`?mock=empty`, `X-Mock-Scenario` 헤더)가 있어 prod 번들에도 들어간다. 이것을 두는 것이 맞는지는 FE 팀이 판단한다(막으면 모든 빌드가 실패한다).
9. `pwa-files`: `public/sw.js`와 `public/manifest.webmanifest`가 있으면 통과, 없으면 `SKIP`(FE 계약 #4는 팀 몫이라 막지 않는다. 지금 FE에는 둘 다 없다).

실제 번들에서 확인한 것(검사기를 돌린 결과: PASS 7, WARN 1(mock), SKIP 1(pwa), 종료 코드 0):

- **계약대로 패치한 설정**(`output: "standalone"`, `images: { unoptimized: true }`, `generateBuildId`와 `deploymentId`를 `process.env.DEPLOYMENT_VERSION`으로)으로 빌드한 번들은 통과한다. 현재 `fe/next.config.ts`는 이 네 가지가 없어서 그대로는 `images-unoptimized`와 `deployment-id` 등이 FAIL이다(FE 팀 몫, 체크리스트).
- standalone은 39MB, static은 3.0MB다. pnpm 때문에 `node_modules`가 **심볼릭 링크**(`next`, `react`, `react-dom`과 `.pnpm/`)다. 아티팩트 전달과 `COPY`(Task 3)에서 링크가 보존되는지 확인해야 한다.
- 빌드(`pnpm install --frozen-lockfile`과 `pnpm build`)는 이 PC(x86)에서 3분 16초가 걸렸다. B(Arm, 2 vCPU, 메모리 4GB)에서는 더 걸릴 수 있어 서버에서 시간을 기록한다.

- [ ] **Step 1: 실패하는 시험을 먼저 쓴다.** `test_check_fe_bundle.py`는 임시 디렉터리에 정상 번들을 만드는 헬퍼 `make_bundle(tmp, sha)`를 두고, 항목마다 하나씩 망가뜨려 해당 줄만 FAIL인지 확인한다(정상 → 전부 PASS, `server.js` 삭제, `static` 비움, BUILD_ID 불일치·빈 값, `deploymentId` 불일치·빈 값, `unoptimized` 값과 파일 상태, sharp가 아닌 `.node`, 로컬 주소, 프레임워크 런타임의 `localhost` 글자는 통과, `node_modules`와 바이너리는 무시, `mock`은 WARN, PWA 파일 없음은 SKIP, 출력에 파일 내용이 없음, 빈 `--sha` 거부, 종료 코드).
- [ ] **Step 2:** `python3 -m unittest infra/ci/tests/test_check_fe_bundle.py -v`가 모듈이 없어서 실패한다.
- [ ] **Step 3:** `check_fe_bundle.py`를 쓴다(표준 라이브러리만. 텍스트 파일 판정은 앞 4KB에 NUL 바이트가 없는 것).
- [ ] **Step 4:** 같은 시험이 통과한다(20개). 검사를 일부러 하나씩 꺼서(`build-id`, `deployment-id`, 빈 값 거부, `static`, `pwa-files` 등 변이 11종) 시험이 실패하는지 확인한다. 바이트코드 캐시가 변이를 가리지 않게 `python -B`로 돌린다.
- [ ] **Step 5:** 실제 `fe/`를 계약대로 패치한 임시 복사본에서 `next build`한 번들에 검사기를 돌려 위 결과가 나오는지 확인한다(리눅스 컨테이너 안에서. Windows의 `cp`는 심볼릭 링크를 만들지 못한다).
- [ ] **Step 6:** 커밋 `:sparkles: feat(infra): FE 번들 산출물 검사(check_fe_bundle.py)와 시험 추가 (S15P31A302-19)`

---

### Task 3: 이미지 Dockerfile, 조립 스크립트, 컨테이너 시험

**Files:**
- Create: `infra/app/Dockerfile.be`, `infra/app/Dockerfile.fe`
- Create: `infra/ci/build-images.sh`
- Create: `infra/ci/test/test-images.sh`

**Interfaces:**
- Consumes: `JRE_IMAGE`, `NODE_IMAGE`(Task 1).
- Produces: `bash infra/ci/build-images.sh <sha>`. 환경변수 `FIT_BE_JAR_DIR`(기본 `be/build/libs`), `FIT_FE_BUNDLE_DIR`(기본 `fe-bundle`), `FIT_BE_IMAGE`(기본 `be`), `FIT_FE_IMAGE`(기본 `fe`)는 compose와 같은 이름이다. 결과는 이미지 `<FIT_BE_IMAGE>:<sha>`, `<FIT_FE_IMAGE>:<sha>`. 이미 있으면 `재사용: be:<sha>`를 찍고 건너뛴다. jar가 없거나 둘 이상이면(`*-plain.jar` 제외) 실패한다.

이미지 계약:

- **BE**(`Dockerfile.be`): `ARG BASE_IMAGE=<JRE 핀>`, 사용자 `app`(uid 10001), `COPY app.jar /app/app.jar`, `ENV APP_SHA=<sha> APP_BUILT_AT=<UTC ISO8601>`(BE의 `/api/v1/version`이 읽는 값의 **제안**이다. BE 팀과 이름을 확정한다), `EXPOSE 8080 8081`, `ENTRYPOINT ["java", "-jar", "/app/app.jar"]`(인자는 그대로 전달된다. 마이그레이션 컨테이너가 `SPRING_PROFILES_ACTIVE=migrate`로 같은 이미지를 쓴다). JVM 플래그는 compose의 `JAVA_TOOL_OPTIONS`가 준다.
- **FE**(`Dockerfile.fe`): `ARG BASE_IMAGE=<NODE 핀>`, `WORKDIR /app`, `COPY standalone/ /app/`, `COPY static/ /app/.next/static/`, `COPY public/ /app/public/`(없으면 빈 디렉터리), `ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0`, 사용자 `node`, `CMD ["node", "server.js"]`. `.next/cache`는 compose가 tmpfs로 준다.
- 두 Dockerfile의 `BASE_IMAGE` 기본값은 hadolint가 핀을 요구해서 핀 값을 직접 적는다. `build-images.sh`는 `tool-images.sh`의 값을 `--build-arg`로 넘기고, `test_tool_images_sync.py`에 두 Dockerfile 기본값이 `tool-images.sh`와 같은지 검사를 더한다.

- [ ] **Step 1: 시험 스크립트를 먼저 쓴다.** `test-images.sh`는 임시 디렉터리에 가짜 jar(`be-0.0.1.jar`와 `be-0.0.1-plain.jar`), 가짜 FE 번들(`standalone/server.js`는 `/fe-healthz`에 200을 주는 작은 Node 서버, `static/chunks/a.js`, `public/sw.js`)을 만들고, `FIT_BE_IMAGE=fit-citest-be FIT_FE_IMAGE=fit-citest-fe`로 `build-images.sh`를 실행해 확인한다: 두 이미지가 `<sha>` 태그로 생긴다 / 다시 실행하면 `재사용`이 찍히고 이미지 ID가 그대로다 / BE 이미지는 사용자 `app`이고 `/app/app.jar`가 있으며 `APP_SHA`가 sha다 / `-plain.jar`만 있거나 jar가 둘이면 실패한다 / FE 이미지를 compose와 같은 조건(`--read-only --tmpfs /app/.next/cache --tmpfs /tmp`, 사용자 `node`)으로 띄우면 `/fe-healthz`가 200이고 `/app/.next/static/chunks/a.js`가 있다 / 시험이 만든 이미지와 컨테이너는 끝에 모두 지운다(`down`). 사용법은 다른 시험과 같게 `up`/`run`/`down`이 아니라 한 번에 돌리는 `bash test-images.sh`다.
- [ ] **Step 2:** 실행해 스크립트가 없어서 실패하는 것을 본다.
- [ ] **Step 3:** 두 Dockerfile과 `build-images.sh`를 쓴다(`set -euo pipefail`, 값 비출력, jar 선택은 `find`로 `*.jar`에서 `*-plain.jar`를 뺀 것이 정확히 하나일 때만).
- [ ] **Step 4:** `bash infra/ci/test/test-images.sh`가 통과한다. hadolint와 shellcheck(`run-local-checks.sh`)도 통과한다.
- [ ] **Step 5:** 변이 시험 한 번: `Dockerfile.fe`에서 `USER node`를 지우면 시험이 실패하는지 확인하고 되돌린다.
- [ ] **Step 6:** 커밋 `:sparkles: feat(infra): BE·FE 이미지 Dockerfile과 조립 스크립트(build-images.sh), 컨테이너 시험 추가 (S15P31A302-19)`

---

### Task 4: 호스트 권한 (deploy 러너가 상태 디렉터리에 쓰게)

**Files:**
- Modify: `infra/host/bootstrap.sh`(`/srv/fit/state`, `/srv/fit/web`)
- Modify: `infra/host/verify-host.sh`(105행의 점검)
- Modify: `infra/host/test/run-in-container.sh`(기대 모드)
- Modify: `infra/host/README.md`(구성 설명 한 줄)

**Interfaces:**
- Produces: A의 `/srv/fit/state`, `/srv/fit/web`이 `root:docker`, 모드 `2775`. `/srv/fit`은 그대로 `root:root 755`다.

- [ ] **Step 1:** `verify-host.sh`의 점검을 `2775 root:docker`로 바꾸고 시험(`test-host.sh`)을 실행해 먼저 실패하는 것을 본다(`bash infra/host/test/test-host.sh`).
- [ ] **Step 2:** `bootstrap.sh`의 `ensure_dir /srv/fit/state 755 root:root`, `ensure_dir /srv/fit/web 755 root:root`를 `2775 root:docker`로 바꾼다. `ensure_dir`는 모드와 소유자가 다르면 고치므로 서버에서 다시 실행하면 적용된다.
- [ ] **Step 3:** `test-host.sh`가 통과한다(멱등: 두 번째 실행 `변경 없음`).
- [ ] **Step 4:** 커밋 `:lock: fix(infra): deploy 러너가 쓰도록 /srv/fit/state, web을 root:docker 2775로 (S15P31A302-19)`

서버 적용에는 한 가지 더 있다: 이미 root가 만든 파일(`upstream-*.caddy`, `history-*.log`, `deploy-*.env`)은 소유자가 root라 러너가 제자리에서 고쳐 쓰지 못한다. `deploy.sh`는 임시 파일을 만들어 `mv -f`로 바꾸는 방식이라 디렉터리 쓰기 권한만 있으면 되지만, `history-*.log`는 `>>`로 덧붙이므로 소유 그룹을 맞춰 둔다(서버 적용 절차 2번).

---

### Task 5: `.gitlab-ci.yml` 잡과 구조 시험

**Files:**
- Modify: `.gitlab-ci.yml`
- Create: `infra/ci/tests/test_pipeline_structure.py`
- Modify: `.gitlab-ci.yml`의 `lint:guards`(`apk add --no-cache python3 git py3-yaml`)

**Interfaces:**
- Consumes: Task 1의 핀, Task 2의 `check_fe_bundle.py`, Task 3의 `build-images.sh`, 1C-2의 `deploy.sh`, `smoke.sh`.
- Produces: 잡 이름과 관계(시험이 검사한다): `be:test`, `fe:test`(verify, 항상) / `fe:build`, `fe:bundle-check`(verify, 스위치) / `build:images`(build, deploy 태그) / `deploy:dev`, `deploy:prod`(deploy) / `smoke:dev`, `smoke:prod`(smoke).

변수와 잡(핵심 부분. 전체는 구현 때 이 설계대로 쓴다):

```yaml
variables:
  # 켜기 전에 아래 "계약 이행 체크리스트"가 모두 끝나 있어야 한다. 바꾸는 일은 MR로 한다
  FIT_CD_ENABLED: "false"

.cd-rules: &cd_enabled
  if: $FIT_CD_ENABLED == "true"

be:test:
  extends: .verify
  image: $JDK_IMAGE
  variables:
    GRADLE_USER_HOME: $CI_PROJECT_DIR/.gradle
    GRADLE_OPTS: -Xmx768m -Dorg.gradle.daemon=false
  cache:
    key:
      files: [be/build.gradle, be/gradle/wrapper/gradle-wrapper.properties]
    paths: [.gradle/caches, .gradle/wrapper]
  script:
    - cd be
    - ./gradlew --no-daemon test bootJar
    - ls -l build/libs
  artifacts:
    expire_in: 1 day
    paths: [be/build/libs/*.jar]
    reports:
      junit: be/build/test-results/test/*.xml

fe:test:
  extends: .verify
  image: $NODE_IMAGE
  variables:
    NODE_OPTIONS: --max-old-space-size=1536
    npm_config_store_dir: $CI_PROJECT_DIR/.pnpm-store
  cache:
    key:
      files: [fe/pnpm-lock.yaml]
    paths: [.pnpm-store]
  script:
    - corepack enable
    - cd fe
    - pnpm install --frozen-lockfile
    - pnpm lint
    - pnpm exec tsc --noEmit
    - pnpm test

fe:build:
  extends: .verify
  image: $NODE_IMAGE
  rules: [*cd_enabled]
  needs: [fe:test]
  variables:
    NODE_OPTIONS: --max-old-space-size=1536
    npm_config_store_dir: $CI_PROJECT_DIR/.pnpm-store
  script:
    - corepack enable
    - cd fe
    - pnpm install --frozen-lockfile
    - DEPLOYMENT_VERSION="$CI_COMMIT_SHA" pnpm build
    - mkdir -p ../fe-bundle
    - cp -r .next/standalone ../fe-bundle/standalone
    - cp -r .next/static ../fe-bundle/static
    - if [ -d public ]; then cp -r public ../fe-bundle/public; fi
    - du -sh ../fe-bundle
  artifacts:
    expire_in: 1 day
    paths: [fe-bundle/]

fe:bundle-check:
  extends: .verify
  image: $PYTHON_IMAGE
  rules: [*cd_enabled]
  needs:
    - {job: fe:build, artifacts: true}
  script:
    - python3 infra/ci/check_fe_bundle.py fe-bundle --sha "$CI_COMMIT_SHA"

build:images:
  stage: build
  tags: [deploy]
  rules:
    - if: $FIT_CD_ENABLED == "true" && ($CI_COMMIT_BRANCH == "develop" || $CI_COMMIT_BRANCH == "master")
  needs:
    - {job: be:test, artifacts: true}
    - {job: fe:build, artifacts: true}
    - fe:bundle-check
  script:
    - bash infra/ci/build-images.sh "$CI_COMMIT_SHA"

deploy:dev:
  stage: deploy
  tags: [deploy]
  rules:
    - if: $FIT_CD_ENABLED == "true" && $CI_COMMIT_BRANCH == "develop"
  needs: [build:images]
  environment:
    name: dev
  resource_group: dev
  timeout: 20m
  script:
    - bash infra/deploy/deploy.sh dev "$CI_COMMIT_SHA"

deploy:prod:
  stage: deploy
  tags: [deploy]
  rules:
    - if: $FIT_CD_ENABLED == "true" && $CI_COMMIT_BRANCH == "master"
      when: manual
  needs: [build:images]
  environment:
    name: prod
  resource_group: prod
  timeout: 20m
  script:
    - bash infra/deploy/deploy.sh prod "$CI_COMMIT_SHA"

smoke:dev:
  stage: smoke
  tags: [deploy]
  rules:
    - if: $FIT_CD_ENABLED == "true" && $CI_COMMIT_BRANCH == "develop"
  needs: [deploy:dev]
  script:
    - bash infra/deploy/smoke.sh dev --sha "$CI_COMMIT_SHA"

smoke:prod:
  stage: smoke
  tags: [deploy]
  rules:
    - if: $FIT_CD_ENABLED == "true" && $CI_COMMIT_BRANCH == "master"
  needs: [deploy:prod]
  script:
    - bash infra/deploy/smoke.sh prod --sha "$CI_COMMIT_SHA"
```

`FIT_SMOKE_SEARCH_PATH`는 BE 검색 API 경로가 정해지면 `variables`에 더한다(그 전에는 `smoke.sh`가 검색 폴백 점검을 건너뛴다).

구조 시험(`test_pipeline_structure.py`, PyYAML)의 규칙:

1. 위 잡 9개가 모두 있다.
2. `build:images`, `deploy:*`, `smoke:*`는 `tags: [deploy]`이고 다른 잡은 기본(verify) 태그를 쓴다.
3. 배포 잡(`deploy:*`)에는 `environment`와 `resource_group`이 있고 이름이 환경과 같다.
4. `deploy:prod`의 규칙은 `when: manual`이고 브랜치가 `master`다. `deploy:dev`는 `develop`이다. 둘 다 `FIT_CD_ENABLED`를 조건에 포함한다.
5. `FIT_CD_ENABLED`가 꺼진 파이프라인(`develop`, `master`, MR)에서는 `be:test`, `fe:test`만 새로 나타난다(규칙을 평가하는 작은 함수로 시험한다). 켠 `develop`에는 모든 잡이, 켠 `master`에는 `deploy:prod`가 수동으로, MR에는 verify 잡만 나타난다.
6. `needs`가 가리키는 잡이 모두 있고, 같은 파이프라인에 나타나지 않을 잡을 가리키지 않는다(예: `build:images`는 스위치가 켜져야만 나타나는 `fe:build`를 가리키므로 같은 조건을 가진다).
7. `interruptible: true`는 verify 단계 잡에만 있다. `deploy`, `smoke`, `build` 단계 잡에는 없다.
8. 모든 `image:`가 `$..._IMAGE` 변수를 쓴다(기존 동기화 시험과 같은 규칙. 새 변수가 모두 정의돼 있다).
9. `be:test` 아티팩트가 `be/build/libs/*.jar`를 포함하고 `fe:build` 아티팩트가 `fe-bundle/`를 포함한다.
10. 스위치 기본값이 `"false"`다(켜는 MR이 이 시험도 함께 바꾸게 해서 실수로 켜지 않는다).

- [ ] **Step 1:** 시험을 먼저 쓰고 실패하는 것을 본다.
- [ ] **Step 2:** 잡을 더하고 시험이 통과한다. `lint:guards`가 `py3-yaml`을 설치한다. yamllint도 통과한다.
- [ ] **Step 3:** 변이 시험: `deploy:prod`에서 `when: manual`을 지우면 시험이 잡는지, `deploy:dev`에 `interruptible: true`를 붙이면 잡는지, 스위치를 `"true"`로 바꾸면 잡는지 확인하고 되돌린다.
- [ ] **Step 4:** 가능하면 로컬에서 실제 파이프라인을 한 번 돌려 본다(`gitlab-ci-local`은 쓰지 않는다. 대신 MR을 올려 `be:test`와 `fe:test`가 verify 러너에서 도는 것을 확인한다. 러너가 등록돼 있어야 한다).
- [ ] **Step 5:** 커밋 `:sparkles: feat(infra): CI에 BE·FE 테스트, 이미지 조립, 배포, 스모크 잡 추가(배포는 스위치로 끈다) (S15P31A302-19)`

---

### Task 6: 문서와 체크리스트, 최종 점검

**Files:**
- Modify: `docs/infra/gitlab-setup.md`(3단계 추가), `docs/infra/design.md`(6.3절 표, 12절에 계약 이행 상태), `infra/deploy/README.md`, `infra/host/README.md`

- [ ] **Step 1:** `gitlab-setup.md`에 3단계(배포 파이프라인)를 쓴다. 프로젝트 설정: **Prevent outdated deployment jobs** 켬, **Allow job retries for rollback deployments** 끔, 환경 `dev`·`prod`에 보호(prod 배포 승인자는 Maintainer), `resource_group`의 `process_mode`를 `oldest_first`로 바꾸는 API 호출(개인 액세스 토큰은 호출하는 사람이 자기 터미널에서만 쓰고 채팅에 붙이지 않는다. 명령은 문서에 쓰되 토큰은 `read -s`로 받는다). 보호 브랜치(`develop`, `master`)에 push는 아무도 못 하고 MR만 허용하는 규칙이 이미 있는지 확인한다.
- [ ] **Step 2:** 설계 6.3절 표를 현재와 맞춘다: `fe:bundle-check` 추가, `smoke:public`을 `smoke:dev`·`smoke:prod`로, 스위치 설명, 12.1절과 12.5절에 계약 이행 상태 표(아래 체크리스트)를 연결한다.
- [ ] **Step 3:** `bash infra/ci/run-local-checks.sh`와 `--self-test`가 통과한다. 이 계획의 시험(`test-images.sh`, `test-host.sh`, 단위 시험)이 통과한다.
- [ ] **Step 4:** 커밋 `:memo: docs(infra): CI 배포 파이프라인 설정과 계약 이행 체크리스트 문서화 (S15P31A302-19)`

---

## 계약 이행 체크리스트 (스위치를 켜기 전에)

스위치(`FIT_CD_ENABLED`)는 아래가 모두 끝나고 dev에서 사람이 한 번 `deploy.sh`로 확인한 뒤에 켠다. 인프라가 확인할 수 있는 항목은 확인 방법을 적었다.

**BE 팀**

| # | 항목 | 확인 방법 |
|---|---|---|
| 1 | `GET /healthz`(상태만, 내부 정보 없음) — 계약 #2 | `curl`로 200 |
| 2 | `GET /api/v1/version` → `{sha, builtAt}`. 이미지에 박힌 `APP_SHA`, `APP_BUILT_AT`를 읽는다(이름은 제안, 팀과 확정) — 계약 #3 | `smoke.sh`가 새 SHA인지 본다 |
| 3 | 관리 포트 8081과 `/actuator/health/readiness`, `/actuator/prometheus` — 계약 #1 | `deploy.sh` readiness |
| 4 | `server.shutdown=graceful`, 종료 대기 30초 — 계약 #4 | 롤백 시험 |
| 5 | `SPRING_PROFILES_ACTIVE=migrate`면 웹 서버 없이 마이그레이션 후 종료 — 계약 #9 | 마이그레이션 컨테이너가 0으로 끝남 |
| 6 | `X-Fallback` 헤더(폴백 응답) — 계약 #17 | `FIT_SMOKE_SEARCH_PATH`를 주면 `smoke.sh`가 확인 |
| 7 | 부팅 시 env 검증(`REPLACE_ME`, 환경 불일치 거부) — 계약 #8 | prod.env의 자리표시자로 기동이 거부되는지 |

**FE 팀**

| # | 항목 | 확인 방법 |
|---|---|---|
| 1 | `next.config.ts`에 `output: 'standalone'`, `generateBuildId`와 `deploymentId`를 `DEPLOYMENT_VERSION`(커밋 SHA)으로 — 계약 #1 | `fe:bundle-check`(BUILD_ID) |
| 2 | `images.unoptimized: true` 또는 커스텀 로더 — 계약 #7 | `fe:bundle-check`(images-manifest) |
| 3 | `GET /fe-healthz`(200, 의존성 상태 안 봄) — 계약 #6 | FE 컨테이너 healthcheck |
| 4 | 번들에 `localhost`·mock 값이 없음 — 계약 #3 | `fe:bundle-check` |
| 5 | `/config.json`이 env에서 읽은 공개 값을 돌려주고 키 목록이 `contracts/env.md`에 있음 — 계약 #3 | `smoke.sh` |
| 6 | `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`가 통과 | `fe:test` |

## 서버 적용 절차 (구현 MR이 병합된 뒤)

1. **러너 등록**(사람): GitLab에서 `fit-verify`(태그 `verify`, untagged 끔, Protected 끔), `fit-deploy`(태그 `deploy`, untagged 끔, Protected 켬)를 만들고 각 서버에서 `sudo bash ~/host/runner.sh register`로 토큰을 숨김 입력한다. `status`가 PASS이고 Runners 목록에서 online이다. 임시 verify 러너(이 PC의 Docker)는 지운다.
2. **A에 권한 반영:** 코드를 갱신하고 `sudo ROLE=app FIT_PEER_IP=<B의 IP> bash ~/host/bootstrap.sh`로 디렉터리 권한을 적용한다. 이어서 이미 있는 파일의 그룹을 맞춘다: `sudo chgrp -R docker /srv/fit/state /srv/fit/web && sudo chmod -R g+rwX /srv/fit/state /srv/fit/web`. `verify-host.sh`가 통과한다.
3. **verify 확인:** MR을 올려 `be:test`, `fe:test`가 B의 러너에서 도는 것을 본다(스위치가 꺼진 채로). 아티팩트 크기와 실행 시간(B의 메모리 4GB 안에서 Gradle이 끝나는지)을 기록한다.
4. **GitLab 프로젝트 설정:** `gitlab-setup.md` 3단계(Prevent outdated deployment jobs 등).
5. **계약 체크리스트가 끝나면** 스위치를 켜는 MR(`FIT_CD_ENABLED: "true"`와 구조 시험의 기본값 시험을 함께 바꾼다)을 올리고 `develop`에 병합해 dev 첫 배포를 지켜본다. 실패하면 `rollback.sh`와 알림을 확인한다.
6. dev가 안정된 뒤 `develop → master` MR을 병합하고 `deploy:prod`를 수동으로 누른다.

## 아직 확인하지 못한 것 (구현에서 확인한다)

- B(Arm, 메모리 4GB)에서 Gradle 테스트와 `bootJar`가 `-Xmx768m`으로 끝나는지, 걸리는 시간. 이 PC는 x86이라 Arm 동작은 서버에서만 본다.
- GitLab CE 아티팩트 최대 크기(jar, FE 번들)와 SSAFY 인스턴스의 만료 정책.
- `fit-deploy` 러너(shell executor)가 `gitlab-runner` 사용자로 `deploy.sh`를 돌 때의 권한 전체(`docker` 그룹, `/etc/fit` 읽기, 상태 디렉터리 쓰기, `edgectl.sh reload`). 호스트 권한 변경은 컨테이너 시험으로 모드만 확인한다.
- 진짜 토큰으로 `runner.sh register`가 동작하는지(첫 등록에서 확인).
- `corepack`이 `pnpm@11.13.0`을 내려받는 데 B의 외부 접근이 필요하다. 막혀 있으면 pnpm을 이미지에 넣는 후속이 필요하다.
- 실제 BE·FE 이미지의 준비 시간과 메모리(1C-2에서도 목 이미지로만 확인했다).

## 후속 계획

| 계획 | 내용 |
|---|---|
| 계획 2(서버 수령 후) | 위 "서버 적용 절차" 실행, 첫 dev 배포와 prod 수동 배포, 리허설 |
| 아티팩트 한도 대응(필요 시) | jar·번들을 B에서 A로 `rsync`로 넘기는 잡 |
| Modal 배포 CI(P2) | `ai/` 배포를 deploy 러너 잡으로(설계 11.2절) |
