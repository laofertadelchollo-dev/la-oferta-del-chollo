import { isSafeWebUrl } from './offer-policy.js';

const fields = {
  productId: ['product id', 'productid', 'item id', 'itemid', 'id producto', 'identificador producto', 'id del producto'],
  title: ['product title', 'product name', 'title', 'product', 'nombre del producto', 'nombre producto', 'titulo', 'título'],
  productUrl: ['product url', 'product link', 'item url', 'product page', 'url producto', 'enlace producto', 'pagina del producto'],
  affiliateUrl: ['affiliate link', 'affiliate url', 'tracking link', 'promotion link', 'promo link', 'hot link', 'enlace afiliado', 'url afiliada', 'enlace de seguimiento', 'enlace de promocion'],
  imageUrl: ['main image', 'image url', 'image link', 'product image', 'image', 'imagen principal', 'url imagen', 'imagen producto', 'imagen'],
  additionalImageUrls: ['additional images', 'other images', 'image urls', 'more images', 'additional image urls', 'imagenes adicionales', 'otras imagenes', 'urls de imagenes'],
  videoUrl: ['video url', 'video link', 'product video', 'url video', 'enlace video', 'video'],
  originalPrice: ['original price', 'regular price', 'price before', 'list price', 'precio original', 'precio anterior', 'precio de lista'],
  currentPrice: ['current price', 'sale price', 'discount price', 'promo price', 'price now', 'precio actual', 'precio oferta', 'precio promocional'],
  currency: ['currency', 'currency code', 'moneda', 'divisa'],
  discountPercent: ['discount', 'discount rate', 'discount percentage', 'discount percent', 'descuento', 'porcentaje descuento'],
  commissionPercent: ['commission rate', 'commission percent', 'commission percentage', 'commission %', 'rate of commission', 'tasa de comision', 'comision %', 'porcentaje comision'],
  estimatedCommission: ['estimated commission', 'commission amount', 'commission per sale', 'est commission', 'comision estimada', 'importe comision'],
  sales180d: ['180 day sales', '180 days sales', 'sales last 180 days', 'orders last 180 days', 'last 180 days orders', '180d sales', 'ventas 180 dias', 'ventas ultimos 180 dias', 'pedidos 180 dias'],
  positiveRating: ['positive rating', 'positive feedback', 'positive rate', 'rating', 'seller rating', 'valoracion positiva', 'valoracion', 'calificacion positiva'],
  coupon: ['coupon', 'coupon code', 'promo code', 'voucher', 'cupon', 'codigo cupon'],
  couponValue: ['coupon value', 'coupon amount', 'discount coupon', 'valor cupon', 'importe cupon'],
  couponQuantity: ['coupon quantity', 'coupon count', 'coupons available', 'cantidad cupones', 'numero cupones'],
  couponMinSpend: ['minimum spend', 'min spend', 'minimum order', 'min order amount', 'gasto minimo', 'pedido minimo'],
  couponStartDate: ['coupon start date', 'coupon start', 'valid from', 'start date', 'fecha inicio cupon', 'inicio cupon'],
  couponEndDate: ['coupon end date', 'coupon end', 'valid until', 'end date', 'fecha fin cupon', 'fin cupon']
};

const normalized = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('en')
  .replace(/[^a-z0-9%]+/g, ' ')
  .trim();

