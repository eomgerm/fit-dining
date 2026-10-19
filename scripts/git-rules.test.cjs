// 실행: npm run test:hooks
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateMessage, validateBranch, completeSubject } = require('./git-rules.cjs');

test('커밋 메시지: Jira 키 형식만 통과한다', () => {
  assert.equal(validateMessage(':sparkles: feat(fe): 로그인 페이지 UI 구현 (S15P31A302-123)'), null);
  assert.notEqual(validateMessage(':sparkles: feat(fe): 로그인 페이지 UI 구현 (#123)'), null);
  assert.notEqual(validateMessage(':sparkles: feat(fe): 로그인 페이지 UI 구현 (S15P21A501-123)'), null);
  assert.notEqual(validateMessage(':sparkles: feat(fe): 로그인 페이지 UI 구현'), null);
});

test('커밋 메시지: 이모지-타입 짝, scope, 소문자 type 을 검사한다', () => {
  assert.notEqual(validateMessage(':bug: feat(fe): 로그인 (S15P31A302-1)'), null);
  assert.notEqual(validateMessage(':sparkles: feat: 로그인 (S15P31A302-1)'), null);
  assert.notEqual(validateMessage(':sparkles: feat(web): 로그인 (S15P31A302-1)'), null);
  assert.notEqual(validateMessage(':sparkles: Feat(fe): 로그인 (S15P31A302-1)'), null);
});

test('커밋 메시지: git 자동 생성 메시지는 검사하지 않는다', () => {
  for (const msg of ["Merge branch 'dev'", 'Revert "x"', 'fixup! x', 'squash! x']) {
    assert.equal(validateMessage(msg), null);
  }
});

test('브랜치: Jira 키로 끝나야 통과한다', () => {
  assert.equal(validateBranch('fe/feat/login-page-S15P31A302-123'), null);
  assert.equal(validateBranch('feat/login-page-S15P31A302-123'), null);
  assert.equal(validateBranch('be/fix/버그-수정-S15P31A302-45'), null);
  assert.notEqual(validateBranch('fe/feat/login-page-123'), null);
  assert.notEqual(validateBranch('feat/login-page'), null);
  assert.notEqual(validateBranch('feature/login-page-S15P31A302-123'), null);
});

test('브랜치: 보호 브랜치와 release/* 는 검사하지 않는다', () => {
  for (const branch of ['main', 'master', 'dev', 'release/1.0']) assert.equal(validateBranch(branch), null);
});

test('자동 완성: 빠진 이모지와 Jira 키를 채우고, 이미 있는 부분은 그대로 둔다', () => {
  const branch = 'fe/feat/login-S15P31A302-123';
  const full = ':sparkles: feat(fe): 로그인 (S15P31A302-123)';
  assert.equal(completeSubject('feat(fe): 로그인', branch), full);
  assert.equal(completeSubject(':sparkles: feat(fe): 로그인', branch), full);
  assert.equal(completeSubject('feat(fe): 로그인 (S15P31A302-123)', branch), full);
  assert.equal(completeSubject(full, branch), full);
  assert.equal(completeSubject('feat(fe): 로그인 (S15P31A302-7)', branch), ':sparkles: feat(fe): 로그인 (S15P31A302-7)');
});

test('자동 완성: 키 없는 브랜치에선 이모지만, 판단할 수 없는 메시지는 그대로 둔다', () => {
  const branch = 'fe/feat/login-S15P31A302-123';
  assert.equal(completeSubject('feat(fe): 로그인', 'dev'), ':sparkles: feat(fe): 로그인');
  assert.equal(completeSubject('feat(fe): 로그인', null), ':sparkles: feat(fe): 로그인');
  assert.equal(completeSubject(':bug: feat(fe): 로그인', branch), ':bug: feat(fe): 로그인 (S15P31A302-123)'); // 짝 검사는 verify 몫
  assert.equal(completeSubject('Feat(fe): 로그인', 'dev'), 'Feat(fe): 로그인');
  assert.equal(completeSubject("Merge branch 'dev'", branch), "Merge branch 'dev'");
});
