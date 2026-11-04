// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
import { InstallBanner } from "@/domains/install/ui/install-banner";
import { Activity } from "react";
import { HomeEntry } from "./home-entry";
import { rememberLoginReturn } from "./login-return";
import { introSeen, markIntroSeen } from "@/domains/install/model/storage";
import {
  ANSWERS_KEY,
  GUEST_KEY,
  readAnswers,
} from "@/domains/onboarding/model/storage";
const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));
const router = { push: mocks.push, replace: mocks.replace };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
}));
vi.mock("@/domains/auth/api/auth-client", () => ({ restore: mocks.restore }));
vi.mock("@/domains/place/ui/search-screen", () => ({
  SearchScreen: () => <div>검색 홈</div>,
}));
// 북마크 인증은 use-bookmark-access 테스트가 아니라 장소 화면 테스트에서 본다
vi.mock("./use-bookmark-access", () => ({ useBookmarkAccess: () => ({}) }));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("로그인 복구 전에는 빈 바탕, 복구 후 홈을 보여준다", async () => {
  let resolve!: () => void;
  mocks.restore.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  render(<HomeEntry />);
  expect(screen.queryByText("검색 홈")).toBeNull();
  expect(screen.queryByRole("button", { name: "시작하기" })).toBeNull();
  await act(async () => resolve());
  expect(screen.getByText("검색 홈")).toBeTruthy();
});
it("비회원 표시가 있으면 복구 실패에도 홈을 보여준다", async () => {
  localStorage.setItem(GUEST_KEY, "1");
  mocks.restore.mockRejectedValue(new Error("unauthenticated"));
  render(<HomeEntry />);
  expect(await screen.findByText("검색 홈")).toBeTruthy();
});
it("처음 방문은 온보딩 답변을 저장하고 가입으로 이동한다", async () => {
  // 홈 화면 추가 안내는 아래 "홈 화면 추가 안내(1-01a)"에서 본다
  markIntroSeen();
  mocks.restore.mockRejectedValue(new Error("unauthenticated"));
  render(<HomeEntry />);
  fireEvent.click(await screen.findByRole("button", { name: "시작하기" }));
  fireEvent.click(screen.getByRole("radio", { name: "조용하고 차분한 곳" }));
  fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
  expect(mocks.push).toHaveBeenCalledWith("/signup");
  expect(readAnswers()).toEqual({
    mood: "QUIET",
    priorities: [],
    purposes: [],
    tastes: [],
  });
});
it("복구 3초 상한 이후 늦은 응답은 화면을 바꾸지 않는다", async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  mocks.restore.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  render(<HomeEntry />);
  await act(async () => vi.advanceTimersByTimeAsync(2999));
  expect(screen.queryByRole("button", { name: "시작하기" })).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByRole("button", { name: "시작하기" })).toBeTruthy();
  await act(async () => resolve());
  expect(screen.queryByText("검색 홈")).toBeNull();
});

