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
import { TextButton } from "@/shared/ui/button/text-button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { TextField } from "@/shared/ui/form/text-field";
import { Checkbox } from "@/shared/ui/form/checkbox";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { BottomSheet } from "@/shared/ui/overlay/bottom-sheet";
import { useToast } from "@/shared/ui/overlay/toast";

const agreementLabels = {
  ageOver14: "만 14세 이상이에요",
  terms: "서비스 이용약관",
  privacy: "개인정보 수집·이용",
};
export default function SignupEmailPage() {
  const router = useRouter();
  const toast = useToast();
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
  const [emailTaken, setEmailTaken] = useState(false);
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
    if (Object.keys(invalid).length === 0) setOpen(true);
  }
  async function start() {
    if (submitting.current || !allAgreed || !valid) return;
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
      router.replace("/");
    } catch (error) {
      const failure = signupFailure(error);
      setErrors(failure.fields);
      setEmailTaken(failure.emailTaken);
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
    <main className="mx-auto flex min-h-svh w-full max-w-110 flex-col bg-surface px-5 pb-6 text-ink sm:px-8">
      <header className="-mx-3 flex min-h-14 items-center gap-2">
        <IconButton
          label="회원가입으로 돌아가기"
          render={<Link href="/signup" />}
        >
          <ChevronLeftIcon />
        </IconButton>
        <h1 className="text-title-md">이메일로 가입</h1>
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
                error={errors[field]}
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
                  if (field === "email") setEmailTaken(false);
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
        {emailTaken && (
          <TextButton render={<Link href="/login" />}>로그인하기</TextButton>
        )}
        <Button
          className="mt-auto w-full"
          type="submit"
          disabled={!valid || busy}
        >
          다음
        </Button>
      </form>
      <BottomSheet
        title="약관에 동의하고 시작해요"
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <p className="mb-4 text-body-sm text-ink-muted">
          핏다이닝을 쓰려면 아래 약관에 동의해 주세요.
        </p>
        <Checkbox
          checked={allAgreed}
          indeterminate={!allAgreed && Object.values(agreements).some(Boolean)}
          disabled={busy}
          onCheckedChange={(checked) =>
            setAgreements({
              ageOver14: checked,
              terms: checked,
              privacy: checked,
            })
          }
        >
          전체 동의
        </Checkbox>
        <div className="my-3 border-t border-line" />
        {(Object.keys(agreementLabels) as (keyof typeof agreements)[]).map(
          (field) => (
            <div
              key={field}
              className="flex items-center justify-between gap-2"
            >
              <Checkbox
                checked={agreements[field]}
                disabled={busy}
                onCheckedChange={(checked) =>
                  setAgreements((previous) => ({
                    ...previous,
                    [field]: checked,
                  }))
                }
              >
                <span className="text-body-sm">
                  <span className="mr-2 text-primary-strong">필수</span>
                  {agreementLabels[field]}
                </span>
              </Checkbox>
              {field !== "ageOver14" && (
                <TextButton
                  disabled={busy}
                  onClick={() => toast("약관 본문은 준비 중이에요.")}
                >
                  보기
                </TextButton>
              )}
            </div>
          ),
        )}
        <Button
          className="mt-5 w-full"
          disabled={!allAgreed || busy}
          onClick={start}
        >
          {busy ? "가입 중" : "동의하고 시작하기"}
        </Button>
      </BottomSheet>
    </main>
  );
}
