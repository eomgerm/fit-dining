# 협업 규칙 (Gitmoji + Jira)

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
<:gitmoji:> <type>(<scope>): <설명> (<Jira 키>)
```

```
:sparkles: feat(fe): 로그인 페이지 UI 구현 (S15P31A302-123)
:bug: fix(be): 회원가입 시 이메일 중복 체크 오류 수정 (S15P31A302-56)
:wrench: chore(infra): Jenkins 파이프라인 설정 추가 (S15P31A302-4)
```

- 이모지는 **shortcode**(`:sparkles:`) 형식이며, GitLab이 이모지로 렌더링해줍니다.
- **scope는 필수**이며 `fe`, `be`, `ai`, `infra` 중 하나입니다.
- **type은 반드시 소문자**로 씁니다 (`docs:` O, `Docs:` X)
- 설명은 한글/영문 모두 가능, **1~60자**
- Jira 키는 항상 맨 뒤 괄호에 들어갑니다.

### 자동 완성: `type(scope): 설명` 만 쓰면 됩니다

이모지는 type과 1:1로 짝지어져 있고(아래 매핑 표), Jira 키는 브랜치 이름에 이미 들어있습니다.
그래서 둘 다 커밋할 때 자동으로 붙습니다. `-m` 으로 커밋하든 에디터로 커밋하든 똑같습니다.

```bash
# fe/feat/login-page-S15P31A302-123 브랜치에서
git commit -m "feat(fe): 로그인 페이지 UI 구현"
# -> ":sparkles: feat(fe): 로그인 페이지 UI 구현 (S15P31A302-123)" 으로 자동 완성
```

- 이모지나 Jira 키를 직접 써도 됩니다. 이미 있는 부분은 건드리지 않습니다 (`--amend` 해도 중복으로 붙지 않음).
- 직접 쓴 이모지가 type과 짝이 맞지 않으면(`:bug: feat(fe):`) 커밋이 막힙니다.
- `master`/`dev`처럼 Jira 키가 없는 보호 브랜치에서는 이모지만 붙으므로 Jira 키는 직접 적어야 합니다.

### Gitmoji ↔ type 매핑

| Shortcode | 렌더링 | Type | 의미 |
|---|---|---|---|
| `:sparkles:` | ✨ | feat | 새로운 기능 추가 |
| `:bug:` | 🐛 | fix | 버그 수정 |
| `:memo:` | 📝 | docs | 문서 추가/수정 |
| `:lipstick:` | 💄 | style | 로직 변경 없는 스타일/포맷팅 |
| `:recycle:` | ♻️ | refactor | 리팩토링 (기능 변화 없음) |
| `:white_check_mark:` | ✅ | test | 테스트 코드 추가/수정 |
| `:wrench:` | 🔧 | chore | 설정, 빌드, 패키지 매니저 등 |
| `:zap:` | ⚡️ | perf | 성능 개선 |
| `:fire:` | 🔥 | remove | 코드/파일 삭제 |
| `:ambulance:` | 🚑 | hotfix | 긴급 수정 |
| `:rocket:` | 🚀 | deploy | 배포 관련 |
| `:twisted_rightwards_arrows:` | 🔀 | merge | 브랜치 병합 |
| `:rewind:` | ⏪ | revert | 이전 커밋으로 되돌리기 |
| `:tada:` | 🎉 | init | 프로젝트/기능 최초 세팅 |
| `:art:` | 🎨 | design | UI/디자인 작업 |

> 타입을 추가/변경하려면 `scripts/git-rules.cjs` 상단의 `TYPES` 만 고치고 이 표를 갱신하면 됩니다.

`Merge ...`, `Revert ...`, `fixup!`, `squash!` 로 시작하는 자동 생성 메시지는 검사에서 제외됩니다.

## 2. 브랜치 네이밍 규칙

### 형식

```
[<플랫폼>/]<커밋타입>/<설명(kebab-case, 영문 또는 한글)>-<Jira 키>
```

```
feat/login-page-S15P31A302-123
fix/signup-email-validation-S15P31A302-56
ai/feat/model-serving-S15P31A302-8
fe/fix/버그-수정-S15P31A302-45
infra/chore/jenkins-pipeline-S15P31A302-4
```

- **플랫폼**(선택): `fe`, `be`, `ai`, `infra` 중 하나. 구분이 필요할 때만 붙이고 없어도 됩니다.
- **커밋타입**(필수): 커밋 메시지와 완전히 동일한 목록 → 위 매핑 표 참고. 임의의 단어는 허용되지 않습니다.
- 설명은 소문자 영문/숫자/한글/하이픈만 씁니다.
- Jira 키는 항상 맨 뒤에 `-` 로 이어 붙입니다. 브랜치 이름에 키가 있으면 Jira 이슈에서도 브랜치가 연결되어 보입니다.
- 작업 전에 Jira 이슈를 먼저 만들고, 그 키로 브랜치를 만듭니다.
- `main`, `master`, `develop`, `dev`, `dev-be`, `dev-fe`, `dev-ai`, `release/*` 는 검사에서 제외됩니다.

## 3. 자동 검사 구조

실행 순서: `prepare-commit-msg` → (에디터) → `commit-msg`

| 훅 | 실행 명령 | 역할 |
|---|---|---|
| `prepare-commit-msg` | `git-rules.cjs branch` | 브랜치 이름 검사 (에디터가 열리기 전에 막음) |
| `commit-msg` | `git-rules.cjs complete` | type에 맞는 이모지와 브랜치의 Jira 키를 메시지에 채움 |
| `commit-msg` | `git-rules.cjs verify` | 커밋 메시지 형식 최종 검사 |

- 설정 파일: [`lefthook.yml`](lefthook.yml)
- 검사 로직 + 타입 목록 단일 소스: [`scripts/git-rules.cjs`](scripts/git-rules.cjs)
- 검사 로직 테스트: `npm run test:hooks`

### 훅을 일시적으로 끄기

```bash
LEFTHOOK=0 git commit -m "..."
```

`git commit --no-verify` 는 `commit-msg` 만 건너뛰고 브랜치 이름 검사(`prepare-commit-msg`)는 그대로 실행됩니다.