function findColumn(headers, field) {
  const names = fields[field];
  const exactIndex = headers.findIndex((header) => {
    const name = normalized(header).replace(/\s+(eur|usd|gbp|cny|jpy|cad|aud|chf|pln|brl)\s*$/i, '');
    return names.includes(name);
  });
  if (exactIndex >= 0) return exactIndex;
  const patterns = {
    productId: /\b(product|item)\s*(id|no|number)\b|\bid\s*(producto|articulo)\b/,
    title: /\b(product|item)\s*(title|name)\b|\b(nombre|titulo)\s*(producto)?\b/,
    productUrl: /\b(product|item)\s*(url|link)\b|\b(enlace|url)\s*(producto)?\b/,
    affiliateUrl: /\b(affiliate|tracking|promotion|promo)\s*(url|link)\b|\b(enlace|url)\s*(afiliad|seguimiento)\b/,
    imageUrl: /\b(main|product)\s*image\b|\b(image|imagen)\s*(url|link|principal)?\b/,
    additionalImageUrls: /\b(additional|other|more)\s*images?\b|\b(imagenes|urls)\s*adicionales\b/,
    videoUrl: /\b(video)\s*(url|link)?\b/,
    originalPrice: /\b(original|regular|list|before)\s*price\b|\bprecio\s*(original|anterior|lista)\b/,
    currentPrice: /\b(current|sale|discount|promo)\s*price\b|\bprecio\s*(actual|oferta|promocional)\b/,
    currency: /\b(currency|currency code|moneda|divisa)\b/,
    discountPercent: /\b(discount|descuento)\s*(rate|percentage|percent|%)?\b/,
    commissionPercent: /\bcommission\b.*\b(rate|percent|percentage)\b|\b(rate|percent|percentage)\b.*\bcommission\b|\bcomision\b.*(%|tasa|porcentaje)|\b(tasa|porcentaje)\b.*\bcomision\b/,
    estimatedCommission: /\b(estimated|est)\s*commission\b|\bcommission\s*(amount|per sale)\b|\bcomision\s*(estimada|importe)\b/,
    sales180d: /\b(180\s*(day|days|d)|last\s*180)\b.*\b(sales|orders)\b|\b(ventas|pedidos)\b.*180\b/,
    positiveRating: /\b(positive\s*(rating|feedback|rate)|rating|valoracion|calificacion)\b/,
    coupon: /\b(coupon|voucher|cupon)\b(?!.*(value|amount|quantity|count|start|end|date|minimum|spend|gasto|cantidad|fecha))/,
    couponValue: /\b(coupon|cupon)\b.*\b(value|amount|valor|importe)\b/,
    couponQuantity: /\b(coupon|cupon)\b.*\b(quantity|count|cantidad|numero)\b/,
    couponMinSpend: /\b(minimum|min)\b.*\b(spend|order|gasto|pedido)\b|\bgasto minimo\b/,
    couponStartDate: /\b(coupon|cupon)\b.*\b(start|inicio|from)\b|\b(valid from|start date)\b/,
    couponEndDate: /\b(coupon|cupon)\b.*\b(end|fin|until)\b|\b(valid until|end date)\b/
  };
  const pattern = patterns[field];
  return pattern ? headers.findIndex((header) => pattern.test(normalized(header))) : -1;
}

function cellAt(row, index) {
  return index < 0 ? '' : row[index] ?? '';
}

function textValue(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return String(value ?? '').trim();
}

export function normalizeAliExpressImageUrl(value) {
  const text = textValue(value);
  if (!text) return '';
  const candidate = text.startsWith('//') ? `https:${text}` : text;
  return isSafeWebUrl(candidate) ? candidate : '';
}

function splitImageUrls(value) {
  if (Array.isArray(value)) return value.flatMap(splitImageUrls);
  const text = textValue(value);
  if (!text) return [];
  const matches = text.match(/(?:https?:)?\/\/[^\s,;|]+/gi) || [];
  return [...new Set(matches.map(normalizeAliExpressImageUrl).filter(Boolean))];
}

function parseNumber(value, { percent = false } = {}) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return percent && value > 0 && value <= 1 ? value * 100 : value;
  }
  const text = textValue(value).replace(/[\s\u00a0]/g, '').replace(/[€$£]/g, '').replace(/%/g, '');
  if (!text) return null;
  const numeric = text.replace(/[^\d,.-]/g, '');
  if (!numeric || !/\d/.test(numeric)) return null;
  const comma = numeric.lastIndexOf(',');
  const dot = numeric.lastIndexOf('.');
  let normalizedNumber = numeric;
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    normalizedNumber = numeric.replaceAll(thousands, '').replace(decimal, '.');
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? ',' : '.';
    const digitsAfter = numeric.length - numeric.lastIndexOf(separator) - 1;
    normalizedNumber = digitsAfter === 3
      ? numeric.replaceAll(separator, '')
      : numeric.replace(separator, '.');
  }
  const number = Number(normalizedNumber);
  if (!Number.isFinite(number)) return null;
  return percent && number > 0 && number <= 1 ? number * 100 : number;
}

