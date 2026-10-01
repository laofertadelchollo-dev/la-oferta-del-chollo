import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isProductionOfferEligible, isSafeWebUrl } from '../src/lib/offer-policy.js';

const offers = JSON.parse(await readFile(new URL('../src/data/offers.json', import.meta.url), 'utf8'));
const guides = JSON.parse(await readFile(new URL('../src/data/guides.json', import.meta.url), 'utf8'));

test('all sample offers are clearly marked as development-only demo content', () => {
  assert.equal(offers.length, 10);
  for (const offer of offers) {
    assert.equal(offer.demo, true, `${offer.id} must remain a demo`);
    assert.ok(['draft', 'verified', 'published', 'expired'].includes(offer.status));
    assert.equal(typeof offer.previousPriceVerified, 'boolean');
  }
});

test('unverified reference prices cannot claim a discount', () => {
  for (const offer of offers) {
    if (!offer.previousPriceVerified) {
      assert.equal(offer.discount, 0, `${offer.id} has an unverified previous price`);
    } else {
      assert.ok(offer.previousPrice > offer.currentPrice, `${offer.id} needs a higher verified reference price`);
    }
  }
});

test('production offer policy rejects demo, incomplete, expired, and monetized offers without an affiliate URL', () => {
  const offer = {
    id: 'real-offer-1',
    title: 'Producto comprobado',
    store: 'Tienda real',
    category: 'tecnologia',
    currentPrice: 29.99,
    sourceUrl: 'https://shop.example-store.es/product',
    affiliateUrl: 'https://tracking.example-affiliate.es/product',
    publishedAt: '2026-09-30',
    lastVerifiedAt: '2026-09-30T10:00:00.000Z',
    status: 'published',
    verified: true,
    demo: false
  };

  assert.equal(isProductionOfferEligible(offer, '2026-10-01'), true);
  assert.equal(isProductionOfferEligible({ ...offer, demo: true }, '2026-10-01'), false);
  assert.equal(isProductionOfferEligible({ ...offer, currentPrice: 0 }, '2026-10-01'), false);
  assert.equal(isProductionOfferEligible({ ...offer, verified: false }, '2026-10-01'), false);
  assert.equal(isProductionOfferEligible({ ...offer, lastVerifiedAt: '' }, '2026-10-01'), false);
  assert.equal(isProductionOfferEligible({ ...offer, expiresAt: '2026-09-30' }, '2026-10-01'), false);
  assert.equal(isProductionOfferEligible({ ...offer, affiliateUrl: '' }, '2026-10-01'), false);
  assert.equal(isProductionOfferEligible({ ...offer, sourceUrl: 'https://example.com/demo' }, '2026-10-01'), false);
  assert.equal(isProductionOfferEligible({ ...offer, status: 'verified', affiliateUrl: '' }, '2026-10-01'), true);
  assert.equal(isProductionOfferEligible({ ...offer, status: 'verified', expiresAt: '2026-02-31' }, '2026-10-01'), false);
  assert.equal(isSafeWebUrl('https://user:password@shop.example-store.es/product'), false);
});

test('editorial guides have unique slugs, SEO metadata, structured sections and practical advice', () => {
  assert.ok(guides.length >= 10);
  assert.equal(new Set(guides.map((guide) => guide.slug)).size, guides.length);
  for (const guide of guides) {
    assert.ok(guide.title.trim());
    assert.ok(guide.seoTitle.trim());
    assert.ok(guide.metaDescription.trim());
    assert.ok(guide.excerpt.trim());
    assert.ok(guide.introduction.trim());
    assert.ok(guide.sections.length >= 3);
    assert.ok(guide.sections.every((section) => section.heading && section.paragraphs.length > 0));
    assert.ok(guide.practicalTips.length >= 3);
    assert.ok(guide.conclusion.trim());
  }
});
