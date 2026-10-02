import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { migrateStoredOfferList, parseOfferJson, validateOfferList } from '../src/lib/offer-import.js';
import { scoreCandidate } from '../src/lib/offer-scoring.js';
import { verifyCandidate, verifyOffer } from '../src/lib/offer-verification.js';
import { createOffer, publishOffer } from '../src/lib/offer-publishing.js';
import { generateTelegramDraft, generateTelegramPost } from '../src/lib/offer-telegram.js';
import { findCandidates } from '../src/lib/sources/index.js';
import { genericSource } from '../src/lib/sources/generic.js';
import { importCandidateData } from '../src/lib/candidate-import.js';
import { filterCandidates, findDuplicateCandidate, selectTopCandidates } from '../src/lib/candidate-filter.js';
import { expireOffers } from '../src/lib/offer-expiry.js';
import { appendCandidateHistory } from '../src/lib/candidate-history.js';
import { createAliExpressDraft, importAliExpressCsv } from '../src/lib/aliexpress-manual-import.js';
import {
  createAliExpressPromoDraft,
  findAliExpressPromoDuplicate,
  parseAliExpressPromoItems,
  parseAliExpressPrice,
  validateAliExpressPromoDraft
} from '../src/lib/aliexpress-promo-items.js';

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

test('AliExpress quick import creates an incomplete, unverified local draft without fabricating links', () => {
  const draft = createAliExpressDraft({
    title: 'Lámpara LED para escritorio',
    sourceUrl: 'https://www.aemet.es/product/desk-lamp',
    currentPrice: '29,99',
    previousPrice: '39,99',
    category: 'tecnologia',
    conditions: 'Datos introducidos por la persona operadora'
  }, { categories: ['tecnologia'] });

  assert.equal(draft.store, 'AliExpress');
  assert.equal(draft.slug, 'lampara-led-para-escritorio');
  assert.equal(draft.currentPrice, 29.99);
  assert.equal(draft.previousPrice, 39.99);
  assert.equal(draft.discount, 25);
  assert.equal(draft.previousPriceVerified, false);
  assert.equal(draft.affiliateUrl, '');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.verified, false);
  assert.equal(draft.demo, false);
  assert.match(draft.shortDescription, /Borrador pendiente de verificación/);

  const partial = createAliExpressDraft({ title: 'Ficha sin precio' });
  assert.equal(partial.currentPrice, 0);
  assert.equal(partial.sourceUrl, '');
  assert.equal(partial.affiliateUrl, '');
  assert.equal(partial.category, '');
  assert.equal(validateOfferList([partial]).length, 1);
  assert.throws(() => createAliExpressDraft({ title: 'URL inválida', sourceUrl: 'javascript:alert(1)' }), /URL original/);
  assert.throws(() => createAliExpressDraft({ title: 'Precio inválido', currentPrice: 'cero' }), /precio mayor que cero/);
  assert.throws(() => createAliExpressDraft({ title: 'Categoría inválida', category: 'otra' }, { categories: ['tecnologia'] }), /categoría válida/);
});

test('AliExpress quick import detects duplicates by source URL and falls back to normalized title', () => {
  const original = createAliExpressDraft({
    title: 'Auriculares inalámbricos',
    sourceUrl: 'https://www.aemet.es/item/123'
  });
  assert.throws(() => createAliExpressDraft({
    title: 'Otro título',
    sourceUrl: 'https://WWW.AEMET.ES/item/123#tracking'
  }, { existingOffers: [original] }), /Oferta duplicada/);
  assert.throws(() => createAliExpressDraft({
    title: 'Auriculares inalambricos'
  }, { existingOffers: [original] }), /Oferta duplicada/);
});

test('AliExpress imported offers cannot be published without verification and a real affiliate URL', () => {
  const draft = createAliExpressDraft({
    title: 'Soporte de escritorio',
    sourceUrl: 'https://www.aemet.es/stand',
    currentPrice: '15.00',
    category: 'tecnologia',
    conditions: 'Precio y condiciones pendientes de revisión'
  });
  assert.throws(() => publishOffer(draft), /estado verificado/);

  const verification = verifyOffer(draft);
  assert.equal(verification.valid, true);
  assert.throws(() => publishOffer({ ...verification.offer, affiliateUrl: '' }), /enlace afiliado/);
  assert.throws(() => publishOffer({ ...verification.offer, verified: false }), /no está verificada/);
});

