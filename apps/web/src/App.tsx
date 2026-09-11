import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { MenuPage } from "./pages/MenuPage";
import { CartPage } from "./pages/CartPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { OrderStatusPage } from "./pages/OrderStatusPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DishPage } from "./components/DishPage";
import {
  getRestaurantBySlug,
  getDish,
  useMenuVersion,
  isMenuLoaded,
  initRemoteMenu,
} from "./lib/menuSource";
import { isSupabaseConfigured } from "./lib/supabase";
import { initAuth, signIn, useSession } from "./lib/auth";

export default function App() {
  useMenuVersion();
  const [, setReady] = useState(false);

  useEffect(() => {
    if (isSupabaseConfigured()) {
      initAuth();
      initRemoteMenu();
    }
    setReady(true);
  }, []);

  if (isSupabaseConfigured() && !isMenuLoaded()) {
    return (
      <div className="not-found">
        <h1>TablePilot</h1>
        <p>Connecting to the restaurant…</p>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/r/:slug" element={<MenuPage />} />
        <Route path="/r/:slug/t/:table" element={<MenuPage />} />
        <Route path="/r/:slug/dish/:dishId" element={<DishRoute />} />
        <Route path="/r/:slug/cart" element={<CartPage />} />
        <Route path="/r/:slug/t/:table/cart" element={<CartPage />} />
        <Route path="/r/:slug/checkout" element={<CheckoutPage />} />
        <Route path="/r/:slug/t/:table/checkout" element={<CheckoutPage />} />
        <Route path="/r/:slug/order/:orderNumber" element={<OrderStatusPage />} />
        <Route path="/r/:slug/t/:table/order/:orderNumber" element={<OrderStatusPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<LoginStub setup />} />
        <Route
          path="*"
          element={
            <div className="not-found">
              <h1>Page not found</h1>
              <p>Please scan the restaurant QR code again or ask the staff for help.</p>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

function DishRoute() {
  useMenuVersion();
  const { slug, dishId } = useParams();
  const restaurant = getRestaurantBySlug(slug ?? "");
  const dish = restaurant ? getDish(restaurant, dishId ?? "") : null;
  if (!restaurant || !dish || !dish.published) {
    return (
      <div className="not-found">
        <h1>Dish not found</h1>
        <p>This dish may have been removed from the menu.</p>
      </div>
    );
  }
  return <DishPage restaurant={restaurant} dish={dish} tableNumber={null} />;
}

function LoginPage() {
  useMenuVersion();
  const session = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isSupabaseConfigured()) {
    return <LoginStub />;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <header className="app-header">
        <h1>Manager sign in</h1>
        <p>Access your restaurant's live dashboard</p>
      </header>
      <form className="dish-editor" onSubmit={submit} aria-label="Manager sign in">
        <label className="field-label">
          Email
          <input
            className="text-input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field-label">
          Password
          <input
            className="text-input"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <div className="safety-note" role="alert">
            {error}
          </div>
        )}
        <div className="sheet-actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
      {session && (
        <p>
          Signed in as {session.email}. <Link to="/dashboard">Open the dashboard →</Link>
        </p>
      )}
      <p className="voice-hint">
        Your data is protected by Row Level Security — only your restaurant's staff can
        see or change it.
      </p>
    </div>
  );
}

function LoginStub({ setup = false }: { setup?: boolean }) {
  return (
    <div className="not-found">
      <h1>{setup ? "Set up your restaurant" : "Manager sign in"}</h1>
      <p>
        Sign-in arrives with the Supabase phase. For the local pilot, the
        dashboard is open:
      </p>
      <p>
        <a href="/dashboard">Open the dashboard →</a>
      </p>
    </div>
  );
}

function Home() {
  useMenuVersion();
  return (
    <div className="not-found">
      <h1>TablePilot</h1>
      <p>
        Scan a restaurant QR code to open its menu, or explore the demo:
      </p>
      <p>
        <a href="/r/cedar-table">Demo menu</a> ·{" "}
        <a href="/r/cedar-table/t/7">Table 7 demo</a> ·{" "}
        <a href="/dashboard">Manager dashboard</a>
      </p>
    </div>
  );
}