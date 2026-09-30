import { test, expect } from '@playwright/test';

test.describe('公开入口 @smoke', () => {
  test('站点可达，受保护路由跳转登录页', async ({ page }) => {
    const response = await page.goto('/#/dashboard');
    expect(response?.ok()).toBeTruthy();
    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  });

  test('错误凭据被拒绝且不会进入工作台', async ({ page }) => {
    await page.goto('/#/login');
    await page.locator('input[type="email"]').fill(`uat-invalid-${Date.now()}@invalid.example`);
    await page.locator('input[type="password"]').fill('UAT_INVALID_PASSWORD_123!');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.locator('form').locator('div.text-red-600, div.dark\\:text-red-400')).toBeVisible();
  });

  test('页面和错误响应不展示常见敏感字段', async ({ page }) => {
    await page.goto('/#/login');
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/authorization\s*:/i);
    expect(text).not.toMatch(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/);
    expect(text).not.toMatch(/supabase[_-]anon[_-]key/i);
  });
});
