import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './utils/supabase';
import { parseProductExcelFiles, productImportRowsToInserts, validateProductImportRows } from './utils/productImport';
import type { Market, MarketForm, Order, OrderForm, OrderFormItem, PickupAgreement, Product, ProductForm, ProductImportRow, ProductInsert, ProductSegment } from './types';

const DELIVERY_TYPES: PickupAgreement[] = ['Self pick up', 'Online delivery', 'Expedition'];
const PRODUCT_SEGMENTS: ProductSegment[] = ['Kudapan Club', 'Chonky Club', 'Bocah Hompimpah Club'];
const PRODUCT_SEGMENT_PREFIX: Record<ProductSegment, string> = {
  'Kudapan Club': 'KC',
  'Chonky Club': 'CC',
  'Bocah Hompimpah Club': 'BCH',
};
const PRODUCTS_PER_PAGE = 10;
const ORDERS_PER_LOAD = 10;
const INDONESIA_LOCALE = 'id-ID';
const INDONESIA_TIME_ZONE = 'Asia/Jakarta';
const dateInputFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: INDONESIA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const displayDateFormatter = new Intl.DateTimeFormat(INDONESIA_LOCALE, {
  timeZone: INDONESIA_TIME_ZONE,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});
const today = () => {
  const parts = dateInputFormatter.formatToParts(new Date());
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
};
const displayDate = (value: string | null | undefined) => {
  if (!value) return '-';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return displayDateFormatter.format(new Date(Date.UTC(year, month - 1, day, 12)));
};
const normalizePickupAgreement = (value: string | null | undefined): PickupAgreement =>
  value === 'Self pick up at biggledot' ? 'Self pick up' : (value as PickupAgreement);
