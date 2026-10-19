# shellcheck shell=sh disable=SC2034
# CI와 로컬 러너(run-local-checks.sh)가 함께 쓰는 도구 이미지 핀.
# 바꾸면 .gitlab-ci.yml의 variables도 같은 값으로 바꾼다 (tests/test_tool_images_sync.py가 검사한다).
# 이 이미지들은 Arm인 B에서도 돌므로 amd64와 arm64를 모두 지원해야 한다 (images_arch.py로 확인).
SHELLCHECK_IMAGE=koalaman/shellcheck-alpine:v0.11.0
HADOLINT_IMAGE=hadolint/hadolint:v2.15.1-alpine
YAMLLINT_IMAGE=pipelinecomponents/yamllint:0.35.27
GITLEAKS_IMAGE=zricethezav/gitleaks:v8.30.1
CADDY_IMAGE=caddy:2.11.7
PROMETHEUS_IMAGE=prom/prometheus:v3.15.0
DOCKER_CLI_IMAGE=docker:29.9.0-cli
PYTHON_IMAGE=python:3.12.15-slim
