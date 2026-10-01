import { isCalendarDate, isProductionOfferEligible, isSafeDemoUrl, isSafeWebUrl } from './offer-policy.js';
import { calculateDiscount } from './offer-math.js';

const statuses = new Set(['draft', 'verified', 'published', 'expired']);
const requiredFields = [
  'id', 'title', 'slug', 'store', 'category', 'currentPrice', 'coupon', 'conditions',
  'seller', 'description', 'shortDescription', 'sourceUrl', 'affiliateUrl', 'publishedAt',
  'discount', 'featured', 'verified', 'score', 'tags', 'demo', 'status'
];
const textFields = [
  'id', 'title', 'slug', 'store', 'category', 'coupon', 'conditions', 'seller',
  'description', 'shortDescription', 'sourceUrl', 'affiliateUrl', 'publishedAt'
];

export function validateOfferList(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('El JSON debe ser un array con al menos una oferta.');

  const errors = [];
  value.forEach((item, index) => {
    const label = `Oferta ${index + 1}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${label}: debe ser un objeto.`);
      return;
    }
    for (const field of requiredFields) {
      if (!(field in item)) errors.push(`${label}: falta el campo obligatorio «${field}».`);
    }
    for (const field of textFields) {
      if (typeof item[field] !== 'string') errors.push(`${label}: «${field}» debe ser texto.`);
    }
    if (!Number.isFinite(item.currentPrice) || item.currentPrice <= 0) errors.push(`${label}: «currentPrice» debe ser mayor que cero.`);
    if (item.previousPrice !== undefined && (!Number.isFinite(item.previousPrice) || item.previousPrice <= item.currentPrice)) {
      errors.push(`${label}: «previousPrice» debe ser mayor que «currentPrice».`);
    }
    if (item.discount !== undefined && (!Number.isFinite(item.discount) || item.discount < 0 || item.discount > 100)) {
      errors.push(`${label}: «discount» debe ser un porcentaje entre 0 y 100.`);
    }
    if (Number.isFinite(item.currentPrice) && Number.isFinite(item.discount)) {
      const expectedDiscount = calculateDiscount(item.currentPrice, item.previousPrice, item.previousPriceVerified === true);
      if (item.discount !== expectedDiscount) errors.push(`${label}: «discount» no coincide con los precios verificados.`);
    }
    if (typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < 0) errors.push(`${label}: «score» debe ser un número igual o mayor que cero.`);
    for (const field of ['featured', 'verified', 'demo']) {
      if (typeof item[field] !== 'boolean') errors.push(`${label}: «${field}» debe ser booleano.`);
    }
    if (!Array.isArray(item.tags) || !item.tags.every((tag) => typeof tag === 'string')) errors.push(`${label}: «tags» debe ser un array de textos.`);
    if (typeof item.status !== 'string' || !statuses.has(item.status)) errors.push(`${label}: estado desconocido; usa draft, verified, published o expired.`);
    if (typeof item.publishedAt === 'string' && !isCalendarDate(item.publishedAt)) errors.push(`${label}: «publishedAt» no es una fecha válida (AAAA-MM-DD).`);
    if (item.expiresAt !== undefined && item.expiresAt !== '' && !isCalendarDate(item.expiresAt)) errors.push(`${label}: «expiresAt» no es una fecha válida (AAAA-MM-DD).`);
    if (item.lastVerifiedAt !== undefined && item.lastVerifiedAt !== '' && !Number.isFinite(Date.parse(item.lastVerifiedAt))) {
      errors.push(`${label}: «lastVerifiedAt» no es una fecha válida.`);
    }
    for (const field of ['sourceUrl', 'affiliateUrl']) {
      const validUrl = isSafeWebUrl(item[field]) || (item.demo === true && field === 'sourceUrl' && isSafeDemoUrl(item[field]));
      if (typeof item[field] === 'string' && item[field] && !validUrl) errors.push(`${label}: «${field}» debe ser una URL HTTP(S) real.`);
    }
    if (item.image !== undefined && (typeof item.image !== 'string' || (item.image !== '' && !((item.image.startsWith('/') && !item.image.startsWith('//')) || isSafeWebUrl(item.image))))) {
      errors.push(`${label}: «image» debe ser una ruta local o URL HTTP(S).`);
    }
    if (item.previousPriceVerified !== undefined && typeof item.previousPriceVerified !== 'boolean') errors.push(`${label}: «previousPriceVerified» debe ser booleano.`);
    if (item.demo === true && item.status !== 'draft' && item.status !== 'expired') errors.push(`${label}: una oferta DEMO solo puede estar en draft o expired.`);
    if ((item.status === 'verified' || item.status === 'published') && !isProductionOfferEligible(item)) {
      errors.push(`${label}: el estado ${item.status} no cumple los requisitos de verificación/publicación.`);
    }
  });

  if (value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
    const ids = value.map((item) => item.id);
    const slugs = value.map((item) => item.slug);
    if (new Set(ids).size !== ids.length) errors.push('El JSON contiene identificadores duplicados.');
    const nonEmptySlugs = slugs.filter((slug) => typeof slug === 'string' && slug);
    if (new Set(nonEmptySlugs).size !== nonEmptySlugs.length) errors.push('El JSON contiene slugs duplicados.');
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return value;
}

export function parseOfferJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON inválido: ${error instanceof Error ? error.message : 'no se pudo analizar el contenido.'}`);
  }
  return validateOfferList(parsed);
}

export function migrateStoredOfferList(value) {
  if (!Array.isArray(value)) return validateOfferList(value);
  const migrated = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return {
      ...item,
      discount: typeof item.discount === 'number'
        ? item.discount
        : calculateDiscount(item.currentPrice, item.previousPrice, item.previousPriceVerified === true),
      featured: typeof item.featured === 'boolean' ? item.featured : false,
      verified: typeof item.verified === 'boolean' ? item.verified : false,
      demo: typeof item.demo === 'boolean' ? item.demo : false,
      score: typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 0,
      coupon: typeof item.coupon === 'string' ? item.coupon : '',
      conditions: typeof item.conditions === 'string' ? item.conditions : '',
      seller: typeof item.seller === 'string' ? item.seller : '',
      affiliateUrl: typeof item.affiliateUrl === 'string' ? item.affiliateUrl : ''
    };
  });
  return validateOfferList(migrated);
}
