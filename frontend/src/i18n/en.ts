/**
 * Every word the Design Bench's own pages say, in English: the bedrock the
 * other languages translate.
 *
 * Keys are "<area>.<file>.<name>" (areas: ui, views). A `{{name}}` is filled
 * with a word or number; a `<name/>` or `<name>…</name>` is drawn as an
 * element. A translation keeps each one exactly as written and may move it.
 * Roastify, Design Bench, Design Studio, Roastify MCP, Nostr, npub, Lightning,
 * Shopify, product and coffee names, and the ™ marks stay as they are.
 */

export const en = {
  // ─── ui: the frame, the top bar and the footer ───
  "ui.app.welcome": "Your coffee line, and every word printed on it. Catalog, designs and artwork stay with your key.",
  "ui.app.loading": "Loading…",
  "ui.app.monetized": "Monetized with <dpyc>Tollbooth DPYC™</dpyc> · Apache-2.0 · Patent Pending (US Prov. 64/045,999)",
  "ui.nav.catalog": "Catalog",
  "ui.nav.designs": "Designs",
  "ui.nav.bench": "Bench",
  "ui.nav.wallet": "Wallet",
  "ui.nav.profile": "Profile & theme",

  // ─── views: the landing hero, for visitors not signed in ───
  "views.hero.tagline": "Coffee packaging, curated",
  "views.hero.title": "Your coffee line, and every word printed on it.",
  "views.hero.lede": "Browse the Roastify catalog, open your saved designs, and generate new packaging artwork from a template you already made — through <mcp>Roastify MCP</mcp>.",
  "views.hero.key": "Bring your own Roastify key. Sign in with a Nostr key — your catalog, your designs, and your artwork stay with your npub, not a login.",
  "views.hero.catalog.title": "The catalog",
  "views.hero.catalog.body": "Every base coffee and box, with roast level, sizes, and what is in stock.",
  "views.hero.designs.title": "Your designs",
  "views.hero.designs.body": "Open a saved design and see every panel it prints across, laid out to scale.",
  "views.hero.artwork.title": "New artwork",
  "views.hero.artwork.body": "Change the words on a template and get print-ready artwork back.",
  "views.hero.powered": "Powered by <dpyc>Tollbooth DPYC™</dpyc> — operator-controlled dynamic pricing at the MCP layer.",

  // ─── views: Catalog ───
  "views.catalog.title": "Catalog",
  "views.catalog.updated": "Updated {{when}}",
  "views.catalog.filter": "Filter",
  "views.catalog.filterLabel": "Filter the catalog",
  "views.catalog.coffees": "Coffees",
  "views.catalog.packaging": "Packaging",
  "views.catalog.noMatch": "Nothing matches “{{q}}”.",
  "views.catalog.decaf": "Decaf",
  "views.catalog.plan": "Included with the {{plan}} plan",
  "views.catalog.variants": "Sizes and grinds available",

  // ─── views: Designs ───
  "views.designs.title": "Your designs",
  "views.designs.empty": "Designs you save in Roastify appear here.",
  "views.designs.first50": "Showing the first 50.",
  "views.designs.sizes_one": "{{count}} size",
  "views.designs.sizes_other": "{{count}} sizes",
  "views.designs.openTitle": "Make new artwork from this design",
  "views.designs.open": "Open",

  // ─── views: Bench ───
  "views.bench.title": "Bench",
  "views.bench.which": "Which design",
  "views.bench.choose": "Choose a design…",
  "views.bench.fileTitle": "Read the design file so its editable text can be listed",
  "views.bench.changeFile": "Change file",
  "views.bench.openFile": "Open design file",
  "views.bench.noText": "That file has no text on it — is it a Design Studio export?",
  "views.bench.unreadable": "That file could not be read as a design.",
  "views.bench.pickDesign": "Choose which design to make artwork from.",
  "views.bench.changeFirst": "Change something first.",
  "views.bench.notStarted": "It could not be started.",
  "views.bench.endedAs": "Ended as {{status}}.",
  "views.bench.openHint": "Open your design file to see what you can change.",
  "views.bench.exportHint": "In Roastify’s designer: File → Export → Project .json. It stays on this device.",
  "views.bench.repeated_one": "“{{text}}” prints in {{count}} place.",
  "views.bench.repeated_other": "“{{text}}” prints in {{count}} places.",
  "views.bench.repeatedOn_one": "“{{text}}” prints in {{count}} place: {{panels}}.",
  "views.bench.repeatedOn_other": "“{{text}}” prints in {{count}} places: {{panels}}.",
  "views.bench.says": "What it says",
  "views.bench.nothing": "Nothing on this design can be changed from here yet.",
  "views.bench.nameLayer": "Name a layer in Roastify’s designer and it becomes editable here.",
  "views.bench.alsoPrints_one": "Also prints in {{count}} other place",
  "views.bench.alsoPrints_other": "Also prints in {{count}} other places",
  "views.bench.make": "Make artwork",
  "views.bench.making": "Making it…",
  "views.bench.ready": "Artwork ready",
  "views.panelMap.label": "Where each piece of text prints on the unfolded box",
  "views.panelMap.unnamed": "unnamed",

  // ─── views: Profile ───
  "views.profile.account.heading": "Your Roastify account",
  "views.profile.account.connected": "Your catalog and designs are the ones in your own Roastify account.",
  "views.profile.account.invite": "Connect your Roastify account to see your catalog and your saved designs.",
  "views.profile.account.getKey": "Get a key",
  "views.profile.account.getKeyTitle": "Where your Roastify API key is created",
  "views.profile.language.heading": "Language",
  "views.profile.timezone.heading": "Display timezone",
  "views.profile.timezone.intro": "Dates on your Wallet — top-ups and when credits expire — and the debug log's times use this zone. Saved on this device.",
  "views.profile.timezone.label": "Zone",
  "views.profile.timezone.auto": "Auto (browser) — {{zone}}",
  "views.profile.timezone.resolving": "Currently resolving to {{zone}}.",
  "views.profile.timezone.using": "Using {{zone}}. Past dates keep the offset that applied at the time.",
  "views.profile.theme.intro": "Roastify defaults to dark. Your choice is saved on this device.",
  "views.profile.theme.dark": "Dark",
  "views.profile.theme.darkHint": "Default",
  "views.profile.theme.light": "Light",
  "views.profile.theme.system": "System",
  "views.profile.theme.systemHint": "Match OS",
  "views.profile.build": "Roastify and Tollbooth-DPYC<tm>™</tm> ship as open source under the Apache License 2.0 — anyone can read the code, fork it, run their own operator. The <i>services</i> on top are private commerce: each operator sets their own tolls; patrons pre-fund a Lightning balance and pay per call. The protocol is shared; the businesses on it are not.",
};

/** A key as written in the catalog, plural suffix and all. */
export type EnglishKey = keyof typeof en;
type StripPlural<K> = K extends `${infer Base}_${"zero" | "one" | "two" | "few" | "many" | "other"}` ? Base : K;
/** A key as code asks for it: `x` stands for `x_one` / `x_other`, read with `{ count }`. */
export type MessageKey = StripPlural<EnglishKey>;
export type Messages = Record<EnglishKey, string>;
type PluralBase = EnglishKey extends infer K ? (K extends `${infer Base}_other` ? Base : never) : never;
/** One language's words: English's keys, plus the plural forms that language has beyond English's two. */
export type Translation = Partial<Messages> & Partial<Record<`${PluralBase}_${"zero" | "two" | "few" | "many"}`, string>>;

export default en as Messages;
