import { test, expect, type Locator, type Page } from '@playwright/test';
import { uatEnv } from '../support/env';
import {
  closeHardeningSessions,
  openHardeningSession,
  type HardeningSession,
} from '../support/hardening';

type DeveloperSnapshot = {
  id: string;
  name: string;
  position: string | null;
  is_active: boolean;
  user_id: string | null;
};

type NotificationRow = {
  id: string;
  recipient_id: string;
  type: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
};

const VIEWPORTS = [
  { width: 1440, height: 900, label: '1440x900' },
  { width: 1280, height: 720, label: '1280x720' },
  { width: 1024, height: 576, label: '1024x576（125% 等效）' },
] as const;

test.describe('统一反馈与通知浮层 @hardening @full', () => {
  test.setTimeout(300_000);

  test('UI-CONFIRM-01 危险删除使用应用内 dialog，取消后不落库且不触发原生对话框', async ({ browser }, testInfo) => {
    const sessions: HardeningSession[] = [];
    try {
      const admin = await openHardeningSession(browser, String(testInfo.project.use.baseURL), 'admin');
      sessions.push(admin);
      const nativeDialogs = guardNativeDialogs(admin.page);
      const targetName = `UAT-UI-DIALOG-${uatEnv.runId}-${testInfo.retry}`;
      const target = await ensureUatDeveloper(admin, targetName);
      const before = await developerSnapshot(admin, target.id);

      await admin.page.goto('/#/developers');
      const row = admin.page.getByRole('row').filter({ has: admin.page.getByText(targetName, { exact: true }) });
      await expect(row).toHaveCount(1);
      await row.getByRole('button', { name: '删除' }).click();
      nativeDialogs.expectNone();

      const dialog = admin.page.getByRole('dialog', { name: '删除开发人员' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(targetName);
      await expect(dialog.getByRole('button', { name: '确认删除', exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      nativeDialogs.expectNone();
      await expect(dialog).toBeHidden();
      expect(await developerSnapshot(admin, target.id)).toEqual(before);
    } finally {
      await closeHardeningSessions(sessions);
    }
  });

  test('UI-CONFIRM-02 + UI-FEEDBACK-01 自我降权确认和普通错误均不得触发原生对话框', async ({ browser }, testInfo) => {
    const sessions: HardeningSession[] = [];
    let roleFailureGate: ReturnType<typeof deferred> | null = null;
    try {
      const admin = await openHardeningSession(browser, String(testInfo.project.use.baseURL), 'admin');
      sessions.push(admin);
      const nativeDialogs = guardNativeDialogs(admin.page);
      const linked = await admin.rest.request<Array<{ user_id: string | null }>>(
        admin.page,
        `developers?select=user_id&id=eq.${admin.developerId}`,
      );
      expect(linked.status).toBe(200);
      const userId = linked.data?.[0]?.user_id;
      expect(userId, 'admin 测试人员必须关联登录账号').toBeTruthy();
      const beforeRole = await accountRole(admin, userId!);
      expect(beforeRole).toBe('admin');

      await admin.page.goto('/#/user-roles');
      const selfRow = admin.page.getByRole('row').filter({ hasText: '(我)' });
      await expect(selfRow).toHaveCount(1);
      await selfRow.getByRole('button', { name: '管理员', exact: true }).click();
      await admin.page.getByRole('button', { name: '普通用户', exact: true }).click();
      nativeDialogs.expectNone();

      const downgrade = admin.page.getByRole('dialog', { name: '确认降低自己的权限' });
      await expect(downgrade).toBeVisible();
      await expect(downgrade).toContainText('立即失去管理员功能');
      await expect(downgrade.getByRole('button', { name: '确认继续', exact: true })).toBeVisible();
      await downgrade.getByRole('button', { name: '取消', exact: true }).click();
      nativeDialogs.expectNone();
      await expect(downgrade).toBeHidden();
      expect(await accountRole(admin, userId!)).toBe(beforeRole);

      let roleUpdateCount = 0;
      roleFailureGate = deferred();
      await admin.page.route('**/rest/v1/user_roles*', async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        roleUpdateCount += 1;
        await roleFailureGate!.promise;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'UAT_FORCED_FAILURE', message: 'UAT 模拟角色更新失败' }),
        });
      });
      await selfRow.getByRole('button', { name: '管理员', exact: true }).click();
      await admin.page.getByRole('button', { name: '普通用户', exact: true }).click();
      const failedDowngrade = admin.page.getByRole('dialog', { name: '确认降低自己的权限' });
      const confirmRole = failedDowngrade.locator('button').filter({ hasText: /确认继续|处理中/ });
      await confirmRole.dblclick();
      await expect.poll(() => roleUpdateCount, 'busy 期间双击只能发送一次角色更新请求').toBe(1);
      await expect(confirmRole).toHaveText('处理中…');
      await expect(confirmRole).toBeDisabled();
      await admin.page.keyboard.press('Escape');
      await expect(failedDowngrade, 'busy 期间 Esc 不得关闭危险确认').toBeVisible();
      const overlay = failedDowngrade.locator('..');
      await overlay.click({ position: { x: 2, y: 2 } });
      await expect(failedDowngrade, 'busy 期间点击遮罩不得关闭危险确认').toBeVisible();

      roleFailureGate.resolve();
      const roleFailure = admin.page.getByRole('dialog', { name: '提示' });
      await expect(roleFailure).toContainText('UAT 模拟角色更新失败');
      await expect(failedDowngrade, '异步失败后确认框必须保留').toBeVisible();
      expect(await accountRole(admin, userId!)).toBe(beforeRole);
      expect(roleUpdateCount).toBe(1);
      await roleFailure.getByRole('button', { name: '知道了', exact: true }).click();
      await expect(failedDowngrade).toBeVisible();
      await failedDowngrade.getByRole('button', { name: '取消', exact: true }).click();
      nativeDialogs.expectNone();

      await admin.page.goto('/#/developers');
      await admin.page.getByRole('button', { name: '添加人员', exact: true }).click();
      const createDialog = admin.page.getByRole('dialog', { name: '添加开发人员' });
      await createDialog.getByRole('button', { name: '保存', exact: true }).click();
      nativeDialogs.expectNone();
      await expect(createDialog.getByText('请填写姓名', { exact: true })).toBeVisible();
      await createDialog.getByRole('button', { name: '取消', exact: true }).click();
      nativeDialogs.expectNone();
    } finally {
      roleFailureGate?.resolve();
      await closeHardeningSessions(sessions);
    }
  });

  test('UI-MODAL-FOCUS-01 多字段 Modal 连续状态更新不丢失第二字段焦点和值', async ({ browser }, testInfo) => {
    const sessions: HardeningSession[] = [];
    try {
      const admin = await openHardeningSession(browser, String(testInfo.project.use.baseURL), 'admin');
      sessions.push(admin);
      const nativeDialogs = guardNativeDialogs(admin.page);
      await admin.page.goto('/#/testing');
      await admin.page.getByRole('button', { name: '登记外部测试', exact: true }).click();
      const dialog = admin.page.getByRole('dialog', { name: '登记外部独立测试' });
      await expect(dialog).toBeVisible();
      const secondTextField = dialog.locator('input').nth(1);
      const value = `UAT-多字段焦点保持-${uatEnv.runId}`;
      await secondTextField.pressSequentially(value);
      await expect(secondTextField).toHaveValue(value);
      expect(await secondTextField.evaluate((element) => document.activeElement === element), '连续状态更新后焦点必须仍在第二字段').toBe(true);
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      nativeDialogs.expectNone();
    } finally {
      await closeHardeningSessions(sessions);
    }
  });

  test('UI-NOTIFY-01 + UI-NOTIFY-02 空态、长列表、边界、层级和滚动隔离', async ({ browser }, testInfo) => {
    const sessions: HardeningSession[] = [];
    let updateGate: ReturnType<typeof deferred> | null = null;
    try {
      const admin = await openHardeningSession(browser, String(testInfo.project.use.baseURL), 'admin');
      sessions.push(admin);
      const nativeDialogs = guardNativeDialogs(admin.page);
      let rows: NotificationRow[] = [];
      let updateMode: 'success' | 'failure' = 'success';
      let updateCount = 0;
      await admin.page.route('**/rest/v1/notifications*', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Content-Range': rows.length === 0 ? '*/0' : `0-${rows.length - 1}/${rows.length}` },
            body: JSON.stringify(rows),
          });
          return;
        }
        if (route.request().method() === 'PATCH') {
          updateCount += 1;
          await updateGate?.promise;
          if (updateMode === 'failure') {
            await route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({ code: 'UAT_FORCED_FAILURE', message: 'UAT 模拟全部已读失败' }),
            });
            return;
          }
          rows = rows.map((item) => ({ ...item, is_read: true }));
          await route.fulfill({ status: 204, body: '' });
          return;
        }
        await route.continue();
      });

      for (const viewport of VIEWPORTS) {
        await admin.page.setViewportSize(viewport);

        rows = [];
        await reloadWithNotifications(admin.page);
        await admin.page.getByRole('button', { name: '通知', exact: true }).click();
        nativeDialogs.expectNone();
        const emptyPanel = admin.page.getByRole('dialog', { name: '通知' });
        await expect(emptyPanel.getByText('暂无通知', { exact: true })).toBeVisible();
        await expectNotificationGeometry(admin.page, emptyPanel, viewport, false);
        await admin.page.keyboard.press('Escape');
        await expect(emptyPanel).toBeHidden();

        rows = longNotifications(admin.developerId);
        await reloadWithNotifications(admin.page);
        const bell = admin.page.getByRole('button', { name: '通知', exact: true });
        await expect(bell.locator('span')).toHaveText('20');
        await bell.click();
        nativeDialogs.expectNone();
        const fullPanel = admin.page.getByRole('dialog', { name: '通知' });
        await expectNotificationGeometry(admin.page, fullPanel, viewport, true);
        await expectNotificationScrollIsolation(admin.page, fullPanel, viewport.label);

        if (viewport.width === 1440) {
          updateMode = 'success';
          updateGate = deferred();
          const markAllRead = fullPanel.locator('button').first();
          await markAllRead.click();
          await expect.poll(() => updateCount, '全部已读成功路径只发送一次 PATCH').toBe(1);
          await expect(markAllRead).toHaveText('处理中…');
          await expect(markAllRead).toBeDisabled();
          updateGate.resolve();
          await expect(markAllRead).toHaveText('全部已读');
          await expect(markAllRead).toBeDisabled();
          await expect(bell.locator('span')).toHaveCount(0);
          nativeDialogs.expectNone();

          await admin.page.keyboard.press('Escape');
          rows = longNotifications(admin.developerId);
          updateMode = 'failure';
          updateGate = deferred();
          await reloadWithNotifications(admin.page);
          const failureBell = admin.page.getByRole('button', { name: '通知', exact: true });
          await expect(failureBell.locator('span')).toHaveText('20');
          await failureBell.click();
          const failurePanel = admin.page.getByRole('dialog', { name: '通知' });
          const failedMarkAll = failurePanel.locator('button').first();
          await failedMarkAll.click();
          await expect.poll(() => updateCount, '全部已读失败路径只新增一次 PATCH').toBe(2);
          await expect(failedMarkAll).toHaveText('处理中…');
          updateGate.resolve();
          const failureNotice = admin.page.getByRole('dialog', { name: '提示' });
          await expect(failureNotice).toContainText('UAT 模拟全部已读失败');
          await expect(failurePanel, '全部已读失败后通知列表保持打开').toBeVisible();
          await expect(failureBell.locator('span')).toHaveText('20');
          await expect(failedMarkAll).toHaveText('全部已读');
          await expect(failedMarkAll).toBeEnabled();
          await failureNotice.getByRole('button', { name: '知道了', exact: true }).click();
          await admin.page.keyboard.press('Escape');
          nativeDialogs.expectNone();
          continue;
        }
        await admin.page.keyboard.press('Escape');
        await expect(fullPanel).toBeHidden();
      }
    } finally {
      updateGate?.resolve();
      await closeHardeningSessions(sessions);
    }
  });
});

