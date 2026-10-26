// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingScreen } from "./onboarding-screen";

const mocks = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock("../api/analyze-taste", () => ({
  analyzeTaste: mocks.analyze,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.analyze.mockReset();
});
function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}
function reachTaste() {
  click("시작하기");
  fireEvent.click(screen.getByRole("radio", { name: "조용하고 차분한 곳" }));
  click("다음");
  click("아늑한 곳");
  click("다음");
  click("혼밥하기 좋은 곳");
  click("다음");
}
describe("온보딩 화면", () => {
  it("첫 렌더에서는 시작하기로 포커스를 옮기지 않는다", () => {
    render(<OnboardingScreen onComplete={vi.fn()} />);
    expect(document.activeElement).not.toBe(
      screen.getByRole("button", { name: "시작하기" }),
    );
    expect(document.activeElement).toBe(document.body);
  });
  it("처음 화면으로 돌아가면 시작하기에 포커스를 옮긴다", () => {
    render(<OnboardingScreen onComplete={vi.fn()} />);
    click("시작하기");
    click("처음 화면으로");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "시작하기" }),
    );
  });
  it("모두 지우기 뒤 입력창으로 포커스를 옮긴다", () => {
    render(<OnboardingScreen onComplete={vi.fn()} />);
    reachTaste();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "국물" } });
    click("입력한 내용 모두 지우기");
    expect(document.activeElement).toBe(input);
    expect((input as HTMLTextAreaElement).value).toBe("");
  });
  it("칩 삭제 뒤 다음·이전·입력창 순으로 포커스를 옮기고 모두 지우면 미분석 모달을 연다", async () => {
    mocks.analyze.mockResolvedValueOnce([
      { polarity: "like", label: "국물" },
      { polarity: "like", label: "조용한 분위기" },
      { polarity: "dislike", label: "매운맛" },
    ]);
    render(<OnboardingScreen onComplete={vi.fn()} />);
    reachTaste();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "국물, 조용한 곳, 매운맛" } });
    click("AI 분석");
    await screen.findByText("이렇게 이해했어요");
    click("국물 지우기");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "조용한 분위기 지우기" }),
    );
    click("매운맛 지우기");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "조용한 분위기 지우기" }),
    );
    click("조용한 분위기 지우기");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByText("이렇게 이해했어요")).toBeNull();
    click("시작하기");
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });
  it("분석 상태 안내 영역은 분석 전후에도 같은 노드로 유지된다", async () => {
    mocks.analyze.mockResolvedValueOnce([{ polarity: "like", label: "국물" }]);
    render(<OnboardingScreen onComplete={vi.fn()} />);
    reachTaste();
    const liveRegion = screen.getByRole("status");
    expect(liveRegion.textContent).toBe("");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "국물" },
    });
    click("AI 분석");
    expect(screen.getByRole("status")).toBe(liveRegion);
    expect(liveRegion.textContent).toContain("분석하고 있어요");
    await screen.findByText("이렇게 이해했어요");
    expect(screen.getByRole("status")).toBe(liveRegion);
    expect(liveRegion.textContent).toBe("");
  });
  it("미선택 다음 비활성, 라디오 키보드와 뒤로 선택 유지를 지원한다", () => {
    render(<OnboardingScreen onComplete={vi.fn()} />);
    click("시작하기");
    expect(
      (screen.getByRole("button", { name: "다음" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const first = screen.getByRole("radio", { name: "조용하고 차분한 곳" });
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(
      screen
        .getByRole("radio", { name: "활기찬 곳" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    click("다음");
    click("아늑한 곳");
    click("이전");
    click("다음");
    expect(
      screen
        .getByRole("button", { name: /아늑한 곳/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 1 }),
    );
  });
  it("미분석 모달에서 그냥 시작하면 답변을 전달하고 저장하지 않는다", async () => {
    const complete = vi.fn();
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const cookie = vi.spyOn(document, "cookie", "set");
    render(<OnboardingScreen onComplete={complete} />);
    reachTaste();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "국물" },
    });
    click("시작하기");
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    click("그냥 시작하기");
    expect(complete).toHaveBeenCalledWith({
      mood: "calm",
      priorities: ["cozy"],
      purposes: ["solo"],
      tastes: [],
    });
    expect(storage).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
  });
  it("분석 중 차단, 결과 삭제와 입력 수정 초기화, 실패 재시도를 처리한다", async () => {
    let resolve!: (value: { polarity: "like"; label: string }[]) => void;
    mocks.analyze.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<OnboardingScreen onComplete={vi.fn()} />);
    reachTaste();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "국물" } });
    click("AI 분석");
    expect(screen.getByRole("status")).toBeTruthy();
    expect(input.closest("[inert]")).toBeTruthy();
    await act(async () => resolve([{ polarity: "like", label: "국물" }]));
    expect(screen.getByText("이렇게 이해했어요")).toBeTruthy();
    click("국물 지우기");
    expect(screen.queryByText("이렇게 이해했어요")).toBeNull();
    mocks.analyze.mockResolvedValueOnce([{ polarity: "like", label: "국물" }]);
    click("AI 분석");
    await screen.findByText("이렇게 이해했어요");
    fireEvent.change(input, { target: { value: "매운맛" } });
    expect(screen.queryByText("이렇게 이해했어요")).toBeNull();
    mocks.analyze.mockRejectedValueOnce(new Error("실패"));
    click("AI 분석");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "조용" } });
    expect(screen.queryByRole("alert")).toBeNull();
    mocks.analyze.mockResolvedValueOnce([
      { polarity: "like", label: "조용한 분위기" },
    ]);
    click("AI 분석");
    await waitFor(() =>
      expect(screen.getByText(/좋아요 · 조용한 분위기/)).toBeTruthy(),
    );
  });
  it("모달에서 분석을 시작하고 화면을 떠나면 취소한다", async () => {
    mocks.analyze.mockImplementation(() => new Promise(() => {}));
    const view = render(<OnboardingScreen onComplete={vi.fn()} />);
    reachTaste();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "국물" },
    });
    click("시작하기");
    await screen.findByRole("alertdialog");
    click("AI 분석하기");
    const signal = mocks.analyze.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
