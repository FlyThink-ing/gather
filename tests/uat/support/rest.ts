import type { Page, Request } from '@playwright/test';

type SafeResult<T> = { status: number; data: T | null; errorCode: string | null; errorMessage: string | null };

export class BrowserRestClient {
  private headers: Record<string, string> | null = null;

  attach(page: Page) {
    const capture = (request: Request) => {
      if (!request.url().includes('/rest/v1/')) return;
      const headers = request.headers();
      if (headers.authorization && headers.apikey) {
        this.headers = { authorization: headers.authorization, apikey: headers.apikey };
      }
    };
    page.on('request', capture);
  }

  async waitUntilReady(page: Page) {
    if (this.headers) return;
    await page.waitForRequest((request) => {
      const headers = request.headers();
      return request.url().includes('/rest/v1/') && !!headers.authorization && !!headers.apikey;
    }).catch(() => undefined);
    if (!this.headers) throw new Error('未捕获到已认证 Supabase REST 请求头。');
  }

  async request<T>(page: Page, resource: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<SafeResult<T>> {
    if (!this.headers) throw new Error('REST 客户端尚未就绪。');
    const safeHeaders = this.headers;
    return page.evaluate(async ({ resource, init, safeHeaders }) => {
      const response = await fetch(`/rest/v1/${resource}`, {
        method: init.method ?? 'GET',
        headers: {
          ...safeHeaders,
          'Content-Type': 'application/json',
          ...(init.prefer ? { Prefer: init.prefer } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const text = await response.text();
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
      return {
        status: response.status,
        data: response.ok ? parsed : null,
        errorCode: response.ok ? null : (parsed?.code ?? 'HTTP_ERROR'),
        // 仅保留服务端业务错误文本，不记录请求头、请求体、Token 或 Cookie。
        errorMessage: response.ok ? null : (typeof parsed?.message === 'string' ? parsed.message.slice(0, 500) : null),
      };
    }, { resource, init, safeHeaders });
  }
}
