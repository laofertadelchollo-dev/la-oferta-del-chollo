import { isCalendarDate } from './offer-policy.js';

export const AVAILABILITY_STATES = [
  'draft',
  'active',
  'price_update',
  'promotion_expired',
  'out_of_stock',
  'unavailable',
  'archived'
];

export const OFFER_CATEGORIES = [
  { slug: 'electronica', label: 'Electrónica' },
  { slug: 'hogar', label: 'Hogar' },
  { slug: 'moda', label: 'Moda' },
  { slug: 'gaming', label: 'Gaming' },
  { slug: 'deporte', label: 'Deporte' },
  { slug: 'automovil', label: 'Automóvil' },
  { slug: 'mascotas', label: 'Mascotas' },
  { slug: 'belleza', label: 'Belleza' },
  { slug: 'herramientas', label: 'Herramientas' },
  { slug: 'accesorios-moviles', label: 'Accesorios móviles' },
  { slug: 'otros', label: 'Otros' },
  { slug: 'tecnologia', label: 'Tecnología (catálogo anterior)' },
  { slug: 'cocina', label: 'Cocina (catálogo anterior)' }
];

export const AVAILABILITY_LABELS = {
  draft: 'Borrador',
  active: 'Activa',
  price_update: 'Actualizar',
  promotion_expired: 'Promoción caducada',
  out_of_stock: 'Sin existencias',
  unavailable: 'No disponible',
  archived: 'Archivada'
};

export function parseAliExpressPromotionEndDate(text) {
  if (typeof text !== 'string') return null;
  const pattern = /(?:oferta\s+v[aá]lida\s+hasta|v[aá]lido\s+hasta|promoci[oó]n\s+hasta|promotion\s+(?:valid\s+)?until|valid\s+until)\s*[:\-]?\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i;
  const match = text.match(pattern);
  if (!match) return null;
  const [, day, month, year] = match;
  const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isCalendarDate(isoDate) ? isoDate : null;
}

export function getAvailabilityState(offer, today = new Date().toISOString().slice(0, 10)) {
  if (AVAILABILITY_STATES.includes(offer?.availabilityStatus)) {
    const current = offer.availabilityStatus;
    if (current === 'active' || current === 'price_update') {
      if (offer.promotionEndDate && isCalendarDate(offer.promotionEndDate) && offer.promotionEndDate < today) {
        return 'promotion_expired';
      }
      if (current === 'active' && offer.status === 'expired') return 'promotion_expired';
    }
    return current;
  }
  if (offer?.status === 'draft') return 'draft';
  if (offer?.status === 'expired') return 'promotion_expired';
  if (offer?.promotionEndDate && isCalendarDate(offer.promotionEndDate) && offer.promotionEndDate < today) {
    return 'promotion_expired';
  }
  if (offer?.status === 'verified' || offer?.status === 'published') return 'active';
  return 'draft';
}

export function getOffersNeedingReview(offers, {
  now = new Date(),
  staleAfterDays = 14,
  upcomingWithinDays = 3
} = {}) {
  const currentTime = now.getTime();
  const today = now.toISOString().slice(0, 10);
  const upcomingLimit = new Date(currentTime + upcomingWithinDays * 86400000).toISOString().slice(0, 10);
  return offers.filter((offer) => {
    const state = getAvailabilityState(offer, today);
    if (['promotion_expired', 'price_update', 'out_of_stock', 'unavailable'].includes(state)) return true;
    if (offer.promotionEndDate && isCalendarDate(offer.promotionEndDate)
      && offer.promotionEndDate >= today && offer.promotionEndDate <= upcomingLimit) return true;
    if (state !== 'active') return false;
    const checkedAt = offer.lastCheckedAt || offer.lastVerifiedAt;
    if (!checkedAt || !Number.isFinite(Date.parse(checkedAt))) return true;
    return currentTime - Date.parse(checkedAt) >= staleAfterDays * 86400000;
  });
}

