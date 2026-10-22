# 관측 (서버 A)

서버 A의 `fit-obs` 프로젝트다. Prometheus가 호스트·컨테이너·앱·데이터·백업 지표를 모으고, 알림 규칙 35개가 Alertmanager를 거쳐 Mattermost로 간다. Grafana 대시보드 3개와 로그 UI(Dozzle)가 있다. 설계는 [design.md](../../docs/infra/design.md) 9절이다. B가 A를 밖에서 보는 쪽은 [ops/README.md](../ops/README.md)다.

## 자주 하는 일

| 하고 싶은 일 | 명령 |
|---|---|
| 설치(요약 스크립트, `obs.env`, 요약 타이머) | `sudo bash infra/obs/install.sh` |
| 관측 스택 올리기 | `obs.env`를 채운 뒤 `bash infra/deploy/fit-up.sh`(재부팅 뒤 기동 순서에 들어 있다) |
| 스택이 설계대로인지 점검 | `bash infra/obs/verify-obs.sh` |
| 상태 요약을 올리지 않고 출력만 | `sudo python3 /usr/local/lib/fit/obs/daily-digest.py --dry-run` |
| 상태 요약을 지금 올리기 | `sudo systemctl start fit-daily-digest.service` |
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
| `MATTERMOST_WEBHOOK_URL` | prod와 A 전체 알림의 수신 웹훅. 상태 요약도 여기로 간다 |
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

CPU 알림(30분, 2시간)은 그 길이만큼 지표가 쌓인 뒤부터 본다. 쌓인 기간이 창보다 짧으면 rate가 창 길이로 나뉘어 사용률이 부풀려지기 때문이다(처음 설치한 직후의 오탐).

메시지를 줄이려고 알림을 알림 이름이 아니라 환경(`site/env`)별로 묶는다. 같은 환경의 알림은 한 메시지에 모인다. 받는 곳은 셋이다(웹훅 주소는 main과 main-quiet이 같고 dev만 따로 쓸 수 있다).

| 받는 곳 | 대상 | 보내는 방식 |
|---|---|---|
| `main` | prod와 A 전체의 critical | 30초 모아 바로 보내고 1시간마다 다시 알린다. 해소도 알린다 |
| `main-quiet` | prod와 A 전체의 warning, info | 5분 모아 보내고 새 알림은 1시간 단위로 보태며 24시간마다 다시 알린다. 해소는 알리지 않는다 |
| `dev` | `env=dev`인 알림 전부 | `main-quiet`과 같은 간격이고 해소는 알리지 않는다 |

같은 알림의 critical이 떠 있으면 warning은 보내지 않는다. 라우팅은 `alertmanager/routes.txt`의 시험 줄로 검사한다. 전체 상태는 아래 상태 요약이 하루 두 번 한 메시지로 보여 준다.

메시지 모양(`alertmanager/templates/fit.tmpl`. A와 B가 같은 파일이고 CI가 다르면 거부한다). 첨부 형식이라 색 막대(빨강, 노랑, 초록)가 상태를 알려 준다.

- **제목:** `장애 2건 · A/prod`, `주의 3건 · A/prod`, 해소는 `해소 · A/prod`. 이모지는 제목에 쓰지 않고 푸시 알림과 채널 목록 미리보기(fallback)에만 🔴🟡🟢를 쓴다.
- **알림 하나:** 굵은 요약, 다음 줄에 `설명 · HH:MM부터 · RB-번호`(설명에 현재 값이 들어 있다. 시작이 하루 넘게 지났으면 날짜도 붙는다). critical이 먼저, 그다음 warning, info.
- **해소:** 맨 아래에 `해소: 요약 (N분 지속)`.
- 견본(`alertmanager/samples/*.json`)과 기대 문구(`expect.txt`)를 CI가 템플릿에 넣어 그려 확인한다. 모양을 바꿀 때는 이 파일들을 같이 고친다. 눈으로 보려면 `docker run --rm --entrypoint "" -v "$PWD:/w" -w /w prom/alertmanager:v0.34.1 amtool template render --template.glob=infra/obs/alertmanager/templates/fit.tmpl --template.data=infra/obs/alertmanager/samples/critical.json --template.text='{{ template "fit.text" . }}'`

BE가 내는 지표의 이름은 [metrics.md](../../docs/infra/contracts/metrics.md)가 정한다. 반드시 있어야 하는 지표는 사라지면 15분 뒤 `absent()` 알림이 운다.

## 상태 요약

`daily-digest.py`가 하루 두 번(09:00과 18:00, 서버 시간대 Asia/Seoul) 서버의 전체 상태를 한 메시지로 올린다(설계 10.1절). 알림이 한 번 놓쳐져도 하루 두 번은 상태를 본다. 표가 어디서나 그대로 그려지도록 첨부가 아니라 일반 글로 올리고, 제목은 `#### Fit Dining · 전체 상태 · 월-일 시:분`(정상, 주의 N건, 장애 N건), 본문은 표 셋이다.

```
#### Fit Dining · 장애 1건 · 주의 3건 · 10-22 18:00

| 구분 | 확인 필요 | 런북 |
|:-:|:--|:-:|
| 🔴 장애 | prod BE가 모든 색에서 응답하지 않는다 | RB-02 |
| 🟡 주의 | caddy 백업이 9일 넘게 없다 | RB-06 |
| 🟡 주의 | dev 배포가 실패했다(11-07 11:02) | - |
| 🟡 주의 | prod 인증서가 5일 뒤 만료된다(경고 14일) | - |

| prod BE | dev BE | 엣지 | DB | 검색 | 금고(B) |
|:-:|:-:|:-:|:-:|:-:|:-:|
| ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |

| 백업 | pg | photos | caddy | 복원 검증 |
|:--|:-:|:-:|:-:|:-:|
| 마지막 성공 | 3시간 전 | 3시간 전 | 없음 ⚠️ | 통과 |
```

- **확인 필요:** 울리는 알림(critical 먼저)의 요약과 런북, 그리고 알림이 없어도 요약이 아는 문제(디스크 80% 이상, 메모리 8% 미만, 스왑 50% 초과, CPU 24시간 평균 40% 초과, prod 5xx, 새벽 배치 26시간 초과, 복원 검증 실패, 실패한 배포, 14일 안에 만료되는 인증서)다. 같은 문제의 알림이 이미 울리면 한 번만 적는다. 없으면 `확인 필요한 항목이 없다.`
- **서비스:** prod BE, dev BE, 엣지, DB, 검색, 금고(B)가 떠 있는지(✅, ❌, 지표가 없으면 ❔).
- **백업:** pg, photos, caddy의 마지막 성공(기준을 넘으면 ⚠️, 한 번도 없으면 `없음 ⚠️`)과 복원 검증.
- 정상인 값(디스크, 메모리, CPU, 배포, 인증서)은 문제가 생겼을 때만 확인 필요에 나온다. CPU는 지표가 24시간보다 짧게 쌓였으면 쌓인 데이터만으로 평균을 내고 `(쌓인 기간)`이라고 적는다.

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
| `daily-digest.py`, `install.sh`, `conf/systemd/` | 상태 요약과 설치, 타이머 |
| `verify-obs.sh` | 읽기 전용 점검(PASS, FAIL, SKIP) |
| `test/` | `test-obs.sh`, `compose.test.yml`, 가짜 대상과 웹훅 대역 |
