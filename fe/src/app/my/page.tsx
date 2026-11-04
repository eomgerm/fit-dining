"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, logout, subscribe } from "@/domains/auth/api/auth-client";
import {
  getUserProfile,
  withdraw,
  type UserProfile,
} from "@/domains/auth/api/user-profile";
import { endGuest } from "@/domains/onboarding/model/storage";
import { savedPlacesHref } from "@/domains/place/model/bookmark";
import { savedViewState } from "@/domains/place/ui/saved-view-state";
import { isApiError } from "@/shared/api/api-error";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { ChevronRightIcon } from "@/shared/ui/icon/icons/chevron-right";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";
import { useToast } from "@/shared/ui/overlay/toast";
import { Screen } from "@/shared/ui/layout/screen";
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
  const [dialog, setDialog] = useState<"logout" | "withdraw" | null>(null);
  const [busy, setBusy] = useState(false);
  // 로그아웃·탈퇴 중에는 세션이 비어도 /login으로 보내지 않는다(성공하면 /로 간다)
  const loggingOut = useRef(false);
  const withdrawing = useRef(false);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribe(() => {
      if (!getSession() && !loggingOut.current && !withdrawing.current) {
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
  // 화면을 옮길 때는 처리 중 상태를 풀지 않는다. 이동이 끝날 때까지 모달의 두 버튼을 막아 다시 누르지 못하게 한다
  async function handleLogout() {
    if (loggingOut.current) return;
    loggingOut.current = true;
    setBusy(true);
    try {
      await logout();
      router.replace("/");
      // 표시 쿠키가 바뀌었으니 브라우저에 남은 홈(/) 화면을 버린다(next.config의 / rewrite)
      router.refresh();
    } catch (cause: unknown) {
      if (isApiError(cause) && cause.status === 401) {
        router.replace("/");
        router.refresh();
      } else {
        loggingOut.current = false;
        setBusy(false);
        setDialog(null);
        toast("로그아웃하지 못했어요. 다시 시도해 주세요.");
        if (!getSession()) router.replace("/login");
      }
    }
  }
  async function handleWithdraw() {
    if (withdrawing.current) return;
    withdrawing.current = true;
    setBusy(true);
    try {
      await withdraw();
      endGuest();
      router.replace("/");
      router.refresh();
      toast("탈퇴했어요");
    } catch (cause: unknown) {
      if (isApiError(cause) && cause.status === 401) router.replace("/login");
      else {
        withdrawing.current = false;
        setBusy(false);
        setDialog(null);
        toast("탈퇴하지 못했어요. 다시 시도해 주세요.");
        // 탈퇴 중 다른 탭이 로그아웃해 세션이 비었으면 subscribe가 건너뛴 이동을 여기서 한다
        if (!getSession()) router.replace("/login");
      }
    }
  }
  return (
    <Screen>
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
                onClick={
                  label === "로그아웃"
                    ? () => setDialog("logout")
                    : label === "저장한 장소"
                      ? openSaved
                      : label === "이용약관"
                        ? () => router.push("/terms")
                        : label === "개인정보처리방침"
                          ? () => router.push("/privacy")
                          : () => setDialog("withdraw")
                }
                className={`flex min-h-13 w-full items-center justify-between border-b border-line px-5 text-left text-body-md ${label === "탈퇴하기" ? "text-ink-muted" : "text-ink"}`}
              >
                {label}
                {index < 3 && <ChevronRightIcon className="text-ink-muted" />}
              </button>
            ))}
          </nav>
        </>
      )}
      <ConfirmDialog
        open={dialog === "logout"}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
        title="로그아웃할까요?"
        secondaryAction={
          <Button
            variant="outline"
            size="md"
            disabled={busy}
            focusableWhenDisabled
            onClick={() => setDialog(null)}
          >
            취소
          </Button>
        }
        action={
          <Button
            size="md"
            disabled={busy}
            focusableWhenDisabled
            aria-busy={busy}
            onClick={handleLogout}
          >
            로그아웃
          </Button>
        }
      />
      <ConfirmDialog
        open={dialog === "withdraw"}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
        tone="danger"
        icon={<WarningIcon />}
        title="탈퇴할까요?"
        description={
          <>
            저장한 장소와 남긴 리뷰가 모두 지워지고 되돌릴 수 없어요.
            {/* 창 밖은 가려져 있어 창 안에서 알린다 */}
            <span role="status" className="sr-only">
              {busy ? "탈퇴하고 있어요" : ""}
            </span>
          </>
        }
        secondaryAction={
          <Button
            variant="outline"
            size="md"
            disabled={busy}
            focusableWhenDisabled
            onClick={() => setDialog(null)}
          >
            취소
          </Button>
        }
        action={
          <Button
            variant="danger"
            size="md"
            disabled={busy}
            focusableWhenDisabled
            aria-busy={busy}
            onClick={handleWithdraw}
          >
            탈퇴
          </Button>
        }
      />
    </Screen>
  );
}
