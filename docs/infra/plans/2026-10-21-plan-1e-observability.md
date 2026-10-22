# 관측성과 감시 구현 계획 (Plan 1E)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버 A의 관측 스택(Prometheus, Alertmanager, Grafana, exporter, Dozzle)과 서버 B의 감시 스택(A를 밖에서 보는 프로브, 인증서, 감시 체계 감시, 백업 금고, 포트 노출 감사)을 compose와 저장소 설정으로 정의하고, 알림 규칙을 `promtool test rules`로, 라우팅을 `amtool`로 CI에서 검증하며, 서버 없이 실제 Prometheus·Alertmanager·blackbox·node-exporter·cAdvisor·Grafana를 띄워 알림이 Mattermost 형식으로 도착하는 데까지 노트북에서 시험한다. 일일 점검 요약과 엣지의 `/_ops` 경로도 만든다.

**Architecture:** `infra/obs/compose.obs.yml`(프로젝트 `fit-obs`)과 `infra/ops/compose.ops.yml`(프로젝트 `fit-ops`)이 스택을 정의한다. 서버마다 다른 값(B의 IP, A의 주소, `/_ops` 자격, 웹훅)은 일회성 서비스(`obs-init`, `ops-init`)가 환경변수에서 설정 파일로 만들고(`render.py`), 나머지 설정은 저장소 파일 그대로 쓴다. 호스트가 쓰는 지표(백업, 금고, 포트 감사)는 파일로 쓰고 node-exporter의 textfile collector가 읽는다. B는 표준 라이브러리만 쓰는 TCP 스캔(`port-audit.py`)으로 A의 열린 포트를 감사하고, A의 엣지(Caddy)는 B의 IP와 basic auth를 모두 통과한 요청에만 `/_ops/*/healthy`를 열고 아니면 404를 준다. 알림은 Alertmanager `slack_configs`로 Mattermost 수신 웹훅에 보내고(주소는 `api_url_file`), 시험은 웹훅 대역이 받은 JSON을 본다. 타이머가 root로 도는 코드(일일 점검 요약, 포트 감사)는 저장소 체크아웃이 아니라 root 소유 사본이다.

**Tech Stack:** bash, Docker Compose v2(2.24 이상, `!override`), `prom/prometheus:v3.15.0`, `prom/alertmanager:v0.34.1`, `prom/blackbox-exporter:v0.28.0`, `prom/node-exporter:v1.12.1`, cAdvisor, postgres-exporter, OpenSearch exporter, Grafana, Dozzle, Caddy 2.11.7, python 3(표준 라이브러리), openssl, 시험용 `ubuntu:24.04`와 `docker:29.9.0-cli`.

**Spec:** [docs/infra/design.md](../design.md) (2.2절 네트워크, 4절 자원 예산, 5.2절 라우팅, 9절 관측성·알림, 10.1절 일일 점검, 13절 보안)

## 한눈에 보기

각 Task는 구현, 통과 확인, 커밋 순서다(커밋은 허용된 경우에만). Task 2, 4, 7, 8의 시험이 이 계획의 게이트다.

| Task | 만드는 것 | 막는 사고 |
|---|---|---|
| 1 | 검사 도구(`check_alerts.py`, `check-prometheus.sh`, `check-alertmanager.sh`), Alertmanager 이미지 핀, CI 잡, 로컬 러너 | 알림 규칙에 runbook이 없거나 단위 시험이 없음, 라우팅이 엉뚱한 수신자로 감, 죽은 검사 |
| 2 | A 관측 스택 정의(compose, 규칙 35개와 단위 시험, Alertmanager, Grafana 대시보드 3개), `fit_monitor` role | 알림 식이 조용히 틀림, 비밀(웹훅)이 설정 파일이나 로그에 남음, 컨테이너가 호스트에 포트를 게시함, 메모리 예산 초과 |
| 3 | A 운영 스크립트(`verify-obs.sh`, `daily-digest.py`, `install.sh`, 타이머) | 스택이 설계와 다르게 떠 있는데 모름, 알림 채널이 끊겨도 하루에 한 번 상태를 못 봄, 타이머가 CI가 바꿀 수 있는 코드를 root로 실행 |
| 4 | A 관측 시험(`test/test-obs.sh`) | 규칙·라우팅·메시지 형식은 실제로 돌려 보기 전에는 믿을 수 없음 |
| 5 | B 감시 스택 정의(compose, 규칙 19개와 단위 시험, Alertmanager, blackbox) | A가 죽었는데 아무도 모름, 인증서 만료, 감시 체계 자체의 침묵 |
| 6 | B 운영 스크립트(`port-audit.py`, `install.sh`, `ops-up.sh`, `verify-ops.sh`, 타이머) | 22·80·443 말고 열린 포트를 모름, 감사가 멈췄는데 모름 |
| 7 | B 감시 시험(`test/test-ops.sh`, 가짜 A) | A가 죽는 상황, 금고 지표, 열린 포트가 알림까지 이어지는지 확인할 길이 없음 |
| 8 | 엣지의 `/_ops` 경로와 시험, 환경변수 계약(obs, ops, edge 키) | 감시용 경로가 밖에 열림, 401로 경로 존재를 알림, B의 IP가 바뀌어도 조용함 |
| 9 | 문서(관측·감시 README, 지표 계약, 설계·로드맵 동기화)와 검사 연결 | 문서와 구현이 어긋남, 새 compose가 포트 검사에서 빠짐 |

이 계획은 서버 A와 B의 관측·감시만 만든다. 런북 RB-01~13의 본문과 포팅 매뉴얼은 계획 1G가, CI 파이프라인(`be:test` 등)은 계획 1C-3이 만든다. BE가 내는 지표 이름은 [metrics.md](../contracts/metrics.md)의 제안이고 BE·AI 팀과 합의해야 한다.

## 검증 결과

이 계획의 코드는 저장소를 clone한 임시 복사본(저장소 밖)에서 계획의 코드 블록만으로 다시 만들어 실행해 확인했다.

- A 관측 시험(`test-obs.sh run`)은 처음 상태에서 구역 제목 10개, `PASS` 93개, `FAIL` 0개로 통과한다. 실제 Prometheus v3.15.0, Alertmanager v0.34.1, Grafana, node-exporter, cAdvisor, blackbox, postgres-exporter, OpenSearch exporter, Dozzle을 띄우고 실제 Postgres 16·OpenSearch 3.9(데이터 시험 환경)를 읽는다. 가짜 BE·Caddy·B와 웹훅 대역, TLS 서버를 쓴다.
- B 감시 시험(`test-ops.sh run`)은 구역 제목 10개, `PASS` 101개, `FAIL` 0개로 통과한다. 실제 Prometheus·Alertmanager·blackbox·node-exporter에 가짜 A(Caddy 내부 CA 인증서, `/healthz`, basic auth가 걸린 `/_ops`)와 포트 감사 대상을 붙인다.
- 엣지 시험(`test-edge.sh verify`)은 `FAIL` 0개, `PASS` 126개로 통과하고 그 가운데 `/_ops` 점검이 24개다. 데이터 시험(`test-data.sh run`)은 `fit_monitor` role을 더한 뒤에도 구역 10개, `PASS` 62개, `FAIL` 0개로 통과한다.
- 시험이 죽은 검사가 아닌지 확인하려고 규칙·라우팅·스크립트·Caddyfile을 36곳 일부러 망가뜨렸다. 모든 경우에 해당 점검이 실패로 잡았고 살아남은 변형은 없다. 알림 식의 임계값 6곳, 라우팅 수신자 3곳, runbook·이름·데이터소스·runbook ID 4곳, 포트 감사(예상 밖 포트 무시, 전체 스캔 범위, 원자적 쓰기, `verify-ops.sh` 기준), 설정 생성기의 검증 3곳, 설치 스크립트의 모드 4곳, `ops-up.sh`의 검사 2곳, 일일 요약(KST 오프셋, 인증서 경고 기준, 웹훅 실패 무시), 점검 스크립트의 보존 크기 기준, 엣지의 `remote_ip` 삭제, `basic_auth` 삭제, `rewrite` 삭제, `WWW-Authenticate` 삭제 무력화, `handle_errors` 무력화, 그 밖의 `/_ops` 응답 코드 변경이다.
- 알림: 알림 규칙 54개(A 35, B 19)가 모두 `promtool test rules`를 통과하고(A 단위 시험 6파일, B 3파일) `check_alerts.py`가 이름·severity·summary·description·runbook·시험의 존재를 확인한다. Alertmanager 라우팅 시험(A 6줄, B 2줄)이 통과한다. 실제 스택에서 가짜 BE를 내리면 `FitBeProdDown`이 main 수신자에, dev BE는 dev 수신자에 Slack 형식(제목 `[FIRING:N] 이름 (site/env)`, 본문 요약·설명·런북, 색)으로 도착하고 복구되면 `[RESOLVED]`가 온다. 백업·금고 지표 파일(textfile)의 값을 바꾸거나 지우면 알림이 오고, 가짜 A를 멈추면 외부 접근·포트·감시 체계·TLS 알림 네 가지가 온다. 내부 CA 인증서(12시간)로 만료 임박 알림도 확인했다.
- 포트 감사: 22·80·443만 열려 있으면 예상 밖 0개, 8080이 열리면 `FitPortExposed`가 오고 `verify-ops.sh`가 실패하며 닫으면 해소된다. quick은 높은 번호 포트를 보지 않고 full은 찾는다. 이름을 찾지 못하면 종료 코드 1이고 지표를 건드리지 않는다.
- `/_ops`: B의 IP와 올바른 자격이면 200이고, 틀린 비밀번호·사용자·IP, 자격 없음, 그 밖의 `/_ops` 경로, dev 호스트는 모두 404이며 `WWW-Authenticate` 헤더가 없다. `B_IP`나 `OPS_BASIC_AUTH_HASH`가 없으면 compose가 거부한다. `caddy hash-password` 출력의 base64를 Caddy가 받아들인다(설계 13.2절의 가정을 확인했다).
- 대시보드 3개가 프로비저닝되고 그 안의 쿼리 31개가 모두 Prometheus에서 성공한다. 일일 요약은 모든 행을 내고 인증서 잔여일(40일 정상, 5일 주의)을 서버 자신의 443에서 읽으며, 비밀을 출력하지 않고, Prometheus나 웹훅이 안 되면 종료 코드 1이다. 설치 스크립트는 A·B 모두 파일 모드·소유자를 맞추고 두 번째 실행은 변경이 0건이며 손으로 고친 사본을 되돌린다. 유닛 파일은 `systemd-analyze`로 `OnCalendar` 표현과 문법을 확인했다.
- 정적 검사: 새 compose 둘은 포트 불변식(호스트 게시는 127.0.0.1뿐)과 이미지 아키텍처(arm64·amd64) 검사를 통과한다. 러너(`run-local-checks.sh`)와 자체 시험이 통과하고, 자체 시험에 알림 규칙 점검·promtool·amtool 항목을 더했다. gitleaks 검사도 통과한다.
- 시험하다 찾아 고친 것: 일일 요약 시험이 시험 PC의 CPU 부하에 기대던 것(값이 나오는지만 본다), 이미 울린 알림을 웹훅 대역의 기록을 비운 뒤에는 찾지 못하던 것(시험 사본의 반복 간격을 30초로 줄였다), `verify-ops.sh`의 "예상 밖 포트가 있으면 실패" 경로가 시험되지 않던 것(점검을 더했다), 비밀번호 시험 값이 gitleaks에 걸린 것(저엔트로피 값으로 바꿨다), `check-caddy.sh`가 예제 env의 자리표시자(`B_IP`, 해시)를 Caddy가 받아들이지 않아 실패하던 것(문서용 IP와 즉석 해시로 바꿔 검사한다).
- Windows(Git Bash)에서 시험하며 겪은 것: Docker Desktop(WSL2)에는 `mountpoint="/"` 파일시스템이 없어 디스크 지표는 존재 여부만 본다. `chmod`가 NTFS에 반영되지 않아 파일 권한 시험(`install.sh`, `ops-up.sh`)은 Linux 컨테이너 안에서 한다. Prometheus는 보존 플래그를 `1w`, `5GiB`로 정규화해 보여 준다. `python.exe`는 `/c/…` 경로를 읽지 못하고, Bash 도구의 heredoc에 넣은 파이썬의 `\n`이 변한다(편집 스크립트는 파일로 쓴다). Docker Desktop의 포트 포워더가 새 연결을 간헐적으로 거부해 엣지 시험이 연결 실패(curl 종료 코드 7)만 다시 시도한다.

아래 코드를 그대로 옮기면 같은 결과가 나와야 한다. 다르면 코드를 고치기 전에 원인을 먼저 확인한다.

**아직 확인하지 못한 것**

- 실제 서버에서의 값: node-exporter의 `mountpoint="/"` 디스크 지표(Docker Desktop(WSL2)에는 `/`인 파일시스템이 없어 시험은 `node_filesystem_avail_bytes`가 있는지만 본다), OOM 킬 지표(`node_vmstat_oom_kill`)의 실제 값, 서버의 Docker 버전에서 cAdvisor·Dozzle 호환(시험은 로컬 Docker 29.7.2).
- 실제 Mattermost 웹훅 전달. 시험은 웹훅 대역이 받은 Slack 형식 JSON까지다.
- systemd 타이머의 실제 실행(`OnCalendar`, 재부팅 뒤 기동). 유닛 파일은 `systemd-analyze`로 문법과 `OnCalendar` 표현만 확인했다.
- `/_ops`의 `remote_ip`가 실제 A↔B 네트워크에서 B의 공인 IP로 보이는지(Docker 게시 포트의 NAT와 IPv6에서 출발지 주소가 보존되는지). 시험은 compose 망의 고정 IP다.
- BE·AI 팀과의 지표 이름 합의. 시험은 가짜 지표로 한다.
- 실제 데이터 크기에서의 Prometheus 메모리·디스크(설계 4.1절 예산)와 실제 부하에서의 CPU 알림.

## Global Constraints

1A·1B·1C-1·1F·1C-2·1D의 전역 제약이 모두 적용된다([plan 1A](2026-10-15-plan-1a-foundation-guardrails.md), [plan 1B](2026-10-19-plan-1b-local-env-contracts.md), [plan 1C-1](2026-10-20-plan-1c1-edge.md), [plan 1F](2026-10-20-plan-1f-host.md), [plan 1C-2](2026-10-21-plan-1c2-deploy.md), [plan 1D](2026-10-21-plan-1d-data-backup.md)). 이 계획에서 더 지키는 것은 다음과 같다.

- 비밀 값(웹훅 주소, 비밀번호, 해시)을 화면, 로그, 설정 API에 출력하지 않는다. Alertmanager 웹훅은 `api_url_file`로 파일에서 읽고, `render.py`는 만든 파일의 이름만 출력한다.
- 호스트에 게시하는 포트는 A의 `127.0.0.1`의 9090(Prometheus), 3000(Grafana), 8888(Dozzle)과 B의 `127.0.0.1`의 9090, 9093뿐이다. exporter와 Alertmanager(A)는 게시하지 않는다.
- 메모리 한도의 합은 설계 4절의 예산 안이다(A의 관측 1.4GB, B의 ops 0.4GB).
- 모든 알림 규칙은 `Fit` 접두사 이름, `severity`, `summary`, `description`, `runbook`(RB-01~13)을 갖고 `prometheus/tests/`에 그 이름의 단위 시험이 있다(`check_alerts.py`가 강제한다). 반드시 있어야 하는 지표는 `absent()` 알림을 둔다.
- 서버마다 다른 값은 설정 파일에 적지 않고 `*-init`이 만든다. 값이 비었거나 `REPLACE_ME`이면 스택이 뜨지 않는다.
- `/_ops`는 B의 IP(`remote_ip`)와 basic auth를 모두 통과해야 하고 하나라도 틀리면 401이 아니라 404다. 이 스캔(포트 감사)은 우리 서버(A)에만 건다.
- 타이머가 root로 실행하는 코드는 root만 쓸 수 있는 사본이다(`/usr/local/lib/fit/obs`, `/usr/local/lib/fit/ops`).
- 시험용 값(웹훅 토큰, 비밀번호)은 실행할 때마다 무작위로 만들고, 저장소에 둘 값은 엔트로피가 낮아 gitleaks에 걸리지 않게 한다. 시험용 컨테이너·볼륨·망은 `fit-obstest`, `fit-opstest`, `fit-edge-test` 접두사로 만들고 `down`으로 지운다(이름 패턴 일괄 삭제 금지). 시험 디렉터리는 저장소 안의 `.tmp-obstest/`, `.tmp-opstest/`다(`.gitignore`에 있다).
- Windows(Git Bash)에서 시험이 돌아야 한다. `docker`와 `python`에 넘기는 경로는 `pwd -W`로 바꾸고, 파일 권한이 필요한 시험(`install.sh`, `ops-up.sh`)은 Linux 컨테이너 안에서 돈다. Python 코드 안의 백슬래시가 든 문자열은 셸 heredoc으로 편집하지 않는다.
- 브랜치는 `infra/feat/observability-S15P31A302-19`다. 커밋 메시지는 1B와 같은 규칙이다.

## 파일 구조

모든 경로는 저장소 루트(`C:\Users\SSAFY\ssafy\S15P31A302`) 기준이다.

| 파일 | 책임 |
|---|---|
| `infra/ci/check_alerts.py`, `check-prometheus.sh`, `check-alertmanager.sh`, `tests/test_check_alerts.py` | 알림 규칙·대시보드 검사, promtool·amtool 검사 |
| `infra/obs/compose.obs.yml`, `obs.env.example`, `render.py` | A 관측 스택 정의, 키 예제, 설정 생성기 |
| `infra/obs/prometheus/`, `alertmanager/`, `grafana/`, `blackbox/` | A의 수집 설정, 알림 규칙(35개)과 단위 시험, 라우팅과 메시지 견본, 대시보드 3개 |
| `infra/obs/verify-obs.sh`, `daily-digest.py`, `install.sh`, `conf/systemd/` | A의 점검, 일일 점검 요약, 설치와 타이머 |
| `infra/obs/test/` | A 관측 시험(`test-obs.sh`, `compose.test.yml`, 가짜 대상, 웹훅 대역, TLS 서버) |
| `infra/ops/compose.ops.yml`, `ops.env.example`, `render.py` | B 감시 스택 정의, 키 예제, 설정 생성기 |
| `infra/ops/prometheus/`, `alertmanager/`, `blackbox/` | B의 프로브·금고·B 자신 알림 규칙(19개)과 단위 시험, 라우팅, 프로브 모듈 |
| `infra/ops/port-audit.py`, `install.sh`, `ops-up.sh`, `verify-ops.sh`, `conf/systemd/` | 포트 노출 감사, 설치, 올리기, 점검 |
| `infra/ops/test/` | B 감시 시험(`test-ops.sh`, `compose.test.yml`) |
| `infra/edge/conf/Caddyfile`, `compose.edge.yml`, `edge.env.example`, `verify-edge.sh`, `README.md`, `test/` | (수정) `/_ops` 경로, 키, 점검, 시험. `test/ops_mock.py`, `ops_probe.py`는 새 파일 |
| `infra/data/`의 `ensure-databases.sh`, `lib.sh`, `verify-data.sh`, `data.env.example`, `README.md`, `test/test-data.sh` | (수정) `fit_monitor` role |
| `infra/ci/tool-images.sh`, `.gitlab-ci.yml`, `.gitignore`, `infra/ci/run-local-checks.sh`, `infra/ci/compose-projects.txt`, `infra/ci/check-caddy.sh` | (수정) 이미지 핀, CI 잡, 러너, 검사 대상 |
| `docs/infra/contracts/env.md`, `README.md`, `metrics.md` | (수정·신규) 환경변수 계약(obs, ops 그룹과 키), 지표 계약 |
| `docs/infra/design.md`, `docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md`, `infra/README.md`, `infra/backup/README.md`, `infra/obs/README.md`, `infra/ops/README.md` | (수정·신규) 문서 |

## 후속 계획

| 계획 | 이 계획의 산출물을 쓰는 방식 |
|---|---|
| 1C-3 CI 파이프라인 | `lint:prometheus`, `lint:alertmanager`는 이 계획이 이미 `.gitlab-ci.yml`에 더했다. 배포 잡은 `fit-up.sh`가 obs를 올리는 순서를 그대로 쓴다 |
| 1G 런북 | 모든 알림의 `runbook` 라벨(RB-01~13, RB-02b)이 가리키는 런북 본문을 쓴다. 일일 점검과 포트 감사 대응 절차를 넣는다 |
| 계획 2(서버 수령 후) | `install.sh`로 A·B에 깔고, `obs.env`·`ops.env`와 `/_ops` 자격을 만들고, `verify-obs.sh`·`verify-ops.sh`로 확인한다. `mountpoint="/"`, OOM 지표, 실제 Mattermost 전달, `remote_ip`를 서버에서 확인한다 |

---

### Task 1: 검사 도구와 이미지 핀

**목표:** 알림 규칙과 대시보드를 검사하는 도구와, Prometheus·Alertmanager 설정을 각 도구 이미지로 검사하는 스크립트를 먼저 만든다. 이 Task에는 규칙 파일이 없어서 도구는 `SKIP`을 낸다. 규칙이 생기는 Task 2부터 이 도구들이 게이트다.

**Files:**
- Create: `infra/ci/check_alerts.py`, `infra/ci/tests/test_check_alerts.py`, `infra/ci/check-prometheus.sh`, `infra/ci/check-alertmanager.sh`
- Modify: `infra/ci/tool-images.sh`, `.gitlab-ci.yml`, `.gitignore`, `infra/ci/run-local-checks.sh`

**Interfaces:**
- Consumes: 1A의 `tool-images.sh`와 `.gitlab-ci.yml`의 핀 동기화 시험(`test_tool_images_sync.py`), 러너(`run-local-checks.sh`)
- Produces: `python infra/ci/check_alerts.py [--root 루트]`(알림 이름·severity·summary·description·runbook·단위 시험, 대시보드 uid·패널 id·데이터소스), `sh infra/ci/check-prometheus.sh`(promtool, prom 이미지 안에서), `sh infra/ci/check-alertmanager.sh`(amtool과 라우팅 시험 `routes.txt`, alertmanager 이미지 안에서), `ALERTMANAGER_IMAGE` 핀, CI 잡 `lint:prometheus`·`lint:alertmanager`, 러너의 검사 단계와 자체 시험

핵심 결정:

- 검사 도구는 YAML 파서 없이 줄 단위로 읽는다(표준 라이브러리만). PromQL 문법과 단위 시험의 통과는 promtool이 본다.
- 도구가 대상을 못 찾으면 `SKIP`을 내고 성공한다(계획 순서와 무관하게 CI에 먼저 넣을 수 있다). 자체 시험(`--self-test`)은 나쁜 입력을 거부하는지 보아 죽은 검사를 막는다.
- `check-alertmanager.sh`는 웹훅 주소 파일(`api_url_file`)이 서버에서 만들어지므로 임시 폴더에 가짜 파일을 두고 경로만 바꿔 `amtool check-config`를 돌린다. 라우팅은 각 디렉터리의 `routes.txt`(한 줄이 한 시험: 기대 수신자와 라벨)로 시험한다.

- [ ] **Step 1: 환경 확인과 브랜치**

Run (저장소 루트, Git Bash):

```bash
python --version
docker version --format 'server={{.Server.Version}}'
docker compose version
git status --short
```

Expected: Python 3.9 이상, Docker 서버 버전 출력, Compose v2.24 이상, 작업 트리가 깨끗하다.

사용자에게 커밋 허용 여부를 한 번 묻는다. 허용하면 `git switch -c infra/feat/observability-S15P31A302-19`로 브랜치를 만든 뒤 시작한다. 허용하지 않으면 모든 커밋 단계를 건너뛴다.

- [ ] **Step 2: 검사 도구 작성**

`infra/ci/check_alerts.py`:

````python
#!/usr/bin/env python3
"""알림 규칙과 Grafana 대시보드의 규칙 검사(설계 9.4절). 표준 라이브러리만 쓴다(YAML 파서가 없어 줄 단위로 읽는다).

알림 규칙(infra/obs/prometheus, infra/ops/prometheus의 rules/*.yml)
  - 이름은 Fit으로 시작하고 중복이 없다.
  - severity(critical, warning, info), summary, description, runbook이 있다. runbook은 설계 10.2절의 런북 ID(RB-01 ~ RB-13, RB-02b)다.
  - 같은 prometheus 디렉터리의 tests/*.yml에 그 이름의 단위 시험(alertname)이 있다.
대시보드(grafana/dashboards/*.json)
  - JSON이고 uid와 title이 파일 사이에 겹치지 않으며 패널 id가 겹치지 않는다.
  - 패널과 대상의 데이터소스 uid가 grafana/provisioning/datasources의 uid 중 하나다. 대상(target)마다 expr가 있다.
규칙의 PromQL 문법과 단위 시험의 통과는 promtool이 본다(infra/ci/check-prometheus.sh).

사용: python infra/ci/check_alerts.py [--root 저장소 루트]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

RUNBOOKS = {f"RB-{n:02d}" for n in range(1, 14)} | {"RB-02b"}
SEVERITIES = {"critical", "warning", "info"}
ALERT_LINE = re.compile(r"^(?P<indent>\s*)-\s+alert:\s*(?P<name>\S+)\s*$")
RULE_START = re.compile(r"^\s*-\s+(alert|record):")


@dataclass
class Alert:
    name: str
    file: str
    line: int
    block: str


def parse_alerts(text: str, file: str = "") -> list[Alert]:
    """`- alert: 이름` 줄부터 다음 규칙(`- alert:`나 `- record:`) 직전까지를 한 알림으로 본다."""
    lines = text.split("\n")
    alerts: list[Alert] = []
    start = None
    name = ""
    for i, ln in enumerate(lines + ["- record: __end__"]):
        if RULE_START.match(ln):
            if start is not None:
                alerts.append(Alert(name, file, start + 1, "\n".join(lines[start:i])))
                start = None
            m = ALERT_LINE.match(ln)
            if m:
                start, name = i, m.group("name")
    return alerts


def alert_problems(a: Alert) -> list[str]:
    """알림 하나의 빠진 항목."""
    problems = []
    if not re.fullmatch(r"Fit[A-Z][A-Za-z0-9]*", a.name):
        problems.append("이름은 Fit으로 시작하는 파스칼 케이스여야 한다")
    sev = re.search(r"severity:\s*(\w+)", a.block)
    if not sev or sev.group(1) not in SEVERITIES:
        problems.append("severity 라벨(critical, warning, info)이 없다")
    for key in ("summary", "description"):
        if not re.search(rf"^\s*{key}:\s*\S", a.block, re.M):
            problems.append(f"{key} 주석이 없다")
    rb = re.search(r"^\s*runbook:\s*(\S+)", a.block, re.M)
    if not rb:
        problems.append("runbook 주석이 없다")
    elif rb.group(1) not in RUNBOOKS:
        problems.append(f"runbook {rb.group(1)}은(는) 설계 10.2절의 런북 ID가 아니다")
    if not re.search(r"^\s*expr:", a.block, re.M):
        problems.append("expr가 없다")
    return problems


def tested_names(tests_dir: Path) -> set[str]:
    names: set[str] = set()
    for f in sorted(tests_dir.glob("*.yml")):
        names.update(re.findall(r"alertname:\s*(\S+)", f.read_text(encoding="utf-8")))
    return names


def check_rules(prom_dir: Path) -> list[str]:
    """prometheus 디렉터리 하나의 알림 규칙 문제 목록."""
    failures = []
    alerts: list[Alert] = []
    for f in sorted((prom_dir / "rules").glob("*.yml")):
        alerts += parse_alerts(f.read_text(encoding="utf-8"), f"{f.parent.parent.name}/{f.name}")
    seen: dict[str, Alert] = {}
    tested = tested_names(prom_dir / "tests") if (prom_dir / "tests").is_dir() else set()
    for a in alerts:
        where = f"{a.file}:{a.line} {a.name}"
        if a.name in seen:
            failures.append(f"{where}: 이름이 {seen[a.name].file}:{seen[a.name].line}과 겹친다")
        seen[a.name] = a
        failures += [f"{where}: {p}" for p in alert_problems(a)]
        if a.name not in tested:
            failures.append(f"{where}: tests/에 단위 시험(alertname: {a.name})이 없다")
    if not alerts:
        failures.append(f"{prom_dir}/rules: 알림 규칙이 하나도 없다")
    return failures


def datasource_uids(obs_dir: Path) -> set[str]:
    uids: set[str] = set()
    for f in (obs_dir / "grafana" / "provisioning" / "datasources").glob("*.yml"):
        uids.update(re.findall(r"^\s*uid:\s*(\S+)", f.read_text(encoding="utf-8"), re.M))
    return uids


def check_dashboards(obs_dir: Path) -> list[str]:
    failures = []
    uids = datasource_uids(obs_dir)
    seen_uid: dict[str, str] = {}
    seen_title: dict[str, str] = {}
    files = sorted((obs_dir / "grafana" / "dashboards").glob("*.json"))
    if not files:
        return [f"{obs_dir}/grafana/dashboards: 대시보드가 없다"]
    for f in files:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except ValueError as e:
            failures.append(f"{f.name}: JSON이 아니다({e})")
            continue
        for key, seen in (("uid", seen_uid), ("title", seen_title)):
            v = d.get(key)
            if not v:
                failures.append(f"{f.name}: {key}가 없다")
            elif v in seen:
                failures.append(f"{f.name}: {key} {v!r}이(가) {seen[v]}와 겹친다")
            else:
                seen[v] = f.name
        ids = [p.get("id") for p in d.get("panels", [])]
        if len(ids) != len(set(ids)):
            failures.append(f"{f.name}: 패널 id가 겹친다")
        for p in d.get("panels", []):
            ds = (p.get("datasource") or {}).get("uid")
            if ds not in uids:
                failures.append(f"{f.name} 패널 {p.get('id')}: 데이터소스 uid {ds!r}가 프로비저닝에 없다({sorted(uids)})")
            for t in p.get("targets", []):
                if not t.get("expr"):
                    failures.append(f"{f.name} 패널 {p.get('id')}: 쿼리(expr)가 비었다")
                tds = (t.get("datasource") or {}).get("uid")
                if tds is not None and tds not in uids:
                    failures.append(f"{f.name} 패널 {p.get('id')}: 쿼리의 데이터소스 uid {tds!r}가 프로비저닝에 없다")
    return failures


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=".", help="저장소 루트")
    args = ap.parse_args(argv)
    root = Path(args.root)
    failures: list[str] = []
    checked = 0
    for obs in (root / "infra" / "obs", root / "infra" / "ops"):
        prom = obs / "prometheus"
        if (prom / "rules").is_dir():
            checked += 1
            failures += check_rules(prom)
        if (obs / "grafana" / "dashboards").is_dir():
            failures += check_dashboards(obs)
    if not checked:
        print("SKIP alerts (알림 규칙 없음)")
        return 0
    for f in failures:
        print(f"FAIL {f}")
    if failures:
        return 1
    print(f"OK alerts ({checked}개 스택)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
````

`infra/ci/tests/test_check_alerts.py`:

````python
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_alerts as ca  # noqa: E402

GOOD = """groups:
  - name: g
    rules:
      - alert: FitGood
        expr: up == 0
        for: 1m
        labels: {severity: critical}
        annotations:
          summary: 요약
          description: 설명
          runbook: RB-03
      - record: fit:thing
        expr: sum(up)
"""
TEST = "tests:\n  - alert_rule_test:\n      - alertname: FitGood\n"


class AlertRulesTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.prom = Path(self._tmp.name) / "prometheus"
        (self.prom / "rules").mkdir(parents=True)
        (self.prom / "tests").mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def put(self, rules: str = GOOD, tests: str = TEST):
        (self.prom / "rules" / "a.yml").write_text(rules, encoding="utf-8")
        (self.prom / "tests" / "a.test.yml").write_text(tests, encoding="utf-8")

    def test_good_rules_pass(self):
        self.put()
        self.assertEqual(ca.check_rules(self.prom), [])

    def test_record_rules_are_not_alerts(self):
        alerts = ca.parse_alerts(GOOD)
        self.assertEqual([a.name for a in alerts], ["FitGood"])

    def test_missing_runbook_is_flagged(self):
        self.put(GOOD.replace("          runbook: RB-03\n", ""))
        self.assertTrue(any("runbook 주석이 없다" in f for f in ca.check_rules(self.prom)))

    def test_unknown_runbook_id_is_flagged(self):
        self.put(GOOD.replace("RB-03", "RB-99"))
        self.assertTrue(any("RB-99" in f for f in ca.check_rules(self.prom)))

    def test_runbook_variant_rb02b_is_allowed(self):
        self.put(GOOD.replace("RB-03", "RB-02b"))
        self.assertEqual(ca.check_rules(self.prom), [])

    def test_missing_or_invalid_severity_is_flagged(self):
        self.put(GOOD.replace("severity: critical", "severity: urgent"))
        self.assertTrue(any("severity" in f for f in ca.check_rules(self.prom)))
        self.put(GOOD.replace("labels: {severity: critical}\n", ""))
        self.assertTrue(any("severity" in f for f in ca.check_rules(self.prom)))

    def test_missing_description_is_flagged(self):
        self.put(GOOD.replace("          description: 설명\n", ""))
        self.assertTrue(any("description 주석이 없다" in f for f in ca.check_rules(self.prom)))

    def test_alert_without_unit_test_is_flagged(self):
        self.put(tests="tests: []\n")
        self.assertTrue(any("단위 시험" in f and "FitGood" in f for f in ca.check_rules(self.prom)))

    def test_bad_name_is_flagged(self):
        self.put(GOOD.replace("FitGood", "badName"), TEST.replace("FitGood", "badName"))
        self.assertTrue(any("Fit으로 시작" in f for f in ca.check_rules(self.prom)))

    def test_duplicate_name_is_flagged(self):
        dup = GOOD + GOOD.split("rules:\n")[1].split("      - record")[0]
        self.put(dup)
        self.assertTrue(any("겹친다" in f for f in ca.check_rules(self.prom)))

    def test_empty_rules_dir_is_flagged(self):
        self.put("groups: []\n")
        self.assertTrue(any("하나도 없다" in f for f in ca.check_rules(self.prom)))

    def test_missing_expr_is_flagged(self):
        self.put(GOOD.replace("        expr: up == 0\n", ""))
        self.assertTrue(any("expr가 없다" in f for f in ca.check_rules(self.prom)))


class DashboardsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.obs = Path(self._tmp.name)
        (self.obs / "grafana" / "dashboards").mkdir(parents=True)
        ds = self.obs / "grafana" / "provisioning" / "datasources"
        ds.mkdir(parents=True)
        (ds / "p.yml").write_text("datasources:\n  - name: P\n    uid: prom-a\n    type: prometheus\n", encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def dash(self, name: str, uid="u1", title="t1", panels=None):
        if panels is None:
            panels = [{"id": 1, "datasource": {"uid": "prom-a"}, "targets": [{"expr": "up", "datasource": {"uid": "prom-a"}}]}]
        (self.obs / "grafana" / "dashboards" / name).write_text(json.dumps({"uid": uid, "title": title, "panels": panels}), encoding="utf-8")

    def test_good_dashboard_passes(self):
        self.dash("a.json")
        self.assertEqual(ca.check_dashboards(self.obs), [])

    def test_invalid_json_is_flagged(self):
        (self.obs / "grafana" / "dashboards" / "a.json").write_text("{", encoding="utf-8")
        self.assertTrue(any("JSON이 아니다" in f for f in ca.check_dashboards(self.obs)))

    def test_duplicate_uid_and_title_are_flagged(self):
        self.dash("a.json")
        self.dash("b.json")
        failures = ca.check_dashboards(self.obs)
        self.assertTrue(any("uid" in f and "겹친다" in f for f in failures))
        self.assertTrue(any("title" in f and "겹친다" in f for f in failures))

    def test_unknown_datasource_is_flagged(self):
        self.dash("a.json", panels=[{"id": 1, "datasource": {"uid": "nope"}, "targets": [{"expr": "up"}]}])
        self.assertTrue(any("nope" in f for f in ca.check_dashboards(self.obs)))

    def test_empty_expr_is_flagged(self):
        self.dash("a.json", panels=[{"id": 1, "datasource": {"uid": "prom-a"}, "targets": [{"expr": ""}]}])
        self.assertTrue(any("expr" in f for f in ca.check_dashboards(self.obs)))

    def test_duplicate_panel_ids_are_flagged(self):
        p = {"id": 1, "datasource": {"uid": "prom-a"}, "targets": [{"expr": "up"}]}
        self.dash("a.json", panels=[p, p])
        self.assertTrue(any("패널 id" in f for f in ca.check_dashboards(self.obs)))

    def test_no_dashboards_is_flagged(self):
        for f in (self.obs / "grafana" / "dashboards").glob("*.json"):
            f.unlink()
        self.assertTrue(any("대시보드가 없다" in f for f in ca.check_dashboards(self.obs)))


class MainTest(unittest.TestCase):
    def test_skip_when_no_stacks(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(ca.main(["--root", d]), 0)

    def test_real_repo_passes(self):
        root = Path(__file__).resolve().parents[3]
        self.assertEqual(ca.main(["--root", str(root)]), 0)


if __name__ == "__main__":
    unittest.main()
````

`infra/ci/check-prometheus.sh`:

````bash
#!/bin/sh
# Prometheus 설정, 알림 규칙, 규칙 단위 시험을 promtool로 검사한다(설계 9.4절: 모든 규칙을 promtool test rules로 CI에서 검증한다).
# 저장소 루트에서 prom/prometheus 이미지(PROMETHEUS_IMAGE)로 실행한다. entrypoint는 비운다:
#   docker run --rm --entrypoint "" -v "$PWD:/work" -w /work "$PROMETHEUS_IMAGE" sh infra/ci/check-prometheus.sh
# 대상: A(infra/obs/prometheus)와 B(infra/ops/prometheus). 없는 디렉터리는 건너뛴다.
# file_sd 대상 파일(/generated/...)은 서버가 뜰 때 만들어지므로 없다는 경고는 정상이다.
set -eu
cd "$(dirname "$0")/../.."
status=0
found=0
for dir in infra/obs/prometheus infra/ops/prometheus; do
  [ -f "$dir/prometheus.yml" ] || continue
  found=1
  echo "== $dir"
  promtool check config "$dir/prometheus.yml" || status=1
  if ls "$dir"/tests/*.yml >/dev/null 2>&1; then
    promtool test rules "$dir"/tests/*.yml || status=1
  else
    echo "FAIL $dir/tests/에 단위 시험이 없다"
    status=1
  fi
done
[ "$found" = 1 ] || echo "SKIP prometheus 설정 없음"
exit "$status"
````

`infra/ci/check-alertmanager.sh`:

````bash
#!/bin/sh
# Alertmanager 설정을 amtool로 검사하고 알림이 의도한 수신자로 가는지 시험한다(설계 9.4절).
# 저장소 루트에서 prom/alertmanager 이미지(ALERTMANAGER_IMAGE)로 실행한다. entrypoint는 비운다:
#   docker run --rm --entrypoint "" -v "$PWD:/work" -w /work "$ALERTMANAGER_IMAGE" sh infra/ci/check-alertmanager.sh
# 대상: A(infra/obs/alertmanager)와 B(infra/ops/alertmanager). 없는 디렉터리는 건너뛴다.
# 웹훅 주소 파일(api_url_file)은 서버가 뜰 때 만들어지므로 임시 폴더에 가짜 파일을 두고 경로만 바꿔 검사한다.
# 라우팅 시험 목록은 각 디렉터리의 routes.txt다. 한 줄이 한 시험이다: <기대 수신자> <라벨=값>...
set -eu
cd "$(dirname "$0")/../.."
T="$(mktemp -d)"
status=0
found=0
for dir in infra/obs/alertmanager infra/ops/alertmanager; do
  [ -f "$dir/alertmanager.yml" ] || continue
  found=1
  work="$T/$(basename "$(dirname "$dir")")"
  mkdir -p "$work/secrets" "$work/templates"
  for f in mattermost_url mattermost_url_dev; do echo "http://example.test/hook" >"$work/secrets/$f"; done
  cp "$dir"/templates/*.tmpl "$work/templates/"
  sed -e "s#/generated/secrets#$work/secrets#g" -e "s#/etc/alertmanager/templates#$work/templates#g" "$dir/alertmanager.yml" >"$work/alertmanager.yml"
  echo "== $dir"
  amtool check-config "$work/alertmanager.yml" || status=1
  while read -r want labels; do
    case "$want" in "" | \#*) continue ;; esac
    # shellcheck disable=SC2086
    got="$(amtool config routes test --config.file="$work/alertmanager.yml" $labels)"
    if [ "$got" = "$want" ]; then
      echo "OK   $labels -> $got"
    else
      echo "FAIL $labels -> $got (기대: $want)"
      status=1
    fi
  done <"$dir/routes.txt"
done
[ "$found" = 1 ] || echo "SKIP alertmanager 설정 없음"
rm -rf "$T"
exit "$status"
````

- [ ] **Step 3: 이미지 핀, CI 잡, 러너, gitignore 수정**

도구 이미지 핀(`ALERTMANAGER_IMAGE`)을 더한다. `.gitlab-ci.yml`의 `variables`와 같아야 한다(시험이 검사한다):

````diff
diff --git a/infra/ci/tool-images.sh b/infra/ci/tool-images.sh
index 771d656..9a93fc3 100644
--- a/infra/ci/tool-images.sh
+++ b/infra/ci/tool-images.sh
@@ -8,5 +8,6 @@ YAMLLINT_IMAGE=pipelinecomponents/yamllint:0.35.27
 GITLEAKS_IMAGE=zricethezav/gitleaks:v8.30.1
 CADDY_IMAGE=caddy:2.11.7
 PROMETHEUS_IMAGE=prom/prometheus:v3.15.0
+ALERTMANAGER_IMAGE=prom/alertmanager:v0.34.1
 DOCKER_CLI_IMAGE=docker:29.9.0-cli
 PYTHON_IMAGE=python:3.12.15-slim
````

CI 잡을 더한다: `lint:guards`에 `check_alerts.py`, 새 잡 `lint:prometheus`·`lint:alertmanager`, `lint:image-arch`에 관측·감시 compose(Task 2와 5가 만든다)를 더한다:

````diff
diff --git a/.gitlab-ci.yml b/.gitlab-ci.yml
index 59092b7..c43b22b 100644
--- a/.gitlab-ci.yml
+++ b/.gitlab-ci.yml
@@ -28,6 +28,7 @@ variables:
   GITLEAKS_IMAGE: zricethezav/gitleaks:v8.30.1
   CADDY_IMAGE: caddy:2.11.7
   PROMETHEUS_IMAGE: prom/prometheus:v3.15.0
+  ALERTMANAGER_IMAGE: prom/alertmanager:v0.34.1
   DOCKER_CLI_IMAGE: docker:29.9.0-cli
   PYTHON_IMAGE: python:3.12.15-slim
 
@@ -46,6 +47,7 @@ lint:guards:
     - python3 infra/ci/check_eol.py
     - python3 infra/ci/check_compose_projects.py
     - python3 infra/ci/check_env_contract.py
+    - python3 infra/ci/check_alerts.py
     - |
       files=$(git ls-files 'infra/*.env.example')
       if [ -n "$files" ]; then python3 infra/ci/check_env_files.py $files; fi
@@ -62,6 +64,8 @@ lint:image-arch:
     - python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/local/compose.yml --env-file infra/local/local.env.example --dockerfile infra/local/opensearch/Dockerfile
     - python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/edge/compose.edge.yml --compose infra/edge/test/compose.test.yml --env-file infra/edge/edge.env.example
     - python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/data/compose.data.yml --env-file infra/data/data.env.example --dockerfile infra/backup/test/node/Dockerfile
+    - python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/obs/compose.obs.yml --env-file infra/obs/obs.env.example
+    - python3 infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/ops/compose.ops.yml --env-file infra/ops/ops.env.example
   rules:
     - changes:
         - infra/ci/tool-images.sh
@@ -72,6 +76,8 @@ lint:image-arch:
         - infra/edge/test/compose.test.yml
         - infra/data/compose.data.yml
         - infra/backup/test/node/Dockerfile
+        - infra/obs/compose.obs.yml
+        - infra/ops/compose.ops.yml
 
 # 인프라 소유 파일만 엄격하게 검사한다. be·fe·ai는 각 팀 린트가 맡는다(스펙 6.3, 12.2).
 lint:shell:
@@ -97,6 +103,24 @@ lint:caddy:
   script:
     - sh infra/ci/check-caddy.sh
 
+# 알림 규칙과 규칙 단위 시험(설계 9.4절). A(infra/obs)와 B(infra/ops)의 Prometheus 설정을 promtool로 검사한다
+lint:prometheus:
+  extends: .verify
+  image:
+    name: $PROMETHEUS_IMAGE
+    entrypoint: [""]
+  script:
+    - sh infra/ci/check-prometheus.sh
+
+# Alertmanager 설정과 라우팅(알림이 의도한 수신자로 가는지)을 amtool로 검사한다
+lint:alertmanager:
+  extends: .verify
+  image:
+    name: $ALERTMANAGER_IMAGE
+    entrypoint: [""]
+  script:
+    - sh infra/ci/check-alertmanager.sh
+
 lint:yaml:
   extends: .verify
   image: $YAMLLINT_IMAGE
````

로컬 러너에 같은 검사와 자체 시험 항목(나쁜 규칙, 문법이 틀린 규칙, 수신자가 없는 설정)을 더한다:

````diff
diff --git a/infra/ci/run-local-checks.sh b/infra/ci/run-local-checks.sh
index 08072cc..428d6ff 100755
--- a/infra/ci/run-local-checks.sh
+++ b/infra/ci/run-local-checks.sh
@@ -106,6 +106,7 @@ check_all() {
     run_step "env 형식" "$PY" infra/ci/check_env_files.py "${envs[@]}"
   fi
   run_step "env 계약 (표와 예제 파일)" "$PY" infra/ci/check_env_contract.py
+  run_step "알림 규칙과 대시보드 (이름, severity, runbook, 단위 시험)" "$PY" infra/ci/check_alerts.py
   run_step "ports (compose 프로젝트)" "$PY" infra/ci/check_compose_projects.py
   # MR의 병합 기준점은 origin/master다. 병합 커밋이 있으면 rebase로 없앤다.
   if git rev-parse --verify -q origin/master >/dev/null; then
@@ -123,6 +124,9 @@ check_all() {
     run_step "arch (엣지)" "$PY" infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/edge/compose.edge.yml --compose infra/edge/test/compose.test.yml --env-file infra/edge/edge.env.example
     # 데이터 스택은 서버 A(x86)에서, 백업 시험 이미지는 개발자 PC에서 돈다
     run_step "arch (데이터, 백업 시험)" "$PY" infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/data/compose.data.yml --env-file infra/data/data.env.example --dockerfile infra/backup/test/node/Dockerfile
+    # 관측 스택은 서버 A(x86)에서, 감시 스택은 서버 B(Arm)에서 돈다
+    run_step "arch (관측 A)" "$PY" infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/obs/compose.obs.yml --env-file infra/obs/obs.env.example
+    run_step "arch (감시 B)" "$PY" infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/ops/compose.ops.yml --env-file infra/ops/ops.env.example
   fi
   # 인프라 소유 파일만 엄격하게 본다. be·fe·ai는 각 팀 린트가 맡는다(스펙 6.3, 12.2). be의 Dockerfile은 오류만 막는다.
   check_tool shellcheck "$SHELLCHECK_IMAGE" 'infra/*.sh' -- shellcheck -x
@@ -130,6 +134,8 @@ check_all() {
   check_tool "hadolint(be)" "$HADOLINT_IMAGE" 'be/*Dockerfile*' -- hadolint --failure-threshold error
   check_tool yamllint "$YAMLLINT_IMAGE" 'infra/*.yml' 'infra/*.yaml' '.gitlab-ci.yml' '.yamllint.yaml' -- yamllint -c .yamllint.yaml
   run_step "caddy (fmt, validate)" drun "$CADDY_IMAGE" sh infra/ci/check-caddy.sh
+  run_step "prometheus (설정, 규칙 단위 시험)" drun "$PROMETHEUS_IMAGE" sh infra/ci/check-prometheus.sh
+  run_step "alertmanager (설정, 라우팅)" drun "$ALERTMANAGER_IMAGE" sh infra/ci/check-alertmanager.sh
   run_step "gitleaks" scan_secrets
 }
 
@@ -163,6 +169,11 @@ EOF
   printf '| `A_KEY` | app | O | 설명 |\n| `app` | `x.env.example` | 소비자 |\n' >"$d/contract.md"
   printf 'STRAY_KEY=1\n' >"$d/x.env.example"
   printf '{\n' >"$d/Caddyfile.bad"
+  # 알림 규칙: runbook과 단위 시험이 없고 이름이 Fit으로 시작하지 않는다. promtool, amtool: 문법이 틀린 규칙과 수신자가 없는 설정
+  mkdir -p "$d/alerts/infra/obs/prometheus/rules" "$d/alerts/infra/obs/prometheus/tests"
+  printf 'groups:\n  - name: x\n    rules:\n      - alert: NoRunbook\n        expr: up == 0\n        labels: {severity: warning}\n        annotations:\n          summary: s\n          description: d\n' >"$d/alerts/infra/obs/prometheus/rules/r.yml"
+  printf 'groups:\n  - name: x\n    rules:\n      - alert: FitBad\n        expr: up ==\n' >"$d/bad-rules.yml"
+  printf 'route:\n  receiver: nobody\n' >"$d/bad-am.yml"
   # 병합 커밋이 든 임시 저장소(커밋 identity는 이 저장소 설정을 건드리지 않게 -c로 준다)
   local g=(git -C "$d/hist" -c user.name=t -c user.email=t@t.t)
   git init -q -b main "$d/hist"
@@ -183,6 +194,9 @@ EOF
   expect_fail eol "$PY" infra/ci/check_eol.py "$d/crlf.yml"
   expect_fail env-contract "$PY" infra/ci/check_env_contract.py --contract "$d/contract.md" --root "$d"
   expect_fail caddy drun "$CADDY_IMAGE" caddy validate --config "$d/Caddyfile.bad" --adapter caddyfile
+  expect_fail alerts "$PY" infra/ci/check_alerts.py --root "$d/alerts"
+  expect_fail promtool drun "$PROMETHEUS_IMAGE" promtool check rules "$d/bad-rules.yml"
+  expect_fail amtool drun "$ALERTMANAGER_IMAGE" amtool check-config "$d/bad-am.yml"
   expect_fail history "$PY" infra/ci/check_linear_history.py --repo "$d/hist" --base start
 }
 
````

시험 디렉터리를 무시한다:

````diff
diff --git a/.gitignore b/.gitignore
index 1aaa8d1..5a85508 100644
--- a/.gitignore
+++ b/.gitignore
@@ -28,6 +28,8 @@ id_rsa
 .tmp-gitleaks/
 .tmp-datatest/
 .tmp-backuptest/
+.tmp-obstest/
+.tmp-opstest/
 __pycache__/
 *.pyc
 .venv/
````

- [ ] **Step 4: 통과 확인 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
chmod +x infra/ci/check-prometheus.sh infra/ci/check-alertmanager.sh
python -m unittest discover -s infra/ci/tests 2>&1 | grep -E "^(Ran|OK|FAILED)"
python infra/ci/check_alerts.py
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$PROMETHEUS_IMAGE" sh infra/ci/check-prometheus.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$ALERTMANAGER_IMAGE" sh infra/ci/check-alertmanager.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/ci/check-prometheus.sh infra/ci/check-alertmanager.sh; echo "shellcheck exit=$?"
bash infra/ci/run-local-checks.sh --self-test 2>&1 | tail -6
```

Expected: `Ran N tests in …`와 `OK`, `SKIP alerts (알림 규칙 없음)`, `SKIP prometheus 설정 없음`, `SKIP alertmanager 설정 없음`, `shellcheck exit=0`. 자체 시험의 끝부분은 `self-test alerts`, `self-test promtool`, `self-test amtool`이 모두 `나쁜 입력을 거부`이고 `모든 검사 통과`다.

- [ ] **Step 5: 커밋 (허용된 경우)**

```bash
git add infra/ci/check_alerts.py infra/ci/tests/test_check_alerts.py infra/ci/check-prometheus.sh infra/ci/check-alertmanager.sh infra/ci/tool-images.sh .gitlab-ci.yml .gitignore infra/ci/run-local-checks.sh
git update-index --chmod=+x infra/ci/check-prometheus.sh infra/ci/check-alertmanager.sh
git commit -m "feat(infra): 알림 규칙·Alertmanager 검사 도구와 Alertmanager 이미지 핀 추가"
```

---

### Task 2: A 관측 스택 정의

**목표:** 서버 A의 `fit-obs` 프로젝트(Prometheus, Alertmanager, Grafana, node-exporter, cAdvisor, blackbox, postgres-exporter, OpenSearch exporter, Dozzle)와 알림 규칙 35개, 단위 시험, 라우팅, 대시보드 3개를 정의한다. postgres-exporter가 읽을 `fit_monitor` role을 데이터 스크립트에 더한다.

**Files:**
- Create: `infra/obs/compose.obs.yml`, `infra/obs/obs.env.example`, `infra/obs/render.py`, `infra/obs/prometheus/prometheus.yml`, `infra/obs/prometheus/rules/{host,containers,app,modal,data,backup}.yml`, `infra/obs/prometheus/tests/{host,containers,app,modal,data,backup}.test.yml`, `infra/obs/alertmanager/alertmanager.yml`, `infra/obs/alertmanager/templates/fit.tmpl`, `infra/obs/alertmanager/routes.txt`, `infra/obs/blackbox/blackbox.yml`, `infra/obs/grafana/provisioning/datasources/prometheus.yml`, `infra/obs/grafana/provisioning/dashboards/dashboards.yml`, `infra/obs/grafana/dashboards/{host,app,data}.json`
- Modify: `infra/data/data.env.example`, `infra/data/lib.sh`, `infra/data/ensure-databases.sh`, `infra/data/verify-data.sh`, `infra/data/test/test-data.sh`, `infra/data/README.md`

**Interfaces:**
- Consumes: 1F의 공유 망(`net-obs`, `net-prod`, `net-dev`, `net-data`. 이름은 `FIT_NET_*`로 바꾼다), 1D의 데이터 스택(Postgres `fit_monitor` role, OpenSearch)과 백업 지표(`/var/lib/fit/metrics`), 1C-1의 엣지 메트릭 리스너(`caddy:9180`), BE의 관리 포트(`be-*:8081`, [metrics.md](../contracts/metrics.md)의 이름)
- Produces: 서비스 9개와 일회성 `obs-init`. 값은 `docker compose --env-file /etc/fit/obs.env`로 읽는다(`${VAR:?msg}`). 호스트 게시는 `127.0.0.1`의 9090, 3000, 8888뿐이다. 한도 합계 1,344MB. 알림 규칙 35개(`host` 9, `containers` 2, `app` 8, `modal` 3, `data` 5, `backup` 8)와 기록 규칙 3개. 데이터소스 uid `prom-a`, 대시보드 uid `fit-host`, `fit-app`, `fit-data`

핵심 결정:

- `obs-init`은 네트워크 없이 읽기 전용으로 돌며 B의 IP와 웹훅 주소를 검증하고(`REPLACE_ME`, 형식) `/generated`에 대상 파일과 비밀 파일을 만든다. prometheus와 alertmanager는 이것이 성공해야 뜬다. Prometheus는 설정에 환경변수를 풀어 주지 않고 Alertmanager는 웹훅 주소를 파일로만 읽기 때문이다. 출력에는 파일 이름만 나온다.
- Prometheus는 보존 7일·5GB, 관리 API(`/-/reload`)는 끈다(플래그는 `1w`, `5GiB`로 정규화되어 보인다). BE는 색마다 따로 긁고(`env`, `color` 라벨) 환경의 모든 색이 down일 때만 서비스 다운이다.
- 알림은 `for`를 두어 깜빡임을 거른다. 반드시 있어야 하는 지표(BE HTTP, 배치, Modal 예산, 백업)는 `absent()` 알림을 둔다. Modal 폴백 비율은 기록 규칙으로 15분 비율을 만들고 호출이 거의 없을 때는 울리지 않는다.
- Alertmanager는 `env=dev`를 dev 수신자로, 나머지를 main으로 보낸다. critical은 1시간마다, 나머지는 4시간마다 다시 알리고 같은 알림의 critical이 떠 있으면 warning은 보내지 않는다. 메시지는 Mattermost 수신 웹훅(Slack 형식)이고 제목은 `[FIRING:N] 이름 (site/env)`, 본문에 요약·설명·`런북: RB-번호`다.
- postgres-exporter는 `pg_monitor` 권한만 가진 `fit_monitor`로 `postgres` DB의 통계를 읽는다. 앱 DB(`fit_prod`, `fit_dev`)에는 접속하지 못한다. 비밀번호는 `data.env`의 `FIT_MONITOR_PASSWORD`(`obs.env`와 같은 값)다.
- Dozzle은 `docker.sock`을 읽기 전용으로 마운트한다. 소켓 API는 읽기 전용이어도 컨테이너 설정(환경변수)을 읽을 수 있어서 설계 13.4절에 한계로 적는다(Task 9).

- [ ] **Step 1: 스택 정의와 설정 생성기 작성**

`infra/obs/compose.obs.yml`:

````yaml
# 서버 A의 관측 스택. 프로젝트 fit-obs다(설계 2.2절, 9절): prometheus, alertmanager, grafana, node-exporter, cadvisor, blackbox,
# postgres-exporter, opensearch-exporter, dozzle. 값은 `docker compose --env-file /etc/fit/obs.env`로 읽는다(키는 docs/infra/contracts/env.md의 obs 그룹).
# 호스트에 게시하는 포트는 127.0.0.1의 prometheus 9090, grafana 3000, dozzle 8888뿐이다(SSH 터널로 본다, 설계 13.1절).
# 망(net-*)은 호스트에서 먼저 만들어 둔다(infra/host/networks.sh). prometheus는 BE의 관리 포트(8081)를 긁으려고 net-prod·net-dev에도 속하고
# exporter 두 개는 DB를 보려고 net-data에도 속한다. 한도의 합은 설계 4.1절의 관측성 예산(1.4GB) 안이다.
name: fit-obs

x-logging: &logging
  driver: json-file
  options:
    max-size: 10m
    max-file: "3"

services:
  # 서버마다 다른 값(B의 주소, 웹훅)을 설정 파일로 만든다. 끝나면 종료하고, prometheus와 alertmanager는 이것이 성공해야 뜬다
  obs-init:
    image: python:3.12.15-slim
    restart: "no"
    user: "0"
    network_mode: none
    read_only: true
    command: [python, /render.py]
    environment:
      B_IP: ${B_IP:?obs.env에 B_IP가 없다}
      MATTERMOST_WEBHOOK_URL: ${MATTERMOST_WEBHOOK_URL:?obs.env에 MATTERMOST_WEBHOOK_URL이 없다}
      MATTERMOST_WEBHOOK_URL_DEV: ${MATTERMOST_WEBHOOK_URL_DEV:?obs.env에 MATTERMOST_WEBHOOK_URL_DEV가 없다}
    volumes:
      - ./render.py:/render.py:ro
      - generated:/generated
    mem_limit: 64m
    logging: *logging

  prometheus:
    image: prom/prometheus:v3.15.0
    restart: unless-stopped
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
      - --storage.tsdb.retention.time=7d
      - --storage.tsdb.retention.size=5GB
      - --web.listen-address=0.0.0.0:9090
    ports:
      - 127.0.0.1:9090:9090
    mem_limit: 512m
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./prometheus/rules:/etc/prometheus/rules:ro
      - generated:/generated:ro
      - promdata:/prometheus
    networks: [net-obs, net-prod, net-dev]
    depends_on:
      obs-init:
        condition: service_completed_successfully
    healthcheck:
      test: [CMD, wget, -q, --spider, "http://localhost:9090/-/ready"]
      interval: 10s
      timeout: 3s
      retries: 12
    logging: *logging

  alertmanager:
    image: prom/alertmanager:v0.34.1
    restart: unless-stopped
    command:
      - --config.file=/etc/alertmanager/alertmanager.yml
      - --storage.path=/alertmanager
      - --web.listen-address=0.0.0.0:9093
    mem_limit: 64m
    volumes:
      - ./alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
      - ./alertmanager/templates:/etc/alertmanager/templates:ro
      - generated:/generated:ro
      - amdata:/alertmanager
    networks: [net-obs]
    depends_on:
      obs-init:
        condition: service_completed_successfully
    healthcheck:
      test: [CMD, wget, -q, --spider, "http://localhost:9093/-/ready"]
      interval: 10s
      timeout: 3s
      retries: 12
    logging: *logging

  grafana:
    image: grafana/grafana:12.4.12
    restart: unless-stopped
    environment:
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?obs.env에 GRAFANA_ADMIN_PASSWORD가 없다}
      GF_AUTH_ANONYMOUS_ENABLED: "false"
      GF_USERS_ALLOW_SIGN_UP: "false"
      GF_ANALYTICS_REPORTING_ENABLED: "false"
      GF_ANALYTICS_CHECK_FOR_UPDATES: "false"
      GF_SERVER_ROOT_URL: http://localhost:3000/
    ports:
      - 127.0.0.1:3000:3000
    mem_limit: 256m
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
      - ./grafana/dashboards:/var/lib/grafana/dashboards:ro
      - grafanadata:/var/lib/grafana
    networks: [net-obs]
    depends_on: [prometheus]
    healthcheck:
      test: [CMD-SHELL, "wget -q --spider http://localhost:3000/api/health || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 12
    logging: *logging

  # 호스트의 디스크·메모리·CPU와 textfile 지표(백업 상태)를 읽는다. 호스트 루트는 읽기 전용으로 마운트한다
  node-exporter:
    image: prom/node-exporter:v1.12.1
    restart: unless-stopped
    pid: host
    command:
      - --path.rootfs=/host
      - --collector.textfile.directory=/textfile
      - --no-collector.ipvs
      - --no-collector.wifi
    mem_limit: 64m
    volumes:
      - /:/host:ro
      - /var/lib/fit/metrics:/textfile:ro
    networks: [net-obs]
    logging: *logging

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:v0.55.1
    restart: unless-stopped
    command:
      - --housekeeping_interval=30s
      - --docker_only=true
      - --store_container_labels=false
      - --whitelisted_container_labels=com.docker.compose.project,com.docker.compose.service
    mem_limit: 192m
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    networks: [net-obs]
    logging: *logging

  # A에서 B의 TCP 22를 두드려 본다(설계 9.2절 "B 도달 불가"). 대상은 obs-init이 만든 file_sd 파일이다
  blackbox:
    image: prom/blackbox-exporter:v0.28.0
    restart: unless-stopped
    command: [--config.file=/etc/blackbox/blackbox.yml]
    mem_limit: 64m
    volumes:
      - ./blackbox/blackbox.yml:/etc/blackbox/blackbox.yml:ro
    networks: [net-obs]
    logging: *logging

  # 모니터링 전용 role(fit_monitor, pg_monitor 권한)로 읽는다. 비밀번호는 data.env의 FIT_MONITOR_PASSWORD와 같다
  postgres-exporter:
    image: quay.io/prometheuscommunity/postgres-exporter:v0.20.1
    restart: unless-stopped
    environment:
      DATA_SOURCE_URI: postgres:5432/postgres?sslmode=disable
      DATA_SOURCE_USER: fit_monitor
      DATA_SOURCE_PASS: ${FIT_MONITOR_PASSWORD:?obs.env에 FIT_MONITOR_PASSWORD가 없다}
    mem_limit: 64m
    networks: [net-obs, net-data]
    logging: *logging

  opensearch-exporter:
    image: quay.io/prometheuscommunity/elasticsearch-exporter:v1.11.0
    restart: unless-stopped
    command: [--es.uri=http://opensearch:9200]
    mem_limit: 64m
    networks: [net-obs, net-data]
    logging: *logging

  # 로그를 웹에서 본다. docker.sock을 읽기 전용으로 마운트하지만 소켓은 사실상 root 권한이라 127.0.0.1에만 열고 SSH 터널로 쓴다(설계 13.4절)
  dozzle:
    image: amir20/dozzle:v11.3.2
    restart: unless-stopped
    environment:
      DOZZLE_NO_ANALYTICS: "true"
    ports:
      - 127.0.0.1:8888:8080
    mem_limit: 64m
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks: [net-obs]
    logging: *logging

volumes:
  generated:
  promdata:
  amdata:
  grafanadata:

networks:
  net-obs:
    name: ${FIT_NET_OBS:-net-obs}
    external: true
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

`infra/obs/obs.env.example`:

````env
GRAFANA_ADMIN_PASSWORD=REPLACE_ME
MATTERMOST_WEBHOOK_URL=REPLACE_ME
MATTERMOST_WEBHOOK_URL_DEV=REPLACE_ME
B_IP=REPLACE_ME
FIT_MONITOR_PASSWORD=REPLACE_ME
````

`infra/obs/render.py`:

````python
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
````

- [ ] **Step 2: Prometheus 설정과 알림 규칙 작성**

`infra/obs/prometheus/prometheus.yml`:

````yaml
# 서버 A의 Prometheus 설정(설계 9절). 규칙은 rules/, 단위 시험은 tests/다(promtool로 검사한다. infra/ci/check-prometheus.sh).
# 보존 기간과 크기 상한(7일, 5GB)은 compose의 실행 인자다. B의 주소 같은 서버별 값은 obs-init이 /generated/targets에 만든다.
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    site: A

rule_files:
  - rules/*.yml

alerting:
  alertmanagers:
    - static_configs:
        - targets: [alertmanager:9093]

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: [localhost:9090]

  - job_name: alertmanager
    static_configs:
      - targets: [alertmanager:9093]

  - job_name: node
    static_configs:
      - targets: [node-exporter:9100]

  - job_name: cadvisor
    static_configs:
      - targets: [cadvisor:8080]

  # 엣지 Caddy의 메트릭 리스너(설계 5.1절). net-obs 안에서만 닿는다
  - job_name: caddy
    static_configs:
      - targets: [caddy:9180]

  # BE의 관리 포트(설계 12.1 #1). 색마다 따로 긁어서 어느 색이 살아 있는지 본다. 멈춰 있는 색은 up==0이 정상이다
  - job_name: be
    metrics_path: /actuator/prometheus
    static_configs:
      - targets: [be-prod-blue:8081]
        labels: {env: prod, color: blue}
      - targets: [be-prod-green:8081]
        labels: {env: prod, color: green}
      - targets: [be-dev:8081]
        labels: {env: dev, color: single}

  - job_name: postgres
    static_configs:
      - targets: [postgres-exporter:9187]

  - job_name: opensearch
    static_configs:
      - targets: [opensearch-exporter:9114]

  - job_name: blackbox
    static_configs:
      - targets: [blackbox:9115]

  # A에서 B의 TCP 22 프로브(설계 9.2절). 대상 B_IP:22는 obs-init이 file_sd 파일로 만든다
  - job_name: vault-ssh
    metrics_path: /probe
    params:
      module: [tcp_connect]
    file_sd_configs:
      - files: [/generated/targets/vault-ssh.yml]
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox:9115
````

규칙은 파일마다 하나씩이다. `infra/obs/prometheus/rules/host.yml`:

````yaml
# 호스트 알림(설계 9.2절). 모든 알림은 runbook(설계 10.2절의 RB-번호)과 severity를 갖고 prometheus/tests/에 단위 시험이 있다(infra/ci/check_alerts.py가 검사한다).
groups:
  - name: fit-host
    rules:
      - alert: FitMemoryLow
        expr: node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.08
        for: 5m
        labels: {severity: critical}
        annotations:
          summary: 호스트 가용 메모리가 8% 미만이다
          description: 가용 메모리 비율 {{ $value | humanizePercentage }} (5분 이상)
          runbook: RB-03

      - alert: FitSwapHigh
        expr: (1 - node_memory_SwapFree_bytes / node_memory_SwapTotal_bytes) > 0.5 and node_memory_SwapTotal_bytes > 0
        for: 10m
        labels: {severity: warning}
        annotations:
          summary: 스왑 사용량이 50%를 넘었다
          description: 스왑 사용 비율 {{ $value | humanizePercentage }} (10분 이상)
          runbook: RB-03

      - alert: FitOomKill
        expr: increase(node_vmstat_oom_kill[5m]) > 0
        labels: {severity: critical}
        annotations:
          summary: 커널이 프로세스를 OOM으로 종료했다
          description: 최근 5분에 OOM 종료 {{ $value | printf "%.0f" }}건. 컨테이너 한도의 OOM도 센다(구현 시 서버에서 확인)
          runbook: RB-03

      - alert: FitDiskUsageHigh
        expr: 1 - node_filesystem_avail_bytes{mountpoint="/", fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{mountpoint="/", fstype!~"tmpfs|overlay"} > 0.8
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: 디스크 사용률이 80%를 넘었다
          description: 루트 파일시스템 사용률 {{ $value | humanizePercentage }}
          runbook: RB-04

      - alert: FitDiskUsageCritical
        expr: 1 - node_filesystem_avail_bytes{mountpoint="/", fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{mountpoint="/", fstype!~"tmpfs|overlay"} > 0.9
        for: 5m
        labels: {severity: critical}
        annotations:
          summary: 디스크 사용률이 90%를 넘었다
          description: 루트 파일시스템 사용률 {{ $value | humanizePercentage }}
          runbook: RB-04

      - alert: FitDiskFillingUp
        expr: predict_linear(node_filesystem_avail_bytes{mountpoint="/", fstype!~"tmpfs|overlay"}[6h], 24 * 3600) < 0
        for: 30m
        labels: {severity: critical}
        annotations:
          summary: 이 속도면 24시간 안에 디스크가 가득 찬다
          description: 최근 6시간 추세로 24시간 뒤 남는 공간이 0 미만이다
          runbook: RB-04

      # 설계 4.1절: CPU 크레딧 때문에 vCPU당 baseline 40%가 기준선이다
      - alert: FitCpuHigh30m
        expr: 1 - avg(rate(node_cpu_seconds_total{mode="idle"}[30m])) > 0.4
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: 30분 평균 CPU 사용률이 40%를 넘었다
          description: 30분 평균 CPU 사용률 {{ $value | humanizePercentage }}
          runbook: RB-09

      - alert: FitCpuHigh2h
        expr: 1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2h])) > 0.4
        for: 5m
        labels: {severity: critical}
        annotations:
          summary: 2시간 평균 CPU 사용률이 40%를 넘었다(버스트 크레딧 소진 위험)
          description: 2시간 평균 CPU 사용률 {{ $value | humanizePercentage }}
          runbook: RB-09

      # 관측 체계 자신: 수집 대상이 죽으면 다른 알림이 조용해진다
      - alert: FitScrapeTargetDown
        expr: up{job=~"prometheus|alertmanager|node|cadvisor|caddy|postgres|opensearch|blackbox"} == 0
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: 수집 대상 {{ $labels.job }}이(가) 응답하지 않는다
          description: "{{ $labels.job }}({{ $labels.instance }})의 up이 0이다. 이 대상의 알림은 조용해진다"
          runbook: RB-01
````

`infra/obs/prometheus/rules/containers.yml`:

````yaml
# 컨테이너 알림(설계 9.2절). cAdvisor의 name 라벨이 비어 있는 항목(cgroup 상위 단위)은 빼고 컨테이너만 본다.
groups:
  - name: fit-containers
    rules:
      - alert: FitContainerRestartLoop
        expr: changes(container_start_time_seconds{name!=""}[10m]) >= 3
        labels: {severity: critical}
        annotations:
          summary: 컨테이너 {{ $labels.name }}이(가) 10분에 3번 이상 다시 시작했다
          description: 재시작 {{ $value | printf "%.0f" }}회(10분). 로그는 Dozzle로 본다
          runbook: RB-03

      - alert: FitContainerMemoryHigh
        expr: container_memory_working_set_bytes{name!=""} / container_spec_memory_limit_bytes{name!=""} > 0.9 and container_spec_memory_limit_bytes{name!=""} > 0
        for: 10m
        labels: {severity: warning}
        annotations:
          summary: 컨테이너 {{ $labels.name }}의 메모리가 한도의 90%를 넘었다
          description: 한도 대비 사용 {{ $value | humanizePercentage }} (10분 이상)
          runbook: RB-03
````

`infra/obs/prometheus/rules/app.yml`:

````yaml
# 앱(BE) 알림(설계 9.2절). 지표 이름은 docs/infra/contracts/metrics.md의 계약이다(Spring Boot Micrometer 기본 이름과 12.1 #11).
# 반드시 있어야 하는 지표(배치 heartbeat 등)는 absent() 알림을 둔다(설계 9.4절).
groups:
  - name: fit-app
    rules:
      # BE는 색마다 따로 긁는다. 환경의 모든 색이 down일 때만 서비스 다운이다(멈춘 이전 색은 up==0이 정상)
      - alert: FitBeProdDown
        expr: max by (env) (up{job="be", env="prod"}) == 0
        for: 2m
        labels: {severity: critical, env: prod}
        annotations:
          summary: prod BE가 모든 색에서 응답하지 않는다
          description: be-prod-blue와 be-prod-green의 관리 포트(8081)를 2분 이상 긁지 못했다
          runbook: RB-02

      - alert: FitBeDevDown
        expr: max by (env) (up{job="be", env="dev"}) == 0
        for: 5m
        labels: {severity: warning, env: dev}
        annotations:
          summary: dev BE가 응답하지 않는다
          description: be-dev의 관리 포트(8081)를 5분 이상 긁지 못했다
          runbook: RB-02

      - alert: FitHttp5xxHigh
        expr: |
          sum by (env) (rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
            / sum by (env) (rate(http_server_requests_seconds_count[5m])) > 0.02
          and sum by (env) (rate(http_server_requests_seconds_count[5m])) > 0.2
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: "{{ $labels.env }} BE의 5xx 비율이 2%를 넘었다"
          description: 5xx 비율 {{ $value | humanizePercentage }}. 요청이 초당 0.2건 이상일 때만 센다
          runbook: RB-02

      # 검색 경로의 지연은 Modal(임베딩·리랭커)과 OpenSearch에 걸려 있어 기준이 느슨하다(추정, 실측 뒤 조정)
      - alert: FitSearchLatencyHigh
        expr: |
          histogram_quantile(0.95, sum by (le, env) (rate(http_server_requests_seconds_bucket{uri=~"/api/v1/search.*"}[5m]))) > 4
          and sum by (env) (rate(http_server_requests_seconds_count{uri=~"/api/v1/search.*"}[5m])) > 0.05
        for: 10m
        labels: {severity: warning}
        annotations:
          summary: "{{ $labels.env }} 검색 p95 지연이 4초를 넘었다"
          description: 검색 p95 {{ $value | humanizeDuration }}
          runbook: RB-07

      - alert: FitHttpLatencyHigh
        expr: |
          histogram_quantile(0.95, sum by (le, env) (rate(http_server_requests_seconds_bucket{uri!~"/api/v1/search.*|/actuator.*"}[5m]))) > 1
          and sum by (env) (rate(http_server_requests_seconds_count{uri!~"/api/v1/search.*|/actuator.*"}[5m])) > 0.2
        for: 10m
        labels: {severity: warning}
        annotations:
          summary: "{{ $labels.env }} BE p95 지연이 1초를 넘었다(검색 제외)"
          description: p95 {{ $value | humanizeDuration }}
          runbook: RB-02

      # 04:00 KST 배치가 26시간 넘게 성공하지 않았다. 색이 둘이어도 가장 최근 값을 본다
      - alert: FitBatchStale
        expr: time() - max by (env) (batch_last_success_timestamp_seconds{env="prod"}) > 26 * 3600
        for: 5m
        labels: {severity: warning, env: prod}
        annotations:
          summary: 새벽 배치의 마지막 성공이 26시간을 넘었다
          description: 마지막 성공 후 {{ $value | humanizeDuration }}
          runbook: RB-07

      - alert: FitBatchMetricMissing
        expr: absent(batch_last_success_timestamp_seconds{env="prod"})
        for: 15m
        labels: {severity: warning, env: prod}
        annotations:
          summary: 배치 heartbeat 지표(batch_last_success_timestamp_seconds)가 없다
          description: "prod BE가 이 지표를 시작부터 내야 한다(BE 계약 #11). 배포 전이라면 정상이다"
          runbook: RB-07

      - alert: FitHttpMetricMissing
        expr: absent(http_server_requests_seconds_count{env="prod"})
        for: 15m
        labels: {severity: warning, env: prod}
        annotations:
          summary: prod BE의 HTTP 요청 지표가 없다
          description: /actuator/prometheus를 긁지 못했거나 지표가 꺼져 있다. 배포 전이라면 정상이다
          runbook: RB-02
````

`infra/obs/prometheus/rules/modal.yml`:

````yaml
# Modal 호출 알림(설계 9.2절, 11.2절). 폴백은 사용자가 못 느끼는 실패라 알림이 필수다(A603 교훈).
# 구성요소(component)는 embedding, reranker, llm이다. 지표 이름은 docs/infra/contracts/metrics.md의 계약이다(BE와 합의 전 제안).
groups:
  - name: fit-modal-recording
    rules:
      - record: fit:modal_calls:rate15m
        expr: sum by (env) (rate(modal_embedding_calls_total[15m]))
        labels: {component: embedding}
      - record: fit:modal_calls:rate15m
        expr: sum by (env) (rate(modal_reranker_calls_total[15m]))
        labels: {component: reranker}
      - record: fit:modal_calls:rate15m
        expr: sum by (env) (rate(modal_llm_calls_total[15m]))
        labels: {component: llm}
      - record: fit:modal_fallback:rate15m
        expr: sum by (env) (rate(modal_embedding_fallback_total[15m]))
        labels: {component: embedding}
      - record: fit:modal_fallback:rate15m
        expr: sum by (env) (rate(modal_reranker_fallback_total[15m]))
        labels: {component: reranker}
      - record: fit:modal_fallback:rate15m
        expr: sum by (env) (rate(modal_llm_fallback_total[15m]))
        labels: {component: llm}
      - record: fit:modal_fallback_ratio:rate15m
        expr: fit:modal_fallback:rate15m / (fit:modal_calls:rate15m > 0)

  - name: fit-modal
    rules:
      - alert: FitModalFallbackHigh
        expr: fit:modal_fallback_ratio:rate15m > 0.3 and on (env, component) fit:modal_calls:rate15m > 0.01
        for: 15m
        labels: {severity: warning}
        annotations:
          summary: "{{ $labels.env }} {{ $labels.component }} 호출의 폴백 비율이 30%를 넘었다"
          description: 15분 폴백 비율 {{ $value | humanizePercentage }}. Modal 쪽 장애이거나 콜드 스타트 타임아웃일 수 있다
          runbook: RB-11

      - alert: FitModalBudgetHigh
        expr: max by (env) (modal_daily_budget_used_ratio) > 0.8
        labels: {severity: warning}
        annotations:
          summary: "{{ $labels.env }}의 Modal 일일 호출 예산을 80% 썼다"
          description: 예산 사용 {{ $value | humanizePercentage }}. 소진되면 키워드 폴백으로 내려간다
          runbook: RB-11

      - alert: FitModalMetricMissing
        expr: absent(modal_daily_budget_used_ratio{env="prod"})
        for: 15m
        labels: {severity: warning, env: prod}
        annotations:
          summary: Modal 예산 지표(modal_daily_budget_used_ratio)가 없다
          description: prod BE가 Redis 카운터를 이 지표로 내야 한다(BE 계약). 배포 전이라면 정상이다
          runbook: RB-11
````

`infra/obs/prometheus/rules/data.yml`:

````yaml
# 데이터 서비스 알림(설계 9.2절). postgres-exporter와 OpenSearch exporter가 지표를 낸다.
groups:
  - name: fit-data
    rules:
      - alert: FitPostgresDown
        expr: pg_up == 0
        for: 1m
        labels: {severity: critical}
        annotations:
          summary: exporter가 Postgres에 접속하지 못한다
          description: pg_up이 0이다(Postgres 중지, fit_monitor 비밀번호 불일치, 연결 한도 초과 중 하나)
          runbook: RB-06

      - alert: FitPostgresConnectionsHigh
        expr: sum(pg_stat_activity_count) / max(pg_settings_max_connections) > 0.8
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: Postgres 연결이 최대 연결 수의 80%를 넘었다
          description: 연결 사용 비율 {{ $value | humanizePercentage }}(최대 60). Hikari 풀 크기와 누수를 본다
          runbook: RB-06

      - alert: FitOpensearchDown
        expr: elasticsearch_clusterinfo_up == 0
        for: 2m
        labels: {severity: critical}
        annotations:
          summary: exporter가 OpenSearch에 닿지 못한다
          description: elasticsearch_clusterinfo_up이 0이다. 검색은 키워드 폴백으로 내려간다
          runbook: RB-07

      - alert: FitOpensearchRed
        expr: elasticsearch_cluster_health_status{color="red"} == 1
        for: 2m
        labels: {severity: critical}
        annotations:
          summary: OpenSearch 클러스터 상태가 red다
          description: 일부 인덱스의 주 샤드가 할당되지 않았다. Postgres에서 재색인한다
          runbook: RB-07

      - alert: FitOpensearchHeapHigh
        expr: max(elasticsearch_jvm_memory_used_bytes{area="heap"} / elasticsearch_jvm_memory_max_bytes{area="heap"}) > 0.9
        for: 10m
        labels: {severity: warning}
        annotations:
          summary: OpenSearch 힙 사용이 90%를 넘었다
          description: 힙 사용 비율 {{ $value | humanizePercentage }}(힙 768MB). k-NN 네이티브 메모리와 함께 본다
          runbook: RB-07
````

`infra/obs/prometheus/rules/backup.yml`:

````yaml
# 백업 알림(설계 8절, 9.2절). 지표는 계획 1D의 백업 스크립트가 /var/lib/fit/metrics/fit_backup.prom에 쓰고 node-exporter의 textfile collector가 읽는다.
# 금고(B) 쪽 알림은 infra/ops의 규칙이다(A가 죽어도 B가 감지한다).
groups:
  - name: fit-backup
    rules:
      - alert: FitBackupPgStale
        expr: time() - fit_backup_last_success_timestamp_seconds{kind="pg"} > 8 * 3600
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: Postgres 백업의 마지막 성공이 8시간을 넘었다(주기는 4시간)
          description: 마지막 성공 후 {{ $value | humanizeDuration }}. journalctl -u fit-backup@pg 를 본다
          runbook: RB-06

      - alert: FitBackupPhotosStale
        expr: time() - fit_backup_last_success_timestamp_seconds{kind="photos"} > 36 * 3600
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: 사진 백업의 마지막 성공이 36시간을 넘었다(주기는 하루)
          description: 마지막 성공 후 {{ $value | humanizeDuration }}
          runbook: RB-06

      - alert: FitBackupCaddyStale
        expr: time() - fit_backup_last_success_timestamp_seconds{kind="caddy"} > 9 * 86400
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: 인증서 볼륨 백업의 마지막 성공이 9일을 넘었다(주기는 일주일)
          description: 마지막 성공 후 {{ $value | humanizeDuration }}
          runbook: RB-05

      - alert: FitBackupVerifyFailed
        expr: fit_backup_last_verify_ok == 0
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: 마지막 덤프 복원 검증이 실패했다
          description: 검증에 실패한 덤프는 B로 보내지 않는다(failed-verify-*로 남는다). 다음 실행이 다시 검증한다
          runbook: RB-06

      - alert: FitBackupVerifyStale
        expr: time() - fit_backup_last_verify_timestamp_seconds > 36 * 3600
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: 덤프 복원 검증을 36시간 넘게 하지 않았다(주기는 하루)
          description: 마지막 검증 후 {{ $value | humanizeDuration }}
          runbook: RB-06

      - alert: FitBackupOutboxStuck
        expr: fit_backup_outbox_files > 0
        for: 2h
        labels: {severity: warning}
        annotations:
          summary: B로 보내지 못한 백업 파일이 2시간 넘게 쌓여 있다
          description: 대기 파일 {{ $value | printf "%.0f" }}개. A에서 B로 SSH가 되는지, 호스트 키와 vault 키 등록을 본다
          runbook: RB-06

      - alert: FitBackupMetricMissing
        expr: absent(fit_backup_last_success_timestamp_seconds{kind="pg"})
        for: 1h
        labels: {severity: warning}
        annotations:
          summary: 백업 지표(fit_backup.prom)가 없다
          description: infra/backup/install.sh app 이 끝났는지, /var/lib/fit/metrics 마운트와 첫 백업을 본다
          runbook: RB-06

      - alert: FitVaultUnreachable
        expr: probe_success{job="vault-ssh"} == 0
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: A에서 B({{ $labels.instance }})의 SSH 포트에 닿지 못한다
          description: 백업 전송과 CI(verify 러너)가 영향을 받는다. B가 살아 있는지, 방화벽을 본다
          runbook: RB-01
````

- [ ] **Step 3: 규칙 단위 시험 작성**

시험은 알림이 울리는 경우와 울리지 않는 경우, 라벨과 설명(`exp_annotations`)을 모두 확인한다. 샘플 간격은 Prometheus의 조회 기간(5분)보다 짧게 둔다(`for`가 있는 규칙).

`infra/obs/prometheus/tests/host.test.yml`:

````yaml
# rules/host.yml 단위 시험. 알림마다 울리는 경우와 울리지 않는 경우를 함께 둔다. exp_annotations는 설명 문구가 제대로 만들어지는지도 본다.
rule_files:
  - ../rules/host.yml
evaluation_interval: 1m

tests:
  # 가용 메모리 5%는 울리고 20%는 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'node_memory_MemAvailable_bytes{instance="a"}'
        values: '5+0x12'
      - series: 'node_memory_MemTotal_bytes{instance="a"}'
        values: '100+0x12'
      - series: 'node_memory_MemAvailable_bytes{instance="ok"}'
        values: '20+0x12'
      - series: 'node_memory_MemTotal_bytes{instance="ok"}'
        values: '100+0x12'
    alert_rule_test:
      - eval_time: 4m
        alertname: FitMemoryLow
        exp_alerts: []
      - eval_time: 10m
        alertname: FitMemoryLow
        exp_alerts:
          - exp_labels: {severity: critical, instance: a}
            exp_annotations:
              summary: 호스트 가용 메모리가 8% 미만이다
              description: 가용 메모리 비율 5% (5분 이상)
              runbook: RB-03

  # 스왑 60% 사용은 울리고, 스왑이 없는 호스트(총량 0)는 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'node_memory_SwapFree_bytes{instance="a"}'
        values: '40+0x15'
      - series: 'node_memory_SwapTotal_bytes{instance="a"}'
        values: '100+0x15'
      - series: 'node_memory_SwapFree_bytes{instance="noswap"}'
        values: '0+0x15'
      - series: 'node_memory_SwapTotal_bytes{instance="noswap"}'
        values: '0+0x15'
    alert_rule_test:
      - eval_time: 14m
        alertname: FitSwapHigh
        exp_alerts:
          - exp_labels: {severity: warning, instance: a}
            exp_annotations:
              summary: 스왑 사용량이 50%를 넘었다
              description: 스왑 사용 비율 60% (10분 이상)
              runbook: RB-03

  # OOM 종료 카운터가 늘면 즉시 울리고, 늘지 않으면 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'node_vmstat_oom_kill{instance="a"}'
        values: '0 0 0 1 1 1 1 1'
      - series: 'node_vmstat_oom_kill{instance="ok"}'
        values: '0 0 0 0 0 0 0 0'
    alert_rule_test:
      - eval_time: 5m
        alertname: FitOomKill
        exp_alerts:
          - exp_labels: {severity: critical, instance: a}
            exp_annotations:
              summary: 커널이 프로세스를 OOM으로 종료했다
              description: 최근 5분에 OOM 종료 1건. 컨테이너 한도의 OOM도 센다(구현 시 서버에서 확인)
              runbook: RB-03

  # 디스크: 85%는 경고만, 95%는 경고와 위험이 함께 울린다. tmpfs는 보지 않는다
  - interval: 1m
    input_series:
      - series: 'node_filesystem_avail_bytes{instance="a", mountpoint="/", fstype="ext4", device="sda1"}'
        values: '15+0x12'
      - series: 'node_filesystem_size_bytes{instance="a", mountpoint="/", fstype="ext4", device="sda1"}'
        values: '100+0x12'
      - series: 'node_filesystem_avail_bytes{instance="b", mountpoint="/", fstype="ext4", device="sdb1"}'
        values: '5+0x12'
      - series: 'node_filesystem_size_bytes{instance="b", mountpoint="/", fstype="ext4", device="sdb1"}'
        values: '100+0x12'
      - series: 'node_filesystem_avail_bytes{instance="t", mountpoint="/", fstype="tmpfs", device="tmpfs"}'
        values: '1+0x12'
      - series: 'node_filesystem_size_bytes{instance="t", mountpoint="/", fstype="tmpfs", device="tmpfs"}'
        values: '100+0x12'
    alert_rule_test:
      - eval_time: 10m
        alertname: FitDiskUsageHigh
        exp_alerts:
          - exp_labels: {severity: warning, instance: a, mountpoint: /, fstype: ext4, device: sda1}
            exp_annotations:
              summary: 디스크 사용률이 80%를 넘었다
              description: 루트 파일시스템 사용률 85%
              runbook: RB-04
          - exp_labels: {severity: warning, instance: b, mountpoint: /, fstype: ext4, device: sdb1}
            exp_annotations:
              summary: 디스크 사용률이 80%를 넘었다
              description: 루트 파일시스템 사용률 95%
              runbook: RB-04
      - eval_time: 10m
        alertname: FitDiskUsageCritical
        exp_alerts:
          - exp_labels: {severity: critical, instance: b, mountpoint: /, fstype: ext4, device: sdb1}
            exp_annotations:
              summary: 디스크 사용률이 90%를 넘었다
              description: 루트 파일시스템 사용률 95%
              runbook: RB-04

  # 디스크 고갈 예측: 2씩 줄어드는 추세는 울리고 변하지 않는 값은 울리지 않는다
  - interval: 10m
    input_series:
      - series: 'node_filesystem_avail_bytes{instance="a", mountpoint="/", fstype="ext4", device="sda1"}'
        values: '2000-20x40'
      - series: 'node_filesystem_avail_bytes{instance="flat", mountpoint="/", fstype="ext4", device="sdc1"}'
        values: '2000+0x40'
    alert_rule_test:
      - eval_time: 360m
        alertname: FitDiskFillingUp
        exp_alerts:
          - exp_labels: {severity: critical, instance: a, mountpoint: /, fstype: ext4, device: sda1}
            exp_annotations:
              summary: 이 속도면 24시간 안에 디스크가 가득 찬다
              description: 최근 6시간 추세로 24시간 뒤 남는 공간이 0 미만이다
              runbook: RB-04

  # CPU: 코어 하나가 초당 0.5초만 쉬면 사용률 50%라 30분 알림과 2시간 알림이 모두 울린다
  - interval: 1m
    input_series:
      - series: 'node_cpu_seconds_total{instance="a", cpu="0", mode="idle"}'
        values: '0+30x200'
    alert_rule_test:
      - eval_time: 90m
        alertname: FitCpuHigh30m
        exp_alerts:
          - exp_labels: {severity: warning}
            exp_annotations:
              summary: 30분 평균 CPU 사용률이 40%를 넘었다
              description: 30분 평균 CPU 사용률 50%
              runbook: RB-09
      - eval_time: 150m
        alertname: FitCpuHigh2h
        exp_alerts:
          - exp_labels: {severity: critical}
            exp_annotations:
              summary: 2시간 평균 CPU 사용률이 40%를 넘었다(버스트 크레딧 소진 위험)
              description: 2시간 평균 CPU 사용률 50%
              runbook: RB-09

  # CPU가 80% 놀면(사용률 20%) 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'node_cpu_seconds_total{instance="a", cpu="0", mode="idle"}'
        values: '0+48x200'
    alert_rule_test:
      - eval_time: 90m
        alertname: FitCpuHigh30m
        exp_alerts: []
      - eval_time: 150m
        alertname: FitCpuHigh2h
        exp_alerts: []

  # 수집 대상이 5분 넘게 down이면 울린다. 다른 job과 살아 있는 대상은 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'up{job="node", instance="node-exporter:9100"}'
        values: '0+0x12'
      - series: 'up{job="cadvisor", instance="cadvisor:8080"}'
        values: '1+0x12'
      - series: 'up{job="be", instance="be-prod-green:8081", env="prod", color="green"}'
        values: '0+0x12'
    alert_rule_test:
      - eval_time: 10m
        alertname: FitScrapeTargetDown
        exp_alerts:
          - exp_labels: {severity: warning, job: node, instance: "node-exporter:9100"}
            exp_annotations:
              summary: 수집 대상 node이(가) 응답하지 않는다
              description: "node(node-exporter:9100)의 up이 0이다. 이 대상의 알림은 조용해진다"
              runbook: RB-01
````

`infra/obs/prometheus/tests/containers.test.yml`:

````yaml
# rules/containers.yml 단위 시험
rule_files:
  - ../rules/containers.yml
evaluation_interval: 1m

tests:
  # 10분에 3번 시작 시각이 바뀌면 재시작 반복이다. 시작 시각이 그대로면 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'container_start_time_seconds{name="be-prod-blue"}'
        values: '100 100 200 200 300 300 400 400 400 400'
      - series: 'container_start_time_seconds{name="caddy"}'
        values: '100+0x9'
      - series: 'container_start_time_seconds{name=""}'
        values: '100 200 300 400 500 600 700 800 900 1000'
    alert_rule_test:
      - eval_time: 8m
        alertname: FitContainerRestartLoop
        exp_alerts:
          - exp_labels: {severity: critical, name: be-prod-blue}
            exp_annotations:
              summary: 컨테이너 be-prod-blue이(가) 10분에 3번 이상 다시 시작했다
              description: 재시작 3회(10분). 로그는 Dozzle로 본다
              runbook: RB-03

  # 한도의 95%를 10분 넘게 쓰면 울린다. 한도가 없는(0) 컨테이너와 name이 빈 항목은 보지 않는다
  - interval: 1m
    input_series:
      - series: 'container_memory_working_set_bytes{name="be-prod-blue"}'
        values: '95+0x15'
      - series: 'container_spec_memory_limit_bytes{name="be-prod-blue"}'
        values: '100+0x15'
      - series: 'container_memory_working_set_bytes{name="nolimit"}'
        values: '500+0x15'
      - series: 'container_spec_memory_limit_bytes{name="nolimit"}'
        values: '0+0x15'
      - series: 'container_memory_working_set_bytes{name="fine"}'
        values: '50+0x15'
      - series: 'container_spec_memory_limit_bytes{name="fine"}'
        values: '100+0x15'
      - series: 'container_memory_working_set_bytes{name=""}'
        values: '99+0x15'
      - series: 'container_spec_memory_limit_bytes{name=""}'
        values: '100+0x15'
    alert_rule_test:
      - eval_time: 5m
        alertname: FitContainerMemoryHigh
        exp_alerts: []
      - eval_time: 14m
        alertname: FitContainerMemoryHigh
        exp_alerts:
          - exp_labels: {severity: warning, name: be-prod-blue}
            exp_annotations:
              summary: 컨테이너 be-prod-blue의 메모리가 한도의 90%를 넘었다
              description: 한도 대비 사용 95% (10분 이상)
              runbook: RB-03
````

`infra/obs/prometheus/tests/app.test.yml`:

````yaml
# rules/app.yml 단위 시험. 지표 이름은 docs/infra/contracts/metrics.md의 계약이다.
rule_files:
  - ../rules/app.yml
evaluation_interval: 1m

tests:
  # prod는 두 색이 모두 down일 때만 다운이다. blue만 down(green 정상)이면 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'up{job="be", env="prod", color="blue", instance="be-prod-blue:8081"}'
        values: '0+0x6'
      - series: 'up{job="be", env="prod", color="green", instance="be-prod-green:8081"}'
        values: '0+0x6'
    alert_rule_test:
      - eval_time: 1m
        alertname: FitBeProdDown
        exp_alerts: []
      - eval_time: 5m
        alertname: FitBeProdDown
        exp_alerts:
          - exp_labels: {severity: critical, env: prod}
            exp_annotations:
              summary: prod BE가 모든 색에서 응답하지 않는다
              description: be-prod-blue와 be-prod-green의 관리 포트(8081)를 2분 이상 긁지 못했다
              runbook: RB-02
  - interval: 1m
    input_series:
      - series: 'up{job="be", env="prod", color="blue", instance="be-prod-blue:8081"}'
        values: '0+0x6'
      - series: 'up{job="be", env="prod", color="green", instance="be-prod-green:8081"}'
        values: '1+0x6'
    alert_rule_test:
      - eval_time: 5m
        alertname: FitBeProdDown
        exp_alerts: []

  # dev는 5분 뒤 warning이고 env=dev 라벨을 달아 dev 수신자로 간다
  - interval: 1m
    input_series:
      - series: 'up{job="be", env="dev", color="single", instance="be-dev:8081"}'
        values: '0+0x8'
    alert_rule_test:
      - eval_time: 7m
        alertname: FitBeDevDown
        exp_alerts:
          - exp_labels: {severity: warning, env: dev}
            exp_annotations:
              summary: dev BE가 응답하지 않는다
              description: be-dev의 관리 포트(8081)를 5분 이상 긁지 못했다
              runbook: RB-02

  # 5xx 비율: 초당 요청 1건 중 10%가 5xx면 울리고, 요청이 거의 없으면(0.1/s) 비율이 높아도 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'http_server_requests_seconds_count{env="prod", color="blue", status="200", uri="/api/v1/x"}'
        values: '0+54x15'
      - series: 'http_server_requests_seconds_count{env="prod", color="blue", status="500", uri="/api/v1/x"}'
        values: '0+6x15'
      - series: 'http_server_requests_seconds_count{env="dev", color="single", status="200", uri="/api/v1/x"}'
        values: '0+3x15'
      - series: 'http_server_requests_seconds_count{env="dev", color="single", status="500", uri="/api/v1/x"}'
        values: '0+3x15'
    alert_rule_test:
      - eval_time: 14m
        alertname: FitHttp5xxHigh
        exp_alerts:
          - exp_labels: {severity: warning, env: prod}
            exp_annotations:
              summary: prod BE의 5xx 비율이 2%를 넘었다
              description: 5xx 비율 10%. 요청이 초당 0.2건 이상일 때만 센다
              runbook: RB-02

  # 검색 p95: 버킷이 모두 4초 넘는 곳에 몰리면 울린다. 같은 지연이어도 검색이 아닌 경로는 검색 알림이 아니라 일반 지연 알림이다
  - interval: 1m
    input_series:
      - series: 'http_server_requests_seconds_bucket{env="prod", uri="/api/v1/search", le="1"}'
        values: '0+0x20'
      - series: 'http_server_requests_seconds_bucket{env="prod", uri="/api/v1/search", le="5"}'
        values: '0+60x20'
      - series: 'http_server_requests_seconds_bucket{env="prod", uri="/api/v1/search", le="+Inf"}'
        values: '0+60x20'
      - series: 'http_server_requests_seconds_count{env="prod", uri="/api/v1/search"}'
        values: '0+60x20'
      - series: 'http_server_requests_seconds_bucket{env="prod", uri="/api/v1/reviews", le="0.5"}'
        values: '0+0x20'
      - series: 'http_server_requests_seconds_bucket{env="prod", uri="/api/v1/reviews", le="2.5"}'
        values: '0+60x20'
      - series: 'http_server_requests_seconds_bucket{env="prod", uri="/api/v1/reviews", le="+Inf"}'
        values: '0+60x20'
      - series: 'http_server_requests_seconds_count{env="prod", uri="/api/v1/reviews"}'
        values: '0+60x20'
    alert_rule_test:
      - eval_time: 19m
        alertname: FitSearchLatencyHigh
        exp_alerts:
          - exp_labels: {severity: warning, env: prod}
            exp_annotations:
              summary: prod 검색 p95 지연이 4초를 넘었다
              description: 검색 p95 4.8s
              runbook: RB-07
      - eval_time: 19m
        alertname: FitHttpLatencyHigh
        exp_alerts:
          - exp_labels: {severity: warning, env: prod}
            exp_annotations:
              summary: prod BE p95 지연이 1초를 넘었다(검색 제외)
              description: p95 2.4s
              runbook: RB-02

  # 배치: 마지막 성공이 27시간 전이면 울리고 1시간 전이면 울리지 않는다. 색이 둘이면 더 최근 값을 본다
  - interval: 1m
    input_series:
      - series: 'batch_last_success_timestamp_seconds{env="prod", color="blue"}'
        values: '0+0x1700'
      - series: 'batch_last_success_timestamp_seconds{env="prod", color="green"}'
        values: '0+0x1700'
    alert_rule_test:
      - eval_time: 20h
        alertname: FitBatchStale
        exp_alerts: []
      - eval_time: 28h
        alertname: FitBatchStale
        exp_alerts:
          - exp_labels: {severity: warning, env: prod}
            exp_annotations:
              summary: 새벽 배치의 마지막 성공이 26시간을 넘었다
              description: 마지막 성공 후 1d 4h 0m 0s
              runbook: RB-07
  - interval: 1m
    input_series:
      - series: 'batch_last_success_timestamp_seconds{env="prod", color="blue"}'
        values: '0+0x1700'
      - series: 'batch_last_success_timestamp_seconds{env="prod", color="green"}'
        values: '0+60x1700'
    alert_rule_test:
      - eval_time: 28h
        alertname: FitBatchStale
        exp_alerts: []

  # heartbeat 지표가 없으면 15분 뒤 울린다. 있으면 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'up{job="be", env="prod", color="blue"}'
        values: '1+0x30'
    alert_rule_test:
      - eval_time: 10m
        alertname: FitBatchMetricMissing
        exp_alerts: []
      - eval_time: 20m
        alertname: FitBatchMetricMissing
        exp_alerts:
          - exp_labels: {severity: warning, env: prod}
            exp_annotations:
              summary: 배치 heartbeat 지표(batch_last_success_timestamp_seconds)가 없다
              description: "prod BE가 이 지표를 시작부터 내야 한다(BE 계약 #11). 배포 전이라면 정상이다"
              runbook: RB-07
      - eval_time: 20m
        alertname: FitHttpMetricMissing
        exp_alerts:
          - exp_labels: {severity: warning, env: prod}
            exp_annotations:
              summary: prod BE의 HTTP 요청 지표가 없다
              description: /actuator/prometheus를 긁지 못했거나 지표가 꺼져 있다. 배포 전이라면 정상이다
              runbook: RB-02
  - interval: 1m
    input_series:
      - series: 'batch_last_success_timestamp_seconds{env="prod", color="blue"}'
        values: '0+0x30'
      - series: 'http_server_requests_seconds_count{env="prod", color="blue", status="200", uri="/x"}'
        values: '0+1x30'
    alert_rule_test:
      - eval_time: 25m
        alertname: FitBatchMetricMissing
        exp_alerts: []
      - eval_time: 25m
        alertname: FitHttpMetricMissing
        exp_alerts: []
````

`infra/obs/prometheus/tests/modal.test.yml`:

````yaml
# rules/modal.yml 단위 시험(녹음 규칙 포함). 지표 이름은 docs/infra/contracts/metrics.md의 계약이다.
rule_files:
  - ../rules/modal.yml
evaluation_interval: 1m

tests:
  # 임베딩 폴백 비율 50%는 15분 뒤 울린다. 리랭커는 호출이 거의 없어(0.005/s) 비율이 100%여도 울리지 않는다. LLM은 폴백이 없다
  - interval: 1m
    input_series:
      - series: 'modal_embedding_calls_total{env="prod", color="blue"}'
        values: '0+60x40'
      - series: 'modal_embedding_fallback_total{env="prod", color="blue"}'
        values: '0+30x40'
      - series: 'modal_reranker_calls_total{env="prod", color="blue"}'
        values: '0+0.3x40'
      - series: 'modal_reranker_fallback_total{env="prod", color="blue"}'
        values: '0+0.3x40'
      - series: 'modal_llm_calls_total{env="prod", color="blue"}'
        values: '0+60x40'
      - series: 'modal_llm_fallback_total{env="prod", color="blue"}'
        values: '0+0x40'
    promql_expr_test:
      - expr: fit:modal_fallback_ratio:rate15m
        eval_time: 30m
        exp_samples:
          - labels: 'fit:modal_fallback_ratio:rate15m{component="embedding", env="prod"}'
            value: 0.5
          - labels: 'fit:modal_fallback_ratio:rate15m{component="reranker", env="prod"}'
            value: 1
          - labels: 'fit:modal_fallback_ratio:rate15m{component="llm", env="prod"}'
            value: 0
    alert_rule_test:
      - eval_time: 10m
        alertname: FitModalFallbackHigh
        exp_alerts: []
      - eval_time: 35m
        alertname: FitModalFallbackHigh
        exp_alerts:
          - exp_labels: {severity: warning, env: prod, component: embedding}
            exp_annotations:
              summary: prod embedding 호출의 폴백 비율이 30%를 넘었다
              description: 15분 폴백 비율 50%. Modal 쪽 장애이거나 콜드 스타트 타임아웃일 수 있다
              runbook: RB-11

  # 예산 85% 사용은 즉시 울리고 50%는 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'modal_daily_budget_used_ratio{env="prod", color="blue"}'
        values: '0.85+0x5'
      - series: 'modal_daily_budget_used_ratio{env="dev", color="single"}'
        values: '0.5+0x5'
    alert_rule_test:
      - eval_time: 3m
        alertname: FitModalBudgetHigh
        exp_alerts:
          - exp_labels: {severity: warning, env: prod}
            exp_annotations:
              summary: prod의 Modal 일일 호출 예산을 80% 썼다
              description: 예산 사용 85%. 소진되면 키워드 폴백으로 내려간다
              runbook: RB-11

  # 예산 지표가 없으면 15분 뒤 울린다
  - interval: 1m
    input_series:
      - series: 'up{job="be", env="prod"}'
        values: '1+0x30'
    alert_rule_test:
      - eval_time: 10m
        alertname: FitModalMetricMissing
        exp_alerts: []
      - eval_time: 20m
        alertname: FitModalMetricMissing
        exp_alerts:
          - exp_labels: {severity: warning, env: prod}
            exp_annotations:
              summary: Modal 예산 지표(modal_daily_budget_used_ratio)가 없다
              description: prod BE가 Redis 카운터를 이 지표로 내야 한다(BE 계약). 배포 전이라면 정상이다
              runbook: RB-11
````

`infra/obs/prometheus/tests/data.test.yml`:

````yaml
# rules/data.yml 단위 시험
rule_files:
  - ../rules/data.yml
evaluation_interval: 1m

tests:
  - interval: 1m
    input_series:
      - series: 'pg_up{instance="postgres-exporter:9187"}'
        values: '1 1 1 0 0 0 0'
    alert_rule_test:
      - eval_time: 2m
        alertname: FitPostgresDown
        exp_alerts: []
      - eval_time: 6m
        alertname: FitPostgresDown
        exp_alerts:
          - exp_labels: {severity: critical, instance: "postgres-exporter:9187"}
            exp_annotations:
              summary: exporter가 Postgres에 접속하지 못한다
              description: pg_up이 0이다(Postgres 중지, fit_monitor 비밀번호 불일치, 연결 한도 초과 중 하나)
              runbook: RB-06

  # 연결 50개/60개(83%)는 울리고 30개는 울리지 않는다. 상태별 행을 모두 더한다
  - interval: 1m
    input_series:
      - series: 'pg_settings_max_connections{instance="x"}'
        values: '60+0x10'
      - series: 'pg_stat_activity_count{datname="fit_prod", state="active"}'
        values: '30+0x10'
      - series: 'pg_stat_activity_count{datname="fit_prod", state="idle"}'
        values: '20+0x10'
    alert_rule_test:
      - eval_time: 8m
        alertname: FitPostgresConnectionsHigh
        exp_alerts:
          - exp_labels: {severity: warning}
            exp_annotations:
              summary: Postgres 연결이 최대 연결 수의 80%를 넘었다
              description: 연결 사용 비율 83.33%(최대 60). Hikari 풀 크기와 누수를 본다
              runbook: RB-06
  - interval: 1m
    input_series:
      - series: 'pg_settings_max_connections{instance="x"}'
        values: '60+0x10'
      - series: 'pg_stat_activity_count{datname="fit_prod", state="active"}'
        values: '10+0x10'
      - series: 'pg_stat_activity_count{datname="fit_prod", state="idle"}'
        values: '20+0x10'
    alert_rule_test:
      - eval_time: 8m
        alertname: FitPostgresConnectionsHigh
        exp_alerts: []

  # OpenSearch가 응답하지 않으면(clusterinfo_up==0) 2분 뒤 울린다
  - interval: 1m
    input_series:
      - series: 'elasticsearch_clusterinfo_up{url="http://opensearch:9200"}'
        values: '1 1 0 0 0 0 0'
    alert_rule_test:
      - eval_time: 3m
        alertname: FitOpensearchDown
        exp_alerts: []
      - eval_time: 6m
        alertname: FitOpensearchDown
        exp_alerts:
          - exp_labels: {severity: critical, url: "http://opensearch:9200"}
            exp_annotations:
              summary: exporter가 OpenSearch에 닿지 못한다
              description: elasticsearch_clusterinfo_up이 0이다. 검색은 키워드 폴백으로 내려간다
              runbook: RB-07

  # red는 울리고 green·yellow는 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'elasticsearch_cluster_health_status{cluster="c", color="red"}'
        values: '1+0x8'
      - series: 'elasticsearch_cluster_health_status{cluster="c", color="green"}'
        values: '0+0x8'
      - series: 'elasticsearch_cluster_health_status{cluster="c", color="yellow"}'
        values: '0+0x8'
    alert_rule_test:
      - eval_time: 6m
        alertname: FitOpensearchRed
        exp_alerts:
          - exp_labels: {severity: critical, cluster: c, color: red}
            exp_annotations:
              summary: OpenSearch 클러스터 상태가 red다
              description: 일부 인덱스의 주 샤드가 할당되지 않았다. Postgres에서 재색인한다
              runbook: RB-07

  # 힙 95%는 10분 뒤 울리고 50%는 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'elasticsearch_jvm_memory_used_bytes{area="heap", name="n"}'
        values: '95+0x15'
      - series: 'elasticsearch_jvm_memory_max_bytes{area="heap", name="n"}'
        values: '100+0x15'
      - series: 'elasticsearch_jvm_memory_used_bytes{area="non-heap", name="n"}'
        values: '99+0x15'
      - series: 'elasticsearch_jvm_memory_max_bytes{area="non-heap", name="n"}'
        values: '100+0x15'
    alert_rule_test:
      - eval_time: 5m
        alertname: FitOpensearchHeapHigh
        exp_alerts: []
      - eval_time: 14m
        alertname: FitOpensearchHeapHigh
        exp_alerts:
          - exp_labels: {severity: warning}
            exp_annotations:
              summary: OpenSearch 힙 사용이 90%를 넘었다
              description: 힙 사용 비율 95%(힙 768MB). k-NN 네이티브 메모리와 함께 본다
              runbook: RB-07
````

`infra/obs/prometheus/tests/backup.test.yml`:

````yaml
# rules/backup.yml 단위 시험. 지표는 계획 1D의 백업 스크립트가 쓰는 fit_backup.prom이다.
rule_files:
  - ../rules/backup.yml
evaluation_interval: 1m

tests:
  # pg 백업: 마지막 성공이 9시간 전이면 울리고 1시간 전이면 울리지 않는다. photos는 36시간이 기준이라 9시간 전은 괜찮다
  - interval: 1m
    input_series:
      - series: 'fit_backup_last_success_timestamp_seconds{kind="pg"}'
        values: '0+0x600'
      - series: 'fit_backup_last_success_timestamp_seconds{kind="photos"}'
        values: '0+0x600'
      - series: 'fit_backup_last_success_timestamp_seconds{kind="caddy"}'
        values: '0+0x600'
    alert_rule_test:
      - eval_time: 7h
        alertname: FitBackupPgStale
        exp_alerts: []
      - eval_time: 9h
        alertname: FitBackupPgStale
        exp_alerts:
          - exp_labels: {severity: warning, kind: pg}
            exp_annotations:
              summary: Postgres 백업의 마지막 성공이 8시간을 넘었다(주기는 4시간)
              description: 마지막 성공 후 9h 0m 0s. journalctl -u fit-backup@pg 를 본다
              runbook: RB-06
      - eval_time: 9h
        alertname: FitBackupPhotosStale
        exp_alerts: []
      - eval_time: 9h
        alertname: FitBackupCaddyStale
        exp_alerts: []
  - interval: 1m
    input_series:
      - series: 'fit_backup_last_success_timestamp_seconds{kind="photos"}'
        values: '0+0x2300'
      - series: 'fit_backup_last_success_timestamp_seconds{kind="caddy"}'
        values: '0+0x20000'
    alert_rule_test:
      - eval_time: 37h
        alertname: FitBackupPhotosStale
        exp_alerts:
          - exp_labels: {severity: warning, kind: photos}
            exp_annotations:
              summary: 사진 백업의 마지막 성공이 36시간을 넘었다(주기는 하루)
              description: 마지막 성공 후 1d 13h 0m 0s
              runbook: RB-06
      - eval_time: 10d
        alertname: FitBackupCaddyStale
        exp_alerts:
          - exp_labels: {severity: warning, kind: caddy}
            exp_annotations:
              summary: 인증서 볼륨 백업의 마지막 성공이 9일을 넘었다(주기는 일주일)
              description: 마지막 성공 후 10d 0h 0m 0s
              runbook: RB-05

  # 검증 결과 0은 5분 뒤 울리고 1은 울리지 않는다. 마지막 검증이 36시간 전이면 검증 정체 알림이 울린다
  - interval: 1m
    input_series:
      - series: 'fit_backup_last_verify_ok'
        values: '1 1 1 0 0 0 0 0 0 0 0'
      - series: 'fit_backup_last_verify_timestamp_seconds'
        values: '0+0x2300'
    alert_rule_test:
      - eval_time: 5m
        alertname: FitBackupVerifyFailed
        exp_alerts: []
      - eval_time: 10m
        alertname: FitBackupVerifyFailed
        exp_alerts:
          - exp_labels: {severity: warning}
            exp_annotations:
              summary: 마지막 덤프 복원 검증이 실패했다
              description: 검증에 실패한 덤프는 B로 보내지 않는다(failed-verify-*로 남는다). 다음 실행이 다시 검증한다
              runbook: RB-06
      - eval_time: 30h
        alertname: FitBackupVerifyStale
        exp_alerts: []
      - eval_time: 37h
        alertname: FitBackupVerifyStale
        exp_alerts:
          - exp_labels: {severity: warning}
            exp_annotations:
              summary: 덤프 복원 검증을 36시간 넘게 하지 않았다(주기는 하루)
              description: 마지막 검증 후 1d 13h 0m 0s
              runbook: RB-06

  # 대기 파일이 2시간 넘게 남으면 울린다. 0이 되면 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'fit_backup_outbox_files'
        values: '2+0x150'
    alert_rule_test:
      - eval_time: 100m
        alertname: FitBackupOutboxStuck
        exp_alerts: []
      - eval_time: 130m
        alertname: FitBackupOutboxStuck
        exp_alerts:
          - exp_labels: {severity: warning}
            exp_annotations:
              summary: B로 보내지 못한 백업 파일이 2시간 넘게 쌓여 있다
              description: 대기 파일 2개. A에서 B로 SSH가 되는지, 호스트 키와 vault 키 등록을 본다
              runbook: RB-06
  - interval: 1m
    input_series:
      - series: 'fit_backup_outbox_files'
        values: '0+0x150'
    alert_rule_test:
      - eval_time: 130m
        alertname: FitBackupOutboxStuck
        exp_alerts: []

  # 백업 지표가 없으면 1시간 뒤 울린다
  - interval: 1m
    input_series:
      - series: 'up{job="node"}'
        values: '1+0x100'
    alert_rule_test:
      - eval_time: 30m
        alertname: FitBackupMetricMissing
        exp_alerts: []
      - eval_time: 90m
        alertname: FitBackupMetricMissing
        exp_alerts:
          - exp_labels: {severity: warning, kind: pg}
            exp_annotations:
              summary: 백업 지표(fit_backup.prom)가 없다
              description: infra/backup/install.sh app 이 끝났는지, /var/lib/fit/metrics 마운트와 첫 백업을 본다
              runbook: RB-06

  # A에서 B의 22번 포트 프로브가 5분 넘게 실패하면 울린다
  - interval: 1m
    input_series:
      - series: 'probe_success{job="vault-ssh", instance="203.0.113.7:22", probe="vault-ssh"}'
        values: '1 1 0 0 0 0 0 0 0 0'
    alert_rule_test:
      - eval_time: 3m
        alertname: FitVaultUnreachable
        exp_alerts: []
      - eval_time: 9m
        alertname: FitVaultUnreachable
        exp_alerts:
          - exp_labels: {severity: warning, job: vault-ssh, instance: "203.0.113.7:22", probe: vault-ssh}
            exp_annotations:
              summary: A에서 B(203.0.113.7:22)의 SSH 포트에 닿지 못한다
              description: 백업 전송과 CI(verify 러너)가 영향을 받는다. B가 살아 있는지, 방화벽을 본다
              runbook: RB-01
````

- [ ] **Step 4: Alertmanager, blackbox, Grafana 설정 작성**

`infra/obs/alertmanager/alertmanager.yml`:

````yaml
# 서버 A의 Alertmanager 설정(설계 9.4절). Mattermost 수신 웹훅은 Slack 호환이라 slack_configs로 보낸다. 웹훅 주소는 파일에서 읽는다(obs-init이 만든다).
# 받는 곳은 둘이다: main(prod와 A 전체 알림)과 dev(env=dev인 알림). critical 알림은 main으로만 가고 더 자주 반복한다.
templates:
  - /etc/alertmanager/templates/*.tmpl

route:
  receiver: main
  group_by: [alertname, site, env]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: [env="dev"]
      receiver: dev
    - matchers: [severity="critical"]
      receiver: main
      repeat_interval: 1h

# 같은 알림의 critical이 떠 있으면 warning은 보내지 않는다
inhibit_rules:
  - source_matchers: [severity="critical"]
    target_matchers: [severity="warning"]
    equal: [alertname, site, env]

receivers:
  - name: main
    slack_configs:
      - api_url_file: /generated/secrets/mattermost_url
        send_resolved: true
        title: '{{ template "fit.title" . }}'
        text: '{{ template "fit.text" . }}'
        color: '{{ template "fit.color" . }}'
  - name: dev
    slack_configs:
      - api_url_file: /generated/secrets/mattermost_url_dev
        send_resolved: true
        title: '{{ template "fit.title" . }}'
        text: '{{ template "fit.text" . }}'
        color: '{{ template "fit.color" . }}'
````

`infra/obs/alertmanager/templates/fit.tmpl`:

````text
{{ define "fit.title" -}}
[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ .CommonLabels.alertname }} ({{ .CommonLabels.site }}{{ with .CommonLabels.env }}/{{ . }}{{ end }})
{{- end }}

{{ define "fit.text" -}}
{{ range .Alerts -}}
*{{ .Labels.severity | toUpper }}* {{ .Annotations.summary }}
{{ .Annotations.description }}
런북: {{ .Annotations.runbook }}
{{ end }}
{{- end }}

{{ define "fit.color" -}}
{{ if eq .Status "resolved" }}good{{ else if eq .CommonLabels.severity "critical" }}danger{{ else }}warning{{ end }}
{{- end }}
````

`infra/obs/alertmanager/routes.txt`(라우팅 시험 목록):

````text
# 라우팅 시험(infra/ci/check-alertmanager.sh). 한 줄이 한 시험이다: <기대 수신자> <라벨=값>...
main severity=critical env=prod site=A alertname=FitBeProdDown
main severity=warning env=prod site=A alertname=FitHttp5xxHigh
main severity=critical site=A alertname=FitMemoryLow
main severity=warning site=A alertname=FitBackupPgStale
dev severity=warning env=dev site=A alertname=FitBeDevDown
dev severity=critical env=dev site=A alertname=FitHttp5xxHigh
````

`infra/obs/blackbox/blackbox.yml`:

````yaml
# A의 blackbox 모듈. A에서는 B의 TCP 22 도달만 본다(설계 9.2절). 바깥에서 A를 보는 프로브는 B의 blackbox가 한다(infra/ops).
modules:
  tcp_connect:
    prober: tcp
    timeout: 5s
````

`infra/obs/grafana/provisioning/datasources/prometheus.yml`:

````yaml
apiVersion: 1

datasources:
  - name: Prometheus
    uid: prom-a
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
````

`infra/obs/grafana/provisioning/dashboards/dashboards.yml`:

````yaml
apiVersion: 1

providers:
  - name: fit
    orgId: 1
    folder: Fit Dining
    type: file
    disableDeletion: true
    allowUiUpdates: false
    options:
      path: /var/lib/grafana/dashboards
````

대시보드 3개(JSON)는 호스트·컨테이너(`fit-host`), 앱(`fit-app`), 데이터·백업(`fit-data`)이다. `infra/obs/grafana/dashboards/host.json`:

````json
{
  "uid": "fit-host",
  "title": "호스트·컨테이너",
  "tags": [
    "fit"
  ],
  "timezone": "browser",
  "schemaVersion": 39,
  "version": 1,
  "refresh": "30s",
  "time": {
    "from": "now-6h",
    "to": "now"
  },
  "panels": [
    {
      "id": 1,
      "type": "timeseries",
      "title": "CPU 사용률(5분)과 40% 기준선",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 0,
        "y": 0,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "100 * (1 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])))",
          "legendFormat": "사용률",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        },
        {
          "refId": "B",
          "expr": "vector(40)",
          "legendFormat": "기준선 40%",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percent",
          "min": 0,
          "max": 100
        },
        "overrides": []
      },
      "description": "설계 4.1절: vCPU당 baseline 40%"
    },
    {
      "id": 2,
      "type": "timeseries",
      "title": "메모리 가용률",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 8,
        "y": 0,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "100 * node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes",
          "legendFormat": "가용",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percent",
          "min": 0,
          "max": 100
        },
        "overrides": []
      }
    },
    {
      "id": 3,
      "type": "timeseries",
      "title": "스왑 사용률",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 16,
        "y": 0,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "100 * (1 - node_memory_SwapFree_bytes / node_memory_SwapTotal_bytes)",
          "legendFormat": "사용",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percent",
          "min": 0,
          "max": 100
        },
        "overrides": []
      }
    },
    {
      "id": 4,
      "type": "timeseries",
      "title": "디스크 사용률(/)",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 0,
        "y": 7,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "100 * (1 - node_filesystem_avail_bytes{mountpoint=\"/\", fstype!~\"tmpfs|overlay\"} / node_filesystem_size_bytes{mountpoint=\"/\", fstype!~\"tmpfs|overlay\"})",
          "legendFormat": "사용",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percent",
          "min": 0,
          "max": 100
        },
        "overrides": []
      }
    },
    {
      "id": 5,
      "type": "timeseries",
      "title": "로드 평균",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 8,
        "y": 7,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "node_load1",
          "legendFormat": "1분",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        },
        {
          "refId": "B",
          "expr": "node_load5",
          "legendFormat": "5분",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short"
        },
        "overrides": []
      }
    },
    {
      "id": 6,
      "type": "timeseries",
      "title": "컨테이너 재시작(1시간)",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 16,
        "y": 7,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "changes(container_start_time_seconds{name!=\"\"}[1h])",
          "legendFormat": "{{name}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short"
        },
        "overrides": []
      }
    },
    {
      "id": 7,
      "type": "timeseries",
      "title": "컨테이너 메모리(working set)",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 0,
        "y": 14,
        "w": 12,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "container_memory_working_set_bytes{name!=\"\"}",
          "legendFormat": "{{name}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "bytes"
        },
        "overrides": []
      }
    },
    {
      "id": 8,
      "type": "timeseries",
      "title": "컨테이너 메모리 한도 대비",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 12,
        "y": 14,
        "w": 12,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "100 * container_memory_working_set_bytes{name!=\"\"} / (container_spec_memory_limit_bytes{name!=\"\"} > 0)",
          "legendFormat": "{{name}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percent",
          "min": 0,
          "max": 100
        },
        "overrides": []
      }
    }
  ],
  "templating": {
    "list": []
  },
  "annotations": {
    "list": []
  }
}
````

`infra/obs/grafana/dashboards/app.json`:

````json
{
  "uid": "fit-app",
  "title": "앱",
  "tags": [
    "fit"
  ],
  "timezone": "browser",
  "schemaVersion": 39,
  "version": 1,
  "refresh": "30s",
  "time": {
    "from": "now-6h",
    "to": "now"
  },
  "panels": [
    {
      "id": 1,
      "type": "timeseries",
      "title": "요청률",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 0,
        "y": 0,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "sum by (env) (rate(http_server_requests_seconds_count[5m]))",
          "legendFormat": "{{env}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "reqps"
        },
        "overrides": []
      }
    },
    {
      "id": 2,
      "type": "timeseries",
      "title": "5xx 비율",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 8,
        "y": 0,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "sum by (env) (rate(http_server_requests_seconds_count{status=~\"5..\"}[5m])) / sum by (env) (rate(http_server_requests_seconds_count[5m]))",
          "legendFormat": "{{env}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "min": 0
        },
        "overrides": []
      }
    },
    {
      "id": 3,
      "type": "timeseries",
      "title": "p95 지연(검색 제외)",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 16,
        "y": 0,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "histogram_quantile(0.95, sum by (le, env) (rate(http_server_requests_seconds_bucket{uri!~\"/api/v1/search.*|/actuator.*\"}[5m])))",
          "legendFormat": "{{env}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "s"
        },
        "overrides": []
      }
    },
    {
      "id": 4,
      "type": "timeseries",
      "title": "검색 p95 지연",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 0,
        "y": 7,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "histogram_quantile(0.95, sum by (le, env) (rate(http_server_requests_seconds_bucket{uri=~\"/api/v1/search.*\"}[5m])))",
          "legendFormat": "{{env}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "s"
        },
        "overrides": []
      }
    },
    {
      "id": 5,
      "type": "timeseries",
      "title": "JVM 힙 사용",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 8,
        "y": 7,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "sum by (env, color) (jvm_memory_used_bytes{area=\"heap\"})",
          "legendFormat": "{{env}} {{color}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "bytes"
        },
        "overrides": []
      }
    },
    {
      "id": 6,
      "type": "timeseries",
      "title": "Hikari 연결",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 16,
        "y": 7,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "sum by (env, color) (hikaricp_connections_active)",
          "legendFormat": "사용 {{env}} {{color}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        },
        {
          "refId": "B",
          "expr": "sum by (env, color) (hikaricp_connections_pending)",
          "legendFormat": "대기 {{env}} {{color}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short"
        },
        "overrides": []
      }
    },
    {
      "id": 7,
      "type": "timeseries",
      "title": "Modal 폴백 비율(15분)",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 0,
        "y": 14,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "fit:modal_fallback_ratio:rate15m",
          "legendFormat": "{{env}} {{component}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "min": 0,
          "max": 1
        },
        "overrides": []
      }
    },
    {
      "id": 8,
      "type": "timeseries",
      "title": "Modal 일일 예산 사용",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 8,
        "y": 14,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "modal_daily_budget_used_ratio",
          "legendFormat": "{{env}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "min": 0,
          "max": 1
        },
        "overrides": []
      }
    },
    {
      "id": 9,
      "type": "timeseries",
      "title": "BE up(색별)",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 16,
        "y": 14,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "up{job=\"be\"}",
          "legendFormat": "{{env}} {{color}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short"
        },
        "overrides": []
      }
    }
  ],
  "templating": {
    "list": []
  },
  "annotations": {
    "list": []
  }
}
````

`infra/obs/grafana/dashboards/data.json`:

````json
{
  "uid": "fit-data",
  "title": "데이터·백업",
  "tags": [
    "fit"
  ],
  "timezone": "browser",
  "schemaVersion": 39,
  "version": 1,
  "refresh": "30s",
  "time": {
    "from": "now-6h",
    "to": "now"
  },
  "panels": [
    {
      "id": 1,
      "type": "timeseries",
      "title": "Postgres 연결",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 0,
        "y": 0,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "sum(pg_stat_activity_count)",
          "legendFormat": "연결",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        },
        {
          "refId": "B",
          "expr": "max(pg_settings_max_connections)",
          "legendFormat": "최대",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short"
        },
        "overrides": []
      }
    },
    {
      "id": 2,
      "type": "stat",
      "title": "Postgres 상태(pg_up)",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 8,
        "y": 0,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "pg_up",
          "legendFormat": "pg_up",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short"
        },
        "overrides": []
      }
    },
    {
      "id": 3,
      "type": "timeseries",
      "title": "DB 크기",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 16,
        "y": 0,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "pg_database_size_bytes{datname=~\"fit_.*\"}",
          "legendFormat": "{{datname}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "bytes"
        },
        "overrides": []
      }
    },
    {
      "id": 4,
      "type": "stat",
      "title": "OpenSearch 클러스터 상태",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 0,
        "y": 7,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "elasticsearch_cluster_health_status == 1",
          "legendFormat": "{{color}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short"
        },
        "overrides": []
      }
    },
    {
      "id": 5,
      "type": "timeseries",
      "title": "OpenSearch 힙 사용률",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 8,
        "y": 7,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "100 * elasticsearch_jvm_memory_used_bytes{area=\"heap\"} / elasticsearch_jvm_memory_max_bytes{area=\"heap\"}",
          "legendFormat": "{{name}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percent",
          "min": 0,
          "max": 100
        },
        "overrides": []
      }
    },
    {
      "id": 6,
      "type": "timeseries",
      "title": "백업 나이(시간)",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 16,
        "y": 7,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "(time() - fit_backup_last_success_timestamp_seconds) / 3600",
          "legendFormat": "{{kind}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "h"
        },
        "overrides": []
      },
      "description": "pg는 8시간, photos는 36시간, caddy는 9일이 알림 기준이다"
    },
    {
      "id": 7,
      "type": "stat",
      "title": "덤프 복원 검증 결과",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 0,
        "y": 14,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "fit_backup_last_verify_ok",
          "legendFormat": "1이면 통과",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short"
        },
        "overrides": []
      }
    },
    {
      "id": 8,
      "type": "timeseries",
      "title": "금고로 보내지 못한 파일",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 8,
        "y": 14,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "fit_backup_outbox_files",
          "legendFormat": "대기",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short"
        },
        "overrides": []
      }
    },
    {
      "id": 9,
      "type": "timeseries",
      "title": "배치 마지막 성공 후(시간)",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 16,
        "y": 14,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "(time() - max by (env) (batch_last_success_timestamp_seconds)) / 3600",
          "legendFormat": "{{env}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "h"
        },
        "overrides": []
      },
      "description": "26시간이 알림 기준이다"
    },
    {
      "id": 10,
      "type": "stat",
      "title": "B 도달(TCP 22)",
      "datasource": {
        "type": "prometheus",
        "uid": "prom-a"
      },
      "gridPos": {
        "x": 0,
        "y": 21,
        "w": 8,
        "h": 7
      },
      "targets": [
        {
          "refId": "A",
          "expr": "probe_success{job=\"vault-ssh\"}",
          "legendFormat": "{{instance}}",
          "datasource": {
            "type": "prometheus",
            "uid": "prom-a"
          }
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short"
        },
        "overrides": []
      }
    }
  ],
  "templating": {
    "list": []
  },
  "annotations": {
    "list": []
  }
}
````

- [ ] **Step 5: `fit_monitor` role 추가 (데이터 스크립트 수정)**

postgres-exporter가 읽을 role을 `ensure-databases.sh`가 만들고, 비밀번호는 `data.env`의 `FIT_MONITOR_PASSWORD`로 맞춘다. `verify-data.sh`는 통계를 읽을 수 있고 앱 DB에는 접속하지 못하는지 본다:

````diff
diff --git a/infra/data/data.env.example b/infra/data/data.env.example
index 6dd66e4..70c738e 100644
--- a/infra/data/data.env.example
+++ b/infra/data/data.env.example
@@ -10,3 +10,4 @@ S3_PROD_ACCESS_KEY=REPLACE_ME
 S3_PROD_SECRET_KEY=REPLACE_ME
 S3_DEV_ACCESS_KEY=REPLACE_ME
 S3_DEV_SECRET_KEY=REPLACE_ME
+FIT_MONITOR_PASSWORD=REPLACE_ME
````

````diff
diff --git a/infra/data/lib.sh b/infra/data/lib.sh
index 44e4ec1..c618564 100644
--- a/infra/data/lib.sh
+++ b/infra/data/lib.sh
@@ -36,7 +36,7 @@ read_env_file() {
 }
 
 # data.env를 읽어 환경변수로 올린다. 필수 키가 없거나 자리표시자(REPLACE_ME)이면 멈춘다. 값은 출력하지 않는다.
-DATA_KEYS="POSTGRES_PASSWORD FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD REDIS_PROD_PASSWORD REDIS_DEV_PASSWORD
+DATA_KEYS="POSTGRES_PASSWORD FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD FIT_MONITOR_PASSWORD REDIS_PROD_PASSWORD REDIS_DEV_PASSWORD
   GARAGE_RPC_SECRET GARAGE_ADMIN_TOKEN S3_PROD_ACCESS_KEY S3_PROD_SECRET_KEY S3_DEV_ACCESS_KEY S3_DEV_SECRET_KEY"
 load_data_env() {
   local k
@@ -51,7 +51,7 @@ load_data_env() {
     case "${!k}" in *REPLACE_ME*) die "data.env의 $k가 자리표시자(REPLACE_ME)다" ;; esac
   done
   # 비밀번호는 SQL과 compose 보간에 그대로 들어가므로 따옴표, $, 공백이 없는 문자만 쓴다
-  for k in POSTGRES_PASSWORD FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD REDIS_PROD_PASSWORD REDIS_DEV_PASSWORD GARAGE_ADMIN_TOKEN; do
+  for k in POSTGRES_PASSWORD FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD FIT_MONITOR_PASSWORD REDIS_PROD_PASSWORD REDIS_DEV_PASSWORD GARAGE_ADMIN_TOKEN; do
     printf '%s' "${!k}" | grep -Eq '^[A-Za-z0-9._~-]{16,}$' || die "data.env의 $k는 영문, 숫자, ._~- 만 쓴 16자 이상이어야 한다"
   done
   printf '%s' "$GARAGE_RPC_SECRET" | grep -Eq '^[0-9a-f]{64}$' || die "data.env의 GARAGE_RPC_SECRET은 64자리 16진수여야 한다"
````

````diff
diff --git a/infra/data/ensure-databases.sh b/infra/data/ensure-databases.sh
index 2e5a0fe..be4e440 100755
--- a/infra/data/ensure-databases.sh
+++ b/infra/data/ensure-databases.sh
@@ -2,7 +2,8 @@
 # 환경별 DB와 role을 만든다(설계 2.3절, 7.1절). 몇 번 실행해도 같은 결과다(멱등). init 스크립트가 아니라 이 스크립트를 쓰는 이유는
 # init 스크립트가 빈 볼륨에서 한 번만 돌기 때문이다(A503 함정). role 비밀번호는 매번 data.env 값으로 맞춘다.
 #   bash infra/data/ensure-databases.sh
-# role: fit_migrator(DDL), fit_prod_app, fit_dev_app(DML만). DB: fit_prod, fit_dev(소유자 fit_migrator). 각 app role은 자기 DB에만 접속한다.
+# role: fit_migrator(DDL), fit_prod_app, fit_dev_app(DML만), fit_monitor(관측성: pg_monitor 권한으로 통계만 읽는다).
+# DB: fit_prod, fit_dev(소유자 fit_migrator). 각 app role은 자기 DB에만 접속하고 fit_monitor는 앱 DB에 접속하지 못한다(postgres DB에서 통계를 읽는다).
 # dev role에는 statement_timeout 30초를 건다. 비밀번호는 표준 입력으로만 넘기고 서버의 통계·로그에 남지 않게 세션 설정을 끈다.
 set -euo pipefail
 # shellcheck source=infra/data/lib.sh
@@ -16,9 +17,11 @@ SET log_statement = 'none';
 SELECT 'CREATE ROLE fit_migrator LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_migrator') \gexec
 SELECT 'CREATE ROLE fit_prod_app LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_prod_app') \gexec
 SELECT 'CREATE ROLE fit_dev_app LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_dev_app') \gexec
+SELECT 'CREATE ROLE fit_monitor LOGIN IN ROLE pg_monitor' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fit_monitor') \gexec
 ALTER ROLE fit_migrator PASSWORD '${FIT_MIGRATOR_PASSWORD}';
 ALTER ROLE fit_prod_app PASSWORD '${FIT_PROD_APP_PASSWORD}';
 ALTER ROLE fit_dev_app PASSWORD '${FIT_DEV_APP_PASSWORD}';
+ALTER ROLE fit_monitor PASSWORD '${FIT_MONITOR_PASSWORD}';
 ALTER ROLE fit_dev_app SET statement_timeout = '30s';
 SELECT 'CREATE DATABASE fit_prod OWNER fit_migrator' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fit_prod') \gexec
 SELECT 'CREATE DATABASE fit_dev OWNER fit_migrator' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fit_dev') \gexec
````

````diff
diff --git a/infra/data/verify-data.sh b/infra/data/verify-data.sh
index 3a2acdd..481d178 100755
--- a/infra/data/verify-data.sh
+++ b/infra/data/verify-data.sh
@@ -40,6 +40,9 @@ for env in prod dev; do
 done
 ok_if "fit_migrator가 fit_prod에서 테이블을 만들 수 있다" "$(succeeds pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'CREATE TEMP TABLE verify_ddl (id int)')"
 ok_if "dev 앱 role에 쿼리 시간 제한 30초가 걸려 있다" "$(succeeds pg_as fit_dev_app "$FIT_DEV_APP_PASSWORD" fit_dev "SELECT 1 WHERE current_setting('statement_timeout') = '30s'")"
+ok_if "fit_monitor가 postgres DB에서 통계(pg_stat_activity)를 읽는다" "$(succeeds pg_as fit_monitor "$FIT_MONITOR_PASSWORD" postgres 'SELECT count(*) FROM pg_stat_activity')"
+ok_if "fit_monitor는 fit_prod와 fit_dev에 접속하지 못한다" \
+  "$([ "$(fails pg_as fit_monitor "$FIT_MONITOR_PASSWORD" fit_prod 'SELECT 1')$(fails pg_as fit_monitor "$FIT_MONITOR_PASSWORD" fit_dev 'SELECT 1')" = 11 ] && echo 1 || echo 0)"
 pg_super() { docker exec -e "PGPASSWORD=$1" "$(svc_container postgres)" psql -h postgres -U postgres -d postgres -c 'SELECT 1'; }
 ok_if "슈퍼유저 postgres는 네트워크로 접속할 때 비밀번호를 쓴다" "$(succeeds pg_super "$POSTGRES_PASSWORD")"
 ok_if "틀린 비밀번호는 거부한다" "$(fails pg_super "wrong-$POSTGRES_PASSWORD")"
````

````diff
diff --git a/infra/data/test/test-data.sh b/infra/data/test/test-data.sh
index d1f504f..31e1968 100755
--- a/infra/data/test/test-data.sh
+++ b/infra/data/test/test-data.sh
@@ -32,6 +32,7 @@ make_env() {
     echo "FIT_MIGRATOR_PASSWORD=$(hex 12)"
     echo "FIT_PROD_APP_PASSWORD=$(hex 12)"
     echo "FIT_DEV_APP_PASSWORD=$(hex 12)"
+    echo "FIT_MONITOR_PASSWORD=$(hex 12)"
     echo "REDIS_PROD_PASSWORD=$(hex 12)"
     echo "REDIS_DEV_PASSWORD=$(hex 12)"
     echo "GARAGE_RPC_SECRET=$(hex 32)"
@@ -110,8 +111,9 @@ run_init_checks() {
   if [ "${FIT_TEST_OPENSEARCH:-0}" = 1 ]; then skip_os=0; fi
   out="$(FIT_VERIFY_SKIP_OPENSEARCH=$skip_os bash infra/data/verify-data.sh 2>&1)" && rc=0 || rc=$?
   printf '%s\n' "$out" >>"$OUT_ALL"
-  ok_if "verify-data.sh가 모두 통과한다" "$(is "$rc" 0)"
+  # 실패하면 출력의 끝이 아니라 FAIL 줄이 보이게 한다(어느 점검이 틀렸는지 알려고)
   if [ "$rc" != 0 ]; then out="$(grep '^FAIL' <<<"$out" || true)"; fi
+  ok_if "verify-data.sh가 모두 통과한다" "$(is "$rc" 0)"
   ok_if "net-data는 internal 망이다" "$(is "$(docker network inspect -f '{{.Internal}}' "${PREFIX}net-data")" true)"
 }
 
@@ -123,7 +125,7 @@ run_idempotent_checks() {
   run_script init-data.sh
   ok_if "다시 실행해도 성공한다" "$(is "$rc" 0)"
   ok_if "두 번째 실행은 Garage 레이아웃을 다시 적용하지 않는다" "$(is "$(has "$out" '레이아웃을 적용했다')" 0)"
-  ok_if "role은 3개뿐이다" "$(is "$(psql_admin -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'fit\\_%'")" 3)"
+  ok_if "role은 4개뿐이다(마이그레이터, prod 앱, dev 앱, 모니터링)" "$(is "$(psql_admin -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'fit\\_%'")" 4)"
   ok_if "DB는 2개뿐이다" "$(is "$(psql_admin -d postgres -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'fit\\_%'")" 2)"
   ok_if "재실행이 기존 데이터를 건드리지 않는다(Postgres)" "$(is "$(pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_prod 'SELECT id FROM keep_rows')" 7)"
   out="$(prod_s3 get fit-prod-photos keep.txt)"
@@ -157,6 +159,9 @@ run_privilege_checks() {
   ok_if "앱 role은 TRUNCATE하지 못한다" "$(fails pg_as fit_prod_app "$p" fit_prod 'TRUNCATE t_flow')"
   ok_if "dev 앱 role은 prod DB에 접속하지 못한다" "$(fails pg_as fit_dev_app "$d" fit_prod 'SELECT 1')"
   ok_if "prod 앱 role은 dev DB에 접속하지 못한다" "$(fails pg_as fit_prod_app "$p" fit_dev 'SELECT 1')"
+  ok_if "모니터링 role(fit_monitor)은 postgres DB의 통계를 읽는다" "$(succeeds pg_as fit_monitor "$FIT_MONITOR_PASSWORD" postgres 'SELECT count(*) FROM pg_stat_activity')"
+  ok_if "모니터링 role은 앱 DB에 접속하지 못한다" "$([ "$(fails pg_as fit_monitor "$FIT_MONITOR_PASSWORD" fit_prod 'SELECT 1')$(fails pg_as fit_monitor "$FIT_MONITOR_PASSWORD" fit_dev 'SELECT 1')" = 11 ] && echo 1 || echo 0)"
+  ok_if "모니터링 role은 테이블을 만들지 못한다" "$(fails pg_as fit_monitor "$FIT_MONITOR_PASSWORD" postgres 'CREATE TABLE monitor_denied (id int)')"
   psql_admin -d fit_prod -c 'CREATE TABLE t_super (id int)' >/dev/null
   ok_if "슈퍼유저가 만든 테이블은 재실행 전까지 앱 role이 못 읽는다" "$(fails pg_as fit_prod_app "$p" fit_prod 'SELECT * FROM t_super')"
   run_script ensure-databases.sh
@@ -224,7 +229,7 @@ run_postgres_checks() {
   ok_if "idle_in_transaction_session_timeout이 1분이다" "$(is "$(psql_admin -d postgres -c 'SHOW idle_in_transaction_session_timeout')" 1min)"
   ok_if "pgvector가 동작한다" "$(is "$(pg_as fit_migrator "$FIT_MIGRATOR_PASSWORD" fit_dev "SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector")" 1)"
   local k bad=0
-  for k in FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD; do
+  for k in FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD FIT_MONITOR_PASSWORD; do
     if docker logs "$(svc_container postgres)" 2>&1 | grep -qF "$(val "$k")"; then bad=1; fi
   done
   ok_if "role 비밀번호가 Postgres 로그에 남지 않는다" "$(is "$bad" 0)"
@@ -274,7 +279,7 @@ run_port_checks() {
 run_hygiene_checks() {
   echo "--- 비밀 값 노출"
   local k bad=0
-  for k in POSTGRES_PASSWORD FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD REDIS_PROD_PASSWORD REDIS_DEV_PASSWORD GARAGE_RPC_SECRET GARAGE_ADMIN_TOKEN S3_PROD_SECRET_KEY S3_DEV_SECRET_KEY; do
+  for k in POSTGRES_PASSWORD FIT_MIGRATOR_PASSWORD FIT_PROD_APP_PASSWORD FIT_DEV_APP_PASSWORD FIT_MONITOR_PASSWORD REDIS_PROD_PASSWORD REDIS_DEV_PASSWORD GARAGE_RPC_SECRET GARAGE_ADMIN_TOKEN S3_PROD_SECRET_KEY S3_DEV_SECRET_KEY; do
     if [ "$(has "$(cat "$OUT_ALL")" "$(val "$k")")" = 1 ]; then
       bad=1
       echo "FAIL  $k 값이 스크립트 출력에 찍혔다"
````

````diff
diff --git a/infra/data/README.md b/infra/data/README.md
index 42e757c..3da979f 100644
--- a/infra/data/README.md
+++ b/infra/data/README.md
@@ -36,11 +36,13 @@ BE는 서비스 이름으로 접속한다(`postgres`, `redis-prod`, `redis-dev`,
 | Redis | `redis-prod`(자기 비밀번호) | `redis-dev`(자기 비밀번호) |
 | Garage | 버킷 `fit-prod-photos`, prod 전용 키 | 버킷 `fit-dev-photos`, dev 전용 키 |
 
+관측용 role `fit_monitor`(`pg_monitor` 멤버)는 postgres-exporter가 `postgres` DB에서 통계만 읽는 데 쓴다. `fit_prod`, `fit_dev`에는 접속하지 못한다. 비밀번호는 `FIT_MONITOR_PASSWORD`이고 `obs.env`의 같은 키와 같아야 한다.
+
 각 앱 role은 자기 DB에만 접속한다. 마이그레이터가 만드는 테이블과 시퀀스에는 앱 role의 DML 권한이 자동으로 붙는다. 초기화 스크립트를 다시 돌리면 다른 방법으로 만든 기존 테이블에도 같은 권한을 준다.
 
 ## data.env
 
-`/etc/fit/data.env`(root:docker 0640)에 12개 키가 있다. 키 목록과 소비자는 [env.md](../../docs/infra/contracts/env.md)의 `data` 그룹이고 예제는 `data.env.example`이다. 값 규칙은 스크립트가 검사하고 어긋나면 값을 찍지 않고 어떤 키가 틀렸는지만 알려 준다.
+`/etc/fit/data.env`(root:docker 0640)에 13개 키가 있다. 키 목록과 소비자는 [env.md](../../docs/infra/contracts/env.md)의 `data` 그룹이고 예제는 `data.env.example`이다. 값 규칙은 스크립트가 검사하고 어긋나면 값을 찍지 않고 어떤 키가 틀렸는지만 알려 준다.
 
 | 키 | 규칙 | 만드는 법 |
 |---|---|---|
````

- [ ] **Step 6: 정적 검증 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$PROMETHEUS_IMAGE" sh infra/ci/check-prometheus.sh 2>&1 | grep -E "^==|SUCCESS|FAIL|passed|failed" | sort | uniq -c
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$ALERTMANAGER_IMAGE" sh infra/ci/check-alertmanager.sh 2>&1 | grep -E "^==|^OK|FAIL"
python infra/ci/check_alerts.py
docker compose -f infra/obs/compose.obs.yml --env-file infra/obs/obs.env.example config -q && echo "obs config OK"
docker compose -f infra/obs/compose.obs.yml --env-file infra/obs/obs.env.example config --format json | python -c "
import json,sys
c=json.load(sys.stdin)
total=0
for n,s in c['services'].items():
    mem=int(s.get('mem_limit') or 0)
    if n != 'obs-init': total += mem
    print(n, mem // 1048576, 'MB', [p['host_ip'] + ':' + str(p['published']) for p in s.get('ports', [])])
print('합계', total // 1048576, 'MB')
"
docker compose -f infra/obs/compose.obs.yml config -q 2>&1 | head -1
python infra/ci/ports_invariant.py infra/obs/compose.obs.yml --env-file infra/obs/obs.env.example
python infra/ci/check_env_files.py infra/obs/obs.env.example infra/data/data.env.example
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml infra/obs infra/data; echo "yamllint exit=$?"
python infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/obs/compose.obs.yml --env-file infra/obs/obs.env.example
docker run --rm --network none -e GENERATED_DIR=/g -e B_IP=b.example.test -e MATTERMOST_WEBHOOK_URL=https://mm.example.test/hooks/a -e MATTERMOST_WEBHOOK_URL_DEV=https://mm.example.test/hooks/b -v "$W/infra/obs/render.py:/render.py:ro" "$PYTHON_IMAGE" python /render.py
docker run --rm --network none -e GENERATED_DIR=/g -e B_IP=REPLACE_ME -e MATTERMOST_WEBHOOK_URL=https://mm.example.test/hooks/a -e MATTERMOST_WEBHOOK_URL_DEV=https://mm.example.test/hooks/b -v "$W/infra/obs/render.py:/render.py:ro" "$PYTHON_IMAGE" python /render.py; echo "exit=$?"
```

Expected: promtool은 `== infra/obs/prometheus`, 설정 `SUCCESS: infra/obs/prometheus/prometheus.yml is valid prometheus config file syntax`, `SUCCESS: 6 rule files found`, 규칙 파일별 `SUCCESS: N rules found`(같은 개수는 `uniq -c`가 묶어 보여 준다), 단위 시험 여섯 파일의 `SUCCESS`(`6   SUCCESS`)를 낸다. amtool은 `== infra/obs/alertmanager`와 라우팅 시험 여섯 줄이 `OK`, 이어서 `OK alerts (1개 스택)`, `obs config OK`, 서비스 아홉 개와 `obs-init`이 한도(MB)와 함께 나오고 `127.0.0.1`의 `9090`, `3000`, `8888`만 게시되며 `합계 1344 MB`, 필수 값이 없을 때의 오류 한 줄(`required variable … is missing`), `OK ports (10 service(s))`, `OK env (2 file(s))`, `yamllint exit=0`, `OK arch linux/arm64,linux/amd64`(이미지 수 포함), `render.py`의 올바른 값은 `만들었다: /g/targets/vault-ssh.yml` 등 파일 이름만 출력하고 웹훅 주소는 출력하지 않는다. `B_IP=REPLACE_ME`는 `FAIL B_IP이(가) 비었거나 자리표시자(REPLACE_ME)다`와 `exit=1`이다.

이 시점에는 단위 테스트(`python -m unittest discover -s infra/ci/tests`)를 돌리지 않는다. 환경변수 계약(`env.md`)은 예제 파일이 모두 생기는 Task 8에서 맞추므로, 그 전에는 계약과 실제 예제를 대조하는 `test_real_contract_matches_real_examples`가 실패한다(새 키 `FIT_MONITOR_PASSWORD` 등이 아직 계약에 없다). Task 8 이후에는 통과한다.

- [ ] **Step 7: 데이터 시험으로 `fit_monitor` 확인 (게이트)**

데이터 스크립트를 바꿨으므로 1D의 데이터 시험이 그대로 통과해야 한다. role이 네 개가 되고(`fit_monitor` 추가) `verify-data.sh`가 monitor 점검 두 개를 더 본다.

Run:

```bash
bash infra/data/test/test-data.sh up >/dev/null
bash infra/data/test/test-data.sh run 2>&1 | grep -E "^---|^FAIL|^PASS|^데이터 스택 시험|개 점검 실패"
bash infra/data/test/test-data.sh down
```

Expected: 구역 제목 10개가 나오고 `FAIL`은 하나도 없으며 `데이터 스택 시험 통과`다. 전체 `PASS` 줄은 62개다. `fit_monitor`의 점검(`통계를 읽는다`, `접속하지 못한다`)이 통과한다. 끝나면 `정리했다`가 나온다.

- [ ] **Step 8: 커밋 (허용된 경우)**

```bash
git add infra/obs infra/data
git commit -m "feat(infra): A 관측 스택(Prometheus·Alertmanager·Grafana·exporter) 정의와 알림 규칙 35개, fit_monitor role 추가"
```

---

### Task 3: A 운영 스크립트

**목표:** 스택이 설계대로 떠 있는지 읽기 전용으로 점검하는 `verify-obs.sh`, 매일 09:00 KST에 상태를 요약해 올리는 `daily-digest.py`, 서버에 설치하는 `install.sh`와 systemd 유닛을 만든다.

**Files:**
- Create: `infra/obs/verify-obs.sh`, `infra/obs/daily-digest.py`, `infra/obs/install.sh`, `infra/obs/conf/systemd/fit-daily-digest.service`, `infra/obs/conf/systemd/fit-daily-digest.timer`

**Interfaces:**
- Consumes: Task 2의 스택(프로젝트 `fit-obs`, 컨테이너는 compose 라벨로 찾는다), 1C-2의 `infra/deploy/lib.sh`(`find_python`), `/etc/fit/edge.env`의 `PROD_HOST`·`DEV_HOST`, `/srv/fit/state/history-<환경>.log`(1C-2의 배포 이력), 1D의 백업 지표
- Produces: `verify-obs.sh`(PASS·FAIL·SKIP, 하나라도 FAIL이면 종료 코드 1. 환경변수 `FIT_OBS_PROJECT`), `daily-digest.py [--dry-run]`(옵션 `--prom`, `--state-dir`, `--obs-env`, `--edge-env`, `--tls-connect`), `sudo bash infra/obs/install.sh`(멱등, 환경변수 `FIT_SKIP=apt,systemd`, `FIT_OBS_ROOT`, `FIT_SYSTEMD_DIR`, `FIT_ENV_DIR`), 유닛 `fit-daily-digest.service`·`.timer`(매일 09:00)

핵심 결정:

- `verify-obs.sh`는 컨테이너 안에서 API를 불러(`docker exec ... wget`) 호스트에 게시된 포트가 없어도 돈다. BE와 caddy는 첫 배포 전에는 없어서 `SKIP`이다.
- 일일 요약은 항목마다 정상(✅)·주의(⚠️)·값 없음(❔)을 붙이고 기준은 알림 규칙과 같다. 인증서 잔여일은 서버 자신의 443에서 `openssl s_client`로 읽는다. Prometheus에 닿지 못하면 그 사실을 올리고 종료 코드 1로 끝난다. 웹훅 주소와 `edge.env`의 다른 키(게이트 키)는 읽거나 출력하지 않는다.
- `install.sh`는 코드를 root 소유 사본(`/usr/local/lib/fit/obs`)에 두고 `obs.env`를 예제에서 만들며(640 root:docker) 웹훅이 채워진 뒤에만 타이머를 켠다. 사본을 손으로 고쳐도 다시 실행하면 저장소와 같게 되돌린다.

- [ ] **Step 1: 점검과 일일 요약 스크립트 작성**

`infra/obs/verify-obs.sh`:

````bash
#!/usr/bin/env bash
# 관측 스택이 설계대로 떠 있는지 점검한다(설계 9절). 읽기만 하고 아무것도 바꾸지 않는다. 점검마다 PASS, FAIL, SKIP만 출력하고 값은 찍지 않는다.
#   bash infra/obs/verify-obs.sh
# 컨테이너 안에서 API를 불러(docker exec) 호스트에 게시된 포트가 없어도 돈다. 하나라도 FAIL이면 종료 코드 1이다.
# 환경변수: FIT_OBS_PROJECT(fit-obs). BE와 caddy는 첫 배포 전에는 없으므로 down이면 SKIP으로 센다.
set -uo pipefail
export PYTHONUTF8=1
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../deploy/lib.sh"

PROJECT="${FIT_OBS_PROJECT:-fit-obs}"
PY="$(find_python)" || {
  echo "FAIL python 3.9 이상이 필요하다" >&2
  exit 1
}
FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }

cid() { docker ps -a -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n 1; }
api() { docker exec "$(cid "$1")" wget -qO- "$2" 2>/dev/null; } # api 서비스 URL: 그 컨테이너 안에서 읽는다
pyjson() { "$PY" -c "$1"; } # 표준 입력의 JSON을 파이썬 식으로 판정한다

for svc in prometheus alertmanager grafana node-exporter cadvisor blackbox postgres-exporter opensearch-exporter dozzle; do
  c="$(cid "$svc")"
  state=""
  if [ -n "$c" ]; then state="$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$c" | tr -d '\r\n')"; fi
  case "$state" in running/healthy | running/-) pass "$svc가 떠 있다($state)" ;; *) fail "$svc가 떠 있지 않다(${state:-컨테이너 없음})" ;; esac
done
c="$(cid obs-init)"
ok_if "obs-init(설정 만들기)이 성공으로 끝났다" "$([ -n "$c" ] && [ "$(docker inspect -f '{{.State.ExitCode}}' "$c" | tr -d '\r\n')" = 0 ] && echo 1 || echo 0)"

# 수집 대상: 필수 job은 up이 하나 이상이어야 하고 be·caddy는 배포 전이면 SKIP이다
targets="$(api prometheus 'http://localhost:9090/api/v1/targets?state=active')"
for job in prometheus alertmanager node cadvisor postgres opensearch blackbox vault-ssh; do
  up="$(printf '%s' "$targets" | pyjson "import json,sys; t=json.load(sys.stdin)['data']['activeTargets']; print(sum(1 for x in t if x['labels']['job']=='$job' and x['health']=='up'))" 2>/dev/null || echo 0)"
  ok_if "수집 대상 $job: up이 있다" "$([ "${up:-0}" -ge 1 ] && echo 1 || echo 0)"
done
for job in be caddy; do
  up="$(printf '%s' "$targets" | pyjson "import json,sys; t=json.load(sys.stdin)['data']['activeTargets']; print(sum(1 for x in t if x['labels']['job']=='$job' and x['health']=='up'))" 2>/dev/null || echo 0)"
  if [ "${up:-0}" -ge 1 ]; then pass "수집 대상 $job: up이 있다"; else skip "수집 대상 $job: up이 없다(첫 배포 전이면 정상)"; fi
done

# 규칙: 모두 평가에 성공하고 알림 규칙이 있다
rules="$(api prometheus 'http://localhost:9090/api/v1/rules')"
bad="$(printf '%s' "$rules" | pyjson "import json,sys; g=json.load(sys.stdin)['data']['groups']; print(sum(1 for x in g for r in x['rules'] if r.get('health')!='ok' or r.get('lastError')))" 2>/dev/null || echo 99)"
n="$(printf '%s' "$rules" | pyjson "import json,sys; g=json.load(sys.stdin)['data']['groups']; print(sum(1 for x in g for r in x['rules'] if r['type']=='alerting'))" 2>/dev/null || echo 0)"
ok_if "알림 규칙 $n개가 올라와 있다" "$([ "${n:-0}" -ge 1 ] && echo 1 || echo 0)"
ok_if "모든 규칙이 오류 없이 평가된다" "$([ "${bad:-99}" = 0 ] && echo 1 || echo 0)"

# 알림 경로: Prometheus가 Alertmanager를 알고 Alertmanager가 준비돼 있다
am="$(api prometheus 'http://localhost:9090/api/v1/alertmanagers')"
ok_if "Prometheus가 Alertmanager를 찾았다" "$(printf '%s' "$am" | pyjson "import json,sys; print(1 if json.load(sys.stdin)['data']['activeAlertmanagers'] else 0)" 2>/dev/null || echo 0)"
ok_if "Alertmanager가 준비됐다" "$([ -n "$(api alertmanager 'http://localhost:9093/-/ready')" ] && echo 1 || echo 0)"

# 보존 설정(설계 9.1절)
flags="$(api prometheus 'http://localhost:9090/api/v1/status/flags')"
ok_if "보존 기간 7일(1w), 크기 상한 5GB(5GiB)" "$(printf '%s' "$flags" | pyjson "import json,sys; f=json.load(sys.stdin)['data']; print(1 if f['storage.tsdb.retention.time'] in ('7d','1w') and f['storage.tsdb.retention.size'] in ('5GB','5GiB') else 0)" 2>/dev/null || echo 0)"

ok_if "Grafana가 응답한다" "$(api grafana 'http://localhost:3000/api/health' | pyjson "import json,sys; print(1 if json.load(sys.stdin).get('database')=='ok' else 0)" 2>/dev/null || echo 0)"

# 호스트에 게시한 포트는 127.0.0.1뿐이다(설계 13.1절)
exposed="$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Ports}}' | tr ',' '\n' | grep -c -E '(^|[ ])(0\.0\.0\.0|\[::\]):[0-9]+->' || true)"
ok_if "0.0.0.0에 게시한 포트가 없다" "$([ "${exposed:-0}" = 0 ] && echo 1 || echo 0)"

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d개 점검 실패\n' "$FAILED"
  exit 1
fi
printf '\n관측 스택이 설계대로다\n'
````

`infra/obs/daily-digest.py`:

````python
#!/usr/bin/env python3
"""일일 점검 요약(설계 10.1절). 서버 A에서 매일 09:00 KST에 돌아 Mattermost에 한 건을 올린다. 표준 라이브러리와 openssl 명령만 쓴다.

항목: 디스크·메모리·스왑, CPU 24시간 평균(40% 기준선 대비), 백업 나이, 마지막 배포, 인증서 잔여일, 5xx 건수, 배치 결과, 지금 울리는 알림.
알림이 한 번 놓쳐져도(알림 채널 중단) 하루에 한 번은 상태를 본다. Prometheus에 닿지 못해도 그 사실을 올리고 종료 코드 1로 끝난다.

  python3 infra/obs/daily-digest.py [--dry-run]
옵션(기본값은 서버의 경로다. 시험이 바꾼다): --prom URL(http://127.0.0.1:9090) --state-dir(/srv/fit/state) --obs-env(/etc/fit/obs.env, 웹훅 주소를 읽는다)
  --edge-env(/etc/fit/edge.env, PROD_HOST와 DEV_HOST만 읽는다) --tls-connect 주소(127.0.0.1, 인증서를 읽을 곳) --dry-run(올리지 않고 출력만 한다)
웹훅 주소와 비밀 값은 출력하지 않는다.
"""
from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import re
import subprocess
import sys
import urllib.parse
import urllib.request

OK, WARN, NONE = "✅", "⚠️", "❔"
KST = datetime.timezone(datetime.timedelta(hours=9))


def read_env(path: str, keys: set[str]) -> dict[str, str]:
    """KEY=VALUE 파일에서 지정한 키만 읽는다(값을 쓰지 않는 다른 키는 메모리에도 담지 않는다)."""
    found: dict[str, str] = {}
    p = pathlib.Path(path)
    if not p.is_file():
        return found
    for line in p.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and key in keys:
            found[key] = value
    return found


class Prom:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")

    def query(self, expr: str) -> list[tuple[dict[str, str], float]]:
        url = f"{self.base}/api/v1/query?query={urllib.parse.quote(expr)}"
        with urllib.request.urlopen(url, timeout=15) as resp:
            body = json.load(resp)
        if body.get("status") != "success":
            raise RuntimeError(f"Prometheus가 질의를 거부했다: {expr}")
        return [(r["metric"], float(r["value"][1])) for r in body["data"]["result"]]

    def scalar(self, expr: str) -> float | None:
        rows = self.query(expr)
        return rows[0][1] if rows else None


def human_age(seconds: float) -> str:
    seconds = max(0, int(seconds))
    if seconds < 3600:
        return f"{seconds // 60}분 전"
    if seconds < 86400:
        return f"{seconds // 3600}시간 {seconds % 3600 // 60}분 전"
    return f"{seconds // 86400}일 {seconds % 86400 // 3600}시간 전"


def pct(value: float) -> str:
    return f"{value * 100:.0f}%"


def host_rows(prom: Prom) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    fs = '{mountpoint="/", fstype!~"tmpfs|overlay"}'
    disk = prom.scalar(f"1 - node_filesystem_avail_bytes{fs} / node_filesystem_size_bytes{fs}")
    rows.append(("디스크(/)", f"{pct(disk)} 사용 (경고 80%)", OK if disk < 0.8 else WARN) if disk is not None else ("디스크(/)", "지표 없음", NONE))
    mem = prom.scalar("node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes")
    rows.append(("메모리", f"가용 {pct(mem)} (경고 8% 미만)", OK if mem >= 0.08 else WARN) if mem is not None else ("메모리", "지표 없음", NONE))
    swap_total = prom.scalar("node_memory_SwapTotal_bytes")
    if swap_total is None:
        rows.append(("스왑", "지표 없음", NONE))
    elif swap_total == 0:
        rows.append(("스왑", "스왑이 없다", OK))
    else:
        swap = prom.scalar("1 - node_memory_SwapFree_bytes / node_memory_SwapTotal_bytes")
        rows.append(("스왑", f"{pct(swap)} 사용 (경고 50%)", OK if swap <= 0.5 else WARN) if swap is not None else ("스왑", "지표 없음", NONE))
    cpu = prom.scalar('1 - avg(rate(node_cpu_seconds_total{mode="idle"}[24h]))')
    rows.append(("CPU 24시간 평균", f"{pct(cpu)} (기준선 40%)", OK if cpu <= 0.4 else WARN) if cpu is not None else ("CPU 24시간 평균", "지표 없음", NONE))
    return rows


def backup_rows(prom: Prom) -> list[tuple[str, str, str]]:
    limits = {"pg": 8 * 3600, "photos": 36 * 3600, "caddy": 9 * 86400}
    rows: list[tuple[str, str, str]] = []
    ages = {m["kind"]: v for m, v in prom.query("time() - fit_backup_last_success_timestamp_seconds")}
    for kind, limit in limits.items():
        if kind in ages:
            rows.append((f"백업 {kind}", f"마지막 성공 {human_age(ages[kind])} (경고 {human_age(limit).replace(' 전', '')} 초과)", OK if ages[kind] <= limit else WARN))
        else:
            rows.append((f"백업 {kind}", "지표 없음", NONE))
    verify = prom.scalar("fit_backup_last_verify_ok")
    rows.append(("백업 복원 검증", "마지막 검증 통과" if verify == 1 else "마지막 검증 실패", OK if verify == 1 else WARN) if verify is not None else ("백업 복원 검증", "지표 없음", NONE))
    return rows


def deploy_rows(state_dir: str) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for env in ("prod", "dev"):
        log = pathlib.Path(state_dir) / f"history-{env}.log"
        last = ""
        if log.is_file():
            for line in log.read_text(encoding="utf-8").splitlines():
                parts = line.split()
                if len(parts) >= 5 and parts[1] in ("deploy-end", "rollback"):
                    last = line
        if not last:
            rows.append((f"마지막 배포({env})", "기록 없음", NONE))
            continue
        ts, action, _svc, sha, result = last.split()[:5]
        who = last.split()[5] if len(last.split()) > 5 else "?"
        when = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).astimezone(KST)
        what = "배포" if action == "deploy-end" else "롤백"
        rows.append((f"마지막 배포({env})", f"{when:%m-%d %H:%M} KST {what} {result} {sha[:12]} ({who})", OK if result.startswith("ok") or action == "rollback" else WARN))
    return rows


def cert_days(host: str, connect: str) -> float:
    """host의 인증서 만료까지 남은 일수. 서버 자신(connect)의 443에서 SNI로 읽는다."""
    s_client = subprocess.run(
        ["openssl", "s_client", "-connect", f"{connect}:443", "-servername", host],
        input=b"", capture_output=True, timeout=20, check=True,
    )
    end = subprocess.run(["openssl", "x509", "-noout", "-enddate"], input=s_client.stdout, capture_output=True, timeout=10, check=True)
    text = end.stdout.decode().strip().removeprefix("notAfter=")
    expires = datetime.datetime.strptime(text, "%b %d %H:%M:%S %Y GMT").replace(tzinfo=datetime.timezone.utc)
    return (expires - datetime.datetime.now(datetime.timezone.utc)).total_seconds() / 86400


def cert_rows(hosts: list[tuple[str, str]], connect: str) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for label, host in hosts:
        try:
            days = cert_days(host, connect)
        except (OSError, subprocess.SubprocessError, ValueError):
            rows.append((f"인증서({label})", "읽지 못했다", WARN))
            continue
        rows.append((f"인증서({label})", f"만료까지 {days:.0f}일 (경고 14일)", OK if days >= 14 else WARN))
    return rows


def app_rows(prom: Prom) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    n5xx = prom.scalar('sum(increase(http_server_requests_seconds_count{env="prod", status=~"5.."}[24h]))')
    total = prom.scalar('sum(increase(http_server_requests_seconds_count{env="prod"}[24h]))')
    if total is None:
        rows.append(("5xx(24시간)", "지표 없음", NONE))
    else:
        count = n5xx or 0
        rows.append(("5xx(24시간)", f"{count:.0f}건 / 전체 {total:.0f}건", OK if count == 0 else WARN))
    age = prom.scalar('time() - max(batch_last_success_timestamp_seconds{env="prod"})')
    rows.append(("새벽 배치", f"마지막 성공 {human_age(age)} (경고 26시간 초과)", OK if age <= 26 * 3600 else WARN) if age is not None else ("새벽 배치", "지표 없음", NONE))
    return rows


def alert_rows(prom: Prom) -> list[tuple[str, str, str]]:
    firing = sorted({m["alertname"] for m, _ in prom.query('ALERTS{alertstate="firing"}')})
    if not firing:
        return [("지금 울리는 알림", "없음", OK)]
    return [("지금 울리는 알림", f"{len(firing)}종: " + ", ".join(firing), WARN)]


def render(now: datetime.datetime, rows: list[tuple[str, str, str]], notes: list[str]) -> str:
    lines = [f"#### Fit Dining 일일 점검 ({now.astimezone(KST):%Y-%m-%d %H:%M} KST)", "", "| 항목 | 상태 | 값 |", "|---|---|---|"]
    lines += [f"| {name} | {mark} | {value} |" for name, value, mark in rows]
    warn = sum(1 for r in rows if r[2] == WARN)
    lines += ["", f"주의 {warn}건." if warn else "모든 항목이 정상 범위다."]
    lines += notes
    return "\n".join(lines)


def post(url: str, text: str) -> None:
    data = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        if resp.status >= 300:
            raise RuntimeError(f"웹훅이 {resp.status}를 돌려줬다")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prom", default="http://127.0.0.1:9090")
    ap.add_argument("--state-dir", default="/srv/fit/state")
    ap.add_argument("--obs-env", default="/etc/fit/obs.env")
    ap.add_argument("--edge-env", default="/etc/fit/edge.env")
    ap.add_argument("--tls-connect", default="127.0.0.1")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    webhook = read_env(args.obs_env, {"MATTERMOST_WEBHOOK_URL"}).get("MATTERMOST_WEBHOOK_URL", "")
    if not args.dry_run and not re.match(r"^https?://\S+$", webhook):
        print(f"FAIL {args.obs_env}에서 MATTERMOST_WEBHOOK_URL을 읽지 못했다", file=sys.stderr)
        return 1
    hosts_env = read_env(args.edge_env, {"PROD_HOST", "DEV_HOST"})
    hosts = [(label, hosts_env[key]) for label, key in (("prod", "PROD_HOST"), ("dev", "DEV_HOST")) if hosts_env.get(key)]

    now = datetime.datetime.now(datetime.timezone.utc)
    rows: list[tuple[str, str, str]] = []
    notes: list[str] = []
    status = 0
    prom = Prom(args.prom)
    try:
        rows += host_rows(prom)
        rows += backup_rows(prom)
        rows += app_rows(prom)
        rows += alert_rows(prom)
    except (OSError, RuntimeError, KeyError, ValueError) as e:
        notes.append(f"Prometheus에서 값을 읽지 못했다({type(e).__name__}). 관측 스택을 먼저 본다(bash infra/obs/verify-obs.sh).")
        status = 1
    rows += deploy_rows(args.state_dir)
    rows += cert_rows(hosts, args.tls_connect)
    text = render(now, rows, notes)
    print(text)
    if args.dry_run:
        return status
    try:
        post(webhook, text)
    except (OSError, RuntimeError) as e:
        print(f"FAIL 웹훅으로 보내지 못했다({type(e).__name__})", file=sys.stderr)
        return 1
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
````

- [ ] **Step 2: 설치 스크립트와 유닛 작성**

`infra/obs/install.sh`:

````bash
#!/usr/bin/env bash
# 서버 A에 관측 구성을 설치한다. 몇 번 실행해도 같은 결과다(멱등). root로 실행한다.
#   sudo bash infra/obs/install.sh
# 하는 일: 일일 점검 요약 스크립트의 root 소유 사본, obs.env(없으면 예제에서), 요약 타이머(매일 09:00 KST).
# 타이머가 도는 코드는 저장소 체크아웃이 아니라 root만 쓸 수 있는 사본($FIT_OBS_ROOT, 기본 /usr/local/lib/fit/obs)이다(infra/backup/install.sh와 같은 이유).
# 관측 스택(prometheus 등)은 이 스크립트가 올리지 않는다. obs.env를 채우면 `bash infra/deploy/fit-up.sh`가 올린다.
# 타이머는 obs.env의 MATTERMOST_WEBHOOK_URL이 채워진 뒤에 켠다. 채우기 전에 실행했다면 채운 뒤 이 스크립트를 다시 실행한다.
# 환경변수(선택): FIT_SKIP(쉼표로 구분, 시험용) apt, systemd. FIT_OBS_ROOT, FIT_SYSTEMD_DIR(/etc/systemd/system), FIT_ENV_DIR(/etc/fit)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SKIP=",${FIT_SKIP:-},"
OBS_ROOT="${FIT_OBS_ROOT:-/usr/local/lib/fit/obs}"
SYSTEMD_DIR="${FIT_SYSTEMD_DIR:-/etc/systemd/system}"
ENV_DIR="${FIT_ENV_DIR:-/etc/fit}"
UNITS=(fit-daily-digest.service fit-daily-digest.timer)
CHANGES=0
PUT=0

step() { printf '\n== %s\n' "$*"; }
log() { printf '%s\n' "$*"; }
die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
skipped() { case "$SKIP" in *",$1,"*) log "건너뜀($1)"; return 0 ;; esac; return 1; }
changed() { CHANGES=$((CHANGES + 1)); log "변경: $*"; }

# put_file 원본 대상 모드: 내용, 모드, 소유자 중 하나라도 다르면 설치하고 PUT=1로 둔다
put_file() {
  local src="$1" dst="$2" mode="$3"
  PUT=0
  if [ -f "$dst" ] && cmp -s "$src" "$dst" && [ "$(stat -c %a "$dst")" = "$mode" ] && [ "$(stat -c %U:%G "$dst")" = root:root ]; then
    return 0
  fi
  install -D -m "$mode" -o root -g root "$src" "$dst"
  PUT=1
  changed "$dst"
}
ensure_dir() { # ensure_dir 경로 모드
  if [ -d "$1" ] && [ "$(stat -c %a "$1")" = "$2" ] && [ "$(stat -c %U:%G "$1")" = root:root ]; then return 0; fi
  install -d -m "$2" -o root -g root "$1"
  changed "디렉터리 $1"
}

[ "$(id -u)" = 0 ] || die "root로 실행한다(sudo)"
for f in "$REPO/infra/obs/daily-digest.py" "$REPO/infra/obs/obs.env.example" "$HERE/conf/systemd/${UNITS[0]}"; do
  [ -e "$f" ] || die "저장소 구조가 맞지 않는다: $f"
done

step "패키지"
if skipped apt; then :
elif command -v python3 >/dev/null 2>&1 && command -v openssl >/dev/null 2>&1; then log "필요한 패키지가 이미 있다"
else
  apt-get -o Acquire::Retries=3 update -qq
  DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y -qq python3 openssl >/dev/null
  changed "패키지 python3 openssl"
fi

step "코드 사본 $OBS_ROOT"
ensure_dir "$OBS_ROOT" 755
put_file "$REPO/infra/obs/daily-digest.py" "$OBS_ROOT/daily-digest.py" 755

step "설정"
if [ ! -e "$ENV_DIR/obs.env" ]; then
  # 배포 러너(docker 그룹)가 fit-up.sh로 compose에 --env-file로 넘긴다. 다른 사용자는 읽지 못한다
  install -D -m 640 -o root -g docker "$REPO/infra/obs/obs.env.example" "$ENV_DIR/obs.env"
  changed "$ENV_DIR/obs.env(예제에서 만들었다. 값을 채운다)"
fi
READY=0
if hook="$(grep -E '^MATTERMOST_WEBHOOK_URL=' "$ENV_DIR/obs.env" | head -n 1 | cut -d= -f2-)" && [ -n "$hook" ] && [ "${hook#*REPLACE_ME}" = "$hook" ]; then READY=1; fi

step "systemd 유닛"
any=0
for f in "${UNITS[@]}"; do
  put_file "$HERE/conf/systemd/$f" "$SYSTEMD_DIR/$f" 644
  [ "$PUT" = 0 ] || any=1
done
if [ "$READY" = 0 ]; then log "타이머는 켜지 않았다(obs.env의 MATTERMOST_WEBHOOK_URL이 아직 비어 있다)"; fi
if ! skipped systemd; then
  if [ "$any" = 1 ]; then systemctl daemon-reload; fi
  if [ "$READY" = 1 ]; then
    for f in "${UNITS[@]}"; do
      case "$f" in *.timer) systemctl enable --now "$f" >/dev/null 2>&1 ;; esac
    done
  fi
fi

step "남은 수동 단계"
if [ "$READY" = 0 ]; then log "1. $ENV_DIR/obs.env 의 값을 채운 뒤 이 스크립트를 다시 실행해 요약 타이머를 켠다"; fi
log "2. 관측 스택을 올린다: bash infra/deploy/fit-up.sh"
log "3. 점검한다: bash infra/obs/verify-obs.sh"
log "4. 요약을 지금 한 번 보내 본다: sudo python3 $OBS_ROOT/daily-digest.py --dry-run (출력만) 또는 sudo systemctl start fit-daily-digest.service"
log "변경 $CHANGES건"
````

`infra/obs/conf/systemd/fit-daily-digest.service`:

````ini
[Unit]
Description=Daily check digest to Mattermost (fit)
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /usr/local/lib/fit/obs/daily-digest.py
TimeoutStartSec=120
Nice=10
````

`infra/obs/conf/systemd/fit-daily-digest.timer`:

````ini
[Unit]
Description=Daily check digest at 09:00 KST (fit)

[Timer]
# 서버의 시간대는 Asia/Seoul이다(설계 10.1절)
OnCalendar=*-*-* 09:00:00
Persistent=true

[Install]
WantedBy=timers.target
````

- [ ] **Step 3: shellcheck와 입력 검증 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
chmod +x infra/obs/verify-obs.sh infra/obs/install.sh infra/obs/daily-digest.py
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/obs/verify-obs.sh infra/obs/install.sh; echo "shellcheck exit=$?"
python -m py_compile infra/obs/daily-digest.py && echo "digest compile OK"
python infra/obs/daily-digest.py --dry-run --prom http://127.0.0.1:9 --state-dir /nonexistent --edge-env /nonexistent; echo "exit=$?"
python infra/obs/daily-digest.py --obs-env /nonexistent; echo "exit=$?"
FIT_OBS_PROJECT=no-such-project bash infra/obs/verify-obs.sh | tail -3; echo "exit=${PIPESTATUS[0]}"
bash infra/obs/install.sh; echo "exit=$?"
find infra -name __pycache__ -prune -exec rm -rf {} +
```

Expected: `shellcheck exit=0`, `digest compile OK`. Prometheus 없이 `--dry-run`은 `Prometheus에서 값을 읽지 못했다` 문장과 `기록 없음`·`인증서` 행이 든 표를 출력하고 `exit=1`이다. 웹훅이 없으면 `FAIL …MATTERMOST_WEBHOOK_URL을 읽지 못했다`와 `exit=1`(값을 출력하지 않는다). 스택이 없는 `verify-obs.sh`는 `FAIL` 줄들과 `개 점검 실패`를 내고 `exit=1`이다. root가 아니면 `install.sh`는 `FAIL root로 실행한다(sudo)`와 `exit=1`이다. 실제 동작은 Task 4의 시험이 확인한다.

- [ ] **Step 4: 커밋 (허용된 경우)**

```bash
git add infra/obs/verify-obs.sh infra/obs/daily-digest.py infra/obs/install.sh infra/obs/conf
git update-index --chmod=+x infra/obs/verify-obs.sh infra/obs/install.sh infra/obs/daily-digest.py
git commit -m "feat(infra): A 점검 스크립트, 일일 점검 요약, 설치 스크립트와 systemd 타이머 추가"
```

---

### Task 4: A 관측 시험

**목표:** 서버 없이 실제 Prometheus·Alertmanager·Grafana·node-exporter·cAdvisor·blackbox·두 exporter·Dozzle을 띄우고, 실제 Postgres·OpenSearch(데이터 시험 환경), 가짜 BE·Caddy·B, 웹훅 대역, TLS 서버로 수집, 규칙, 알림 도착, 대시보드, 일일 요약, 설치를 확인한다.

**Files:**
- Create: `infra/obs/test/compose.test.yml`, `infra/obs/test/mock-exporter.py`, `infra/obs/test/webhook-sink.py`, `infra/obs/test/tls-sim.py`, `infra/obs/test/test-obs.sh`

**Interfaces:**
- Consumes: Task 2·3의 스택과 스크립트, 1D의 `test-data.sh`(데이터 시험 환경을 띄운다. OpenSearch 포함, 접두사 `fit-datatest-`)
- Produces: `bash infra/obs/test/test-obs.sh up|run [구역...]|down`. 구역: `stack init scrape rules alert grafana digest install hygiene`. 시험 사본은 알림 규칙의 `for`를 0s로, Alertmanager의 그룹 대기·간격과 반복 간격을 짧게 바꾼다(식과 라우팅은 같다). 시험용 값(웹훅 토큰, 비밀번호)은 매번 무작위다. 시험 프로젝트 이름은 `fit-obstest`다

시나리오(구역):

- `stack`: `verify-obs.sh`가 모두 통과한다. 호스트 게시 포트는 127.0.0.1의 prometheus·grafana·dozzle 셋뿐이고 메모리 한도가 설계대로이며 Prometheus 보존이 7일·5GB이고 관리 API가 꺼져 있다.
- `init`: `obs-init`이 올바른 값으로 파일을 만들고 값을 출력하지 않으며 누락·자리표시자·형식 오류를 거부한다. 네트워크 없이 읽기 전용으로 돈다.
- `scrape`: 모든 수집 대상(prometheus, alertmanager, node, cadvisor, caddy, postgres, opensearch, blackbox, vault-ssh)이 up이고 BE 세 색이 `env`·`color` 라벨과 함께 보이며 cAdvisor가 컨테이너 메모리 한도를 내고 postgres·OpenSearch exporter가 값을 낸다.
- `rules`: 알림 규칙 35개와 기록 규칙이 오류 없이 평가된다.
- `alert`: 가짜 BE를 내리면 `FitBeProdDown`이 main 수신자에, dev BE는 dev 수신자에 Slack 형식(제목·본문·색·런북)으로 도착하고 복구되면 `[RESOLVED]`가 온다. 백업 지표 파일의 값을 바꾸면 알림이 오고, 지표가 사라지면 `absent()` 알림이 온다.
- `grafana`: 데이터소스가 정상이고 대시보드 3개가 프로비저닝되며 익명 접근이 없고 대시보드의 모든 쿼리가 Prometheus에서 성공한다.
- `digest`: 일일 요약이 모든 행(디스크·메모리·스왑·CPU·백업·5xx·배치·알림·배포·인증서)을 내고 인증서 잔여일(40일 정상, 5일 주의)을 읽으며 비밀을 출력하지 않는다. 올리면 웹훅 대역에 도착하고 Prometheus나 웹훅이 안 되면 종료 코드 1이다.
- `install`: 컨테이너 안에서 `install.sh`가 파일 모드·소유자를 맞추고 두 번째 실행은 변경이 0건이며, 손으로 고친 사본을 되돌리고 root가 아니면 거부한다. 유닛 문법은 `systemd-analyze`로 본다.
- `hygiene`: 어느 컨테이너 로그에도 비밀 값이 없고 Prometheus 설정 API에 웹훅 주소가 없다.

- [ ] **Step 1: 시험 환경과 대역 작성**

`infra/obs/test/compose.test.yml`: 호스트 포트를 시험용으로 바꾸고 규칙과 Alertmanager 설정은 시험 사본을 쓴다.

````yaml
# 시험용 덮어쓰기(infra/obs/test/test-obs.sh). 호스트 포트를 시험용으로 바꾸고, 알림 규칙과 Alertmanager 설정은 시험 사본을 쓴다.
# 사본은 저장소 파일에서 sed로 만든다: 규칙의 for를 0s로(대기 시간 없이 바로 울리게), group_wait·group_interval을 짧게. 그 밖의 식과 라우팅은 같다.
# textfile 지표 디렉터리도 시험 디렉터리다. FIT_OBSTEST_DIR은 시험 스크립트가 정한다.
services:
  prometheus:
    ports: !override
      - 127.0.0.1:${FIT_OBSTEST_PROM_PORT:-19090}:9090
    volumes: !override
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ${FIT_OBSTEST_DIR}/rules:/etc/prometheus/rules:ro
      - generated:/generated:ro
      - promdata:/prometheus

  alertmanager:
    volumes: !override
      - ${FIT_OBSTEST_DIR}/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
      - ./alertmanager/templates:/etc/alertmanager/templates:ro
      - generated:/generated:ro
      - amdata:/alertmanager

  grafana:
    ports: !override
      - 127.0.0.1:${FIT_OBSTEST_GRAFANA_PORT:-13000}:3000

  node-exporter:
    volumes: !override
      - /:/host:ro
      - ${FIT_OBSTEST_DIR}/textfile:/textfile:ro

  dozzle:
    ports: !override
      - 127.0.0.1:${FIT_OBSTEST_DOZZLE_PORT:-18888}:8080
````

`infra/obs/test/mock-exporter.py`(가짜 BE·Caddy 지표):

````python
"""시험용 가짜 지표 서버(infra/obs/test, infra/ops/test). 디렉터리 안의 파일을 Prometheus 지표 형식으로 내준다.
시험이 파일을 바꾸면 다음 수집부터 값이 바뀐다. 파일이 없으면 404라 수집이 실패(up=0)한다.
예: BE 흉내는 <dir>/actuator/prometheus, Caddy 흉내는 <dir>/metrics.

사용: python mock-exporter.py <포트> <디렉터리>
"""
import pathlib
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

port, root = int(sys.argv[1]), pathlib.Path(sys.argv[2])


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        f = (root / self.path.split("?")[0].lstrip("/")).resolve()
        if root.resolve() not in f.parents or not f.is_file():
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        data = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass


HTTPServer(("0.0.0.0", port), Handler).serve_forever()
````

`infra/obs/test/webhook-sink.py`(Mattermost 웹훅 대역):

````python
"""시험용 Mattermost 웹훅 대역(infra/obs/test, infra/ops/test). 0.0.0.0에서 POST를 받고 요청마다 {"path": ..., "body": ...}를 한 줄씩 적는다.
Alertmanager가 보내는 Slack 형식 JSON을 그대로 body 문자열에 담는다(경로로 수신자 main(/hook)과 dev(/hook-dev)를 구분한다).

사용: python webhook-sink.py <포트> <출력 파일>
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

port, out = int(sys.argv[1]), sys.argv[2]


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8", errors="replace")
        with open(out, "a", encoding="utf-8") as f:
            f.write(json.dumps({"path": self.path, "body": body}, ensure_ascii=False) + "\n")
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, fmt, *args):
        pass


HTTPServer(("0.0.0.0", port), Handler).serve_forever()
````

`infra/obs/test/tls-sim.py`(인증서 잔여일 시험용 TLS 서버):

````python
"""시험용 TLS 서버(infra/obs/test). 주어진 인증서로 핸드셰이크만 받고 닫는다. 일일 점검 요약의 인증서 잔여일 읽기를 시험하려는 것이다.

사용: python tls-sim.py <포트> <인증서 PEM> <개인키 PEM>
"""
import socket
import ssl
import sys
import threading

port, cert, key = int(sys.argv[1]), sys.argv[2], sys.argv[3]
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(cert, key)


def handle(conn):
    try:
        with ctx.wrap_socket(conn, server_side=True) as tls:
            tls.recv(1)
    except (OSError, ssl.SSLError):
        pass


srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("0.0.0.0", port))
srv.listen(16)
while True:
    conn, _ = srv.accept()
    threading.Thread(target=handle, args=(conn,), daemon=True).start()
````

- [ ] **Step 2: 시험 스크립트 작성**

`infra/obs/test/test-obs.sh`:

````bash
#!/usr/bin/env bash
# 서버 A의 관측 스택을 노트북에서 시험한다(설계 10.5절). 실제 Prometheus, Alertmanager, Grafana, node-exporter, cAdvisor, blackbox, 두 exporter, Dozzle을 띄우고
# 실제 Postgres·OpenSearch(데이터 시험 환경), 가짜 BE·Caddy·B(지표와 포트만 흉내)와 웹훅 대역으로 알림이 Mattermost 형식으로 도착하는 데까지 확인한다.
#   bash infra/obs/test/test-obs.sh up [구역...]   # 데이터 스택(OpenSearch 포함), 가짜 대상, 관측 스택을 띄운다
#   bash infra/obs/test/test-obs.sh run [구역...]  # 시나리오를 돌린다. 구역: stack init scrape rules alert grafana digest install hygiene
#   bash infra/obs/test/test-obs.sh down           # 시험이 만든 것을 모두 지운다
# 필요한 것: docker compose(2.24 이상), python 3.9 이상. 데이터 스택 시험(infra/data/test/test-data.sh)의 망과 DB를 그대로 쓴다.
# 시험용 사본: 규칙의 for는 0s로, Alertmanager의 group_wait·group_interval은 짧게 바꾼다(식과 라우팅은 같다). 시험용 값은 매번 무작위다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
# Windows의 파이썬은 콘솔 코드 페이지(cp949)로 출력해 한글이 깨지므로 UTF-8로 고정한다
export PYTHONUTF8=1
W="$(pwd -W 2>/dev/null || pwd)"
T="$W/.tmp-obstest"
PROJECT=fit-obstest
# shellcheck source=infra/ci/tool-images.sh
. infra/ci/tool-images.sh
# shellcheck source=infra/deploy/lib.sh
. infra/deploy/lib.sh

# 데이터 스택 시험의 이름(접두사 fit-datatest)을 그대로 쓴다
export FIT_ENV_DIR="$W/.tmp-datatest/etc" FIT_DATA_ENV="$W/.tmp-datatest/etc/data.env" FIT_DATA_PROJECT=fit-datatest
export FIT_NET_PREFIX=fit-datatest- FIT_NET_DATA=fit-datatest-net-data FIT_NET_EDGE=fit-datatest-net-edge FIT_NET_DBACCESS=fit-datatest-net-dbaccess
export FIT_NET_OBS=fit-datatest-net-obs FIT_NET_PROD=fit-datatest-net-prod FIT_NET_DEV=fit-datatest-net-dev
export FIT_OBSTEST_DIR="$T"

dc() { docker compose -p "$PROJECT" -f "$W/infra/obs/compose.obs.yml" -f "$W/infra/obs/test/compose.test.yml" --env-file "$T/obs.env" "$@"; }
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
PY="$(find_python)"

# 가짜 대상: 이름은 망의 별칭이다(컨테이너 이름은 시험 접두사라 다른 시험과 겹치지 않는다)
sidecar() { # sidecar 이름 망 별칭 [docker run 인자...] -- 명령...
  local name="$1" net="$2" alias="$3"
  shift 3
  docker run -d --name "$PROJECT-$name" --network "$net" --network-alias "$alias" "$@" >/dev/null
}
be_metrics() { # be_metrics 디렉터리: 가짜 BE가 내는 지표 파일(정상 값)
  mkdir -p "$T/$1/actuator"
  printf 'http_server_requests_seconds_count{status="200",uri="/api/v1/x",method="GET"} 100\nbatch_last_success_timestamp_seconds %s\nmodal_daily_budget_used_ratio 0.1\n' "$(date +%s)" >"$T/$1/actuator/prometheus"
}
mock_be() { # mock_be 이름 망 별칭 디렉터리
  be_metrics "$4"
  sidecar "$1" "$2" "$3" -v "$W/infra/obs/test/mock-exporter.py:/mock.py:ro" -v "$T/$4:/srv:ro" "$PYTHON_IMAGE" python /mock.py 8081 /srv
}

up() {
  down >/dev/null 2>&1 || true
  mkdir -p "$T/textfile" "$T/rules" "$T/caddy"
  FIT_TEST_OPENSEARCH=1 bash infra/data/test/test-data.sh up
  bash infra/data/init-data.sh
  local token_main token_dev
  token_main="$(hex 12)"
  token_dev="$(hex 12)"
  printf 'webhook-main=%s\nwebhook-dev=%s\n' "$token_main" "$token_dev" >"$T/tokens"
  {
    echo "GRAFANA_ADMIN_PASSWORD=$(hex 12)"
    echo "MATTERMOST_WEBHOOK_URL=http://webhook-sink:18099/hook/$token_main"
    echo "MATTERMOST_WEBHOOK_URL_DEV=http://webhook-sink:18099/hook-dev/$token_dev"
    echo "B_IP=b-sim"
    sed -n 's/^FIT_MONITOR_PASSWORD=/FIT_MONITOR_PASSWORD=/p' "$FIT_DATA_ENV"
  } >"$T/obs.env"
  # 시험 사본: for를 0s로, Alertmanager 대기를 짧게
  for f in infra/obs/prometheus/rules/*.yml; do sed 's/^\( *\)for: .*/\1for: 0s/' "$f" >"$T/rules/$(basename "$f")"; done
  sed -e 's/group_wait: .*/group_wait: 1s/' -e 's/group_interval: .*/group_interval: 5s/' infra/obs/alertmanager/alertmanager.yml >"$T/alertmanager.yml"
  # 지표 fixture: 백업은 정상 값으로 시작한다
  now="$(date +%s)"
  printf 'fit_backup_last_success_timestamp_seconds{kind="pg"} %s\nfit_backup_last_success_timestamp_seconds{kind="photos"} %s\nfit_backup_last_success_timestamp_seconds{kind="caddy"} %s\nfit_backup_last_verify_ok 1\nfit_backup_last_verify_timestamp_seconds %s\nfit_backup_last_push_timestamp_seconds %s\nfit_backup_outbox_files 0\n' "$now" "$now" "$now" "$now" "$now" >"$T/textfile/fit_backup.prom"
  printf 'caddy_http_requests_total 1\n' >"$T/caddy/metrics"
  mock_be be-prod-blue "$FIT_NET_PROD" be-prod-blue be-prod-blue
  mock_be be-prod-green "$FIT_NET_PROD" be-prod-green be-prod-green
  mock_be be-dev "$FIT_NET_DEV" be-dev be-dev
  sidecar caddy "$FIT_NET_OBS" caddy -v "$W/infra/obs/test/mock-exporter.py:/mock.py:ro" -v "$T/caddy:/srv:ro" "$PYTHON_IMAGE" python /mock.py 9180 /srv
  sidecar webhook-sink "$FIT_NET_OBS" webhook-sink -v "$W/infra/obs/test/webhook-sink.py:/sink.py:ro" -v "$T:/out" "$PYTHON_IMAGE" python /sink.py 18099 /out/sink.log
  sidecar b-sim "$FIT_NET_OBS" b-sim "$PYTHON_IMAGE" python -c "import socketserver as s; s.ThreadingTCPServer.allow_reuse_address=True; s.ThreadingTCPServer(('0.0.0.0',22), type('H',(s.BaseRequestHandler,),{'handle':lambda self:None})).serve_forever()"
  # 일일 점검 요약 시험용: 인증서 잔여일을 읽을 TLS 서버 둘(40일, 5일). 호스트의 openssl로 자체 서명 인증서를 만든다
  mkdir -p "$T/tls"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$T/tls/key.pem" -out "$T/tls/cert40.pem" -days 40 -subj /CN=a.test >/dev/null 2>&1
  openssl req -new -x509 -key "$T/tls/key.pem" -out "$T/tls/cert5.pem" -days 5 -subj /CN=a.test >/dev/null 2>&1
  sidecar tls-sim "$FIT_NET_OBS" tls-sim -v "$W/infra/obs/test/tls-sim.py:/tls.py:ro" -v "$T/tls:/tls:ro" "$PYTHON_IMAGE" python /tls.py 443 /tls/cert40.pem /tls/key.pem
  sidecar tls-sim-short "$FIT_NET_OBS" tls-sim-short -v "$W/infra/obs/test/tls-sim.py:/tls.py:ro" -v "$T/tls:/tls:ro" "$PYTHON_IMAGE" python /tls.py 443 /tls/cert5.pem /tls/key.pem
  : >"$T/sink.log"
  dc up -d --wait --wait-timeout 300
  echo "관측 시험 환경이 떴다(프로젝트 $PROJECT)"
}

down() {
  dc down -v --remove-orphans >/dev/null 2>&1 || docker compose -p "$PROJECT" down -v --remove-orphans >/dev/null 2>&1 || true
  local c
  docker rm -f "$PROJECT-host" >/dev/null 2>&1 || true
  for c in be-prod-blue be-prod-green be-dev caddy webhook-sink b-sim tls-sim tls-sim-short; do docker rm -f "$PROJECT-$c" >/dev/null 2>&1 || true; done
  bash infra/data/test/test-data.sh down >/dev/null 2>&1 || true
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
out=""
rc=0

cid() { docker ps -a -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n 1; }
# 서비스 컨테이너 안에서 URL을 읽는다(호스트 포트 포워더에 기대지 않는다)
inside() { docker exec "$(cid "$1")" wget -qO- "$2" 2>/dev/null; }
urlenc() { "$PY" -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1"; }
prom() { inside prometheus "http://localhost:9090/api/v1/query?query=$(urlenc "$1")"; }
# 질의 결과의 첫 값(없으면 빈 문자열)
pval() { prom "$1" | "$PY" -c 'import json,sys; r=json.load(sys.stdin)["data"]["result"]; print(r[0]["value"][1] if r else "")' 2>/dev/null || true; }
pcount() { prom "$1" | "$PY" -c 'import json,sys; print(len(json.load(sys.stdin)["data"]["result"]))' 2>/dev/null || echo 0; }
wait_for() { # wait_for 제한초 명령... : 명령이 성공할 때까지 기다린다
  local limit=$(($(date +%s) + $1)) _
  shift
  until "$@" >/dev/null 2>&1; do
    [ "$(date +%s)" -lt "$limit" ] || return 1
    sleep 3
  done
}
# 웹훅 대역이 받은 메시지 수: sink_count 경로접두사 포함할문자열
sink_count() {
  "$PY" - "$T/sink.log" "$1" "$2" <<'PYEOF'
import json, sys
path, prefix, needle = sys.argv[1:4]
n = 0
for line in open(path, encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    rec = json.loads(line)
    if rec["path"].startswith(prefix) and needle in rec["body"]:
        n += 1
print(n)
PYEOF
}
sink_has() { [ "$(sink_count "$1" "$2")" -ge 1 ]; }
sink_body() { # sink_body 경로접두사 포함할문자열: 마지막으로 받은 메시지의 body
  "$PY" - "$T/sink.log" "$1" "$2" <<'PYEOF'
import json, sys
path, prefix, needle = sys.argv[1:4]
last = ""
for line in open(path, encoding="utf-8"):
    line = line.strip()
    if line:
        rec = json.loads(line)
        if rec["path"].startswith(prefix) and needle in rec["body"]:
            last = rec["body"]
print(last)
PYEOF
}

run_stack_checks() {
  echo "--- 구성"
  out="$(FIT_OBS_PROJECT=$PROJECT bash infra/obs/verify-obs.sh 2>&1)" && rc=0 || rc=$?
  ok_if "verify-obs.sh가 모두 통과한다" "$(is "$rc" 0)"
  local ports
  ports="$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}} {{.Ports}}' | tr -d '\r')"
  ok_if "호스트에 게시한 포트는 prometheus, grafana, dozzle의 127.0.0.1뿐이다" \
    "$([ "$(grep -c '127.0.0.1:' <<<"$ports")" = 3 ] && [ "$(grep -c '0.0.0.0:' <<<"$ports")" = 0 ] && echo 1 || echo 0)"
  ok_if "alertmanager, exporter, cadvisor는 호스트에 게시하지 않는다" \
    "$([ "$(grep -E 'alertmanager|exporter|cadvisor|blackbox' <<<"$ports" | grep -c -- '->')" = 0 ] && echo 1 || echo 0)"
  local svc limit
  for svc in prometheus:536870912 alertmanager:67108864 grafana:268435456 node-exporter:67108864 cadvisor:201326592 blackbox:67108864 postgres-exporter:67108864 opensearch-exporter:67108864 dozzle:67108864; do
    limit="$(docker inspect -f '{{.HostConfig.Memory}}' "$(cid "${svc%%:*}")" | tr -d '\r\n')"
    ok_if "${svc%%:*}의 메모리 한도가 ${svc##*:}바이트다" "$(is "$limit" "${svc##*:}")"
  done
  out="$(inside prometheus 'http://localhost:9090/api/v1/status/flags')"
  ok_if "Prometheus 보존이 7일, 5GB다(화면에는 1w, 5GiB로 보인다)" "$([ "$(has "$out" '"storage.tsdb.retention.time":"1w"')" = 1 ] && [ "$(has "$out" '"storage.tsdb.retention.size":"5GiB"')" = 1 ] && echo 1 || echo 0)"
  ok_if "Prometheus의 관리 API(/-/quit, /-/reload)는 꺼져 있다" "$([ "$(has "$out" '"web.enable-lifecycle":"false"')" = 1 ] && echo 1 || echo 0)"
}

run_init_checks() {
  echo "--- 설정 만들기(obs-init)"
  local g=/tmp/g good=(-e B_IP=b.example.test -e MATTERMOST_WEBHOOK_URL=https://mm.example.test/hooks/a -e MATTERMOST_WEBHOOK_URL_DEV=https://mm.example.test/hooks/b)
  initrun() { docker run --rm --network none -e GENERATED_DIR=$g -v "$W/infra/obs/render.py:/render.py:ro" "$@" "$PYTHON_IMAGE" python /render.py 2>&1; }
  out="$(initrun "${good[@]}" && echo)" && rc=0 || rc=$?
  ok_if "올바른 값이면 대상 파일과 비밀 파일 3개를 만든다" "$([ "$rc" = 0 ] && [ "$(has "$out" 'vault-ssh.yml')" = 1 ] && [ "$(has "$out" 'mattermost_url_dev')" = 1 ] && echo 1 || echo 0)"
  ok_if "만든 내용에 웹훅 주소를 출력하지 않는다" "$(is "$(has "$out" 'mm.example.test')" 0)"
  out="$(initrun -e MATTERMOST_WEBHOOK_URL=https://x.test/a -e MATTERMOST_WEBHOOK_URL_DEV=https://x.test/b)" && rc=0 || rc=$?
  ok_if "B_IP가 없으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" B_IP)" = 1 ] && echo 1 || echo 0)"
  out="$(initrun -e B_IP=REPLACE_ME -e MATTERMOST_WEBHOOK_URL=https://x.test/a -e MATTERMOST_WEBHOOK_URL_DEV=https://x.test/b)" && rc=0 || rc=$?
  ok_if "자리표시자(REPLACE_ME)가 남아 있으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" REPLACE_ME)" = 1 ] && echo 1 || echo 0)"
  out="$(initrun -e 'B_IP=a;b' -e MATTERMOST_WEBHOOK_URL=https://x.test/a -e MATTERMOST_WEBHOOK_URL_DEV=https://x.test/b)" && rc=0 || rc=$?
  ok_if "B_IP에 이상한 문자가 있으면 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  out="$(initrun -e B_IP=b.test -e MATTERMOST_WEBHOOK_URL=ftp://x.test/a -e MATTERMOST_WEBHOOK_URL_DEV=https://x.test/b)" && rc=0 || rc=$?
  ok_if "http(s)가 아닌 웹훅 주소는 거부한다" "$(is "$([ "$rc" != 0 ] && echo 1 || echo 0)" 1)"
  c="$(cid obs-init)"
  ok_if "obs-init은 네트워크 없이 읽기 전용으로 돈다" "$([ "$(docker inspect -f '{{.HostConfig.NetworkMode}} {{.HostConfig.ReadonlyRootfs}}' "$c" | tr -d '\r')" = 'none true' ] && echo 1 || echo 0)"
  out="$(docker exec "$(cid alertmanager)" sh -c 'ls -l /generated/secrets/ | grep -c mattermost; cat /generated/targets/vault-ssh.yml' 2>&1)"
  ok_if "Alertmanager가 비밀 파일 2개를 읽을 수 있고 대상 파일에 B_IP가 있다" "$([ "$(has "$out" 'b-sim:22')" = 1 ] && echo 1 || echo 0)"
}

run_scrape_checks() {
  echo "--- 수집"
  local job
  for job in prometheus alertmanager node cadvisor caddy postgres opensearch blackbox vault-ssh; do
    ok_if "수집 대상 $job가 up이다" "$(is "$(pval "count(up{job=\"$job\"} == 1)")" 1)"
  done
  ok_if "BE는 세 대상(blue, green, dev)이 모두 up이다" "$(is "$(pval 'count(up{job="be"} == 1)')" 3)"
  ok_if "BE 지표에 env와 color 라벨이 붙는다" "$(is "$(pval 'count(up{job="be", env="prod", color="blue"})')" 1)"
  ok_if "Prometheus에 site=A 외부 라벨이 있다" "$([ "$(has "$(inside prometheus 'http://localhost:9090/api/v1/status/config')" 'site: A')" = 1 ] && echo 1 || echo 0)"
  # Docker Desktop(WSL2)에는 mountpoint="/"인 파일시스템이 없어 라벨은 실제 서버에서 확인한다
  ok_if "node-exporter가 호스트의 메모리·디스크 지표를 낸다" "$([ "$(pcount 'node_memory_MemAvailable_bytes')" -ge 1 ] && [ "$(pcount 'node_filesystem_avail_bytes')" -ge 1 ] && echo 1 || echo 0)"
  ok_if "node-exporter가 textfile 지표(백업)를 읽는다" "$(is "$(pval 'fit_backup_last_verify_ok')" 1)"
  ok_if "cAdvisor가 컨테이너 이름과 메모리 한도를 낸다(prometheus 512MiB)" "$(is "$(pval 'container_spec_memory_limit_bytes{name=~".*prometheus.*"}')" 536870912)"
  ok_if "postgres-exporter가 pg_up=1과 연결 수를 낸다" "$([ "$(pval pg_up)" = 1 ] && [ -n "$(pval 'sum(pg_stat_activity_count)')" ] && [ "$(pval 'max(pg_settings_max_connections)')" = 60 ] && echo 1 || echo 0)"
  ok_if "OpenSearch exporter가 클러스터 상태와 힙을 낸다" "$([ "$(pval 'elasticsearch_clusterinfo_up')" = 1 ] && [ -n "$(pval 'max(elasticsearch_jvm_memory_used_bytes{area="heap"})')" ] && echo 1 || echo 0)"
  ok_if "A에서 B(b-sim:22)의 TCP 프로브가 성공한다" "$(is "$(pval 'probe_success{job="vault-ssh"}')" 1)"
}

run_rules_checks() {
  echo "--- 규칙"
  local rules
  rules="$(inside prometheus 'http://localhost:9090/api/v1/rules')"
  ok_if "알림 규칙 35개가 올라와 있다" "$(is "$(printf '%s' "$rules" | "$PY" -c 'import json,sys; g=json.load(sys.stdin)["data"]["groups"]; print(sum(1 for x in g for r in x["rules"] if r["type"]=="alerting"))')" 35)"
  ok_if "모든 규칙이 오류 없이 평가된다" "$(is "$(printf '%s' "$rules" | "$PY" -c 'import json,sys; g=json.load(sys.stdin)["data"]["groups"]; print(sum(1 for x in g for r in x["rules"] if r.get("health")!="ok" or r.get("lastError")))')" 0)"
  ok_if "기록 규칙(recording rule, Modal 폴백 비율)이 올라와 있다" "$([ "$(has "$rules" 'fit:modal_fallback_ratio:rate15m')" = 1 ] && echo 1 || echo 0)"
  ok_if "Prometheus가 Alertmanager에 연결돼 있다" "$([ "$(has "$(inside prometheus 'http://localhost:9090/api/v1/alertmanagers')" 'alertmanager:9093')" = 1 ] && echo 1 || echo 0)"
}

run_alert_checks() {
  echo "--- 알림이 Mattermost 형식으로 도착한다"
  local mt="$T/textfile/fit_backup.prom" tok_main tok_dev body
  tok_main="$(sed -n 's/^webhook-main=//p' "$T/tokens")"
  tok_dev="$(sed -n 's/^webhook-dev=//p' "$T/tokens")"
  : >"$T/sink.log" # 앞서 받은 메시지는 비운다(이 구역을 다시 돌려도 같은 결과가 나오게)
  # 1) prod BE가 모두 내려가면 critical이 main으로 간다
  docker stop "$PROJECT-be-prod-blue" "$PROJECT-be-prod-green" >/dev/null
  ok_if "prod BE 두 색이 모두 내려가면 FitBeProdDown이 main 수신자(/hook)에 도착한다" "$(wait_for 150 sink_has "/hook/$tok_main" FitBeProdDown && echo 1 || echo 0)"
  body="$(sink_body "/hook/$tok_main" "[FIRING:1] FitBeProdDown")"
  out="$body"
  ok_if "메시지가 Slack 형식(attachments, title, text, color)이다" "$([ "$(has "$body" '"attachments"')" = 1 ] && [ "$(has "$body" '"title"')" = 1 ] && [ "$(has "$body" '"color":"danger"')" = 1 ] && echo 1 || echo 0)"
  ok_if "제목에 상태, 알림 이름, site/env가 있다([FIRING:1] FitBeProdDown (A/prod))" "$(has "$body" '[FIRING:1] FitBeProdDown (A/prod)')"
  ok_if "본문에 요약, 설명, 런북 ID가 있다" "$([ "$(has "$body" '*CRITICAL*')" = 1 ] && [ "$(has "$body" 'prod BE가 모든 색에서 응답하지 않는다')" = 1 ] && [ "$(has "$body" '런북: RB-02')" = 1 ] && echo 1 || echo 0)"
  ok_if "prod 알림은 dev 수신자(/hook-dev)로 가지 않는다" "$(is "$(sink_count "/hook-dev/$tok_dev" FitBeProdDown)" 0)"
  docker start "$PROJECT-be-prod-blue" "$PROJECT-be-prod-green" >/dev/null
  ok_if "복구되면 [RESOLVED] 메시지가 온다" "$(wait_for 150 sink_has "/hook/$tok_main" '[RESOLVED] FitBeProdDown' && echo 1 || echo 0)"
  # 2) dev는 별도 수신자로 간다
  docker stop "$PROJECT-be-dev" >/dev/null
  ok_if "dev BE가 내려가면 FitBeDevDown이 dev 수신자(/hook-dev)에 도착한다" "$(wait_for 150 sink_has "/hook-dev/$tok_dev" FitBeDevDown && echo 1 || echo 0)"
  ok_if "dev 알림은 main 수신자로 가지 않는다" "$(is "$(sink_count "/hook/$tok_main" FitBeDevDown)" 0)"
  docker start "$PROJECT-be-dev" >/dev/null
  # 3) 백업 지표(textfile)가 알림까지 이어진다
  sed -i 's/^fit_backup_last_verify_ok .*/fit_backup_last_verify_ok 0/' "$mt"
  ok_if "textfile의 fit_backup_last_verify_ok를 0으로 바꾸면 FitBackupVerifyFailed가 도착한다" "$(wait_for 150 sink_has "/hook/$tok_main" FitBackupVerifyFailed && echo 1 || echo 0)"
  out="$(sink_body "/hook/$tok_main" "[FIRING:1] FitBackupVerifyFailed")"
  ok_if "그 메시지의 색은 warning이고 런북은 RB-06이다" "$([ "$(has "$out" '"color":"warning"')" = 1 ] && [ "$(has "$out" '런북: RB-06')" = 1 ] && echo 1 || echo 0)"
  sed -i 's/^fit_backup_last_verify_ok .*/fit_backup_last_verify_ok 1/' "$mt"
  ok_if "1로 되돌리면 해소 메시지가 온다" "$(wait_for 150 sink_has "/hook/$tok_main" '[RESOLVED] FitBackupVerifyFailed' && echo 1 || echo 0)"
  # 4) B로 가는 22번 프로브가 실패하면 알린다
  docker stop "$PROJECT-b-sim" >/dev/null
  ok_if "B의 22번 포트가 닫히면 FitVaultUnreachable이 도착한다" "$(wait_for 150 sink_has "/hook/$tok_main" FitVaultUnreachable && echo 1 || echo 0)"
  docker start "$PROJECT-b-sim" >/dev/null
  # 5) 지표가 사라지면(absent) 알린다
  rm -f "$T/be-prod-blue/actuator/prometheus" "$T/be-prod-green/actuator/prometheus"
  ok_if "BE 지표 파일이 사라지면 FitHttpMetricMissing(absent)이 도착한다" "$(wait_for 150 sink_has "/hook/$tok_main" FitHttpMetricMissing && echo 1 || echo 0)"
  be_metrics be-prod-blue
  be_metrics be-prod-green
  ok_if "지표 파일을 되살리면 해소 메시지가 온다(시험은 처음 상태로 돌아간다)" "$(wait_for 150 sink_has "/hook/$tok_main" '[RESOLVED] FitHttpMetricMissing' && echo 1 || echo 0)"
}

run_grafana_checks() {
  echo "--- Grafana"
  local pw dashes
  pw="$(sed -n 's/^GRAFANA_ADMIN_PASSWORD=//p' "$T/obs.env")"
  out="$(docker exec "$(cid grafana)" wget -qO- --header "Authorization: Basic $(printf 'admin:%s' "$pw" | base64 | tr -d '\n')" http://localhost:3000/api/datasources/uid/prom-a/health 2>&1)"
  ok_if "프로비저닝한 Prometheus 데이터소스(uid prom-a)가 정상이다" "$(has "$out" 'Successfully queried the Prometheus API')"
  dashes="$(docker exec "$(cid grafana)" wget -qO- --header "Authorization: Basic $(printf 'admin:%s' "$pw" | base64 | tr -d '\n')" 'http://localhost:3000/api/search?type=dash-db' 2>&1)"
  ok_if "대시보드 3개가 프로비저닝됐다(fit-host, fit-app, fit-data)" "$([ "$(has "$dashes" '"uid":"fit-host"')" = 1 ] && [ "$(has "$dashes" '"uid":"fit-app"')" = 1 ] && [ "$(has "$dashes" '"uid":"fit-data"')" = 1 ] && echo 1 || echo 0)"
  out="$(docker exec "$(cid grafana)" wget -qO- http://localhost:3000/api/search 2>&1 || true)"
  ok_if "로그인 없이는 대시보드를 볼 수 없다(익명 접근 없음)" "$([ "$(has "$out" fit-host)" = 0 ] && echo 1 || echo 0)"
  # 대시보드의 모든 쿼리가 Prometheus에서 문법 오류 없이 실행된다
  local bad=0 n=0 expr
  while IFS= read -r expr; do
    n=$((n + 1))
    if [ "$(prom "$expr" | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null)" != success ]; then
      bad=$((bad + 1))
      echo "FAIL  쿼리가 실행되지 않는다: $expr"
    fi
  done < <("$PY" - infra/obs/grafana/dashboards <<'PYEOF'
import json, pathlib, sys
for f in sorted(pathlib.Path(sys.argv[1]).glob("*.json")):
    for p in json.loads(f.read_text(encoding="utf-8"))["panels"]:
        for t in p["targets"]:
            print(t["expr"])
PYEOF
  )
  ok_if "대시보드의 쿼리 $n개가 모두 Prometheus에서 성공한다" "$([ "$bad" = 0 ] && [ "$n" -ge 20 ] && echo 1 || echo 0)"
}

run_digest_checks() {
  echo "--- 일일 점검 요약(daily-digest.py)"
  local tok gate gpw before out2
  tok="$(sed -n 's/^webhook-main=//p' "$T/tokens")"
  gate="gatekey-$(hex 6)"
  gpw="$(sed -n 's/^GRAFANA_ADMIN_PASSWORD=//p' "$T/obs.env")"
  mkdir -p "$T/digest" "$T/state"
  printf 'GRAFANA_ADMIN_PASSWORD=%s\nMATTERMOST_WEBHOOK_URL=http://webhook-sink:18099/hook/%s\n' "$gpw" "$tok" >"$T/digest/obs.env"
  printf 'GRAFANA_ADMIN_PASSWORD=%s\nMATTERMOST_WEBHOOK_URL=http://webhook-sink:1/unreachable\n' "$gpw" >"$T/digest/obs-bad.env"
  printf 'PROD_HOST=a.test\nDEV_HOST=a.test\nDEV_GATE_KEY=%s\n' "$gate" >"$T/digest/edge.env"
  printf '2026-11-07T01:02:03Z deploy-start all 0123456789abcdef0123 start runner\n2026-11-07T01:05:03Z deploy-end all 0123456789abcdef0123 ok runner\n' >"$T/state/history-prod.log"
  printf '2026-11-07T02:02:03Z deploy-end all fedcba9876543210fedc fail runner\n' >"$T/state/history-dev.log"
  digest() { # digest 인자...: 스크립트를 시험 망의 컨테이너에서 돌린다(뒤에 오는 같은 옵션이 앞을 덮는다)
    docker run --rm --network "$FIT_NET_OBS" -v "$W/infra/obs/daily-digest.py:/d.py:ro" -v "$T/digest:/digest:ro" -v "$T/state:/state:ro" "$PYTHON_IMAGE" \
      python /d.py --prom http://prometheus:9090 --state-dir /state --obs-env /digest/obs.env --edge-env /digest/edge.env --tls-connect tls-sim "$@" 2>&1
  }
  # shellcheck disable=SC2329 # wait_for가 이름으로 부른다
  digest_has() { digest --dry-run | grep -qF -- "$1"; } # digest_has 문자열: wait_for에 넘기려고 호출할 때마다 다시 만든다
  before="$(sink_count /hook "일일 점검")"
  out="$(digest --dry-run)" && rc=0 || rc=$?
  ok_if "--dry-run은 종료 코드 0으로 끝나고 아무것도 올리지 않는다" "$([ "$rc" = 0 ] && [ "$(sink_count /hook "일일 점검")" = "$before" ] && echo 1 || echo 0)"
  ok_if "표에 디스크, 메모리, 스왑, CPU 24시간 평균 행이 있다" "$([ "$(has "$out" '| 디스크(/) |')" = 1 ] && [ "$(has "$out" '| 메모리 |')" = 1 ] && [ "$(has "$out" '| 스왑 |')" = 1 ] && [ "$(has "$out" '| CPU 24시간 평균 |')" = 1 ] && echo 1 || echo 0)"
  # CPU 행의 ✅와 ⚠️는 시험하는 PC의 부하에 달렸으므로 값이 나오는지만 본다
  ok_if "메모리와 CPU는 실제 값이 나온다(지표 없음이 아니다)" "$([ "$(has "$out" '| 메모리 | ✅ | 가용')" = 1 ] && [ "$(printf '%s\n' "$out" | grep -F '| CPU 24시간 평균 |' | grep -c '기준선 40%')" = 1 ] && echo 1 || echo 0)"
  ok_if "백업 행: pg, photos, caddy의 마지막 성공과 복원 검증 통과" "$([ "$(has "$out" '| 백업 pg | ✅ | 마지막 성공')" = 1 ] && [ "$(has "$out" '| 백업 photos | ✅ |')" = 1 ] && [ "$(has "$out" '| 백업 caddy | ✅ |')" = 1 ] && [ "$(has "$out" '| 백업 복원 검증 | ✅ | 마지막 검증 통과')" = 1 ] && echo 1 || echo 0)"
  ok_if "5xx와 배치 행이 있다(BE 지표에서)" "$([ "$(has "$out" '| 5xx(24시간) | ✅ | 0건')" = 1 ] && [ "$(has "$out" '| 새벽 배치 | ✅ | 마지막 성공')" = 1 ] && echo 1 || echo 0)"
  ok_if "마지막 배포: prod는 성공(KST로 바뀐 시각과 앞 12자리 sha), dev는 실패가 주의로 보인다" "$([ "$(has "$out" '| 마지막 배포(prod) | ✅ | 11-07 10:05 KST 배포 ok 0123456789ab (runner)')" = 1 ] && [ "$(has "$out" '| 마지막 배포(dev) | ⚠️ | 11-07 11:02 KST 배포 fail fedcba987654')" = 1 ] && echo 1 || echo 0)"
  ok_if "인증서 잔여일을 서버 자신의 443에서 읽는다(40일, 정상)" "$([ "$(has "$out" '| 인증서(prod) | ✅ | 만료까지 40일')" = 1 ] && [ "$(has "$out" '| 인증서(dev) | ✅ | 만료까지 40일')" = 1 ] && echo 1 || echo 0)"
  ok_if "지금 울리는 알림 행이 있다" "$(has "$out" '| 지금 울리는 알림 |')"
  ok_if "웹훅 주소, Grafana 비밀번호, dev 게이트 키는 출력하지 않는다" "$([ "$(has "$out" "$tok")" = 0 ] && [ "$(has "$out" "$gpw")" = 0 ] && [ "$(has "$out" "$gate")" = 0 ] && echo 1 || echo 0)"
  out2="$(digest --dry-run --tls-connect tls-sim-short)" && rc=0 || rc=$?
  ok_if "인증서가 5일 남았으면 주의(14일 미만)로 보이고 주의 건수가 줄에 나온다" "$([ "$rc" = 0 ] && [ "$(has "$out2" '| 인증서(prod) | ⚠️ | 만료까지 5일')" = 1 ] && [ "$(has "$out2" '주의 ')" = 1 ] && echo 1 || echo 0)"
  # 백업 검증이 실패했다고 쓰면 요약에 주의로 나온다
  sed -i 's/^fit_backup_last_verify_ok .*/fit_backup_last_verify_ok 0/' "$T/textfile/fit_backup.prom"
  ok_if "백업 복원 검증이 실패하면 요약에 주의로 나온다" "$(wait_for 90 digest_has '| 백업 복원 검증 | ⚠️ | 마지막 검증 실패' && echo 1 || echo 0)"
  sed -i 's/^fit_backup_last_verify_ok .*/fit_backup_last_verify_ok 1/' "$T/textfile/fit_backup.prom"
  # 실제로 올린다
  out="$(digest)" && rc=0 || rc=$?
  ok_if "올리면 종료 코드 0이고 main 수신자에 도착한다" "$([ "$rc" = 0 ] && wait_for 30 sink_has "/hook/$tok" "일일 점검" && echo 1 || echo 0)"
  out="$(sink_body "/hook/$tok" "일일 점검")"
  ok_if "메시지는 Mattermost 수신 웹훅 형식({\"text\": ...})이고 제목이 있다" "$([ "$(has "$out" '{"text":')" = 1 ] && [ "$(has "$out" '#### Fit Dining 일일 점검')" = 1 ] && echo 1 || echo 0)"
  # 실패 경로
  out="$(digest --prom http://nonexistent.invalid:9090)" && rc=0 || rc=$?
  ok_if "Prometheus에 닿지 못하면 그 사실을 올리고 종료 코드 1이다" "$([ "$rc" = 1 ] && wait_for 30 sink_has "/hook/$tok" "Prometheus에서 값을 읽지 못했다" && echo 1 || echo 0)"
  out="$(digest --obs-env /digest/none.env)" && rc=0 || rc=$?
  ok_if "웹훅 주소를 읽지 못하면 거부한다" "$([ "$rc" = 1 ] && [ "$(has "$out" 'MATTERMOST_WEBHOOK_URL을 읽지 못했다')" = 1 ] && echo 1 || echo 0)"
  out="$(digest --obs-env /digest/obs-bad.env)" && rc=0 || rc=$?
  ok_if "웹훅에 보내지 못하면 종료 코드 1이고 주소는 출력하지 않는다" "$([ "$rc" = 1 ] && [ "$(has "$out" '웹훅으로 보내지 못했다')" = 1 ] && [ "$(has "$out" 'unreachable')" = 0 ] && echo 1 || echo 0)"
}

run_install_checks() {
  echo "--- 설치(A의 일일 점검 요약)"
  local H="$PROJECT-host" M=/usr/local/lib/fit/obs
  docker rm -f "$H" >/dev/null 2>&1 || true
  docker run -d --name "$H" -v "$W:/repo:ro" ubuntu:24.04 sleep infinity >/dev/null
  hx() { docker exec "$H" bash -c "$1" 2>&1; } # 컨테이너 안에서 root로 실행한다
  hx 'groupadd docker' >/dev/null
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/obs/install.sh')" && rc=0 || rc=$?
  ok_if "install.sh가 성공한다" "$(is "$rc" 0)"
  ok_if "첫 실행은 변경을 알리고 웹훅이 비어 있으면 타이머를 켜지 않는다고 알린다" "$([ "$(has "$out" '변경:')" = 1 ] && [ "$(has "$out" '타이머는 켜지 않았다')" = 1 ] && echo 1 || echo 0)"
  ok_if "obs.env는 예제에서 만들어지고 640 root:docker다" "$(is "$(hx "stat -c '%a %U:%G' /etc/fit/obs.env")" '640 root:docker')"
  ok_if "점검 요약 스크립트 사본은 755 root:root다" "$(is "$(hx "stat -c '%a %U:%G' $M/daily-digest.py")" '755 root:root')"
  ok_if "코드 사본은 root 외에는 쓸 수 없다" "$(is "$(hx "find $M -perm /022 | wc -l")" 0)"
  ok_if "유닛 파일 2개가 설치됐고 저장소와 같다" "$(is "$(hx "ls /etc/systemd/system | grep -c '^fit-daily-digest'; for f in /repo/infra/obs/conf/systemd/*; do cmp -s \$f /etc/systemd/system/\$(basename \$f) || echo diff; done" | tr '\n' ' ')" '2 ')"
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/obs/install.sh')"
  ok_if "두 번째 실행은 변경이 없다" "$(has "$out" '변경 0건')"
  hx "sed -i 's|^MATTERMOST_WEBHOOK_URL=.*|MATTERMOST_WEBHOOK_URL=http://mm.example.test/hooks/x|' /etc/fit/obs.env" >/dev/null
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/obs/install.sh')"
  ok_if "웹훅을 채우면 타이머 안내가 사라지고 채운 값은 덮어쓰지 않는다" "$([ "$(has "$out" '타이머는 켜지 않았다')" = 0 ] && [ "$(has "$(hx 'grep ^MATTERMOST /etc/fit/obs.env')" 'mm.example.test')" = 1 ] && echo 1 || echo 0)"
  out="$(hx "su -s /bin/bash nobody -c 'bash /repo/infra/obs/install.sh'")" && rc=0 || rc=$?
  ok_if "root가 아니면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'root로 실행한다')" = 1 ] && echo 1 || echo 0)"
  hx "echo '# 누가 고쳤다' >> $M/daily-digest.py" >/dev/null
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/obs/install.sh')"
  ok_if "사본을 손으로 고쳐도 다시 실행하면 저장소와 같게 되돌린다" "$([ "$(has "$out" "변경: $M/daily-digest.py")" = 1 ] && [ "$(hx "cmp /repo/infra/obs/daily-digest.py $M/daily-digest.py && echo same")" = same ] && echo 1 || echo 0)"
  ok_if "ExecStart가 가리키는 스크립트가 사본에 있다" "$(is "$(hx "p=\$(sed -n 's/^ExecStart=[^ ]* \\([^ ]*\\)\$/\\1/p' /etc/systemd/system/fit-daily-digest.service); test -f \"\$p\" && echo yes")" yes)"
  docker rm -f "$H" >/dev/null
  echo "--- systemd 유닛 문법(systemd-analyze)"
  out="$(tar -C infra/obs/conf/systemd -cf - . | docker run --rm -i ubuntu:24.04 bash -c '
set -e
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends systemd >/dev/null
tar -x -C /etc/systemd/system
chmod 644 /etc/systemd/system/*
mkdir -p /usr/local/lib/fit/obs
printf "#!/bin/sh\n" >/usr/local/lib/fit/obs/daily-digest.py
printf "[Service]\nExecStart=/bin/true\n" >/etc/systemd/system/docker.service
[ -x /usr/bin/python3 ] || { printf "#!/bin/sh\n" >/usr/bin/python3; chmod +x /usr/bin/python3; }
systemd-analyze calendar "$(sed -n "s/^OnCalendar=//p" /etc/systemd/system/fit-daily-digest.timer)" >/dev/null
echo "calendar OK"
cd /etc/systemd/system
verify_out="$(systemd-analyze verify fit-daily-digest.service fit-daily-digest.timer 2>&1)" || { echo "$verify_out"; echo "verify FAIL"; exit 1; }
echo "$verify_out" | grep -v "^$" || true
echo "verify OK"
' 2>&1)" && rc=0 || rc=$?
  ok_if "systemd-analyze가 OnCalendar 표현을 해석한다" "$(has "$out" 'calendar OK')"
  ok_if "systemd-analyze verify가 서비스와 타이머를 오류 없이 읽는다" "$([ "$rc" = 0 ] && [ "$(has "$out" 'verify OK')" = 1 ] && [ "$(grep -ci -e 'failed' -e 'error' <<<"$out")" = 0 ] && echo 1 || echo 0)"
}

run_hygiene_checks() {
  echo "--- 비밀 값 노출"
  local tok_main tok_dev pw leaked=0 svc
  tok_main="$(sed -n 's/^webhook-main=//p' "$T/tokens")"
  tok_dev="$(sed -n 's/^webhook-dev=//p' "$T/tokens")"
  pw="$(sed -n 's/^GRAFANA_ADMIN_PASSWORD=//p' "$T/obs.env")"
  for svc in obs-init prometheus alertmanager grafana node-exporter cadvisor blackbox postgres-exporter opensearch-exporter dozzle; do
    if docker logs "$(cid "$svc")" 2>&1 | grep -q -e "$tok_main" -e "$tok_dev" -e "$pw" -e "$(sed -n 's/^FIT_MONITOR_PASSWORD=//p' "$T/obs.env")"; then
      leaked=1
      echo "FAIL  $svc 로그에 비밀 값이 있다"
    fi
  done
  ok_if "어느 컨테이너 로그에도 웹훅 주소, Grafana·모니터링 비밀번호가 없다" "$(is "$leaked" 0)"
  ok_if "Prometheus 설정 API에 웹훅 주소가 없다(파일로만 읽는다)" "$([ "$(has "$(inside prometheus 'http://localhost:9090/api/v1/status/config')" "$tok_main")" = 0 ] && echo 1 || echo 0)"
}

run() {
  local section
  local -a sections=("$@")
  if [ "${#sections[@]}" = 0 ]; then sections=(stack init scrape rules alert grafana digest install hygiene); fi
  set +e
  for section in "${sections[@]}"; do "run_${section}_checks"; done
  set -e
  if [ "$FAILED" -gt 0 ]; then
    printf '\n%d개 점검 실패\n' "$FAILED"
    return 1
  fi
  printf '\n관측 스택 시험 통과\n'
}

case "${1:-}" in
  up) up ;;
  run) shift && run "$@" ;;
  down) down ;;
  *)
    echo "사용: bash infra/obs/test/test-obs.sh up | run [구역...] | down" >&2
    exit 2
    ;;
esac
````

- [ ] **Step 3: shellcheck와 정적 검사 확인**

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
chmod +x infra/obs/test/test-obs.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/obs/test/test-obs.sh; echo "shellcheck exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml infra/obs/test/compose.test.yml; echo "yamllint exit=$?"
python -m py_compile infra/obs/test/mock-exporter.py infra/obs/test/webhook-sink.py infra/obs/test/tls-sim.py && echo "py OK"
find infra -name __pycache__ -prune -exec rm -rf {} +
```

Expected: `shellcheck exit=0`, `yamllint exit=0`, `py OK`.

- [ ] **Step 4: 시험 환경 켜기 (게이트)**

처음에는 prometheus, alertmanager, grafana, exporter, cAdvisor, Dozzle, OpenSearch(빌드) 이미지를 받아 몇 분 걸린다.

Run: `bash infra/obs/test/test-obs.sh up`

Expected: 데이터 시험 환경이 먼저 뜨고(`데이터 시험 환경이 떴다`) 이어서 `obs-init`이 `Exited`, 나머지가 `Healthy`로 바뀌며 마지막 줄이 `관측 시험 환경이 떴다(프로젝트 fit-obstest)`다.

- [ ] **Step 5: 시나리오 실행 (게이트)**

Run:

```bash
bash infra/obs/test/test-obs.sh run > .tmp-obs-run.log 2>&1; echo "exit=$?"
grep -E "^---|^FAIL|^관측 스택 시험|개 점검 실패" .tmp-obs-run.log
grep -c "^PASS" .tmp-obs-run.log
rm -f .tmp-obs-run.log
```

Expected: `exit=0`, 구역 제목 10개(`--- 구성`부터 `--- 비밀 값 노출`까지. 설치 구역은 제목이 둘이다)가 나오고 `FAIL`은 하나도 없으며 `관측 스택 시험 통과`가 나온 뒤 마지막 줄(전체 `PASS` 줄 수)이 93이다. 구역 하나만 돌리려면 구역 이름을 준다(예: `... run digest`). 알림 구역은 가짜 BE를 내렸다 올리므로 몇 분 걸린다.

시험하는 PC의 부하는 결과를 바꾸지 않는다(CPU 평균이 40%를 넘어도 요약은 그 행을 `주의`로 낼 뿐이고 시험은 값이 나오는지만 본다).

- [ ] **Step 6: 시험이 잡아내는지 확인 (변이)**

스크립트를 일부러 망가뜨리면 시험이 실패해야 한다. 아래는 예시 둘이다(켜 둔 환경에서 망가뜨리고, 해당 구역만 시험하고, 되돌린다).

Run:

```bash
cp infra/obs/daily-digest.py .tmp-digest.bak
sed -i 's/timedelta(hours=9)/timedelta(hours=8)/' infra/obs/daily-digest.py
bash infra/obs/test/test-obs.sh run digest 2>&1 | grep "^FAIL  [^>]" | head -3
mv .tmp-digest.bak infra/obs/daily-digest.py
cp infra/obs/install.sh .tmp-install.bak
sed -i 's|/daily-digest.py" 755$|/daily-digest.py" 777|' infra/obs/install.sh
bash infra/obs/test/test-obs.sh run install 2>&1 | grep "^FAIL  [^>]" | head -3
mv .tmp-install.bak infra/obs/install.sh
```

Expected: 첫 시험의 출력에 `FAIL  마지막 배포: prod는 성공(KST로 바뀐 시각과 앞 12자리 sha)…`가(시간대 오프셋 오류를 잡는다), 둘째 시험의 출력에 `FAIL  점검 요약 스크립트 사본은 755 root:root다`와 `FAIL  코드 사본은 root 외에는 쓸 수 없다`가 포함된다.

- [ ] **Step 7: 정리 확인**

Run:

```bash
bash infra/obs/test/test-obs.sh down
docker ps -a --format '{{.Names}}' | grep -c 'fit-obstest\|fit-datatest'
docker network ls --format '{{.Name}}' | grep -c '^fit-datatest-'
docker volume ls --format '{{.Name}}' | grep -c '^fit-obstest\|^fit-datatest'
ls -d .tmp-obstest .tmp-datatest 2>&1 | head -2
```

Expected: `정리했다`, 이어서 `0`, `0`, `0`, 마지막은 두 경로 모두 `No such file or directory`다.

- [ ] **Step 8: 커밋 (허용된 경우)**

```bash
git add infra/obs/test
git update-index --chmod=+x infra/obs/test/test-obs.sh
git commit -m "feat(infra): A 관측 시험 환경(실제 Prometheus·Alertmanager, 알림 도착·요약·설치 시나리오) 추가"
```

---

### Task 5: B 감시 스택 정의

**목표:** 서버 B의 `fit-ops` 프로젝트(prometheus-b, alertmanager-b, blackbox, node-exporter)와 알림 규칙 19개, 단위 시험, 라우팅을 정의한다. B는 A를 밖에서 보고, 금고와 포트 감사 지표를 textfile로 읽는다.

**Files:**
- Create: `infra/ops/compose.ops.yml`, `infra/ops/ops.env.example`, `infra/ops/render.py`, `infra/ops/prometheus/prometheus.yml`, `infra/ops/prometheus/rules/{probes,vault,host}.yml`, `infra/ops/prometheus/tests/{probes,vault,host}.test.yml`, `infra/ops/alertmanager/alertmanager.yml`, `infra/ops/alertmanager/templates/fit.tmpl`, `infra/ops/alertmanager/routes.txt`, `infra/ops/blackbox/blackbox.yml`

**Interfaces:**
- Consumes: 1D의 금고 지표(`/srv/vault/metrics/fit_vault.prom`), Task 6의 포트 감사 지표(`fit_portaudit_*.prom`), Task 8의 엣지 `/_ops` 경로, Task 1의 검사 도구
- Produces: 서비스 4개와 일회성 `ops-init`. 값은 `docker compose --env-file /etc/fit/ops.env`로 읽는다. 호스트 게시는 `127.0.0.1`의 9090(Prometheus-B), 9093(Alertmanager-B)뿐이다. 한도 합계 352MB. 알림 규칙 19개(`probes` 7, `vault` 9, `host` 3). 프로브 8개(`probe` 라벨 `a-healthz`, `a-fe`, `a-tcp-80`, `a-tcp-443`, `a-tls-prod`, `a-tls-dev`, `a-prometheus`, `a-alertmanager`)

핵심 결정:

- `ops-init`이 `PROD_HOST`·`DEV_HOST`로 프로브 대상 파일을, `OPS_BASIC_AUTH_USER`로 blackbox 설정(견본의 `@@OPS_BASIC_AUTH_USER@@`)을, 웹훅과 비밀번호로 비밀 파일을 만든다. 시험 전용 `PROBE_INSECURE_TLS=1`이면 인증서 검증을 끈다(운영 compose에는 없다). 값이 비었거나 형식이 틀리면 스택이 뜨지 않는다.
- 인증서 만료는 호스트마다(prod, dev) `tcp_tls` 프로브의 `probe_ssl_earliest_cert_expiry`로 본다. 14일 미만 warning, 7일 미만 critical, TLS 연결 실패는 따로 warning이다. 이미 만료된 인증서(남은 시간이 음수)도 critical이다.
- 감시 체계 감시는 A의 `/_ops/prometheus/healthy`, `/_ops/alertmanager/healthy`를 `http_ops` 모듈(basic auth, 비밀번호는 파일)로 본다. A의 알림이 조용해졌는지 밖에서 보려는 것이다.
- B의 알림은 모두 prod에 관한 것이라 외부 라벨 `env=prod`, 수신자 하나(main)다. critical은 1시간마다 다시 알린다. 메시지 견본은 A와 같다.

- [ ] **Step 1: 스택 정의와 설정 생성기 작성**

`infra/ops/compose.ops.yml`:

````yaml
# 서버 B의 감시 스택. 프로젝트 fit-ops다(설계 2.2절, 9.3절): prometheus-b, alertmanager-b, blackbox, node-exporter.
# A가 죽어도 B가 A를 밖에서 보고 알린다(외부 접근, 인증서, 포트 도달성, 감시 체계 감시, 백업 금고). 값은 `docker compose --env-file /etc/fit/ops.env`로 읽는다.
# 호스트에 게시하는 포트는 127.0.0.1의 prometheus-b 9090과 alertmanager-b 9093뿐이다(SSH 터널로 본다, 설계 13.1절).
# 한도의 합은 설계 4.2절의 ops 스택 예산(0.4GB) 안이다. node-exporter는 금고의 지표 파일(/srv/vault/metrics, 포트 노출 감사 결과 포함)을 읽는다.
name: fit-ops

x-logging: &logging
  driver: json-file
  options:
    max-size: 10m
    max-file: "3"

services:
  # 서버마다 다른 값(A의 주소, /_ops 자격, 웹훅)을 설정 파일로 만든다. 끝나면 종료하고 prometheus-b, alertmanager-b, blackbox는 이것이 성공해야 뜬다
  ops-init:
    image: python:3.12.15-slim
    restart: "no"
    user: "0"
    network_mode: none
    read_only: true
    command: [python, /render.py]
    environment:
      PROD_HOST: ${PROD_HOST:?ops.env에 PROD_HOST가 없다}
      DEV_HOST: ${DEV_HOST:?ops.env에 DEV_HOST가 없다}
      OPS_BASIC_AUTH_USER: ${OPS_BASIC_AUTH_USER:?ops.env에 OPS_BASIC_AUTH_USER가 없다}
      OPS_BASIC_AUTH_PASSWORD: ${OPS_BASIC_AUTH_PASSWORD:?ops.env에 OPS_BASIC_AUTH_PASSWORD가 없다}
      MATTERMOST_WEBHOOK_URL: ${MATTERMOST_WEBHOOK_URL:?ops.env에 MATTERMOST_WEBHOOK_URL이 없다}
    volumes:
      - ./render.py:/render.py:ro
      - ./blackbox/blackbox.yml:/blackbox.yml:ro
      - generated:/generated
    mem_limit: 32m
    logging: *logging

  prometheus-b:
    image: prom/prometheus:v3.15.0
    restart: unless-stopped
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
      - --storage.tsdb.retention.time=7d
      - --storage.tsdb.retention.size=2GB
      - --web.listen-address=0.0.0.0:9090
    ports:
      - 127.0.0.1:9090:9090
    mem_limit: 160m
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./prometheus/rules:/etc/prometheus/rules:ro
      - generated:/generated:ro
      - promdata:/prometheus
    depends_on:
      ops-init:
        condition: service_completed_successfully
    healthcheck:
      test: [CMD, wget, -q, --spider, "http://localhost:9090/-/ready"]
      interval: 10s
      timeout: 3s
      retries: 12
    logging: *logging

  alertmanager-b:
    image: prom/alertmanager:v0.34.1
    restart: unless-stopped
    command:
      - --config.file=/etc/alertmanager/alertmanager.yml
      - --storage.path=/alertmanager
      - --web.listen-address=0.0.0.0:9093
    ports:
      - 127.0.0.1:9093:9093
    mem_limit: 64m
    volumes:
      - ./alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
      - ./alertmanager/templates:/etc/alertmanager/templates:ro
      - generated:/generated:ro
      - amdata:/alertmanager
    depends_on:
      ops-init:
        condition: service_completed_successfully
    healthcheck:
      test: [CMD, wget, -q, --spider, "http://localhost:9093/-/ready"]
      interval: 10s
      timeout: 3s
      retries: 12
    logging: *logging

  # A를 밖에서 두드린다. 설정은 ops-init이 만든 /generated/blackbox.yml이다
  blackbox:
    image: prom/blackbox-exporter:v0.28.0
    restart: unless-stopped
    command: [--config.file=/generated/blackbox.yml]
    mem_limit: 64m
    volumes:
      - generated:/generated:ro
    depends_on:
      ops-init:
        condition: service_completed_successfully
    logging: *logging

  node-exporter:
    image: prom/node-exporter:v1.12.1
    restart: unless-stopped
    pid: host
    command:
      - --path.rootfs=/host
      - --collector.textfile.directory=/textfile
      - --no-collector.ipvs
      - --no-collector.wifi
    mem_limit: 64m
    volumes:
      - /:/host:ro
      - /srv/vault/metrics:/textfile:ro
    logging: *logging

volumes:
  generated:
  promdata:
  amdata:
````

`infra/ops/ops.env.example`:

````env
PROD_HOST=REPLACE_ME
DEV_HOST=REPLACE_ME
OPS_BASIC_AUTH_USER=REPLACE_ME
OPS_BASIC_AUTH_PASSWORD=REPLACE_ME
MATTERMOST_WEBHOOK_URL=REPLACE_ME
````

`infra/ops/render.py`:

````python
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
````

- [ ] **Step 2: Prometheus 설정, 규칙, 단위 시험 작성**

`infra/ops/prometheus/prometheus.yml`:

````yaml
# 서버 B의 Prometheus 설정(설계 9.3절). A를 밖에서 보는 프로브와 B 자신, 금고·포트 감사 지표(node-exporter의 textfile)를 본다.
# 프로브 대상은 ops-init이 /generated/targets에 만든다(A의 주소는 서버마다 다르다). 규칙은 rules/, 단위 시험은 tests/다.
# B의 알림은 모두 prod에 관한 것이라 env=prod를 외부 라벨로 둔다(Alertmanager가 prod 수신자로 보낸다).
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    site: B
    env: prod

rule_files:
  - rules/*.yml

alerting:
  alertmanagers:
    - static_configs:
        - targets: [alertmanager-b:9093]

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: [localhost:9090]

  - job_name: alertmanager
    static_configs:
      - targets: [alertmanager-b:9093]

  - job_name: node
    static_configs:
      - targets: [node-exporter:9100]

  - job_name: blackbox
    static_configs:
      - targets: [blackbox:9115]

  # A를 밖에서 두드리는 프로브. 모듈은 대상 파일의 module 라벨이고 어떤 프로브인지는 probe 라벨이다(알림 규칙이 이 라벨로 고른다)
  - job_name: a-probe
    metrics_path: /probe
    file_sd_configs:
      - files: [/generated/targets/a-probes.yml]
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [module]
        target_label: __param_module
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox:9115
````

`infra/ops/prometheus/rules/probes.yml`:

````yaml
# B가 A를 밖에서 본다(설계 9.3절). 프로브는 blackbox가 하고 어떤 프로브인지는 probe 라벨이다(대상 파일은 infra/ops/render.py가 만든다).
# 모든 알림은 runbook(설계 10.2절의 RB-번호)과 severity를 갖고 prometheus/tests/에 단위 시험이 있다(infra/ci/check_alerts.py가 검사한다).
groups:
  - name: fit-external
    rules:
      - alert: FitExternalDown
        expr: probe_success{probe=~"a-healthz|a-fe"} == 0
        for: 2m
        labels: {severity: critical}
        annotations:
          summary: 밖에서 본 A가 응답하지 않는다({{ $labels.probe }})
          description: "{{ $labels.instance }}가 2분 넘게 200을 주지 않는다. A가 죽었거나 엣지(Caddy)·BE·FE에 문제가 있다"
          runbook: RB-02

      - alert: FitCertExpiringSoon
        expr: (probe_ssl_earliest_cert_expiry{probe=~"a-tls-.*"} - time()) < 14 * 86400 and (probe_ssl_earliest_cert_expiry{probe=~"a-tls-.*"} - time()) >= 7 * 86400
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: 인증서가 14일 안에 만료된다({{ $labels.probe }})
          description: 남은 시간 {{ $value | humanizeDuration }}. Caddy가 자동 갱신해야 하는 시점이 지났다
          runbook: RB-05

      - alert: FitCertExpiringCritical
        expr: (probe_ssl_earliest_cert_expiry{probe=~"a-tls-.*"} - time()) < 7 * 86400
        for: 5m
        labels: {severity: critical}
        annotations:
          summary: 인증서가 7일 안에 만료된다({{ $labels.probe }})
          description: 남은 시간 {{ $value | humanizeDuration }}(음수면 이미 만료). 80번 포트와 DNS, 인증서 발급 한도를 본다
          runbook: RB-05

      - alert: FitTlsProbeFailed
        expr: probe_success{probe=~"a-tls-.*"} == 0
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: 인증서 확인을 위한 TLS 연결이 실패한다({{ $labels.probe }})
          description: "{{ $labels.instance }}에 TLS로 접속하지 못한다. 만료일을 읽을 수 없다"
          runbook: RB-05

      - alert: FitPortUnreachable
        expr: probe_success{probe=~"a-tcp-(80|443)"} == 0
        for: 2m
        labels: {severity: critical}
        annotations:
          summary: A의 {{ $labels.instance }} 포트에 닿지 못한다
          description: 80(인증서 갱신과 301)과 443(서비스)은 항상 열려 있어야 한다. 방화벽과 ufw, Caddy를 본다
          runbook: RB-01

      # 감시 체계 감시: A의 Prometheus와 Alertmanager가 살아 있는지 /_ops 경로로 본다(B의 IP와 basic auth가 필요하다)
      - alert: FitOpsWatcherDown
        expr: probe_success{probe=~"a-prometheus|a-alertmanager"} == 0
        for: 2m
        labels: {severity: critical}
        annotations:
          summary: A의 감시 체계({{ $labels.probe }})가 응답하지 않는다
          description: "{{ $labels.instance }}가 2분 넘게 200을 주지 않는다. A의 알림이 조용해졌을 수 있다. A에서 fit-obs를 본다"
          runbook: RB-01

      - alert: FitProbeMetricMissing
        expr: absent(probe_success{probe="a-healthz"})
        for: 15m
        labels: {severity: warning}
        annotations:
          summary: A 프로브 지표(probe_success)가 없다
          description: ops-init이 대상 파일을 만들지 못했거나 blackbox가 죽었다. ops.env와 컨테이너를 본다
          runbook: RB-01
````

`infra/ops/prometheus/rules/vault.yml`:

````yaml
# 백업 금고(B)와 포트 노출 감사 알림(설계 8절, 9.3절). 지표는 계획 1D의 vault-ingest.sh(fit_vault.prom)와 이 디렉터리의 port-audit.py(fit_portaudit_*.prom)가
# /srv/vault/metrics에 쓰고 node-exporter의 textfile collector가 읽는다. A가 죽어도 B가 백업 수신 중단을 감지한다.
groups:
  - name: fit-vault
    rules:
      - alert: FitVaultStale
        expr: time() - fit_vault_last_received_timestamp_seconds{kind="pg"} > 8 * 3600
        for: 5m
        labels: {severity: critical}
        annotations:
          summary: 금고가 Postgres 백업을 8시간 넘게 받지 못했다(주기는 4시간)
          description: 마지막 수신 후 {{ $value | humanizeDuration }}. A가 죽었거나 전송이 막혔거나 검증에서 격리됐다
          runbook: RB-06

      - alert: FitVaultRestoreCheckOverdue
        expr: time() - fit_vault_last_restore_check_timestamp_seconds > 8 * 86400
        for: 5m
        labels: {severity: info}
        annotations:
          summary: 복원 리허설을 8일 넘게 하지 않았다(주 1회)
          description: 마지막 리허설 후 {{ $value | humanizeDuration }}. infra/backup/restore-check.sh로 리허설하고 결과를 기록한다
          runbook: RB-06

      - alert: FitVaultQuarantine
        expr: fit_vault_quarantined_files > 0
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: 금고에 격리된 파일이 있다
          description: 격리 파일 {{ $value | printf "%.0f" }}개. 검증에 실패했거나 짝이 없는 파일이다. /srv/vault/store/quarantine을 본다
          runbook: RB-06

      - alert: FitVaultIngestFailing
        expr: increase(fit_vault_ingest_failures_total[1h]) > 0
        labels: {severity: warning}
        annotations:
          summary: 금고가 최근 1시간에 받은 백업을 검증에서 거부했다
          description: 검증 실패 {{ $value | printf "%.0f" }}건(1시간). A의 백업과 전송을 본다
          runbook: RB-06

      - alert: FitVaultIngestStale
        expr: time() - fit_vault_ingest_last_run_timestamp_seconds > 3600
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: 금고의 ingest(10분 주기)가 1시간 넘게 돌지 않았다
          description: 마지막 실행 후 {{ $value | humanizeDuration }}. systemctl status fit-vault-ingest.timer 를 본다
          runbook: RB-06

      - alert: FitVaultMetricMissing
        expr: absent(fit_vault_last_received_timestamp_seconds{kind="pg"})
        for: 30m
        labels: {severity: warning}
        annotations:
          summary: 금고 지표(fit_vault.prom)가 없다
          description: infra/backup/install.sh ops 와 vault-ingest 타이머, /srv/vault/metrics 마운트를 본다
          runbook: RB-06

  - name: fit-port-audit
    rules:
      - alert: FitPortExposed
        expr: fit_portaudit_unexpected_ports > 0
        labels: {severity: critical}
        annotations:
          summary: 밖에서 본 A에 22·80·443 말고 열린 포트가 있다({{ $labels.mode }} 스캔)
          description: 예상 밖 열린 포트 {{ $value | printf "%.0f" }}개. fit_portaudit_port_open 지표의 port 라벨이 그 번호다. 컨테이너 게시와 ufw를 본다
          runbook: RB-01

      - alert: FitPortAuditStale
        expr: time() - fit_portaudit_last_scan_timestamp_seconds{mode="quick"} > 3600 or time() - fit_portaudit_last_scan_timestamp_seconds{mode="full"} > 36 * 3600
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: 포트 노출 감사가 오래 돌지 않았다({{ $labels.mode }} 스캔)
          description: 마지막 스캔 후 {{ $value | humanizeDuration }}(quick은 15분마다, full은 매일). systemctl status fit-port-audit-{{ $labels.mode }}.timer 를 본다
          runbook: RB-01

      - alert: FitPortAuditMissing
        expr: absent(fit_portaudit_last_scan_timestamp_seconds{mode="quick"})
        for: 30m
        labels: {severity: warning}
        annotations:
          summary: 포트 노출 감사 지표(fit_portaudit_quick.prom)가 없다
          description: infra/ops/install.sh 가 끝났는지, 타이머와 /srv/vault/metrics 마운트를 본다
          runbook: RB-01
````

`infra/ops/prometheus/rules/host.yml`:

````yaml
# B 자신의 알림(설계 9.3절). B는 작은 서버(메모리 4GB)라 CI와 금고가 함께 쓴다.
groups:
  - name: fit-ops-host
    rules:
      - alert: FitOpsDiskHigh
        expr: 1 - node_filesystem_avail_bytes{mountpoint="/", fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{mountpoint="/", fstype!~"tmpfs|overlay"} > 0.8
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: B의 디스크 사용률이 80%를 넘었다
          description: 루트 파일시스템 사용률 {{ $value | humanizePercentage }}. CI 이미지 캐시와 금고 보관소를 본다
          runbook: RB-04

      - alert: FitOpsMemoryLow
        expr: node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.08
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: B의 가용 메모리가 8% 미만이다
          description: 가용 메모리 비율 {{ $value | humanizePercentage }}. CI verify 작업이 한도를 넘었을 수 있다
          runbook: RB-03

      - alert: FitOpsScrapeTargetDown
        expr: up{job=~"prometheus|alertmanager|node|blackbox"} == 0
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: B의 수집 대상 {{ $labels.job }}이(가) 응답하지 않는다
          description: "{{ $labels.job }}({{ $labels.instance }})의 up이 0이다. 이 대상의 알림은 조용해진다"
          runbook: RB-01
````

`infra/ops/prometheus/tests/probes.test.yml`:

````yaml
# rules/probes.yml 단위 시험
rule_files:
  - ../rules/probes.yml
evaluation_interval: 1m

tests:
  # /healthz가 2분 넘게 실패하면 울리고, 잘 되는 프로브와 다른 프로브(tcp)는 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'probe_success{probe="a-healthz", instance="https://fit.example.test/healthz", module="http_2xx"}'
        values: '1 1 0 0 0 0 0 0'
      - series: 'probe_success{probe="a-fe", instance="https://fit.example.test/", module="http_2xx"}'
        values: '1+0x7'
    alert_rule_test:
      - eval_time: 2m
        alertname: FitExternalDown
        exp_alerts: []
      - eval_time: 6m
        alertname: FitExternalDown
        exp_alerts:
          - exp_labels: {severity: critical, probe: a-healthz, instance: "https://fit.example.test/healthz", module: http_2xx}
            exp_annotations:
              summary: 밖에서 본 A가 응답하지 않는다(a-healthz)
              description: "https://fit.example.test/healthz가 2분 넘게 200을 주지 않는다. A가 죽었거나 엣지(Caddy)·BE·FE에 문제가 있다"
              runbook: RB-02

  # 인증서: 남은 시간 10일은 경고만, 5일은 위험만, 20일은 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'probe_ssl_earliest_cert_expiry{probe="a-tls-prod", instance="fit.example.test:443"}'
        values: '864000+0x10'
      - series: 'probe_ssl_earliest_cert_expiry{probe="a-tls-dev", instance="dev.example.test:443"}'
        values: '432000+0x10'
      - series: 'probe_ssl_earliest_cert_expiry{probe="a-tls-old", instance="far.example.test:443"}'
        values: '1728000+0x10'
    alert_rule_test:
      - eval_time: 8m
        alertname: FitCertExpiringSoon
        exp_alerts:
          - exp_labels: {severity: warning, probe: a-tls-prod, instance: "fit.example.test:443"}
            exp_annotations:
              summary: 인증서가 14일 안에 만료된다(a-tls-prod)
              description: 남은 시간 9d 23h 52m 0s. Caddy가 자동 갱신해야 하는 시점이 지났다
              runbook: RB-05
      - eval_time: 8m
        alertname: FitCertExpiringCritical
        exp_alerts:
          - exp_labels: {severity: critical, probe: a-tls-dev, instance: "dev.example.test:443"}
            exp_annotations:
              summary: 인증서가 7일 안에 만료된다(a-tls-dev)
              description: 남은 시간 4d 23h 52m 0s(음수면 이미 만료). 80번 포트와 DNS, 인증서 발급 한도를 본다
              runbook: RB-05

  # 이미 만료된 인증서(남은 시간이 음수)는 위험이다
  - interval: 1m
    input_series:
      - series: 'probe_ssl_earliest_cert_expiry{probe="a-tls-prod", instance="fit.example.test:443"}'
        values: '0+0x10'
    alert_rule_test:
      - eval_time: 8m
        alertname: FitCertExpiringCritical
        exp_alerts:
          - exp_labels: {severity: critical, probe: a-tls-prod, instance: "fit.example.test:443"}
            exp_annotations:
              summary: 인증서가 7일 안에 만료된다(a-tls-prod)
              description: 남은 시간 -8m 0s(음수면 이미 만료). 80번 포트와 DNS, 인증서 발급 한도를 본다
              runbook: RB-05

  # TLS 연결이 5분 넘게 실패하면 울린다
  - interval: 1m
    input_series:
      - series: 'probe_success{probe="a-tls-prod", instance="fit.example.test:443", module="tcp_tls"}'
        values: '0+0x10'
    alert_rule_test:
      - eval_time: 8m
        alertname: FitTlsProbeFailed
        exp_alerts:
          - exp_labels: {severity: warning, probe: a-tls-prod, instance: "fit.example.test:443", module: tcp_tls}
            exp_annotations:
              summary: 인증서 확인을 위한 TLS 연결이 실패한다(a-tls-prod)
              description: "fit.example.test:443에 TLS로 접속하지 못한다. 만료일을 읽을 수 없다"
              runbook: RB-05

  # 80·443 TCP 프로브가 실패하면 울린다. 22번이나 다른 프로브는 이 알림이 아니다
  - interval: 1m
    input_series:
      - series: 'probe_success{probe="a-tcp-443", instance="fit.example.test:443", module="tcp_connect"}'
        values: '1 1 0 0 0 0 0 0'
      - series: 'probe_success{probe="a-tcp-80", instance="fit.example.test:80", module="tcp_connect"}'
        values: '1+0x7'
    alert_rule_test:
      - eval_time: 6m
        alertname: FitPortUnreachable
        exp_alerts:
          - exp_labels: {severity: critical, probe: a-tcp-443, instance: "fit.example.test:443", module: tcp_connect}
            exp_annotations:
              summary: A의 fit.example.test:443 포트에 닿지 못한다
              description: 80(인증서 갱신과 301)과 443(서비스)은 항상 열려 있어야 한다. 방화벽과 ufw, Caddy를 본다
              runbook: RB-01

  # 감시 체계 감시: A의 Prometheus /_ops 프로브가 실패하면 울린다
  - interval: 1m
    input_series:
      - series: 'probe_success{probe="a-prometheus", instance="https://fit.example.test/_ops/prometheus/healthy", module="http_ops"}'
        values: '1 1 0 0 0 0 0 0'
      - series: 'probe_success{probe="a-alertmanager", instance="https://fit.example.test/_ops/alertmanager/healthy", module="http_ops"}'
        values: '1+0x7'
    alert_rule_test:
      - eval_time: 6m
        alertname: FitOpsWatcherDown
        exp_alerts:
          - exp_labels: {severity: critical, probe: a-prometheus, instance: "https://fit.example.test/_ops/prometheus/healthy", module: http_ops}
            exp_annotations:
              summary: A의 감시 체계(a-prometheus)가 응답하지 않는다
              description: "https://fit.example.test/_ops/prometheus/healthy가 2분 넘게 200을 주지 않는다. A의 알림이 조용해졌을 수 있다. A에서 fit-obs를 본다"
              runbook: RB-01

  # 프로브 지표 자체가 없으면 15분 뒤 울린다
  - interval: 1m
    input_series:
      - series: 'up{job="blackbox"}'
        values: '1+0x30'
    alert_rule_test:
      - eval_time: 10m
        alertname: FitProbeMetricMissing
        exp_alerts: []
      - eval_time: 20m
        alertname: FitProbeMetricMissing
        exp_alerts:
          - exp_labels: {severity: warning, probe: a-healthz}
            exp_annotations:
              summary: A 프로브 지표(probe_success)가 없다
              description: ops-init이 대상 파일을 만들지 못했거나 blackbox가 죽었다. ops.env와 컨테이너를 본다
              runbook: RB-01
````

`infra/ops/prometheus/tests/vault.test.yml`:

````yaml
# rules/vault.yml 단위 시험(금고와 포트 노출 감사)
rule_files:
  - ../rules/vault.yml
evaluation_interval: 1m

tests:
  # 마지막 수신이 7시간 전이면 울리지 않고 9시간 전이면 울린다. photos 같은 다른 종류는 이 알림이 아니다
  - interval: 1m
    input_series:
      - series: 'fit_vault_last_received_timestamp_seconds{kind="pg"}'
        values: '0+0x600'
      - series: 'fit_vault_last_received_timestamp_seconds{kind="photos"}'
        values: '0+0x600'
    alert_rule_test:
      - eval_time: 7h
        alertname: FitVaultStale
        exp_alerts: []
      - eval_time: 9h
        alertname: FitVaultStale
        exp_alerts:
          - exp_labels: {severity: critical, kind: pg}
            exp_annotations:
              summary: 금고가 Postgres 백업을 8시간 넘게 받지 못했다(주기는 4시간)
              description: 마지막 수신 후 9h 0m 0s. A가 죽었거나 전송이 막혔거나 검증에서 격리됐다
              runbook: RB-06

  # 복원 리허설이 9일 전이면 info다
  - interval: 1m
    input_series:
      - series: 'fit_vault_last_restore_check_timestamp_seconds'
        values: '0+0x13500'
    alert_rule_test:
      - eval_time: 7d
        alertname: FitVaultRestoreCheckOverdue
        exp_alerts: []
      - eval_time: 9d
        alertname: FitVaultRestoreCheckOverdue
        exp_alerts:
          - exp_labels: {severity: info}
            exp_annotations:
              summary: 복원 리허설을 8일 넘게 하지 않았다(주 1회)
              description: 마지막 리허설 후 9d 0h 0m 0s. infra/backup/restore-check.sh로 리허설하고 결과를 기록한다
              runbook: RB-06

  # 격리 파일이 있으면 5분 뒤 울린다
  - interval: 1m
    input_series:
      - series: 'fit_vault_quarantined_files'
        values: '2+0x10'
    alert_rule_test:
      - eval_time: 8m
        alertname: FitVaultQuarantine
        exp_alerts:
          - exp_labels: {severity: warning}
            exp_annotations:
              summary: 금고에 격리된 파일이 있다
              description: 격리 파일 2개. 검증에 실패했거나 짝이 없는 파일이다. /srv/vault/store/quarantine을 본다
              runbook: RB-06
  - interval: 1m
    input_series:
      - series: 'fit_vault_quarantined_files'
        values: '0+0x10'
    alert_rule_test:
      - eval_time: 8m
        alertname: FitVaultQuarantine
        exp_alerts: []

  # 검증 실패 카운터가 1시간 안에 늘면 울린다. 그대로면 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'fit_vault_ingest_failures_total'
        values: '0 0 0 1 1 1 1'
      - series: 'fit_vault_ingest_failures_total{other="flat"}'
        values: '5 5 5 5 5 5 5'
    alert_rule_test:
      - eval_time: 5m
        alertname: FitVaultIngestFailing
        exp_alerts:
          - exp_labels: {severity: warning}
            exp_annotations:
              summary: 금고가 최근 1시간에 받은 백업을 검증에서 거부했다
              description: 검증 실패 1건(1시간). A의 백업과 전송을 본다
              runbook: RB-06

  # ingest가 1시간 넘게 안 돌면 울린다
  - interval: 1m
    input_series:
      - series: 'fit_vault_ingest_last_run_timestamp_seconds'
        values: '0+0x200'
    alert_rule_test:
      - eval_time: 30m
        alertname: FitVaultIngestStale
        exp_alerts: []
      - eval_time: 90m
        alertname: FitVaultIngestStale
        exp_alerts:
          - exp_labels: {severity: warning}
            exp_annotations:
              summary: 금고의 ingest(10분 주기)가 1시간 넘게 돌지 않았다
              description: 마지막 실행 후 1h 30m 0s. systemctl status fit-vault-ingest.timer 를 본다
              runbook: RB-06

  # 금고 지표가 없으면 30분 뒤 울린다
  - interval: 1m
    input_series:
      - series: 'up{job="node"}'
        values: '1+0x60'
    alert_rule_test:
      - eval_time: 20m
        alertname: FitVaultMetricMissing
        exp_alerts: []
      - eval_time: 40m
        alertname: FitVaultMetricMissing
        exp_alerts:
          - exp_labels: {severity: warning, kind: pg}
            exp_annotations:
              summary: 금고 지표(fit_vault.prom)가 없다
              description: infra/backup/install.sh ops 와 vault-ingest 타이머, /srv/vault/metrics 마운트를 본다
              runbook: RB-06

  # 포트 노출 감사: 예상 밖 열린 포트가 있으면 즉시 울리고 0이면 울리지 않는다
  - interval: 1m
    input_series:
      - series: 'fit_portaudit_unexpected_ports{mode="quick"}'
        values: '0 0 1 1 1'
      - series: 'fit_portaudit_unexpected_ports{mode="full"}'
        values: '0+0x4'
    alert_rule_test:
      - eval_time: 1m
        alertname: FitPortExposed
        exp_alerts: []
      - eval_time: 3m
        alertname: FitPortExposed
        exp_alerts:
          - exp_labels: {severity: critical, mode: quick}
            exp_annotations:
              summary: 밖에서 본 A에 22·80·443 말고 열린 포트가 있다(quick 스캔)
              description: 예상 밖 열린 포트 1개. fit_portaudit_port_open 지표의 port 라벨이 그 번호다. 컨테이너 게시와 ufw를 본다
              runbook: RB-01

  # 포트 감사가 오래 안 돌면 울린다(quick 1시간, full 36시간)
  - interval: 1m
    input_series:
      - series: 'fit_portaudit_last_scan_timestamp_seconds{mode="quick"}'
        values: '0+0x200'
      - series: 'fit_portaudit_last_scan_timestamp_seconds{mode="full"}'
        values: '0+60x200'
    alert_rule_test:
      - eval_time: 30m
        alertname: FitPortAuditStale
        exp_alerts: []
      - eval_time: 90m
        alertname: FitPortAuditStale
        exp_alerts:
          - exp_labels: {severity: warning, mode: quick}
            exp_annotations:
              summary: 포트 노출 감사가 오래 돌지 않았다(quick 스캔)
              description: 마지막 스캔 후 1h 30m 0s(quick은 15분마다, full은 매일). systemctl status fit-port-audit-quick.timer 를 본다
              runbook: RB-01

  # 포트 감사 지표가 없으면 30분 뒤 울린다
  - interval: 1m
    input_series:
      - series: 'up{job="node"}'
        values: '1+0x60'
    alert_rule_test:
      - eval_time: 20m
        alertname: FitPortAuditMissing
        exp_alerts: []
      - eval_time: 40m
        alertname: FitPortAuditMissing
        exp_alerts:
          - exp_labels: {severity: warning, mode: quick}
            exp_annotations:
              summary: 포트 노출 감사 지표(fit_portaudit_quick.prom)가 없다
              description: infra/ops/install.sh 가 끝났는지, 타이머와 /srv/vault/metrics 마운트를 본다
              runbook: RB-01
````

`infra/ops/prometheus/tests/host.test.yml`:

````yaml
# rules/host.yml 단위 시험(B 자신)
rule_files:
  - ../rules/host.yml
evaluation_interval: 1m

tests:
  - interval: 1m
    input_series:
      - series: 'node_filesystem_avail_bytes{instance="b", mountpoint="/", fstype="ext4", device="sda1"}'
        values: '15+0x12'
      - series: 'node_filesystem_size_bytes{instance="b", mountpoint="/", fstype="ext4", device="sda1"}'
        values: '100+0x12'
      - series: 'node_filesystem_avail_bytes{instance="b", mountpoint="/", fstype="tmpfs", device="tmpfs"}'
        values: '1+0x12'
      - series: 'node_filesystem_size_bytes{instance="b", mountpoint="/", fstype="tmpfs", device="tmpfs"}'
        values: '100+0x12'
    alert_rule_test:
      - eval_time: 10m
        alertname: FitOpsDiskHigh
        exp_alerts:
          - exp_labels: {severity: warning, instance: b, mountpoint: /, fstype: ext4, device: sda1}
            exp_annotations:
              summary: B의 디스크 사용률이 80%를 넘었다
              description: 루트 파일시스템 사용률 85%. CI 이미지 캐시와 금고 보관소를 본다
              runbook: RB-04

  - interval: 1m
    input_series:
      - series: 'node_memory_MemAvailable_bytes{instance="b"}'
        values: '5+0x12'
      - series: 'node_memory_MemTotal_bytes{instance="b"}'
        values: '100+0x12'
    alert_rule_test:
      - eval_time: 4m
        alertname: FitOpsMemoryLow
        exp_alerts: []
      - eval_time: 10m
        alertname: FitOpsMemoryLow
        exp_alerts:
          - exp_labels: {severity: warning, instance: b}
            exp_annotations:
              summary: B의 가용 메모리가 8% 미만이다
              description: 가용 메모리 비율 5%. CI verify 작업이 한도를 넘었을 수 있다
              runbook: RB-03

  - interval: 1m
    input_series:
      - series: 'up{job="blackbox", instance="blackbox:9115"}'
        values: '0+0x12'
      - series: 'up{job="node", instance="node-exporter:9100"}'
        values: '1+0x12'
    alert_rule_test:
      - eval_time: 10m
        alertname: FitOpsScrapeTargetDown
        exp_alerts:
          - exp_labels: {severity: warning, job: blackbox, instance: "blackbox:9115"}
            exp_annotations:
              summary: B의 수집 대상 blackbox이(가) 응답하지 않는다
              description: "blackbox(blackbox:9115)의 up이 0이다. 이 대상의 알림은 조용해진다"
              runbook: RB-01
````

- [ ] **Step 3: Alertmanager와 blackbox 설정 작성**

`infra/ops/alertmanager/alertmanager.yml`:

````yaml
# 서버 B의 Alertmanager 설정(설계 9.4절). B의 알림은 모두 prod에 관한 것이라 수신자는 하나다. critical은 더 자주 반복한다.
# 웹훅 주소는 파일에서 읽는다(ops-init이 만든다). 메시지 형식은 A의 것과 같다(infra/obs/alertmanager/templates).
templates:
  - /etc/alertmanager/templates/*.tmpl

route:
  receiver: main
  group_by: [alertname, site, env]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: [severity="critical"]
      receiver: main
      repeat_interval: 1h

inhibit_rules:
  - source_matchers: [severity="critical"]
    target_matchers: [severity="warning"]
    equal: [alertname, site, env]

receivers:
  - name: main
    slack_configs:
      - api_url_file: /generated/secrets/mattermost_url
        send_resolved: true
        title: '{{ template "fit.title" . }}'
        text: '{{ template "fit.text" . }}'
        color: '{{ template "fit.color" . }}'
````

`infra/ops/alertmanager/templates/fit.tmpl`:

````text
{{ define "fit.title" -}}
[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ .CommonLabels.alertname }} ({{ .CommonLabels.site }}{{ with .CommonLabels.env }}/{{ . }}{{ end }})
{{- end }}

{{ define "fit.text" -}}
{{ range .Alerts -}}
*{{ .Labels.severity | toUpper }}* {{ .Annotations.summary }}
{{ .Annotations.description }}
런북: {{ .Annotations.runbook }}
{{ end }}
{{- end }}

{{ define "fit.color" -}}
{{ if eq .Status "resolved" }}good{{ else if eq .CommonLabels.severity "critical" }}danger{{ else }}warning{{ end }}
{{- end }}
````

`infra/ops/alertmanager/routes.txt`:

````text
# 라우팅 시험(infra/ci/check-alertmanager.sh). 한 줄이 한 시험이다: <기대 수신자> <라벨=값>...
main severity=critical env=prod site=B alertname=FitExternalDown
main severity=warning env=prod site=B alertname=FitOpsDiskHigh
````

`infra/ops/blackbox/blackbox.yml`(모듈 견본. `ops-init`이 사용자 이름을 채워 `/generated/blackbox.yml`로 만든다):

````yaml
# B의 blackbox 모듈 견본(설계 9.3절). ops-init(render.py)이 @@OPS_BASIC_AUTH_USER@@를 채워 /generated/blackbox.yml로 만든다.
# 견본 그대로도 유효한 설정이라 CI가 형식을 검사한다. 인증서 검증은 켠 상태가 기본이다(시험에서만 render.py가 끈다).
modules:
  # A의 공개 주소가 HTTPS 200으로 응답한다
  http_2xx:
    prober: http
    timeout: 10s
    http:
      method: GET
      valid_status_codes: [200]
      fail_if_not_ssl: true
      preferred_ip_protocol: ip4
      tls_config:
        insecure_skip_verify: false

  # 포트가 열려 있다
  tcp_connect:
    prober: tcp
    timeout: 5s

  # TLS 핸드셰이크를 하고 인증서 만료 시각(probe_ssl_earliest_cert_expiry)을 읽는다. 호스트마다 인증서가 따로라 prod와 dev를 모두 본다
  tcp_tls:
    prober: tcp
    timeout: 10s
    tcp:
      tls: true
      tls_config:
        insecure_skip_verify: false

  # A의 /_ops 경로(설계 5.2절): B의 IP와 basic auth를 모두 통과해야 200이다. 비밀번호는 파일에서 읽는다
  http_ops:
    prober: http
    timeout: 10s
    http:
      method: GET
      valid_status_codes: [200]
      fail_if_not_ssl: true
      preferred_ip_protocol: ip4
      basic_auth:
        username: "@@OPS_BASIC_AUTH_USER@@"
        password_file: /generated/secrets/ops_password
      tls_config:
        insecure_skip_verify: false
````

- [ ] **Step 4: 정적 검증 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$PROMETHEUS_IMAGE" sh infra/ci/check-prometheus.sh 2>&1 | grep -E "^==|SUCCESS|FAIL|passed|failed" | sort | uniq -c
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$ALERTMANAGER_IMAGE" sh infra/ci/check-alertmanager.sh 2>&1 | grep -E "^==|^OK|FAIL"
python infra/ci/check_alerts.py
docker compose -f infra/ops/compose.ops.yml --env-file infra/ops/ops.env.example config -q && echo "ops config OK"
docker compose -f infra/ops/compose.ops.yml --env-file infra/ops/ops.env.example config --format json | python -c "
import json,sys
c=json.load(sys.stdin)
total=0
for n,s in c['services'].items():
    mem=int(s.get('mem_limit') or 0)
    if n != 'ops-init': total += mem
    print(n, mem // 1048576, 'MB', [p['host_ip'] + ':' + str(p['published']) for p in s.get('ports', [])])
print('합계', total // 1048576, 'MB')
"
python infra/ci/ports_invariant.py infra/ops/compose.ops.yml --env-file infra/ops/ops.env.example
python infra/ci/check_env_files.py infra/ops/ops.env.example
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml infra/ops; echo "yamllint exit=$?"
python infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/ops/compose.ops.yml --env-file infra/ops/ops.env.example
docker run --rm --network none -e GENERATED_DIR=/g -e PROD_HOST=a.example.test -e DEV_HOST=dev.example.test -e OPS_BASIC_AUTH_USER=opsuser -e OPS_BASIC_AUTH_PASSWORD=ops-test-password-aaaaaaaa -e MATTERMOST_WEBHOOK_URL=https://mm.example.test/hooks/a -e BLACKBOX_TEMPLATE=/b.yml -v "$W/infra/ops/render.py:/render.py:ro" -v "$W/infra/ops/blackbox/blackbox.yml:/b.yml:ro" "$PYTHON_IMAGE" python /render.py
docker run --rm --network none -e GENERATED_DIR=/g -e PROD_HOST=a.example.test -e DEV_HOST=dev.example.test -e OPS_BASIC_AUTH_USER=opsuser -e OPS_BASIC_AUTH_PASSWORD=short -e MATTERMOST_WEBHOOK_URL=https://mm.example.test/hooks/a -e BLACKBOX_TEMPLATE=/b.yml -v "$W/infra/ops/render.py:/render.py:ro" -v "$W/infra/ops/blackbox/blackbox.yml:/b.yml:ro" "$PYTHON_IMAGE" python /render.py; echo "exit=$?"
```

Expected: promtool은 `== infra/obs/prometheus`와 `== infra/ops/prometheus` 모두에서 설정 `SUCCESS: … is valid prometheus config file syntax`, `SUCCESS: 6 rule files found`(A)와 `SUCCESS: 3 rule files found`(B), 규칙 파일별 `SUCCESS: N rules found`, 단위 시험 아홉 파일의 `SUCCESS`(`9   SUCCESS`)를 낸다. amtool은 두 디렉터리의 라우팅 시험이 `OK`(A 여섯 줄, B 두 줄), 이어서 `OK alerts (2개 스택)`, `ops config OK`, 서비스 네 개와 `ops-init`이 한도와 함께 나오고 `127.0.0.1`의 `9090`, `9093`만 게시되며 `합계 352 MB`, `OK ports (5 service(s))`, `OK env (1 file(s))`, `yamllint exit=0`, `OK arch linux/arm64,linux/amd64 (5 image(s))`, `render.py`의 올바른 값은 `만들었다: /g/targets/a-probes.yml` 등 파일 이름만 출력한다(비밀번호와 웹훅 주소는 출력하지 않는다). 짧은 비밀번호는 `FAIL OPS_BASIC_AUTH_PASSWORD는 …16자 이상이어야 한다`와 `exit=1`이다.

- [ ] **Step 5: 커밋 (허용된 경우)**

```bash
git add infra/ops
git commit -m "feat(infra): B 감시 스택(Prometheus-B·Alertmanager-B·blackbox) 정의와 알림 규칙 19개 추가"
```

---

### Task 6: B 운영 스크립트

**목표:** B에서 A의 열린 포트를 감사하는 `port-audit.py`, 서버에 설치하는 `install.sh`와 systemd 유닛(quick 15분, full 매일 05:30), 스택을 올리는 `ops-up.sh`, 읽기 전용 점검 `verify-ops.sh`를 만든다.

**Files:**
- Create: `infra/ops/port-audit.py`, `infra/ops/install.sh`, `infra/ops/ops-up.sh`, `infra/ops/verify-ops.sh`, `infra/ops/conf/systemd/fit-port-audit-quick.service`, `infra/ops/conf/systemd/fit-port-audit-quick.timer`, `infra/ops/conf/systemd/fit-port-audit-full.service`, `infra/ops/conf/systemd/fit-port-audit-full.timer`

**Interfaces:**
- Consumes: Task 5의 스택(프로젝트 `fit-ops`), 1C-2의 `infra/deploy/lib.sh`(`find_python`), `/etc/fit/ops.env`의 `PROD_HOST`
- Produces: `python3 infra/ops/port-audit.py --target <호스트> --mode quick|full [--expected 22,80,443] [--out /srv/vault/metrics]`(지표 `fit_portaudit_*`를 `fit_portaudit_<mode>.prom`에 원자적으로 쓴다. 예상 밖 포트가 있어도 종료 코드 0, 감사를 못 하면 1), `sudo bash infra/ops/install.sh`(멱등. `FIT_SKIP=apt,systemd`, `FIT_OPS_ROOT`, `FIT_SYSTEMD_DIR`, `FIT_ENV_DIR`, `FIT_VAULT_DIR`, `FIT_VAULT_METRICS_DIR`), `sudo bash infra/ops/ops-up.sh`(`FIT_ENV_DIR`, `FIT_OPS_PROJECT`, `FIT_OPS_COMPOSE`), `verify-ops.sh`(PASS·FAIL·SKIP. `FIT_OPS_PROJECT`, `FIT_SKIP=systemd`)

핵심 결정:

- 포트 감사는 표준 라이브러리만 쓰는 TCP connect 스캔이다. `quick`은 1~1,024번과 자주 쓰는 서비스 포트 44개(DB, 캐시, 관리 UI, 이 프로젝트의 내부 포트), `full`은 1~65,535번이다. 지표는 임시 파일에 쓴 뒤 이름을 바꾼다(node-exporter가 쓰다 만 파일을 읽지 않게). 이 스캔은 우리 서버(A)에만 건다.
- 감사를 못 하면(주소 해석 실패 등) 종료 코드 1이고 지표를 갱신하지 않는다. 오래된 지표는 `FitPortAuditStale`(quick 1시간, full 36시간)이 잡는다.
- `install.sh`는 `ops.env`를 예제에서 만들되(600 root:root) `PROD_HOST`가 채워진 뒤에만 감사 타이머를 켠다. 코드는 root 소유 사본(`/usr/local/lib/fit/ops`)에 둔다.
- `ops-up.sh`는 `REPLACE_ME`가 남았거나 `ops.env`의 권한이 600·640이 아니면 올리지 않는다(비밀이 든다). 이미 떠 있으면 같은 결과다.

- [ ] **Step 1: 포트 감사와 스크립트 작성**

`infra/ops/port-audit.py`:

````python
#!/usr/bin/env python3
"""포트 노출 감사(설계 9.3절). B가 A를 밖에서 TCP로 두드려 22·80·443 말고 열린 포트가 있는지 본다. 표준 라이브러리만 쓴다.

  python3 infra/ops/port-audit.py --target <A의 호스트> --mode quick|full [--expected 22,80,443] [--out /srv/vault/metrics]

quick은 잘 알려진 포트(1~1024와 자주 쓰는 서비스 포트)를 15분마다, full은 1~65535 전체를 매일 본다. 결과는 Prometheus textfile 형식
(`fit_portaudit_<mode>.prom`)으로 쓰고 node-exporter가 읽는다. 예상 밖 포트가 열려 있어도 종료 코드는 0이다(알림은 지표가 건다).
이름을 풀지 못하는 등 감사를 하지 못하면 종료 코드 1이고 지표를 갱신하지 않는다(오래된 지표는 FitPortAuditStale이 잡는다).
이 스캔은 우리 서버(A)에만 건다. 다른 호스트에 쓰지 않는다.
"""
from __future__ import annotations

import argparse
import asyncio
import pathlib
import re
import socket
import sys
import time

# quick 스캔에 1~1024와 함께 보는 서비스 포트(DB, 캐시, 관리 UI, 이 프로젝트가 쓰는 내부 포트 등)
EXTRA = [
    1433, 1521, 2049, 2375, 2376, 2379, 3000, 3306, 3389, 4222, 5000, 5432, 5601, 5672, 5900, 6379, 6443, 7000,
    8000, 8008, 8080, 8081, 8082, 8086, 8443, 8500, 8888, 9000, 9042, 9090, 9093, 9100, 9115, 9180, 9200, 9300,
    9411, 11211, 15432, 15672, 16379, 19200, 27017, 50000,
]
HOST = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")


def ports_for(mode: str) -> list[int]:
    if mode == "full":
        return list(range(1, 65536))
    return sorted(set(range(1, 1025)) | set(EXTRA))


async def probe(host: str, port: int, timeout: float, sem: asyncio.Semaphore) -> int | None:
    async with sem:
        try:
            _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
        except (OSError, asyncio.TimeoutError):
            return None
        writer.close()
        try:
            await writer.wait_closed()
        except OSError:
            pass
        return port


async def scan(host: str, ports: list[int], timeout: float, concurrency: int) -> list[int]:
    sem = asyncio.Semaphore(concurrency)
    found = await asyncio.gather(*(probe(host, p, timeout, sem) for p in ports))
    return sorted(p for p in found if p is not None)


def render(mode: str, started: float, duration: float, open_ports: list[int], expected: set[int]) -> str:
    unexpected = [p for p in open_ports if p not in expected]
    lines = [
        "# HELP fit_portaudit_last_scan_timestamp_seconds 마지막으로 스캔을 끝낸 시각(UTC epoch)",
        "# TYPE fit_portaudit_last_scan_timestamp_seconds gauge",
        f'fit_portaudit_last_scan_timestamp_seconds{{mode="{mode}"}} {int(started + duration)}',
        "# HELP fit_portaudit_scan_duration_seconds 스캔에 걸린 시간",
        "# TYPE fit_portaudit_scan_duration_seconds gauge",
        f'fit_portaudit_scan_duration_seconds{{mode="{mode}"}} {duration:.1f}',
        "# HELP fit_portaudit_open_ports 밖에서 열려 있는 포트 수",
        "# TYPE fit_portaudit_open_ports gauge",
        f'fit_portaudit_open_ports{{mode="{mode}"}} {len(open_ports)}',
        "# HELP fit_portaudit_unexpected_ports 예상(22, 80, 443) 밖에서 열려 있는 포트 수",
        "# TYPE fit_portaudit_unexpected_ports gauge",
        f'fit_portaudit_unexpected_ports{{mode="{mode}"}} {len(unexpected)}',
        "# HELP fit_portaudit_port_open 예상 밖에서 열려 있는 포트(값은 항상 1)",
        "# TYPE fit_portaudit_port_open gauge",
    ]
    lines += [f'fit_portaudit_port_open{{mode="{mode}",port="{p}"}} 1' for p in unexpected]
    return "\n".join(lines) + "\n"


def write_atomic(path: pathlib.Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.chmod(0o644)
    tmp.replace(path)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, help="스캔할 호스트(A의 공개 호스트 이름이나 IP)")
    ap.add_argument("--mode", choices=["quick", "full"], required=True)
    ap.add_argument("--expected", default="22,80,443", help="열려 있어야 하는 포트(쉼표)")
    ap.add_argument("--out", default="/srv/vault/metrics", help="지표 파일을 쓸 디렉터리")
    ap.add_argument("--timeout", type=float, default=None, help="포트마다 기다리는 초(기본 quick 3, full 1.5)")
    ap.add_argument("--concurrency", type=int, default=500)
    args = ap.parse_args(argv)
    if not HOST.match(args.target) and not re.match(r"^\d{1,3}(\.\d{1,3}){3}$", args.target):
        print("FAIL --target은 호스트 이름이나 IPv4 주소여야 한다", file=sys.stderr)
        return 1
    try:
        expected = {int(p) for p in args.expected.split(",") if p}
    except ValueError:
        print("FAIL --expected는 쉼표로 구분한 포트 번호다", file=sys.stderr)
        return 1
    try:
        ip = socket.getaddrinfo(args.target, None, socket.AF_INET)[0][4][0]
    except OSError as e:
        print(f"FAIL {args.target}의 주소를 찾지 못했다({e})", file=sys.stderr)
        return 1
    timeout = args.timeout if args.timeout is not None else (3.0 if args.mode == "quick" else 1.5)
    started = time.time()
    open_ports = asyncio.run(scan(ip, ports_for(args.mode), timeout, args.concurrency))
    duration = time.time() - started
    unexpected = [p for p in open_ports if p not in expected]
    write_atomic(pathlib.Path(args.out) / f"fit_portaudit_{args.mode}.prom", render(args.mode, started, duration, open_ports, expected))
    print(f"{args.mode} 스캔 {duration:.1f}초: 열린 포트 {open_ports}, 예상 밖 {unexpected}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
````

`infra/ops/install.sh`:

````bash
#!/usr/bin/env bash
# 서버 B에 감시 구성을 설치한다. 몇 번 실행해도 같은 결과다(멱등). root로 실행한다.
#   sudo bash infra/ops/install.sh
# 하는 일: 포트 노출 감사 스크립트의 root 소유 사본, 지표 디렉터리, ops.env(없으면 예제에서), 감사 타이머(quick 15분, full 매일).
# 타이머가 도는 코드는 저장소 체크아웃이 아니라 root만 쓸 수 있는 사본($FIT_OPS_ROOT, 기본 /usr/local/lib/fit/ops)이다(infra/backup/install.sh와 같은 이유).
# 감시 스택(prometheus-b 등)은 이 스크립트가 올리지 않는다. ops.env를 채운 뒤 `bash infra/ops/ops-up.sh`로 올린다.
# 타이머는 ops.env의 PROD_HOST가 채워진 뒤에 켠다. 채우기 전에 실행했다면 채운 뒤 이 스크립트를 다시 실행한다.
# 환경변수(선택): FIT_SKIP(쉼표로 구분, 시험용) apt, systemd. FIT_OPS_ROOT, FIT_SYSTEMD_DIR(/etc/systemd/system), FIT_ENV_DIR(/etc/fit),
#   FIT_VAULT_DIR(/srv/vault), FIT_VAULT_METRICS_DIR($FIT_VAULT_DIR/metrics)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SKIP=",${FIT_SKIP:-},"
OPS_ROOT="${FIT_OPS_ROOT:-/usr/local/lib/fit/ops}"
SYSTEMD_DIR="${FIT_SYSTEMD_DIR:-/etc/systemd/system}"
ENV_DIR="${FIT_ENV_DIR:-/etc/fit}"
VAULT_DIR="${FIT_VAULT_DIR:-/srv/vault}"
VAULT_METRICS_DIR="${FIT_VAULT_METRICS_DIR:-$VAULT_DIR/metrics}"
UNITS=(fit-port-audit-quick.service fit-port-audit-quick.timer fit-port-audit-full.service fit-port-audit-full.timer)
CHANGES=0
PUT=0

step() { printf '\n== %s\n' "$*"; }
log() { printf '%s\n' "$*"; }
die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
skipped() { case "$SKIP" in *",$1,"*) log "건너뜀($1)"; return 0 ;; esac; return 1; }
changed() { CHANGES=$((CHANGES + 1)); log "변경: $*"; }

# put_file 원본 대상 모드: 내용, 모드, 소유자 중 하나라도 다르면 설치하고 PUT=1로 둔다
put_file() {
  local src="$1" dst="$2" mode="$3"
  PUT=0
  if [ -f "$dst" ] && cmp -s "$src" "$dst" && [ "$(stat -c %a "$dst")" = "$mode" ] && [ "$(stat -c %U:%G "$dst")" = root:root ]; then
    return 0
  fi
  install -D -m "$mode" -o root -g root "$src" "$dst"
  PUT=1
  changed "$dst"
}
ensure_dir() { # ensure_dir 경로 모드
  if [ -d "$1" ] && [ "$(stat -c %a "$1")" = "$2" ] && [ "$(stat -c %U:%G "$1")" = root:root ]; then return 0; fi
  install -d -m "$2" -o root -g root "$1"
  changed "디렉터리 $1"
}

[ "$(id -u)" = 0 ] || die "root로 실행한다(sudo)"
for f in "$REPO/infra/ops/port-audit.py" "$REPO/infra/ops/ops.env.example" "$HERE/conf/systemd/${UNITS[0]}"; do
  [ -e "$f" ] || die "저장소 구조가 맞지 않는다: $f"
done

step "패키지"
if skipped apt; then :
elif command -v python3 >/dev/null 2>&1; then log "필요한 패키지가 이미 있다"
else
  apt-get -o Acquire::Retries=3 update -qq
  DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y -qq python3 >/dev/null
  changed "패키지 python3"
fi

step "코드 사본 $OPS_ROOT"
ensure_dir "$OPS_ROOT" 755
put_file "$REPO/infra/ops/port-audit.py" "$OPS_ROOT/port-audit.py" 755

step "디렉터리와 설정"
ensure_dir "$VAULT_METRICS_DIR" 755
if [ ! -e "$ENV_DIR/ops.env" ]; then
  install -D -m 600 -o root -g root "$REPO/infra/ops/ops.env.example" "$ENV_DIR/ops.env"
  changed "$ENV_DIR/ops.env(예제에서 만들었다. 값을 채운다)"
fi
READY=0
if prod="$(grep -E '^PROD_HOST=' "$ENV_DIR/ops.env" | head -n 1 | cut -d= -f2-)" && [ -n "$prod" ] && [ "${prod#*REPLACE_ME}" = "$prod" ]; then READY=1; fi

step "systemd 유닛"
any=0
for f in "${UNITS[@]}"; do
  put_file "$HERE/conf/systemd/$f" "$SYSTEMD_DIR/$f" 644
  [ "$PUT" = 0 ] || any=1
done
if [ "$READY" = 0 ]; then log "타이머는 켜지 않았다(ops.env의 PROD_HOST가 아직 비어 있다)"; fi
if ! skipped systemd; then
  if [ "$any" = 1 ]; then systemctl daemon-reload; fi
  if [ "$READY" = 1 ]; then
    for f in "${UNITS[@]}"; do
      case "$f" in *.timer) systemctl enable --now "$f" >/dev/null 2>&1 ;; esac
    done
  fi
fi

step "남은 수동 단계"
if [ "$READY" = 0 ]; then log "1. $ENV_DIR/ops.env 의 값을 채운 뒤 이 스크립트를 다시 실행해 감사 타이머를 켠다"; fi
log "2. 감시 스택을 올린다: bash infra/ops/ops-up.sh"
log "3. 점검한다: bash infra/ops/verify-ops.sh"
log "변경 $CHANGES건"
````

`infra/ops/ops-up.sh`:

````bash
#!/usr/bin/env bash
# 서버 B의 감시 스택(프로젝트 fit-ops)을 올린다. 몇 번 실행해도 같은 결과다(이미 떠 있으면 설정이 바뀐 서비스만 다시 만든다).
#   sudo bash infra/ops/ops-up.sh
# 값은 $FIT_ENV_DIR/ops.env(기본 /etc/fit/ops.env)에서 읽는다. REPLACE_ME가 남아 있으면 올리지 않는다.
# 환경변수(선택): FIT_ENV_DIR, FIT_OPS_PROJECT(fit-ops), FIT_OPS_COMPOSE(compose 파일. 시험용)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${FIT_ENV_DIR:-/etc/fit}/ops.env"
COMPOSE="${FIT_OPS_COMPOSE:-$HERE/compose.ops.yml}"
PROJECT="${FIT_OPS_PROJECT:-fit-ops}"

[ -f "$ENV_FILE" ] || {
  echo "FAIL $ENV_FILE가 없다. 먼저 sudo bash infra/ops/install.sh 를 실행한다" >&2
  exit 1
}
if grep -q 'REPLACE_ME' "$ENV_FILE"; then
  echo "FAIL $ENV_FILE에 자리표시자(REPLACE_ME)가 남아 있다. 값을 채운다" >&2
  exit 1
fi
if [ "$(stat -c %a "$ENV_FILE")" != 600 ] && [ "$(stat -c %a "$ENV_FILE")" != 640 ]; then
  echo "FAIL $ENV_FILE의 권한이 600이나 640이 아니다(비밀이 들어 있다)" >&2
  exit 1
fi
docker compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV_FILE" up -d --wait --wait-timeout 300
echo "$PROJECT가 올라왔다. 점검: bash infra/ops/verify-ops.sh"
````

`infra/ops/verify-ops.sh`:

````bash
#!/usr/bin/env bash
# 서버 B의 감시 구성이 설계대로 떠 있는지 점검한다(설계 9.3절). 읽기만 하고 아무것도 바꾸지 않는다. 점검마다 PASS, FAIL, SKIP만 출력하고 값은 찍지 않는다.
#   bash infra/ops/verify-ops.sh
# 컨테이너 안에서 API를 불러(docker exec) 호스트에 게시된 포트가 없어도 돈다. 하나라도 FAIL이면 종료 코드 1이다.
# 환경변수: FIT_OPS_PROJECT(fit-ops), FIT_SKIP=systemd(포트 감사 타이머를 보지 않는다. 시험용). A가 아직 배포 전이면 A를 보는 프로브와 금고 지표는 SKIP으로 센다.
set -uo pipefail
export PYTHONUTF8=1
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../deploy/lib.sh"

PROJECT="${FIT_OPS_PROJECT:-fit-ops}"
PY="$(find_python)" || {
  echo "FAIL python 3.9 이상이 필요하다" >&2
  exit 1
}
FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }
ok_if() { if [ "$2" = 1 ]; then pass "$1"; else fail "$1"; fi; }

cid() { docker ps -a -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n 1; }
api() { docker exec "$(cid "$1")" wget -qO- "$2" 2>/dev/null; } # api 서비스 URL: 그 컨테이너 안에서 읽는다
pyjson() { "$PY" -c "$1"; } # 표준 입력의 JSON을 파이썬 식으로 판정한다
query() { api prometheus-b "http://localhost:9090/api/v1/query?query=$1"; } # query 식(URL 인코딩된 식): 결과 JSON
count_of() { pyjson "import json,sys; print(len(json.load(sys.stdin)['data']['result']))" 2>/dev/null || echo 0; }

for svc in prometheus-b alertmanager-b blackbox node-exporter; do
  c="$(cid "$svc")"
  state=""
  if [ -n "$c" ]; then state="$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$c" | tr -d '\r\n')"; fi
  case "$state" in running/healthy | running/-) pass "$svc가 떠 있다($state)" ;; *) fail "$svc가 떠 있지 않다(${state:-컨테이너 없음})" ;; esac
done
c="$(cid ops-init)"
ok_if "ops-init(설정 만들기)이 성공으로 끝났다" "$([ -n "$c" ] && [ "$(docker inspect -f '{{.State.ExitCode}}' "$c" | tr -d '\r\n')" = 0 ] && echo 1 || echo 0)"

# 수집 대상: B 자신의 job은 up이어야 하고 A 프로브는 대상 8개가 모두 수집돼야 한다(A가 응답하는지는 아래에서 따로 본다)
targets="$(api prometheus-b 'http://localhost:9090/api/v1/targets?state=active')"
for job in prometheus alertmanager node blackbox; do
  up="$(printf '%s' "$targets" | pyjson "import json,sys; t=json.load(sys.stdin)['data']['activeTargets']; print(sum(1 for x in t if x['labels']['job']=='$job' and x['health']=='up'))" 2>/dev/null || echo 0)"
  ok_if "수집 대상 $job: up이 있다" "$([ "${up:-0}" -ge 1 ] && echo 1 || echo 0)"
done
up="$(printf '%s' "$targets" | pyjson "import json,sys; t=json.load(sys.stdin)['data']['activeTargets']; print(sum(1 for x in t if x['labels']['job']=='a-probe' and x['health']=='up'))" 2>/dev/null || echo 0)"
ok_if "A 프로브 대상 8개가 모두 수집된다" "$([ "${up:-0}" = 8 ] && echo 1 || echo 0)"

# 규칙: 모두 평가에 성공하고 알림 규칙이 있다
rules="$(api prometheus-b 'http://localhost:9090/api/v1/rules')"
bad="$(printf '%s' "$rules" | pyjson "import json,sys; g=json.load(sys.stdin)['data']['groups']; print(sum(1 for x in g for r in x['rules'] if r.get('health')!='ok' or r.get('lastError')))" 2>/dev/null || echo 99)"
n="$(printf '%s' "$rules" | pyjson "import json,sys; g=json.load(sys.stdin)['data']['groups']; print(sum(1 for x in g for r in x['rules'] if r['type']=='alerting'))" 2>/dev/null || echo 0)"
ok_if "알림 규칙 $n개가 올라와 있다" "$([ "${n:-0}" -ge 1 ] && echo 1 || echo 0)"
ok_if "모든 규칙이 오류 없이 평가된다" "$([ "${bad:-99}" = 0 ] && echo 1 || echo 0)"

# 알림 경로
am="$(api prometheus-b 'http://localhost:9090/api/v1/alertmanagers')"
ok_if "Prometheus가 Alertmanager를 찾았다" "$(printf '%s' "$am" | pyjson "import json,sys; print(1 if json.load(sys.stdin)['data']['activeAlertmanagers'] else 0)" 2>/dev/null || echo 0)"
ok_if "Alertmanager가 준비됐다" "$([ -n "$(api alertmanager-b 'http://localhost:9093/-/ready')" ] && echo 1 || echo 0)"

flags="$(api prometheus-b 'http://localhost:9090/api/v1/status/flags')"
ok_if "보존 기간 7일(1w), 크기 상한 2GB(2GiB)" "$(printf '%s' "$flags" | pyjson "import json,sys; f=json.load(sys.stdin)['data']; print(1 if f['storage.tsdb.retention.time'] in ('7d','1w') and f['storage.tsdb.retention.size'] in ('2GB','2GiB') else 0)" 2>/dev/null || echo 0)"

# A를 밖에서 본 결과. 첫 배포 전이면 A가 응답하지 않으므로 SKIP이다
if [ "$(query 'probe_success%7Bprobe%3D%22a-healthz%22%7D%3D%3D1' | count_of)" = 1 ]; then
  pass "밖에서 본 A의 /healthz가 200이다"
else
  skip "밖에서 본 A의 /healthz가 200이 아니다(A가 배포 전이면 정상)"
fi
for metric in fit_portaudit_last_scan_timestamp_seconds fit_vault_last_received_timestamp_seconds; do
  if [ "$(query "$metric" | count_of)" -ge 1 ]; then pass "지표 $metric가 있다"; else skip "지표 $metric가 아직 없다(설치 직후나 첫 실행 전이면 정상)"; fi
done
if [ "$(query 'fit_portaudit_unexpected_ports%3E0' | count_of)" = 0 ]; then pass "예상 밖에서 열린 포트가 없다(포트 감사 지표 기준)"; else fail "예상 밖에서 열린 포트가 있다(fit_portaudit_port_open 지표를 본다)"; fi

# 포트 감사 타이머(systemd가 없는 환경에서는 건너뛴다)
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] && [ "${FIT_SKIP:-}" != systemd ]; then
  for t in fit-port-audit-quick.timer fit-port-audit-full.timer; do
    ok_if "$t가 켜져 있다" "$([ "$(systemctl is-active "$t" 2>/dev/null)" = active ] && echo 1 || echo 0)"
  done
else
  skip "systemd가 없어 포트 감사 타이머를 보지 않았다"
fi

# 호스트에 게시한 포트는 127.0.0.1뿐이다(설계 13.1절)
exposed="$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Ports}}' | tr ',' '\n' | grep -c -E '(^|[ ])(0\.0\.0\.0|\[::\]):[0-9]+->' || true)"
ok_if "0.0.0.0에 게시한 포트가 없다" "$([ "${exposed:-0}" = 0 ] && echo 1 || echo 0)"

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d개 점검 실패\n' "$FAILED"
  exit 1
fi
printf '\nB의 감시 구성이 설계대로다\n'
````

- [ ] **Step 2: systemd 유닛 작성**

`infra/ops/conf/systemd/fit-port-audit-quick.service`:

````ini
[Unit]
Description=Port exposure audit of server A, quick scan (fit)

[Service]
Type=oneshot
EnvironmentFile=/etc/fit/ops.env
ExecStart=/usr/bin/python3 /usr/local/lib/fit/ops/port-audit.py --target ${PROD_HOST} --mode quick
TimeoutStartSec=300
Nice=10
IOSchedulingClass=idle
````

`infra/ops/conf/systemd/fit-port-audit-quick.timer`:

````ini
[Unit]
Description=Port exposure audit of server A, quick scan every 15 minutes (fit)

[Timer]
OnCalendar=*:0/15
Persistent=true

[Install]
WantedBy=timers.target
````

`infra/ops/conf/systemd/fit-port-audit-full.service`:

````ini
[Unit]
Description=Port exposure audit of server A, full scan of all 65535 ports (fit)

[Service]
Type=oneshot
EnvironmentFile=/etc/fit/ops.env
ExecStart=/usr/bin/python3 /usr/local/lib/fit/ops/port-audit.py --target ${PROD_HOST} --mode full
TimeoutStartSec=1800
Nice=10
IOSchedulingClass=idle
````

`infra/ops/conf/systemd/fit-port-audit-full.timer`:

````ini
[Unit]
Description=Port exposure audit of server A, full scan daily (fit)

[Timer]
# 매일 05:30(서버 시간대 Asia/Seoul). 새벽 4시 배치와 4시 15분 백업이 끝난 뒤다
OnCalendar=*-*-* 05:30:00
RandomizedDelaySec=5min
Persistent=true

[Install]
WantedBy=timers.target
````

- [ ] **Step 3: shellcheck와 포트 감사 시험 (게이트)**

포트 22, 80, 443, 8080, 41234를 여는 컨테이너를 만들어 감사가 예상 밖 포트를 찾는지 본다.

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
chmod +x infra/ops/*.sh infra/ops/port-audit.py
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/ops/install.sh infra/ops/ops-up.sh infra/ops/verify-ops.sh; echo "shellcheck exit=$?"
docker network create t-pa >/dev/null
docker run -d --name t-ports --network t-pa --network-alias a-sim "$PYTHON_IMAGE" python -c "
import socketserver as s, threading
s.ThreadingTCPServer.allow_reuse_address = True
H = type('H', (s.BaseRequestHandler,), {'handle': lambda self: None})
for p in (22, 80, 443, 8080, 41234):
    threading.Thread(target=s.ThreadingTCPServer(('0.0.0.0', p), H).serve_forever, daemon=True).start()
threading.Event().wait()" >/dev/null
sleep 3
for m in quick full; do docker run --rm --network t-pa -v "$W/infra/ops/port-audit.py:/pa.py:ro" -v "$W/.tmp-pa:/out" "$PYTHON_IMAGE" python /pa.py --target a-sim --mode $m --out /out; done
grep -v '^#' .tmp-pa/fit_portaudit_quick.prom
docker run --rm --network t-pa -v "$W/infra/ops/port-audit.py:/pa.py:ro" "$PYTHON_IMAGE" python /pa.py --target nonexistent.invalid --mode quick --out /tmp; echo "exit=$?"
docker rm -f t-ports >/dev/null; docker network rm t-pa >/dev/null; rm -rf .tmp-pa
FIT_OPS_PROJECT=no-such-project bash infra/ops/verify-ops.sh | tail -2; echo "exit=${PIPESTATUS[0]}"
bash infra/ops/install.sh; echo "exit=$?"
find infra -name __pycache__ -prune -exec rm -rf {} +
```

Expected: `shellcheck exit=0`. quick 감사는 `quick 스캔 …초: 열린 포트 [22, 80, 443, 8080], 예상 밖 [8080]`(41234는 quick 범위 밖이라 보이지 않는다), full 감사는 `열린 포트 [22, 80, 443, 8080, 41234], 예상 밖 [8080, 41234]`를 낸다. 지표에는 `fit_portaudit_unexpected_ports{mode="quick"} 1`과 `fit_portaudit_port_open{mode="quick",port="8080"} 1`이 있다. 이름을 찾지 못하면 `FAIL nonexistent.invalid의 주소를 찾지 못했다(...)`와 `exit=1`이다. 스택이 없는 `verify-ops.sh`는 `개 점검 실패`와 `exit=1`, root가 아니면 `install.sh`는 `FAIL root로 실행한다(sudo)`와 `exit=1`이다.

- [ ] **Step 4: 커밋 (허용된 경우)**

```bash
git add infra/ops/port-audit.py infra/ops/install.sh infra/ops/ops-up.sh infra/ops/verify-ops.sh infra/ops/conf
git update-index --chmod=+x infra/ops/port-audit.py infra/ops/install.sh infra/ops/ops-up.sh infra/ops/verify-ops.sh
git commit -m "feat(infra): B 포트 노출 감사, 설치·올리기·점검 스크립트와 systemd 타이머 추가"
```

---

### Task 7: B 감시 시험

**목표:** 서버 없이 실제 Prometheus·Alertmanager·blackbox·node-exporter와 가짜 A(Caddy 내부 CA 인증서, `/healthz`, basic auth가 걸린 `/_ops`), 웹훅 대역, 포트 감사 대상으로 외부 프로브, 알림 도착, 금고 지표, 포트 감사, 설치, 올리기를 확인한다.

**Files:**
- Create: `infra/ops/test/compose.test.yml`, `infra/ops/test/test-ops.sh`

**Interfaces:**
- Consumes: Task 5·6의 스택과 스크립트, Task 4의 웹훅 대역(`infra/obs/test/webhook-sink.py`)
- Produces: `bash infra/ops/test/test-ops.sh up|run [구역...]|down`. 구역: `stack init probes alert vault ports install hygiene`. 시험 프로젝트는 `fit-opstest`, 망은 `fit-opstest-net`이다. 호스트 포트는 19091, 19093(`FIT_OPSTEST_PROM_PORT`, `FIT_OPSTEST_AM_PORT`)이다. 시험 사본은 `for`를 0s로, 그룹 대기·간격과 반복 간격(30초)을 짧게 바꾼다

시나리오(구역):

- `stack`: `verify-ops.sh`가 모두 통과하고 게시 포트는 127.0.0.1의 둘뿐이며 메모리 한도, 보존(7일·2GB), 관리 API 꺼짐을 확인한다. Alertmanager를 멈추면 점검이 실패한다.
- `init`: `ops-init`이 파일 네 개를 만들고 비밀을 출력하지 않으며 운영 값에서는 인증서 검증을 끄지 않는다(시험 전용 값에서만 끈다). 누락·자리표시자·잘못된 호스트·짧은 비밀번호·공백이 든 사용자 이름·http(s)가 아닌 웹훅을 거부한다.
- `probes`: 프로브 8개가 모두 성공하고 인증서 만료까지 남은 시간이 읽히며, 자격 없이 `/_ops`를 부르면 실패하고 `password_file`로 자격을 주면 200이다.
- `alert`: 내부 CA 인증서(12시간)라 `FitCertExpiringCritical`이 울리고, 가짜 A를 멈추면 `FitExternalDown`, `FitPortUnreachable`, `FitOpsWatcherDown`, `FitTlsProbeFailed`가 Slack 형식으로 도착하며 복구되면 `[RESOLVED]`가 온다.
- `vault`: 금고 지표 파일(1D와 같은 이름·형식)의 마지막 수신 시각을 9시간 전으로 쓰면 `FitVaultStale`, 파일을 지우면 `FitVaultMetricMissing`이 도착하고 되돌리면 해소된다.
- `ports`: 예상 포트(22·80·443)만 열려 있으면 감사가 0개로 끝나고, 8080이 열리면 `FitPortExposed`가 도착하고 `verify-ops.sh`가 실패하며 닫으면 해소된다. quick은 높은 번호 포트를 보지 않고 full은 찾는다. 이름을 못 찾으면 종료 코드 1이고 지표를 건드리지 않는다.
- `install`: 컨테이너 안에서 `install.sh`의 모드·소유자·멱등·root 확인·사본 복구, `ops-up.sh`의 거부(파일 없음, `REPLACE_ME`, 644)와 올리기(600, 640, 다시 실행해도 같은 결과)를 Linux 컨테이너(docker CLI + 호스트 데몬)에서 확인한다. 유닛 문법은 `systemd-analyze`로 본다.
- `hygiene`: 어느 컨테이너 로그에도 웹훅 주소와 `/_ops` 비밀번호가 없다.

- [ ] **Step 1: 시험 환경과 시험 스크립트 작성**

`infra/ops/test/compose.test.yml`:

````yaml
# 시험용 덮어쓰기(infra/ops/test/test-ops.sh). 호스트 포트를 시험용으로 바꾸고, 알림 규칙과 Alertmanager 설정은 시험 사본을 쓴다.
# 사본은 저장소 파일에서 sed로 만든다: 규칙의 for를 0s로(대기 시간 없이 바로 울리게), group_wait·group_interval을 짧게. 그 밖의 식과 라우팅은 같다.
# 가짜 A, 웹훅 대역은 시험 망(FIT_OPSTEST_NET)에 있고 blackbox와 alertmanager-b가 그 망에 붙는다.
# 가짜 A의 인증서는 Caddy 내부 CA가 만든 것이라 ops-init에 시험 전용 PROBE_INSECURE_TLS=1을 준다(운영 compose에는 없다).
# FIT_OPSTEST_DIR, FIT_OPSTEST_NET은 시험 스크립트가 정한다.
services:
  ops-init:
    environment:
      PROBE_INSECURE_TLS: "1"

  prometheus-b:
    ports: !override
      - 127.0.0.1:${FIT_OPSTEST_PROM_PORT:-19091}:9090
    volumes: !override
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ${FIT_OPSTEST_DIR}/rules:/etc/prometheus/rules:ro
      - generated:/generated:ro
      - promdata:/prometheus

  alertmanager-b:
    ports: !override
      - 127.0.0.1:${FIT_OPSTEST_AM_PORT:-19093}:9093
    volumes: !override
      - ${FIT_OPSTEST_DIR}/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
      - ./alertmanager/templates:/etc/alertmanager/templates:ro
      - generated:/generated:ro
      - amdata:/alertmanager
    networks: [default, sim]

  blackbox:
    networks: [default, sim]

  node-exporter:
    volumes: !override
      - /:/host:ro
      - ${FIT_OPSTEST_DIR}/metrics:/textfile:ro

networks:
  sim:
    external: true
    name: ${FIT_OPSTEST_NET}
````

`infra/ops/test/test-ops.sh`:

````bash
#!/usr/bin/env bash
# 서버 B의 감시 구성을 노트북에서 시험한다(설계 10.5절). 실제 Prometheus, Alertmanager, blackbox, node-exporter를 띄우고
# 가짜 A(Caddy: 내부 CA 인증서, /healthz, basic auth가 걸린 /_ops), 웹훅 대역, 포트 감사 대상으로 A를 밖에서 보는 프로브와 알림이 Mattermost 형식으로 도착하는 데까지 확인한다.
#   bash infra/ops/test/test-ops.sh up [구역...]   # 가짜 A, 웹훅 대역, B의 감시 스택을 띄운다
#   bash infra/ops/test/test-ops.sh run [구역...]  # 시나리오를 돌린다. 구역: stack init probes alert vault ports install hygiene
#   bash infra/ops/test/test-ops.sh down           # 시험이 만든 것을 모두 지운다
# 필요한 것: docker compose(2.24 이상), python 3.9 이상. install 구역의 유닛 문법 점검은 apt로 systemd를 받으므로 인터넷이 필요하고 수십 초 걸린다.
# 시험용 사본: 규칙의 for는 0s로, Alertmanager의 group_wait·group_interval·repeat_interval은 짧게 바꾼다(식과 라우팅은 같다). 시험용 값은 매번 무작위다.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) export MSYS_NO_PATHCONV=1 ;;
esac
# Windows의 파이썬은 콘솔 코드 페이지(cp949)로 출력해 한글이 깨지므로 UTF-8로 고정한다
export PYTHONUTF8=1
W="$(pwd -W 2>/dev/null || pwd)"
T="$W/.tmp-opstest"
PROJECT=fit-opstest
NET=fit-opstest-net
# shellcheck source=infra/ci/tool-images.sh
. infra/ci/tool-images.sh
# shellcheck source=infra/deploy/lib.sh
. infra/deploy/lib.sh

export FIT_OPSTEST_DIR="$T" FIT_OPSTEST_NET="$NET"

dc() { docker compose -p "$PROJECT" -f "$W/infra/ops/compose.ops.yml" -f "$W/infra/ops/test/compose.test.yml" --env-file "$T/ops.env" "$@"; }
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
PY="$(find_python)"

sidecar() { # sidecar 이름 별칭 [docker run 인자...]: 시험 망에 붙인 컨테이너
  local name="$1" alias="$2"
  shift 2
  docker run -d --name "$PROJECT-$name" --network "$NET" --network-alias "$alias" "$@" >/dev/null
}
# 지정한 포트를 여는 TCP 수신기. network에는 시험 망 또는 container:이름(다른 컨테이너와 같은 네트워크 이름공간)을 준다
listener() { # listener 이름 network 별칭 포트...
  local name="$1" net="$2" alias="$3" ports="" p
  shift 3
  for p in "$@"; do ports="$ports,$p"; done
  local code="import socketserver as s,threading
s.ThreadingTCPServer.allow_reuse_address=True
H=type('H',(s.BaseRequestHandler,),{'handle':lambda self:None})
for p in [${ports#,}]:
    threading.Thread(target=s.ThreadingTCPServer(('0.0.0.0',p),H).serve_forever,daemon=True).start()
threading.Event().wait()"
  if [ -n "$alias" ]; then
    docker run -d --name "$PROJECT-$name" --network "$net" --network-alias "$alias" "$PYTHON_IMAGE" python -c "$code" >/dev/null
  else
    docker run -d --name "$PROJECT-$name" --network "$net" "$PYTHON_IMAGE" python -c "$code" >/dev/null
  fi
}
# Prometheus가 time()으로 보는 시각(컨테이너의 시계). PC가 절전에서 깨어난 직후처럼 Docker의 시계가 호스트와 어긋나도 시험이 흔들리지 않게 이것을 쓴다
vm_now() {
  local n
  n="$(docker exec "$(cid prometheus-b)" date +%s 2>/dev/null | tr -d '\r\n')"
  printf '%s' "${n:-$(date +%s)}"
}
vault_metrics() { # vault_metrics 기준시각 [pg를 마지막으로 받은 시각]: 금고가 쓰는 fit_vault.prom과 같은 이름·형식의 지표(1D vault-ingest.sh)
  local now="$1" pg="${2:-$1}" f="$T/metrics/fit_vault.prom"
  printf 'fit_vault_last_received_timestamp_seconds{kind="pg"} %s\nfit_vault_last_received_timestamp_seconds{kind="photos"} %s\nfit_vault_last_received_timestamp_seconds{kind="caddy"} %s\nfit_vault_quarantined_files 0\nfit_vault_ingest_failures_total 0\nfit_vault_ingest_last_run_timestamp_seconds %s\nfit_vault_last_restore_check_timestamp_seconds %s\n' \
    "$pg" "$now" "$now" "$now" "$now" >"$f.part"
  mv "$f.part" "$f"
}

up() {
  down >/dev/null 2>&1 || true
  mkdir -p "$T/metrics" "$T/rules" "$T/caddy"
  docker network create "$NET" >/dev/null
  local tok pw hash
  tok="$(hex 12)"
  pw="$(hex 12)"
  printf 'webhook=%s\npassword=%s\n' "$tok" "$pw" >"$T/tokens"
  {
    echo "PROD_HOST=a-prod.test"
    echo "DEV_HOST=a-dev.test"
    echo "OPS_BASIC_AUTH_USER=opsuser"
    echo "OPS_BASIC_AUTH_PASSWORD=$pw"
    echo "MATTERMOST_WEBHOOK_URL=http://webhook-sink:18099/hook/$tok"
  } >"$T/ops.env"
  # 시험 사본: for를 0s로, Alertmanager 대기와 반복 간격을 짧게(이미 울린 알림도 곧 다시 보낸다)
  for f in infra/ops/prometheus/rules/*.yml; do sed 's/^\( *\)for: .*/\1for: 0s/' "$f" >"$T/rules/$(basename "$f")"; done
  sed -e 's/group_wait: .*/group_wait: 1s/' -e 's/group_interval: .*/group_interval: 5s/' -e 's/repeat_interval: .*/repeat_interval: 30s/' infra/ops/alertmanager/alertmanager.yml >"$T/alertmanager.yml"
  # 가짜 A: prod와 dev 호스트 이름을 모두 받는 Caddy. 인증서는 내부 CA가 발급하고(12시간짜리라 만료 임박 알림이 울린다), /_ops는 basic auth다
  hash="$(docker run --rm "$CADDY_IMAGE" caddy hash-password --plaintext "$pw" | tr -d '\r\n')"
  cat >"$T/caddy/Caddyfile" <<EOF
{
	local_certs
	skip_install_trust
}
a-prod.test, a-dev.test {
	tls internal
	handle /_ops/* {
		basic_auth {
			opsuser $hash
		}
		respond "ok" 200
	}
	handle /healthz {
		respond "ok" 200
	}
	handle {
		respond "fe" 200
	}
}
EOF
  sidecar a-sim a-prod.test --network-alias a-dev.test -v "$T/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE"
  sidecar webhook-sink webhook-sink -v "$W/infra/obs/test/webhook-sink.py:/sink.py:ro" -v "$T:/out" "$PYTHON_IMAGE" python /sink.py 18099 /out/sink.log
  : >"$T/sink.log"
  vault_metrics "$(date +%s)"
  dc up -d --wait --wait-timeout 300
  echo "B 시험 환경이 떴다(프로젝트 $PROJECT)"
}

down() {
  dc down -v --remove-orphans >/dev/null 2>&1 || docker compose -p "$PROJECT" down -v --remove-orphans >/dev/null 2>&1 || true
  docker compose -p "$PROJECT-up" down -v --remove-orphans >/dev/null 2>&1 || true
  local c
  for c in a-sim webhook-sink a-ports a-ports-extra host; do docker rm -f "$PROJECT-$c" >/dev/null 2>&1 || true; done
  docker network rm "$NET" >/dev/null 2>&1 || true
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
nonzero() { if [ "$1" != 0 ]; then echo 1; else echo 0; fi; }
out=""
rc=0

cid() { docker ps -a -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n 1; }
inside() { docker exec "$(cid "$1")" wget -qO- "$2" 2>/dev/null; } # 서비스 컨테이너 안에서 URL을 읽는다
urlenc() { "$PY" -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1"; }
prom() { inside prometheus-b "http://localhost:9090/api/v1/query?query=$(urlenc "$1")"; }
pval() { prom "$1" | "$PY" -c 'import json,sys; r=json.load(sys.stdin)["data"]["result"]; print(r[0]["value"][1] if r else "")' 2>/dev/null || true; }
pcount() { prom "$1" | "$PY" -c 'import json,sys; print(len(json.load(sys.stdin)["data"]["result"]))' 2>/dev/null || echo 0; }
wait_for() { # wait_for 제한초 명령... : 명령이 성공할 때까지 기다린다
  local limit=$(($(date +%s) + $1))
  shift
  until "$@" >/dev/null 2>&1; do
    [ "$(date +%s)" -lt "$limit" ] || return 1
    sleep 3
  done
}
sink_count() { # sink_count 경로접두사 포함할문자열...: 모든 문자열이 들어 있는 메시지 수
  "$PY" - "$T/sink.log" "$@" <<'PYEOF'
import json, sys
path, prefix, needles = sys.argv[1], sys.argv[2], sys.argv[3:]
n = 0
for line in open(path, encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    rec = json.loads(line)
    if rec["path"].startswith(prefix) and all(x in rec["body"] for x in needles):
        n += 1
print(n)
PYEOF
}
sink_has() { [ "$(sink_count "$@")" -ge 1 ]; }
sink_body() { # sink_body 경로접두사 포함할문자열...: 마지막으로 받은 메시지의 body
  "$PY" - "$T/sink.log" "$@" <<'PYEOF'
import json, sys
path, prefix, needles = sys.argv[1], sys.argv[2], sys.argv[3:]
last = ""
for line in open(path, encoding="utf-8"):
    line = line.strip()
    if line:
        rec = json.loads(line)
        if rec["path"].startswith(prefix) and all(x in rec["body"] for x in needles):
            last = rec["body"]
print(last)
PYEOF
}
tok() { sed -n "s/^$1=//p" "$T/tokens"; }
# 알림 이름으로 보는 도착 확인. 같은 알림이 둘 이상이면 제목이 [FIRING:2]처럼 되므로 개수는 보지 않는다
fired() { sink_has "/hook/$(tok webhook)" '[FIRING:' "] $1 ("; }
resolved() { sink_has "/hook/$(tok webhook)" "[RESOLVED] $1 ("; }
fired_body() { sink_body "/hook/$(tok webhook)" '[FIRING:' "] $1 ("; }
pval_is() { [ "$(pval "$1")" = "$2" ]; } # pval_is 식 기대값: wait_for에 넘기려고 호출할 때마다 다시 질의한다
run_audit() { # run_audit 모드 대상 [포트 목록]: 포트 감사를 컨테이너에서 돌려 지표 파일을 시험 디렉터리에 쓴다
  docker run --rm --network "$NET" -v "$W/infra/ops/port-audit.py:/pa.py:ro" -v "$T/metrics:/out" "$PYTHON_IMAGE" python /pa.py --target "$2" --mode "$1" --out /out ${3:+--expected "$3"} 2>&1
}

run_stack_checks() {
  echo "--- 구성"
  # up 직후에는 첫 수집이 끝나기 전일 수 있다. 수집 대상 12개(B 자신 4, A 프로브 8)가 모두 up이 될 때까지 기다린다
  wait_for 90 pval_is 'count(up == 1)' 12 || true
  out="$(FIT_SKIP=systemd FIT_OPS_PROJECT=$PROJECT bash infra/ops/verify-ops.sh 2>&1)" && rc=0 || rc=$?
  ok_if "verify-ops.sh가 모두 통과한다" "$(is "$rc" 0)"
  local ports
  ports="$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}} {{.Ports}}' | tr -d '\r')"
  ok_if "호스트에 게시한 포트는 prometheus-b와 alertmanager-b의 127.0.0.1뿐이다" \
    "$([ "$(grep -c '127.0.0.1:' <<<"$ports")" = 2 ] && [ "$(grep -c '0.0.0.0:' <<<"$ports")" = 0 ] && echo 1 || echo 0)"
  ok_if "blackbox와 node-exporter는 호스트에 게시하지 않는다" "$([ "$(grep -E 'blackbox|node-exporter' <<<"$ports" | grep -c -- '->')" = 0 ] && echo 1 || echo 0)"
  local svc limit
  for svc in prometheus-b:167772160 alertmanager-b:67108864 blackbox:67108864 node-exporter:67108864 ops-init:33554432; do
    limit="$(docker inspect -f '{{.HostConfig.Memory}}' "$(cid "${svc%%:*}")" | tr -d '\r\n')"
    ok_if "${svc%%:*}의 메모리 한도가 ${svc##*:}바이트다" "$(is "$limit" "${svc##*:}")"
  done
  out="$(inside prometheus-b 'http://localhost:9090/api/v1/status/flags')"
  ok_if "Prometheus 보존이 7일, 2GB다(화면에는 1w, 2GiB로 보인다)" "$([ "$(has "$out" '"storage.tsdb.retention.time":"1w"')" = 1 ] && [ "$(has "$out" '"storage.tsdb.retention.size":"2GiB"')" = 1 ] && echo 1 || echo 0)"
  ok_if "Prometheus의 관리 API(/-/quit, /-/reload)는 꺼져 있다" "$([ "$(has "$out" '"web.enable-lifecycle":"false"')" = 1 ] && echo 1 || echo 0)"
  # 감시 체계가 빠지면 점검이 실패한다
  docker stop "$(cid alertmanager-b)" >/dev/null
  out="$(FIT_SKIP=systemd FIT_OPS_PROJECT=$PROJECT bash infra/ops/verify-ops.sh 2>&1)" && rc=0 || rc=$?
  ok_if "alertmanager-b를 멈추면 verify-ops.sh가 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'FAIL  alertmanager-b')" = 1 ] && echo 1 || echo 0)"
  docker start "$(cid alertmanager-b)" >/dev/null
  ok_if "다시 켜면 verify-ops.sh가 통과한다" "$(wait_for 90 env FIT_SKIP=systemd FIT_OPS_PROJECT=$PROJECT bash infra/ops/verify-ops.sh && echo 1 || echo 0)"
}

run_init_checks() {
  echo "--- 설정 만들기(ops-init)"
  mkdir -p "$T/gen"
  local good=(PROD_HOST=a.example.test DEV_HOST=dev.example.test OPS_BASIC_AUTH_USER=opsuser OPS_BASIC_AUTH_PASSWORD=ops-test-password-aaaaaaaa MATTERMOST_WEBHOOK_URL=https://mm.example.test/hooks/a)
  initrun() { # initrun NAME=값...: ops-init과 같은 조건(네트워크 없음)으로 render.py를 돌린다. 같은 이름이 뒤에 또 있으면 뒤의 값이 이긴다
    local envs=() e
    for e in "$@"; do envs+=(-e "$e"); done
    docker run --rm --network none -e GENERATED_DIR=/g -v "$T/gen:/g" -v "$W/infra/ops/render.py:/render.py:ro" -v "$W/infra/ops/blackbox/blackbox.yml:/blackbox.yml:ro" "${envs[@]}" "$PYTHON_IMAGE" python /render.py 2>&1
  }
  rm -rf "${T:?}/gen"/*
  out="$(initrun "${good[@]}")" && rc=0 || rc=$?
  ok_if "올바른 값이면 대상 파일, blackbox 설정, 비밀 파일 2개를 만든다" "$([ "$rc" = 0 ] && [ -f "$T/gen/targets/a-probes.yml" ] && [ -f "$T/gen/blackbox.yml" ] && [ -f "$T/gen/secrets/mattermost_url" ] && [ -f "$T/gen/secrets/ops_password" ] && echo 1 || echo 0)"
  ok_if "프로브 대상이 8개다" "$(is "$(grep -c '^- targets' "$T/gen/targets/a-probes.yml")" 8)"
  ok_if "대상 파일에 prod와 dev 호스트가 들어간다" "$([ "$(has "$(cat "$T/gen/targets/a-probes.yml")" 'a.example.test:443')" = 1 ] && [ "$(has "$(cat "$T/gen/targets/a-probes.yml")" 'dev.example.test:443')" = 1 ] && echo 1 || echo 0)"
  ok_if "blackbox 설정에 /_ops 사용자 이름이 들어가고 자리 표시는 남지 않는다" "$([ "$(has "$(cat "$T/gen/blackbox.yml")" 'username: "opsuser"')" = 1 ] && [ "$(has "$(cat "$T/gen/blackbox.yml")" '@@')" = 0 ] && echo 1 || echo 0)"
  ok_if "운영 값에서는 인증서 검증을 끄지 않는다(insecure_skip_verify: true가 없다)" "$(is "$(grep -c 'insecure_skip_verify: true' "$T/gen/blackbox.yml")" 0)"
  ok_if "만든 내용에 웹훅 주소와 비밀번호를 출력하지 않는다" "$([ "$(has "$out" 'mm.example.test')" = 0 ] && [ "$(has "$out" 'ops-test-password-aaaaaaaa')" = 0 ] && echo 1 || echo 0)"
  out="$(initrun "${good[@]}" PROBE_INSECURE_TLS=1)" && rc=0 || rc=$?
  ok_if "PROBE_INSECURE_TLS=1이면(시험 전용) 인증서 검증을 끈다" "$([ "$rc" = 0 ] && [ "$(grep -c 'insecure_skip_verify: false' "$T/gen/blackbox.yml")" = 0 ] && echo 1 || echo 0)"
  local name
  for name in PROD_HOST DEV_HOST OPS_BASIC_AUTH_USER OPS_BASIC_AUTH_PASSWORD MATTERMOST_WEBHOOK_URL; do
    local args=() e
    for e in "${good[@]}"; do case "$e" in "$name="*) ;; *) args+=("$e") ;; esac; done
    out="$(initrun "${args[@]}")" && rc=0 || rc=$?
    ok_if "$name가 없으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" "$name")" = 1 ] && echo 1 || echo 0)"
  done
  out="$(initrun "${good[@]}" PROD_HOST=REPLACE_ME)" && rc=0 || rc=$?
  ok_if "자리표시자(REPLACE_ME)가 남아 있으면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" REPLACE_ME)" = 1 ] && echo 1 || echo 0)"
  out="$(initrun "${good[@]}" 'PROD_HOST=a;b')" && rc=0 || rc=$?
  ok_if "호스트 이름에 이상한 문자가 있으면 거부한다" "$(nonzero "$rc")"
  out="$(initrun "${good[@]}" OPS_BASIC_AUTH_PASSWORD=short)" && rc=0 || rc=$?
  ok_if "짧은 비밀번호는 거부한다" "$(nonzero "$rc")"
  out="$(initrun "${good[@]}" 'OPS_BASIC_AUTH_USER=a b')" && rc=0 || rc=$?
  ok_if "사용자 이름에 공백이 있으면 거부한다" "$(nonzero "$rc")"
  out="$(initrun "${good[@]}" MATTERMOST_WEBHOOK_URL=ftp://x.test/a)" && rc=0 || rc=$?
  ok_if "http(s)가 아닌 웹훅 주소는 거부한다" "$(nonzero "$rc")"
  c="$(cid ops-init)"
  ok_if "ops-init은 네트워크 없이 읽기 전용으로 돈다" "$([ "$(docker inspect -f '{{.HostConfig.NetworkMode}} {{.HostConfig.ReadonlyRootfs}}' "$c" | tr -d '\r')" = 'none true' ] && echo 1 || echo 0)"
  ok_if "ops-init은 성공으로 끝났다" "$(is "$(docker inspect -f '{{.State.ExitCode}}' "$c" | tr -d '\r\n')" 0)"
}

run_probes_checks() {
  echo "--- 밖에서 본 A(프로브)"
  local p
  for p in a-healthz a-fe a-tcp-80 a-tcp-443 a-tls-prod a-tls-dev a-prometheus a-alertmanager; do
    ok_if "프로브 $p가 성공한다" "$(wait_for 90 pval_is "probe_success{probe=\"$p\"}" 1 && echo 1 || echo 0)"
  done
  ok_if "인증서 만료까지 남은 시간이 읽힌다(prod 12시간 안팎, 7일 미만)" \
    "$([ "$(pcount 'probe_ssl_earliest_cert_expiry{probe="a-tls-prod"} - time() > 0 < 604800')" = 1 ] && [ "$(pcount 'probe_ssl_earliest_cert_expiry{probe="a-tls-dev"} - time() > 0 < 604800')" = 1 ] && echo 1 || echo 0)"
  # /_ops는 자격이 있어야 200이다. 같은 주소를 자격 없이(http_2xx 모듈) 부르면 실패한다
  out="$(inside prometheus-b 'http://blackbox:9115/probe?module=http_2xx&target=https%3A%2F%2Fa-prod.test%2F_ops%2Fprometheus%2Fhealthy')"
  ok_if "자격 없이 /_ops를 부르면 프로브가 실패한다(basic auth)" "$([ "$(has "$out" 'probe_success 0')" = 1 ] && echo 1 || echo 0)"
  out="$(inside prometheus-b 'http://blackbox:9115/probe?module=http_ops&target=https%3A%2F%2Fa-prod.test%2F_ops%2Fprometheus%2Fhealthy')"
  ok_if "자격(password_file)을 주면 같은 주소가 200이다" "$([ "$(has "$out" 'probe_success 1')" = 1 ] && echo 1 || echo 0)"
}

run_alert_checks() {
  echo "--- 알림이 Mattermost 형식으로 도착한다"
  local body
  : >"$T/sink.log" # 앞서 받은 메시지는 비운다. 울리고 있는 알림은 반복 간격(시험 30초)마다 다시 온다
  ok_if "내부 CA 인증서는 12시간짜리라 FitCertExpiringCritical이 main 수신자에 도착한다" "$(wait_for 150 fired FitCertExpiringCritical && echo 1 || echo 0)"
  body="$(fired_body FitCertExpiringCritical)"
  out="$body"
  ok_if "메시지가 Slack 형식이고 제목에 상태, 알림 이름, site/env가 있다([FIRING:1] ... (B/prod))" "$([ "$(has "$body" '"attachments"')" = 1 ] && [ "$(has "$body" '"color":"danger"')" = 1 ] && [ "$(has "$body" '(B/prod)')" = 1 ] && echo 1 || echo 0)"
  ok_if "본문에 요약과 런북 ID(RB-05)가 있다" "$([ "$(has "$body" '인증서가 7일 안에 만료된다')" = 1 ] && [ "$(has "$body" '런북: RB-05')" = 1 ] && echo 1 || echo 0)"
  # 가짜 A가 죽으면 밖에서 본 알림 네 가지가 울린다
  docker stop "$PROJECT-a-sim" >/dev/null
  for a in FitExternalDown FitPortUnreachable FitOpsWatcherDown FitTlsProbeFailed; do
    ok_if "A가 죽으면 $a가 도착한다" "$(wait_for 150 fired "$a" && echo 1 || echo 0)"
  done
  out="$(fired_body FitExternalDown)"
  ok_if "FitExternalDown은 critical이고 런북은 RB-02다" "$([ "$(has "$out" '"color":"danger"')" = 1 ] && [ "$(has "$out" '런북: RB-02')" = 1 ] && echo 1 || echo 0)"
  docker start "$PROJECT-a-sim" >/dev/null
  ok_if "A가 돌아오면 [RESOLVED] FitExternalDown이 온다" "$(wait_for 150 resolved FitExternalDown && echo 1 || echo 0)"
}

run_vault_checks() {
  echo "--- 금고 지표(textfile)가 알림까지 이어진다"
  local n
  vault_metrics "$(vm_now)"
  : >"$T/sink.log"
  ok_if "금고 지표가 정상이면 FitVault* 알림이 울리지 않는다" "$(wait_for 60 pval_is 'count(ALERTS{alertname=~"FitVault.*", alertstate="firing"})' '' && echo 1 || echo 0)"
  n="$(vm_now)"
  vault_metrics "$n" "$((n - 9 * 3600))"
  ok_if "Postgres 백업을 9시간째 못 받았다고 쓰면 FitVaultStale이 도착한다" "$(wait_for 150 fired FitVaultStale && echo 1 || echo 0)"
  out="$(fired_body FitVaultStale)"
  ok_if "그 메시지는 critical이고 런북은 RB-06이다" "$([ "$(has "$out" '"color":"danger"')" = 1 ] && [ "$(has "$out" '런북: RB-06')" = 1 ] && echo 1 || echo 0)"
  vault_metrics "$(vm_now)"
  ok_if "정상으로 되돌리면 [RESOLVED] FitVaultStale이 온다" "$(wait_for 150 resolved FitVaultStale && echo 1 || echo 0)"
  rm -f "$T/metrics/fit_vault.prom"
  ok_if "지표 파일이 사라지면 FitVaultMetricMissing(absent)이 도착한다" "$(wait_for 150 fired FitVaultMetricMissing && echo 1 || echo 0)"
  vault_metrics "$(vm_now)"
  ok_if "되살리면 해소 메시지가 온다(시험은 처음 상태로 돌아간다)" "$(wait_for 150 resolved FitVaultMetricMissing && echo 1 || echo 0)"
}

run_ports_checks() {
  echo "--- 포트 노출 감사"
  docker rm -f "$PROJECT-a-ports" "$PROJECT-a-ports-extra" >/dev/null 2>&1 || true
  rm -f "$T"/metrics/fit_portaudit_*.prom # 이 구역을 다시 돌려도 "한 번도 돌리지 않은" 상태에서 시작한다
  ok_if "감사를 한 번도 돌리지 않은 동안은 FitPortAuditMissing이 울린다" "$(wait_for 90 pval_is 'count(ALERTS{alertname="FitPortAuditMissing", alertstate="firing"})' 1 && echo 1 || echo 0)"
  listener a-ports "$NET" a-ports.test 22 80 443
  sleep 2
  out="$(run_audit quick a-ports.test)" && rc=0 || rc=$?
  ok_if "예상 포트(22, 80, 443)만 열려 있으면 quick 감사가 예상 밖 0개로 끝난다" "$([ "$rc" = 0 ] && [ "$(has "$out" '예상 밖 []')" = 1 ] && echo 1 || echo 0)"
  ok_if "지표 파일이 시험 지표 디렉터리에 만들어지고 읽을 수 있다(644)" "$([ -f "$T/metrics/fit_portaudit_quick.prom" ] && [ "$(has "$(cat "$T/metrics/fit_portaudit_quick.prom")" 'fit_portaudit_unexpected_ports{mode="quick"} 0')" = 1 ] && echo 1 || echo 0)"
  ok_if "첫 감사가 끝나면 FitPortAuditMissing이 해소된다" "$(wait_for 90 pval_is 'count(ALERTS{alertname="FitPortAuditMissing", alertstate="firing"})' '' && echo 1 || echo 0)"
  ok_if "Prometheus가 감사 지표를 읽는다(마지막 스캔 시각, 예상 밖 0개)" "$(wait_for 60 pval_is 'fit_portaudit_unexpected_ports{mode="quick"}' 0 && echo 1 || echo 0)"
  : >"$T/sink.log"
  listener a-ports-extra "container:$PROJECT-a-ports" "" 8080
  sleep 2
  out="$(run_audit quick a-ports.test)" && rc=0 || rc=$?
  ok_if "8080이 더 열리면 quick 감사가 예상 밖 [8080]을 찾고 종료 코드는 0이다" "$([ "$rc" = 0 ] && [ "$(has "$out" '예상 밖 [8080]')" = 1 ] && echo 1 || echo 0)"
  ok_if "지표에 port=8080이 라벨로 남는다" "$(has "$(cat "$T/metrics/fit_portaudit_quick.prom")" 'fit_portaudit_port_open{mode="quick",port="8080"} 1')"
  ok_if "FitPortExposed가 critical로 main 수신자에 도착한다" "$(wait_for 150 fired FitPortExposed && echo 1 || echo 0)"
  out="$(fired_body FitPortExposed)"
  ok_if "메시지에 예상 밖 열린 포트 1개와 런북 RB-01이 있다" "$([ "$(has "$out" '예상 밖 열린 포트 1개')" = 1 ] && [ "$(has "$out" '런북: RB-01')" = 1 ] && echo 1 || echo 0)"
  out="$(FIT_SKIP=systemd FIT_OPS_PROJECT=$PROJECT bash infra/ops/verify-ops.sh 2>&1)" && rc=0 || rc=$?
  ok_if "예상 밖 포트가 열려 있으면 verify-ops.sh가 실패한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'FAIL  예상 밖에서 열린 포트가 있다')" = 1 ] && echo 1 || echo 0)"
  docker rm -f "$PROJECT-a-ports-extra" >/dev/null
  run_audit quick a-ports.test >/dev/null
  ok_if "포트를 닫고 다시 감사하면 해소 메시지가 온다" "$(wait_for 150 resolved FitPortExposed && echo 1 || echo 0)"
  # full 스캔은 1~65535 전체를 본다. quick이 보지 않는 높은 번호 포트를 찾는다
  listener a-ports-extra "container:$PROJECT-a-ports" "" 41234
  sleep 2
  run_audit quick a-ports.test >/dev/null
  ok_if "quick 스캔은 41234 같은 높은 번호 포트를 보지 않는다" "$(has "$(cat "$T/metrics/fit_portaudit_quick.prom")" 'fit_portaudit_unexpected_ports{mode="quick"} 0')"
  out="$(run_audit full a-ports.test)" && rc=0 || rc=$?
  ok_if "full 스캔은 41234를 예상 밖으로 찾는다" "$([ "$rc" = 0 ] && [ "$(has "$out" '예상 밖 [41234]')" = 1 ] && echo 1 || echo 0)"
  ok_if "full 지표는 mode=full 라벨로 따로 남는다" "$(has "$(cat "$T/metrics/fit_portaudit_full.prom")" 'fit_portaudit_port_open{mode="full",port="41234"} 1')"
  docker rm -f "$PROJECT-a-ports-extra" >/dev/null
  out="$(run_audit quick nonexistent.invalid)" && rc=0 || rc=$?
  ok_if "주소를 찾지 못하면 종료 코드 1로 실패하고 지표 파일을 건드리지 않는다" "$([ "$rc" = 1 ] && [ "$(has "$(cat "$T/metrics/fit_portaudit_quick.prom")" 'fit_portaudit_unexpected_ports{mode="quick"} 0')" = 1 ] && echo 1 || echo 0)"
  out="$(run_audit quick 'a;b')" && rc=0 || rc=$?
  ok_if "대상 이름에 이상한 문자가 있으면 거부한다" "$(is "$rc" 1)"
  ok_if "지표 파일을 쓰다 만 임시 파일(.part)이 남지 않는다" "$(is "$(find "$T/metrics" -name '*.part' | wc -l | tr -d ' ')" 0)"
  docker rm -f "$PROJECT-a-ports" >/dev/null
}

run_install_checks() {
  echo "--- 설치(B)"
  local H="$PROJECT-host" M=/usr/local/lib/fit/ops u
  docker rm -f "$H" >/dev/null 2>&1 || true
  docker run -d --name "$H" -v "$W:/repo:ro" ubuntu:24.04 sleep infinity >/dev/null
  hx() { docker exec "$H" bash -c "$1" 2>&1; } # 컨테이너 안에서 root로 실행한다
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/ops/install.sh')" && rc=0 || rc=$?
  ok_if "install.sh가 성공한다" "$(is "$rc" 0)"
  ok_if "첫 실행은 변경을 알리고 ops.env가 비어 있으면 타이머를 켜지 않는다고 알린다" "$([ "$(has "$out" '변경:')" = 1 ] && [ "$(has "$out" '타이머는 켜지 않았다')" = 1 ] && echo 1 || echo 0)"
  ok_if "ops.env는 예제에서 만들어지고 600 root:root다" "$(is "$(hx "stat -c '%a %U:%G' /etc/fit/ops.env")" '600 root:root')"
  ok_if "포트 감사 스크립트 사본은 755 root:root다" "$(is "$(hx "stat -c '%a %U:%G' $M/port-audit.py")" '755 root:root')"
  ok_if "코드 사본은 root 외에는 쓸 수 없다" "$(is "$(hx "find $M -perm /022 | wc -l")" 0)"
  ok_if "금고 지표 디렉터리가 755로 만들어진다" "$(is "$(hx "stat -c '%a %U:%G' /srv/vault/metrics")" '755 root:root')"
  ok_if "유닛 파일 4개가 설치됐다" "$(is "$(hx "ls /etc/systemd/system | grep -c '^fit-port-audit'")" 4)"
  ok_if "저장소의 유닛과 설치된 유닛이 같다" "$(is "$(hx "for f in /repo/infra/ops/conf/systemd/*; do cmp -s \$f /etc/systemd/system/\$(basename \$f) || echo diff; done | wc -l")" 0)"
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/ops/install.sh')"
  ok_if "두 번째 실행은 변경이 없다" "$(has "$out" '변경 0건')"
  hx "sed -i 's/^PROD_HOST=.*/PROD_HOST=a.example.test/' /etc/fit/ops.env" >/dev/null
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/ops/install.sh')"
  ok_if "ops.env의 PROD_HOST를 채우면 타이머를 켜라는 안내가 사라지고 채운 값은 덮어쓰지 않는다" "$([ "$(has "$out" '타이머는 켜지 않았다')" = 0 ] && [ "$(has "$(hx 'grep ^PROD_HOST /etc/fit/ops.env')" 'a.example.test')" = 1 ] && echo 1 || echo 0)"
  out="$(hx "su -s /bin/bash nobody -c 'bash /repo/infra/ops/install.sh'")" && rc=0 || rc=$?
  ok_if "root가 아니면 거부한다" "$([ "$rc" != 0 ] && [ "$(has "$out" 'root로 실행한다')" = 1 ] && echo 1 || echo 0)"
  hx "echo '# 누가 고쳤다' >> $M/port-audit.py" >/dev/null
  out="$(hx 'FIT_SKIP=apt,systemd bash /repo/infra/ops/install.sh')"
  ok_if "사본을 손으로 고쳐도 다시 실행하면 저장소와 같게 되돌린다" "$([ "$(has "$out" "변경: $M/port-audit.py")" = 1 ] && [ "$(hx "cmp /repo/infra/ops/port-audit.py $M/port-audit.py && echo same")" = same ] && echo 1 || echo 0)"
  for u in infra/ops/conf/systemd/*.service; do
    ok_if "$(basename "$u"): ExecStart가 가리키는 스크립트가 사본에 있다" "$(is "$(hx "p=\$(sed -n 's/^ExecStart=[^ ]* \\([^ ]*\\) .*/\\1/p' /etc/systemd/system/$(basename "$u")); test -f \"\$p\" && echo yes")" yes)"
  done
  docker rm -f "$H" >/dev/null

  echo "--- 올리기(ops-up.sh)"
  # docker CLI 컨테이너가 호스트 데몬을 쓴다(파일 권한을 믿을 수 있는 Linux에서 돌리려는 것이다). compose 파일은 마운트 없는 작은 것을 쓴다
  out="$(docker run --rm -i -v //var/run/docker.sock:/var/run/docker.sock -v "$W:/repo:ro" -e IMG="$PYTHON_IMAGE" -e P="$PROJECT-up" "$DOCKER_CLI_IMAGE" sh -s 2>&1 <<'EOS'
apk add --no-cache -q bash >/dev/null
printf 'services:\n  probe:\n    image: %s\n    command: [python, -c, "import time; time.sleep(600)"]\n' "$IMG" >/tmp/c.yml
go() { FIT_ENV_DIR=/etc/fit FIT_OPS_PROJECT="$P" FIT_OPS_COMPOSE=/tmp/c.yml bash /repo/infra/ops/ops-up.sh; }
count() { docker ps -q --filter "label=com.docker.compose.project=$P" | wc -l | tr -d ' '; }
mkdir -p /etc/fit
go >/tmp/o 2>&1; echo "CASE noenv rc=$? $(cat /tmp/o | tr '\n' ' ')"
cp /repo/infra/ops/ops.env.example /etc/fit/ops.env; chmod 600 /etc/fit/ops.env
go >/tmp/o 2>&1; echo "CASE placeholder rc=$? $(cat /tmp/o | tr '\n' ' ')"
printf 'PROD_HOST=a.test\nDEV_HOST=d.test\nOPS_BASIC_AUTH_USER=u\nOPS_BASIC_AUTH_PASSWORD=ops-test-password-aaaaaaaa\nMATTERMOST_WEBHOOK_URL=http://x.test/h\n' >/etc/fit/ops.env
chmod 644 /etc/fit/ops.env
go >/tmp/o 2>&1; echo "CASE worldreadable rc=$? $(cat /tmp/o | tr '\n' ' ')"
chmod 600 /etc/fit/ops.env
go >/tmp/o 2>&1; echo "CASE up600 rc=$? count=$(count)"
go >/tmp/o 2>&1; echo "CASE again rc=$? count=$(count)"
chmod 640 /etc/fit/ops.env
go >/tmp/o 2>&1; echo "CASE up640 rc=$? count=$(count)"
docker compose -p "$P" -f /tmp/c.yml down -v --remove-orphans >/dev/null 2>&1
echo "CASE down count=$(count)"
EOS
)"
  ok_if "ops.env가 없으면 올리지 않는다" "$([ "$(has "$out" 'CASE noenv rc=1')" = 1 ] && echo 1 || echo 0)"
  ok_if "REPLACE_ME가 남아 있으면 올리지 않는다" "$([ "$(has "$out" 'CASE placeholder rc=1')" = 1 ] && [ "$(has "$out" 'REPLACE_ME')" = 1 ] && echo 1 || echo 0)"
  ok_if "ops.env를 다른 사용자가 읽을 수 있으면(644) 올리지 않는다" "$([ "$(has "$out" 'CASE worldreadable rc=1')" = 1 ] && [ "$(has "$out" '권한')" = 1 ] && echo 1 || echo 0)"
  ok_if "값이 모두 채워지고 권한이 600이면 compose를 올린다(컨테이너 하나)" "$(has "$out" 'CASE up600 rc=0 count=1')"
  ok_if "다시 실행해도 같은 결과다(컨테이너는 하나)" "$(has "$out" 'CASE again rc=0 count=1')"
  ok_if "권한 640(root:docker)도 받아들인다" "$(has "$out" 'CASE up640 rc=0 count=1')"
  ok_if "시험이 올린 컨테이너를 지웠다" "$(has "$out" 'CASE down count=0')"

  echo "--- systemd 유닛 문법(systemd-analyze)"
  # systemd가 있는 임시 컨테이너(저장소에는 없다)에 유닛 파일을 tar로 표준 입력에 넣어 문법을 본다. 설치에 수십 초 걸린다
  out="$(tar -C infra/ops/conf/systemd -cf - . | docker run --rm -i ubuntu:24.04 bash -c '
set -e
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends systemd >/dev/null
tar -x -C /etc/systemd/system
chmod 644 /etc/systemd/system/*
mkdir -p /usr/local/lib/fit/ops /etc/fit
printf "#!/bin/sh\n" >/usr/local/lib/fit/ops/port-audit.py
printf "PROD_HOST=a.example.test\n" >/etc/fit/ops.env
[ -x /usr/bin/python3 ] || { printf "#!/bin/sh\n" >/usr/bin/python3; chmod +x /usr/bin/python3; }
for t in /etc/systemd/system/*.timer; do
  systemd-analyze calendar "$(sed -n "s/^OnCalendar=//p" "$t")" >/dev/null
  echo "calendar OK $(basename "$t")"
done
cd /etc/systemd/system
verify_out="$(systemd-analyze verify fit-port-audit-quick.service fit-port-audit-quick.timer fit-port-audit-full.service fit-port-audit-full.timer 2>&1)" || { echo "$verify_out"; echo "verify FAIL"; exit 1; }
echo "$verify_out" | grep -v "^$" || true
echo "verify OK"
' 2>&1)" && rc=0 || rc=$?
  ok_if "systemd-analyze가 두 타이머의 OnCalendar 표현을 해석한다" "$(is "$(grep -c '^calendar OK' <<<"$out")" 2)"
  ok_if "systemd-analyze verify가 서비스와 타이머를 오류 없이 읽는다" "$([ "$rc" = 0 ] && [ "$(has "$out" 'verify OK')" = 1 ] && [ "$(grep -ci -e 'failed' -e 'error' <<<"$out")" = 0 ] && echo 1 || echo 0)"
}

run_hygiene_checks() {
  echo "--- 비밀 값 노출"
  local t pw leaked=0 svc
  t="$(tok webhook)"
  pw="$(tok password)"
  for svc in ops-init prometheus-b alertmanager-b blackbox node-exporter; do
    if docker logs "$(cid "$svc")" 2>&1 | grep -q -e "$t" -e "$pw"; then
      leaked=1
      echo "FAIL  $svc 로그에 비밀 값이 있다"
    fi
  done
  ok_if "어느 컨테이너 로그에도 웹훅 주소와 /_ops 비밀번호가 없다" "$(is "$leaked" 0)"
  ok_if "Prometheus 설정 API에 웹훅 주소와 비밀번호가 없다" "$([ "$(has "$(inside prometheus-b 'http://localhost:9090/api/v1/status/config')" "$t")" = 0 ] && [ "$(has "$(inside prometheus-b 'http://localhost:9090/api/v1/status/config')" "$pw")" = 0 ] && echo 1 || echo 0)"
  ok_if "blackbox 설정 화면에 비밀번호가 없다(파일로만 읽는다)" "$([ "$(has "$(inside prometheus-b 'http://blackbox:9115/config')" "$pw")" = 0 ] && echo 1 || echo 0)"
  ok_if "저장소 파일에 시험용 비밀 값이 남지 않았다" "$([ -z "$(git grep -l -e "$t" -e "$pw" -- . 2>/dev/null || true)" ] && echo 1 || echo 0)"
}

run() {
  local section
  local -a sections=("$@")
  if [ "${#sections[@]}" = 0 ]; then sections=(stack init probes alert vault ports install hygiene); fi
  set +e
  for section in "${sections[@]}"; do "run_${section}_checks"; done
  set -e
  if [ "$FAILED" -gt 0 ]; then
    printf '\n%d개 점검 실패\n' "$FAILED"
    return 1
  fi
  printf '\nB 감시 구성 시험 통과\n'
}

case "${1:-}" in
  up) up ;;
  run) shift && run "$@" ;;
  down) down ;;
  *)
    echo "사용: bash infra/ops/test/test-ops.sh up | run [구역...] | down" >&2
    exit 2
    ;;
esac
````

- [ ] **Step 2: shellcheck와 정적 검사 확인**

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
chmod +x infra/ops/test/test-ops.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/ops/test/test-ops.sh; echo "shellcheck exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml infra/ops/test/compose.test.yml; echo "yamllint exit=$?"
```

Expected: `shellcheck exit=0`, `yamllint exit=0`.

- [ ] **Step 3: 시험 환경 켜기 (게이트)**

Run: `bash infra/ops/test/test-ops.sh up`

Expected: `ops-init`이 `Exited`, 나머지 네 컨테이너가 `Healthy`로 바뀌고 마지막 줄이 `B 시험 환경이 떴다(프로젝트 fit-opstest)`다.

- [ ] **Step 4: 시나리오 실행 (게이트)**

Run:

```bash
bash infra/ops/test/test-ops.sh run > .tmp-ops-run.log 2>&1; echo "exit=$?"
grep -E "^---|^FAIL|^B 감시 구성 시험|개 점검 실패" .tmp-ops-run.log
grep -c "^PASS" .tmp-ops-run.log
rm -f .tmp-ops-run.log
```

Expected: `exit=0`, 구역 제목 10개가 나오고(`--- 구성`, `--- 설정 만들기(ops-init)`, `--- 밖에서 본 A(프로브)`, `--- 알림이 Mattermost 형식으로 도착한다`, `--- 금고 지표(textfile)가 알림까지 이어진다`, `--- 포트 노출 감사`, `--- 설치(B)`, `--- 올리기(ops-up.sh)`, `--- systemd 유닛 문법(systemd-analyze)`, `--- 비밀 값 노출`) `FAIL`은 하나도 없으며 `B 감시 구성 시험 통과`가 나온 뒤 마지막 줄(전체 `PASS` 줄 수)이 101이다. 구역 하나만 돌리려면 구역 이름을 준다(예: `... run ports`).

- [ ] **Step 5: 시험이 잡아내는지 확인 (변이)**

켜 둔 환경에서 스크립트를 일부러 망가뜨리고 해당 구역만 시험한 뒤 되돌린다.

Run:

```bash
cp infra/ops/port-audit.py .tmp-pa.bak
sed -i 's/if p not in expected\]/if p in (0,)]/' infra/ops/port-audit.py
bash infra/ops/test/test-ops.sh run ports 2>&1 | grep "^FAIL  [^>]" | head -3
mv .tmp-pa.bak infra/ops/port-audit.py
cp infra/ops/render.py .tmp-render.bak
sed -i 's/{16,}/{4,}/' infra/ops/render.py
bash infra/ops/test/test-ops.sh run init 2>&1 | grep "^FAIL  [^>]" | head -3
mv .tmp-render.bak infra/ops/render.py
```

Expected: 첫 시험의 출력에 `FAIL  8080이 더 열리면 quick 감사가 예상 밖 [8080]을 찾고 종료 코드는 0이다`, `FAIL  지표에 port=8080이 라벨로 남는다`, `FAIL  FitPortExposed가 critical로 main 수신자에 도착한다`가(예상 밖 포트를 모두 무시하는 것을 잡는다), 둘째 시험의 출력에 `FAIL  짧은 비밀번호는 거부한다`가 포함된다.

- [ ] **Step 6: 정리 확인**

Run:

```bash
bash infra/ops/test/test-ops.sh down
docker ps -a --format '{{.Names}}' | grep -c 'fit-opstest'
docker network ls --format '{{.Name}}' | grep -c '^fit-opstest'
docker volume ls --format '{{.Name}}' | grep -c '^fit-opstest'
ls -d .tmp-opstest 2>&1 | head -1
```

Expected: `정리했다`, 이어서 `0`, `0`, `0`, 마지막은 `ls: cannot access '.tmp-opstest': No such file or directory`다.

- [ ] **Step 7: 커밋 (허용된 경우)**

```bash
git add infra/ops/test
git update-index --chmod=+x infra/ops/test/test-ops.sh
git commit -m "feat(infra): B 감시 시험 환경(가짜 A, 알림 도착·금고·포트 감사·설치 시나리오) 추가"
```

---

### Task 8: 엣지 `/_ops`와 환경변수 계약

**목표:** 엣지(Caddy)에 B의 감시용 경로를 더한다. prod 호스트의 `/_ops/prometheus/healthy`, `/_ops/alertmanager/healthy`만 열고, B의 IP와 basic auth를 모두 통과해야 200이며 아니면 401이 아니라 404다. 환경변수 계약에 `obs`, `ops` 그룹과 키를 더한다.

**Files:**
- Create: `infra/edge/test/ops_mock.py`, `infra/edge/test/ops_probe.py`
- Modify: `infra/edge/conf/Caddyfile`, `infra/edge/compose.edge.yml`, `infra/edge/edge.env.example`, `infra/edge/verify-edge.sh`, `infra/edge/test/compose.test.yml`, `infra/edge/test/test-edge.sh`, `infra/edge/README.md`, `infra/ci/check-caddy.sh`, `docs/infra/contracts/env.md`

**Interfaces:**
- Consumes: 1C-1의 엣지(Caddyfile, 시험 환경), Task 2·5의 `obs.env.example`·`ops.env.example`, B가 쓰는 `OPS_BASIC_AUTH_*`
- Produces: Caddy 스니펫 `ops_route`(prometheus, alertmanager), 키 `B_IP`(IP나 CIDR), `OPS_BASIC_AUTH_USER`, `OPS_BASIC_AUTH_HASH`(`caddy hash-password` 출력의 base64). compose는 이 키가 비면 거부한다. 시험은 net-obs의 고정 부분망(`10.213.99.0/24`)에서 B의 IP(`.50`)와 다른 IP(`.51`)로 요청한다

핵심 결정:

- 요청은 `route` 안에서 `basic_auth`, `rewrite * /-/healthy`, `reverse_proxy` 순서로 처리한다(순서를 고정해야 오류 처리기가 원래 경로를 본다). 다른 `/_ops` 경로(`/_ops`, `/_ops/`, `/_ops/prometheus/api/...`)와 dev 호스트에는 경로 자체가 없어 404다.
- basic auth 실패(401)는 `handle_errors 401`이 404로 바꾸고 `WWW-Authenticate` 헤더를 지운다(경로가 있다는 단서를 주지 않는다).
- `remote_ip`는 TCP 상대 주소를 본다(프록시 헤더를 믿지 않는다). B의 IP가 바뀌면 `edge.env`의 `B_IP`를 바꾸고 컨테이너를 다시 만든다.
- 해시는 `caddy hash-password` 출력을 base64로 인코딩해 env에 둔다(원본의 `$`가 env 형식 규칙에 걸린다. Caddy는 base64 형태도 받는다. 시험으로 확인했다).
- `check-caddy.sh`는 예제 env의 자리표시자를 Caddy가 받아들이지 않으므로(IP와 해시 형식) 문서용 IP와 즉석에서 만든 해시로 바꿔 검사한다.

- [ ] **Step 1: Caddyfile과 compose, env 예제 수정**

`ops_route` 스니펫과 prod 호스트의 `/_ops` 처리, `handle_errors`를 더한다:

````diff
diff --git a/infra/edge/conf/Caddyfile b/infra/edge/conf/Caddyfile
index 0fd456a..713d4ea 100644
--- a/infra/edge/conf/Caddyfile
+++ b/infra/edge/conf/Caddyfile
@@ -82,9 +82,42 @@
 	}
 }
 
+# 감시 체계 감시(설계 5.2절). prod 호스트에서만 열리고, B의 IP(remote_ip)와 basic auth를 둘 다 통과해야 200이다.
+# 어느 하나라도 틀리면 404다(경로가 있다는 것도 알리지 않는다). 내부 /-/healthy만 노출하고 그 밖의 /_ops 경로는 없다.
+# basic_auth를 rewrite보다 앞에 두려고 route로 순서를 고정한다(그래야 오류 처리기가 원래 경로를 본다)
+(ops_route) {
+	@ops_{args[0]} {
+		path /_ops/{args[0]}/healthy
+		remote_ip {$B_IP}
+	}
+	handle @ops_{args[0]} {
+		route {
+			basic_auth {
+				{$OPS_BASIC_AUTH_USER} {$OPS_BASIC_AUTH_HASH}
+			}
+			rewrite * /-/healthy
+			reverse_proxy {args[1]}
+		}
+	}
+}
+
 # prod
 {$PROD_HOST} {
 	import common
+	import ops_route prometheus prometheus:9090
+	import ops_route alertmanager alertmanager:9093
+	@ops_other path /_ops /_ops/*
+	handle @ops_other {
+		respond 404
+	}
+	# basic auth 실패(401)는 404로 바꾼다. WWW-Authenticate 헤더도 지워 /_ops가 있다는 단서를 주지 않는다
+	handle_errors 401 {
+		@ops path /_ops/*
+		handle @ops {
+			header -WWW-Authenticate
+			respond 404
+		}
+	}
 	import env_routes prod
 }
 
````

compose가 새 키를 환경으로 넘기고 비면 거부하게 한다:

````diff
diff --git a/infra/edge/compose.edge.yml b/infra/edge/compose.edge.yml
index 1c70141..32b3f76 100644
--- a/infra/edge/compose.edge.yml
+++ b/infra/edge/compose.edge.yml
@@ -14,6 +14,9 @@ services:
       ACME_MODE: ${ACME_MODE:?edge.env에 ACME_MODE(staging 또는 production)가 없다}
       HSTS_MODE: ${HSTS_MODE:?edge.env에 HSTS_MODE(off 또는 on)가 없다}
       DEV_GATE_KEY: ${DEV_GATE_KEY:?edge.env에 DEV_GATE_KEY가 없다}
+      B_IP: ${B_IP:?edge.env에 B_IP가 없다}
+      OPS_BASIC_AUTH_USER: ${OPS_BASIC_AUTH_USER:?edge.env에 OPS_BASIC_AUTH_USER가 없다}
+      OPS_BASIC_AUTH_HASH: ${OPS_BASIC_AUTH_HASH:?edge.env에 OPS_BASIC_AUTH_HASH가 없다}
     ports:
       - "80:80"
       - "443:443"
````

````diff
diff --git a/infra/edge/edge.env.example b/infra/edge/edge.env.example
index 096ee40..d690725 100644
--- a/infra/edge/edge.env.example
+++ b/infra/edge/edge.env.example
@@ -4,3 +4,6 @@ ACME_EMAIL=ops@example.test
 ACME_MODE=staging
 HSTS_MODE=off
 DEV_GATE_KEY=REPLACE_ME_with_32_or_more_url_safe_characters
+B_IP=REPLACE_ME
+OPS_BASIC_AUTH_USER=REPLACE_ME
+OPS_BASIC_AUTH_HASH=REPLACE_ME
````

- [ ] **Step 2: 시험 대역과 시험 수정**

`infra/edge/test/ops_mock.py`(A의 Prometheus·Alertmanager 대역. `/-/healthy`만 200):

````python
"""시험용 감시 체계 대역(infra/edge/test). A의 Prometheus와 Alertmanager처럼 /-/healthy에만 200을 주고 나머지는 본문이 있는 404를 준다.
엣지가 /_ops 요청을 /-/healthy로만 보내는지(그 밖의 경로는 upstream에 닿지 않는지) 본문으로 구분하려는 것이다.

사용: python ops_mock.py <포트> <이름>
"""
import http.server
import sys

port, name = int(sys.argv[1]), sys.argv[2]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        ok = self.path == "/-/healthy"
        body = f"{name} is Healthy.\n" if ok else f"{name} upstream: not found {self.path}\n"
        data = body.encode()
        self.send_response(200 if ok else 404)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass


http.server.HTTPServer(("0.0.0.0", port), Handler).serve_forever()
````

`infra/edge/test/ops_probe.py`(고정 IP 컨테이너에서 `/_ops`를 부르는 프로브):

````python
"""엣지의 /_ops 경로를 compose 망 안의 컨테이너(고정 IP)에서 부른다(infra/edge/test). B의 IP(remote_ip)를 흉내 내려는 것이다.

사용: python ops_probe.py <엣지 IP> <SNI 호스트> <경로> [사용자:비밀번호]
출력 한 줄: <상태 코드> www-authenticate=<yes|no> body=<본문 앞부분>. 인증서는 시험용 내부 CA라 검증하지 않는다.
"""
import base64
import socket
import ssl
import sys

ip, host, path = sys.argv[1:4]
auth = sys.argv[4] if len(sys.argv) > 4 else ""
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

request = f"GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n"
if auth:
    request += "Authorization: Basic " + base64.b64encode(auth.encode()).decode() + "\r\n"
raw = socket.create_connection((ip, 443), timeout=15)
conn = ctx.wrap_socket(raw, server_hostname=host)
conn.sendall((request + "\r\n").encode())
data = b""
while True:
    chunk = conn.recv(65536)
    if not chunk:
        break
    data += chunk
head, _, body = data.partition(b"\r\n\r\n")
lines = head.decode("latin-1").split("\r\n")
status = lines[0].split(" ")[1]
www = "yes" if any(line.lower().startswith("www-authenticate:") for line in lines[1:]) else "no"
print(f"{status} www-authenticate={www} body={body.decode('utf-8', 'replace').strip()[:80]!r}")
````

시험 compose에 감시 체계 대역 둘과 net-obs의 고정 부분망을 더하고, 시험 스크립트에 `/_ops` 점검을 더하고, `verify-edge.sh`에 "B 밖에서는 404" 점검을 더한다:

````diff
diff --git a/infra/edge/test/compose.test.yml b/infra/edge/test/compose.test.yml
index 5fa3476..92b028e 100644
--- a/infra/edge/test/compose.test.yml
+++ b/infra/edge/test/compose.test.yml
@@ -109,12 +109,27 @@ services:
     healthcheck: *fe-health
     networks: [net-dev]
 
+  # A의 감시 체계 대역(/_ops 시험). 실제 서버에서는 fit-obs의 prometheus와 alertmanager가 net-obs에 있다
+  prometheus:
+    <<: *mock
+    command: [python, /mock/ops_mock.py, "9090", Prometheus]
+    networks: [net-obs]
+
+  alertmanager:
+    <<: *mock
+    command: [python, /mock/ops_mock.py, "9093", Alertmanager]
+    networks: [net-obs]
+
 volumes:
   web:
   state:
 
-# net-edge만 로컬 스택(garage가 있는 망)에 붙고, 나머지 망은 이 시험 프로젝트가 만든다
+# net-edge만 로컬 스택(garage가 있는 망)에 붙고, 나머지 망은 이 시험 프로젝트가 만든다.
+# net-obs는 부분망을 고정한다(B의 IP를 흉내 내는 시험 컨테이너에 고정 IP를 주려는 것이다)
 networks:
   net-prod: !override {}
   net-dev: !override {}
-  net-obs: !override {}
+  net-obs: !override
+    ipam:
+      config:
+        - subnet: 10.213.99.0/24
````

````diff
diff --git a/infra/edge/test/test-edge.sh b/infra/edge/test/test-edge.sh
index 3976e73..67d6bc8 100755
--- a/infra/edge/test/test-edge.sh
+++ b/infra/edge/test/test-edge.sh
@@ -39,6 +39,11 @@ export FIT_LOCAL_PROJECT="$LOCAL_PROJECT" FIT_LOCAL_ENV=infra/local/local.env.ex
 # prod와 dev는 호스트로 나뉜다. dev.localhost도 Caddy가 내부 CA로 인증서를 발급한다
 export PROD_HOST=localhost DEV_HOST=dev.localhost ACME_EMAIL=ops@example.test ACME_MODE=production HSTS_MODE=off DEV_GATE_KEY="$KEY"
 export FIT_NET_EDGE="${LOCAL_PROJECT}_default"
+# /_ops(설계 5.2절): B의 IP는 시험 망 net-obs(고정 부분망)의 고정 IP다. 비밀번호는 시험용 값이고 해시는 up에서 만든다(bcrypt는 매번 달라진다)
+OPS_PW="edge-test-ops-password-aaaaaaaa"
+OPS_B_IP=10.213.99.50
+OPS_OTHER_IP=10.213.99.51
+export B_IP="$OPS_B_IP" OPS_BASIC_AUTH_USER=opsuser OPS_BASIC_AUTH_HASH="${OPS_BASIC_AUTH_HASH:-placeholder}"
 export FIT_EDGE_TEST_HTTP_PORT="$HTTP_PORT" FIT_EDGE_TEST_HTTPS_PORT="$HTTPS_PORT"
 # edgectl.sh도 같은 인자로 compose를 부른다(서버에서 쓰는 reload 경로를 그대로 시험한다)
 export FIT_EDGE_COMPOSE_ARGS="-p $EDGE_PROJECT -f infra/edge/compose.edge.yml -f infra/edge/test/compose.test.yml"
@@ -56,6 +61,9 @@ up() {
   garage bucket info fit-prod-photos >/dev/null 2>&1 || garage bucket create fit-prod-photos >/dev/null
   garage bucket allow --read --write --owner fit-prod-photos --key "$S3_ACCESS_KEY" >/dev/null
   garage bucket website --allow fit-prod-photos >/dev/null
+  # caddy hash-password의 출력을 base64로 인코딩해 env에 둔다(원본의 $가 env 형식 규칙에 걸린다. Caddy는 base64 형태도 받는다)
+  OPS_BASIC_AUTH_HASH="$(docker run --rm "$CADDY_IMAGE" caddy hash-password --plaintext "$OPS_PW" | tr -d '\r\n' | base64 | tr -d '\n')"
+  export OPS_BASIC_AUTH_HASH
   dc up -d --wait
   echo "엣지 시험 환경이 떴다: https://$PROD_HOST:$HTTPS_PORT (prod), https://$DEV_HOST:$HTTPS_PORT (dev)"
 }
@@ -226,6 +234,40 @@ check_blue_green() {
   ok_if "전환: 모두 blue로 되돌렸다" "$(is "$(active_be)$(active_fe)" blueblue)"
 }
 
+# ops_get 클라이언트IP SNI호스트 경로 [사용자:비밀번호]: net-obs의 고정 IP를 가진 컨테이너에서 엣지의 /_ops를 부른다(B를 흉내 낸다)
+ops_get() {
+  local cip="$1" w ccaddy
+  shift
+  w="$(pwd -W 2>/dev/null || pwd)"
+  ccaddy="$(docker inspect -f "{{(index .NetworkSettings.Networks \"${EDGE_PROJECT}_net-obs\").IPAddress}}" "$(dc ps -q caddy)" | tr -d '\r\n')"
+  docker run --rm --network "${EDGE_PROJECT}_net-obs" --ip "$cip" -v "$w/infra/edge/test/ops_probe.py:/p.py:ro" "$PYTHON_IMAGE" python /p.py "$ccaddy" "$@"
+}
+
+check_ops_routes() {
+  local out svc p good="opsuser:$OPS_PW"
+  for svc in prometheus alertmanager; do
+    out="$(ops_get "$OPS_B_IP" "$PROD_HOST" "/_ops/$svc/healthy" "$good")"
+    ok_if "/_ops($svc): B의 IP와 올바른 자격이면 200이고 upstream의 /-/healthy 응답이다" "$(is "$(has "$out" '200 ')$(has "$out" 'is Healthy')" 11)"
+  done
+  out="$(ops_get "$OPS_B_IP" "$PROD_HOST" /_ops/prometheus/healthy "opsuser:wrong-password-aaaaaaaa")"
+  ok_if "/_ops: 틀린 비밀번호는 404이고 WWW-Authenticate가 없다" "$(has "$out" "404 www-authenticate=no body=''")"
+  out="$(ops_get "$OPS_B_IP" "$PROD_HOST" /_ops/prometheus/healthy "wrong:$OPS_PW")"
+  ok_if "/_ops: 틀린 사용자 이름은 404이고 WWW-Authenticate가 없다" "$(has "$out" "404 www-authenticate=no body=''")"
+  out="$(ops_get "$OPS_B_IP" "$PROD_HOST" /_ops/prometheus/healthy)"
+  ok_if "/_ops: 자격이 없으면 401이 아니라 404이고 WWW-Authenticate가 없다" "$(has "$out" "404 www-authenticate=no body=''")"
+  out="$(ops_get "$OPS_OTHER_IP" "$PROD_HOST" /_ops/prometheus/healthy "$good")"
+  ok_if "/_ops: 올바른 자격이어도 B의 IP가 아니면 404다" "$(has "$out" "404 www-authenticate=no body=''")"
+  ok_if "/_ops: 호스트(B의 IP가 아닌 곳)에서도 자격을 줘도 404다" "$(is "$(http_code -u "$good" "$PROD/_ops/prometheus/healthy")" 404)"
+  for p in /_ops /_ops/ /_ops/prometheus/ /_ops/prometheus/healthy/x /_ops/prometheus/-/healthy /_ops/prometheus/api/v1/targets /_ops/prometheus/metrics /_ops/alertmanager/api/v2/status; do
+    out="$(ops_get "$OPS_B_IP" "$PROD_HOST" "$p" "$good")"
+    ok_if "/_ops: B의 IP와 올바른 자격이어도 $p 는 없다(404, upstream에 닿지 않는다)" "$(has "$out" "404 www-authenticate=no body=''")"
+  done
+  out="$(ops_get "$OPS_B_IP" "$DEV_HOST" /_ops/prometheus/healthy "$good")"
+  ok_if "/_ops: dev 호스트에는 없다(404)" "$(has "$out" "404 www-authenticate=no body=''")"
+  if (unset B_IP; dc config >/dev/null 2>&1); then fail "/_ops: B_IP 없이도 compose가 설정을 만들었다"; else pass "/_ops: B_IP가 없으면 compose가 거부한다(조용히 열리지 않는다)"; fi
+  if (unset OPS_BASIC_AUTH_HASH; dc config >/dev/null 2>&1); then fail "/_ops: OPS_BASIC_AUTH_HASH 없이도 compose가 설정을 만들었다"; else pass "/_ops: OPS_BASIC_AUTH_HASH가 없으면 compose가 거부한다"; fi
+}
+
 check_internal_and_logs() {
   local logs
   ok_if "내부 리스너: dev의 FE 서버는 dev BE를 본다" "$(is "$(body "${GATE[@]}" "$DEV/ssr-probe" | sed -nE 's/^be=(.*)$/\1/p')" dev)"
@@ -255,6 +297,7 @@ verify() {
   check_photos
   check_static_pool
   check_streaming
+  check_ops_routes
   check_blue_green
   check_internal_and_logs
   if [ "$FAILED" -gt 0 ]; then
````

````diff
diff --git a/infra/edge/verify-edge.sh b/infra/edge/verify-edge.sh
index 5fd6715..1476ee8 100755
--- a/infra/edge/verify-edge.sh
+++ b/infra/edge/verify-edge.sh
@@ -90,6 +90,15 @@ check_site() { # check_site 라벨 URL [curl 인자...]
 
 check_site prod "$PROD"
 
+# /_ops는 B의 IP와 basic auth가 있어야 열린다. 여기서(B가 아닌 곳에서) 부르면 자격이 있어도 404이고 /_ops가 있다는 단서(WWW-Authenticate)가 없다
+for p in /_ops/prometheus/healthy /_ops/alertmanager/healthy; do
+  fetch "$PROD$p"
+  expect "prod: $p 는 B 밖에서 404" "$(is "$STATUS" 404)"
+  expect "prod: $p 의 404는 WWW-Authenticate 헤더가 없다" "$(is "$(header_value www-authenticate)" "")"
+  fetch "$PROD$p" -u "x:y"
+  expect "prod: $p 는 자격을 줘도 B 밖에서는 404" "$(is "$STATUS" 404)"
+done
+
 if [ -n "$HTTP_URL" ]; then
   fetch "$HTTP_URL/"
   expect "http→https 리다이렉트(3xx)" "$(has "301 302 307 308" "$STATUS")"
````

- [ ] **Step 3: 검사 스크립트와 README, 환경변수 계약 수정**

````diff
diff --git a/infra/ci/check-caddy.sh b/infra/ci/check-caddy.sh
index b0b957b..70fe7a6 100755
--- a/infra/ci/check-caddy.sh
+++ b/infra/ci/check-caddy.sh
@@ -21,6 +21,10 @@ set -a
 # shellcheck source=/dev/null
 . infra/edge/edge.env.example
 set +a
+# 예제의 자리표시자(REPLACE_ME)는 Caddy가 받아들이지 않는다(B_IP는 IP여야 하고 해시는 bcrypt의 base64여야 한다). 문서용 IP와 즉석에서 만든 해시로 바꿔 검사한다
+B_IP=203.0.113.9
+OPS_BASIC_AUTH_HASH="$(caddy hash-password --plaintext check-only | base64 | tr -d '\n')"
+export B_IP OPS_BASIC_AUTH_HASH
 for mode in staging production; do
   for hsts in off on; do
     if ! ACME_MODE="$mode" HSTS_MODE="$hsts" caddy validate --config "$CONF/Caddyfile" --adapter caddyfile >/dev/null 2>&1; then
````

````diff
diff --git a/infra/edge/README.md b/infra/edge/README.md
index 5c31aa5..0e8d86a 100644
--- a/infra/edge/README.md
+++ b/infra/edge/README.md
@@ -22,6 +22,7 @@
                      ├ /api/*, /healthz               ─→ BE(활성 색)
                      ├ /fit-<환경>-photos/*           ─→ garage S3 API(업로드)
                      ├ /photos/<환경>/confirmed/*     ─→ garage 웹 엔드포인트(읽기)
+                     ├ /_ops/prometheus|alertmanager/healthy ─→ A의 Prometheus·Alertmanager(prod 호스트만, B의 IP와 basic auth가 있어야 하고 아니면 404)
                      └ 그 외 전부                     ─→ FE(활성 색, Next.js SSR)
 FE 서버 ─ caddy:8081(prod), caddy:8082(dev) ─→ BE(활성 색)
 ```
@@ -38,8 +39,8 @@ FE 서버가 BE를 부를 때는 Caddy의 내부 리스너를 거친다(`BE_INTE
 | `state-sample/` | 활성 색 upstream 파일의 형식 견본(환경 × 서비스 네 개) |
 | `edge.env.example` | `/etc/fit/edge.env`의 키(계약은 [env.md](../../docs/infra/contracts/env.md)의 edge 그룹) |
 | `edgectl.sh` | 상태, 검사, reload |
-| `verify-edge.sh` | 라우팅, 캐시, 헤더, dev 게이트를 HTTP로 점검한다 |
-| `test/` | 노트북에서 엣지를 시험하는 환경(목 BE·FE, 시험용 풀, 로컬 스택의 garage) |
+| `verify-edge.sh` | 라우팅, 캐시, 헤더, dev 게이트, `/_ops`가 B 밖에서는 404인지를 HTTP로 점검한다 |
+| `test/` | 노트북에서 엣지를 시험하는 환경(목 BE·FE, 시험용 풀, 로컬 스택의 garage, `/_ops`용 감시 체계 대역과 B의 IP를 흉내 내는 프로브) |
 
 ## 바꿀 곳
 
@@ -50,6 +51,15 @@ FE 서버가 BE를 부를 때는 Caddy의 내부 리스너를 거친다(`BE_INTE
 | BE·FE 활성 색 전환 | `/srv/fit/state/upstream-<환경>-<be\|fe>.caddy`(배포 스크립트가 쓴다)와 `edgectl.sh reload` |
 | 인증서 단계, HSTS | `edge.env`의 `ACME_MODE`, `HSTS_MODE` |
 | dev 접근 키 교체 | `edge.env`의 `DEV_GATE_KEY`를 바꾸고 caddy 컨테이너를 다시 만든다(`docker compose up -d`) |
+| B의 IP, `/_ops` 자격 교체 | `edge.env`의 `B_IP`(CIDR도 된다), `OPS_BASIC_AUTH_USER`, `OPS_BASIC_AUTH_HASH`를 바꾸고 caddy 컨테이너를 다시 만든다. 자격은 B의 `ops.env`와 짝이다([ops/README.md](../ops/README.md)의 자격 만들기) |
+
+## /_ops (감시 체계 감시)
+
+prod 호스트의 `/_ops/prometheus/healthy`, `/_ops/alertmanager/healthy`만 열린다(Caddyfile의 `ops_route`). 요청은 내부 `/-/healthy`로 rewrite해 A의 Prometheus와 Alertmanager로 간다. 다른 `/_ops` 경로와 dev 호스트에는 없다.
+
+- B의 IP(`remote_ip`, TCP 상대 주소)와 basic auth를 둘 다 통과해야 200이다. 하나라도 틀리면 401이 아니라 404이고 `WWW-Authenticate` 헤더도 없다(경로가 있다는 단서를 주지 않는다).
+- `B_IP`, `OPS_BASIC_AUTH_USER`, `OPS_BASIC_AUTH_HASH`가 비어 있으면 compose가 거부한다(조용히 열리지 않는다).
+- 이 경로의 프로브는 B가 한다([ops/README.md](../ops/README.md)). A의 알림이 조용해졌는지 밖에서 보려는 것이다.
 
 ## 서버가 갖출 것
 
````

환경변수 계약에 `obs`, `ops` 그룹을 더하고 `edge`·`data`와 공유하는 키(`B_IP`, `OPS_BASIC_AUTH_USER`, `FIT_MONITOR_PASSWORD`, `PROD_HOST`, `DEV_HOST`)의 그룹을 맞춘다:

````diff
diff --git a/docs/infra/contracts/env.md b/docs/infra/contracts/env.md
index f4fdac5..c425107 100644
--- a/docs/infra/contracts/env.md
+++ b/docs/infra/contracts/env.md
@@ -19,8 +19,8 @@
 | `edge` | `infra/edge/edge.env.example` | 엣지 Caddy(`/etc/fit/edge.env`). compose가 `--env-file`로 읽는다 |
 | `data` | `infra/data/data.env.example` | 데이터 스택(`infra/data/compose.data.yml`)과 DB·버킷 초기화 스크립트(`/etc/fit/data.env`). 환경별 자격이 앱 env와 같아야 한다 |
 | `backup` | `infra/backup/backup.env.example` | A의 백업 스크립트와 타이머(`/etc/fit/backup.env`) |
-
-이 문서를 만든 계획 이후의 계획이 `obs`, `ops` 그룹을 같은 표에 더한다(design.md 13.2절의 파일 구분).
+| `obs` | `infra/obs/obs.env.example` | A의 관측 스택(`/etc/fit/obs.env`). compose가 `--env-file`로 읽고, 일일 점검 요약이 웹훅 주소를 읽는다 |
+| `ops` | `infra/ops/ops.env.example` | B의 감시 스택과 포트 노출 감사(`/etc/fit/ops.env`) |
 
 ## 키 목록
 
@@ -73,12 +73,20 @@
 | `POSTHOG_KEY` | fe | X | PostHog 공개 키. `/config.json`의 `posthogKey`로 나간다 |
 | `POSTHOG_HOST` | fe | X | PostHog 호스트. `/config.json`의 `posthogHost`로 나간다 |
 | `PUSH_PUBLIC_KEY` | fe | X | 웹 푸시 공개 키. `/config.json`의 `pushPublicKey`로 나간다 |
-| `PROD_HOST` | edge | O | prod 호스트명(예: `fit.<도메인>`). 호스트마다 인증서를 따로 받는다 |
-| `DEV_HOST` | edge | O | dev 호스트명(예: `dev.fit.<도메인>`). prod와 다른 호스트여야 쿠키·서비스 워커가 분리된다 |
+| `PROD_HOST` | edge, ops | O | prod 호스트명(예: `fit.<도메인>`). 호스트마다 인증서를 따로 받는다. ops에서는 B가 프로브하고 포트를 감사할 A의 주소다 |
+| `DEV_HOST` | edge, ops | O | dev 호스트명(예: `dev.fit.<도메인>`). prod와 다른 호스트여야 쿠키·서비스 워커가 분리된다. ops에서는 B가 인증서를 볼 A의 dev 주소다 |
 | `ACME_EMAIL` | edge | O | 인증서 발급 알림을 받을 이메일 |
 | `ACME_MODE` | edge | O | `staging`이면 staging CA만 쓴다. `production`이면 기본 이슈어(Let's Encrypt, ZeroSSL)를 쓴다 |
 | `HSTS_MODE` | edge | O | `off` 또는 `on`. 운영 인증서가 확정된 뒤에만 `on`으로 바꾼다 |
 | `DEV_GATE_KEY` | edge | O | dev 접근 키. `/?k=<키>`로 접속하면 쿠키를 받는다. 영문자·숫자·`_`·`-` 32자 이상, 비밀 |
+| `B_IP` | edge, obs | O | 서버 B의 공인 IP. edge에서는 `/_ops` 접근을 이 주소로 제한하고(`remote_ip`, CIDR도 된다), obs에서는 A가 B의 22번 포트를 프로브할 대상이다. 문서나 저장소에 적지 않는다 |
+| `OPS_BASIC_AUTH_USER` | edge, ops | O | A의 `/_ops` basic auth 사용자 이름. edge와 ops가 같아야 한다. 영문·숫자·`._-` 64자 이하 |
+| `OPS_BASIC_AUTH_HASH` | edge | O | `/_ops` basic auth 비밀번호의 해시. `caddy hash-password` 출력을 base64로 인코딩한다(원본의 `$`가 env 형식 규칙에 걸린다. Caddy는 base64 형태도 받는다). ops의 비밀번호와 짝이다 |
+| `OPS_BASIC_AUTH_PASSWORD` | ops | O | `/_ops` basic auth 비밀번호(평문). 영문·숫자·`._~-`만 쓴 16자 이상, 비밀 |
+| `MATTERMOST_WEBHOOK_URL` | obs, ops | O | 알림을 받을 Mattermost 수신 웹훅(`http(s)://`). obs에서는 prod와 A 전체 알림과 일일 점검 요약, ops에서는 B의 알림이 간다. 비밀 |
+| `MATTERMOST_WEBHOOK_URL_DEV` | obs | O | dev 알림을 받을 Mattermost 수신 웹훅(채널을 나눈다). 비밀 |
+| `GRAFANA_ADMIN_PASSWORD` | obs | O | Grafana admin 비밀번호. 비밀 |
+| `FIT_MONITOR_PASSWORD` | data, obs | O | `fit_monitor` 비밀번호(`pg_monitor` 권한. postgres_exporter가 통계를 읽는다). `data.env`와 `obs.env`의 값이 같아야 한다 |
 | `FIT_PROD_APP_PASSWORD` | data | O | `fit_prod_app` 비밀번호. `prod.env`의 `SPRING_DATASOURCE_PASSWORD`와 같아야 한다 |
 | `REDIS_PROD_PASSWORD` | data | O | `redis-prod` 비밀번호. `prod.env`의 `SPRING_DATA_REDIS_PASSWORD`와 같아야 한다 |
 | `REDIS_DEV_PASSWORD` | data | O | `redis-dev` 비밀번호. `dev.env`의 `SPRING_DATA_REDIS_PASSWORD`와 같아야 한다 |
@@ -104,6 +112,8 @@
 
 로컬 그룹의 값은 개발용 가짜 값이다. 서버 값으로 쓰지 않는다.
 
+`obs`와 `ops` 그룹의 값은 시작 때 `obs-init`, `ops-init`(`render.py`)이 검사한다. 비었거나 `REPLACE_ME`이면 스택이 뜨지 않는다.
+
 `data` 그룹의 값 형식은 스크립트가 검사한다(`infra/data/lib.sh`, `init-garage.sh`). 비밀번호와 토큰(`*_PASSWORD`, `GARAGE_ADMIN_TOKEN`)은 영문·숫자·`._~-`만 쓴 16자 이상이고, `GARAGE_RPC_SECRET`과 `S3_*_SECRET_KEY`는 16진수 64자리, `S3_*_ACCESS_KEY`는 `GK` + 16진수 24자리다.
 
 ## 프런트 런타임 설정 (`/config.json`)
````

- [ ] **Step 4: 정적 검증 (게이트)**

Run:

```bash
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
chmod +x infra/ci/check-caddy.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$CADDY_IMAGE" sh infra/ci/check-caddy.sh
python infra/ci/check_env_contract.py
python infra/ci/check_env_files.py infra/edge/edge.env.example infra/obs/obs.env.example infra/ops/ops.env.example infra/data/data.env.example
python infra/ci/ports_invariant.py infra/edge/compose.edge.yml infra/edge/test/compose.test.yml --env-file infra/edge/edge.env.example
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml infra/edge; echo "yamllint exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" shellcheck -x infra/edge/verify-edge.sh infra/edge/test/test-edge.sh; echo "shellcheck exit=$?"
python infra/ci/images_arch.py --platform linux/arm64 --platform linux/amd64 --compose infra/edge/compose.edge.yml --compose infra/edge/test/compose.test.yml --env-file infra/edge/edge.env.example
```

Expected: `OK caddy (fmt, validate)`, `OK env-contract`, `OK env (4 file(s))`, `OK ports (10 service(s))`, `yamllint exit=0`, `shellcheck exit=0`, `OK arch linux/arm64,linux/amd64 (2 image(s))`.

- [ ] **Step 5: 엣지 시험 (게이트)**

처음에는 로컬 스택(garage) 이미지를 받는다.

Run:

```bash
bash infra/edge/test/test-edge.sh up >/dev/null
bash infra/edge/test/test-edge.sh verify > .tmp-edge-verify.log 2>&1; echo "exit=$?"
grep -E "^FAIL|^엣지|개 점검 실패" .tmp-edge-verify.log
grep -c "_ops" .tmp-edge-verify.log
grep -c "^PASS" .tmp-edge-verify.log
rm -f .tmp-edge-verify.log
```

Expected: `exit=0`, `FAIL`은 없고 `엣지 정상`과 `엣지 시험 통과`가 나온다. `_ops`가 든 줄이 24개이고(B 밖에서 404, `WWW-Authenticate` 없음, B의 IP와 올바른 자격이면 200, 틀린 비밀번호·사용자·IP는 404, 그 밖의 `/_ops` 경로와 dev 호스트는 404, `B_IP`·`OPS_BASIC_AUTH_HASH`가 없으면 compose가 거부), 전체 `PASS` 줄은 126개다. 검증 로그에는 `curl: (7) Failed to connect`가 몇 줄 섞일 수 있다(Docker Desktop의 포트 포워더가 새 연결을 간헐적으로 거부하는 것이고 시험 스크립트가 다시 시도한다).

- [ ] **Step 6: 시험이 잡아내는지 확인 (변이)**

보안에 직접 걸린 두 줄을 일부러 망가뜨리고 시험한 뒤 되돌린다. 시험 환경의 Caddy는 설정 디렉터리를 마운트해 두었으므로 컨테이너 안에서 `caddy reload`로 적용된다(컨테이너 이름은 `fit-edge-test-caddy-1`).

Run:

```bash
cp infra/edge/conf/Caddyfile .tmp-caddyfile.bak
sed -i '/remote_ip {\$B_IP}/d' infra/edge/conf/Caddyfile
docker exec fit-edge-test-caddy-1 caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1
bash infra/edge/test/test-edge.sh verify 2>&1 | grep "^FAIL" | head -3
cp .tmp-caddyfile.bak infra/edge/conf/Caddyfile
sed -i 's/header -WWW-Authenticate/header -X-None/' infra/edge/conf/Caddyfile
docker exec fit-edge-test-caddy-1 caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1
bash infra/edge/test/test-edge.sh verify 2>&1 | grep "^FAIL" | head -3
mv .tmp-caddyfile.bak infra/edge/conf/Caddyfile
docker exec fit-edge-test-caddy-1 caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1
```

Expected: 첫 시험의 출력에 `FAIL  /_ops: 올바른 자격이어도 B의 IP가 아니면 404다`가(B의 IP 제한을 지우면 잡힌다), 둘째 시험의 출력에 `FAIL  /_ops: 틀린 비밀번호는 404이고 WWW-Authenticate가 없다`가(401을 404로 바꿀 때 헤더를 지우지 않으면 잡힌다) 포함된다. 끝나면 Caddyfile은 원래대로이고 `git diff --stat infra/edge/conf/Caddyfile`은 이 Task의 수정만 보여 준다.

- [ ] **Step 7: 정리 확인과 커밋 (허용된 경우)**

Run:

```bash
bash infra/edge/test/test-edge.sh down >/dev/null 2>&1
docker ps -a --format '{{.Names}}' | grep -c 'fit-edge-test'
docker network ls --format '{{.Name}}' | grep -c '^fit-edge-test'
docker volume ls --format '{{.Name}}' | grep -c '^fit-edge-test'
ls -d .tmp-edge* 2>&1 | head -1
```

Expected: `0`, `0`, `0`, 마지막은 `No such file or directory`다.

```bash
git add infra/edge infra/ci/check-caddy.sh docs/infra/contracts/env.md
git update-index --chmod=+x infra/edge/test/ops_mock.py infra/edge/test/ops_probe.py
git commit -m "feat(infra): 엣지 /_ops(감시 체계 감시) 경로와 환경변수 계약(obs, ops) 추가"
```

---

### Task 9: 문서와 검사 연결

**목표:** 관측·감시 README, 지표 계약, 설계·로드맵·인프라 README를 현재 구현에 맞추고, 새 compose를 포트 검사 대상에 올린 뒤 전체 검사를 돌린다.

**Files:**
- Create: `infra/obs/README.md`, `infra/ops/README.md`, `docs/infra/contracts/metrics.md`
- Modify: `docs/infra/design.md`, `docs/infra/contracts/README.md`, `docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md`, `infra/README.md`, `infra/backup/README.md`, `infra/ci/compose-projects.txt`

핵심 결정:

- 문서는 현재 사실만 적는다. 설계 7.1(`fit_monitor`), 9(스택 구성, 알림 표, 공통 규칙), 10.1(`daily-digest.py`), 13.2(파일별 내용과 권한), 13.4(Dozzle의 `docker.sock`), 16절 15번(Docker 29 호환), 17(산출물), 부록 B(결정 로그)를 맞춘다.
- `infra/ci/compose-projects.txt`에 `obs`, `obs-test`, `ops`, `ops-test`를 더해 포트 불변식(호스트 게시는 127.0.0.1만)을 CI가 계속 지키게 한다.

- [ ] **Step 1: README와 지표 계약 작성**

`infra/obs/README.md`:

````markdown
# 관측 (서버 A)

서버 A의 `fit-obs` 프로젝트다. Prometheus가 호스트·컨테이너·앱·데이터·백업 지표를 모으고, 알림 규칙 35개가 Alertmanager를 거쳐 Mattermost로 간다. Grafana 대시보드 3개와 로그 UI(Dozzle)가 있다. 설계는 [design.md](../../docs/infra/design.md) 9절이다. B가 A를 밖에서 보는 쪽은 [ops/README.md](../ops/README.md)다.

## 자주 하는 일

| 하고 싶은 일 | 명령 |
|---|---|
| 설치(요약 스크립트, `obs.env`, 요약 타이머) | `sudo bash infra/obs/install.sh` |
| 관측 스택 올리기 | `obs.env`를 채운 뒤 `bash infra/deploy/fit-up.sh`(재부팅 뒤 기동 순서에 들어 있다) |
| 스택이 설계대로인지 점검 | `bash infra/obs/verify-obs.sh` |
| 일일 점검 요약을 올리지 않고 출력만 | `sudo python3 /usr/local/lib/fit/obs/daily-digest.py --dry-run` |
| 일일 점검 요약을 지금 올리기 | `sudo systemctl start fit-daily-digest.service` |
| Grafana, Prometheus, Dozzle 보기 | SSH 터널 `-L 3000:127.0.0.1:3000 -L 9090:127.0.0.1:9090 -L 8888:127.0.0.1:8888` 뒤 `http://localhost:3000` 등 |
| 알림 규칙과 라우팅을 서버 없이 검사 | `bash infra/ci/run-local-checks.sh`(promtool, amtool, `check_alerts.py`가 돈다) |
| 노트북에서 스택 전체를 시험 | `bash infra/obs/test/test-obs.sh up`, `run`, `down` |

## 구성

프로젝트 `fit-obs`의 서비스와 메모리 한도다. 합계 1,344MB로 설계 4.1절의 관측성 예산(1.4GB) 안이다.

| 서비스 | 한도 | 하는 일 |
|---|---|---|
| `obs-init` | 32MB | 일회성. 서버마다 다른 값(B의 IP, 웹훅)으로 설정 파일을 만들고 끝난다. prometheus와 alertmanager는 이것이 성공해야 뜬다 |
| `prometheus` | 512MB | 보존 7일, 5GB 상한. 관리 API(`/-/reload` 등)는 꺼져 있다. 호스트 게시는 `127.0.0.1:9090` |
| `alertmanager` | 64MB | 알림을 Mattermost 수신 웹훅(Slack 형식)으로 보낸다. 호스트에 게시하지 않는다 |
| `grafana` | 256MB | 대시보드 3개를 저장소에서 프로비저닝한다. 익명 접근이 없고 `127.0.0.1:3000`만 연다 |
| `node-exporter` | 64MB | 호스트 지표와 textfile 지표(`/var/lib/fit/metrics`의 백업 지표) |
| `cadvisor` | 192MB | 컨테이너별 CPU·메모리·재시작 |
| `blackbox` | 64MB | A에서 B의 TCP 22 프로브 |
| `postgres-exporter` | 64MB | `pg_monitor` 권한만 가진 `fit_monitor` 역할로 Postgres를 읽는다 |
| `opensearch-exporter` | 64MB | OpenSearch 클러스터 상태와 힙 |
| `dozzle` | 64MB | 컨테이너 로그 UI. `127.0.0.1:8888`만 연다 |

Prometheus가 긁는 대상: prometheus, alertmanager, node, cadvisor, caddy(엣지 메트릭 리스너), be(prod blue·green, dev의 관리 포트 8081. `env`·`color` 라벨을 붙인다), postgres, opensearch, blackbox, vault-ssh(B의 22번). BE와 caddy는 첫 배포 전에는 없어서 `verify-obs.sh`가 건너뛴다(SKIP).

## obs.env

`/etc/fit/obs.env`(root:docker 0640). 키 계약은 [env.md](../../docs/infra/contracts/env.md)의 `obs` 그룹이다. `install.sh`가 예제에서 만든다.

| 키 | 뜻 |
|---|---|
| `GRAFANA_ADMIN_PASSWORD` | Grafana admin 비밀번호 |
| `MATTERMOST_WEBHOOK_URL` | prod와 A 전체 알림의 수신 웹훅. 일일 점검 요약도 여기로 간다 |
| `MATTERMOST_WEBHOOK_URL_DEV` | dev 알림의 수신 웹훅(채널을 나눈다) |
| `B_IP` | B의 공인 IP. A에서 B의 22번을 프로브할 대상 |
| `FIT_MONITOR_PASSWORD` | `fit_monitor` 역할 비밀번호. `data.env`의 값과 같아야 한다 |

값이 비었거나 `REPLACE_ME`이면 `obs-init`이 거부하고 스택이 뜨지 않는다. 웹훅 주소는 설정 API나 로그에 나오지 않는다(`api_url_file`로 파일에서 읽는다).

## 알림

규칙은 `prometheus/rules/*.yml`, 단위 시험은 `prometheus/tests/*.test.yml`이다. 모든 알림은 `severity`, `summary`, `description`, `runbook`(설계 10.2절의 RB-번호)을 갖는다.

| 파일 | 알림 |
|---|---|
| `host.yml`(9) | 메모리, 스왑, OOM, 디스크(80%, 90%, 고갈 예측), CPU(30분, 2시간), 수집 대상 다운 |
| `containers.yml`(2) | 재시작 반복, 컨테이너 메모리 |
| `app.yml`(8) | BE prod·dev 다운, 5xx, 검색·일반 지연, 배치 지연, 배치·HTTP 지표 누락 |
| `modal.yml`(3) | Modal 폴백 비율, 예산, 예산 지표 누락(기록 규칙(recording rule)으로 15분 비율을 만든다) |
| `data.yml`(5) | Postgres 다운·연결 수, OpenSearch 다운·red·힙 |
| `backup.yml`(8) | 백업 신선도(pg, photos, caddy), 복원 검증, outbox, 지표 누락, B 도달 불가 |

받는 곳은 둘이다. dev 알림(`env=dev`)은 심각도와 관계없이 dev 수신자로, 그 밖은 main으로 간다. main의 critical은 1시간마다, 나머지는 4시간마다 다시 알린다. 같은 알림의 critical이 떠 있으면 warning은 보내지 않는다. 라우팅은 `alertmanager/routes.txt`의 시험 줄로 검사한다.

메시지 모양(`alertmanager/templates/fit.tmpl`): 제목 `[FIRING:N] 알림이름 (site/env)`, 본문에 요약, 설명, `런북: RB-번호`. critical은 빨강, 그 밖은 노랑, 해소는 초록이다.

BE가 내는 지표의 이름은 [metrics.md](../../docs/infra/contracts/metrics.md)가 정한다. 반드시 있어야 하는 지표는 사라지면 15분 뒤 `absent()` 알림이 운다.

## 일일 점검 요약

`daily-digest.py`가 매일 09:00(서버 시간대 Asia/Seoul)에 한 건을 올린다(설계 10.1절). 디스크, 메모리, 스왑, CPU 24시간 평균(기준선 40%), 백업 나이와 복원 검증, 5xx 건수, 새벽 배치, 알림 현황, prod·dev의 마지막 배포, 인증서 잔여일이다. 항목마다 정상(✅), 주의(⚠️), 값 없음(❔)을 붙이고 기준은 알림 규칙과 같다.

- 인증서 잔여일은 서버 자신의 443에서 읽는다(`openssl s_client`). 호스트 이름은 `/etc/fit/edge.env`의 `PROD_HOST`, `DEV_HOST`만 읽는다.
- Prometheus에 닿지 못하면 그 사실을 올리고 종료 코드 1로 끝난다. 웹훅으로 보내지 못해도 종료 코드 1이다(`systemctl status fit-daily-digest.service`로 보인다).
- 타이머가 도는 코드는 저장소 체크아웃이 아니라 root 소유 사본(`/usr/local/lib/fit/obs`)이다. 코드를 고치면 `install.sh`를 다시 실행한다.

## 시험

`bash infra/obs/test/test-obs.sh up`이 데이터 스택(OpenSearch 포함)과 가짜 BE·Caddy·B, 웹훅 대역, TLS 서버를 띄우고 스택을 올린다. `run [구역...]`의 구역은 `stack init scrape rules alert grafana digest install hygiene`이다. 알림 구역은 가짜 BE를 내려 실제 알림이 Mattermost 형식으로 도착하는지 본다(시험 사본은 `for`를 0s로, 그룹 대기와 반복 간격을 짧게 바꾼다. 식과 라우팅은 같다). `down`이 시험이 만든 것을 모두 지운다.

## 파일

| 경로 | 내용 |
|---|---|
| `compose.obs.yml` | 스택 정의 |
| `render.py` | `obs-init`이 실행하는 설정 생성기(값은 출력하지 않는다) |
| `obs.env.example` | 키 목록 |
| `prometheus/` | `prometheus.yml`, `rules/`, `tests/` |
| `alertmanager/` | `alertmanager.yml`, `templates/`, `routes.txt` |
| `grafana/` | `provisioning/`(데이터소스 uid `prom-a`, 대시보드 공급자), `dashboards/`(`fit-host`, `fit-app`, `fit-data`) |
| `blackbox/blackbox.yml` | 프로브 모듈 |
| `daily-digest.py`, `install.sh`, `conf/systemd/` | 일일 점검 요약과 설치, 타이머 |
| `verify-obs.sh` | 읽기 전용 점검(PASS, FAIL, SKIP) |
| `test/` | `test-obs.sh`, `compose.test.yml`, 가짜 대상과 웹훅 대역 |
````

`infra/ops/README.md`:

````markdown
# 감시 (서버 B)

서버 B의 `fit-ops` 프로젝트다. A가 죽어도 B가 A를 밖에서 보고 알린다. A의 외부 접근, 인증서, 80·443 도달성, A의 감시 체계, 포트 노출, 백업 금고를 본다. 설계는 [design.md](../../docs/infra/design.md) 9.3절이다. A 쪽 관측은 [obs/README.md](../obs/README.md)다.

## 자주 하는 일

| 하고 싶은 일 | 명령 |
|---|---|
| 설치(포트 감사 스크립트, `ops.env`, 감사 타이머) | `sudo bash infra/ops/install.sh` |
| 감시 스택 올리기 | `ops.env`를 채운 뒤 `sudo bash infra/ops/ops-up.sh` |
| 설계대로인지 점검 | `bash infra/ops/verify-ops.sh` |
| 포트 감사를 지금 돌리기 | `sudo systemctl start fit-port-audit-quick.service`(전체는 `fit-port-audit-full.service`) |
| Prometheus-B, Alertmanager-B 보기 | SSH 터널 `-L 9090:127.0.0.1:9090 -L 9093:127.0.0.1:9093` |
| 노트북에서 시험 | `bash infra/ops/test/test-ops.sh up`, `run`, `down` |

## 구성

| 서비스 | 한도 | 하는 일 |
|---|---|---|
| `ops-init` | 32MB | 일회성. A의 주소와 `/_ops` 자격, 웹훅으로 설정 파일을 만들고 끝난다 |
| `prometheus-b` | 160MB | 보존 7일, 2GB 상한. `127.0.0.1:9090` |
| `alertmanager-b` | 64MB | Mattermost로 보낸다. `127.0.0.1:9093` |
| `blackbox` | 64MB | A를 밖에서 두드린다 |
| `node-exporter` | 64MB | B 자신과 `/srv/vault/metrics`의 지표 파일(금고, 포트 감사) |

합계 352MB로 설계 4.2절의 ops 스택 예산(0.4GB) 안이다.

## 프로브

프로브 대상은 `ops-init`이 `PROD_HOST`, `DEV_HOST`로 만든다. 어떤 프로브인지는 `probe` 라벨이다.

| probe | 대상 | 모듈 | 알림 |
|---|---|---|---|
| `a-healthz`, `a-fe` | `https://<PROD_HOST>/healthz`, `/` | `http_2xx` | `FitExternalDown`(2분, critical) |
| `a-tcp-80`, `a-tcp-443` | `<PROD_HOST>:80`, `:443` | `tcp_connect` | `FitPortUnreachable`(2분, critical) |
| `a-tls-prod`, `a-tls-dev` | `<PROD_HOST>:443`, `<DEV_HOST>:443` | `tcp_tls` | 만료 14일 미만 `FitCertExpiringSoon`, 7일 미만 `FitCertExpiringCritical`, 연결 실패 `FitTlsProbeFailed` |
| `a-prometheus`, `a-alertmanager` | `https://<PROD_HOST>/_ops/prometheus/healthy`, `/_ops/alertmanager/healthy` | `http_ops` | `FitOpsWatcherDown`(2분, critical). A의 알림이 조용해졌는지 본다 |

인증서 검증은 켠 상태가 기본이다. `/_ops`는 B의 IP와 basic auth를 둘 다 통과해야 열리고(엣지의 `ops_route`) 아니면 404다.

## 포트 노출 감사

`port-audit.py`(표준 라이브러리만)가 B에서 A를 TCP connect로 두드려 22·80·443 말고 열린 포트가 있는지 본다. 이 스캔은 우리 서버(A)에만 건다.

| 모드 | 범위 | 주기 | 유닛 |
|---|---|---|---|
| `quick` | 1~1,024번과 자주 쓰는 서비스 포트 44개(DB, 캐시, 관리 UI, 이 프로젝트의 내부 포트) | 15분 | `fit-port-audit-quick.timer` |
| `full` | 1~65,535번 전체 | 매일 05:30 | `fit-port-audit-full.timer` |

결과는 `/srv/vault/metrics/fit_portaudit_<mode>.prom`에 쓰고 node-exporter가 읽는다(임시 파일에 쓴 뒤 이름을 바꾼다). 예상 밖 포트가 열려 있어도 종료 코드는 0이고 알림은 지표가 건다. 주소를 찾지 못하는 등 감사를 하지 못하면 종료 코드 1이고 지표는 갱신하지 않는다(오래되면 `FitPortAuditStale`이 운다).

| 지표 | 뜻 |
|---|---|
| `fit_portaudit_last_scan_timestamp_seconds{mode}` | 마지막으로 스캔을 끝낸 시각 |
| `fit_portaudit_scan_duration_seconds{mode}` | 걸린 시간 |
| `fit_portaudit_open_ports{mode}`, `fit_portaudit_unexpected_ports{mode}` | 열린 포트 수, 예상 밖 포트 수 |
| `fit_portaudit_port_open{mode,port}` | 예상 밖에서 열린 포트(값 1) |

알림: `FitPortExposed`(예상 밖 포트가 있으면, critical), `FitPortAuditStale`(quick 1시간, full 36시간), `FitPortAuditMissing`.

## 금고와 B 자신

금고 지표(`fit_vault.prom`)는 계획 1D의 `vault-ingest.sh`가 쓴다. `FitVaultStale`(pg를 8시간 넘게 못 받음, critical), `FitVaultRestoreCheckOverdue`(복원 리허설 8일, info), `FitVaultQuarantine`, `FitVaultIngestFailing`, `FitVaultIngestStale`, `FitVaultMetricMissing`. B 자신은 `FitOpsDiskHigh`(80%), `FitOpsMemoryLow`(8% 미만), `FitOpsScrapeTargetDown`이다. 알림은 모두 prod에 관한 것이라 수신자 하나(main)로 간다.

## ops.env

`/etc/fit/ops.env`(`install.sh`가 예제에서 600 root:root로 만든다). 키 계약은 [env.md](../../docs/infra/contracts/env.md)의 `ops` 그룹이다.

| 키 | 뜻 |
|---|---|
| `PROD_HOST`, `DEV_HOST` | A의 prod·dev 호스트 이름(바깥에서 보는 주소). 포트 감사도 `PROD_HOST`를 대상으로 한다 |
| `OPS_BASIC_AUTH_USER`, `OPS_BASIC_AUTH_PASSWORD` | A의 `/_ops` 접근 자격. 비밀번호는 영문·숫자·`._~-`만 쓴 16자 이상이다 |
| `MATTERMOST_WEBHOOK_URL` | 알림 수신 웹훅 |

### `/_ops` 자격 만들기

비밀번호(평문)는 B의 `ops.env`에, 그 해시는 A의 `edge.env`에 둔다. 해시는 `caddy hash-password`의 출력을 base64로 인코딩해 둔다(원본의 `$`가 env 형식 규칙에 걸린다. Caddy는 base64 형태도 받는다).

```bash
pw="$(head -c 18 /dev/urandom | base64 | tr -d '/+=\n' | head -c 24)"     # ops.env의 OPS_BASIC_AUTH_PASSWORD
docker run --rm caddy:2.11.7 caddy hash-password --plaintext "$pw" | tr -d '\n' | base64 | tr -d '\n'   # edge.env의 OPS_BASIC_AUTH_HASH
```

값을 화면에 남기지 않도록 터미널 기록을 정리한다. 엣지는 `bash infra/edge/edgectl.sh reload`로 적용한다.

## 시험

`bash infra/ops/test/test-ops.sh up`이 가짜 A(Caddy 내부 CA, `/_ops` basic auth), 웹훅 대역, B 스택을 띄운다. `run [구역...]`의 구역은 `stack init probes alert vault ports install hygiene`이다. 가짜 A를 멈추면 외부 알림 네 가지가 Mattermost 형식으로 도착하는지, 금고 지표 파일과 포트 감사 결과가 알림까지 이어지는지, 설치와 `ops-up.sh`가 멱등인지를 본다. 시험 사본은 `for`를 0s로, 그룹 대기와 반복 간격을 짧게 바꾼다(식과 라우팅은 같다). `down`이 시험이 만든 것을 모두 지운다.

## 파일

| 경로 | 내용 |
|---|---|
| `compose.ops.yml`, `ops.env.example` | 스택 정의와 키 목록 |
| `render.py` | `ops-init`이 실행하는 설정 생성기(값은 출력하지 않는다) |
| `prometheus/` | `prometheus.yml`, `rules/`(`probes.yml`, `vault.yml`, `host.yml`), `tests/` |
| `alertmanager/`, `blackbox/` | 설정, 메시지 견본, 라우팅 시험 목록, 프로브 모듈 견본 |
| `port-audit.py`, `install.sh`, `conf/systemd/` | 포트 노출 감사와 설치, 타이머 |
| `ops-up.sh`, `verify-ops.sh` | 스택 올리기와 읽기 전용 점검 |
| `test/` | `test-ops.sh`, `compose.test.yml` |
````

`docs/infra/contracts/metrics.md`:

````markdown
# 지표 계약 (BE)

BE가 `/actuator/prometheus`로 내야 하는 지표의 이름이다. 알림 규칙([infra/obs/prometheus/rules](../../../infra/obs/prometheus/rules))이 이 이름을 그대로 쓴다. 이름이 다르면 알림이 조용히 멈추므로, 반드시 있어야 하는 지표는 사라지면 `absent()` 알림이 운다([design.md](../design.md) 9.4절).

- 상태: **제안**. BE·AI 팀과 M1 전에 합의한다([README.md](README.md)).
- 노출: 관리 포트 8081의 `/actuator/prometheus`. 공개하지 않는다(Prometheus가 `be-prod-blue:8081`, `be-prod-green:8081`, `be-dev:8081`을 긁는다). `env`(prod, dev)와 `color` 라벨은 Prometheus가 붙인다. BE가 내지 않는다.
- 형식: heartbeat 지표는 counter가 아니라 gauge로 만든다(시계열이 처음부터 존재해야 `absent()`가 쓸모 있다. design.md 9.4절).

## 필수 지표

| 지표 | 종류 | 라벨 | 뜻 | 쓰는 알림 |
|---|---|---|---|---|
| `http_server_requests_seconds_count`, `http_server_requests_seconds_bucket` | counter, histogram | `status`(예: `200`, `503`), `uri`(경로 템플릿. 예: `/api/v1/search`), `method` | Spring Boot Micrometer의 기본 HTTP 서버 지표. 히스토그램 버킷을 켠다(`management.metrics.distribution.percentiles-histogram.http.server.requests=true`) | `FitHttp5xxHigh`, `FitSearchLatencyHigh`, `FitHttpLatencyHigh`, `FitHttpMetricMissing` |
| `batch_last_success_timestamp_seconds` | gauge | 없음 | 새벽 배치가 마지막으로 성공한 시각(UTC epoch 초). 기동 직후에도 값이 있어야 한다(재시작해도 마지막 성공 시각을 이어 낸다) | `FitBatchStale`(26시간), `FitBatchMetricMissing` |
| `modal_daily_budget_used_ratio` | gauge | 없음 | Modal 일일 호출 예산 사용 비율(0~1, Redis 카운터) | `FitModalBudgetHigh`(80%), `FitModalMetricMissing` |

검색 경로의 `uri`는 `/api/v1/search`로 시작해야 검색 지연 알림이 따로 센다(design.md 9.2절).

## Modal 호출 지표

구성요소는 `embedding`, `reranker`, `llm` 셋이다. 호출 횟수와 폴백 횟수를 구성요소마다 counter로 낸다. 폴백 비율은 Prometheus의 기록 규칙(recording rule)이 15분 비율로 만든다.

| 지표 | 종류 | 뜻 |
|---|---|---|
| `modal_embedding_calls_total`, `modal_reranker_calls_total`, `modal_llm_calls_total` | counter | Modal 호출 시도 수(성공과 실패 모두) |
| `modal_embedding_fallback_total`, `modal_reranker_fallback_total`, `modal_llm_fallback_total` | counter | 폴백(키워드 검색 등)으로 내려간 수 |

알림 `FitModalFallbackHigh`는 15분 폴백 비율이 30%를 넘고 호출이 초당 0.01건을 넘을 때 울린다.

## 합의할 점

- 지표 이름과 라벨(위 표)을 BE가 그대로 내는지. 이름을 바꾸면 알림 규칙과 대시보드(`infra/obs/grafana/dashboards`)를 함께 고친다.
- `uri` 라벨이 경로 변수를 템플릿(`/api/v1/restaurants/{id}`)으로 내는지(원래 값을 그대로 내면 계열 수가 폭발한다. Spring MVC의 기본 동작이 템플릿이다).
- 배치 성공 시각을 재시작해도 이어 내는 방법(DB나 Redis에 저장)과 `*_ENABLED` 스위치가 꺼진 환경(dev)의 처리. 알림은 prod만 본다.
````

- [ ] **Step 2: 문서와 검사 대상 수정**

````diff
diff --git a/docs/infra/contracts/README.md b/docs/infra/contracts/README.md
index 1877e19..409b813 100644
--- a/docs/infra/contracts/README.md
+++ b/docs/infra/contracts/README.md
@@ -7,6 +7,7 @@ BE, AI, 프런트 팀과 인프라가 서로 지켜야 할 규약이다. 서버
 | 계약 | 위치 | 합의할 팀 | 상태 | 합의일 |
 |---|---|---|---|---|
 | 환경변수 | [env.md](env.md) | BE, 프런트 | 제안 | |
+| 지표(BE) | [metrics.md](metrics.md) | BE, AI | 제안 | |
 | BE | design.md 12.1절 | BE | 제안 | |
 | AI(Modal 호출) | design.md 12.2절, 12.3절 | AI, BE | 제안 | |
 | 프런트 | design.md 12.5절 | 프런트 | 제안 | |
````

````diff
diff --git a/docs/infra/design.md b/docs/infra/design.md
index 70b8d59..85e5d55 100644
--- a/docs/infra/design.md
+++ b/docs/infra/design.md
@@ -512,7 +512,7 @@ FE는 `fe/`의 Next.js를 `output: 'standalone'`으로 빌드한 Node 컨테이
 
 - 이미지는 `pgvector/pgvector:0.8.7-pg16`으로 핀한다(로컬 스택과 같다).
 - 튜닝은 mount한 설정 파일이 아니라 `command:` 플래그로 한다(shared_buffers 256MB, max_connections 60, `idle_in_transaction_session_timeout`, `pg_stat_statements`).
-- 환경별 DB·role은 init 스크립트가 아니라 멱등 `infra/data/ensure-databases.sh`로 만든다. init 스크립트는 빈 볼륨에서 한 번만 돌기 때문이다(A503 함정). role은 `fit_migrator`(DDL, 두 DB의 소유자), `fit_prod_app`, `fit_dev_app`(DML만)이고 DB는 `fit_prod`, `fit_dev`다. 각 앱 role은 자기 DB에만 접속하고(`REVOKE ... FROM PUBLIC`), 마이그레이터가 만드는 테이블·시퀀스에는 기본 권한으로 DML 권한이 따라간다. 비밀번호는 실행할 때마다 `/etc/fit/data.env` 값으로 맞춘다(교체는 값을 바꾸고 다시 실행). dev role에는 `statement_timeout` 30초를 건다 (확인: `infra/data/test/test-data.sh`).
+- 환경별 DB·role은 init 스크립트가 아니라 멱등 `infra/data/ensure-databases.sh`로 만든다. init 스크립트는 빈 볼륨에서 한 번만 돌기 때문이다(A503 함정). role은 `fit_migrator`(DDL, 두 DB의 소유자), `fit_prod_app`, `fit_dev_app`(DML만), `fit_monitor`(`pg_monitor` 멤버. postgres_exporter가 `postgres` DB에서 통계만 읽고 앱 DB에는 접속하지 못한다)이고 DB는 `fit_prod`, `fit_dev`다. 각 앱 role은 자기 DB에만 접속하고(`REVOKE ... FROM PUBLIC`), 마이그레이터가 만드는 테이블·시퀀스에는 기본 권한으로 DML 권한이 따라간다. 비밀번호는 실행할 때마다 `/etc/fit/data.env` 값으로 맞춘다(교체는 값을 바꾸고 다시 실행). dev role에는 `statement_timeout` 30초를 건다 (확인: `infra/data/test/test-data.sh`).
 - 비밀번호는 SQL에 그대로 들어가므로 영문·숫자·`._~-`만 쓴 16자 이상으로 제한하고 스크립트가 그 밖의 값을 거부한다. data.env는 셸로 실행하지 않고 `KEY=VALUE` 줄만 읽는다. SQL은 표준 입력으로 넘기고 `log_statement`와 `pg_stat_statements.track_utility`를 꺼서 비밀번호가 프로세스 목록, Postgres 로그, 통계에 남지 않는다 (확인: 위 시험).
 - 공식 이미지는 컨테이너 안 loopback 접속을 비밀번호 없이 허용(trust)한다. 다른 컨테이너가 서비스 이름으로 들어오는 접속은 scram-sha-256 비밀번호 검사를 받는다 (확인: 틀린 비밀번호가 거부됨). 호스트 게시 포트(`127.0.0.1:5432`)로 들어오는 접속은 출발지가 loopback이 아니라 같은 규칙을 받는다 (서버에서 터널로 확인).
 - 개발자용 dev DB 접근은 SSH 터널 → `127.0.0.1:5432`이고 dev role 비밀번호만 공유한다.
@@ -576,8 +576,11 @@ Garage는 단일 노드라도 레이아웃 설정이 필요하다(`layout assign
 
 ### 9.1 A 스택
 
-- Prometheus(보존 7일 + 5GB 상한), Alertmanager → Mattermost, Grafana(대시보드 3개를 repo에서 프로비저닝, SSH 터널로 접속, 익명 접근 없음)
+- Prometheus(보존 7일 + 5GB 상한), Alertmanager → Mattermost(수신 웹훅에 Slack 형식으로 보낸다), Grafana(대시보드 3개를 repo에서 프로비저닝, SSH 터널로 접속, 익명 접근 없음)
 - node_exporter, cAdvisor, blackbox_exporter, postgres_exporter, OpenSearch exporter, Dozzle(로그 UI)
+- 프로젝트 `fit-obs`(`infra/obs/compose.obs.yml`). 서버마다 다른 값(B의 IP, 웹훅)은 일회성 서비스 `obs-init`(`render.py`)이 시작 때 설정 파일로 만들고, 나머지 설정은 저장소 파일 그대로 쓴다. 한도의 합은 1,344MB다(4.1절).
+- postgres_exporter는 `fit_monitor` role로 읽는다(7.1절). 호스트가 쓰는 지표(백업)는 node_exporter의 textfile collector로 읽는다(`/var/lib/fit/metrics`).
+- 사용법과 알림 목록은 [infra/obs/README.md](../../infra/obs/README.md)다.
 - Loki·Tempo·OTel은 올리지 않는다. 로그 검색이 필요해지면 Alloy + Loki(보존 3일)를 나중에 추가한다. Promtail은 2026-03-02에 EOL이다 (확인).
 
 대시보드 3개:
@@ -601,6 +604,9 @@ Garage는 단일 노드라도 레이아웃 설정이 필요하다(`layout assign
 | OpenSearch·Postgres | red, 힙 >90%, 연결 >80%, pg_up==0 | critical / warning |
 | 폴백 | `*_fallback_ratio` >30% 15분(임베딩·리랭커·LLM 각각) | warning |
 | Modal 예산 | 일일 호출 예산 80% 소진(Redis 카운터) | warning |
+| 백업 | 마지막 성공 pg >8시간, photos >36시간, caddy >9일, 복원 검증 실패나 36시간 넘게 없음, 전송 대기(outbox) 파일 | warning |
+| 수집 대상 | prometheus, alertmanager, node, cadvisor, caddy, postgres, opensearch, blackbox의 `up==0` 5분 | warning |
+| 지표 누락 | 반드시 있어야 하는 지표(BE HTTP, 배치, Modal 예산, 백업)가 15분 넘게 없음(`absent()`) | warning |
 | B 도달 불가 | A에서 B의 TCP 22 프로브 실패 | warning (CI·백업 영향) |
 
 ### 9.3 B 알림
@@ -608,17 +614,20 @@ Garage는 단일 노드라도 레이아웃 설정이 필요하다(`layout assign
 | 알림 | 조건 | 심각도 |
 |---|---|---|
 | 외부 접근 | A `/healthz` 또는 `/`(FE) 2분 연속 실패 | critical |
-| 인증서 | 밖에서 본 만료일 <14일 / <7일 | warning / critical |
+| 인증서 | 밖에서 본 만료일 <14일 / <7일. TLS 연결이 실패해 만료일을 읽지 못하면 따로 warning | warning / critical |
 | 포트 도달성 | A의 80·443 TCP 불가 | critical |
-| 포트 노출 감사 | 15분마다 A의 상위 1,000 포트(+매일 전체 스캔)를 밖에서 스캔. 22·80·443 외에 열린 포트가 있으면 | critical |
+| 포트 노출 감사 | 15분마다 A의 1~1,024번과 자주 쓰는 서비스 포트를, 매일 05:30에 1~65,535번 전체를 밖에서 스캔(`infra/ops/port-audit.py`). 22·80·443 외에 열린 포트가 있으면. 감사가 1시간(전체는 36시간) 넘게 안 돌면 warning | critical |
 | 감시 체계 감시 | A의 `/_ops/prometheus/healthy`, `/_ops/alertmanager/healthy` 실패 | critical |
-| 백업 금고 | 마지막 수신 >8시간 / 사람 복원 리허설 >8일 | critical / info |
-| B 자신 | 디스크 80%, 메모리 부족 | warning |
+| 백업 금고 | 마지막 수신 >8시간 / 사람 복원 리허설 >8일. 격리 파일, 검증 실패, ingest 중단은 warning | critical / info |
+| B 자신 | 디스크 80%, 메모리 8% 미만, 수집 대상 다운 | warning |
+
+B의 알림은 모두 prod에 관한 것이라 수신자는 하나다. 프로브 대상과 지표는 [infra/ops/README.md](../../infra/ops/README.md)다.
 
 ### 9.4 공통 규칙
 
 - heartbeat 지표는 counter가 아니라 gauge로 만든다(계열이 처음부터 존재). 반드시 있어야 하는 지표는 `absent()` 알림을 둔다.
-- 모든 규칙을 `promtool test rules`로 CI에서 검증한다(이름·uid 중복 포함).
+- 모든 규칙을 `promtool test rules`로 CI에서 검증한다. `infra/ci/check_alerts.py`가 알림 이름(`Fit` 접두사, 중복)과 severity·summary·description·runbook, 단위 시험의 존재, 대시보드의 uid·패널 id 중복과 데이터소스를, `infra/ci/check-alertmanager.sh`(amtool)가 설정과 라우팅(`routes.txt`)을 검사한다.
+- BE가 내는 지표 이름은 [contracts/metrics.md](contracts/metrics.md)가 정한다.
 - 알림마다 runbook 링크를 단다.
 - 두 Alertmanager 모두 Mattermost로 보내되 `site`(A/B)와 `env` 라벨을 붙인다. dev의 warning은 별도 수신자로 보낸다. critical 채널에는 prod와 B 알림만 간다.
 - Alertmanager 웹훅 URL은 `api_url_file`로 시크릿 파일에서 읽는다.
@@ -627,7 +636,7 @@ Garage는 단일 노드라도 레이아웃 설정이 필요하다(`layout assign
 
 ### 10.1 일일 점검
 
-매일 09:00 KST에 `daily-digest.sh`(A)가 아래 항목을 Mattermost에 올린다: 디스크·메모리·스왑, CPU 24시간 평균(40% 기준선 대비), 백업 나이, 마지막 배포, 인증서 잔여일, 5xx 건수, 배치 결과.
+매일 09:00 KST에 `infra/obs/daily-digest.py`(A, `fit-daily-digest.timer`)가 아래 항목을 Mattermost에 올린다: 디스크·메모리·스왑, CPU 24시간 평균(40% 기준선 대비), 백업 나이, 마지막 배포, 인증서 잔여일, 5xx 건수, 배치 결과, 지금 울리는 알림. 항목마다 정상·주의·값 없음을 붙인다. 인증서 잔여일은 서버 자신의 443에서 읽는다. Prometheus나 웹훅에 닿지 못하면 그 사실을 올리고 종료 코드 1로 끝난다.
 
 ### 10.2 런북
 
@@ -899,11 +908,11 @@ AI 팀과 M1 전에 합의한다. FastAPI는 Modal에서 돌고 A·B에는 AI 
 | `/etc/fit/fe-prod.env`, `fe-dev.env` | A | root:docker 0640 | FE env(비밀 없음. 내부 BE 주소, 브라우저에 공개되는 키) |
 | `/etc/fit/migrate-prod.env`, `migrate-dev.env` | A | root:docker 0640 | 마이그레이션 일회성 컨테이너의 DDL 자격(웹 컨테이너에는 넣지 않는다) |
 | `/etc/fit/data.env` | A | root:docker 0640 | DB·Redis·Garage 자격 |
-| `/etc/fit/edge.env` | A | root:docker 0640 | `ACME_EMAIL`, `ACME_MODE`, `HSTS_MODE`, `PROD_HOST`, `DEV_HOST`, B의 IP, `/_ops` basic auth 해시, dev 게이트 키(`?k=` 쿠키 발급용) |
-| `/etc/fit/obs.env` | A | root:docker 0640 | Grafana admin, Mattermost 웹훅 |
+| `/etc/fit/edge.env` | A | root:docker 0640 | `ACME_EMAIL`, `ACME_MODE`, `HSTS_MODE`, `PROD_HOST`, `DEV_HOST`, B의 IP, `/_ops` basic auth 사용자와 해시, dev 게이트 키(`?k=` 쿠키 발급용) |
+| `/etc/fit/obs.env` | A | root:docker 0640 | Grafana admin, Mattermost 웹훅(main·dev), B의 IP, `fit_monitor` 비밀번호 |
 | `/etc/fit/backup.env` | A, B | root:docker 0640 | 백업 설정(B의 주소와 SSH 포트, 보관 기간). 비밀은 없다 |
 | `/etc/fit/keys/` | A | root:root 0700(파일 0600) | vault SSH 개인키(`vault_ed25519`), B의 호스트 키(`vault_known_hosts`), age 수신자 공개키(`age-recipients.txt`) |
-| `/etc/fit/ops.env` | B | root:docker 0640 | Mattermost 웹훅, A의 `/_ops` 자격 |
+| `/etc/fit/ops.env` | B | root:root 0600 | A의 호스트(`PROD_HOST`, `DEV_HOST`), Mattermost 웹훅, A의 `/_ops` 자격(사용자와 평문 비밀번호) |
 | age 개인키 | 서버 없음 | 수신자 2명이 오프라인 보관 | 백업 복호화 |
 
 - `/_ops` basic auth 해시는 `caddy hash-password` 출력을 base64로 인코딩해 둔다. 원본의 `$`가 env 형식 규칙에 걸리고, Caddy는 base64 형태도 받는다 (확인).
@@ -928,6 +937,7 @@ AI 팀과 M1 전에 합의한다. FastAPI는 Modal에서 돌고 A·B에는 AI 
 - B의 verify 러너는 docker.sock으로 B의 root 권한을 가지므로 `ops.env`(웹훅, `/_ops` 자격)를 읽을 수 있다. A에 대한 SSH 키는 B에 없다. 그러나 같은 권한으로 `/srv/vault/store`(금고)를 지울 수도 있다. A에 로컬 사본(48시간 + 14일)이 남고 복원 리허설 때 내려받은 최신 덤프 1벌을 노트북에 둔다(8절). MR 파이프라인에서 임의 코드가 돌 수 있으므로 프로젝트 멤버를 팀원으로 한정하고 MR 리뷰 후 병합한다.
 - Modal 토큰이 유출되면 지출이 생긴다. 토큰은 환경별로 분리해 서버 env에만 두고, Modal의 지출 한도와 BE의 일일 호출 예산이 상한이다(11.2절).
 - OpenSearch는 보안 플러그인을 끈다. 내부 망이고 호스트 게시가 없다는 전제이며, 앱 컨테이너가 침해되면 인덱스가 변조될 수 있다. DB 자격 침해와 같은 수준의 위험으로 보고 수용한다. 두 환경의 BE가 `net-data`를 공유해 be-dev가 prod 인덱스를 읽고 쓸 수 있다. 기동 시 접두사 대조(12.1 #8)는 사고를 막지만 악의는 막지 못한다.
+- Dozzle(로그 UI)은 `docker.sock`을 읽기 전용으로 마운트한다. 읽기 전용이어도 소켓의 API는 컨테이너 설정(환경변수 포함)을 읽을 수 있어서 Dozzle이 침해되면 비밀이 노출될 수 있다. `127.0.0.1:8888`에만 게시하고 SSH 터널로만 연다. 팀원 터널 허용 목록(13.3절)에 8888이 들어 있어 팀원은 prod를 포함한 모든 컨테이너의 로그를 볼 수 있으므로, 로그에 개인정보와 비밀을 남기지 않는 것(12절)이 전제다. cAdvisor도 호스트의 `/`, `/sys`, `/var/lib/docker`를 읽기 전용으로 마운트한다.
 - 개인정보는 로그 마스킹(12절), 백업 암호화(8절), 종료 시 삭제(RB-10), 외부 전송 고지(11.2절)로 다룬다.
 
 ## 14. 일정과 우선순위
@@ -1002,7 +1012,7 @@ AI 팀과 M1 전에 합의한다. FastAPI는 Modal에서 돌고 A·B에는 AI 
 | 12 | 당번표(11/06~11/18)와 점검 창 | 팀 | M4 |
 | 13 | Garage 스파이크 결과 | 인프라 | M1~M2 |
 | 14 | 푸시 방식(FCM 웹 푸시 vs VAPID 직접 구현) | 프런트 팀 | M2 |
-| 15 | Docker 29일 때 cAdvisor·Dozzle 호환 | 인프라 | 사전(로컬 Docker 29.7.2로 확인) |
+| 15 | 서버의 Docker 버전에서 cAdvisor·Dozzle 호환. 로컬 Docker 29.7.2에서는 확인했다(`infra/obs/test/test-obs.sh`: cAdvisor가 컨테이너 이름과 메모리 한도를 내고 Dozzle이 뜬다) | 인프라 | M0(서버에서 `verify-obs.sh`) |
 | 16 | 포팅 매뉴얼 필요 여부와 양식 | 팀, 코치 | M3 전 |
 | 17 | buildx 자원 상한 방법. `rrsync`는 24.04에서 확인했고(8절) 22.04는 서버에서 확인한다 | 인프라 | M0~M1 |
 | 18 | 프런트 팀 합의: 12.5절 계약(standalone 빌드, 같은 출처, 환경 값, 헬스, 이미지, 서비스 워커, dev 게이트, 쿠키, SSE, 공유) | 프런트 팀, 인프라 | M1 전 |
@@ -1021,21 +1031,21 @@ AI 팀과 M1 전에 합의한다. FastAPI는 Modal에서 돌고 A·B에는 AI 
 ```
 infra/
   host/        bootstrap.sh, verify-host.sh, networks.sh, docker-prune.sh, README.md, conf/(sshd, sysctl, daemon.json, fail2ban, apt, systemd units), test/(test-host.sh, run-in-container.sh)
-  edge/        compose.edge.yml, conf/(Caddyfile, acme/, hsts/), state-sample/, edge.env.example, edgectl.sh, verify-edge.sh, README.md, test/(compose.test.yml, test-edge.sh, 목 BE·FE)
+  edge/        compose.edge.yml, conf/(Caddyfile, acme/, hsts/), state-sample/, edge.env.example, edgectl.sh, verify-edge.sh, README.md, test/(compose.test.yml, test-edge.sh, 목 BE·FE, `/_ops` 시험용 감시 체계 대역과 프로브)
   data/        compose.data.yml, data.env.example, lib.sh, init-data.sh, ensure-databases.sh, init-garage.sh, verify-data.sh, s3tool.py, garage/garage.toml, README.md, test/(test-data.sh, compose.test.yml). OpenSearch는 local/opensearch/Dockerfile을 빌드한다
   app/         compose.app.yml(프로필 prod·dev), *.env.example
-  obs/         compose.obs.yml, prometheus/(rules, tests), alertmanager/, grafana/(provisioning, dashboards), blackbox/
-  ops/         (B) compose.ops.yml, prometheus/, alertmanager/, blackbox, port-audit.sh
+  obs/         compose.obs.yml, obs.env.example, render.py(obs-init), prometheus/(prometheus.yml, rules, tests), alertmanager/(alertmanager.yml, templates, routes.txt), grafana/(provisioning, dashboards), blackbox/, daily-digest.py, install.sh, verify-obs.sh, conf/systemd/, README.md, test/(test-obs.sh, compose.test.yml, 가짜 대상)
+  ops/         (B) compose.ops.yml, ops.env.example, render.py(ops-init), prometheus/(prometheus.yml, rules, tests), alertmanager/, blackbox/, port-audit.py, install.sh, ops-up.sh, verify-ops.sh, conf/systemd/, README.md, test/(test-ops.sh, compose.test.yml)
   deploy/      deploy.sh, rollback.sh, preflight.sh, smoke.sh, notify.sh, fit-up.sh, lib.sh, README.md, test/(test-deploy.sh, 목 BE·FE 이미지)
   backup/      lib.sh, pg-backup.sh, verify-dump.sh, files-backup.sh(photos, caddy), push-vault.sh, backup-run.sh, vault-ingest.sh(B), vault-authorize.sh(B), restore-check.sh(노트북용), install.sh, backup.env.example, conf/systemd/, README.md, test/(test-backup.sh, node/Dockerfile)
-  ci/          ports_invariant.py, check_compose_projects.py, check_env_files.py, check_env_contract.py, check_eol.py, check_linear_history.py, no-merge-commit.sh, check-caddy.sh, migration_immutability.py, images_arch.py, run-local-checks.sh, tool-images.sh, compose-projects.txt, tests/
+  ci/          ports_invariant.py, check_compose_projects.py, check_env_files.py, check_env_contract.py, check_eol.py, check_linear_history.py, no-merge-commit.sh, check-caddy.sh, check-prometheus.sh, check-alertmanager.sh, check_alerts.py, migration_immutability.py, images_arch.py, run-local-checks.sh, tool-images.sh, compose-projects.txt, tests/
   local/       compose.yml (profile: core, search), fit-local.sh, local.env.example, garage/, opensearch/Dockerfile, README.md
 .gitlab-ci.yml
 docs/infra/
   design.md    이 문서
   runbooks/    RB-01 ~ RB-13
   porting/     포팅 매뉴얼 초안(버전, 환경변수, 외부 서비스, DB 덤프, 시연)
-  contracts/   README.md(합의 상태), env.md. BE·AI(Modal 호출)·프런트 계약은 합의되면 이 폴더로 옮긴다
+  contracts/   README.md(합의 상태), env.md, metrics.md. BE·AI(Modal 호출)·프런트 계약은 합의되면 이 폴더로 옮긴다
   ssh-matrix.md
   gitlab-setup.md  GitLab 프로젝트 설정·러너 등록 체크리스트
 ```
@@ -1105,6 +1115,13 @@ docs/infra/
 | 백업 | 덤프 검증 방식 | 임시 컨테이너에 복원하고 테이블 수를 덤프 시점 값과 비교 | `pg_restore -l` 목차 확인만(데이터가 읽히는지 모른다) |
 | 관측성 | B 감시 구성 | Prometheus-B·Alertmanager-B·blackbox(설정이 repo에 남는다) | Uptime Kuma 한 개(설정이 UI에 남아 repo 관리 원칙과 어긋난다) |
 | 관측성 | 우선순위 | 감시 체계 감시(`/_ops`)는 P0, `lint:image-arch`는 P1 | 둘 다 P2로 내리기(비용이 거의 없어 유지) |
+| 관측성 | 알림 전달 | Alertmanager `slack_configs`로 Mattermost 수신 웹훅에 보낸다(주소는 `api_url_file`) | 별도 알림 어댑터(구성요소가 늘어난다) |
+| 관측성 | 서버별 값 | 일회성 서비스(`obs-init`, `ops-init`)가 환경변수로 필요한 설정 파일만 만든다. 나머지 설정은 저장소 파일 그대로다 | 설정 파일 전체를 서버에서 생성(검증할 수 없는 파일이 는다) |
+| 관측성 | 호스트 지표 | 백업·금고·포트 감사 결과는 파일로 쓰고 node_exporter의 textfile collector가 읽는다 | pushgateway(상시 프로세스가 는다) |
+| 관측성 | `/_ops` 실패 응답 | B의 IP와 basic auth를 모두 통과하지 못하면 401이 아니라 404(경로가 있다는 단서를 주지 않는다) | 401 |
+| 관측성 | 포트 감사 방식 | B에서 표준 라이브러리만 쓰는 TCP connect 스캔. 자주 쓰는 포트 15분, 전체 매일 | nmap(패키지와 결과 파싱이 늘어난다) |
+| 관측성 | 일일 요약 | Python 표준 라이브러리와 openssl. 인증서 잔여일은 서버 자신의 443에서 읽는다 | 셸 스크립트(JSON 처리가 취약), A가 B의 인증서 프로브를 조회(호스트 사이에 새 경로가 생긴다) |
+| 관측성 | 로그 UI | Dozzle(`docker.sock` 읽기 전용, 127.0.0.1만 게시). 한계는 13.4절 | 로그 UI 없이 서버에서 `docker logs`(터널 접근자가 셸이 없어 로그를 볼 수 없다) |
 
 ## 부록 C. 출처
 
````

````diff
diff --git a/docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md b/docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md
index 198379d..f985304 100644
--- a/docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md
+++ b/docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md
@@ -95,7 +95,7 @@
 | [1B 로컬 개발 환경과 서비스 계약](2026-10-19-plan-1b-local-env-contracts.md) | `infra/local/compose.yml`(profile `core`: Postgres(pgvector)·Redis·Garage, `search`: nori를 넣은 OpenSearch)과 `fit-local.sh`, `docs/infra/contracts/`(env.md와 합의 상태 목록. BE·AI(Modal 호출)·프런트 계약은 합의되면 옮긴다), `*.env.example`, 계약과 예제의 일치 검사. BE·FE 팀이 이미 개발 중이라 서버 없이도 가장 먼저 쓰이는 산출물이고, 계약은 M1 전에 합의해야 한다 |
 | 1C 엣지와 배포(셋으로 나눈다) | **1C-1 엣지**([계획](2026-10-20-plan-1c1-edge.md)): Caddyfile(호스트별 사이트, Next.js SSR 프록시와 정적 자산 풀, dev 쿠키 게이트, 사진 업로드·읽기 프록시), `compose.edge.yml`, `edgectl.sh`, `verify-edge.sh`, 노트북 시험 환경. **1C-2 배포 스크립트**([계획](2026-10-21-plan-1c2-deploy.md)): `compose.app.yml`(be, fe), `deploy.sh`(BE·FE Blue/Green과 정적 자산 풀 동기화)·`rollback.sh`·`preflight.sh`(다운그레이드 가드, `BE_INTERNAL_URL` 포트 확인 포함)·`smoke.sh`(검색 1건의 폴백 표시 확인 포함)·`fit-up.sh`(재부팅 뒤 기동 순서), 로컬 시뮬레이션. **1C-3 CI 파이프라인**: `.gitlab-ci.yml`의 `be:test`·`fe:test`·`fe:build`(FE 산출물 검사 포함)·`build`·`deploy`(`environment`, 환경별 `resource_group`)·`smoke` 잡. 이 계획의 `check_env_files.py`, `ports_invariant.py`를 호출한다 |
 | 1D 데이터와 백업([계획](2026-10-21-plan-1d-data-backup.md)) | `infra/data/`(`compose.data.yml`, `ensure-databases.sh`, `init-garage.sh`, `init-data.sh`, `verify-data.sh`, 노트북 시험), `infra/backup/`(`pg-backup.sh`(scheduled, predeploy), `verify-dump.sh`, `files-backup.sh`, `push-vault.sh`, `vault-ingest.sh`, `vault-authorize.sh`, `restore-check.sh`, `install.sh`, systemd 유닛, 노트북 시험), `fit-up.sh`의 data 연결 |
-| 1E 관측성 | A와 B의 Prometheus·Alertmanager·blackbox 설정, 알림 규칙(Modal 폴백·예산 알림, B 도달 알림 포함)과 `promtool test`, 포트 노출 감사, 대시보드. B의 ops 스택 compose가 생기면 그 이미지의 arm64 검사를 `lint:image-arch`에 추가한다 |
+| 1E 관측성([계획](2026-10-21-plan-1e-observability.md)) | `infra/obs/`(A: `compose.obs.yml`, Prometheus·Alertmanager·Grafana·exporter, 알림 규칙 35개와 `promtool test`, 대시보드 3개, `daily-digest.py`, 설치, 노트북 시험), `infra/ops/`(B: `compose.ops.yml`, 외부 프로브, 금고·B 알림, `port-audit.py`, 설치, 노트북 시험), 엣지의 `/_ops` 경로, `docs/infra/contracts/metrics.md`, `lint:prometheus`·`lint:alertmanager`와 ops·obs compose의 arm64 검사 |
 | 1F 호스트 부트스트랩([계획](2026-10-20-plan-1f-host.md)) | `infra/host/`(`bootstrap.sh` ROLE=app\|ops, `verify-host.sh`, `networks.sh`, `docker-prune.sh`, daemon.json, sysctl, sshd drop-in, fail2ban, 자동 업데이트, systemd 유닛), 컨테이너 시험. 설계 3절 |
 | 1G 런북과 포팅 매뉴얼 | 런북 초안 RB-01~13(설계 10.2절), 포팅 매뉴얼 골격(설계 17절) |
 | 2 (M0~M4) | 서버 수령일이 정해진 뒤에 쓴다 |
````

````diff
diff --git a/infra/README.md b/infra/README.md
index ca8fd5d..6c660e5 100644
--- a/infra/README.md
+++ b/infra/README.md
@@ -12,6 +12,8 @@ Fit Dining 인프라 코드. 설계는 [docs/infra/design.md](../docs/infra/desi
 - `deploy/` 배포·롤백·사전 점검·스모크·재부팅 뒤 기동(`deploy.sh` 등)과 노트북 시험 환경. 사용법은 [deploy/README.md](deploy/README.md)
 - `data/` 데이터 스택(Postgres, OpenSearch, Redis 2개, Garage)의 compose와 멱등 초기화 스크립트(DB·role·버킷·키), 점검, 노트북 시험. 사용법은 [data/README.md](data/README.md)
 - `backup/` Postgres 덤프·사진·인증서 볼륨의 암호화 백업, B 금고로 전송과 수신 검증, 복원 리허설, 마이그레이션 전 덤프, 설치 스크립트와 systemd 타이머, 노트북 시험. 사용법은 [backup/README.md](backup/README.md)
+- `obs/` 서버 A의 관측(Prometheus, Alertmanager, Grafana, exporter, Dozzle), 알림 규칙과 단위 시험, 대시보드, 일일 점검 요약, 노트북 시험. 사용법은 [obs/README.md](obs/README.md)
+- `ops/` 서버 B의 감시(A를 밖에서 보는 프로브, 인증서, 감시 체계 감시, 백업 금고 알림), 포트 노출 감사, 노트북 시험. 사용법은 [ops/README.md](ops/README.md)
 
 가드가 강제하는 규칙:
 
@@ -24,6 +26,8 @@ Fit Dining 인프라 코드. 설계는 [docs/infra/design.md](../docs/infra/desi
 | `check_linear_history.py` | MR 안에 병합 커밋(3-way merge) 금지. 브랜치는 rebase로 최신화 | 10.8절 |
 | `migration_immutability.py` | 적용된 마이그레이션 수정·삭제·이름 변경 금지(MR) | 6.5절 |
 | `images_arch.py` | 이미지가 대상 호스트 플랫폼(A amd64, B arm64)을 지원 | 3절 |
+| `check_alerts.py` | 알림 규칙의 이름·severity·runbook·단위 시험, 대시보드의 uid·패널 id·데이터소스 | 9.4절 |
+| `check-prometheus.sh`, `check-alertmanager.sh` | Prometheus 설정과 규칙 단위 시험(promtool), Alertmanager 설정과 라우팅(amtool). 각 도구 이미지 안에서 돈다 | 9.4절 |
 
 ## 로컬에서 검사하기
 
````

````diff
diff --git a/infra/backup/README.md b/infra/backup/README.md
index dd321e5..09ae6ab 100644
--- a/infra/backup/README.md
+++ b/infra/backup/README.md
@@ -64,9 +64,9 @@ bash infra/backup/restore-check.sh -i ~/fit-backup-key.txt --fetch-seconds <1에
 | 격리된 파일 보기 | `ls /srv/vault/store/quarantine`(B). 검증에 실패했거나 짝이 없는 파일이다 |
 | 덤프 검증만 따로 | `bash infra/backup/verify-dump.sh <평문 덤프> --expect-tables <N>`(복호화한 파일) |
 
-## 지표 (1E가 알림 규칙을 건다)
+## 지표
 
-A는 `/var/lib/fit/metrics/fit_backup.prom`(`FIT_METRICS_DIR`)에, B는 `/srv/vault/metrics/fit_vault.prom`에 Prometheus textfile 형식으로 쓴다. node_exporter의 textfile collector가 읽는 디렉터리로 마운트하는 것은 계획 1E다.
+A는 `/var/lib/fit/metrics/fit_backup.prom`(`FIT_METRICS_DIR`)에, B는 `/srv/vault/metrics/fit_vault.prom`에 Prometheus textfile 형식으로 쓴다. A의 node-exporter(`infra/obs`)와 B의 node-exporter(`infra/ops`)가 textfile collector로 읽고, 알림 규칙이 이 이름을 쓴다([obs/README.md](../obs/README.md), [ops/README.md](../ops/README.md)).
 
 | 지표 | 뜻 |
 |---|---|
````

````diff
diff --git a/infra/ci/compose-projects.txt b/infra/ci/compose-projects.txt
index e50954a..d2bb549 100644
--- a/infra/ci/compose-projects.txt
+++ b/infra/ci/compose-projects.txt
@@ -7,3 +7,7 @@ edge-test infra/edge/compose.edge.yml infra/edge/test/compose.test.yml --env-fil
 app infra/app/compose.app.yml
 data infra/data/compose.data.yml --env-file infra/data/data.env.example
 data-test infra/data/compose.data.yml infra/data/test/compose.test.yml --env-file infra/data/data.env.example
+obs infra/obs/compose.obs.yml --env-file infra/obs/obs.env.example
+obs-test infra/obs/compose.obs.yml infra/obs/test/compose.test.yml --env-file infra/obs/obs.env.example
+ops infra/ops/compose.ops.yml --env-file infra/ops/ops.env.example
+ops-test infra/ops/compose.ops.yml infra/ops/test/compose.test.yml --env-file infra/ops/ops.env.example
````

- [ ] **Step 3: 전체 검사 (게이트)**

Run:

```bash
python -m unittest discover -s infra/ci/tests
bash infra/ci/run-local-checks.sh
bash infra/ci/run-local-checks.sh --self-test
export MSYS_NO_PATHCONV=1
W="$(pwd -W 2>/dev/null || pwd)"
. infra/ci/tool-images.sh
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$SHELLCHECK_IMAGE" sh -ec "find infra -type f -name '*.sh' -print0 | xargs -0 -r shellcheck -x"; echo "lint:shell exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$HADOLINT_IMAGE" sh -ec "find infra -type f \( -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name '*.Dockerfile' \) -print0 | xargs -0 -r hadolint"; echo "lint:docker exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$YAMLLINT_IMAGE" yamllint -c .yamllint.yaml .gitlab-ci.yml .yamllint.yaml infra; echo "lint:yaml exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$PROMETHEUS_IMAGE" sh infra/ci/check-prometheus.sh >/dev/null; echo "lint:prometheus exit=$?"
docker run --rm --entrypoint "" -v "$W:/work" -w /work "$ALERTMANAGER_IMAGE" sh infra/ci/check-alertmanager.sh >/dev/null; echo "lint:alertmanager exit=$?"
find . -name __pycache__ -not -path './.git/*' -prune -exec rm -rf {} + 2>/dev/null
git status --short
ls -a | grep -E 'tmp-' ; true
```

Expected: 단위 테스트 통과, `run-local-checks.sh`의 모든 줄이 `PASS`(또는 `SKIP`)이고 마지막이 `모든 검사 통과`(알림 규칙·prometheus·alertmanager·arch(관측 A, 감시 B) 줄 포함), `--self-test`도 `모든 검사 통과`(alerts, promtool, amtool 포함), `lint:shell exit=0`, `lint:docker exit=0`, `lint:yaml exit=0`, `lint:prometheus exit=0`, `lint:alertmanager exit=0`. `git status`에는 이 계획이 만든 파일만 있고 `tmp-` 디렉터리는 남지 않는다.

- [ ] **Step 4: 커밋 (허용된 경우)**

```bash
git add infra/obs/README.md infra/ops/README.md docs/infra/contracts/metrics.md docs/infra/contracts/README.md docs/infra/design.md docs/infra/plans/2026-10-15-plan-1a-foundation-guardrails.md infra/README.md infra/backup/README.md infra/ci/compose-projects.txt
git commit -m "docs(infra): 관측·감시 문서, 지표 계약, 설계·로드맵 동기화"
```