describe("북마크 로그인 뒤 복귀", () => {
  const RETURN_KEY = "fitdining:login-return";

  it("로그인된 상태로 쿼리 없는 홈에 오면 남은 상세 주소로 한 번 replace하고 지운다", async () => {
    mocks.restore.mockResolvedValue({});
    rememberLoginReturn("/places/3?from=saved");
    render(<HomeEntry />);

    await vi.waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/places/3?from=saved"),
    );
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
    // 다른 화면으로 가므로 홈을 그리지 않는다
    expect(screen.queryByText("검색 홈")).toBeNull();
  });

  it("저장한 장소 화면 주소면 replace하고 메인을 그린다", async () => {
    mocks.restore.mockResolvedValue({});
    rememberLoginReturn("/?view=saved&category=CAFE");
    render(<HomeEntry />);

    expect(await screen.findByText("검색 홈")).toBeTruthy();
    expect(mocks.replace).toHaveBeenCalledWith("/?view=saved&category=CAFE");
  });

  it("로그인 없이 홈에 오면 주소를 버린다", async () => {
    localStorage.setItem(GUEST_KEY, "1");
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    rememberLoginReturn("/places/3");
    render(<HomeEntry />);

    expect(await screen.findByText("검색 홈")).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });

  it("남긴 지 10분이 지났으면 따르지 않는다", async () => {
    mocks.restore.mockResolvedValue({});
    rememberLoginReturn("/places/3", Date.now() - 10 * 60 * 1000 - 1);
    render(<HomeEntry />);

    expect(await screen.findByText("검색 홈")).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each([
    "//evil.example/x",
    "/\\evil.example/x",
    "https://evil.example/x",
    "place?id=3",
  ])("다른 출처로 해석되는 %s는 따르지 않는다", async (path) => {
    mocks.restore.mockResolvedValue({});
    rememberLoginReturn(path);
    render(<HomeEntry />);

    expect(await screen.findByText("검색 홈")).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });

  it("쿼리가 있는 홈에 오면 남은 주소를 읽지 않는다", async () => {
    window.history.replaceState(null, "", "/?view=saved");
    mocks.restore.mockResolvedValue({});
    rememberLoginReturn("/places/3");
    render(<HomeEntry />);

    expect(await screen.findByText("검색 홈")).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN_KEY)).not.toBeNull();
  });

  it("로그인 복원이 3초 안에 끝나지 않으면 주소를 버린다", async () => {
    vi.useFakeTimers();
    mocks.restore.mockImplementation(() => new Promise(() => {}));
    rememberLoginReturn("/places/3");
    render(<HomeEntry />);

    await act(async () => vi.advanceTimersByTimeAsync(3000));

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });
});

it("선택 없이 건너뛰면 답변을 저장하지 않고 가입으로 이동한다", async () => {
  // 홈 화면 추가 안내는 아래 "홈 화면 추가 안내(1-01a)"에서 본다
  markIntroSeen();
  mocks.restore.mockRejectedValue(new Error("unauthenticated"));
  render(<HomeEntry />);
  fireEvent.click(await screen.findByRole("button", { name: "시작하기" }));
  fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
  expect(mocks.push).toHaveBeenCalledWith("/signup");
  expect(readAnswers()).toBeUndefined();
  expect(localStorage.getItem(ANSWERS_KEY)).toBeNull();
});

describe("홈 화면 추가 안내(1-01a)", () => {
  const dialog = () => screen.queryByRole("alertdialog");
  async function intro() {
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    render(<HomeEntry />);
    return screen.findByRole("button", { name: "시작하기" });
  }

  it("[시작하기]를 처음 누르면 안내를 띄우고 [웹에서 계속하기]로 온보딩을 이어 간다", async () => {
    fireEvent.click(await intro());
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "웹에서 계속하기" }));
    expect(
      await screen.findByRole("radio", { name: "조용하고 차분한 곳" }),
    ).toBeTruthy();
  });

  it("한 번 띄운 뒤로는 띄우지 않는다", async () => {
    fireEvent.click(await intro());
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "웹에서 계속하기" }));
    cleanup();
    fireEvent.click(await intro());
    expect(dialog()).toBeNull();
    expect(
      screen.getByRole("radio", { name: "조용하고 차분한 곳" }),
    ).toBeTruthy();
  });

  it("[홈 화면에 추가하기]는 설치 창이 없으면 가이드로 간다", async () => {
    fireEvent.click(await intro());
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "홈 화면에 추가하기" }));
    expect(mocks.push).toHaveBeenCalledWith("/install/android");
  });

  it("홈 화면에서 연 앱에서는 띄우지 않는다", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(display-mode: standalone)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    fireEvent.click(await intro());
    expect(dialog()).toBeNull();
    expect(
      screen.getByRole("radio", { name: "조용하고 차분한 곳" }),
    ).toBeTruthy();
  });
});

