import type { OfferCandidate } from './sources/types';

export function importCandidateData(text: string, options?: { format?: 'json' | 'csv'; source?: string }): OfferCandidate[];
