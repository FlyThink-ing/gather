import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import ts from 'typescript';

const root = path.resolve(process.env.UAT_CONTRACT_ROOT || process.cwd());
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

test('0012 权限、统计、工时与 UI 跨层合同完整 @hardening-static @hardening', async () => {
  const migration = read('supabase/migrations/0012_permission_and_flow_hardening.sql');
  const testingMigration = read('supabase/migrations/0009_testing_center.sql');
  const projects = read('src/pages/Projects.tsx');
  const tasks = read('src/pages/Tasks.tsx');
  const dashboard = read('src/pages/Dashboard.tsx');
  const testing = read('src/pages/TestingCenter.tsx');
  const plan = read('src/pages/TestPlanDetail.tsx');
  const demo = read('src/lib/demoClient.ts');

  for (const symbol of [
    'can_view_task', 'can_view_project', 'can_execute_task', 'can_lead_task', 'can_approve_task',
    'update_project_business', 'admin_update_project_business', 'change_project_governance',
    'lead_manage_task', 'admin_manage_task', 'admin_execute_task_action',
    'get_my_pending_approval_count', 'get_dashboard_task_counts',
    'get_test_work_entries', 'update_test_work_entry', 'void_test_work_entry',
  ]) expect(migration, `0012 缺少 ${symbol}`).toContain(`function public.${symbol}`);

  expect(migration).toMatch(/where public\.can_view_task\(t\.id\)[\s\S]*p_focus_id/);
  expect(migration).not.toMatch(/create policy task_update[\s\S]{0,300}public\.is_manager\(\)/);
  expect(migration).toContain('Approval may only change task status');
  expect(migration).toContain('Illegal task status transition');
  expect(migration).toContain('Testing and terminal tasks are locked to ordinary updates');
  const teamScope = migration.slice(migration.indexOf("p_scope='team'"), migration.indexOf('), counted as'));
  expect(teamScope).toContain('t.developer_id=public.current_developer_id()');
  expect(teamScope).toContain('member.developer_id=t.developer_id');
  expect(teamScope).not.toContain('t.team_id');
  expect(migration).not.toMatch(/can_view_test_plan[\s\S]{0,900}public\.is_test_worker\(\)/);
  expect(migration).toMatch(/actual_rows[\s\S]*public\.can_view_test_plan\(t\.test_plan_id\)/);
  expect(migration).toMatch(/'all_sources'/);
  expect(migration).toMatch(/record_test_work_hours[\s\S]*v_task\.work_source='test_activity'[\s\S]*test_activity_participants/);
  expect(migration).not.toMatch(/record_test_work_hours[\s\S]{0,1800}test_construction_participants/);
  const cycleTransition = migration.slice(
    migration.lastIndexOf('create or replace function public.transition_test_cycle'),
    migration.lastIndexOf('revoke all on function public.transition_test_cycle'),
  );
  expect(cycleTransition).toContain("update public.test_activities set status='in_progress'");
  expect(cycleTransition).toContain("update public.tasks set status='in_progress'");
  expect(cycleTransition).toContain("update public.test_activities set status='paused'");
  expect(cycleTransition).toContain("update public.tasks set status='paused'");
  expect(cycleTransition).toContain("update public.test_activities set status='cancelled'");
  const hourEntry = migration.slice(
    migration.lastIndexOf('create or replace function public.record_test_work_hours'),
    migration.lastIndexOf('revoke all on function public.record_test_work_hours'),
  );
  expect(hourEntry).toContain("v_task.status not in('in_progress','paused')");
  expect(hourEntry).toContain("a.status in('in_progress','paused')");
  expect(testingMigration).toContain("new.work_source in ('test_activity','construction')");
  expect(testingMigration).toContain("new.task_type='test' and new.work_source='development'");
  const taskInsertBoundary = migration.slice(
    migration.indexOf('create policy task_insert'),
    migration.indexOf('create policy task_update'),
  );
  expect(taskInsertBoundary, '普通用户创建任务时必须校验关联项目可见性').toMatch(/can_view_project|project_id is null/i);

  expect(projects).toContain("supabase.rpc('update_project_business'");
  expect(projects).toContain("supabase.rpc('admin_update_project_business'");
  expect(projects).toContain("supabase.rpc('change_project_governance'");
  expect(tasks).toContain("supabase.rpc('lead_manage_task'");
  expect(tasks).toContain("supabase.rpc('admin_manage_task'");
  expect(tasks).toContain("supabase.rpc('admin_execute_task_action'");
  expect(tasks).not.toMatch(/role === 'manager'\) return true/);
  expect(dashboard).toContain("supabase.rpc('get_dashboard_task_counts'");
  expect(dashboard).toContain("label: '待我审批'");
  expect(dashboard).toMatch(/<button[^>]*onClick=.*navigate\(`\/tasks\?scope=all/);
  expect(testing).toContain('全部来源实际工时');
  expect(testing).toContain('overflow-x-auto');
  expect(plan).toContain('只读访问');
  expect(plan).toContain('工时明细');
  expect(plan).toContain('whitespace-nowrap');

  for (const rpcName of [
    'update_project_business', 'admin_update_project_business', 'change_project_governance',
    'lead_manage_task', 'admin_manage_task', 'admin_execute_task_action',
    'get_my_pending_approval_count', 'get_dashboard_task_counts',
    'get_test_work_entries', 'update_test_work_entry', 'void_test_work_entry',
  ]) expect(demo, `demoClient 缺少 ${rpcName}`).toContain(`'${rpcName}'`);
});

test('UI-NATIVE-STATIC-01 运行时代码不得直接或间接引用原生对话框 @hardening-static @hardening', () => {
  const forbidden = new Set(['alert', 'confirm', 'prompt']);
  const violations: string[] = [];
  const files = runtimeSourceFiles(path.join(root, 'src'));
  const configPath = ts.findConfigFile(root, fs.existsSync, 'tsconfig.json');
  expect(configPath, '项目必须存在 tsconfig.json 以解析全局与局部符号').toBeTruthy();
  const config = ts.readConfigFile(configPath!, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(files, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();

  for (const file of files) {
    const source = program.getSourceFile(file);
    expect(source, `TypeScript Program 未加载 ${file}`).toBeTruthy();
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && forbidden.has(node.text)) {
        const declarations = checker.getSymbolAtLocation(node)?.getDeclarations() ?? [];
        const isDomGlobal = declarations.some((declaration) => /[/\\]lib\.dom(?:\.iterable)?\.d\.ts$/i.test(declaration.getSourceFile().fileName));
        const unresolvedRuntimeCall = declarations.length === 0 && ts.isCallExpression(node.parent) && node.parent.expression === node;
        if (isDomGlobal || unresolvedRuntimeCall) addViolation(source!, node, node.text);
      }
      if (
        ts.isElementAccessExpression(node)
        && ts.isIdentifier(node.expression)
        && ['window', 'globalThis', 'self', 'top', 'parent'].includes(node.expression.text)
        && ts.isStringLiteralLike(node.argumentExpression)
        && forbidden.has(node.argumentExpression.text)
      ) {
        addViolation(source!, node, `${node.expression.text}['${node.argumentExpression.text}']`);
      }
      if (
        ts.isVariableDeclaration(node)
        && ts.isObjectBindingPattern(node.name)
        && ts.isIdentifier(node.initializer)
        && ['window', 'globalThis', 'self', 'top', 'parent'].includes(node.initializer.text)
      ) {
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name;
          if (ts.isIdentifier(property) && forbidden.has(property.text)) addViolation(source!, element, `解构 ${node.initializer.text}.${property.text}`);
        }
      }
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'Reflect'
        && node.expression.name.text === 'get'
        && ts.isIdentifier(node.arguments[0])
        && ['window', 'globalThis', 'self', 'top', 'parent'].includes(node.arguments[0].text)
        && ts.isStringLiteralLike(node.arguments[1])
        && forbidden.has(node.arguments[1].text)
      ) {
        addViolation(source!, node, `Reflect.get(${node.arguments[0].text}, '${node.arguments[1].text}')`);
      }
      ts.forEachChild(node, visit);
    };
    const addViolation = (sourceFile: ts.SourceFile, node: ts.Node, label: string) => {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push(`${path.relative(root, file)}:${line + 1}:${character + 1} ${label}`);
    };
    visit(source!);
  }

  expect(violations, 'src 运行时代码必须使用应用内反馈组件；原生 alert/confirm/prompt 零白名单').toEqual([]);
});

function runtimeSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return runtimeSourceFiles(target);
    return /\.(?:[cm]?[jt]sx?)$/i.test(entry.name) && !/\.d\.ts$/i.test(entry.name) ? [target] : [];
  });
}
