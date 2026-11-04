"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthError, login, restore } from "@/domains/auth/api/auth-client";
import { SIGNUP_LIMITS } from "@/domains/auth/model/signup";
import Image from "next/image";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { TextButton } from "@/shared/ui/button/text-button";
import { TextField } from "@/shared/ui/form/text-field";
import { Screen } from "@/shared/ui/layout/screen";
import { Icon } from "@/shared/ui/icon/icon";
import { CloseIcon } from "@/shared/ui/icon/icons/close";
import { SocialButtons } from "@/domains/auth/ui/social-buttons";
import { SocialError } from "@/domains/auth/ui/social-error";

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    restore()
      .then(() => {
        if (!active) return;
        router.replace("/");
        router.refresh();
      })
      .catch((error: unknown) => {
        if (active && (!(error instanceof AuthError) || error.status !== 401))
          setMessage(
            error instanceof Error
              ? error.message
              : "인증 상태를 확인하지 못했습니다.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [router]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setMessage("");
    setInvalid(false);
    setNotice("");
    try {
      await login(String(data.get("email")), String(data.get("password")));
      form.reset();
      setPassword("");
      router.replace("/");
      // 표시 쿠키가 바뀌었으니 브라우저에 남은 홈(/) 화면을 버린다(next.config의 / rewrite)
      router.refresh();
    } catch (error) {
      const credentialsInvalid =
        error instanceof AuthError && error.status === 401;
      setInvalid(credentialsInvalid);
      setMessage(
        credentialsInvalid
          ? "이메일 또는 비밀번호가 맞지 않아요. 다시 확인해 주세요."
          : error instanceof AuthError && error.status === 429
            ? "잠시 후 다시 시도해주세요."
            : error instanceof Error
              ? error.message
              : "로그인하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen inset="page" bottom="md">
      <SocialError />
      <header className="-mx-3 flex min-h-14 items-center justify-end">
        <IconButton
          label="로그인 닫기"
          role="link"
          nativeButton={false}
          render={<Link href="/" />}
        >
          <CloseIcon />
        </IconButton>
      </header>
      <h1 className="sr-only">핏다이닝 로그인</h1>
      <div className="mt-12 mb-10 flex justify-center">
        <Image
          src="/brand/fitdining.svg"
          alt="핏다이닝"
          width={177}
          height={52}
          unoptimized
          priority
        />
      </div>
      <form className="flex flex-col gap-3" onSubmit={submit} aria-busy={busy}>
        <TextField
          label="이메일"
          id="email"
          name="email"
          placeholder="이메일"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={SIGNUP_LIMITS.email}
          required
          disabled={busy}
          value={email}
          invalid={invalid}
          aria-invalid={invalid}
          aria-describedby={invalid ? "login-error" : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
            setInvalid(false);
            setMessage("");
          }}
        />
        <TextField
          label="비밀번호"
          id="password"
          name="password"
          maxLength={SIGNUP_LIMITS.password}
          placeholder="비밀번호"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          disabled={busy}
          value={password}
          invalid={invalid}
          aria-invalid={invalid}
          aria-describedby={invalid ? "login-error" : undefined}
          onChange={(event) => {
            setPassword(event.target.value);
            setInvalid(false);
            setMessage("");
          }}
          suffix={
            <IconButton
              type="button"
              disabled={busy}
              label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((value) => !value)}
            >
              <Icon size="md">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
                {showPassword && <path d="m3 3 18 18" />}
              </Icon>
            </IconButton>
          }
        />
        {message && (
          <p
            id="login-error"
            className="text-caption-md text-danger"
            role="alert"
          >
            {message}
          </p>
        )}
        <Button
          className={message ? "mt-2 w-full" : "mt-3 w-full"}
          type="submit"
          disabled={busy || !email || !password}
        >
          {busy && (
            <span
              className="mr-2 size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {busy ? "로그인 확인 중" : "로그인"}
        </Button>
        <div className="-mt-1 flex justify-center">
          <TextButton
            variant="muted"
            type="button"
            onClick={() => setNotice("비밀번호 찾기는 준비 중이에요.")}
          >
            비밀번호 찾기
          </TextButton>
        </div>
        <div className="flex justify-center">
          <TextButton
            variant="muted"
            role="link"
            nativeButton={false}
            render={<Link href="/signup" />}
          >
            이메일로 가입하기
          </TextButton>
        </div>
        {notice && (
          <p
            className="rounded-md bg-surface-sunken px-3.5 py-3 text-caption-md text-ink-muted"
            role="status"
          >
            {notice}
          </p>
        )}
      </form>
      <section
        className="mt-auto flex flex-col gap-3 pt-16"
        aria-label="소셜 로그인"
      >
        <SocialButtons from="login" />
      </section>
    </Screen>
  );
}
