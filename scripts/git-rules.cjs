#!/usr/bin/env node
// 커밋 메시지/브랜치 이름 규칙 검사와 메시지 자동 완성(Jira 키).
// lefthook.yml에서 서브커맨드로 호출한다.
//
//   node scripts/git-rules.cjs branch            현재 브랜치 이름 검사
//   node scripts/git-rules.cjs complete <파일>   브랜치의 Jira 키를 메시지 앞에 채움
//   node scripts/git-rules.cjs verify   <파일>   커밋 메시지 형식 검사
//
// 규칙 문서: CONTRIBUTING.md

const fs = require('fs');
const { execSync, execFileSync } = require('child_process');

// ── 규칙 정의 (여기만 고치면 커밋/브랜치 양쪽에 반영된다) ──────────────

// Jira 프로젝트 키. 이슈 키는 `S15P31A302-123` 형태가 된다.
const JIRA_PROJECT_KEY = 'S15P31A302';

// 커밋 메시지와 브랜치 이름에 쓰는 타입
const TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'test',
  'chore',
  'perf',
  'remove',
  'hotfix',
  'deploy',
  'merge',
  'revert',
  'init',
  'design',
];

// 이슈 키가 없는 통합 브랜치는 이름 검사에서 제외한다.
const PROTECTED_BRANCHES = ['main', 'master', 'develop', 'dev', 'dev-be', 'dev-fe', 'dev-ai'];

// git이 자동 생성하는 커밋 메시지는 형식 검사에서 제외한다.
const SKIP_PATTERNS = [/^Merge /, /^Revert /, /^fixup!/, /^squash!/];

const typeNames = TYPES.join('|');
const ISSUE_KEY = String.raw`${JIRA_PROJECT_KEY}-\d+`;

// [<Jira 키>] <type>: <설명 1~60자>
const MSG_PATTERN = new RegExp(String.raw`^\[${ISSUE_KEY}\] (?:${typeNames}): .{1,60}$`);

// <Jira 키>/<type>/<설명 kebab-case>
const BRANCH_PATTERN = new RegExp(String.raw`^${ISSUE_KEY}/(?:${typeNames})/[a-z0-9가-힣-]+$`);

const BRANCH_ISSUE_PATTERN = new RegExp(`^(${ISSUE_KEY})/`);
const MSG_ISSUE_PATTERN = new RegExp(String.raw`^\[${ISSUE_KEY}\]`);

// 옛 규칙(이모지, 파트, 키를 맨 뒤에)으로 이미 원격에 올린 브랜치와 그 커밋을 계속 받아 준다.
// 아직 올리지 않은 브랜치는 이름을 바꿔도 잃는 게 없으므로 새 규칙을 따르게 한다.
// 옛 브랜치가 모두 병합되면 LEGACY_ 로 시작하는 두 패턴과 이를 쓰는 곳을 지운다.
const LEGACY_SCOPES = 'fe|be|ai|infra';
// [<플랫폼>/]<type>/<설명>-<Jira 키>
const LEGACY_BRANCH_PATTERN = new RegExp(
  String.raw`^(?:(?:${LEGACY_SCOPES})/)?(?:${typeNames})/[a-z0-9가-힣-]+-(${ISSUE_KEY})$`
);
// <:gitmoji:> <type>(<scope>): <설명> (<Jira 키>)
const LEGACY_MSG_PATTERN = new RegExp(
  String.raw`^:[a-z0-9_+-]+: (?:${typeNames})\((?:${LEGACY_SCOPES})\): .{1,60} \(${ISSUE_KEY}\)$`
);

// ── 검사 (통과하면 null, 위반하면 사유 문자열) ────────────────────────

// 옛 형식 메시지는 옛 이름 브랜치와 rebase 중(branch 가 null)에만 받는다. 옛 커밋을 amend 하거나 reword 할 때다.
function validateMessage(subject, branch = null) {
  if (SKIP_PATTERNS.some((p) => p.test(subject))) return null;
  if (LEGACY_MSG_PATTERN.test(subject) && (branch === null || LEGACY_BRANCH_PATTERN.test(branch))) return null;
  return MSG_PATTERN.test(subject) ? null : '형식이 규칙과 다릅니다.';
}

// pushed: 같은 이름의 브랜치가 원격에 이미 있는지
function validateBranch(branch, pushed = false) {
  if (PROTECTED_BRANCHES.includes(branch) || branch.startsWith('release/')) return null;
  if (LEGACY_BRANCH_PATTERN.test(branch)) {
    return pushed ? null : '옛 규칙 이름입니다. 원격에 올리기 전이니 새 규칙 이름으로 바꿔 주세요.';
  }
  return BRANCH_PATTERN.test(branch) ? null : '형식이 규칙과 다릅니다.';
}

