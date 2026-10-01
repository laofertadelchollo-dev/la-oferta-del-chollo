import { offers as seedOffers } from '../data/offers';
import {
  CATEGORIES,
  calculateDiscount,
  createSlug,
  formatMoney,
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
import { isCalendarDate } from '../lib/offer-policy.js';
import { migrateStoredOfferList, parseOfferJson, validateOfferList } from '../lib/offer-import.js';
import type { CandidateRecord, OfferCandidate } from '../lib/sources/types';
import { importCandidateData } from '../lib/candidate-import.js';
import { filterCandidates, selectTopCandidates } from '../lib/candidate-filter.js';
import { appendCandidateHistory, appendCandidateSearchHistory, type CandidateHistoryEntry } from '../lib/candidate-history.js';
import { findCandidates } from '../lib/sources/index.js';
import { expireOffers } from '../lib/offer-expiry.js';
import { createAliExpressDraft, importAliExpressCsv } from '../lib/aliexpress-manual-import.js';

const storageKey = 'la-oferta-del-chollo-offers-v1';
const candidateStorageKey = 'la-oferta-del-chollo-candidates-v1';
const candidateHistoryStorageKey = 'la-oferta-del-chollo-candidate-history-v1';
const today = () => new Date().toISOString().slice(0, 10);
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
  const telegramDialog = getElement<HTMLDialogElement>('#telegram-send-dialog');
  const telegramPreview = getElement<HTMLPreElement>('#telegram-preview');
  const telegramSendButton = getElement<HTMLButtonElement>('#confirm-telegram-send');
  const idInput = getElement<HTMLInputElement>('#offer-id');
  const titleInput = getElement<HTMLInputElement>('#title');
  const slugSeed = seedOffers.map((offer) => ({ ...offer }));
  let records: Offer[];
  let candidateRecords: CandidateRecord[] = [];
  let candidateHistory: CandidateHistoryEntry[] = [];
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

  const collectOffer = (existing?: Offer): Offer => {
    const title = input('title').value.trim();
    const storeChoice = input('store-select').value;
    const store = storeChoice === 'other' ? input('store-custom').value.trim() : storeChoice;
    const category = input('category').value;
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
    const image = input('image').value.trim() || undefined;

    const errors: string[] = [];
    if (!title) errors.push('Escribe el nombre del producto.');
    if (!store) errors.push('Indica la tienda.');
    if (!CATEGORIES.some((item) => item.slug === category)) errors.push('Elige una categoría válida.');
    if (chosenStatus !== 'draft' && chosenStatus !== 'expired') {
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) errors.push('Indica un precio actual mayor que cero.');
      if (!isHttpUrl(sourceUrl)) errors.push('Añade una URL de oferta válida (http o https).');
      if (!verified) errors.push('Marca que has comprobado los datos antes de publicar.');
      if (chosenStatus === 'published' && !isHttpUrl(affiliateUrl)) errors.push('Para publicar una oferta monetizada, añade su enlace de afiliación real.');
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
    if (chosenStatus === 'published' && expiresAt && expiresAt < today()) errors.push('No se puede publicar una oferta caducada.');
    if (!slug) errors.push('El título no genera un slug válido.');
    if (image && !((image.startsWith('/') && !image.startsWith('//')) || isHttpUrl(image))) errors.push('La imagen debe ser una ruta local o una URL http(s) válida.');

    const duplicateSlug = records.some((offer) => offer.slug === slug && offer.id !== existing?.id);
    if (duplicateSlug) errors.push('Ya existe otra oferta con ese slug.');
    if (errors.length) throw new Error(errors.join(' '));

    return {
      id: existing?.id || `offer-${crypto.randomUUID()}`,
      title,
      slug,
      store,
      category,
      ...(image ? { image } : {}),
      currentPrice,
      ...(previousPrice ? { previousPrice } : {}),
      previousPriceVerified: Boolean(previousPrice && previousPriceVerified),
      discount: calculateDiscount(currentPrice, previousPrice, previousPriceVerified),
      coupon: input('coupon').value.trim(),
      conditions: input('conditions').value.trim(),
      seller: input('seller').value.trim(),
      description: input('description').value.trim(),
      shortDescription: input('short-description').value.trim(),
      sourceUrl,
      affiliateUrl,
      publishedAt,
      ...(expiresAt ? { expiresAt } : {}),
      ...(lastVerifiedAt ? { lastVerifiedAt } : existing?.lastVerifiedAt ? { lastVerifiedAt: existing.lastVerifiedAt } : {}),
      status: chosenStatus,
      featured: checkbox('featured').checked,
      verified,
      demo: false,
      score: existing?.score || 0,
      tags: input('tags').value.split(',').map((tag) => tag.trim()).filter(Boolean)
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
      image: offer?.image || '',
      'current-price': offer?.currentPrice ? String(offer.currentPrice) : '',
      'previous-price': offer?.previousPrice ? String(offer.previousPrice) : '',
      coupon: offer?.coupon || '',
      conditions: offer?.conditions || '',
      'short-description': offer?.shortDescription || '',
      description: offer?.description || '',
      'source-url': offer?.sourceUrl || '',
      'affiliate-url': offer?.affiliateUrl || '',
      'published-at': offer?.publishedAt || '',
      'expires-at': offer?.expiresAt || '',
      status: offer?.status || 'draft',
      tags: offer?.tags.join(', ') || ''
    };
    for (const [key, value] of Object.entries(values)) input(key).value = value;
    const knownStore = ['Amazon España', 'AliExpress'].includes(offer?.store || '');
    input('store-select').value = offer?.store && knownStore ? offer.store : offer?.store ? 'other' : '';
    input('store-custom').value = offer?.store && !knownStore ? offer.store : '';
    getElement<HTMLInputElement>('#store-custom').hidden = input('store-select').value !== 'other';
    checkbox('previous-price-verified').checked = Boolean(offer?.previousPriceVerified);
    checkbox('verified').checked = Boolean(offer?.verified);
    checkbox('featured').checked = Boolean(offer?.featured);
    output.value = '';
    telegramStatus.textContent = '';
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
    const visible = records.filter((offer) => {
      const state = getOfferState(offer);
      if (filter.value === 'all') return true;
      if (filter.value === 'expired') return state === 'expired';
      return offer.status === filter.value;
    });
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
      summary.textContent = `${offer.store || 'Tienda sin indicar'} · ${formatMoney(offer.currentPrice || 0)}${discount} · ${getOfferStatusLabel(getOfferState(offer))} · ${offer.verified ? 'Verificada' : 'No verificada'} · Publicada: ${offer.publishedAt || 'sin fecha'}${checked}${offer.demo ? ' · DEMO' : ''}`;
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
    const imported = records.filter((offer) =>
      offer.store === 'AliExpress' && offer.tags.some((tag) => tag === 'importacion-rapida' || tag === 'importacion-csv')
    );
    importedOffersEmpty.hidden = imported.length > 0;
    for (const offer of imported) {
      const row = document.createElement('tr');
      const productCell = document.createElement('th');
      productCell.scope = 'row';
      productCell.textContent = offer.title || '(Sin título)';
      const priceCell = document.createElement('td');
      priceCell.textContent = offer.currentPrice > 0 ? formatMoney(offer.currentPrice) : 'Pendiente';
      const categoryCell = document.createElement('td');
      categoryCell.textContent = CATEGORIES.find((category) => category.slug === offer.category)?.label || 'Sin categoría';
      const statusCell = document.createElement('td');
      statusCell.textContent = getOfferStatusLabel(getOfferState(offer));
      const verifiedCell = document.createElement('td');
      verifiedCell.textContent = offer.verified ? 'Sí' : 'No';
      const linkCell = document.createElement('td');
      if (isHttpUrl(offer.sourceUrl)) {
        const sourceLink = document.createElement('a');
        sourceLink.href = offer.sourceUrl;
        sourceLink.target = '_blank';
        sourceLink.rel = 'noopener noreferrer';
        sourceLink.textContent = 'Original';
        linkCell.append(sourceLink);
      } else {
        linkCell.textContent = 'Sin URL original';
      }
      const affiliateNotice = document.createElement('small');
      const affiliateUrl = offer.affiliateUrl || '';
      if (isHttpUrl(affiliateUrl)) {
        const affiliateLink = document.createElement('a');
        affiliateLink.href = affiliateUrl;
        affiliateLink.target = '_blank';
        affiliateLink.rel = 'noopener noreferrer nofollow sponsored';
        affiliateLink.textContent = 'Afiliado';
        affiliateNotice.append(affiliateLink);
      } else {
        affiliateNotice.textContent = 'FALTA ENLACE DE AFILIADO';
        affiliateNotice.className = 'affiliate-missing';
      }
      linkCell.append(document.createElement('br'), affiliateNotice);
      const dateCell = document.createElement('td');
      dateCell.textContent = offer.publishedAt || '—';
      const actionsCell = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'admin-record-actions';
      actions.append(button('Editar', () => {
        setForm(offer);
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
      actions.append(button('Verificar', () => {
        if (!window.confirm('Abre el producto original y comprueba manualmente el precio, la disponibilidad, el enlace afiliado y sus condiciones. ¿Confirmas que lo has revisado ahora?')) return;
        const result = verifyOffer(offer);
        if (!result.valid || !result.offer) {
          setMessage(`No se puede verificar todavía: ${result.errors.join(' ')}`, true);
          return;
        }
        if (updateRecord(result.offer)) setMessage('Oferta verificada. Revisa la ficha antes de publicarla.');
      }));
      const hasAffiliateUrl = isHttpUrl(offer.affiliateUrl || '');
      const canPublish = offer.status === 'verified' && offer.verified && hasAffiliateUrl;
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
            output.value = generateTelegramPost(offer);
            telegramStatus.textContent = 'Borrador generado. No se ha enviado a Telegram.';
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
      row.append(productCell, priceCell, categoryCell, statusCell, verifiedCell, linkCell, dateCell, actionsCell);
      importedOffersTable.append(row);
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
      }, { existingOffers: records, categories: CATEGORIES.map((category) => category.slug) });
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
        categories: CATEGORIES.map((category) => category.slug)
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

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const existing = currentExisting();
    try {
      const next = collectOffer(existing);
      const updated = existing
        ? records.map((offer) => offer.id === existing.id ? next : offer)
        : [...records, next];
      if (persist(updated)) {
        setMessage(existing ? 'Oferta actualizada en este navegador.' : 'Oferta guardada en este navegador. Exporta el JSON para publicarla.');
        setForm();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo validar la oferta.', true);
    }
  });

  filter.addEventListener('change', renderRecords);
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
      const telegramText = generateTelegramPost(draft);
      output.value = telegramText;
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
  renderFoundCandidates();
  renderCandidateHistory();
}
