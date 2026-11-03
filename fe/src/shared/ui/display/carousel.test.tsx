// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Carousel } from "./carousel";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  on: vi.fn(),
  destroy: vi.fn(),
  selectedScrollSnap: vi.fn(),
  scrollTo: vi.fn(),
  internalEngine: vi.fn(),
  duration: vi.fn(),
  useDuration: vi.fn(),
}));
vi.mock("embla-carousel", () => ({
  default: (...args: unknown[]) => {
    mocks.create(...args);
    return mocks;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.internalEngine.mockReturnValue({ scrollBody: mocks });
  mocks.selectedScrollSnap.mockReturnValue(0);
});
afterEach(cleanup);

// 가장 최근에 만든 Embla에 건 이벤트를 일으킨다
function emit(event: string) {
  const handler = mocks.on.mock.calls.findLast(([name]) => name === event)?.[1];
  expect(handler).toBeTypeOf("function");
  act(() => handler());
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
      emit("pointerUp");
      expect(mocks.internalEngine).toHaveBeenCalledOnce();
      expect(mocks.useDuration).toHaveBeenCalledWith(speed * (15 / 25));
    },
  );

  it("duration이 없으면 Embla 기본 동작을 유지한다", () => {
    render(<Carousel label="사진">사진</Carousel>);
    emit("pointerUp");
    expect(mocks.internalEngine).not.toHaveBeenCalled();
    expect(mocks.useDuration).not.toHaveBeenCalled();
  });

  it("바뀐 duration을 쓰고, 언마운트하면 Embla를 정리한다", () => {
    mocks.duration.mockReturnValue(20);
    const view = render(
      <Carousel label="사진" options={{ duration: 15 }}>
        사진
      </Carousel>,
    );
    view.rerender(
      <Carousel label="사진" options={{ duration: 10 }}>
        사진
      </Carousel>,
    );
    emit("pointerUp");
    expect(mocks.useDuration).toHaveBeenLastCalledWith(8);
    view.unmount();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});

describe("Carousel 다시 만들기 (place-search D-102)", () => {
  function screen(mode: "visible" | "hidden", index?: number) {
    return (
      <Activity mode={mode}>
        <Carousel label="사진" index={index}>
          <span>1</span>
          <span>2</span>
          <span>3</span>
        </Carousel>
      </Activity>
    );
  }

  it("숨겼다 다시 보이면 마지막으로 보던 칸에서 바로 시작한다", () => {
    const view = render(screen("visible"));
    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ startIndex: 0 }),
    );
    mocks.selectedScrollSnap.mockReturnValue(2);
    emit("select");

    view.rerender(screen("hidden"));
    expect(mocks.destroy).toHaveBeenCalledOnce();
    view.rerender(screen("visible"));

    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ startIndex: 2 }),
    );
    expect(mocks.scrollTo).not.toHaveBeenCalled();
  });

  it("바깥에서 정한 칸이 있으면 그 칸에서 시작하고 미끄러지지 않는다", () => {
    const view = render(screen("visible", 0));
    view.rerender(screen("hidden", 0));
    view.rerender(screen("hidden", 2));
    mocks.selectedScrollSnap.mockReturnValue(2);
    view.rerender(screen("visible", 2));

    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ startIndex: 2 }),
    );
    expect(mocks.scrollTo).not.toHaveBeenCalled();
  });
});
