import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost } from '../functions/api/telegram/send.js';
import { onRequestGet } from '../functions/api/telegram/session.js';

const testEnv = {
  ENVIRONMENT: 'development',
  TELEGRAM_BOT_TOKEN: 'unit-test-token-not-real',
  TELEGRAM_CHAT_ID: '-123456',
  TELEGRAM_PUBLISH_SECRET: 'unit-test-publish-secret-with-over-32-chars'
};

function localContext(path, { method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  return {
    request: new Request(`http://127.0.0.1${path}`, {
      method,
      headers: requestHeaders,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    }),
    env: testEnv
  };
}

async function sessionCookie() {
  const response = await onRequestGet(localContext('/api/telegram/session'));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('Set-Cookie');
  assert.ok(cookie?.includes('HttpOnly'));
  assert.ok(cookie?.includes('SameSite=Strict'));
  return cookie.split(';', 1)[0];
}

test('session endpoint creates a short-lived HttpOnly cookie only with configured bindings', async () => {
  const response = await onRequestGet(localContext('/api/telegram/session'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly/);
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=300/);

  const unconfigured = await onRequestGet({
    ...localContext('/api/telegram/session'),
    env: { ...testEnv, TELEGRAM_PUBLISH_SECRET: '' }
  });
  assert.equal(unconfigured.status, 503);
});

test('production session and send endpoints are disabled before creating sessions or contacting Telegram', async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ ok: true });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const productionContext = (path, options = {}) => ({
    ...localContext(path, options),
    request: new Request(`https://la-oferta-del-chollo.pages.dev${path}`, {
      method: options.method || 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
    }),
    env: { ...testEnv, ENVIRONMENT: 'production' }
  });

  const sessionResponse = await onRequestGet(productionContext('/api/telegram/session'));
  assert.equal(sessionResponse.status, 503);
  assert.equal(sessionResponse.headers.has('Set-Cookie'), false);

  const sendResponse = await onRequestPost(productionContext('/api/telegram/send', {
    method: 'POST',
    body: { action: 'test' }
  }));
  assert.equal(sendResponse.status, 503);
  assert.deepEqual(await sendResponse.json(), {
    error: 'El envío a Telegram está desactivado temporalmente en producción.'
  });
  assert.equal(fetchCount, 0);
});

test('remote session and send endpoints remain disabled even with development bindings', async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ ok: true });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const remoteContext = (path, options = {}) => ({
    request: new Request(`https://preview.pages.dev${path}`, {
      method: options.method || 'GET',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : {},
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
    }),
    env: testEnv
  });

  const sessionResponse = await onRequestGet(remoteContext('/api/telegram/session'));
  assert.equal(sessionResponse.status, 503);
  assert.equal(sessionResponse.headers.has('Set-Cookie'), false);

  const sendResponse = await onRequestPost(remoteContext('/api/telegram/send', {
    method: 'POST',
    body: { action: 'test' }
  }));
  assert.equal(sendResponse.status, 503);
  assert.equal(fetchCount, 0);
});

test('send endpoint accepts only explicit demo test action and relays server-side credentials', async (t) => {
  const cookie = await sessionCookie();
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body) };
    return Response.json({ ok: true, result: { message_id: 10 } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await onRequestPost(localContext('/api/telegram/send', {
    method: 'POST',
    body: { action: 'test' },
    headers: { Origin: 'http://127.0.0.1', Cookie: cookie }
  }));
  assert.equal(response.status, 200);
  assert.equal(sent.body.chat_id, testEnv.TELEGRAM_CHAT_ID);
  assert.match(sent.body.text, /^PRUEBA DE TELEGRAM — LA OFERTA DEL CHOLLO/);
  assert.ok(sent.url.endsWith('/sendMessage'));
  const clientResponse = await response.text();
  assert.equal(clientResponse.includes(testEnv.TELEGRAM_BOT_TOKEN), false);
  assert.equal(clientResponse.includes(testEnv.TELEGRAM_PUBLISH_SECRET), false);
});