function parseCurrency(row, headers, indexes) {
  const explicit = textValue(cellAt(row, indexes.currency)).toUpperCase();
  const recognizedCodes = ['EUR', 'USD', 'GBP', 'CNY', 'JPY', 'CAD', 'AUD', 'CHF', 'PLN', 'BRL'];
  if (recognizedCodes.includes(explicit)) return explicit;
  if (explicit === '€' || explicit.includes('EURO')) return 'EUR';
  if (explicit === '£' || explicit.includes('POUND')) return 'GBP';
  if (explicit === '$' || explicit.includes('DOLLAR')) return 'USD';
  const sources = [
    indexes.currentPrice >= 0 ? headers[indexes.currentPrice] : '',
    indexes.originalPrice >= 0 ? headers[indexes.originalPrice] : '',
    textValue(cellAt(row, indexes.currentPrice)),
    textValue(cellAt(row, indexes.originalPrice))
  ].join(' ');
  const currencyCode = sources.match(/\b(EUR|USD|GBP|CNY|JPY|CAD|AUD|CHF|PLN|BRL)\b/i)?.[1];
  if (currencyCode) return currencyCode.toUpperCase();
  const symbol = sources.match(/[€$£]/)?.[0];
  return symbol === '€' ? 'EUR' : symbol === '£' ? 'GBP' : symbol === '$' ? 'USD' : '';
}

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const text = textValue(value);
  const iso = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const local = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (local) return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  return null;
}

function headerIndexes(headers) {
  const indexes = Object.fromEntries(Object.keys(fields).map((field) => [field, findColumn(headers, field)]));
  indexes.additionalImageIndexes = headers.flatMap((header, index) => {
    const name = normalized(header);
    const isImageColumn = /\b(image|imagen)(\s+(url|link|[1-9]\d*))?\b/.test(name);
    return isImageColumn && index !== indexes.imageUrl ? [index] : [];
  });
  return indexes;
}

function getOriginalRow(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [textValue(header) || `column_${index + 1}`, row[index] ?? null]));
}

