import { test, expect } from '@playwright/test';
import { login } from '../support/auth';
import { requireAccount } from '../support/skip';

test('日期控件、弹窗、中文类型与工时口径关键 UI @full', async ({ page }) => {
  await login(page, requireAccount('admin'));
  await page.goto('/#/projects');
  await page.getByRole('button', { name: '添加项目' }).click();

  const dialogHeading = page.getByRole('heading', { name: '添加项目' });
  await expect(dialogHeading).toBeVisible();
  const modal = dialogHeading.locator('xpath=../..');
  await expect(modal).toHaveClass(/rounded-2xl/);
  await expect(modal).toHaveClass(/shadow-2xl/);

  const dateButtons = modal.getByRole('button', { name: '选择日期' });
  expect(await dateButtons.count()).toBeGreaterThanOrEqual(2);
  const dateStyle = await dateButtons.first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { radius: style.borderRadius, height: element.getBoundingClientRect().height };
  });
  expect(dateStyle.radius).not.toBe('0px');
  expect(dateStyle.height).toBeGreaterThanOrEqual(32);
  await page.getByRole('button', { name: '取消' }).click();

  await page.goto('/#/testing');
  await expect(page.getByRole('heading', { name: '测试中心' })).toBeVisible();
  await page.getByRole('button', { name: '资源汇总' }).click();
  await expect(page.getByText('内部项目测试实际工时')).toBeVisible();
  await expect(page.getByText('外部独立测试实际工时')).toBeVisible();
  await expect(page.getByText('测试建设实际工时')).toBeVisible();
});
