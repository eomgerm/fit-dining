"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, logout, subscribe } from "@/domains/auth/api/auth-client";
import {
  getUserProfile,
  type UserProfile,
} from "@/domains/auth/api/user-profile";
import { savedPlacesHref } from "@/domains/place/model/bookmark";
import { savedViewState } from "@/domains/place/ui/saved-view-state";
import { isApiError } from "@/shared/api/api-error";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { ChevronRightIcon } from "@/shared/ui/icon/icons/chevron-right";
import { useToast } from "@/shared/ui/overlay/toast";
import { TopBar } from "@/shared/ui/layout/top-bar";
const loginMessages = {
  email: "이메일로 로그인했어요",
  kakao: "카카오 계정으로 로그인했어요",
  naver: "네이버 계정으로 로그인했어요",
  google: "구글 계정으로 로그인했어요",
};
export default function MyPage() {
  const router = useRouter();
  const toast = useToast();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loggingOut = useRef(false);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribe(() => {
      if (!getSession() && !loggingOut.current) {
        setProfile(null);
        router.replace("/login");
      }
    });
    getUserProfile()
      .then((value) => {
        if (active && getSession()) setProfile(value);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (!getSession() || (isApiError(cause) && cause.status === 401))
          router.replace("/login");
        else setError("내 정보를 불러오지 못했어요. 다시 시도해 주세요.");
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [router]);
  // 메인과 같은 저장한 장소 화면을 연다. 그 화면의 [뒤로]는 내 정보로 돌아온다(북마크 D-9)
  function openSaved() {
    savedViewState.enter({ from: "my" });
    router.push(savedPlacesHref());
  }
  async function handleLogout() {
    if (loggingOut.current) return;
    loggingOut.current = true;
    setBusy(true);
    try {
      await logout();
      router.replace("/");
    } catch (cause: unknown) {
      if (isApiError(cause) && cause.status === 401) router.replace("/");
      else {
        toast("로그아웃하지 못했어요. 다시 시도해 주세요.");
        if (!getSession()) router.replace("/login");
      }
    } finally {
      loggingOut.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="min-h-dvh bg-surface text-ink">
      <TopBar
        title="내 정보"
        start={
          <IconButton
            label="이전"
            onClick={() =>
              window.history.length > 1 ? router.back() : router.replace("/")
            }
          >
            <ChevronLeftIcon />
          </IconButton>
        }
      />
      {error ? (
        <p role="alert" className="p-5 text-body-md">
          {error}
        </p>
      ) : !profile ? (
        <p role="status" className="p-5 text-body-md">
          내 정보를 불러오고 있어요
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3.5 px-5 pt-2 pb-5">
            <span
              aria-hidden="true"
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary-soft text-title-lg text-primary-strong"
            >
              {Array.from(profile.nickname)[0]}
            </span>
            <div>
              <div className="text-title-md">{profile.nickname}</div>
              <p className="text-caption-md text-ink-muted">
                {loginMessages[profile.loginMethod]}
              </p>
            </div>
          </div>
          <nav aria-label="내 정보 메뉴" className="border-t-8 border-line">
            {[
              "저장한 장소",
              "이용약관",
              "개인정보처리방침",
              "로그아웃",
              "탈퇴하기",
            ].map((label, index) => (
              <button
                key={label}
                type="button"
                disabled={label === "로그아웃" && busy}
                onClick={
                  label === "로그아웃"
                    ? handleLogout
                    : label === "저장한 장소"
                      ? openSaved
                      : label === "이용약관"
                        ? () => router.push("/terms")
                        : label === "개인정보처리방침"
                          ? () => router.push("/privacy")
                          : () => toast("준비 중이에요")
                }
                className={`flex min-h-13 w-full items-center justify-between border-b border-line px-5 text-left text-body-md disabled:opacity-50 ${label === "탈퇴하기" ? "text-ink-muted" : "text-ink"}`}
              >
                {label}
                {index < 3 && <ChevronRightIcon className="text-ink-muted" />}
              </button>
            ))}
          </nav>
        </>
      )}
    </main>
  );
}
