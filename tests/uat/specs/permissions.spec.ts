import { test, expect, type Page } from '@playwright/test';
import { login } from '../support/auth';
import { requireAccount } from '../support/skip';
import type { AccountKey } from '../support/env';

const commonMenu = ['工作台', '项目管理', '开发人员', '任务管理', '测试中心'];

async function expectMenu(page: Page, visible: string[], hidden: string[]) {
  for (const name of visible) await expect(page.getByRole('link', { name })).toBeVisible();
  for (const name of hidden) await expect(page.getByRole('link', { name })).toHaveCount(0);
}

for (const matrix of [
  { key: 'admin' as AccountKey, visible: [...commonMenu, '小组管理', '数据分析', '权限管理'], hidden: [] },
  { key: 'manager' as AccountKey, visible: [...commonMenu, '数据分析'], hidden: ['小组管理', '权限管理'] },
  { key: 'user' as AccountKey, visible: commonMenu, hidden: ['小组管理', '数据分析', '权限管理'] },
]) {
  test(`${matrix.key} 菜单与路由权限 @smoke`, async ({ page }) => {
    await login(page, requireAccount(matrix.key));
    await expectMenu(page, matrix.visible, matrix.hidden);

    if (matrix.key !== 'admin') {
      await page.goto('/#/teams');
      await expect(page).toHaveURL(/#\/dashboard$/);
      await page.goto('/#/user-roles');
      await expect(page).toHaveURL(/#\/dashboard$/);
    }
    if (matrix.key === 'user') {
      await page.goto('/#/analytics');
      await expect(page).toHaveURL(/#\/dashboard$/);
    }
  });
}

test('任务默认数据范围符合角色 @full', async ({ page }) => {
  await login(page, requireAccount('user'));
  await page.goto('/#/tasks');
  await expect(page.getByRole('button', { name: '我的任务' })).toBeVisible();
});
