export type Locale = "ar" | "fr" | "en";

export type UserRole =
  | "individual"
  | "agency"
  | "bank"
  | "bailiff"
  | "inspector"
  | "admin";

export type KycStatus = "none" | "submitted" | "pending" | "verified" | "rejected";

export type PropertyType =
  | "apartment"
  | "house"
  | "villa"
  | "land"
  | "commercial"
  | "office"
  | "warehouse"
  | "farm";

export type PropertyStatus =
  | "draft"
  | "pending_review"
  | "rejected"
  | "ready"
  | "archived";

export type AuctionType = "english" | "sealed" | "dutch";

export type AuctionStatus =
  | "scheduled"
  | "live"
  | "extending"
  | "ended_sold"
  | "ended_unsold"
  | "sixth_offer_window"
  | "awarded"
  | "cancelled";

export type Property = {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  type: PropertyType;
  area_sqm: number | null;
  rooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  year_built: number | null;
  // Per-type characteristics keyed by AttributeKind.field_key. Mirrors the
  // five legacy columns above for the canonical keys; also holds the
  // type-specific extras (has_elevator, title_type, water_source, …).
  attributes: Record<string, string | number | boolean>;
  governorate: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  status: PropertyStatus;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AttributeDataType = "number" | "text" | "boolean" | "select";

export type AttributeOption = { value: string; label: string };

// Admin-controlled catalog row: defines one characteristic field for a
// property type. Editable from /admin/characteristics.
export type AttributeKind = {
  id: string;
  property_type: PropertyType;
  field_key: string;
  label: string;
  data_type: AttributeDataType;
  options: AttributeOption[] | null;
  unit: string | null;
  required: boolean;
  sort_order: number;
};

export type PropertyPhoto = {
  id: string;
  property_id: string;
  storage_path: string;
  caption: string | null;
  sort_order: number;
};

export type Auction = {
  id: string;
  property_id: string;
  type: AuctionType;
  opening_price: number;
  reserve_price: number | null;
  dutch_start_price: number | null;
  dutch_floor_price: number | null;
  dutch_decrement: number | null;
  dutch_tick_seconds: number | null;
  starts_at: string;
  ends_at: string;
  extend_window_seconds: number;
  extend_by_seconds: number;
  status: AuctionStatus;
  current_price: number | null;
  sixth_offer_deadline: string | null;
  // Seller opt-in: when true, a won auction opens the 8-day legal 1/6 overbid
  // window; when false it awards immediately with the 14-day payment deadline
  // (migration 0130).
  sixth_offer_enabled: boolean;
  winner_user_id: string | null;
  winner_amount: number | null;
  hammer_at: string | null;
  // Final-payment deadline (now + 14 days), stamped when an auction is awarded.
  final_payment_due_at: string | null;
  // Two-path purchase (migration 0018):
  //  - 'auction'  → standard bidding flow
  //  - 'direct'   → fixed-price sale, no bidding
  listing_type: "auction" | "direct";
  // Fixed price for direct listings; null on auctions.
  sale_price: number | null;
  // Display flag for direct listings — UI hint the seller is open to talk.
  sale_negotiable: boolean;
  // Optional "skip the bidding" price on auctions; null on direct.
  buy_now_price: number | null;
  // Denormalized bid count (0098), maintained by a trigger on bids. Read by
  // the auction detail + bid pages instead of a per-viewer count() query.
  bid_count: number;
};

export type Bid = {
  id: string;
  auction_id: string;
  bidder_id: string;
  amount: number;
  max_amount: number | null;
  is_proxy: boolean;
  is_winning: boolean;
  placed_at: string;
};

export type AuctionWithProperty = Auction & {
  property: Property & { photos: PropertyPhoto[] };
};
