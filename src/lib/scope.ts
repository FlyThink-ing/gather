// 列表默认范围由角色决定，实际可见范围由服务端授权。
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

export function developerTeamIds(
  developerId: string | null,
  teams: Pick<Team, 'id' | 'leader_id'>[],
  devTeams: DevTeamLink[]
): Set<string> {
  const ids = new Set<string>();
  if (!developerId) return ids;
  for (const x of devTeams) if (x.developer_id === developerId) ids.add(x.team_id);
  for (const t of teams) if (t.leader_id === developerId) ids.add(t.id);
  return ids;
}

export function taskTeamIds(
  task: Task,
  teams: Team[],
  devTeams: DevTeamLink[],
): Set<string> {
  if (task.project_id && task.task_type === 'dev') {
    return developerTeamIds(task.developer_id ?? task.created_by, teams, devTeams);
  }
  return new Set(task.team_id ? [task.team_id] : []);
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
  const ledTeams = teams.filter((team) => team.leader_id === developer.id);
  const members = new Set(devTeams.filter((link) => ledTeams.some((team) => team.id === link.team_id)).map((link) => link.developer_id));
  members.add(developer.id);
  return tasks.filter((task) => (task.developer_id && members.has(task.developer_id))
    || (task.created_by && members.has(task.created_by)));
}

export function defaultScope(role: Role): ScopeKey {
  if (role === 'admin') return 'all';
  if (role === 'manager') return 'team';
  return 'mine';
}
