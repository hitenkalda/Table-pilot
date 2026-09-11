import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import { SPICE_LABELS, type Dish, type Order, type OrderStatus } from "../types";
import {
  getRestaurant,
  menuStore,
  setDishAvailability,
  setDishPublished,
  addCategory,
  addTable,
  setTableActive,
  updateSettings,
  newDish,
  saveDish,
  dishCompleteness,
} from "../lib/menuSource";
import { useOrders, transitionOrder, setOrderPaymentStatus, orderAnalytics } from "../lib/orders";
import { formatPrice, timeAgo } from "../lib/localStore";
import { useMenuVersion } from "../lib/menuSource";
import { useSession, signOut, authEnabled } from "../lib/auth";

const SECTIONS = [
  ["overview", "Overview"],
  ["orders", "Orders"],
  ["kitchen", "Kitchen"],
  ["menu", "Menu"],
  ["tables", "Tables"],
  ["qr", "QR Codes"],
  ["payments", "Payments"],
  ["analytics", "Analytics"],
  ["settings", "Settings"],
] as const;

type Section = (typeof SECTIONS)[number][0];

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "New",
  ACCEPTED: "Accepted",
  PREPARING: "Preparing",
  READY: "Ready",
  SERVED: "Served",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export function DashboardPage() {
  useMenuVersion();
  const [params, setParams] = useSearchParams();
  const section = (params.get("section") ?? "overview") as Section;
  const orders = useOrders();
  const session = useSession();

  function go(next: Section) {
    setParams({ section: next });
    window.scrollTo({ top: 0 });
  }

  if (authEnabled() && !session) {
    return (
      <div className="container">
        <header className="app-header">
          <h1>Manager sign in required</h1>
          <p>Your dashboard is protected — sign in with your manager account.</p>
        </header>
        <p>
          <Link className="button-link primary" to="/login">
            Go to sign in →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-brand">TABLEPILOT</div>
        <nav aria-label="Dashboard sections">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => go(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Link to="/r/cedar-table">Public menu ↗</Link>
          {session && (
            <button className="linklike" onClick={() => void signOut()}>
              Sign out ({session.email})
            </button>
          )}
        </div>
      </aside>
      <main className="dash-main">
        {section === "overview" && <Overview orders={orders} />}
        {section === "orders" && <OrdersSection orders={orders} />}
        {section === "kitchen" && <KitchenBoard orders={orders} />}
        {section === "menu" && <MenuSection />}
        {section === "tables" && <TablesSection />}
        {section === "qr" && <QrSection />}
        {section === "payments" && <PaymentsSection orders={orders} />}
        {section === "analytics" && <AnalyticsSection orders={orders} />}
        {section === "settings" && <SettingsSection />}
      </main>
    </div>
  );
}

/* ---------------- Overview ---------------- */

function Overview({ orders }: { orders: Order[] }) {
  const a = orderAnalytics(orders);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return (
    <>
      <header className="app-header">
        <h1>{greeting} 👋</h1>
        <p>Today at The Cedar Table</p>
      </header>
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-num">{formatPrice("₹", a.revenue)}</span>
          <span className="stat-label">Revenue</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{a.orderCount}</span>
          <span className="stat-label">Orders</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{formatPrice("₹", Math.round(a.avgOrder))}</span>
          <span className="stat-label">Avg order</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{a.pending}</span>
          <span className="stat-label">Pending</span>
        </div>
      </div>
      <h4 className="section-title">Live</h4>
      <div className="live-box">
        <span>{a.pending} new orders</span>
        <span>{a.preparing} preparing</span>
        <span>{a.ready} ready</span>
      </div>
      <h4 className="section-title">Quick actions</h4>
      <QuickActions />
    </>
  );
}

function QuickActions() {
  const [, setParams] = useSearchParams();
  return (
    <div className="sheet-actions">
      <button onClick={() => setParams({ section: "menu", edit: "new" })}>+ Add Dish</button>
      <button onClick={() => setParams({ section: "tables" })}>+ Add Table</button>
      <button onClick={() => setParams({ section: "orders" })}>View Orders</button>
      <button onClick={() => setParams({ section: "qr" })}>Generate QR</button>
    </div>
  );
}

/* ---------------- Orders queue ---------------- */

function OrdersSection({ orders }: { orders: Order[] }) {
  const active = orders.filter((o) => o.status !== "SERVED");
  const past = orders.filter((o) => o.status === "SERVED");

  return (
    <>
      <header className="app-header"><h1>Orders</h1><p>Newest first — updates live across tabs</p></header>
      {active.length === 0 && <p>No open orders right now.</p>}
      <div className="order-grid">
        {active.map((o) => (
          <OrderCard key={o.id} order={o} />
        ))}
      </div>
      {past.length > 0 && (
        <>
          <h4 className="section-title">Served</h4>
          <div className="order-grid">
            {past.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function OrderCard({ order }: { order: Order }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function move(to: OrderStatus, reason?: string) {
    setBusy(true);
    try {
      await transitionOrder(order.id, to, reason);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={`order-card status-${order.status.toLowerCase()}`}>
      <div className="order-head">
        <strong>#{order.orderNumber}</strong>
        <span>{order.tableNumber ? `Table ${order.tableNumber}` : "Takeaway"}</span>
        <span className="muted">{timeAgo(order.createdAt)}</span>
      </div>
      <ul className="order-items">
        {order.items.map((i, idx) => (
          <li key={idx}>
            {i.dishNameSnapshot} × {i.quantity}
            {i.specialInstruction ? ` — ${i.specialInstruction}` : ""}
          </li>
        ))}
      </ul>
      {order.customerNote && <p className="not-provided">Note: {order.customerNote}</p>}
      <p className="order-total">{formatPrice("₹", order.total)} · {STATUS_LABELS[order.status]} · {order.paymentStatus.replace("_", " ")}</p>
      {error && <p className="not-provided" role="alert">{error}</p>}
      <div className="sheet-actions">
        {order.status === "PENDING" && (
          <>
            <button className="primary" disabled={busy} onClick={() => void move("ACCEPTED")}>Accept</button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt("Reason for rejection:") ?? undefined;
                void move("REJECTED", reason);
              }}
            >
              Reject
            </button>
          </>
        )}
        {order.status === "ACCEPTED" && (
          <button className="primary" disabled={busy} onClick={() => void move("PREPARING")}>Send to Kitchen</button>
        )}
        {order.status === "PREPARING" && (
          <button className="primary" disabled={busy} onClick={() => void move("READY")}>Mark Ready</button>
        )}
        {order.status === "READY" && (
          <button className="primary" disabled={busy} onClick={() => void move("SERVED")}>Mark Served</button>
        )}
      </div>
    </article>
  );
}

/* ---------------- Kitchen ---------------- */

function KitchenBoard({ orders }: { orders: Order[] }) {
  const columns: Array<[string, OrderStatus[], (o: Order) => string, OrderStatus | null]> = [
    ["NEW", ["PENDING", "ACCEPTED"], (o) => (o.status === "PENDING" ? "Waiting for acceptance" : "Accepted"), null],
    ["PREPARING", ["PREPARING"], () => "In progress", "READY"],
    ["READY", ["READY"], () => "Collect for table", "SERVED"],
  ];
  return (
    <>
      <header className="app-header"><h1>Kitchen</h1><p>Large buttons — updates live</p></header>
      <div className="kitchen-grid">
        {columns.map(([title, statuses, hint, action]) => (
          <div key={title} className="kitchen-col">
            <h4 className="section-title">{title}</h4>
            {orders
              .filter((o) => statuses.includes(o.status))
              .map((o) => (
                <div key={o.id} className="kitchen-card">
                  <strong>#{o.orderNumber}</strong> <span>{o.tableNumber ? `Table ${o.tableNumber}` : "Takeaway"}</span>
                  <ul className="order-items">
                    {o.items.map((i, idx) => (
                      <li key={idx}>{i.dishNameSnapshot} × {i.quantity}</li>
                    ))}
                  </ul>
                  <p className="muted">{hint(o)}</p>
                  {action && (
                    <button
                      className="primary wide"
                      onClick={() => void transitionOrder(o.id, action).catch(() => {})}
                    >
                      {action === "READY" ? "READY" : "SERVED"}
                    </button>
                  )}
                </div>
              ))}
            {orders.filter((o) => statuses.includes(o.status)).length === 0 && (
              <p className="muted">—</p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Menu ---------------- */

function MenuSection() {
  const restaurant = getRestaurant();
  const [, force] = useState(0);
  const [params] = useSearchParams();
  const editingId = params.get("edit");
  const [draft, setDraft] = useState<Dish | null>(null);

  useEffect(() => {
    if (editingId === "new") {
      setDraft(newDish(restaurant.categories[0]?.id ?? ""));
    }
  }, [editingId]);

  function refresh() {
    force((n) => n + 1);
  }

  const dishList = restaurant.dishes;

  return (
    <>
      <header className="app-header">
        <h1>Menu</h1>
        <p>{dishList.length} dishes · publish, availability & completeness</p>
      </header>

      {draft ? (
        <DishEditor
          draft={draft}
          categories={restaurant.categories}
          onSave={(d) => {
            saveDish(d);
            setDraft(null);
            refresh();
          }}
          onCancel={() => setDraft(null)}
        />
      ) : (
        <>
          <div className="sheet-actions">
            <button className="primary" onClick={() => setDraft(newDish(restaurant.categories[0]?.id ?? ""))}>
              + Add Dish
            </button>
          </div>
          <h4 className="section-title">Categories</h4>
          <div className="sheet-actions">
            {restaurant.categories.map((c) => (
              <span key={c.id} className="chip">{c.name}</span>
            ))}
          </div>
          <AddCategory onAdd={(name) => { addCategory(name); refresh(); }} />
          <h4 className="section-title">Dishes</h4>
          <div className="menu-admin-list">
            {dishList.map((d) => {
              const comp = dishCompleteness(d);
              return (
                <div key={d.id} className="menu-admin-row">
                  <div>
                    <strong>{d.name || "(unnamed draft)"}</strong>
                    <span className="muted"> · {formatPrice("₹", d.price)} · {SPICE_LABELS[d.spice_level]}</span>
                    <div className="completeness">
                      <span>Menu completeness: {comp.percent}%</span>
                      {comp.missing.length > 0 && (
                        <span className="not-provided"> ⚠ {comp.missing.join(", ")}</span>
                      )}
                    </div>
                  </div>
                  <div className="sheet-actions">
                    <button
                      onClick={() => { setDishAvailability(d.id, !d.is_available); refresh(); }}
                    >
                      {d.is_available ? "Mark unavailable" : "Mark available"}
                    </button>
                    <button
                      onClick={() => { setDishPublished(d.id, !d.published); refresh(); }}
                    >
                      {d.published ? "Unpublish" : "Publish"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function AddCategory({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form
      className="chat-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) {
          onAdd(name.trim());
          setName("");
        }
      }}
    >
      <input
        type="text"
        placeholder="New category name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit">Add</button>
    </form>
  );
}

function DishEditor({
  draft,
  categories,
  onSave,
  onCancel,
}: {
  draft: Dish;
  categories: { id: string; name: string }[];
  onSave: (d: Dish) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Dish>(draft);
  function field<K extends keyof Dish>(key: K, value: Dish[K]) {
    setD((prev) => ({ ...prev, [key]: value }));
  }
  return (
    <section className="dish-editor" aria-label="Dish editor">
      <label className="field-label">Name
        <input className="text-input" value={d.name} onChange={(e) => field("name", e.target.value)} />
      </label>
      <label className="field-label">Price (₹)
        <input
          className="text-input"
          type="number"
          min={0}
          step="0.5"
          value={d.price}
          onChange={(e) => field("price", Number(e.target.value) || 0)}
        />
      </label>
      <label className="field-label">Short description
        <input className="text-input" value={d.short_description} onChange={(e) => field("short_description", e.target.value)} />
      </label>
      <label className="field-label">Category
        <select
          className="text-input"
          value={d.categoryId}
          onChange={(e) => field("categoryId", e.target.value)}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <label className="field-label">Ingredients (comma-separated)
        <input className="text-input" value={d.ingredients.join(", ")} onChange={(e) => field("ingredients", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
      </label>
      <label className="field-label">Taste profile (comma-separated)
        <input className="text-input" value={d.taste_profile.join(", ")} onChange={(e) => field("taste_profile", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
      </label>
      <label className="field-label">Texture profile (comma-separated)
        <input className="text-input" value={d.texture_profile.join(", ")} onChange={(e) => field("texture_profile", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
      </label>
      <label className="field-label">Spice level: {SPICE_LABELS[d.spice_level]}
        <input type="range" min={0} max={5} step={1} value={d.spice_level} onChange={(e) => field("spice_level", Number(e.target.value) as Dish["spice_level"])} />
      </label>
      <label className="field-label">Dietary tags (comma-separated)
        <input className="text-input" value={d.dietary_tags.join(", ")} onChange={(e) => field("dietary_tags", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
      </label>
      <label className="field-label">Declared allergens (comma-separated)
        <input className="text-input" value={d.allergens.join(", ")} onChange={(e) => field("allergens", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
      </label>
      <label className="field-label">Portion note
        <input className="text-input" value={d.portion_note ?? ""} onChange={(e) => field("portion_note", e.target.value)} />
      </label>
      <label className="field-label" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={Boolean(d.is_special)}
          onChange={(e) => field("is_special", e.target.checked)}
        />
        ★ Chef&apos;s special (featured by the AI waiter)
      </label>
      <div className="sheet-actions">
        <button className="primary" onClick={() => onSave(d)}>Save dish</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

/* ---------------- Tables & QR ---------------- */

function TablesSection() {
  const restaurant = getRestaurant();
  const [, force] = useState(0);
  const [num, setNum] = useState("");
  return (
    <>
      <header className="app-header"><h1>Tables</h1><p>Each table gets its own QR code</p></header>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(num);
          if (Number.isInteger(n) && n > 0 && n < 1000) {
            addTable(n);
            setNum("");
            force((x) => x + 1);
          }
        }}
      >
        <input type="number" min={1} placeholder="New table number" value={num} onChange={(e) => setNum(e.target.value)} />
        <button type="submit">Add table</button>
      </form>
      <div className="menu-admin-list">
        {restaurant.tables.map((t) => (
          <div key={t.id} className="menu-admin-row">
            <div>
              <strong>Table {t.number}</strong>
              <span className="muted"> · {t.isActive ? "Active" : "Inactive"}</span>
            </div>
            <div className="sheet-actions">
              <button
                onClick={() => { setTableActive(t.id, !t.isActive); force((x) => x + 1); }}
              >
                {t.isActive ? "Deactivate" : "Activate"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function QrSection() {
  const restaurant = getRestaurant();
  const [tableId, setTableId] = useState<string>(restaurant.tables[0]?.id ?? "");
  const [qr, setQr] = useState<string>("");

  const table = restaurant.tables.find((t) => t.id === tableId);
  const url = `${location.origin}/r/${restaurant.slug}${table ? `/t/${table.number}` : ""}`;

  useEffect(() => {
    QRCode.toDataURL(url, { width: 260, margin: 2 }).then(setQr);
  }, [url]);

  return (
    <>
      <header className="app-header"><h1>QR Codes</h1><p>One QR per table — prints with the table number</p></header>
      <label className="field-label">
        Table
        <select className="text-input" value={tableId} onChange={(e) => setTableId(e.target.value)}>
          {restaurant.tables.map((t) => (
            <option key={t.id} value={t.id}>Table {t.number}</option>
          ))}
        </select>
      </label>
      <div className="qr-box">
        {qr ? (
          <>
            {table && <h3>Table {table.number}</h3>}
            <img src={qr} alt={`QR code for ${url}`} width={260} height={260} />
            <p><a href={qr} download={`table-${table?.number ?? "menu"}-qr.png`}>Download QR</a></p>
            <p className="muted" style={{ wordBreak: "break-all" }}>{url}</p>
          </>
        ) : (
          <p>Generating…</p>
        )}
      </div>
    </>
  );
}

/* ---------------- Payments ---------------- */

function PaymentsSection({ orders }: { orders: Order[] }) {
  const pending = orders.filter((o) => o.paymentStatus === "PAYMENT_PENDING" || o.paymentStatus === "UNPAID");

  return (
    <>
      <header className="app-header">
        <h1>Payments</h1>
        <p>Verify cash & UPI receipts — guests can never self-mark as paid</p>
      </header>
      {pending.length === 0 ? (
        <p>No payments waiting for verification.</p>
      ) : (
        <div className="menu-admin-list">
          {pending.map((o) => (
            <div key={o.id} className="menu-admin-row">
              <div>
                <strong>#{o.orderNumber}</strong>
                <span className="muted">
                  {" "}· {formatPrice("₹", o.total)} · {o.paymentMethod} · {o.paymentStatus.replace("_", " ")}
                </span>
              </div>
              <div className="sheet-actions">
                <button
                  className="primary"
                  onClick={() => void setOrderPaymentStatus(o.id, "PAID").catch(() => {})}
                >
                  Mark paid
                </button>
                <button
                  className="danger"
                  onClick={() => void setOrderPaymentStatus(o.id, "PAYMENT_FAILED").catch(() => {})}
                >
                  Not received
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------- Analytics ---------------- */

function AnalyticsSection({ orders }: { orders: Order[] }) {
  const a = useMemo(() => orderAnalytics(orders), [orders]);
  const restaurant = getRestaurant();

  return (
    <>
      <header className="app-header"><h1>Analytics</h1><p>Derived from real orders — no fake numbers</p></header>
      <div className="stats-row">
        <div className="stat-card"><span className="stat-num">{a.orderCount}</span><span className="stat-label">Orders</span></div>
        <div className="stat-card"><span className="stat-num">{formatPrice("₹", a.revenue)}</span><span className="stat-label">Revenue</span></div>
        <div className="stat-card"><span className="stat-num">{formatPrice("₹", Math.round(a.avgOrder))}</span><span className="stat-label">Avg order</span></div>
        <div className="stat-card"><span className="stat-num">{a.rejected}</span><span className="stat-label">Rejected</span></div>
      </div>
      <h4 className="section-title">Top dishes</h4>
      {a.topDishes.length === 0 ? (
        <p className="muted">No orders yet today.</p>
      ) : (
        <div className="totals">
          {a.topDishes.map((d, i) => (
            <div key={d.name} className="totals-row">
              <span>{i + 1}. {d.name}</span>
              <span>{d.count}</span>
            </div>
          ))}
        </div>
      )}
      <h4 className="section-title">Menu</h4>
      <p>
        {restaurant.dishes.filter((d) => d.published).length} published ·{" "}
        {restaurant.dishes.filter((d) => !d.is_available).length} unavailable
      </p>
    </>
  );
}

/* ---------------- Settings ---------------- */

function SettingsSection() {
  const state = menuStore.get();
  const [upiId, setUpiId] = useState(state.settings.upiId);
  const [upiName, setUpiName] = useState(state.settings.upiName);
  const [saved, setSaved] = useState(false);

  return (
    <>
      <header className="app-header">
        <h1>Settings</h1>
        <p>Restaurant profile for the pilot (auth + multi-tenant arrives with Supabase)</p>
      </header>
      <section className="dish-editor">
        <label className="field-label">UPI ID (for guest payments)
          <input className="text-input" value={upiId} onChange={(e) => { setUpiId(e.target.value); setSaved(false); }} />
        </label>
        <label className="field-label">Payee name
          <input className="text-input" value={upiName} onChange={(e) => { setUpiName(e.target.value); setSaved(false); }} />
        </label>
        <label className="field-label" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={state.settings.isOpen}
            onChange={(e) => updateSettings({ isOpen: e.target.checked })}
          />
          Restaurant is open (guests can browse when closed, but see a notice)
        </label>
        <div className="sheet-actions">
          <button
            className="primary"
            onClick={() => {
              updateSettings({ upiId: upiId.trim(), upiName: upiName.trim() });
              setSaved(true);
            }}
          >
            Save settings
          </button>
          {saved && <span className="muted">Saved ✓</span>}
        </div>
      </section>
      <p className="voice-hint">
        Data lives in this browser for the demo. The Supabase migration
        (supabase/migrations) matches this schema exactly for deployment.
      </p>
    </>
  );
}
