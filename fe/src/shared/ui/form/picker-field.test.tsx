// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PickerField } from "./picker-field";

function mount() {
  render(
    <PickerField
      type="date"
      label="모임 날짜"
      value=""
      placeholder="날짜 고르기"
      icon={null}
      onChange={() => {}}
    />,
  );
  return screen.getByLabelText("모임 날짜") as HTMLInputElement;
}

afterEach(() => {
  cleanup();
});

describe("PickerField", () => {
  it("칸을 누르면 기기 고르기를 바로 연다", () => {
    const input = mount();
    const showPicker = vi.fn();
    input.showPicker = showPicker;

    fireEvent.click(input);

    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it("고르기를 열 수 없는 브라우저에서도 누를 수 있다", () => {
    const input = mount();
    input.showPicker = () => {
      throw new DOMException("not allowed", "NotAllowedError");
    };

    expect(() => fireEvent.click(input)).not.toThrow();
  });
});
