# 호스트 (bootstrap)

서버 A(`app`, EC2 x86)와 B(`ops`, EC2 Arm)를 설계 3절의 상태로 만들고 점검한다. 설계는 [design.md](../../docs/infra/design.md) 3절이다. Ubuntu 22.04와 24.04에서 시험했다.

## 서버에서 하는 순서

1. 관리자 계정으로 키 SSH 접속이 되는지 **다른 터미널에서 먼저 확인**한다. bootstrap이 비밀번호 로그인을 끈다.
2. `infra/host/` 디렉터리를 서버로 복사한다(`scp -r infra/host <서버>:~/host`). 이 디렉터리만 있으면 된다.
3. 설계 3.1절의 Day-0 실측을 돌리고 결과를 붙여 준다.
4. 적용한다. `FIT_PEER_IP`에는 상대 서버(A면 B, B면 A)의 공인 IP를 넣는다.

   ```bash
   sudo ROLE=app FIT_PEER_IP=<B의 공인 IP> bash ~/host/bootstrap.sh   # 서버 A
   sudo ROLE=ops FIT_PEER_IP=<A의 공인 IP> bash ~/host/bootstrap.sh   # 서버 B
   ```

5. 점검한다. 전부 PASS여야 한다: `sudo bash ~/host/verify-host.sh`
6. 서버 밖(노트북)에서 포트를 확인한다: `Test-NetConnection <호스트> -Port 22`(열림), `80`, `443`(Caddy 전에는 닫힘). 클라우드 방화벽(EC2 보안 그룹)도 같은 포트만 열려 있는지 사람이 본다.
7. A의 `fit-dev` 계정에 팀원 공개키를 한 줄씩 넣는다(`/home/fit-dev/.ssh/authorized_keys`). 팀원은 `ssh -N -L 5432:127.0.0.1:5432 fit-dev@<호스트>`처럼 터널만 만들 수 있다.

몇 번을 다시 실행해도 같은 결과다. 마지막 줄이 `변경 없음`이면 이미 설계대로다.

## 구성

| 경로 | 내용 |
|---|---|
| `bootstrap.sh` | 적용 스크립트(`ROLE=app\|ops`). A는 `/srv/fit/state`, `/srv/fit/web`을 `root:docker 2775`로 만든다(setgid라 deploy 러너(`gitlab-runner`, docker 그룹)가 쓴 파일도 docker 그룹이 되고, Caddy는 others로 읽기만 한다). 이미 있는 파일의 그룹은 서버에서 한 번 맞춘다(`chgrp -R docker /srv/fit/state /srv/fit/web && chmod -R g+rwX /srv/fit/state /srv/fit/web`) |
| `verify-host.sh` | 읽기만 하는 점검. PASS, FAIL, SKIP만 출력하고 IP·키 값은 찍지 않는다 |
| `networks.sh` | 서버 A의 공유 Docker 망 여섯 개(`net-edge`, `net-prod`, `net-dev`, `net-data`(internal), `net-obs`, `net-dbaccess`). bootstrap이 부르고 직접 실행해도 된다 |
| `runner.sh` | GitLab Runner 설치와 등록(`install`, `register`, `tune`, `status`). 아래 CI 러너 절 |
| `envset.py` | `/etc/fit/*.env`에 환경변수를 넣고 바꾸고 지우는 도구. 아래 환경변수 넣기 절 |
| `docker-prune.sh` | 주 1회 정리. A는 `be`·`fe`의 SHA 태그 최근 5개만 남기고, B는 7일 넘게 쓰지 않은 이미지를 지운다. 볼륨은 지우지 않는다 |
| `conf/` | 설치될 설정: SSH 하드닝(`sshd-*.conf`), sysctl, `daemon-*.json`, fail2ban, 자동 업데이트, systemd 유닛 |
| `test/` | 노트북 시험(Ubuntu 컨테이너와 이 PC의 Docker) |

## CI 러너 (runner.sh)

서버마다 러너 하나를 둔다(설계 6.1절): A는 `fit-deploy`(shell executor, 보호된 브랜치의 job만), B는 `fit-verify`(docker executor + docker.sock). 서버의 역할은 `/etc/fit/role`에서 읽는다. bootstrap이 끝난 서버에서 한다.

