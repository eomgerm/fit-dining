# GitLab 설정 체크리스트

lab.ssafy.com의 프로젝트(S15P31A302)를 설계([design.md](design.md) 6절, 10.8절)대로 맞추는 절차다. 코드가 아니라 GitLab 화면과 API로 하는 작업이라 구현 계획 대신 이 문서로 관리한다.

- 메뉴 이름과 위치는 GitLab 버전에 따라 다를 수 있다. 다르면 화면에 보이는 이름을 따른다.
- 보호 브랜치와 러너 설정은 Maintainer 권한이 필요하다 (확인: GitLab 문서).
- 토큰과 러너 인증 값은 채팅, 문서, 저장소에 붙이지 않는다.

## 한눈에 보기

| 단계 | 시점 | 하는 일 | 서버 |
|---|---|---|---|
| 0 | 지금 | 권한, 플랜, 버전 확인 | 불필요 |
| 1 | 지금 | 브랜치 보호, 병합 규칙, 배포 안전 설정 | 불필요 |
| 2 | 러너 등록 때 (M1) | 러너 2개 생성·등록, 병합 조건 강화 | 필요 |
| 3 | 스위치를 켜기 전후 | 환경 보호 대체 확인, 배포 순서 보장(`process_mode`) | 필요 |

**순서를 지키는 이유:** lab.ssafy.com에는 공용 러너가 없다 (확인: A503 문서). 러너가 없으면 `lint:*` 잡은 pending으로 멈추고, 이때 "Pipelines must succeed"를 켜면 어떤 MR도 병합할 수 없다. 그래서 이 설정은 러너가 online이 된 뒤인 2단계에서 켠다.

## 0단계: 권한, 플랜, 버전 확인

결과는 아래 "확인 결과 기록"에 적고, 설계 16절 #5와 #25를 갱신한다.

