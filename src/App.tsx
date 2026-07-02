import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './utils/supabase';
import type { Order, OrderForm, OrderFormItem, PickupAgreement, Product, ProductForm } from './types';

const DELIVERY_TYPES: PickupAgreement[] = ['Self pick up at biggledot', 'Online delivery', 'Expedition'];
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

const emptyProduct: ProductForm = { name: '', size: '', price: '', variation: '', stock: '', sku: '' };
const emptyOrder: OrderForm = {
  status: 'Pending',
  pickup_agreement: DELIVERY_TYPES[0],
  date_order_created: today(),
  customer_name: '',
  customer_address: '',
  customer_phone: '',
  items: [{ product_id: '', quantity: 1 }],
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<'All' | 'Pending' | 'Done'>('All');
  const [search, setSearch] = useState('');
  const [orderModal, setOrderModal] = useState<OrderForm | null>(null);
  const [productModal, setProductModal] = useState<ProductForm | null>(null);
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
      return;
    }

    void loadData();
  }, [session]);

  async function loadData() {
    setError('');
    const [productsResult, ordersResult] = await Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select('*, order_items(*)')
        .order('date_order_created', { ascending: false })
        .order('created_at', { ascending: false }),
    ]);

    if (productsResult.error || ordersResult.error) {
      setError(productsResult.error?.message || ordersResult.error?.message || 'Failed to load data.');
      return;
    }

    setProducts((productsResult.data || []) as Product[]);
    setOrders((ordersResult.data || []) as Order[]);
  }

  const totals = useMemo(() => {
    const pending = orders.filter((order) => order.status === 'Pending').length;
    const done = orders.filter((order) => order.status === 'Done').length;
    const revenue = orders.filter((order) => order.status === 'Done').reduce((sum, order) => sum + Number(order.total_price), 0);
    const lowStock = products.filter((product) => Number(product.stock) <= 3).length;
    return { pending, done, revenue, lowStock };
  }, [orders, products]);

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orders
      .filter((order) => filter === 'All' || order.status === filter)
      .filter((order) => {
        if (!needle) return true;
        return [order.order_number, order.customer_name, order.customer_phone, order.pickup_agreement]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      });
  }, [orders, filter, search]);

  async function saveProduct(product: ProductForm) {
    const normalized = {
      name: product.name.trim(),
      size: product.size.trim() || null,
      variation: product.variation.trim() || null,
      price: Number(product.price),
      stock: Number(product.stock),
      sku: product.sku.trim().toUpperCase(),
    };

    if (!normalized.name || !normalized.sku || !Number.isFinite(normalized.price) || normalized.price < 0 || !Number.isFinite(normalized.stock) || normalized.stock < 0) {
      alert('Product name, price, stock, and SKU are mandatory. Price and stock must be valid numbers.');
      return;
    }

    setBusy(true);
    setError('');
    const result = product.id
      ? await supabase.from('products').update(normalized).eq('id', product.id)
      : await supabase.from('products').insert(normalized);

    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    setProductModal(null);
    await loadData();
  }

  async function saveOrder(formOrder: OrderForm) {
    const cleanItems = formOrder.items
      .filter((item) => item.product_id && Number(item.quantity) > 0)
      .map((item) => ({ product_id: item.product_id, quantity: Number(item.quantity) }));

    if (!cleanItems.length || !formOrder.pickup_agreement || !formOrder.date_order_created) {
      alert('Order items, pickup agreement, and date order created are mandatory.');
      return;
    }

    const rpcName = formOrder.id ? 'update_pending_order' : 'create_order';
    const payload = {
      ...(formOrder.id ? { p_order_id: formOrder.id } : {}),
      p_status: formOrder.status,
      p_pickup_agreement: formOrder.pickup_agreement,
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
          <button className="btn" onClick={() => setProductModal({ ...emptyProduct })}>+ Product</button>
          <button className="btn primary" disabled={products.length === 0} onClick={() => setOrderModal({ ...emptyOrder })}>+ Order</button>
          <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      <main>
        <aside className="panel side">
          <div className="panel-head">
            <h2>Dashboard</h2>
            <button className="btn ghost" disabled={busy} onClick={loadData}>Refresh</button>
          </div>
          <div className="panel-body">
            {error && <div className="notice error">{error}</div>}
            <div className="stats">
              <Stat label="Pending" value={totals.pending} />
              <Stat label="Done" value={totals.done} />
              <Stat label="Paid revenue" value={money(totals.revenue)} />
              <Stat label="Low stock" value={totals.lowStock} />
            </div>
            <div className="filters">
              <div className="field">
                <label>Search orders</label>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Order no, customer, phone" />
              </div>
              <div className="field">
                <label>Status filter</label>
                <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
                  {['All', 'Pending', 'Done'].map((option) => <option key={option}>{option}</option>)}
                </select>
              </div>
            </div>
            <ProductList products={products} onEdit={(product) => setProductModal(productToForm(product))} />
          </div>
        </aside>

        <section className="panel">
          <div className="panel-head">
            <h2>Orders</h2>
            <span className="subtle">{filteredOrders.length} shown</span>
          </div>
          <div className="panel-body order-list">
            {products.length === 0 && <div className="notice">Add at least one product before creating an order.</div>}
            {filteredOrders.length === 0
              ? <div className="empty">No orders yet.</div>
              : filteredOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onEdit={() => setOrderModal(orderToForm(order))}
                  onDelete={() => deleteOrder(order)}
                />
              ))}
          </div>
        </section>
      </main>

      {productModal && <ProductModal product={productModal} busy={busy} onClose={() => setProductModal(null)} onSave={saveProduct} />}
      {orderModal && <OrderModal order={orderModal} products={products} busy={busy} onClose={() => setOrderModal(null)} onSave={saveOrder} />}
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
  };
}

