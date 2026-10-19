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

Fit Dining(PWA 프런트, Spring Boot 백엔드, OpenSearch 검색, Modal 위의 AI)의 서버 인프라 설계다. SSAFY가 지급한 자원 4종으로 구성한다. 첫 공개는 2026-11-06, 서비스 종료는 11-18이라 공개 운영은 12일이다. 그래서 "작게 만들되 사고가 나도 복구되는" 구성을 택했다.

### 한눈에 보기

| 자원 | 역할 | 올라가는 것 |
|---|---|---|
| A: Lightsail xlarge (x86, 16GB) | 서비스 | Caddy(PWA 정적 파일 포함), BE(prod·dev), Postgres, OpenSearch, Redis, Garage, 관측성, 배포 러너 |
| B: EC2 c6g.large (Arm, 4GB) | 감시·CI·백업 | 외부 감시, CI verify 러너, 백업 금고 |
| SSAFY 공용 GPU 서버 | 학습 전용 | 인프라가 다루지 않는다. A·B와 연결하지 않는다 |
| Modal (serverless GPU) | AI 추론 전부 | FastAPI, 임베딩, 리랭커, 소형 LLM. A·B에는 AI 구성요소가 없다 |

### 이 문서를 읽는 법

| 읽는 사람 | 먼저 볼 절 |
|---|---|
| BE 팀 | 12.1(BE 계약), 11.2(Modal 호출 방어), 6.5(마이그레이션), 12.4(환경변수) |
| FE 팀 | 12.5(프런트 계약), 5절(캐시·dev 접근), 6.8(PWA 빌드·배치) |
| AI 팀 | 12.2·12.3(Modal 계약), 11절 |
| 인프라 담당 | 전체. 일정은 14절, 운영은 10절 |
| 팀 전체 | 10.8(브랜치·MR 운영 규칙), 16절(미결정·확인 필요) |

### 핵심 결정

| # | 결정 | 이유 |
|---|---|---|
| 1 | 경량 단일 서버형: prod와 dev가 DB·검색·Redis 같은 무거운 서비스를 공유하고, 앱·DB·인덱스·버킷만 환경별로 분리한다 | A 한 대의 지속 CPU(약 1.6 vCPU)와 운영할 컨테이너 수를 아낀다. 한도 메모리 합계는 약 8.3GB(16GB의 52%)다 |
| 2 | A는 서비스 본체, B는 외부 감시·CI verify·백업 금고 | B는 4GB라 서비스 경로에 넣으면 두 호스트 중 하나만 죽어도 서비스가 죽는다. 서비스 경로 밖에서 A의 약점(서버 안 감시, CI 부하, 호스트 밖 백업)을 덮는다 |
| 3 | 엣지는 Caddy | 인증서 발급·갱신, 프록시 헤더, 리다이렉트가 기본이라 선배 팀의 nginx 함정이 대부분 없다 |
| 4 | CI/CD는 GitLab Runner 2개(verify는 B, deploy는 A). 러너 등록이 막히면 Jenkins로 폴백 | 공개 웹훅과 플러그인 설정이 없고 설정이 repo에 남는다 |
| 5 | prod는 Blue/Green(Caddy upstream 전환), dev는 교체형 | 배포 중 요청 유실을 줄이고, 실패하면 자동으로 되돌린다 |
| 6 | AI 추론과 FastAPI는 전부 Modal에 둔다. A·B는 AI를 담당하지 않고, BE가 Modal을 HTTPS로 호출한다 | AI 팀이 Modal에서 모델을 서빙·배포하므로 서버는 모델 파일, 양자화, 아키텍처별 의존성(arm64)을 맡지 않는다. 대신 Modal이 AI의 단일 의존점이라 키워드 검색 폴백, 예산, 킬스위치가 필수다 |
| 7 | 사진 저장소는 Garage(S3 호환) | S3를 쓸 수 없다고 가정한다. MinIO 커뮤니티판은 아카이브됐다 |
| 8 | 백업은 age로 암호화(수신자 2명, 개인키는 서버에 두지 않음)한 뒤 B 금고로 쓰기 전용 전송. 복원 리허설은 사람이 한다 | 서버가 뚫려도 백업 평문이 나가지 않는다 |
| 9 | 관측성은 A에 Prometheus·Alertmanager·Grafana, B에 외부 감시. Loki·Tempo·OTel은 쓰지 않는다 | 선배 팀에서 Tempo/OTel은 쓰이지 않았고 Promtail은 EOL이다 |
| 10 | 컨테이너는 `127.0.0.1` 바인딩만 쓰고 공개는 Caddy 하나다. B가 밖에서 포트 노출을 계속 감사한다 | Docker 게시 포트는 ufw를 우회한다. 선배 팀에서 실제 노출 사고가 있었다 |
| 11 | 외부 호출(Modal, GMS 등)은 타임아웃·서킷브레이커·예산·킬스위치·폴백 계약을 둔다. Modal 엔드포인트는 프록시 인증, BE는 사용자·IP별 속도 제한을 건다 | 폴백은 사용자가 못 느끼는 실패라 비율 알림이 필수다. 전역 예산만 있으면 한 명이 예산을 소진시켜 모두를 폴백으로 떨어뜨릴 수 있다 |

### 용어

| 용어 | 뜻 |
|---|---|
| prod / dev | 운영 환경(443) / 개발 환경(8443). 같은 서버, 같은 호스트명에서 포트로 나뉜다 |
| Blue/Green | prod BE를 두 벌(blue, green) 두고 새 버전을 반대 색에 띄운 뒤 Caddy가 트래픽을 넘기는 배포 방식 |
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
| A. Lightsail Xlarge-16GB | x86_64, 4 vCPU, 16GB, 320GB SSD, 전송 6TB (확인) | 서비스 본체(BE, PWA 서빙), 배포 러너 |
| B. EC2 c6g.large | Arm(Graviton2), 2 vCPU, 4GiB, EBS 전용, GPU 없음 (확인). 디스크 크기 (미확인) | 외부 감시, CI verify 러너, 백업 금고 |
| SSAFY GPU 서버 | 공용, 학습 전용(기획서). 고정 공인 IP 없음, VPC/VPN 없음(A503 기준) | 학습만. 서비스 경로에 넣지 않고 A·B와 연결하지 않는다. 학습 결과는 AI 팀이 직접 Modal에 올린다 |
| Modal | serverless GPU | AI 추론 전부(임베딩, 리랭커, 소형 LLM)와 FastAPI. A·B에는 AI 구성요소가 없다. 호출 쪽 계약(11.2절)은 인프라와 BE가 맡는다 |

- **A의 CPU 크레딧:** baseline은 vCPU당 40%(2023-06-29 이후 생성한 인스턴스 기준)라서 지속 약 1.6 vCPU다. 초과분은 유휴 때 적립한 burst 용량을 쓰고, 오래 burst하면 적립분을 다 써서 다시 baseline(지속 가능 구간)으로 돌아간다 (확인: AWS 문서, 실측은 RB-09).
- **B의 성능:** T 계열이 아니라 고정 성능이다. burst 크레딧이 없다 (확인).

### 1.3 SSAFY 플랫폼 사실

- **방화벽:** 호스트 방화벽 ufw가 켜져 있고 기본 정책이 deny(DROP)다. DROP이라 거부가 아니라 타임아웃으로 보인다. A503은 허용 포트가 22·8000·8001뿐이었고 80/443은 `ufw allow` 직후 열렸다. 클라우드 방화벽은 처음부터 열려 있었다 (확인: A503 문서). 포트가 안 열릴 때 확인 순서는 리스너(`ss -lntp`), ufw, 클라우드 방화벽, 그 바깥이다.
- **Docker 포트:** Docker 게시 포트는 ufw를 우회한다.
- **인증서:** DNS-01은 못 쓴다. `p.ssafy.io` 존의 TXT 권한이 없다 (확인: A503 문서). Let's Encrypt HTTP-01만 가능하므로 80 포트는 갱신 때문에 상시 열어 둔다.
- **도메인:** 패턴은 `<접두><기수><팀>.p.ssafy.io`이고 선배 팀은 `i15a603`, `j15a503`이었다. 우리 접두는 (미확인).
- **GitLab:** lab.ssafy.com은 Community Edition v18.11.5이고 Premium 기능은 쓸 수 없다 (확인: 팀원 확인). 공용 러너가 없다 (확인: A503 문서). 프로젝트 러너 생성에는 Maintainer 권한이 필요하다 (확인: GitLab 문서).
- **AWS·S3:** AWS 콘솔·IAM·S3 사용 흔적이 선배 팀 양쪽에 없다. S3는 쓸 수 없다고 가정한다.
- **아웃바운드:** 제한이 없었다(Docker Hub, HuggingFace 등 접근 가능).
- **공인 IP:** Lightsail의 기본 공인 IP는 stop/start하면 바뀌고, 정적 IP는 인스턴스에 붙여 두면 무료다 (확인: AWS 문서). EC2의 공인 IP도 Elastic IP가 없으면 stop/start로 바뀐다. `remote_ip` 허용, 금고 전송, DNS가 이 IP에 기대므로 인스턴스는 멈추지 않고 M0에서 둘 다 고정 IP를 붙인다.
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
- 프런트(`fe/`)는 PWA이고 정적 산출물로 빌드된다. CI가 빌드하고 A의 Caddy가 같은 출처로 서빙한다. SSR용 Node 서버는 쓰지 않는다. 장소 공유는 외부 지도 링크로 하므로 링크 미리보기용 서버 렌더링이 필요 없다(12.5절). SSR을 쓰면 Node 서버 컨테이너와 Blue/Green이 추가돼 운영 부담이 늘어난다(A의 한도 최악 합계는 약 12.7GB로 예산에는 들어간다, 추정).
- 팀 Mattermost에 Incoming Webhook을 만들 수 있다.
- 예상 규모(동시 사용자, 피크 RPS, 문서·벡터 수, 사진)는 아직 모른다. 4.4절의 자리표시자를 팀과 맞춘다(16절).

## 2. 아키텍처

### 2.1 토폴로지

