# RB-02b 긴급 수동 배포(`SKIP_VERIFY`)

- 검증 기준: develop `52c661d`, 2026-10-27. 서버 A에서 4번의 준비와 사전 점검까지 실제로 실행했다. **`deploy.sh` 실행 자체는 따라 해 보지 못했다**(맨 아래 범위).
- 쓰는 때: CI(GitLab 또는 B)를 쓸 수 없는데 배포나 되돌림이 급할 때. 사유를 이력에 남기는 조건으로 CI의 verify 단계를 건너뛴다(설계 6.7절).
- 쓰지 않는 때: 롤백만 필요하면 [RB-02](RB-02.md)의 `rollback.sh`다(사유도 저장소도 필요 없다).

## 1. 이 절차로 할 수 있는 것과 없는 것

- **할 수 있다:** A에 이미지 `be:<전체 SHA>`, `fe:<전체 SHA>`가 있는 커밋을 배포한다(이미지는 서비스당 최근 5개가 남는다).
- **할 수 없다:** 새 코드를 새로 배포하는 것. jar와 FE 번들은 B의 CI가 빌드하고 A는 `COPY`만 한다. B가 죽었으면 B 복구가 먼저다([RB-01](RB-01.md)). 서버에 어떤 이미지가 있는지는 이렇게 본다.

  ```bash
  sudo docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^(be|fe):'
  ```

## 2. 왜 번들로 저장소를 올리나

`deploy.sh`의 사전 점검은 **전체 이력이 있는 저장소**에서 돌아야 한다(다운그레이드 가드와 마이그레이션 비교가 커밋을 읽는다). A의 러너 checkout(`/home/gitlab-runner/builds/.../S15P31A302`)은 쓰지 않는다. 마지막 잡(`build:images`, `smoke:*`)이 `GIT_DEPTH: 20`으로 받아서 얕은 저장소일 수 있고(2026-10-27 확인: `shallow: true`, 20커밋), GitLab이 죽었으면 새로 받을 수도 없다. 그래서 노트북의 저장소를 `git bundle`로 올려 A에서 전체 이력 clone을 만든다. GitLab이 없어도 된다.

## 3. 절차

배포할 SHA는 노트북에서 **전체 40자리**로 구한다(`git rev-parse <sha>`). 짧은 SHA는 이미지를 못 찾는다.

노트북(저장소 루트)에서:

```bash
git fetch origin && git branch -f develop origin/develop        # 배포할 커밋이 담긴 로컬 브랜치를 맞춘다(master면 master)
git bundle create fit.bundle develop                             # 로컬 브랜치 이름으로 만든다
scp -i <A 키> fit.bundle ubuntu@k15a302.p.ssafy.io:/tmp/fit.bundle
```

번들은 `origin/develop`처럼 원격 추적 이름으로 만들지 않는다. A에서 clone하면 브랜치가 없어 "empty repository"가 나온다(2026-10-27에 겪었다).

서버 A에서(`SHA`는 전체 SHA, `ENV`는 `dev` 또는 `prod`):

```bash
sudo rm -rf /tmp/fit-deploy-repo
sudo -u gitlab-runner git clone -q /tmp/fit.bundle /tmp/fit-deploy-repo        # "remote HEAD refers to nonexistent ref" 경고는 정상이다
sudo -u gitlab-runner git -C /tmp/fit-deploy-repo checkout -q <SHA>
sudo -u gitlab-runner git -C /tmp/fit-deploy-repo rev-parse --is-shallow-repository   # false여야 한다
cd /tmp/fit-deploy-repo                                                          # gitlab-runner가 읽을 수 있는 디렉터리에서 실행한다
sudo -u gitlab-runner bash infra/deploy/preflight.sh <ENV> <SHA>                 # 읽기만 한다. "배포 사전 점검 통과"여야 한다
sudo -u gitlab-runner env SKIP_VERIFY='<사유>' bash infra/deploy/deploy.sh <ENV> <SHA>
sudo -u gitlab-runner bash infra/deploy/smoke.sh <ENV> --sha <SHA>
sudo rm -rf /tmp/fit-deploy-repo /tmp/fit.bundle
```

- **`gitlab-runner`로 실행한다.** CI와 같은 계정(docker 그룹)이라 `/srv/fit/state`의 파일 소유자가 CI와 섞이지 않는다. root로 하면 상태 디렉터리에 root 소유 파일이 생긴다.
- **읽을 수 있는 디렉터리에서 실행한다.** `ubuntu`의 홈(`~`)에서 부르면 `gitlab-runner`가 현재 디렉터리를 못 읽어 `compose 설정이 올바르다` 점검이 `stat .: permission denied`로 실패한다(2026-10-27에 겪었다).
- **`SKIP_VERIFY`는 사유다.** 값이 이력에 `skip-verify:<사유>`로 남는다. 사유 없이 부르면 `deploy.sh`가 "CI 밖에서 직접 배포하려면 SKIP_VERIFY=<사유>를 준다"며 사전 점검 전에 거부한다(확인함).
- 사전 점검이 통과해도 배포가 실패하면 자동으로 이전 상태로 돌아가고 종료 코드 1이다([RB-02](RB-02.md)의 실패 표).
- 이 배포는 2인 승인의 예외다. 장애 중에는 사후 승인을 허용하고 사유를 남긴다(설계 10.6절). 배포한 뒤 팀 채널에 SHA와 사유를 알린다.

## 4. 되돌리기

- 배포가 나쁘면 [RB-02](RB-02.md)의 `rollback.sh <ENV>`다. 저장소가 필요 없다.
- 임시 clone과 번들은 위 마지막 줄로 지운다. 서버에 남는 것은 상태 파일과 이력(`/srv/fit/state`)뿐이다.
- GitLab이 돌아오면 같은 SHA의 파이프라인 상태를 확인한다. 다음 CI 배포는 서버의 `DEPLOYED_SHA`를 기준으로 다운그레이드 가드를 적용한다.

## 이 런북을 따라 해 본 범위

- 직접 실행함(2026-10-27, A): 번들 만들기와 전송, `gitlab-runner` 권한으로 clone(222커밋, 전체 이력)과 `checkout`, 사유 없이 `deploy.sh`를 부르면 거부되는지, 같은 위치에서 `preflight.sh dev <전체 SHA>`가 "배포 사전 점검 통과"인지. 시험하다 겪은 세 가지(짧은 SHA, 읽을 수 없는 현재 디렉터리, 원격 추적 이름의 번들)를 위에 반영했다.
- **실행하지 못함: `deploy.sh`로 실제 배포하는 단계와 그 뒤의 `smoke.sh`.** dev를 이미 배포된 SHA로 다시 배포해 보려 했으나 실행 권한 판정에서 거부돼 하지 않았다. 따라서 이 절차의 배포 단계는 코드와 노트북 시험(`infra/deploy/test`)에 기댄 것이고 서버에서는 확인하지 못했다. dev에서 한 번 시험할 기회가 생기면 이 줄을 고친다.
- 실행하지 못함: prod에 대한 수동 배포(prod는 아직 이 스크립트로 배포한 적이 없다), GitLab이 실제로 죽은 상황에서의 흐름.
