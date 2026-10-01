import type { OfferCandidate } from './sources/types';

export type CandidateHistoryEntry = {
  id: string;
  date: string;
  source: string;
  product: string;
  price: number | null;
  currency: string;
  status: string;
};

export function appendCandidateHistory(
  history: CandidateHistoryEntry[],
  candidates: OfferCandidate[],
  status: string,
  checkedAt?: string
): CandidateHistoryEntry[];
export function appendCandidateSearchHistory(
  history: CandidateHistoryEntry[],
  source: string,
  status: string,
  checkedAt?: string
): CandidateHistoryEntry[];
