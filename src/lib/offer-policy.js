const reservedHosts = new Set([
  'example.com',
  'example.net',
  'example.org',
  'invalid',
  'test'
]);

export function isSafeDemoUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;

  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function isSafeWebUrl(value) {
  if (!isSafeDemoUrl(value)) return false;
  const hostname = new URL(value).hostname.toLowerCase();
  const reservedHost = [...reservedHosts].some((host) => hostname === host || hostname.endsWith(`.${host}`))
    || hostname.endsWith('.example');
  return !reservedHost;
}

export function isSafeOfferImage(value) {
  if (typeof value !== 'string') return false;
  if ((value.startsWith('/') && !value.startsWith('//')) || isSafeWebUrl(value)) return true;
  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(value);
}

export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isProductionOfferEligible(offer, today = new Date().toISOString().slice(0, 10)) {
  if (!offer || typeof offer !== 'object') return false;
  if (offer.availabilityStatus && offer.availabilityStatus !== 'active') return false;
  if (offer.promotionEndDate && (!isCalendarDate(offer.promotionEndDate) || offer.promotionEndDate < today)) return false;
  const promoItemsOffer = Array.isArray(offer.tags) && offer.tags.includes('aliexpress-promo-items');
  const validOriginalUrl = isSafeWebUrl(offer.sourceUrl)
    || (promoItemsOffer && !offer.sourceUrl && isSafeWebUrl(offer.affiliateUrl));
  if (!['verified', 'published'].includes(offer.status)
    || offer.verified !== true
    || offer.demo === true
    || typeof offer.title !== 'string'
    || !offer.title.trim()
    || typeof offer.store !== 'string'
    || !offer.store.trim()
    || typeof offer.category !== 'string'
    || !offer.category.trim()
    || !Number.isFinite(offer.currentPrice)
    || offer.currentPrice <= 0
    || !isCalendarDate(offer.publishedAt)
    || offer.publishedAt > today
    || !validOriginalUrl
    || !Number.isFinite(Date.parse(offer.lastVerifiedAt))
    || Date.parse(offer.lastVerifiedAt) > Date.now()) return false;

  if (offer.expiresAt && (!isCalendarDate(offer.expiresAt) || offer.expiresAt < today)) return false;
  if (offer.affiliateUrl && !isSafeWebUrl(offer.affiliateUrl)) return false;
  if (offer.status === 'published' && !isSafeWebUrl(offer.affiliateUrl)) return false;
  return true;
}