function normalizeProduct(row, headers, indexes, rowNumber, fileName, importedAt) {
  const rawTitle = textValue(cellAt(row, indexes.title));
  const productId = textValue(cellAt(row, indexes.productId));
  const currentPrice = parseNumber(cellAt(row, indexes.currentPrice));
  const currency = parseCurrency(row, headers, indexes);
  const affiliateUrl = textValue(cellAt(row, indexes.affiliateUrl));
  const affiliateValid = isSafeWebUrl(affiliateUrl);
  const errors = [];
  if (!productId || productId.length > 200) errors.push('Product ID no válido.');
  if (!rawTitle) errors.push('Falta el título.');
  if (currentPrice === null || currentPrice <= 0) errors.push('El precio actual no es interpretable.');
  if (!currency || !/^[A-Z]{3}$/.test(currency)) errors.push('No se pudo detectar una moneda válida.');
  if (!affiliateValid) errors.push('Falta un enlace afiliado HTTP(S) válido.');

  const rawImageUrls = [
    textValue(cellAt(row, indexes.imageUrl)),
    textValue(cellAt(row, indexes.additionalImageUrls)),
    ...indexes.additionalImageIndexes.map((index) => textValue(cellAt(row, index)))
  ].flatMap((value) => value.match(/(?:https?:)?\/\/[^\s,;|]+/gi) || []);
  const imageUrls = rawImageUrls.map(normalizeAliExpressImageUrl).filter((url, index, urls) => url && urls.indexOf(url) === index);
  const rawImageFields = [
    cellAt(row, indexes.imageUrl),
    cellAt(row, indexes.additionalImageUrls),
    ...indexes.additionalImageIndexes.map((index) => cellAt(row, index))
  ];
  if (rawImageUrls.some((url) => !normalizeAliExpressImageUrl(url))
    || rawImageFields.some((value) => textValue(value) && !(textValue(value).match(/(?:https?:)?\/\/[^\s,;|]+/gi) || []).length)) {
    errors.push('Hay una URL de imagen no válida.');
  }
  const originalPrice = parseNumber(cellAt(row, indexes.originalPrice));
  const commissionPercent = parseNumber(cellAt(row, indexes.commissionPercent), { percent: true });
  const estimatedCommissionSource = parseNumber(cellAt(row, indexes.estimatedCommission));
  const discountSource = parseNumber(cellAt(row, indexes.discountPercent), { percent: true });
  const computedDiscount = originalPrice && currentPrice !== null && originalPrice > currentPrice
    ? ((originalPrice - currentPrice) / originalPrice) * 100 : null;
  const sales180d = parseNumber(cellAt(row, indexes.sales180d));
  const positiveRating = parseNumber(cellAt(row, indexes.positiveRating), { percent: true });
  const couponValue = parseNumber(cellAt(row, indexes.couponValue));
  const couponQuantity = parseNumber(cellAt(row, indexes.couponQuantity));
  const couponMinSpend = parseNumber(cellAt(row, indexes.couponMinSpend));
  const estimatedCommission = estimatedCommissionSource
    ?? (commissionPercent !== null && currentPrice !== null ? currentPrice * commissionPercent / 100 : null);
  for (const [field, label, value, minimum, maximum, integer, percent] of [
    ['originalPrice', 'precio original', originalPrice, 0, Number.POSITIVE_INFINITY, false, false],
    ['discountPercent', 'descuento', discountSource, 0, 100, false, true],
    ['commissionPercent', 'comisión', commissionPercent, 0, 100, false, true],
    ['estimatedCommission', 'comisión estimada', estimatedCommission, 0, Number.POSITIVE_INFINITY, false, false],
    ['sales180d', 'ventas de 180 días', sales180d, 0, Number.POSITIVE_INFINITY, true, false],
    ['positiveRating', 'valoración positiva', positiveRating, 0, 100, false, true],
    ['couponValue', 'valor del cupón', couponValue, 0, Number.POSITIVE_INFINITY, false, false],
    ['couponQuantity', 'cantidad de cupones', couponQuantity, 0, Number.POSITIVE_INFINITY, true, false],
    ['couponMinSpend', 'gasto mínimo', couponMinSpend, 0, Number.POSITIVE_INFINITY, false, false]
  ]) {
    const raw = cellAt(row, indexes[field]);
    const rawText = textValue(raw);
    if (rawText && (value === null || value < minimum || value > maximum || integer && !Number.isInteger(value))) {
      errors.push(`El campo ${label} no es válido.`);
    }
    if (percent && rawText && value !== null && value > 100) {
      errors.push(`El campo ${label} debe estar entre 0 y 100.`);
    }
  }
  for (const field of ['productUrl', 'videoUrl']) {
    const value = textValue(cellAt(row, indexes[field]));
    if (value && !isSafeWebUrl(value)) errors.push(`La URL de ${field === 'productUrl' ? 'producto' : 'vídeo'} no es válida.`);
  }
  for (const field of ['couponStartDate', 'couponEndDate']) {
    const value = cellAt(row, indexes[field]);
    if (textValue(value) && !parseDateValue(value)) errors.push(`La fecha ${field === 'couponStartDate' ? 'de inicio' : 'de finalización'} del cupón no es válida.`);
  }
  const product = {
    productId,
    title: rawTitle,
    productUrl: textValue(cellAt(row, indexes.productUrl)),
    affiliateUrl,
    imageUrl: imageUrls[0] || '',
    additionalImageUrls: imageUrls.slice(1),
    imageUrls,
    videoUrl: textValue(cellAt(row, indexes.videoUrl)),
    originalPrice,
    currentPrice,
    currency,
    discountPercent: discountSource ?? computedDiscount,
    commissionPercent,
    estimatedCommission,
    sales180d,
    positiveRating,
    coupon: textValue(cellAt(row, indexes.coupon)),
    couponValue,
    couponQuantity,
    couponMinSpend,
    couponStartDate: parseDateValue(cellAt(row, indexes.couponStartDate)),
    couponEndDate: parseDateValue(cellAt(row, indexes.couponEndDate)),
    theoreticalCommissionVolume: sales180d !== null && estimatedCommission !== null ? sales180d * estimatedCommission : null,
    importedAt,
    source: 'aliexpress_excel',
    sourceFileName: fileName,
    originalData: getOriginalRow(headers, row),
    category: '',
    subcategory: '',
    tags: [],
    editorialStatus: 'draft',
    availabilityStatus: 'draft',
    publishedEnTelegram: false,
    fechaPublicacionTelegram: null,
    priceHistory: [],
    salesHistory: [],
    couponHistory: [],
    captureHistory: []
  };
  return { product, errors, rowNumber };
}

