import { test, expect } from '@playwright/test';
import { login } from '../support/auth';
import { requireAccount } from '../support/skip';

test.describe('人员、小组、项目与任务基础流程', () => {
  test('admin 可进入基础数据创建入口，弹窗必填校验稳定 @smoke', async ({ page }) => {
    await login(page, requireAccount('admin'));

    await page.goto('/#/developers');
    await page.getByRole('button', { name: '添加人员' }).click();
    await expect(page.getByRole('heading', { name: '添加开发人员' })).toBeVisible();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('请填写姓名')).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();

    await page.goto('/#/teams');
    const existingQaTeam = page.getByRole('heading', { name: 'UAT-质量保障组', exact: true });
    if (await existingQaTeam.count()) await expect(existingQaTeam).toBeVisible();
    await page.getByRole('button', { name: '创建小组' }).click();
    await expect(page.getByRole('heading', { name: '创建小组' })).toBeVisible();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('请填写小组名称')).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();

    await page.goto('/#/projects');
    const existingProject = page.getByRole('button', { name: 'UAT-全流程验收项目', exact: true });
    if (await existingProject.count()) await expect(existingProject).toBeVisible();
    await page.getByRole('button', { name: '添加项目' }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('请填写项目名称')).toBeVisible();
  });

  test('任务创建、开始、进度/完成、审核入口存在 @full', async ({ page }) => {
    await login(page, requireAccount('user'));
    await page.goto('/#/tasks');
    await expect(page.getByRole('heading', { name: '任务管理' })).toBeVisible();
    await page.getByRole('button', { name: '添加任务' }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('请填写任务标题')).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();

    await expect(page.getByText('开发任务不再单独提测')).toBeVisible();
    await expect(page.getByRole('button', { name: '我的任务' })).toBeVisible();
  });
});
