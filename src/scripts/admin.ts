import { offers as seedOffers } from '../data/offers';
import {
  CATEGORIES,
  calculateDiscount,
  createSlug,
  formatMoney,
  generateTelegramPost,
  getOfferStatusLabel,
  isHttpUrl,
  type Offer,
  type OfferStatus
} from '../lib/site';

const storageKey = 'la-oferta-del-chollo-offers-v1';
const today = () => new Date().toISOString().slice(0, 10);
const getElement = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`No se encontró el control requerido: ${selector}`);
  return element;
};

function isOfferStatus(value: unknown): value is OfferStatus {
  return value === 'draft' || value === 'verified' || value === 'published' || value === 'expired';
}

function isOfferRecord(value: unknown): value is Offer {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.title === 'string'
    && typeof record.slug === 'string'
    && typeof record.store === 'string'
    && typeof record.category === 'string'
    && typeof record.currentPrice === 'number'
    && typeof record.sourceUrl === 'string'
    && typeof record.verified === 'boolean'
    && isOfferStatus(record.status)
    && Array.isArray(record.tags);
}

function validateOfferList(value: unknown): Offer[] {
  if (!Array.isArray(value) || !value.every(isOfferRecord)) {
    throw new Error('El archivo debe ser un array de ofertas con los campos requeridos.');
  }
  const ids = new Set(value.map((offer) => offer.id));
  const slugs = new Set(value.map((offer) => offer.slug));
  if (ids.size !== value.length || slugs.size !== value.length) {
    throw new Error('El JSON contiene identificadores o slugs duplicados.');
  }
  return value;
}

