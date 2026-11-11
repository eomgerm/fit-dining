"use client";

import { clearAnswers, readAnswers } from "@/domains/onboarding/model/storage";
import { signupFailure } from "@/domains/auth/api/signup-error";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signup } from "@/domains/auth/api/auth-client";
import {
  SIGNUP_LIMITS,
  signupMessages,
  validateSignup,
  type SignupFields,
  type SignupErrors,
} from "@/domains/auth/model/signup";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { TextField } from "@/shared/ui/form/text-field";
import { Screen } from "@/shared/ui/layout/screen";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";

import {
  EmailVerification,
  type VerifiedEmail,
} from "@/domains/auth/ui/email-verification";
import {
  requiredAgreed,
  SignupTerms,
  type Agreements,
} from "@/domains/auth/ui/signup-terms";

// 이메일 인증 단계. 토큰은 메모리 state에만 두고 storage에 저장하지 않는다
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
  const [agreements, setAgreements] = useState<Agreements>({
    ageOver14: false,
    terms: false,
    privacy: false,
    marketing: false,
  });
  const [verification, setVerification] = useState<VerifiedEmail | null>(null);
  const [verificationReset, setVerificationReset] = useState(0);
  const [verificationPending, setVerificationPending] = useState(false);
  const allAgreed = requiredAgreed(agreements);
  const verified = !!verification;
  const valid = Object.keys(validateSignup(fields)).length === 0 && verified;
  function resetVerification() {
    setVerification(null);
    setVerificationReset((value) => value + 1);
  }
  function focus(name: string) {
    requestAnimationFrame(() =>
      formRef.current
        ?.querySelector<HTMLInputElement>(`[name="${name}"]`)
        ?.focus(),
    );
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
      !verification ||
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
      // 표시 쿠키가 바뀌었으니 브라우저에 남은 홈(/) 화면을 버린다(next.config의 / rewrite)
      router.refresh();
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
        aria-busy={busy || verificationPending}
      >
        <EmailVerification
          id="signup-email"
          onPendingChange={setVerificationPending}
          key={verificationReset}
          initialEmail={fields.email}
          error={serverErrors.email || errors.email}
          busy={busy}
          onVerified={(value) => {
            setVerification(value);
            setFields((previous) => ({
              ...previous,
              email: value?.email ?? "",
            }));
            setServerErrors((previous) => ({ ...previous, email: undefined }));
            setErrors((previous) => ({ ...previous, email: undefined }));
            if (value) focus("password");
          }}
        />
        {(["password", "confirmation", "nickname"] as const).map((field) => {
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
              type={field === "nickname" ? "text" : "password"}
              autoComplete={field === "nickname" ? "nickname" : "new-password"}
              autoCapitalize="none"
              spellCheck={false}
              value={fields[field]}
              disabled={busy}

              required
              error={serverErrors[field] || errors[field]}
              description={
                field === "password" || field === "nickname"
                  ? signupMessages[field]
                  : undefined
              }
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
                  ...(field === "password" ? { confirmation: undefined } : {}),
                }));
                setMessage("");
                setServerErrors((previous) => ({
                  ...previous,
                  [field]: undefined,
                }));
              }}
            />
          );
          return input;
        })}
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
