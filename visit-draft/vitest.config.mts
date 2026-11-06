import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // 브라우저(Chromium)를 여는 테스트가 동시에 돌면 기본 5초를 넘길 수 있다
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