test('AliExpress Promo Items parser extracts title, EUR price and the exact affiliate URL', () => {
  const parsed = parseAliExpressPromoItems([
    '¡Mejores Recomendaciones de Productos en Oferta!',
    '2025 nuevo cabezal de ducha ion con filtro de mano, turbocompresor con múltiples modos de pulverización, interruptor de encendido/apagado de filtro incorporado',
    'Ahora precio: EUR 11.61',
    '🔗 Haz clic y compra: [https://s.click.aliexpress.com/e/_c3Er9SYh](https://s.click.aliexpress.com/e/_c3Er9SYh)',
    'Idioma: Spanish',
    'Tracking ID: laofertadelchollo'
  ].join('\n'));

  assert.equal(parsed.title, '2025 nuevo cabezal de ducha ion con filtro de mano, turbocompresor con múltiples modos de pulverización, interruptor de encendido/apagado de filtro incorporado');
  assert.equal(parsed.currentPrice, 11.61);
  assert.equal(parsed.currency, 'EUR');
  assert.equal(parsed.affiliateUrl, 'https://s.click.aliexpress.com/e/_c3Er9SYh');
  assert.equal(parsed.language, 'Spanish');
  assert.equal(parsed.trackingId, 'laofertadelchollo');
});

test('AliExpress Promo Items parser tolerates decimal commas, price variants, emojis and line endings', () => {
  const commaPrice = parseAliExpressPromoItems('¡Oferta! 🔥\nAuriculares útiles\nAhora precio: 11,61 €\nhttps://s.click.aliexpress.com/e/item');
  const codeFirst = parseAliExpressPromoItems('Material promocional\rProducto de prueba\rEUR 11.61\rhttps://s.click.aliexpress.com/e/item');
  const codeLast = parseAliExpressPromoItems('Recomendaciones\n💡 Lámpara de escritorio\n11.61 EUR\n🔗 https://s.click.aliexpress.com/e/item');

  assert.equal(commaPrice.currentPrice, 11.61);
  assert.equal(commaPrice.currency, 'EUR');
  assert.equal(commaPrice.title, 'Auriculares útiles');
  assert.equal(codeFirst.currentPrice, 11.61);
  assert.equal(codeFirst.currency, 'EUR');
  assert.equal(codeFirst.title, 'Producto de prueba');
  assert.equal(codeLast.currentPrice, 11.61);
  assert.equal(codeLast.affiliateUrl, 'https://s.click.aliexpress.com/e/item');
  assert.equal(parseAliExpressPrice('1.234,56 €'), 1234.56);
});

test('AliExpress Promo Items drafts validate title, price and affiliate URL before verification', () => {
  const missingAffiliate = createAliExpressPromoDraft({
    title: 'Producto pendiente de enlace',
    currentPrice: 11.61,
    currency: 'EUR'
  });
  const noTitle = validateAliExpressPromoDraft({ title: '', affiliateUrl: '' });
  const invalidPrice = validateAliExpressPromoDraft({ title: 'Producto', currentPrice: 0, currency: 'EUR' });
  const verification = verifyOffer({ ...missingAffiliate, currency: '' });

  assert.equal(missingAffiliate.status, 'draft');
  assert.equal(missingAffiliate.verified, false);
  assert.equal(missingAffiliate.demo, false);
  assert.deepEqual(noTitle.errors, ['Falta el título.']);
  assert.ok(invalidPrice.errors.includes('El precio no es válido.'));
  assert.ok(verification.errors.some((error) => /enlace afiliado/i.test(error)));
  assert.ok(verification.errors.some((error) => /moneda/i.test(error)));
});

test('AliExpress Promo Items draft associates one to six ordered images and preserves legacy images', () => {
  const makeImage = (order) => ({ url: `data:image/webp;base64,${Buffer.from(`image-${order}`).toString('base64')}`, isPrimary: order === 0, order });
  const oneImage = createAliExpressPromoDraft({
    title: 'Producto con una imagen', images: [makeImage(0)]
  });
  const sixImages = createAliExpressPromoDraft({
    title: 'Producto con seis imágenes', images: Array.from({ length: 6 }, (_, index) => makeImage(index))
  });

  assert.equal(oneImage.images.length, 1);
  assert.equal(oneImage.image, oneImage.images[0].url);
  assert.equal(sixImages.images.length, 6);
  assert.equal(sixImages.images.filter((image) => image.isPrimary).length, 1);
  assert.equal(sixImages.images[0].isPrimary, true);
  assert.equal(validateOfferList([offers[0]]).length, 1);
  assert.equal(validateOfferList([{
    ...sixImages,
    currentPrice: 1,
    affiliateUrl: 'https://s.click.aliexpress.com/e/image-test'
  }]).length, 1);
  const legacyTelegramOffer = {
    ...offers[0],
    demo: false,
    currentPrice: 12.34,
    sourceUrl: 'https://www.aemet.es/',
    affiliateUrl: 'https://www.aemet.es/',
    shortDescription: 'Resumen de prueba.',
    description: 'Descripción de prueba.'
  };
  assert.equal(generateTelegramDraft(legacyTelegramOffer).images.length, (legacyTelegramOffer.image ? 1 : 0));
  assert.equal(generateTelegramDraft({
    ...sixImages,
    currentPrice: 1,
    sourceUrl: 'https://www.aemet.es/',
    affiliateUrl: 'https://www.aemet.es/',
    shortDescription: 'Resumen de prueba.',
    description: 'Descripción de prueba.'
  }).images.length, 6);
});