export function initializeLocalOfferManager(): void {
  const form = getElement<HTMLFormElement>('#offer-form');
  const statusMessage = getElement<HTMLParagraphElement>('#admin-status');
  const list = getElement<HTMLDivElement>('#offer-list');
  const output = getElement<HTMLTextAreaElement>('#telegram-output');
  const telegramStatus = getElement<HTMLParagraphElement>('#telegram-status');
  const idInput = getElement<HTMLInputElement>('#offer-id');
  const titleInput = getElement<HTMLInputElement>('#title');
  const slugSeed = seedOffers.map((offer) => ({ ...offer }));
  let records: Offer[];

  try {
    const stored = localStorage.getItem(storageKey);
    records = stored ? validateOfferList(JSON.parse(stored)) : slugSeed;
  } catch (error) {
    records = slugSeed;
    statusMessage.textContent = `No se pudieron leer los datos locales. Se muestran los ejemplos incluidos: ${error instanceof Error ? error.message : 'error desconocido'}`;
    statusMessage.classList.add('is-error');
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
    if (!CATEGORIES.some((item) => item.slug === category)) errors.push('Elige una categoría válida.');
    if (chosenStatus === 'verified' || chosenStatus === 'published') {
      if (!store) errors.push('Indica la tienda para publicar la oferta.');
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) errors.push('Indica un precio actual mayor que cero.');
      if (!isHttpUrl(sourceUrl)) errors.push('Añade una URL de oferta válida (http o https).');
      if (!verified) errors.push('Marca que has comprobado los datos antes de publicar.');
      if (chosenStatus === 'published' && !isHttpUrl(affiliateUrl)) {
        errors.push('Para publicar una oferta monetizada, añade su enlace de afiliación real.');
      }
      if (!input('short-description').value.trim()) errors.push('Añade un resumen editorial.');
      if (!input('description').value.trim()) errors.push('Añade una descripción editorial.');
    }
    if (sourceUrl && !isHttpUrl(sourceUrl)) errors.push('La URL de oferta debe comenzar por http:// o https://.');
    if (affiliateUrl && !isHttpUrl(affiliateUrl)) errors.push('La URL afiliada debe comenzar por http:// o https://.');
    if (previousPriceText && (!Number.isFinite(previousPrice) || !previousPrice || previousPrice <= currentPrice)) {
      errors.push('El precio anterior debe ser superior al precio actual.');
    }
    if (previousPriceVerified && !previousPrice) errors.push('Introduce un precio anterior antes de marcarlo como comprobado.');
    if (expiresAt && publishedAt && expiresAt < publishedAt) errors.push('La fecha de caducidad no puede ser anterior a la publicación.');
    if (!slug) errors.push('El título no genera un slug válido.');
    if (image && !((image.startsWith('/') && !image.startsWith('//')) || isHttpUrl(image))) {
      errors.push('La imagen debe ser una ruta local o una URL http(s) válida.');
    }

    const duplicateSlug = records.some((offer) => offer.slug === slug && offer.id !== existing?.id);
    if (duplicateSlug) errors.push('Ya existe otra oferta con ese slug.');
    if (errors.length) throw new Error(errors.join(' '));

    const offer: Offer = {
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
      ...(lastVerifiedAt ? { lastVerifiedAt } : existing?.lastVerifiedAt && verified ? { lastVerifiedAt: existing.lastVerifiedAt } : {}),
      status: chosenStatus,
      featured: checkbox('featured').checked,
      verified,
      demo: false,
      tags: input('tags').value.split(',').map((tag) => tag.trim()).filter(Boolean)
    };
    return offer;
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

  function renderRecords() {
    list.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No hay ofertas guardadas en este navegador.';
      list.append(empty);
      return;
    }
    for (const offer of records) {
      const card = document.createElement('article');
      card.className = 'admin-record';
      const details = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = offer.title || '(Sin título)';
      const summary = document.createElement('p');
      summary.textContent = `${offer.store || 'Tienda sin indicar'} · ${formatMoney(offer.currentPrice || 0)} · ${getOfferStatusLabel(offer.status)}${offer.demo ? ' · DEMO' : ''}`;
      details.append(title, summary);
      const actions = document.createElement('div');
      actions.className = 'admin-record-actions';
      actions.append(
        button('Editar', () => {
          if (offer.demo) {
            setMessage('Los ejemplos DEMO están protegidos. Duplícalos para crear un borrador limpio.', true);
            return;
          }
          setForm(offer);
        }),
        button('Duplicar', () => {
          const id = `offer-${crypto.randomUUID()}`;
          const duplicate: Offer = offer.demo
            ? {
                id, title: '', slug: '', store: '', category: '', currentPrice: 0, conditions: '',
                seller: '', description: '', shortDescription: '', sourceUrl: '', affiliateUrl: '',
                publishedAt: '', status: 'draft', verified: false, featured: false, demo: false,
                previousPriceVerified: false, tags: []
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
    URL.revokeObjectURL(anchor.href);
    setMessage('JSON exportado. Revisa el archivo antes de sustituir src/data/offers.json.');
  });

  getElement<HTMLInputElement>('#import-offers').addEventListener('change', async (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const imported = validateOfferList(JSON.parse(await file.text()));
      if (persist(imported)) setMessage(`${imported.length} ofertas importadas en este navegador.`);
    } catch (error) {
      setMessage(`No se pudo importar el JSON: ${error instanceof Error ? error.message : 'error desconocido'}`, true);
    } finally {
      (event.currentTarget as HTMLInputElement).value = '';
    }
  });

  getElement<HTMLButtonElement>('#reset-offers').addEventListener('click', () => {
    if (!window.confirm('¿Restaurar únicamente los ejemplos DEMO y borrar las ofertas guardadas localmente?')) return;
    if (persist(seedOffers.map((offer) => ({ ...offer })))) {
      setForm();
      setMessage('Se han restaurado los ejemplos DEMO en este navegador.');
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
        ? `Completa los datos necesarios antes de copiar: ${error.message}`
        : 'No se pudo generar el borrador.';
    }
  });

  const refreshTelegram = () => {
    const existing = currentExisting();
    if (!titleInput.value.trim() || !input('current-price').value || !input('source-url').value.trim()) return;
    try {
      output.value = generateTelegramPost(collectOffer(existing));
    } catch {
      output.value = '';
    }
  };
  form.addEventListener('input', refreshTelegram);
  form.addEventListener('change', refreshTelegram);
  renderRecords();
}
