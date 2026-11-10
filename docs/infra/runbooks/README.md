# 런북

알림이나 사용자 신고를 받았을 때 서버에서 무엇을 보고 무엇을 하는지 적은 절차다. 설계는 [design.md](../design.md) 10.2절이다. 알림 메시지의 `RB-번호`가 이 폴더의 파일이다.

| ID | 내용 | 파일 |
|---|---|---|
| RB-01 | 서버 점검과 부트스트랩(A/B), 감시 체계 이상 | [RB-01.md](RB-01.md) |
| RB-02 | 배포와 롤백, BE·FE 응답 이상 | [RB-02.md](RB-02.md) |
| RB-02b | 긴급 수동 배포(`SKIP_VERIFY`) | [RB-02b.md](RB-02b.md) |
| RB-03 | 메모리 부족과 OOM | [RB-03.md](RB-03.md) |
| RB-04 | 디스크 | [RB-04.md](RB-04.md) |
| RB-05 | 인증서와 TLS | [RB-05.md](RB-05.md) |
| RB-06 | 백업이 안 올 때, Postgres 장애, DB 복원, 복원 리허설 | [RB-06.md](RB-06.md) |
| RB-07 | OpenSearch(검색), 재색인, 새벽 배치 | [RB-07.md](RB-07.md) |
| RB-08 | 시크릿 회전 | [RB-08.md](RB-08.md) |
| RB-09 | CPU 버스트 소진 의심 | [RB-09.md](RB-09.md) |
| RB-10 | 서비스 종료(11/18): 최종 백업, 합성 덤프, 실데이터 삭제 | [RB-10.md](RB-10.md) |
| RB-11 | Modal 장애·예산, 임베딩 모델 교체 | [RB-11.md](RB-11.md) |
| RB-12 | 서버 A 소실 시 재구축(DR) | [RB-12.md](RB-12.md) |
| RB-13 | dev DB 초기화 | [RB-13.md](RB-13.md) |
| RB-14 | AI API(서버 A) 켜기, AI 배포 경고·장애 | [RB-14.md](RB-14.md) |

RB-08, RB-10, RB-12, RB-13, RB-14는 알림이 아니라 사람이 시작하는 절차다. **RB-12는 서버에서 한 번도 따라 해 보지 않았다.** 맨 위의 "검증 기준"과 맨 아래 "알려진 빈칸"을 먼저 읽는다. RB-10과 RB-13은 데이터를 지우는 절차라서 운영 데이터에는 실행해 보지 않았다. 각 파일 맨 아래에 실제로 돌려 본 것과 못 돌린 것을 적었다.

## 모든 런북이 따르는 약속

- **순서:** 증상 → 값을 출력하지 않는 확인 명령 → 원인별 조치 → 되돌리기 → 이 런북을 따라 해 본 범위.
- **값 출력 없음:** 이 폴더의 명령은 비밀 값을 화면에 내지 않는다. env 파일은 `envset.py`로만 본다(키 이름과 글자 수만 나온다). 값을 채팅이나 이슈에 붙이지 않는다.
- **표기:** 설계 문서처럼 직접 확인한 것은 (확인), 확인하지 못한 것은 (미확인)이라고 쓴다. 각 런북 맨 아래 "이 런북을 따라 해 본 범위"가 실제로 돌려 본 것과 돌리지 못한 것의 목록이다.
- **검증 기준:** 각 파일 머리에 어느 커밋과 날짜의 서버에서 확인했는지 적는다. 스크립트가 바뀌면 다시 확인한다.

## 접속과 준비

| 서버 | 접속 | 하는 일 |
|---|---|---|
| A | `ssh -i <A 키> ubuntu@k15a302.p.ssafy.io` | 서비스(BE·FE·엣지), 데이터, 관측, 배포 러너 |
| B | `ssh -i <B 키> ubuntu@52.78.33.39` | 외부 감시, CI verify 러너, 백업 금고 |

키는 인프라 담당이 갖고 있다. 팀원은 `fit-dev` 계정으로 SSH 터널만 만들 수 있다(서버 셸은 없다). `ubuntu`는 docker 그룹이 아니라서 `docker`는 `sudo`로 부른다.

**가장 먼저 보는 곳.** 알림은 Mattermost로 온다(하루 두 번 09:00, 18:00 KST 상태 요약도 같다). 지금 상태를 바로 보려면 A에서:

```bash
sudo python3 /usr/local/lib/fit/obs/daily-digest.py --dry-run
```

확인 필요, 서비스 여섯 가지(prod BE, dev BE, 엣지, DB, 검색, 금고), 백업 상태가 한 화면에 나온다. 올리지 않고 출력만 한다.

**Grafana, Prometheus, Dozzle(로그).** 호스트에 열려 있지 않아서 SSH 터널로 본다.

```bash
ssh -i <A 키> -N -L 3000:127.0.0.1:3000 -L 9090:127.0.0.1:9090 -L 8888:127.0.0.1:8888 ubuntu@k15a302.p.ssafy.io
```

그 뒤 노트북 브라우저에서 `http://localhost:3000`(Grafana), `:9090`(Prometheus), `:8888`(Dozzle). B의 Prometheus(`9090`)와 Alertmanager(`9093`)도 같은 방식이다.

**서버에 있는 스크립트 사본.** 서버에는 저장소 전체가 없다. 점검과 복구 스크립트는 노트북에서 `git archive`로 올린 `~/fit-repo` 사본을 쓴다. 쓰기 전에 최신으로 올린다(A와 B가 같다).

