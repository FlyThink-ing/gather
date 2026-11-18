import { STATUS_LABEL, type Task, type TaskStatus } from './types';

export const testingFeaturesEnabled = process.env.ENABLE_TESTING_FEATURES === 'true';

export function isVisibleTask(task: Pick<Task, 'task_type'>) {
  return testingFeaturesEnabled || task.task_type === 'dev';
}

export function taskStatusLabel(status: TaskStatus) {
  return !testingFeaturesEnabled && status === 'testing' ? '已锁定' : STATUS_LABEL[status];
}

export function projectCompletionMessage(message: string) {
  if (testingFeaturesEnabled) return message;

  const blockers = /^项目仍有阻断项：未完成开发任务 (\d+) 个、.*?待审批 (\d+) 个/.exec(message);
  if (!blockers) return message;

  const [, unfinished, review] = blockers;
  return Number(unfinished) || Number(review)
    ? `项目尚未满足完成条件。未完成开发任务 ${unfinished} 个，待审批任务 ${review} 个。`
    : '项目尚未满足完成条件，请联系管理员。';
}
