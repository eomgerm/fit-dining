// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MeetupStartButton } from "./meetup-start-button";

afterEach(cleanup);

describe("홈의 모임 시작 버튼 (meetup AC-67)", () => {
  it("모임 만들기로 가는 링크다", () => {
    render(<MeetupStartButton />);
    expect(
      screen
        .getByRole("link", { name: "모임 장소 정하기" })
        .getAttribute("href"),
    ).toBe("/m/new");
  });
});
