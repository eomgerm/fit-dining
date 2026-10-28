"use client";
import { clearAnswers, readAnswers } from "@/domains/onboarding/model/storage";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthError, socialSignup } from "@/domains/auth/api/auth-client";
import { signupFailure } from "@/domains/auth/api/signup-error";
import { validateNickname, signupMessages } from "@/domains/auth/model/signup";
import { SignupTerms } from "@/domains/auth/ui/signup-terms";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { TextField } from "@/shared/ui/form/text-field";
export default function SocialSignupPage() {
  const router = useRouter();
  const submitting = useRef(false);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agreements, setAgreements] = useState({
    ageOver14: false,
    terms: false,
    privacy: false,
  });
  function next(event: FormEvent) {
    event.preventDefault();
    const invalid = validateNickname(nickname);
    setError(invalid);
    if (!invalid) setOpen(true);
  }
  async function start() {
    if (
      submitting.current ||
      validateNickname(nickname) ||
      !Object.values(agreements).every(Boolean)
    )
      return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const preferences = readAnswers();
      await socialSignup({
        nickname,
        agreements,
        ...(preferences ? { preferences } : {}),
      });
      clearAnswers();
      router.replace("/location");
    } catch (failure) {
      if (failure instanceof AuthError && failure.status === 401) {
        router.replace("/signup?error=social");
        return;
      }
      const parsed = signupFailure(failure);
      setError(parsed.fields.nickname);
      setMessage(parsed.message);
      setOpen(false);
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
        <h1 className="text-title-md">닉네임 정하기</h1>
      </header>
      <form
        onSubmit={next}
        noValidate
        aria-busy={busy}
        className="mt-6 flex flex-1 flex-col gap-4"
      >
        <TextField
          id="social-nickname"
          name="nickname"
          label="닉네임"
          placeholder="닉네임"
          autoComplete="nickname"
          required
          disabled={busy}
          value={nickname}
          description={signupMessages.nickname}
          error={error}
          onBlur={() => setError(validateNickname(nickname))}
          onChange={(event) => {
            setNickname(event.target.value);
            setError(undefined);
            setMessage("");
          }}
        />
        {message && (
          <p role="alert" className="text-caption-md text-danger">
            {message}
          </p>
        )}
        <Button
          type="submit"
          className="mt-auto w-full"
          disabled={!!validateNickname(nickname) || busy}
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
