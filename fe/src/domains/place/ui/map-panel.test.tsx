// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MapPanel, type PanelState } from "./map-panel";

function Harness({ initial }: { initial: PanelState }) {
  const [state, setState] = useState<PanelState>(initial);
  return (
    <MapPanel state={state} label="패널" onStateChange={setState}>
      <p>내용</p>
    </MapPanel>
  );
}

const panel = () => screen.getByRole("region", { name: "패널" });
const handle = () =>
  screen.getByRole("button", { name: /패널 (펼치기|줄이기)/ });

beforeEach(() => {
  // jsdom은 크기를 재지 않는다. 지도 영역 높이를 1000px로 둔다
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(1000);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MapPanel 손잡이 끌기", () => {
  it("끄는 동안 손가락을 따라오고, 놓으면 상태 위치로 돌아간다", () => {
    render(<Harness initial="full" />);

    fireEvent.pointerDown(handle(), {
      clientY: 100,
      pointerId: 1,
      isPrimary: true,
    });
    fireEvent.pointerMove(handle(), { clientY: 220, pointerId: 1 });

    expect(panel().style.getPropertyValue("--panel-drag")).toBe("120px");
    expect(panel().hasAttribute("data-dragging")).toBe(true);

    fireEvent.pointerUp(handle(), { clientY: 220, pointerId: 1 });

    expect(panel().style.getPropertyValue("--panel-drag")).toBe("");
    expect(panel().hasAttribute("data-dragging")).toBe(false);
    expect(handle().getAttribute("aria-label")).toBe("패널 펼치기");
  });

  it("전체 높이 위로는 끌려 올라가지 않는다", () => {
    render(<Harness initial="full" />);

    fireEvent.pointerDown(handle(), {
      clientY: 100,
      pointerId: 1,
      isPrimary: true,
    });
    fireEvent.pointerMove(handle(), { clientY: 40, pointerId: 1 });

    expect(panel().style.getPropertyValue("--panel-drag")).toBe("0px");
  });

  it("30px 넘게 끌어 바꾼 뒤 따라오는 클릭은 상태를 되돌리지 않는다", () => {
    render(<Harness initial="full" />);

    fireEvent.pointerDown(handle(), {
      clientY: 100,
      pointerId: 1,
      isPrimary: true,
    });
    fireEvent.pointerMove(handle(), { clientY: 160, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 160, pointerId: 1 });
    fireEvent.click(handle(), { detail: 1 });

    expect(handle().getAttribute("aria-label")).toBe("패널 펼치기");

    // 그다음 탭은 다시 상태를 바꾼다
    fireEvent.click(handle(), { detail: 1 });
    expect(handle().getAttribute("aria-label")).toBe("패널 줄이기");
  });

  it("멀리 끌었다 제자리로 돌아와 놓으면 따라오는 클릭에도 상태가 그대로다", () => {
    render(<Harness initial="middle" />);

    fireEvent.pointerDown(handle(), {
      clientY: 500,
      pointerId: 1,
      isPrimary: true,
    });
    fireEvent.pointerMove(handle(), { clientY: 350, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 500, pointerId: 1 });
    fireEvent.click(handle(), { detail: 1 });

    expect(handle().getAttribute("aria-label")).toBe("패널 펼치기");
  });

  it("끌기 뒤 클릭이 오지 않았어도 키보드로 누르면 바로 바뀐다", () => {
    render(<Harness initial="full" />);

    // 터치로 끌면 브라우저가 클릭을 보내지 않는다
    fireEvent.pointerDown(handle(), {
      clientY: 100,
      pointerId: 1,
      isPrimary: true,
    });
    fireEvent.pointerMove(handle(), { clientY: 160, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 160, pointerId: 1 });
    expect(handle().getAttribute("aria-label")).toBe("패널 펼치기");

    // Enter·Space 클릭은 detail이 0이다
    fireEvent.click(handle(), { detail: 0 });
    expect(handle().getAttribute("aria-label")).toBe("패널 줄이기");
  });

  it("짧게 끌었다 놓으면 상태가 그대로다", () => {
    render(<Harness initial="middle" />);

    fireEvent.pointerDown(handle(), {
      clientY: 500,
      pointerId: 1,
      isPrimary: true,
    });
    fireEvent.pointerMove(handle(), { clientY: 490, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 490, pointerId: 1 });

    expect(handle().getAttribute("aria-label")).toBe("패널 펼치기");
  });

  it("끌다 취소되면 제자리로 돌아간다", () => {
    render(<Harness initial="full" />);

    fireEvent.pointerDown(handle(), {
      clientY: 100,
      pointerId: 1,
      isPrimary: true,
    });
    fireEvent.pointerMove(handle(), { clientY: 200, pointerId: 1 });
    fireEvent.pointerCancel(handle(), { pointerId: 1 });

    expect(panel().style.getPropertyValue("--panel-drag")).toBe("");
    expect(handle().getAttribute("aria-label")).toBe("패널 줄이기");
  });

  it("상태를 바꿀 수 없는 패널은 손잡이를 버튼으로 두지 않는다", () => {
    render(
      <MapPanel state="middle" label="패널">
        <p>내용</p>
      </MapPanel>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
