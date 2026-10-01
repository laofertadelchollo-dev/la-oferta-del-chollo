import { isSafeDemoUrl, isSafeWebUrl } from '../offer-policy.js';

export function normalizeCandidate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('El candidato debe ser un objeto JSON.');
  }

  const candidate = input;
  const errors = [];
  if (typeof candidate.title !== 'string' || !candidate.title.trim()) errors.push('title debe ser un texto no vacío.');
  if (typeof candidate.store !== 'string' || !candidate.store.trim()) errors.push('store debe ser un texto no vacío.');
  if (!Number.isFinite(candidate.currentPrice) || candidate.currentPrice <= 0) errors.push('currentPrice debe ser un número mayor que cero.');
  if (!isSafeWebUrl(candidate.sourceUrl) && !(candidate.demo === true && isSafeDemoUrl(candidate.sourceUrl))) errors.push('sourceUrl debe ser una URL HTTP(S) válida.');
  if (typeof candidate.checkedAt !== 'string' || !Number.isFinite(Date.parse(candidate.checkedAt))) errors.push('checkedAt debe contener una fecha válida.');
  if (candidate.checkedAt && Date.parse(candidate.checkedAt) > Date.now()) errors.push('checkedAt no puede estar en el futuro.');
  if (candidate.previousPrice !== undefined
    && (!Number.isFinite(candidate.previousPrice) || candidate.previousPrice <= candidate.currentPrice)) {
    errors.push('previousPrice debe ser mayor que currentPrice.');
  }
  if (candidate.image && !isSafeWebUrl(candidate.image)) errors.push('image debe ser una URL HTTP(S) válida.');
  if (errors.length) throw new Error(errors.join(' '));

  return {
    title: candidate.title.trim(),
    store: candidate.store.trim(),
    currentPrice: candidate.currentPrice,
    ...(candidate.previousPrice !== undefined ? { previousPrice: candidate.previousPrice } : {}),
    sourceUrl: candidate.sourceUrl.trim(),
    ...(candidate.image ? { image: candidate.image.trim() } : {}),
    ...(typeof candidate.seller === 'string' && candidate.seller.trim() ? { seller: candidate.seller.trim() } : {}),
    ...(typeof candidate.coupon === 'string' && candidate.coupon.trim() ? { coupon: candidate.coupon.trim() } : {}),
    ...(typeof candidate.conditions === 'string' && candidate.conditions.trim() ? { conditions: candidate.conditions.trim() } : {}),
    checkedAt: candidate.checkedAt,
    previousPriceVerified: candidate.previousPriceVerified === true,
    demo: candidate.demo === true
  };
}
