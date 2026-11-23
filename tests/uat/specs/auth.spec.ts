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

test('重新打开时自动续期并进入首页 @smoke', async ({ page }) => {
  const credentials = requireAccount('user');
  await login(page, credentials);

  await page.addInitScript(() => {
    const key = Object.keys(localStorage).find((name) => /^sb-.*-auth-token$/.test(name));
    if (!key) throw new Error('找不到已保存的 Supabase 会话');
    const session = JSON.parse(localStorage.getItem(key)!);
    session.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem(key, JSON.stringify(session));
  });

  const isRefresh = (url: URL) =>
    url.pathname.endsWith('/auth/v1/token') && url.searchParams.get('grant_type') === 'refresh_token';
  // 等页面挂载认证监听后再返回续期结果，覆盖初始化与认证事件重叠的情况。
  let resumeRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => { resumeRefresh = resolve; });
  await page.route(isRefresh, async (route) => {
    await refreshGate;
    await route.continue();
  });
  try {
    await Promise.all([
      page.waitForRequest((request) => request.method() === 'POST' && isRefresh(new URL(request.url()))),
      page.reload(),
    ]);
    await expect(page.getByText('加载中…', { exact: true })).toBeVisible();
  } finally {
    resumeRefresh();
  }

  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.getByRole('heading', { name: '项目概览' })).toBeVisible();
});
