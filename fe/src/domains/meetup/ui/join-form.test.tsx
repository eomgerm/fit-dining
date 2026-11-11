// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EMPTY_JOIN_FORM } from "../model/join-form";
import type { MeetupQuestions } from "../model/meetup";
import { JoinFormView, type JoinMode } from "./join-form";

const ALL: MeetupQuestions = {
  mood: true,
  food: true,
  spicy: true,
  price: true,
};

function mount(
  props: Partial<Parameters<typeof JoinFormView>[0]> & { mode?: JoinMode } = {},
) {
  const handlers = {
    onSubmit: vi.fn(),
    onBack: vi.fn(),
    onSignIn: vi.fn(),
    onPickName: vi.fn(),
  };
  render(
    <JoinFormView
      mode="guest"
      hostNickname="민지"
      questions={ALL}
      initial={EMPTY_JOIN_FORM}
      signedIn={false}
      pending={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const submit = () =>
  screen.getByRole("button", { name: /취향 남기기|저장/ }) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("질문지", () => {
  it("이름이 없으면 보낼 수 없고, 이름을 넣으면 고른 답을 넘긴다", () => {
    const { onSubmit } = mount();
    expect(submit().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/이름/), {
      target: { value: "하린" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /조용하고 차분한 곳/ }));
    fireEvent.click(screen.getByRole("button", { name: "한식" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /매운 걸 잘 못 먹어요/ }),
    );
    fireEvent.click(submit());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "하린",
        mood: "QUIET",
        likeFoods: ["KOREAN"],
        noSpicy: true,
      }),
    );
  });

  it("보일 질문만 보인다. 술집은 매운 음식만, 카페는 분위기만 묻는다", () => {
    mount({
      questions: { mood: true, food: false, spicy: true, price: false },
    });
    expect(screen.queryByText("먹고 싶은 음식이 있나요?")).toBeNull();
    expect(screen.getByText("음식")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /매운 걸/ })).toBeTruthy();
    cleanup();

    mount({
      questions: { mood: true, food: false, spicy: false, price: false },
    });
    expect(screen.queryByRole("checkbox", { name: /매운 걸/ })).toBeNull();
    expect(screen.queryByText("메뉴 하나에 얼마까지 괜찮아요?")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "분위기" })).toBeTruthy();
  });

  it("빼고 싶은 음식 종류는 펼쳐야 고른다", () => {
    mount();
    const toggle = screen.getByRole("button", {
      name: /빼고 싶은 음식 종류가 있어요/,
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("group", { name: "빼고 싶은 음식 종류" }),
    ).toBeNull();
    fireEvent.click(toggle);
    expect(
      screen.getByRole("group", { name: "빼고 싶은 음식 종류" }),
    ).toBeTruthy();
  });

  it("가격을 직접 넣으면 범위 안의 1천 원 단위여야 보낸다", () => {
    mount({ initial: { ...EMPTY_JOIN_FORM, name: "하린" } });
    fireEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    const amount = screen.getByLabelText("금액");
    fireEvent.change(amount, { target: { value: "4,000" } });
    expect((amount as HTMLInputElement).value).toBe("4000");
    expect(submit().disabled).toBe(true);
    fireEvent.change(amount, { target: { value: "12000" } });
    expect(submit().disabled).toBe(false);
  });

  it("이미 있는 이름이면 칸 아래에 알리고 이름 고르기로 보낸다", () => {
    const { onPickName } = mount({
      initial: { ...EMPTY_JOIN_FORM, name: "하린" },
      takenName: "하린",
    });
    expect(screen.getByText(/'하린'은 이미 있는 이름이에요/)).toBeTruthy();
    expect(submit().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "이름 고르기" }));
    expect(onPickName).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/이름/), {
      target: { value: "하린2" },
    });
    expect(screen.queryByText(/이미 있는 이름이에요/)).toBeNull();
  });

  it("비회원이 로그인을 누르면 쓰던 답을 넘긴다", () => {
    const { onSignIn } = mount();
    fireEvent.change(screen.getByLabelText(/이름/), {
      target: { value: "하린" },
    });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(onSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ name: "하린" }),
    );
  });

  it("모임장은 다른 제목과 닉네임 안내를 보고, 수정은 이름 칸 없이 저장한다", () => {
    mount({ mode: "host", signedIn: true });
    expect(screen.getByText("내 취향부터 남겨요")).toBeTruthy();
    expect(screen.getByText(/회원 닉네임을 그대로 넣었어요/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "로그인" })).toBeNull();
    cleanup();

    const { onSubmit } = mount({ mode: "edit" });
    expect(screen.queryByLabelText(/이름/)).toBeNull();
    fireEvent.click(submit());
    expect(onSubmit).toHaveBeenCalled();
  });

  it("남긴 취향을 링크를 가진 사람이 본다고 알린다", () => {
    mount();
    expect(
      screen.getByText(/남긴 취향은 모임 링크를 가진 사람에게 보여요/),
    ).toBeTruthy();
  });
});
