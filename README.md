# HomPimPah Tracking

React + Supabase order tracker for HomPimPah merch orders.

## Setup

Install dependencies:

```bash
npm install
```

Run the Supabase schema in the Supabase SQL editor:

```text
supabase/schema.sql
```

Create at least one Supabase Auth user in the Supabase dashboard, then run the app:

```bash
npm run dev
```

The app reads Supabase settings from `.env`.

Public stock tracking page:

```text
/StockTrack
```

This page does not require login and is intended for direct customer access.

## Supabase Integration

- `src/utils/supabase.ts` creates the Supabase client.
- `src/App.tsx` loads products and orders from Supabase.
- `/StockTrack` publicly loads product name, SKU, size, variation, price, and stock from Supabase.
- Products are inserted and updated through the `products` table.
- Products can be bulk imported from one or more Excel workbooks. Every sheet must use the `productList.xlsx` headers:
  `Product Name*`, `SKU*`, `Size`, `Variation`, `Price*`, `Stock*`.
- Orders are created, edited, and deleted through SQL RPC functions.
- Stock changes happen inside Supabase transactions through:
  - `create_order`
  - `update_pending_order`
  - `delete_pending_order`

## QA checklist

- Sign in with a Supabase Auth user.
- Confirm `/StockTrack` opens without login.
- Confirm `/StockTrack` shows product prices and stock status.
- Confirm `/StockTrack` autocomplete works by product name and SKU.
- Confirm `/StockTrack` is responsive on mobile and desktop.
- Add product with mandatory product name, price, stock, and SKU.
- Reject product with missing mandatory fields or duplicate SKU.
- Delete an unused product.
- Confirm products already used by orders are protected from deletion by the database.
- Bulk upload products from Excel.
- Confirm bulk upload supports multiple files and multiple sheets per file.
- Confirm bulk upload rejects wrong headers, missing mandatory fields, invalid price/stock, duplicate uploaded SKUs, and SKUs already in products.
- Confirm product list shows 10 products per page.
- Confirm product pagination works with product search.
- Add order only after products exist.
- Add one or more order items and verify line totals plus total order price.
- Confirm Add/Edit Order product dropdown is sorted by SKU ascending.
- Confirm Add/Edit Order product field suggests products by product name and SKU.
- Confirm typing without choosing a suggestion prevents saving.
- Confirm a product can only be selected once in the same order.
- Confirm stock decreases after saving an order.
- Edit a Pending order and confirm previous stock is restored before the new quantity is deducted.
- Delete a Pending order and confirm stock is returned.
- Mark order status as Pending or Done.
- Confirm Done orders are visible but no longer editable or deletable.
- Filter and search orders.
- Confirm order list initially shows 10 orders and Load More shows 10 more.
- Use quick All/Pending/Done order filters.
- Filter orders by created date.
- Confirm daily order totals and paid sales update with the created date filter.
- Search products by product name and SKU on the home dashboard.
- Confirm the Products segment does not show order statistics.
- Confirm order search appears in the Order List segment.
- Check layout at desktop and mobile widths.
