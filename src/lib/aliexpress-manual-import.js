import { calculateDiscount, createSlug } from './offer-math.js';
import { isSafeWebUrl } from './offer-policy.js';

const allowedColumns = new Set([
  'title', 'sourceUrl', 'affiliateUrl', 'currentPrice', 'previousPrice',
  'coupon', 'category', 'seller', 'image'
]);

function parsePrice(value, label, optional = true) {
  const text = String(value ?? '').trim();
  if (!text) {
    if (optional) return undefined;
    throw new Error(`${label}: indica un precio.`);
  }
  const numeric = text.replace(/\s|[€$£]/g, '');
  const normalized = numeric.includes(',') && numeric.includes('.')
    ? numeric.replace(/\./g, '').replace(',', '.')
    : numeric.replace(',', '.');
  const price = Number(normalized);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`${label}: debe ser un precio mayor que cero.`);
  return price;
}

function normalizeTitle(title) {
  return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  } catch {
    return '';
  }
}

function isDuplicate(draft, existingOffers) {
  const sourceUrl = normalizeUrl(draft.sourceUrl);
  if (sourceUrl && existingOffers.some((offer) => normalizeUrl(offer.sourceUrl) === sourceUrl && normalizeUrl(offer.sourceUrl))) return true;
  if (!sourceUrl) {
    const title = normalizeTitle(draft.title);
    return Boolean(title && existingOffers.some((offer) => normalizeTitle(offer.title || '') === title));
  }
  return false;
}

export function createAliExpressDraft(input, { existingOffers = [], categories = [] } = {}) {
  const title = String(input.title ?? '').trim();
  if (!title) throw new Error('Indica el nombre del producto.');
  if (title.length > 180) throw new Error('El nombre no puede superar los 180 caracteres.');

  const sourceUrl = String(input.sourceUrl ?? '').trim();
  const affiliateUrl = String(input.affiliateUrl ?? '').trim();
  const image = String(input.image ?? '').trim();
  const category = String(input.category ?? '').trim();
  if (sourceUrl && !isSafeWebUrl(sourceUrl)) throw new Error('La URL original debe ser una dirección HTTP(S) válida.');
  if (affiliateUrl && !isSafeWebUrl(affiliateUrl)) throw new Error('La URL afiliada debe ser una dirección HTTP(S) válida.');
  if (image && !((image.startsWith('/') && !image.startsWith('//')) || isSafeWebUrl(image))) {
    throw new Error('La imagen debe ser una ruta local o una URL HTTP(S) válida.');
  }
  if (category && categories.length && !categories.includes(category)) throw new Error('Selecciona una categoría válida.');

  const currentPrice = parsePrice(input.currentPrice, 'Precio actual');
  const previousPrice = parsePrice(input.previousPrice, 'Precio anterior');
  if (previousPrice !== undefined && currentPrice === undefined) {
    throw new Error('Indica también el precio actual para conservar el precio anterior.');
  }
  if (previousPrice !== undefined && previousPrice <= currentPrice) {
    throw new Error('El precio anterior debe ser superior al precio actual.');
  }

  const validDiscountPrices = Number.isFinite(currentPrice) && currentPrice > 0
    && Number.isFinite(previousPrice) && previousPrice > currentPrice;
  const draft = {
    id: `offer-${crypto.randomUUID()}`,
    title,
    slug: createSlug(title),
    store: 'AliExpress',
    category,
    ...(image ? { image } : {}),
    currentPrice: currentPrice ?? 0,
    ...(previousPrice !== undefined ? { previousPrice } : {}),
    previousPriceVerified: false,
    discount: validDiscountPrices ? calculateDiscount(currentPrice, previousPrice, true) : 0,
    coupon: String(input.coupon ?? '').trim(),
    conditions: String(input.conditions ?? '').trim(),
    seller: String(input.seller ?? '').trim(),
    description: `Borrador editorial de «${title}». Completa esta descripción con información contrastada antes de publicar.`,
    shortDescription: `Borrador pendiente de verificación: ${title}.`,
    sourceUrl,
    affiliateUrl,
    publishedAt: new Date().toISOString().slice(0, 10),
    status: 'draft',
    featured: false,
    verified: false,
    demo: false,
    score: 0,
    tags: ['importacion-rapida']
  };

  if (isDuplicate(draft, existingOffers)) throw new Error('Oferta duplicada: ya existe la misma URL original o el mismo título normalizado.');
  return draft;
}

function parseCsvRows(text) {
  const input = text.replace(/^\uFEFF/, '');
  const delimiter = (input.split(/\r?\n/, 1)[0].match(/;/g) || []).length
    > (input.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let lineNumber = 1;
  let rowNumber = 2;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted && char === '"' && input[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push({ rowNumber, values: row });
      row = [];
      cell = '';
      lineNumber += 1;
      rowNumber = lineNumber;
    } else {
      cell += char;
      if (quoted && (char === '\n' || char === '\r')) {
        if (char === '\r' && input[index + 1] === '\n') index += 1;
        lineNumber += 1;
      }
    }
  }
  if (quoted) throw new Error('CSV inválido: hay un campo entrecomillado sin cerrar.');
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push({ rowNumber, values: row });
  if (!rows.length) throw new Error('El CSV está vacío.');

  const headers = rows[0].values.map((header) => header.trim());
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) {
    throw new Error('Los encabezados CSV deben ser únicos y no estar vacíos.');
  }
  const unsupported = headers.filter((header) => !allowedColumns.has(header));
  if (unsupported.length) throw new Error(`Columnas CSV no admitidas: ${unsupported.join(', ')}.`);
  if (!headers.includes('title')) throw new Error('El CSV debe incluir la columna title.');

  return rows.slice(1).map(({ rowNumber: rowIndex, values }) => ({
    rowNumber: rowIndex,
    values: Object.fromEntries(headers.map((header, column) => [header, (values[column] ?? '').trim()])),
    columnCount: values.length,
    expectedColumnCount: headers.length
  }));
}

export function importAliExpressCsv(text, { existingOffers = [], categories = [] } = {}) {
  const rows = parseCsvRows(text);
  const results = [];
  const accepted = [...existingOffers];
  const imported = [];

  for (const { rowNumber, values, columnCount, expectedColumnCount } of rows) {
    if (columnCount !== expectedColumnCount) {
      results.push({ row: rowNumber, ok: false, message: 'El número de columnas no coincide con los encabezados.' });
      continue;
    }
    if (/^\s*demo\b/i.test(values.title)) {
      results.push({ row: rowNumber, ok: false, message: 'Fila DEMO de plantilla; no se ha importado.' });
      continue;
    }
    try {
      const offer = createAliExpressDraft(values, { existingOffers: accepted, categories });
      imported.push(offer);
      accepted.push(offer);
      results.push({ row: rowNumber, ok: true, message: `Borrador creado: ${offer.title}.`, offer });
    } catch (error) {
      results.push({ row: rowNumber, ok: false, message: error instanceof Error ? error.message : 'Fila inválida.' });
    }
  }
  return { offers: imported, results };
}
