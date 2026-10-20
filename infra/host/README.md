# 호스트 (bootstrap)

서버 A(`app`, Lightsail x86)와 B(`ops`, EC2 Arm)를 설계 3절의 상태로 만들고 점검한다. 설계는 [design.md](../../docs/infra/design.md) 3절이다. Ubuntu 22.04와 24.04에서 시험했다.

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
6. 서버 밖(노트북)에서 포트를 확인한다: `Test-NetConnection <호스트> -Port 22`(열림), `80`, `443`(Caddy 전에는 닫힘). 클라우드 방화벽(Lightsail 네트워킹 탭, EC2 보안 그룹)도 같은 포트만 열려 있는지 사람이 본다.
7. A의 `fit-dev` 계정에 팀원 공개키를 한 줄씩 넣는다(`/home/fit-dev/.ssh/authorized_keys`). 팀원은 `ssh -N -L 5432:127.0.0.1:5432 fit-dev@<호스트>`처럼 터널만 만들 수 있다.

몇 번을 다시 실행해도 같은 결과다. 마지막 줄이 `변경 없음`이면 이미 설계대로다.

## 구성

| 경로 | 내용 |
|---|---|
| `bootstrap.sh` | 적용 스크립트(`ROLE=app\|ops`) |
| `verify-host.sh` | 읽기만 하는 점검. PASS, FAIL, SKIP만 출력하고 IP·키 값은 찍지 않는다 |
| `networks.sh` | 서버 A의 공유 Docker 망 여섯 개(`net-edge`, `net-prod`, `net-dev`, `net-data`(internal), `net-obs`, `net-dbaccess`). bootstrap이 부르고 직접 실행해도 된다 |
| `docker-prune.sh` | 주 1회 정리. A는 `be`·`fe`의 SHA 태그 최근 5개만 남기고, B는 7일 넘게 쓰지 않은 이미지를 지운다. 볼륨은 지우지 않는다 |
| `conf/` | 설치될 설정: SSH 하드닝(`sshd-*.conf`), sysctl, `daemon-*.json`, fail2ban, 자동 업데이트, systemd 유닛 |
| `test/` | 노트북 시험(Ubuntu 컨테이너와 이 PC의 Docker) |

## bootstrap의 안전장치

- **잠금 방지:** 키가 등록된 일반 로그인 계정이 없으면 비밀번호 로그인을 끄지 않고 멈춘다. sshd 설정 검사(`sshd -t`)가 실패하면 이전 파일로 되돌린다. sshd가 22번 포트가 아니면 ufw를 건드리지 않고 멈춘다.
- **ufw:** 22는 허용 규칙을 먼저 넣은 뒤 켠다. 허용 목록 밖의 기존 규칙은 지우지 않고 알려 주기만 한다(verify-host가 실패로 보고한다).
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
```

점검 출력을 전부 보려면 `FIT_TEST_VERBOSE=1`을 준다. 컨테이너 시험은 Docker Engine 설치까지 실제로 하고, 설정을 하나씩 망가뜨려 verify-host가 잡는지와 bootstrap이 고치는지를 확인한다. 컨테이너에는 systemd와 Docker 데몬이 없고 커널 설정은 호스트와 공유되므로 `FIT_SKIP`으로 해당 단계만 건너뛴다.

## 서버에서만 확인되는 것

스왑 생성과 `vm.max_map_count` 적용, 시간 동기화, Docker 데몬(`live-restore`)과 정리 타이머·fail2ban의 실제 동작, 공유 Docker 망 생성, B의 CPU 구조(arm64), 실제 SSH 접속(`fit-dev` 터널, 키 로그인), 서버 밖에서 보이는 열린 포트. `verify-host.sh`가 이 항목을 점검한다.