function orderToForm(order: Order): OrderForm {
  return {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    pickup_agreement: order.pickup_agreement,
    date_order_created: order.date_order_created,
    customer_name: order.customer_name || '',
    customer_address: order.customer_address || '',
    customer_phone: order.customer_phone || '',
    items: order.order_items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
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

function ProductList({ products, onEdit }: { products: Product[]; onEdit: (product: Product) => void }) {
  return (
    <div className="products">
      <div className="panel-head compact-head">
        <h3>Products</h3>
        <span className="subtle">{products.length} total</span>
      </div>
      {products.length === 0 ? (
        <div className="empty">No products.</div>
      ) : (
        products.map((product) => (
          <div className="product" key={product.id}>
            <div>
              <strong>{product.name}</strong>
              <small>{product.sku} | {product.size || 'No size'} | {product.variation || 'No variation'} | {money(product.price)}</small>
            </div>
            <div className="product-stock">
              <strong>{product.stock}</strong>
              <button className="btn ghost small-btn" onClick={() => onEdit(product)}>Edit</button>
            </div>
          </div>
        ))
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
        <Meta label="Created" value={order.date_order_created} />
        <Meta label="Agreement" value={order.pickup_agreement} />
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

function ProductModal({ product, busy, onSave, onClose }: { product: ProductForm; busy: boolean; onSave: (product: ProductForm) => void; onClose: () => void }) {
  const [form, setForm] = useState(product);
  const update = (key: keyof ProductForm, value: string) => setForm((current) => ({ ...current, [key]: value }));

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
            <Field label="SKU *" value={form.sku} onChange={(value) => update('sku', value)} required />
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

function OrderModal({ order, products, busy, onSave, onClose }: { order: OrderForm; products: Product[]; busy: boolean; onSave: (order: OrderForm) => void; onClose: () => void }) {
  const [form, setForm] = useState(order);
  const update = (key: keyof OrderForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const updateItem = (index: number, key: keyof OrderFormItem, value: string) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
    }));
  };
  const selectedTotal = form.items.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.product_id);
    return sum + (Number(product?.price || 0) * Number(item.quantity || 0));
  }, 0);

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
                <div className="field">
                  <label>Product</label>
                  <select value={item.product_id} required onChange={(event) => updateItem(index, 'product_id', event.target.value)}>
                    <option value="">Choose product</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>{product.name} ({product.stock} stock) - {money(product.price)}</option>
                    ))}
                  </select>
                </div>
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
            <button type="button" className="btn" onClick={() => setForm((current) => ({ ...current, items: [...current.items, { product_id: '', quantity: 1 }] }))}>+ Add Item</button>
          </div>

          <div className="grid-2">
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
