// 실행: npm run test:hooks
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateMessage, validateBranch, completeSubject } = require('./git-rules.cjs');

test('커밋 메시지: 맨 앞 [Jira 키] 형식만 통과한다', () => {
  assert.equal(validateMessage('[S15P31A302-123] feat: 로그인 페이지 UI 구현'), null);
  assert.notEqual(validateMessage('[#123] feat: 로그인 페이지 UI 구현'), null);
  assert.notEqual(validateMessage('[S15P21A501-123] feat: 로그인 페이지 UI 구현'), null);
  assert.notEqual(validateMessage('S15P31A302-123 feat: 로그인 페이지 UI 구현'), null);
  assert.notEqual(validateMessage('feat: 로그인 페이지 UI 구현 (S15P31A302-123)'), null);
  assert.notEqual(validateMessage('feat: 로그인 페이지 UI 구현'), null);
});

test('커밋 메시지: 이모지와 scope 없이 소문자 type 만 받는다', () => {
  assert.notEqual(validateMessage('[S15P31A302-1] :sparkles: feat: 로그인'), null);
  assert.notEqual(validateMessage('[S15P31A302-1] feat(fe): 로그인'), null);
  assert.notEqual(validateMessage('[S15P31A302-1] Feat: 로그인'), null);
  assert.notEqual(validateMessage('[S15P31A302-1] feature: 로그인'), null);
});

test('커밋 메시지: 설명은 1~60자다', () => {
  assert.equal(validateMessage(`[S15P31A302-1] feat: ${'가'.repeat(60)}`), null);
  assert.notEqual(validateMessage(`[S15P31A302-1] feat: ${'가'.repeat(61)}`), null);
  assert.notEqual(validateMessage('[S15P31A302-1] feat: '), null);
});

test('커밋 메시지: git 자동 생성 메시지는 검사하지 않는다', () => {
  for (const msg of ["Merge branch 'dev'", 'Revert "x"', 'fixup! x', 'squash! x']) {
    assert.equal(validateMessage(msg), null);
  }
});

test('브랜치: Jira 키로 시작해야 통과한다', () => {
  assert.equal(validateBranch('S15P31A302-123/feat/login-page'), null);
  assert.equal(validateBranch('S15P31A302-45/fix/버그-수정'), null);
  assert.notEqual(validateBranch('fe/S15P31A302-123/feat/login-page'), null);
  assert.notEqual(validateBranch('S15P31A302-123/fe/feat/login-page'), null);
  assert.notEqual(validateBranch('S15P31A302-123/feature/login-page'), null);
  assert.notEqual(validateBranch('S15P31A302-123/feat'), null);
  assert.notEqual(validateBranch('123/feat/login-page'), null);
});

test('브랜치: 보호 브랜치와 release/* 는 검사하지 않는다', () => {
  for (const branch of ['main', 'master', 'develop', 'dev', 'release/1.0']) assert.equal(validateBranch(branch), null);
});

test('자동 완성: 빠진 Jira 키를 앞에 채우고, 이미 있으면 그대로 둔다', () => {
  const branch = 'S15P31A302-123/feat/login';
  const full = '[S15P31A302-123] feat: 로그인';
  assert.equal(completeSubject('feat: 로그인', branch), full);
  assert.equal(completeSubject('feat: 로그인  ', branch), full);
  assert.equal(completeSubject(full, branch), full);
  assert.equal(completeSubject('[S15P31A302-7] feat: 로그인', branch), '[S15P31A302-7] feat: 로그인');
});

test('옛 규칙 브랜치: 원격에 이미 올린 것만 통과한다', () => {
  assert.equal(validateBranch('fe/feat/login-page-S15P31A302-123', true), null);
  assert.equal(validateBranch('feat/login-page-S15P31A302-123', true), null);
  assert.notEqual(validateBranch('fe/feat/login-page-S15P31A302-123', false), null);
  assert.notEqual(validateBranch('fe/feat/login-page-S15P31A302-123'), null);
  assert.notEqual(validateBranch('fe/feat/login-page-123', true), null);
});

test('옛 규칙 커밋: 옛 브랜치와 rebase 중에만 통과하고, 새 커밋에는 새 형식으로 키를 채운다', () => {
  const legacy = ':sparkles: feat(fe): 로그인 (S15P31A302-123)';
  const branch = 'fe/feat/login-S15P31A302-123';
  assert.equal(validateMessage(legacy, branch), null);
  assert.equal(validateMessage(legacy, null), null);
  assert.equal(validateMessage(legacy), null);
  assert.notEqual(validateMessage(legacy, 'S15P31A302-123/feat/login'), null);
  assert.notEqual(validateMessage(legacy, 'develop'), null);
  assert.notEqual(validateMessage('[S15P31A302-123] feat(fe): 로그인', branch), null);

  assert.equal(completeSubject('feat: 로그인', branch), '[S15P31A302-123] feat: 로그인');
  assert.equal(completeSubject(legacy, branch), legacy); // amend --no-edit 로 옛 커밋을 고칠 때
});

test('자동 완성: 키 없는 브랜치에선 그대로, 자동 생성 메시지도 그대로 둔다', () => {
  const branch = 'S15P31A302-123/feat/login';
  assert.equal(completeSubject('feat: 로그인', 'develop'), 'feat: 로그인');
  assert.equal(completeSubject('feat: 로그인', null), 'feat: 로그인');
  assert.equal(completeSubject('Feat: 로그인', branch), '[S15P31A302-123] Feat: 로그인'); // type 검사는 verify 몫
  assert.equal(completeSubject("Merge branch 'dev'", branch), "Merge branch 'dev'");
});
