import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Layers, Wand2, Package } from "lucide-react";
import { listMyProducts, type MyProduct } from "../lib/mcp";
import RefreshButton from "./RefreshButton";

const CACHE_KEY = "roastify:designs:v1";

export default function DesignsPage() {
  const cached = (() => {
    try {
      const r = window.localStorage.getItem(CACHE_KEY);
      return r ? (JSON.parse(r) as { at: number; products: MyProduct[] }) : null;
    } catch {
      return null;
    }
  })();

  const [products, setProducts] = useState<MyProduct[]>(cached?.products ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await listMyProducts({ limit: 50 });
      setProducts(r.products ?? []);
      setMore(Boolean(r.has_next_page));
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), products: r.products }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!cached) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5 flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Your designs</h1>
        <div className="ml-auto">
          <RefreshButton onClick={load} busy={loading} size="sm" />
        </div>
      </header>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}

      {loading && !products.length && (
        <p className="py-12 text-center text-sm text-stone-400 dark:text-zinc-500">Loading…</p>
      )}

      {!loading && !products.length && !error && (
        <div className="rounded-xl border border-dashed border-stone-300 py-12 text-center dark:border-zinc-700">
          <Layers className="mx-auto mb-2 h-8 w-8 text-stone-300 dark:text-zinc-700" />
          <p className="text-sm text-stone-500 dark:text-zinc-400">
            Designs you save in Roastify appear here.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <DesignCard key={p.id} product={p} />
        ))}
      </div>

      {more && (
        <p className="mt-4 text-center text-xs text-stone-400 dark:text-zinc-500">
          Showing the first 50.
        </p>
      )}
    </div>
  );
}

function DesignCard({ product }: { product: MyProduct }) {
  const v = product.variants ?? [];
  const price = v.length ? Math.min(...v.map((x) => x.retailPrice ?? 0)) : 0;
  const shot = product.images?.[0]?.url ?? product.imageUrl;

  return (
    <article className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {shot ? (
        <img src={shot} alt="" loading="lazy" className="h-40 w-full bg-stone-100 object-contain dark:bg-zinc-950" />
      ) : (
        <div className="grid h-40 w-full place-items-center bg-stone-100 dark:bg-zinc-950">
          <Package className="h-8 w-8 text-stone-300 dark:text-zinc-700" />
        </div>
      )}
      <div className="space-y-2 p-3">
        <h3 className="text-sm font-medium leading-snug">{product.title ?? product.id}</h3>
        <div className="flex items-center gap-x-3 text-xs text-stone-500 dark:text-zinc-400">
          {product.productType && <span>{product.productType}</span>}
          {price > 0 && <span className="tabular-nums">${(price / 100).toFixed(2)}</span>}
          {v.length > 0 && <span>{v.length} sizes</span>}
        </div>
        <Link
          to={`/bench?design=${encodeURIComponent(product.id)}`}
          title="Make new artwork from this design"
          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-2.5 py-1 text-sm transition-colors hover:bg-stone-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <Wand2 className="h-4 w-4" />
          Open
        </Link>
      </div>
    </article>
  );
}