const displayPickupAgreement = (value: string | null | undefined) => normalizePickupAgreement(value || 'Self pick up');
const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat(INDONESIA_LOCALE, {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
const productOptionLabel = (product: Product) =>
  `${product.sku} - ${product.name} - ${product.variation || 'No variation'} - (${product.stock} stock) - ${money(product.price)}`;
const getProductSegmentFromSku = (sku: string): ProductSegment => {
  const normalized = sku.toUpperCase();
  if (normalized.startsWith('BCH')) return 'Bocah Hompimpah Club';
  if (normalized.startsWith('CC')) return 'Chonky Club';
  return 'Kudapan Club';
};
const getNextSku = (segment: ProductSegment, products: Product[]) => {
  const prefix = PRODUCT_SEGMENT_PREFIX[segment];
  const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i');
  const maxNumber = products.reduce((max, product) => {
    const match = product.sku.match(pattern);
    return match ? Math.max(max, Number(match[1]) || 0) : max;
  }, 0);
  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`;
};

const emptyProduct: ProductForm = { name: '', size: '', price: '', variation: '', stock: '', sku: '', product_segment: 'Kudapan Club' };
const createEmptyOrder = (marketId = ''): OrderForm => ({
  status: 'Pending',
  pickup_agreement: DELIVERY_TYPES[0],
  market_id: marketId,
  date_order_created: today(),
  customer_name: '',
  customer_address: '',
  customer_phone: '',
  items: [{ product_id: '', product_query: '', quantity: 1 }],
});
const emptyMarket: MarketForm = { market_id: '', name: '', start_date: today(), is_active: true };

export default function App() {
  return window.location.pathname.toLowerCase() === '/stocktrack' ? <StockTrackPage /> : <AdminApp />;
}

function StockTrackPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadPublicProducts() {
      setLoading(true);
      setError('');
      const { data, error: productsError } = await supabase
        .from('products')
        .select('id, name, sku, size, variation, price, stock, product_segment')
        .order('sku', { ascending: true });

      if (productsError) {
        setError(productsError.message);
        setProducts([]);
      } else {
        setProducts((data || []) as Product[]);
      }

      setLoading(false);
    }

    void loadPublicProducts();
  }, []);

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: 'base' })),
    [products],
  );
  const needle = query.trim().toLowerCase();
  const suggestions = sortedProducts.filter((product) => {
    if (!needle) return true;
    return [product.name, product.sku, product.size, product.variation].join(' ').toLowerCase().includes(needle);
  });
  const visibleProducts = selectedProductId
    ? sortedProducts.filter((product) => product.id === selectedProductId)
    : suggestions;

  function chooseProduct(product: Product) {
    setSelectedProductId(product.id);
    setQuery(`${product.sku} - ${product.name}`);
    setFocused(false);
  }

  function updateQuery(value: string) {
    setQuery(value);
    setSelectedProductId('');
    setFocused(true);
  }

  return (
    <div className="stock-page">
      <header className="stock-hero">
        <div>
          <h1>HomPimPah Stock Track</h1>
          <p>Check live merch stock and prices before ordering.</p>
        </div>
      </header>

      <main className="stock-main">
        <section className="stock-search-panel">
          <div className="field autocomplete-field public-search">
            <label>Search stock</label>
            <input
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              onFocus={() => setFocused(true)}
              onClick={() => setFocused(true)}
              onBlur={() => window.setTimeout(() => setFocused(false), 120)}
              placeholder="Search product name or SKU"
              aria-autocomplete="list"
              aria-expanded={focused}
              aria-controls="stock-suggestions"
            />
            {focused && (
              <div className="suggestions stock-suggestions" id="stock-suggestions">
                {suggestions.length === 0 ? (
                  <div className="suggestion empty-suggestion">No matching products</div>
                ) : (
                  suggestions.map((product) => (
                    <button
                      type="button"
                      className="suggestion"
                      key={product.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseProduct(product)}
                    >
                      <strong>{product.sku} - {product.name}</strong>
                      <span>{product.size || 'No size'} | {product.variation || 'No variation'} | {money(product.price)}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {query && (
            <button className="btn" type="button" onClick={() => { setQuery(''); setSelectedProductId(''); }}>
              Clear
            </button>
          )}
        </section>

        {loading && <div className="panel public-message">Loading stock...</div>}
        {error && <div className="notice error public-error">{error}</div>}
        {!loading && !error && (
          <section className="stock-grid">
            {visibleProducts.length === 0 ? (
              <div className="panel public-message">No products found.</div>
            ) : (
              visibleProducts.map((product) => <StockProductCard key={product.id} product={product} />)
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function stockState(stock: number) {
  if (stock <= 0) return { label: 'Out of stock', className: 'out' };
  if (stock <= 5) return { label: 'Low stock', className: 'low' };
  return { label: 'Available', className: 'available' };
}

function StockProductCard({ product }: { product: Product }) {
  const state = stockState(Number(product.stock));

  return (
    <article className="stock-card">
      <div>
        <span className="stock-sku">{product.sku}</span>
        <h2>{product.name}</h2>
        <p>{product.size || 'No size'} | {product.variation || 'No variation'}</p>
      </div>
      <div className="stock-card-foot">
        <strong>{money(product.price)}</strong>
        <span className={`stock-pill ${state.className}`}>{state.label}</span>
      </div>
      <div className="stock-count">{Number(product.stock)} in stock</div>
    </article>
  );
}

function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [filter, setFilter] = useState<'All' | 'Pending' | 'Done'>('All');
  const [search, setSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productPage, setProductPage] = useState(1);
  const [orderDateFilter, setOrderDateFilter] = useState(today());
  const [marketFilter, setMarketFilter] = useState('');
  const [rangeStartFilter, setRangeStartFilter] = useState('');
  const [rangeEndFilter, setRangeEndFilter] = useState('');
  const [visibleOrderCount, setVisibleOrderCount] = useState(ORDERS_PER_LOAD);
  const [orderModal, setOrderModal] = useState<OrderForm | null>(null);
  const [productModal, setProductModal] = useState<ProductForm | null>(null);
  const [bulkProductModal, setBulkProductModal] = useState(false);
  const [marketModal, setMarketModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProducts([]);
      setOrders([]);
      setMarkets([]);
      return;
    }

    void loadData();
  }, [session]);

  useEffect(() => {
    setProductPage(1);
  }, [productSearch]);

  useEffect(() => {
    setVisibleOrderCount(ORDERS_PER_LOAD);
  }, [filter, orderDateFilter, marketFilter, rangeStartFilter, rangeEndFilter, search]);

  async function loadData() {
    setError('');
    const [marketsResult, productsResult, ordersResult] = await Promise.all([
      supabase.from('markets').select('*').order('start_date', { ascending: false }),
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select('*, markets(*), order_items(*)')
        .order('date_order_created', { ascending: false })
        .order('created_at', { ascending: false }),
    ]);

    if (marketsResult.error || productsResult.error || ordersResult.error) {
      setError(marketsResult.error?.message || productsResult.error?.message || ordersResult.error?.message || 'Failed to load data.');
      return;
    }

    setMarkets((marketsResult.data || []) as Market[]);
    setProducts((productsResult.data || []) as Product[]);
    setOrders((ordersResult.data || []) as Order[]);
  }

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: 'base' })),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const needle = productSearch.trim().toLowerCase();
    if (!needle) return sortedProducts;
    return sortedProducts.filter((product) => [product.name, product.sku].join(' ').toLowerCase().includes(needle));
  }, [productSearch, sortedProducts]);
  const productPageCount = Math.max(1, Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE));
  const currentProductPage = Math.min(productPage, productPageCount);
  const paginatedProducts = filteredProducts.slice((currentProductPage - 1) * PRODUCTS_PER_PAGE, currentProductPage * PRODUCTS_PER_PAGE);
  const activeMarkets = useMemo(() => markets.filter((market) => market.is_active), [markets]);
  const defaultMarketId = activeMarkets[0]?.id || markets[0]?.id || '';
  const hasRangeFilter = Boolean(rangeStartFilter || rangeEndFilter);

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orders
      .filter((order) => filter === 'All' || order.status === filter)
      .filter((order) => !marketFilter || order.market_id === marketFilter)
      .filter((order) => {
        if (hasRangeFilter) {
          if (rangeStartFilter && order.date_order_created < rangeStartFilter) return false;
          if (rangeEndFilter && order.date_order_created > rangeEndFilter) return false;
          return true;
        }
        return !orderDateFilter || order.date_order_created === orderDateFilter;
      })
      .filter((order) => {
        if (!needle) return true;
        return [order.order_number, order.customer_name, order.customer_phone, order.markets?.name, displayPickupAgreement(order.pickup_agreement)]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      });
  }, [orders, filter, marketFilter, hasRangeFilter, rangeStartFilter, rangeEndFilter, orderDateFilter, search]);

  const dailyTotals = useMemo(() => {
    const pending = filteredOrders.filter((order) => order.status === 'Pending').length;
    const done = filteredOrders.filter((order) => order.status === 'Done').length;
    const paidSales = filteredOrders.filter((order) => order.status === 'Done').reduce((sum, order) => sum + Number(order.total_price), 0);
    const transactionValue = filteredOrders.reduce((sum, order) => sum + Number(order.total_price), 0);
    return { orders: filteredOrders.length, pending, done, paidSales, transactionValue };
  }, [filteredOrders]);
  const visibleOrders = filteredOrders.slice(0, visibleOrderCount);

  async function saveProduct(product: ProductForm) {
    const normalized = {
      name: product.name.trim(),
      size: product.size.trim() || null,
      variation: product.variation.trim() || null,
      price: Number(product.price),
      stock: Number(product.stock),
      sku: product.sku.trim().toUpperCase(),
      product_segment: product.product_segment,
    };

    if (!normalized.name || !normalized.product_segment || !Number.isFinite(normalized.price) || normalized.price < 0 || !Number.isFinite(normalized.stock) || normalized.stock < 0) {
      alert('Product name, product segment, price, and stock are mandatory. Price and stock must be valid numbers.');
      return;
    }

    setBusy(true);
    setError('');
    const result = product.id
      ? await supabase.from('products').update(normalized).eq('id', product.id)
      : await supabase.rpc('create_product', {
        p_name: normalized.name,
        p_size: normalized.size || '',
        p_price: normalized.price,
        p_variation: normalized.variation || '',
        p_stock: normalized.stock,
        p_product_segment: normalized.product_segment,
      });

    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    setProductModal(null);
    await loadData();
  }

  async function deleteProduct(product: Product) {
    if (!confirm(`Delete product ${product.name} (${product.sku})?`)) return;

    setBusy(true);
    setError('');
    const { error: deleteError } = await supabase.from('products').delete().eq('id', product.id);
    setBusy(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    await loadData();
  }

  async function bulkInsertProducts(productInserts: ProductInsert[]) {
    if (productInserts.length === 0) {
      alert('No valid products to import.');
      return;
    }

    setBusy(true);
    setError('');
    const { error: insertError } = await supabase.from('products').insert(productInserts);
    setBusy(false);

    if (insertError) {
      setError(insertError.message);
      return false;
    }

    setBulkProductModal(false);
    await loadData();
    return true;
  }

  async function saveOrder(formOrder: OrderForm) {
    if (formOrder.items.some((item) => !item.product_id)) {
      alert('Choose a valid product from the suggestions for every order item.');
      return;
    }

    const cleanItems = formOrder.items
      .filter((item) => item.product_id && Number(item.quantity) > 0)
      .map((item) => ({ product_id: item.product_id, quantity: Number(item.quantity) }));

    if (!cleanItems.length || !formOrder.pickup_agreement || !formOrder.market_id || !formOrder.date_order_created) {
      alert('Order items, market, pickup agreement, and date order created are mandatory.');
      return;
    }

    const productIds = cleanItems.map((item) => item.product_id);
    if (new Set(productIds).size !== productIds.length) {
      alert('Each product can only be listed once in the same order.');
      return;
    }

    const rpcName = formOrder.id ? 'update_pending_order' : 'create_order';
    const payload = {
      ...(formOrder.id ? { p_order_id: formOrder.id } : {}),
      p_status: formOrder.status,
      p_pickup_agreement: formOrder.pickup_agreement,
      p_market_id: formOrder.market_id,
      p_date_order_created: formOrder.date_order_created,
      p_customer_name: formOrder.customer_name,
      p_customer_address: formOrder.customer_address,
      p_customer_phone: formOrder.customer_phone,
      p_items: cleanItems,
    };

    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc(rpcName, payload);
    setBusy(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setOrderModal(null);
    await loadData();
  }

  async function deleteOrder(order: Order) {
    if (!confirm(`Delete ${order.order_number}? Stock will be returned to products.`)) return;

    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('delete_pending_order', { p_order_id: order.id });
    setBusy(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    await loadData();
  }

  async function saveMarket(market: MarketForm) {
    const normalized = {
      market_id: market.market_id.trim().toUpperCase().replace(/\s+/g, '-'),
      name: market.name.trim(),
      start_date: market.start_date,
      is_active: market.is_active,
    };

    if (!normalized.market_id || !normalized.name || !normalized.start_date) {
      alert('Market ID, market name, and start date are mandatory.');
      return false;
    }

    setBusy(true);
    setError('');
    const result = market.id
      ? await supabase.from('markets').update(normalized).eq('id', market.id)
      : await supabase.from('markets').insert(normalized);
    setBusy(false);

    if (result.error) {
      setError(result.error.message);
      return false;
    }

    await loadData();
    return true;
  }

  async function deleteMarket(market: Market) {
    const attachedOrders = orders.filter((order) => order.market_id === market.id).length;
    if (attachedOrders > 0) {
      if (!confirm(`${market.name} has ${attachedOrders} order(s). Deactivate it instead?`)) return;
      setBusy(true);
      setError('');
      const { error: updateError } = await supabase.from('markets').update({ is_active: false }).eq('id', market.id);
      setBusy(false);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      await loadData();
      return;
    }

    if (!confirm(`Delete market ${market.name}?`)) return;

    setBusy(true);
    setError('');
    const { error: deleteError } = await supabase.from('markets').delete().eq('id', market.id);
    setBusy(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    if (marketFilter === market.id) setMarketFilter('');
    await loadData();
  }

  if (loading) {
    return <div className="center-screen">Loading...</div>;
  }

  if (!session) {
    return <Login />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>HomPimPah Tracking</h1>
          <p>Order and merch stock tracking for fast-paced selling.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setMarketModal(true)}>Markets</button>
          <button className="btn" onClick={() => setBulkProductModal(true)}>Bulk Upload</button>
          <button className="btn" onClick={() => setProductModal({ ...emptyProduct })}>+ Product</button>
          <button className="btn primary" disabled={products.length === 0 || markets.length === 0} onClick={() => setOrderModal(createEmptyOrder(defaultMarketId))}>+ Order</button>
          <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      <main>
        <aside className="panel side">
          <div className="panel-head">
            <h2>Products</h2>
            <button className="btn ghost" disabled={busy} onClick={loadData}>Refresh</button>
          </div>
          <div className="panel-body">
            {error && <div className="notice error">{error}</div>}
            <ProductList
              products={paginatedProducts}
              totalProducts={products.length}
              filteredProductCount={filteredProducts.length}
              busy={busy}
              search={productSearch}
              page={currentProductPage}
              pageCount={productPageCount}
              onSearch={setProductSearch}
              onPageChange={setProductPage}
              onEdit={(product) => setProductModal(productToForm(product))}
              onDelete={deleteProduct}
            />
          </div>
        </aside>

        <section className="panel">
          <div className="panel-head">
            <h2>Orders</h2>
            <span className="subtle">{filteredOrders.length} shown</span>
          </div>
          <div className="panel-body">
            <div className="order-controls">
              <div className="segmented" aria-label="Order status filter">
                {(['All', 'Pending', 'Done'] as const).map((option) => (
                  <button
                    key={option}
                    className={filter === option ? 'active' : ''}
                    onClick={() => setFilter(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="field order-search">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find by Order no, customer, phone" />
              </div>
              <div className="date-filter">
                <div className="field">
                  <label>Daily sales</label>
                  <input type="date" value={orderDateFilter} onChange={(event) => setOrderDateFilter(event.target.value)} />
                </div>
              </div>
            </div>
            <details className="advanced-filters">
              <summary>More filters</summary>
              <div className="advanced-filter-grid">
                <div className="field">
                  <label>Market</label>
                  <select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)}>
                    <option value="">All markets</option>
                    {markets.map((market) => (
                      <option key={market.id} value={market.id}>{market.name}</option>
                    ))}
                  </select>
                </div>
                <Field label="Start date" type="date" value={rangeStartFilter} onChange={setRangeStartFilter} />
                <Field label="End date" type="date" value={rangeEndFilter} onChange={setRangeEndFilter} />
                <button
                  className="btn"
                  type="button"
                  disabled={!marketFilter && !rangeStartFilter && !rangeEndFilter}
                  onClick={() => {
                    setMarketFilter('');
                    setRangeStartFilter('');
                    setRangeEndFilter('');
                  }}
                >
                  Clear
                </button>
              </div>
            </details>
            <div className="stats daily-stats">
              <Stat label={hasRangeFilter ? 'Filtered orders' : 'Daily orders'} value={dailyTotals.orders} />
              <Stat label="Pending" value={dailyTotals.pending} />
              <Stat label="Done" value={dailyTotals.done} />
              <Stat label="Paid sales" value={money(dailyTotals.paidSales)} />
            </div>
            <div className="notice compact-notice">
              Total transaction value for {hasRangeFilter ? 'selected range' : displayDate(orderDateFilter)}: {money(dailyTotals.transactionValue)}
            </div>
          </div>
          <div className="panel-body order-list">
            {products.length === 0 && <div className="notice">Add at least one product before creating an order.</div>}
            {filteredOrders.length === 0
              ? <div className="empty">No orders yet.</div>
              : visibleOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onEdit={() => setOrderModal(orderToForm(order))}
                  onDelete={() => deleteOrder(order)}
                />
              ))}
            {visibleOrders.length < filteredOrders.length && (
              <button
                className="btn load-more"
                type="button"
                onClick={() => setVisibleOrderCount((count) => count + ORDERS_PER_LOAD)}
              >
                Load More Orders
              </button>
            )}
          </div>
        </section>
      </main>

      {marketModal && <MarketModal markets={markets} busy={busy} onClose={() => setMarketModal(false)} onSave={saveMarket} onDelete={deleteMarket} />}
      {productModal && <ProductModal product={productModal} products={products} busy={busy} onClose={() => setProductModal(null)} onSave={saveProduct} />}
      {bulkProductModal && (
        <BulkProductModal
          busy={busy}
          existingSkus={products.map((product) => product.sku)}
          onClose={() => setBulkProductModal(false)}
          onImport={bulkInsertProducts}
        />
      )}
      {orderModal && <OrderModal order={orderModal} products={sortedProducts} markets={markets} busy={busy} onClose={() => setOrderModal(null)} onSave={saveOrder} />}
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setMessage(error.message);
  }

  return (
    <div className="login-page">
      <form className="login panel" onSubmit={signIn}>
        <div className="panel-head">
          <h1>HomPimPah Tracking</h1>
        </div>
        <div className="panel-body login-body">
          {message && <div className="notice error">{message}</div>}
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          <button className="btn primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        </div>
      </form>
    </div>
  );
}

function productToForm(product: Product): ProductForm {
  return {
    id: product.id,
    name: product.name,
    size: product.size || '',
    price: product.price,
    variation: product.variation || '',
    stock: product.stock,
    sku: product.sku,
    product_segment: product.product_segment || getProductSegmentFromSku(product.sku),
  };
}

function orderToForm(order: Order): OrderForm {
  return {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    pickup_agreement: normalizePickupAgreement(order.pickup_agreement),
    market_id: order.market_id,
    date_order_created: order.date_order_created,
    customer_name: order.customer_name || '',
    customer_address: order.customer_address || '',
    customer_phone: order.customer_phone || '',
    items: order.order_items.map((item) => ({
      product_id: item.product_id,
      product_query: `${item.sku} - ${item.item_name} - ${item.variation || 'No variation'}`,
      quantity: item.quantity,
    })),
  };
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function ProductList({
  products,
  totalProducts,
  filteredProductCount,
  busy,
  search,
  page,
  pageCount,
  onSearch,
  onPageChange,
  onEdit,
  onDelete,
}: {
  products: Product[];
  totalProducts: number;
  filteredProductCount: number;
  busy: boolean;
  search: string;
  page: number;
  pageCount: number;
  onSearch: (value: string) => void;
  onPageChange: (value: number) => void;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
}) {
  return (
    <div className="products">
      <div className="field">
        <div className="field-header">
          <label>Search products</label>
          <span className="subtle">{filteredProductCount} of {totalProducts}</span>
        </div>
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Product name or SKU" />
      </div>
      {products.length === 0 ? (
        <div className="empty">No products.</div>
      ) : (
        products.map((product) => (
          <div className="product" key={product.id}>
            <div>
              <strong>{product.name}</strong>
              <small>{product.sku} | {product.product_segment || getProductSegmentFromSku(product.sku)} | {product.size || 'No size'} | {product.variation || 'No variation'} | {money(product.price)}</small>
            </div>
            <div className="product-stock">
              <strong>{product.stock}</strong>
              <div className="product-actions">
                <button className="btn ghost small-btn" disabled={busy} onClick={() => onEdit(product)}>Edit</button>
                <button className="btn danger small-btn" disabled={busy} onClick={() => onDelete(product)}>Delete</button>
              </div>
            </div>
          </div>
        ))
      )}
      {filteredProductCount > PRODUCTS_PER_PAGE && (
        <div className="pager">
          <button className="btn small-btn" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
          <span>Page {page} of {pageCount}</span>
          <button className="btn small-btn" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

function OrderCard({ order, onEdit, onDelete }: { order: Order; onEdit: () => void; onDelete: () => void }) {
  return (
    <article className="order-card">
      <div className="order-top">
        <div>
          <h3 className="order-title">{order.order_number}</h3>
          <div className="subtle">{order.customer_name || 'No customer name'} | {order.customer_phone || 'No phone'}</div>
        </div>
        <span className={`status ${order.status.toLowerCase()}`}>{order.status}</span>
      </div>
      <div className="meta">
        <Meta label="Total" value={money(order.total_price)} />
        <Meta label="Created" value={displayDate(order.date_order_created)} />
        <Meta label="Market" value={order.markets?.name || 'Art Market'} />
        <Meta label="Agreement" value={displayPickupAgreement(order.pickup_agreement)} />
        <Meta label="Address" value={order.customer_address || '-'} />
      </div>
      <ul className="items">
        {order.order_items.map((item) => (
          <li key={item.id || `${item.product_id}-${item.sku}`}>
            <span>
              {item.item_name} x {item.quantity}
              <br />
              <span className="subtle">{item.sku} | {item.size || '-'} | {item.variation || '-'}</span>
            </span>
            <strong className="money">{money(item.line_total)}</strong>
          </li>
        ))}
      </ul>
      {order.status === 'Pending' ? (
        <div className="card-actions">
          <button className="btn" onClick={onEdit}>Edit</button>
          <button className="btn danger" onClick={onDelete}>Delete</button>
        </div>
      ) : (
        <div className="subtle completed-note">Completed order</div>
      )}
    </article>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function MarketModal({
  markets,
  busy,
  onSave,
  onDelete,
  onClose,
}: {
  markets: Market[];
  busy: boolean;
  onSave: (market: MarketForm) => Promise<boolean>;
  onDelete: (market: Market) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<MarketForm>(emptyMarket);
  const update = (key: keyof MarketForm, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const saved = await onSave(form);
    if (saved) setForm(emptyMarket);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal wide-modal">
        <div className="panel-head">
          <h2>Markets</h2>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        <div className="modal-content">
          <form className="market-form" onSubmit={submit}>
            <div className="grid-2">
              <Field label="Market name *" value={form.name} onChange={(value) => update('name', value)} required />
              <Field label="Market ID *" value={form.market_id} onChange={(value) => update('market_id', value)} required />
              <Field label="Start date *" type="date" value={form.start_date} onChange={(value) => update('start_date', value)} required />
              <label className="check-field">
                <input type="checkbox" checked={form.is_active} onChange={(event) => update('is_active', event.target.checked)} />
                <span>Active market</span>
              </label>
            </div>
            <div className="form-actions">
              {form.id && <button type="button" className="btn" onClick={() => setForm(emptyMarket)}>New Market</button>}
              <button className="btn primary" disabled={busy}>{busy ? 'Saving...' : form.id ? 'Save Market' : 'Create Market'}</button>
            </div>
          </form>

          <div className="market-list">
            {markets.length === 0 ? (
              <div className="empty">No markets yet.</div>
            ) : (
              markets.map((market) => (
                <div className="market-row" key={market.id}>
                  <div>
                    <strong>{market.name}</strong>
                    <small>{market.market_id} | Starts {displayDate(market.start_date)} | {market.is_active ? 'Active' : 'Inactive'}</small>
                  </div>
                  <div className="product-actions">
                    <button className="btn ghost small-btn" disabled={busy} onClick={() => setForm({
                      id: market.id,
                      market_id: market.market_id,
                      name: market.name,
                      start_date: market.start_date,
                      is_active: market.is_active,
                    })}>Edit</button>
                    <button className="btn danger small-btn" disabled={busy} onClick={() => onDelete(market)}>Delete</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductModal({
  product,
  products,
  busy,
  onSave,
  onClose,
}: {
  product: ProductForm;
  products: Product[];
  busy: boolean;
  onSave: (product: ProductForm) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(product);
  const update = (key: keyof ProductForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const skuPreview = form.id ? form.sku : getNextSku(form.product_segment, products);

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="panel-head">
          <h2>{form.id ? 'Edit Product' : 'Add Product'}</h2>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
          <div className="grid-2">
            <Field label="Product name *" value={form.name} onChange={(value) => update('name', value)} required />
            <div className="field">
              <label>Product segment *</label>
              <select value={form.product_segment} onChange={(event) => update('product_segment', event.target.value)} required>
                {PRODUCT_SEGMENTS.map((segment) => <option key={segment}>{segment}</option>)}
              </select>
            </div>
            <div className="field">
              <label>SKU</label>
              <input readOnly value={skuPreview} />
            </div>
            <Field label="Size" value={form.size} onChange={(value) => update('size', value)} />
            <Field label="Variation" value={form.variation} onChange={(value) => update('variation', value)} />
            <Field label="Price *" type="number" min="0" value={form.price} onChange={(value) => update('price', value)} required />
            <Field label="Stock *" type="number" min="0" value={form.stock} onChange={(value) => update('stock', value)} required />
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save Product'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BulkProductModal({
  busy,
  existingSkus,
  onImport,
  onClose,
}: {
  busy: boolean;
  existingSkus: string[];
  onImport: (products: ProductInsert[]) => Promise<boolean | undefined>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ProductImportRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [message, setMessage] = useState('');

  const totalErrors = rows.reduce((total, row) => total + row.errors.length, 0);
  const validRows = rows.filter((row) => row.errors.length === 0);

  async function handleFiles(files: FileList | null) {
    const selectedFiles = Array.from(files || []);
    setMessage('');

    if (selectedFiles.length === 0) {
      setRows([]);
      return;
    }

    setParsing(true);
    try {
      const parsedRows = await parseProductExcelFiles(selectedFiles);
      setRows(validateProductImportRows(parsedRows, existingSkus));
    } catch (error) {
      setRows([]);
      setMessage(error instanceof Error ? error.message : 'Failed to read Excel file.');
    } finally {
      setParsing(false);
    }
  }

  async function importProducts() {
    const imported = await onImport(productImportRowsToInserts(validRows));
    if (imported) setRows([]);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal wide-modal">
        <div className="panel-head">
          <div>
            <h2>Bulk Upload Products</h2>
            <span className="subtle">Accepted headers: Product Name*, SKU*, Size, Variation, Price*, Stock*</span>
          </div>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        <div className="modal-content">
          {message && <div className="notice error">{message}</div>}
          <div className="field">
            <label>Excel files</label>
            <input type="file" accept=".xlsx,.xls" multiple onChange={(event) => handleFiles(event.target.files)} />
          </div>
          <div className="import-summary">
            <span>{rows.length} rows found</span>
            <span>{validRows.length} ready</span>
            <span>{totalErrors} errors</span>
          </div>
          <div className="table-wrap">
            <table className="import-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Row</th>
                  <th>Product Name</th>
                  <th>SKU</th>
                  <th>Size</th>
                  <th>Variation</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="empty-cell">Choose one or more Excel files to preview products.</td>
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr key={`${row.source_file}-${row.sheet_name}-${row.row_number}-${index}`} className={row.errors.length ? 'invalid-row' : ''}>
                      <td>{row.source_file}<br /><span className="subtle">{row.sheet_name}</span></td>
                      <td>{row.row_number}</td>
                      <td>{row.name || '-'}</td>
                      <td>{row.sku || '-'}</td>
                      <td>{row.size || '-'}</td>
                      <td>{row.variation || '-'}</td>
                      <td>{row.price === null ? '-' : money(row.price)}</td>
                      <td>{row.stock === null ? '-' : row.stock}</td>
                      <td>{row.errors.length ? row.errors.join(' ') : 'Ready'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy || parsing || rows.length === 0 || totalErrors > 0} onClick={importProducts}>
              {busy ? 'Importing...' : parsing ? 'Reading...' : `Import ${validRows.length} Products`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductAutocomplete({
  item,
  rowIndex,
  products,
  selectedProductIds,
  isFocused,
  onFocus,
  onBlur,
  onQueryChange,
  onSelect,
}: {
  item: OrderFormItem;
  rowIndex: number;
  products: Product[];
  selectedProductIds: string[];
  isFocused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onQueryChange: (value: string) => void;
  onSelect: (product: Product) => void;
}) {
  const needle = item.product_query.trim().toLowerCase();
  const suggestions = products
    .filter((product) => {
      if (product.id === item.product_id) return true;
      if (selectedProductIds.includes(product.id)) return false;
      if (!needle) return true;
      return [product.name, product.sku].join(' ').toLowerCase().includes(needle);
    });

  return (
    <div className="field autocomplete-field">
      <label>Product</label>
      <input
        value={item.product_query}
        onChange={(event) => onQueryChange(event.target.value)}
        onFocus={onFocus}
        onClick={onFocus}
        onBlur={onBlur}
        placeholder="Choose product by name or SKU"
        required
        aria-autocomplete="list"
        aria-expanded={isFocused}
        aria-controls={`product-suggestions-${rowIndex}`}
      />
      {isFocused && (
        <div className="suggestions" id={`product-suggestions-${rowIndex}`}>
          {suggestions.length === 0 ? (
            <div className="suggestion empty-suggestion">No matching products</div>
          ) : (
            suggestions.map((product) => (
              <button
                type="button"
                className="suggestion"
                key={product.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(product)}
              >
                <strong>{product.sku} - {product.name}</strong>
                <span>{product.variation || 'No variation'} | {product.stock} stock | {money(product.price)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function OrderModal({
  order,
  products,
  markets,
  busy,
  onSave,
  onClose,
}: {
  order: OrderForm;
  products: Product[];
  markets: Market[];
  busy: boolean;
  onSave: (order: OrderForm) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(order);
  const [focusedProductRow, setFocusedProductRow] = useState<number | null>(null);
  const update = (key: keyof OrderForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const updateItem = (index: number, key: keyof OrderFormItem, value: string) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
    }));
  };
  const updateProductQuery = (index: number, value: string) => {
    setFocusedProductRow(index);
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, product_id: '', product_query: value } : item),
    }));
  };
  const selectProduct = (index: number, product: Product) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, product_id: product.id, product_query: productOptionLabel(product) } : item),
    }));
    setFocusedProductRow(null);
  };
  const selectedTotal = form.items.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.product_id);
    return sum + (Number(product?.price || 0) * Number(item.quantity || 0));
  }, 0);
  const selectedProductIds = form.items.map((item) => item.product_id).filter(Boolean);
  const canAddItem = selectedProductIds.length < products.length;
  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: 'base' })),
    [products],
  );

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="panel-head">
          <h2>{form.id ? `Edit ${form.order_number}` : 'Add Order'}</h2>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
          <div className="section">
            <h3>Order Items *</h3>
            {form.items.map((item, index) => (
              <div className="item-row" key={index}>
                <ProductAutocomplete
                  item={item}
                  rowIndex={index}
                  products={sortedProducts}
                  selectedProductIds={selectedProductIds}
                  isFocused={focusedProductRow === index}
                  onFocus={() => setFocusedProductRow(index)}
                  onBlur={() => window.setTimeout(() => setFocusedProductRow((current) => current === index ? null : current), 120)}
                  onQueryChange={(value) => updateProductQuery(index, value)}
                  onSelect={(product) => selectProduct(index, product)}
                />
                <Field label="Qty" type="number" min="1" value={item.quantity} onChange={(value) => updateItem(index, 'quantity', value)} required />
                <div className="field">
                  <label>Line total</label>
                  <input readOnly value={money(Number(products.find((entry) => entry.id === item.product_id)?.price || 0) * Number(item.quantity || 0))} />
                </div>
                <button
                  type="button"
                  className="btn danger"
                  disabled={form.items.length === 1}
                  onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn"
              disabled={!canAddItem}
              onClick={() => setForm((current) => ({ ...current, items: [...current.items, { product_id: '', product_query: '', quantity: 1 }] }))}
            >
              + Add Item
            </button>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>Market *</label>
              <select value={form.market_id} onChange={(event) => update('market_id', event.target.value)} required>
                <option value="" disabled>Choose market</option>
                {markets.map((market) => (
                  <option key={market.id} value={market.id}>{market.name}{market.is_active ? '' : ' (inactive)'}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Order status *</label>
              <select value={form.status} onChange={(event) => update('status', event.target.value)} required>
                <option>Pending</option>
                <option>Done</option>
              </select>
            </div>
            <div className="field">
              <label>Pick up agreement *</label>
              <select value={form.pickup_agreement} onChange={(event) => update('pickup_agreement', event.target.value)} required>
                {DELIVERY_TYPES.map((type) => <option key={type}>{type}</option>)}
              </select>
            </div>
            <Field label="Date order created *" type="date" value={form.date_order_created} onChange={(value) => update('date_order_created', value)} required />
            <div className="field">
              <label>Total order price *</label>
              <input readOnly value={money(selectedTotal)} />
            </div>
          </div>

          <div className="section">
            <h3>Customer Info</h3>
            <div className="grid-2">
              <Field label="Name" value={form.customer_name} onChange={(value) => update('customer_name', value)} />
              <Field label="Phone no" value={form.customer_phone} onChange={(value) => update('customer_phone', value)} />
            </div>
            <div className="field">
              <label>Address</label>
              <textarea value={form.customer_address} onChange={(event) => update('customer_address', event.target.value)} />
            </div>
          </div>

          <div className="form-actions">
            <strong className="money form-total">Total: {money(selectedTotal)}</strong>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save Order'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

type FieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
};

function Field({ label, value, onChange, type = 'text', ...props }: FieldProps) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} {...props} />
    </div>
  );
}
