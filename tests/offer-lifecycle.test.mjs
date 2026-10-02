import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateStoredOfferList } from '../src/lib/offer-import.js';
import {
  AVAILABILITY_STATES,
  filterAndSortOffers,
  getAvailabilityState,
  getOffersNeedingReview,
  parseAliExpressPromotionEndDate,
  recordOfferPriceChange
} from '../src/lib/offer-lifecycle.js';
import { parseAliExpressPromoItems } from '../src/lib/aliexpress-promo-items.js';

const baseOffer = {
  id: 'offer-test',
  title: 'Auriculares Bluetooth',
  slug: 'auriculares-bluetooth',
  store: 'AliExpress',
  category: 'electronica',
  subcategory: 'Audio',
  tags: ['auriculares', 'bluetooth', 'audio', 'movil'],
  currentPrice: 14.99,
  currency: 'EUR',
  discount: null,
  coupon: '',
  conditions: 'Sin condiciones especiales',
  seller: '',
  description: 'Descripción de prueba.',
  shortDescription: 'Resumen de prueba.',
  sourceUrl: 'https://www.aemet.es/',
  affiliateUrl: 'https://www.aemet.es/',
  publishedAt: '2020-01-10',
  lastVerifiedAt: '2020-01-10T12:00:00.000Z',
  status: 'published',
  verified: true,
  demo: false,
  featured: false,
  featuredToday: false,
  score: 0,
  availabilityStatus: 'active',
  promotionEndDate: null,
  lastCheckedAt: '2026-01-10T12:00:00.000Z'
};

test('active offer and future promotion date remain active', () => {
  assert.equal(getAvailabilityState(baseOffer, '2026-01-11'), 'active');
  assert.equal(getAvailabilityState({ ...baseOffer, promotionEndDate: '2026-01-12' }, '2026-01-11'), 'active');
  assert.equal(getOffersNeedingReview([{ ...baseOffer, promotionEndDate: '2026-01-12' }], {
    now: new Date('2026-01-11T12:00:00.000Z')
  }).length, 1);
});

test('expired promotion is distinct from stock and unavailable states', () => {
  assert.equal(getAvailabilityState({ ...baseOffer, promotionEndDate: '2026-01-10' }, '2026-01-11'), 'promotion_expired');
  assert.equal(getAvailabilityState({ ...baseOffer, availabilityStatus: 'out_of_stock' }, '2026-01-11'), 'out_of_stock');
  assert.equal(getAvailabilityState({ ...baseOffer, availabilityStatus: 'unavailable' }, '2026-01-11'), 'unavailable');
});

test('promotion date parser handles supported AliExpress Spanish labels and rejects invalid dates', () => {
  assert.equal(parseAliExpressPromotionEndDate('Oferta válida hasta 15/10/2026'), '2026-10-15');
  assert.equal(parseAliExpressPromotionEndDate('Válido hasta: 15-10-2026'), '2026-10-15');
  assert.equal(parseAliExpressPromotionEndDate('Promoción hasta 31/02/2026'), null);
  assert.equal(parseAliExpressPromotionEndDate('Sin fecha'), null);
});

test('Promo Items parsing imports a structured promotion end date', () => {
  const parsed = parseAliExpressPromoItems([
    'Recomendaciones de productos en oferta',
    'Cabezal de ducha con filtro',
    'Ahora precio: EUR 11.61',
    'Oferta válida hasta 15/10/2026',
    'https://s.click.aliexpress.com/e/_promo'
  ].join('\n'));
  assert.equal(parsed.promotionEndDate, '2026-10-15');
});

test('price changes record old and new prices and checked time without duplicate writes', () => {
  const updated = recordOfferPriceChange(baseOffer, 9.89, 'EUR', '2026-02-01T10:00:00.000Z');
  assert.equal(updated.currentPrice, 9.89);
  assert.equal(updated.lastCheckedAt, '2026-02-01T10:00:00.000Z');
  assert.deepEqual(updated.priceHistory, [
    { checkedAt: '2026-02-01T10:00:00.000Z', price: 14.99, currency: 'EUR' },
    { checkedAt: '2026-02-01T10:00:00.000Z', price: 9.89, currency: 'EUR' }
  ]);
  const unchanged = recordOfferPriceChange(updated, 9.89, 'EUR', '2026-02-02T10:00:00.000Z');
  assert.equal(unchanged.priceHistory.length, 2);
  assert.throws(() => recordOfferPriceChange(baseOffer, 0), /mayor que cero/);
});

test('category, subcategory, tags, featured and Offers of the Day remain independent', () => {
  const tagged = { ...baseOffer, featured: true, featuredToday: true };
  assert.equal(filterAndSortOffers([tagged], { category: 'electronica' }).length, 1);
  assert.equal(filterAndSortOffers([tagged], { subcategory: 'audio' }).length, 1);
  assert.equal(filterAndSortOffers([tagged], { query: 'auriculares' }).length, 1);
  assert.equal(filterAndSortOffers([tagged], { featuredToday: true }).length, 1);
  assert.equal(filterAndSortOffers([tagged], { featured: true }).length, 1);
  assert.equal(filterAndSortOffers([tagged], { featuredToday: true, featured: true }).length, 1);
});

test('state, category, review and sort filters work independently', () => {
  const offers = [
    baseOffer,
    { ...baseOffer, id: 'other', category: 'hogar', availabilityStatus: 'price_update', currentPrice: 8 },
    { ...baseOffer, id: 'expired', promotionEndDate: '2026-01-01' }
  ];
  assert.deepEqual(filterAndSortOffers(offers, { state: 'price_update' }).map((offer) => offer.id), ['other']);
  assert.deepEqual(filterAndSortOffers(offers, { category: 'hogar' }).map((offer) => offer.id), ['other']);
  assert.deepEqual(filterAndSortOffers(offers, { needsUpdate: true }, new Date('2026-01-11T12:00:00.000Z')).map((offer) => offer.id), ['other', 'expired']);
  assert.deepEqual(filterAndSortOffers(offers, { sort: 'price' }).map((offer) => offer.id), ['other', 'offer-test', 'expired']);
});

test('legacy offers without lifecycle fields migrate without losing their data', () => {
  const legacy = { ...baseOffer };
  for (const field of ['availabilityStatus', 'promotionEndDate', 'lastCheckedAt', 'priceHistory', 'subcategory', 'featuredToday']) {
    delete legacy[field];
  }
  const [migrated] = migrateStoredOfferList([legacy]);
  assert.equal(migrated.title, legacy.title);
  assert.equal(migrated.availabilityStatus, 'active');
  assert.equal(migrated.promotionEndDate, null);
  assert.equal(migrated.lastCheckedAt, '');
  assert.deepEqual(migrated.priceHistory, []);
  assert.equal(migrated.subcategory, '');
  assert.equal(migrated.featuredToday, false);
});

test('all requested availability states are represented', () => {
  assert.deepEqual(AVAILABILITY_STATES, [
    'draft', 'active', 'price_update', 'promotion_expired',
    'out_of_stock', 'unavailable', 'archived'
  ]);
});
