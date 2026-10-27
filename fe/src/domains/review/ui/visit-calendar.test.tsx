// @vitest-environment jsdom
import { cleanup, render as mount, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { VisitCalendar, VisitDateSheet } from "./visit-calendar";

afterEach(cleanup);

function render() {
  return renderToStaticMarkup(
    <VisitCalendar
      month={{ year: 2026, month: 10 }}
      range={{ min: "2026-09-21", max: "2026-10-19" }}
      reviewedDates={["2026-10-12"]}
      today="2026-10-19"
      selected="2026-10-17"
      onSelect={() => {}}
    />,
  );
}

const button = (html: string, label: string) =>
  html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";

describe("VisitCalendar", () => {
  it("이미 쓴 날은 작성함으로 읽히고 취소선으로 막힌다", () => {
    const day = button(render(), "10월 12일 \\(월\\) 작성함");
    expect(day).toContain("disabled");
    expect(day).toContain("line-through");
  });

  it("오늘 뒤의 날은 고를 수 없다", () => {
    const html = render();
    expect(button(html, "10월 20일 \\(화\\)")).toContain("disabled");
    expect(button(html, "10월 31일 \\(토\\)")).toContain("disabled");
    expect(button(html, "10월 19일 \\(월\\)")).not.toContain("disabled");
  });

  it("고른 날을 표시한다", () => {
    expect(button(render(), "10월 17일 \\(토\\)")).toContain(
      'aria-pressed="true"',
    );
  });

  it("일요일부터 요일 머리를 보인다", () => {
    expect(render()).toMatch(/>일<.*>월<.*>화<.*>수<.*>목<.*>금<.*>토</);
  });
});

describe("VisitDateSheet", () => {
  it("다시 받은 범위 밖의 방문일을 받으면 고르지 않은 채 오늘이 있는 달을 연다", async () => {
    mount(
      <VisitDateSheet
        open
        onOpenChange={() => {}}
        range={{ min: "2026-10-01", max: "2026-11-01" }}
        reviewedDates={[]}
        today="2026-11-01"
        value="2026-09-30"
        onConfirm={() => {}}
      />,
    );

    expect(await screen.findByText("2026년 11월")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "방문일을 골라 주세요" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
