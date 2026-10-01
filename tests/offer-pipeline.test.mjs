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
import { importCandidateData } from '../src/lib/candidate-import.js';
import { filterCandidates, findDuplicateCandidate, selectTopCandidates } from '../src/lib/candidate-filter.js';
import { expireOffers } from '../src/lib/offer-expiry.js';
import { appendCandidateHistory } from '../src/lib/candidate-history.js';

const offers = JSON.parse(await readFile(new URL('../src/data/offers.json', import.meta.url), 'utf8'));
const checkedAt = new Date().toISOString();
const candidate = {
  id: 'candidate-test-product',
  title: 'Producto sintético de prueba',
  store: 'Tienda de prueba',
  category: 'tecnologia',
  currentPrice: 29.99,
  previousPrice: 49.99,
  discount: 40,
  currency: 'EUR',
  previousPriceVerified: true,
  sourceUrl: 'https://www.aemet.es/',
  seller: 'Vendedor de prueba',
  checkedAt,
  conditions: 'Condiciones de prueba',
  available: true,
  source: 'generic',
  affiliateUrl: 'https://www.aemet.es/',
  affiliateRequired: false,
  verified: false,
  verificationNotes: [],
  lastVerifiedAt: null,
  expiresAt: null,
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
  assert.equal(scoreCandidate(candidate).score, 81);
  assert.equal(scoreCandidate(candidate).components.reduce((sum, item) => sum + item.maximum, 0), 100);
  assert.ok(scoreCandidate(candidate).explanation.some((line) => line.includes('Potencial de afiliación')));
  assert.equal(verifyCandidate(candidate).valid, true);
  assert.equal(verifyCandidate({ ...candidate, currentPrice: 0 }).valid, false);
  assert.equal(verifyCandidate({ ...candidate, sourceUrl: 'javascript:alert(1)' }).valid, false);
  assert.equal(verifyCandidate({ ...candidate, expiresAt: '2000-01-01' }).valid, false);
  assert.throws(() => genericSource.normalizeCandidate({
    ...candidate,
    demo: false,
    sourceUrl: 'https://example.com/not-demo'
  }), /sourceUrl debe ser/);
});

test('candidate importer validates common JSON and CSV fields and rejects incomplete imports explicitly', () => {
  const jsonCandidates = importCandidateData(JSON.stringify([candidate]), { format: 'json', source: 'aliexpress' });
  assert.equal(jsonCandidates[0].source, 'aliexpress');
  assert.equal(jsonCandidates[0].discount, 40);
  assert.equal(jsonCandidates[0].currency, 'EUR');

  const csv = [
    'id,title,store,category,currentPrice,previousPrice,previousPriceVerified,currency,sourceUrl,conditions,available,checkedAt,affiliateUrl',
    `csv-1,"Lámpara, pequeña",AliExpress,hogar,20,25,true,EUR,https://www.aemet.es/,"Envío según vendedor",true,${checkedAt},https://www.aemet.es/`
  ].join('\n');
  const csvCandidates = importCandidateData(csv, { format: 'csv', source: 'aliexpress' });
  assert.equal(csvCandidates[0].title, 'Lámpara, pequeña');
  assert.equal(csvCandidates[0].discount, 20);
  assert.equal(csvCandidates[0].source, 'aliexpress');
  const spanishCsv = [
    'id;title;store;category;currentPrice;previousPrice;previousPriceVerified;currency;sourceUrl;conditions;available;checkedAt',
    `csv-2;Lámpara;AliExpress;hogar;"1.234,56 €";"1.500,00 €";true;EUR;https://www.aemet.es/;"Sin condiciones especiales";true;${checkedAt}`
  ].join('\n');
  const spanishCandidates = importCandidateData(spanishCsv, { format: 'csv', source: 'aliexpress' });
  assert.equal(spanishCandidates[0].currentPrice, 1234.56);
  assert.equal(spanishCandidates[0].discount, 18);

  assert.throws(() => importCandidateData(JSON.stringify([{ ...candidate, conditions: '' }]), { source: 'aliexpress' }), /No se importó ningún candidato/);
  assert.throws(() => importCandidateData(JSON.stringify([{ ...candidate, available: 'maybe' }]), { source: 'aliexpress' }), /available debe indicar/);
  assert.throws(() => importCandidateData(JSON.stringify([{ ...candidate, previousPriceVerified: true, discount: 39 }]), { source: 'aliexpress' }), /discount debe coincidir/);
});

test('candidate filters reject unavailable, unverified-discount, duplicate and DEMO records', () => {
  const unavailable = { ...candidate, id: 'unavailable', available: false };
  const noVerifiedPrice = { ...candidate, id: 'no-price-proof', previousPrice: null, discount: null, previousPriceVerified: false };
  const demo = { ...candidate, id: 'demo-candidate', demo: true };
  const duplicate = { ...candidate, id: 'same-product', title: candidate.title.toUpperCase() };
  assert.equal(findDuplicateCandidate(duplicate, [candidate]), candidate);

  const result = filterCandidates([candidate, unavailable, noVerifiedPrice, demo, duplicate], {
    existingCandidates: [],
    existingOffers: []
  });
  assert.deepEqual(result.accepted.map((item) => item.id), ['candidate-test-product']);
  assert.equal(result.rejected.length, 4);
  assert.match(result.rejected[0].reason, /disponibilidad/);
  assert.match(result.rejected[1].reason, /descuento verificable/);

  const top = selectTopCandidates([candidate], { minScore: 70, minDiscount: 20, maxPrice: 35, categories: ['tecnologia'] });
  assert.equal(top.length, 1);
  assert.ok(top[0].result.explanation.some((reason) => reason.includes('Descuento verificable')));
  assert.equal(selectTopCandidates([candidate], { minScore: 70, minDiscount: 20, maxPrice: 10 }).length, 0);
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

test('verification records source limitations, history captures prices, and expired offers change state', () => {
  const checked = verifyCandidate(candidate);
  assert.equal(checked.valid, true);
  assert.equal(checked.verified, false);
  assert.ok(checked.verificationNotes.some((note) => note.includes('No se ha consultado')));

  const history = appendCandidateHistory([], [candidate], 'pendiente', checkedAt);
  assert.equal(history[0].price, candidate.currentPrice);
  assert.equal(history[0].source, candidate.source);

  const expired = expireOffers([
    { id: 'expired', status: 'published', expiresAt: '2020-01-01' },
    { id: 'invalid-date', status: 'published', expiresAt: 'not-a-date' },
    { id: 'current', status: 'published', expiresAt: '2030-01-01' }
  ], new Date('2026-10-01T00:00:00.000Z'));
  assert.equal(expired.expiredCount, 2);
  assert.equal(expired.offers[0].status, 'expired');
  assert.equal(expired.offers[1].status, 'expired');
  assert.equal(expired.offers[2].status, 'published');
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
  await assert.rejects(() => findCandidates('aliexpress'), /no tiene una fuente oficial configurada/);
});
