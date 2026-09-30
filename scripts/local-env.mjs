import fs from 'node:fs/promises';
import path from 'node:path';

const apiUrl = process.env.LOCAL_SUPABASE_URL;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;

if (!apiUrl || !anonKey) {
  throw new Error('本地 Supabase 前端连接参数不完整。');
}

await fs.writeFile(
  path.join(process.cwd(), '.env.local'),
  `SUPABASE_URL=${apiUrl}\nSUPABASE_ANON_KEY=${anonKey}\n`,
  { encoding: 'utf8' },
);

console.log('本地前端连接配置已就绪。');
