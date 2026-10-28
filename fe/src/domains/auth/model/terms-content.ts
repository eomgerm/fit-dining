export const termsContent = {
  terms: {
    title: "서비스 이용약관",
    body: "약관 본문은 준비 중이에요.",
    effectiveDate: "2026-10-23",
  },
  privacy: {
    title: "개인정보처리방침",
    body: "약관 본문은 준비 중이에요.",
    effectiveDate: "2026-10-23",
  },
} as const;

export type TermsKind = keyof typeof termsContent;
