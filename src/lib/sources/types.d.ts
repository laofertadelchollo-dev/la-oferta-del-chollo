export type OfferCandidate = {
  title: string;
  store: string;
  currentPrice: number;
  previousPrice?: number;
  sourceUrl: string;
  image?: string;
  seller?: string;
  coupon?: string;
  conditions?: string;
  checkedAt: string;
  previousPriceVerified?: boolean;
  demo?: boolean;
};

export type OfferSource = {
  id: 'amazon' | 'aliexpress' | 'awin' | 'generic';
  findCandidates: () => Promise<OfferCandidate[]>;
  normalizeCandidate: (input: unknown) => OfferCandidate;
};
