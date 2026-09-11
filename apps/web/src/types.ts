export type SpiceLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const SPICE_LABELS: Record<number, string> = {
  0: "Not spicy",
  1: "Mild",
  2: "Medium",
  3: "Hot",
  4: "Very hot",
  5: "Extremely hot",
};

export type Dish = {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  short_description: string;
  ingredients: string[];
  taste_profile: string[];
  texture_profile: string[];
  spice_level: SpiceLevel;
  dietary_tags: string[];
  allergens: string[];
  allergens_unknown: boolean;
  portion_note?: string;
  is_special?: boolean;
  image_url?: string;
  is_available: boolean;
  published: boolean;
  updated_at: string;
};

export type MenuCategory = {
  id: string;
  name: string;
  sort_order: number;
  published: boolean;
};

export type RestaurantTable = {
  id: string;
  number: number;
  isActive: boolean;
};

export type Restaurant = {
  id: string;
  name: string;
  slug: string;
  description: string;
  default_language: string;
  currency: string;
  upiId: string;
  upiName: string;
  isOpen: boolean;
  published: boolean;
  categories: MenuCategory[];
  dishes: Dish[];
  tables: RestaurantTable[];
};

export type DishExplanation = {
  dishId: string;
  title: string;
  whatItIs: string;
  tasteAndTexture: string;
  spice: { level: number | null; label: string };
  ingredients: string[];
  dietary: string[];
  allergens: { declared: string[]; unknown: boolean };
  portionNote?: string;
  confidence: "restaurant-provided" | "partially-provided" | "unknown";
  safetyNote: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  restaurantSlug: string;
  /** "dish" = scoped to one dish; "restaurant" = the AI waiter agent. */
  scope: "dish" | "restaurant";
  dishId?: string;
  messages: ChatMessage[];
};

export type CartAction =
  | { type: "add_to_cart"; dishId: string; quantity: number }
  | { type: "remove_from_cart"; dishId: string }
  | { type: "update_cart_item"; dishId: string; quantity: number }
  | { type: "navigate_to_checkout" }
  | { type: "set_instruction"; note: string };

export type ChatResponse = {
  answer: string;
  mode: "deterministic" | "ai";
  sources: string[];
  safetyNote: string;
  actions?: CartAction[];
};

/* ---------- Orders & payments (TablePilot) ---------- */

export type OrderStatus =
  | "PENDING"
  | "ACCEPTED"
  | "PREPARING"
  | "READY"
  | "SERVED"
  | "REJECTED"
  | "CANCELLED";

export type PaymentStatus =
  | "UNPAID"
  | "PAYMENT_PENDING"
  | "PAID"
  | "PAYMENT_FAILED"
  | "REFUNDED";

export type OrderType = "DINE_IN" | "TAKEAWAY";
export type PaymentMethod = "CASH" | "UPI" | "GATEWAY";

export type CartItem = {
  dishId: string;
  quantity: number;
  note?: string;
};

/** Immutable snapshot of dish name and price at order time. */
export type OrderItem = {
  dishId: string;
  dishNameSnapshot: string;
  unitPriceSnapshot: number;
  quantity: number;
  specialInstruction?: string;
  subtotal: number;
};

export type Order = {
  id: string;
  restaurantId: string;
  restaurantSlug: string;
  tableNumber: number | null;
  orderNumber: number;
  orderType: OrderType;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  customerNote?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type Payment = {
  id: string;
  orderId: string;
  method: PaymentMethod;
  amount: number;
  currency: string;
  status: PaymentStatus;
  providerPaymentId?: string;
  createdAt: string;
};

/** Provider-neutral payment adapter. Implementations must never trust
 *  client-side payment success claims. */
export interface PaymentProvider {
  readonly method: PaymentMethod;
  createPayment(order: Order): Promise<Payment>;
  verifyPayment(payment: Payment): Promise<PaymentStatus>;
  refundPayment(payment: Payment): Promise<PaymentStatus>;
}