function guardNativeDialogs(page: Page) {
  const seen: string[] = [];
  page.on('dialog', (dialog) => {
    seen.push(dialog.type());
    void dialog.dismiss();
  });
  return {
    expectNone: () => expect(seen, '任何用户流程触发 Playwright native dialog 事件均为失败').toEqual([]),
  };
}

async function ensureUatDeveloper(actor: HardeningSession, name: string) {
  const existing = await actor.rest.request<DeveloperSnapshot[]>(
    actor.page,
    `developers?select=id,name,position,is_active,user_id&name=eq.${encodeURIComponent(name)}`,
  );
  expect(existing.status).toBe(200);
  if (existing.data?.[0]) return existing.data[0];
  const created = await actor.rest.request<DeveloperSnapshot[]>(actor.page, 'developers', {
    method: 'POST',
    body: { name, position: '测试工程师', is_active: true },
    prefer: 'return=representation',
  });
  expect(created.status).toBe(201);
  expect(created.data).toHaveLength(1);
  return created.data![0];
}

async function developerSnapshot(actor: HardeningSession, id: string) {
  const result = await actor.rest.request<DeveloperSnapshot[]>(
    actor.page,
    `developers?select=id,name,position,is_active,user_id&id=eq.${id}`,
  );
  expect(result.status).toBe(200);
  expect(result.data).toHaveLength(1);
  return result.data![0];
}

