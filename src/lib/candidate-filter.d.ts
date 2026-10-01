import type { OfferCandidate } from './sources/types';
import type { Offer } from './site';
import type { CandidateScore } from './offer-scoring';

export const DEFAULT_CANDIDATE_FILTERS: Readonly<{
  minScore: 70;
  minDiscount: 20;
  maxPrice: null;
  categories: never[];
}>;

export function normalizeCandidateTitle(title: string): string;
export function findDuplicateCandidate(candidate: Partial<OfferCandidate>, existing?: unknown[]): unknown;
export function filterCandidates(candidates: OfferCandidate[], options?: {
  existingCandidates?: unknown[];
  existingOffers?: Offer[];
  now?: Date;
}): { accepted: OfferCandidate[]; rejected: { candidate: OfferCandidate; reason: string }[] };
export function selectTopCandidates(candidates: OfferCandidate[], filters?: {
  minScore?: number;
  minDiscount?: number;
  maxPrice?: number | null;
  categories?: string[];
}, now?: Date): { candidate: OfferCandidate; result: CandidateScore }[];
