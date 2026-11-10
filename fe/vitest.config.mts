import { defineConfig } from "vitest/config";

// 테스트에서도 @/ 경로를 쓰도록 tsconfig paths를 읽는다
export default defineConfig({
  test: { setupFiles: ["./src/test-setup.ts"] },
  resolve: { tsconfigPaths: true },
});
