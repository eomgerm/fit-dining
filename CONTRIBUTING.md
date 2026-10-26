# 협업 규칙 (커밋 + 브랜치)

커밋 메시지와 브랜치 이름 규칙 문서입니다.
두 규칙은 Git hook(lefthook)으로 **자동 검사**됩니다. 규칙을 어기면 커밋이 막히고 고치는 방법이 출력됩니다.

## 0. 최초 1회 설정

Node.js(18 이상)가 필요합니다. 클론 받은 뒤 저장소 루트에서 아래 명령을 한 번 실행하면 훅이 활성화됩니다.

```bash
npm install
```

## 1. 커밋 메시지 규칙

### 형식

```
[<Jira 키>] <type>: <설명>
```

```
[S15P31A302-123] feat: 로그인 페이지 UI 구현
[S15P31A302-56] fix: 회원가입 시 이메일 중복 체크 오류 수정
[S15P31A302-4] chore: Jenkins 파이프라인 설정 추가
```

- Jira 키는 항상 맨 앞 대괄호에 들어갑니다.
- 이모지와 scope(`fe`, `be` 같은 파트)는 쓰지 않습니다.
- **type은 반드시 소문자**로 씁니다 (`docs:` O, `Docs:` X)
- 설명은 한글/영문 모두 가능, **1~60자**

### 자동 완성: `type: 설명` 만 쓰면 됩니다

Jira 키는 브랜치 이름에 이미 들어있어서 커밋할 때 자동으로 앞에 붙습니다. `-m` 으로 커밋하든 에디터로 커밋하든 똑같습니다.

```bash
# S15P31A302-123/feat/login-page 브랜치에서
git commit -m "feat: 로그인 페이지 UI 구현"
# -> "[S15P31A302-123] feat: 로그인 페이지 UI 구현" 으로 자동 완성
```

- Jira 키를 직접 써도 됩니다. 이미 키로 시작하면 건드리지 않습니다 (`--amend` 해도 중복으로 붙지 않음).
- `master`/`develop`처럼 Jira 키가 없는 보호 브랜치에서는 키가 붙지 않으므로 직접 적어야 합니다.

### type 목록

| Type | 의미 |
|---|---|
| feat | 새로운 기능 추가 |
| fix | 버그 수정 |
| docs | 문서 추가/수정 |
| style | 로직 변경 없는 스타일/포맷팅 |
| refactor | 리팩토링 (기능 변화 없음) |
| test | 테스트 코드 추가/수정 |
| chore | 설정, 빌드, 패키지 매니저 등 |
| perf | 성능 개선 |
| remove | 코드/파일 삭제 |
| hotfix | 긴급 수정 |
| deploy | 배포 관련 |
| merge | 브랜치 병합 |
| revert | 이전 커밋으로 되돌리기 |
| init | 프로젝트/기능 최초 세팅 |
| design | UI/디자인 작업 |

> 타입을 추가/변경하려면 `scripts/git-rules.cjs` 상단의 `TYPES` 만 고치고 이 표를 갱신하면 됩니다.

`Merge ...`, `Revert ...`, `fixup!`, `squash!` 로 시작하는 자동 생성 메시지는 검사에서 제외됩니다.

## 2. 브랜치 네이밍 규칙

### 형식

```
<Jira 키>/<커밋타입>/<설명(kebab-case, 영문 또는 한글)>
```

```
S15P31A302-123/feat/login-page
S15P31A302-56/fix/signup-email-validation
S15P31A302-45/fix/버그-수정
S15P31A302-4/chore/jenkins-pipeline
```

- Jira 키는 항상 맨 앞에 둡니다. 브랜치 이름에 키가 있으면 Jira 이슈에서도 브랜치가 연결되어 보입니다.
- 플랫폼(`fe`, `be` 같은 파트)은 쓰지 않습니다.
- **커밋타입**(필수): 커밋 메시지와 완전히 동일한 목록 → 위 type 목록 참고. 임의의 단어는 허용되지 않습니다.
- 설명은 소문자 영문/숫자/한글/하이픈만 씁니다.
- 작업 전에 Jira 이슈를 먼저 만들고, 그 키로 브랜치를 만듭니다.
- `main`, `master`, `develop`, `dev`, `dev-be`, `dev-fe`, `dev-ai`, `release/*` 는 검사에서 제외됩니다.

