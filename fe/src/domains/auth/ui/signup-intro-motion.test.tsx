// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SignupIntroMotion } from "./signup-intro-motion";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

it("clips the status-bar-adjusted band and preserves the reference stage transforms", () => {
  const css = readFileSync(
    resolve("src/domains/auth/ui/signup-intro-motion.css"),
    "utf8",
  );
  const rule = (selector: string) =>
    css.slice(css.indexOf(`${selector} {`)).split("}")[0];
  expect(rule(".signup-motion")).toContain("height: 352px;");
  expect(rule(".signup-motion")).toContain("overflow: hidden;");
  expect(rule(".signup-motion-stage")).toContain("top: -28px;");
  for (const [slide, transform] of [
    [1, "translateY(49px) scale(0.82)"],
    [2, "translateY(49px) scale(0.94)"],
    [3, "scale(0.94)"],
  ]) {
    const stage = rule(`.signup-motion-stage > .m${slide}-fd`);
    expect(stage).toContain("transform-origin: 50% 0;");
    expect(stage).toContain(`transform: ${transform};`);
  }
});

afterEach(cleanup);
it("hides artwork and transfers playback between slides", () => {
  const slides = (active: number) =>
    [0, 1, 2].map((slide) => (
      <SignupIntroMotion key={slide} slide={slide} playing={slide === active} />
    ));
  const { container, rerender } = render(<>{slides(0)}</>);
  expect(
    container.querySelectorAll('.signup-motion[aria-hidden="true"]'),
  ).toHaveLength(3);
  expect(container.querySelectorAll("[data-playing]")).toHaveLength(1);
  expect(container.querySelector("[data-playing] .m1-fd")).toBeTruthy();
  rerender(<>{slides(1)}</>);
  expect(container.querySelectorAll("[data-playing]")).toHaveLength(1);
  expect(container.querySelector("[data-playing] .m2-fd")).toBeTruthy();
  expect(
    container.querySelector(".m1-fd")?.closest("[data-playing]"),
  ).toBeNull();
  rerender(<>{slides(0)}</>);
  expect(container.querySelector("[data-playing] .m1-fd")).toBeTruthy();
});
