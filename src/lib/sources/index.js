import { aliexpressSource } from './aliexpress.js';
import { amazonSource } from './amazon.js';
import { awinSource } from './awin.js';
import { genericSource } from './generic.js';

export const offerSources = {
  amazon: amazonSource,
  aliexpress: aliexpressSource,
  awin: awinSource,
  generic: genericSource
};

export async function findCandidates(sourceId) {
  const source = offerSources[sourceId];
  if (!source) throw new Error(`Fuente de ofertas desconocida: ${sourceId}`);
  return source.findCandidates();
}
