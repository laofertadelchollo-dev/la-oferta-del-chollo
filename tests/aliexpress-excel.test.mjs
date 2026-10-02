import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/node';
import {
  importAliExpressExcelRows,
  normalizeAliExpressImageUrl,
  parseAliExpressExcelRows
} from '../src/lib/aliexpress-excel.js';

const headers = [
  'Product ID', 'Product Name', 'Product URL', 'Affiliate URL',
  'Main Image URL', 'Image URL 2', 'Video URL',
  'Original Price (EUR)', 'Current Price (EUR)', 'Commission Rate',
  'Estimated Commission', '180-day sales', 'Positive Rating',
  'Coupon Code', 'Coupon Value', 'Coupon Quantity', 'Minimum Spend',
  'Coupon Start Date', 'Coupon End Date', 'Seller Region'
];
const validRow = [
  '10001', 'Lámpara LED de escritorio', 'https://www.aliexpress.com/item/10001.html',
  'https://s.click.aliexpress.com/e/_lamp', '//ae01.alicdn.com/kf/lamp.jpg',
  'https://ae01.alicdn.com/kf/lamp-side.jpg', 'https://video.aliexpress-media.com/lamp.mp4',
  8.18, 4.09, 0.12, 0.49, 850, 96, 'SAVE2', 2, 300, 10,
  '2026-10-01', '2026-10-31', 'CN'
];

function workbookBuffer(sheetRows) {
  const columnName = (number) => {
    let name = '';
    let current = number;
    while (current > 0) {
      const remainder = (current - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      current = Math.floor((current - 1) / 26);
    }
    return name;
  };
  const escapeXml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const sheet = sheetRows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
      if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value ?? '')}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Promo Items" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)]))));
}

async function rowsFromWorkbook(rows) {
  const sheets = await readXlsxFile(workbookBuffer(rows));
  return sheets[0].data;
}

test('reads AliExpress XLSX workbooks and detects headers after a title row', async () => {
  const worksheetRows = await rowsFromWorkbook([
    ['AliExpress Promo Items export'],
    headers,
    validRow
  ]);
  const parsed = parseAliExpressExcelRows(worksheetRows, {
    fileName: 'promo-items.xlsx',
    importedAt: '2026-10-02T18:00:00.000Z'
  });
  assert.equal(parsed.headerRow, 2);
  assert.equal(parsed.detectedRows, 1);
  assert.equal(parsed.products[0].productId, '10001');
  assert.equal(parsed.products[0].source, 'aliexpress_excel');
  assert.equal(parsed.products[0].sourceFileName, 'promo-items.xlsx');
  assert.equal(parsed.products[0].importedAt, '2026-10-02T18:00:00.000Z');
  assert.equal(parsed.products[0].originalData['Seller Region'], 'CN');
});

test('recognizes localized and varied column names and interprets prices, discounts and commission metrics', () => {
  const parsed = parseAliExpressExcelRows([
    ['ID producto', 'Nombre del producto', 'Enlace de seguimiento', 'Imagen principal', 'Precio anterior (€)', 'Precio actual (€)', 'Tasa de comisión', 'Ventas últimos 180 días', 'Valoración positiva'],
    ['A-2', 'Auriculares inalámbricos', 'https://s.click.aliexpress.com/e/_headphones', '//cdn.alicdn.com/headphones.webp', '20,00 €', '15,00 €', '10%', '200', '97%']
  ]);
  const product = parsed.products[0];
  assert.equal(product.productId, 'A-2');
  assert.equal(product.originalPrice, 20);
  assert.equal(product.currentPrice, 15);
  assert.equal(product.currency, 'EUR');
  assert.equal(product.discountPercent, 25);
  assert.equal(product.commissionPercent, 10);
  assert.equal(product.estimatedCommission, 1.5);
  assert.equal(product.sales180d, 200);
  assert.equal(product.positiveRating, 97);
  assert.equal(product.theoreticalCommissionVolume, 300);
});

test('normalizes protocol-relative image URLs and retains additional image URLs', () => {
  const parsed = parseAliExpressExcelRows([headers, validRow]);
  const product = parsed.products[0];
  assert.equal(product.imageUrl, 'https://ae01.alicdn.com/kf/lamp.jpg');
  assert.deepEqual(product.additionalImageUrls, ['https://ae01.alicdn.com/kf/lamp-side.jpg']);
  assert.equal(normalizeAliExpressImageUrl('//img.alicdn.com/a.png'), 'https://img.alicdn.com/a.png');
  assert.equal(normalizeAliExpressImageUrl('javascript:alert(1)'), '');
});

