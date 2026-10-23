# BE 이미지(설계 6.3절, BE 계약 #20). verify 단계(B)가 만든 jar를 COPY만 한다(멀티스테이지 빌드 금지: A의 CPU 크레딧을 쓰지 않는다).
# 조립은 infra/ci/build-images.sh가 한다. 베이스 이미지 핀은 infra/ci/tool-images.sh의 JRE_IMAGE와 같다(tests/test_tool_images_sync.py가 검사한다).
# JVM 플래그와 시간대는 compose의 환경변수(JAVA_TOOL_OPTIONS, TZ)가 준다. 마이그레이션 컨테이너는 SPRING_PROFILES_ACTIVE=migrate로 같은 이미지를 쓴다.
ARG BASE_IMAGE=eclipse-temurin:21.0.12_8-jre-noble
FROM ${BASE_IMAGE}

ARG SHA
ARG BUILT_AT
# BE의 GET /api/v1/version이 읽는 값(이름은 BE 팀과 확정하는 제안이다, 계획 1C-3)
ENV APP_SHA=${SHA} APP_BUILT_AT=${BUILT_AT}
LABEL org.opencontainers.image.revision=${SHA} org.opencontainers.image.created=${BUILT_AT}

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY app.jar /app/app.jar
USER 10001:10001
EXPOSE 8080 8081
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
