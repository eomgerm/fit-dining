백엔드 작업을 진행할 디렉토리입니다.

코드 컨벤션은 [docs/convention.md](docs/convention.md)를 따릅니다.

BE 테스트는 실행 중인 Docker 데몬이 필요하며 외부 DB는 불필요합니다.
`be/`에서 `.\gradlew.bat cleanTest test`를 실행합니다. 공통 Testcontainers 기반이
`pgvector/pgvector:0.8.7-pg16` 컨테이너를 시작하고 인증 마이그레이션을 적용합니다.
같은 JVM의 테스트는 컨테이너를 공유하며 JVM 종료 후 Ryuk이 정리합니다.
