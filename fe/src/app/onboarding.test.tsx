// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeEntry } from "./home-entry";
const mocks = vi.hoisted(() => ({ mount: vi.fn() }));
vi.mock("@/domains/place/ui/search-screen", () => ({
  SearchScreen: () => {
    mocks.mount();
    return <div>검색 홈</div>;
  },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.mount.mockClear();
});
function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}
describe("HomeEntry", () => {
  it("홈을 완료 후에만 마운트하며 저장과 요청 없이 건너뛴다", () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const cookie = vi.spyOn(document, "cookie", "set");
    const fetch = vi.spyOn(globalThis, "fetch");
    render(<HomeEntry />);
    expect(mocks.mount).not.toHaveBeenCalled();
    click("시작하기");
    click("건너뛰기");
    expect(screen.getByText("검색 홈")).toBeTruthy();
    expect(storage).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
