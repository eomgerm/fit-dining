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
