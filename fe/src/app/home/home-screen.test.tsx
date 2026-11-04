// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallBanner } from "@/domains/install/ui/install-banner";
import { markIntroSeen } from "@/domains/install/model/storage";
import {
  clearSignedIn,
  markSignedIn,
} from "@/domains/auth/model/signed-in-cookie";
import { GUEST_COOKIE, startAsGuest } from "@/domains/onboarding/model/storage";
import { rememberLoginReturn } from "../login-return";
import { HomeScreen } from "./home-screen";

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
const router = { replace: mocks.replace, refresh: mocks.refresh };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
}));
vi.mock("@/domains/auth/api/auth-client", () => ({ restore: mocks.restore }));
vi.mock("@/domains/place/ui/search-screen", () => ({
  SearchScreen: () => <div>검색 홈</div>,
}));
// 북마크 인증은 use-bookmark-access 테스트가 아니라 장소 화면 테스트에서 본다
vi.mock("../use-bookmark-access", () => ({ useBookmarkAccess: () => ({}) }));

const RETURN_KEY = "fitdining:login-return";
// 서버는 표시 쿠키가 있을 때 이 화면을 준다
const signedIn = () => markSignedIn(Date.now() / 1000 + 3600);
const restoreFails = () =>
  mocks.restore.mockImplementation(async () => {
    // 갱신 401이면 인증 모듈이 로그인 표시를 지운다
    clearSignedIn();
    throw new Error("unauthenticated");
  });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  clearSignedIn();
  document.cookie = `${GUEST_COOKIE}=; Path=/; Max-Age=0`;
  window.history.replaceState(null, "", "/");
});
afterEach(() => cleanup());

it("로그인 복구를 기다리지 않고 검색 홈을 그린다", () => {
  signedIn();
  mocks.restore.mockImplementation(() => new Promise(() => {}));
  render(<HomeScreen />);
  expect(screen.getByText("검색 홈")).toBeTruthy();
});

describe("표시 쿠키가 실제와 다르면 서버가 온보딩을 주도록 다시 받는다", () => {
  it("세션이 끝나 로그인 표시가 지워지면 다시 받는다", async () => {
    signedIn();
    restoreFails();
    render(<HomeScreen />);
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("비회원이면 로그인 복구에 실패해도 머문다", async () => {
    startAsGuest();
    restoreFails();
    render(<HomeScreen />);
    await act(async () => {});
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  // 연결 실패는 세션이 끝난 게 아니라 표시가 남는다. 다시 받으면 같은 화면이 되풀이된다
  it("연결 실패로 복구하지 못하면 머문다", async () => {
    signedIn();
    mocks.restore.mockRejectedValue(new TypeError("offline"));
    render(<HomeScreen />);
    await act(async () => {});
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("북마크 로그인 뒤 복귀", () => {
  beforeEach(signedIn);

  it("로그인된 상태로 쿼리 없는 홈에 오면 남은 주소로 한 번 replace하고 지운다", async () => {
    mocks.restore.mockResolvedValue({});
    rememberLoginReturn("/places/3?from=saved");
    render(<HomeScreen />);

    await vi.waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/places/3?from=saved"),
    );
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });

  it("로그인 없이 홈에 오면 주소를 버린다", async () => {
    startAsGuest();
    restoreFails();
    rememberLoginReturn("/places/3");
    render(<HomeScreen />);

    await act(async () => {});
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });

  it("남긴 지 10분이 지났으면 따르지 않는다", async () => {
    mocks.restore.mockResolvedValue({});
    rememberLoginReturn("/places/3", Date.now() - 10 * 60 * 1000 - 1);
    render(<HomeScreen />);

    await act(async () => {});
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
    render(<HomeScreen />);

    await act(async () => {});
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });

  it("쿼리가 있는 홈에 오면 남은 주소를 읽지 않는다", async () => {
    window.history.replaceState(null, "", "/?view=saved");
    mocks.restore.mockResolvedValue({});
    rememberLoginReturn("/places/3");
    render(<HomeScreen />);

    await act(async () => {});
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN_KEY)).not.toBeNull();
  });
});

it("첫 화면(4-01)에서는 홈 화면 추가 배너를 띄운다", async () => {
  markIntroSeen();
  startAsGuest();
  restoreFails();
  render(
    <>
      <HomeScreen />
      <InstallBanner />
    </>,
  );
  expect(
    await screen.findByRole("complementary", { name: "홈 화면 추가 안내" }),
  ).toBeTruthy();
});
