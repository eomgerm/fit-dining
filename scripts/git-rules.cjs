#!/usr/bin/env node
// 커밋 메시지/브랜치 이름 규칙 검사와 메시지 자동 완성(이모지 + Jira 키).
// lefthook.yml에서 서브커맨드로 호출한다.
//
//   node scripts/git-rules.cjs branch            현재 브랜치 이름 검사
//   node scripts/git-rules.cjs complete <파일>   type 에 맞는 이모지와 브랜치의 Jira 키를 메시지에 채움
//   node scripts/git-rules.cjs verify   <파일>   커밋 메시지 형식 검사
//
// 규칙 문서: CONTRIBUTING.md

const fs = require('fs');
const { execSync } = require('child_process');

// ── 규칙 정의 (여기만 고치면 커밋/브랜치 양쪽에 반영된다) ──────────────

// Jira 프로젝트 키. 이슈 키는 `S15P31A302-123` 형태가 된다.
const JIRA_PROJECT_KEY = 'S15P31A302';

// 타입 -> gitmoji shortcode (GitLab이 렌더링해준다)
const TYPES = {
  feat: ':sparkles:',
  fix: ':bug:',
  docs: ':memo:',
  style: ':lipstick:',
  refactor: ':recycle:',
  test: ':white_check_mark:',
  chore: ':wrench:',
  perf: ':zap:',
  remove: ':fire:',
  hotfix: ':ambulance:',
  deploy: ':rocket:',
  merge: ':twisted_rightwards_arrows:',
  revert: ':rewind:',
  init: ':tada:',
  design: ':art:',
};

// 플랫폼 스코프. 커밋 메시지에서는 필수, 브랜치 이름에서는 선택.
const SCOPES = ['fe', 'be', 'ai', 'infra'];

// 이슈 키가 없는 통합 브랜치는 이름 검사에서 제외한다.
const PROTECTED_BRANCHES = ['main', 'master', 'develop', 'dev', 'dev-be', 'dev-fe', 'dev-ai'];

// git이 자동 생성하는 커밋 메시지는 형식 검사에서 제외한다.
const SKIP_PATTERNS = [/^Merge /, /^Revert /, /^fixup!/, /^squash!/];

const typeNames = Object.keys(TYPES).join('|');
const scopeNames = SCOPES.join('|');
const ISSUE_KEY = String.raw`${JIRA_PROJECT_KEY}-\d+`;

// <:shortcode:> <type>(<scope>): <설명 1~60자> (<Jira 키>)
const MSG_PATTERN = new RegExp(
  String.raw`^(:[a-z0-9_+-]+:) (${typeNames})\((${scopeNames})\): .{1,60} \(${ISSUE_KEY}\)$`
);

// [<플랫폼>/]<type>/<설명 kebab-case>-<Jira 키>
const BRANCH_PATTERN = new RegExp(
  String.raw`^(?:(?:${scopeNames})/)?(?:${typeNames})/[a-z0-9가-힣-]+-${ISSUE_KEY}$`
);

const BARE_TYPE_PATTERN = new RegExp(String.raw`^(${typeNames})\(`); // 이모지 없이 type 으로 시작
const BRANCH_ISSUE_PATTERN = new RegExp(`(${ISSUE_KEY})$`);
const MSG_ISSUE_PATTERN = new RegExp(String.raw`\(${ISSUE_KEY}\)`);

// ── 검사 (통과하면 null, 위반하면 사유 문자열) ────────────────────────

function validateMessage(subject) {
  if (SKIP_PATTERNS.some((p) => p.test(subject))) return null;

  const matched = MSG_PATTERN.exec(subject);
  if (!matched) return '형식이 규칙과 다릅니다.';

  const [, shortcode, type] = matched;
  if (TYPES[type] !== shortcode) {
    return `타입 "${type}" 에는 ${TYPES[type]} 를 써야 합니다 (입력한 이모지: ${shortcode}).`;
  }
  return null;
}

function validateBranch(branch) {
  if (PROTECTED_BRANCHES.includes(branch) || branch.startsWith('release/')) return null;
  return BRANCH_PATTERN.test(branch) ? null : '형식이 규칙과 다릅니다.';
}

// ── 자동 완성 ───────────────────────────────────────────────────────

// 제목에 빠진 이모지와 Jira 키를 채운다. 이미 있는 부분은 건드리지 않는다.
//   "feat(fe): 로그인"  →  ":sparkles: feat(fe): 로그인 (S15P31A302-123)"
// branch 가 null(detached HEAD)이거나 키가 없는 브랜치면 이모지만 채운다.
function completeSubject(subject, branch) {
  if (SKIP_PATTERNS.some((p) => p.test(subject))) return subject;

  let completed = subject.trimEnd();

  const bareType = BARE_TYPE_PATTERN.exec(completed);
  if (bareType) completed = `${TYPES[bareType[1]]} ${completed}`;

  const issue = branch?.match(BRANCH_ISSUE_PATTERN);
  if (issue && !MSG_ISSUE_PATTERN.test(completed)) completed = `${completed} (${issue[1]})`;

  return completed;
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

    const reason = validateBranch(branch);
    if (!reason) return;

    fail(`
브랜치 이름 규칙 위반: "${branch}" — ${reason}

  형식: [<플랫폼>/]<타입>/<설명(kebab-case, 영문 또는 한글)>-<Jira 키>
  예시: feat/login-page-${JIRA_PROJECT_KEY}-123
        fe/fix/버그-수정-${JIRA_PROJECT_KEY}-45

  허용 플랫폼(선택): ${SCOPES.join(', ')}
  허용 타입: ${Object.keys(TYPES).join(', ')}
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
    const reason = validateMessage(subject);
    if (!reason) return;

    const table = Object.entries(TYPES).map(([type, code]) => `${code} ${type}`).join('  ');
    fail(`
커밋 메시지 규칙 위반: ${reason}

  입력: ${subject}

  형식: <:gitmoji:> <type>(<scope>): <설명> (<Jira 키>)
  예시: :sparkles: feat(fe): 로그인 페이지 UI 구현 (${JIRA_PROJECT_KEY}-123)

  이모지와 Jira 키는 자동으로 붙으므로 "feat(fe): 로그인 페이지 UI 구현" 만 써도 됩니다.
  단, Jira 키는 브랜치 이름에 키가 있을 때만 붙습니다 (master/dev 에서는 직접 적으세요).
  설명은 1~60자입니다.
  허용 스코프: ${SCOPES.join(', ')}
  허용 타입:
    ${table}

  전체 규칙: CONTRIBUTING.md
`);
  },
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

module.exports = { JIRA_PROJECT_KEY, TYPES, SCOPES, validateMessage, validateBranch, completeSubject };

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`알 수 없는 명령: ${command} (사용 가능: ${Object.keys(COMMANDS).join(', ')})`);
    process.exit(2);
  }
  handler(...args);
}
