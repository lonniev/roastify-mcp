
## What to tell a person about Roastify Design Bench

Roastify Design Bench is for a coffee merchant who sells their own line through Roastify.
It keeps every word printed on their packaging in one place, and turns a template they already made into new print-ready artwork.

What a merchant gets:

- **Their catalog at a glance.** Every base coffee and box, with roast level, sizes and stock.
- **Their designs, laid out to scale.** Each saved design shows every panel it prints across.
- **New artwork from words.** Change the text on a template and get print-ready artwork back.
- **A design library they own.** Designs are kept, with their history, in a GitHub repository in the merchant's own name.
- **No login.** They sign in with a Nostr key and bring their own Roastify key, which arrives by encrypted message and is stored encrypted.

A good one-line pitch: *"Your coffee line, and every word printed on it: new packaging artwork from the templates you already made."*

## For agents

Roastify Design Bench is a single-page web app backed by roastify-mcp, a Model
Context Protocol server. Humans use the web UI; AI agents call the same MCP
tools, and the server's own instructions describe how a branded variant is made.

## Bring your own Roastify key

Every person connects their own Roastify account. Roastify scopes the catalog, a
merchant's saved designs, and plan tier to the account behind the API key, so
this service holds no key of its own — a shared key would return one merchant's
catalog to everyone. Keys arrive as an encrypted Nostr direct message and are
stored encrypted; the browser never sees one.

## What it does

- **Catalog** — the coffees and packaging available to your account, with roast
  level, sizes, and stock.
- **Designs** — the products you have already saved in Roastify.
- **Bench** — change the named text on one of your designs and get print-ready
  artwork back.
- **Library** — a private, versioned store of designs in a GitHub repository the
  merchant owns. A small courier the merchant runs on Roastify's Merchant App
  carries a design into the library and a finished one back onto a product,
  since only the merchant's own session may do either.

## What it does not do

- It cannot create, update, delete, or sync products. Roastify's API has no such
  endpoints; saved products and storefront sync are Merchant App capabilities.
- It does not place orders. That is left to Roastify and the merchant's store.
- Artwork generation personalizes a template a human authored in Design Studio.
  It cannot author a design from scratch, and the artwork it returns is not
  attached to a product.

## Reading a design

Roastify identifies an editable layer by the name a person typed in Design
Studio, and publishes no way to ask which names a design has. The Bench answers
that in the browser: you open the design's exported .json and it lists the named
layers, shows where each one prints on the unfolded box, and flags any value
that prints in more than one place. The file is never uploaded.
