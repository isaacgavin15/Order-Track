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

## Supabase Integration

- `src/utils/supabase.ts` creates the Supabase client.
- `src/App.tsx` loads products and orders from Supabase.
- Products are inserted and updated through the `products` table.
- Orders are created, edited, and deleted through SQL RPC functions.
- Stock changes happen inside Supabase transactions through:
  - `create_order`
  - `update_pending_order`
  - `delete_pending_order`

## QA checklist

- Sign in with a Supabase Auth user.
- Add product with mandatory product name, price, stock, and SKU.
- Reject product with missing mandatory fields or duplicate SKU.
- Add order only after products exist.
- Add one or more order items and verify line totals plus total order price.
- Confirm stock decreases after saving an order.
- Edit a Pending order and confirm previous stock is restored before the new quantity is deducted.
- Delete a Pending order and confirm stock is returned.
- Mark order status as Pending or Done.
- Confirm Done orders are visible but no longer editable or deletable.
- Filter and search orders.
- Check layout at desktop and mobile widths.
