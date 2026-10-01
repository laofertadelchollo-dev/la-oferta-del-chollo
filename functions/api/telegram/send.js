import { isProductionOfferEligible, isSafeWebUrl } from '../../../src/lib/offer-policy.js';
import { generateTelegramPost } from '../../../src/lib/offer-telegram.js';
import {
  hasTelegramConfiguration,
  isAuthorizedRequest,
  isLocalDevelopment,
  jsonResponse
} from '../../_lib/telegram-auth.js';

const maxBodyLength = 24_000;
const demoMessage = 'PRUEBA DE TELEGRAM — LA OFERTA DEL CHOLLO\n\nMensaje de prueba manual. No es una oferta real.';

function isPublishableOffer(offer) {
  return Boolean(offer)
    && typeof offer === 'object'
    && !Array.isArray(offer)
    && offer.demo !== true
    && offer.verified === true
    && offer.status === 'published'
    && isSafeWebUrl(offer.affiliateUrl)
    && isProductionOfferEligible(offer);
}

export async function onRequestPost(context) {
  if (!isLocalDevelopment(context)) {
    return jsonResponse({ error: 'El envío a Telegram está desactivado temporalmente en producción.' }, 503);
  }

  if (!hasTelegramConfiguration(context)) {
    return jsonResponse({ error: 'La publicación en Telegram no está configurada.' }, 503);
  }

  let authorized = false;
  try {
    authorized = await isAuthorizedRequest(context);
  } catch (error) {
    console.error('Telegram request authorization failed.', error instanceof Error ? error.name : 'UnknownError');
  }
  if (!authorized) return jsonResponse({ error: 'No autorizado.' }, 403);

  const contentType = context.request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return jsonResponse({ error: 'Petición no válida.' }, 415);
  }
  const contentLength = Number(context.request.headers.get('Content-Length') || 0);
  if (contentLength > maxBodyLength) return jsonResponse({ error: 'Petición no válida.' }, 413);

  let body;
  try {
    const text = await context.request.text();
    if (text.length > maxBodyLength) return jsonResponse({ error: 'Petición no válida.' }, 413);
    body = JSON.parse(text);
  } catch {
    return jsonResponse({ error: 'Petición no válida.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonResponse({ error: 'Petición no válida.' }, 400);

  let message;
  if (body.action === 'test') {
    message = demoMessage;
  } else if (body.action === 'offer') {
    if (!isPublishableOffer(body.offer)) {
      return jsonResponse({ error: 'La oferta no está aprobada para publicar.' }, 422);
    }
    try {
      message = generateTelegramPost(body.offer);
    } catch {
      return jsonResponse({ error: 'La oferta no está aprobada para publicar.' }, 422);
    }
  } else {
    return jsonResponse({ error: 'Petición no válida.' }, 400);
  }
  if (message.length > 4096) return jsonResponse({ error: 'El mensaje supera el límite permitido por Telegram.' }, 422);

  let telegramResponse;
  try {
    telegramResponse = await fetch(`https://api.telegram.org/bot${context.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: context.env.TELEGRAM_CHAT_ID, text: message })
    });
  } catch (error) {
    console.error('Telegram sendMessage network failure.', error instanceof Error ? error.name : 'UnknownError');
    return jsonResponse({ error: 'Telegram no pudo enviar el mensaje.' }, 502);
  }

  let result;
  try {
    result = await telegramResponse.json();
  } catch {
    console.error('Telegram sendMessage returned a non-JSON response.', { status: telegramResponse.status });
    return jsonResponse({ error: 'Telegram no pudo enviar el mensaje.' }, 502);
  }
  if (!telegramResponse.ok || result?.ok !== true) {
    const errorCode = Number.isInteger(result?.error_code) ? result.error_code : telegramResponse.status;
    console.error('Telegram sendMessage rejected the request.', { status: telegramResponse.status, errorCode });
    return jsonResponse({ error: 'Telegram no pudo enviar el mensaje.' }, 502);
  }

  return jsonResponse({ ok: true });
}
