import { createSlug } from './offer-math.js';
import { isSafeWebUrl } from './offer-policy.js';
import { parseAliExpressPromotionEndDate } from './offer-lifecycle.js';

const pricePattern = /(?:(EUR|USD|GBP|CNY|JPY|CAD|AUD|CHF|PLN|BRL)\s*)?([€$£])?\s*((?:\d{1,3}(?:[.,\s\u00a0]\d{3})+|\d+)(?:[.,]\d{1,2})?)\s*([€$£])?\s*(EUR|USD|GBP|CNY|JPY|CAD|AUD|CHF|PLN|BRL)?/i;
const promoHeading = /mejores recomendaciones de productos|recomendaciones de productos en oferta|promotional material|material promocional|promo items|^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{P}\s]*(?:oferta|promo(?:ción)?|promocional)\b/iu;

function parseNumericPrice(value) {
  let numeric = value.replace(/[\s\u00a0]/g, '');
  const comma = numeric.lastIndexOf(',');
  const dot = numeric.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    numeric = numeric.replaceAll(thousandsSeparator, '').replace(decimalSeparator, '.');
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? ',' : '.';
    const trailingDigits = numeric.length - numeric.lastIndexOf(separator) - 1;
    numeric = trailingDigits === 3
      ? numeric.replaceAll(separator, '')
      : numeric.replace(separator, '.');
  }
  const price = Number(numeric);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function parseAliExpressPrice(value) {
  const text = String(value ?? '').trim().replace(/[€$£]/g, '').replace(/\b(?:EUR|USD|GBP|CNY|JPY|CAD|AUD|CHF|PLN|BRL)\b/gi, '').trim();
  return text ? parseNumericPrice(text) : null;
}

function currencyFromMatch(match) {
  const code = (match[1] || match[5] || '').toUpperCase();
  if (code) return code;
  const symbol = match[2] || match[4];
  return symbol === '€' ? 'EUR' : symbol === '£' ? 'GBP' : symbol === '$' ? 'USD' : '';
}

function readLabeledValue(lines, pattern) {
  const line = lines.find((candidate) => pattern.test(candidate));
  if (!line) return '';
  return line.replace(pattern, '').replace(/^[\s:：=\-]+/, '').trim();
}

function extractAffiliateUrl(text) {
  const matches = text.match(/https?:\/\/[^\s<>"\]]+/gi) || [];
  const candidate = matches
    .map((value) => value.replace(/[),.!?;:]+$/, ''))
    .find((value) => {
      try {
        const url = new URL(value);
        return url.hostname.toLowerCase() === 's.click.aliexpress.com'
          || url.hostname.toLowerCase().endsWith('.aliexpress.com');
      } catch {
        return false;
      }
    });
  return candidate || '';
}

function extractTitle(lines) {
  const titleLines = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || promoHeading.test(line)) continue;
    if ((/(?:ahora\s+)?precio|price(?:\s+now)?|now\s+price/i.test(line) && pricePattern.test(line))
      || (pricePattern.test(line) && /(?:EUR|USD|GBP|CNY|JPY|CAD|AUD|CHF|PLN|BRL|[€$£])/i.test(line))) break;
    if (/https?:\/\//i.test(line)
      || /(?:tracking\s*id|track\s*id|id\s*de\s*rastreo|idioma|language)\s*[:：=]/i.test(line)) break;
    titleLines.push(line.replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s•*#-]+/u, '').trim());
  }
  return titleLines.filter(Boolean).join(' ').trim();
}

export function parseAliExpressPromoItems(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Pega el material promocional de AliExpress.');
  }
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const priceLine = lines.find((line) =>
    /(?:ahora\s+)?precio|price(?:\s+now)?|now\s+price/i.test(line) && pricePattern.test(line))
    || lines.find((line) => pricePattern.test(line) && /(?:EUR|USD|GBP|CNY|JPY|CAD|AUD|CHF|PLN|BRL|[€$£])/i.test(line));
  const priceMatch = priceLine?.match(pricePattern);
  const affiliateUrl = extractAffiliateUrl(normalized);

  return {
    title: extractTitle(lines),
    currentPrice: priceMatch ? parseNumericPrice(priceMatch[3]) : null,
    currency: priceMatch ? currencyFromMatch(priceMatch) : '',
    affiliateUrl,
    trackingId: readLabeledValue(lines, /^(?:tracking\s*id|track\s*id|id\s*de\s*rastreo)\b/i),
    language: readLabeledValue(lines, /^(?:language|idioma)\b/i),
    promotionEndDate: parseAliExpressPromotionEndDate(normalized)
  };
}

