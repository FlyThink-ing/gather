// 数据范围分层（v2.5.1）：按角色决定默认可见的任务集合
// admin → 全部；manager → 我的小组（所属/带队并集）；user → 我的任务（仅本人名下）
import type { Task, Developer, Team, Role } from './types';

export type ScopeKey = 'mine' | 'team' | 'all';

export const SCOPE_LABEL: Record<ScopeKey, string> = {
  mine: '我的任务',
  team: '我的小组',
  all: '全部',
};

export interface DevTeamLink {
  developer_id: string;
  team_id: string;
}

/** 我所属（developer_teams）或担任组长（teams.leader_id）的小组 id 并集 */
export function myTeamIds(
  developer: Developer | null,
  teams: Team[],
  devTeams: DevTeamLink[]
): Set<string> {
  const ids = new Set<string>();
  if (!developer) return ids;
  for (const x of devTeams) if (x.developer_id === developer.id) ids.add(x.team_id);
  for (const t of teams) if (t.leader_id === developer.id) ids.add(t.id);
  return ids;
}

export function scopeTasks(
  tasks: Task[],
  scope: ScopeKey,
  developer: Developer | null,
  teams: Team[],
  devTeams: DevTeamLink[]
): Task[] {
  if (scope === 'all') return tasks;
  if (!developer) return tasks;
  if (scope === 'mine') return tasks.filter((t) => t.developer_id === developer.id);
  // team：小组并集内的任务，兜底包含本人名下（跨组被派活也可见）
  const ids = myTeamIds(developer, teams, devTeams);
  if (ids.size === 0) return tasks.filter((t) => t.developer_id === developer.id);
  return tasks.filter((t) => (t.team_id && ids.has(t.team_id)) || t.developer_id === developer.id);
}

export function defaultScope(role: Role): ScopeKey {
  if (role === 'admin') return 'all';
  if (role === 'manager') return 'team';
  return 'mine';
}
