"use client";

import { clearAnswers, readAnswers } from "@/domains/onboarding/model/storage";
import {
  signupFailure,
  verificationFailure,
} from "@/domains/auth/api/signup-error";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  confirmEmailVerification,
  requestEmailVerification,
  signup,
} from "@/domains/auth/api/auth-client";
import {
  SIGNUP_LIMITS,
  VERIFICATION_POLICY,
  formatRemaining,
  normalizeEmail,
  signupMessages,
  validateSignup,
  validateVerificationCode,
  verificationSentMessage,
  type SignupFields,
  type SignupErrors,
} from "@/domains/auth/model/signup";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { TextButton } from "@/shared/ui/button/text-button";
import { TextField } from "@/shared/ui/form/text-field";
import { Screen } from "@/shared/ui/layout/screen";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";

import { SignupTerms } from "@/domains/auth/ui/signup-terms";

// 이메일 인증 단계. 토큰은 메모리 state에만 두고 storage에 저장하지 않는다
type Verification =
  | { phase: "idle" }
  | { phase: "sent"; email: string; expiresAt: number; resendAt: number }
  | { phase: "verified"; email: string; token: string };

export default function SignupEmailPage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const [fields, setFields] = useState<SignupFields>({
    email: "",
    password: "",
    confirmation: "",
    nickname: "",
  });
  const [errors, setErrors] = useState<SignupErrors>({});
  const [message, setMessage] = useState("");
  const [serverErrors, setServerErrors] = useState<SignupErrors>({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agreements, setAgreements] = useState({
    ageOver14: false,
    terms: false,
    privacy: false,
  });
  const [verification, setVerification] = useState<Verification>({
    phase: "idle",
  });
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string>();
  const [verifyError, setVerifyError] = useState<string>();
  const [pending, setPending] = useState<"send" | "confirm" | null>(null);
  const [now, setNow] = useState(0);
  const sent = verification.phase === "sent";
  useEffect(() => {
    if (!sent) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sent]);

  const allAgreed = Object.values(agreements).every(Boolean);
  const verified =
    verification.phase === "verified" &&
    verification.email === normalizeEmail(fields.email);
  const valid = Object.keys(validateSignup(fields)).length === 0 && verified;
  const emailInvalid = Boolean(validateSignup(fields).email);
  const expired =
    verification.phase === "sent" && now >= verification.expiresAt;
  const resendWait =
    verification.phase === "sent" ? verification.resendAt - now : 0;

  function focus(name: string) {
    requestAnimationFrame(() =>
      formRef.current
        ?.querySelector<HTMLInputElement>(`[name="${name}"]`)
        ?.focus(),
    );
  }
  function resetVerification() {
    setVerification({ phase: "idle" });
    setCode("");
    setCodeError(undefined);
    setVerifyError(undefined);
  }
  async function sendCode() {
    if (pending || busy) return;
    const emailError = validateSignup(fields).email;
    if (emailError) {
      setErrors((previous) => ({ ...previous, email: emailError }));
      return;
    }
    const email = normalizeEmail(fields.email);
    setPending("send");
    setVerifyError(undefined);
    setCodeError(undefined);
    setServerErrors((previous) => ({ ...previous, email: undefined }));
    try {
      await requestEmailVerification(email);
      const sentAt = Date.now();
      setNow(sentAt);
      setCode("");
      setVerification({
        phase: "sent",
        email,
        expiresAt: sentAt + VERIFICATION_POLICY.codeTtlMs,
        resendAt: sentAt + VERIFICATION_POLICY.resendWaitMs,
      });
      focus("code");
    } catch (error) {
      setVerifyError(verificationFailure(error));
    } finally {
      setPending(null);
    }
  }
  async function confirmCode() {
    if (pending || busy || verification.phase !== "sent") return;
    const invalid = validateVerificationCode(code);
    if (invalid) {
      setCodeError(invalid);
      return;
    }
    setPending("confirm");
    setCodeError(undefined);
    try {
      const result = await confirmEmailVerification(verification.email, code);
      setVerification({
        phase: "verified",
        email: verification.email,
        token: result.verificationToken,
      });
      setCode("");
      focus("password");
    } catch (error) {
      setCodeError(verificationFailure(error));
    } finally {
      setPending(null);
    }
  }
  function changeEmail() {
    resetVerification();
    focus("email");
  }
  function next(event: FormEvent) {
    event.preventDefault();
    const invalid = validateSignup(fields);
    if (!invalid.email && !verified)
      invalid.email = signupMessages.verificationNeeded;
    setErrors(invalid);
    if (Object.values(serverErrors).some(Boolean)) return;
    if (Object.keys(invalid).length === 0) setOpen(true);
  }
  async function start() {
    if (
      submitting.current ||
      !allAgreed ||
      !valid ||
      verification.phase !== "verified" ||
      Object.values(serverErrors).some(Boolean)
    )
      return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const preferences = readAnswers();
      await signup({
        email: fields.email,
        password: fields.password,
        nickname: fields.nickname,
        agreements,
        verificationToken: verification.token,
        ...(preferences ? { preferences } : {}),
      });
      clearAnswers();
      setFields({ email: "", password: "", confirmation: "", nickname: "" });
      router.replace("/location");
    } catch (error) {
      const failure = signupFailure(error);
      // 인증 토큰이 만료·무효거나 이미 가입한 이메일이면 이메일을 다시 인증해야 한다
      if (failure.resetVerification || failure.fields.email)
        resetVerification();
      setServerErrors(failure.fields);
      setMessage(failure.message);
      setOpen(false);
      const first = Object.keys(failure.fields)[0];
      if (first) focus(first);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  function emailDescription() {
    if (verified) return signupMessages.verified;
    if (verification.phase === "sent")
      return verificationSentMessage(verification.email);
  }
  function emailAction() {
    if (verification.phase === "verified")
      return (
        <TextButton
          type="button"
          variant="muted"
          onClick={changeEmail}
          disabled={busy}
        >
          이메일 바꾸기
        </TextButton>
      );
    if (verification.phase === "idle")
      return (
        <TextButton
          type="button"
          onClick={sendCode}
          disabled={emailInvalid || pending !== null || busy}
        >
          인증번호 받기
        </TextButton>
      );
  }
  return (
    <Screen inset="page" bottom="sm">
      <header className="relative -mx-3 flex min-h-14 items-center">
        <IconButton
          label="회원가입으로 돌아가기"
          role="link"
          nativeButton={false}
          render={<Link href="/signup" />}
        >
          <ChevronLeftIcon />
        </IconButton>
        <h1 className="pointer-events-none absolute inset-x-0 text-center text-title-sm">
          이메일로 가입
        </h1>
      </header>
      <form
        ref={formRef}
        onSubmit={next}
        noValidate
        className="mt-6 flex flex-1 flex-col gap-4"
        aria-busy={busy || pending !== null}
      >
        {(["email", "password", "confirmation", "nickname"] as const).map(
          (field) => {
            const label = {
              email: "이메일",
              password: "비밀번호",
              confirmation: "비밀번호 확인",
              nickname: "닉네임",
            }[field];
            const input = (
              <TextField
                key={field}
                label={label}
                placeholder={label}
                name={field}
                maxLength={
                  SIGNUP_LIMITS[field === "confirmation" ? "password" : field]
                }
                id={`signup-${field}`}
                type={
                  field === "email"
                    ? "email"
                    : field === "nickname"
                      ? "text"
                      : "password"
                }
                autoComplete={
                  field === "email"
                    ? "email"
                    : field === "nickname"
                      ? "nickname"
                      : "new-password"
                }
                autoCapitalize="none"
                spellCheck={false}
                value={fields[field]}
                disabled={busy}
                // 인증을 마친 이메일은 [이메일 바꾸기]로만 바꾼다
                readOnly={field === "email" && verified}
                required
                error={
                  serverErrors[field] ||
                  errors[field] ||
                  (field === "email" ? verifyError : undefined)
                }
                description={
                  field === "password" || field === "nickname"
                    ? signupMessages[field]
                    : field === "email"
                      ? emailDescription()
                      : undefined
                }
                suffix={field === "email" ? emailAction() : undefined}
                onBlur={() =>
                  setErrors((previous) => ({
                    ...previous,
                    [field]: validateSignup(fields)[field],
                  }))
                }
                onChange={(event) => {
                  setFields((previous) => ({
                    ...previous,
                    [field]: event.target.value,
                  }));
                  setErrors((previous) => ({
                    ...previous,
                    [field]: undefined,
                    ...(field === "password"
                      ? { confirmation: undefined }
                      : {}),
                  }));
                  setMessage("");
                  setServerErrors((previous) => ({
                    ...previous,
                    [field]: undefined,
                  }));
                  // 인증번호를 보낸 뒤 이메일을 고치면 처음부터 다시 받는다
                  if (field === "email" && verification.phase === "sent")
                    resetVerification();
                  if (field === "email") setVerifyError(undefined);
                }}
              />
            );
            if (field !== "email" || verification.phase !== "sent")
              return input;
            return [
              input,
              <div
                key="code"
                // 처음 그릴 때 투명도만 200ms로 바꾼다. 움직임 줄이기에서는 120ms다
                className="flex flex-col gap-1 transition-opacity duration-200 motion-reduce:duration-120 starting:opacity-0"
              >
                <TextField
                  label="인증번호"
                  placeholder="인증번호 6자리"
                  name="code"
                  id="signup-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={VERIFICATION_POLICY.codeLength}
                  value={code}
                  disabled={busy || pending === "confirm"}
                  error={
                    codeError ||
                    (expired ? signupMessages.verificationExpired : undefined)
                  }
                  suffix={
                    <span className="text-caption-md text-primary-strong tabular-nums">
                      <span className="sr-only">남은 시간 </span>
                      {formatRemaining(verification.expiresAt - now)}
                    </span>
                  }
                  onChange={(event) => {
                    setCode(event.target.value.replace(/[^0-9]/g, ""));
                    setCodeError(undefined);
                  }}
                  onKeyDown={(event) => {
                    // 인증번호 칸의 Enter는 [다음]이 아니라 [확인]이다
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void confirmCode();
                    }
                  }}
                />
                <div className="flex items-center justify-between">
                  <TextButton
                    type="button"
                    variant="muted"
                    onClick={sendCode}
                    disabled={resendWait > 0 || pending !== null || busy}
                  >
                    {resendWait > 0
                      ? `다시 받기 (${Math.ceil(resendWait / 1000)}초)`
                      : "다시 받기"}
                  </TextButton>
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={confirmCode}
                    disabled={
                      code.length !== VERIFICATION_POLICY.codeLength ||
                      expired ||
                      pending !== null ||
                      busy
                    }
                  >
                    확인
                  </Button>
                </div>
              </div>,
            ];
          },
        )}
        {message && (
          <p role="alert" className="text-caption-md text-danger">
            {message}
          </p>
        )}
        <Button
          className="mt-auto w-full"
          type="submit"
          disabled={!valid || busy || Object.values(serverErrors).some(Boolean)}
        >
          다음
        </Button>
      </form>
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
