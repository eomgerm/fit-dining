"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, logout, subscribe } from "@/domains/auth/api/auth-client";
import {
  getUserProfile,
  updateContactEmail,
  updateMarketingConsent,
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
import {
  EmailVerification,
  type VerifiedEmail,
} from "@/domains/auth/ui/email-verification";
import { BottomSheet } from "@/shared/ui/overlay/bottom-sheet";
import { Checkbox } from "@/shared/ui/form/checkbox";
import {
  validationFieldError,
  VERIFICATION_REQUIRED_TYPE,
} from "@/domains/auth/api/signup-error";
import { signupMessages } from "@/domains/auth/model/signup";
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
  const [contactOpen, setContactOpen] = useState(false);
  const [verified, setVerified] = useState<VerifiedEmail | null>(null);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [contactError, setContactError] = useState("");
  const [contactReset, setContactReset] = useState(0);
  const [contactFieldError, setContactFieldError] = useState<string>();
  const [contactDraft, setContactDraft] = useState<string>();
  async function saveContact() {
    if (!verified || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setContactError("");
    setContactFieldError(undefined);
    try {
      await updateContactEmail(verified.email, verified.token);
      setProfile(
        (previous) => previous && { ...previous, contactEmail: verified.email },
      );
      setContactOpen(false);
      setVerified(null);
      toast("연락받을 이메일을 저장했어요");
    } catch (cause) {
      const fieldError = validationFieldError(cause, "email");
      if (
        isApiError(cause) &&
        cause.status === 400 &&
        cause.problem?.type === VERIFICATION_REQUIRED_TYPE
      ) {
        setContactError(signupMessages.verificationInvalid);
        setContactDraft(verified.email);
        setVerified(null);
        setContactReset((value) => value + 1);
      } else if (fieldError) {
        setContactFieldError(fieldError);
        setContactDraft(verified.email);
        setVerified(null);
        setContactReset((value) => value + 1);
      } else {
        setContactError(
          "연락받을 이메일을 저장하지 못했어요. 다시 시도해 주세요.",
        );
      }
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  async function changeMarketing(agreed: boolean) {
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    try {
      await updateMarketingConsent(agreed);
      setProfile(
        (previous) => previous && { ...previous, marketingAgreed: agreed },
      );
      toast(
        agreed
          ? "마케팅 정보 수신에 동의했어요"
          : "마케팅 정보 수신 동의를 철회했어요",
      );
    } catch {
      toast("수신 동의를 변경하지 못했어요. 다시 시도해 주세요.");
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
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
          <section
            aria-label="연락처 및 수신 동의"
            className="flex flex-col gap-3 border-t-8 border-line px-5 py-4"
          >
            <h2 className="text-title-sm">연락받을 이메일</h2>
            <p className="text-body-md break-all">
              {profile.contactEmail || "연락받을 이메일을 등록해 주세요"}
            </p>
            <Button
              variant="outline"
              size="md"
              disabled={saving || busy}
              onClick={() => {
                setVerified(null);
                setContactError("");
                setContactFieldError(undefined);
                setContactDraft(undefined);
                setContactReset((value) => value + 1);
                setContactOpen(true);
              }}
            >
              {profile.contactEmail ? "이메일 변경" : "이메일 등록"}
            </Button>
            <Checkbox
              checked={profile.marketingAgreed ?? false}
              disabled={saving || busy}
              onCheckedChange={changeMarketing}
            >
              마케팅 정보 수신 동의 (선택)
            </Checkbox>
            <p className="text-caption-md text-ink-muted">
              이벤트·혜택 안내를 이메일로 받아요. 동의하지 않아도 서비스를
              이용할 수 있어요.
            </p>
          </section>
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
      <BottomSheet
        title="연락받을 이메일 등록·변경"
        open={contactOpen}
        onOpenChange={(value) => {
          if (!saving) setContactOpen(value);
        }}
      >
        {contactOpen && (
          <EmailVerification
            key={contactReset}
            purpose="contact"
            initialEmail={contactDraft ?? profile?.contactEmail ?? ""}
            error={contactFieldError}
            busy={saving}
            onVerified={(value) => {
              setVerified(value);
              setContactFieldError(undefined);
              if (value) setContactError("");
            }}
          />
        )}
        {contactError && (
          <p role="alert" className="mt-2 text-caption-md text-danger">
            {contactError}
          </p>
        )}
        <Button
          className="mt-5 w-full"
          disabled={!verified || saving}
          onClick={saveContact}
        >
          {saving ? "저장 중" : "이메일 저장"}
        </Button>
      </BottomSheet>
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
