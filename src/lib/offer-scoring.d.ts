import type { OfferCandidate } from './sources/types';

export type CandidateScore = {
  score: number;
  components: { name: string; points: number; maximum: number; reason: string }[];
  explanation: string[];
};

export function scoreCandidate(candidate: Partial<OfferCandidate>, now?: Date): CandidateScore;
