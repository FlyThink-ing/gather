// 白天/黑夜主题：class 策略（html.dark），持久化到 localStorage
export type Theme = 'light' | 'dark';

const KEY = 'gather-theme';

export function getTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved === 'light' ? 'light' : 'dark'; // 默认黑夜（与现有风格一致）
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem(KEY, theme);
}

export function initTheme() {
  applyTheme(getTheme());
}
