#!/bin/sh
# MR 파이프라인에서 FE 시험을 어디까지 돌릴지 정한다(설계 6.3절). fe:check가 읽는 dotenv 파일을 쓴다.
#   sh infra/ci/fe-test-scope.sh [출력 파일(기본 fe-scope.env)]
#   FE_TEST_FULL=true    전체 시험(develop·master와 같다)
#   FE_TEST_FULL=false   FE_TEST_FILES에 적은 파일(fe/ 기준 경로, 공백으로 구분)과 관련된 시험만 돌린다(vitest related).
#                        비어 있으면 바뀐 소스가 없는 것이라 시험을 건너뛴다.
# node 이미지에는 git이 없어서 git이 있는 가벼운 잡(fe:scope)이 이 스크립트를 돌린다. 판단이 서지 않으면 늘 전체다.
set -eu

out="${1:-fe-scope.env}"
base="${CI_MERGE_REQUEST_DIFF_BASE_SHA:-}"
max_files=60
max_chars=3000

# 이 파일들이 바뀌면 시험 전체에 영향이 있을 수 있다(설정, 의존성, public/의 정적 파일, CI 설정). 전체를 돌린다
global_files='^(\.gitlab-ci\.yml|infra/ci/tool-images\.sh|infra/ci/fe-test-scope\.sh|fe/(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.json|components\.json|(vitest|next|eslint|postcss)\.config\.[a-z]+|public/.*))$'

full() {
  printf 'FE_TEST_FULL=true\nFE_TEST_FILES=\n' >"$out"
  echo "전체 시험을 돌린다: $1"
  exit 0
}

[ -n "$base" ] || full "MR 기준 커밋(CI_MERGE_REQUEST_DIFF_BASE_SHA)을 모른다"
if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  # 얕은 clone이라 기준 커밋이 없으면 받아 본다
  git fetch --quiet --depth=200 origin "$base" 2>/dev/null || true
fi
git cat-file -e "${base}^{commit}" 2>/dev/null || full "기준 커밋이 이 사본에 없다"

if git diff --name-only "$base" HEAD | grep -Eq "$global_files"; then
  full "설정, 의존성, public/ 또는 CI 설정이 바뀌었다"
fi

# 지금도 있는 소스 파일만(삭제된 파일은 시험이 찾지 못한다). 지운 파일에 기대던 코드는 같이 바뀌므로 그쪽이 걸린다
files="$(git diff --name-only --diff-filter=ACMR "$base" HEAD -- fe/src | grep -E '\.(ts|tsx|js|jsx|mts|mjs|css|json)$' | sed 's#^fe/##' || true)"

count=0
if [ -n "$files" ]; then count="$(printf '%s\n' "$files" | grep -c .)"; fi
[ "$count" -le "$max_files" ] || full "바뀐 소스가 ${max_files}개를 넘는다($count개)"
case "$files" in *" "*) full "파일 이름에 공백이 있다" ;; esac

list="$(printf '%s' "$files" | tr '\n' ' ' | sed 's/ $//')"
[ "${#list}" -le "$max_chars" ] || full "파일 목록이 너무 길다"

printf 'FE_TEST_FULL=false\nFE_TEST_FILES=%s\n' "$list" >"$out"
echo "관련 시험만 돌린다: ${count}개 파일"
