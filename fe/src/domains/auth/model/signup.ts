export const signupMessages = {
  email: "이메일 형식을 확인해 주세요.",
  password: "영문과 숫자를 섞어 8자 이상",
  confirmation: "비밀번호가 일치하지 않아요.",
  nickname: "리뷰에 보이는 이름이에요. 2~15자",
};
export type SignupFields = {
  email: string;
  password: string;
  confirmation: string;
  nickname: string;
};
export type SignupErrors = Partial<Record<keyof SignupFields, string>>;
export function validateSignup(fields: SignupFields): SignupErrors {
  const errors: SignupErrors = {};
  const email = fields.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))
    errors.email = signupMessages.email;
  if (
    Array.from(fields.password).length < 8 ||
    !/[a-zA-Z]/.test(fields.password) ||
    !/[0-9]/.test(fields.password) ||
    new TextEncoder().encode(fields.password).length > 72
  )
    errors.password = signupMessages.password;
  if (!fields.confirmation || fields.password !== fields.confirmation)
    errors.confirmation = signupMessages.confirmation;
  const length = Array.from(fields.nickname.trim()).length;
  if (length < 2 || length > 15 || /\p{Cc}/u.test(fields.nickname.trim()))
    errors.nickname = signupMessages.nickname;
  return errors;
}
