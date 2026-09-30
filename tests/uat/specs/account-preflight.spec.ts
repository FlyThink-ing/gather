import { test, expect } from '@playwright/test';
import { login, logout } from '../support/auth';
import { requireAccount } from '../support/skip';
import type { AccountKey } from '../support/env';

const accounts: Array<{ key: AccountKey; label: string }> = [
  { key: 'projectOwner', label: 'UAT_PROJECT_OWNER' },
  { key: 'testLead', label: 'UAT_TEST_LEAD' },
  { key: 'testEngineer', label: 'UAT_TEST_ENGINEER' },
  { key: 'automationTester', label: 'UAT_AUTOMATION_TESTER' },
];

for (const account of accounts) {
  test(`${account.label} 账号可登录 @smoke`, async ({ page }) => {
    await login(page, requireAccount(account.key));
    await expect(page.getByRole('heading', { name: '项目概览' })).toBeVisible();
    await logout(page);
  });
}
