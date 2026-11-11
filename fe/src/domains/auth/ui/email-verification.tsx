"use client";
import { useEffect, useRef, useState } from "react";
import {
  confirmEmailVerification,
  requestEmailVerification,
} from "../api/auth-client";
import { verificationFailure } from "../api/signup-error";
import {
  formatRemaining,
  normalizeEmail,
  SIGNUP_LIMITS,
  signupMessages,
  validateSignup,
  validateVerificationCode,
  VERIFICATION_POLICY,
  verificationSentMessage,
} from "../model/signup";
import { TextField } from "@/shared/ui/form/text-field";
import { Button } from "@/shared/ui/button/button";
import { TextButton } from "@/shared/ui/button/text-button";
export type VerifiedEmail = { email: string; token: string };
export function EmailVerification({
  purpose = "signup",
  busy = false,
  initialEmail = "",
  error: externalError,
  id,
  onPendingChange,
  onVerified,
}: {
  purpose?: "signup" | "contact";
  busy?: boolean;
  initialEmail?: string;
  error?: string;
  id?: string;
  onPendingChange?: (pending: boolean) => void;
  onVerified: (value: VerifiedEmail | null) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState<{
    email: string;
    expiresAt: number;
    resendAt: number;
  } | null>(null);
  const [verified, setVerified] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [requestError, setRequestError] = useState<string>();
  const [codeError, setCodeError] = useState<string>();
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const input = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!sent) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sent]);
  const emailError = validateSignup({
    email,
    password: "",
    confirmation: "",
    nickname: "",
  }).email;
  const expired = !!sent && now >= sent.expiresAt;
  const wait = sent ? Math.max(0, sent.resendAt - now) : 0;
  async function send() {
    if (lock.current || busy || emailError || wait > 0) return;
    lock.current = true;
    setPending(true);
    onPendingChange?.(true);
    setError(undefined);
    setRequestError(undefined);
    setCodeError(undefined);
    const address = normalizeEmail(email);
    try {
      await requestEmailVerification(address, purpose);
      if (!active.current) return;
      const at = Date.now();
      setNow(at);
      setCode("");
      setSent({
        email: address,
        expiresAt: at + VERIFICATION_POLICY.codeTtlMs,
        resendAt: at + VERIFICATION_POLICY.resendWaitMs,
      });
      requestAnimationFrame(() => input.current?.focus());
    } catch (cause) {
      setRequestError(verificationFailure(cause));
    } finally {
      lock.current = false;
      setPending(false);
      if (active.current) onPendingChange?.(false);
    }
  }
  async function confirm() {
    if (lock.current || busy || !sent || expired) return;
    const invalid = validateVerificationCode(code);
    if (invalid) {
      setCodeError(invalid);
      return;
    }
    lock.current = true;
    setPending(true);
    onPendingChange?.(true);
    setCodeError(undefined);
    try {
      const result = await confirmEmailVerification(sent.email, code);
      if (!active.current) return;
      setVerified(true);
      setSent(null);
      setCode("");
      onVerified({ email: sent.email, token: result.verificationToken });
    } catch (cause) {
      setCodeError(verificationFailure(cause));
    } finally {
      lock.current = false;
      setPending(false);
      if (active.current) onPendingChange?.(false);
    }
  }
  function reset() {
    setVerified(false);
    setSent(null);
    setCode("");
    setError(undefined);
    setRequestError(undefined);
    setCodeError(undefined);
    onVerified(null);
  }
  return (
    <div className="flex flex-col gap-2" aria-busy={pending}>
      <TextField
        id={id}
        label="이메일"
        name="email"
        type="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={SIGNUP_LIMITS.email}
        value={email}
        readOnly={verified}
        disabled={busy || pending}
        error={externalError || requestError || error}
        description={
          verified
            ? signupMessages.verified
            : sent
              ? verificationSentMessage(sent.email)
              : undefined
        }
        onChange={(event) => {
          setEmail(event.target.value);
          reset();
        }}
        onBlur={() => setError(emailError)}
        suffix={
          verified ? (
            <TextButton
              type="button"
              variant="muted"
              disabled={busy}
              onClick={reset}
            >
              이메일 바꾸기
            </TextButton>
          ) : !sent ? (
            <TextButton
              type="button"
              disabled={!!emailError || busy || pending}
              onClick={send}
            >
              인증번호 받기
            </TextButton>
          ) : undefined
        }
      />
      {sent && (
        <>
          <TextField
            ref={input}
            label="인증번호"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            disabled={busy || pending}
            error={
              codeError ||
              (expired ? signupMessages.verificationExpired : undefined)
            }
            suffix={
              <span className="text-caption-md text-primary-strong tabular-nums">
                <span className="sr-only">남은 시간 </span>
                {formatRemaining(sent.expiresAt - now)}
              </span>
            }
            onChange={(event) => {
              setCode(event.target.value.replace(/[^0-9]/g, ""));
              setCodeError(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void confirm();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <TextButton
              type="button"
              variant="muted"
              disabled={wait > 0 || busy || pending}
              onClick={send}
            >
              {wait > 0
                ? `다시 받기 (${Math.ceil(wait / 1000)}초)`
                : "다시 받기"}
            </TextButton>
            <Button
              type="button"
              variant="outline"
              size="md"
              disabled={code.length !== 6 || expired || busy || pending}
              onClick={confirm}
            >
              확인
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
