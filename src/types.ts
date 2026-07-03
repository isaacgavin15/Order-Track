export type OrderStatus = 'Pending' | 'Done';

export type PickupAgreement = 'Self pick up at biggledot' | 'Online delivery' | 'Expedition';

export type Product = {
  id: string;
  name: string;
  size: string | null;
  price: number;
  variation: string | null;
  stock: number;
  sku: string;
  created_at?: string;
  updated_at?: string;
};

export type OrderItem = {
  id?: string;
  order_id?: string;
  product_id: string;
  item_name: string;
  sku: string;
  size: string | null;
  variation: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export type Order = {
  id: string;
  order_number: string;
  status: OrderStatus;
  pickup_agreement: PickupAgreement;
  total_price: number;
  date_order_created: string;
  customer_name: string | null;
  customer_address: string | null;
  customer_phone: string | null;
  created_at?: string;
  updated_at?: string;
  order_items: OrderItem[];
};

export type ProductForm = {
  id?: string;
  name: string;
  size: string;
  price: string | number;
  variation: string;
  stock: string | number;
  sku: string;
};

export type OrderFormItem = {
  product_id: string;
  quantity: string | number;
};

export type OrderForm = {
  id?: string;
  order_number?: string;
  status: OrderStatus;
  pickup_agreement: PickupAgreement;
  date_order_created: string;
  customer_name: string;
  customer_address: string;
  customer_phone: string;
  items: OrderFormItem[];
};

export type ProductImportRow = {
  source_file: string;
  sheet_name: string;
  row_number: number;
  name: string;
  sku: string;
  size: string;
  variation: string;
  price: number | null;
  stock: number | null;
  errors: string[];
};

export type ProductInsert = {
  name: string;
  sku: string;
  size: string | null;
  variation: string | null;
  price: number;
  stock: number;
};
