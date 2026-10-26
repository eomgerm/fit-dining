// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Textarea } from "./textarea";

afterEach(cleanup);
describe("Textarea 기존 레이아웃", () => {
  it("강조 입력칸은 입력 유무와 관계없이 키보드 포커스 링을 유지한다", () => {
    const view = render(<Textarea label="취향" emphasis={false} />);
    for (const emphasis of [false, true]) {
      view.rerender(
        <Textarea
          label="취향"
          emphasis={emphasis}
          value={emphasis ? "국물" : ""}
        />,
      );
      const frame = screen.getByRole("textbox").parentElement!;
      for (const name of [
        "has-[:focus-visible]:outline-2",
        "has-[:focus-visible]:outline-offset-2",
        "has-[:focus-visible]:outline-focus-ring",
        "focus-within:border-1.5",
        "focus-within:border-primary-strong",
      ])
        expect(frame.classList.contains(name)).toBe(true);
      expect(frame.classList.contains("focus-within:outline-none")).toBe(false);
      expect(frame.classList.contains("border-primary-strong")).toBe(emphasis);
    }
  });
  it("emphasis 없는 리뷰 입력칸은 기존 포커스 링 클래스를 유지한다", () => {
    render(<Textarea label="리뷰" maxLength={500} />);
    const frame = screen.getByRole("textbox").parentElement!;
    for (const name of [
      "focus-within:outline-2",
      "focus-within:outline-offset-2",
      "focus-within:outline-focus-ring",
    ])
      expect(frame.classList.contains(name)).toBe(true);
    expect(frame.className).not.toContain("has-[:focus-visible]");
    expect(frame.className).not.toContain("border-1.5");
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
