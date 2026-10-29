// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Textarea } from "./textarea";

afterEach(cleanup);
describe("Textarea 기존 레이아웃", () => {
  it("포커스는 바깥 링 없이 안쪽 1.5px 테두리 한 줄로 보여 준다", () => {
    const view = render(<Textarea label="리뷰" />);
    for (const emphasis of [undefined, false, true]) {
      view.rerender(
        <Textarea
          label="취향"
          emphasis={emphasis}
          value={emphasis ? "국물" : ""}
        />,
      );
      const frame = screen.getByRole("textbox").parentElement!;
      expect(frame.classList.contains("focus-within:border-1.5")).toBe(true);
      expect(
        frame.classList.contains("focus-within:border-primary-strong"),
      ).toBe(true);
      expect(frame.className).not.toContain("outline");
      expect(frame.classList.contains("border-primary-strong")).toBe(
        emphasis === true,
      );
    }
  });
  it("오류면 포커스 중에도 빨강 테두리를 유지한다", () => {
    render(<Textarea label="취향" emphasis aria-invalid />);
    const frame = screen.getByRole("textbox").parentElement!;
    expect(frame.classList.contains("border-danger")).toBe(true);
    expect(frame.className).not.toContain("primary-strong");
  });
  it("글자 수 제한이 없으면 footer를 만들지 않고 고정 높이를 유지한다", () => {
    render(<Textarea label="리뷰" />);
    const input = screen.getByRole("textbox");
    const frame = input.parentElement!;
    expect(frame.classList.contains("h-35")).toBe(true);
    expect(input.classList.contains("flex-1")).toBe(true);
    expect(input.classList.contains("min-h-0")).toBe(true);
    expect(frame.children.length).toBe(1);
    expect(frame.querySelector("div")).toBeNull();
  });
  it("리뷰 글자 수는 유지하고 footer 버튼 유무가 강조를 결정하지 않는다", () => {
    render(
      <Textarea
        label="리뷰"
        maxLength={500}
        footerAction={<button>분석</button>}
      />,
    );
    expect(screen.getByText("0/500")).toBeTruthy();
    expect(
      screen
        .getByRole("textbox")
        .parentElement?.classList.contains("border-primary-strong"),
    ).toBe(false);
  });
});
