# Business context — Euro Digital

Last checked: 29/10/2026, against the files of the existing project (read only, never modified).
Every statement below names its source. Anything not found there is marked **to confirm** and
must not appear in generated content until the owner confirms it.

Sources (paths are relative to `E:\Euro Digital\`):

| Ref | File |
|---|---|
| S1 | `euro-digital web e-commerce/README.md` |
| S2 | `euro-digital web e-commerce/messages/fr.json`, `messages/ar.json` (site texts) |
| S3 | `euroDigital/README.md` (backend, branch `euro-digital-main`) |
| S4 | `euro-digital web e-commerce/OWNER_INPUTS_CHECKLIST.md` |
| S5 | `euro-digital web e-commerce/docs/FEATURE_STATUS.md` |
| S6 | `euroDigital/docs/external-import/FORMAT.md`, `euroDigital/config/product_specs.php` |

## Business

Euro Digital sells computers and electronics in **Morocco** (S2 site title "informatique et
électronique au Maroc"; S3 "single Moroccan supplier — Euro Digital (electronics and IT products)";
currency MAD). It runs one backend for a website, a back office and mobile apps (S1, S3).

- **Retail**: public prices including VAT (TTC), **cash on delivery** (S1, S2 "Paiement à la livraison").
- **Professionals**: quotation requests for quantities (S1 "wholesale customers request a quotation";
  S2 "devis pour les professionnels"; S5 multi-product quotations, `/entreprises` page).
- Orders can be placed without an account, with the phone verified by SMS (S5; the owner has not yet
  confirmed this policy, S4).

## Product categories

From the site description (S2) and the characteristics templates of the backend (S6):
laptops ("ordinateurs portables"), desktop PCs, components, monitors, storage, networking,
peripherals and accessories, chargers, printers, servers.

First catalogue file received (S4, S5): **43 business laptops (HP, Dell, Lenovo)**, imported as
**drafts**. The file has **no prices, stock, condition, warranty or keyboard layout**; 6 rows have
uncertain model names and 4 rows are empty (S4 §1). Until the owner sends them, none of these
values may be stated.

## Customers

Verified segments: retail buyers ordering online with cash on delivery; companies, schools and
administrations asking for quotes on several products (S1, S2, S5 `/entreprises`).

Not verified (do not target or describe as facts until confirmed): students, gamers, specific
cities, age groups, income levels.

## Positioning and tone

What the site promises, word for word (S2, French site):
- "Prix publics TTC, paiement à la livraison, devis pour les professionnels."
- "En espèces, à la réception." · "Frais affichés dans le panier avant de commander." ·
  "Prix pour vos quantités, sur demande." · "Chaque étape dans votre espace client."

Tone of the existing site: plain, factual, short sentences; no exaggeration; every claim is
something the shop really does (S1 design principles: "never a simulated success"; S5 "never a fake
timer"). Visual direction: compact, product-first technology store in the spirit of nextlevelpc.ma
and ultrapc.ma (S1). **No brand charter, logo or brand colours yet** (S4 §2): to confirm.

## Customer pain points

The only documented analysis is the improvement plan written for the owner (competitor review of
nextlevelpc.ma and ultrapc.ma, not customer research). It points to: buyers need the condition and
warranty of a computer stated; delivery cost known before ordering; ordering without creating an
account; confirming by WhatsApp; comparing models by real specifications. Treat these as
**hypotheses to test**, not as quotes from customers.

## Marketing objectives

Documented in the improvement plan (Phase 3, growth): visits that reach product pages, orders, and
conversion by source and language; Arabic content as an opportunity (neither main competitor has an
Arabic site); guides for choosing a laptop; short videos of real stock. Concrete targets (followers,
sales) are **to confirm** with the owner.

## Languages

Arabic (default on the site, right-to-left) and French (S1, S2, S3). Instagram content should be
written in **French or Arabic**, chosen per post. English is used only for this application's
interface. Moroccan Darija is **not** used on the site: to confirm before using it in posts.

## Product and price data

Source of truth: the backend's public catalogue API (read only; this app never writes to it):

| Endpoint (base `ECOMMERCE_API_URL`, e.g. `http://192.168.1.7:8010/api/v1`) | Gives |
|---|---|
| `GET merchant/products?search=&per_page=` | Active products: name, SKU, price **HT** and `tax_rate`, old price, stock flag, condition, warranty, keyboard, brand, image |
| `GET merchant/products/{id}` | One product: description, images, technical characteristics, manufacturer media |
| `GET merchant/home?channel=web` | Banners, running flash sales with real end dates |

Rules this app follows:
- A price shown in a post is the API price **TTC** (`price × (1 + tax_rate/100)`), fetched when the
  draft is created and **re-checked before publishing**; if it changed, the draft needs re-approval.
- Inactive or draft products (such as the 43 laptops above) are not returned by the API, so they
  cannot be promoted by mistake.
- No product data is copied into this application's database except a snapshot stored with the
  draft that used it (for traceability).

## Content restrictions (always)

Never invent or guess: prices, discounts, stock, condition, warranty, delivery times or fees,
specifications, sales figures, customer reviews or testimonials, awards, partnerships. A value that
is not in the API data or in the voice profile comes back as `{{to confirm: …}}` and blocks approval.
No competitor named in posts unless the owner decides it. No claims about being "the cheapest" or
"the best" without proof. Respect the 5-hashtag limit checked by `ig-caption`.

## To confirm with the owner

Instagram handle and account type (must be Professional: Business or Creator); brand charter, logo,
colours; voice (three example captions or reels); WhatsApp number and keyword CTA; website domain;
target audiences and objectives; whether Darija is used; which products to promote first; any
topics that are off limits.
