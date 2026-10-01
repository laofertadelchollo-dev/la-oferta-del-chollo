import { normalizeCandidate } from './normalize-candidate.js';

export function createSourceAdapter(id, displayName) {
  return {
    id,
    async findCandidates() {
      throw new Error(`${displayName} no está conectado. Importa datos desde una API o feed oficial antes de buscar candidatos.`);
    },
    normalizeCandidate(input) {
      return normalizeCandidate(input);
    }
  };
}
