import { isProductionOfferEligible, isSafeWebUrl } from './offer-policy.js';
import { verifyCandidate, verifyOffer } from './offer-verification.js';
import { calculateDiscount, createSlug } from './offer-math.js';

export function createOffer(candidate, editorial = {}) {
  const verification = verifyCandidate(candidate);
  if (!verification.valid) throw new Error(`No se puede crear la oferta: ${verification.errors.join(' ')}`);
  const title = candidate.title.trim();
  const currentPrice = candidate.currentPrice;
  const previousPriceVerified = candidate.previousPriceVerified === true
    && Number.isFinite(candidate.previousPrice)
    && candidate.previousPrice > currentPrice;

  return {
    id: editorial.id || `offer-${crypto.randomUUID()}`,
    title,
    slug: createSlug(editorial.slug || title),
    store: candidate.store.trim(),
    category: editorial.category || '',
    ...(candidate.image ? { image: candidate.image } : {}),
    currentPrice,
    ...(Number.isFinite(candidate.previousPrice) ? { previousPrice: candidate.previousPrice } : {}),
    previousPriceVerified,
    discount: calculateDiscount(currentPrice, candidate.previousPrice, previousPriceVerified),
    coupon: candidate.coupon || '',
    conditions: candidate.conditions || '',
    seller: candidate.seller || '',
    description: editorial.description || '',
    shortDescription: editorial.shortDescription || '',
    sourceUrl: candidate.sourceUrl,
    affiliateUrl: editorial.affiliateUrl || '',
    publishedAt: editorial.publishedAt || new Date().toISOString().slice(0, 10),
    ...(editorial.expiresAt ? { expiresAt: editorial.expiresAt } : {}),
    lastVerifiedAt: '',
    featured: false,
    verified: false,
    demo: candidate.demo === true,
    score: editorial.score ?? 0,
    tags: editorial.tags || [],
    status: 'draft',
    availabilityStatus: 'draft',
    promotionEndDate: editorial.promotionEndDate || null,
    subcategory: editorial.subcategory || '',
    featuredToday: false
  };
}

export function publishOffer(offer, now = new Date()) {
  if (offer.demo === true) throw new Error('Una oferta DEMO no se puede publicar.');
  if (offer.status === 'expired' || (offer.expiresAt && offer.expiresAt < now.toISOString().slice(0, 10))) {
    throw new Error('La oferta está caducada y no se puede publicar.');
  }
  if (offer.status !== 'verified') throw new Error('La oferta debe estar en estado verificado antes de publicarse.');
  const verification = verifyOffer(offer, now);
  if (offer.verified !== true || !verification.valid) {
    throw new Error(`La oferta no está verificada: ${verification.errors.join(' ') || 'marca la oferta como verificada primero.'}`);
  }
  if (!isSafeWebUrl(offer.affiliateUrl)) throw new Error('Para publicar, añade el enlace afiliado completo y real de esta oferta.');
  const published = { ...offer, status: 'published', availabilityStatus: offer.availabilityStatus || 'active' };
  if (!isProductionOfferEligible(published, now.toISOString().slice(0, 10))) {
    throw new Error('La oferta no cumple los requisitos de publicación o está caducada.');
  }
  return published;
}
