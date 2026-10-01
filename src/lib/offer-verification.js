import { isCalendarDate, isSafeDemoUrl, isSafeWebUrl } from './offer-policy.js';

export function verifyCandidate(candidate, now = new Date()) {
  const errors = [];
  const checkedAt = now.toISOString();

  if (!candidate || typeof candidate !== 'object') {
    return { valid: false, errors: ['El candidato debe ser un objeto.'], checkedAt, demo: false };
  }
  if (typeof candidate.title !== 'string' || !candidate.title.trim()) errors.push('Falta un título.');
  if (typeof candidate.store !== 'string' || !candidate.store.trim()) errors.push('Falta la tienda.');
  if (!Number.isFinite(candidate.currentPrice) || candidate.currentPrice <= 0) errors.push('El precio debe ser mayor que cero.');
  if (!isSafeWebUrl(candidate.sourceUrl) && !(candidate.demo === true && isSafeDemoUrl(candidate.sourceUrl))) errors.push('Falta una URL de origen HTTP(S) válida.');
  if (!candidate.checkedAt || !Number.isFinite(Date.parse(candidate.checkedAt)) || Date.parse(candidate.checkedAt) > now.getTime()) {
    errors.push('La fecha de comprobación no es válida o está en el futuro.');
  }
  if (candidate.image && !((candidate.image.startsWith('/') && !candidate.image.startsWith('//')) || isSafeWebUrl(candidate.image))) {
    errors.push('La imagen debe ser una ruta local o una URL HTTP(S) válida.');
  }
  if (candidate.previousPrice !== undefined
    && (!Number.isFinite(candidate.previousPrice) || candidate.previousPrice <= candidate.currentPrice)) {
    errors.push('El precio anterior debe ser superior al precio actual.');
  }
  if (candidate.previousPriceVerified === true
    && (!Number.isFinite(candidate.previousPrice) || candidate.previousPrice <= candidate.currentPrice)) {
    errors.push('No se puede verificar un precio anterior que no supere al precio actual.');
  }
  if (candidate.expiresAt && (!isCalendarDate(candidate.expiresAt) || candidate.expiresAt < now.toISOString().slice(0, 10))) {
    errors.push('La fecha de caducidad es inválida o ya ha pasado.');
  }

  return {
    valid: errors.length === 0,
    errors,
    checkedAt,
    demo: candidate.demo === true,
    ...(candidate.demo === true ? { warning: 'Candidato DEMO: no puede publicarse en producción.' } : {})
  };
}

export function verifyOffer(offer, now = new Date()) {
  const result = verifyCandidate({ ...offer, checkedAt: now.toISOString() }, now);
  if (!result.valid || result.demo) {
    return { ...result, valid: false, errors: [...result.errors, ...(result.demo ? ['Las ofertas DEMO no pueden marcarse como verificadas para producción.'] : [])] };
  }
  return { ...result, offer: { ...offer, verified: true, status: 'verified', lastVerifiedAt: result.checkedAt } };
}