it("안내가 떠 있는 동안에는 아직 본 것으로 기록하지 않는다(배너가 모달 뒤에 뜨지 않게)", async () => {
  mocks.restore.mockRejectedValue(new Error("unauthenticated"));
  render(<HomeEntry />);
  fireEvent.click(await screen.findByRole("button", { name: "시작하기" }));
  await screen.findByRole("alertdialog");
  expect(introSeen()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "웹에서 계속하기" }));
  expect(introSeen()).toBe(true);
});

describe("홈 화면 추가 배너(4-01b)는 첫 화면부터 보인다", () => {
  const banner = () =>
    screen.queryByRole("complementary", { name: "홈 화면 추가 안내" });

  it("같은 주소의 최초화면·온보딩에서는 숨긴다", async () => {
    markIntroSeen();
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    render(
      <>
        <HomeEntry />
        <InstallBanner />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "시작하기" }));
    expect(
      screen.getByRole("radio", { name: "조용하고 차분한 곳" }),
    ).toBeTruthy();
    expect(banner()).toBeNull();
  });

  it("첫 화면(4-01)에서는 띄운다", async () => {
    markIntroSeen();
    localStorage.setItem(GUEST_KEY, "1");
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    render(
      <>
        <HomeEntry />
        <InstallBanner />
      </>,
    );
    expect(await screen.findByText("검색 홈")).toBeTruthy();
    expect(banner()).not.toBeNull();
  });
});

describe("홈 화면 추가 안내가 끝나면 누른 버튼이 하던 곳으로 간다", () => {
  async function intro() {
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    render(<HomeEntry />);
    return screen.findByRole("button", { name: "시작하기" });
  }

  it("설치 창을 닫으면 최초화면에 머물지 않고 온보딩으로 간다", async () => {
    fireEvent.click(await intro());
    await screen.findByRole("alertdialog");
    const prompt = vi.fn(async () => {});
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt,
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    fireEvent.click(screen.getByRole("button", { name: "홈 화면에 추가하기" }));
    expect(
      await screen.findByRole("radio", { name: "조용하고 차분한 곳" }),
    ).toBeTruthy();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("[시작하기]로 가이드에 갔다가 돌아오면 바로 온보딩부터 보여 준다", async () => {
    fireEvent.click(await intro());
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "홈 화면에 추가하기" }));
    expect(mocks.push).toHaveBeenCalledWith("/install/android");
    // 가이드에서 [이전]으로 돌아오면 홈이 새로 그려진다
    cleanup();
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    render(<HomeEntry />);
    expect(
      await screen.findByRole("radio", { name: "조용하고 차분한 곳" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "시작하기" })).toBeNull();
  });

  it("화면 상태를 보존한 채 돌아와도(Next Activity) 바로 온보딩부터 보여 준다", async () => {
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    // Cache Components는 떠난 화면을 hidden Activity로 남겨 두었다가 돌아오면 상태째 다시 보여 준다
    const view = render(
      <Activity mode="visible">
        <HomeEntry />
      </Activity>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "시작하기" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "홈 화면에 추가하기" }));
    view.rerender(
      <Activity mode="hidden">
        <HomeEntry />
      </Activity>,
    );
    view.rerender(
      <Activity mode="visible">
        <HomeEntry />
      </Activity>,
    );
    // 다시 보이는 첫 그림부터 온보딩이어야 한다. 최초화면(어두운 영상)이 한 번 그려지면 깜빡여 보인다
    expect(screen.queryByRole("button", { name: "시작하기" })).toBeNull();
    expect(
      screen.getByRole("radio", { name: "조용하고 차분한 곳" }),
    ).toBeTruthy();
  });

  it("[기존 계정으로 로그인]으로 가이드에 갔다가 돌아오면 로그인 화면으로 보낸다", async () => {
    await intro();
    fireEvent.click(
      screen.getByRole("button", { name: "기존 계정으로 로그인" }),
    );
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "홈 화면에 추가하기" }));
    cleanup();
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    render(<HomeEntry />);
    await vi.waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/login"),
    );
  });
});
