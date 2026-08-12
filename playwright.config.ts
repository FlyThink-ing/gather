import { defineConfig, devices } from '@playwright/test';
import { loadUatEnv, uatEnv } from './tests/uat/support/env';

loadUatEnv();

if (!uatEnv.baseUrl) {
  throw new Error('缺少 UAT_BASE_URL：请复制 .env.uat.example 为 .env.uat 并填写站点地址。');
}

export default defineConfig({
  testDir: './tests/uat/specs',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 1,
  forbidOnly: !!process.env.CI,
  outputDir: 'artifacts/uat/test-results',
  reporter: [
    ['line'],
    ['html', { outputFolder: 'reports/uat/html', open: 'never' }],
  ],
  use: {
    baseURL: uatEnv.baseUrl,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'public-smoke',
      testMatch: /public\.spec\.ts/,
      use: { trace: 'retain-on-failure' },
    },
    {
      name: 'authenticated-uat',
      testIgnore: /public\.spec\.ts/,
      // 认证 trace 可能包含 Authorization/Cookie，请勿启用原始 trace。
      use: { trace: 'off' },
    },
  ],
});
