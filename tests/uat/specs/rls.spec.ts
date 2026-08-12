import { test, expect } from '@playwright/test';
import { login } from '../support/auth';
import { requireAccount } from '../support/skip';
import { BrowserRestClient } from '../support/rest';
import { uatEnv } from '../support/env';

test.describe('Supabase / RLS 关键越权', () => {
  test('user 不能创建小组，且无效数据不会落库 @full', async ({ page }) => {
    const rest = new BrowserRestClient();
    rest.attach(page);
    await login(page, requireAccount('user'));
    await page.goto('/#/tasks');
    await rest.waitUntilReady(page);

    const result = await rest.request(page, 'teams', {
      method: 'POST',
      body: { name: null },
      prefer: 'return=representation',
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.errorCode).toBe('42501');
  });

  test('user 对他人 UAT 任务的更新被 RLS 静默过滤 @full', async ({ browser }, testInfo) => {
    const adminCredentials = requireAccount('admin');
    const userCredentials = requireAccount('user');
    expect(adminCredentials.email, 'RLS 越权测试要求 admin 与 user 使用不同账号。').not.toBe(userCredentials.email);

    const baseURL = String(testInfo.project.use.baseURL);
    const adminContext = await browser.newContext({ baseURL, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    const userContext = await browser.newContext({ baseURL, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    try {
      const adminPage = await adminContext.newPage();
      const adminRest = new BrowserRestClient();
      adminRest.attach(adminPage);
      await login(adminPage, adminCredentials);
      await adminPage.goto('/#/tasks');
      await adminRest.waitUntilReady(adminPage);
      const adminId = await adminRest.request<string>(adminPage, 'rpc/current_developer_id', { method: 'POST', body: {} });
      expect(adminId.status).toBe(200);
      expect(adminId.data).toBeTruthy();

      const runId = uatEnv.runId;
      const today = new Date().toISOString().slice(0, 10);
      const created = await adminRest.request<Array<{ id: string; status: string }>>(adminPage, 'tasks', {
        method: 'POST',
        body: {
          title: `UAT-RLS-他人任务-${runId}`,
          description: 'Playwright UAT 自动生成；仅验证 RLS，保留审计。',
          developer_id: adminId.data,
          created_by: adminId.data,
          start_date: today,
          due_date: today,
        },
        prefer: 'return=representation',
      });
      expect(created.status).toBe(201);
      const target = created.data?.[0];
      expect(target).toMatchObject({ status: 'todo' });

      const userPage = await userContext.newPage();
      const userRest = new BrowserRestClient();
      userRest.attach(userPage);
      await login(userPage, userCredentials);
      await userPage.goto('/#/tasks');
      await userRest.waitUntilReady(userPage);
      const result = await userRest.request<unknown[]>(userPage, `tasks?id=eq.${target!.id}`, {
        method: 'PATCH',
        body: { status: '__invalid_uat_status__' },
        prefer: 'return=representation',
      });
      // RLS 正常时目标行不可更新，返回空数组；若越权则约束报错，但也不会写入数据。
      expect(result.status).toBe(200);
      expect(result.data).toEqual([]);

      const unchanged = await adminRest.request<Array<{ status: string }>>(
        adminPage,
        `tasks?select=status&id=eq.${target!.id}`,
      );
      expect(unchanged.data?.[0]?.status).toBe('todo');
    } finally {
      await Promise.all([adminContext.close(), userContext.close()]);
    }
  });
});
