import { offers as seedOffers } from '../data/offers';
import {
  CATEGORIES,
  calculateDiscount,
  createSlug,
  formatMoney,
  generateTelegramDraft,
  generateTelegramPost,
  getOfferStatusLabel,
  getOfferState,
  isExpired,
  isHttpUrl,
  type Offer,
  type OfferStatus
} from '../lib/site';
import { scoreCandidate } from '../lib/offer-scoring.js';
import { verifyCandidate, verifyOffer } from '../lib/offer-verification.js';
import { createOffer, publishOffer } from '../lib/offer-publishing.js';
import { isCalendarDate, isSafeOfferImage } from '../lib/offer-policy.js';
import { migrateStoredOfferList, parseOfferJson, validateOfferList } from '../lib/offer-import.js';
import type { CandidateRecord, OfferCandidate } from '../lib/sources/types';
import { importCandidateData } from '../lib/candidate-import.js';
import { filterCandidates, selectTopCandidates } from '../lib/candidate-filter.js';
import { appendCandidateHistory, appendCandidateSearchHistory, type CandidateHistoryEntry } from '../lib/candidate-history.js';
import { findCandidates } from '../lib/sources/index.js';
import { expireOffers } from '../lib/offer-expiry.js';
import {
  AVAILABILITY_LABELS,
  OFFER_CATEGORIES,
  filterAndSortOffers,
  getAvailabilityState,
  getOffersNeedingReview,
  recordOfferPriceChange
} from '../lib/offer-lifecycle.js';
import { createAliExpressDraft, importAliExpressCsv } from '../lib/aliexpress-manual-import.js';
import {
  createAliExpressPromoDraft,
  parseAliExpressPromoItems,
  parseAliExpressPrice
} from '../lib/aliexpress-promo-items.js';
import {
  importAliExpressExcelRows,
  normalizeAliExpressImageUrl,
  parseAliExpressExcelRows,
  readAliExpressExcelFile
} from '../lib/aliexpress-excel.js';

const storageKey = 'la-oferta-del-chollo-offers-v1';
const candidateStorageKey = 'la-oferta-del-chollo-candidates-v1';
const candidateHistoryStorageKey = 'la-oferta-del-chollo-candidate-history-v1';
const excelProductsStorageKey = 'la-oferta-del-chollo-aliexpress-excel-v1';
type ExcelHistoryValue<T> = { importedAt: string; value: T };
type AliExpressExcelProduct = {
  productId: string;
  title: string;
  productUrl: string;
  affiliateUrl: string;
  imageUrl: string;
  additionalImageUrls: string[];
  imageUrls: string[];
  videoUrl: string;
  originalPrice: number | null;
  currentPrice: number | null;
  currency: string;
  discountPercent: number | null;
  commissionPercent: number | null;
  estimatedCommission: number | null;
  sales180d: number | null;
  positiveRating: number | null;
  coupon: string;
  couponValue: number | null;
  couponQuantity: number | null;
  couponMinSpend: number | null;
  couponStartDate: string | null;
  couponEndDate: string | null;
  theoreticalCommissionVolume: number | null;
  importedAt: string;
  source: 'aliexpress_excel';
  sourceFileName: string;
  originalData: Record<string, unknown>;
  category: string;
  subcategory: string;
  tags: string[];
  editorialStatus: string;
  availabilityStatus: string;
  publishedEnTelegram: boolean;
  fechaPublicacionTelegram: string | null;
  priceHistory: ExcelHistoryValue<{ price: number; currency: string }>[];
  salesHistory: ExcelHistoryValue<number>[];
  couponHistory: ExcelHistoryValue<{ coupon: string; value: number | null; startDate: string | null; endDate: string | null }>[];
  captureHistory: {
    importedAt: string;
    currentPrice: number | null;
    currency: string;
    sales180d: number | null;
    coupon: string;
    couponValue: number | null;
    couponStartDate: string | null;
    couponEndDate: string | null;
  }[];
};
const today = () => new Date().toISOString().slice(0, 10);
const formatDateForSpain = (value?: string | null) => {
  if (!value || !isCalendarDate(value.slice(0, 10))) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
};
const formatCandidateCurrency = (value: number, currency: string) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const isCandidateRecord = (value: unknown): value is CandidateRecord => {
  if (!value || typeof value !== 'object' || !('candidate' in value) || !('status' in value)
    || !('score' in value) || !('scoreExplanation' in value) || !('verificationNotes' in value)) return false;
  const candidate = value.candidate;
  return Boolean(candidate && typeof candidate === 'object' && 'id' in candidate
    && typeof candidate.id === 'string'
    && ['pending', 'verified', 'approved', 'discarded', 'rejected'].includes(String(value.status))
    && Number.isFinite(value.score) && Array.isArray(value.scoreExplanation)
    && Array.isArray(value.verificationNotes));
};
const isCandidateHistoryEntry = (value: unknown): value is CandidateHistoryEntry => {
  if (!value || typeof value !== 'object'
    || !('date' in value) || !('source' in value) || !('product' in value)
    || !('price' in value) || !('currency' in value) || !('status' in value)) return false;
  return typeof value.date === 'string' && typeof value.source === 'string'
    && typeof value.product === 'string'
    && (value.price === null || Number.isFinite(value.price))
    && typeof value.currency === 'string' && typeof value.status === 'string';
};
const getElement = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`No se encontró el control requerido: ${selector}`);
  return element;
};

