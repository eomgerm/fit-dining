import { ApiError } from "@/shared/api/api-error";
import { signupMessages, type SignupErrors } from "../model/signup";

const AUTH_TYPE = "urn:fitdining:auth:";
export const VERIFICATION_REQUIRED_TYPE = `${AUTH_TYPE}verification-required`;

export function signupFailure(error: unknown): {
  fields: SignupErrors;
  message: string;
  // 인증 토큰이 만료·무효라 이메일 인증 단계로 되돌려야 한다
  resetVerification: boolean;
} {
  const fields: SignupErrors = {};
  let resetVerification = false;
  if (error instanceof ApiError) {
    if (
      error.status === 409 &&
      error.problem?.type === "urn:fitdining:auth:email-taken"
    )
      fields.email = "사용 중인 이메일입니다.";
    if (
      error.status === 409 &&
      error.problem?.type === "urn:fitdining:auth:nickname-taken"
    )
      fields.nickname = "이미 쓰는 닉네임이에요.";
    if (
      error.status === 400 &&
      error.problem?.type === VERIFICATION_REQUIRED_TYPE
    ) {
      fields.email = signupMessages.verificationInvalid;
      resetVerification = true;
    }
    if (error.status === 400 && Array.isArray(error.problem?.errors)) {
      for (const item of error.problem.errors) {
        if (
          item &&
          typeof item === "object" &&
          "field" in item &&
          "reason" in item &&
          typeof item.reason === "string" &&
          (item.field === "email" ||
            item.field === "password" ||
            item.field === "nickname")
        )
          fields[item.field as "email" | "password" | "nickname"] = item.reason;
      }
    }
  }
  return {
    fields,
    resetVerification,
    message: Object.keys(fields).length
      ? ""
      : error instanceof ApiError && error.status === 429
        ? "잠시 후 다시 시도해주세요."
        : error instanceof Error
          ? error.message
          : "가입하지 못했어요. 다시 시도해 주세요.",
  };
}

// 인증번호 요청·확인 실패를 칸 아래 문구로 바꾼다. 서버 detail은 일반 문구라 쓰지 않는다
export function verificationFailure(error: unknown): string {
  if (!(error instanceof ApiError))
    return "인증하지 못했어요. 다시 시도해 주세요.";
  if (error.kind !== "http") return error.message;
  const type = error.problem?.type;
  if (type === `${AUTH_TYPE}email-taken`) return signupMessages.emailRegistered;
  if (type === `${AUTH_TYPE}verification-code-mismatch`)
    return signupMessages.verificationMismatch;
  if (type === `${AUTH_TYPE}verification-expired`)
    return signupMessages.verificationExpired;
  if (type === `${AUTH_TYPE}verification-attempts-exceeded`)
    return signupMessages.verificationAttempts;
  if (type === `${AUTH_TYPE}mail-unavailable`)
    return signupMessages.mailUnavailable;
  if (error.status === 429) return signupMessages.retryLater;
  if (error.status === 400 && Array.isArray(error.problem?.errors)) {
    const reason = error.problem.errors.find(
      (item): item is { reason: string } =>
        !!item &&
        typeof item === "object" &&
        "reason" in item &&
        typeof item.reason === "string",
    )?.reason;
    if (reason) return reason;
  }
  return "인증하지 못했어요. 다시 시도해 주세요.";
}
