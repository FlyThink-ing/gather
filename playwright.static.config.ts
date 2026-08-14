import { defineConfig } from '@playwright/test';

// 静态合同检查不得加载 .env.uat，也不会访问浏览器或网络。
export default defineConfig({
  testDir: './tests/uat/specs',
  testMatch: /hardening-contract\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: [['line']],
});
