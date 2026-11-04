import Image from "next/image";
import { KakaoIcon } from "@/shared/ui/icon/icons/kakao";
import { markSignedIn } from "../model/signed-in-cookie";

// 기존 회원은 제공자 화면을 거쳐 BE가 바로 홈(/)으로 보낸다. 그 첫 요청이 검색 홈을 받도록 로그인 표시를 미리 남긴다.
// 로그인이 끝나면 갱신이 세션 만료까지로 늘리고, 끝나지 않으면 홈의 복구 실패나 10분 만료로 사라진다
const PENDING_SECONDS = 10 * 60;
export function SocialButtons({ from }: { from: "login" | "signup" }) {
  return (
    <div className="flex flex-col gap-3">
      {(["kakao", "naver", "google"] as const).map((provider) => (
        <a
          key={provider}
          href={`/api/auth/oauth/${provider}?from=${from}`}
          onClick={() => markSignedIn(Date.now() / 1000 + PENDING_SECONDS)}
          className={`inline-flex h-13 w-full items-center justify-center rounded-md px-5 text-button-md whitespace-nowrap transition select-none motion-safe:active:scale-98 ${provider === "kakao" ? "bg-kakao text-ink" : provider === "naver" ? "bg-naver text-on-primary" : "border border-line-strong bg-surface text-ink"}`}
        >
          {provider === "kakao" ? (
            <KakaoIcon size="md" className="mr-2" />
          ) : (
            <Image
              src={`/brand/${provider}.svg`}
              alt=""
              width={20}
              height={20}
              unoptimized
              className="mr-2"
            />
          )}
          {{ kakao: "카카오", naver: "네이버", google: "구글" }[provider]}로
          계속하기
        </a>
      ))}
    </div>
  );
}
