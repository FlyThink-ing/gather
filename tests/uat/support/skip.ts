import { test } from '@playwright/test';
import { account, type AccountKey, type UatAccount } from './env';

export function requireAccount(key: AccountKey): UatAccount {
  const credentials = account(key);
  test.skip(!credentials, `未配置 ${key} 测试账号；请仅在本地 .env.uat 中填写。`);
  return credentials!;
}