export function parseAliExpressExcelRows(rows, { fileName = '', importedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('El Excel está vacío o no contiene filas.');
  const headerIndex = rows.findIndex((row) => Array.isArray(row)
    && Object.keys(fields).some((field) => findColumn(row, field) >= 0)
    && findColumn(row, 'productId') >= 0
    && findColumn(row, 'title') >= 0);
  if (headerIndex < 0) throw new Error('No se encontraron encabezados reconocibles para Product ID y nombre del producto.');
  const headers = rows[headerIndex].map(textValue);
  const indexes = headerIndexes(headers);
  if (indexes.currentPrice < 0) throw new Error('No se encontró una columna reconocible de precio actual.');

  const products = [];
  const errors = [];
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    if (!Array.isArray(row) || row.every((cell) => cell === null || cell === undefined || textValue(cell) === '')) return;
    const { product, errors: rowErrors } = normalizeProduct(row, headers, indexes, rowNumber, fileName, importedAt);
    if (rowErrors.length) errors.push({ row: rowNumber, productId: product.productId, title: product.title, errors: rowErrors });
    else products.push({ ...product, sourceRowNumber: rowNumber });
  });
  return { headers, headerRow: headerIndex + 1, products, errors, detectedRows: products.length + errors.length };
}

export async function readAliExpressExcelFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Selecciona un archivo Excel .xlsx válido.');
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  const sheets = await readXlsxFile(file);
  return Array.isArray(sheets?.[0]?.data) ? sheets[0].data : sheets;
}

function normalizedText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function addHistoryEntry(history, value, importedAt) {
  if (value === null || value === undefined || value === '') return history || [];
  const last = history?.at(-1);
  if (JSON.stringify(last?.value) === JSON.stringify(value)) return history || [];
  return [...(history || []), { importedAt, value }];
}

function mergeReimport(existing, incoming) {
  const importedAt = incoming.importedAt;
  const snapshot = {
    importedAt,
    currentPrice: incoming.currentPrice,
    currency: incoming.currency,
    sales180d: incoming.sales180d,
    coupon: incoming.coupon,
    couponValue: incoming.couponValue,
    couponStartDate: incoming.couponStartDate,
    couponEndDate: incoming.couponEndDate
  };
  const priceHistory = addHistoryEntry(existing.priceHistory, {
    price: incoming.currentPrice, currency: incoming.currency
  }, importedAt);
  const salesHistory = addHistoryEntry(existing.salesHistory, incoming.sales180d, importedAt);
  const couponHistory = addHistoryEntry(existing.couponHistory, {
    coupon: incoming.coupon, value: incoming.couponValue, startDate: incoming.couponStartDate, endDate: incoming.couponEndDate
  }, importedAt);
  return {
    ...existing,
    ...incoming,
    category: existing.category || incoming.category,
    subcategory: existing.subcategory || incoming.subcategory,
    tags: existing.tags || incoming.tags,
    editorialStatus: existing.editorialStatus || 'draft',
    availabilityStatus: existing.availabilityStatus || 'draft',
    publishedEnTelegram: existing.publishedEnTelegram === true,
    fechaPublicacionTelegram: existing.fechaPublicacionTelegram || null,
    priceHistory,
    salesHistory,
    couponHistory,
    captureHistory: [...(existing.captureHistory || []), snapshot],
    importedAt
  };
}

