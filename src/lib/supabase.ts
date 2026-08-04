import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDemoClient } from './demoClient';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

// 未配置真实 Supabase（.env 还是占位值）时进入演示模式：
// 内置模拟数据，任意邮箱密码可登录，数据存 localStorage。
export const isDemoMode =
  !url || !anonKey || url.includes('your-project-ref') || anonKey.includes('your-anon');

if (isDemoMode) {
  // eslint-disable-next-line no-console
  console.info(
    '[gather] 演示模式：未检测到真实 Supabase 配置（.env）。' +
      '当前使用内置模拟数据，window.__resetDemo() 可重置。'
  );
}

export const supabase: SupabaseClient = (
  isDemoMode
    ? (createDemoClient() as unknown)
    : createClient(url!, anonKey!, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
) as SupabaseClient;
