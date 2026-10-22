#!/bin/sh
# Prometheus 설정, 알림 규칙, 규칙 단위 시험을 promtool로 검사한다(설계 9.4절: 모든 규칙을 promtool test rules로 CI에서 검증한다).
# 저장소 루트에서 prom/prometheus 이미지(PROMETHEUS_IMAGE)로 실행한다. entrypoint는 비운다:
#   docker run --rm --entrypoint "" -v "$PWD:/work" -w /work "$PROMETHEUS_IMAGE" sh infra/ci/check-prometheus.sh
# 대상: A(infra/obs/prometheus)와 B(infra/ops/prometheus). 없는 디렉터리는 건너뛴다.
# file_sd 대상 파일(/generated/...)은 서버가 뜰 때 만들어지므로 없다는 경고는 정상이다.
set -eu
cd "$(dirname "$0")/../.."
status=0
found=0
for dir in infra/obs/prometheus infra/ops/prometheus; do
  [ -f "$dir/prometheus.yml" ] || continue
  found=1
  echo "== $dir"
  promtool check config "$dir/prometheus.yml" || status=1
  if ls "$dir"/tests/*.yml >/dev/null 2>&1; then
    promtool test rules "$dir"/tests/*.yml || status=1
  else
    echo "FAIL $dir/tests/에 단위 시험이 없다"
    status=1
  fi
done
[ "$found" = 1 ] || echo "SKIP prometheus 설정 없음"
exit "$status"
