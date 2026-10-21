import { plugin as shadcn } from "@shadcn/lint";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 의존 방향: app → domains → shared. 도메인끼리는 import하지 않고 app에서 조합한다.
  // 같은 도메인 안은 상대 경로로 import한다. 패턴은 gitignore 문법이라 "@/app"이 하위 경로까지 막는다.
  // ponytail: @/ 별칭만 검사한다. 상대 경로로 다른 도메인을 부르면 못 잡으므로, 필요해지면 eslint-plugin-boundaries로 바꾼다
  {
    files: ["src/shared/**", "src/domains/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["@/app", "@/domains"] }],
    },
  },
  // model은 순수 타입과 규칙만 둔다
  {
    files: ["src/domains/*/model/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["react"],
          patterns: ["@/app", "@/domains", "@/shared/api", "@tanstack/*"],
        },
      ],
    },
  },
  // 디자인 시스템 린트. shared/ui에서 import한 컴포넌트를 디자인 시스템 컴포넌트로 본다.
  // 켤 규칙은 디자인 토큰과 공통 컴포넌트를 만들면서 정한다
  {
    plugins: { shadcn },
    settings: { shadcn: { ui: "@/shared/ui" } },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
