import { describe, expect, it } from "vitest";

import { parsePlaceId } from "./place-id";

describe("parsePlaceId", () => {
  it.each([
    ["1", 1],
    ["42", 42],
    ["9007199254740991", 9007199254740991],
  ])("%s는 %d다", (raw, id) => {
    expect(parsePlaceId(raw)).toBe(id);
  });

  it.each([
    null,
    "",
    "0",
    "007",
    "-1",
    "1.5",
    "1e3",
    " 1",
    "abc",
    "9007199254740992",
  ])("%s는 요청하지 않는다", (raw) => {
    expect(parsePlaceId(raw)).toBeUndefined();
  });
});