```bash
sudo bash ~/host/runner.sh install     # 패키지, 키, 고정, docker 그룹. 토큰이 필요 없다
sudo bash ~/host/runner.sh register    # 토큰을 숨김 입력으로 받아 등록한다
sudo bash ~/host/runner.sh tune        # 이미 등록된 러너의 동시 실행 수를 역할에 맞춘다(토큰 불필요, 재시작 없음)
bash ~/host/runner.sh status           # 읽기 전용 점검(PASS, FAIL, SKIP)
```

- **install:** GitLab 저장소 서명 키를 받아 지문(`F640 3F65 44A3 8863 DAA0 B6E0 3F01 618A 5131 2F3F`)이 코드에 고정한 값과 같을 때만 쓴다. `gitlab-runner`와 `gitlab-runner-helper-images`를 **18.11.4-1**로 고정하고(GitLab 서버 CE 18.11.5와 같은 마이너 버전. 서버를 올리면 `RUNNER_VERSION`도 올린다) `apt hold`로 자동 업데이트가 올리지 못하게 한다. `gitlab-runner` 계정을 docker 그룹에 넣는다(root와 같은 권한이다. 설계 6.1절).
- **러너 만들기:** 등록 전에 GitLab에서 만든다(Settings -> CI/CD -> Runners -> Create project runner. Maintainer 권한). `fit-verify`는 태그 `verify`, Run untagged 끔, Protected 끔. `fit-deploy`는 태그 `deploy`, Run untagged 끔, Protected 켬. 화면에 한 번만 보이는 인증 토큰(`glrt-`로 시작)을 `register`가 숨김 입력으로 받는다. 토큰은 채팅, 문서, 저장소에 붙이지 않고 이 서버의 `config.toml`(권한 600)에만 남는다. 토큰은 명령 인자가 아니라 환경변수로만 넘기고 등록 출력은 버린다.
- **register:** 동시 실행 수(`concurrent`)를 역할에 맞춘다(B의 `fit-verify` 2, A의 `fit-deploy` 1). B는 job 메모리 2GB, CPU 2개, docker.sock을 job에 연다. 이미 등록돼 있으면 건드리지 않는다(`FIT_RUNNER_REREGISTER=1`이면 다시 등록한다. GitLab에서 옛 러너도 지운다).
- **tune:** 이미 등록된 러너의 `concurrent`만 역할에 맞춘다. 토큰이 필요 없고 서비스를 재시작하지 않는다(러너가 `config.toml`을 몇 초마다 다시 읽어 돌고 있는 job이 끊기지 않는다). `FIT_RUNNER_CONCURRENT`(1에서 4)로 B의 값을 바꿀 수 있고 A는 무엇을 줘도 1이다. B에서 가벼운 린터가 무거운 잡(Gradle, Node) 뒤에 줄을 서지 않게 하려는 것이다. 무거운 잡끼리는 `.gitlab-ci.yml`의 `resource_group: verify-heavy`가 한 번에 하나로 묶는다. `status`는 `concurrent`가 역할의 값과 다르면 `tune`을 안내하며 실패한다.
- 환경변수: `FIT_RUNNER_URL`(기본 `https://lab.ssafy.com`), `FIT_RUNNER_ROLE_FILE`, `FIT_RUNNER_CONFIG`, `FIT_SKIP=systemd`(시험용).
- **러너가 도는 잡:** `fit-verify`(B, 태그 `verify`)는 `lint:*`, `be:test`, `fe:test`, `be:build`, `fe:build`, `fe:bundle-check`를(MR에서는 바뀐 경로의 잡만 돈다), `fit-deploy`(A, 태그 `deploy`)는 `build:images`, `deploy:*`, `smoke:*`를 받는다(`.gitlab-ci.yml`, 설계 6.3절, [infra/deploy/README.md](../deploy/README.md)). `fit-deploy`가 `deploy.sh`를 돌려면 `/srv/fit/state`, `/srv/fit/web`이 `root:docker 2775`여야 한다(bootstrap이 만든다).

## 환경변수 넣기 (envset.py)

`/etc/fit/*.env`에 키를 넣고, 바꾸고, 지우고, 상태를 본다. 어떤 키든 되고 값은 화면, 셸 기록, 명령 인자, 출력 어디에도 남지 않는다(출력은 키 이름과 글자 수뿐이다). 서버에는 파일 하나(`envset.py`)와 계약 표(`env.md`)를 `~/host/`에 두고 쓴다.

