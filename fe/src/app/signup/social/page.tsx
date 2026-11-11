"use client";
import { clearAnswers, readAnswers } from "@/domains/onboarding/model/storage";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AuthError,
  getSocialSignup,
  socialSignup,
} from "@/domains/auth/api/auth-client";
import {
  signupFailure,
  validationFieldError,
} from "@/domains/auth/api/signup-error";
import {
  EmailVerification,
  type VerifiedEmail,
} from "@/domains/auth/ui/email-verification";
import {
  requiredAgreed,
  SignupTerms,
  type Agreements,
} from "@/domains/auth/ui/signup-terms";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { Screen } from "@/shared/ui/layout/screen";
export default function SocialSignupPage() {
  const router = useRouter();
  const { replace } = router;
  const submitting = useRef(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agreements, setAgreements] = useState<Agreements>({
    ageOver14: false,
    terms: false,
    privacy: false,
    marketing: false,
  });
  const [context, setContext] = useState<Awaited<
    ReturnType<typeof getSocialSignup>
  > | null>(null);
  const [editing, setEditing] = useState(false);
  const [verified, setVerified] = useState<VerifiedEmail | null>(null);
  const [reset, setReset] = useState(0);
  const [emailError, setEmailError] = useState<string>();
  const [draftEmail, setDraftEmail] = useState<string>();
  const [lookup, setLookup] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const contactEmail = editing ? verified?.email : context?.email;
  useEffect(() => {
    let active = true;
    getSocialSignup()
      .then((value) => {
        if (active) {
          setContext(value);
          setEditing(!value.email);
          setLookup("ready");
        }
      })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof AuthError && cause.status === 401)
          replace("/signup?error=social");
        else setLookup("error");
      });
    return () => {
      active = false;
    };
  }, [replace, lookupAttempt]);
  async function start() {
    if (
      submitting.current ||
      !requiredAgreed(agreements) ||
      !contactEmail ||
      !context
    )
      return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const preferences = readAnswers();
      await socialSignup({
        agreements,
        contactEmail: contactEmail!,
        ...(editing && verified ? { verificationToken: verified.token } : {}),
        ...(preferences ? { preferences } : {}),
      });
      clearAnswers();
      router.replace("/location");
      // 표시 쿠키가 바뀌었으니 브라우저에 남은 홈(/) 화면을 버린다(next.config의 / rewrite)
      router.refresh();
    } catch (failure) {
      if (failure instanceof AuthError && failure.status === 401) {
        router.replace("/signup?error=social");
        return;
      }
      const parsed = signupFailure(failure);
      const fieldError = validationFieldError(failure, "contactEmail");
      setMessage(
        fieldError
          ? ""
          : parsed.message || parsed.fields.email || "가입하지 못했어요.",
      );
      setEmailError(fieldError);
      if (parsed.resetVerification || fieldError) {
        setDraftEmail(contactEmail);
        setEditing(true);
        setVerified(null);
        setReset((value) => value + 1);
      }
      setOpen(false);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen inset="page" bottom="md">
      <header className="-mx-3 flex min-h-14 items-center gap-2">
        <IconButton
          label="회원가입으로 돌아가기"
          role="link"
          nativeButton={false}
          render={<Link href="/signup" />}
        >
          <ChevronLeftIcon />
        </IconButton>
        <h1 className="text-title-md">핏다이닝 시작하기</h1>
      </header>
      <div aria-busy={busy} className="mt-6 flex flex-1 flex-col gap-4">
        {lookup === "error" ? (
          <>
            <p role="alert" className="text-caption-md text-danger">
              가입 정보를 불러오지 못했어요. 다시 시도해 주세요.
            </p>
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                setLookup("loading");
                setLookupAttempt((value) => value + 1);
              }}
            >
              다시 시도
            </Button>
          </>
        ) : !context ? (
          <p role="status">가입 정보를 불러오고 있어요</p>
        ) : (
          <>
            <h2 className="text-title-sm">연락받을 이메일</h2>
            <p className="text-body-sm text-ink-muted">
              서비스 안내를 받을 이메일을 확인해 주세요.
            </p>
            {editing ? (
              <>
                <EmailVerification
                  key={reset}
                  purpose="contact"
                  initialEmail={draftEmail ?? context.email ?? ""}
                  error={emailError}
                  busy={busy}
                  onVerified={(value) => {
                    setVerified(value);
                    setEmailError(undefined);
                  }}
                />
                {context.email && (
                  <Button
                    variant="outline"
                    size="md"
                    disabled={busy}
                    onClick={() => {
                      setEditing(false);
                      setVerified(null);
                      setMessage("");
                      setEmailError(undefined);
                      setDraftEmail(undefined);
                    }}
                  >
                    취소
                  </Button>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="text-body-md break-all">{context.email}</p>
                <Button
                  variant="outline"
                  size="md"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  변경
                </Button>
              </div>
            )}
          </>
        )}
        {message && (
          <p role="alert" className="text-caption-md text-danger">
            {message}
          </p>
        )}
        <Button
          onClick={() => setOpen(true)}
          className="mt-auto w-full"
          disabled={busy || !context || !contactEmail}
        >
          약관 동의하고 시작하기
        </Button>
      </div>
      <SignupTerms
        open={open}
        setOpen={setOpen}
        busy={busy}
        agreements={agreements}
        setAgreements={setAgreements}
        start={start}
      />
    </Screen>
  );
}