```bash
# 노트북, 저장소 루트에서. HEAD가 올릴 커밋이다(보통 origin/develop)
git archive HEAD infra docs/infra/contracts | ssh -i <키> ubuntu@<서버> 'mkdir -p ~/fit-repo && tar -x --overwrite -C ~/fit-repo'
```

이 사본은 읽고 실행만 한다. 서버의 자동 작업(백업 타이머 등)은 root만 쓸 수 있는 `/usr/local/lib/fit/repo` 사본을 쓰므로 `~/fit-repo`를 바꿔도 영향이 없다.

**디렉터리를 지우고 바꿔 끼우지 않는다(`rm -rf` 뒤 `mv`).** A의 컨테이너들은 `~/fit-repo` 안의 설정(Caddyfile, Prometheus 규칙, Grafana 프로비저닝, Alertmanager 템플릿, Garage 설정)을 **디렉터리째 붙잡아** 떠 있다. 디렉터리를 지우고 새로 만들면 컨테이너는 지워진 옛 디렉터리를 계속 보고, 새 설정은 컨테이너가 다시 만들어질 때까지 안 보인다. 2026-10-28 A에서 서버의 임시 디렉터리로 같은 상황을 만들어 확인했다.

| 갱신 방법 | 디렉터리째 붙잡은 컨테이너 | 파일 하나를 붙잡은 컨테이너(`prometheus.yml` 등) |
|---|---|---|
| `rm -rf` 뒤 `mv` | **파일이 안 보인다** | 옛 파일이 보인다 |
| `tar -x`(기본) | 새 파일이 보인다 | **옛 파일이 보인다** |
| `tar -x --overwrite` 또는 `cp -f` | 새 파일이 보인다 | 새 파일이 보인다 |

그래서 위 명령은 `--overwrite`다. 사본을 갱신해도 **설정은 컨테이너가 다시 읽어야 반영된다**(해당 서비스의 reload나 `up -d --force-recreate`, 각 스택 README).

이전에 `rm -rf`로 갱신한 서버는 이미 어긋나 있을 수 있다. 컨테이너가 보는 파일과 호스트의 파일이 같은지 본다.

```bash
sudo docker exec fit-edge-caddy-1 sha256sum /etc/caddy/Caddyfile         # 파일이 없다고 나오면 어긋난 것이다
sha256sum ~/fit-repo/infra/edge/conf/Caddyfile                            # 위와 같아야 한다
sudo docker inspect -f 'health={{.State.Health.Status}}' fit-data-garage-1   # unhealthy면 설정 디렉터리를 못 읽는 것이다
```

어긋난 컨테이너는 해당 스택을 `up -d --force-recreate <서비스>`로 다시 만든다(엣지는 짧게 끊긴다. 서비스별 명령은 `envset.py`가 파일마다 안내하는 것과 같다).

## 알림과 런북

각 알림이 가리키는 런북이다(2026-10-27 `infra/obs`, `infra/ops`의 규칙 기준). 이름 뒤 괄호는 심각도와 지속 시간이다.

| 런북 | 알림 |
|---|---|
| RB-01 | `FitScrapeTargetDown`(주의, 5분), `FitOpsScrapeTargetDown`(주의, 5분), `FitPortUnreachable`(장애, 2분), `FitOpsWatcherDown`(장애, 2분), `FitPortExposed`(장애), `FitPortAuditStale`, `FitPortAuditMissing`, `FitProbeMetricMissing`, `FitVaultUnreachable`, `FitRedisProdDown`(장애, 2분), `FitRedisDevDown`(주의, 5분) |
| RB-02 | `FitBeProdDown`(장애, 2분), `FitBeDevDown`, `FitHttp5xxHigh`, `FitHttpLatencyHigh`, `FitHttpMetricMissing`, `FitExternalDown`(장애, 2분) |
| RB-03 | `FitMemoryLow`(장애, 8% 미만 5분), `FitSwapHigh`(50%), `FitOomKill`(장애), `FitContainerRestartLoop`(장애), `FitContainerMemoryHigh`(90%), `FitOpsMemoryLow` |
| RB-04 | `FitDiskUsageHigh`(80%), `FitDiskUsageCritical`(90%), `FitDiskFillingUp`(24시간 안에 가득), `FitOpsDiskHigh` |
| RB-05 | `FitCertExpiringSoon`(14일 미만), `FitCertExpiringCritical`(7일 미만), `FitTlsProbeFailed`, `FitBackupCaddyStale` |
| RB-06 | `FitPostgresDown`(장애, 1분), `FitPostgresConnectionsHigh`, `FitBackupPgStale`(8시간), `FitBackupPhotosStale`, `FitBackupVerifyFailed`, `FitBackupVerifyStale`, `FitBackupOutboxStuck`, `FitBackupMetricMissing`, `FitVaultStale`(장애, 8시간), `FitVaultRestoreCheckOverdue`, `FitVaultQuarantine`, `FitVaultIngestFailing`, `FitVaultIngestStale`, `FitVaultMetricMissing` |

| RB-07 | `FitOpensearchDown`(장애, 2분), `FitOpensearchRed`(장애, 2분), `FitOpensearchHeapHigh`(90%), `FitSearchLatencyHigh`(p95 4초), `FitBatchStale`(26시간), `FitBatchMetricMissing` |
| RB-09 | `FitCpuHigh30m`(주의, 40%), `FitCpuHigh2h`(장애, 40%) |
| RB-11 | `FitModalFallbackHigh`(폴백 30%), `FitModalBudgetHigh`(예산 80%), `FitModalMetricMissing` |

RB-08, RB-10, RB-12, RB-13, RB-14에는 알림이 없다(사람이 시작한다).
