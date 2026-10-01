import type { Offer } from './site';

export function expireOffers(offers: Offer[], now?: Date): { offers: Offer[]; expiredCount: number };
