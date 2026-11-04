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
import { OnboardingEntry } from "./onboarding-entry";
import { introSeen, markIntroSeen } from "@/domains/install/model/storage";
import {
  clearSignedIn,
  markSignedIn,
} from "@/domains/auth/model/signed-in-cookie";
import {
  ANSWERS_KEY,
  GUEST_COOKIE,
  GUEST_KEY,
  readAnswers,
  startAsGuest,
} from "@/domains/onboarding/model/storage";
const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
const router = {
  push: mocks.push,
  replace: mocks.replace,
  refresh: mocks.refresh,
};
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
}));
vi.mock("@/domains/auth/api/auth-client", () => ({ restore: mocks.restore }));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  clearSignedIn();
  document.cookie = `${GUEST_COOKIE}=; Path=/; Max-Age=0`;
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
// /는 표시 쿠키가 없을 때 서버가 고른 온보딩이다. 로그인 복구를 기다리지 않는다
it("로그인 복구를 기다리지 않고 최초화면을 그린다", () => {
  mocks.restore.mockImplementation(() => new Promise(() => {}));
  render(<OnboardingEntry />);
  expect(screen.getByRole("button", { name: "시작하기" })).toBeTruthy();
});
describe("표시 쿠키가 없던 로그인 사용자·옛 비회원은 검색 홈을 다시 받는다", () => {
  it("로그인이 복구되어 표시가 생기면 다시 받는다", async () => {
    mocks.restore.mockImplementation(async () => {
      markSignedIn(Date.now() / 1000 + 60);
    });
    render(<OnboardingEntry />);
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });
  // 쿠키를 막은 브라우저에서 다시 받기가 되풀이되지 않게 한다
  it("복구되어도 표시가 없으면 다시 받지 않는다", async () => {
    mocks.restore.mockResolvedValue({});
    render(<OnboardingEntry />);
    await act(async () => {});
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("복구에 실패하면 온보딩에 머문다", async () => {
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    render(<OnboardingEntry />);
    await act(async () => {});
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "시작하기" })).toBeTruthy();
  });
  it("localStorage의 옛 비회원 표시는 쿠키로 옮기고 다시 받는다", () => {
    localStorage.setItem(GUEST_KEY, "1");
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    render(<OnboardingEntry />);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(GUEST_KEY)).toBeNull();
  });
  // 비회원 시작 뒤 브라우저에 남은 이전 온보딩 화면으로 왔을 때
  it("비회원 표시가 이미 있으면 다시 받는다", () => {
    startAsGuest();
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    render(<OnboardingEntry />);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
it("처음 방문은 온보딩 답변을 저장하고 가입으로 이동한다", async () => {
  // 홈 화면 추가 안내는 아래 "홈 화면 추가 안내(1-01a)"에서 본다
  markIntroSeen();
  mocks.restore.mockRejectedValue(new Error("unauthenticated"));
  render(<OnboardingEntry />);
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

it("선택 없이 건너뛰면 답변을 저장하지 않고 가입으로 이동한다", async () => {
  // 홈 화면 추가 안내는 아래 "홈 화면 추가 안내(1-01a)"에서 본다
  markIntroSeen();
  mocks.restore.mockRejectedValue(new Error("unauthenticated"));
  render(<OnboardingEntry />);
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
    render(<OnboardingEntry />);
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
  render(<OnboardingEntry />);
  fireEvent.click(await screen.findByRole("button", { name: "시작하기" }));
  await screen.findByRole("alertdialog");
  expect(introSeen()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "웹에서 계속하기" }));
  expect(introSeen()).toBe(true);
});

describe("홈 화면 추가 배너(4-01b)", () => {
  const banner = () =>
    screen.queryByRole("complementary", { name: "홈 화면 추가 안내" });

  it("같은 주소의 최초화면·온보딩에서는 숨긴다", async () => {
    markIntroSeen();
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    render(
      <>
        <OnboardingEntry />
        <InstallBanner />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "시작하기" }));
    expect(
      screen.getByRole("radio", { name: "조용하고 차분한 곳" }),
    ).toBeTruthy();
    expect(banner()).toBeNull();
  });
});

describe("홈 화면 추가 안내가 끝나면 누른 버튼이 하던 곳으로 간다", () => {
  async function intro() {
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));
    render(<OnboardingEntry />);
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
    render(<OnboardingEntry />);
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
        <OnboardingEntry />
      </Activity>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "시작하기" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "홈 화면에 추가하기" }));
    view.rerender(
      <Activity mode="hidden">
        <OnboardingEntry />
      </Activity>,
    );
    view.rerender(
      <Activity mode="visible">
        <OnboardingEntry />
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
    render(<OnboardingEntry />);
    await vi.waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/login"),
    );
  });
});
