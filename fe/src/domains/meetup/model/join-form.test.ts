// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  canSubmit,
  EMPTY_JOIN_FORM,
  formFromTaste,
  isNameValid,
  isPriceValid,
  saveDraft,
  takeDraft,
  toTaste,
  type JoinForm,
} from "./join-form";
import type { MeetupQuestions } from "./meetup";

const ALL: MeetupQuestions = {
  mood: true,
  food: true,
  spicy: true,
  price: true,
};
const CAFE: MeetupQuestions = {
  mood: true,
  food: false,
  spicy: false,
  price: false,
};

const FILLED: JoinForm = {
  ...EMPTY_JOIN_FORM,
  name: "하린",
  mood: "QUIET",
  likeFoods: ["KOREAN"],
  avoidOpen: true,
  avoidFoods: ["CHINESE"],
  noSpicy: true,
  wantMenu: " 곱창 ",
  price: 20_000,
};

afterEach(() => sessionStorage.clear());

describe("질문지", () => {
  it("이름은 앞뒤 공백을 지운 값이 1~10자다", () => {
    expect(isNameValid("  하린 ")).toBe(true);
    expect(isNameValid("   ")).toBe(false);
    expect(isNameValid("가".repeat(11))).toBe(false);
  });

  it("직접 넣는 가격은 5천~10만 원, 1천 원 단위다", () => {
    expect(isPriceValid("5000")).toBe(true);
    expect(isPriceValid("100000")).toBe(true);
    expect(isPriceValid("4000")).toBe(false);
    expect(isPriceValid("15500")).toBe(false);
    expect(isPriceValid("")).toBe(false);
  });

  it("보이는 질문의 답만 보내고 메뉴의 공백을 지운다", () => {
    expect(toTaste(FILLED, ALL)).toEqual({
      mood: "QUIET",
      likeFoods: ["KOREAN"],
      avoidFoods: ["CHINESE"],
      wantMenu: "곱창",
      noSpicy: true,
      priceCap: 20_000,
    });
    expect(toTaste(FILLED, CAFE)).toEqual({ mood: "QUIET" });
  });

  it("상관없어요를 고르거나 빼고 싶은 음식을 접으면 그 답을 보내지 않는다", () => {
    expect(
      toTaste({ ...FILLED, anyFood: true, avoidOpen: false }, ALL),
    ).not.toHaveProperty("likeFoods");
    expect(toTaste({ ...FILLED, avoidOpen: false }, ALL)).not.toHaveProperty(
      "avoidFoods",
    );
  });

  it("직접 넣은 가격이 틀리면 보낼 수 없다", () => {
    const custom = { ...FILLED, price: "custom" as const, customPrice: "4000" };
    expect(canSubmit(custom, ALL, true)).toBe(false);
    expect(canSubmit({ ...custom, customPrice: "12000" }, ALL, true)).toBe(
      true,
    );
    expect(toTaste({ ...custom, customPrice: "12000" }, ALL).priceCap).toBe(
      12_000,
    );
  });

  it("남긴 취향으로 수정 질문지를 채운다", () => {
    const form = formFromTaste("하린", {
      mood: "LIVELY",
      avoidFoods: ["ASIAN"],
      priceCap: 12_000,
    });
    expect(form).toMatchObject({
      name: "하린",
      mood: "LIVELY",
      avoidOpen: true,
      avoidFoods: ["ASIAN"],
      price: "custom",
      customPrice: "12000",
    });
    expect(formFromTaste("하린", { priceCap: 30_000 }).price).toBe(30_000);
  });

  it("로그인하러 갈 때 쓰던 답은 한 번만 꺼낸다", () => {
    saveDraft("code", FILLED);
    expect(takeDraft("code")).toEqual(FILLED);
    expect(takeDraft("code")).toBeUndefined();
  });
});
