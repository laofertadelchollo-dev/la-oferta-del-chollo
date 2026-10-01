export type OfferCandidate = {
  id: string;
  title: string;
  store: string;
  category: string;
  currentPrice: number;
  previousPrice: number | null;
  discount: number | null;
  currency: string;
  sourceUrl: string;
  available: boolean;
  source: 'aliexpress' | 'awin' | 'generic' | 'amazon';
  image?: string;
  seller?: string;
  coupon?: string;
  conditions: string;
  productId?: string;
  affiliateUrl?: string;
  affiliateRequired: boolean;
  checkedAt: string;
  previousPriceVerified: boolean;
  verified: boolean;
  verificationNotes: string[];
  lastVerifiedAt: string | null;
  expiresAt: string | null;
  demo: boolean;
  interestSignals?: string[];
  demandSignals?: string[];
};

export type OfferSource = {
  id: 'amazon' | 'aliexpress' | 'awin' | 'generic';
  findCandidates: () => Promise<OfferCandidate[]>;
  normalizeCandidate: (input: unknown) => OfferCandidate;
};

export type CandidateRecord = {
  recordId?: string;
  candidate: OfferCandidate;
  offerId?: string;
  status: 'pending' | 'verified' | 'approved' | 'discarded' | 'rejected';
  score: number;
  scoreExplanation: string[];
  verificationNotes: string[];
  lastVerifiedAt: string | null;
  rejectionReason?: string;
};
