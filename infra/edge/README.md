# 엣지 (Caddy)

서버 A의 `fit-edge` 프로젝트다. 80·443만 게시하고 prod와 dev는 호스트(`PROD_HOST`, `DEV_HOST`)로 나눈다. 뒤에는 Next.js(SSR) FE와 BE가 있다. 설계는 [design.md](../../docs/infra/design.md) 5절이다.

## 자주 하는 일

| 하고 싶은 일 | 명령 |
|---|---|
| 지금 상태와 활성 색 보기 | `bash infra/edge/edgectl.sh status` |
| 설정 문법만 검사 | `bash infra/edge/edgectl.sh check` |
| 설정이나 상태 파일을 적용(무중단) | `bash infra/edge/edgectl.sh reload`, 이어서 `verify-edge.sh` |
| 엣지가 정상인지 점검 | `bash infra/edge/verify-edge.sh --prod https://<PROD_HOST> --dev https://<DEV_HOST> --dev-key <키> --http http://<PROD_HOST>` |
| DNS를 바꾸기 전에 서버만 점검 | 위 명령에 `--resolve <호스트>:443:<서버 IP>`를 호스트마다 더한다 |
| 노트북에서 엣지 전체를 시험 | `bash infra/edge/test/test-edge.sh up`, `verify`, `down` |

`edgectl.sh`는 `/etc/fit/edge.env`를 읽는다(`FIT_EDGE_ENV`로 바꿀 수 있다). 배포 스크립트도 같은 `reload`를 부른다.

## 요청 흐름

```
브라우저 ─443→ caddy ┬ /_next/static/*                ─→ 풀(pool)에 있으면 Caddy가 직접, 없으면 FE
                     ├ /api/*, /healthz               ─→ BE(활성 색)
                     ├ /fit-<환경>-photos/*           ─→ garage S3 API(업로드)
                     ├ /photos/<환경>/confirmed/*     ─→ garage 웹 엔드포인트(읽기)
                     └ 그 외 전부                     ─→ FE(활성 색, Next.js SSR)
FE 서버 ─ caddy:8081(prod), caddy:8082(dev) ─→ BE(활성 색)
```

FE 서버가 BE를 부를 때는 Caddy의 내부 리스너를 거친다(`BE_INTERNAL_URL`). 활성 색을 고르는 곳이 상태 파일 한 곳이라 FE는 BE의 색을 모른다. 내부 리스너는 호스트에 게시하지 않는다. 같은 망의 컨테이너는 포트만 맞으면 어느 환경의 리스너에도 닿으므로 `BE_INTERNAL_URL`의 포트가 환경과 맞는지는 배포 사전 점검이 확인한다(계획 1C-2).

## 구성

| 경로 | 내용 |
|---|---|
| `compose.edge.yml` | caddy 컨테이너. 값은 `docker compose --env-file /etc/fit/edge.env`로 읽는다 |
| `conf/Caddyfile` | 호스트별 사이트, 환경별 라우팅(`env_routes` 한 곳), dev 게이트, 로그. 설정 디렉터리째 마운트한다 |
| `conf/acme/`, `conf/hsts/` | `ACME_MODE`, `HSTS_MODE`가 고르는 조각 |
| `state-sample/` | 활성 색 upstream 파일의 형식 견본(환경 × 서비스 네 개) |
| `edge.env.example` | `/etc/fit/edge.env`의 키(계약은 [env.md](../../docs/infra/contracts/env.md)의 edge 그룹) |
| `edgectl.sh` | 상태, 검사, reload |
| `verify-edge.sh` | 라우팅, 캐시, 헤더, dev 게이트를 HTTP로 점검한다 |
| `test/` | 노트북에서 엣지를 시험하는 환경(목 BE·FE, 시험용 풀, 로컬 스택의 garage) |

## 바꿀 곳

| 바꾸려는 것 | 바꿀 곳 |
|---|---|
| 도메인·호스트 이름 | `edge.env`의 `PROD_HOST`, `DEV_HOST`와 DNS A 레코드. Caddyfile은 그대로다 |
| 라우트 추가·수정 | `conf/Caddyfile`의 `env_routes` 한 곳(prod와 dev에 같이 적용된다). 고친 뒤 `edgectl.sh check`와 `test-edge.sh verify` |
| BE·FE 활성 색 전환 | `/srv/fit/state/upstream-<환경>-<be\|fe>.caddy`(배포 스크립트가 쓴다)와 `edgectl.sh reload` |
| 인증서 단계, HSTS | `edge.env`의 `ACME_MODE`, `HSTS_MODE` |
| dev 접근 키 교체 | `edge.env`의 `DEV_GATE_KEY`를 바꾸고 caddy 컨테이너를 다시 만든다(`docker compose up -d`) |

## 서버가 갖출 것

- DNS: `PROD_HOST`와 `DEV_HOST`의 A 레코드가 서버 A의 공인 IP를 가리켜야 인증서가 발급된다.
- 망 `net-edge`, `net-prod`, `net-dev`, `net-obs`를 먼저 만든다(계획 1F). 이름은 `FIT_NET_*`로 바꿀 수 있다.
- 정적 자산 풀 `/srv/fit/web/<환경>/pool/`. 안에 `_next/static/…`가 URL 경로 그대로 쌓인다. 쌓는 일과 정리는 배포 스크립트가 한다(계획 1C-2).
- 상태 디렉터리 `/srv/fit/state/`에 `upstream-prod-be.caddy`, `upstream-prod-fe.caddy`, `upstream-dev-be.caddy`, `upstream-dev-fe.caddy`. 형식은 `state-sample/`과 같다.
- 인증서 보관 볼륨 `caddy_data`는 지우지 않고 백업한다(재발급 한도).

## 상태 파일을 바꿀 때

임시 이름으로 쓴 뒤 `mv`로 바꾸고 `edgectl.sh reload`를 부른다(`check`를 통과해야 reload한다).

- 문법이 틀린 파일은 `check`와 `reload`가 거부하고 직전 설정이 유지된다.
- 문법은 맞지만 없는 호스트를 가리키면 `reload`를 통과하고 요청이 502가 된다. reload 뒤에는 반드시 Caddy 경유 점검(`verify-edge.sh`)으로 확인한다.

## 인증서 단계

1. 첫날: `ACME_MODE=staging`, `HSTS_MODE=off`로 시작해 발급 경로(80 도달, DNS)를 확인한다.
2. 이어서 `ACME_MODE=production`으로 바꿔 운영 인증서를 받는다. 이때부터 기본 이슈어 둘(Let's Encrypt, ZeroSSL)을 쓴다.
3. 운영 인증서가 확정되면 `HSTS_MODE=on`으로 바꾼다.

## 노트북에서 시험하기

```bash
bash infra/edge/test/test-edge.sh up      # 로컬 스택(garage)과 엣지 시험 환경을 켠다
bash infra/edge/test/test-edge.sh verify  # verify-edge.sh와 동작 시험
bash infra/edge/test/test-edge.sh down    # 두 프로젝트의 컨테이너와 볼륨을 지운다
```

시험 환경은 `https://localhost:18443`(prod), `https://dev.localhost:18443`(dev), `http://localhost:18080`에 뜬다. 인증서는 Caddy의 내부 CA가 발급한 것이라 `-k`가 필요하다. Docker Desktop(Windows)은 새 연결을 간헐적으로 거부하므로 시험 스크립트가 연결 실패만 다시 시도한다.

## 서버에서 점검하기

FE가 배포돼 있어야 한다(SSR 페이지, `/config.json`, `/fe-healthz`, `/sw.js`, `/manifest.webmanifest`). 키는 출력하지 않는다.
