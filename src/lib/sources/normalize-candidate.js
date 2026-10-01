import { isSafeDemoUrl, isSafeWebUrl } from '../offer-policy.js';
import { calculateDiscount } from '../offer-math.js';

const sourceIds = new Set(['aliexpress', 'awin', 'generic', 'amazon']);

function stableCandidateId(source, productId, sourceUrl) {
  const identity = `${source}:${productId || sourceUrl}`;
  let hash = 2166136261;
  for (const character of identity) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `candidate-${(hash >>> 0).toString(36)}`;
}

function parseAvailability(value) {
  if (value === true || value === false) return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'available', 'in stock', 'instock', 'disponible', 'en stock'].includes(normalized)) return true;
  if (['false', '0', 'no', 'unavailable', 'out of stock', 'outofstock', 'agotado', 'sin stock'].includes(normalized)) return false;
  return undefined;
}

function parseNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !value.trim()) return Number.NaN;
  const normalized = value.trim().replace(/\s/g, '').replace(/[€$£]/g, '');
  if (/^-?\d{1,3}(?:\.\d{3})+,\d+$/.test(normalized)) return Number(normalized.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d+,\d+$/.test(normalized)) return Number(normalized.replace(',', '.'));
  return Number(normalized);
}

export function normalizeCandidate(input, sourceOverride) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('El candidato debe ser un objeto JSON.');
  }

  const candidate = input;
  const source = typeof sourceOverride === 'string' ? sourceOverride : candidate.source;
  const currentPrice = parseNumber(candidate.currentPrice);
  const previousPriceInput = candidate.previousPrice === null || candidate.previousPrice === '' || candidate.previousPrice === undefined
    ? null
    : parseNumber(candidate.previousPrice);
  const previousPriceVerified = candidate.previousPriceVerified === true || candidate.previousPriceVerified === 'true';
  const previousPrice = previousPriceVerified
    && Number.isFinite(previousPriceInput)
    && previousPriceInput > currentPrice
    ? previousPriceInput
    : null;
  const available = parseAvailability(candidate.available);
  const sourceUrl = typeof candidate.sourceUrl === 'string' ? candidate.sourceUrl.trim() : '';
  const checkedAt = typeof candidate.checkedAt === 'string' ? candidate.checkedAt : '';
  const productId = typeof candidate.productId === 'string' && candidate.productId.trim() ? candidate.productId.trim() : undefined;
  const errors = [];

  if (typeof candidate.title !== 'string' || !candidate.title.trim()) errors.push('title debe ser un texto no vacío.');
  if (typeof candidate.store !== 'string' || !candidate.store.trim()) errors.push('store debe ser un texto no vacío.');
  if (typeof candidate.category !== 'string' || !candidate.category.trim()) errors.push('category debe ser un texto no vacío.');
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) errors.push('currentPrice debe ser un número mayor que cero.');
  if (previousPriceInput !== null && (!Number.isFinite(previousPriceInput) || previousPriceInput <= currentPrice)) {
    errors.push('previousPrice debe ser mayor que currentPrice.');
  }
  if (previousPriceVerified && previousPrice === null) errors.push('previousPriceVerified requiere un previousPrice válido y fiable.');
  if (available === undefined) errors.push('available debe indicar explícitamente true o false.');
  if (typeof candidate.currency !== 'string' || !/^[A-Z]{3}$/.test(candidate.currency.trim().toUpperCase())) {
    errors.push('currency debe ser un código de moneda ISO 4217 de tres letras.');
  }
  if (typeof source !== 'string' || !sourceIds.has(source)) errors.push('source debe ser aliexpress, awin, generic o amazon.');
  if (!isSafeWebUrl(sourceUrl) && !(candidate.demo === true && isSafeDemoUrl(sourceUrl))) errors.push('sourceUrl debe ser una URL HTTP(S) válida.');
  if (!checkedAt || !Number.isFinite(Date.parse(checkedAt)) || Date.parse(checkedAt) > Date.now()) {
    errors.push('checkedAt debe contener una fecha válida que no esté en el futuro.');
  }
  if (candidate.conditions !== undefined && typeof candidate.conditions !== 'string') errors.push('conditions debe ser texto.');
  if (typeof candidate.conditions !== 'string' || !candidate.conditions.trim()) errors.push('conditions debe describir las condiciones o indicar «Sin condiciones especiales».');
  if (candidate.image && typeof candidate.image !== 'string') errors.push('image debe ser texto.');
  if (candidate.image && !isSafeWebUrl(candidate.image)) errors.push('image debe ser una URL HTTP(S) válida.');
  if (candidate.affiliateUrl && !isSafeWebUrl(candidate.affiliateUrl)) errors.push('affiliateUrl debe ser una URL HTTP(S) válida.');
  if (candidate.affiliateRequired !== undefined && typeof candidate.affiliateRequired !== 'boolean') errors.push('affiliateRequired debe ser booleano.');
  if (errors.length) throw new Error(errors.join(' '));

  const discount = previousPrice === null
    ? null
    : calculateDiscount(currentPrice, previousPrice, true);
  if (candidate.discount !== undefined && candidate.discount !== null
    && (!Number.isInteger(candidate.discount) || candidate.discount !== discount)) {
    errors.push('discount debe coincidir con los precios anterior y actual verificables.');
  }
  if (errors.length) throw new Error(errors.join(' '));
  const sourceId = source;
  const id = typeof candidate.id === 'string' && candidate.id.trim()
    ? candidate.id.trim()
    : stableCandidateId(sourceId, productId, sourceUrl);

  return {
    id,
    title: candidate.title.trim(),
    store: candidate.store.trim(),
    category: candidate.category.trim(),
    currentPrice,
    previousPrice,
    discount,
    currency: candidate.currency.trim().toUpperCase(),
    sourceUrl,
    ...(candidate.image ? { image: candidate.image.trim() } : {}),
    ...(typeof candidate.seller === 'string' && candidate.seller.trim() ? { seller: candidate.seller.trim() } : {}),
    ...(typeof candidate.coupon === 'string' && candidate.coupon.trim() ? { coupon: candidate.coupon.trim() } : {}),
    conditions: typeof candidate.conditions === 'string' ? candidate.conditions.trim() : '',
    available,
    checkedAt,
    source: sourceId,
    ...(productId ? { productId } : {}),
    ...(typeof candidate.affiliateUrl === 'string' && candidate.affiliateUrl.trim() ? { affiliateUrl: candidate.affiliateUrl.trim() } : {}),
    affiliateRequired: candidate.affiliateRequired === true,
    previousPriceVerified: previousPrice !== null,
    verified: false,
    verificationNotes: [],
    lastVerifiedAt: null,
    expiresAt: typeof candidate.expiresAt === 'string' && candidate.expiresAt ? candidate.expiresAt : null,
    demo: candidate.demo === true,
    ...(Array.isArray(candidate.interestSignals) ? { interestSignals: candidate.interestSignals.filter((item) => typeof item === 'string') } : {}),
    ...(Array.isArray(candidate.demandSignals) ? { demandSignals: candidate.demandSignals.filter((item) => typeof item === 'string') } : {})
  };
}
