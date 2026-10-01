export function appendCandidateHistory(history, candidates, status, checkedAt = new Date().toISOString()) {
  const entries = candidates.map((candidate) => ({
    id: candidate.id,
    date: checkedAt,
    source: candidate.source,
    product: candidate.title,
    price: candidate.currentPrice,
    currency: candidate.currency,
    status
  }));
  return [...history, ...entries].slice(-500);
}

export function appendCandidateSearchHistory(history, source, status, checkedAt = new Date().toISOString()) {
  return [...history, {
    id: `search-${Date.parse(checkedAt)}-${source}`,
    date: checkedAt,
    source,
    product: '',
    price: null,
    currency: '',
    status
  }].slice(-500);
}
