"use client";

import { clearAnswers, readAnswers } from "@/domains/onboarding/model/storage";
import { signupFailure } from "@/domains/auth/api/signup-error";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signup } from "@/domains/auth/api/auth-client";
import {
  signupMessages,
  validateSignup,
  type SignupFields,
  type SignupErrors,
} from "@/domains/auth/model/signup";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { TextField } from "@/shared/ui/form/text-field";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";

import { SignupTerms } from "@/domains/auth/ui/signup-terms";

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
  const allAgreed = Object.values(agreements).every(Boolean);
  const valid = Object.keys(validateSignup(fields)).length === 0;
  function next(event: FormEvent) {
    event.preventDefault();
    const invalid = validateSignup(fields);
    setErrors(invalid);
    if (Object.values(serverErrors).some(Boolean)) return;
    if (Object.keys(invalid).length === 0) setOpen(true);
  }
  async function start() {
    if (
      submitting.current ||
      !allAgreed ||
      !valid ||
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
        ...(preferences ? { preferences } : {}),
      });
      clearAnswers();
      setFields({ email: "", password: "", confirmation: "", nickname: "" });
      router.replace("/location");
    } catch (error) {
      const failure = signupFailure(error);
      setServerErrors(failure.fields);
      setMessage(failure.message);
      setOpen(false);
      const first = Object.keys(failure.fields)[0];
      if (first)
        requestAnimationFrame(() =>
          formRef.current
            ?.querySelector<HTMLInputElement>(`[name="${first}"]`)
            ?.focus(),
        );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-110 flex-col bg-surface px-5 pb-4 text-ink sm:px-8">
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
        aria-busy={busy}
      >
        {(["email", "password", "confirmation", "nickname"] as const).map(
          (field) => {
            const label = {
              email: "이메일",
              password: "비밀번호",
              confirmation: "비밀번호 확인",
              nickname: "닉네임",
            }[field];
            return (
              <TextField
                key={field}
                label={label}
                placeholder={label}
                name={field}
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
                    ...(field === "password"
                      ? { confirmation: undefined }
                      : {}),
                  }));
                  setMessage("");
                  setServerErrors((previous) => ({
                    ...previous,
                    [field]: undefined,
                  }));
                }}
              />
            );
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
    </main>
  );
}
