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

const storageKey = 'la-oferta-del-chollo-offers-v1';
const today = () => new Date().toISOString().slice(0, 10);
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
  const telegramDialog = getElement<HTMLDialogElement>('#telegram-send-dialog');
  const telegramPreview = getElement<HTMLPreElement>('#telegram-preview');
  const telegramSendButton = getElement<HTMLButtonElement>('#confirm-telegram-send');
  const idInput = getElement<HTMLInputElement>('#offer-id');
  const titleInput = getElement<HTMLInputElement>('#title');
  const slugSeed = seedOffers.map((offer) => ({ ...offer }));
  let records: Offer[];
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
      const candidate = {
        title: seed.title,
        store: seed.store,
        currentPrice: seed.currentPrice,
        ...(seed.previousPrice ? { previousPrice: seed.previousPrice } : {}),
        sourceUrl: seed.sourceUrl,
        ...(seed.seller ? { seller: seed.seller } : {}),
        ...(seed.coupon ? { coupon: seed.coupon } : {}),
        conditions: seed.conditions,
        checkedAt: new Date().toISOString(),
        previousPriceVerified: false,
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
      stages.textContent = `Candidato → puntuación ${score}/100 → verificación ${verification.valid ? 'superada' : verification.errors.join(' ')} → ${approval} → ${publication}`;
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
}
