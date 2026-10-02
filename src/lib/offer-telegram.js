import { isSafeWebUrl } from './offer-policy.js';
import { calculateDiscount } from './offer-math.js';

export function generateTelegramPost(offer) {
  if (offer.demo) throw new Error('No se puede generar una publicación real con una oferta DEMO.');
  if (typeof offer.title !== 'string' || !offer.title.trim()) throw new Error('Añade el nombre del producto antes de generar el texto.');
  if (!Number.isFinite(offer.currentPrice) || offer.currentPrice <= 0) throw new Error('Añade un precio real antes de generar el texto.');

  const affiliateUrl = typeof offer.affiliateUrl === 'string' && isSafeWebUrl(offer.affiliateUrl) ? offer.affiliateUrl.trim() : '';
  const sourceUrl = typeof offer.sourceUrl === 'string' && isSafeWebUrl(offer.sourceUrl) ? offer.sourceUrl.trim() : '';
  const url = affiliateUrl || sourceUrl;
  if (!url) throw new Error('Añade una URL de producto válida antes de generar el texto.');
  const description = typeof offer.shortDescription === 'string' && offer.shortDescription.trim()
    ? offer.shortDescription.trim()
    : typeof offer.description === 'string'
      ? offer.description.trim()
      : '';
  if (!description) throw new Error('Añade una descripción editorial antes de generar el texto.');

  const currency = typeof offer.currency === 'string' && /^[A-Z]{3}$/.test(offer.currency) ? offer.currency : 'EUR';
  const price = currency === 'EUR'
    ? `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(offer.currentPrice)} €`
    : new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(offer.currentPrice);
  const discount = calculateDiscount(offer.currentPrice, offer.previousPrice, offer.previousPriceVerified);
  const categoryMarkers = {
    electronica: '📱',
    tecnologia: '📱',
    hogar: '🏠',
    cocina: '🏠',
    moda: '👕',
    gaming: '🎮',
    deporte: '💪',
    automovil: '🚗',
    mascotas: '🐶',
    belleza: '💄',
    herramientas: '🛠️',
    'accesorios-moviles': '📱'
  };
  const categoryMarker = categoryMarkers[offer.category] || '🏷️';
  const lines = [
    offer.featuredToday ? '🔥 OFERTA DEL DÍA' : '🔥 OFERTA',
    ...(offer.category ? [`${categoryMarker} ${offer.category}${offer.subcategory ? ` · ${offer.subcategory}` : ''}`] : []),
    '',
    offer.title.trim(),
    '',
    `💰 Precio: ${price}`,
    ...(discount ? [`📉 Descuento: ${discount} %`] : []),
    '',
    `✅ ${description}`,
    ...(typeof offer.conditions === 'string' && offer.conditions.trim() ? ['', `⚠️ ${offer.conditions.trim()}`] : []),
    '',
    '🛒 VER OFERTA:',
    url,
    ...(affiliateUrl ? ['', '🔗 Enlace de afiliado.'] : [])
  ];
  return lines.join('\n');
}

export function generateTelegramDraft(offer) {
  const text = generateTelegramPost(offer);
  const images = Array.isArray(offer.images)
    ? [...offer.images].sort((left, right) => left.order - right.order)
    : offer.image ? [{ url: offer.image, isPrimary: true, order: 0 }] : [];
  return {
    text,
    images: images.map((image) => ({ ...image })),
    primaryImage: images.find((image) => image.isPrimary)?.url || images[0]?.url || ''
  };
}
