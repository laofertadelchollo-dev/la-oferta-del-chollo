import type { Offer } from './site';
import type { OfferCandidate } from './sources/types';

export function createOffer(candidate: OfferCandidate, editorial?: Partial<Offer>): Offer;
export function publishOffer(offer: Offer, now?: Date): Offer;