async function encodePromoImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error(`${file.name}: selecciona una imagen JPG, PNG o WEBP.`);
  }
  if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name}: el archivo supera el límite de 15 MB.`);
  const bitmap = await createImageBitmap(file);
  try {
    for (const maxSide of [1000, 750, 500]) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error(`${file.name}: el navegador no pudo procesar la imagen.`);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.78, 0.65, 0.52]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob && blob.size <= 300 * 1024) {
          return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener('load', () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(`${file.name}: no se pudo leer la imagen procesada.`)));
            reader.addEventListener('error', () => reject(new Error(`${file.name}: no se pudo leer la imagen procesada.`)));
            reader.readAsDataURL(blob);
          });
        }
      }
    }
    throw new Error(`${file.name}: no se pudo reducir por debajo de 300 KB.`);
  } finally {
    bitmap.close();
  }
}

export function initializeLocalOfferManager(): void {
  const form = getElement<HTMLFormElement>('#offer-form');
  const statusMessage = getElement<HTMLParagraphElement>('#admin-status');
  const list = getElement<HTMLDivElement>('#offer-list');
  const output = getElement<HTMLTextAreaElement>('#telegram-output');
  const telegramStatus = getElement<HTMLParagraphElement>('#telegram-status');
  const importOutput = getElement<HTMLParagraphElement>('#import-errors');
  const importTextarea = getElement<HTMLTextAreaElement>('#import-json');
  const filter = getElement<HTMLSelectElement>('#offer-filter');
  const candidateResults = getElement<HTMLDivElement>('#candidate-results');
  const foundCandidatesList = getElement<HTMLDivElement>('#found-candidates-list');
  const candidateHistoryList = getElement<HTMLDivElement>('#candidate-history-list');
  const candidateImportData = getElement<HTMLTextAreaElement>('#candidate-import-data');
  const candidateImportStatus = getElement<HTMLParagraphElement>('#candidate-import-status');
  const candidateSource = getElement<HTMLSelectElement>('#candidate-source');
  const candidateFile = getElement<HTMLInputElement>('#candidate-import-file');
  const quickOfferForm = getElement<HTMLFormElement>('#quick-offer-form');
  const quickImportStatus = getElement<HTMLParagraphElement>('#quick-import-status');
  const aliexpressCsv = getElement<HTMLTextAreaElement>('#aliexpress-csv');
  const aliexpressCsvFile = getElement<HTMLInputElement>('#aliexpress-csv-file');
  const aliexpressCsvResults = getElement<HTMLDivElement>('#aliexpress-csv-results');
  const importedOffersTable = getElement<HTMLTableSectionElement>('#imported-offers-table');
  const importedOffersEmpty = getElement<HTMLParagraphElement>('#imported-offers-empty');
  const reviewQueue = getElement<HTMLDivElement>('#review-queue');
  const excelFileInput = getElement<HTMLInputElement>('#aliexpress-excel-file');
  const excelStatus = getElement<HTMLParagraphElement>('#aliexpress-excel-status');
  const excelResults = getElement<HTMLDivElement>('#aliexpress-excel-results');
  const excelPreviewWrap = getElement<HTMLDivElement>('#aliexpress-excel-preview-wrap');
  const excelPreview = getElement<HTMLTableSectionElement>('#aliexpress-excel-preview');
  const excelProductsTable = getElement<HTMLTableSectionElement>('#aliexpress-excel-products');
  const excelProductsEmpty = getElement<HTMLParagraphElement>('#aliexpress-excel-empty');
  const promoMaterial = getElement<HTMLTextAreaElement>('#promo-material');
  const promoStatus = getElement<HTMLParagraphElement>('#promo-detect-status');
  const promoFields = getElement<HTMLDivElement>('#promo-fields');
  const promoImagesInput = getElement<HTMLInputElement>('#promo-images-input');
  const promoImagesList = getElement<HTMLDivElement>('#promo-images-list');
  const promoImagesStatus = getElement<HTMLParagraphElement>('#promo-images-status');
  const promoPreview = getElement<HTMLDivElement>('#promo-preview-content');
  const telegramImagesPreview = getElement<HTMLDivElement>('#telegram-images-preview');
  const telegramDialog = getElement<HTMLDialogElement>('#telegram-send-dialog');
  const telegramPreview = getElement<HTMLPreElement>('#telegram-preview');
  const telegramSendButton = getElement<HTMLButtonElement>('#confirm-telegram-send');
  const idInput = getElement<HTMLInputElement>('#offer-id');
  const titleInput = getElement<HTMLInputElement>('#title');
  const slugSeed = seedOffers.map((offer) => ({ ...offer }));
  let records: Offer[];
  let candidateRecords: CandidateRecord[] = [];
  let candidateHistory: CandidateHistoryEntry[] = [];
  let promoImages: NonNullable<Offer['images']> = [];
  let refreshOfferId: string | undefined;
  let editorImages: NonNullable<Offer['images']> = [];
  let excelProducts: AliExpressExcelProduct[] = [];
  let excelWorkbookRows: unknown[][] = [];
  let excelPreviewData: ReturnType<typeof parseAliExpressExcelRows> | undefined;
  let excelPreviewSelected = new Set<number>();
  let lastPromoMaterial = '';
  let pendingTelegramAction: { action: 'offer'; offer: Offer } | { action: 'test' } | undefined;

  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      records = migrateStoredOfferList(parsed);
      if (JSON.stringify(records) !== JSON.stringify(parsed)) {
        localStorage.setItem(storageKey, JSON.stringify(records));
        statusMessage.textContent = 'Se han actualizado los datos locales al modelo actual sin descartar ofertas.';
      }
    } else {
      records = slugSeed;
    }
  } catch (error) {
    records = slugSeed;
    statusMessage.textContent = `No se pudieron leer los datos locales; se muestran los ejemplos incluidos: ${error instanceof Error ? error.message : 'error desconocido'}`;
    statusMessage.classList.add('is-error');
  }

  try {
    const storedExcelProducts: unknown = JSON.parse(localStorage.getItem(excelProductsStorageKey) || '[]');
    if (!Array.isArray(storedExcelProducts) || storedExcelProducts.some((item) =>
      !item || typeof item !== 'object' || typeof item.productId !== 'string' || !Array.isArray(item.captureHistory))) {
      throw new Error('Los productos importados desde Excel no tienen un formato válido.');
    }
    excelProducts = storedExcelProducts as AliExpressExcelProduct[];
  } catch (error) {
    excelStatus.textContent = `No se pudieron leer los productos Excel guardados: ${error instanceof Error ? error.message : 'error desconocido'}`;
    excelStatus.classList.add('is-error');
  }

  const expired = expireOffers(records);
  if (expired.expiredCount) {
    records = expired.offers;
    try {
      localStorage.setItem(storageKey, JSON.stringify(records));
    } catch (error) {
      statusMessage.textContent = `Hay ofertas caducadas, pero no se pudo guardar el cambio local: ${error instanceof Error ? error.message : 'error desconocido'}`;
      statusMessage.classList.add('is-error');
    }
  }
  try {
    const storedCandidates: unknown = JSON.parse(localStorage.getItem(candidateStorageKey) || '[]');
    const storedHistory: unknown = JSON.parse(localStorage.getItem(candidateHistoryStorageKey) || '[]');
    if (!Array.isArray(storedCandidates) || !Array.isArray(storedHistory)) {
      throw new Error('El historial local de candidatos no tiene el formato esperado.');
    }
    if (storedCandidates.some((record) => !isCandidateRecord(record))) {
      throw new Error('Hay candidatos locales con registros incompletos.');
    }
    if (storedHistory.some((entry) => !isCandidateHistoryEntry(entry))) {
      throw new Error('Hay entradas de historial local incompletas.');
    }
    candidateRecords = storedCandidates;
    candidateHistory = storedHistory;
  } catch (error) {
    candidateImportStatus.textContent = `No se pudieron leer los candidatos guardados: ${error instanceof Error ? error.message : 'error desconocido'}`;
    candidateImportStatus.classList.add('is-error');
  }

  const setMessage = (message: string, isError = false) => {
    statusMessage.textContent = message;
    statusMessage.classList.toggle('is-error', isError);
    statusMessage.classList.toggle('is-success', !isError);
  };

  const persist = (next: Offer[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      records = next;
      renderRecords();
      renderImportedOffers();
      return true;
    } catch (error) {
      setMessage(`No se pudieron guardar los cambios en este navegador: ${error instanceof Error ? error.message : 'error desconocido'}`, true);
      return false;
    }
  };

  const input = (id: string) => getElement<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`);
  const checkbox = (id: string) => getElement<HTMLInputElement>(`#${id}`);
  const formStatus = () => input('status').value as OfferStatus;
  const currentExisting = () => records.find((offer) => offer.id === idInput.value);

  function renderPromoImages() {
    promoImagesList.replaceChildren();
    promoImages.forEach((image, index) => {
      const item = document.createElement('article');
      item.className = 'promo-image-item';
      const thumbnail = document.createElement('img');
      thumbnail.src = image.url;
      thumbnail.alt = image.isPrimary ? 'Imagen principal de la oferta' : `Imagen adicional ${index + 1}`;
      const label = document.createElement('small');
      label.textContent = image.isPrimary ? 'Imagen principal · se usará en Telegram' : `Imagen ${index + 1}`;
      const actions = document.createElement('div');
      actions.className = 'promo-image-actions';
      if (!image.isPrimary) actions.append(button('Hacer principal', () => {
        promoImages = promoImages.map((item, itemIndex) => ({ ...item, isPrimary: itemIndex === index }));
        renderPromoImages();
        renderPromoPreview();
      }));
      if (index > 0) actions.append(button('←', () => {
        const reordered = [...promoImages];
        [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
        promoImages = reordered.map((item, order) => ({ ...item, order }));
        renderPromoImages();
        renderPromoPreview();
      }));
      if (index < promoImages.length - 1) actions.append(button('→', () => {
        const reordered = [...promoImages];
        [reordered[index + 1], reordered[index]] = [reordered[index], reordered[index + 1]];
        promoImages = reordered.map((item, order) => ({ ...item, order }));
        renderPromoImages();
        renderPromoPreview();
      }));
      actions.append(button('Eliminar', () => {
        promoImages = promoImages
          .filter((_, itemIndex) => itemIndex !== index)
          .map((item, order) => ({ ...item, order, isPrimary: order === 0 }));
        renderPromoImages();
        renderPromoPreview();
      }, 'secondary-btn danger-btn'));
      item.append(thumbnail, label, actions);
      promoImagesList.append(item);
    });
    promoImagesStatus.textContent = `${promoImages.length} de 6 imágenes asociadas. La selección se guardará únicamente con esta oferta.`;
    promoImagesStatus.classList.remove('is-error');
  }

  function renderPromoPreview() {
    promoPreview.replaceChildren();
    const content = document.createElement('div');
    content.className = 'promo-preview-content';
    const primary = promoImages.find((image) => image.isPrimary) || promoImages[0];
    const image = document.createElement('img');
    image.className = 'promo-preview-main-image';
    image.alt = 'Imagen principal de previsualización';
    if (primary) image.src = primary.url;
    else image.alt = 'Añade una imagen para previsualizar el producto';
    content.append(image);
    const details = document.createElement('div');
    const title = input('promo-title').value.trim();
    const heading = document.createElement('h4');
    heading.textContent = `🔥 ${title || 'Nombre del producto'}`;
    const priceLine = document.createElement('p');
    const price = parseAliExpressPrice(input('promo-price').value);
    const currency = input('promo-currency').value.trim().toUpperCase();
    priceLine.textContent = price && /^[A-Z]{3}$/.test(currency)
      ? `💰 ${formatMoney(price, currency)}`
      : price ? `💰 ${price} ${currency}`.trim() : '💰 Precio pendiente';
    const linkLine = document.createElement('p');
    linkLine.textContent = '🔗 Haz clic y compra:';
    const affiliateUrl = input('promo-affiliate-url').value.trim();
    if (isHttpUrl(affiliateUrl)) {
      const link = document.createElement('a');
      link.href = affiliateUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow sponsored';
      link.textContent = affiliateUrl;
      linkLine.append(document.createElement('br'), link);
    } else {
      const missing = document.createElement('strong');
      missing.className = 'affiliate-missing';
      missing.textContent = 'FALTA ENLACE DE AFILIADO';
      linkLine.append(document.createElement('br'), missing);
    }
    const state = document.createElement('span');
    state.className = 'state-badge draft';
    state.textContent = 'BORRADOR · sin publicar';
    details.append(heading, priceLine, linkLine, state);
    content.append(details);
    promoPreview.append(content);
    if (promoImages.length > 1) {
      const additional = document.createElement('div');
      additional.className = 'promo-preview-thumbnails';
      promoImages.filter((item) => !item.isPrimary).forEach((item, index) => {
        const thumbnail = document.createElement('img');
        thumbnail.src = item.url;
        thumbnail.alt = `Imagen adicional ${index + 1}`;
        additional.append(thumbnail);
      });
      promoPreview.append(additional);
    }
  }

  function renderTelegramImages(offer: Offer) {
    telegramImagesPreview.replaceChildren();
    const images = Array.isArray(offer.images)
      ? [...offer.images].sort((left, right) => left.order - right.order)
      : offer.image ? [{ url: offer.image, isPrimary: true, order: 0 }] : [];
    for (const [index, item] of images.entries()) {
      const image = document.createElement('img');
      image.src = item.url;
      image.alt = item.isPrimary ? 'Imagen principal para Telegram' : `Imagen adicional para Telegram ${index}`;
      telegramImagesPreview.append(image);
    }
  }

  const collectOffer = (existing?: Offer): Offer => {
    const title = input('title').value.trim();
    const storeChoice = input('store-select').value;
    const store = storeChoice === 'other' ? input('store-custom').value.trim() : storeChoice;
    const category = input('category').value;
    const subcategory = input('subcategory').value.trim();
    const promotionEndDate = input('promotion-end-date').value || null;
    const availabilityStatus = input('availability-status').value as Offer['availabilityStatus'];
    const currentPrice = Number(input('current-price').value);
    const previousPriceText = input('previous-price').value.trim();
    const previousPrice = previousPriceText ? Number(previousPriceText) : undefined;
    const previousPriceVerified = checkbox('previous-price-verified').checked;
    const verified = checkbox('verified').checked;
    const sourceUrl = input('source-url').value.trim();
    const affiliateUrl = input('affiliate-url').value.trim();
    const chosenStatus = formStatus();
    const slug = createSlug(input('slug').value.trim() || title);
    const expiresAt = input('expires-at').value || undefined;
    const publishedAt = input('published-at').value || existing?.publishedAt || today();
    const lastVerifiedAt = verified ? new Date().toISOString() : undefined;
    const image = input('image').value.trim() || editorImages.find((item) => item.isPrimary)?.url || undefined;
    const currency = input('currency').value.trim().toUpperCase();
    const tags = input('tags').value.split(',').map((tag) => tag.trim()).filter(Boolean);
    const promoItemsOffer = tags.includes('aliexpress-promo-items');

    const errors: string[] = [];
    if (!title) errors.push('Escribe el nombre del producto.');
    if (!store) errors.push('Indica la tienda.');
    if (!OFFER_CATEGORIES.some((item) => item.slug === category)) errors.push('Elige una categoría válida.');
    if (chosenStatus !== 'draft' && chosenStatus !== 'expired') {
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) errors.push('Indica un precio actual mayor que cero.');
      if (!isHttpUrl(sourceUrl) && !(promoItemsOffer && isHttpUrl(affiliateUrl))) errors.push('Añade una URL de oferta válida (http o https).');
      if (!verified) errors.push('Marca que has comprobado los datos antes de publicar.');
      if ((promoItemsOffer || chosenStatus === 'published') && !isHttpUrl(affiliateUrl)) errors.push('Para verificar o publicar esta oferta, añade su enlace de afiliación real.');
      if (!input('short-description').value.trim()) errors.push('Añade un resumen editorial.');
      if (!input('description').value.trim()) errors.push('Añade una descripción editorial.');
    }
    if (sourceUrl && !isHttpUrl(sourceUrl)) errors.push('La URL de oferta debe ser válida y no contener credenciales.');
    if (affiliateUrl && !isHttpUrl(affiliateUrl)) errors.push('La URL afiliada debe ser válida y no contener credenciales.');
    if (previousPriceText && (!Number.isFinite(previousPrice) || !previousPrice || previousPrice <= currentPrice)) errors.push('El precio anterior debe ser superior al precio actual.');
    if (previousPriceVerified && !previousPrice) errors.push('Introduce un precio anterior antes de marcarlo como comprobado.');
    if (!isCalendarDate(publishedAt)) errors.push('Indica una fecha de publicación válida.');
    if (expiresAt && !isCalendarDate(expiresAt)) errors.push('La fecha de caducidad no es válida.');
    if (expiresAt && publishedAt && expiresAt < publishedAt) errors.push('La fecha de caducidad no puede ser anterior a la publicación.');
    if (promotionEndDate && !isCalendarDate(promotionEndDate)) errors.push('La fecha de finalización de la promoción no es válida.');
    if (chosenStatus === 'published' && expiresAt && expiresAt < today()) errors.push('No se puede publicar una oferta caducada.');
    if (!slug) errors.push('El título no genera un slug válido.');
    if (currency && !/^[A-Z]{3}$/.test(currency)) errors.push('La moneda debe ser un código ISO 4217 de tres letras.');
    if (chosenStatus !== 'draft' && currentPrice > 0 && !/^[A-Z]{3}$/.test(currency)) errors.push('Indica un código de moneda válido antes de verificar o publicar.');
    if (image && !isSafeOfferImage(image)) errors.push('La imagen debe ser una imagen local válida o una URL http(s) válida.');

    const duplicateSlug = records.some((offer) => offer.slug === slug && offer.id !== existing?.id);
    if (duplicateSlug) errors.push('Ya existe otra oferta con ese slug.');
    if (errors.length) throw new Error(errors.join(' '));

    const priceChanged = Boolean(existing && (existing.currentPrice !== currentPrice
      || (existing.currency || 'EUR') !== (currency || 'EUR')));
    const checkedNow = Boolean(existing && (refreshOfferId === existing.id || priceChanged));
    const updatedPrice = existing && checkedNow
      ? recordOfferPriceChange(existing, currentPrice, currency || 'EUR')
      : existing || {};
    return {
      ...updatedPrice,
      id: existing?.id || `offer-${crypto.randomUUID()}`,
      title,
      slug,
      store,
      category,
      ...(image ? { image } : {}),
      ...(editorImages.length ? { images: editorImages.map((item, order) => ({ ...item, order })) } : existing?.images ? { images: existing.images } : {}),
      currentPrice,
      ...(currency ? { currency } : existing?.currency ? { currency: existing.currency } : {}),
      ...(previousPrice ? { previousPrice } : {}),
      previousPriceVerified: Boolean(previousPrice && previousPriceVerified),
      discount: previousPriceVerified ? calculateDiscount(currentPrice, previousPrice, true) : null,
      coupon: input('coupon').value.trim(),
      conditions: input('conditions').value.trim(),
      seller: input('seller').value.trim(),
      description: input('description').value.trim(),
      shortDescription: input('short-description').value.trim(),
      sourceUrl,
      affiliateUrl,
      publishedAt,
      ...(expiresAt ? { expiresAt } : {}),
      subcategory,
      promotionEndDate,
      availabilityStatus: availabilityStatus || existing?.availabilityStatus || (chosenStatus === 'draft' ? 'draft' : 'active'),
      ...(checkedNow ? { lastCheckedAt: updatedPrice.lastCheckedAt } : existing?.lastCheckedAt ? { lastCheckedAt: existing.lastCheckedAt } : {}),
      ...(lastVerifiedAt ? { lastVerifiedAt } : existing?.lastVerifiedAt ? { lastVerifiedAt: existing.lastVerifiedAt } : {}),
      status: chosenStatus,
      featured: checkbox('featured').checked,
      featuredToday: checkbox('featured-today').checked,
      verified,
      demo: false,
      score: existing?.score || 0,
      tags,
      ...(existing?.trackingId ? { trackingId: existing.trackingId } : {}),
      ...(existing?.promoLanguage ? { promoLanguage: existing.promoLanguage } : {})
    };
  };

  const setForm = (offer?: Offer) => {
    form.reset();
    idInput.value = offer?.id || '';
    getElement<HTMLHeadingElement>('#form-heading').textContent = offer ? `Editando: ${offer.title}` : 'Nueva oferta';
    const values: Record<string, string> = {
      title: offer?.title || '',
      slug: offer?.slug || '',
      seller: offer?.seller || '',
      category: offer?.category || '',
      image: offer?.image?.startsWith('data:') ? '' : offer?.image || '',
      'current-price': offer?.currentPrice ? String(offer.currentPrice) : '',
      currency: offer?.currency || 'EUR',
      'previous-price': offer?.previousPrice ? String(offer.previousPrice) : '',
      coupon: offer?.coupon || '',
      conditions: offer?.conditions || '',
      'short-description': offer?.shortDescription || '',
      description: offer?.description || '',
      'source-url': offer?.sourceUrl || '',
      'affiliate-url': offer?.affiliateUrl || '',
      'published-at': offer?.publishedAt || '',
      'expires-at': offer?.expiresAt || '',
      'promotion-end-date': offer?.promotionEndDate || '',
      'availability-status': offer?.availabilityStatus || (offer?.status === 'published' || offer?.status === 'verified' ? 'active' : 'draft'),
      subcategory: offer?.subcategory || '',
      status: offer?.status || 'draft',
      tags: offer?.tags.join(', ') || ''
    };
    for (const [key, value] of Object.entries(values)) input(key).value = value;
    editorImages = offer?.images
      ? [...offer.images].sort((left, right) => left.order - right.order).map((item) => ({ ...item }))
      : offer?.image ? [{ url: offer.image, isPrimary: true, order: 0 }] : [];
    const knownStore = ['Amazon España', 'AliExpress'].includes(offer?.store || '');
    input('store-select').value = offer?.store && knownStore ? offer.store : offer?.store ? 'other' : '';
    input('store-custom').value = offer?.store && !knownStore ? offer.store : '';
    getElement<HTMLInputElement>('#store-custom').hidden = input('store-select').value !== 'other';
    checkbox('previous-price-verified').checked = Boolean(offer?.previousPriceVerified);
    checkbox('verified').checked = Boolean(offer?.verified);
    checkbox('featured').checked = Boolean(offer?.featured);
    checkbox('featured-today').checked = Boolean(offer?.featuredToday);
    output.value = '';
    telegramStatus.textContent = '';
    telegramImagesPreview.replaceChildren();
    renderPromoImages();
    titleInput.focus();
  };

  const button = (label: string, action: () => void, className = 'secondary-btn') => {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = className;
    control.textContent = label;
    control.addEventListener('click', action);
    return control;
  };

  const persistCandidates = (next: CandidateRecord[]) => {
    try {
      localStorage.setItem(candidateStorageKey, JSON.stringify(next));
      candidateRecords = next;
      renderFoundCandidates();
      return true;
    } catch (error) {
      candidateImportStatus.textContent = `No se pudieron guardar los candidatos: ${error instanceof Error ? error.message : 'error desconocido'}`;
      candidateImportStatus.classList.add('is-error');
      return false;
    }
  };

  const persistCandidateHistory = (entries: CandidateHistoryEntry[]) => {
    try {
      localStorage.setItem(candidateHistoryStorageKey, JSON.stringify(entries));
      candidateHistory = entries;
      renderCandidateHistory();
    } catch (error) {
      candidateImportStatus.textContent = `No se pudo guardar el historial: ${error instanceof Error ? error.message : 'error desconocido'}`;
      candidateImportStatus.classList.add('is-error');
    }
  };

  function renderCandidateHistory() {
    candidateHistoryList.replaceChildren();
    const recent = [...candidateHistory].reverse().slice(0, 30);
    if (!recent.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Todavía no hay búsquedas ni importaciones.';
      candidateHistoryList.append(empty);
      return;
    }
    for (const entry of recent) {
      const row = document.createElement('article');
      row.className = 'candidate-result';
      const text = document.createElement('p');
      const productPrice = Number.isFinite(entry.price)
        ? ` · ${formatCandidateCurrency(entry.price, entry.currency)}`
        : '';
      text.textContent = `${new Date(entry.date).toLocaleString('es-ES')} · ${entry.source}${entry.product ? ` · ${entry.product}` : ' · Búsqueda de fuente'}${productPrice} · ${entry.status}`;
      row.append(text);
      candidateHistoryList.append(row);
    }
  }

  function renderFoundCandidates() {
    foundCandidatesList.replaceChildren();
    const filters = {
      minScore: Number(getElement<HTMLInputElement>('#candidate-min-score').value),
      minDiscount: Number(getElement<HTMLInputElement>('#candidate-min-discount').value),
      maxPrice: getElement<HTMLInputElement>('#candidate-max-price').value || null,
      categories: getElement<HTMLInputElement>('#candidate-categories').value
        .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
    };
    const shortlist = new Set(selectTopCandidates(
      candidateRecords.filter((record) => record.status !== 'discarded' && record.candidate.demo !== true).map((record) => record.candidate),
      filters
    ).map(({ candidate }) => candidate.id));

    if (!candidateRecords.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Importa un feed autorizado para mostrar candidatos. No hay búsqueda automática configurada.';
      foundCandidatesList.append(empty);
      return;
    }

    for (const record of candidateRecords) {
      const { candidate } = record;
      const recordId = record.recordId || candidate.id;
      const card = document.createElement('article');
      card.className = 'candidate-result';
      const title = document.createElement('h3');
      title.textContent = `${candidate.title}${candidate.demo ? ' · DEMO' : ''}`;
      const details = document.createElement('p');
      details.textContent = `${candidate.store} · ${formatCandidateCurrency(candidate.currentPrice, candidate.currency)} · ${candidate.discount === null ? 'Sin descuento verificable' : `${candidate.discount} %`} · ${candidate.category} · ${candidate.source} · ${candidate.available ? 'Disponible según la fuente' : 'No disponible'} · Puntuación ${record.score}/100 · ${record.status}${shortlist.has(candidate.id) ? ' · En selección' : ''}`;
      const verifiedAt = document.createElement('p');
      verifiedAt.textContent = `Última comprobación: ${record.lastVerifiedAt ? new Date(record.lastVerifiedAt).toLocaleString('es-ES') : 'pendiente'}`;
      const explanation = document.createElement('ul');
      for (const reason of record.scoreExplanation) {
        const item = document.createElement('li');
        item.textContent = reason;
        explanation.append(item);
      }
      card.append(title, details, verifiedAt);
      if (record.rejectionReason) {
        const rejected = document.createElement('p');
        rejected.className = 'is-error';
        rejected.textContent = `Descartada: ${record.rejectionReason}`;
        card.append(rejected);
      }
      if (record.verificationNotes.length) {
        const notes = document.createElement('p');
        notes.textContent = record.verificationNotes.join(' ');
        card.append(notes);
      }
      card.append(explanation);

      if (isHttpUrl(candidate.sourceUrl)) {
        const link = document.createElement('a');
        link.href = candidate.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Ver producto en origen';
        card.append(link);
      }
      const actions = document.createElement('div');
      actions.className = 'admin-record-actions';
      if (isHttpUrl(candidate.sourceUrl)) {
        actions.append(button('VER', () => window.open(candidate.sourceUrl, '_blank', 'noopener,noreferrer')));
      }
      actions.append(button('VERIFICAR', () => {
        const result = verifyCandidate(candidate);
        if (!result.valid) {
          const updated = candidateRecords.map((item) => (item.recordId || item.candidate.id) === recordId
            ? { ...item, status: 'rejected' as const, rejectionReason: result.errors.join(' '), verificationNotes: result.verificationNotes }
            : item);
          persistCandidates(updated);
          setMessage(`No se pudo verificar el candidato: ${result.errors.join(' ')}`, true);
          return;
        }
        if (candidate.demo || !window.confirm('Abre la URL del producto y comprueba manualmente el precio, disponibilidad y condiciones actuales. ¿Confirmas que los has revisado?')) return;
        const checked = new Date().toISOString();
        const verifiedCandidate: OfferCandidate = {
          ...candidate,
          verified: true,
          checkedAt: checked,
          lastVerifiedAt: checked,
          verificationNotes: [...result.verificationNotes, 'La persona operadora confirma haber revisado precio, disponibilidad y condiciones en el origen.']
        };
        const score = scoreCandidate(verifiedCandidate);
        const updated = candidateRecords.map((item) => (item.recordId || item.candidate.id) === recordId
          ? { ...item, candidate: verifiedCandidate, status: 'verified' as const, score: score.score, scoreExplanation: score.explanation, verificationNotes: verifiedCandidate.verificationNotes, lastVerifiedAt: checked, rejectionReason: undefined }
          : item);
        if (persistCandidates(updated)) {
          persistCandidateHistory(appendCandidateHistory(candidateHistory, [verifiedCandidate], 'verificada manualmente', checked));
          setMessage('Candidato verificado manualmente. Aún no se ha publicado; puedes aprobarlo como borrador local.');
        }
      }));
      actions.append(button('EDITAR', () => {
        const existing = records.find((offer) => offer.id === record.offerId);
        const draft = existing || createOffer(candidate, {
          category: candidate.category,
          affiliateUrl: candidate.affiliateUrl || '',
          score: record.score
        });
        setForm(draft);
        getElement<HTMLFormElement>('#offer-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
      const canApprove = record.status === 'verified' && candidate.verified && !candidate.demo;
      const approve = button('APROBAR', () => {
        if (!canApprove) return;
        try {
          const draft = createOffer(candidate, {
            category: candidate.category,
            affiliateUrl: candidate.affiliateUrl || '',
            score: record.score
          });
          const next = [...records, draft];
          if (!persist(next)) return;
          const updated = candidateRecords.map((item) => (item.recordId || item.candidate.id) === recordId
            ? { ...item, status: 'approved' as const, offerId: draft.id }
            : item);
          persistCandidates(updated);
          setForm(draft);
          setMessage('Aprobado como borrador local. Completa la descripción editorial y vuelve a comprobar la oferta; no se ha publicado.');
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'No se pudo crear el borrador.', true);
        }
      }, 'primary-btn');
      approve.disabled = !canApprove;
      approve.title = canApprove ? 'Crear un borrador local; no publica ni envía.' : 'Requiere verificación manual y no ser DEMO.';
      actions.append(approve);
      const discard = button('DESCARTAR', () => {
        const updated = candidateRecords.map((item) => (item.recordId || item.candidate.id) === recordId
          ? { ...item, status: 'discarded' as const, rejectionReason: 'Descartada manualmente.' }
          : item);
        if (persistCandidates(updated)) {
          persistCandidateHistory(appendCandidateHistory(candidateHistory, [candidate], 'descartada', new Date().toISOString()));
        }
      }, 'secondary-btn danger-btn');
      actions.append(discard);
      card.append(actions);
      foundCandidatesList.append(card);
    }
  }

  const updateRecord = (updated: Offer) => persist(records.map((offer) => offer.id === updated.id ? updated : offer));

  function renderRecords() {
    list.replaceChildren();
    const visible = filterAndSortOffers(records, { state: filter.value === 'expired' ? 'promotion_expired' : filter.value });
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No hay ofertas para este filtro.';
      list.append(empty);
      return;
    }

    for (const offer of visible) {
      const card = document.createElement('article');
      card.className = 'admin-record';
      const details = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = offer.title || '(Sin título)';
      const discountValue = calculateDiscount(offer.currentPrice, offer.previousPrice, offer.previousPriceVerified);
      const discount = discountValue ? ` · ${discountValue}%` : '';
      const checked = offer.lastVerifiedAt ? ` · Comprobada: ${offer.lastVerifiedAt.slice(0, 10)}` : ' · Sin comprobar';
      const summary = document.createElement('p');
      summary.textContent = `${offer.store || 'Tienda sin indicar'} · ${formatMoney(offer.currentPrice || 0, offer.currency || 'EUR')}${discount} · ${getOfferStatusLabel(getOfferState(offer))} · ${offer.verified ? 'Verificada' : 'No verificada'} · Publicada: ${offer.publishedAt || 'sin fecha'}${checked}${offer.demo ? ' · DEMO' : ''}`;
      details.append(title, summary);
      if (isHttpUrl(offer.affiliateUrl)) {
        const affiliate = document.createElement('a');
        affiliate.href = offer.affiliateUrl;
        affiliate.target = '_blank';
        affiliate.rel = 'noopener noreferrer nofollow sponsored';
        affiliate.textContent = 'Abrir enlace afiliado';
        details.append(affiliate);
      } else {
        const missingAffiliate = document.createElement('p');
        missingAffiliate.textContent = 'Sin enlace afiliado';
        details.append(missingAffiliate);
      }

      const actions = document.createElement('div');
      actions.className = 'admin-record-actions';
      actions.append(button('Editar', () => {
        if (offer.demo) {
          setMessage('Los ejemplos DEMO están protegidos. Duplícalos para crear un borrador limpio.', true);
          return;
        }
        setForm(offer);
      }));
      if (!offer.demo && getOfferState(offer) !== 'expired' && offer.status !== 'published') {
        actions.append(button('Verificar', () => {
          const result = verifyOffer(offer);
          if (!result.valid || !result.offer) {
            setMessage(`No se puede verificar: ${result.errors.join(' ')}`, true);
            return;
          }
          if (updateRecord(result.offer)) setMessage('Oferta verificada. Revisa los datos y publícala manualmente cuando tenga enlace afiliado.');
        }));
      }
      if (offer.status === 'verified' && offer.verified && !offer.demo) {
        actions.append(button('Publicar', () => {
          try {
            const published = publishOffer(offer);
            if (updateRecord(published)) setMessage('Oferta publicada en el catálogo local. Exporta el JSON y despliega para reflejarlo en la web.');
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo publicar la oferta.', true);
          }
        }, 'primary-btn'));
      }
      if (offer.status === 'published') {
        actions.append(button('Despublicar', () => {
          if (updateRecord({ ...offer, status: 'draft' })) setMessage('Oferta despublicada en el catálogo local. Exporta y despliega el catálogo para aplicarlo.');
        }));
      }
      const canSendToTelegram = !offer.demo
        && offer.verified === true
        && offer.status === 'published'
        && !isExpired(offer)
        && isHttpUrl(offer.affiliateUrl || '');
      const sendButton = button('ENVIAR A TELEGRAM', () => {
        try {
          const preview = generateTelegramPost(offer);
          pendingTelegramAction = { action: 'offer', offer };
          telegramPreview.textContent = preview;
          telegramSendButton.textContent = 'Confirmar envío';
          telegramDialog.showModal();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'No se pudo preparar el envío.', true);
        }
      }, 'primary-btn');
      sendButton.disabled = !canSendToTelegram;
      sendButton.title = canSendToTelegram
        ? 'Previsualizar y confirmar el envío al canal.'
        : 'Requiere una oferta no DEMO, verificada, publicada, vigente y con enlace afiliado válido.';
      actions.append(sendButton);
      actions.append(
        button('Duplicar', () => {
          const id = `offer-${crypto.randomUUID()}`;
          const duplicate: Offer = offer.demo
            ? {
                id, title: '', slug: '', store: '', category: '', currentPrice: 0, conditions: '',
                seller: '', description: '', shortDescription: '', sourceUrl: '', affiliateUrl: '',
                publishedAt: today(), status: 'draft', verified: false, featured: false, demo: false,
                previousPriceVerified: false, score: 0, tags: [], coupon: ''
              }
            : { ...offer, id, slug: `${offer.slug}-copia`, title: `${offer.title} (copia)`, status: 'draft', verified: false, lastVerifiedAt: undefined, demo: false };
          if (!offer.demo && records.some((item) => item.slug === duplicate.slug)) duplicate.slug = `${offer.slug}-copia-${Date.now()}`;
          if (persist([...records, duplicate])) {
            setMessage('Se ha creado un borrador. Revisa todos los datos antes de verificarlo.');
            setForm(duplicate);
          }
        }),
        button('Eliminar', () => {
          if (!window.confirm(`¿Eliminar «${offer.title}» del almacenamiento de este navegador?`)) return;
          if (persist(records.filter((item) => item.id !== offer.id))) {
            if (idInput.value === offer.id) setForm();
            setMessage('Oferta eliminada del navegador. Exporta el JSON para reflejarlo en el catálogo.');
          }
        }, 'secondary-btn danger-btn')
      );
      card.append(details, actions);
      list.append(card);
    }
  }

  const importCandidateBatch = (candidates: OfferCandidate[]) => {
    const filtered = filterCandidates(candidates, {
      existingCandidates: candidateRecords.map((record) => record.candidate),
      existingOffers: records
    });
    const checkedAt = new Date().toISOString();
    const newRecords: CandidateRecord[] = [
      ...filtered.accepted.map((candidate) => {
        const result = scoreCandidate(candidate);
        return {
          recordId: candidate.id,
          candidate,
          status: 'pending' as const,
          score: result.score,
          scoreExplanation: result.explanation,
          verificationNotes: [],
          lastVerifiedAt: null
        };
      }),
      ...filtered.rejected.map(({ candidate, reason }, index) => {
        const result = scoreCandidate(candidate);
        return {
          recordId: candidateRecords.some((record) => (record.recordId || record.candidate.id) === candidate.id)
            || filtered.accepted.some((item) => item.id === candidate.id)
            || filtered.rejected.slice(0, index).some((item) => item.candidate.id === candidate.id)
            ? `${candidate.id}-duplicate-${Date.now()}-${index}`
            : candidate.id,
          candidate,
          status: 'rejected' as const,
          score: result.score,
          scoreExplanation: result.explanation,
          verificationNotes: [],
          lastVerifiedAt: null,
          rejectionReason: reason
        };
      })
    ];
    if (!persistCandidates([...candidateRecords, ...newRecords])) return;
    const historyEntries = [
      ...filtered.accepted.map((candidate) => ({ candidate, status: 'pendiente de revisión' })),
      ...filtered.rejected.map(({ candidate, reason }) => ({ candidate, status: `descartado: ${reason}` }))
    ];
    for (const entry of historyEntries) {
      candidateHistory = appendCandidateHistory(candidateHistory, [entry.candidate], entry.status, checkedAt);
    }
    persistCandidateHistory(candidateHistory);
    candidateImportStatus.textContent = `Importados ${filtered.accepted.length} candidatos pendientes; ${filtered.rejected.length} descartados por filtros o duplicados. Ninguno se ha publicado.`;
    candidateImportStatus.classList.remove('is-error');
    setMessage('Candidatos añadidos al panel local; no se ha publicado ni enviado nada.');
  };

  function renderImportedOffers() {
    importedOffersTable.replaceChildren();
    const importedRecords = records.filter((offer) =>
      offer.store === 'AliExpress' && offer.tags.some((tag) =>
        tag === 'importacion-rapida' || tag === 'importacion-csv' || tag === 'aliexpress-promo-items')
    );
    const imported = filterAndSortOffers(importedRecords, {
      state: getElement<HTMLSelectElement>('#imported-state-filter').value,
      category: getElement<HTMLSelectElement>('#imported-category-filter').value,
      subcategory: getElement<HTMLInputElement>('#imported-subcategory-filter').value.trim() || 'all',
      featuredToday: getElement<HTMLInputElement>('#imported-today-filter').checked,
      featured: getElement<HTMLInputElement>('#imported-featured-filter').checked,
      promotionDate: getElement<HTMLSelectElement>('#imported-promotion-filter').value,
      needsUpdate: getElement<HTMLInputElement>('#imported-review-filter').checked,
      sort: getElement<HTMLSelectElement>('#imported-sort').value
    });
    importedOffersEmpty.hidden = imported.length > 0;
    for (const offer of imported) {
      const row = document.createElement('tr');
      const productCell = document.createElement('th');
      productCell.scope = 'row';
      productCell.textContent = offer.title || '(Sin título)';
      const priceCell = document.createElement('td');
      priceCell.textContent = offer.currentPrice > 0 ? formatMoney(offer.currentPrice, offer.currency || 'EUR') : 'Pendiente';
      const lastPrice = offer.priceHistory?.at(-2);
      if (lastPrice) {
        const oldPrice = document.createElement('small');
        oldPrice.textContent = `Anterior: ${formatMoney(lastPrice.price, lastPrice.currency)}`;
        priceCell.append(document.createElement('br'), oldPrice);
      }
      const categoryCell = document.createElement('td');
      categoryCell.textContent = `${OFFER_CATEGORIES.find((category) => category.slug === offer.category)?.label || CATEGORIES.find((category) => category.slug === offer.category)?.label || 'Sin categoría'}${offer.subcategory ? ` · ${offer.subcategory}` : ''}`;
      const statusCell = document.createElement('td');
      const availability = getAvailabilityState(offer);
      statusCell.textContent = `${availability === 'active' ? '🟢' : availability === 'price_update' ? '🟠' : availability === 'promotion_expired' ? '🔴' : availability === 'out_of_stock' || availability === 'archived' ? '⚫' : availability === 'unavailable' ? '⚪' : '📝'} ${AVAILABILITY_LABELS[availability]}`;
      const promotionCell = document.createElement('td');
      promotionCell.textContent = offer.promotionEndDate
        ? `${formatDateForSpain(offer.promotionEndDate)}${availability === 'promotion_expired' ? ' · 🔴 PROMOCIÓN CADUCADA' : ''}`
        : '—';
      const checkedCell = document.createElement('td');
      checkedCell.textContent = formatDateForSpain(offer.lastCheckedAt || offer.lastVerifiedAt);
      const dayCell = document.createElement('td');
      dayCell.textContent = offer.featuredToday ? '🔥 Sí' : '—';
      const featuredCell = document.createElement('td');
      featuredCell.textContent = offer.featured ? '⭐ Sí' : '—';
      const actionsCell = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'admin-record-actions';
      actions.append(button('Editar', () => {
        setForm(offer);
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
      actions.append(button('Actualizar', () => {
        if (offer.status === 'published' && !window.confirm('Actualizar esta oferta activa puede cambiar su precio o disponibilidad. ¿Continuar?')) return;
        refreshOfferId = offer.id;
        setForm(offer);
        setMessage('Edita los datos comprobados y guarda para registrar el precio y la fecha de actualización.');
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
      if (availability === 'active') {
        actions.append(button('Necesita revisión', () => {
          if (updateRecord({ ...offer, availabilityStatus: 'price_update' })) setMessage('Oferta marcada para revisar precio y disponibilidad.');
        }));
      }
      if (!offer.demo && offer.status !== 'expired' && offer.status !== 'published' && availability !== 'active') {
        actions.append(button('Verificar', () => {
          if (!window.confirm('Comprueba manualmente en AliExpress el precio, la disponibilidad, el enlace afiliado y las condiciones. ¿Confirmas que lo has revisado ahora?')) return;
          const result = verifyOffer(offer);
          if (!result.valid || !result.offer) {
            setMessage(`No se puede verificar todavía: ${result.errors.join(' ')}`, true);
            return;
          }
          if (updateRecord(result.offer)) setMessage('Oferta verificada. Revisa la ficha antes de publicarla.');
        }));
      }
      const hasAffiliateUrl = isHttpUrl(offer.affiliateUrl || '');
      const canPublish = offer.status === 'verified' && offer.verified && hasAffiliateUrl && !offer.demo && availability === 'active';
      const publishButton = button('Publicar', () => {
        try {
          if (updateRecord(publishOffer(offer))) setMessage('Oferta publicada en el catálogo local. Exporta el JSON y despliega para aplicar el cambio.');
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'No se pudo publicar la oferta.', true);
        }
      }, 'primary-btn');
      publishButton.disabled = !canPublish;
      publishButton.title = canPublish ? 'Publicar esta oferta manualmente.' : !hasAffiliateUrl
        ? 'FALTA ENLACE DE AFILIADO.'
        : 'Verifica la oferta antes de publicarla.';
      actions.append(publishButton);
      if (offer.verified) {
        actions.append(button('GENERAR TELEGRAM', () => {
          try {
            const telegramDraft = generateTelegramDraft(offer);
            output.value = telegramDraft.text;
            renderTelegramImages(offer);
            telegramStatus.textContent = `Borrador preparado con ${telegramDraft.images.length} imagen(es). No se ha enviado a Telegram.`;
            output.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo generar el borrador de Telegram.', true);
          }
        }, 'secondary-btn'));
      }
      actions.append(button('Descartar', () => {
        if (!window.confirm(`¿Descartar «${offer.title}» del almacenamiento local?`)) return;
        if (persist(records.filter((item) => item.id !== offer.id))) setMessage('Oferta descartada del panel local.');
      }, 'secondary-btn danger-btn'));
      actionsCell.append(actions);
      const setAvailability = (next: NonNullable<Offer['availabilityStatus']>, label: string) => {
        if (availability === 'active' && !window.confirm(`La oferta está activa. ¿Confirmas que quieres marcarla como «${label}»?`)) return;
        if (updateRecord({ ...offer, availabilityStatus: next, lastCheckedAt: new Date().toISOString() })) setMessage(`Oferta marcada como ${label.toLocaleLowerCase('es-ES')}.`);
      };
      actions.append(
        button('Marcar caducada', () => setAvailability('promotion_expired', 'Promoción caducada'), 'secondary-btn'),
        button('Sin existencias', () => setAvailability('out_of_stock', 'Sin existencias'), 'secondary-btn'),
        button('No disponible', () => setAvailability('unavailable', 'No disponible'), 'secondary-btn'),
        button('Archivar', () => setAvailability('archived', 'Archivada'), 'secondary-btn')
      );
      row.append(productCell, priceCell, categoryCell, statusCell, promotionCell, checkedCell, dayCell, featuredCell, actionsCell);
      importedOffersTable.append(row);
    }
    reviewQueue.replaceChildren();
    const needsReview = getOffersNeedingReview(importedRecords);
    if (!needsReview.length) {
      reviewQueue.textContent = 'No hay ofertas pendientes de revisión.';
    } else {
      const reviewList = document.createElement('ul');
      needsReview.forEach((offer) => {
        const item = document.createElement('li');
        item.textContent = `${offer.title} — ${AVAILABILITY_LABELS[getAvailabilityState(offer)]}`;
        reviewList.append(item);
      });
      reviewQueue.append(reviewList);
    }
  }

  const persistExcelProducts = (next: AliExpressExcelProduct[]) => {
    try {
      localStorage.setItem(excelProductsStorageKey, JSON.stringify(next));
      excelProducts = next;
      renderExcelProducts();
      return true;
    } catch (error) {
      excelStatus.textContent = `No se pudieron guardar los productos importados: ${error instanceof Error ? error.message : 'error desconocido'}`;
      excelStatus.classList.add('is-error');
      return false;
    }
  };

  const formatExcelMoney = (value: number | null, currency: string) => {
    if (value === null || !Number.isFinite(value)) return '—';
    try {
      return formatMoney(value, currency || 'EUR');
    } catch {
      return `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value)} ${currency}`;
    }
  };

  function renderExcelPreview() {
    excelPreview.replaceChildren();
    if (!excelPreviewData) {
      excelPreviewWrap.hidden = true;
      return;
    }
    excelPreviewWrap.hidden = false;
    const visible = excelPreviewData.products.slice(0, 250);
    for (const product of visible) {
      const row = document.createElement('tr');
      const selectCell = document.createElement('td');
      const select = document.createElement('input');
      select.type = 'checkbox';
      select.checked = excelPreviewSelected.has(product.sourceRowNumber);
      select.setAttribute('aria-label', `Seleccionar ${product.title}`);
      select.addEventListener('change', () => {
        if (select.checked) excelPreviewSelected.add(product.sourceRowNumber);
        else excelPreviewSelected.delete(product.sourceRowNumber);
      });
      selectCell.append(select);
      const imageCell = document.createElement('td');
      const urls = product.imageUrls || [];
      if (urls.length) {
        const image = document.createElement('img');
        image.src = product.imageUrl;
        image.alt = `Imagen de ${product.title}`;
        image.loading = 'lazy';
        image.className = 'excel-product-thumbnail';
        image.addEventListener('error', () => {
          const warning = document.createElement('small');
          warning.className = 'affiliate-missing';
          warning.textContent = 'Imagen no disponible; la fila se ha conservado.';
          imageCell.replaceChildren(warning);
        }, { once: true });
        imageCell.append(image);
        if (urls.length > 1) {
          const primary = document.createElement('select');
          primary.setAttribute('aria-label', `Imagen principal de ${product.title}`);
          urls.forEach((url, index) => {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = `Imagen ${index + 1}${url === product.imageUrl ? ' · principal' : ''}`;
            primary.append(option);
          });
          primary.addEventListener('change', () => {
            const selectedUrl = urls[Number(primary.value)];
            product.imageUrl = selectedUrl;
            product.additionalImageUrls = urls.filter((url) => url !== selectedUrl);
            renderExcelPreview();
          });
          imageCell.append(primary);
        }
      } else {
        imageCell.textContent = 'Sin imagen';
      }
      const productCell = document.createElement('td');
      productCell.textContent = `${product.title}\nID: ${product.productId}`;
      const priceCell = document.createElement('td');
      priceCell.textContent = formatExcelMoney(product.currentPrice, product.currency);
      const discountCell = document.createElement('td');
      discountCell.textContent = product.discountPercent === null ? '—' : `${product.discountPercent.toFixed(1)} %`;
      const salesCell = document.createElement('td');
      salesCell.textContent = product.sales180d === null ? '—' : String(product.sales180d);
      const ratingCell = document.createElement('td');
      ratingCell.textContent = product.positiveRating === null ? '—' : `${product.positiveRating}%`;
      const commissionPercentCell = document.createElement('td');
      commissionPercentCell.textContent = product.commissionPercent === null ? '—' : `${product.commissionPercent}%`;
      const commissionCell = document.createElement('td');
      commissionCell.textContent = formatExcelMoney(product.estimatedCommission, product.currency);
      const couponCell = document.createElement('td');
      couponCell.textContent = product.coupon || (product.couponValue !== null ? formatExcelMoney(product.couponValue, product.currency) : '—');
      const affiliateCell = document.createElement('td');
      const affiliateLink = document.createElement('a');
      affiliateLink.href = product.affiliateUrl;
      affiliateLink.target = '_blank';
      affiliateLink.rel = 'noopener noreferrer nofollow sponsored';
      affiliateLink.textContent = 'Abrir';
      affiliateCell.append(affiliateLink);
      const rowCell = document.createElement('td');
      rowCell.textContent = String(product.sourceRowNumber);
      row.append(selectCell, imageCell, productCell, priceCell, discountCell, salesCell, ratingCell, commissionPercentCell, commissionCell, couponCell, affiliateCell, rowCell);
      excelPreview.append(row);
    }
  }

  function renderExcelProducts() {
    const categoryFilter = getElement<HTMLSelectElement>('#excel-filter-category').value;
    const minPrice = Number(getElement<HTMLInputElement>('#excel-filter-price-min').value);
    const maxPrice = Number(getElement<HTMLInputElement>('#excel-filter-price-max').value);
    const couponFilter = getElement<HTMLSelectElement>('#excel-filter-coupon').value;
    const videoFilter = getElement<HTMLSelectElement>('#excel-filter-video').value;
    const affiliateFilter = getElement<HTMLSelectElement>('#excel-filter-affiliate').value;
    const telegramFilter = getElement<HTMLSelectElement>('#excel-filter-telegram').value;
    const statusFilter = getElement<HTMLSelectElement>('#excel-filter-status').value;
    const sort = getElement<HTMLSelectElement>('#excel-sort').value;
    const filtered = excelProducts.filter((product) => {
      if (categoryFilter !== 'all' && product.category !== categoryFilter) return false;
      if (Number.isFinite(minPrice) && getElement<HTMLInputElement>('#excel-filter-price-min').value && (product.currentPrice ?? -1) < minPrice) return false;
      if (Number.isFinite(maxPrice) && getElement<HTMLInputElement>('#excel-filter-price-max').value && (product.currentPrice ?? Number.POSITIVE_INFINITY) > maxPrice) return false;
      const hasCoupon = Boolean(product.coupon || product.couponValue !== null);
      if (couponFilter === 'yes' && !hasCoupon || couponFilter === 'no' && hasCoupon) return false;
      if (videoFilter === 'yes' && !product.videoUrl || videoFilter === 'no' && Boolean(product.videoUrl)) return false;
      const hasAffiliate = isHttpUrl(product.affiliateUrl);
      if (affiliateFilter === 'yes' && !hasAffiliate || affiliateFilter === 'no' && hasAffiliate) return false;
      if (telegramFilter === 'yes' && !product.publishedEnTelegram || telegramFilter === 'no' && product.publishedEnTelegram) return false;
      if (statusFilter !== 'all' && product.availabilityStatus !== statusFilter) return false;
      return true;
    }).sort((left, right) => {
      const leftValue = sort === 'sales' ? left.sales180d
        : sort === 'commission' ? left.estimatedCommission
          : sort === 'discount' ? left.discountPercent
            : sort === 'rating' ? left.positiveRating
              : sort === 'price' ? left.currentPrice
                : Date.parse(left.importedAt);
      const rightValue = sort === 'sales' ? right.sales180d
        : sort === 'commission' ? right.estimatedCommission
          : sort === 'discount' ? right.discountPercent
            : sort === 'rating' ? right.positiveRating
              : sort === 'price' ? right.currentPrice
                : Date.parse(right.importedAt);
      return sort === 'price' ? (leftValue ?? Number.POSITIVE_INFINITY) - (rightValue ?? Number.POSITIVE_INFINITY)
        : (rightValue ?? 0) - (leftValue ?? 0);
    });
    excelProductsTable.replaceChildren();
    excelProductsEmpty.hidden = filtered.length > 0;
    for (const product of filtered.slice(0, 500)) {
      const row = document.createElement('tr');
      const titleCell = document.createElement('th');
      titleCell.scope = 'row';
      titleCell.textContent = `${product.title}\n${product.productId}`;
      const categoryCell = document.createElement('td');
      const categorySelect = document.createElement('select');
      categorySelect.setAttribute('aria-label', `Categoría de ${product.title}`);
      const noCategory = document.createElement('option');
      noCategory.value = '';
      noCategory.textContent = 'Sin categoría';
      categorySelect.append(noCategory);
      for (const category of OFFER_CATEGORIES) {
        const option = document.createElement('option');
        option.value = category.slug;
        option.textContent = category.label;
        categorySelect.append(option);
      }
      categorySelect.value = product.category;
      categorySelect.addEventListener('change', () => persistExcelProducts(excelProducts.map((item) => item.productId === product.productId
        ? { ...item, category: categorySelect.value }
        : item)));
      categoryCell.append(categorySelect);
      const subcategoryCell = document.createElement('td');
      const subcategoryInput = document.createElement('input');
      subcategoryInput.type = 'text';
      subcategoryInput.maxLength = 80;
      subcategoryInput.value = product.subcategory;
      subcategoryInput.setAttribute('aria-label', `Subcategoría de ${product.title}`);
      subcategoryInput.addEventListener('change', () => persistExcelProducts(excelProducts.map((item) => item.productId === product.productId
        ? { ...item, subcategory: subcategoryInput.value.trim() }
        : item)));
      subcategoryCell.append(subcategoryInput);
      const tagsCell = document.createElement('td');
      const tagsInput = document.createElement('input');
      tagsInput.type = 'text';
      tagsInput.value = product.tags.join(', ');
      tagsInput.setAttribute('aria-label', `Etiquetas de ${product.title}`);
      tagsInput.placeholder = 'Separadas por comas';
      tagsInput.addEventListener('change', () => {
        const tags = [...new Set(tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean))];
        persistExcelProducts(excelProducts.map((item) => item.productId === product.productId ? { ...item, tags } : item));
      });
      tagsCell.append(tagsInput);
      const priceCell = document.createElement('td');
      priceCell.textContent = formatExcelMoney(product.currentPrice, product.currency);
      const discountCell = document.createElement('td');
      discountCell.textContent = product.discountPercent === null ? '—' : `${product.discountPercent.toFixed(1)} %`;
      const salesCell = document.createElement('td');
      salesCell.textContent = product.sales180d === null ? '—' : String(product.sales180d);
      const ratingCell = document.createElement('td');
      ratingCell.textContent = product.positiveRating === null ? '—' : `${product.positiveRating}%`;
      const commissionRateCell = document.createElement('td');
      commissionRateCell.textContent = product.commissionPercent === null ? '—' : `${product.commissionPercent}%`;
      const commissionCell = document.createElement('td');
      commissionCell.textContent = formatExcelMoney(product.estimatedCommission, product.currency);
      const couponCell = document.createElement('td');
      couponCell.textContent = [product.coupon, product.couponValue === null ? '' : formatExcelMoney(product.couponValue, product.currency)].filter(Boolean).join(' · ') || '—';
      const videoCell = document.createElement('td');
      if (isHttpUrl(product.videoUrl)) {
        const video = document.createElement('a');
        video.href = product.videoUrl;
        video.target = '_blank';
        video.rel = 'noopener noreferrer';
        video.textContent = 'Ver';
        videoCell.append(video);
      } else videoCell.textContent = '—';
      const capturedCell = document.createElement('td');
      capturedCell.textContent = formatDateForSpain(product.importedAt);
      const statusCell = document.createElement('td');
      const statusSelect = document.createElement('select');
      for (const [value, label] of [
        ['draft', 'Borrador'], ['active', 'Activa'], ['price_update', 'Actualizar'],
        ['promotion_expired', 'Caducada'], ['out_of_stock', 'Sin existencias'],
        ['unavailable', 'No disponible'], ['archived', 'Archivada']
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        statusSelect.append(option);
      }
      statusSelect.value = product.availabilityStatus;
      statusSelect.addEventListener('change', () => {
        const updated = excelProducts.map((item) => item.productId === product.productId
          ? { ...item, availabilityStatus: statusSelect.value }
          : item);
        persistExcelProducts(updated);
      });
      statusCell.append(statusSelect);
      const telegramCell = document.createElement('td');
      telegramCell.textContent = product.publishedEnTelegram
        ? `Sí · ${formatDateForSpain(product.fechaPublicacionTelegram)}`
        : 'No';
      const actionsCell = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'admin-record-actions';
      actions.append(button('Borrador Telegram', () => {
        try {
          if (!isHttpUrl(product.affiliateUrl)) throw new Error('Añade un enlace afiliado válido antes de generar el borrador.');
          const offer: Offer = {
            id: `excel-${product.productId}`,
            title: product.title,
            slug: createSlug(product.title),
            store: 'AliExpress',
            category: product.category || 'otros',
            image: product.imageUrl,
            images: product.imageUrls.map((url, index) => ({ url, isPrimary: url === product.imageUrl, order: index })),
            currentPrice: product.currentPrice ?? 0,
            currency: product.currency,
            previousPrice: product.originalPrice ?? undefined,
            previousPriceVerified: false,
            discount: null,
            coupon: product.coupon,
            conditions: product.couponValue !== null ? `Cupón: ${formatExcelMoney(product.couponValue, product.currency)}${product.couponMinSpend !== null ? ` en compras desde ${formatExcelMoney(product.couponMinSpend, product.currency)}` : ''}.` : '',
            seller: '',
            description: `Producto promocional importado desde ${product.sourceFileName || 'Excel de AliExpress'}. Comprueba las condiciones antes de publicar.`,
            shortDescription: product.coupon ? `Cupón disponible: ${product.coupon}.` : 'Revisa el precio y las condiciones vigentes en AliExpress.',
            sourceUrl: isHttpUrl(product.productUrl) ? product.productUrl : product.affiliateUrl,
            affiliateUrl: product.affiliateUrl,
            publishedAt: today(),
            status: 'draft',
            featured: false,
            verified: false,
            demo: false,
            score: 0,
            tags: [...product.tags, 'aliexpress-excel']
          };
          const draft = generateTelegramDraft(offer);
          output.value = draft.text;
          renderTelegramImages(offer);
          telegramStatus.textContent = `Borrador preparado con ${draft.images.length} imagen(es) desde las URLs de AliExpress. No se ha enviado a Telegram.`;
          output.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'No se pudo generar el borrador de Telegram.', true);
        }
      }));
      actions.append(button(product.publishedEnTelegram ? 'Quitar marca Telegram' : 'Registrar publicado', () => {
        const message = product.publishedEnTelegram
          ? `¿Quitar el registro de publicación en Telegram de «${product.title}»? No se enviará ningún mensaje.`
          : `Confirma que «${product.title}» ya se publicó manualmente en Telegram. Esta acción solo registra la fecha; no envía mensajes.`;
        if (!window.confirm(message)) return;
        const publishedAt = product.publishedEnTelegram ? null : new Date().toISOString();
        persistExcelProducts(excelProducts.map((item) => item.productId === product.productId
          ? { ...item, publishedEnTelegram: Boolean(publishedAt), fechaPublicacionTelegram: publishedAt }
          : item));
      }));
      actions.append(button('Crear oferta borrador', () => {
        const draft: Offer = {
          id: `offer-${crypto.randomUUID()}`,
          title: product.title,
          slug: createSlug(product.title),
          store: 'AliExpress',
          category: product.category || 'otros',
          image: product.imageUrl,
          images: product.imageUrls.map((url, index) => ({ url, isPrimary: url === product.imageUrl, order: index })),
          currentPrice: product.currentPrice ?? 0,
          currency: product.currency,
          ...(product.originalPrice !== null ? { previousPrice: product.originalPrice } : {}),
          previousPriceVerified: false,
          discount: null,
          coupon: product.coupon,
          conditions: product.couponValue !== null ? `Cupón: ${formatExcelMoney(product.couponValue, product.currency)}.` : '',
          seller: '',
          description: `Oferta pendiente de revisión. Datos procedentes de ${product.sourceFileName || 'Excel de AliExpress'}.`,
          shortDescription: `Producto importado para revisar: ${product.title}.`,
          sourceUrl: isHttpUrl(product.productUrl) ? product.productUrl : product.affiliateUrl,
          affiliateUrl: product.affiliateUrl,
          publishedAt: today(),
          status: 'draft',
          featured: false,
          verified: false,
          demo: false,
          score: 0,
          tags: [...product.tags, 'aliexpress-excel'],
          availabilityStatus: 'draft',
          featuredToday: false
        };
        if (persist([...records, draft])) {
          setForm(draft);
          setMessage('Oferta editorial creada como borrador. Verifícala manualmente antes de publicarla.');
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }));
      row.append(titleCell, categoryCell, subcategoryCell, tagsCell, priceCell, discountCell, salesCell, ratingCell, commissionRateCell, commissionCell, couponCell, videoCell, capturedCell, statusCell, telegramCell, actionsCell);
      excelProductsTable.append(row);
    }
    if (filtered.length > 500) {
      const note = document.createElement('p');
      note.className = 'muted-text';
      note.textContent = `Se muestran 500 de ${filtered.length} productos. Ajusta los filtros para acotar el análisis.`;
      excelProductsTable.after(note);
    }
  }

  function importOfferJson(text: string) {
    try {
      const imported = parseOfferJson(text) as Offer[];
      if (!window.confirm(`Se van a sustituir las ${records.length} ofertas locales por ${imported.length} registros validados. ¿Continuar?`)) {
        importOutput.textContent = 'Importación cancelada; no se modificaron los datos.';
        importOutput.classList.remove('is-error');
        return;
      }

      if (persist(imported)) {
        importOutput.textContent = `${imported.length} ofertas importadas correctamente.`;
        importOutput.classList.remove('is-error');
        setMessage(`${imported.length} ofertas importadas en este navegador.`);
      }
    } catch (error) {
      importOutput.textContent = `No se importó nada. ${error instanceof Error ? error.message : 'Error desconocido.'}`;
      importOutput.classList.add('is-error');
      setMessage('El JSON tiene errores; corrígelos antes de importar.', true);
    }
  }

  getElement<HTMLButtonElement>('#import-candidates').addEventListener('click', () => {
    try {
      const candidates = importCandidateData(candidateImportData.value, { source: candidateSource.value });
      importCandidateBatch(candidates);
    } catch (error) {
      candidateImportStatus.textContent = error instanceof Error ? error.message : 'No se pudo importar el archivo.';
      candidateImportStatus.classList.add('is-error');
      setMessage('No se importaron candidatos; corrige los errores indicados.', true);
    }
  });

  candidateFile.addEventListener('change', async () => {
    const file = candidateFile.files?.[0];
    if (!file) return;
    try {
      candidateImportData.value = await file.text();
      candidateImportStatus.textContent = `Archivo cargado (${file.name}). Pulsa «Validar e importar candidatos» para continuar.`;
      candidateImportStatus.classList.remove('is-error');
    } catch (error) {
      candidateImportStatus.textContent = `No se pudo leer el archivo: ${error instanceof Error ? error.message : 'error desconocido'}`;
      candidateImportStatus.classList.add('is-error');
    } finally {
      candidateFile.value = '';
    }
  });

  getElement<HTMLButtonElement>('#find-source-candidates').addEventListener('click', async () => {
    const source = candidateSource.value;
    if (source !== 'amazon' && source !== 'aliexpress' && source !== 'awin' && source !== 'generic') {
      candidateImportStatus.textContent = 'Selecciona una fuente reconocida.';
      candidateImportStatus.classList.add('is-error');
      return;
    }
    const checkedAt = new Date().toISOString();
    try {
      const candidates = await findCandidates(source);
      persistCandidateHistory(appendCandidateSearchHistory(candidateHistory, source, `búsqueda: ${candidates.length} candidatos`, checkedAt));
      importCandidateBatch(candidates);
    } catch (error) {
      candidateImportStatus.textContent = error instanceof Error ? error.message : 'No se pudo consultar la fuente.';
      candidateImportStatus.classList.add('is-error');
      persistCandidateHistory(appendCandidateSearchHistory(candidateHistory, source, 'fuente sin conexión configurada', checkedAt));
    }
  });

  for (const selector of ['#candidate-min-score', '#candidate-min-discount', '#candidate-max-price', '#candidate-categories']) {
    getElement<HTMLInputElement>(selector).addEventListener('input', renderFoundCandidates);
  }

  quickOfferForm.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const draft = createAliExpressDraft({
        title: input('quick-title').value,
        sourceUrl: input('quick-source-url').value,
        affiliateUrl: input('quick-affiliate-url').value,
        currentPrice: input('quick-current-price').value,
        previousPrice: input('quick-previous-price').value,
        coupon: input('quick-coupon').value,
        category: input('quick-category').value,
        seller: input('quick-seller').value,
        image: input('quick-image').value,
        conditions: input('quick-conditions').value
      }, { existingOffers: records, categories: OFFER_CATEGORIES.map((category) => category.slug) });
      if (persist([...records, draft])) {
        quickOfferForm.reset();
        quickImportStatus.textContent = 'Borrador creado en este navegador. No se ha publicado ni enviado a Telegram.';
        quickImportStatus.classList.remove('is-error');
        setMessage('Borrador de AliExpress creado. Completa la ficha y verifica la oferta antes de publicarla.');
      }
    } catch (error) {
      quickImportStatus.textContent = error instanceof Error ? error.message : 'No se pudo crear el borrador.';
      quickImportStatus.classList.add('is-error');
      setMessage('No se creó ningún borrador; revisa los datos indicados.', true);
    }
  });

  aliexpressCsvFile.addEventListener('change', async () => {
    const file = aliexpressCsvFile.files?.[0];
    if (!file) return;
    try {
      aliexpressCsv.value = await file.text();
      aliexpressCsvResults.textContent = `CSV cargado (${file.name}). Pulsa «Importar ofertas CSV» para validar cada fila.`;
    } catch (error) {
      aliexpressCsvResults.textContent = `No se pudo leer el archivo: ${error instanceof Error ? error.message : 'error desconocido'}`;
    } finally {
      aliexpressCsvFile.value = '';
    }
  });

  getElement<HTMLButtonElement>('#import-aliexpress-csv').addEventListener('click', () => {
    aliexpressCsvResults.replaceChildren();
    try {
      const imported = importAliExpressCsv(aliexpressCsv.value, {
        existingOffers: records,
        categories: OFFER_CATEGORIES.map((category) => category.slug)
      });
      const csvOffers = imported.offers.map((offer) => ({ ...offer, tags: ['importacion-csv'] }));
      if (csvOffers.length && !persist([...records, ...csvOffers])) {
        aliexpressCsvResults.textContent = 'No se guardaron las filas válidas; revisa el estado de almacenamiento local.';
        return;
      }
      const summary = document.createElement('p');
      summary.textContent = `Filas: ${imported.results.length}. Borradores creados: ${csvOffers.length}. Filas con errores o duplicadas: ${imported.results.length - csvOffers.length}.`;
      aliexpressCsvResults.append(summary);
      const list = document.createElement('ul');
      for (const result of imported.results) {
        const item = document.createElement('li');
        item.textContent = `Fila ${result.row}: ${result.ok ? 'IMPORTADA' : 'ERROR'} — ${result.message}`;
        item.classList.toggle('is-error', !result.ok);
        list.append(item);
      }
      aliexpressCsvResults.append(list);
      setMessage(`CSV procesado: ${csvOffers.length} borradores creados; cada fila tiene un resultado visible.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo importar el CSV.';
      aliexpressCsvResults.textContent = message;
      aliexpressCsvResults.classList.add('is-error');
      setMessage('El CSV no se pudo procesar.', true);
    }
  });

  excelFileInput.addEventListener('change', async () => {
    const file = excelFileInput.files?.[0];
    excelFileInput.value = '';
    if (!file) return;
    excelResults.replaceChildren();
    excelPreviewData = undefined;
    excelPreviewSelected.clear();
    try {
      const rows = await readAliExpressExcelFile(file);
      excelWorkbookRows = rows as unknown[][];
      excelPreviewData = parseAliExpressExcelRows(excelWorkbookRows, {
        fileName: file.name,
        importedAt: new Date().toISOString()
      });
      excelPreviewSelected = new Set(excelPreviewData.products.map((product) => product.sourceRowNumber));
      const summary = document.createElement('p');
      summary.textContent = `${excelPreviewData.detectedRows} productos encontrados; ${excelPreviewData.products.length} filas válidas y ${excelPreviewData.errors.length} filas con errores.`;
      excelResults.append(summary);
      if (excelPreviewData.errors.length) {
        const errorsList = document.createElement('ul');
        for (const rowError of excelPreviewData.errors) {
          const item = document.createElement('li');
          item.className = 'is-error';
          item.textContent = `Fila ${rowError.row}${rowError.productId ? ` · ${rowError.productId}` : ''}: ${rowError.errors.join(' ')}`;
          errorsList.append(item);
        }
        excelResults.append(errorsList);
      }
      if (excelPreviewData.products.length > 250) {
        const note = document.createElement('p');
        note.className = 'muted-text';
        note.textContent = `La previsualización muestra las primeras 250 filas válidas; «Importar todos» incluirá las ${excelPreviewData.products.length}.`;
        excelResults.append(note);
      }
      renderExcelPreview();
      excelStatus.textContent = 'Previsualiza los productos y selecciona cuáles importar. No se ha publicado ni enviado nada.';
      excelStatus.classList.remove('is-error');
    } catch (error) {
      excelPreviewWrap.hidden = true;
      excelStatus.textContent = error instanceof Error
        ? `No se pudo leer el archivo Excel: ${error.message}`
        : 'No se pudo leer el archivo Excel.';
      excelStatus.classList.add('is-error');
    }
  });

  const importExcelSelection = (all: boolean) => {
    if (!excelPreviewData) {
      excelStatus.textContent = 'Selecciona un archivo Excel antes de importar.';
      excelStatus.classList.add('is-error');
      return;
    }
    const selectedRows = new Set(all
      ? excelPreviewData.products.map((product) => product.sourceRowNumber)
      : [...excelPreviewSelected]);
    if (!selectedRows.size) {
      excelStatus.textContent = 'Selecciona al menos un producto válido para importar.';
      excelStatus.classList.add('is-error');
      return;
    }
    const selectedInput = excelWorkbookRows.slice(0, excelPreviewData.headerRow)
      .concat(excelWorkbookRows.filter((_, index) => selectedRows.has(index + 1)));
    try {
      const imported = importAliExpressExcelRows(selectedInput, {
        existingProducts: excelProducts,
        fileName: excelPreviewData.products[0]?.sourceFileName || '',
        importedAt: new Date().toISOString()
      });
      const selectedImages = new Map(excelPreviewData.products
        .filter((product) => selectedRows.has(product.sourceRowNumber))
        .map((product) => [product.productId, product.imageUrl]));
      const productsWithSelectedImages = imported.products.map((product) => {
        const selectedImage = selectedImages.get(product.productId);
        if (!selectedImage || !product.imageUrls.includes(selectedImage)) return product;
        return {
          ...product,
          imageUrl: selectedImage,
          additionalImageUrls: product.imageUrls.filter((url) => url !== selectedImage),
          imageUrls: [selectedImage, ...product.imageUrls.filter((url) => url !== selectedImage)]
        };
      });
      if (!persistExcelProducts(productsWithSelectedImages)) return;
      excelStatus.textContent = `${excelPreviewData.detectedRows} productos encontrados · ${imported.imported} nuevos · ${imported.updated} duplicados actualizados · ${excelPreviewData.errors.length} filas con errores.`;
      excelStatus.classList.remove('is-error');
      excelPreviewWrap.hidden = true;
      excelResults.replaceChildren();
      const summary = document.createElement('p');
      summary.textContent = excelStatus.textContent;
      excelResults.append(summary);
      setMessage('Productos del Excel guardados en el almacenamiento local de análisis. No se ha publicado ni enviado nada.');
    } catch (error) {
      excelStatus.textContent = error instanceof Error ? error.message : 'No se pudieron importar los productos seleccionados.';
      excelStatus.classList.add('is-error');
    }
  };

  getElement<HTMLButtonElement>('#aliexpress-excel-import-all').addEventListener('click', () => importExcelSelection(true));
  getElement<HTMLButtonElement>('#aliexpress-excel-import-selected').addEventListener('click', () => importExcelSelection(false));
  getElement<HTMLButtonElement>('#aliexpress-excel-select-all').addEventListener('click', () => {
    if (!excelPreviewData) return;
    const visibleRows = excelPreviewData.products.slice(0, 250).map((product) => product.sourceRowNumber);
    const allVisibleSelected = visibleRows.every((row) => excelPreviewSelected.has(row));
    visibleRows.forEach((row) => allVisibleSelected ? excelPreviewSelected.delete(row) : excelPreviewSelected.add(row));
    renderExcelPreview();
  });
  getElement<HTMLButtonElement>('#aliexpress-excel-discard').addEventListener('click', () => {
    excelPreviewData = undefined;
    excelWorkbookRows = [];
    excelPreviewSelected.clear();
    excelResults.replaceChildren();
    excelStatus.textContent = 'Previsualización descartada; no se modificó el catálogo.';
    excelStatus.classList.remove('is-error');
    renderExcelPreview();
  });

  for (const selector of [
    '#excel-filter-category', '#excel-filter-price-min', '#excel-filter-price-max',
    '#excel-filter-coupon', '#excel-filter-video', '#excel-filter-affiliate',
    '#excel-filter-telegram', '#excel-filter-status', '#excel-sort'
  ]) {
    const control = getElement<HTMLInputElement | HTMLSelectElement>(selector);
    control.addEventListener('input', renderExcelProducts);
    control.addEventListener('change', renderExcelProducts);
  }

  const updatePromoPreview = () => renderPromoPreview();
  for (const selector of ['#promo-title', '#promo-price', '#promo-currency', '#promo-affiliate-url']) {
    getElement<HTMLInputElement>(selector).addEventListener('input', updatePromoPreview);
  }
  promoMaterial.addEventListener('input', () => {
    if (lastPromoMaterial && promoMaterial.value !== lastPromoMaterial) {
      promoFields.hidden = true;
      promoImages = [];
      renderPromoImages();
      promoStatus.textContent = 'El texto ha cambiado. Vuelve a detectar la oferta antes de continuar para no asociar imágenes al producto equivocado.';
      promoStatus.classList.remove('is-error');
    }
  });

  getElement<HTMLButtonElement>('#detect-promo').addEventListener('click', () => {
    try {
      const detected = parseAliExpressPromoItems(promoMaterial.value);
      lastPromoMaterial = promoMaterial.value;
      input('promo-title').value = detected.title;
      input('promo-price').value = detected.currentPrice === null ? '' : String(detected.currentPrice);
      input('promo-currency').value = detected.currency;
      input('promo-affiliate-url').value = detected.affiliateUrl;
      input('promo-tracking-id').value = detected.trackingId;
      input('promo-language').value = detected.language;
      input('promo-promotion-date').value = detected.promotionEndDate || '';
      promoFields.hidden = false;
      renderPromoImages();
      renderPromoPreview();
      const warnings = [
        !detected.title ? 'No se detectó el título.' : '',
        detected.currentPrice === null ? 'No se detectó un precio con moneda.' : '',
        !detected.affiliateUrl ? 'FALTA ENLACE DE AFILIADO; no podrás verificar ni publicar hasta añadirlo.' : ''
      ].filter(Boolean);
      promoStatus.textContent = warnings.length
        ? `Detección completada con avisos: ${warnings.join(' ')}`
        : 'Datos detectados. Revísalos, añade las imágenes y guarda como borrador.';
      promoStatus.classList.toggle('is-error', warnings.length > 0);
    } catch (error) {
      promoStatus.textContent = error instanceof Error ? error.message : 'No se pudo analizar el material promocional.';
      promoStatus.classList.add('is-error');
    }
  });

  promoImagesInput.addEventListener('change', async () => {
    const files = Array.from(promoImagesInput.files || []);
    promoImagesInput.value = '';
    if (!files.length) return;
    if (promoImages.length + files.length > 6) {
      promoImagesStatus.textContent = `No se añadieron imágenes: el máximo es 6 y ya hay ${promoImages.length}.`;
      promoImagesStatus.classList.add('is-error');
      return;
    }
    const additions: NonNullable<Offer['images']> = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        additions.push({
          url: await encodePromoImage(file),
          isPrimary: promoImages.length === 0 && additions.length === 0,
          order: promoImages.length + additions.length
        });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${file.name}: no se pudo procesar la imagen.`);
      }
    }
    if (additions.length) {
      promoImages = [...promoImages, ...additions].map((image, order) => ({
        ...image,
        order,
        isPrimary: image.isPrimary || (order === 0 && !promoImages.some((item) => item.isPrimary))
      }));
    }
    renderPromoImages();
    renderPromoPreview();
    if (errors.length) {
      promoImagesStatus.textContent = `${promoImages.length} imagen(es) añadidas. No se procesaron: ${errors.join(' ')}`;
      promoImagesStatus.classList.add('is-error');
    }
  });

  getElement<HTMLButtonElement>('#save-promo-draft').addEventListener('click', () => {
    try {
      const priceText = input('promo-price').value.trim();
      const parsedPrice = priceText ? parseAliExpressPrice(priceText) : null;
      if (priceText && parsedPrice === null) throw new Error('El precio no es válido.');
      const draft = createAliExpressPromoDraft({
        title: input('promo-title').value,
        currentPrice: parsedPrice,
        currency: input('promo-currency').value.trim().toUpperCase(),
        sourceUrl: input('promo-source-url').value.trim(),
        affiliateUrl: input('promo-affiliate-url').value.trim(),
        trackingId: input('promo-tracking-id').value.trim(),
        language: input('promo-language').value.trim(),
        promotionEndDate: input('promo-promotion-date').value || null,
        category: input('promo-category').value,
        seller: input('promo-seller').value,
        coupon: input('promo-coupon').value,
        conditions: input('promo-conditions').value,
        images: promoImages
      }, { existingOffers: records });
      if (persist([...records, draft])) {
        setForm(draft);
        promoStatus.textContent = 'BORRADOR guardado en este navegador. No se ha publicado ni enviado a Telegram.';
        promoStatus.classList.remove('is-error');
        setMessage('Oferta Promo Items guardada como borrador local. Comprueba los datos antes de verificarla.');
      }
    } catch (error) {
      promoStatus.textContent = error instanceof Error ? error.message : 'No se pudo guardar el borrador.';
      promoStatus.classList.add('is-error');
      setMessage('No se guardó ningún borrador Promo Items; revisa los errores.', true);
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const existing = currentExisting();
    try {
      const next = collectOffer(existing);
      const updated = existing
        ? records.map((offer) => offer.id === existing.id ? next : offer)
        : [...records, next];
      if (persist(updated)) {
        refreshOfferId = undefined;
        setMessage(existing ? 'Oferta actualizada en este navegador.' : 'Oferta guardada en este navegador. Exporta el JSON para publicarla.');
        setForm();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo validar la oferta.', true);
    }
  });

  filter.addEventListener('change', renderRecords);
  for (const selector of [
    '#imported-state-filter', '#imported-category-filter', '#imported-subcategory-filter',
    '#imported-today-filter', '#imported-featured-filter', '#imported-promotion-filter',
    '#imported-review-filter', '#imported-sort'
  ]) {
    const control = getElement<HTMLInputElement | HTMLSelectElement>(selector);
    control.addEventListener(control instanceof HTMLInputElement && control.type === 'checkbox' ? 'change' : 'input', renderImportedOffers);
    control.addEventListener('change', renderImportedOffers);
  }
  getElement<HTMLButtonElement>('#new-offer').addEventListener('click', () => setForm());
  getElement<HTMLButtonElement>('#cancel-edit').addEventListener('click', () => setForm());
  getElement<HTMLButtonElement>('#generate-slug').addEventListener('click', () => {
    input('slug').value = createSlug(titleInput.value);
  });
  getElement<HTMLSelectElement>('#store-select').addEventListener('change', (event) => {
    const customStore = getElement<HTMLInputElement>('#store-custom');
    customStore.hidden = (event.currentTarget as HTMLSelectElement).value !== 'other';
    if (!customStore.hidden) customStore.focus();
  });
  getElement<HTMLButtonElement>('#export-offers').addEventListener('click', () => {
    const blob = new Blob([`${JSON.stringify(records, null, 2)}\n`], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'offers.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
    setMessage('JSON exportado. Revisa el archivo antes de sustituir src/data/offers.json.');
  });

  getElement<HTMLButtonElement>('#validate-import').addEventListener('click', () => importOfferJson(importTextarea.value));
  getElement<HTMLInputElement>('#import-offers').addEventListener('change', async (event) => {
    const fileInput = event.currentTarget as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      importTextarea.value = await file.text();
      importOfferJson(importTextarea.value);
    } catch (error) {
      importOutput.textContent = `No se pudo leer el archivo: ${error instanceof Error ? error.message : 'error desconocido'}`;
      importOutput.classList.add('is-error');
    } finally {
      fileInput.value = '';
    }
  });

  getElement<HTMLButtonElement>('#reset-offers').addEventListener('click', () => {
    if (!window.confirm('¿Restaurar únicamente los ejemplos DEMO y borrar las ofertas guardadas localmente?')) return;
    if (persist(seedOffers.map((offer) => ({ ...offer })))) {
      setForm();
      setMessage('Se han restaurado los ejemplos DEMO en este navegador.');
    }
  });

  getElement<HTMLButtonElement>('#run-simulator').addEventListener('click', () => {
    candidateResults.replaceChildren();
    for (const seed of seedOffers.slice(0, 3)) {
      const candidate: OfferCandidate = {
        id: `demo-${seed.id}`,
        title: seed.title,
        store: seed.store,
        category: seed.category,
        currentPrice: seed.currentPrice,
        previousPrice: null,
        discount: null,
        currency: 'EUR',
        sourceUrl: seed.sourceUrl,
        ...(seed.seller ? { seller: seed.seller } : {}),
        ...(seed.coupon ? { coupon: seed.coupon } : {}),
        conditions: seed.conditions,
        available: true,
        source: 'generic',
        checkedAt: new Date().toISOString(),
        previousPriceVerified: false,
        affiliateRequired: false,
        verified: false,
        verificationNotes: ['Datos sintéticos del simulador; no consultan una tienda real.'],
        lastVerifiedAt: null,
        expiresAt: null,
        demo: true
      };
      const score = scoreCandidate(candidate);
      const verification = verifyCandidate(candidate);
      const approval = verification.valid ? 'Pendiente de aprobación editorial; DEMO bloqueada.' : 'No aprobable: corrige los errores de validación.';
      let publication = 'No publicada: requiere aprobación manual y datos reales.';
      if (verification.valid) {
        try {
          publishOffer(createOffer(candidate));
          publication = 'Error: el simulador nunca debe publicar DEMO.';
        } catch (error) {
          publication = `Publicación bloqueada correctamente: ${error instanceof Error ? error.message : 'error desconocido'}`;
        }
      }
      const result = document.createElement('article');
      result.className = 'candidate-result';
      const heading = document.createElement('h3');
      heading.textContent = `${candidate.title} · DEMO`;
      const stages = document.createElement('p');
      stages.textContent = `Candidato → puntuación ${score.score}/100 → verificación ${verification.valid ? 'superada' : verification.errors.join(' ')} → ${approval} → ${publication}`;
      result.append(heading, stages);
      candidateResults.append(result);
    }
  });

  getElement<HTMLButtonElement>('#telegram-demo-test').addEventListener('click', () => {
    pendingTelegramAction = { action: 'test' };
    telegramPreview.textContent = 'PRUEBA DE TELEGRAM — LA OFERTA DEL CHOLLO\n\nMensaje de prueba manual. No es una oferta real.';
    telegramSendButton.textContent = 'Enviar prueba DEMO';
    telegramDialog.showModal();
  });

  getElement<HTMLButtonElement>('#cancel-telegram-send').addEventListener('click', () => {
    pendingTelegramAction = undefined;
    telegramDialog.close();
  });

  telegramDialog.addEventListener('cancel', () => {
    pendingTelegramAction = undefined;
  });

  telegramSendButton.addEventListener('click', async () => {
    if (!pendingTelegramAction || telegramSendButton.disabled) return;
    telegramSendButton.disabled = true;
    telegramSendButton.textContent = 'Enviando…';
    try {
      const sessionResponse = await fetch('/api/telegram/session', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!sessionResponse.ok) {
        if (sessionResponse.status === 403) throw new Error('No autorizado. Inicia sesión en Cloudflare Access y vuelve a intentarlo.');
        if (sessionResponse.status === 503) throw new Error('La integración de Telegram no está configurada en Cloudflare.');
        throw new Error('No se pudo iniciar una sesión segura para Telegram.');
      }
      if (!sessionResponse.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
        throw new Error('La sesión de Cloudflare Access no está disponible. Inicia sesión y vuelve a intentarlo.');
      }
      const sessionResult = await sessionResponse.json().catch(() => null);
      if (sessionResult?.ok !== true) throw new Error('No se pudo iniciar una sesión segura para Telegram.');

      const response = await fetch('/api/telegram/send', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(pendingTelegramAction)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 502) throw new Error('Telegram no pudo enviar el mensaje.');
        if (response.status === 403) throw new Error('No autorizado. Inicia sesión en Cloudflare Access y vuelve a intentarlo.');
        if (response.status === 422) throw new Error('La oferta no cumple los requisitos para enviarse a Telegram.');
        throw new Error('Telegram no pudo enviar el mensaje.');
      }
      if (result?.ok !== true) throw new Error('Telegram no pudo enviar el mensaje.');
      telegramDialog.close();
      pendingTelegramAction = undefined;
      setMessage('Mensaje enviado correctamente al canal de Telegram.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Telegram no pudo enviar el mensaje.', true);
    } finally {
      telegramSendButton.disabled = false;
      telegramSendButton.textContent = pendingTelegramAction?.action === 'test' ? 'Enviar prueba DEMO' : 'Confirmar envío';
    }
  });

  getElement<HTMLButtonElement>('#copy-telegram').addEventListener('click', async () => {
    try {
      const draft = collectOffer(currentExisting());
      const telegramDraft = generateTelegramDraft(draft);
      const telegramText = telegramDraft.text;
      output.value = telegramText;
      renderTelegramImages(draft);
      await navigator.clipboard.writeText(telegramText);
      telegramStatus.textContent = 'Texto copiado. No se ha enviado a Telegram.';
    } catch (error) {
      telegramStatus.textContent = error instanceof Error
        ? `No se pudo generar o copiar el texto: ${error.message}`
        : 'No se pudo generar o copiar el texto.';
    }
  });

  const refreshTelegram = () => {
    const existing = currentExisting();
    if (!titleInput.value.trim() || !input('current-price').value || !input('source-url').value.trim()) {
      output.value = '';
      return;
    }
    try {
      output.value = generateTelegramPost(collectOffer(existing));
    } catch (error) {
      output.value = '';
      telegramStatus.textContent = error instanceof Error ? error.message : 'Completa los datos reales de la oferta.';
    }
  };
  form.addEventListener('input', refreshTelegram);
  form.addEventListener('change', refreshTelegram);
  renderRecords();
  renderImportedOffers();
  renderExcelPreview();
  renderExcelProducts();
  renderFoundCandidates();
  renderCandidateHistory();
}
