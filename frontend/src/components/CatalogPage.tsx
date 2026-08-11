import { useEffect, useState } from "react";
import { Coffee, Package, Ruler, Search, Leaf } from "lucide-react";
import { browseCatalog, type BrowseCatalogResult, type Blend, type CatalogProduct } from "../lib/mcp";
import RefreshButton from "./RefreshButton";

const CACHE_KEY = "roastify:catalog:v1";

interface Cached {
  at: number;
  data: BrowseCatalogResult;
}

function readCache(): Cached | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}

function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export default function CatalogPage() {
  const cached = readCache();
  const [data, setData] = useState<BrowseCatalogResult | null>(cached?.data ?? null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(cached?.at ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await browseCatalog();
      setData(r);
      setFetchedAt(Date.now());
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: r }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Show what we have instantly; only reach out when there is nothing to show.
  useEffect(() => {
    if (!cached) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const products = data?.products ?? [];
  const blends = data?.blends ?? [];
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? products.filter((p) =>
        `${p.title ?? ""} ${p.description ?? ""} ${p.productType ?? ""}`.toLowerCase().includes(needle),
      )
    : products;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Catalog</h1>
        {fetchedAt && (
          <span className="text-xs text-stone-400 dark:text-zinc-500">Updated {ago(fetchedAt)}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter"
              aria-label="Filter the catalog"
              className="w-40 rounded-lg border border-stone-200 bg-white py-1.5 pl-8 pr-2 text-sm outline-none focus:border-amber-400 dark:border-zinc-800 dark:bg-zinc-900 sm:w-56"
            />
          </label>
          <RefreshButton onClick={load} busy={loading} />
        </div>
      </header>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}
      {loading && !data && (
        <p className="py-12 text-center text-sm text-stone-400 dark:text-zinc-500">Loading…</p>
      )}
      {data && (
        <>
          {blends.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-zinc-500">
                Coffees
              </h2>
              <div className="flex flex-wrap gap-2">
                {blends.map((b) => (
                  <BlendChip key={b.id} blend={b} />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-zinc-500">
              Packaging
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
            {needle && !shown.length && (
              <p className="py-8 text-center text-sm text-stone-400 dark:text-zinc-500">
                Nothing matches “{q}”.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function BlendChip({ blend }: { blend: Blend }) {
  return (
    <span
      title={blend.description || blend.name}
      className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <Coffee className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
      <span>{blend.name ?? blend.id}</span>
      {blend.roastLevel && (
        <span className="text-xs text-stone-400 dark:text-zinc-500">{titleCase(blend.roastLevel)}</span>
      )}
      {blend.isDecaf && (
        <Leaf className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-label="Decaf" />
      )}
    </span>
  );
}

function ProductCard({ product }: { product: CatalogProduct }) {
  return (
    <article className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt=""
          loading="lazy"
          className="h-36 w-full bg-stone-100 object-contain dark:bg-zinc-950"
        />
      ) : (
        <div className="grid h-36 w-full place-items-center bg-stone-100 dark:bg-zinc-950">
          <Package className="h-8 w-8 text-stone-300 dark:text-zinc-700" />
        </div>
      )}
      <div className="space-y-1.5 p-3">
        <div className="flex items-start gap-2">
          <h3 className="flex-1 text-sm font-medium leading-snug">{product.title ?? product.id}</h3>
          {product.plan && (
            <span
              title={`Included with the ${titleCase(product.plan)} plan`}
              className="rounded border border-stone-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-stone-500 dark:border-zinc-700 dark:text-zinc-400"
            >
              {product.plan}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-zinc-400">
          {product.productType && (
            <span className="inline-flex items-center gap-1">
              <Package className="h-3.5 w-3.5" />
              {product.productType}
            </span>
          )}
          {typeof product.variants === "number" && product.variants > 0 && (
            <span className="inline-flex items-center gap-1" title="Sizes and grinds available">
              <Ruler className="h-3.5 w-3.5" />
              {product.variants}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
