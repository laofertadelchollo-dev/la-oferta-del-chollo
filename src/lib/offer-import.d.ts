import type { Offer } from './site';

export function validateOfferList(value: unknown): Offer[];
export function parseOfferJson(text: string): Offer[];
export function migrateStoredOfferList(value: unknown): Offer[];