- [ ] 내 역할이 Maintainer 이상인가 (프로젝트 Manage → Members).
- [x] Settings → CI/CD → Runners에 **Create project runner** 버튼이 보이는가 (#5). 보인다(2026-10-19 확인). 안 보이면 설계 6.1절의 Jenkins 폴백을 팀과 논의한다.
- [ ] 같은 화면에서 Instance runners 토글이 켜져 있는가. 켜져 있어도 이 설계는 프로젝트 러너 2개를 쓴다.
- [x] GitLab 플랜과 버전. 이 GitLab은 Community Edition v18.11.5다(2026-10-19 확인). CE에는 Premium 기능이 없어 아래 표의 Free 열이 적용된다.

| 기능 | Free | Premium 이상 |
|---|---|---|
| 보호 브랜치 (역할 단위: Developers + Maintainers, Maintainers, No one) | 가능 | 가능 |
| 병합·push 권한을 사용자·그룹 단위로 지정 | 불가 | 가능 (확인: GitLab 문서) |
| MR 승인 규칙, CODEOWNERS 강제 | 불가 (확인: 18.11 CE의 설정 화면에 승인 규칙 항목이 없다, #25) | 가능 (미확인) |
| merge train | 불가 | 가능. 이 설계는 쓰지 않는다 (10.8절) |

## 1단계: 브랜치 보호와 병합 규칙 (서버 없이)

### 보호 브랜치

Settings → Repository → Branch rules → **Add branch rule**에서 `master`에 다음으로 만든다. 지금은 `develop`이 없어 `master`에만 적용했다. `develop`은 배포 파이프라인(계획 1C)을 만들 때 팀과 합의해 만들고 같은 설정을 건다.

- [x] Allowed to push and merge: **No one**
- [x] Allowed to merge: Premium 이상이면 인프라 담당과 지정한 리뷰어. Free면 **Maintainers**
- [x] Allowed to force push: 끔

Free(CE 포함)에서는 병합 권한자를 개별 사용자로 지정할 수 없다. 이 경우 Maintainer 역할을 인프라 담당과 지정한 리뷰어로만 둔다.

### 병합 규칙

Settings → Merge requests에서 설정한다.

- [x] Merge method: **Fast-forward merge**
- [x] **Enable automatic rebase prior to merge**: 켜지 않는다. 이 서버(18.11)의 설정 화면에는 옵션이 없다(GitLab 19.2에서 추가됐다). 있는 버전에서 켜면 병합 시점에 rebase한 결과에 파이프라인이 다시 돌지 않아 검증하지 않은 SHA가 병합된다 (확인: GitLab 문서). 병합 전 rebase는 MR 화면의 Rebase 버튼으로 하고 파이프라인이 다시 돈 뒤 병합한다.
- [x] MR 화면의 **Rebase without pipeline** 버튼은 쓰지 않는다. rebase로 바뀐 SHA를 검사하지 않고 병합할 수 있다. 이 버튼을 숨기는 프로젝트 설정은 없고, "Pipelines must succeed"를 켜면 사라진다(2단계).
- [x] **Squash commits when merging**: **Do not allow**. squash는 병합할 때 새 커밋(새 SHA)을 만들어 파이프라인이 검증한 커밋과 달라진다.
- [x] Merge checks의 **All threads must be resolved**: 켬
- [x] 병합 후 source branch 삭제를 기본으로 선택
- [x] 승인 규칙: 이 서버(CE)에는 설정이 없다. 병합 권한을 Maintainer로 좁히고 MR 설명에 체크 항목을 둔다 (10.8절).
- [ ] Merge checks의 **Pipelines must succeed**: 2단계에서 켠다

### 배포 안전 설정

Settings → CI/CD → General pipelines에서 설정한다.

- [x] **Prevent outdated deployment jobs**: 켬. 같은 환경에서 더 최근에 시작한 배포가 있으면 오래된 배포 잡이 실패한다 (확인).
- [x] **Allow job retries for rollback deployments**: 끔. prod는 재시도 대신 `rollback.sh`로 되돌린다 (6.2절).

### 확인

보호 브랜치에 직접 push해 보는 방식으로 시험하지 않는다. 설정이 틀렸다면 그 push가 실제로 반영되기 때문이다.

- [ ] Branch rules 화면에서 `develop`, `master`의 Allowed to push and merge가 No one인지 읽는다.
- [ ] 설정 뒤 처음 병합되는 MR에서 병합 커밋이 생기지 않는지(`git log --graph`) 확인한다. 설정 전에 병합된 MR 1번은 merge commit으로 병합됐다.

## 2단계: 러너 등록과 병합 조건 강화 (M1)

서버를 받기 전에도 이 PC의 Docker에서 임시 verify 러너(태그 `verify`, docker executor, `concurrent 1`)를 돌려 파이프라인을 확인할 수 있다. GitLab CE 18.11.5에는 러너 이미지 `gitlab/gitlab-runner:alpine-v18.11.4`로 동작했다. B에 verify 러너를 등록한 뒤에는 임시 러너를 지우고 GitLab의 Runners 목록에서도 삭제한다.

호스트에 `gitlab-runner`를 설치하는 일은 호스트 부트스트랩(계획 1F, 설계 3절)에서 한다. 아래는 GitLab 쪽 작업이다. 러너 생성은 Settings → CI/CD → Runners → **Create project runner**다. runner authentication token 방식이고, 옛 registration token은 GitLab 17.0부터 비활성화됐다 (확인).

| 러너 | Tags | Run untagged | Protected | 호스트·executor |
|---|---|---|---|---|
| `fit-verify` | `verify` | 끔 | 끔 | B, docker(+ docker.sock), `concurrent 2` |
| `fit-deploy` | `deploy` | 끔 | 켬 | A, shell, `concurrent 1` |

세부 값(job 메모리, cpus, `gitlab-runner` 사용자의 docker 그룹)은 설계 6.1절이다. B의 `concurrent`는 처음 등록하면 `runner.sh register`가 2로 맞추고, 이미 1로 등록된 러너는 토큰 없이 `sudo bash ~/host/runner.sh tune`으로 바꾼다(서비스를 재시작하지 않는다). 메모리를 많이 쓰는 잡은 `resource_group: verify-heavy`로 한 번에 하나만 돌아서 4GB를 넘지 않는다.

- [x] 두 러너를 만들고 화면에 한 번만 보이는 인증 토큰(`glrt-`로 시작)을 호스트의 `gitlab-runner register`에 입력한다. 토큰은 호스트의 `config.toml`에만 남긴다. 두 서버에서 `runner.sh status`가 PASS다(2026-10-23).
- [x] Runners 목록에서 두 러너가 online인지 확인한다. 임시 verify 러너(이 PC의 Docker)는 지웠다(사용자 보고, 2026-10-23).
- [x] MR 파이프라인에서 `lint:*` 잡이 verify 러너에서 통과하는지 확인한다(MR 38의 파이프라인 #238229 통과, 2026-10-23).
- [x] Merge checks의 **Pipelines must succeed**: 켬(사용자 보고, 2026-10-23). 켜면 MR 화면의 **Rebase without pipeline** 버튼이 사라진다. 같은 곳의 **Skipped pipelines are considered successful**은 켜지 않는다(켜면 버튼이 다시 나타나 검사하지 않은 SHA를 병합할 수 있다) (확인: GitLab 문서).
- [x] B의 러너를 `sudo bash ~/host/runner.sh tune`으로 `concurrent 2`에 맞추고 `runner.sh status`가 PASS인지 확인한다(2026-10-23 적용. 러너가 서비스 재시작 없이 값을 다시 읽었고 잡이 두 슬롯에서 같이 돌았다).
- [x] MR 파이프라인이 경로별로 가벼워졌다(`rules:changes`, 설계 6.3절). 항상 도는 잡이 3개(`lint:guards`, `lint:secrets`, `lint:history`)라 "Pipelines must succeed"가 파이프라인 없는 MR을 막는 일이 없다. **Skipped pipelines are considered successful**은 계속 켜지 않는다.
- [ ] `master`보다 뒤처진 MR에서 Rebase 버튼만 보이고 Rebase without pipeline 버튼이 보이지 않는지 확인한다.
- [x] Settings → CI/CD → General pipelines의 **Auto-cancel redundant pipelines**: 켬. 같은 브랜치에 새 커밋이 오면 이전 파이프라인의 verify 잡이 취소된다. 이미 켜져 있었다(사용자 보고, 2026-10-23). 배포 잡에는 `interruptible`을 두지 않아서 취소되지 않는다.

## 3단계: 배포 파이프라인 (스위치를 켜기 전후)

배포 잡(`deploy:dev`, `deploy:prod`)은 `.gitlab-ci.yml`의 변수 `FIT_CD_ENABLED`(기본 `"false"`)를 켜야 파이프라인에 나타난다(설계 6.3절). 시크릿이 아니라서 GitLab 변수가 아니라 파일에 두고, 켜는 일은 MR로 한다. 켜기 전에 [계획 1C-3의 서버 적용 절차와 계약 이행 체크리스트](plans/2026-10-23-plan-1c3-ci-pipeline.md)가 끝나 있어야 한다. "Prevent outdated deployment jobs"와 "Allow job retries for rollback deployments"는 1단계에서 이미 설정했다.

### 환경 보호는 쓸 수 없다

보호된 환경(protected environments)은 Premium 이상의 기능이라 이 서버(Community Edition v18.11.5)에서는 쓸 수 없다 (확인: GitLab 문서). 대신 prod 배포를 누를 수 있는 사람을 이렇게 좁힌다.

- `deploy:prod`는 `master`에서만 나타나는 수동 잡이고, `fit-deploy` 러너는 Protected라 보호된 브랜치의 잡만 받는다.
- `master`의 Allowed to merge는 Maintainers다(1단계). 보호 브랜치의 수동 잡은 그 브랜치에 병합·푸시 권한이 있는 사람만 누를 수 있다고 문서에 있다 (확인: GitLab 문서). 동작이 일관되지 않다는 이슈가 있어서 첫 prod 배포 전에 직접 확인한다.

- [ ] Developer 역할 사용자가 `master` 파이프라인의 `deploy:prod`를 누를 수 없는지 확인한다(첫 prod 배포 전).
- [ ] `develop`과 `master` 모두 Allowed to push and merge가 No one, Allowed to merge가 Maintainers인지 Branch rules 화면에서 읽는다. `develop`은 팀원이 만들었고 설정을 아직 읽지 않았다.

### 배포 순서 보장 (첫 배포 파이프라인 뒤)

`resource_group`의 기본 `process_mode`는 `unordered`라 대기 중인 배포의 순서가 보장되지 않는다 (확인: GitLab 문서). `.gitlab-ci.yml`로는 바꿀 수 없고 API로만 바꾼다. 키 이름은 `.gitlab-ci.yml`의 `resource_group`인 `dev`와 `prod`다. 그룹은 그 키를 가진 잡의 파이프라인이 처음 만들어진 뒤에 생긴다 (추정).

필요한 것: 프로젝트 ID(프로젝트 화면의 점 세 개 메뉴 또는 Settings → General), `api` 범위의 토큰. 토큰에 필요한 권한은 문서에 명시돼 있지 않다 (#25). 토큰은 환경변수로만 넘기고 출력하지 않는다.

```bash
curl --fail --request PUT --header "PRIVATE-TOKEN: $GITLAB_API_TOKEN" \
  --data "process_mode=oldest_first" \
  "https://lab.ssafy.com/api/v4/projects/<프로젝트ID>/resource_groups/<키>"
curl --fail --header "PRIVATE-TOKEN: $GITLAB_API_TOKEN" \
  "https://lab.ssafy.com/api/v4/projects/<프로젝트ID>/resource_groups/<키>"
```

- [ ] 환경마다 위 두 호출을 실행한다. 성공하면 상태 코드 200이고 두 번째 응답의 `process_mode`가 `oldest_first`다. 실패하면 400이다.

## 확인 결과 기록

| 항목 | 결과 | 날짜 | 확인한 사람 |
|---|---|---|---|
| 내 역할 (Maintainer 이상) | | | |
| Create project runner 버튼 (#5) | 있음 | 2026-10-19 | 인프라 담당 |
| 플랜과 GitLab 버전 | Community Edition v18.11.5 | 2026-10-19 | 인프라 담당 |
| 승인 규칙·CODEOWNERS 사용 가능 (#25) | 불가 (CE, 설정 화면에 항목 없음) | 2026-10-19 | 인프라 담당 |
| API 토큰 권한 (#25) | | | |
| 1단계 완료 | 완료 (사용자 보고) | 2026-10-19 | 인프라 담당 |
| 2단계 완료 (러너 online) | 러너 2개 online, MR 38 파이프라인 통과, Pipelines must succeed 켬, B의 `concurrent 2` 적용. Rebase 버튼 확인만 남음 | 2026-10-23 | 인프라 담당 |
| 보호된 환경 (CE) | 불가 (Premium 이상, GitLab 문서). 위 3단계의 대체 확인이 남음 | 2026-10-23 | 문서 조사 |
| 3단계 완료 (`oldest_first`) | | | |
