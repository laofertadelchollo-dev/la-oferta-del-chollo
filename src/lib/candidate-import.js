import { normalizeCandidate } from './sources/normalize-candidate.js';

const csvBooleanFields = new Set(['previousPriceVerified', 'affiliateRequired', 'demo', 'available']);

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      row.push(cell);
      cell = '';
    } else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('CSV inválido: hay un campo entrecomillado sin cerrar.');
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('CSV inválido: debe incluir encabezados y al menos una fila.');

  const headers = rows[0].map((header) => header.trim());
  if (!headers[0] || new Set(headers).size !== headers.length) throw new Error('CSV inválido: los encabezados deben ser únicos y no vacíos.');
  return rows.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) throw new Error(`CSV, fila ${rowIndex + 2}: el número de columnas no coincide con los encabezados.`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index].trim()]));
  });
}

function convertCsvValues(row) {
  const output = { ...row };
  for (const field of ['currentPrice', 'previousPrice', 'discount']) {
    if (field in output && output[field] !== '') {
      const value = output[field].replace(/\s|[€$£]/g, '');
      const normalized = value.includes(',') && value.includes('.')
        ? value.replace(/\./g, '').replace(',', '.')
        : value.replace(',', '.');
      const parsed = Number(normalized);
      output[field] = Number.isFinite(parsed) ? parsed : Number.NaN;
    } else if (field !== 'currentPrice') {
      output[field] = null;
    }
  }
  for (const field of csvBooleanFields) {
    if (field in output) {
      if (['true', '1', 'yes', 'sí', 'si'].includes(output[field].toLowerCase())) output[field] = true;
      else if (['false', '0', 'no'].includes(output[field].toLowerCase())) output[field] = false;
    }
  }
  return output;
}

export function importCandidateData(text, { format, source } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('No hay datos para importar.');
  const selectedFormat = format || (text.trimStart().startsWith('[') ? 'json' : 'csv');
  let rows;
  if (selectedFormat === 'json') {
    try {
      rows = JSON.parse(text);
    } catch (error) {
      throw new Error(`JSON inválido: ${error instanceof Error ? error.message : 'no se pudo analizar.'}`);
    }
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('El JSON debe ser un array no vacío de candidatos.');
  } else if (selectedFormat === 'csv') {
    rows = parseCsv(text);
  } else {
    throw new Error('Formato no admitido; usa JSON o CSV.');
  }

  const normalized = [];
  const errors = [];
  rows.forEach((row, index) => {
    try {
      normalized.push(normalizeCandidate(selectedFormat === 'csv' ? convertCsvValues(row) : row, source));
    } catch (error) {
      errors.push(`Fila ${index + 1}: ${error instanceof Error ? error.message : 'candidato inválido.'}`);
    }
  });
  if (errors.length) throw new Error(`No se importó ningún candidato:\n${errors.join('\n')}`);
  return normalized;
}
