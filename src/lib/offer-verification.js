import { isCalendarDate, isSafeDemoUrl, isSafeWebUrl } from './offer-policy.js';

export function verifyCandidate(candidate, now = new Date()) {
  const errors = [];
  const verificationNotes = [
    'Se han comprobado estructura, formatos y coherencia de los datos importados.',
    'No se ha consultado el producto en tiempo real; precio, disponibilidad y condiciones requieren comprobación humana en origen.'
  ];
  const checkedAt = now.toISOString();

  if (!candidate || typeof candidate !== 'object') {
    return {
      valid: false, verified: false, errors: ['El candidato debe ser un objeto.'],
      verificationNotes, lastVerifiedAt: null, checkedAt, demo: false
    };
  }
  if (typeof candidate.title !== 'string' || !candidate.title.trim()) errors.push('Falta un título.');
  if (typeof candidate.store !== 'string' || !candidate.store.trim()) errors.push('Falta la tienda.');
  if (typeof candidate.category !== 'string' || !candidate.category.trim()) errors.push('Falta la categoría.');
  if (!Number.isFinite(candidate.currentPrice) || candidate.currentPrice <= 0) errors.push('El precio debe ser mayor que cero.');
  if (!isSafeWebUrl(candidate.sourceUrl) && !(candidate.demo === true && isSafeDemoUrl(candidate.sourceUrl))) errors.push('Falta una URL de origen HTTP(S) válida.');
  if (typeof candidate.available !== 'boolean') errors.push('La disponibilidad debe estar indicada explícitamente.');
  if (typeof candidate.currency !== 'string' || !/^[A-Z]{3}$/.test(candidate.currency)) errors.push('Falta una moneda ISO 4217 válida.');
  if (!['aliexpress', 'awin', 'generic', 'amazon'].includes(candidate.source)) errors.push('Falta una fuente reconocida.');
  if (typeof candidate.conditions !== 'string' || !candidate.conditions.trim()) errors.push('Las condiciones no están claras; indica las condiciones o «Sin condiciones especiales».');
  if (!candidate.checkedAt || !Number.isFinite(Date.parse(candidate.checkedAt)) || Date.parse(candidate.checkedAt) > now.getTime()) {
    errors.push('La fecha de comprobación no es válida o está en el futuro.');
  }
  if (candidate.image && !((candidate.image.startsWith('/') && !candidate.image.startsWith('//')) || isSafeWebUrl(candidate.image))) {
    errors.push('La imagen debe ser una ruta local o una URL HTTP(S) válida.');
  }
  if (candidate.previousPrice !== undefined && candidate.previousPrice !== null
    && (!Number.isFinite(candidate.previousPrice) || candidate.previousPrice <= candidate.currentPrice)) {
    errors.push('El precio anterior debe ser superior al precio actual.');
  }
  if (candidate.previousPriceVerified === true
    && (!Number.isFinite(candidate.previousPrice) || candidate.previousPrice <= candidate.currentPrice)) {
    errors.push('No se puede verificar un precio anterior que no supere al precio actual.');
  }
  if (candidate.discount !== undefined && candidate.discount !== null) {
    const expectedDiscount = Number.isFinite(candidate.previousPrice)
      && candidate.previousPriceVerified === true
      ? Math.round(((candidate.previousPrice - candidate.currentPrice) / candidate.previousPrice) * 100)
      : null;
    if (expectedDiscount === null || candidate.discount !== expectedDiscount) errors.push('El descuento no coincide con un precio anterior verificable.');
  }
  if (candidate.available === false) errors.push('El producto figura como agotado o no disponible.');
  if (candidate.affiliateUrl && !isSafeWebUrl(candidate.affiliateUrl)) errors.push('El enlace afiliado no es una URL HTTP(S) válida.');
  if (candidate.affiliateRequired === true && !candidate.affiliateUrl) errors.push('La fuente exige enlace afiliado, pero el candidato no lo incluye.');
  if (candidate.expiresAt && (!isCalendarDate(candidate.expiresAt) || candidate.expiresAt < now.toISOString().slice(0, 10))) {
    errors.push('La fecha de caducidad es inválida o ya ha pasado.');
  }

  return {
    valid: errors.length === 0,
    verified: errors.length === 0 && candidate.verified === true && candidate.demo !== true,
    errors,
    verificationNotes,
    lastVerifiedAt: errors.length === 0 && candidate.verified === true && candidate.demo !== true ? checkedAt : null,
    checkedAt,
    demo: candidate.demo === true,
    ...(candidate.demo === true ? { warning: 'Candidato DEMO: no puede publicarse en producción.' } : {})
  };
}

export function verifyOffer(offer, now = new Date()) {
  const result = verifyCandidate({
    ...offer,
    category: offer.category,
    currency: 'EUR',
    available: true,
    source: 'generic',
    conditions: typeof offer.conditions === 'string' ? offer.conditions : '',
    previousPrice: offer.previousPrice ?? null,
    discount: offer.previousPriceVerified === true ? offer.discount ?? null : null,
    affiliateRequired: false,
    checkedAt: now.toISOString()
  }, now);
  if (!result.valid || result.demo) {
    return { ...result, valid: false, errors: [...result.errors, ...(result.demo ? ['Las ofertas DEMO no pueden marcarse como verificadas para producción.'] : [])] };
  }
  return { ...result, offer: { ...offer, verified: true, status: 'verified', lastVerifiedAt: result.checkedAt } };
}
