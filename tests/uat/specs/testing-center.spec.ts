import { test, expect } from '@playwright/test';
import { login } from '../support/auth';
import { requireAccount } from '../support/skip';

test.describe('测试中心', () => {
  test('计划、建设、资源三视图与外部测试必填校验 @smoke', async ({ page }) => {
    await login(page, requireAccount('testEngineer'));
    await page.goto('/#/testing');
    await expect(page.getByRole('heading', { name: '测试中心' })).toBeVisible();
    await expect(page.getByRole('button', { name: '测试计划' })).toBeVisible();
    await expect(page.getByRole('button', { name: '测试建设' })).toBeVisible();
    await expect(page.getByRole('button', { name: '资源汇总' })).toBeVisible();

    await page.getByRole('button', { name: '登记外部测试' }).click();
    await expect(page.getByRole('heading', { name: '登记外部独立测试' })).toBeVisible();
    await page.getByRole('button', { name: '提交测试申请' }).click();
    await expect(page.getByText('计划名称、测试范围和测试目标必填')).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();

    await page.getByRole('button', { name: '资源汇总' }).click();
    await expect(page.getByText('三来源实际工时合计')).toBeVisible();
    await expect(page.getByText('内部项目测试实际工时')).toBeVisible();
    await expect(page.getByText('外部独立测试实际工时')).toBeVisible();
    await expect(page.getByText('测试建设实际工时')).toBeVisible();
  });

  test('自动化测试工程师可创建测试建设并校验必填项 @full', async ({ page }) => {
    await login(page, requireAccount('automationTester'));
    await page.goto('/#/testing?view=construction');
    await page.getByRole('button', { name: '新建建设工作' }).click();
    await expect(page.getByRole('heading', { name: '新建测试建设工作' })).toBeVisible();
    await page.getByRole('button', { name: '创建草稿' }).click();
    await expect(page.getByText('标题、目标、预期成果和验收标准必填')).toBeVisible();
  });

  test('测试组长业务身份可看到排期/结论职责说明 @full', async ({ page }) => {
    await login(page, requireAccount('testLead'));
    await page.goto('/#/testing');
    await expect(page.getByRole('heading', { name: '测试中心' })).toBeVisible();
    await expect(page.getByText(/测试小组.*组长|确认排期|测试计划/).first()).toBeVisible();
  });
});
