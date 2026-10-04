export interface BillingProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  interval: string;
  features: { feature: string; enabled: boolean; limit: number }[];
}

export interface WorkspaceBilling {
  plans: BillingProduct[];
  subscription: {
    id: string;
    product_id: string;
    status: string;
    product?: BillingProduct;
  } | null;
}
