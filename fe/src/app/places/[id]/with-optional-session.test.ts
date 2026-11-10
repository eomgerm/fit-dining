import { expect, it, vi } from "vitest";
import { withOptionalSession } from "./with-optional-session";

it("인자 없이 send를 한 번 호출하고 결과를 반환한다", async () => {
  const send = vi.fn().mockResolvedValue("result");
  await expect(withOptionalSession(send)).resolves.toBe("result");
  expect(send.mock.calls).toEqual([[]]);
});

it.each([new Error("network"), { status: 401 }])(
  "오류를 그대로 전달하고 재시도하지 않는다: %s",
  async (error) => {
    const send = vi.fn().mockRejectedValue(error);
    await expect(withOptionalSession(send)).rejects.toBe(error);
    expect(send.mock.calls).toEqual([[]]);
  },
);
