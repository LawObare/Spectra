interface Env {
  BACKEND_URL?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
}

/**
 * Cloudflare Pages reverse proxy for all /api/* routes (REST, SSE, binary Float32, and WebSockets).
 * Set BACKEND_URL in Cloudflare Pages settings (e.g. https://<hf-user>-spectra-mission-engine.hf.space).
 */
export async function onRequest(context: PagesContext): Promise<Response> {
  const backendOrigin = (context.env.BACKEND_URL || '').trim().replace(/\/+$/, '');
  if (!backendOrigin) {
    return new Response(
      JSON.stringify({
        error: 'BACKEND_URL is not configured in Cloudflare Pages environment variables.',
      }),
      {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }
    );
  }

  const incomingUrl = new URL(context.request.url);
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, backendOrigin);

  const headers = new Headers(context.request.headers);
  headers.delete('host');
  headers.set('x-forwarded-host', incomingUrl.host);
  headers.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''));

  const method = context.request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const upstreamRequest = new Request(targetUrl.toString(), {
    method,
    headers,
    body: hasBody ? context.request.body : undefined,
    redirect: 'manual',
  });

  return fetch(upstreamRequest);
}
