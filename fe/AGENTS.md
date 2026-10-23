<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 핏다이닝 와이어프레임 참고 가이드

### 자료 위치와 확인 방법

- 프로젝트 루트 기준 `../../design_fitdining_v1/`에 초기 와이어프레임이 있다. 현재 절대 경로는 `C:/Users/SSAFY/pjt/design_fitdining_v1/`이다.
- `index.html`은 전체 화면을 모아 보는 진입점이다. **유저 플로우 / 예외 상태 / 모션 원칙** 탭으로 나뉜다. 드래그로 이동하고 Ctrl+휠로 확대하며, 화면을 누르면 개별 화면을 크게 열 수 있다.
- `project/*.dc.html`은 개별 화면, `project/fit.css`는 공통 스타일·디자인 토큰·모션 정의다. `index.html`의 `script#data`에는 화면 파일명, 제목, 분류와 설명 메모가 있다.
- `읽어주세요.txt`에 오프라인 보기 방법이 있다. 최초 화면 영상은 HTML에서 정지 포스터로 대체되어 있으며, 원본은 `핏다이닝 온보딩 4.mp4`다.
- HTML과 CSS에는 긴 인라인 이미지·폰트 데이터가 포함될 수 있다. 파일 전체를 출력하기보다 필요한 본문, 스타일 선언, 메타데이터를 추려 확인한다.

### 서비스와 주요 사용자 흐름

핏다이닝은 사용자의 취향과 현재 방문 목적을 바탕으로 주변 식당·카페를 추천하는 모바일 중심 서비스다. 와이어프레임은 기본 흐름 54개, 예외 상태 33개, 모션 미리보기 1개로 총 88개 화면으로 구성되어 있다.

1. **진입·온보딩**: `Main`, `Onb1`~`Onb4`, `Onb4Analyzing`, `Onb4Result`. 분위기, 장소 선택 기준, 방문 목적, 자유 입력 취향을 수집하고 AI 분석 결과를 확인한다. 건너뛰기와 분석 실패·분석 없이 시작하는 상태도 있다.
2. **회원가입·위치 권한**: `Signup*`, `Location*`. 소셜·이메일 가입, 약관 동의, 나중에 가입하기, 위치 권한 안내와 브라우저 권한 요청 예시를 포함한다.
3. **로그인**: `Login*`, `PasswordFind*`, `PasswordSent`. 기존 계정 로그인과 비밀번호 찾기 흐름이다.
4. **첫 화면·홈 화면 추가**: `Start*`. 지도, 주변 추천 카드, 현재 위치, 검색 진입, 최근 검색, 저장한 장소·내 정보 진입이 있다. Android/iOS 홈 화면 추가 안내도 포함한다.
5. **검색·추천 결과**: `Typing*`, `Loading*`, `Results*`, `RequestHistory`, `PastResult`. 자연어 조건 입력, 검색 후보, 추천 대기, 지도와 중간/전체 높이 결과 패널, 추가 조건 요청, 요청 기록·과거 결과를 다룬다.
6. **장소 상세**: `Detail*`. 홈·메뉴·리뷰·정보 탭, 핏 점수 설명, AI 추천 이유와 근거 리뷰, 근거 부족 안내, 영업 정보, 저장, 리뷰 수정·삭제·신고를 포함한다.
7. **방문 평가**: `Review*`. 방문 확인·방문일, 좋았던 점과 아쉬웠던 점 선택, 재방문 의사, 리뷰·사진·금액 입력, 등록 완료 흐름이다. 중복 작성, 근처 확인 실패, 작성 취소, 사진·등록 실패 상태도 확인한다.
8. **저장한 장소·내 정보**: `Saved*`, `DetailSaved`, `MyInfo*`. 저장 목록과 상세 진입, 계정 정보, 로그아웃·탈퇴 흐름이다.

위 이름은 `project/` 안의 `.dc.html` 확장자를 생략한 것이다. 접두사가 같은 파일에는 정상 화면과 예외 화면이 함께 있으므로 `index.html`의 분류와 화면 제목으로 구분한다.

### 구현 시 참고 원칙

- 이 자료는 사용자가 제공한 **대략적인 초기 와이어프레임**이다. 화면 구성과 사용자 흐름의 기준으로 참고하되, 이후 사용자 지시와 확정된 프로젝트 요구사항을 우선한다.
- 관련 기능을 구현할 때 정상 화면뿐 아니라 해당 예외 상태도 함께 확인한다. 특히 위치 차단, 비회원 저장 시 로그인 안내, 네트워크/서버 실패, 결과 없음, 리뷰·저장 실패를 구분한다.
- 추천은 핏 점수뿐 아니라 **추천 이유와 리뷰 근거**, 확인할 근거가 부족한 취향, 대기 등 주의 정보도 전달하는 구조다.
- 지도 그림, 예시 장소·점수·주소·날짜, 브라우저 권한 팝업, 키보드·시스템 영역은 시안 표현일 수 있다. 실제 지도·데이터·브라우저 기능과 구분하고 서비스 정책이나 API 계약으로 단정하지 않는다.
- 공통 색상·서체·간격·컴포넌트는 `fit.css`를 먼저 참고한다. 복사 전에 현재 프로젝트의 컴포넌트와 스타일 구조에 맞게 적용한다.
- 모션은 피드백, 상태 변화, 화면 연결에 사용한다. 기준은 누름 120ms, 칩·토글·토스트 200ms, 바텀시트·화면 전환 320ms, 닫힘 220ms이며 상세 패턴은 모션 원칙 메모와 CSS를 확인한다.
- 움직임 줄이기 설정에서는 이동·확대를 제외하고 투명도·색 변화 위주로 120ms를 적용한다. 튕김·탄성이나 불필요한 장식 모션은 피한다.
- 모션 원칙에는 아직 미구현인 화면 전환, 카드→상세 사진 연결, 결과 패널 높이 전환이 명시되어 있다. 시안에 설명된 동작이 모두 실제 작동한다고 가정하지 않는다.