async function accountRole(actor: HardeningSession, userId: string) {
  const result = await actor.rest.request<Array<{ role: string }>>(
    actor.page,
    `user_roles?select=role&user_id=eq.${userId}`,
  );
  expect(result.status).toBe(200);
  expect(result.data).toHaveLength(1);
  return result.data![0].role;
}

async function reloadWithNotifications(page: Page) {
  const response = page.waitForResponse((candidate) => (
    candidate.request().method() === 'GET' && candidate.url().includes('/rest/v1/notifications')
  ));
  await page.reload();
  await response;
  await expect(page.getByRole('heading', { name: '项目概览' })).toBeVisible();
}

function longNotifications(recipientId: string): NotificationRow[] {
  return Array.from({ length: 20 }, (_, index) => ({
    id: `uat-notification-${String(index + 1).padStart(2, '0')}`,
    recipient_id: recipientId,
    type: 'task_rejected',
    payload: {
      title: `UAT-长文本通知-${String(index + 1).padStart(2, '0')}-${'跨组项目审批与测试执行状态说明'.repeat(4)}`,
      reason: `结构化原因-${'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(8)}`,
    },
    is_read: false,
    created_at: new Date(Date.UTC(2099, 0, 20, 12, 0, index)).toISOString(),
  }));
}

