import { isSafeWebUrl } from './offer-policy.js';

export function scoreCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new Error('El candidato debe ser un objeto.');

  let score = 0;
  if (typeof candidate.title === 'string' && candidate.title.trim()) score += 15;
  if (typeof candidate.store === 'string' && candidate.store.trim()) score += 10;
  if (Number.isFinite(candidate.currentPrice) && candidate.currentPrice > 0) score += 20;
  if (isSafeWebUrl(candidate.sourceUrl)) score += 20;
  if (candidate.checkedAt && Number.isFinite(Date.parse(candidate.checkedAt)) && Date.parse(candidate.checkedAt) <= Date.now()) score += 15;
  if (candidate.previousPriceVerified === true
    && Number.isFinite(candidate.previousPrice)
    && candidate.previousPrice > candidate.currentPrice) score += 10;
  if (typeof candidate.conditions === 'string' && candidate.conditions.trim()) score += 5;
  if (typeof candidate.seller === 'string' && candidate.seller.trim()) score += 5;
  return score;
}
