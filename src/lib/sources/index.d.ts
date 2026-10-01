import type { OfferCandidate, OfferSource } from './types';

export const offerSources: Record<OfferSource['id'], OfferSource>;
export function findCandidates(sourceId: OfferSource['id']): Promise<OfferCandidate[]>;
