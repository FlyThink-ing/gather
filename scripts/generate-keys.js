/**
 * 一键生成自建 Supabase 所需的三个密钥：
 *   JWT_SECRET / ANON_KEY / SERVICE_ROLE_KEY
 *
 * 用法（在项目根目录，Windows/Mac/Linux 都行）：
 *   node scripts/generate-keys.js
 *
 * 把输出的三行分别粘贴进服务器上 supabase/docker/.env 的对应位置即可。
 * 无需安装任何依赖。
 */
const crypto = require('crypto');

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJWT(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest();
  return `${header}.${body}.${b64url(sig)}`;
}

const JWT_SECRET = crypto.randomBytes(48).toString('base64').replace(/[+/=]/g, '').slice(0, 48);

const iat = Math.floor(Date.now() / 1000);
const exp = iat + 60 * 60 * 24 * 365 * 10; // 10 年有效期

const ANON_KEY = signJWT({ role: 'anon', iss: 'supabase', iat, exp }, JWT_SECRET);
const SERVICE_ROLE_KEY = signJWT({ role: 'service_role', iss: 'supabase', iat, exp }, JWT_SECRET);

console.log('============================================================');
console.log('已生成，请复制以下三行到服务器 supabase/docker/.env 中：');
console.log('（同名的旧行删掉或注释掉）');
console.log('============================================================\n');
console.log(`JWT_SECRET=${JWT_SECRET}\n`);
console.log(`ANON_KEY=${ANON_KEY}\n`);
console.log(`SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}\n`);
console.log('============================================================');
console.log('另外：本项目前端 .env 里的 SUPABASE_ANON_KEY 也用上面的 ANON_KEY。');
console.log('注意：这三个值是一套的，不能只换其中一个。');
console.log('============================================================');
