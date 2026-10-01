import type { Offer } from './site';
import type { OfferCandidate } from './sources/types';

export type OfferVerification = {
  valid: boolean;
  errors: string[];
  checkedAt: string;
  demo: boolean;
  warning?: string;
  offer?: Offer;
};

export function verifyCandidate(candidate: Partial<OfferCandidate> | Partial<Offer>, now?: Date): OfferVerification;
export function verifyOffer(offer: Offer, now?: Date): OfferVerification;
