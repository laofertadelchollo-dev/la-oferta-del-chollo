import { isSafeWebUrl } from './offer-policy.js';

function freshnessPoints(checkedAt, now) {
  const age = now.getTime() - Date.parse(checkedAt);
  if (!Number.isFinite(age) || age < 0) return 0;
  if (age <= 24 * 60 * 60 * 1000) return 10;
  if (age <= 7 * 24 * 60 * 60 * 1000) return 5;
  return 0;
}

export function scoreCandidate(candidate, now = new Date()) {
  if (!candidate || typeof candidate !== 'object') throw new Error('El candidato debe ser un objeto.');

  const components = [];
  const add = (name, points, maximum, reason) => components.push({ name, points, maximum, reason });
  const titleValid = typeof candidate.title === 'string' && candidate.title.trim().length > 0;
  const categoryValid = typeof candidate.category === 'string' && candidate.category.trim().length > 0;
  add('Completitud', (titleValid ? 5 : 0) + (categoryValid ? 5 : 0), 10,
    titleValid && categoryValid ? 'Título y categoría completos.' : 'Faltan título o categoría.');

  const price = candidate.currentPrice;
  const pricePoints = !Number.isFinite(price) || price <= 0 ? 0
    : price <= 20 ? 15
      : price <= 50 ? 12
        : price <= 100 ? 9
          : price <= 250 ? 6 : 3;
  add('Precio', pricePoints, 15, pricePoints ? `Precio actual: ${price.toFixed(2)} ${candidate.currency || ''}.` : 'Precio actual ausente o inválido.');

  const verifiedDiscount = candidate.previousPriceVerified === true
    && Number.isFinite(candidate.previousPrice)
    && candidate.previousPrice > price
    && Number.isFinite(candidate.discount);
  const discountPoints = verifiedDiscount
    ? candidate.discount >= 50 ? 20 : candidate.discount >= 30 ? 14 : candidate.discount >= 20 ? 8 : 3
    : 0;
  add('Descuento verificable', discountPoints, 20,
    verifiedDiscount ? `Descuento calculado desde precios verificados: ${candidate.discount} %.` : 'Sin precio anterior fiable: no se atribuyen puntos ni descuento.');

  add('Disponibilidad', candidate.available === true ? 10 : 0, 10,
    candidate.available === true ? 'La fuente indica que está disponible.' : 'Disponibilidad ausente o agotada.');

  const freshness = freshnessPoints(candidate.checkedAt, now);
  const sourceValid = ['aliexpress', 'awin', 'generic', 'amazon'].includes(candidate.source);
  const reliabilityPoints = freshness + (sourceValid ? 5 : 0)
    + (candidate.verified === true && candidate.demo !== true ? 5 : 0);
  add('Fiabilidad', reliabilityPoints, 20, [
    freshness ? `Comprobación de origen reciente (+${freshness}).` : 'Comprobación ausente o antigua.',
    sourceValid ? 'Procedencia declarada.' : 'Procedencia no reconocida.',
    candidate.verified === true && candidate.demo !== true ? 'Revisión humana registrada.' : 'Pendiente de revisión humana.'
  ].join(' '));

  const clearConditions = typeof candidate.conditions === 'string' && candidate.conditions.trim().length > 0;
  add('Condiciones', clearConditions ? 10 : 0, 10,
    clearConditions ? 'Las condiciones están descritas.' : 'Faltan condiciones claras.');

  const affiliateValid = isSafeWebUrl(candidate.affiliateUrl);
  add('Potencial de afiliación', affiliateValid ? 10 : 0, 10,
    affiliateValid ? 'Incluye un enlace afiliado proporcionado.' : 'No se ha generado ni se ha aportado enlace afiliado.');

  const interestPoints = candidate.verified === true && Array.isArray(candidate.interestSignals) && candidate.interestSignals.length > 0 ? 3 : 0;
  add('Interés editorial', interestPoints, 3,
    interestPoints ? `Se aportan señales: ${candidate.interestSignals.join(', ')}.` : 'No hay señales de interés declaradas.');
  const demandPoints = candidate.verified === true && Array.isArray(candidate.demandSignals) && candidate.demandSignals.length > 0 ? 2 : 0;
  add('Demanda', demandPoints, 2,
    demandPoints ? `Se aportan señales: ${candidate.demandSignals.join(', ')}.` : 'No hay datos de demanda declarados.');

  const score = components.reduce((total, component) => total + component.points, 0);
  return {
    score,
    components,
    explanation: components.map(({ name, points, maximum, reason }) => `${name}: ${points}/${maximum}. ${reason}`)
  };
}
