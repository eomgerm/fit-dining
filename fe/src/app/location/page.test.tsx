// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { searchStore } from "@/domains/place/model/search-store";
import LocationPage from "./page";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  query: vi.fn(),
  position: vi.fn(),
}));
const router = { replace: mocks.replace };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ state: "prompt" });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: mocks.query },
  });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: mocks.position },
  });
  searchStore.setLocation({ status: "idle" });
});
afterEach(cleanup);

it("위치 안내와 그림을 표시하고 뒤로가기 버튼은 표시하지 않는다", () => {
  render(<LocationPage />);
  expect(
    screen.getByRole("heading", { name: /위치 권한을\s*허용해 주세요/ }),
  ).toBeTruthy();
  expect(screen.getByText(/내 주변 장소를 찾기 위해서/)).toBeTruthy();
  expect(document.querySelector("img")?.getAttribute("alt")).toBe("");
  expect(screen.getAllByRole("button")).toHaveLength(2);
});

it("건너뛰기는 위치 요청 없이 홈으로 이동한다", () => {
  render(<LocationPage />);
  fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
  expect(mocks.replace).toHaveBeenCalledWith("/");
  expect(mocks.position).not.toHaveBeenCalled();
});

it.each(["success", "denied", "unavailable", "timeout"])(
  "위치 요청 %s 결과를 저장하고 홈으로 이동한다",
  async (result) => {
    render(<LocationPage />);
    const allow = screen.getByRole("button", { name: "위치 허용하기" });
    fireEvent.click(allow);
    fireEvent.click(allow);
    expect(
      screen.getByRole("heading", { name: /가까운 곳부터\s*보여 드릴게요/ }),
    ).toBeTruthy();
    expect(screen.getByText(/허용하지 않으면 역삼역 주변/)).toBeTruthy();
    expect(allow.getAttribute("aria-disabled")).toBe("true");
    expect(mocks.position).toHaveBeenCalledTimes(1);
    expect(mocks.position.mock.calls[0][2]).toEqual({
      timeout: 10_000,
      maximumAge: 300_000,
    });
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => {
      if (result === "success")
        mocks.position.mock.calls[0][0]({
          coords: { latitude: 37.5, longitude: 127 },
        });
      else
        mocks.position.mock.calls[0][1]({
          code: { denied: 1, unavailable: 2, timeout: 3 }[result],
        });
    });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
    expect(searchStore.getSnapshot().location).toEqual(
      result === "success"
        ? { status: "ok", here: { lat: 37.5, lng: 127 } }
        : { status: "failed" },
    );
  },
);

it("이미 허용된 권한이면 요청 없이 홈으로 이동한다", async () => {
  mocks.query.mockResolvedValue({ state: "granted" });
  render(<LocationPage />);
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
  expect(mocks.position).not.toHaveBeenCalled();
});

it("건너뛴 뒤 권한 조회가 완료되어도 다시 이동하지 않는다", async () => {
  let finish!: (permission: { state: string }) => void;
  mocks.query.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<LocationPage />);
  fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
  await act(async () => {
    finish({ state: "granted" });
  });
  expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/");
  expect(mocks.position).not.toHaveBeenCalled();
});

it("위치 요청 중에도 허용 버튼의 포커스를 유지하고 재요청을 막는다", () => {
  render(<LocationPage />);
  const allow = screen.getByRole("button", { name: "위치 허용하기" });
  allow.focus();
  fireEvent.click(allow);
  expect(document.activeElement).toBe(allow);
  expect(allow.hasAttribute("disabled")).toBe(false);
  expect(allow.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(allow);
  fireEvent.keyDown(allow, { key: "Enter" });
  fireEvent.keyUp(allow, { key: "Enter" });
  expect(mocks.position).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(allow);
});

it.each(["missing", "error"])(
  "권한 조회가 %s 상태여도 안내를 유지한다",
  async (result) => {
    if (result === "missing")
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: undefined,
      });
    else mocks.query.mockRejectedValue(new Error("unsupported"));
    await act(async () => {
      render(<LocationPage />);
    });
    expect(screen.getByRole("button", { name: "위치 허용하기" })).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  },
);
