# HomPimPah Tracking

Single-page React order tracker for HomPimPah merch orders.

## How to use

Open `index.html` in a browser. Data is saved in browser local storage under `hompimpah-tracking-v1`.

## QA checklist

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