function productDuplicateIndex(product, productsById, productsByAffiliate, productsByTitle) {
  const id = normalizedText(product.productId);
  if (id && productsById.has(id)) return productsById.get(id);
  const affiliate = normalizedText(product.affiliateUrl);
  if (affiliate && productsByAffiliate.has(affiliate)) return productsByAffiliate.get(affiliate);
  const title = normalizedText(product.title);
  return title ? productsByTitle.get(title) ?? -1 : -1;
}

export function importAliExpressExcelRows(rows, { existingProducts = [], fileName = '', importedAt = new Date().toISOString() } = {}) {
  const parsed = parseAliExpressExcelRows(rows, { fileName, importedAt });
  const products = existingProducts.map((product) => ({ ...product }));
  const indexes = { id: new Map(), affiliate: new Map(), title: new Map() };
  const addIndex = (product, index) => {
    const id = normalizedText(product.productId);
    const affiliate = normalizedText(product.affiliateUrl);
    const title = normalizedText(product.title);
    if (id) indexes.id.set(id, index);
    if (affiliate) indexes.affiliate.set(affiliate, index);
    if (title) indexes.title.set(title, index);
  };
  products.forEach(addIndex);
  const results = [...parsed.errors.map((error) => ({ ...error, ok: false, status: 'error' }))];
  let imported = 0;
  let updated = 0;
  for (const parsedProduct of parsed.products) {
    const { sourceRowNumber, ...incoming } = parsedProduct;
    const existingIndex = productDuplicateIndex(incoming, indexes.id, indexes.affiliate, indexes.title);
    if (existingIndex >= 0) {
      products[existingIndex] = mergeReimport(products[existingIndex], incoming);
      addIndex(products[existingIndex], existingIndex);
      updated += 1;
      results.push({ row: sourceRowNumber, ok: true, status: 'updated', productId: incoming.productId });
    } else {
      const initial = {
        ...incoming,
        priceHistory: incoming.currentPrice === null ? [] : [{ importedAt: incoming.importedAt, value: { price: incoming.currentPrice, currency: incoming.currency } }],
        salesHistory: incoming.sales180d === null ? [] : [{ importedAt: incoming.importedAt, value: incoming.sales180d }],
        couponHistory: incoming.coupon || incoming.couponValue !== null ? [{
          importedAt: incoming.importedAt,
          value: { coupon: incoming.coupon, value: incoming.couponValue, startDate: incoming.couponStartDate, endDate: incoming.couponEndDate }
        }] : [],
        captureHistory: [{
          importedAt: incoming.importedAt,
          currentPrice: incoming.currentPrice,
          currency: incoming.currency,
          sales180d: incoming.sales180d,
          coupon: incoming.coupon,
          couponValue: incoming.couponValue,
          couponStartDate: incoming.couponStartDate,
          couponEndDate: incoming.couponEndDate
        }]
      };
      const index = products.push(initial) - 1;
      addIndex(initial, index);
      imported += 1;
      results.push({ row: sourceRowNumber, ok: true, status: 'imported', productId: incoming.productId });
    }
  }
  return { products, results, imported, updated, errors: parsed.errors.length, detected: parsed.detectedRows, headers: parsed.headers };
}