test('AliExpress Promo Items import detects duplicates by affiliate URL and title fallback', () => {
  const existing = createAliExpressPromoDraft({
    title: 'Lámpara inalámbrica',
    affiliateUrl: 'https://s.click.aliexpress.com/e/item-1'
  });
  const byAffiliate = findAliExpressPromoDuplicate({
    title: 'Otro título',
    affiliateUrl: 'https://s.click.aliexpress.com/e/item-1'
  }, [existing]);
  const byTitle = findAliExpressPromoDuplicate({
    title: 'Lampara inalambrica',
    affiliateUrl: ''
  }, [{ title: 'Lámpara inalámbrica', affiliateUrl: '', sourceUrl: '' }]);

  assert.equal(byAffiliate, existing);
  assert.ok(byTitle);
  assert.throws(() => createAliExpressPromoDraft({
    title: 'Producto distinto',
    affiliateUrl: 'https://s.click.aliexpress.com/e/item-1'
  }, { existingOffers: [existing] }), /parece estar ya importado/);
});

test('AliExpress Promo Items can be verified and published with an affiliate URL without inventing sourceUrl', () => {
  const draft = createAliExpressPromoDraft({
    title: 'Accesorio real',
    category: 'tecnologia',
    currentPrice: 11.61,
    currency: 'EUR',
    affiliateUrl: 'https://s.click.aliexpress.com/e/item-2',
    conditions: 'Precio y disponibilidad comprobados manualmente',
    shortDescription: 'Accesorio revisado manualmente.',
    description: 'Descripción editorial completada tras revisar la ficha.'
  });
  const verification = verifyOffer(draft);
  assert.equal(verification.valid, true);
  assert.equal(verification.offer.sourceUrl, '');
  assert.equal(verification.offer.status, 'verified');
  assert.equal(publishOffer(verification.offer).status, 'published');
});

test('AliExpress CSV import reports every row, imports multiple valid offers, and rejects the DEMO template row', async () => {
  const csv = [
    'title,sourceUrl,affiliateUrl,currentPrice,previousPrice,coupon,category,seller,image',
    '"Lámpara, compacta",https://www.aemet.es/item/1,https://www.aemet.es/track/1,"29,99",39.99,,hogar,Marca,',
    '',
    'Bolsa organizadora,,,,,,,,',
    'URL inválida,javascript:alert(1),,,,,,,',
    'Duplicada,https://www.aemet.es/item/1,,,,,,,',
    'DEMO - NO IMPORTAR ESTA FILA,,,,,,,,'
  ].join('\n');
  const result = importAliExpressCsv(csv, { categories: ['hogar', 'tecnologia'] });

  assert.equal(result.offers.length, 2);
  assert.equal(result.offers[0].title, 'Lámpara, compacta');
  assert.equal(result.offers[0].currentPrice, 29.99);
  assert.equal(result.offers[0].status, 'draft');
  assert.equal(result.offers[1].currentPrice, 0);
  assert.deepEqual(result.results.map(({ ok }) => ok), [true, true, false, false, false]);
  assert.equal(result.results[2].row, 5);
  assert.match(result.results[2].message, /URL original/);
  assert.match(result.results[3].message, /duplicada/);
  assert.match(result.results[4].message, /DEMO/);

  const template = await readFile(new URL('../public/templates/aliexpress-offers-template.csv', import.meta.url), 'utf8');
  const templateResult = importAliExpressCsv(template);
  assert.equal(templateResult.offers.length, 0);
  assert.equal(templateResult.results[0].ok, false);
  assert.match(templateResult.results[0].message, /DEMO/);

  const semicolonCsv = [
    'title;sourceUrl;affiliateUrl;currentPrice;previousPrice;coupon;category;seller;image',
    'Mesa auxiliar;https://www.aemet.es/item/mesa;;"12,50 €";"15,00 €";;hogar;;'
  ].join('\n');
  const semicolonResult = importAliExpressCsv(semicolonCsv, { categories: ['hogar'] });
  assert.equal(semicolonResult.offers.length, 1);
  assert.equal(semicolonResult.offers[0].currentPrice, 12.5);
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