### 옛 규칙으로 만든 브랜치

이 규칙 전에 만들어 원격에 올린 브랜치(`fe/feat/login-page-S15P31A302-123`)는 이름을 바꾸지 않고 계속 써도 됩니다. MR도 그대로 둡니다.

- 그 브랜치에서 새로 하는 커밋은 새 형식이 됩니다. `feat: 설명` 만 쓰면 브랜치 끝의 Jira 키가 앞에 붙습니다.
- 이미 만든 옛 형식 커밋(`:sparkles: feat(fe): ... (S15P31A302-123)`)은 그대로 두고, `--amend` 로 고쳐도 통과합니다.
- 아직 원격에 올리지 않은 옛 이름 브랜치는 커밋할 때 막힙니다. `git branch -m <새이름>` 으로 바꿉니다. 이미 만든 커밋은 그대로 둬도 되고, 그중 옛 형식 커밋을 `--amend` 할 때만 `git commit --amend -m "feat: 설명"` 처럼 메시지를 새로 씁니다.
- 옛 브랜치가 모두 병합되면 이 예외는 `scripts/git-rules.cjs` 에서 지웁니다.

## 3. 자동 검사 구조

실행 순서: `prepare-commit-msg` → (에디터) → `commit-msg`

| 훅 | 실행 명령 | 역할 |
|---|---|---|
| `prepare-commit-msg` | `git-rules.cjs branch` | 브랜치 이름 검사 (에디터가 열리기 전에 막음) |
| `commit-msg` | `git-rules.cjs complete` | 브랜치의 Jira 키를 메시지 앞에 채움 |
| `commit-msg` | `git-rules.cjs verify` | 커밋 메시지 형식 최종 검사 |
| `pre-commit` | `infra/ci/pre-commit-secrets.sh` | 스테이징한 변경에서 시크릿(토큰, 비밀번호) 검사 |
| `pre-merge-commit` | `infra/ci/no-merge-commit.sh` | 병합 커밋(3-way merge) 차단 |

- 설정 파일: [`lefthook.yml`](lefthook.yml)
- 검사 로직 + 타입 목록 단일 소스: [`scripts/git-rules.cjs`](scripts/git-rules.cjs)
- 검사 로직 테스트: `npm run test:hooks`

### 훅을 일시적으로 끄기

```bash
LEFTHOOK=0 git commit -m "..."
```

`git commit --no-verify` 는 `commit-msg` 만 건너뛰고 브랜치 이름 검사(`prepare-commit-msg`)는 그대로 실행됩니다.

## 4. 병합 커밋 금지

`master`에는 병합 커밋(3-way merge) 없이 fast-forward로만 들어갑니다. 파이프라인이 검증한 커밋이 그대로 올라가야 하기 때문입니다.

- 브랜치를 최신으로 만들 때: `git fetch origin` 다음 `git rebase origin/master`
- 원격 변경을 당겨받을 때: `git pull --rebase` (한 번만 `git config --global pull.rebase true`로 기본값을 바꿔 둘 수 있습니다)
- rebase 뒤에는 `git push --force-with-lease`로 올립니다. `master`에는 force push가 막혀 있습니다.
- MR 화면에서 병합할 때는 먼저 **Rebase** 버튼으로 rebase하고 파이프라인이 다시 돈 뒤 병합합니다.
- **Rebase without pipeline** 버튼은 누르지 않습니다. rebase하면 커밋 SHA가 바뀌는데, 합쳐진 상태를 검사하지 않은 커밋이 `develop`으로 가서 dev에 배포될 수 있습니다.
- 병합 커밋을 만들려 하면 로컬 훅(`pre-merge-commit`)이 막습니다. 진행 중인 병합은 `git merge --abort`로 취소합니다.
- 이미 병합 커밋을 올렸다면 MR의 `lint:history`가 실패합니다. `git rebase origin/master`로 없앤 뒤 다시 올립니다.

## 5. MR description 작성

MR을 올릴 때 [`.gitlab/merge_request_templates/Default.md`](.gitlab/merge_request_templates/Default.md) 템플릿이 자동으로 채워집니다.

- **What / Why / How / Trade-off(필요한 경우만)** 는 AI가 대신 쓰지 않고 **사람이 직접 작성**합니다.
- 그 외 추가하는 내용(스크린샷, 테스트 방법 등)은 형식 자유입니다.
