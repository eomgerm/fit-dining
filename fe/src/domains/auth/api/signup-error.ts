import { ApiError } from "@/shared/api/api-error";
import type { SignupErrors } from "../model/signup";

export function signupFailure(error: unknown): {
  fields: SignupErrors;
  message: string;
  emailTaken: boolean;
} {
  const fields: SignupErrors = {};
  const emailTaken =
    error instanceof ApiError &&
    error.status === 409 &&
    error.problem?.type === "urn:fitdining:auth:email-taken";
  if (error instanceof ApiError) {
    if (
      error.status === 409 &&
      error.problem?.type === "urn:fitdining:auth:email-taken"
    )
      fields.email = "이미 가입한 이메일이에요. 로그인해 주세요.";
    if (
      error.status === 409 &&
      error.problem?.type === "urn:fitdining:auth:nickname-taken"
    )
      fields.nickname = "이미 쓰는 닉네임이에요.";
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
    emailTaken,
    message: Object.keys(fields).length
      ? ""
      : error instanceof ApiError && error.status === 429
        ? "잠시 후 다시 시도해주세요."
        : error instanceof Error
          ? error.message
          : "가입하지 못했어요. 다시 시도해 주세요.",
  };
}
