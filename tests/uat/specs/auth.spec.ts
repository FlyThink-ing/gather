import { test, expect } from '@playwright/test';
import { login, logout } from '../support/auth';
import { requireAccount } from '../support/skip';

test('有效账号登录和退出 @smoke', async ({ page }) => {
  const credentials = requireAccount('user');
  await login(page, credentials);
  await logout(page);
  await page.goto('/#/tasks');
  await expect(page).toHaveURL(/#\/login$/);
});
