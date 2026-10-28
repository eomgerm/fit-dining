// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Carousel } from "./carousel";

const mocks = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  internalEngine: vi.fn(),
  duration: vi.fn(),
  useDuration: vi.fn(),
}));
vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), mocks],
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.internalEngine.mockReturnValue({ scrollBody: mocks });
});
afterEach(cleanup);

function pointerUp() {
  const handler = mocks.on.mock.calls.find(
    ([event]) => event === "pointerUp",
  )?.[1];
  expect(handler).toBeTypeOf("function");
  handler();
}

describe("Carousel 스와이프 정착 시간", () => {
  it.each([25, 18, 0])(
    "현재 시간 %s에 duration / 25 비율을 적용한다",
    (speed) => {
      mocks.duration.mockReturnValue(speed);
      render(
        <Carousel label="사진" options={{ duration: 15 }}>
          사진
        </Carousel>,
      );
      pointerUp();
      expect(mocks.internalEngine).toHaveBeenCalledOnce();
      expect(mocks.useDuration).toHaveBeenCalledWith(speed * (15 / 25));
    },
  );

  it("duration이 없으면 Embla 기본 동작을 유지한다", () => {
    render(<Carousel label="사진">사진</Carousel>);
    expect(mocks.on).not.toHaveBeenCalled();
    expect(mocks.internalEngine).not.toHaveBeenCalled();
    expect(mocks.useDuration).not.toHaveBeenCalled();
  });

  it("duration 변경과 언마운트 시 이전 이벤트를 해제한다", () => {
    mocks.duration.mockReturnValue(20);
    const view = render(
      <Carousel label="사진" options={{ duration: 15 }}>
        사진
      </Carousel>,
    );
    const first = mocks.on.mock.calls[0][1];
    view.rerender(
      <Carousel label="사진" options={{ duration: 10 }}>
        사진
      </Carousel>,
    );
    expect(mocks.off).toHaveBeenCalledWith("pointerUp", first);
    const latest = mocks.on.mock.calls.at(-1)![1];
    latest();
    expect(mocks.useDuration).toHaveBeenLastCalledWith(8);
    view.unmount();
    expect(mocks.off).toHaveBeenLastCalledWith("pointerUp", latest);
  });
});