```bash
sudo python3 ~/host/envset.py list                                      # 이 서버의 env 파일, 키 개수, REPLACE_ME 개수
sudo python3 ~/host/envset.py status fe-prod                            # 계약의 필수 키와 형식 점검(파일 이름을 빼면 전부)
sudo python3 ~/host/envset.py set fe-prod,fe-dev NAVER_MAP_CLIENT_ID=abc123   # 비밀이 아닌 값은 바로 준다
sudo python3 ~/host/envset.py set prod,dev MODAL_KEY MODAL_SECRET       # 키 이름만 주면 숨김 입력(비밀은 이 방식만 된다)
sudo python3 ~/host/envset.py unset dev REVIEW_MOCK_ENABLED             # 키를 지운다
```

- **파일 이름:** 서버 A는 `prod`, `dev`, `fe-prod`, `fe-dev`, `ai-prod`, `ai-dev`, `migrate-prod`, `migrate-dev`, `data`, `edge`, `obs`, `backup`, 서버 B는 `ops`다. 쉼표로 여러 파일에 같은 값을 한 번에 넣는다. 목록 밖의 이름이나 경로는 받지 않고, 없는 파일을 새로 만들지도 않는다.
- **비밀 판별:** 키 이름에 `KEY`, `SECRET`, `PASSWORD`, `TOKEN`, `HASH`, `WEBHOOK`이 단어로 들어 있으면 비밀이다. 비밀은 `KEY=VALUE`로 줄 수 없다(셸 기록과 프로세스 목록에 남는다). 입력을 비우면 그 키는 건너뛴다.
- **형식 검사:** `check_env_files.py`와 같은 규칙이다(공백, 따옴표, `#`, `$`, 백슬래시, 백틱, 보이지 않는 글자 금지. `$`가 필요한 값은 base64). `REPLACE_ME`도 거부한다. `*_BASE_URL`은 끝의 `/`를 지우고 `http(s)://`로 시작해야 한다. 하나라도 어긋나면 어느 파일에도 쓰지 않는다.
- **덮어쓰기:** 이미 값이 있는 키를 바꿀 때는 파일마다 묻는다(`--yes`로 생략). `unset`도 묻는다. 필수 키를 지우면 경고한다.
- **쓰는 방식:** 같은 디렉터리의 임시 파일에 쓰고 바꿔 끼운다. 모드와 소유자(`root:docker 640`)는 그대로다. 다른 줄은 건드리지 않는다.
- **계약 안내:** 키가 계약 표(그룹)에 없으면 알려 준다. 계약 MR을 먼저 올린다. `status`는 필수 키가 비었거나 `REPLACE_ME`인지, 이미 들어 있는 `*_BASE_URL`이 규칙(끝에 `/` 없음, `http(s)://`로 시작)을 지키는지 보여 준다.
- **적용:** 파일만 바뀐다. 실행 중인 컨테이너에는 파일별 안내(`적용(...)`)대로 반영한다. BE·FE는 컨테이너를 만들 때 읽으므로 같은 SHA를 다시 배포한다.
- **서버에 올리기:** `scp infra/host/envset.py docs/infra/contracts/env.md <서버>:~/host/`. 계약 표를 못 찾으면 필수 키 안내만 건너뛴다. 환경변수: `FIT_ENV_DIR`(기본 `/etc/fit`), `FIT_ENV_CONTRACT`.
- **시험:** `python -m unittest infra/ci/tests/test_envset.py`. `check_env_files.py`와 규칙이 같은지, 값이 출력에 새지 않는지, 실패하면 아무것도 쓰지 않는지를 본다.

## bootstrap의 안전장치

