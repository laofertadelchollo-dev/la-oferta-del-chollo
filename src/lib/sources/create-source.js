import { normalizeCandidate } from './normalize-candidate.js';

export function createSourceAdapter(id, displayName) {
  return {
    id,
    async findCandidates() {
      throw new Error(`${displayName} no tiene una fuente oficial configurada. Importa un feed o archivo autorizado; no se realiza scraping.`);
    },
    normalizeCandidate(input) {
      return normalizeCandidate(input, id);
    }
  };
}
