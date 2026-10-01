import { isCalendarDate } from './offer-policy.js';

export function expireOffers(offers, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  let expiredCount = 0;
  const updated = offers.map((offer) => {
    if (offer.status === 'expired' || !offer.expiresAt
      || (isCalendarDate(offer.expiresAt) && offer.expiresAt >= today)) return offer;
    expiredCount += 1;
    return { ...offer, status: 'expired' };
  });
  return { offers: updated, expiredCount };
}
