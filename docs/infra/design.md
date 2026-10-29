# Fit Dining 인프라 설계

| 항목 | 내용 |
|---|---|
| 상태 | 인프라 설계 확정. 서비스 계약(12절)은 팀 합의 대기 |
| 기준일 | 2026-10-19 |
| 대상 독자 | 인프라 담당, BE·FE·AI 팀원 |
| 근거 | 선배 팀 프로젝트 2건 분석(A603 = S15P11A603 깃든, A503 = S15P21A503 pred-block), AWS·Caddy·GitLab·Garage·Docker·Modal 공식 문서(부록 C) |
| 표기 | **(확인)** 공식 문서나 소스로 확인한 사실 · **(추정)** 추정치이며 서버 실측 후 확정 · **(미확인)** 서버를 받아야 알 수 있음 |
| 문서 규칙 | 줄번호를 인용하지 않는다. 상태를 단언하는 대신 확인 명령을 적는다. 런북 머리에 검증 기준 커밋과 날짜를 적는다 |

## 0. 요약

Fit Dining(Next.js SSR 프런트(PWA), Spring Boot 백엔드, OpenSearch 검색, Modal 위의 AI)의 서버 인프라 설계다. SSAFY가 지급한 자원 4종으로 구성한다. 첫 공개는 2026-11-06, 서비스 종료는 11-18이라 공개 운영은 12일이다. 그래서 "작게 만들되 사고가 나도 복구되는" 구성을 택했다.

### 한눈에 보기

| 자원 | 역할 | 올라가는 것 |
|---|---|---|
| A: EC2 t3.xlarge (x86, 16GB) | 서비스 | Caddy, FE(Next.js SSR, prod·dev), BE(prod·dev), Postgres, OpenSearch, Redis, Garage, 관측성, 배포 러너 |
| B: EC2 c6g.large (Arm, 4GB) | 감시·CI·백업 | 외부 감시, CI verify 러너, 백업 금고 |
| SSAFY 공용 GPU 서버 | 학습 전용 | 인프라가 다루지 않는다. A·B와 연결하지 않는다 |
| Modal (serverless GPU) | AI 추론 전부 | FastAPI, 임베딩, 리랭커, 소형 LLM. A·B에는 AI 구성요소가 없다 |

### 이 문서를 읽는 법

| 읽는 사람 | 먼저 볼 절 |
|---|---|
| BE 팀 | 12.1(BE 계약), 11.2(Modal 호출 방어), 6.5(마이그레이션), 12.4(환경변수) |
| FE 팀 | 12.5(프런트 계약), 5절(라우팅·캐시·dev 접근), 6.8(FE 빌드·배치) |
| AI 팀 | 12.2·12.3(Modal 계약), 11절 |
| 인프라 담당 | 전체. 일정은 14절, 운영은 10절 |
| 팀 전체 | 10.8(브랜치·MR 운영 규칙), 16절(미결정·확인 필요) |

### 핵심 결정

| # | 결정 | 이유 |
|---|---|---|
| 1 | 경량 단일 서버형: prod와 dev가 DB·검색·Redis 같은 무거운 서비스를 공유하고, 앱·DB·인덱스·버킷만 환경별로 분리한다 | A 한 대의 지속 CPU(약 1.6 vCPU)와 운영할 컨테이너 수를 아낀다. 한도 메모리 합계는 약 9.2GB(16GB의 58%)다 |
| 2 | A는 서비스 본체, B는 외부 감시·CI verify·백업 금고 | B는 4GB라 서비스 경로에 넣으면 두 호스트 중 하나만 죽어도 서비스가 죽는다. 서비스 경로 밖에서 A의 약점(서버 안 감시, CI 부하, 호스트 밖 백업)을 덮는다 |
| 3 | 엣지는 Caddy. 프런트는 Next.js SSR(Node 컨테이너)을 Caddy 뒤에 둔다 | 인증서 발급·갱신, 프록시 헤더, 리다이렉트가 기본이라 선배 팀의 nginx 함정이 대부분 없다. Next.js는 앞단에 리버스 프록시를 두라고 권장하고 그 역할을 Caddy가 한다 |
| 4 | CI/CD는 GitLab Runner 2개(verify는 B, deploy는 A). 러너 등록이 막히면 Jenkins로 폴백 | 공개 웹훅과 플러그인 설정이 없고 설정이 repo에 남는다 |
| 5 | prod는 Blue/Green(Caddy upstream 전환), dev는 교체형. BE와 FE가 같은 방식이다 | 배포 중 요청 유실을 줄이고, 실패하면 자동으로 되돌린다. 두 서비스가 같은 메커니즘이라 배포·롤백 절차가 하나다 |
| 6 | AI 추론과 FastAPI는 전부 Modal에 둔다. A·B는 AI를 담당하지 않고, BE가 Modal을 HTTPS로 호출한다 | AI 팀이 Modal에서 모델을 서빙·배포하므로 서버는 모델 파일, 양자화, 아키텍처별 의존성(arm64)을 맡지 않는다. 대신 Modal이 AI의 단일 의존점이라 키워드 검색 폴백, 예산, 킬스위치가 필수다 |
| 7 | 사진 저장소는 Garage(S3 호환) | S3를 쓸 수 없다고 가정한다. MinIO 커뮤니티판은 아카이브됐다 |
| 8 | 백업은 age로 암호화(수신자 2명, 개인키는 서버에 두지 않음)한 뒤 B 금고로 쓰기 전용 전송. 복원 리허설은 사람이 한다 | 서버가 뚫려도 백업 평문이 나가지 않는다 |
| 9 | 관측성은 A에 Prometheus·Alertmanager·Grafana, B에 외부 감시. Loki·Tempo·OTel은 쓰지 않는다 | 선배 팀에서 Tempo/OTel은 쓰이지 않았고 Promtail은 EOL이다 |
| 10 | 컨테이너는 `127.0.0.1` 바인딩만 쓰고 공개는 Caddy 하나다. B가 밖에서 포트 노출을 계속 감사한다 | Docker 게시 포트는 ufw를 우회한다. 선배 팀에서 실제 노출 사고가 있었다 |
| 11 | 외부 호출(Modal, GMS 등)은 타임아웃·서킷브레이커·예산·킬스위치·폴백 계약을 둔다. Modal 엔드포인트는 프록시 인증, BE는 사용자·IP별 속도 제한을 건다 | 폴백은 사용자가 못 느끼는 실패라 비율 알림이 필수다. 전역 예산만 있으면 한 명이 예산을 소진시켜 모두를 폴백으로 떨어뜨릴 수 있다 |
| 12 | 도메인은 가비아에서 등록한 것을 쓴다. prod와 dev는 호스트(`PROD_HOST`, `DEV_HOST`)로 나누고 둘 다 443이다 | 포트로 나누면 쿠키가 격리되지 않고 비표준 포트가 막히는 망이 있다. 인증서 발급 한도도 우리 도메인만의 것이다 |
| 13 | 프런트는 Next.js SSR이다. 정적 자산은 Caddy가 서빙하고 FE 서버의 BE 호출은 Caddy 내부 리스너를 거쳐, 관리 지점을 BE와 같은 한 곳으로 모은다 | 팀이 서버 렌더링 기능을 쓰기로 했다. 5.3절, 6.8절 |

### 용어

| 용어 | 뜻 |
|---|---|
| prod / dev | 운영 환경(`PROD_HOST`) / 개발 환경(`DEV_HOST`). 같은 서버, 같은 포트(443), 호스트명으로 나뉜다 |
| Blue/Green | prod BE와 FE를 각각 두 벌(blue, green) 두고 새 버전을 반대 색에 띄운 뒤 Caddy가 트래픽을 넘기는 배포 방식 |
| 누적 풀 | 릴리스마다 `/_next/static` 파일을 쌓아 두는 디렉터리. Caddy가 직접 서빙한다 |
| 폴백 | 외부 호출이 실패했을 때 대체 동작으로 넘어가는 것. 임베딩이 실패하면 키워드 검색을 쓴다 |
| 킬스위치 | 환경변수 `*_ENABLED`로 외부 호출을 즉시 끄는 스위치 |
| 스모크 | 배포 직후 핵심 경로를 몇 건 호출해 보는 확인 |
| 핀 | 이미지 태그를 특정 버전으로 고정하는 것 |
| verify / deploy 러너 | GitLab CI를 실행하는 프로세스. verify는 B(테스트·빌드), deploy는 A(배포) |
| 금고(vault) | B에 둔 암호화 백업 보관 공간 |
| P0·P1·P2 | 우선순위. P0는 11/06 공개 전에 반드시 끝낼 것이다(14절) |
| M0~M4 | 서버 수령 이후의 마일스톤(14절) |

## 1. 배경과 제약

### 1.1 일정

| 날짜 | 이벤트 |
|---|---|
| 2026-10-15 | 인프라 설계 확정 |
| 미정 | 서버 수령(A, B). 수령 전에는 사전 작업(14절) |
| 2026-11-04 | 동결. 이후 변경은 핫픽스 절차로만(10.6절) |
| 2026-11-06 | 첫 공개(기획서의 2차 공개) |
| 2026-11-18 | 서비스 종료. 공개 운영 12일 |

### 1.2 자원

| 자원 | 스펙 | 역할 |
|---|---|---|
| A. EC2 t3.xlarge | x86_64, 4 vCPU, 15.7GB, 디스크 309GB (확인: 2026-10-22 서버, 유형은 인스턴스 메타데이터). 전송량 한도 (미확인) | 서비스 본체(BE, FE, 엣지), 배포 러너 |
| B. EC2 c6g.large | Arm(Graviton2), 2 vCPU, 4GiB, EBS 전용, GPU 없음 (확인). 디스크 크기 (미확인) | 외부 감시, CI verify 러너, 백업 금고 |
| SSAFY GPU 서버 | 공용, 학습 전용(기획서). 고정 공인 IP 없음, VPC/VPN 없음(A503 기준) | 학습만. 서비스 경로에 넣지 않고 A·B와 연결하지 않는다. 학습 결과는 AI 팀이 직접 Modal에 올린다 |
| Modal | serverless GPU | AI 추론 전부(임베딩, 리랭커, 소형 LLM)와 FastAPI. A·B에는 AI 구성요소가 없다. 호출 쪽 계약(11.2절)은 인프라와 BE가 맡는다 |

- **A의 CPU 크레딧:** baseline은 vCPU당 40%(t3.xlarge는 시간당 96크레딧을 얻고 최대 2304크레딧을 쌓는다)라서 지속 약 1.6 vCPU다. 초과분은 유휴 때 적립한 burst 용량을 쓰고, 오래 burst하면 적립분을 다 써서 다시 baseline(지속 가능 구간)으로 돌아간다 (확인: AWS 문서, 실측은 RB-09).
- **A의 CPU 크레딧 실측(2026-10-27):** A는 SSAFY가 준 서버라 AWS 콘솔이 없다. 크레딧 잔액과 크레딧 모드(standard·unlimited)는 콘솔과 CloudWatch로만 보이고 인스턴스 메타데이터에도 해당 키가 없어 확인하지 못했다 (미확인). 서버 안에서는 인스턴스 유형 `t3.xlarge`(확인: 메타데이터)와 CPU steal(확인: A의 Prometheus `job=node`)을 읽는다. 최근 3일 steal은 평균 0.8%, 5분 평균의 최댓값 6.7%였고 같은 기간 CPU 사용률은 평균 5.8%, 5분 평균의 최댓값 42.9%였다. 부하가 낮은 동안 크레딧 때문에 제한된 징후는 없다. 다만 이 값은 크레딧 모드의 증거가 아니고, 크레딧이 바닥나 제한되면 steal로 보일 것이라는 것은 추정이며(미확인), 동시 사용자 100명 피크에서의 동작은 알려 주지 않는다. 그 부분은 경량 부하 시험과 RB-09로 본다. 알림은 `FitCpuHigh30m`(30분 평균 CPU 40% 초과, warning)뿐이고 steal 알림은 없다. steal은 Prometheus에서 `node_cpu_seconds_total{mode="steal"}`로 볼 수 있다.
- **B의 성능:** T 계열이 아니라 고정 성능이다. burst 크레딧이 없다 (확인).

### 1.3 SSAFY 플랫폼 사실

- **방화벽:** 호스트 방화벽 ufw가 켜져 있고 기본 정책이 deny(DROP)다. DROP이라 거부가 아니라 타임아웃으로 보인다. A503은 허용 포트가 22·8000·8001뿐이었고 80/443은 `ufw allow` 직후 열렸다. 클라우드 방화벽은 처음부터 열려 있었다 (확인: A503 문서). 포트가 안 열릴 때 확인 순서는 리스너(`ss -lntp`), ufw, 클라우드 방화벽, 그 바깥이다.
- **Docker 포트:** Docker 게시 포트는 ufw를 우회한다. 단 밖에서 들어오는 연결의 이야기이고, 컨테이너가 호스트 게이트웨이(`172.17.0.1`)의 게시 포트로 들어가는 연결은 호스트로 들어오는 `INPUT` 경로라 ufw가 막는다 (확인: 2026-10-26 B. 시간 초과로 보인다). Testcontainers를 도는 B의 CI 잡이 이 경우여서 B에만 `docker0` 규칙 한 줄이 있다(3절 호스트 표의 ufw 행).
- **인증서:** 가비아에서 등록한 도메인이라 Let's Encrypt HTTP-01(80)을 쓴다. DNS-01은 쓰지 않으므로 80 포트는 갱신 때문에 상시 열어 둔다. SSAFY의 `p.ssafy.io` 존은 TXT 권한이 없어 DNS-01을 못 쓴다 (확인: A503 문서).
- **도메인:** 가비아에서 등록한 도메인을 쓴다. 가비아 DNS의 A 레코드로 `PROD_HOST`와 `DEV_HOST`를 A의 정적 IP에 붙인다. SSAFY 지급 도메인(`<접두><기수><팀>.p.ssafy.io`)은 쓰지 않는다. DNS 변경은 우리가 직접 하므로 IP가 바뀌어도 도메인 변경 요청 절차가 없다.
- **GitLab:** lab.ssafy.com은 Community Edition v18.11.5이고 Premium 기능은 쓸 수 없다 (확인: 팀원 확인). 공용 러너가 없다 (확인: A503 문서). 프로젝트 러너 생성에는 Maintainer 권한이 필요하다 (확인: GitLab 문서).
- **AWS·S3:** AWS 콘솔·IAM·S3 사용 흔적이 선배 팀 양쪽에 없다. S3는 쓸 수 없다고 가정한다.
- **아웃바운드:** 제한이 없었다(Docker Hub, HuggingFace 등 접근 가능).
- **공인 IP:** EC2의 공인 IP는 Elastic IP가 없으면 stop/start로 바뀐다 (확인: AWS 문서). `remote_ip` 허용, 금고 전송, DNS가 이 IP에 기대므로 인스턴스는 멈추지 않는다. 고정 IP(Elastic IP)를 붙일 수 있는지는 콘솔 권한에 달려 있다(아래 실측 항목).
- **A의 공인 IP 실측(2026-10-27, 위험 19):** 인스턴스 메타데이터(IMDSv2)에서 `t3.xlarge`(온디맨드, ap-northeast-2a)와 공인 IP `3.35.170.47`을 읽었고, `PROD_HOST`와 `DEV_HOST`의 A 레코드(TTL 600초)도 같은 IP를 가리킨다 (확인). 이 IP가 Elastic IP인지는 확인하지 못했다 (미확인). A는 SSAFY가 준 서버라 콘솔이 없고, 메타데이터의 `public-ipv4`와 `ipv4-associations`는 자동으로 받은 IP에도 같은 값을 주며 Elastic IP 여부를 알려 주는 키가 없다. Elastic IP가 아니면 stop/start 때 IP가 바뀐다. 이 IP를 박아 둔 곳은 B의 금고 계정 `from="3.35.170.47"`과 fail2ban `ignoreip`, 가비아의 A 레코드다 (확인: 2026-10-27 B). B의 클라우드 방화벽에 A의 IP가 들어 있는지는 확인하지 못했다 (미확인). 대체 수단은 세 가지다. (1) 인스턴스를 멈추지 않는다. (2) IP나 DNS가 어긋나면 B의 프로브가 `https://<PROD_HOST>/healthz`와 `/`에서 2분 넘게 200을 못 받아 `FitExternalDown`(critical)이 울린다. (3) IP가 바뀌면 금고 전송이 `from=`에 막혀 pg 백업이 8시간 넘게 안 들어오고 `FitVaultStale`(critical)이 울린다. 복구는 가비아에서 A 레코드를 새 IP로 고치고(TTL 600초) B의 금고 `from=`와 fail2ban 허용 IP를 새 IP로 바꾸는 것이다.
- **작업 방식:** 선배 팀에서 AI 에이전트는 EC2에 접속하지 못했다. 서버에서의 실행은 사람이 하고, 런북은 값을 출력하지 않는 확인 명령을 포함한다.
- **Docker Engine 29:** 최소 API 버전이 1.44로 올라 구버전 클라이언트(Traefik, Testcontainers, docker-java 계열)를 거부한다 (확인). 29.3에서 최소 API가 낮아졌다는 보고는 단일 출처라 (미확인).
- **서버를 받아야 아는 것:** 스펙, 스왑, 디스크, Docker 버전.

### 1.4 선배 팀에서 얻은 원칙

상세는 부록 A에 있다. 핵심만 적는다.

1. 컨테이너 메모리·CPU 제한, 로그 로테이션, 이미지 prune, 호스트 밖 백업이 두 프로젝트 모두에 없었다. 우리는 전부 넣는다.
2. 포트 짧은 문법(`8080:80`)은 0.0.0.0에 바인딩되고 ufw를 우회한다. A603은 Loki·Tempo·OTLP가 인터넷에 열렸다.
3. 설정 누락이 조용히 통과했다(env 전달 누락 6회 이상, 기본값이 mock, 빈 번들 6회). 부팅 시 검증, 배포 후 스모크, 산출물 검사를 둔다.
4. Jenkins–GitLab 연동에 며칠을 썼고, 변경 감지 정규식은 과트리거와 침묵 스킵을 둘 다 냈다. 변경 감지 없이 항상 전체를 실행한다.
5. 관측성 스택은 올렸지만 Tempo/OTel은 안 쓰였고 prod 알림은 0개였다. 최소한으로 시작해 쓰이는 것만 둔다.
6. prod를 늦게 올려서 노출 수정보다 prod 첫 배포가 먼저였다. prod를 일찍 띄워 리허설한다.
7. 문서가 코드와 어긋났다. 확인 명령과 검증 기준 커밋·날짜를 문서에 적는다.

### 1.5 가정

아래는 확정이 아니라 가정이다. 틀리면 알려 달라는 항목이며 16절에 담당과 해소 시점이 있다.

