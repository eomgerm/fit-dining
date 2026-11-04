import { expect, it } from "vitest";
import { SIGNED_IN_COOKIE } from "@/domains/auth/model/signed-in-cookie";
import { GUEST_COOKIE } from "@/domains/onboarding/model/storage";
import nextConfig from "../../../next.config";

// next.config는 @/ 별칭을 읽지 못해 쿠키 이름을 글자로 적는다. 여기서 앱의 이름과 맞는지 본다
it("로그인·비회원 표시(값 1)가 있는 / 요청만 /home으로 rewrite한다", async () => {
  const rewrites = await nextConfig.rewrites!();
  if (Array.isArray(rewrites)) throw new Error("beforeFiles가 있어야 한다");

  expect(rewrites.beforeFiles).toEqual(
    [SIGNED_IN_COOKIE, GUEST_COOKIE].map((key) => ({
      source: "/",
      has: [{ type: "cookie", key, value: "1" }],
      destination: "/home",
    })),
  );
});

it("/home 주소로 직접 오면 쿼리를 지닌 채 /로 보낸다", async () => {
  expect(await nextConfig.redirects!()).toContainEqual({
    source: "/home",
    destination: "/",
    permanent: false,
  });
});
