export function calculateDiscount(currentPrice, previousPrice, previousPriceVerified = false) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0
    || !previousPriceVerified
    || !Number.isFinite(previousPrice)
    || !previousPrice
    || previousPrice <= currentPrice) return 0;
  return Math.round(((previousPrice - currentPrice) / previousPrice) * 100);
}

export function createSlug(value) {
  return value
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