test('imports valid rows despite invalid IDs, prices, affiliate links, images and numeric cells', () => {
  const invalidId = [...validRow];
  invalidId[0] = '';
  const invalidTitle = [...validRow];
  invalidTitle[1] = '';
  const invalidAffiliate = [...validRow];
  invalidAffiliate[3] = 'javascript:alert(1)';
  const invalidPrice = [...validRow];
  invalidPrice[8] = 'not a price';
  const invalidImage = [...validRow];
  invalidImage[4] = 'javascript:alert(2)';
  const invalidNumeric = [...validRow];
  invalidNumeric[11] = 'many';
  const result = importAliExpressExcelRows([headers, validRow, invalidId, invalidTitle, invalidAffiliate, invalidPrice, invalidImage, invalidNumeric]);
  assert.equal(result.imported, 1);
  assert.equal(result.errors, 6);
  assert.equal(result.products.length, 1);
  assert.ok(result.results.find((row) => row.status === 'error' && row.errors.some((message) => message.includes('Product ID'))));
  assert.ok(result.results.find((row) => row.status === 'error' && row.errors.some((message) => message.includes('enlace afiliado'))));
});

test('same Product ID updates current data without duplicates and preserves price, sales and coupon history', () => {
  const first = importAliExpressExcelRows([headers, validRow], {
    importedAt: '2026-10-02T10:00:00.000Z',
    fileName: 'first.xlsx'
  });
  const changed = [...validRow];
  changed[8] = 3.49;
  changed[11] = 1200;
  changed[13] = 'SAVE3';
  changed[14] = 3;
  const second = importAliExpressExcelRows([headers, changed], {
    existingProducts: first.products,
    importedAt: '2026-10-15T10:00:00.000Z',
    fileName: 'second.xlsx'
  });
  assert.equal(second.products.length, 1);
  assert.equal(second.imported, 0);
  assert.equal(second.updated, 1);
  const product = second.products[0];
  assert.equal(product.currentPrice, 3.49);
  assert.equal(product.sales180d, 1200);
  assert.equal(product.coupon, 'SAVE3');
  assert.equal(product.priceHistory.length, 2);
  assert.equal(product.priceHistory[0].value.price, 4.09);
  assert.equal(product.priceHistory[1].value.price, 3.49);
  assert.equal(product.salesHistory.length, 2);
  assert.equal(product.couponHistory.length, 2);
  assert.equal(product.captureHistory.length, 2);
  assert.equal(product.sourceFileName, 'second.xlsx');
});

test('reimporting unchanged product does not repeat price, sales or coupon history entries', () => {
  const first = importAliExpressExcelRows([headers, validRow], { importedAt: '2026-10-02T10:00:00.000Z' });
  const second = importAliExpressExcelRows([headers, validRow], {
    existingProducts: first.products,
    importedAt: '2026-10-15T10:00:00.000Z'
  });
  assert.equal(second.updated, 1);
  assert.equal(second.products[0].priceHistory.length, 1);
  assert.equal(second.products[0].salesHistory.length, 1);
  assert.equal(second.products[0].couponHistory.length, 1);
  assert.equal(second.products[0].captureHistory.length, 2);
});

test('coupon values and promotion date fields are imported without inferring missing values', () => {
  const parsed = parseAliExpressExcelRows([headers, validRow]);
  const product = parsed.products[0];
  assert.equal(product.coupon, 'SAVE2');
  assert.equal(product.couponValue, 2);
  assert.equal(product.couponQuantity, 300);
  assert.equal(product.couponMinSpend, 10);
  assert.equal(product.couponStartDate, '2026-10-01');
  assert.equal(product.couponEndDate, '2026-10-31');
  assert.equal(product.videoUrl, 'https://video.aliexpress-media.com/lamp.mp4');
  assert.equal(product.publishedEnTelegram, false);
  assert.equal(product.fechaPublicacionTelegram, null);
  assert.equal(product.editorialStatus, 'draft');
  assert.equal(product.availabilityStatus, 'draft');
});

test('existing analysis metadata remains compatible and is preserved on reimport', () => {
  const first = importAliExpressExcelRows([headers, validRow]);
  const existing = {
    ...first.products[0],
    category: 'hogar',
    subcategory: 'Iluminación',
    tags: ['escritorio', 'luz'],
    availabilityStatus: 'active',
    publishedEnTelegram: true,
    fechaPublicacionTelegram: '2026-10-03T10:00:00.000Z'
  };
  const next = importAliExpressExcelRows([headers, validRow], { existingProducts: [existing] });
  assert.equal(next.products[0].category, 'hogar');
  assert.equal(next.products[0].subcategory, 'Iluminación');
  assert.deepEqual(next.products[0].tags, ['escritorio', 'luz']);
  assert.equal(next.products[0].availabilityStatus, 'active');
  assert.equal(next.products[0].publishedEnTelegram, true);
  assert.equal(next.products[0].fechaPublicacionTelegram, '2026-10-03T10:00:00.000Z');
});
