import fs from 'node:fs';
import path from 'node:path';

export type AccountKey =
  | 'admin'
  | 'manager'
  | 'user'
  | 'teamLead'
  | 'otherTeamLead'
  | 'emptyManager'
  | 'teamMember'
  | 'outsider'
  | 'crossGroupOwner'
  | 'projectOwner'
  | 'testLead'
  | 'testEngineer'
  | 'testParticipant'
  | 'automationTester';

export interface UatAccount {
  email: string;
  password: string;
}

let loaded = false;

export function loadUatEnv(file = path.resolve(process.cwd(), '.env.uat')) {
  if (loaded) return;
  loaded = true;
  if (process.env.UAT_DISABLE_ENV_FILE === '1') return;
  if (!fs.existsSync(file)) return;

  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadUatEnv();

const accountVars: Record<AccountKey, [string, string]> = {
  admin: ['UAT_ADMIN_EMAIL', 'UAT_ADMIN_PASSWORD'],
  manager: ['UAT_MANAGER_EMAIL', 'UAT_MANAGER_PASSWORD'],
  user: ['UAT_USER_EMAIL', 'UAT_USER_PASSWORD'],
  teamLead: ['UAT_TEAM_LEAD_EMAIL', 'UAT_TEAM_LEAD_PASSWORD'],
  otherTeamLead: ['UAT_OTHER_TEAM_LEAD_EMAIL', 'UAT_OTHER_TEAM_LEAD_PASSWORD'],
  emptyManager: ['UAT_EMPTY_MANAGER_EMAIL', 'UAT_EMPTY_MANAGER_PASSWORD'],
  teamMember: ['UAT_TEAM_MEMBER_EMAIL', 'UAT_TEAM_MEMBER_PASSWORD'],
  outsider: ['UAT_OUTSIDER_EMAIL', 'UAT_OUTSIDER_PASSWORD'],
  crossGroupOwner: ['UAT_CROSS_GROUP_OWNER_EMAIL', 'UAT_CROSS_GROUP_OWNER_PASSWORD'],
  projectOwner: ['UAT_PROJECT_OWNER_EMAIL', 'UAT_PROJECT_OWNER_PASSWORD'],
  testLead: ['UAT_TEST_LEAD_EMAIL', 'UAT_TEST_LEAD_PASSWORD'],
  testEngineer: ['UAT_TEST_ENGINEER_EMAIL', 'UAT_TEST_ENGINEER_PASSWORD'],
  testParticipant: ['UAT_TEST_PARTICIPANT_EMAIL', 'UAT_TEST_PARTICIPANT_PASSWORD'],
  automationTester: ['UAT_AUTOMATION_TESTER_EMAIL', 'UAT_AUTOMATION_TESTER_PASSWORD'],
};

const placeholder = /^(YOUR_|.*@example\.com$|http:\/\/YOUR_)/i;

export function account(key: AccountKey): UatAccount | null {
  const [emailKey, passwordKey] = accountVars[key];
  const email = process.env[emailKey]?.trim() ?? '';
  const password = process.env[passwordKey]?.trim() ?? '';
  if (!email || !password || placeholder.test(email) || placeholder.test(password)) return null;
  return { email, password };
}

export const uatEnv = {
  get baseUrl() {
    const value = process.env.UAT_BASE_URL?.trim() ?? '';
    return placeholder.test(value) ? '' : value.replace(/\/$/, '');
  },
  get runId() {
    return (process.env.UAT_RUN_ID?.trim() || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14))
      .replace(/[^a-zA-Z0-9_-]/g, '-');
  },
};
