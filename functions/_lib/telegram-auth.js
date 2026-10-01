const encoder = new TextEncoder();
const sessionCookieName = 'lodc_telegram_session';
const sessionLifetimeSeconds = 300;
let cachedAccessKeys;
let cachedAccessKeysUntil = 0;

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function getSigningKey(context) {
  const value = context.env.TELEGRAM_PUBLISH_SECRET;
  if (typeof value !== 'string' || value.length < 32) throw new Error('Telegram publish secret is missing or too short.');
  return crypto.subtle.importKey('raw', encoder.encode(value), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }).filter(([key]) => key));
}

function getAccessConfiguration(context) {
  const domainValue = context.env.CF_ACCESS_TEAM_DOMAIN;
  const audience = context.env.CF_ACCESS_AUD;
  if (typeof domainValue !== 'string' || !domainValue.trim() || typeof audience !== 'string' || !audience.trim()) {
    throw new Error('Cloudflare Access configuration is missing.');
  }
  const domainUrl = new URL(domainValue.startsWith('https://') ? domainValue : `https://${domainValue}`);
  if (domainUrl.protocol !== 'https:' || domainUrl.pathname !== '/' || domainUrl.search || domainUrl.hash) {
    throw new Error('Cloudflare Access team domain must be an HTTPS origin.');
  }
  return { issuer: domainUrl.origin, audience };
}

async function getAccessKeys(issuer) {
  if (cachedAccessKeys && Date.now() < cachedAccessKeysUntil && cachedAccessKeys.issuer === issuer) return cachedAccessKeys.keys;
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Cloudflare Access certificate lookup failed (${response.status}).`);
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error('Cloudflare Access certificate response was invalid.');
  cachedAccessKeys = { issuer, keys: body.keys };
  cachedAccessKeysUntil = Date.now() + 5 * 60 * 1000;
  return body.keys;
}

async function verifyAccessAssertion(context) {
  const assertion = context.request.headers.get('Cf-Access-Jwt-Assertion');
  if (!assertion || assertion.length > 8192) return false;

  const { issuer, audience } = getAccessConfiguration(context);
  const [encodedHeader, encodedClaims, encodedSignature, extra] = assertion.split('.');
  if (!encodedHeader || !encodedClaims || !encodedSignature || extra !== undefined) return false;

  let header;
  let claims;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedHeader)));
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedClaims)));
  } catch {
    return false;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== issuer || !audiences.includes(audience)
    || !Number.isFinite(claims.exp) || claims.exp <= now
    || (Number.isFinite(claims.nbf) && claims.nbf > now + 30)
    || (Number.isFinite(claims.iat) && claims.iat > now + 30)) return false;

  const keys = await getAccessKeys(issuer);
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig');
  if (!jwk) return false;
  const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signedContent = encoder.encode(`${encodedHeader}.${encodedClaims}`);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, base64UrlDecode(encodedSignature), signedContent);
}

async function createSessionToken(context, subject) {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({
    sub: subject,
    exp: Math.floor(Date.now() / 1000) + sessionLifetimeSeconds
  })));
  const key = await getSigningKey(context);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifySessionToken(context, token) {
  if (!token || token.length > 2048) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return false;
  try {
    const key = await getSigningKey(context);
    const valid = await crypto.subtle.verify('HMAC', key, base64UrlDecode(signature), encoder.encode(payload));
    if (!valid) return false;
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    return typeof claims.sub === 'string' && Number.isFinite(claims.exp) && claims.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function isLocalDevelopment(context) {
  const url = new URL(context.request.url);
  return context.env.ENVIRONMENT === 'development'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
}

export function hasTelegramConfiguration(context) {
  return typeof context.env.TELEGRAM_BOT_TOKEN === 'string' && context.env.TELEGRAM_BOT_TOKEN.length > 0
    && typeof context.env.TELEGRAM_CHAT_ID === 'string' && /^-?\d+$/.test(context.env.TELEGRAM_CHAT_ID)
    && typeof context.env.TELEGRAM_PUBLISH_SECRET === 'string' && context.env.TELEGRAM_PUBLISH_SECRET.length >= 32;
}

export async function createAuthorizedSession(context) {
  const url = new URL(context.request.url);
  let subject = 'local-development';
  if (isLocalDevelopment(context)) {
    const origin = context.request.headers.get('Origin');
    if (origin && origin !== url.origin) return { ok: false, response: jsonResponse({ error: 'No autorizado.' }, 403) };
  } else {
    try {
      if (!await verifyAccessAssertion(context)) return { ok: false, response: jsonResponse({ error: 'No autorizado.' }, 403) };
      subject = 'cloudflare-access-user';
    } catch (error) {
      console.error('Telegram Access session validation failed.', error instanceof Error ? error.name : 'UnknownError');
      return { ok: false, response: jsonResponse({ error: 'No autorizado.' }, 403) };
    }
  }

  const token = await createSessionToken(context, subject);
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return {
    ok: true,
    response: new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': `${sessionCookieName}=${token}; Path=/api/telegram/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetimeSeconds}${secure}`
      }
    })
  };
}

export async function isAuthorizedRequest(context) {
  const url = new URL(context.request.url);
  if (context.request.headers.get('Origin') !== url.origin) return false;
  const fetchSite = context.request.headers.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite !== 'same-origin' && !(isLocalDevelopment(context) && fetchSite === 'same-site')) return false;

  const cookies = parseCookies(context.request.headers.get('Cookie') || '');
  return verifySessionToken(context, cookies[sessionCookieName]);
}

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

export function clearSessionCookie(url) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${sessionCookieName}=; Path=/api/telegram/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}
