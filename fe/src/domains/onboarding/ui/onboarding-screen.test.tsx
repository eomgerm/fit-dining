// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { OnboardingScreen } from "./onboarding-screen";

const mocks = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock("../api/analyze-taste", () => ({
  analyzeTaste: mocks.analyze,
}));
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  mocks.analyze.mockReset();
  vi.unstubAllGlobals();
});
describe("처음 화면 버튼 가로채기(홈 화면 추가 안내용)", () => {
  it("[시작하기]를 가로채면 멈췄다가 넘겨받은 함수로 온보딩을 이어 간다", () => {
    let proceed!: () => void;
    const interceptIntro = vi.fn((_: string, next: () => void) => {
      proceed = next;
      return true;
    });
    render(
      <OnboardingScreen
        onComplete={() => {}}
        interceptIntro={interceptIntro}
      />,
    );
    click("시작하기");
    expect(interceptIntro).toHaveBeenCalledWith("start", expect.any(Function));
    expect(screen.queryByRole("radio")).toBeNull();
    act(() => proceed());
    expect(
      screen.getByRole("radio", { name: "조용하고 차분한 곳" }),
    ).toBeTruthy();
  });

  it("처음 단계를 받아 최초화면 없이 온보딩부터 시작할 수 있다", () => {
    render(<OnboardingScreen onComplete={() => {}} initialStep={1} />);
    expect(screen.queryByRole("button", { name: "시작하기" })).toBeNull();
    expect(
      screen.getByRole("radio", { name: "조용하고 차분한 곳" }),
    ).toBeTruthy();
  });

  it("가로채지 않으면 바로 온보딩으로 간다", () => {
    render(
      <OnboardingScreen onComplete={() => {}} interceptIntro={() => false} />,
    );
    click("시작하기");
    expect(
      screen.getByRole("radio", { name: "조용하고 차분한 곳" }),
    ).toBeTruthy();
  });

  it("[기존 계정으로 로그인]을 가로채면 이동을 멈추고, 이어 가면 같은 링크로 로그인 화면에 간다", async () => {
    let proceed!: () => void;
    let intercept = true;
    const interceptIntro = vi.fn((_: string, next: () => void) => {
      proceed = next;
      return intercept;
    });
    render(
      <OnboardingScreen
        onComplete={() => {}}
        interceptIntro={interceptIntro}
      />,
    );
    const login = screen.getByRole("button", { name: "기존 계정으로 로그인" });
    // React 핸들러가 끝난 뒤(문서까지 올라온 뒤)에 브라우저가 이동할지 본다
    const navigate = vi.fn((event: MouseEvent) => event.defaultPrevented);
    const onLoginClick = (event: MouseEvent) => {
      if (event.target === login) navigate(event);
    };
    document.addEventListener("click", onLoginClick);
    onTestFinished(() => document.removeEventListener("click", onLoginClick));
    fireEvent.click(login);
    expect(interceptIntro).toHaveBeenCalledWith("login", expect.any(Function));
    expect(navigate).toHaveLastReturnedWith(true);
    // 안내를 본 뒤에는 가로채지 않으므로 다시 눌러도 막히지 않는다
    intercept = false;
    act(() => proceed());
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
    expect(navigate).toHaveLastReturnedWith(false);
  });
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
  it("장식 영상을 반복 자동재생하고 시작하기에서 언마운트한다", () => {
    const { container } = render(<OnboardingScreen onComplete={vi.fn()} />);
    const video = container.querySelector("video")!;
    expect(video.src).toContain("/onboarding/intro.mp4");
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.hasAttribute("poster")).toBe(false);
    expect(container.querySelector('img[alt=""]')).toBeTruthy();
    expect(video.getAttribute("aria-hidden")).toBe("true");
    expect(video.classList.contains("opacity-0")).toBe(true);
    fireEvent.playing(video);
    expect(video.classList.contains("opacity-0")).toBe(false);
    click("시작하기");
    expect(container.querySelector("video")).toBeNull();
  });
  it("움직임 줄이기에서는 포스터만 보여 준다", () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const { container } = render(<OnboardingScreen onComplete={vi.fn()} />);
    expect(window.matchMedia).toHaveBeenCalledWith(
      "(prefers-reduced-motion: reduce)",
    );
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector('img[alt=""]')).toBeTruthy();
  });
  it("영상 오류가 나면 포스터를 유지한다", () => {
    const { container } = render(<OnboardingScreen onComplete={vi.fn()} />);
    fireEvent.error(container.querySelector("video")!);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector('img[alt=""]')).toBeTruthy();
  });
  it("작성 중인 내용 다이얼로그에 연필 아이콘을 표시한다", async () => {
    render(<OnboardingScreen onComplete={vi.fn()} />);
    reachTaste();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "국물" },
    });
    click("시작하기");
    const dialog = await screen.findByRole("alertdialog", {
      name: "작성 중인 내용이 있어요",
    });
    const icon = dialog.querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.classList.contains("text-primary-strong")).toBe(true);
    expect(
      Array.from(icon?.querySelectorAll("path") ?? [], (path) =>
        path.getAttribute("d"),
      ),
    ).toEqual(["M4 20H8L19 9L15 5L4 16V20Z", "M13.5 6.5L17.5 10.5"]);
  });
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
      { polarity: "LIKE", label: "국물" },
      { polarity: "LIKE", label: "조용한 분위기" },
      { polarity: "DISLIKE", label: "매운맛" },
    ]);
    render(<OnboardingScreen onComplete={vi.fn()} />);
    reachTaste();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "국물, 조용한 곳, 매운맛" } });
    click("AI 분석");
    await screen.findByText("이렇게 이해했어요");
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 1 }),
    );
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
  it("분석 직후 칩을 삭제해도 늦은 프레임이 포커스를 빼앗지 않는다", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    mocks.analyze.mockResolvedValueOnce([
      { polarity: "LIKE", label: "국물" },
      { polarity: "LIKE", label: "조용한 분위기" },
    ]);
    render(<OnboardingScreen onComplete={vi.fn()} />);
    reachTaste();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "국물, 조용한 곳" },
    });
    click("AI 분석");
    await screen.findByText("이렇게 이해했어요");
    click("국물 지우기");
    const next = screen.getByRole("button", { name: "조용한 분위기 지우기" });
    expect(document.activeElement).toBe(next);
    act(() => frames.forEach((callback) => callback(0)));
    expect(document.activeElement).toBe(next);
  });
  it("결과 커밋 직후 수동 effect 전에 칩을 삭제해도 다음 칩에 포커스를 옮긴다", async () => {
    mocks.analyze.mockResolvedValueOnce([
      { polarity: "LIKE", label: "국물" },
      { polarity: "LIKE", label: "조용한 분위기" },
      { polarity: "DISLIKE", label: "매운맛" },
    ]);
    const view = render(<OnboardingScreen onComplete={vi.fn()} />);
    reachTaste();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "국물, 조용한 곳, 매운맛" },
    });
    let observer: MutationObserver | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        observer = new MutationObserver(() => {
          if (!screen.queryByText("이렇게 이해했어요")) return;
          observer?.disconnect();
          try {
            // findBy/waitFor를 거치지 않고 커밋 직후의 첫 마이크로태스크에서 누른다.
            click("국물 지우기");
            expect(
              screen.queryByRole("button", { name: "국물 지우기" }),
            ).toBeNull();
            expect(document.activeElement).toBe(
              screen.getByRole("button", { name: "조용한 분위기 지우기" }),
            );
            resolve();
          } catch (error) {
            reject(error);
          }
        });
        observer.observe(view.container, { childList: true, subtree: true });
        click("AI 분석");
      });
    } finally {
      observer?.disconnect();
    }
  });
  it("분석 상태 안내 영역은 분석 전후에도 같은 노드로 유지된다", async () => {
    mocks.analyze.mockResolvedValueOnce([{ polarity: "LIKE", label: "국물" }]);
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
      mood: "QUIET",
      priorities: ["COZY"],
      purposes: ["SOLO"],
      tastes: [],
    });
    expect(storage).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
  });
  it("분석 중 차단, 결과 삭제와 입력 수정 초기화, 실패 재시도를 처리한다", async () => {
    let resolve!: (value: { polarity: "LIKE"; label: string }[]) => void;
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
    await act(async () => resolve([{ polarity: "LIKE", label: "국물" }]));
    await screen.findByText("이렇게 이해했어요");
    expect(screen.getByText("이렇게 이해했어요")).toBeTruthy();
    click("국물 지우기");
    expect(screen.queryByText("이렇게 이해했어요")).toBeNull();
    mocks.analyze.mockResolvedValueOnce([{ polarity: "LIKE", label: "국물" }]);
    click("AI 분석");
    await screen.findByText("이렇게 이해했어요");
    fireEvent.change(input, { target: { value: "매운맛" } });
    expect(screen.queryByText("이렇게 이해했어요")).toBeNull();
    mocks.analyze.mockRejectedValueOnce(new Error("실패"));
    click("AI 분석");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 1 }),
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "조용" } });
    expect(screen.queryByRole("alert")).toBeNull();
    mocks.analyze.mockResolvedValueOnce([
      { polarity: "LIKE", label: "조용한 분위기" },
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

it("분석 API가 즉시 끝나도 덮개를 최소 600ms 보여준다", async () => {
  vi.useFakeTimers();
  mocks.analyze.mockResolvedValueOnce([{ polarity: "LIKE", label: "국물" }]);
  render(<OnboardingScreen onComplete={vi.fn()} />);
  reachTaste();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "국물" } });
  click("AI 분석");
  await act(async () => vi.advanceTimersByTimeAsync(599));
  expect(screen.queryByText("이렇게 이해했어요")).toBeNull();
  expect(
    screen.getByRole("textbox", { hidden: true }).closest("[inert]"),
  ).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByText("이렇게 이해했어요")).toBeTruthy();
});
