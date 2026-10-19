#!/bin/sh
# lefthook의 pre-merge-commit이 부른다. 병합 커밋(3-way merge)을 만들지 못하게 막는다(설계 10.8절).
# fast-forward로 끝나는 병합은 병합 커밋이 없어 이 훅이 불리지 않는다.
cat >&2 <<'EOF'
병합 커밋은 만들지 않는다.
- 진행 중인 병합은 `git merge --abort`로 취소한다.
- 브랜치 최신화는 `git rebase origin/master`를 쓴다.
- 당겨받기는 `git pull --rebase`를 쓴다.
EOF
exit 1
