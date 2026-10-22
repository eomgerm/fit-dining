# 서비스 계약

BE, AI, 프런트 팀과 인프라가 서로 지켜야 할 규약이다. 서버에서 돌기 전에 팀이 합의해야 해서 M1 전에 검토한다([design.md](../design.md) 12절).

## 상태

| 계약 | 위치 | 합의할 팀 | 상태 | 합의일 |
|---|---|---|---|---|
| 환경변수 | [env.md](env.md) | BE, 프런트 | 제안 | |
| 지표(BE) | [metrics.md](metrics.md) | BE, AI | 제안 | |
| BE | design.md 12.1절 | BE | 제안 | |
| AI(Modal 호출) | design.md 12.2절, 12.3절 | AI, BE | 제안 | |
| 프런트 | design.md 12.5절 | 프런트 | 제안 | |

- 상태는 `제안`(합의 전)과 `합의`다.
- 합의되면 이 표의 상태와 합의일을 고치고, design.md 12절의 해당 내용을 이 폴더의 문서로 옮긴다. 옮기면 design.md에는 링크만 남긴다. 12절을 가리키는 다른 절의 참조도 함께 고친다.
- 합의 뒤에 계약을 바꾸려면 영향을 받는 팀에 먼저 알린다.

## 검사

- `infra/ci/check_env_files.py`는 예제 파일의 형식을 본다.
- `infra/ci/check_env_contract.py`는 [env.md](env.md)의 표와 예제 파일의 키가 같은지 본다. 두 검사는 CI의 `lint:guards`와 `bash infra/ci/run-local-checks.sh`에서 돈다.