async function expectNotificationGeometry(
  page: Page,
  panel: Locator,
  viewport: { width: number; height: number; label: string },
  populated: boolean,
) {
  await expect(panel, `${viewport.label} 通知弹层可见`).toBeVisible();
  const box = await panel.boundingBox();
  expect(box, `${viewport.label} 通知弹层必须有布局边界`).not.toBeNull();
  expect(box!.x, `${viewport.label} 左边界`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${viewport.label} 上边界`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${viewport.label} 右边界`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height, `${viewport.label} 下边界`).toBeLessThanOrEqual(viewport.height + 1);

  const bellBox = await page.getByRole('button', { name: '通知', exact: true }).boundingBox();
  expect(bellBox).not.toBeNull();
  expect(Math.abs((box!.x + box!.width) - (bellBox!.x + bellBox!.width)), `${viewport.label} 弹层应锚定通知按钮右边`).toBeLessThanOrEqual(2);

  const hitPoints = [
    { x: box!.x + 2, y: box!.y + 2 },
    { x: box!.x + box!.width - 2, y: box!.y + 2 },
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    { x: box!.x + 2, y: box!.y + box!.height - 2 },
    { x: box!.x + box!.width - 2, y: box!.y + box!.height - 2 },
  ];
  const ownsHitPoints = await panel.evaluate((element, points) => points.every(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return hit !== null && element.contains(hit);
  }), hitPoints);
  expect(ownsHitPoints, `${viewport.label} 弹层不得被其他层遮挡`).toBe(true);

  const header = panel.getByText('通知', { exact: true }).locator('..');
  const scroller = panel.locator('.overflow-y-auto');
  const [headerBox, scrollerBox] = await Promise.all([header.boundingBox(), scroller.boundingBox()]);
  expect(headerBox).not.toBeNull();
  expect(scrollerBox).not.toBeNull();
  expect(Math.abs(scrollerBox!.y - (headerBox!.y + headerBox!.height)), `${viewport.label} 标题区与列表不得有空白断层`).toBeLessThanOrEqual(1);
  expect(Math.abs((scrollerBox!.y + scrollerBox!.height) - (box!.y + box!.height)), `${viewport.label} 列表与弹层底部不得有空白断层`).toBeLessThanOrEqual(1);

  const metrics = await scroller.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(metrics.scrollWidth, `${viewport.label} 通知内容不得横向溢出`).toBeLessThanOrEqual(metrics.clientWidth);
  if (populated) {
    expect(metrics.overflowY).toMatch(/auto|scroll/);
    expect(metrics.scrollHeight, `${viewport.label} 20 条通知必须形成内部滚动`).toBeGreaterThan(metrics.clientHeight);
    const items = scroller.locator(':scope > div');
    await expect(items).toHaveCount(20);
    await expect(items.first()).toBeVisible();
    const firstBox = await items.first().boundingBox();
    expect(firstBox).not.toBeNull();
    expect(Math.abs(firstBox!.y - scrollerBox!.y), `${viewport.label} 第一项前不得有空白断层`).toBeLessThanOrEqual(1);
  }
}

