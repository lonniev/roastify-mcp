/**
 * Roastify's own tools, called through @tollbooth-dpyc/web.
 *
 * The client core is the package's: the one MCP connection, the npub/proof
 * envelope, the proof-bounce signal, identity storage and the standard tools
 * (service status, proofs, balance, top-up, payment, statement, coupons,
 * profile, patron credential fields). What stays here is Roastify's alone:
 * the catalog, the merchant's products, the design library, artwork, and the
 * courier conversation that carries the patron's Roastify key.
 */

import { callTool, getStoredNpub, getStoredProof } from "@tollbooth-dpyc/web";

// ─── Roastify catalog ────────────────────────────────────────────────────

export interface CatalogVariant {
  id?: string;
  title?: string;
  size?: string;
  sku?: string;
  retailPrice?: number; // cents, as upstream gives it
  inStock?: boolean;
  stockQty?: number;
  plan?: string;
}

export interface CatalogProduct {
  id: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  productType?: string;
  productCategory?: string;
  dielineTemplateUrl?: string;
  variants?: number;
  plan?: string;
}

export interface Blend {
  id: string;
  name?: string;
  description?: string;
  isDecaf?: boolean;
  roastLevel?: string;
}

export interface BrowseCatalogResult {
  success: boolean;
  products: CatalogProduct[];
  blends: Blend[];
  /** False when the blend leg failed — an empty list must not read as "none exist". */
  blends_available: boolean;
}

export async function browseCatalog(): Promise<BrowseCatalogResult> {
  return callTool<BrowseCatalogResult>("browse_catalog");
}

export interface CatalogProductDetail {
  success: boolean;
  product: CatalogProduct;
  variants: CatalogVariant[];
  variants_available: boolean;
}

export async function getCatalogProduct(productId: string): Promise<CatalogProductDetail> {
  return callTool<CatalogProductDetail>("get_catalog_product", { product_id: productId });
}

export interface BlendDetail {
  success: boolean;
  blend: Blend;
  variants: CatalogVariant[];
  variants_available: boolean;
}

export async function getBlend(blendId: string): Promise<BlendDetail> {
  return callTool<BlendDetail>("get_blend", { blend_id: blendId });
}

// ─── The merchant's own saved designs ────────────────────────────────────

export interface MyProduct {
  id: string;
  createdAt?: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  productType?: string;
  images?: { url: string }[];
  variants?: CatalogVariant[];
}

export interface ListMyProductsResult {
  success: boolean;
  products: MyProduct[];
  end_cursor?: string | null;
  has_next_page: boolean;
}

export async function listMyProducts(opts: { cursor?: string; limit?: number } = {}) {
  return callTool<ListMyProductsResult>("list_my_products", {
    cursor: opts.cursor ?? "",
    limit: opts.limit ?? 50,
  });
}

export async function getMyProduct(productId: string) {
  return callTool<{ success: boolean; product: MyProduct }>("get_my_product", {
    product_id: productId,
  });
}

// ─── Design library ──────────────────────────────────────────────────────
// The patron's own designs, held in the operator's Neon (npub-scoped). The
// courier stashes a product's design here; the Bench edits it; the courier
// fetches it back to write onto a product. Storage only — never touches
// Roastify. Mirrors the four server tools.

export interface StoredDesignMeta {
  design_id: string;
  label: string;
  product_id: string;
  source_title: string;
  bytes: number;
  updated_at?: string;
}

export interface FetchedDesign extends StoredDesignMeta {
  design: Record<string, unknown>;
}

export async function stashDesign(
  design: Record<string, unknown>,
  opts: { label?: string; productId?: string; sourceTitle?: string; designId?: string } = {},
) {
  return callTool<{
    success: boolean; design_id: string; bytes: number; assets: number; error?: string;
  }>("stash_design", {
    design,
    label: opts.label ?? "",
    product_id: opts.productId ?? "",
    source_title: opts.sourceTitle ?? "",
    design_id: opts.designId ?? "",
  });
}

export async function fetchDesign(designId: string) {
  return callTool<{ success: boolean; error?: string } & Partial<FetchedDesign>>(
    "fetch_design", { design_id: designId },
  );
}

export async function listDesigns() {
  return callTool<{
    success: boolean; count: number; designs: StoredDesignMeta[]; error?: string;
  }>("list_designs", {});
}

export async function deleteDesign(designId: string) {
  return callTool<{ success: boolean; deleted: boolean; design_id: string; error?: string }>(
    "delete_design", { design_id: designId },
  );
}

// ─── Artwork ─────────────────────────────────────────────────────────────

export interface ArtworkField {
  fieldId: string;
  type: "text" | "image";
  value: string;
}

export interface StartArtworkResult {
  success: boolean;
  job_id?: string;
  status?: string;
  error?: string;
}

export async function generateArtwork(args: {
  productId: string;
  fields: ArtworkField[];
  clientReqId?: string;
}): Promise<StartArtworkResult> {
  return callTool<StartArtworkResult>("generate_artwork", {
    product_id: args.productId,
    fields: args.fields,
    client_req_id: args.clientReqId ?? "",
  });
}

export interface ArtworkStatusResult {
  success: boolean;
  job_id?: string;
  status?: string;
  artwork_url?: string | null;
  error?: string | null;
}

export async function artworkStatus(jobId: string): Promise<ArtworkStatusResult> {
  return callTool<ArtworkStatusResult>("artwork_status", { job_id: jobId });
}

// ─── Patron credentials (the Roastify key) ───────────────────────────────

export interface OnboardingField {
  field: string;
  category?: string;
  status?: string;
  lifecycle?: string;
  how?: string;
}

export interface PatronOnboardingResult {
  ready: boolean;
  configured: OnboardingField[];
  missing: OnboardingField[];
  summary?: string;
  credential_service?: string;
}

export async function getPatronOnboardingStatus(): Promise<PatronOnboardingResult> {
  // Envelope-free: takes patron_npub + the cached phrase explicitly, like
  // check_proof_status. Sending the injected npub/dpop_token pair is rejected.
  return callTool<PatronOnboardingResult>("get_patron_onboarding_status", {
    patron_npub: getStoredNpub(),
    dpop_token: getStoredProof(),
  });
}

export interface RequestPatronCredentialsResult {
  success: boolean;
  dpop_token?: string;
  rendezvous_relay?: string;
  instructions?: string;
  message?: string;
}

export async function requestPatronCredentials(): Promise<RequestPatronCredentialsResult> {
  return callTool<RequestPatronCredentialsResult>("request_patron_credentials", {
    sender_npub: getStoredNpub(),
  });
}

export interface ReceivePatronCredentialsResult {
  success: boolean;
  stored_fields?: string[];
  still_missing_required?: string[];
  message?: string;
  error?: string;
}

export async function receivePatronCredentials(dpopToken: string) {
  return callTool<ReceivePatronCredentialsResult>("receive_patron_credentials", {
    sender_npub: getStoredNpub(),
    dpop_token: dpopToken,
  });
}