export function recordOfferPriceChange(offer, currentPrice, currency = offer.currency || 'EUR', checkedAt = new Date().toISOString()) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) throw new Error('El precio debe ser mayor que cero.');
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new Error('Indica una moneda ISO 4217 válida.');
  const previousCurrency = offer.currency || 'EUR';
  const priceHistory = Array.isArray(offer.priceHistory) ? [...offer.priceHistory] : [];
  const changed = Number.isFinite(offer.currentPrice)
    && offer.currentPrice > 0
    && (offer.currentPrice !== currentPrice || previousCurrency !== currency);
  if (changed) {
    priceHistory.push({ checkedAt, price: offer.currentPrice, currency: previousCurrency });
    priceHistory.push({ checkedAt, price: currentPrice, currency });
  }
  return {
    ...offer,
    currentPrice,
    currency,
    lastCheckedAt: checkedAt,
    ...(changed ? { priceHistory: priceHistory.slice(-50) } : offer.priceHistory ? { priceHistory } : {})
  };
}

export function filterAndSortOffers(offers, filters = {}, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const filtered = offers.filter((offer) => {
    const state = getAvailabilityState(offer, today);
    if (filters.state && filters.state !== 'all' && state !== filters.state) return false;
    if (filters.category && filters.category !== 'all' && offer.category !== filters.category) return false;
    if (filters.subcategory && filters.subcategory !== 'all'
      && !String(offer.subcategory || '').toLocaleLowerCase('es-ES').includes(filters.subcategory.toLocaleLowerCase('es-ES'))) return false;
    if (filters.featuredToday && offer.featuredToday !== true) return false;
    if (filters.featured && offer.featured !== true) return false;
    if (filters.promotionDate && filters.promotionDate !== 'all') {
      const ended = Boolean(offer.promotionEndDate && isCalendarDate(offer.promotionEndDate) && offer.promotionEndDate < today);
      const upcomingLimit = filters.promotionDate === 'upcoming'
        ? new Date(now.getTime() + 3 * 86400000).toISOString().slice(0, 10)
        : filters.promotionDate;
      const upcoming = Boolean(offer.promotionEndDate && isCalendarDate(offer.promotionEndDate)
        && offer.promotionEndDate >= today && offer.promotionEndDate <= upcomingLimit);
      if (filters.promotionDate === 'expired' && !ended) return false;
      if (filters.promotionDate === 'upcoming' && !upcoming) return false;
      if (filters.promotionDate === 'dated' && !offer.promotionEndDate) return false;
      if (filters.promotionDate === 'undated' && offer.promotionEndDate) return false;
    }
    if (filters.needsUpdate && !getOffersNeedingReview([offer], { now }).length) return false;
    if (filters.query) {
      const query = filters.query.toLocaleLowerCase('es-ES').trim();
      const searchable = [offer.title, offer.category, offer.subcategory, ...(offer.tags || [])]
        .filter(Boolean).join(' ').toLocaleLowerCase('es-ES');
      if (!searchable.includes(query)) return false;
    }
    return true;
  });

  const sort = filters.sort || 'recent';
  const categoryLabel = (offer) => OFFER_CATEGORIES.find(({ slug }) => slug === offer.category)?.label || offer.category || '';
  return filtered.sort((left, right) => {
    if (sort === 'price') return (left.currentPrice || 0) - (right.currentPrice || 0);
    if (sort === 'checked') return Date.parse(right.lastCheckedAt || right.lastVerifiedAt || 0) - Date.parse(left.lastCheckedAt || left.lastVerifiedAt || 0);
    if (sort === 'promotion') return Date.parse(left.promotionEndDate || '9999-12-31') - Date.parse(right.promotionEndDate || '9999-12-31');
    if (sort === 'category') return categoryLabel(left).localeCompare(categoryLabel(right), 'es');
    return String(right.publishedAt || '').localeCompare(String(left.publishedAt || ''));
  });
}
