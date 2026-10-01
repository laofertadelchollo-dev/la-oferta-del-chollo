import { isCalendarDate, isProductionOfferEligible, isSafeWebUrl } from './offer-policy.js';
import { calculateDiscount } from './offer-math.js';

export { calculateDiscount, createSlug } from './offer-math.js';
export { generateTelegramPost } from './offer-telegram.js';

export const SITE = {
  name: 'LA OFERTA DEL CHOLLO',
  shortName: 'LA OFERTA DEL CHOLLO',
  description: 'Portal editorial de ofertas y recomendaciones para ahorrar en productos útiles en España.',
  defaultImage: '/images/la-oferta-del-chollo.png',
  locale: 'es_ES',
  currency: 'EUR',
  affiliateDisclosure: 'Esta web puede contener enlaces de afiliados. Si realizas una compra a través de algunos de nuestros enlaces, podemos recibir una comisión sin coste adicional para ti.',
  contact: {
    name: '[NOMBRE]',
    email: '[EMAIL]',
    address: '[DOMICILIO]'
  }
};

export const NAV_ITEMS = [
  { href: '/', label: 'Inicio' },
  { href: '/ofertas/', label: 'Ofertas' },
  { href: '/tecnologia/', label: 'Tecnología' },
  { href: '/hogar/', label: 'Hogar' },
  { href: '/cocina/', label: 'Cocina' },
  { href: '/herramientas/', label: 'Herramientas' },
  { href: '/automovil/', label: 'Automóvil' },
  { href: '/guias/', label: 'Guías' },
  { href: '/sobre-nosotros/', label: 'Sobre nosotros' },
  { href: '/contacto/', label: 'Contacto' }
];

export const CATEGORIES = [
  { slug: 'tecnologia', label: 'Tecnología', emoji: '💻', description: 'Smartphones, audio, accesorios y electrónica útil.' },
  { slug: 'hogar', label: 'Hogar', emoji: '🏠', description: 'Organización, limpieza y comodidad para casa.' },
  { slug: 'cocina', label: 'Cocina', emoji: '🍳', description: 'Utensilios y electrodomésticos para cocinar mejor.' },
  { slug: 'herramientas', label: 'Herramientas', emoji: '🧰', description: 'Herramientas, bricolaje y mejora del hogar.' },
  { slug: 'automovil', label: 'Automóvil', emoji: '🚗', description: 'Accesorios, mantenimiento y seguridad del coche.' }
];

export type OfferStatus = 'draft' | 'verified' | 'published' | 'expired';

export type Offer = {
  id: string;
  title: string;
  slug: string;
  store: string;
  category: string;
  image?: string;
  currentPrice: number;
  previousPrice?: number;
  previousPriceVerified?: boolean;
  discount?: number;
  coupon?: string;
  conditions: string;
  seller?: string;
  description: string;
  shortDescription: string;
  sourceUrl: string;
  affiliateUrl?: string;
  publishedAt: string;
  expiresAt?: string;
  lastVerifiedAt?: string;
  status: OfferStatus;
  featured: boolean;
  verified: boolean;
  demo: boolean;
  score: number;
  tags: string[];
};

export type Guide = {
  id: string;
  title: string;
  seoTitle: string;
  metaDescription: string;
  slug: string;
  excerpt: string;
  introduction: string;
  sections: { heading: string; paragraphs: string[] }[];
  practicalTips: string[];
  conclusion: string;
  category: string;
  image: string;
  publishedAt: string;
};

export function formatMoney(value: number): string {
  return `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} €`;
}

export function isExpired(offer: Pick<Offer, 'expiresAt' | 'status'>, today = new Date().toISOString().slice(0, 10)): boolean {
  if (offer.status === 'expired') return true;
  if (!offer.expiresAt) return false;
  return !isCalendarDate(offer.expiresAt) || offer.expiresAt < today;
}

export function getOfferState(offer: Offer): OfferStatus | 'pending' {
  if (isExpired(offer)) return 'expired';
  if (offer.status === 'draft') return 'draft';
  if (!offer.verified) return 'pending';
  return offer.status ?? 'verified';
}

export function getOfferStatusLabel(state: OfferStatus | 'pending'): string {
  switch (state) {
    case 'verified': return 'Verificada';
    case 'published': return 'Publicada';
    case 'pending': return 'Pendiente';
    case 'draft': return 'Borrador';
    case 'expired': return 'Expirada';
  }
}

export function isOfferActive(offer: Offer): boolean {
  return isProductionOfferEligible(offer) && Boolean(getOfferOutboundUrl(offer));
}

export function isOfferVisible(offer: Offer, development = false): boolean {
  if (development && offer.demo) return !isExpired(offer);
  return isOfferActive(offer);
}

export function getCategoryInfo(slug: string) {
  return CATEGORIES.find((category) => category.slug === slug) || null;
}

export function getSafeAffiliateUrl(affiliateUrl?: string) {
  const value = affiliateUrl?.trim();
  return value && isHttpUrl(value) ? value : '';
}

export function isHttpUrl(value: string): boolean {
  return isSafeWebUrl(value);
}

export function getOfferOutboundUrl(offer: Pick<Offer, 'sourceUrl' | 'affiliateUrl'>): string {
  return getSafeAffiliateUrl(offer.affiliateUrl) || (isHttpUrl(offer.sourceUrl) ? offer.sourceUrl.trim() : '');
}

export function getOfferDiscount(offer: Offer): number {
  return calculateDiscount(offer.currentPrice, offer.previousPrice, offer.previousPriceVerified);
}