- **잠금 방지:** 키가 등록된 일반 로그인 계정이 없으면 비밀번호 로그인을 끄지 않고 멈춘다. sshd 설정 검사(`sshd -t`)가 실패하면 이전 파일로 되돌린다. sshd가 22번 포트가 아니면 ufw를 건드리지 않고 멈춘다.
- **ufw:** 22는 허용 규칙을 먼저 넣은 뒤 켠다. 허용 목록 밖의 기존 규칙은 지우지 않고 알려 주기만 한다(verify-host가 실패로 보고한다).
- **ufw: B의 CI 잡용 규칙 하나(`ROLE=ops`만):** `ufw allow in on docker0 from 172.17.0.0/16 to any port 32768:60999 proto tcp`. BE 테스트가 Testcontainers로 띄운 DB·Ryuk 컨테이너는 잡 컨테이너 안이 아니라 B 위에 나란히 생기고 포트가 B의 임의 포트(32768~60999)로 게시된다. 잡 컨테이너(기본 브리지 `docker0`)의 `localhost`는 자기 자신이라, 호스트 게이트웨이(`172.17.0.1`)로 닿아야 한다. 이 규칙이 없으면 `INPUT` 기본 차단에 걸려 연결이 시간 초과가 되고 Ryuk 연결 오류(`RyukResourceReaper`)로 테스트가 시작도 못 한다(2026-10-26 MR 45에서 확인). 게시 포트 범위의 TCP만, `docker0`의 컨테이너에서 오는 것만 연다. 인터넷 쪽은 그대로이고(보안 그룹도 22번뿐) 22 같은 다른 포트는 이 규칙으로 늘지 않는다. A에는 두지 않는다(A의 deploy 러너는 shell executor). 잡 쪽에는 따로 줄 설정이 없다. 잡 컨테이너(`docker.sock` 마운트)에서 Testcontainers가 호스트 주소를 스스로 찾고, 이 규칙만 있으면 `TESTCONTAINERS_HOST_OVERRIDE` 없이 통과한다(2026-10-26 B에서 확인). 러너를 사용자 정의 망으로 바꾸면(`FF_NETWORK_PER_BUILD`) `docker0`가 아니라 그 망의 브리지를 열어야 한다.
- **Docker:** 이미 설치돼 있으면 건드리지 않는다. 기존 `daemon.json`은 한 번만 `.fit-orig`로 백업한다. 컨테이너가 돌고 있으면 Docker를 재시작하지 않는다.
- **fail2ban:** `FIT_PEER_IP`를 `ignoreip`에 넣어 A와 B 사이 전송이 차단되지 않게 한다. IP가 아닌 값은 거부한다.

## 환경변수

| 이름 | 뜻 |
|---|---|
| `ROLE` | `app` 또는 `ops`(bootstrap 필수. verify-host는 `/etc/fit/role`에서 읽는다) |
| `FIT_PEER_IP` | 상대 서버의 공인 IP(공백으로 여러 개) |
| `FIT_FORCE_SSH=1` | 키가 없어도 비밀번호 로그인을 끈다. 서버에 못 들어갈 수 있다 |
| `FIT_SKIP` | 건너뛸 단계(쉼표): `docker-install`, `swap`, `sysctl-apply`, `systemd`, `networks`, `arch`(verify-host만). 시험용이다 |
| `FIT_NET_PREFIX` | `networks.sh`의 망 이름 앞에 붙일 접두사(시험용) |

## 노트북에서 시험하기

```bash
bash infra/host/test/test-host.sh          # Ubuntu 24.04 컨테이너에서 app과 ops
bash infra/host/test/test-host.sh all      # 24.04와 22.04 모두
bash infra/host/test/test-host.sh prune    # docker-prune.sh와 networks.sh를 이 PC의 Docker로
bash infra/host/test/test-runner.sh        # runner.sh를 Ubuntu 컨테이너에서(실제 GitLab Runner 저장소로 설치. all은 22.04도)
```

점검 출력을 전부 보려면 `FIT_TEST_VERBOSE=1`을 준다. 컨테이너 시험은 Docker Engine 설치까지 실제로 하고, 설정을 하나씩 망가뜨려 verify-host가 잡는지와 bootstrap이 고치는지를 확인한다. 컨테이너에는 systemd와 Docker 데몬이 없고 커널 설정은 호스트와 공유되므로 `FIT_SKIP`으로 해당 단계만 건너뛴다.

## 서버에서만 확인되는 것

스왑 생성과 `vm.max_map_count` 적용, 시간 동기화, Docker 데몬(`live-restore`)과 정리 타이머·fail2ban의 실제 동작, 공유 Docker 망 생성, B의 CPU 구조(arm64), 실제 SSH 접속(`fit-dev` 터널, 키 로그인), 서버 밖에서 보이는 열린 포트. `verify-host.sh`가 이 항목을 점검한다.
