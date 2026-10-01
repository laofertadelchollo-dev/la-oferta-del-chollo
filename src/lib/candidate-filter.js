import { verifyCandidate } from './offer-verification.js';
import { scoreCandidate } from './offer-scoring.js';
import { isSafeWebUrl } from './offer-policy.js';

export const DEFAULT_CANDIDATE_FILTERS = Object.freeze({
  minScore: 70,
  minDiscount: 20,
  maxPrice: null,
  categories: []
});

export function normalizeCandidateTitle(title) {
  return typeof title === 'string'
    ? title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : '';
}

function normalizedProductUrl(value) {
  if (!isSafeWebUrl(value)) return '';
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '').toLowerCase();
  return url.toString().replace(/\/$/, '');
}

export function findDuplicateCandidate(candidate, existing = []) {
  const productId = typeof candidate.productId === 'string' ? candidate.productId.trim().toLowerCase() : '';
  const title = normalizeCandidateTitle(candidate.title);
  const url = normalizedProductUrl(candidate.sourceUrl);
  return existing.find((item) => {
    const other = item?.candidate || item;
    if (!other || typeof other !== 'object') return false;
    const sameProductId = productId && other.productId
      && candidate.source === other.source
      && productId === String(other.productId).trim().toLowerCase();
    const sameUrl = url && normalizedProductUrl(other.sourceUrl) === url;
    const sameTitle = title && normalizeCandidateTitle(other.title) === title;
    return Boolean(sameProductId || sameUrl || sameTitle);
  });
}

export function filterCandidates(candidates, {
  existingCandidates = [],
  existingOffers = [],
  now = new Date()
} = {}) {
  const accepted = [];
  const rejected = [];
  const seen = [...existingCandidates, ...existingOffers];

  for (const candidate of candidates) {
    let reason = '';
    if (candidate.demo === true) reason = 'Candidato DEMO; queda fuera de la selección de producción.';
    else if (candidate.available !== true) reason = 'Producto agotado o disponibilidad no confirmada.';
    else if (!isSafeWebUrl(candidate.sourceUrl)) reason = 'URL de producto inválida.';
    else if (!Number.isFinite(candidate.currentPrice) || candidate.currentPrice <= 0) reason = 'Precio actual ausente o inválido.';
    else if (candidate.affiliateRequired === true && !isSafeWebUrl(candidate.affiliateUrl)) reason = 'La fuente requiere enlace afiliado y no se ha proporcionado.';
    else if (typeof candidate.conditions !== 'string' || !candidate.conditions.trim()) reason = 'Condiciones no claras.';
    else if (candidate.previousPriceVerified !== true || !Number.isFinite(candidate.previousPrice)
      || candidate.previousPrice <= candidate.currentPrice || !Number.isFinite(candidate.discount)) {
      reason = 'No hay un descuento verificable a partir de un precio anterior fiable.';
    } else if (findDuplicateCandidate(candidate, seen)) reason = 'Producto duplicado por URL, ID de producto o título normalizado.';

    if (!reason) {
      const verification = verifyCandidate(candidate, now);
      if (!verification.valid) reason = verification.errors.join(' ');
    }

    if (reason) rejected.push({ candidate, reason });
    else {
      accepted.push(candidate);
      seen.push(candidate);
    }
  }
  return { accepted, rejected };
}

export function selectTopCandidates(candidates, filters = {}, now = new Date()) {
  const settings = { ...DEFAULT_CANDIDATE_FILTERS, ...filters };
  const minimumScore = Number.isFinite(Number(settings.minScore)) ? Number(settings.minScore) : DEFAULT_CANDIDATE_FILTERS.minScore;
  const minimumDiscount = Number.isFinite(Number(settings.minDiscount)) ? Number(settings.minDiscount) : DEFAULT_CANDIDATE_FILTERS.minDiscount;
  const maximumPrice = settings.maxPrice === null || settings.maxPrice === '' || settings.maxPrice === undefined
    ? null
    : Number(settings.maxPrice);
  const categories = Array.isArray(settings.categories) ? settings.categories.map((item) => String(item).toLowerCase()) : [];

  return candidates.map((candidate) => ({ candidate, result: scoreCandidate(candidate, now) }))
    .filter(({ candidate, result }) => candidate.demo !== true
      && result.score >= minimumScore
      && candidate.discount >= minimumDiscount
      && (maximumPrice === null || candidate.currentPrice <= maximumPrice)
      && (!categories.length || categories.includes(candidate.category.toLowerCase())))
    .sort((left, right) => right.result.score - left.result.score || left.candidate.currentPrice - right.candidate.currentPrice);
}
