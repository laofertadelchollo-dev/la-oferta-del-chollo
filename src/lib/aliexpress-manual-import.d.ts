import type { Offer } from './site';

export type AliExpressDraftInput = {
  [key: string]: string | number | undefined;
};

export function createAliExpressDraft(
  input: AliExpressDraftInput,
  options?: { existingOffers?: Offer[]; categories?: string[] }
): Offer;

export function importAliExpressCsv(
  text: string,
  options?: { existingOffers?: Offer[]; categories?: string[] }
): { offers: Offer[]; results: { row: number; ok: boolean; message: string; offer?: Offer }[] };
