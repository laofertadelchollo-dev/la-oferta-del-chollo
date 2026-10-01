import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { migrateStoredOfferList, parseOfferJson, validateOfferList } from '../src/lib/offer-import.js';
import { scoreCandidate } from '../src/lib/offer-scoring.js';
import { verifyCandidate, verifyOffer } from '../src/lib/offer-verification.js';
import { createOffer, publishOffer } from '../src/lib/offer-publishing.js';
import { generateTelegramPost } from '../src/lib/offer-telegram.js';
import { findCandidates } from '../src/lib/sources/index.js';
import { genericSource } from '../src/lib/sources/generic.js';

const offers = JSON.parse(await readFile(new URL('../src/data/offers.json', import.meta.url), 'utf8'));
const checkedAt = new Date().toISOString();
const candidate = {
  title: 'Producto sintético de prueba',
  store: 'Tienda de prueba',
  currentPrice: 29.99,
  previousPrice: 49.99,
  previousPriceVerified: true,
  sourceUrl: 'https://www.aemet.es/',
  seller: 'Vendedor de prueba',
  checkedAt,
  conditions: 'Condiciones de prueba',
  demo: false
};

test('JSON import checks the offer schema and reports missing fields', () => {
  assert.equal(validateOfferList(offers).length, 10);
  assert.equal(parseOfferJson(JSON.stringify(offers)).length, 10);

  const incomplete = { ...offers[0] };
  delete incomplete.sourceUrl;
  assert.throws(() => validateOfferList([incomplete]), /falta el campo obligatorio «sourceUrl»/);
  assert.throws(() => parseOfferJson('[{'), /JSON inválido/);
});

test('legacy browser records migrate additive fields without removing offers', () => {
  const legacy = { ...offers[0] };
  delete legacy.score;
  delete legacy.discount;
  const [migrated] = migrateStoredOfferList([legacy]);
  assert.equal(migrated.id, legacy.id);
  assert.equal(migrated.score, 0);
  assert.equal(migrated.discount, 0);
});

test('candidate normalization, scoring and verification reject invalid prices and URLs', async () => {
  const normalized = genericSource.normalizeCandidate({
    ...candidate,
    demo: true,
    sourceUrl: 'https://example.com/demo'
  });
  assert.equal(normalized.demo, true);
  assert.equal(scoreCandidate(candidate), 100);
  assert.equal(verifyCandidate(candidate).valid, true);
  assert.equal(verifyCandidate({ ...candidate, currentPrice: 0 }).valid, false);
  assert.equal(verifyCandidate({ ...candidate, sourceUrl: 'javascript:alert(1)' }).valid, false);
  assert.equal(verifyCandidate({ ...candidate, expiresAt: '2000-01-01' }).valid, false);
  assert.throws(() => genericSource.normalizeCandidate({
    ...candidate,
    sourceUrl: 'https://example.com/not-demo'
  }), /sourceUrl debe ser/);
});

test('manual verification and publication require actual non-demo offer data', () => {
  const draft = createOffer(candidate, {
    category: 'tecnologia',
    shortDescription: 'Resumen editorial de prueba.',
    description: 'Contexto editorial de prueba.',
    affiliateUrl: 'https://www.aemet.es/'
  });
  const verification = verifyOffer(draft);
  assert.equal(verification.valid, true);
  assert.equal(verification.offer.status, 'verified');
  assert.equal(verification.offer.verified, true);

  const published = publishOffer(verification.offer);
  assert.equal(published.status, 'published');
  assert.throws(() => publishOffer({ ...verification.offer, affiliateUrl: '' }), /enlace afiliado/);
  assert.throws(() => publishOffer({ ...verification.offer, demo: true }), /DEMO/);
  assert.throws(() => publishOffer({ ...verification.offer, status: 'draft' }), /estado verificado/);
  assert.throws(() => publishOffer({ ...verification.offer, expiresAt: '2000-01-01' }), /caducad|requisitos/);
});

test('Telegram draft uses verified offer values and never labels a non-affiliate URL as affiliate', () => {
  const offer = {
    ...createOffer(candidate, {
      category: 'tecnologia',
      shortDescription: 'Resumen basado en los datos de prueba.',
      description: 'Descripción de prueba.',
      affiliateUrl: 'https://www.aemet.es/'
    }),
    ...verifyOffer(createOffer(candidate, {
      category: 'tecnologia',
      shortDescription: 'Resumen basado en los datos de prueba.',
      description: 'Descripción de prueba.',
      affiliateUrl: 'https://www.aemet.es/'
    })).offer
  };
  const text = generateTelegramPost(offer);
  assert.match(text, /💰 Precio: 29,99 €/);
  assert.match(text, /📉 Descuento: 40 %/);
  assert.match(text, /🔗 Enlace de afiliado\./);
  assert.match(text, /https:\/\/www\.aemet\.es\//);
  assert.throws(() => generateTelegramPost({ ...offer, demo: true }), /DEMO/);
  assert.throws(() => generateTelegramPost({ ...offer, sourceUrl: '', affiliateUrl: '' }), /URL de producto/);
});

test('unconfigured official-source adapters fail explicitly instead of scraping', async () => {
  await assert.rejects(() => findCandidates('aliexpress'), /no está conectado/);
});
