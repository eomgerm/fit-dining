import { describe, expect, it } from "vitest";
import { validateSignup } from "./signup";

const valid = {
  email: " User@Example.com ",
  password: "password1",
  confirmation: "password1",
  nickname: " 새이름 ",
};
describe("signup validation", () => {
  it("normalizes Unicode whitespace around email and nickname", () =>
    expect(
      validateSignup({
        ...valid,
        email: "\u00a0\u3000User@Example.com\u3000\u00a0",
        nickname: "\u00a0\u3000새이름\u3000\u00a0",
      }),
    ).toEqual({}));
  it.each(["새\t이름", "새\n이름", "새\u0000이름", "새\u0085이름"])(
    "rejects nickname control characters",
    (nickname) =>
      expect(validateSignup({ ...valid, nickname }).nickname).toBeTruthy(),
  );
  it("accepts trimmed email and nickname", () =>
    expect(validateSignup(valid)).toEqual({}));
  it.each([
    "",
    "abc",
    "a@b",
    "a b@example.com",
    "a@b..com",
    `${"a".repeat(243)}@example.com`,
  ])("rejects malformed/oversize email %s", (email) =>
    expect(validateSignup({ ...valid, email }).email).toBeTruthy(),
  );
  it.each(["short1", "password", "12345678", `abc1${"가".repeat(23)}`])(
    "rejects invalid password %s",
    (password) =>
      expect(validateSignup({ ...valid, password }).password).toBeTruthy(),
  );
  it("accepts a password of exactly 72 UTF-8 bytes", () =>
    expect(
      validateSignup({
        ...valid,
        password: `abc123${"가".repeat(22)}`,
        confirmation: `abc123${"가".repeat(22)}`,
      }),
    ).toEqual({}));
  it.each([" ", "a", "a".repeat(16)])("rejects nickname length", (nickname) =>
    expect(validateSignup({ ...valid, nickname }).nickname).toBeTruthy(),
  );
  it("counts nickname code points", () =>
    expect(validateSignup({ ...valid, nickname: "😀".repeat(15) })).toEqual(
      {},
    ));
  it("rejects mismatched confirmation", () =>
    expect(
      validateSignup({ ...valid, confirmation: "other" }).confirmation,
    ).toBeTruthy());
});
