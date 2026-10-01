import {
  clearSessionCookie,
  createAuthorizedSession,
  hasTelegramConfiguration,
  jsonResponse
} from '../../_lib/telegram-auth.js';

export async function onRequestGet(context) {
  if (context.env.ENVIRONMENT === 'production') {
    return jsonResponse({ error: 'El envío a Telegram está desactivado temporalmente en producción.' }, 503);
  }

  if (!hasTelegramConfiguration(context)) {
    return jsonResponse({ error: 'La publicación en Telegram no está configurada.' }, 503);
  }

  const result = await createAuthorizedSession(context);
  return result.response;
}

export async function onRequestDelete(context) {
  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store',
      'Set-Cookie': clearSessionCookie(new URL(context.request.url))
    }
  });
}
