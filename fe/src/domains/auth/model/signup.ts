export const SIGNUP_LIMITS = {
  email: 254,
  password: 72,
  nickname: 15,
} as const;

export const signupMessages = {
  email: "이메일 형식을 확인해 주세요.",
  password: "영문과 숫자를 섞어 8자 이상",
  confirmation: "비밀번호가 일치하지 않아요.",
  nickname: "리뷰에 보이는 이름이에요. 2~15자",
  // 이메일 인증(레퍼런스에 화면이 없어 SignupEmail 도움말·PasswordSent 문구 톤에 맞췄다)
  verificationCode: "인증번호 6자리를 입력해 주세요.",
  verificationMismatch: "인증번호가 맞지 않아요.",
  verificationExpired: "인증번호가 만료됐어요. 다시 받아 주세요.",
  verificationAttempts: "인증번호를 다시 받아 주세요.",
  verificationNeeded: "이메일 인증을 해 주세요.",
  verificationInvalid: "이메일 인증이 만료됐어요. 다시 인증해 주세요.",
  verified: "인증했어요.",
  emailRegistered: "이미 가입한 이메일이에요. 로그인해 주세요.",
  mailUnavailable: "메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.",
  retryLater: "잠시 후 다시 시도해 주세요.",
};

// 인증번호를 보낸 뒤 이메일 칸 아래 도움말
export function verificationSentMessage(email: string) {
  return `${email}로 인증번호를 보냈어요. 메일이 안 보이면 스팸함도 확인해 주세요.`;
}

// BE 정책 상수(EmailVerificationTransactions)와 같다. 남은 시간 표시에만 쓰고 만료 판정은 서버가 한다
export const VERIFICATION_POLICY = {
  codeLength: 6,
  codeTtlMs: 10 * 60 * 1000,
  resendWaitMs: 60 * 1000,
} as const;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function validateVerificationCode(code: string): string | undefined {
  if (!/^[0-9]{6}$/.test(code)) return signupMessages.verificationCode;
}

// 남은 시간을 m:ss로 보여 준다. 0 아래로는 내려가지 않는다
export function formatRemaining(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export type SignupFields = {
  email: string;
  password: string;
  confirmation: string;
  nickname: string;
};
export type SignupErrors = Partial<Record<keyof SignupFields, string>>;
export function validateSignup(fields: SignupFields): SignupErrors {
  const errors: SignupErrors = {};
  const email = normalizeEmail(fields.email);
  if (
    email.length > SIGNUP_LIMITS.email ||
    !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)
  )
    errors.email = signupMessages.email;
  if (
    Array.from(fields.password).length < 8 ||
    !/[a-zA-Z]/.test(fields.password) ||
    !/[0-9]/.test(fields.password) ||
    new TextEncoder().encode(fields.password).length > SIGNUP_LIMITS.password
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
  if (
    length < 2 ||
    length > SIGNUP_LIMITS.nickname ||
    /\p{Cc}/u.test(nickname.trim())
  )
    return signupMessages.nickname;
}