```
 [PWA / team]                       [Modal]
        | 443, 8443                   ^ https (BE -> AI)
        v                             |
+-------------------------------------------+      +--------------------------------------+
| A: Lightsail xlarge (x86 / 16GB)          |      | B: EC2 c6g.large (Arm / 4GB)         |
|  edge  Caddy (+ PWA static files)         |      |  ops   Prometheus-B, Alertmanager-B, |
|  app   be (prod blue|green, dev)          |----->|        blackbox, node-exporter,      |
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
| A | `fit-app-prod` | be-prod-blue/green |
| A | `fit-app-dev` | be-dev |
| A | `fit-obs` | prometheus, alertmanager, grafana, node-exporter, cadvisor, blackbox, postgres-exporter, opensearch-exporter, dozzle |
| B | `fit-ops` | prometheus-b, alertmanager-b, blackbox, node-exporter |

호스트 서비스(systemd)는 A의 `gitlab-runner`(deploy)와 B의 `gitlab-runner`(verify)다.

어느 망에 누가 속하는지가 곧 접근 허용 목록이다. 아래는 A의 네트워크다.

| 망 | 종류 | 속한 컨테이너 | 설명 |
|---|---|---|---|
| `net-edge` | 일반 bridge | caddy, garage | caddy는 80·443·8443을 게시하고 ACME 때문에 바깥으로 나갈 수 있어야 해서 internal 망에 두지 않는다. garage는 사진 업로드·공개 읽기 프록시용이다 |
| `net-prod` | 일반 bridge | be-prod-blue/green, caddy | prod 앱 망. BE의 외부 호출(GMS, Modal 등)이 가능하다. caddy가 BE로 프록시한다 |
| `net-dev` | 일반 bridge | be-dev, caddy | dev 앱 망. 역할은 `net-prod`와 같다 |
| `net-data` | `internal: true` | postgres, opensearch, redis-prod, redis-dev, garage, BE 컨테이너 | 바깥으로 나가지 못한다. caddy는 속하지 않는다(인터넷을 마주한 컨테이너가 DB 망에 직접 붙지 않게) |
| `net-obs` | bridge | 관측성 컨테이너, caddy | prometheus는 `net-prod`·`net-dev`에도 속해 BE의 관리 포트(8081)를 긁고, postgres-exporter·opensearch-exporter는 `net-data`에도 속한다. caddy는 메트릭용으로 속한다 |
| `net-dbaccess` | bridge | postgres | postgres가 `127.0.0.1:5432`를 게시하기 위해 추가로 속한다. 개발자 SSH 터널 용도다 |

두 환경의 BE가 `net-data`를 공유하므로 환경 분리는 자격 증명(Postgres role, Redis 비밀번호, Garage 키)이 맡는다. OpenSearch만 인증이 없어 접두사가 관례일 뿐이다(2.3절, 13.4절).

컨테이너 이름은 환경 접두사로 고정한다(`be-prod-blue`, `be-dev`, `redis-prod` 등). `backend` 같은 일반 별칭은 쓰지 않는다. A603은 공유 망에서 별칭이 환경 간에 해석될 수 있었다.

### 2.3 환경 분리 규칙

| 자원 | prod | dev |
|---|---|---|
| Postgres | DB `fit_prod`, role `fit_prod_app`(DML), `fit_migrator`(DDL) | DB `fit_dev`, role `fit_dev_app`(`statement_timeout` 설정) |
| OpenSearch | 인덱스 접두사 `prod-`, 별칭으로 서빙 | 접두사 `dev-`. `action.destructive_requires_name=true`로 와일드카드 삭제를 막는다. 인증이 없어 접두사는 관례일 뿐이다(12.1 #8, 13.4절) |
| Redis | `redis-prod` 인스턴스 | `redis-dev` 인스턴스 (인스턴스당 약 10MB라 논리 DB 번호보다 안전하다) |
| Garage | 버킷 `fit-prod-photos`, prod 전용 키 | 버킷 `fit-dev-photos`, dev 전용 키 |
| 비밀 | DB 비밀번호, JWT 키, 외부 API 토큰 모두 환경마다 다르게 | 〃 |
| Modal | 앱·토큰 `fit-prod-*`(FastAPI, 임베딩, 리랭커, LLM) | 앱·토큰 `fit-dev-*` |

## 3. 호스트 기반

서버 설정은 멱등 스크립트 `infra/host/bootstrap.sh`(`ROLE=app|ops`)와 검증 스크립트 `infra/host/verify-host.sh`로 한다. verify는 PASS/FAIL만 출력하고 값은 찍지 않는다. 서버에서의 실행은 사람이 하고 출력을 붙여 주면 검토한다.

| 영역 | A | B | 근거 |
|---|---|---|---|
| 시간대 | 호스트와 모든 컨테이너 `Asia/Seoul`(tzdata 포함 확인), DB는 `timestamptz` | 호스트 `Asia/Seoul` | 새벽 4시 KST 일괄 처리. A503은 호스트 KST와 컨테이너 UTC 불일치로 날짜 오류가 났다 |
| 스왑 | 4GB swapfile, swappiness 10 | 2GB swapfile, swappiness 10 | OOM 완충 |
| 커널 | `vm.max_map_count=262144` | 해당 없음 | OpenSearch 필수값 |
| Docker 로그 | `json-file` 10MB×3. be·caddy는 50MB×5(compose `logging:`) | 10MB×3 | 로그 로테이션 부재가 선배 팀의 공통 결함 |
| Docker 운영 | `live-restore`, 주 1회 이미지·빌더 캐시 prune(서비스당 최근 SHA 5개 유지) | 주 1회 prune | prune 부재가 공통 결함 |
| Docker 버전 | `docker version`으로 확인. 29 이상이면 API 클라이언트(cAdvisor, Dozzle, Testcontainers)를 최신으로 핀하고, 안 되면 daemon.json의 `min-api-version`으로 완화 | 〃 | 1.3절 |
| ufw | 기본 deny. 허용 22(limit), 80, 443, 8443 | 기본 deny. 허용 22(limit)만 | 80은 인증서 갱신 때문에 상시 개방 |
| 포트 규칙 | 컨테이너는 `127.0.0.1:` 바인딩만. 공개는 caddy 하나. CI가 compose 파일을 검사해 위반하면 실패 | 〃 | 13절 |
| SSH | 키 전용, root 금지, fail2ban(`ignoreip`에 A↔B 상대 호스트 IP). 자동 보안 업데이트는 켜고 자동 재부팅은 끈다(11/06 이후 재부팅은 공지된 창에서만) | 〃 | |
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

서버 밖(노트북)에서는 `Test-NetConnection <호스트> -Port 22/80/443/8443`으로 도달성을 본다. Caddy가 뜨기 전(M0)에는 22만 열려 있어야 한다. A→B SSH(전송용)와 B에서 A의 포트 도달성(스캔)도 M0에서 확인한다. B에는 A로 들어오는 SSH 키가 없으므로 B→A는 SSH가 아니라 도달성만 본다.

## 4. 자원 예산

### 4.1 A (GB, 추정)

| 구성 | 한도 | 평상시 |
|---|---|---|
| OS·Docker·sshd | 0.8 | 0.8 |
| Caddy | 0.15 | 0.05 |
| be-prod (배포 중 반대 색 +1.5) | 1.5 | 0.8 |
| be-dev | 1.0 | 0.6 |
| Postgres | 1.0 | 0.4 |
| OpenSearch (힙 768MB) | 2.0 | 1.3 |
| Redis ×2 + Garage | 0.45 | 0.15 |
| 관측성 전체 | 1.4 | 0.9 |
| **합계** | **약 8.3** | **약 5.0** |

- A에는 AI 구성요소(임베딩 서버, ai-api)가 없다. 한도 합계 약 8.3GB는 16GB의 약 52%다.
- JVM 힙을 컨테이너 한도의 60%로 잡으면 메타스페이스·스레드 스택·코드 캐시가 한도 안에 들어온다(12.1 #10).
- 순간 증가분은 3.0GB다: 이미지 조립 0.3, 배포 겹침(BE 1.5) 1.5, 새벽 배치 1.2. jar와 PWA 번들은 B에서 빌드하고 A는 `COPY`만 하므로 빌드 메모리가 A에 오지 않는다(6.3절). 한도 최악 합계는 약 11.3GB다.

한도는 상한일 뿐 동시에 다 차지는 않는다는 가정에 기대는 설계라서 아래를 방어선으로 둔다.

1. 스왑 4GB
2. 컨테이너 OOM과 메모리 80% 알림(9절)
3. 배포·CI 직렬화(GitLab `resource_group`, 러너 `concurrent 1`)
4. 비상안: dev 스택(be-dev, 약 1.0GB)을 일시 중지

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

Caddy 컨테이너(`caddy:2.x`, 구현 시 최신 2.x를 핀)가 A의 80·443·8443만 게시한다.

### 5.1 기본 설정

| 항목 | 결정 | 근거 |
|---|---|---|
| 프로토콜 | `protocols h1 h2`. UDP 443(h3)은 열지 않는다 | Caddy 기본값은 h3를 포함한다 (확인) |
| 호스트·인증서 | 호스트명 하나(`<팀ID>.p.ssafy.io`). 443은 prod, 8443은 dev, 같은 인증서. Let's Encrypt HTTP-01(80) | DNS-01 불가 |
| 인증서 단계 | staging 단계에서만 `acme_ca`(`ACME_CA`)로 staging CA를 지정하고, 운영 단계에서는 지정하지 않는다 | 아래 인증서 메모 |
| 인증서 보관 | `caddy_data` 볼륨은 삭제 금지, 백업 대상. 운영 인증서는 M1 첫날 발급하고 곧바로 백업한다 | 삭제하면 재발급 한도에 걸릴 수 있다 |
| 프록시 헤더 | Caddy가 `X-Forwarded-For/Proto/Host`를 설정하고 외부에서 온 값은 무시, Host는 원본 유지 | (확인: Caddy 문서). BE는 `server.forward-headers-strategy` 설정이 필요하다 |
| 요청 크기 | API 본문 2MB 상한. 사진 업로드 경로는 `request_body max_size 10MB` | presigned PUT은 크기를 정책으로 묶을 수 없어(POST policy만 가능) 프록시에서도 상한을 둔다 |
| 관리면 | Grafana·Dozzle·Prometheus는 127.0.0.1 게시 + SSH 터널. 공개 경로 없음. Caddy admin은 컨테이너 내부에서만 | |
| 로그 | JSON을 stdout으로, json-file 로테이션 | |
| 메트릭 | 전역 `metrics` 옵션을 켜고 내부 전용 리스너로 노출(`net-obs`) | (확인: Caddy 문서는 전역 `metrics`를 스크래핑의 전제로 설명한다) |

**인증서 메모**

- 기본 이슈어는 ZeroSSL과 Let's Encrypt다 (확인: Caddy 문서). `acme_ca`를 지정하면 그 CA만 쓰는 것으로 알려져 폴백이 사라진다(문서에 명시 없음, `caddy adapt`로 확인). 그래서 운영 단계에서는 지정하지 않는다.
- Let's Encrypt는 등록 도메인당 주 50장 제한이 있다. `ssafy.io`가 공개 접미사 목록에 없다면 다른 팀과 한도를 나눠 쓴다 (미확인).

### 5.2 라우팅

| 경로 | 대상 | 비고 |
|---|---|---|
| `/api/*` | 현재 활성 색 BE | |
| `/healthz` | BE 헬스(상태만) | 외부 감시용 |
| `/fit-prod-photos/*`, `/fit-dev-photos/*` | garage S3 API(사진 업로드, path-style) | Host 헤더가 보존돼 SigV4 서명이 통과해야 한다. 7.4절 스파이크로 확인 |
| `/photos/<env>/confirmed/*` | garage 웹 엔드포인트(3902) | `header_up Host`를 그 버킷의 웹 호스트(`<버킷>.<web_root_domain>`)로 바꾼다. `pending/`은 공개 경로에서 막는다. 객체 키는 추측할 수 없는 UUID이고, 읽기 응답은 캐시 가능하게(`Cache-Control: public`) 둔다 |
| `/_ops/prometheus/healthy`, `/_ops/alertmanager/healthy` | 내부 `/-/healthy`로 rewrite | B의 IP(`remote_ip`)와 basic auth를 둘 다 통과해야 하고 실패하면 404. 이 외의 `/_ops` 경로는 없다. B가 A의 감시 체계를 감시한다 |
| 그 외 | PWA 정적 파일(5.3절) | API와 사진이 같은 출처라 CORS가 필요 없다 |

**사진 읽기 경로의 근거**

- Garage에는 ACL·버킷 정책이 없다 (확인). 서명 없는 `<img src>`를 S3 API로는 읽을 수 없을 것이다(익명 GET 거부는 7.4절 스파이크에서 확인).
- 공개 읽기는 `garage bucket website --allow`로 켠 웹 엔드포인트로 한다. 켜면 그 버킷이 웹으로 공개된다 (확인: Garage 문서).

### 5.3 PWA 서빙

- **루트:** `/srv/fit/web/<env>/current`다. 릴리스 디렉터리를 가리키는 상대 심볼릭 링크(`releases/<SHA>`)이고, 디렉터리째 읽기 전용으로 마운트한다. 절대 경로 링크는 컨테이너 안에서 끊긴다.
- **캐시:** `index.html`·`sw.js`·`manifest.webmanifest`·`config.json`은 `Cache-Control: no-cache`, 내용 해시가 붙은 정적 자산은 `public, max-age=31536000, immutable`이다. 서비스 워커가 옛 `sw.js`에 갇히면 배포가 반영되지 않는다.
- **환경 값:** `config.json`은 환경별 파일(`/srv/fit/web/<env>/config.json`)로 서빙한다.
- **SPA 폴백:** SPA 라우트만 `index.html`로 폴백하고 자산 경로의 누락은 404로 둔다. 폴백이 자산 404를 덮으면 빈 화면의 원인을 못 찾는다(A503 빈 번들 교훈).
- **헤더:** `encode zstd gzip`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`를 붙인다.
- **HSTS:** `Strict-Transport-Security`는 운영 인증서가 확정된 뒤에만 켠다. staging 인증서 단계에서 켜면 브라우저가 거부해 테스트가 막힌다.
- **CSP:** 프런트 팀과 합의한 뒤 추가한다.

### 5.4 dev 접근과 쿠키

**dev 접근 제한**

- 8443은 쿠키가 없으면 404다.
- `/?k=<dev 키>`로 한 번 접속하면 Caddy가 `fit_dev` 쿠키(Secure, HttpOnly, SameSite=Lax, `Max-Age=1209600`)를 심고 `/`로 보낸다. 같은 출처 요청에는 쿠키가 자동으로 붙는다.
- `/manifest.webmanifest`와 `/icons/*`는 게이트에서 제외한다. 브라우저가 쿠키 없이 가져오기 때문이다.
- 로그에서는 쿼리의 `k`를 지운다(`log`의 `filter` 인코더에서 `request>uri query { delete k }`, 구현 시 확인). `Cookie`·`Authorization` 헤더는 Caddy가 기본으로 가린다(Caddy 문서의 `log_credentials`, 구현 시 확인).
- 목적은 스캐너 차단용 최소 방어다. 헤더 방식은 브라우저의 페이지 탐색에 붙일 수 없고, basic auth는 JWT를 담는 `Authorization` 헤더와 충돌해 쓰지 않는다. 만료가 없는 세션 쿠키면 모바일에서 앱을 닫을 때마다 사라진다.
- iOS 홈 화면 PWA는 Safari와 쿠키를 공유하지 않을 수 있다. 그 경우 PWA 안에서 다시 `?k=`로 들어와야 한다 (미확인).

**쿠키 분리**

- 쿠키는 포트로 격리되지 않아(RFC 6265) 브라우저가 prod 쿠키를 :8443에도 보낸다.
- 8443 사이트는 `fit_prod_` 접두사 쿠키를 지운 뒤 프록시하고(`request_header Cookie "fit_prod_[^;]*;? ?" ""`), 443 사이트는 `fit_dev` 쿠키를 지운다. dev BE가 prod 리프레시 토큰을 받지 않게 하려는 것이다(구현 시 확인).
- prod 인증 쿠키는 HttpOnly로 둔다.

### 5.5 전환·연결·검증

**Blue/Green 전환:** 배포 스크립트가 활성 색 upstream 조각(`/srv/fit/state/upstream-prod.caddy`)을 쓰고 `caddy reload`를 호출한다. 상태 디렉터리는 파일이 아니라 디렉터리째 마운트한다(A603의 bind-mount inode 사고 교훈). `lb_try_duration`으로 전환 중 연결 실패를 재시도한다.

**장기 연결:** SSE는 `text/event-stream`이면 자동 flush된다 (확인). reload 때 WebSocket은 기본으로 강제 종료되고 `stream_close_delay`로 지연할 수 있다 (확인). 일반 HTTP는 grace period가 무제한이라 끝까지 처리된다 (확인). 어느 쪽이든 old 색을 멈추면 끊기므로 클라이언트 재연결(`Last-Event-ID`)이 전제다.

**PWA와 TLS:** 서비스 워커, 설치(홈 화면 추가), 웹 푸시는 브라우저가 신뢰하는 HTTPS에서만 동작한다. staging CA 인증서는 신뢰되지 않으므로 프런트 테스트 전에 운영 CA 인증서를 확정한다. prod(443)와 dev(8443)는 출처가 달라 서비스 워커와 localStorage가 따로지만, 같은 호스트명이라 쿠키는 포트로 격리되지 않는다(12.5절).

**검증:** `verify-edge.sh`는 서버 안에서 TLS·헤더·라우팅을 확인한다(`/`가 200, `index.html`·`sw.js`·manifest는 `no-cache`, 해시 자산은 `immutable`, 없는 자산 경로는 404). 서버 밖에서는 포트 스캔(22/80/443/8443만 열림)과 인증서 만료일을 확인한다.

## 6. CI/CD

### 6.1 러너

| 러너 | 호스트 | executor | 비고 |
|---|---|---|---|
| `fit-verify` (태그 `verify`) | B (Arm) | docker + docker.sock | job 메모리 2.0GB, cpus 2, `concurrent 1`. B에는 prod 컨테이너·볼륨·시크릿이 없어 CI 사고가 서비스에 닿지 않는다 |
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

### 6.3 파이프라인 `.gitlab-ci.yml`

단계는 `verify` → `build` → `deploy` → `smoke` 순서다. `verify`는 B에서, 나머지는 A의 deploy 러너에서 돈다. 변경 감지는 쓰지 않는다. 레지스트리 조회가 필요한 `lint:image-arch`와 MR에서만 의미 있는 `lint:migrations`와 `lint:history`만 조건부로 돌고, 나머지는 항상 전체를 실행한다.

| 잡 | 단계 | 내용 |
|---|---|---|
| `lint:*` | verify | 아래 목록 |
| `be:test` | verify | Gradle 테스트(Testcontainers, 최신 버전 필수)와 `bootJar` 빌드. jar를 아티팩트로 넘긴다. jar 크기가 GitLab 아티팩트 상한을 넘으면 B에서 A로 `rsync`한다(상한은 미확인) |
| `fe:test` | verify | 린트, 타입 검사, 단위 테스트(`fe/`). verify 러너(B)에서 Node 이미지(핀, arm64 지원)로 실행 |
| `fe:build` | verify | 같은 Node 이미지로 PWA를 **한 번만** 빌드하고(환경 값은 번들에 넣지 않는다, 6.8절) 산출물 검사를 거쳐 정적 산출물을 GitLab 아티팩트로 넘긴다 |
| `build:images` | build | `<서비스>:<SHA>` 로컬 조립. verify 단계가 만든 jar를 `COPY`한다(BE 계약 #20). 레지스트리는 없다. 이미 있으면 재사용한다(MR을 fast-forward로 병합하므로 SHA가 그대로라 다시 조립하지 않는다) |
| `deploy:dev` | deploy | develop 푸시 시 자동(`environment: dev`) |
| `deploy:prod` | deploy | master에서 수동(`environment: prod`) |
| `smoke:public` | smoke | 배포 후 `--resolve`로 서버 내부 경유 확인. 검색 1건을 호출해 폴백 사용 여부를 확인한다(Modal 연동 누락이 폴백에 가려지지 않게, BE 계약 #17). 콜드 스타트를 감안한 타임아웃을 둔다 |

**`lint:*` 잡**

- `lint:guards`: 단위 테스트, CRLF, `infra/`의 env 예제 형식, env 계약과 예제 파일의 키 일치, 포트 규칙
- `lint:image-arch`: 도구 이미지 핀이나 로컬 스택 이미지가 바뀔 때만 돈다
- `lint:shell`, `lint:docker`, `lint:yaml`: `infra/`와 루트 설정만 엄격하게 본다. be의 Dockerfile은 오류 수준만 막는다. 다른 팀 코드는 각자의 잡이 맡는다
- `lint:secrets`: 저장소 전체와 MR 커밋 이력
- `lint:history`: MR에서만 돈다. MR 안의 병합 커밋(3-way merge)을 막는다
- `lint:migrations`: MR에서만 돈다. 적용된 Flyway 파일의 수정, 버전 중복, 순서 역전을 막는다
- 도구별로 잡을 나눈다. job 컨테이너 안에서 `docker run -v $PWD`로 도구 컨테이너를 띄우면 워크스페이스가 호스트 경로가 아니라 마운트되지 않기 때문이다
- `caddy validate`와 `promtool check/test`는 해당 파일이 생기는 계획에서 추가한다

verify는 Arm, prod는 x86이다. 그래서 deploy 스크립트가 idle 색에서 실제 x86 이미지로 스모크를 돌린 뒤에만 전환한다.

`ai/`의 테스트와 배포는 AI 팀이 Modal 쪽에서 한다(인프라 CI 범위 밖). Modal 배포를 deploy 러너 잡으로 옮기는 것은 P2다(11.2절).

### 6.4 배포 스크립트 `infra/deploy/deploy.sh <env> <sha>`

GitLab이 죽어도 서버에서 직접 실행할 수 있다.

1. preflight(값 비출력): env 파일·권한·CRLF·필수 키, `compose config -q`, 디스크 여유, **메모리 여유**(겹침 배포에 필요한 양보다 적으면 중단), **다운그레이드 가드**(배포할 SHA가 현재 배포된 SHA의 후손이 아니면 거부한다. `git merge-base --is-ancestor`를 쓰며 얕은 clone에서는 현재 SHA를 먼저 fetch한다. 되돌리기는 `rollback.sh`로만 한다)
2. `flock` 잠금
3. prod는 마이그레이션이 있으면 사전 `pg_dump` 후 일회성 마이그레이션 컨테이너 실행. 실패하면 트래픽을 건드리기 전에 중단
4. 반대 색 기동 → readiness(BE 최대 150초) → idle 색 스모크
5. Caddy 전환(`validate` → `reload`) → Caddy 경유 스모크(버전 헤더가 새 SHA인지). 실패하면 자동 복귀
6. 30초 드레인 후 이전 색 정지. 컨테이너와 이미지는 다음 배포까지 보관하고 `rollback.sh`로 즉시 복귀
7. 상태 파일과 이력 기록, Mattermost 알림(SHA, 작성자, 소요 시간)

프런트(PWA) 정적 산출물은 BE 전환이 성공한 뒤 같은 스크립트가 이어서 배치한다(6.8절).

dev는 같은 스크립트를 단일 색으로 돌린다. 교체형이고 헬스 실패 시 직전 이미지로 복귀한다. 일정상 Blue/Green(P1)이 어려우면 prod도 이 교체형(헬스 게이트 + 직전 이미지 복귀)으로 먼저 배포한다(P0).

### 6.5 DB 마이그레이션

Flyway(Spring)를 쓴다.

- 적용된 파일 수정은 CI에서 거부하고, expand/contract만 허용한다.
- 전용 `migrate` 프로필로 일회성 컨테이너에서 실행한다.
- prod는 마이그레이션이 있는 배포 직전에 추가 덤프를 뜬다.
- 롤백은 forward-fix가 원칙이고, 치명적이면 사전 덤프로 복원한다.

### 6.6 이미지

호스트에서 `<서비스>:<SHA>`로 로컬 조립하고 서비스당 최근 5개를 보관한다. 모든 이미지 태그는 핀한다.

### 6.7 B 중단 시

B가 죽으면 CI가 멈추고 배포가 막힌다. 서비스는 영향이 없다. 외부 감시와 백업 전송도 멈추므로 A의 TCP 22 프로브가 알린다(9.2절). 긴급 시 A에서 `SKIP_VERIFY=<사유>`로 `deploy.sh`를 수동 실행하는 절차(RB-02b)를 둔다. B 재구축은 RB-01을 다시 따른다.

### 6.8 프런트(PWA)

PWA는 `fe/`를 정적 산출물로 빌드해 A의 Caddy가 서빙한다(5절). 서버에는 Node 런타임이 없고 빌드는 CI에서만 한다. 프런트 계약은 12.5절이다.

- **빌드:** `fe:build`가 번들을 **한 번만** 만든다. Next.js는 `output: 'export'`로 `out/`을 만든다(12.5절 #1). 환경별 값(PostHog 키, 푸시 공개 키 등 브라우저에 공개되는 값)은 번들에 넣지 않고 `/config.json`으로 받는다. Caddy가 환경별 파일(`/srv/fit/web/<env>/config.json`)로 서빙한다. dev에서 검증한 번들이 곧 prod 번들이다. 시크릿은 어디에도 넣지 않는다. 키 목록은 `docs/infra/contracts/env.md`에 둔다.
- **산출물 검사(P0):** 번들에 `localhost`·mock 값이 없는지, `index.html`·`sw.js`·manifest가 있는지 확인한다. 배치 뒤 smoke는 해당 환경의 `/config.json`에 필수 키가 모두 있는지 확인한다. A503이 빌드타임 설정 누락으로 빈 번들을 6회 배포한 교훈이다. 환경 값을 런타임 설정으로 받으면 그 실패 유형이 줄어든다.
- **배치:** deploy 스크립트가 `/srv/fit/web/<env>/releases/<SHA>/`에 풀고 `current` 링크를 원자적으로 바꾼다. 상대 링크 `releases/<SHA>`를 `current.tmp`로 만든 뒤 `mv -T current.tmp current`로 교체한다(`ln -sfn`은 원자적이지 않다). 롤백은 링크를 직전 릴리스로 되돌린다. 릴리스는 최근 5개를 보관한다. 순서는 BE 전환이 먼저, 프런트가 나중이다.
- **버전 스큐:** 서비스 워커가 옛 번들을 캐시한 브라우저가 새 API를 호출한다. 그래서 API는 직전 배포의 번들과 하위호환을 유지한다(BE 계약 #16). `index.html`과 `sw.js`는 `no-cache`로 서빙해 새 서비스 워커가 곧바로 감지되게 한다. 열려 있는 탭이 이전 릴리스의 해시 자산을 요청해도 404가 나지 않아야 한다(구현 방식은 계획에서 정한다. 예: 해시 자산을 공용 디렉터리에 누적).
- **푸시와 설치:** 웹 푸시와 설치 흐름은 프런트 팀 몫이다. 인프라는 HTTPS, 캐시 정책, 푸시 키 보관을 맡는다(11.3절).

## 7. 데이터 서비스

### 7.1 Postgres

- 이미지는 `pgvector/pgvector:0.8.7-pg16`으로 핀한다(로컬 스택과 같다).
- 튜닝은 mount한 설정 파일이 아니라 `command:` 플래그로 한다(shared_buffers 256MB, max_connections 60, `idle_in_transaction_session_timeout`, `pg_stat_statements`).
- 환경별 DB·role은 init 스크립트가 아니라 멱등 `ensure-databases.sh`로 만든다. init 스크립트는 빈 볼륨에서 한 번만 돌기 때문이다(A503 함정). dev role에는 `statement_timeout`을 건다.
- 개발자용 dev DB 접근은 SSH 터널 → `127.0.0.1:5432`이고 dev role 비밀번호만 공유한다.

### 7.2 OpenSearch

- 공식 이미지(`opensearchproject/opensearch:3.9.0`)에 `analysis-nori`를 설치한 커스텀 이미지다(힙 768MB). 설치는 `opensearch-plugin install --batch analysis-nori`다. 로컬에서 빌드해 `analysis-nori`와 `opensearch-knn` 플러그인이 있고 nori 분석기가 동작함을 확인했다 (확인: `infra/local/fit-local.sh`).
- single-node이고 보안 플러그인은 끈다. 내부 망이고 호스트 게시가 없다는 전제이며 잔여 위험은 13절에 있다.
- `action.destructive_requires_name=true`, 인덱스 템플릿은 `replicas: 0`이다(아니면 yellow).
- 무중단 재색인은 별칭 전환이다(BE 계약).
- 복구는 Postgres에서 재색인한다(스냅샷 없음). 재색인 소요 시간은 측정해 기록한다.
- 임베딩이 Modal 호출이라, 문서 벡터를 Postgres(pgvector)에도 저장해 두지 않으면 재색인 때 문서 전체를 다시 Modal로 임베딩해야 한다(시간·비용). 저장 위치는 BE·AI 팀과 합의한다(16절).
- 벡터 규모와 네이티브 메모리는 4.4절에 있다.

### 7.3 Redis ×2

`redis-prod`, `redis-dev`. maxmemory 96MB, `noeviction`(멱등성 키가 쫓겨나지 않게), AOF everysec, requirepass.

### 7.4 사진 저장소 (Garage)

Garage(`dxflrs/garage:v2.4.1`, 데이터·메타 볼륨, 설정은 디렉터리 마운트)를 쓴다. 공식 문서 기준으로 기획서의 업로드 흐름에 필요한 기능을 지원한다 (확인).

- **지원:** SigV4 presigned URL, PostObject, 멀티파트, Head/Copy/Delete, 수명주기의 `Expiration`과 `AbortIncompleteMultipartUpload`(접두사는 `Filter` 안에), CORS, ListObjectsV2, path-style
- **미지원:** 버킷 정책, 태깅, 버저닝(접두사로 대체)
- **흐름:** 업로드는 `pending/`, 리뷰 등록이 확정되면 `confirmed/`로 Copy 후 Delete, `pending/`는 수명주기로 자동 정리
- **읽기:** 확정된 사진(`confirmed/`)만 웹 엔드포인트로 공개 읽기한다(5절). 업로드는 S3 API, 읽기는 웹 엔드포인트로 경로가 갈린다

**첫 주 스파이크(2시간):** PostObject의 `content-length-range` 강제 여부, presigned PUT/POST가 Caddy 경유(Host 보존)로 서명이 통과하는지, 수명주기 동작, 웹 엔드포인트(3902)로 `confirmed/` 공개 읽기가 되고 익명 S3 GET은 거부되는지를 확인한다. 웹 엔드포인트의 공개 읽기와 익명 S3 GET 거부는 로컬 스택 점검에서 확인했다 (확인). 나머지는 서버에서 확인한다. 실패하면 Cloudflare R2나 Firebase Storage로 간다(계정·결제수단 필요, 국외 이전이면 처리방침 고지).

Garage는 단일 노드라도 레이아웃 설정이 필요하다(`layout assign/apply`, 버킷·키 생성). 로컬에서 v2.4.1로 확인했고 멱등 스크립트는 `infra/local/fit-local.sh`의 `init_garage`다 (확인). 서버용 스크립트는 계획 1D가 같은 순서로 만들고 키는 `/etc/fit/*.env`에 둔다. 메모리는 작을 것으로 보고(추정) 0.25GB를 잡았다.

## 8. 백업·복구

목표는 RPO 4시간, RTO 2시간이다(제안값, 복원 리허설로 측정).

| 대상 | 주기 | 보관 위치 |
|---|---|---|
| Postgres 덤프 | 4시간마다 | A 로컬, B 금고(4시간 단위 48시간 + 일 단위 14일) |
| 사진 | 하루 1회(사진의 RPO는 24시간) | B 금고(rclone, S3 API 경유) |
| Caddy 인증서 볼륨 | 주 1회 | B 금고 |
| `/etc/fit/*.env` | 변경 때마다(수동) | 팀 비밀번호 관리자(암호화) |
| OpenSearch | 백업하지 않는다 | Postgres에서 재색인 |

1. **덤프와 검증(A):** A가 4시간마다 `pg_dump -Fc`를 뜬다. 하루 1회 이상은 같은 덤프를 임시 컨테이너 DB에 복원해 sanity 검사를 한다(덤프 시점 검증, `verify-dump.sh`). 통과하면 `age`로 암호화한다. 수신자는 2명(인프라 담당, 백업 담당)이고 공개키만 A에 둔다.
2. **전송:** B로 `rsync`한다. 전용 `vault` 사용자가 쓰기 전용 강제 명령(`rrsync -wo -no-del /srv/vault/incoming`)으로만 접속하므로 삭제 옵션이 막힌다. `rrsync`는 구현 시 확인한다 (미확인).
3. **보관(B):** B의 timer가 sha256·크기를 검증하고 `incoming`에서 `store`로 옮기며 보관 정책(4시간 단위 48시간 + 일 단위 14일)을 적용한다. 마지막 수신 시각을 지표로 낸다. 8시간 넘게 새 백업이 안 오면 B가 알린다(A가 죽어도 감지).
4. **복호화 키:** 개인키는 A·B 어디에도 두지 않고 수신자 2명이 각자 오프라인으로 보관한다. 서버가 뚫려도 백업 평문이 나가지 않는 대신 자동 복원 리허설은 하지 않는다.
5. **복원 리허설:** 사람이 노트북(Docker Desktop)에서 B 사본을 내려받아 복호화·복원하고 걸린 시간(RTO)을 `restore-check.sh`로 기록한다. 주 1회 하고 11/06 전에는 최소 2회 한다. 결과는 B에 기록해 지표로 낸다. 내려받은 암호화 덤프 최신 1벌은 노트북에 남긴다(3번째 사본, 13.4절).
6. **A 로컬 보관:** 같은 보관 정책(4시간 단위 48시간 + 일 단위 14일)을 쓴다.
7. **그 외 대상:** 사진과 Caddy 인증서 볼륨도 같은 경로로 B에 보낸다. OpenSearch는 Postgres에서 재색인한다. `/etc/fit/*.env`는 자동화하지 않고 인프라 담당이 변경 때마다 암호화해 팀 비밀번호 관리자에 둔다.
8. **선택(P2):** GitLab Package Registry에 암호화 사본을 2차로 올린다. Lightsail 스냅샷은 권한이 있으면 일 1회 자동으로 켠다(권한 (미확인)).
9. **B 소실:** 금고 내용은 사라지지만 A에 로컬 사본이 있다. B를 재구축한다(RB-01).
10. **A 소실(RB-12):** bootstrap → 금고에서 복원(사람, 개인키 사용) → OpenSearch 재색인 → 사진 복원 → env를 팀 비밀번호 관리자에서 복구 → 배포 순서다.

종료(11/18)에는 합성 데이터 덤프를 만들어 포팅 매뉴얼에 첨부한다(실데이터를 커밋한 A603 사고 방지). 실데이터와 호스트 밖 사본은 RB-10으로 삭제한다.

## 9. 관측성·알림

### 9.1 A 스택

- Prometheus(보존 7일 + 5GB 상한), Alertmanager → Mattermost, Grafana(대시보드 3개를 repo에서 프로비저닝, SSH 터널로 접속, 익명 접근 없음)
- node_exporter, cAdvisor, blackbox_exporter, postgres_exporter, OpenSearch exporter, Dozzle(로그 UI)
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
| B 도달 불가 | A에서 B의 TCP 22 프로브 실패 | warning (CI·백업 영향) |

### 9.3 B 알림

| 알림 | 조건 | 심각도 |
|---|---|---|
| 외부 접근 | A `/healthz` 또는 `/`(PWA) 2분 연속 실패 | critical |
| 인증서 | 밖에서 본 만료일 <14일 / <7일 | warning / critical |
| 포트 도달성 | A의 80·443 TCP 불가 | critical |
| 포트 노출 감사 | 15분마다 A의 상위 1,000 포트(+매일 전체 스캔)를 밖에서 스캔. 22·80·443·8443 외에 열린 포트가 있으면 | critical |
| 감시 체계 감시 | A의 `/_ops/prometheus/healthy`, `/_ops/alertmanager/healthy` 실패 | critical |
| 백업 금고 | 마지막 수신 >8시간 / 사람 복원 리허설 >8일 | critical / info |
| B 자신 | 디스크 80%, 메모리 부족 | warning |

### 9.4 공통 규칙

- heartbeat 지표는 counter가 아니라 gauge로 만든다(계열이 처음부터 존재). 반드시 있어야 하는 지표는 `absent()` 알림을 둔다.
- 모든 규칙을 `promtool test rules`로 CI에서 검증한다(이름·uid 중복 포함).
- 알림마다 runbook 링크를 단다.
- 두 Alertmanager 모두 Mattermost로 보내되 `site`(A/B)와 `env` 라벨을 붙인다. dev의 warning은 별도 수신자로 보낸다. critical 채널에는 prod와 B 알림만 간다.
- Alertmanager 웹훅 URL은 `api_url_file`로 시크릿 파일에서 읽는다.

## 10. 운영

### 10.1 일일 점검

매일 09:00 KST에 `daily-digest.sh`(A)가 아래 항목을 Mattermost에 올린다: 디스크·메모리·스왑, CPU 24시간 평균(40% 기준선 대비), 백업 나이, 마지막 배포, 인증서 잔여일, 5xx 건수, 배치 결과.

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

- 로컬 개발용 `infra/local/compose.yml`은 profile(`core`, `search`)로 나눠 노트북 메모리에 맞게 고르게 한다. AI는 Modal의 dev 앱을 쓴다. 켜고 점검하는 명령은 `bash infra/local/fit-local.sh`이고 접속 값은 `infra/local/README.md`에 있다. 환경변수 이름은 `docs/infra/contracts/env.md`를 따른다.
- 서버 수령 전에는 이 PC의 Docker Desktop(Docker 29.7.2, Compose v5.4.0)과 WSL Ubuntu로 compose·스크립트·알림 규칙·Caddy 설정을 검증한다. shellcheck, promtool, age는 컨테이너로 돌린다.
- 서버에서만 확인되는 것은 ufw, sysctl, 실제 TLS 발급, CPU 버스트, 외부 포트 노출이다.

### 10.6 동결과 핫픽스

- **병합 방식:** MR은 fast-forward로 병합한다(프로젝트 설정). 병합 커밋이 새 SHA를 만들면 dev에서 검증한 이미지·번들과 prod가 달라진다. `develop → master`가 fast-forward가 되려면 master에 develop에 없는 커밋이 없어야 하므로 핫픽스도 반드시 develop을 거친다.
- **동결(11/04 이후):** 기능 MR은 받지 않는다. develop·master의 병합 권한을 인프라 담당과 지정한 리뷰어로 좁힌다.
- **핫픽스 순서:** `hotfix` 타입 브랜치(10.8절) → develop MR(dev 자동 배포, `smoke:public` 통과) → `develop → master` fast-forward MR → 인프라 담당이 `deploy:prod`를 수동 실행 → smoke와 `rollback.sh` 준비 상태 확인 → Mattermost 공지.
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
| `[플랫폼/]<타입>/<설명>-<Jira키>` (예: `fe/feat/login-page-S15P31A302-123`) | 개발 브랜치. MR로 `develop`에 합친다 | 배포하지 않는다 |
| `develop` | 통합. 항상 배포 가능한 상태로 둔다 | dev 자동 배포 |
| `master` | prod 승격 | prod 수동 배포 |
| `[플랫폼/]hotfix/<설명>-<Jira키>` | 긴급 수정. `develop`을 거쳐 `master`로 간다(10.6절) | 위 경로를 따른다 |

**GitLab 프로젝트 설정** (인프라 담당이 설정한다. 단계별 절차와 시점은 [gitlab-setup.md](gitlab-setup.md))

- `develop`(만든 뒤)과 `master`는 protected로 둔다. push는 막고 병합 권한은 인프라 담당과 지정한 리뷰어로 좁힌다(동결 중에는 10.6절). 사용자 단위 지정은 Premium 이상에서만 가능하다 (확인: GitLab 문서). Free면 Maintainer 역할을 인프라 담당과 지정한 리뷰어로만 둔다.
- Merge method는 fast-forward merge로 한다. 병합 시점의 자동 rebase(Enable automatic rebase prior to merge)는 켜지 않는다(이 서버 18.11에는 옵션이 없다). 켜면 rebase한 결과에 파이프라인이 다시 돌지 않아 검증하지 않은 SHA가 병합된다 (확인: GitLab 문서).
- 병합할 때 squash(Squash commits when merging)는 `Do not allow`로 둔다. squash는 새 커밋을 만들어 파이프라인이 검증한 SHA와 달라진다.
- "Pipelines must succeed"와 "All threads must be resolved"를 켠다.
- 병합한 뒤 source branch를 지운다.
- "Auto-cancel redundant pipelines"를 켠다(구현 시 확인). 같은 브랜치에 새 커밋이 오면 이전 파이프라인의 verify 잡이 취소된다. verify 잡만 `interruptible`이다.
- "Prevent outdated deployment jobs"를 켜고 `process_mode`를 `oldest_first`로 바꾼다(6.2절).
- 브랜치 이름과 커밋 메시지는 저장소 루트의 `CONTRIBUTING.md`(lefthook으로 검사)를 따른다. 브랜치는 `[플랫폼/]<타입>/<설명>-<Jira키>`, 커밋은 `<:gitmoji:> <type>(<scope>): <설명> (<Jira 키>)`이고 type은 소문자, 인프라 작업의 scope는 `infra`다. `develop`과 `master`는 이름 검사에서 제외된다.
- MR 승인은 설정으로 강제할 수 없다(CE에 승인 규칙이 없다). 병합 권한을 Maintainer로 좁히고 MR 설명에 체크 항목을 둔다.

**병합 순서**

- fast-forward 병합은 병합 전에 source 브랜치를 target 위로 rebase해야 한다. 그래서 병합은 한 번에 하나씩 일어나고, 병합될 때마다 남은 MR은 rebase하고 파이프라인을 다시 돌린다.
- 병합 커밋(3-way merge)은 쓰지 않는다. 브랜치는 `git rebase origin/master`로 최신화하고 `git pull --rebase`로 당겨받는다. 로컬에서는 lefthook의 `pre-merge-commit`이, MR에서는 CI의 `lint:history`가 병합 커밋을 막는다. GitLab의 fast-forward 병합은 병합 커밋이 든 브랜치도 받아주므로 이 검사가 필요하다.
- merge train은 쓰지 않는다. Premium·Ultimate 기능이고 fast-forward와 완전히 호환되지 않는다 (확인: GitLab 문서).
- 병합 권한자는 준비된 MR을 먼저 올라온 순서로 하나씩 병합한다. 대기가 길면 변경이 작은 MR부터 병합한다.
- verify 러너가 B 한 대(`concurrent 1`)라 MR이 몰리면 큐가 길어진다. 파이프라인에는 시간 상한(`timeout`, 예: 30분, 제안값)을 둔다.
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

- 환경별 앱·토큰을 분리한다(`fit-dev-*`, `fit-prod-*`). FastAPI와 임베딩·리랭커·LLM 엔드포인트가 모두 이 앱이다.
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
5. dev와 prod는 Modal 앱·토큰을 나누고, 가능하면 Modal 환경도 나눠 환경별 지출 한도를 건다(플랜에 따라 가능한지는 미확인).

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
| 13 | 테스트 | 최신 Testcontainers(Docker 29 호환). Gradle `-Xmx768m`, 테스트 포크 768MB. OpenSearch 컨테이너 테스트 금지(모킹 사용). Testcontainers가 쓰는 이미지는 arm64 변형이 있어야 한다 | B에서 실행(4.2절) |
| 14 | Redis | 멱등성 키 등은 noeviction 전제, requirepass | 7.3절 |
| 15 | SSE | `text/event-stream`, `Last-Event-ID` 재연결 처리. 배포 전환 때 연결이 끊긴다 | 5절 |
| 16 | API 하위호환 | 직전 배포의 PWA 번들(서비스 워커 캐시)이 호출해도 동작해야 한다(한 버전). 필드 삭제·의미 변경은 expand/contract | 6.8절 버전 스큐 |
| 17 | 폴백 표시 | 폴백으로 처리한 응답에는 `X-Fallback`(사유 목록) 헤더를 붙인다 | smoke가 Modal 연동 누락을 폴백에 가려진 채 통과시키지 않게(A603 교훈), 6.3절 |
| 18 | 속도 제한 | Modal을 부르는 API(검색, 요청 해석 등)에 사용자별·IP별 분당·일일 상한(Redis)과 질의 길이 상한을 건다. 초과는 429, 전역 일일 예산 소진은 키워드 폴백 | 비용 남용 방어, 11.2절 |
| 19 | 배치 | 배치는 한 번에 하나만 돈다(ShedLock 등). Blue/Green 겹침 구간에 두 색에서 동시에 돌지 않게 한다. dev는 `BATCH_ENABLED=false`가 기본이다 | Modal 비용 이중 발생 방지, 10.7절 |
| 20 | Dockerfile | CI가 만든 jar를 `COPY`만 한다(멀티스테이지 빌드 금지). 베이스 이미지는 핀한다 | A의 CPU 크레딧 절약, 6.3절 |

### 12.2 AI (FastAPI, Modal)

AI 팀과 M1 전에 합의한다. FastAPI는 Modal에서 돌고 A·B에는 AI 컨테이너가 없다. BE가 Modal 엔드포인트를 HTTPS로 호출한다.

1. 환경별 Modal 앱(`fit-dev-*`, `fit-prod-*`)과 토큰을 분리한다. URL과 토큰은 BE의 서버 env(`/etc/fit/<env>.env`)에 둔다. 토큰은 코드와 repo에 두지 않는다. 엔드포인트는 모두 `requires_proxy_auth=True`로 보호하고 BE가 `Modal-Key`·`Modal-Secret` 헤더로 호출한다(11.2절).
2. 엔드포인트는 임베딩(12.3절), 리랭커, 요청 해석(LLM)이다. 요청·응답 스키마, 오류 코드, 최대 입력 길이와 배치 크기 상한을 AI 팀이 명세하고, 응답에 모델 버전을 싣는다.
3. 콜드 스타트: 첫 호출 지연의 상한과 상시 가동할 컨테이너 수를 AI 팀이 비용 상한과 함께 정한다. BE 타임아웃은 이 값에 맞춘다(11.2절).
4. 서버 쪽 방어도 둔다: 동시성 상한과 요청당 비용 상한. BE의 일일 호출 예산과 별개다.
5. 로그는 JSON이고 비밀·개인정보를 마스킹한다. 요청 텍스트를 그대로 남기지 않는다.
6. 테스트와 배포(`modal deploy`)는 AI 팀이 맡는다. 인프라 CI는 `ai/`를 다루지 않는다(6.3절).
7. 임베딩 모델을 바꾸면 벡터 공간이 달라지므로 새 인덱스 재색인과 별칭 전환이 필요하다(RB-11). 모델 버전은 응답과 BE 지표에 노출한다.

### 12.3 임베딩 엔드포인트 (Modal)

- `POST /embed` `{"texts": [...], "kind": "query|passage"}` → `{"model": "<이름>@<버전>", "dim": <모델별>, "vectors": [...]}`, 응답 헤더 `X-Model-Version`.
- 요청당 최대 길이와 배치 크기 상한은 AI 팀이 정하고 명세에 적는다. BE는 이를 넘지 않게 나눠 보낸다.
- 기본 모델(snowflake-arctic-embed-l-v2.0)은 568M 파라미터이고 차원 1024다 (확인). 파인튜닝판 `dragonkue/snowflake-arctic-embed-l-v2.0-ko`의 값은 (미확인).
- 질의(`query`)는 검색마다 호출돼 지연이 사용자에게 직접 보인다. 문서(`passage`)는 새벽 배치에서 대량으로 호출돼 비용과 직결되므로 배치 크기와 일일 예산을 정한다.

### 12.4 공통 환경변수

- `KEY=VALUE`만 쓴다. 공백·따옴표·CRLF·`#`을 금지한다.
- 필수·선택을 구분한 목록은 [contracts/env.md](contracts/env.md)에 있고 `check_env_contract.py`가 예제 파일과 맞춰 본다.
- 파일 소비자가 셋(compose 보간, 서비스 `env_file:`, 마이그레이션 일회성 컨테이너)이라 가장 보수적인 형식을 쓴다.
- compose `env_file`은 컨테이너 생성 시점에 굳으므로 파일만 고치면 반영되지 않고 재생성이 필요하다.
- `$`를 쓰는 값(bcrypt 해시 등)은 base64로 인코딩해 둔다(13.2절).

### 12.5 프런트(PWA)

프런트 팀과 M1 전에 합의한다. 합의되면 `docs/infra/contracts/`로 분리한다.

| # | 항목 | 요구 | 이유 |
|---|---|---|---|
| 1 | 정적 빌드 | `fe/`가 잠금 파일 기준 설치(`pnpm install --frozen-lockfile`, 패키지 매니저는 `package.json`의 `packageManager` 필드)와 빌드 명령으로 정적 산출물을 만든다. Next.js는 `output: 'export'`를 쓰고 산출물은 `out/`이다. SSR 서버(Node)와 서버 기능(쿠키 읽기, Server Actions, 동적 Route Handler, `rewrites`·`redirects`·`headers`, 기본 이미지 최적화 로더)은 쓰지 않는다(Next.js 정적 export 미지원 목록). 필요하면 먼저 알린다 | 서버에 Node 런타임이 없다(6.8절) |
| 2 | 같은 출처 | API는 `/api`, 사진은 `/fit-<env>-photos/` 상대 경로로 호출한다. 호스트·포트를 번들에 박지 않는다. 로컬 개발만 프록시를 쓴다(정적 export는 `rewrites`를 쓸 수 없어 방식은 프런트 팀이 정한다) | CORS가 필요 없다(5절) |
| 3 | 환경 값 | 번들에 환경별 값을 넣지 않는다. 시작할 때 `/config.json`을 받아 쓰고(없으면 오류 화면) 키 목록은 `contracts/env.md`에 둔다. 브라우저에 공개되는 값만 둔다. 빌드 메모리는 1.5GB 이내(예: `NODE_OPTIONS=--max-old-space-size=1536`) | 번들 하나로 dev 검증을 prod에 그대로 쓴다(6.8절). 빌드타임 설정 누락(A503) 방지, B의 CI 메모리 한도(4.2절) |
| 4 | 서비스 워커 | 루트 `/sw.js`와 `/manifest.webmanifest`로 경로를 고정한다. `/api/*`, 사진 경로, `/config.json`은 캐시하지 않는다(네트워크 전용). 새 서비스 워커의 활성화 정책은 프런트 팀이 정하되 API 한 버전 하위호환(BE #16)을 전제로 한다 | 5절 캐시 정책, 6.8절 버전 스큐 |
| 5 | 파일명 | 정적 자산은 내용 해시를 파일명에 넣는다 | `immutable` 캐시 전제 |
| 6 | dev 게이트 | dev는 `/?k=`로 첫 접속해 쿠키를 받는다(2주 유지). manifest와 아이콘은 게이트 밖이다 | 5절 |
| 7 | 쿠키 | prod(443)와 dev(8443)는 같은 호스트명이라 쿠키가 포트로 격리되지 않는다. 쿠키를 쓰면 이름에 환경 접두사를 붙인다(`fit_prod_`, `fit_dev_`). Caddy가 8443에서 `fit_prod_` 쿠키를 지워 dev BE로 새지 않게 하고, prod 인증 쿠키는 HttpOnly로 둔다 | 환경 간 쿠키 덮어쓰기와 유출 방지. localStorage와 서비스 워커는 출처별로 분리된다 |
| 8 | SSE | 브라우저 `EventSource`는 `Authorization` 헤더를 붙일 수 없다. fetch 기반 스트림 등으로 구현하고 `Last-Event-ID` 재연결을 직접 처리한다 | BE #15, 배포 전환 시 연결이 끊긴다 |
| 9 | 푸시 | 방식(FCM 웹 푸시 또는 VAPID)은 프런트·BE 팀이 정하고 키는 서버 env에 둔다 | 11.3절, 16절 |
| 10 | 공유 | 장소 공유는 외부 지도(네이버) 링크를 Web Share API(`navigator.share`)로 보내고, 미지원 환경은 클립보드 복사로 대체한다. 우리 서버는 링크 미리보기(OG 태그)를 만들지 않는다. Fit Dining URL 자체를 공유해야 하면 BE가 `/share/<id>`에서 OG 태그만 담은 HTML을 내려주고 Caddy가 그 경로만 BE로 보낸다(그때 추가) | SSR 없이 공유가 해결된다. 장소 ID 확보는 16절 #19 |

## 13. 보안 요약

### 13.1 포트

| 호스트 | 포트 | 바인딩 | 용도 |
|---|---|---|---|
| A | 22 | 0.0.0.0 (ufw limit) | SSH |
| A | 80 | 0.0.0.0 | ACME, 301 |
| A | 443 | 0.0.0.0 | prod |
| A | 8443 | 0.0.0.0 | dev |
| A | 3000, 8888, 9090, 5432 | 127.0.0.1 | Grafana, Dozzle, Prometheus, Postgres(dev role 터널) |
| B | 22 | 0.0.0.0 (ufw limit) | SSH |
| B | 9090, 9093 | 127.0.0.1 | Prometheus-B, Alertmanager-B(터널) |

그 외에는 호스트 바인딩이 없다. CI의 포트 규칙 검사와 B의 포트 노출 감사가 이 표를 지킨다.

### 13.2 시크릿

| 파일 | 호스트 | 권한 | 내용 |
|---|---|---|---|
| `/etc/fit/prod.env`, `dev.env` | A | root:docker 0640 | 앱 env(Modal URL·토큰 포함) |
| `/etc/fit/data.env` | A | root:docker 0640 | DB·Redis·Garage 자격 |
| `/etc/fit/edge.env` | A | root:docker 0640 | `ACME_EMAIL`, `ACME_CA`, `PUBLIC_HOST`, B의 IP, `/_ops` basic auth 해시, dev 게이트 키(`?k=` 쿠키 발급용) |
| `/etc/fit/obs.env` | A | root:docker 0640 | Grafana admin, Mattermost 웹훅 |
| `/etc/fit/keys/` | A | root:root 0400 | vault SSH 개인키, B 접속 정보, age 공개키(호스트 간 전송용) |
| `/etc/fit/ops.env` | B | root:docker 0640 | Mattermost 웹훅, A의 `/_ops` 자격 |
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

키 자체는 repo에 두지 않는다. 배포 러너 사용자(`gitlab-runner`)는 `/etc/fit/keys/`를 읽지 못한다(root 0400, systemd timer만 사용).

### 13.4 한계

- docker 그룹은 사실상 root라서, 배포 러너 사용자가 키를 못 읽는다는 것은 우발적 노출을 막는 수준이고 악의적인 CI 코드까지 막지는 못한다. 이를 막는 것은 protected 브랜치와 MR 리뷰다.
- B의 verify 러너는 docker.sock으로 B의 root 권한을 가지므로 `ops.env`(웹훅, `/_ops` 자격)를 읽을 수 있다. A에 대한 SSH 키는 B에 없다. 그러나 같은 권한으로 `/srv/vault/store`(금고)를 지울 수도 있다. A에 로컬 사본(48시간 + 14일)이 남고 복원 리허설 때 내려받은 최신 덤프 1벌을 노트북에 둔다(8절). MR 파이프라인에서 임의 코드가 돌 수 있으므로 프로젝트 멤버를 팀원으로 한정하고 MR 리뷰 후 병합한다.
- Modal 토큰이 유출되면 지출이 생긴다. 토큰은 환경별로 분리해 서버 env에만 두고, Modal의 지출 한도와 BE의 일일 호출 예산이 상한이다(11.2절).
- OpenSearch는 보안 플러그인을 끈다. 내부 망이고 호스트 게시가 없다는 전제이며, 앱 컨테이너가 침해되면 인덱스가 변조될 수 있다. DB 자격 침해와 같은 수준의 위험으로 보고 수용한다. 두 환경의 BE가 `net-data`를 공유해 be-dev가 prod 인덱스를 읽고 쓸 수 있다. 기동 시 접두사 대조(12.1 #8)는 사고를 막지만 악의는 막지 못한다.
- 개인정보는 로그 마스킹(12절), 백업 암호화(8절), 종료 시 삭제(RB-10), 외부 전송 고지(11.2절)로 다룬다.

## 14. 일정과 우선순위

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 사전 (서버 없이) | `infra/` 골격, compose, Caddyfile, 배포·롤백·백업·복원 스크립트, 알림 규칙 + promtool 테스트, 대시보드, 로컬 dev compose, 런북 초안, `.gitlab-ci.yml`, GitLab 프로젝트 설정(브랜치 보호·병합 규칙, 10.8절) | 로컬 기동, `compose config`, shellcheck, promtool test, `caddy validate` 통과. 로컬에서 Blue/Green 전환 시뮬레이션 |
| M0 수령 +0~1일 | A·B 실측과 bootstrap(ufw·SSH·Docker), A 정적 IP와 B Elastic IP 부착 확인, 호스트 간 연결 실측(A→B SSH, B에서 A의 TCP 22 도달성. B→A HTTPS 프로브는 Caddy가 뜨는 M1에서) | `verify-host.sh` 전부 PASS, 서버 밖에서 열린 포트가 A·B 모두 22뿐(Caddy 전이므로), ufw 허용 규칙 확인, 호스트 간 연결 확인 |
| M1 +2~4일 | Caddy + TLS(운영 인증서는 첫날 발급, staging은 하루 안에), data 스택, 러너 2개(A의 deploy, B의 verify)와 병합 조건 강화(gitlab-setup.md 2단계), dev 첫 배포와 prod 첫 배포(교체형, 같은 SHA. PWA 정적 서빙 포함), B의 ops 스택(프로브) | `verify-edge.sh`·`verify-data.sh` PASS, 서버 밖에서 A의 80/443/8443 도달(B 프로브 포함), dev·prod `/healthz` 200, dev PWA 로드(쿠키 게이트 통과 시), BE→Modal dev 호출 성공(콜드 스타트 지연 실측) |
| M2 +5~9일 | 파이프라인 완성(Testcontainers, PWA 빌드·배치 포함), Blue/Green, 관측성 + B 외부 감시, 백업 → 금고, 포트 노출 감사, 복원 리허설 #1, 개발자 접근 | 배포 E2E(정상·실패 롤백), 알림 테스트 발화, 복원 성공 + RTO 기록 |
| M3 +10~14일(늦어도 11/03) | 리허설 #1(10.3절), 메모리·CPU 튜닝, 경량 부하 시험, 첫 공개 준비(10.7절), 포팅 매뉴얼 초안 | 리허설 체크리스트 전부 통과 |
| M4 ~11/04 | 리허설 #2, 런북 완결, 당번표, 동결 | 동결 후 변경은 핫픽스 절차로만 |
| 운영 11/06~11/18 | 일일 digest, 알림 대응, 핫픽스 배포 | |
| 종료 11/18 | RB-10: 최종 백업, 합성 덤프, 실데이터 삭제 | |

**일정 규칙**

- 수령일을 D라 하면 M3의 끝은 D+14일과 11/03 중 빠른 날이다. 예를 들어 10/22에 받으면 M3가 11/01~11/05가 되어 동결(11/04)과 겹친다.
- prod 첫 배포는 M1에서 한다(1.4절의 "prod를 일찍 띄워 리허설한다").
- 우선순위(P0·P1·P2)는 서버 수령일과 관계없이 지금부터 적용한다. 11/03까지 끝나지 않은 P1은 공개 뒤로 미룬다.

**우선순위**

- **P0 (11/06 필수):** A·B bootstrap과 하드닝(정적 IP·EIP 포함), TLS·엣지(PWA 서빙 포함), 롤백 가능한 prod 배포, 백업 → 금고 + 덤프 시점 검증 + 사람 복원 리허설, 메모리 한도와 스왑, B의 외부 감시(프로브, 포트 노출 감사, 감시 체계 감시) + critical 알림, 핵심 런북, 서버 전용 시크릿, 브랜치 보호·병합 설정(10.8절), 배포 순서 보장(`oldest_first`, outdated 배포 보호, 다운그레이드 가드), 외부 호출 계약(Modal 키워드 폴백·예산·속도 제한, 킬스위치), PWA 산출물 검사
- **P1:** Blue/Green(폴백은 헬스 게이트 교체형), 대시보드, daily digest, dev 알림 분리, 개발자 터널, gitleaks·마이그레이션 게이트·arch 검사, Garage(폴백 R2), cAdvisor(컨테이너 메모리·재시작 알림), 경량 부하 시험(k6)
- **P2:** Dozzle, GitLab Package Registry 2차 사본, Lightsail 스냅샷, `verify-x86`, Modal 배포 잡, 정식 부하 시험(경량 부하 시험은 P1)

## 15. 리스크

| # | 리스크 | 대응 |
|---|---|---|
| 1 | A 메모리(OpenSearch) | 한도, 스왑, OOM 알림. 비상안은 dev 스택 중지. 한도 합계가 약 8.3GB(16GB의 52%)로 여유가 크다 |
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
| 14 | PWA 서비스 워커 캐시로 옛 번들이 새 API를 호출(버전 스큐) | API 한 버전 하위호환(BE #16), `no-cache` 헤더, 이전 릴리스 자산 보관(6.8절) |
| 15 | staging 인증서로는 PWA를 테스트할 수 없음 | 운영 CA 인증서를 프런트 테스트 전에 확정(5절). 재발급 한도 때문에 `caddy_data` 보존 |
| 16 | prod·dev가 같은 호스트명이라 쿠키가 겹침 | 쿠키 이름에 환경 접두사, Caddy가 8443에서 prod 쿠키 제거(5절, 12.5절) |
| 17 | Let's Encrypt 발급 한도(등록 도메인 공유 가능성)나 발급 실패 | 운영에서 `acme_ca` 미지정으로 ZeroSSL 폴백 유지, M1 첫날 발급, `caddy_data` 즉시 백업 |
| 18 | 유료 Modal 엔드포인트 남용 | 프록시 인증, 사용자·IP별 속도 제한, 질의 길이 상한, 전역 예산(폴백), 지출 한도(11.2절) |
| 19 | stop/start로 공인 IP 변경 | A 정적 IP·B Elastic IP 부착, 인스턴스 stop 금지(1.3절) |
| 20 | MR이 몰려 verify 큐가 길어지고 병합 순서가 꼬임 | fast-forward 직렬 병합, 파이프라인 `timeout`, 작은 MR 우선(10.8절) |
| 21 | 옛 SHA가 나중에 배포됨 | `oldest_first`, outdated 배포 보호, `deploy.sh` 다운그레이드 가드(6.2·6.4절) |
| 22 | `develop`의 미완성 코드가 prod로 승격됨 | `develop`은 항상 배포 가능, 미완성은 `*_ENABLED` 스위치 뒤(10.8절) |

## 16. 미결정·확인 필요

| # | 항목 | 담당 | 해소 시점 |
|---|---|---|---|
| 1 | A·B 실제 스펙(RAM, vCPU, 디스크, 스왑, OS, Docker 버전, 아키텍처, CPU 소진 후 동작) | 인프라 | M0 |
| 2 | 서버 수령일 | 인프라 | 즉시 확인 |
| 3 | 도메인 접두사와 B의 도메인·공인 IP | 인프라 | M0 |
| 4 | Lightsail/EC2 방화벽 접근 권한, Lightsail 스냅샷 권한 | 인프라 | M0 |
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
| 15 | Docker 29일 때 cAdvisor·Dozzle 호환 | 인프라 | 사전(로컬 Docker 29.7.2로 확인) |
| 16 | 포팅 매뉴얼 필요 여부와 양식 | 팀, 코치 | M3 전 |
| 17 | `rrsync` 가용성, buildx 자원 상한 방법 | 인프라 | M0~M1 |
| 18 | 프런트 팀 합의: 12.5절 계약(정적 빌드, 같은 출처, 환경 값, 서비스 워커, dev 게이트, 쿠키, SSE, 공유) | 프런트 팀, 인프라 | M1 전 |
| 19 | 가게 데이터에 네이버 장소 ID(또는 URL)가 포함되는지. 없으면 상호·주소 검색 링크로 대체(정확도 낮음) | BE·AI 팀 | M1 전 |
| 20 | Modal 워크스페이스 접근 권한, 지출 한도·알림 설정 담당, 콜드 스타트·상시 가동 정책과 비용 상한 | AI 팀, 인프라 | M1 전 |
| 21 | 문서 벡터를 Postgres(pgvector)에도 저장하는지(재색인 시 Modal 호출 회피) | BE·AI 팀 | M1 전 |
| 22 | 검색·요청 해석 API를 비로그인으로 허용하는지(허용하면 IP당 일일 횟수 제한) | BE·AI 팀 | M1 전 |
| 23 | 예상 규모(동시 사용자, 피크 RPS, 문서·벡터 수, 사진). 4.4절 자리표시자 확정 | 팀 | M1 전 |
| 24 | prod 첫 데이터 적재·임베딩 백필의 담당·일정, 소요 시간과 비용 추정 | BE·AI 팀 | M1 전 |
| 25 | `process_mode` 변경에 쓸 API 토큰 권한(Maintainer 이상). 승인 규칙·CODEOWNERS 강제는 CE에서 쓸 수 없다(확인) | 인프라, 팀장 | 사전~M0 |

## 17. 산출물

```
infra/
  host/        bootstrap.sh, verify-host.sh, daemon.json, sysctl.d, sshd drop-in, fail2ban, systemd units
  edge/        compose.edge.yml, Caddyfile, snippets/
  data/        compose.data.yml, ensure-databases.sh, opensearch/Dockerfile, garage/ 설정과 초기화 스크립트
  app/         compose.app.yml, compose.prod.yml, compose.dev.yml, *.env.example
  obs/         compose.obs.yml, prometheus/(rules, tests), alertmanager/, grafana/(provisioning, dashboards), blackbox/
  ops/         (B) compose.ops.yml, prometheus/, alertmanager/, blackbox, port-audit.sh, vault-ingest.sh
  deploy/      deploy.sh, rollback.sh, preflight.sh, smoke.sh, notify.sh, fit-up.sh
  backup/      pg-backup.sh, verify-dump.sh, push-vault.sh, photos-backup.sh, restore-check.sh(노트북용)
  ci/          ports_invariant.py, check_compose_projects.py, check_env_files.py, check_env_contract.py, check_eol.py, check_linear_history.py, no-merge-commit.sh, migration_immutability.py, images_arch.py, run-local-checks.sh, tool-images.sh, compose-projects.txt, tests/
  local/       compose.yml (profile: core, search), fit-local.sh, local.env.example, garage/, opensearch/Dockerfile, README.md
.gitlab-ci.yml
docs/infra/
  design.md    이 문서
  runbooks/    RB-01 ~ RB-13
  porting/     포팅 매뉴얼 초안(버전, 환경변수, 외부 서비스, DB 덤프, 시연)
  contracts/   README.md(합의 상태), env.md. BE·AI(Modal 호출)·프런트 계약은 합의되면 이 폴더로 옮긴다
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
| 구성 | 서버 | 기본 지급 Lightsail xlarge 1대(A) + EC2 c6g.large 1대(B) + 공용 GPU 서버(학습 전용) + Modal | |
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
| 프런트 | 프런트 | PWA. CI가 빌드하고 A의 Caddy가 같은 출처로 정적 서빙 | Flutter 앱 + Firebase App Distribution, 별도 정적 호스팅(출처가 갈려 CORS와 쿠키가 복잡해진다) |
| 프런트 | 디렉터리 | `fe/`(repo의 실제 구조) | |
| 프런트 | 렌더링 | 정적 SPA(PWA는 특정 프레임워크를 요구하지 않는다). 프레임워크는 프런트 팀이 고른다 | Next.js SSR(Node 상주, 컨테이너와 Blue/Green이 늘어난다. A의 한도 최악 합계는 약 12.7GB라 예산에는 들어간다) |
| 프런트 | 환경 값 | 번들 한 번 빌드 + 환경별 `/config.json` | 환경별 빌드(prod 번들이 dev에서 검증되지 않고, 빌드타임 값 누락 위험) |
| 프런트 | 배치 | 릴리스 디렉터리 + 심볼릭 링크 원자 전환(롤백은 링크 되돌리기) | 컨테이너 이미지로 서빙(메모리·Blue/Green 부담) |
| 프런트 | 링크 공유 | 외부 지도(네이버) 링크 + Web Share API. 자체 URL 공유가 필요해지면 BE `/share/<id>` | 자체 공유 페이지를 SSR로 렌더링(OG 태그) |
| 프런트 | dev 접근 제한 | `/?k=` 쿠키 게이트(Caddy, 쿠키 없으면 404) | `X-Fit-Dev-Key` 헤더(브라우저 탐색에 못 붙임), 전체 basic auth(`Authorization` 헤더가 JWT와 충돌) |
| 데이터 | 사진 저장소 | Garage | 외부(R2, Firebase Storage) |
| 데이터 | 사진 읽기 | Garage 웹 엔드포인트 + Caddy(`confirmed/`만) | presigned GET(URL이 매번 달라 캐시가 안 된다) |
| 보안 | 비용 방어 | Modal 프록시 인증 + 사용자·IP 속도 제한 + 전역 예산 | 전역 예산만(한 명이 소진시키면 모두 폴백) |
| 보안 | 팀원 접근 | 비특권 계정 + SSH 터널 | infra 담당만, 전원 sudo |
| 백업 | 백업 키 | 서버에 두지 않고 2인 오프라인 보관 | B에 키를 두고 복원 자동화 |
| 백업 | 호스트 밖 백업 위치 | B 금고. GitLab Package Registry는 선택적 2차 사본(P2) | GitLab Package Registry를 주 저장소로 |
| 관측성 | B 감시 구성 | Prometheus-B·Alertmanager-B·blackbox(설정이 repo에 남는다) | Uptime Kuma 한 개(설정이 UI에 남아 repo 관리 원칙과 어긋난다) |
| 관측성 | 우선순위 | 감시 체계 감시(`/_ops`)는 P0, `lint:image-arch`는 P1 | 둘 다 P2로 내리기(비용이 거의 없어 유지) |

## 부록 C. 출처

- [Lightsail instance bundles](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html)
- [Baseline CPU performance and burst capacity](https://docs.aws.amazon.com/lightsail/latest/userguide/baseline-cpu-performance.html)
- [Identify when your Lightsail instance bursts](https://docs.aws.amazon.com/lightsail/latest/userguide/identifying-instance-burst.html)
- [AWS EC2 C6g instances](https://aws.amazon.com/ec2/instance-types/c6g/)
- [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Caddy global options](https://caddyserver.com/docs/caddyfile/options)
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
