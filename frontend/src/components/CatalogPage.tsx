import { useEffect, useState } from "react";
import { Coffee, Package, Ruler, Search, Leaf } from "lucide-react";
import { browseCatalog, type BrowseCatalogResult, type Blend, type CatalogProduct } from "../lib/mcp";
import { RefreshButton, useLanguageLocale } from "@tollbooth-dpyc/web/react";
import { useT } from "../i18n";
import { refreshLook } from "../lib/look";

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

/** How long ago, in the reader's language ("5 min. ago", "il y a 5 min"). */
function ago(ms: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return rtf.format(0, "second");
  if (m < 60) return rtf.format(-m, "minute");
  const h = Math.round(m / 60);
  return h < 24 ? rtf.format(-h, "hour") : rtf.format(-Math.round(h / 24), "day");
}

export default function CatalogPage() {
  const t = useT();
  const locale = useLanguageLocale();
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
    <div className="mx-auto max-w-[90rem] px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t("views.catalog.title")}</h1>
        {fetchedAt && (
          <span className="text-xs text-stone-400 dark:text-zinc-500">{t("views.catalog.updated", { when: ago(fetchedAt, locale) })}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("views.catalog.filter")}
              aria-label={t("views.catalog.filterLabel")}
              className="w-40 rounded-lg border border-stone-200 bg-white py-1.5 pl-8 pr-2 text-sm outline-none focus:border-amber-400 dark:border-zinc-800 dark:bg-zinc-900 sm:w-56"
            />
          </label>
          <RefreshButton onRefresh={load} busy={loading} iconSize={24} classNames={refreshLook.toolbar} />
        </div>
      </header>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}
      {loading && !data && (
        <p className="py-12 text-center text-sm text-stone-400 dark:text-zinc-500">{t("ui.app.loading")}</p>
      )}
      {data && (
        <>
          {blends.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-zinc-500">
                {t("views.catalog.coffees")}
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
              {t("views.catalog.packaging")}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
            {needle && !shown.length && (
              <p className="py-8 text-center text-sm text-stone-400 dark:text-zinc-500">
                {t("views.catalog.noMatch", { q })}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function BlendChip({ blend }: { blend: Blend }) {
  const t = useT();
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
        <Leaf className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-label={t("views.catalog.decaf")} />
      )}
    </span>
  );
}

function ProductCard({ product }: { product: CatalogProduct }) {
  const t = useT();
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
              title={t("views.catalog.plan", { plan: titleCase(product.plan) })}
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
            <span className="inline-flex items-center gap-1" title={t("views.catalog.variants")}>
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
