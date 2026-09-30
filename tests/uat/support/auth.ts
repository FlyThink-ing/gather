import { expect, type Page } from '@playwright/test';
import type { UatAccount } from './env';

export async function login(page: Page, credentials: UatAccount) {
  await page.goto('/#/login');
  const emailInput = page.locator('input[type="email"]');
  const passwordInput = page.locator('input[type="password"]');
  await emailInput.fill(credentials.email);
  await passwordInput.fill(credentials.password);
  try {
    await page.getByRole('button', { name: '登录', exact: true }).click();
  } finally {
    // Playwright 的失败上下文会记录表单当前值；提交后立即清空，避免附件泄露凭据。
    await Promise.allSettled([emailInput.fill(''), passwordInput.fill('')]);
  }
  await expect(page).toHaveURL(/#\/dashboard$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: '项目概览' })).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/#\/login$/);
}
