import { describe, expect, it } from "vitest";
import {
  formatRemaining,
  validateSignup,
  validateVerificationCode,
  verificationSentMessage,
} from "./signup";

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

it("accepts exactly 254 email characters and rejects 255", () => {
  const email = `${"a".repeat(242)}@example.com`;
  expect(validateSignup({ ...valid, email })).toEqual({});
  expect(validateSignup({ ...valid, email: `a${email}` }).email).toBeTruthy();
});
it("accepts 72 ASCII password bytes and rejects 73", () => {
  const password = `a1${"a".repeat(70)}`;
  expect(
    validateSignup({ ...valid, password, confirmation: password }),
  ).toEqual({});
  expect(
    validateSignup({ ...valid, password: `${password}a` }).password,
  ).toBeTruthy();
});
it("accepts a trimmed 15-character nickname and rejects 16 code points", () => {
  expect(
    validateSignup({ ...valid, nickname: ` ${"가".repeat(15)} ` }),
  ).toEqual({});
  expect(
    validateSignup({ ...valid, nickname: "😀".repeat(16) }).nickname,
  ).toBeTruthy();
});

describe("email verification model", () => {
  it.each(["123456", "000000"])("accepts six digits %s", (code) =>
    expect(validateVerificationCode(code)).toBeUndefined(),
  );
  it.each(["12345", "1234567", "12a456", " 123456", "１２３４５６"])(
    "rejects %s",
    (code) =>
      expect(validateVerificationCode(code)).toBe(
        "인증번호 6자리를 입력해 주세요.",
      ),
  );
  it("formats remaining time without going below zero", () => {
    expect(formatRemaining(600_000)).toBe("10:00");
    expect(formatRemaining(59_001)).toBe("1:00");
    expect(formatRemaining(9_000)).toBe("0:09");
    expect(formatRemaining(-1)).toBe("0:00");
  });
  it("mentions the spam folder in the sent message", () =>
    expect(verificationSentMessage("a@example.com")).toBe(
      "a@example.com로 인증번호를 보냈어요. 메일이 안 보이면 스팸함도 확인해 주세요.",
    ));
});
