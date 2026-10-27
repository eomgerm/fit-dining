import Image from "next/image";
import { KakaoIcon } from "@/shared/ui/icon/icons/kakao";
export function SocialButtons({ from }: { from: "login" | "signup" }) {
  return (
    <div className="flex flex-col gap-3">
      {(["kakao", "naver", "google"] as const).map((provider) => (
        <a
          key={provider}
          href={`/api/auth/oauth/${provider}?from=${from}`}
          className={`inline-flex h-12 w-full items-center justify-center rounded-md px-5 text-button-md whitespace-nowrap transition select-none motion-safe:active:scale-98 ${provider === "kakao" ? "bg-kakao text-ink" : provider === "naver" ? "bg-naver text-on-primary" : "border border-line-strong bg-surface text-ink"}`}
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