// ── 자동 완성 ───────────────────────────────────────────────────────

// 브랜치 이름의 Jira 키. 새 규칙은 맨 앞, 옛 규칙은 맨 뒤에 있다.
function branchIssue(branch) {
  return branch?.match(BRANCH_ISSUE_PATTERN)?.[1] ?? branch?.match(LEGACY_BRANCH_PATTERN)?.[1];
}

// 제목 앞에 빠진 Jira 키를 채운다. 이미 키로 시작하거나 옛 규칙 형식이면 건드리지 않는다.
//   "feat: 로그인"  →  "[S15P31A302-123] feat: 로그인"
// branch 가 null(detached HEAD)이거나 키가 없는 브랜치면 그대로 둔다.
function completeSubject(subject, branch) {
  if (SKIP_PATTERNS.some((p) => p.test(subject))) return subject;

  const completed = subject.trimEnd();
  if (MSG_ISSUE_PATTERN.test(completed) || LEGACY_MSG_PATTERN.test(completed)) return completed;

  const issue = branchIssue(branch);
  return issue ? `[${issue}] ${completed}` : completed;
}

// ── 서브커맨드 ───────────────────────────────────────────────────────

// detached HEAD 등 브랜치가 없으면 null
function currentBranch() {
  try {
    return execSync('git symbolic-ref --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// fetch 나 push 로 받아 둔 origin 의 원격 추적 브랜치가 있는지로 판단한다. 네트워크는 쓰지 않는다.
function remoteBranchExists(branch) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// commit-msg 훅이 받는 파일에는 에디터의 주석(#)과 빈 줄이 남아 있으므로
// git이 실제 제목으로 쓰는 첫 번째 의미 있는 줄을 찾는다.
function readMessage(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() !== '' && !line.startsWith('#'));
  return { lines, index, subject: index === -1 ? '' : lines[index].trim() };
}

const COMMANDS = {
  branch() {
    const branch = currentBranch();
    if (branch === null) return;

    const reason = validateBranch(branch, LEGACY_BRANCH_PATTERN.test(branch) && remoteBranchExists(branch));
    if (!reason) return;

    fail(`
브랜치 이름 규칙 위반: "${branch}" — ${reason}

  형식: <Jira 키>/<타입>/<설명(kebab-case, 영문 또는 한글)>
  예시: ${JIRA_PROJECT_KEY}-123/feat/login-page
        ${JIRA_PROJECT_KEY}-45/fix/버그-수정

  허용 타입: ${TYPES.join(', ')}
  검사 제외: ${PROTECTED_BRANCHES.join(', ')}, release/*

  브랜치 이름 변경: git branch -m <새이름>
  전체 규칙: CONTRIBUTING.md
`);
  },

  // prepare-commit-msg 가 아닌 commit-msg 에서 실행해야 에디터로 쓴 메시지에도 채워진다.
  complete(msgFile) {
    const { lines, index, subject } = readMessage(msgFile);
    if (index === -1) return; // 빈 메시지는 git이 알아서 커밋을 취소한다

    const completed = completeSubject(subject, currentBranch());
    if (completed === subject) return;

    lines[index] = completed;
    fs.writeFileSync(msgFile, lines.join('\n'));
  },

  verify(msgFile) {
    const { subject } = readMessage(msgFile);
    const reason = validateMessage(subject, currentBranch());
    if (!reason) return;

    fail(`
커밋 메시지 규칙 위반: ${reason}

  입력: ${subject}

  형식: [<Jira 키>] <type>: <설명>
  예시: [${JIRA_PROJECT_KEY}-123] feat: 로그인 페이지 UI 구현

  Jira 키는 자동으로 붙으므로 "feat: 로그인 페이지 UI 구현" 만 써도 됩니다.
  단, Jira 키는 브랜치 이름에 키가 있을 때만 붙습니다 (master/develop 에서는 직접 적으세요).
  설명은 1~60자입니다.
  허용 타입: ${TYPES.join(', ')}

  전체 규칙: CONTRIBUTING.md
`);
  },
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

module.exports = { JIRA_PROJECT_KEY, TYPES, validateMessage, validateBranch, completeSubject };

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`알 수 없는 명령: ${command} (사용 가능: ${Object.keys(COMMANDS).join(', ')})`);
    process.exit(2);
  }
  handler(...args);
}