- repo는 모노레포이고 `be/`, `ai/`, `fe/`, `infra/`를 최상위에 둔다(repo의 실제 구조).
- 브랜치는 feature → MR → `develop`(dev 자동 배포), `develop → master` MR 후 prod 수동 배포다. 규칙은 10.8절이다.
- BE는 Spring Boot(Java 21), 검색은 OpenSearch(nori)다. AI는 FastAPI(Python 3.12)이고 Modal에 배포되며 A·B에서 돌지 않는다. BE가 Modal 엔드포인트를 HTTPS로 호출한다(AI 팀이 `modal deploy`로 배포).
- 프런트(`fe/`)는 Next.js(SSR)로 만든 PWA다. Node 컨테이너(standalone 빌드)가 렌더링하고 Caddy가 앞단에서 프록시한다. 팀이 서버 렌더링 기능을 쓰기로 했다(구체적인 요구는 16절 #26). A의 한도 최악 합계는 약 12.7GB로 예산에 들어간다(4.1절).
- 팀 Mattermost에 Incoming Webhook을 만들 수 있다.
- 예상 규모(동시 사용자, 피크 RPS, 문서·벡터 수, 사진)는 아직 모른다. 4.4절의 자리표시자를 팀과 맞춘다(16절).

## 2. 아키텍처

### 2.1 토폴로지

```
 [PWA / team]                       [Modal]
        | 443                         ^ https (BE -> AI)
        v                             |
+-------------------------------------------+      +--------------------------------------+
| A: EC2 t3.xlarge (x86 / 16GB)             |      | B: EC2 c6g.large (Arm / 4GB)         |
|  edge  Caddy                              |      |  ops   Prometheus-B, Alertmanager-B, |
|  app   be, fe (prod blue|green, dev)      |----->|        blackbox, node-exporter,      |
|  data  postgres opensearch redis garage   | dump |        port-audit                    |
|  obs   Prometheus-A Alertmanager-A Grafana|<-----|  ci    GitLab Runner (verify)        |
|  ci    GitLab Runner (deploy)             | probe|  vault encrypted dumps               |
+-------------------------------------------+HTTPS +--------------------------------------+
```

| 경로 | 방식 |
|---|---|
| A → B | 암호화된 덤프 전송(`vault`, 쓰기 전용 SSH), TCP 22 프로브 |
| B → A | HTTPS 프로브만. B에는 A로 들어오는 SSH 키가 없다 |
| BE(A) → Modal·GMS | 아웃바운드 HTTPS. AI 추론(임베딩, 리랭커, 소형 LLM)과 FastAPI는 Modal에서 돌고 A·B에는 AI 구성요소가 없다 |
| 공용 GPU 서버 | 학습 전용이라 A·B와 연결하지 않는다. AI 팀이 학습 결과를 직접 Modal에 올린다 |

### 2.2 compose 프로젝트와 네트워크

| 호스트 | 프로젝트 | 내용 |
|---|---|---|
| A | `fit-edge` | caddy |
| A | `fit-data` | postgres, opensearch, redis-prod, redis-dev, garage |
| A | `fit-app-prod` | be-prod-blue/green, fe-prod-blue/green |
| A | `fit-app-dev` | be-dev, fe-dev |
| A | `fit-obs` | prometheus, alertmanager, grafana, node-exporter, cadvisor, blackbox, postgres-exporter, opensearch-exporter, dozzle |
| B | `fit-ops` | prometheus-b, alertmanager-b, blackbox, node-exporter |

호스트 서비스(systemd)는 A의 `gitlab-runner`(deploy)와 B의 `gitlab-runner`(verify)다.

어느 망에 누가 속하는지가 곧 접근 허용 목록이다. 아래는 A의 네트워크다.

| 망 | 종류 | 속한 컨테이너 | 설명 |
|---|---|---|---|
| `net-edge` | 일반 bridge | caddy, garage | caddy는 80·443을 게시하고 ACME 때문에 바깥으로 나갈 수 있어야 해서 internal 망에 두지 않는다. garage는 사진 업로드·공개 읽기 프록시용이다 |
| `net-prod` | 일반 bridge | be-prod-blue/green, fe-prod-blue/green, caddy | prod 앱 망. BE의 외부 호출(GMS, Modal 등)이 가능하다. caddy가 BE·FE로 프록시한다 |
| `net-dev` | 일반 bridge | be-dev, fe-dev, caddy | dev 앱 망. 역할은 `net-prod`와 같다 |
| `net-data` | `internal: true` | postgres, opensearch, redis-prod, redis-dev, garage, BE 컨테이너 | 바깥으로 나가지 못한다. caddy는 속하지 않는다(인터넷을 마주한 컨테이너가 DB 망에 직접 붙지 않게) |
| `net-obs` | bridge | 관측성 컨테이너, caddy | prometheus는 `net-prod`·`net-dev`에도 속해 BE의 관리 포트(8081)를 긁고, postgres-exporter·opensearch-exporter는 `net-data`에도 속한다. caddy는 메트릭용으로 속한다 |
| `net-dbaccess` | bridge | postgres | postgres가 `127.0.0.1:5432`를 게시하기 위해 추가로 속한다. 개발자 SSH 터널 용도다 |

공유 망 여섯 개는 `infra/host/networks.sh`가 만든다(몇 번 실행해도 같고 `net-data`만 `internal`이다. 확인: `test-host.sh prune`). FE는 DB 망(`net-data`)에 속하지 않는다. FE 서버가 BE를 부를 때는 Caddy의 내부 리스너(`caddy:8081` prod, `caddy:8082` dev)를 거친다. 활성 색을 고르는 곳이 Caddy 한 곳이라 FE는 BE의 색을 모른다(5.2절).

두 환경의 BE가 `net-data`를 공유하므로 환경 분리는 자격 증명(Postgres role, Redis 비밀번호, Garage 키)이 맡는다. OpenSearch만 인증이 없어 접두사가 관례일 뿐이다(2.3절, 13.4절).

컨테이너 이름은 환경 접두사로 고정한다(`be-prod-blue`, `fe-prod-green`, `redis-prod` 등). `backend` 같은 일반 별칭은 쓰지 않는다. A603은 공유 망에서 별칭이 환경 간에 해석될 수 있었다.

### 2.3 환경 분리 규칙

| 자원 | prod | dev |
|---|---|---|
| Postgres | DB `fit_prod`, role `fit_prod_app`(DML), `fit_migrator`(DDL) | DB `fit_dev`, role `fit_dev_app`(`statement_timeout` 설정) |
| OpenSearch | 인덱스 접두사 `prod-`, 별칭으로 서빙 | 접두사 `dev-`. `action.destructive_requires_name=true`로 와일드카드 삭제를 막는다. 인증이 없어 접두사는 관례일 뿐이다(12.1 #8, 13.4절) |
| Redis | `redis-prod` 인스턴스 | `redis-dev` 인스턴스 (인스턴스당 약 10MB라 논리 DB 번호보다 안전하다) |
| Garage | 버킷 `fit-prod-photos`, prod 전용 키 | 버킷 `fit-dev-photos`, dev 전용 키 |
| 비밀 | DB 비밀번호, JWT 키, 외부 API 토큰 모두 환경마다 다르게 | 〃 |
| Modal | Environment `fit-prod`의 앱(FastAPI, 임베딩, 리랭커, LLM)과 prod 전용 프록시 토큰 | Environment `fit-dev`. AI 팀 시험용 `fit-test`가 따로 있다(11.2절) |

## 3. 호스트 기반

서버 설정은 멱등 스크립트 `infra/host/bootstrap.sh`(`ROLE=app|ops`)와 검증 스크립트 `infra/host/verify-host.sh`로 한다. verify는 PASS/FAIL만 출력하고 값은 찍지 않는다. 서버에서의 실행은 사람이 하고 출력을 붙여 주면 검토한다. `infra/host/` 디렉터리만 서버로 복사해 쓴다(순서와 안전장치는 `infra/host/README.md`). 두 스크립트를 Ubuntu 22.04와 24.04 컨테이너에서 실제로 적용하고 점검했고, 설정을 하나씩 망가뜨리면 verify가 잡고 bootstrap이 고치며 두 번째 실행은 변경이 없음을 확인했다 (확인: `infra/host/test/test-host.sh`). 컨테이너에서 확인되지 않는 것(스왑, sysctl 적용, 시간 동기화, Docker 데몬과 systemd 타이머, fail2ban의 실제 차단, B의 arm64)은 서버에서 `verify-host.sh`로 확인한다.

| 영역 | A | B | 근거 |
|---|---|---|---|
| 시간대 | 호스트와 모든 컨테이너 `Asia/Seoul`(tzdata 포함 확인), DB는 `timestamptz` | 호스트 `Asia/Seoul` | 새벽 4시 KST 일괄 처리. A503은 호스트 KST와 컨테이너 UTC 불일치로 날짜 오류가 났다 |
| 스왑 | 4GB swapfile, swappiness 10 | 2GB swapfile, swappiness 10 | OOM 완충 |
| 커널 | `vm.max_map_count=262144` | 해당 없음 | OpenSearch 필수값 |
| Docker 로그 | `json-file` 10MB×3. be·fe·caddy는 50MB×5(compose `logging:`) | 10MB×3 | 로그 로테이션 부재가 선배 팀의 공통 결함 |
| Docker 운영 | `live-restore`, 주 1회 이미지·빌더 캐시 prune(be·fe는 SHA 태그 최근 5개 유지, 볼륨은 지우지 않는다) | 주 1회 prune(7일 넘게 쓰지 않은 이미지) | prune 부재가 공통 결함. 시험에서 최근 5개 유지와 사용 중 이미지 보호를 확인했다 (확인: `test-host.sh prune`) |
| Docker 버전 | `docker version`으로 확인. 29 이상이면 API 클라이언트(cAdvisor, Dozzle, Testcontainers)를 최신으로 핀하고, 안 되면 daemon.json의 `min-api-version`으로 완화 | 〃 | 1.3절 |
| ufw | 기본 deny. 허용 22(limit), 80, 443 | 기본 deny. 허용 22(limit)와 CI 잡용 한 줄(`allow in on docker0 from 172.17.0.0/16 to any port 32768:60999 proto tcp`) | 80은 인증서 갱신 때문에 상시 개방. B의 한 줄은 verify 러너의 잡 컨테이너가 Testcontainers 형제 컨테이너(DB, Ryuk)의 게시 포트에 호스트 게이트웨이로 닿는 길이다. 없으면 `INPUT` 기본 차단에 걸려 시간 초과가 나고 BE 테스트가 시작도 못 한다 (확인: 2026-10-26 B에서 재현하고 규칙을 넣어 전부 통과). 인터넷 쪽은 영향이 없다 |
| 포트 규칙 | 컨테이너는 `127.0.0.1:` 바인딩만. 공개는 caddy 하나. CI가 compose 파일을 검사해 위반하면 실패 | 〃 | 13절 |
| SSH | 키 전용, root 금지, fail2ban(`ignoreip`에 A↔B 상대 호스트 IP). 자동 보안 업데이트는 켜고 자동 재부팅은 끈다(11/06 이후 재부팅은 공지된 창에서만) | 〃 | 설정은 `sshd_config.d/10-fit.conf`다. sshd는 같은 키워드의 첫 값을 쓰고 파일을 이름 순서로 읽으므로 클라우드 이미지의 `60-cloudimg-settings.conf`보다 먼저 읽히게 10번을 쓴다. `Match User` 블록은 그 사용자에게만 적용된다 (확인: `sshd -T -C`). 키가 등록된 로그인 계정이 없으면 bootstrap이 비밀번호 로그인을 끄지 않는다 |
| 이미지 아키텍처 | amd64 | arm64 | B에 amd64 전용 이미지를 올리지 않는다 |
| 디렉터리 | `/srv/fit/{state,backups,web}`, `/etc/fit/` | `/srv/vault/{incoming,store}`, `/etc/fit/` | |

이미지 아키텍처는 CI의 `lint:image-arch` 잡이 compose·Dockerfile·도구 이미지 핀의 모든 이미지가 해당 플랫폼을 갖는지 `docker buildx imagetools inspect`로 확인한다. 도구 이미지 핀은 verify 러너가 B라서 arm64와, 로컬 PC용 amd64를 둘 다 본다.

CPU는 vCPU당 baseline 40%다. Grafana에 40% 기준선을 그리고 30분 평균이 40%를 넘으면 경고한다(9절). 이 임계값은 A에만 해당한다.

### 3.1 Day-0 실측 (서버 수령 당일, A와 B 각각)

값을 문서에 적지 않고 결과만 붙여 달라는 목적이다. 공인 IP는 기록하지 않는다.

```
uname -m; lscpu | head -n 20; free -h; swapon --show; df -h /; lsb_release -ds
docker version --format 'server={{.Server.Version}} api={{.Server.APIVersion}}'; docker compose version
sudo ufw status verbose; ss -lntp
timedatectl | head -n 4
sudo sshd -T | grep -Ei 'passwordauthentication|permitrootlogin'
getent hosts <도메인>
```

서버 밖(노트북)에서는 `Test-NetConnection <호스트> -Port 22/80/443`으로 도달성을 본다. Caddy가 뜨기 전(M0)에는 22만 열려 있어야 한다. A→B SSH(전송용)와 B에서 A의 포트 도달성(스캔)도 M0에서 확인한다. B에는 A로 들어오는 SSH 키가 없으므로 B→A는 SSH가 아니라 도달성만 본다.

## 4. 자원 예산

### 4.1 A (GB, 추정)

| 구성 | 한도 | 평상시 |
|---|---|---|
| OS·Docker·sshd | 0.8 | 0.8 |
| Caddy | 0.15 | 0.05 |
| be-prod (배포 중 반대 색 +1.5) | 1.5 | 0.8 |
| be-dev | 1.0 | 0.6 |
| fe-prod (배포 중 반대 색 +0.5) | 0.5 | 0.15 |
| fe-dev | 0.4 | 0.12 |
| Postgres | 1.0 | 0.4 |
| OpenSearch (힙 768MB) | 2.0 | 1.3 |
| Redis ×2 + Garage | 0.45 | 0.15 |
| 관측성 전체 | 1.4 | 0.9 |
| **합계** | **약 9.2** | **약 5.3** |

- A에는 AI 구성요소(임베딩 서버, ai-api)가 없다. 한도 합계 약 9.2GB는 16GB의 약 58%다. FE(Node)는 빈 템플릿에서 약 45MiB(측정)라 평상시 값은 실제 앱으로 다시 측정한다(추정).
- JVM 힙을 컨테이너 한도의 60%로 잡으면 메타스페이스·스레드 스택·코드 캐시가 한도 안에 들어온다(12.1 #10).
- 순간 증가분은 3.5GB다: 이미지 조립 0.3, 배포 겹침(BE 1.5 + FE 0.5) 2.0, 새벽 배치 1.2. jar와 FE 번들은 B에서 빌드하고 A는 `COPY`만 하므로 빌드 메모리가 A에 오지 않는다(6.3절). 한도 최악 합계는 약 12.7GB다.

한도는 상한일 뿐 동시에 다 차지는 않는다는 가정에 기대는 설계라서 아래를 방어선으로 둔다.

1. 스왑 4GB
2. 컨테이너 OOM과 메모리 80% 알림(9절)
3. 배포·CI 직렬화(GitLab `resource_group`, 배포 러너 `concurrent 1`)
4. 비상안: dev 스택(be-dev·fe-dev, 약 1.4GB)을 일시 중지

CPU는 dev 컨테이너에 `cpus` 상한을, prod에는 `cpu_shares` 우선순위를 준다. 빌드의 자원 상한 방법(buildx docker-container driver의 자원 옵션 또는 cgroup)은 구현 시 검증한다 (미확인).

### 4.2 B (GB, 추정)

| 구성 | 한도 | 평상시 |
|---|---|---|
| OS·Docker·sshd | 0.5 | 0.5 |
| ops 스택(Prometheus-B, Alertmanager-B, blackbox, node-exporter) | 0.4 | 0.3 |
| GitLab Runner | 0.05 | 0.05 |
| CI verify 작업 | 2.0 | 0 |
| Testcontainers 형제 컨테이너 | 0.6 | 0 |
| **합계** | **약 3.6** | **약 0.9** |

- 스왑은 2GB다.
- 디스크는 (미확인)이며 CI 이미지, Gradle·npm 캐시, 백업에 최소 20GB가 필요하다 (추정).
- 금고의 rsync·timer는 메모리를 거의 쓰지 않는다.
- B에서 OpenSearch 컨테이너 테스트는 메모리상 불가하므로 BE 계약(12.1 #13)에 명시한다. 프런트 테스트(`fe:test`)는 Node 힙을 1.5GB 안으로 묶는다(12.5절).

### 4.3 디스크 (A, 320GB)

이미지·빌드 캐시가 대부분이다. 예상 사용량은 60GB 미만(추정)이며 prune 정책과 80% 알림으로 관리한다.

### 4.4 용량 가정 (미확인, M1 전에 팀과 맞춘다)

아직 규모가 정해지지 않았다. 아래 표의 예시는 자리표시자이며, 팀이 정한 값으로 바꿔 부하 시험(14절 P1)의 목표로 쓴다.

| 항목 | 예시(자리표시자) | 쓰이는 곳 |
|---|---|---|
| 피크 동시 사용자 | 100명 | CPU 크레딧(40% 기준선), 부하 시험 목표 |
| 피크 검색 RPS | 5 | BE 속도 제한 값, Modal 동시성·비용(요청마다 임베딩 1회, 리랭커 1회, 요청 해석 최대 1회) |
| 문서(리뷰) 수와 벡터 수 | (미확인) | OpenSearch k-NN 메모리, 임베딩 백필 시간·비용 |
| 사진 | (미확인) | Garage·B 디스크, 사진 백업(8절) |

**k-NN 메모리**

- HNSW는 벡터당 약 1.1 × (4 × 차원 + 8 × M) 바이트가 든다(M=16 가정. 구버전 문서의 추정식이라 구현 시 현재 버전 문서로 다시 확인한다).
- 1024차원이면 벡터당 약 4.6KB다. 10만 건은 약 0.5GB, 100만 건은 약 4.6GB다.
- 네이티브 메모리는 기본값으로 (RAM − 힙)의 50%까지만 쓰고(`knn.memory.circuit_breaker.limit`, 확인: OpenSearch 설정 문서) 넘으면 가장 오래 안 쓴 인덱스를 내린다.
- OpenSearch 컨테이너 한도 2.0GB와 힙 768MB로는 (2.0 − 0.77) × 0.5 ≈ 0.6GB라 약 13만 건이 상한이다.
- 이 값이 컨테이너 한도가 아니라 호스트 RAM(16GB)을 기준으로 계산되면 한도에 닿기 전에 OOM이 나므로 절대값으로 명시한다(구현 시 확인).
- 규모가 이보다 크면 한도를 올리거나 차원을 줄인다(arctic-embed-l-v2.0은 256차원으로 줄이는 방식을 지원한다고 알려져 있다, 미확인).

## 5. 엣지·TLS

Caddy 컨테이너(`caddy:2.x`, 구현 시 최신 2.x를 핀)가 A의 80·443만 게시한다.

### 5.1 기본 설정

| 항목 | 결정 | 근거 |
|---|---|---|
| 프로토콜 | `protocols h1 h2`. UDP 443(h3)은 열지 않는다 | Caddy 기본값은 h3를 포함한다 (확인) |
| 호스트·인증서 | 호스트명 둘(`PROD_HOST`, `DEV_HOST`). 둘 다 443이고 호스트마다 인증서를 따로 받는다. Let's Encrypt HTTP-01(80) | 가비아 도메인(1.3절). DNS-01은 쓰지 않는다 |
| 인증서 단계 | `ACME_MODE`로 고른다. `staging`이면 staging CA만 쓰고, `production`이면 `acme_ca`를 지정하지 않아 기본 이슈어를 쓴다 | 아래 인증서 메모 |
| 인증서 보관 | `caddy_data` 볼륨은 삭제 금지, 백업 대상. 운영 인증서는 M1 첫날 발급하고 곧바로 백업한다 | 삭제하면 재발급 한도에 걸릴 수 있다 |
| 프록시 헤더 | Caddy가 `X-Forwarded-For/Proto/Host`를 설정하고 외부에서 온 값은 무시, Host는 원본 유지 | (확인: Caddy 문서). BE는 `server.forward-headers-strategy` 설정이 필요하다 |
| 요청 크기 | API 본문 2MB 상한. 사진 업로드 경로는 `request_body max_size 10MB` | presigned PUT은 크기를 정책으로 묶을 수 없어(POST policy만 가능) 프록시에서도 상한을 둔다. 본문을 읽는 upstream에서 초과 요청이 413으로 거부됨을 확인했다 (확인: `infra/edge/test/test-edge.sh`). 본문을 읽지 않는 upstream은 한도를 넘기 전에 응답을 먼저 돌려준다 |
| 관리면 | Grafana·Dozzle·Prometheus는 127.0.0.1 게시 + SSH 터널. 공개 경로 없음. Caddy admin은 컨테이너 내부에서만 | |
| 로그 | JSON을 stdout으로, json-file 로테이션 | |
| 메트릭 | 전역 `metrics` 옵션을 켜고 `:9180/metrics`를 호스트에 게시하지 않는 내부 리스너로 노출(`net-obs`) | (확인: Caddy 문서는 전역 `metrics`를 스크래핑의 전제로 설명한다. `servers` 안의 `metrics`는 폐기 예정이라 쓰지 않는다. 호스트 미게시와 망 안 응답은 `test-edge.sh`로 확인) |

**인증서 메모**

- 기본 이슈어는 ZeroSSL과 Let's Encrypt다 (확인: Caddy 문서). `acme_ca`를 지정하면 그 CA만 쓰고 폴백이 사라진다(확인: `caddy adapt` 결과. `ACME_MODE=staging`은 이슈어 하나, `production`은 Let's Encrypt와 ZeroSSL 둘). 그래서 운영 단계에서는 지정하지 않는다.
- Let's Encrypt는 등록 도메인당 주 50장 제한이 있다. 가비아에서 등록한 우리 도메인의 한도라 다른 팀과 나누지 않는다. 호스트가 둘이라 첫 발급은 2장이다.

### 5.2 라우팅

| 경로 | 대상 | 비고 |
|---|---|---|
| `/_next/static/*` | 누적 풀(`/srv/fit/web/<env>/pool/`)의 파일. 풀에 없으면 활성 색 FE | 해시가 붙은 불변 자산(5.3절) |
| `/api/*` | 활성 색 BE | |
| `/healthz` | BE 헬스(상태만) | 외부 감시용 |
| `/fit-prod-photos/*`, `/fit-dev-photos/*` | garage S3 API(사진 업로드, path-style) | Host 헤더가 보존돼 SigV4 서명이 통과해야 한다. 헤더 서명 PUT은 엣지를 거쳐 로컬 garage에서 통과했다 (확인: `test-edge.sh`). presigned URL과 POST policy는 7.4절 스파이크로 확인 |
| `/photos/<env>/confirmed/*` | garage 웹 엔드포인트(3902) | `header_up Host`를 그 버킷의 웹 호스트(`<버킷>.<web_root_domain>`)로 바꾼다. `pending/`은 공개 경로에서 막는다. 객체 키는 추측할 수 없는 UUID이고, 읽기 응답은 캐시 가능하게(`Cache-Control: public`) 둔다 |
| `/_ops/prometheus/healthy`, `/_ops/alertmanager/healthy` | 내부 `/-/healthy`로 rewrite | B의 IP(`remote_ip`)와 basic auth를 둘 다 통과해야 하고 실패하면 404. 이 외의 `/_ops` 경로는 없다. B가 A의 감시 체계를 감시한다 |
| 그 외 모두 | 활성 색 FE(Next.js SSR) | 페이지, RSC, `/config.json`, `/fe-healthz`, `public/` 파일(`/sw.js`, `/manifest.webmanifest`) |

각 호스트는 자기 환경의 경로만 라우팅한다. 예를 들어 dev 호스트는 `/fit-prod-photos/*`를 프록시하지 않는다.

**내부 리스너:** `:8081`(prod)과 `:8082`(dev)는 호스트에 게시하지 않고 compose 망 안에서만 닿는다. 활성 색 BE로 프록시하며 FE 서버가 BE를 부를 때 쓰는 주소(`BE_INTERNAL_URL`)다 (확인: `test-edge.sh`. 호스트에 게시되지 않고, 전환하면 FE 서버가 읽는 BE 색이 FE 재시작 없이 바뀐다). 같은 망의 컨테이너는 어느 환경의 리스너에도 닿으므로 `BE_INTERNAL_URL`의 포트가 환경과 맞는지는 배포 사전 점검이 확인한다.

**사진 읽기 경로의 근거**

- Garage에는 ACL·버킷 정책이 없다 (확인). 서명 없는 `<img src>`를 S3 API로는 읽을 수 없을 것이다(익명 GET 거부는 7.4절 스파이크에서 확인).
- 공개 읽기는 `garage bucket website --allow`로 켠 웹 엔드포인트로 한다. 켜면 그 버킷이 웹으로 공개된다 (확인: Garage 문서).

### 5.3 프런트 서빙 (SSR)

- **FE 컨테이너:** `fe-prod-blue`·`fe-prod-green`, `fe-dev`. Next.js `output: 'standalone'`의 `node server.js`(포트 3000)를 돌리며 호스트에 게시하지 않는다. 루트 파일시스템은 읽기 전용이고 Next의 캐시 디렉터리(`.next/cache`)만 tmpfs로 쓴다.
- **정적 자산:** `/_next/static/*`는 Caddy가 누적 풀에서 직접 준다. 배포 스크립트가 릴리스마다 `.next/static`을 풀에 쌓고 지우지 않으므로, 열려 있는 탭이 이전 릴리스의 해시 자산을 요청해도 404가 나지 않는다(Next.js 문서의 immutable assets 방식). 풀에 없으면 FE가 대신 응답해서 풀 동기화 실수가 장애로 번지지 않는다. 풀은 URL 경로를 그대로 따르는 `/srv/fit/web/<env>/pool/_next/static/…`이다. 풀 정리는 배포 스크립트가 맡는다 (확인: `test-edge.sh`. 풀에 있는 자산은 FE를 거치지 않고 응답하고 없는 자산은 FE가 응답하며, `..` 경로로 풀 밖의 파일을 읽을 수 없다).
- **캐시 헤더:** `/_next/static`은 `Cache-Control: public, max-age=31536000, immutable`이다(Next가 붙이고 풀도 같다). HTML·RSC·`public/` 파일의 캐시 헤더는 FE가 정하고 Caddy는 바꾸지 않는다.
- **헤더:** `encode zstd gzip`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`를 붙이고 `Server`와 `X-Powered-By`를 지운다 (확인: upstream이 보내도 지워진다).
- **스트리밍:** FE의 스트리밍 응답(Suspense, RSC)은 Caddy가 버퍼링하지 않고 그대로 흘려야 한다 (확인: `test-edge.sh`. `encode`를 켠 상태에서 첫 덩어리가 1.5초 뒤의 마지막 덩어리를 기다리지 않고 도착한다).
- **환경 값:** FE는 `/etc/fit/fe-<env>.env`를 런타임에 읽는다(번들에 넣지 않는다). 브라우저가 쓸 공개 값은 `/config.json`(FE 라우트)이 돌려준다.
- **HSTS:** `Strict-Transport-Security`는 운영 인증서가 확정된 뒤에만 켠다. staging 인증서 단계에서 켜면 브라우저가 거부해 테스트가 막힌다.
- **CSP:** 프런트 팀과 합의한 뒤 추가한다.

### 5.4 dev 접근과 쿠키

**dev 접근 제한**

- dev 호스트(`DEV_HOST`)는 쿠키가 없으면 404다.
- `/?k=<dev 키>`로 한 번 접속하면 Caddy가 `fit_dev` 쿠키(Secure, HttpOnly, SameSite=Lax, `Max-Age=1209600`, `Domain` 없음)를 심고 `/`로 보낸다. 같은 출처 요청에는 쿠키가 자동으로 붙는다.
- `/manifest.webmanifest`와 `/icons/*`는 게이트에서 제외한다. 브라우저가 쿠키 없이 가져오기 때문이다.
- 로그에서는 쿼리의 `k`를 지운다(`log`의 `filter` 인코더에서 `request>uri query { delete k }`). `Cookie`·`Authorization` 헤더는 Caddy가 기본으로 가린다(Caddy 문서의 `log_credentials`). 키가 쿼리와 쿠키 어느 쪽으로도 로그에 남지 않음을 확인했다 (확인: `test-edge.sh`).
- 게이트를 통과한 요청은 `fit_dev` 쿠키를 지운 뒤 프록시한다(`handle` 안의 `request_header`). 키가 앱 컨테이너 로그에 남지 않게 하려는 것이고 다른 쿠키는 그대로 전달된다 (확인: `test-edge.sh`). `curl --aws-sigv4`처럼 Cookie를 서명 대상에 넣는 클라이언트는 서명이 어긋난다. 브라우저의 presigned URL 요청은 Cookie를 서명하지 않을 것으로 본다 (미확인, 7.4절 스파이크).
- 목적은 스캐너 차단용 최소 방어다. 헤더 방식은 브라우저의 페이지 탐색에 붙일 수 없고, basic auth는 JWT를 담는 `Authorization` 헤더와 충돌해 쓰지 않는다. 만료가 없는 세션 쿠키면 모바일에서 앱을 닫을 때마다 사라진다.
- iOS 홈 화면 PWA는 Safari와 쿠키를 공유하지 않을 수 있다. 그 경우 PWA 안에서 다시 `?k=`로 들어와야 한다 (미확인).

**쿠키 분리**

- prod와 dev는 호스트가 달라 쿠키가 호스트 단위로 격리된다. 쿠키에 `Domain` 속성을 주면 상위 도메인으로 공유되므로 BE와 FE는 쿠키에 `Domain`을 쓰지 않는다(BE #21, 12.5절 #9).
- 서비스 워커와 localStorage도 호스트(출처)별로 분리된다.
- prod 인증 쿠키는 HttpOnly로 둔다.

### 5.5 전환·연결·검증

**Blue/Green 전환:** 배포 스크립트가 서비스(be, fe)별 활성 색 upstream 조각(`/srv/fit/state/upstream-<환경>-<서비스>.caddy`)을 쓰고 `caddy reload`를 호출한다. 상태 디렉터리는 파일이 아니라 디렉터리째 마운트한다(A603의 bind-mount inode 사고 교훈). `lb_try_duration`으로 전환 중 연결 실패를 재시도한다. BE와 FE가 같은 방식이라 배포·롤백 절차가 하나다. 형식 견본은 `infra/edge/state-sample/`이고 파일은 임시 이름으로 쓴 뒤 `mv`로 바꾼다. 적용은 `infra/edge/edgectl.sh reload`(문법 검사를 통과해야 reload) 하나이고 배포 스크립트도 같은 명령을 쓴다.

**reload의 성질** (확인: `test-edge.sh`)

- 상태 파일만 바꾸고 reload하기 전에는 트래픽이 옮겨지지 않는다.
- BE와 FE는 따로 전환된다. BE만 되돌려도 FE는 그대로이고 FE 서버가 읽는 BE 색은 즉시 바뀐다.
- reload 중 compose 망 안의 요청은 끊기지 않는다(요청 150건 실패 0건). 호스트 포트 경로에서는 Docker Desktop의 포트 포워더가 새 연결을 간헐적으로 거부했는데 Caddy 쪽 원인이 아니었다(응답 코드가 4xx·5xx인 요청은 0건).
- 문법이 틀린 상태 파일은 `check`와 `reload`가 거부하고 직전 설정이 유지된다.
- 문법은 맞지만 없는 호스트를 가리키는 upstream은 `check`와 `reload`를 통과하고 요청이 502가 된다. 그래서 reload 뒤 Caddy 경유 스모크(6.4절 5단계)가 필수다.

**바꿀 곳이 하나씩이다:** 도메인은 `edge.env`의 호스트 두 값과 DNS, 라우트는 `Caddyfile`의 `env_routes` 한 곳(prod와 dev에 같이 적용), 색 전환은 상태 파일과 `edgectl.sh reload`다(`infra/edge/README.md`).

**장기 연결:** SSE는 `text/event-stream`이면 자동 flush된다 (확인). reload 때 WebSocket은 기본으로 강제 종료되고 `stream_close_delay`로 지연할 수 있다 (확인). 일반 HTTP는 grace period가 무제한이라 끝까지 처리된다 (확인). 어느 쪽이든 old 색을 멈추면 끊기므로 클라이언트 재연결(`Last-Event-ID`)이 전제다.

**PWA와 TLS:** 서비스 워커, 설치(홈 화면 추가), 웹 푸시는 브라우저가 신뢰하는 HTTPS에서만 동작한다. staging CA 인증서는 신뢰되지 않으므로 프런트 테스트 전에 운영 CA 인증서를 확정한다. prod와 dev는 호스트가 달라 출처가 다르므로 서비스 워커, localStorage, 쿠키가 모두 분리된다(12.5절).

**검증:** `verify-edge.sh`는 서버 안에서 TLS·헤더·라우팅을 확인한다(`/`가 200, `/_next/static` 자산은 `immutable`, 없는 자산은 404(`immutable` 아님), `/healthz`·`/fe-healthz`·`/config.json`이 200, dev 호스트는 쿠키 없이 404). `--resolve`를 주면 DNS를 바꾸기 전에도 서버를 점검할 수 있다. 서버 밖에서는 포트 스캔(22/80/443만 열림)과 인증서 만료일을 확인한다.

## 6. CI/CD

### 6.1 러너

| 러너 | 호스트 | executor | 비고 |
|---|---|---|---|
| `fit-verify` (태그 `verify`) | B (Arm) | docker + docker.sock | job 메모리 2.0GB, cpus 2, `concurrent 2`(메모리를 많이 쓰는 Gradle·Node 잡은 `resource_group: verify-heavy`로 한 번에 하나만 돌아서 나머지 하나는 가벼운 lint가 쓴다. `runner.sh tune`). B에는 prod 컨테이너·볼륨·시크릿이 없어 CI 사고가 서비스에 닿지 않는다 |
| `fit-deploy` (태그 `deploy`) | A (x86) | shell, `gitlab-runner` ∈ docker 그룹 | protected 브랜치(develop·master)만, `concurrent 1`. 이미지 조립(`COPY`)과 배포만 한다. jar와 PWA 번들은 verify 단계(B)가 만든 아티팩트를 쓴다 |
| `fit-verify-x86` (필요 시) | A | docker | BE·프런트 의존성에 arm64 빌드가 없을 때만 추가. 야간 위주 |

러너는 프로젝트 Settings → CI/CD → Runners → Create project runner로 만든다. Maintainer 권한이 필요하고 runner authentication token 방식을 쓴다. 옛 registration token은 GitLab 17.0부터 비활성화됐다 (확인). 이 메뉴가 막혀 있으면 Jenkins로 폴백한다. 그 경우 선배 팀의 Jenkinsfile 자산을 쓴다.

### 6.2 브랜치와 환경

- feature → MR → `develop`은 dev 자동 배포, `develop → master` MR 후 prod는 수동 실행(`when: manual`)이다.
- MR은 fast-forward로 병합한다. 병합 순서와 프로젝트 설정은 10.8절, 동결과 핫픽스는 10.6절이다.
- 시크릿은 서버 `/etc/fit/*.env`에만 두고 GitLab 변수에는 넣지 않는다.

**배포 순서 보장**

- 배포 잡에는 `environment: dev`, `environment: prod`를 두고 환경별 `resource_group`을 건다. 같은 환경의 배포는 동시에 돌지 않는다.
- `resource_group`의 `process_mode` 기본값은 `unordered`라 대기 중인 배포의 순서가 보장되지 않는다 (확인: GitLab 문서). 그래서 API로 `oldest_first`로 바꾼다. `.gitlab-ci.yml`로는 바꿀 수 없다.
- 프로젝트 설정 "Prevent outdated deployment jobs"를 켠다. 같은 환경에서 더 최근에 시작한 배포가 있으면 오래된 배포 잡은 실패로 처리된다 (확인). 기준은 커밋 시각이 아니라 잡 시작 시각이다. 그래서 오래된 파이프라인의 수동 prod 배포를 먼저 누르면 새 파이프라인의 수동 배포가 막힌다. prod 수동 배포는 항상 master의 최신 파이프라인에서 누른다.
- "Allow job retries for rollback deployments"는 기본이 켜져 있고 (확인), GitLab 문서는 민감한 프로젝트에서 끄라고 권한다. prod는 재시도 대신 `rollback.sh`로 되돌리므로 끈다.
- `deploy.sh`에도 다운그레이드 가드가 있다(6.4절).
- 보호된 환경(protected environments)은 Premium 이상의 기능이라 이 서버(CE)에서는 쓸 수 없다 (확인: GitLab 문서). prod 배포를 누를 수 있는 사람은 `master`의 병합 권한(Maintainer)과 Protected 러너(`fit-deploy`는 보호된 브랜치의 잡만 받는다)로 좁힌다. 보호 브랜치의 수동 잡은 그 브랜치에 병합·푸시 권한이 있는 사람만 누를 수 있다고 문서에 있지만 동작이 일관되지 않다는 보고가 있어서 (확인: GitLab 문서와 이슈), 첫 prod 배포 전에 권한이 없는 사용자가 누를 수 없는지 직접 확인한다.

### 6.3 파이프라인 `.gitlab-ci.yml`

단계는 `verify` → `build` → `deploy` → `smoke` 순서다. `verify`는 B에서, 나머지는 A의 deploy 러너에서 돈다. **MR 파이프라인은 바뀐 경로에 해당하는 잡만 돌린다**(`rules:changes`. MR 파이프라인은 대상 브랜치와의 차이로 판단한다). `develop`과 `master` 파이프라인은 항상 전체를 돌린다(배포할 결과물과 병합 뒤 전체 검증이 필요하다). `lint:guards`, `lint:secrets`, `lint:history`는 경로와 상관없이 모든 MR에서 돈다. "Pipelines must succeed"는 파이프라인이 없는 MR을 병합하지 못하게 하므로 어떤 파일만 바꿔도 잡이 하나는 있어야 하기 때문이다. 모든 잡의 `changes`에는 `.gitlab-ci.yml`이 들어 있어서 CI 설정을 바꾸면 전부 다시 검증한다. `lint:image-arch`(레지스트리 조회)는 핀이나 이미지 참조가 바뀔 때만, `lint:migrations`와 `lint:history`는 MR에서만 돈다. 각 잡이 보는 경로는 `.gitlab-ci.yml`의 `rules`에 있고 `test_pipeline_structure.py`가 경로별로 어떤 잡이 도는지 검사한다.

| 잡 | 단계 | 내용 |
|---|---|---|
| `lint:*` | verify | 아래 목록 |
| `be:test` | verify | Gradle 테스트(`sh ./gradlew test`: 래퍼가 git에서 실행 권한이 없다). DB가 필요한 BE 시험은 Testcontainers(`PostgresTestSupport`)가 dev·prod와 같은 pgvector(`PGVECTOR_IMAGE` 핀)를 직접 띄운다. 그래서 잡에는 DB 서비스도 `SPRING_DATASOURCE_*` 환경변수도 주지 않는다(환경변수가 시험이 코드로 넣은 값을 가린 적이 있다). Testcontainers는 최신 버전이어야 하고, 잡 컨테이너가 형제 컨테이너의 게시 포트에 닿도록 B에 ufw `docker0` 규칙이 있다(3절 호스트 표. 2026-10-26 BE 팀이 Testcontainers로 옮길 때 확인했고, 같은 날 DB 서비스를 뺐다). JUnit 보고서를 MR에 보인다(실패해도 올린다). jar는 만들지 않는다. MR마다 55MB를 GitLab으로 올리면 느리고, 서버가 흔들릴 때(2026-10-23, 502) 테스트까지 같이 실패한다 |
| `be:build` | verify | 스위치를 켠 `develop`·`master`에서만 돈다. `be:test`가 끝난 뒤 `bootJar -x test`로 배포할 jar를 만들어 아티팩트로 넘긴다(DB가 필요 없다). jar 크기가 GitLab 아티팩트 상한을 넘으면 B에서 A로 `rsync`한다(상한은 미확인) |
| `fe:test` | verify | 린트, `next typegen`(Next 16의 전역 타입을 만든다. 없으면 `tsc`가 실패한다), 타입 검사, 단위 테스트(`fe/`). verify 러너(B)에서 Node 이미지(핀, arm64 지원)로 실행 |
| `fe:build` | verify | 같은 Node 이미지로 `next build`(standalone)를 **한 번만** 하고(환경 값은 번들에 넣지 않는다, 6.8절) 커밋 SHA를 `DEPLOYMENT_VERSION`으로 넘겨 빌드 ID와 `deploymentId`로 쓴다. FE 번들(`standalone`, `static`, `public`)을 GitLab 아티팩트로 넘긴다 |
| `fe:bundle-check` | verify | `infra/ci/check_fe_bundle.py`로 번들 산출물을 검사한다(서버 파일, 정적 자산, 빌드 ID와 `deploymentId`가 SHA와 같음, 이미지 최적화 꺼짐, `sharp` 외 네이티브 모듈 없음, `localhost` 주소 없음. mock 글자는 경고, PWA 파일 없음은 건너뜀). 실패하면 `build:images`가 돌지 않는다 |
| `build:images` | build | `<서비스>:<SHA>`(be, fe) 로컬 조립(`infra/ci/build-images.sh`). verify 단계가 만든 jar와 FE 번들을 `COPY`한다(BE 계약 #20, FE 계약 #1). 레지스트리는 없다. 이미 있으면 재사용한다(MR을 fast-forward로 병합하므로 SHA가 그대로라 다시 조립하지 않는다). `develop`과 `master`에서만 돈다 |
| `deploy:dev` | deploy | develop 푸시 시 자동(`environment: dev`, `resource_group: dev`). 전체 clone(`GIT_DEPTH: "0"`)을 쓴다. 얕은 clone이면 다운그레이드 가드와 마이그레이션 비교가 틀리므로 preflight가 얕은 저장소를 `git fetch --unshallow`로 채우고 못 채우면 거부한다(Jira S15P31A302-99) |
| `deploy:prod` | deploy | master에서 수동(`environment: prod`, `resource_group: prod`). `allow_failure: false`라 사람이 누를 때까지 파이프라인이 멈춘다(`when: manual`만 두면 안 눌러도 통과한 것처럼 보인다) |
| `smoke:dev`, `smoke:prod` | smoke | 환경별로 배포 뒤에 돈다(`smoke.sh <env> --sha <SHA>`). `--resolve`로 서버 내부 경유 확인. 검색 1건을 호출해 폴백 사용 여부를 확인한다(Modal 연동 누락이 폴백에 가려지지 않게, BE 계약 #17). 콜드 스타트를 감안한 타임아웃을 둔다. FE는 `/`가 200이고 `/config.json`에 필수 키가 모두 있는지 확인한다 |

**배포 스위치:** `.gitlab-ci.yml`의 변수 `FIT_CD_ENABLED`가 `"false"`이면(2026-10-26에 `"true"`로 켰다. 비상으로 끄려면 프로젝트 CI/CD 변수로 덮는다) `fe:build`부터 `smoke`까지는 파이프라인에 나타나지 않고 `be:test`와 `fe:test`만 모든 파이프라인(`develop`, `master`, MR)에서 돈다. 켜면 `develop`은 `smoke:dev`까지, `master`는 수동 `deploy:prod`와 `smoke:prod`까지, MR은 검사 잡(`fe:build`, `fe:bundle-check` 포함, 바뀐 경로에 한해)까지 나타난다. jar를 만드는 `be:build`는 MR에 나타나지 않는다. 켜는 일은 MR 한 줄이라 기록이 남고, 구조 시험(`test_pipeline_structure.py`)의 기본값 시험도 함께 바꿔야 해서 실수로 켜지 못한다. BE·FE가 서비스 계약(12.1, 12.5절)을 이행하기 전에 `fe:bundle-check`가 모든 MR을 막는 일을 피하려는 것이다. 켜기 전에 끝나야 할 일은 [계획 1C-3의 계약 이행 체크리스트](plans/2026-10-23-plan-1c3-ci-pipeline.md)에 있다.

**`lint:*` 잡**

- `lint:guards`: 단위 테스트(`.gitlab-ci.yml`의 구조 시험 포함: 파이프라인마다 어떤 잡이 나타나는지, 태그, 스위치 기본값), CRLF, `infra/`의 env 예제 형식, env 계약과 예제 파일의 키 일치, 포트 규칙
- `lint:image-arch`: 도구 이미지 핀, 로컬 스택, 엣지, 데이터 스택, 백업 시험 이미지가 바뀔 때만 돈다
- `lint:shell`, `lint:docker`, `lint:yaml`: `infra/`와 루트 설정만 엄격하게 본다. be의 Dockerfile은 오류 수준만 막는다. 다른 팀 코드는 각자의 잡이 맡는다
- `lint:secrets`: 저장소 전체와 MR 커밋 이력
- `lint:history`: MR에서만 돈다. MR 안의 병합 커밋(3-way merge)을 막는다
- `lint:migrations`: MR에서만 돈다. 적용된 Flyway 파일의 수정, 버전 중복, 순서 역전을 막는다
- 도구별로 잡을 나눈다. job 컨테이너 안에서 `docker run -v $PWD`로 도구 컨테이너를 띄우면 워크스페이스가 호스트 경로가 아니라 마운트되지 않기 때문이다
- `lint:caddy`: 엣지 설정의 형식(`caddy fmt --diff`)과 문법(`caddy validate`, 인증서 단계와 HSTS의 네 조합)
- `promtool check/test`는 해당 파일이 생기는 계획에서 추가한다

verify는 Arm, prod는 x86이다. 그래서 deploy 스크립트가 idle 색에서 실제 x86 이미지로 스모크를 돌린 뒤에만 전환한다.

`ai/`의 테스트와 배포는 AI 팀이 Modal 쪽에서 한다(인프라 CI 범위 밖). Modal 배포를 deploy 러너 잡으로 옮기는 것은 P2다(11.2절).

### 6.4 배포 스크립트 `infra/deploy/deploy.sh <env> <sha>`

GitLab이 죽어도 서버에서 직접 실행할 수 있다.

1. preflight(값 비출력): env 파일·권한·CRLF·필수 키, `compose config -q`, 디스크 여유, **메모리 여유**(겹침 배포에 필요한 양보다 적으면 중단), **다운그레이드 가드**(배포할 SHA가 현재 배포된 SHA의 후손이 아니면 거부한다. `git merge-base --is-ancestor`를 쓰며 저장소가 얕으면 먼저 `git fetch --unshallow origin`으로 전체 이력을 채우고, 못 채우면 거부한다. 되돌리기는 `rollback.sh`로만 한다)
2. `flock` 잠금
3. prod는 마이그레이션이 있으면 사전 `pg_dump` 후 일회성 마이그레이션 컨테이너 실행. 실패하면 트래픽을 건드리기 전에 중단
4. 서비스별로(BE, FE 순) 반대 색 기동 → readiness(BE 최대 150초, FE는 `/fe-healthz`) → idle 색 스모크(BE는 헬스·버전, FE는 SSR 페이지와 `/config.json`). FE의 정적 자산은 색을 띄우기 전에 풀에 쌓는다
5. Caddy 전환(`validate` → `reload`) → Caddy 경유 스모크(BE는 버전 헤더가 새 SHA인지, FE는 페이지가 200인지). 실패하면 자동 복귀
6. 30초 드레인 후 이전 색 정지. 컨테이너와 이미지는 다음 배포까지 보관하고 `rollback.sh`로 즉시 복귀
7. 상태 파일과 이력 기록, Mattermost 알림(SHA, 작성자, 소요 시간)

BE와 FE는 같은 절차로 전환하되 BE가 먼저, FE가 나중이다. 새 BE는 직전 FE와 하위호환이어야 한다(BE 계약 #16).

**구현 메모** (확인: `infra/deploy/test/test-deploy.sh`)

- `fit-app-prod`와 `fit-app-dev`는 `infra/app/compose.app.yml` 하나를 프로필(`prod`, `dev`)로 나눠 쓴다. 이미지 태그와 활성 색은 상태 파일 `/srv/fit/state/deploy-<환경>.env`가 정하고(compose의 `--env-file`), 처음 배포는 활성이 green으로 시작해 blue로 간다(엣지 견본의 upstream과 같다).
- 준비 확인과 idle 색 확인은 호스트에 게시하지 않는 포트를 위해 같은 망의 caddy 컨테이너 안에서 `wget`으로 한다. BE는 `/actuator/health/readiness`, `/healthz`, `/api/v1/version`(SHA), FE는 `/fe-healthz`, `/`, `/config.json`(`env`)이다.
- 마이그레이션은 이전 배포 SHA와 새 SHA 사이에 `be/src/main/resources/db/migration`이 바뀌었을 때(첫 배포 포함)만 실행한다. prod는 그 전에 `infra/backup/pg-backup.sh predeploy <환경> <sha>`(8절)로 덤프하고, 덤프나 마이그레이션이 실패하면 트래픽을 건드리기 전에 멈춘다.
- 새 색의 준비·직접 확인이나 엣지 전환 뒤 확인에 실패하면 새 색을 치우고 엣지를 이전 색으로 되돌린다. BE는 성공하고 FE가 실패하면 BE는 새 버전, FE는 이전 버전으로 남는다(새 BE가 직전 FE와 호환돼야 한다). `rollback.sh`는 서비스별로 이전 색(컨테이너와 이미지가 남아 있다)으로 옮기고, 전체 롤백이면 `DEPLOYED_SHA`와 `PREVIOUS_SHA`를 맞바꾼다.
- 이미 활성인 SHA를 다시 배포(env 값을 바꾼 뒤의 재배포, Retry)해도 롤백 대상은 유지된다. dev는 서비스별 직전 태그(`*_DEV_PREV_TAG`)와 `PREVIOUS_SHA`를 덮지 않는다. prod는 반대 색에 같은 태그를 띄워 두 색의 태그가 같아지므로 직전 릴리스를 `*_PROD_PREV_TAG`에 따로 적고, `rollback.sh`가 두 색의 태그가 같을 때 그 태그의 이미지로 이전 색을 띄운다(Jira S15P31A302-98, 확인: `infra/deploy/test/test-deploy.sh`).
- 사전 점검은 FE env의 `BE_INTERNAL_URL`이 이 환경의 엣지 내부 리스너(prod `caddy:8081`, dev `caddy:8082`)인지 확인한다. 같은 망의 컨테이너는 어느 환경의 리스너에도 닿으므로 환경 간 호출을 여기서 막는다.
- 정적 자산 풀(`/srv/fit/web/<환경>/pool/_next/static`)은 FE 이미지의 `/app/.next/static`을 `docker cp`로 꺼내 이미 있는 파일은 덮어쓰지 않고 쌓는다. 이번 릴리스가 가진 파일의 수정 시각을 갱신하고, 14일 넘게 어느 릴리스에도 없던 파일은 지운다.
- 잠금은 `mkdir`로 잡는다(프로세스가 죽어 남은 잠금은 pid로 알아본다). `flock`이 없는 환경에서도 같게 돈다. CI 밖에서 직접 실행하려면 `SKIP_VERIFY=<사유>`가 필요하고 사유는 이력에 남는다.

dev는 같은 스크립트를 단일 색으로 돌린다. 교체형이고 헬스 실패 시 직전 이미지로 복귀한다. 일정상 Blue/Green(P1)이 어려우면 prod도 이 교체형(헬스 게이트 + 직전 이미지 복귀)으로 먼저 배포한다(P0).

### 6.5 DB 마이그레이션

Flyway(Spring)를 쓴다.

- 적용된 파일 수정은 CI에서 거부하고, expand/contract만 허용한다.
- 전용 `migrate` 프로필로 일회성 컨테이너에서 실행한다.
- prod는 마이그레이션이 있는 배포 직전에 추가 덤프를 뜬다.
- 롤백은 forward-fix가 원칙이고, 치명적이면 사전 덤프로 복원한다.

### 6.6 이미지

호스트에서 `<서비스>:<SHA>`(be, fe)로 로컬 조립하고 서비스당 최근 5개를 보관한다. 모든 이미지 태그는 핀한다.

### 6.7 B 중단 시

B가 죽으면 CI가 멈추고 배포가 막힌다. 서비스는 영향이 없다. 외부 감시와 백업 전송도 멈추므로 A의 TCP 22 프로브가 알린다(9.2절). 긴급 시 A에서 `SKIP_VERIFY=<사유>`로 `deploy.sh`를 수동 실행하는 절차(RB-02b)를 둔다. B 재구축은 RB-01을 다시 따른다.

### 6.8 프런트(Next.js SSR)

FE는 `fe/`의 Next.js를 `output: 'standalone'`으로 빌드한 Node 컨테이너(`fe-<env>`)로 돌고 Caddy가 앞단에서 프록시한다(5절). 프런트 계약은 12.5절이다. 관리 지점을 줄이려고 BE와 같은 방식(Blue/Green, 상태 파일, 롤백 절차)을 쓰고 FE만의 절차를 만들지 않는다.

- **빌드:** `fe:build`가 B에서 `next build`로 번들을 **한 번만** 만든다. 환경별 값은 번들에 넣지 않는다(`NEXT_PUBLIC_*`에 환경별 값을 두지 않는다). dev에서 검증한 이미지가 곧 prod 이미지다. `generateBuildId`와 `deploymentId`는 커밋 SHA다. 시크릿은 어디에도 넣지 않는다.
- **아키텍처:** B(Arm)에서 만든 번들을 A(x86)에서 돌린다. standalone 번들에는 `sharp`의 플랫폼 전용 네이티브 모듈이 들어가고 이미지 최적화를 꺼도 빠지지 않는다(확인: Linux x64 빌드에서 `images.unoptimized: true`여도 `@img/sharp-linux-x64`가 들어간다). 그래서 이미지 최적화 기본 로더를 쓰지 않는다(`unoptimized: true` 또는 커스텀 로더). 사진은 Garage가 제공한다.
- **산출물 검사(P0):** 번들에 `localhost`·mock 값이 없는지, `.next/images-manifest.json`의 `unoptimized`가 `true`인지(확인: 설정에 따라 `false`나 `true`로 기록된다), 네이티브 모듈이 `sharp-*`뿐인지, `server.js`와 `.next/static`이 있는지 확인한다. 배치 뒤 smoke는 `/config.json`에 필수 키가 모두 있는지 확인한다. A503이 빌드타임 설정 누락으로 빈 번들을 6회 배포한 교훈이다.
- **배치:** `fe:<SHA>` 이미지로 반대 색 FE를 띄우고 idle 색에서 SSR 페이지(`/`)와 `/config.json`을 확인한 뒤 전환한다. 정적 자산은 색을 띄우기 전에 `.next/static`을 풀(`/srv/fit/web/<env>/pool/`)에 쌓는다.
- **운영:** 루트 파일시스템은 읽기 전용이고 `.next/cache`만 tmpfs다(확인: 쓰기 불가이면 `/app/.next/cache`를 만들지 못해 오류가 난다). 컨테이너 메모리 한도(4.1절)와 `NODE_OPTIONS=--max-old-space-size`로 힙을 묶고, 로그는 JSON을 stdout으로 낸다. 종료는 SIGTERM이며 진행 중 요청을 끝낼 시간으로 30초 드레인을 둔다(Next.js 문서는 10~30초를 권장한다).
- **버전 스큐:** `deploymentId`가 있으면 Next가 어긋남을 감지해 전체 새로고침을 한다(Next.js 문서). 이전 릴리스 자산은 풀에 남아 있고, API는 직전 배포의 FE와 하위호환을 유지한다(BE 계약 #16).
- **푸시와 설치:** 웹 푸시와 설치 흐름은 프런트 팀 몫이다. 인프라는 HTTPS, 캐시 정책, 푸시 키 보관을 맡는다(11.3절).

## 7. 데이터 서비스

### 7.1 Postgres

- 이미지는 `pgvector/pgvector:0.8.7-pg16`으로 핀한다(로컬 스택과 같다).
- 튜닝은 mount한 설정 파일이 아니라 `command:` 플래그로 한다(shared_buffers 256MB, max_connections 60, `idle_in_transaction_session_timeout`, `pg_stat_statements`).
- 환경별 DB·role은 init 스크립트가 아니라 멱등 `infra/data/ensure-databases.sh`로 만든다. init 스크립트는 빈 볼륨에서 한 번만 돌기 때문이다(A503 함정). role은 `fit_migrator`(DDL, 두 DB의 소유자), `fit_prod_app`, `fit_dev_app`(DML만), `fit_monitor`(`pg_monitor` 멤버. postgres_exporter가 `postgres` DB에서 통계만 읽고 앱 DB에는 접속하지 못한다)이고 DB는 `fit_prod`, `fit_dev`다. 각 앱 role은 자기 DB에만 접속하고(`REVOKE ... FROM PUBLIC`), 마이그레이터가 만드는 테이블·시퀀스에는 기본 권한으로 DML 권한이 따라간다. 비밀번호는 실행할 때마다 `/etc/fit/data.env` 값으로 맞춘다(교체는 값을 바꾸고 다시 실행). dev role에는 `statement_timeout` 30초를 건다 (확인: `infra/data/test/test-data.sh`).
- 비밀번호는 SQL에 그대로 들어가므로 영문·숫자·`._~-`만 쓴 16자 이상으로 제한하고 스크립트가 그 밖의 값을 거부한다. data.env는 셸로 실행하지 않고 `KEY=VALUE` 줄만 읽는다. SQL은 표준 입력으로 넘기고 `log_statement`와 `pg_stat_statements.track_utility`를 꺼서 비밀번호가 프로세스 목록, Postgres 로그, 통계에 남지 않는다 (확인: 위 시험).
- 공식 이미지는 컨테이너 안 loopback 접속을 비밀번호 없이 허용(trust)한다. 다른 컨테이너가 서비스 이름으로 들어오는 접속은 scram-sha-256 비밀번호 검사를 받는다 (확인: 틀린 비밀번호가 거부됨). 호스트 게시 포트(`127.0.0.1:5432`)로 들어오는 접속은 출발지가 loopback이 아니라 같은 규칙을 받는다 (서버에서 터널로 확인).
- 개발자용 dev DB 접근은 SSH 터널 → `127.0.0.1:5432`이고 dev role 비밀번호만 공유한다.

### 7.2 OpenSearch

- 공식 이미지(`opensearchproject/opensearch:3.9.0`)에 `analysis-nori`를 설치한 커스텀 이미지다(힙 768MB). 설치는 `opensearch-plugin install --batch analysis-nori`다. 로컬에서 빌드해 `analysis-nori`와 `opensearch-knn` 플러그인이 있고 nori 분석기가 동작함을 확인했다 (확인: `infra/local/fit-local.sh`).
- 서버용 정의는 `infra/data/compose.data.yml`이고 로컬과 같은 Dockerfile(`infra/local/opensearch`)을 빌드한다(메모리 상한 2GB, 힙 768MB, 호스트 게시 없음). 이 compose로 띄운 OpenSearch에서 nori 분석기가 한국어를 형태소로 나눈다(`닭가슴살` → `닭`, `가슴`, `살`) (확인: `FIT_TEST_OPENSEARCH=1 bash infra/data/test/test-data.sh`). 빈 인덱스 상태에서 컨테이너 메모리는 약 1.3GiB였다(4.1절의 평상시 추정과 같다. Postgres 약 63MiB, Redis 각 약 4MiB, Garage 약 5MiB는 유휴 값이라 실제 데이터로 다시 잰다).
- single-node이고 보안 플러그인은 끈다. 내부 망이고 호스트 게시가 없다는 전제이며 잔여 위험은 13절에 있다.
- `action.destructive_requires_name=true`, 인덱스 템플릿은 `replicas: 0`이다(아니면 yellow).
- 무중단 재색인은 별칭 전환이다(BE 계약).
- 복구는 Postgres에서 재색인한다(스냅샷 없음). 재색인 소요 시간은 측정해 기록한다.
- 임베딩이 Modal 호출이라, 문서 벡터를 Postgres(pgvector)에도 저장해 두지 않으면 재색인 때 문서 전체를 다시 Modal로 임베딩해야 한다(시간·비용). 저장 위치는 BE·AI 팀과 합의한다(16절).
- 벡터 규모와 네이티브 메모리는 4.4절에 있다.

### 7.3 Redis ×2

`redis-prod`, `redis-dev`. maxmemory 96MB, `noeviction`(멱등성 키가 쫓겨나지 않게), AOF everysec, requirepass(환경별 비밀번호). maxmemory를 넘으면 기존 키를 쫓아내지 않고 쓰기를 `OOM` 오류로 거절하고, 재시작하면 AOF로 데이터가 돌아오며, dev 비밀번호로는 prod Redis에 들어가지 못한다 (확인: `infra/data/test/test-data.sh`).

### 7.4 사진 저장소 (Garage)

Garage(`dxflrs/garage:v2.4.1`, 데이터·메타 볼륨, 설정은 디렉터리 마운트)를 쓴다. 공식 문서 기준으로 기획서의 업로드 흐름에 필요한 기능을 지원한다 (확인).

- **지원:** SigV4 presigned URL, PostObject, 멀티파트, Head/Copy/Delete, 수명주기의 `Expiration`과 `AbortIncompleteMultipartUpload`(접두사는 `Filter` 안에), CORS, ListObjectsV2, path-style
- **미지원:** 버킷 정책, 태깅, 버저닝(접두사로 대체)
- **흐름:** 업로드는 `pending/`, 리뷰 등록이 확정되면 `confirmed/`로 Copy 후 Delete, `pending/`는 수명주기로 자동 정리
- **읽기:** 확정된 사진(`confirmed/`)만 웹 엔드포인트로 공개 읽기한다(5절). 업로드는 S3 API, 읽기는 웹 엔드포인트로 경로가 갈린다

**첫 주 스파이크(2시간):** PostObject의 `content-length-range` 강제 여부, presigned PUT/POST가 Caddy 경유(Host 보존)로 서명이 통과하는지, 수명주기 동작, 웹 엔드포인트(3902)로 `confirmed/` 공개 읽기가 되고 익명 S3 GET은 거부되는지를 확인한다. 웹 엔드포인트의 공개 읽기와 익명 S3 GET 거부는 로컬 스택 점검에서 확인했다 (확인). 나머지는 서버에서 확인한다. 실패하면 Cloudflare R2나 Firebase Storage로 간다(계정·결제수단 필요, 국외 이전이면 처리방침 고지).

Garage는 단일 노드라도 레이아웃 설정이 필요하다(`layout assign/apply`, 버킷·키 생성). 로컬의 멱등 스크립트는 `infra/local/fit-local.sh`의 `init_garage`다 (확인). 서버용 멱등 스크립트는 `infra/data/init-garage.sh`이고 환경별 키는 `/etc/fit/data.env`에 둔다. 키 ID는 `GK` + 16진수 24자리, 비밀 키는 16진수 64자리여야 하고(Garage의 `key import` 형식) 스크립트가 이미 있는 키는 바꾸지 않는다. 버킷마다 자기 환경의 키에만 읽기·쓰기·소유 권한을 주고 웹 엔드포인트 공개 읽기와 수명주기(`pending/`와 끝나지 않은 멀티파트를 1일 뒤 삭제)를 건다. 호스트에는 S3 도구가 없고 Garage의 S3 포트를 게시하지 않으므로 스크립트는 net-data에 붙인 python 컨테이너에서 서명한 요청(`infra/data/s3tool.py`, 표준 라이브러리 SigV4)으로 수명주기 설정과 사진 읽기를 한다. 실제 Garage v2.4.1에서 dev 키가 prod 버킷을 읽거나 쓰지 못하고, 서명 없는 S3 GET은 거부되며 웹 엔드포인트 읽기는 되고, 재시작 뒤에도 객체와 레이아웃이 남으며 초기화를 다시 실행해도 변경이 없음을 확인했다 (확인: `infra/data/test/test-data.sh`). 메모리는 작을 것으로 보고(추정) 0.25GB를 잡았다.

## 8. 백업·복구

목표는 RPO 4시간, RTO 2시간이다(제안값, 복원 리허설로 측정).

| 대상 | 주기 | 보관 위치 |
|---|---|---|
| Postgres 덤프 | 4시간마다 | A 로컬, B 금고(4시간 단위 48시간 + 일 단위 14일) |
| 사진 | 하루 1회(사진의 RPO는 24시간) | A 로컬, B 금고(S3 API로 읽어 tar로 묶는다) |
| Caddy 인증서 볼륨 | 주 1회 | B 금고 |
| `/etc/fit/*.env` | 변경 때마다(수동) | 팀 비밀번호 관리자(암호화) |
| OpenSearch | 백업하지 않는다 | Postgres에서 재색인 |

1. **덤프와 검증(A):** A가 4시간마다 `pg_dump -Fc`를 뜬다(`infra/backup/pg-backup.sh scheduled`). 마지막 검증 뒤 24시간이 지났으면 같은 덤프를 임시 컨테이너 DB(망 없음, 메모리 디스크)에 복원해 검사한다(덤프 시점 검증, `verify-dump.sh`). 복원 오류가 없고 복원된 public 테이블 수가 덤프 시점의 수와 같아야 통과한다. 통과하면 `age`로 암호화한다. 실패하면 그 덤프는 보내지 않고 `failed-verify-*`로 남기며 지표 `fit_backup_last_verify_ok`가 0이 된다. 수신자는 2명(인프라 담당, 백업 담당)이고 공개키만 A에 둔다(`/etc/fit/keys/age-recipients.txt`). 수신자 2명이 각자 풀 수 있고 수신자가 아닌 키로는 풀 수 없으며, 암호화 파일에서 테이블 이름이나 데이터가 보이지 않고, 복원한 DB에서 원래 행이 조회됨을 확인했다 (확인: `infra/backup/test/test-backup.sh`).
2. **전송:** B로 `rsync`한다(`push-vault.sh`). 암호화 파일을 먼저, sha256·크기를 적은 `.meta`를 나중에 보내고 B는 `.meta`가 있어야 받은 것으로 친다. 전용 `vault` 사용자가 쓰기 전용 강제 명령(`rrsync -wo -no-del /srv/vault/incoming`, `restrict`, 선택적으로 `from=<A의 IP>`)으로만 접속한다. Ubuntu 24.04에서 A의 키로 셸 명령 실행, 금고 읽기, `--delete`, `incoming/` 밖 쓰기가 모두 거부되고 등록하지 않은 주소에서는 같은 키도 거부됨을 확인했다 (확인: 위 시험). 22.04의 `rrsync`는 `python3`가 있어야 한다. B의 호스트 키는 사람이 지문을 B의 지문과 대조한 뒤 등록한 `known_hosts`로 고정하고, 다른 키가 오면 보내지 않는다 (확인: 위 시험). 보내기에 성공한 파일만 A의 outbox에서 지우고 실패하면 다음 실행이 다시 보낸다.
3. **보관(B):** B의 timer가 10분마다 `vault-ingest.sh`를 돌린다. `incoming`의 파일을 root만 쓰는 staging으로 옮긴 뒤(vault 계정이 검증 뒤에 바꿔치기하지 못하게) 이름 형식, sha256, 크기, 일반 파일 여부를 검증해 `store/<종류>/`로 옮기고 실패한 것은 `store/quarantine/`으로 보낸다. 보관 정책(4시간 단위 48시간 + 한국 시간 기준 하루 1벌 14일)을 적용하고 마지막 수신 시각, 보관 수·크기, 격리·실패 수를 지표로 낸다. 8시간 넘게 새 백업이 안 오면 B가 알린다(A가 죽어도 감지, 알림 규칙은 계획 1E). 손상된 파일, 크기가 다른 파일, 형식이 틀린 `.meta`, 심볼릭 링크는 격리되고 보관소에 들어가지 않음을 확인했다 (확인: 위 시험).
4. **복호화 키:** 개인키는 A·B 어디에도 두지 않고 수신자 2명이 각자 오프라인으로 보관한다. 서버가 뚫려도 백업 평문이 나가지 않는 대신 자동 복원 리허설은 하지 않는다.
5. **복원 리허설:** 사람이 노트북(Docker Desktop, `age`)에서 B 사본을 내려받아 복호화·복원하고 걸린 시간(RTO)을 `restore-check.sh`로 잰다. 주 1회 하고 11/06 전에는 최소 2회 한다. 결과는 B에서 `vault-ingest.sh record-restore <epoch> <RTO>`로 기록해 지표(`fit_vault_last_restore_check_*`)로 낸다. 내려받은 암호화 덤프 최신 1벌은 노트북에 남긴다(3번째 사본, 13.4절). 절차는 `infra/backup/README.md`다.
6. **A 로컬 보관:** 같은 보관 정책(4시간 단위 48시간 + 일 단위 14일)을 쓴다(`/srv/fit/backups/{pg,photos,caddy}`, 보낼 파일은 `outbox/`).
7. **그 외 대상:** 사진(`files-backup.sh photos`: prod 버킷 전체를 S3 API로 읽어 tar)과 Caddy 인증서 볼륨(`files-backup.sh caddy`: 데이터 볼륨을 읽기 전용으로 tar)도 암호화해 같은 경로로 B에 보낸다. OpenSearch는 Postgres에서 재색인한다. `/etc/fit/*.env`는 자동화하지 않고 인프라 담당이 변경 때마다 암호화해 팀 비밀번호 관리자에 둔다. 백업하는 DB는 `fit_prod`뿐이다(dev DB와 dev 사진은 하지 않는다).
8. **선택(P2):** GitLab Package Registry에 암호화 사본을 2차로 올린다. 디스크 스냅샷은 AWS 콘솔이 있어야 켤 수 있는데 A는 SSAFY가 준 서버라 콘솔 계정이 없어 쓰지 못한다(확인).
9. **B 소실:** 금고 내용은 사라지지만 A에 로컬 사본이 있다. B를 재구축한다(RB-01).
10. **A 소실(RB-12):** bootstrap → 금고에서 복원(사람, 개인키 사용) → OpenSearch 재색인 → 사진 복원 → env를 팀 비밀번호 관리자에서 복구 → 배포 순서다.
11. **마이그레이션 전 덤프:** `pg-backup.sh predeploy <환경> <sha>`가 평문 덤프를 `/srv/fit/predeploy/`에 두고 환경별 최근 5개만 남긴다. 개인키가 서버에 없어 암호화하면 급할 때 복원할 수 없고, 이 덤프는 A의 DB 볼륨과 같은 신뢰 범위에 있으며 B로 보내지 않는다. 디렉터리는 배포 러너(`gitlab-runner`, docker 그룹)가 쓸 수 있도록 root 전용 백업 디렉터리 밖에 두고(`root:docker 2770`) 파일은 640이다.
12. **설치:** `infra/backup/install.sh app|ops`가 패키지(`age`, `rsync`), 디렉터리, 전송 키, systemd 타이머(A: `fit-backup-pg`(00:15부터 4시간마다), `fit-backup-photos`(04:40), `fit-backup-caddy`(일요일 04:50), B: `fit-vault-ingest`(10분마다))를 멱등하게 만든다. 타이머는 저장소 체크아웃이 아니라 root만 쓸 수 있는 사본(`/usr/local/lib/fit/repo`)을 실행해서 배포 러너가 저장소를 바꿔도 root로 도는 백업 코드가 바뀌지 않는다. 유닛 파일은 `systemd-analyze`로 `OnCalendar` 표현과 문법을 확인했다 (확인: `test-backup.sh`의 `units` 구역, systemd 255). 지표는 Prometheus textfile 형식으로 A는 `/var/lib/fit/metrics/fit_backup.prom`, B는 `/srv/vault/metrics/fit_vault.prom`에 쓰고 수집은 계획 1E다. 타이머의 실제 실행, A↔B의 실제 네트워크, 22.04의 `rrsync`는 서버에서 확인한다.

종료(11/18)에는 합성 데이터 덤프를 만들어 포팅 매뉴얼에 첨부한다(실데이터를 커밋한 A603 사고 방지). 실데이터와 호스트 밖 사본은 RB-10으로 삭제한다.

## 9. 관측성·알림

### 9.1 A 스택

- Prometheus(보존 7일 + 5GB 상한), Alertmanager → Mattermost(수신 웹훅에 Slack 형식으로 보낸다), Grafana(대시보드 3개를 repo에서 프로비저닝, SSH 터널로 접속, 익명 접근 없음)
- node_exporter, cAdvisor, blackbox_exporter, postgres_exporter, OpenSearch exporter, Dozzle(로그 UI)
- 프로젝트 `fit-obs`(`infra/obs/compose.obs.yml`). 서버마다 다른 값(B의 IP, 웹훅)은 일회성 서비스 `obs-init`(`render.py`)이 시작 때 설정 파일로 만들고, 나머지 설정은 저장소 파일 그대로 쓴다. 한도의 합은 1,344MB다(4.1절).
- postgres_exporter는 `fit_monitor` role로 읽는다(7.1절). 호스트가 쓰는 지표(백업)는 node_exporter의 textfile collector로 읽는다(`/var/lib/fit/metrics`).
- 사용법과 알림 목록은 [infra/obs/README.md](../../infra/obs/README.md)다.
- Loki·Tempo·OTel은 올리지 않는다. 로그 검색이 필요해지면 Alloy + Loki(보존 3일)를 나중에 추가한다. Promtail은 2026-03-02에 EOL이다 (확인).

대시보드 3개:

1. 호스트·컨테이너: CPU와 40% 기준선, 컨테이너별 메모리와 한도, 스왑, 디스크, 로드
2. 앱: RED, JVM·Hikari, Modal 호출·검색 지연, 폴백 비율
3. 데이터: Postgres, OpenSearch와 백업·배치 신선도

### 9.2 A 알림

| 알림 | 조건 | 심각도 |
|---|---|---|
| 서비스 다운 | BE 모든 색 up==0 2분 | critical |
| 메모리 | MemAvailable<8% 5분 / 스왑 50% 10분 | critical / warning |
| OOM·재시작 | OOM 이벤트(`node_vmstat_oom_kill` 증가. cgroup OOM도 센다, 구현 시 확인), 10분에 재시작 3회(cAdvisor) | critical |
| 컨테이너 메모리 | 한도의 90% 10분 | warning |
| 디스크 | 80% / 90%, 24시간 내 고갈 예측 | warning / critical |
| CPU 지속 | 30분 평균 >40% / 2시간 >40% | warning / critical |
| 앱 오류 | 5xx >2%(최소 요청 수), p95 지연 10분(경로별: 검색 >4s, 그 외 >1s, 추정) | warning |
| 배치 | 04:00 배치 마지막 성공 >26시간 | warning |
| OpenSearch·Postgres | red, 힙 >90%, 연결 >80%, pg_up==0 | critical / warning |
| 폴백 | `*_fallback_ratio` >30% 15분(임베딩·리랭커·LLM 각각) | warning |
| Modal 예산 | 일일 호출 예산 80% 소진(Redis 카운터) | warning |
| 백업 | 마지막 성공 pg >8시간, photos >36시간, caddy >9일, 복원 검증 실패나 36시간 넘게 없음, 전송 대기(outbox) 파일 | warning |
| 수집 대상 | prometheus, alertmanager, node, cadvisor, caddy, postgres, opensearch, blackbox의 `up==0` 5분 | warning |
| 지표 누락 | 반드시 있어야 하는 지표(BE HTTP, 배치, Modal 예산, 백업)가 15분 넘게 없음(`absent()`) | warning |
| B 도달 불가 | A에서 B의 TCP 22 프로브 실패 | warning (CI·백업 영향) |

### 9.3 B 알림

| 알림 | 조건 | 심각도 |
|---|---|---|
| 외부 접근 | A `/healthz` 또는 `/`(FE) 2분 연속 실패 | critical |
| 인증서 | 밖에서 본 만료일 <14일 / <7일. TLS 연결이 실패해 만료일을 읽지 못하면 따로 warning | warning / critical |
| 포트 도달성 | A의 80·443 TCP 불가 | critical |
| 포트 노출 감사 | 15분마다 A의 1~1,024번과 자주 쓰는 서비스 포트를, 매일 05:30에 1~65,535번 전체를 밖에서 스캔(`infra/ops/port-audit.py`). 22·80·443 외에 열린 포트가 있으면. 감사가 1시간(전체는 36시간) 넘게 안 돌면 warning | critical |
| 감시 체계 감시 | A의 `/_ops/prometheus/healthy`, `/_ops/alertmanager/healthy` 실패 | critical |
| 백업 금고 | 마지막 수신 >8시간 / 사람 복원 리허설 >8일. 격리 파일, 검증 실패, ingest 중단은 warning | critical / info |
| B 자신 | 디스크 80%, 메모리 8% 미만, 수집 대상 다운 | warning |

B의 알림은 모두 prod에 관한 것이라 수신자는 하나다. 프로브 대상과 지표는 [infra/ops/README.md](../../infra/ops/README.md)다.

### 9.4 공통 규칙

- heartbeat 지표는 counter가 아니라 gauge로 만든다(계열이 처음부터 존재). 반드시 있어야 하는 지표는 `absent()` 알림을 둔다.
- 모든 규칙을 `promtool test rules`로 CI에서 검증한다. `infra/ci/check_alerts.py`가 알림 이름(`Fit` 접두사, 중복)과 severity·summary·description·runbook, 단위 시험의 존재, 대시보드의 uid·패널 id 중복과 데이터소스를, `infra/ci/check-alertmanager.sh`(amtool)가 설정과 라우팅(`routes.txt`)을 검사한다.
- BE가 내는 지표 이름은 [contracts/metrics.md](contracts/metrics.md)가 정한다.
- 알림마다 runbook 링크를 단다.
- 두 Alertmanager 모두 Mattermost로 보내되 `site`(A/B)와 `env` 라벨을 붙인다. 알림은 알림 이름이 아니라 `site/env`별로 묶어 한 메시지에 모은다. critical은 바로 보내고 해소도 알리며 1시간마다 다시 알린다. warning과 info는 5분 모아 보내고 새 알림만 1시간 단위로 보태며 24시간마다 다시 알리고 해소는 알리지 않는다. dev(`env=dev`)는 별도 수신자로 같은 방식(해소 없음)으로 보낸다. 메시지는 제목(상태, 건수, 환경)과 알림마다 요약, 런북 번호만 담는다(`alertmanager/templates/fit.tmpl`).
- Alertmanager 웹훅 URL은 `api_url_file`로 시크릿 파일에서 읽는다.

## 10. 운영

### 10.1 일일 점검

하루 두 번(09:00, 18:00 KST) `infra/obs/daily-digest.py`(A, `fit-daily-digest.timer`)가 서버의 전체 상태를 Mattermost에 **한 메시지**로 올린다. 제목(`Fit Dining · 정상|주의 N건|장애 N건 · 월-일 시:분`)과 표 셋이다: 확인 필요(울리는 알림과 요약만 아는 문제를 구분·내용·런북으로), 서비스(prod·dev BE, 엣지, DB, 검색, 금고가 떠 있는지), 백업(pg·photos·caddy의 마지막 성공과 복원 검증). 정상인 값(디스크·메모리·CPU·배포·인증서)은 문제가 생겼을 때만 확인 필요에 나온다. 인증서 잔여일은 서버 자신의 443에서 읽는다. Prometheus나 웹훅에 닿지 못하면 그 사실을 올리고 종료 코드 1로 끝난다. 알림 메시지는 알림 이름이 아니라 환경(`site/env`)별로 묶어 한 메시지에 모으고, critical만 바로 보내며 warning과 info는 모아서 해소를 알리지 않는다(9.4절).

### 10.2 런북

각 런북은 증상 → 값 비출력 확인 명령 → 조치 순으로 쓰고 머리에 검증 기준 커밋·날짜를 적는다.

| ID | 내용 |
|---|---|
| RB-01 | 서버 첫날 점검·부트스트랩(A/B) |
| RB-02 | 배포·롤백 |
| RB-02b | 긴급 수동 배포(`SKIP_VERIFY`) |
| RB-03 | 메모리 부족·OOM |
| RB-04 | 디스크 |
| RB-05 | 인증서·TLS |
| RB-06 | DB 복원(금고에서, 사람)과 복원 리허설 |
| RB-07 | OpenSearch 재색인 |
| RB-08 | 시크릿 회전 |
| RB-09 | CPU 버스트 소진 의심 |
| RB-10 | 서비스 종료(11/18) |
| RB-11 | Modal 임베딩 모델 교체와 재색인 연계(AI 팀 주도, RB-07 사용) |
| RB-12 | A 소실 시 재구축(DR). 새 IP면 도메인 변경 요청 절차 포함 |
| RB-13 | dev DB 초기화(적용된 마이그레이션이 develop과 어긋났을 때, 10.8절) |

작성한 런북은 [runbooks/](runbooks/README.md)에 있다. 2026-10-28 기준 RB-01~13과 RB-02b를 모두 썼다. 각 파일 맨 아래에 서버에서 직접 따라 해 본 범위와 해 보지 못한 범위를 적는다. RB-12(A 소실 재구축)는 서버에서 한 번도 따라 해 보지 않았고, 사진을 되살리는 도구가 없는 것을 포함해 알려진 빈칸이 적혀 있다.

### 10.3 리허설 (11/06 전)

- BE `kill -9`, OOM
- 배포 실패 자동 복귀
- 호스트 재부팅 후 전체 기동 순서(`fit-up.sh`)
- 복원, 인증서 갱신
- B 중단, A 재구축 + 금고 복원
- 모델 교체(재색인 포함), Modal 장애 폴백(키워드 검색 확인)

### 10.4 접근 정책

| 대상 | 접근 |
|---|---|
| 인프라 담당 | A, B 모두 개인 계정(sudo) |
| 팀원 | A의 `fit-dev`(비특권, 셸 없음)로 SSH 터널만. `PermitOpen`으로 Grafana(3000), Dozzle(8888), dev DB(5432)만 허용. B에는 접근 없음 |
| 배포·prod | 인프라 담당만 |

Grafana는 팀원에게 viewer 계정을 준다. A503에서는 SSH 보유자만 로그를 볼 수 있어 원인을 못 좁힌 사례가 있었다.

### 10.5 로컬 개발·사전 검증

- 로컬 개발용 `infra/local/compose.yml`은 profile(`core`, `search`)로 나눠 노트북 메모리에 맞게 고르게 한다. AI는 Modal의 dev 앱을 쓴다. 켜고 점검하는 명령은 `bash infra/local/fit-local.sh`이고 접속 값은 `infra/local/README.md`에 있다. 환경변수 이름은 `docs/infra/contracts/env.md`를 따른다. 엣지는 `bash infra/edge/test/test-edge.sh up|verify|down`으로 목 BE·FE와 시험용 풀, 로컬 스택의 garage를 붙여 시험한다. 배포는 `bash infra/deploy/test/test-deploy.sh up|run|down`으로 실제 Caddy와 목 BE·FE 이미지를 띄워 배포·롤백·실패 복구를 시험한다.
- 서버 수령 전에는 이 PC의 Docker Desktop(Docker 29.7.2, Compose v5.4.0)과 Ubuntu 컨테이너(호스트 스크립트)로 compose·스크립트·알림 규칙·Caddy 설정을 검증한다. shellcheck, promtool, age는 컨테이너로 돌린다.
- 서버에서만 확인되는 것은 스왑·sysctl 적용, ufw의 실제 차단, 실제 TLS 발급, CPU 버스트, 외부 포트 노출, 클라우드 방화벽이다.

### 10.6 동결과 핫픽스

- **병합 방식:** MR은 fast-forward로 병합한다(프로젝트 설정). 병합 커밋이 새 SHA를 만들면 dev에서 검증한 이미지·번들과 prod가 달라진다. `develop → master`가 fast-forward가 되려면 master에 develop에 없는 커밋이 없어야 하므로 핫픽스도 반드시 develop을 거친다.
- **동결(11/04 이후):** 기능 MR은 받지 않는다. develop·master의 병합 권한을 인프라 담당과 지정한 리뷰어로 좁힌다.
- **핫픽스 순서:** `hotfix` 타입 브랜치(10.8절) → develop MR(dev 자동 배포, `smoke:dev` 통과) → `develop → master` fast-forward MR → 인프라 담당이 `deploy:prod`를 수동 실행 → smoke와 `rollback.sh` 준비 상태 확인 → Mattermost 공지.
- **승인:** 2인(인프라 담당과 해당 영역 담당). 배포는 공지한 시간대에 한다. 장애 중에는 사후 승인을 허용하고 사유를 남긴다(RB-02b 포함).

### 10.7 첫 공개 준비 (11/02까지)

- **prod 데이터 적재 경로:** 수집(Apify 등) → Postgres 적재 → 문서 전량 임베딩 백필(Modal) → OpenSearch 인덱스 생성과 별칭 연결. 중간에 멈춰도 이어서 돌릴 수 있어야 한다. 소요 시간과 비용은 dev에서 한 번 재서 기록한다(BE·AI 팀, 16절 #24).
- **배치 중복 방지:** dev의 새벽 배치는 기본으로 끄고(`BATCH_ENABLED=false`) 필요하면 prod 벡터를 복사해 쓴다(Modal 비용 이중 발생 방지). prod 배치는 한 번에 하나만 돈다(BE 계약 #19).
- **시험:** 알림 테스트 발화, 복원 리허설 2회, Modal 지출 한도·킬스위치·키워드 폴백 시험, 롤백 시험, 인증서 만료일과 `caddy_data` 백업 확인, 경량 부하 시험(4.4절 가정 기준).

### 10.8 브랜치·MR 운영 규칙

브랜치가 여러 개 갈라지고 MR이 한꺼번에 몰려도 prod에는 검증된 한 줄의 이력만 올라가게 하는 규칙이다.

**브랜치**

| 브랜치 | 역할 | 배포 |
|---|---|---|
| `<Jira키>/<타입>/<설명>` (예: `S15P31A302-123/feat/login-page`) | 개발 브랜치. MR로 `develop`에 합친다 | 배포하지 않는다 |
| `develop` | 통합. 항상 배포 가능한 상태로 둔다 | dev 자동 배포 |
| `master` | prod 승격 | prod 수동 배포 |
| `<Jira키>/hotfix/<설명>` | 긴급 수정. `develop`을 거쳐 `master`로 간다(10.6절) | 위 경로를 따른다 |

**GitLab 프로젝트 설정** (인프라 담당이 설정한다. 단계별 절차와 시점은 [gitlab-setup.md](gitlab-setup.md))

- `develop`(만든 뒤)과 `master`는 protected로 둔다. push는 막고 병합 권한은 인프라 담당과 지정한 리뷰어로 좁힌다(동결 중에는 10.6절). 사용자 단위 지정은 Premium 이상에서만 가능하다 (확인: GitLab 문서). Free면 Maintainer 역할을 인프라 담당과 지정한 리뷰어로만 둔다.
- Merge method는 fast-forward merge로 한다. 병합 시점의 자동 rebase(Enable automatic rebase prior to merge)는 켜지 않는다(이 서버 18.11에는 옵션이 없다). 켜면 rebase한 결과에 파이프라인이 다시 돌지 않아 검증하지 않은 SHA가 병합된다 (확인: GitLab 문서).
- 병합할 때 squash(Squash commits when merging)는 `Do not allow`로 둔다. squash는 새 커밋을 만들어 파이프라인이 검증한 SHA와 달라진다.
- "Pipelines must succeed"와 "All threads must be resolved"를 켠다.
- 병합한 뒤 source branch를 지운다.
- "Auto-cancel redundant pipelines"를 켠다(구현 시 확인). 같은 브랜치에 새 커밋이 오면 이전 파이프라인의 verify 잡이 취소된다. verify 잡만 `interruptible`이다.
- "Prevent outdated deployment jobs"를 켜고 `process_mode`를 `oldest_first`로 바꾼다(6.2절).
- 브랜치 이름과 커밋 메시지는 저장소 루트의 `CONTRIBUTING.md`(lefthook으로 검사)를 따른다. 브랜치는 `<Jira키>/<타입>/<설명>`, 커밋은 `[<Jira 키>] <type>: <설명>`이고 type은 소문자다. `develop`과 `master`는 이름 검사에서 제외된다.
- MR 승인은 설정으로 강제할 수 없다(CE에 승인 규칙이 없다). 병합 권한을 Maintainer로 좁히고 MR 설명에 체크 항목을 둔다.

**병합 순서**

- fast-forward 병합은 병합 전에 source 브랜치를 target 위로 rebase해야 한다. 그래서 병합은 한 번에 하나씩 일어나고, 병합될 때마다 남은 MR은 rebase하고 파이프라인을 다시 돌린다.
- 병합 커밋(3-way merge)은 쓰지 않는다. 브랜치는 `git rebase origin/master`로 최신화하고 `git pull --rebase`로 당겨받는다. 로컬에서는 lefthook의 `pre-merge-commit`이, MR에서는 CI의 `lint:history`가 병합 커밋을 막는다. GitLab의 fast-forward 병합은 병합 커밋이 든 브랜치도 받아주므로 이 검사가 필요하다.
- merge train은 쓰지 않는다. Premium·Ultimate 기능이고 fast-forward와 완전히 호환되지 않는다 (확인: GitLab 문서).
- 병합 권한자는 준비된 MR을 먼저 올라온 순서로 하나씩 병합한다. 대기가 길면 변경이 작은 MR부터 병합한다.
- verify 러너가 B 한 대라 MR이 몰리면 큐가 길어진다. 그래서 MR 파이프라인은 바뀐 경로의 잡만 돌리고(6.3절), 무거운 잡만 줄을 세우고 가벼운 잡은 동시에 돌린다(`concurrent 2`). 파이프라인에는 시간 상한(`timeout`, 예: 30분, 제안값)을 둔다.
- 마이그레이션 번호가 겹치는 MR은 앞선 MR이 병합된 뒤 rebase하면 `lint:migrations`가 `duplicate-version`으로 잡는다(6.5절). 새 번호는 rebase한 뒤 다시 붙인다.

**인프라 경로 변경**

- `.gitlab-ci.yml`, `infra/`, `be/src/main/resources/db/migration/`을 바꾸는 MR은 인프라 담당 승인을 받는다. CI 파일은 B와 A의 러너에서 코드를 실행하는 경로이기 때문이다.
- MR approval rules와 CODEOWNERS 강제는 Premium 기능이라 Community Edition인 이 GitLab에서는 쓸 수 없다 (확인: 설정 화면에 승인 규칙 항목이 없다, 16절 #25). 그래서 병합 권한을 Maintainer 역할로 좁히고(Maintainer는 인프라 담당과 지정한 리뷰어만) MR 설명에 체크 항목을 둔다.

**dev 사용**

- dev는 하나이고 `develop` 푸시 때만 배포한다. 기능 브랜치는 dev에 올리지 않고 로컬 compose(`infra/local/compose.yml`, 10.5절)로 시험한다.
- 기능 브랜치를 dev에 올렸다가 내리면 적용된 마이그레이션이 `develop`에 없어 dev DB의 Flyway 검증이 깨진다. 이런 어긋남이 생기면 RB-13으로 dev DB를 초기화한다.

**`develop`과 prod 승격**

- `develop`은 항상 배포 가능한 상태로 둔다. 미완성 기능은 `*_ENABLED` 스위치(11.2절의 킬스위치 방식) 뒤에 두고 기본값을 꺼 둔다. 그래야 `develop` 전체를 승격해도, 핫픽스가 `develop`을 거쳐도 미완성 코드가 노출되지 않는다.
- 승격 단위는 `develop` 전체다(`develop → master` fast-forward MR). `master`에만 있는 커밋은 만들지 않는다(10.6절).
- prod 수동 배포는 `master`의 최신 파이프라인에서만 누른다(6.2절).

## 11. GPU 서버·Modal·외부 호출

### 11.1 GPU 서버 (공용, 학습 전용)

인프라가 다루지 않는다. 서비스 경로에 넣지 않고 A·B와 연결도 만들지 않는다. 공용이라 가용성 보장이 없고, prod 시크릿과 비식별되지 않은 실데이터를 올리지 않는다.

- **데이터와 산출물:** 학습 데이터 반출(비식별 포함)과 학습 결과를 Modal에 올리는 일은 AI 팀이 직접 한다. 인프라에는 경로·권한·체크섬 규약이 없다.
- **모델 교체:** AI 팀이 Modal에서 새 버전을 배포한다. 임베딩 모델이 바뀌면 벡터 공간이 달라져 새 인덱스에 재색인하고 별칭을 전환해야 한다(RB-07, RB-11). 실패하면 이전 별칭으로 되돌린다. 모델 버전은 임베딩 응답과 BE 지표에 노출한다.

### 11.2 Modal과 외부 호출

**분리와 배포**

- 한 워크스페이스에 Modal Environment `fit-test`·`fit-dev`·`fit-prod`를 두고 앱 이름은 환경과 상관없이 같게 둔다(예: `fit-embed`). 앱·Secret·웹 URL이 Environment마다 갈린다. FastAPI와 임베딩·리랭커·LLM 엔드포인트가 모두 이 앱들이다.
- `fit-test`는 AI 팀 전용이다. 상시 배포하지 않고 `modal serve --env fit-test`로 필요할 때만 띄운다. 모델 교체는 fit-test에서 대조한 뒤 같은 커밋을 fit-dev, fit-prod 순서로 `modal deploy --env <env>`한다.
- 프록시 토큰은 dev용과 prod용을 따로 만든다. RBAC가 없는 워크스페이스는 토큰이 Environment에 묶이지 않아 dev 토큰으로 prod도 부를 수 있다 (확인: Modal 문서는 RBAC 워크스페이스에서만 Environment 단위라고 한다). prod 토큰을 B의 `prod.env`에만 두는 것은 prod 토큰이 새는 것만 막는다. dev 토큰이 새면 prod 엔드포인트도 부를 수 있고, 이 위험은 Starter 플랜에서 받아들인다. 막으려면 RBAC(Team 플랜)나 prod 전용 워크스페이스가 필요하다(아래 5).
- 호출 URL과 토큰은 BE의 서버 env에만 둔다.
- 배포는 AI 팀이 `modal deploy`로 한다. 안정되면 deploy 러너 잡으로 옮길 수 있다(P2).

**호출 방어**

- 모든 외부 호출(Modal, GMS, Apify)에 타임아웃, 재시도 1회, 서킷 브레이커, 동시성 상한, 일일 호출 예산(Redis 카운터), `*_ENABLED` 킬스위치를 둔다.

**폴백**

- 리랭커는 임베딩 점수 순위로, LLM 요청 해석은 규칙 기반으로 대체한다.
- 임베딩 호출이 실패하면(Modal 장애, 타임아웃, 예산 소진, 킬스위치) 임베딩 없이 키워드 검색(OpenSearch nori)으로 대체하고 리랭커는 건너뛴다.
- 폴백은 사용자가 못 느끼는 실패라 `*_fallback_ratio` 알림이 필수다(A603 교훈).

**단일 의존점**

- Modal은 AI의 단일 의존점이다(FastAPI, 임베딩, 리랭커, 소형 LLM 모두). 장애, 콜드 스타트, 지출 한도 소진이면 검색 품질이 떨어진다.
- 첫 호출(콜드 스타트) 타임아웃을 따로 두고, 상시 가동할 컨테이너 수는 AI 팀이 비용 상한과 함께 정한다 (미확인).
- 새벽 배치(문서 임베딩)는 폴백 없이 재시도하고 지연을 허용한다.

**남용·비용 방어**

전역 일일 예산만 두면 한 사용자가 예산을 소진시켜 모든 사용자를 키워드 폴백으로 떨어뜨릴 수 있다. 그래서 아래를 함께 건다.

1. Modal 엔드포인트는 전부 `requires_proxy_auth=True`로 두고 BE가 `Modal-Key`·`Modal-Secret` 헤더로 호출한다 (확인: Modal 문서. 거부된 요청이 컨테이너를 띄우는지는 미확인).
2. Modal을 부르는 API에는 BE가 사용자별·IP별 분당·일일 상한을 건다(BE 계약 #18).
3. 질의 길이 상한(예: 200자)을 둔다.
4. 비로그인 검색을 허용한다면 IP당 일일 횟수로 묶는다(16절 #22).
5. dev와 prod는 Modal Environment와 토큰을 나눈다. 지출 한도를 Environment별로 걸 수 있는지는 미확인이다. 워크스페이스 단위라면 test·dev 과금이 prod 몫을 먹으므로, 문제가 되면 prod만 별도 워크스페이스로 옮긴다.

**지출 한도와 개인정보**

- Modal 워크스페이스의 지출 한도와 알림은 Modal 대시보드에서 설정한다(런북 점검 항목). BE의 일일 호출 예산은 이와 별개로 건다.
- 요청 텍스트, 취향 맥락, 리뷰 텍스트(문서 임베딩)가 GMS와 Modal로 나가므로 처리방침의 외부 전송 항목과 포팅 매뉴얼의 '외부 서비스 정보'에 적는다.

### 11.3 외부 서비스 목록

| 서비스 | 용도 | 비밀 위치 | 장애 시 |
|---|---|---|---|
| GMS (SSAFY LLM API) | 요청 해석, aspect·페르소나 생성 | `/etc/fit/<env>.env` | 규칙 기반 해석으로 폴백, 배치는 재시도 |
| Modal | FastAPI, 임베딩, 리랭커, 소형 LLM 추론 | `/etc/fit/<env>.env`(URL·토큰) | 임베딩은 키워드 검색으로, 리랭커는 건너뛰고, 배치는 재시도 |
| Apify | 리뷰 수집(지역 추가) | `/etc/fit/<env>.env` | 비용 상한 도달 시 중단, 승인 후 재개 |
| Firebase | FCM 웹 푸시(VAPID 직접 구현으로 대체 가능, 16절) | `/etc/fit/<env>.env`(서비스 계정 또는 VAPID 개인키) | 푸시 지연 허용 |
| PostHog Cloud | 행동 분석(웹 SDK) | 프런트 `config.json`의 공개 키 | 분석 손실만 |
| Mattermost | 알림 웹훅 | `/etc/fit/obs.env`, `/etc/fit/ops.env` | 알림 채널 중단, 일일 digest로 보완 |
| GitLab | 코드, 러너 | 러너 토큰(호스트) | 서버에서 수동 배포 |

## 12. 서비스 계약

BE·AI·프런트 팀과 M1 전에 합의한다. 합의되면 `docs/infra/contracts/`로 분리한다. 환경변수 계약은 [contracts/env.md](contracts/env.md)에 있고 합의 상태는 [contracts/README.md](contracts/README.md)에 적는다. AI는 Modal에서 도는 서비스라 AI 계약은 BE가 Modal을 호출하는 규약이다(12.2·12.3절).

### 12.1 BE (Spring Boot, Java 21)

이행 상태와 인프라가 확인하는 방법은 [계획 1C-3의 계약 이행 체크리스트](plans/2026-10-23-plan-1c3-ci-pipeline.md)에 있다. 배포 스위치(6.3절)는 이 표가 이행된 뒤에 켠다.

| # | 항목 | 요구 | 이유 |
|---|---|---|---|
| 1 | 관리 포트 | `management.server.port=8081`. `/actuator/health/readiness`(DB에만 의존), `/actuator/health/liveness`, `/actuator/prometheus`. 공개 경로로 프록시하지 않는다 | readiness가 외부 의존 장애에 흔들리면 재시작 폭풍(A503 교훈) |
| 2 | 공개 헬스 | `GET /healthz`: 상태만 반환, 내부 정보 없음 | 외부 감시용 |
| 3 | 버전 | `GET /api/v1/version` → `{sha, builtAt}` (또는 `X-App-Version` 헤더) | 배포 스모크와 롤백 판정 |
| 4 | 종료 | `server.shutdown=graceful`, `spring.lifecycle.timeout-per-shutdown-phase=30s` | 전환 시 요청 유실 방지 |
| 5 | 로그 | JSON 한 줄을 stdout으로. 토큰·개인정보 마스킹 | |
| 6 | 시간대 | `TZ=Asia/Seoul`, DB는 `timestamptz`(UTC 저장) | 새벽 4시 KST 배치 |
| 7 | 프록시 헤더 | `server.forward-headers-strategy=native` (또는 framework) | 5절 |
| 8 | 부팅 시 env 검증 | 필수값 누락, mock 기본값, 약한 기본값이면 기동 거부. `APP_ENV`와 DB 이름·Redis 호스트·OpenSearch 인덱스 접두사가 어긋나도 거부 | A503의 `GPU_ADAPTER=mock` 기본값 사고. dev가 prod 인덱스를 쓰지 못하게(2.3절) |
| 9 | 마이그레이션 | Flyway, 적용된 파일 수정 금지, expand/contract, `migrate` 프로필(웹 서버 없이 마이그레이션 후 종료). 웹 프로필은 `spring.flyway.enabled=false` | 6.5절. 웹은 DML 전용 role이라 부팅 때 Flyway가 실패한다 |
| 10 | 메모리·풀 | JVM `-XX:InitialRAMPercentage=25 -XX:MaxRAMPercentage=60 -XX:MaxMetaspaceSize=192m -XX:+UseSerialGC`. 힙을 컨테이너 한도에 비례시킨다(prod 1.5GB는 힙 약 900MB, dev 1.0GB는 약 600MB, 측정 후 조정). Hikari 풀 prod 10 / dev 5 / batch 5 | 4.1절 예산. 고정 `-Xmx`는 메타스페이스·스레드 스택·코드 캐시가 더해져 한도를 넘는다 |
| 11 | 지표 | `batch_last_success_timestamp_seconds`(gauge, 시작부터 존재), 외부 호출별 `*_calls_total`, `*_fallback_total`, 지연 히스토그램(버킷 범위 제한) | 9절 알림 |
| 12 | 외부 호출 | 11.2절의 방어 일체. Modal 호출은 첫 호출(콜드 스타트) 타임아웃을 따로 둔다 | |
| 13 | 테스트 | 최신 Testcontainers(Docker 29 호환). Gradle `-Xmx768m`, 테스트 포크 768MB. OpenSearch 컨테이너 테스트 금지(모킹 사용). Testcontainers가 쓰는 이미지는 arm64 변형이 있어야 한다. 잡이 컨테이너 안에서 돌아 형제 컨테이너(DB, Ryuk)의 게시 포트에 호스트 게이트웨이로 닿으므로 B의 ufw에 `docker0` 규칙이 한 줄 있다(3절 호스트 표). 이 규칙 외에 잡에 줄 설정은 없다 | B에서 실행(4.2절) |
| 14 | Redis | 멱등성 키 등은 noeviction 전제, requirepass | 7.3절 |
| 15 | SSE | `text/event-stream`, `Last-Event-ID` 재연결 처리. 배포 전환 때 연결이 끊긴다 | 5절 |
| 16 | API 하위호환 | 직전 배포의 FE 번들(서비스 워커 캐시, 열려 있는 탭)이 호출해도 동작해야 한다(한 버전). 필드 삭제·의미 변경은 expand/contract | 6.8절 버전 스큐 |
| 17 | 폴백 표시 | 폴백으로 처리한 응답에는 `X-Fallback`(사유 목록) 헤더를 붙인다 | smoke가 Modal 연동 누락을 폴백에 가려진 채 통과시키지 않게(A603 교훈), 6.3절 |
| 18 | 속도 제한 | Modal을 부르는 API(검색, 요청 해석 등)에 사용자별·IP별 분당·일일 상한(Redis)과 질의 길이 상한을 건다. 초과는 429, 전역 일일 예산 소진은 키워드 폴백 | 비용 남용 방어, 11.2절 |
| 19 | 배치 | 배치는 한 번에 하나만 돈다(ShedLock 등). Blue/Green 겹침 구간에 두 색에서 동시에 돌지 않게 한다. dev는 `BATCH_ENABLED=false`가 기본이다 | Modal 비용 이중 발생 방지, 10.7절 |
| 20 | Dockerfile | CI가 만든 jar를 `COPY`만 한다(멀티스테이지 빌드 금지). 베이스 이미지는 핀한다 | A의 CPU 크레딧 절약, 6.3절 |
| 21 | 쿠키 | 쿠키에 `Domain` 속성을 주지 않는다(호스트 전용). 인증 쿠키는 HttpOnly·Secure다 | prod와 dev가 호스트로 나뉘어 쿠키가 격리된다(5.4절) |

### 12.2 AI (FastAPI, Modal)

AI 팀과 M1 전에 합의한다. FastAPI는 Modal에서 돌고 A·B에는 AI 컨테이너가 없다. BE가 Modal 엔드포인트를 HTTPS로 호출한다.

1. Modal Environment(`fit-dev`, `fit-prod`)와 토큰을 분리한다(11.2절). URL과 토큰은 BE의 서버 env(`/etc/fit/<env>.env`)에 둔다. 토큰은 코드와 repo에 두지 않는다. 엔드포인트는 모두 `requires_proxy_auth=True`로 보호하고 BE가 `Modal-Key`·`Modal-Secret` 헤더로 호출한다(11.2절).
2. 엔드포인트는 임베딩(12.3절), 리랭커, 요청 해석(LLM)이다. 요청·응답 스키마, 오류 코드, 최대 입력 길이와 배치 크기 상한을 AI 팀이 명세하고, 응답에 모델 버전을 싣는다.
3. 콜드 스타트: 첫 호출 지연의 상한과 상시 가동할 컨테이너 수를 AI 팀이 비용 상한과 함께 정한다. BE 타임아웃은 이 값에 맞춘다(11.2절).
4. 서버 쪽 방어도 둔다: 동시성 상한과 요청당 비용 상한. BE의 일일 호출 예산과 별개다.
5. 로그는 JSON이고 비밀·개인정보를 마스킹한다. 요청 텍스트를 그대로 남기지 않는다.
6. 테스트와 배포(`modal deploy`)는 AI 팀이 맡는다. 인프라 CI는 `ai/`를 다루지 않는다(6.3절).
7. 임베딩 모델을 바꾸면 벡터 공간이 달라지므로 새 인덱스 재색인과 별칭 전환이 필요하다(RB-11). 모델 버전은 응답과 BE 지표에 노출한다.

### 12.3 임베딩 엔드포인트 (Modal)

- `POST /embed` `{"texts": [...], "kind": "query|passage"}` → `{"model": "<이름>@<버전>", "dim": <모델별>, "vectors": [...]}`, 응답 헤더 `X-Model-Version`.
- 상한: 요청당 텍스트 1~64개, 텍스트마다 2000자 이하. BE는 이를 넘지 않게 나눠 보낸다. 구현은 `ai/server/embed.py`다.
- 모델은 `dragonkue/snowflake-arctic-embed-l-v2.0-ko`(568M, 차원 1024)이고 리비전을 고정한다. 벡터는 단위 길이이고 소수 6자리로 반올림된다 (확인: fit-dev 응답이 로컬 `fit_ai.embedding`과 원소 차이 1e-6 이내).
- 응답 코드: 200 성공. 401 `Modal-Key`·`Modal-Secret` 누락·불일치(Modal 프록시가 거부한다). 422 상한·`kind` 위반이고 본문에는 위치와 사유만 있고 받은 텍스트는 없다. 303 처리가 150초를 넘으면 Modal이 결과 URL로 돌려보낸다(콜드 스타트 중 GPU 배정 대기로 실제로 났다). BE는 303과 5xx를 실패로 보고 폴백한다.
- 콜드 스타트는 17~85초를 쟀다(fit-dev·fit-test). 연결을 재사용하면 질의 1건이 한국에서 약 250~400ms이고 대부분 미국 동부 왕복이다. BE는 연결 풀을 쓴다.
- 질의(`query`)는 검색마다 호출돼 지연이 사용자에게 직접 보인다. 문서(`passage`)는 새벽 배치에서 대량으로 호출돼 비용과 직결되므로 배치 크기와 일일 예산을 정한다.

### 12.4 공통 환경변수

- `KEY=VALUE`만 쓴다. 공백·따옴표·CRLF·`#`을 금지한다.
- 필수·선택을 구분한 목록은 [contracts/env.md](contracts/env.md)에 있고 `check_env_contract.py`가 예제 파일과 맞춰 본다.
- 파일 소비자가 셋(compose 보간, 서비스 `env_file:`, 마이그레이션 일회성 컨테이너)이라 가장 보수적인 형식을 쓴다.
- compose `env_file`은 컨테이너 생성 시점에 굳으므로 파일만 고치면 반영되지 않고 재생성이 필요하다.
- `$`를 쓰는 값(bcrypt 해시 등)은 base64로 인코딩해 둔다(13.2절).

### 12.5 프런트(Next.js SSR)

프런트 팀과 M1 전에 합의한다. 합의되면 `docs/infra/contracts/`로 분리한다. 이행 상태와 확인 방법은 [계획 1C-3의 계약 이행 체크리스트](plans/2026-10-23-plan-1c3-ci-pipeline.md)에 있다(`fe:bundle-check`가 번들로 확인한다).

| # | 항목 | 요구 | 이유 |
|---|---|---|---|
| 1 | 빌드 | `fe/`가 잠금 파일 기준 설치(`pnpm install --frozen-lockfile`, 패키지 매니저는 `package.json`의 `packageManager` 필드)와 `pnpm build`로 `output: 'standalone'` 번들을 만든다. `generateBuildId`와 `deploymentId`는 커밋 SHA(`DEPLOYMENT_VERSION`)다 | 번들을 컨테이너에 `COPY`만 한다(6.8절). 버전 스큐를 Next가 감지한다 |
| 2 | 같은 출처 | 브라우저는 API를 `/api`, 사진을 `/fit-<env>-photos/` 상대 경로로 호출한다. 서버 쪽 호출(서버 컴포넌트, 라우트 핸들러)은 `BE_INTERNAL_URL`을 쓴다. 호스트·포트를 번들에 박지 않는다. 로컬 개발은 프록시나 `BE_INTERNAL_URL`로 로컬 BE에 붙는다 | CORS가 필요 없다(5절). 활성 색 전환을 FE가 모른다 |
| 3 | 환경 값 | 환경별 값은 번들에 넣지 않고 런타임 env(`/etc/fit/fe-<env>.env`)로 받는다. `NEXT_PUBLIC_*`에 환경별 값을 두지 않는다(빌드 때 번들에 박힌다). 브라우저가 쓸 공개 값은 `/config.json`(동적 라우트)이 env에서 읽어 돌려주며 키 목록은 `contracts/env.md`에 둔다. 빌드 메모리는 1.5GB 이내(예: `NODE_OPTIONS=--max-old-space-size=1536`) | 이미지 하나로 dev 검증을 prod에 그대로 쓴다(6.8절). 빌드타임 설정 누락(A503) 방지, B의 CI 메모리 한도(4.2절) |
| 4 | 서비스 워커 | 루트 `/sw.js`와 `/manifest.webmanifest`는 `public/`에 둔다. `/api/*`, 사진 경로, `/config.json`은 캐시하지 않는다(네트워크 전용). 새 서비스 워커의 활성화 정책은 프런트 팀이 정하되 API 한 버전 하위호환(BE #16)을 전제로 한다 | 5절 캐시 정책, 6.8절 버전 스큐 |
| 5 | 정적 자산 | 정적 자산은 Next가 만드는 해시 붙은 `/_next/static/*`를 쓴다. 다른 경로에 불변 자산을 두려면 미리 알린다 | Caddy가 `/_next/static`만 누적 풀에서 `immutable`로 서빙한다(5.3절) |
| 6 | 헬스 | `GET /fe-healthz`는 200과 상태만 반환한다(내부 정보 없음). 의존성(BE 등) 상태를 보지 않는다 | idle 색 스모크와 컨테이너 healthcheck. BE 장애 때 FE가 재시작 폭풍에 빠지지 않게 한다 |
| 7 | 이미지 | 이미지 최적화 기본 로더를 쓰지 않는다(`images.unoptimized: true` 또는 커스텀 로더). 사진은 Garage URL을 쓴다 | B(Arm) 번들을 A(x86)에서 돌리는데 `sharp`가 플랫폼 전용이다(6.8절) |
| 8 | dev 게이트 | dev는 `/?k=`로 첫 접속해 쿠키를 받는다(2주 유지). manifest와 아이콘은 게이트 밖이다 | 5.4절 |
| 9 | 쿠키 | 쿠키에 `Domain` 속성을 주지 않는다(호스트 전용). 인증 쿠키는 HttpOnly·Secure다 | prod와 dev가 호스트로 나뉘어 쿠키가 격리된다. localStorage와 서비스 워커도 출처별로 분리된다 |
| 10 | SSE | 브라우저 `EventSource`는 `Authorization` 헤더를 붙일 수 없다. fetch 기반 스트림 등으로 구현하고 `Last-Event-ID` 재연결을 직접 처리한다 | BE #15, 배포 전환 시 연결이 끊긴다 |
| 11 | 푸시 | 방식(FCM 웹 푸시 또는 VAPID)은 프런트·BE 팀이 정하고 키는 서버 env에 둔다 | 11.3절, 16절 |
| 12 | 공유 | 장소 공유는 외부 지도(네이버) 링크를 Web Share API(`navigator.share`)로 보내고, 미지원 환경은 클립보드 복사로 대체한다. Fit Dining URL 자체를 공유해야 하면 FE가 OG 메타를 렌더링한다. 장소 ID 확보는 16절 #19 | SSR이라 별도 공유 페이지가 필요 없다 |
| 13 | 런타임 | 로그는 JSON 한 줄을 stdout으로 내고 토큰·개인정보를 마스킹한다. SIGTERM을 받으면 진행 중 요청을 끝내고 내려간다. 쓰기는 `.next/cache`뿐이며 운영이 tmpfs로 준다 | 4.1절, 6.8절. 읽기 전용 루트 |
| 14 | 이미지 | `WORKDIR /app`, `server.js`와 `.next/static`이 `/app` 아래에 있고 컨테이너 안에 `node`가 있다 | 배포가 `docker cp`로 정적 자산을 풀에 쌓고(6.4절) compose healthcheck가 `node`로 `/fe-healthz`를 부른다. 읽기 전용 루트에서 쓰기는 `/app/.next/cache`(tmpfs)와 `/tmp`뿐이다 |

## 13. 보안 요약

### 13.1 포트

| 호스트 | 포트 | 바인딩 | 용도 |
|---|---|---|---|
| A | 22 | 0.0.0.0 (ufw limit) | SSH |
| A | 80 | 0.0.0.0 | ACME, 301 |
| A | 443 | 0.0.0.0 | prod·dev(호스트로 구분) |
| A | 3000, 8888, 9090, 5432 | 127.0.0.1 | Grafana, Dozzle, Prometheus, Postgres(dev role 터널) |
| B | 22 | 0.0.0.0 (ufw limit) | SSH |
| B | 9090, 9093 | 127.0.0.1 | Prometheus-B, Alertmanager-B(터널) |

그 외에는 호스트 바인딩이 없다. CI의 포트 규칙 검사와 B의 포트 노출 감사가 이 표를 지킨다.

### 13.2 시크릿

| 파일 | 호스트 | 권한 | 내용 |
|---|---|---|---|
| `/etc/fit/prod.env`, `dev.env` | A | root:docker 0640 | 앱 env(Modal URL·토큰 포함) |
| `/etc/fit/fe-prod.env`, `fe-dev.env` | A | root:docker 0640 | FE env(비밀 없음. 내부 BE 주소, 브라우저에 공개되는 키) |
| `/etc/fit/migrate-prod.env`, `migrate-dev.env` | A | root:docker 0640 | 마이그레이션 일회성 컨테이너의 DDL 자격(웹 컨테이너에는 넣지 않는다) |
| `/etc/fit/data.env` | A | root:docker 0640 | DB·Redis·Garage 자격 |
| `/etc/fit/edge.env` | A | root:docker 0640 | `ACME_EMAIL`, `ACME_MODE`, `HSTS_MODE`, `PROD_HOST`, `DEV_HOST`, B의 IP, `/_ops` basic auth 사용자와 해시, dev 게이트 키(`?k=` 쿠키 발급용) |
| `/etc/fit/obs.env` | A | root:docker 0640 | Grafana admin, Mattermost 웹훅(main·dev), B의 IP, `fit_monitor` 비밀번호 |
| `/etc/fit/backup.env` | A, B | root:docker 0640 | 백업 설정(B의 주소와 SSH 포트, 보관 기간). 비밀은 없다 |
| `/etc/fit/keys/` | A | root:root 0700(파일 0600) | vault SSH 개인키(`vault_ed25519`), B의 호스트 키(`vault_known_hosts`), age 수신자 공개키(`age-recipients.txt`) |
| `/etc/fit/ops.env` | B | root:root 0600 | A의 호스트(`PROD_HOST`, `DEV_HOST`), Mattermost 웹훅, A의 `/_ops` 자격(사용자와 평문 비밀번호) |
| age 개인키 | 서버 없음 | 수신자 2명이 오프라인 보관 | 백업 복호화 |

- `/_ops` basic auth 해시는 `caddy hash-password` 출력을 base64로 인코딩해 둔다. 원본의 `$`가 env 형식 규칙에 걸리고, Caddy는 base64 형태도 받는다 (확인).
- 앱 시크릿은 서버에만 두고 GitLab 변수에는 넣지 않는다. repo에는 `*.env.example`만 둔다.
- gitleaks를 CI와 pre-commit에 둔다. pre-commit은 팀의 lefthook(저장소 루트 `CONTRIBUTING.md`)이 `lefthook.yml`에서 `infra/ci/pre-commit-secrets.sh`를 불러 검사하고, `npm install`로 켠다. CI의 `lint:secrets`가 MR 이력까지 다시 본다.
- 실제 값은 로그·문서·채팅에 출력하지 않는다.

### 13.3 SSH 매트릭스

| 출발 | 도착 | 계정 | 허용 |
|---|---|---|---|
| 인프라 담당 | A, B | 개인 계정 | sudo |
| 팀원 | A | `fit-dev` | 터널만(3000, 8888, 5432), 셸 없음 |
| A (root timer) | B | `vault` | `rrsync -wo -no-del /srv/vault/incoming` |
| B | A | 없음 | HTTPS 프로브만(`/healthz`, `/_ops/*`) |

키 자체는 repo에 두지 않는다. 배포 러너 사용자(`gitlab-runner`)는 `/etc/fit/keys/`를 읽지 못한다(root 0700, systemd timer만 사용).

### 13.4 한계

- docker 그룹은 사실상 root라서, 배포 러너 사용자가 키를 못 읽는다는 것은 우발적 노출을 막는 수준이고 악의적인 CI 코드까지 막지는 못한다. 이를 막는 것은 protected 브랜치와 MR 리뷰다.
- B의 verify 러너는 docker.sock으로 B의 root 권한을 가지므로 `ops.env`(웹훅, `/_ops` 자격)를 읽을 수 있다. A에 대한 SSH 키는 B에 없다. 그러나 같은 권한으로 `/srv/vault/store`(금고)를 지울 수도 있다. A에 로컬 사본(48시간 + 14일)이 남고 복원 리허설 때 내려받은 최신 덤프 1벌을 노트북에 둔다(8절). MR 파이프라인에서 임의 코드가 돌 수 있으므로 프로젝트 멤버를 팀원으로 한정하고 MR 리뷰 후 병합한다.
- Modal 토큰이 유출되면 지출이 생긴다. 토큰은 환경별로 분리해 서버 env에만 두고, Modal의 지출 한도와 BE의 일일 호출 예산이 상한이다(11.2절).
- OpenSearch는 보안 플러그인을 끈다. 내부 망이고 호스트 게시가 없다는 전제이며, 앱 컨테이너가 침해되면 인덱스가 변조될 수 있다. DB 자격 침해와 같은 수준의 위험으로 보고 수용한다. 두 환경의 BE가 `net-data`를 공유해 be-dev가 prod 인덱스를 읽고 쓸 수 있다. 기동 시 접두사 대조(12.1 #8)는 사고를 막지만 악의는 막지 못한다.
- Dozzle(로그 UI)은 `docker.sock`을 읽기 전용으로 마운트한다. 읽기 전용이어도 소켓의 API는 컨테이너 설정(환경변수 포함)을 읽을 수 있어서 Dozzle이 침해되면 비밀이 노출될 수 있다. `127.0.0.1:8888`에만 게시하고 SSH 터널로만 연다. 팀원 터널 허용 목록(13.3절)에 8888이 들어 있어 팀원은 prod를 포함한 모든 컨테이너의 로그를 볼 수 있으므로, 로그에 개인정보와 비밀을 남기지 않는 것(12절)이 전제다. cAdvisor도 호스트의 `/`, `/sys`, `/var/lib/docker`를 읽기 전용으로 마운트한다.
- 개인정보는 로그 마스킹(12절), 백업 암호화(8절), 종료 시 삭제(RB-10), 외부 전송 고지(11.2절)로 다룬다.

## 14. 일정과 우선순위

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 사전 (서버 없이) | `infra/` 골격, compose, Caddyfile, 배포·롤백·백업·복원 스크립트, 알림 규칙 + promtool 테스트, 대시보드, 로컬 dev compose, 런북 초안, `.gitlab-ci.yml`, GitLab 프로젝트 설정(브랜치 보호·병합 규칙, 10.8절) | 로컬 기동, `compose config`, shellcheck, promtool test, `caddy validate` 통과. 로컬에서 Blue/Green 전환 시뮬레이션 |
| M0 수령 +0~1일 | A·B 실측과 bootstrap(ufw·SSH·Docker), A 정적 IP와 B Elastic IP 부착 확인, 가비아 DNS의 A 레코드(`PROD_HOST`, `DEV_HOST`)를 A의 정적 IP로 설정, 호스트 간 연결 실측(A→B SSH, B에서 A의 TCP 22 도달성. B→A HTTPS 프로브는 Caddy가 뜨는 M1에서) | `verify-host.sh` 전부 PASS, 서버 밖에서 열린 포트가 A·B 모두 22뿐(Caddy 전이므로), ufw 허용 규칙 확인, 호스트 간 연결 확인 |
| M1 +2~4일 | Caddy + TLS(운영 인증서는 첫날 발급, staging은 하루 안에), data 스택, 러너 2개(A의 deploy, B의 verify)와 병합 조건 강화(gitlab-setup.md 2단계), dev 첫 배포와 prod 첫 배포(교체형, 같은 SHA. FE 포함), B의 ops 스택(프로브) | `verify-edge.sh`·`verify-data.sh` PASS, 서버 밖에서 A의 80/443 도달(B 프로브 포함), dev·prod `/healthz` 200, dev PWA 로드(쿠키 게이트 통과 시), BE→Modal dev 호출 성공(콜드 스타트 지연 실측) |
| M2 +5~9일 | 파이프라인 완성(Testcontainers, FE 빌드·배치 포함), Blue/Green, 관측성 + B 외부 감시, 백업 → 금고, 포트 노출 감사, 복원 리허설 #1, 개발자 접근 | 배포 E2E(정상·실패 롤백), 알림 테스트 발화, 복원 성공 + RTO 기록 |
| M3 +10~14일(늦어도 11/03) | 리허설 #1(10.3절), 메모리·CPU 튜닝, 경량 부하 시험, 첫 공개 준비(10.7절), 포팅 매뉴얼 초안 | 리허설 체크리스트 전부 통과 |
| M4 ~11/04 | 리허설 #2, 런북 완결, 당번표, 동결 | 동결 후 변경은 핫픽스 절차로만 |
| 운영 11/06~11/18 | 일일 digest, 알림 대응, 핫픽스 배포 | |
| 종료 11/18 | RB-10: 최종 백업, 합성 덤프, 실데이터 삭제 | |

**일정 규칙**

- 수령일을 D라 하면 M3의 끝은 D+14일과 11/03 중 빠른 날이다. 예를 들어 10/22에 받으면 M3가 11/01~11/05가 되어 동결(11/04)과 겹친다.
- prod 첫 배포는 M1에서 한다(1.4절의 "prod를 일찍 띄워 리허설한다").
- 우선순위(P0·P1·P2)는 서버 수령일과 관계없이 지금부터 적용한다. 11/03까지 끝나지 않은 P1은 공개 뒤로 미룬다.

**우선순위**

- **P0 (11/06 필수):** A·B bootstrap과 하드닝(정적 IP·EIP 포함), TLS·엣지(FE 서빙 포함), 롤백 가능한 prod 배포, 백업 → 금고 + 덤프 시점 검증 + 사람 복원 리허설, 메모리 한도와 스왑, B의 외부 감시(프로브, 포트 노출 감사, 감시 체계 감시) + critical 알림, 핵심 런북, 서버 전용 시크릿, 브랜치 보호·병합 설정(10.8절), 배포 순서 보장(`oldest_first`, outdated 배포 보호, 다운그레이드 가드), 외부 호출 계약(Modal 키워드 폴백·예산·속도 제한, 킬스위치), PWA 산출물 검사
- **P1:** Blue/Green(폴백은 헬스 게이트 교체형), 대시보드, daily digest, dev 알림 분리, 개발자 터널, gitleaks·마이그레이션 게이트·arch 검사, Garage(폴백 R2), cAdvisor(컨테이너 메모리·재시작 알림), 경량 부하 시험(k6)
- **P2:** Dozzle, GitLab Package Registry 2차 사본, 디스크 스냅샷(콘솔 필요), `verify-x86`, Modal 배포 잡, 정식 부하 시험(경량 부하 시험은 P1)

## 15. 리스크

| # | 리스크 | 대응 |
|---|---|---|
| 1 | A 메모리(OpenSearch) | 한도, 스왑, OOM 알림. 비상안은 dev 스택 중지. 한도 합계가 약 9.2GB(16GB의 58%)로 여유가 있다 |
| 2 | A CPU 버스트 소진 | dev·CI 상한, "30분 평균 >40%" 알림, 소진 후 동작 실측 |
| 3 | A 단일 장애점 | bootstrap + 금고 복원으로 재구축. RTO는 리허설로 측정 |
| 4 | B의 4GB와 Arm | 테스트 메모리 계약, arm64 이미지·의존성 확인(M1 전), `verify-x86` 폴백 |
| 5 | 러너 등록 불가·비활성 | Jenkins 폴백(선배 팀 자산) |
| 6 | 앱 계약 합의 지연 | 계약을 M1 전에 공유하고, smoke가 헬스·버전 엔드포인트 존재를 검사 |
| 7 | 호스트 간 연결(SSAFY 네트워크) | M0에서 A↔B 연결을 실측 |
| 8 | 외부 호출 비용·장애(Modal, GMS, Apify) | 11.2절 계약, 킬스위치, 폴백, 알림 |
| 9 | 공용 GPU 서버 가용성 | 서비스 경로 밖 |
| 10 | Garage 스파이크 실패 | R2 또는 Firebase Storage로 폴백 |
| 11 | 시크릿 유출 | 서버 전용 시크릿, gitleaks, RB-08 |
| 12 | 종료 후 데이터 잔존 | RB-10 |
| 13 | Modal이 AI의 단일 의존점(장애, 콜드 스타트, 지출, 계정 한도, 재색인 비용) | 11.2절 계약, 키워드 폴백, 지출 한도·일일 예산·킬스위치, 폴백 비율·예산 알림, 문서 벡터를 Postgres에도 저장(7.2절) |
| 14 | 서비스 워커 캐시나 열려 있는 탭의 옛 FE가 새 서버와 어긋남(버전 스큐) | `deploymentId`, API 한 버전 하위호환(BE #16), 이전 릴리스 자산을 누적 풀에 보관(5.3절, 6.8절) |
| 15 | staging 인증서로는 PWA를 테스트할 수 없음 | 운영 CA 인증서를 프런트 테스트 전에 확정(5절). 재발급 한도 때문에 `caddy_data` 보존 |
| 16 | prod·dev 쿠키가 겹침 | 호스트를 나누고 쿠키에 `Domain`을 쓰지 않는다(5.4절, BE #21, 12.5절 #9) |
| 17 | Let's Encrypt 발급 실패나 한도 | 우리 도메인만의 한도라 다른 팀과 나누지 않는다. 운영에서 `acme_ca` 미지정으로 ZeroSSL 폴백 유지, M1 첫날 발급, `caddy_data` 즉시 백업 |
| 18 | 유료 Modal 엔드포인트 남용 | 프록시 인증, 사용자·IP별 속도 제한, 질의 길이 상한, 전역 예산(폴백), 지출 한도(11.2절) |
| 19 | stop/start로 공인 IP 변경, A의 CPU 크레딧 소진(A는 콘솔 없이 확인하지 못한다) | 인스턴스 stop 금지(1.3절). A의 Elastic IP 여부와 크레딧 모드는 확인하지 못했고, 확인한 값과 대체 감시(B의 `FitExternalDown`·`FitVaultStale`, `FitCpuHigh30m`, steal 지표)는 1.2절 CPU 크레딧 실측과 1.3절 공인 IP 실측에 있다. B는 Elastic IP 부착 |
| 20 | MR이 몰려 verify 큐가 길어지고 병합 순서가 꼬임 | fast-forward 직렬 병합, 파이프라인 `timeout`, 작은 MR 우선(10.8절) |
| 21 | 옛 SHA가 나중에 배포됨 | `oldest_first`, outdated 배포 보호, `deploy.sh` 다운그레이드 가드(6.2·6.4절) |
| 22 | `develop`의 미완성 코드가 prod로 승격됨 | `develop`은 항상 배포 가능, 미완성은 `*_ENABLED` 스위치 뒤(10.8절) |
| 23 | FE(Node) 장애나 메모리 초과가 곧 사이트 전체 장애 | FE도 Blue/Green, `/fe-healthz` 헬스게이트와 `/`의 외부 감시(9.2절), 메모리 한도와 힙 상한, 롤백 절차는 BE와 같다 |
| 24 | B(Arm)에서 만든 FE 번들을 A(x86)에서 돌림. 네이티브 모듈(`sharp`)이 플랫폼에 묶임 | 이미지 최적화 기본 로더를 쓰지 않는다(`unoptimized`). `fe:build` 산출물 검사가 이를 확인하고 idle 색 스모크가 A에서 실제로 띄워 본다(6.8절) |

## 16. 미결정·확인 필요

| # | 항목 | 담당 | 해소 시점 |
|---|---|---|---|
| 1 | A·B 실제 스펙(RAM, vCPU, 디스크, 스왑, OS, Docker 버전, 아키텍처, CPU 소진 후 동작) | 인프라 | M0 |
| 2 | 서버 수령일 | 인프라 | 즉시 확인 |
| 3 | 가비아 도메인의 호스트 구성(`PROD_HOST`, `DEV_HOST`)과 DNS 설정 시점, B의 공인 IP | 인프라 | M0 |
| 4 | EC2 보안 그룹(클라우드 방화벽)과 디스크 스냅샷 권한. 콘솔 계정이 없다(확인) | 인프라 | M0 |
| 5 | GitLab Package Registry 사용 가능 여부. Create project runner 메뉴는 보인다 (확인) | 인프라, 팀장 | 사전~M0 |
| 6 | A↔B SSH 연결성 | 인프라 | M0 |
| 7 | AI 팀 합의: Modal 엔드포인트 계약(12.2·12.3절), 콜드 스타트와 상시 가동 컨테이너 수·비용 상한, 키워드 폴백, 외부 호출 계약 | AI 팀, 인프라 | M1 전 |
| 8 | BE 팀 합의: 12.1절 계약 항목(폴백 표시 포함), 검색의 키워드 폴백 경로, Modal 호출 규약 | BE 팀, 인프라 | M1 전 |
| 9 | 모노레포 구조와 브랜치 모델 가정 확인 | 팀 | M1 전 |
| 10 | Mattermost 웹훅·채널 | 인프라, 팀장 | M1 |
| 11 | age 수신자 2명 지정과 키 보관 | 인프라, 지정자 | 첫 백업 전 |
| 12 | 당번표(11/06~11/18)와 점검 창 | 팀 | M4 |
| 13 | Garage 스파이크 결과 | 인프라 | M1~M2 |
| 14 | 푸시 방식(FCM 웹 푸시 vs VAPID 직접 구현) | 프런트 팀 | M2 |
| 15 | 서버의 Docker 버전에서 cAdvisor·Dozzle 호환. 로컬 Docker 29.7.2에서는 확인했다(`infra/obs/test/test-obs.sh`: cAdvisor가 컨테이너 이름과 메모리 한도를 내고 Dozzle이 뜬다) | 인프라 | M0(서버에서 `verify-obs.sh`) |
| 16 | 포팅 매뉴얼 필요 여부와 양식 | 팀, 코치 | M3 전 |
| 17 | buildx 자원 상한 방법. `rrsync`는 24.04에서 확인했고(8절) 22.04는 서버에서 확인한다 | 인프라 | M0~M1 |
| 18 | 프런트 팀 합의: 12.5절 계약(standalone 빌드, 같은 출처, 환경 값, 헬스, 이미지, 서비스 워커, dev 게이트, 쿠키, SSE, 공유) | 프런트 팀, 인프라 | M1 전 |
| 19 | 가게 데이터에 네이버 장소 ID(또는 URL)가 포함되는지. 없으면 상호·주소 검색 링크로 대체(정확도 낮음) | BE·AI 팀 | M1 전 |
| 20 | Modal 워크스페이스 접근 권한, 지출 한도·알림 설정 담당, 콜드 스타트·상시 가동 정책과 비용 상한 | AI 팀, 인프라 | M1 전 |
| 21 | 문서 벡터를 Postgres(pgvector)에도 저장하는지(재색인 시 Modal 호출 회피) | BE·AI 팀 | M1 전 |
| 22 | 검색·요청 해석 API를 비로그인으로 허용하는지(허용하면 IP당 일일 횟수 제한) | BE·AI 팀 | M1 전 |
| 23 | 예상 규모(동시 사용자, 피크 RPS, 문서·벡터 수, 사진). 4.4절 자리표시자 확정 | 팀 | M1 전 |
| 24 | prod 첫 데이터 적재·임베딩 백필의 담당·일정, 소요 시간과 비용 추정 | BE·AI 팀 | M1 전 |
| 25 | `process_mode` 변경에 쓸 API 토큰 권한(Maintainer 이상). 승인 규칙·CODEOWNERS 강제는 CE에서 쓸 수 없다(확인). `api` 범위 토큰으로 `dev` 그룹 변경은 성공했고 필요한 최소 권한은 확인하지 못했다(2026-10-26) | 인프라, 팀장 | 사전~M0 |
| 26 | SSR이 필요한 구체적인 이유(SEO, 서버 컴포넌트 데이터 페칭, 서버 쪽 세션 등)와 사진 리사이즈 방식 | 프런트 팀 | M1 전 |
| 27 | `cacheComponents`·`partialPrefetching`을 쓸 때의 캐시 저장소. 기본은 컨테이너 안 tmpfs이고 FE가 한 벌씩이라 충분하다 | 프런트 팀 | M2 |

## 17. 산출물

```
infra/
  host/        bootstrap.sh, verify-host.sh, networks.sh, docker-prune.sh, README.md, conf/(sshd, sysctl, daemon.json, fail2ban, apt, systemd units), test/(test-host.sh, run-in-container.sh)
  edge/        compose.edge.yml, conf/(Caddyfile, acme/, hsts/), state-sample/, edge.env.example, edgectl.sh, verify-edge.sh, README.md, test/(compose.test.yml, test-edge.sh, 목 BE·FE, `/_ops` 시험용 감시 체계 대역과 프로브)
  data/        compose.data.yml, data.env.example, lib.sh, init-data.sh, ensure-databases.sh, init-garage.sh, verify-data.sh, s3tool.py, garage/garage.toml, README.md, test/(test-data.sh, compose.test.yml). OpenSearch는 local/opensearch/Dockerfile을 빌드한다
  app/         compose.app.yml(프로필 prod·dev), *.env.example
  obs/         compose.obs.yml, obs.env.example, render.py(obs-init), prometheus/(prometheus.yml, rules, tests), alertmanager/(alertmanager.yml, templates, routes.txt), grafana/(provisioning, dashboards), blackbox/, daily-digest.py, install.sh, verify-obs.sh, conf/systemd/, README.md, test/(test-obs.sh, compose.test.yml, 가짜 대상)
  ops/         (B) compose.ops.yml, ops.env.example, render.py(ops-init), prometheus/(prometheus.yml, rules, tests), alertmanager/, blackbox/, port-audit.py, install.sh, ops-up.sh, verify-ops.sh, conf/systemd/, README.md, test/(test-ops.sh, compose.test.yml)
  deploy/      deploy.sh, rollback.sh, preflight.sh, smoke.sh, notify.sh, fit-up.sh, lib.sh, README.md, test/(test-deploy.sh, 목 BE·FE 이미지)
  backup/      lib.sh, pg-backup.sh, verify-dump.sh, files-backup.sh(photos, caddy), push-vault.sh, backup-run.sh, vault-ingest.sh(B), vault-authorize.sh(B), restore-check.sh(노트북용), install.sh, backup.env.example, conf/systemd/, README.md, test/(test-backup.sh, node/Dockerfile)
  ci/          ports_invariant.py, check_compose_projects.py, check_env_files.py, check_env_contract.py, check_eol.py, check_linear_history.py, no-merge-commit.sh, check-caddy.sh, check-prometheus.sh, check-alertmanager.sh, check_alerts.py, migration_immutability.py, images_arch.py, run-local-checks.sh, tool-images.sh, compose-projects.txt, tests/
  local/       compose.yml (profile: core, search), fit-local.sh, local.env.example, garage/, opensearch/Dockerfile, README.md
.gitlab-ci.yml
docs/infra/
  design.md    이 문서
  runbooks/    RB-01 ~ RB-13
  porting/     포팅 매뉴얼 초안(버전, 환경변수, 외부 서비스, DB 덤프, 시연)
  contracts/   README.md(합의 상태), env.md, metrics.md. BE·AI(Modal 호출)·프런트 계약은 합의되면 이 폴더로 옮긴다
  ssh-matrix.md
  gitlab-setup.md  GitLab 프로젝트 설정·러너 등록 체크리스트
```

## 부록 A. 선배 팀 교훈과 이 설계의 대응

| 교훈 (출처) | 설계 대응 |
|---|---|
| 포트 짧은 문법=0.0.0.0, ufw 우회로 Loki·Tempo·OTLP 노출 (A603) | 13.1절 포트 규칙, CI 검사, B의 포트 노출 감사 |
| ufw DROP을 클라우드 방화벽으로 오진해 TLS가 하루 지연 (A503) | 1.3절 확인 순서, RB-01 |
| 단일 파일 bind-mount가 디렉터리로 생성, 디렉터리 교체로 inode 고정 (A603) | 설정은 디렉터리 마운트, Postgres는 `command:` 플래그, 변경 시에만 restart |
| `env_file` 없이 키별 전달해 누락 6회 이상 (A603) | 12.4절 env 계약, 부팅 시 검증(12.1 #8), 배포 preflight |
| 기본값이 mock이라 운영에 mock 기동 (A503) | 12.1 #8 |
| Flyway 체크섬 불일치로 배포 롤백 2연속 (A603) | 6.5절 CI 게이트 |
| 빌드타임 설정 누락으로 빈 번들 6회 (A503 FE) | 번들에 환경 값을 넣지 않고 `/config.json`으로 받음 + `fe:build` 산출물 검사와 smoke의 config 키 확인(P0) |
| 서비스명 별칭이 공유 망에서 환경 간 해석 (A603) | 2.2절 이름 규칙 |
| Blue/Green 상태 파일이 서버에만 있어 유실 시 전체 404, smoke 실패 경로에서 idle 색 잔존 (A603) | 상태 디렉터리 마운트, 활성 색을 실제 컨테이너·Caddy 설정과 교차 확인(6.4절) |
| Jenkins–GitLab 플러그인에 며칠, 변경 감지의 과트리거와 침묵 스킵 (A503) | GitLab Runner, 항상 전체 실행 |
| Gradle 데몬 소멸, Ryuk, 고아 컨테이너 (A603) | verify는 B에서 `--no-daemon`, 힙 상한, 잡 정리 |
| ACME location 누락, 헤더 누락, 업로드 1m 기본값 (A503) | Caddy 기본 동작, 5절 |
| Tempo/OTel 미사용, Loki 보존 없음, prod 알림 0 (A603) | 9.1절 스택 축소, 9절 prod 알림 |
| noData=OK로 알림 침묵, `_total` 누락, 소표본 오탐 (A603) | 9.4절 gauge, `absent()`, `promtool test` |
| 폴백이 200으로 숨겨져 사용자가 못 느끼는 실패 (A603) | 11.2절 폴백 비율 알림, smoke의 폴백 확인(12.1 #17) |
| prod를 늦게 올려 노출 수정보다 prod가 먼저 (A603) | M1에서 prod 첫 배포, M3에서 prod 리허설, 14절 |
| 시크릿·실데이터 덤프 커밋 (A603), 문서에 서버 공인 IP 평문 (A503) | gitleaks, 합성 덤프, 문서에 실 IP 금지 |
| 문서 부패 (양쪽) | 문서 규칙(머리말), 확인 명령, 줄번호 금지 |

## 부록 B. 결정 로그

| 분야 | 결정 | 선택 | 대안 |
|---|---|---|---|
| 구성 | 서버 | 기본 지급 EC2 t3.xlarge 1대(A) + EC2 c6g.large 1대(B) + 공용 GPU 서버(학습 전용) + Modal | |
| 구성 | 접근법 | 경량 단일 서버형 | 선배 팀 구성 이식형, prod 전용 + 로컬 dev |
| 구성 | 1차 공개 | 11/06 | 10/28, 10/22 이전 |
| 구성 | 스택 | Spring Boot + FastAPI(Modal) | NestJS + FastAPI, Python 단일 |
| 구성 | 프로젝트명 | Fit Dining. 식별자 접두사는 `fit`(`/etc/fit`, `fit-edge`, `fit_prod` 등) | |
| AI | AI 추론 위치 | 전부 Modal(FastAPI, 임베딩, 리랭커, 소형 LLM). A·B에는 AI 구성요소가 없다 | A 또는 B에서 임베딩 서버 운영(모델 파일, 양자화, 아키텍처별 의존성, 배포를 서버 쪽이 맡아야 한다) |
| AI | 모델 허브 | 두지 않는다. AI 팀이 학습 결과를 직접 Modal에 올린다 | B에 datasets/inbox/verified 허브와 `install-model.sh` |
| 서버 역할 | B 역할 | 외부 감시, CI verify, 백업 금고 | B에 임베딩 서버 |
| 서버 역할 | CI verify 위치 | B. prod가 없고 A의 CPU 크레딧을 쓰지 않는다 | A(privileged dind) |
| CI/CD | BE 테스트 | Testcontainers 사용 | `services:` |
| CI/CD | jar·번들 빌드 위치 | B(verify 단계)에서 빌드하고 A는 `COPY`만 한다 | A에서 빌드(CPU 크레딧을 쓰고 순간 메모리가 는다) |
| CI/CD | MR 병합 | fast-forward | 병합 커밋(SHA가 바뀌어 dev 검증물과 prod가 달라진다) |
| CI/CD | MR 병합 대기열 | fast-forward 병합(rebase로 직렬화)과 병합 순서 규칙 | merge train(Premium·Ultimate 기능이고 fast-forward와 완전히 호환되지 않는다) |
| CI/CD | 배포 순서 | `oldest_first` + outdated 배포 보호 + `deploy.sh` 다운그레이드 가드 | 기본값 `unordered`(대기 중인 배포의 순서가 보장되지 않는다) |
| CI/CD | dev 사용 | `develop` 푸시만 dev에 배포하고 기능 브랜치는 로컬 compose로 시험 | 수동 배포 잡으로 dev를 빌려 쓰기(마이그레이션이 `develop`에 없으면 dev DB의 Flyway 검증이 깨지고 점유 조율이 필요하다) |
| CI/CD | 미완성 기능 | `develop`은 항상 배포 가능, 미완성은 `*_ENABLED` 스위치 뒤 | 릴리스 브랜치를 따로 운영(브랜치 수와 병합 부담이 늘어난다) |
| 프런트 | 프런트 | PWA를 Next.js SSR로 만든다. Node 컨테이너가 렌더링하고 Caddy가 같은 출처로 프록시한다 | Flutter 앱 + Firebase App Distribution, 별도 정적 호스팅(출처가 갈려 CORS와 쿠키가 복잡해진다) |
| 프런트 | 디렉터리 | `fe/`(repo의 실제 구조) | |
| 프런트 | 렌더링 | Next.js SSR(standalone Node 컨테이너). 팀이 서버 렌더링 기능을 쓰기로 했다 | 정적 SPA(Next 정적 export 또는 Vite). 인프라가 가장 단순하지만 서버 기능을 못 쓴다 |
| 프런트 | 환경 값 | 이미지 한 번 빌드 + 환경별 런타임 env와 `/config.json` | 환경별 빌드(prod 번들이 dev에서 검증되지 않고, 빌드타임 값 누락 위험) |
| 프런트 | 배치 | FE 컨테이너를 BE와 같은 Blue/Green으로 전환하고 정적 자산은 누적 풀에서 Caddy가 서빙 | 모든 요청을 Node가 서빙(메모리 부담, 버전 스큐 방어를 따로 구현) |
| 프런트 | 링크 공유 | 외부 지도(네이버) 링크 + Web Share API. 자체 URL 공유가 필요해지면 FE가 OG 메타를 렌더링한다 | BE `/share/<id>`(FE가 SSR이라 필요 없다) |
| 프런트 | dev 접근 제한 | `/?k=` 쿠키 게이트(Caddy, 쿠키 없으면 404) | `X-Fit-Dev-Key` 헤더(브라우저 탐색에 못 붙임), 전체 basic auth(`Authorization` 헤더가 JWT와 충돌) |
| 프런트 | FE→BE 호출 | Caddy 내부 리스너(`caddy:8081`, `caddy:8082`)를 거친다. 활성 색 전환 지점이 한 곳이다 | BE 컨테이너 이름으로 직접 호출(색이 바뀔 때 FE가 따라가야 한다), 공개 주소로 호출(밖으로 나갔다 들어온다) |
| 프런트 | 빌드 위치 | B(Arm)에서 standalone 번들을 만들고 A는 `COPY`만. 이미지 최적화 기본 로더를 쓰지 않는다 | A(x86)에서 빌드(MR 코드가 서비스 호스트에서 돈다), Arm 산출물에 의존성을 새로 설치(검증하지 못했다) |
| 엣지 | 도메인 | 가비아에서 등록한 도메인. prod와 dev는 호스트로 구분(둘 다 443) | SSAFY 지급 도메인 하나와 포트 구분(쿠키가 격리되지 않고 인증서 한도를 다른 팀과 나눌 수 있다) |
| 데이터 | 사진 저장소 | Garage | 외부(R2, Firebase Storage) |
| 데이터 | 사진 읽기 | Garage 웹 엔드포인트 + Caddy(`confirmed/`만) | presigned GET(URL이 매번 달라 캐시가 안 된다) |
| 보안 | 비용 방어 | Modal 프록시 인증 + 사용자·IP 속도 제한 + 전역 예산 | 전역 예산만(한 명이 소진시키면 모두 폴백) |
| 보안 | 팀원 접근 | 비특권 계정 + SSH 터널 | infra 담당만, 전원 sudo |
| 백업 | 백업 키 | 서버에 두지 않고 2인 오프라인 보관 | B에 키를 두고 복원 자동화 |
| 백업 | 호스트 밖 백업 위치 | B 금고. GitLab Package Registry는 선택적 2차 사본(P2) | GitLab Package Registry를 주 저장소로 |
| 백업 | 마이그레이션 전 덤프 | 평문, A의 `/srv/fit/predeploy`(최근 5개), B로 보내지 않는다 | 암호화(개인키가 서버에 없어 급할 때 복원하지 못한다) |
| 백업 | 백업 코드 실행 위치 | root 소유 사본(`/usr/local/lib/fit/repo`)에서 타이머가 돈다 | 저장소 체크아웃에서 실행(배포 러너가 root로 도는 코드를 바꿀 수 있다) |
| 백업 | 금고 수신 검증 | incoming을 신뢰하지 않고 root 전용 staging에서 sha256·크기·이름을 검증, 실패는 격리 | incoming에서 바로 검증해 이동(검증 뒤 바꿔치기 가능) |
| 백업 | 덤프 검증 방식 | 임시 컨테이너에 복원하고 테이블 수를 덤프 시점 값과 비교 | `pg_restore -l` 목차 확인만(데이터가 읽히는지 모른다) |
| 관측성 | B 감시 구성 | Prometheus-B·Alertmanager-B·blackbox(설정이 repo에 남는다) | Uptime Kuma 한 개(설정이 UI에 남아 repo 관리 원칙과 어긋난다) |
| 관측성 | 우선순위 | 감시 체계 감시(`/_ops`)는 P0, `lint:image-arch`는 P1 | 둘 다 P2로 내리기(비용이 거의 없어 유지) |
| 관측성 | 알림 전달 | Alertmanager `slack_configs`로 Mattermost 수신 웹훅에 보낸다(주소는 `api_url_file`) | 별도 알림 어댑터(구성요소가 늘어난다) |
| 관측성 | 서버별 값 | 일회성 서비스(`obs-init`, `ops-init`)가 환경변수로 필요한 설정 파일만 만든다. 나머지 설정은 저장소 파일 그대로다 | 설정 파일 전체를 서버에서 생성(검증할 수 없는 파일이 는다) |
| 관측성 | 호스트 지표 | 백업·금고·포트 감사 결과는 파일로 쓰고 node_exporter의 textfile collector가 읽는다 | pushgateway(상시 프로세스가 는다) |
| 관측성 | `/_ops` 실패 응답 | B의 IP와 basic auth를 모두 통과하지 못하면 401이 아니라 404(경로가 있다는 단서를 주지 않는다) | 401 |
| 관측성 | 포트 감사 방식 | B에서 표준 라이브러리만 쓰는 TCP connect 스캔. 자주 쓰는 포트 15분, 전체 매일 | nmap(패키지와 결과 파싱이 늘어난다) |
| 관측성 | 일일 요약 | Python 표준 라이브러리와 openssl. 인증서 잔여일은 서버 자신의 443에서 읽는다 | 셸 스크립트(JSON 처리가 취약), A가 B의 인증서 프로브를 조회(호스트 사이에 새 경로가 생긴다) |
| 관측성 | 로그 UI | Dozzle(`docker.sock` 읽기 전용, 127.0.0.1만 게시). 한계는 13.4절 | 로그 UI 없이 서버에서 `docker logs`(터널 접근자가 셸이 없어 로그를 볼 수 없다) |

## 부록 C. 출처

- [Burstable performance instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances.html)
- [Key concepts for burstable performance instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html)
- [Monitor CPU credits for burstable instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-monitoring-cpu-credits.html)
- [AWS EC2 C6g instances](https://aws.amazon.com/ec2/instance-types/c6g/)
- [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Caddy global options](https://caddyserver.com/docs/caddyfile/options)
- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports)
- [GitLab project runners](https://docs.gitlab.com/ci/runners/runners_scope/)
- [Garage S3 compatibility](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/)
- [Garage: exposing buckets as websites](https://garagehq.deuxfleurs.fr/documentation/cookbook/exposing-websites/)
- [MinIO in Maintenance Mode](https://ayedo.de/en/posts/minio-im-maintenance-mode/)
- [Self-hosted S3 alternatives in 2026](https://glukhov.org/data-infrastructure/object-storage/self-hosted-s3-alternatives/)
- [Promtail merging into Alloy](https://grafana.com/blog/2025/02/13/grafana-loki-3.4-standardized-storage-config-sizing-guidance-and-promtail-merging-into-alloy/)
- [Docker 29 increased minimum API version](https://forums.docker.com/t/docker-29-increased-minimum-api-version-breaks-traefik-reverse-proxy/150384)
- [Docker Engine v29](https://www.docker.com/blog/docker-engine-version-29/)
- [Custom OpenSearch in Docker](https://forum.opensearch.org/t/how-can-i-run-custom-opensearch-in-docker-or-can-i-install-a-plugin/21775)
- [OpenSearch vector search settings](https://docs.opensearch.org/latest/vector-search/settings/)
- [Modal: web endpoint proxy auth tokens](https://modal.com/docs/guide/webhook-proxy-auth)
- [Snowflake Arctic-embed-l-v2.0](https://zilliz.com/ko/ai-models/snowflake-arctic-embed-l-v2.0)