export function validateAliExpressPromoDraft(input) {
  const errors = [];
  if (typeof input.title !== 'string' || !input.title.trim()) errors.push('Falta el título.');
  if (typeof input.title === 'string' && input.title.trim().length > 180) errors.push('El título no puede superar los 180 caracteres.');
  if (input.currentPrice !== null && input.currentPrice !== undefined
    && (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0)) errors.push('El precio no es válido.');
  if (input.currentPrice !== null && input.currentPrice !== undefined
    && (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency))) {
    errors.push('Indica una moneda ISO 4217 válida.');
  }
  if (input.sourceUrl && !isSafeWebUrl(input.sourceUrl)) errors.push('La URL original debe ser una dirección HTTP(S) válida.');
  if (input.affiliateUrl && !isSafeWebUrl(input.affiliateUrl)) errors.push('El enlace afiliado debe ser una URL HTTP(S) válida.');
  if (input.images !== undefined && (!Array.isArray(input.images) || input.images.length > 6)) {
    errors.push('Puedes asociar entre 0 y 6 imágenes.');
  }
  if (Array.isArray(input.images) && input.images.length > 0
    && input.images.some((image) => !image || typeof image.url !== 'string' || !image.url.startsWith('data:image/webp;base64,'))) {
    errors.push('Las imágenes deben ser archivos JPG, PNG o WEBP válidos.');
  }
  if (input.demo === true) errors.push('Las ofertas DEMO no pueden guardarse como ofertas reales.');
  return { valid: errors.length === 0, errors };
}

function normalizedTitle(title) {
  return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizedUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  } catch {
    return '';
  }
}

export function findAliExpressPromoDuplicate(draft, existingOffers = []) {
  const urls = [draft.affiliateUrl, draft.sourceUrl].map(normalizedUrl).filter(Boolean);
  if (urls.length) {
    return existingOffers.find((offer) =>
      [offer.affiliateUrl, offer.sourceUrl].some((url) => urls.includes(normalizedUrl(url)))
    ) || null;
  }
  const title = normalizedTitle(draft.title || '');
  return title ? existingOffers.find((offer) => normalizedTitle(offer.title || '') === title) || null : null;
}

export function createAliExpressPromoDraft(input, { existingOffers = [] } = {}) {
  const price = input.currentPrice === '' || input.currentPrice === undefined ? null : input.currentPrice;
  const draftInput = { ...input, currentPrice: price };
  const validation = validateAliExpressPromoDraft(draftInput);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const title = input.title.trim();
  const images = (input.images || []).map((image, order) => ({
    ...image,
    isPrimary: order === 0,
    order
  }));
  const primaryImage = images.find((image) => image.isPrimary);
  const draft = {
    id: `offer-${crypto.randomUUID()}`,
    title,
    slug: createSlug(title),
    store: 'AliExpress',
    category: String(input.category || ''),
    ...(primaryImage ? { image: primaryImage.url } : {}),
    ...(images.length ? { images } : {}),
    currentPrice: price ?? 0,
    ...(input.currency ? { currency: String(input.currency).toUpperCase() } : {}),
    previousPriceVerified: false,
    discount: null,
    coupon: String(input.coupon || '').trim(),
    conditions: String(input.conditions || '').trim(),
    seller: String(input.seller || '').trim(),
    description: `Borrador editorial de «${title}». Revisa sus características, precio y condiciones antes de publicar.`,
    shortDescription: `Oferta de AliExpress pendiente de verificación: ${title}.`,
    sourceUrl: String(input.sourceUrl || '').trim(),
    affiliateUrl: String(input.affiliateUrl || '').trim(),
    ...(input.trackingId ? { trackingId: String(input.trackingId).trim() } : {}),
    ...(input.language ? { promoLanguage: String(input.language).trim() } : {}),
    promotionEndDate: input.promotionEndDate || null,
    availabilityStatus: 'draft',
    featuredToday: false,
    publishedAt: new Date().toISOString().slice(0, 10),
    status: 'draft',
    featured: false,
    verified: false,
    demo: false,
    score: 0,
    tags: ['aliexpress-promo-items']
  };
  const duplicate = findAliExpressPromoDuplicate(draft, existingOffers);
  if (duplicate) throw new Error('Este producto parece estar ya importado.');
  return draft;
}