async function expectNotificationScrollIsolation(page: Page, panel: Locator, label: string) {
  const scroller = panel.locator('.overflow-y-auto');
  const before = await outerScrollMetrics(page);
  const initialTop = await scroller.evaluate((element) => element.scrollTop);
  await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const afterTop = await scroller.evaluate((element) => element.scrollTop);
  expect(afterTop, `${label} 通知列表内部滚动位置必须变化`).toBeGreaterThan(initialTop);

  const items = scroller.locator(':scope > div');
  const [lastBox, listBox] = await Promise.all([items.last().boundingBox(), scroller.boundingBox()]);
  expect(lastBox).not.toBeNull();
  expect(listBox).not.toBeNull();
  expect(lastBox!.y, `${label} 末项顶部必须进入可视区`).toBeGreaterThanOrEqual(listBox!.y - 1);
  expect(lastBox!.y + lastBox!.height, `${label} 末项必须完整可见`).toBeLessThanOrEqual(listBox!.y + listBox!.height + 1);

  await scroller.hover();
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(100);
  expect(await outerScrollMetrics(page), `${label} 通知滚动到底后不得穿透到页面`).toEqual(before);
}

function outerScrollMetrics(page: Page) {
  return page.evaluate(() => ({
    windowY: window.scrollY,
    documentTop: document.documentElement.scrollTop,
    bodyTop: document.body.scrollTop,
    mainTop: document.querySelector('main')?.scrollTop ?? 0,
  }));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
