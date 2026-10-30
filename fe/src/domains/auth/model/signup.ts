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
  const nicknameError = validateNickname(fields.nickname);
  if (nicknameError) errors.nickname = nicknameError;
  return errors;
}

// 가입 API 계약. app 계층에서 온보딩 답변을 조합하고 도메인 간 의존은 두지 않는다.
export type SignupPreferences = {
  mood: "QUIET" | "LIVELY" | null;
  priorities: (
    | "SPACIOUS"
    | "SHORT_WAIT"
    | "GENEROUS_PORTION"
    | "PRETTY_SPACE"
    | "VIEW_OUTDOOR"
    | "COZY"
    | "VALUE"
  )[];
  purposes: ("CONVERSATION" | "SOLO" | "DATE" | "GATHERING" | "WORK_STUDY")[];
  tastes: {
    polarity: "LIKE" | "DISLIKE";
    label: string;
    code?: string | null;
  }[];
};

export function validateNickname(nickname: string): string | undefined {
  const length = Array.from(nickname.trim()).length;
  if (length < 2 || length > 15 || /\p{Cc}/u.test(nickname.trim()))
    return signupMessages.nickname;
}