test('send endpoint formats an approved real offer and rejects an affiliate-less offer', async (t) => {
  const cookie = await sessionCookie();
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body) };
    return Response.json({ ok: true });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const now = new Date();
  const publishedAt = now.toISOString().slice(0, 10);
  const offer = {
    id: 'unit-test-offer',
    title: 'Producto verificado de prueba',
    slug: 'producto-verificado-de-prueba',
    store: 'Tienda de prueba',
    category: 'tecnologia',
    currentPrice: 29.99,
    previousPrice: 49.99,
    previousPriceVerified: true,
    discount: 40,
    coupon: '',
    conditions: 'Prueba editorial.',
    seller: 'Vendedor de prueba',
    description: 'Descripción editorial de prueba.',
    shortDescription: 'Resumen editorial de prueba.',
    sourceUrl: 'https://www.aemet.es/',
    affiliateUrl: 'https://www.aemet.es/',
    publishedAt,
    lastVerifiedAt: now.toISOString(),
    featured: false,
    verified: true,
    score: 80,
    tags: [],
    demo: false,
    status: 'published'
  };

  const response = await onRequestPost(localContext('/api/telegram/send', {
    method: 'POST',
    body: { action: 'offer', offer },
    headers: { Origin: 'http://127.0.0.1', Cookie: cookie }
  }));
  assert.equal(response.status, 200);
  assert.match(sent.body.text, /Producto verificado de prueba/);
  assert.match(sent.body.text, /Precio: 29,99 €/);
  assert.match(sent.body.text, /Descuento: 40 %/);
  assert.match(sent.body.text, /Enlace de afiliado/);

  const noAffiliate = await onRequestPost(localContext('/api/telegram/send', {
    method: 'POST',
    body: { action: 'offer', offer: { ...offer, affiliateUrl: '' } },
    headers: { Origin: 'http://127.0.0.1', Cookie: cookie }
  }));
  assert.equal(noAffiliate.status, 422);
});

test('send endpoint refuses missing auth, cross-origin requests, DEMO offers and incomplete published offers', async (t) => {
  const cookie = await sessionCookie();
  const originalFetch = globalThis.fetch;
  let sendCount = 0;
  globalThis.fetch = async () => {
    sendCount += 1;
    return Response.json({ ok: true });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const withoutCookie = await onRequestPost(localContext('/api/telegram/send', {
    method: 'POST',
    body: { action: 'test' },
    headers: { Origin: 'http://127.0.0.1' }
  }));
  assert.equal(withoutCookie.status, 403);

  const crossOrigin = await onRequestPost(localContext('/api/telegram/send', {
    method: 'POST',
    body: { action: 'test' },
    headers: { Origin: 'https://attacker.invalid', Cookie: cookie }
  }));
  assert.equal(crossOrigin.status, 403);

  const demoOffer = await onRequestPost(localContext('/api/telegram/send', {
    method: 'POST',
    body: { action: 'offer', offer: { demo: true, status: 'published', verified: true } },
    headers: { Origin: 'http://127.0.0.1', Cookie: cookie }
  }));
  assert.equal(demoOffer.status, 422);

  const unpublished = await onRequestPost(localContext('/api/telegram/send', {
    method: 'POST',
    body: { action: 'offer', offer: { status: 'draft', verified: true, demo: false } },
    headers: { Origin: 'http://127.0.0.1', Cookie: cookie }
  }));
  assert.equal(unpublished.status, 422);
  assert.equal(sendCount, 0);
});

test('Telegram API errors return only the generic message', async (t) => {
  const cookie = await sessionCookie();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok: false, error_code: 400, description: 'test failure' }, { status: 400 });
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await onRequestPost(localContext('/api/telegram/send', {
    method: 'POST',
    body: { action: 'test' },
    headers: { Origin: 'http://127.0.0.1', Cookie: cookie }
  }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Telegram no pudo enviar el mensaje.' });
});
