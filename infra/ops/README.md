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
