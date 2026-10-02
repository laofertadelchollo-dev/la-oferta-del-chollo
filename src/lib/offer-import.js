import { isCalendarDate, isProductionOfferEligible, isSafeDemoUrl, isSafeOfferImage, isSafeWebUrl } from './offer-policy.js';
import { calculateDiscount } from './offer-math.js';
import { AVAILABILITY_STATES } from './offer-lifecycle.js';

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
    const incompleteDraftPrice = item.status === 'draft' && item.currentPrice === 0;
    if (!Number.isFinite(item.currentPrice) || item.currentPrice < 0 || (item.currentPrice === 0 && !incompleteDraftPrice)) {
      errors.push(`${label}: «currentPrice» debe ser mayor que cero, salvo en un borrador pendiente.`);
    }
    if (item.previousPrice !== undefined && (!Number.isFinite(item.previousPrice) || item.previousPrice <= item.currentPrice)) {
      errors.push(`${label}: «previousPrice» debe ser mayor que «currentPrice».`);
    }
    if (item.discount !== undefined && item.discount !== null && (!Number.isFinite(item.discount) || item.discount < 0 || item.discount > 100)) {
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
    if (item.promotionEndDate !== undefined && item.promotionEndDate !== null && item.promotionEndDate !== ''
      && !isCalendarDate(item.promotionEndDate)) errors.push(`${label}: «promotionEndDate» no es una fecha válida (AAAA-MM-DD).`);
    if (item.lastCheckedAt !== undefined && item.lastCheckedAt !== '' && !Number.isFinite(Date.parse(item.lastCheckedAt))) {
      errors.push(`${label}: «lastCheckedAt» no es una fecha válida.`);
    }
    if (item.availabilityStatus !== undefined && !AVAILABILITY_STATES.includes(item.availabilityStatus)) {
      errors.push(`${label}: «availabilityStatus» no es válido.`);
    }
    if (item.subcategory !== undefined && typeof item.subcategory !== 'string') errors.push(`${label}: «subcategory» debe ser texto.`);
    if (item.featuredToday !== undefined && typeof item.featuredToday !== 'boolean') errors.push(`${label}: «featuredToday» debe ser booleano.`);
    if (item.priceHistory !== undefined && (!Array.isArray(item.priceHistory) || !item.priceHistory.every((entry) =>
      entry && Number.isFinite(entry.price) && entry.price > 0
      && typeof entry.currency === 'string' && /^[A-Z]{3}$/.test(entry.currency)
      && Number.isFinite(Date.parse(entry.checkedAt))))) {
      errors.push(`${label}: «priceHistory» debe contener fechas, precios y monedas válidos.`);
    }
    if (item.lastVerifiedAt !== undefined && item.lastVerifiedAt !== '' && !Number.isFinite(Date.parse(item.lastVerifiedAt))) {
      errors.push(`${label}: «lastVerifiedAt» no es una fecha válida.`);
    }
    for (const field of ['sourceUrl', 'affiliateUrl']) {
      const validUrl = isSafeWebUrl(item[field]) || (item.demo === true && field === 'sourceUrl' && isSafeDemoUrl(item[field]));
      if (typeof item[field] === 'string' && item[field] && !validUrl) errors.push(`${label}: «${field}» debe ser una URL HTTP(S) real.`);
    }
    if (item.image !== undefined && (typeof item.image !== 'string' || (item.image !== '' && !isSafeOfferImage(item.image)))) {
      errors.push(`${label}: «image» debe ser una ruta local o URL HTTP(S).`);
    }
    if (item.currency !== undefined && (typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency))) {
      errors.push(`${label}: «currency» debe ser un código ISO 4217 de tres letras.`);
    }
    if (item.images !== undefined) {
      if (!Array.isArray(item.images) || item.images.length > 6) {
        errors.push(`${label}: «images» debe ser un array de hasta seis imágenes.`);
      } else {
        item.images.forEach((image, imageIndex) => {
          if (!image || typeof image !== 'object' || !isSafeOfferImage(image.url)
            || typeof image.isPrimary !== 'boolean' || !Number.isInteger(image.order) || image.order < 0) {
            errors.push(`${label}: la imagen ${imageIndex + 1} no tiene una URL, orden o imagen principal válidos.`);
          }
        });
        if (item.images.length && item.images.filter((image) => image?.isPrimary === true).length !== 1) {
          errors.push(`${label}: «images» debe tener exactamente una imagen principal.`);
        }
      }
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
      discount: item.discount === null ? null : typeof item.discount === 'number'
        ? item.discount
        : calculateDiscount(item.currentPrice, item.previousPrice, item.previousPriceVerified === true),
      featured: typeof item.featured === 'boolean' ? item.featured : false,
      verified: typeof item.verified === 'boolean' ? item.verified : false,
      demo: typeof item.demo === 'boolean' ? item.demo : false,
      score: typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 0,
      coupon: typeof item.coupon === 'string' ? item.coupon : '',
      conditions: typeof item.conditions === 'string' ? item.conditions : '',
      seller: typeof item.seller === 'string' ? item.seller : '',
      affiliateUrl: typeof item.affiliateUrl === 'string' ? item.affiliateUrl : '',
      currency: typeof item.currency === 'string' ? item.currency : 'EUR',
      subcategory: typeof item.subcategory === 'string' ? item.subcategory : '',
      availabilityStatus: AVAILABILITY_STATES.includes(item.availabilityStatus) ? item.availabilityStatus
        : item.status === 'expired' ? 'promotion_expired'
          : item.status === 'published' || item.status === 'verified' ? 'active' : 'draft',
      promotionEndDate: typeof item.promotionEndDate === 'string' && item.promotionEndDate ? item.promotionEndDate : null,
      lastCheckedAt: typeof item.lastCheckedAt === 'string' ? item.lastCheckedAt : '',
      featuredToday: typeof item.featuredToday === 'boolean' ? item.featuredToday : false,
      priceHistory: Array.isArray(item.priceHistory) ? item.priceHistory : []
    };
  });
  return validateOfferList(migrated);
}
