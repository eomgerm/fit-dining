#!/usr/bin/env bash
# Garage를 한 번 초기화한다(설계 7.4절). 몇 번 실행해도 같은 결과다(멱등). 단일 노드도 레이아웃을 적용해야 버킷을 만들 수 있다.
#   bash infra/data/init-garage.sh
# 레이아웃, 버킷(fit-prod-photos, fit-dev-photos), 환경 전용 키(자기 버킷에만 권한), 웹 엔드포인트 공개 읽기, 수명주기(pending/ 1일 뒤 삭제)를 맞춘다.
# 키 ID는 GK로 시작하는 26자리, 비밀 키는 64자리 16진수여야 한다(Garage의 key import 형식). 이 스크립트는 기존 키를 바꾸지 않는다(교체는 RB-08).
set -euo pipefail
# shellcheck source=infra/data/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_data_env

GARAGE="$(require_container garage)"
garage() { docker exec -e RUST_LOG=warn "$GARAGE" /garage -c /etc/garage/garage.toml "$@"; }

printf '%s%s' "$S3_PROD_ACCESS_KEY" "$S3_DEV_ACCESS_KEY" | grep -Eq '^(GK[0-9a-f]{24}){2}$' || die "S3 키 ID는 GK로 시작하는 26자리(GK + 16진수 24자리)여야 한다"
printf '%s%s' "$S3_PROD_SECRET_KEY" "$S3_DEV_SECRET_KEY" | grep -Eq '^[0-9a-f]{128}$' || die "S3 비밀 키는 각각 64자리 16진수여야 한다"

if garage status 2>/dev/null | grep -q "NO ROLE ASSIGNED"; then
  node="$(garage status 2>/dev/null | awk '/^[0-9a-f]{16}/ { print $1; exit }')"
  garage layout assign -z dc1 -c 1G "$node" >/dev/null
  garage layout apply --version 1 >/dev/null
  log "레이아웃을 적용했다"
fi

for env in prod dev; do
  bucket="fit-$env-photos"
  access_var="S3_$(printf '%s' "$env" | tr '[:lower:]' '[:upper:]')_ACCESS_KEY"
  secret_var="S3_$(printf '%s' "$env" | tr '[:lower:]' '[:upper:]')_SECRET_KEY"
  garage bucket info "$bucket" >/dev/null 2>&1 || garage bucket create "$bucket" >/dev/null
  garage key info "${!access_var}" >/dev/null 2>&1 || garage key import --yes -n "fit-$env" "${!access_var}" "${!secret_var}" >/dev/null
  garage bucket allow --read --write --owner "$bucket" --key "${!access_var}" >/dev/null
  garage bucket website --allow "$bucket" >/dev/null
  s3run "${!access_var}" "${!secret_var}" lifecycle-set "$bucket" | grep -q '^HTTP 200' || die "$bucket 수명주기를 설정하지 못했다"
  log "$bucket 준비됨(키, 권한, 웹 읽기, 수명주기)"
done
