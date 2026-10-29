import type { PanelState } from "./result-panel";

export type SavedPanelState = "middle" | "full";

// 저장한 장소 화면을 앱 안에서 연 곳. 메인에서 열었으면 그때의 패널 상태도 둔다
type SavedEntry = { from: "main"; mainPanel: PanelState } | { from: "my" };

let entry: SavedEntry | undefined;
let panel: SavedPanelState = "middle";

// 저장한 장소 화면의 페이지 세션 상태(bookmark D-9, D-12). 상세에 다녀와도 남아,
// [뒤로]가 브라우저 뒤로 가기인지와 패널 높이, 돌아갈 메인의 패널 상태를 기억한다.
// 메인 화면을 보이거나 로그인하러 가면 지운다
export const savedViewState = {
  enter(next: SavedEntry) {
    entry = next;
    panel = "middle";
  },
  entry: () => entry,
  clear() {
    entry = undefined;
    panel = "middle";
  },
  panel: () => panel,
  setPanel(next: SavedPanelState) {
    panel = next;
  },
};
