# Spend or Swipe

A Chrome extension that interrupts you at checkout and asks one question: *do you actually need this?*

Built as a behavioral experiment — the goal isn't to stop you from spending, it's to create a moment of friction that makes the decision conscious rather than automatic.

![Version](https://img.shields.io/badge/version-2.0.0-black) ![Manifest](https://img.shields.io/badge/manifest-v3-black) ![License](https://img.shields.io/badge/license-MIT-black)

---

## What it does

When you land on a checkout or cart page, a modal appears before you can complete the purchase. It:

- Detects checkout pages automatically (URL patterns + DOM signals)
- Extracts the cart total from the page, or lets you enter it manually
- Converts the price into hours of work at your configured hourly rate
- Assigns a **Regret Risk** score (Low / Medium / High) based on price
- Disables action buttons for 2 seconds — the psychological core of the experiment
- Tracks your decisions locally so you can see patterns over time

Everything runs locally. No accounts, no backend, no data leaves your machine.

---

## Screenshots

> _Add screenshots here once installed — the modal, the popup panel, and the wait screen are the three main views worth capturing._

---

## Install locally

No build step. No dependencies. Just load the folder directly into Chrome.

**1. Clone the repo**
```bash
git clone https://github.com/YOUR_USERNAME/spend-or-swipe.git
```

**2. Open Chrome extensions**

Go to `chrome://extensions` in your browser.

**3. Enable Developer Mode**

Toggle the switch in the top-right corner of the extensions page.

**4. Load the extension**

Click **"Load unpacked"** and select the `spend-or-swipe` folder you just cloned.

**5. Pin it (optional but recommended)**

Click the puzzle piece icon in your Chrome toolbar → pin Spend or Swipe for quick access to settings.

That's it. Visit any checkout page and the modal will appear.

---

## How to use

**The modal** appears automatically on checkout/cart pages. You'll see:

- The cart total + how many hours of work it represents
- A regret risk score and recommendation
- Three choices: **Wait 48 Hours**, **Continue Anyway**, or **Dismiss**

The buttons are intentionally disabled for 2 seconds when the modal opens. That pause is the whole point.

**The settings panel** opens when you click the extension icon in your toolbar:

- Set your **hourly wage** (default $20) to personalize the time-cost calculation
- Toggle **Strict Mode** to lower risk thresholds and get more assertive recommendations
- View your **stats** — total checks, estimated avoided spend, how many warnings you've ignored
- See your **recent activity** log

---

## Settings

| Setting | Default | Description |
|---|---|---|
| Hourly wage | $20/hr | Used to calculate how many hours of work a purchase costs |
| Strict Mode | Off | Lowers risk thresholds. Medium risk triggers at $20 (vs $30), High at $75 (vs $100) |

---

## Risk thresholds

| | Normal Mode | Strict Mode |
|---|---|---|
| 🟢 Low — "Go ahead" | Under $30 | Under $20 |
| 🟡 Medium — "Wait 48 hours" | $30–$100 | $20–$75 |
| 🔴 High — "Skip this" | Over $100 | Over $75 |

---

## Testing it

The extension works on real stores — add something to your cart and head to checkout. A few reliable ones to test on:

| Store | URL |
|---|---|
| Amazon | `amazon.com/gp/cart/view.html` |
| Etsy | `etsy.com/cart` |
| eBay | `ebay.com/cart` |
| Any Shopify store | `/cart` on any Shopify storefront |

You can also trigger it manually in the browser console on any page:
```js
history.pushState({}, '', '/checkout');
```
Then wait about 1.5 seconds.

To inspect stored data at any time:
```js
chrome.storage.local.get(null, console.log)
```

---

## Project structure

```
spend-or-swipe/
├── manifest.json    # Chrome Extension Manifest V3 config
├── content.js       # Injected into pages — detection, price extraction, modal
├── modal.css        # All modal styles (scoped, won't affect host pages)
├── popup.html       # Extension popup UI — settings + behavioral stats
├── popup.js         # Popup logic — reads/writes chrome.storage.local
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## How it works

**Checkout detection** uses two signals in combination: URL pattern matching (`/checkout`, `/cart`, `/payment`, etc.) and DOM text signals (e.g. "Place Order", "Billing Address"). A `MutationObserver` waits for dynamic content to finish rendering before triggering — this handles SPAs and lazy-loaded checkout flows reliably. A 1.5s debounce prevents duplicate triggers on fast navigations.

**Price extraction** tries 25+ CSS selectors targeting common e-commerce platforms (Shopify, Amazon, WooCommerce, Magento, BigCommerce) before falling back to regex scanning the page body. It deliberately reads the *last* matching element per selector, since grand totals are almost always rendered after line items.

**Personalization without AI** — the extension reads your last 20 events from local storage and surfaces a context line when relevant ("You've triggered this 4 times today", "This is above your recent average of $45"). A ±8% jitter on the effective price means risk scores feel less mechanical over repeated use.

**All storage is local.** `chrome.storage.local` holds up to 20 events and your settings. Nothing is ever sent anywhere.

---

## Permissions

```json
"permissions": ["activeTab", "scripting", "storage"]
```

That's the full list. No broad host access, no network requests, no tracking.

---

## Why I built this

Most spending tools try to analyze your budget after the fact. This is an experiment in the opposite direction — intervening at the exact moment of decision rather than reviewing it later.

The 2-second friction delay is the core hypothesis: does forced hesitation change behavior? Even a brief pause converts an automatic action into a deliberate one. That shift — automatic → deliberate — is where behavior change actually happens.

This is a behavioral MVP, not a polished product. The goal was to test one thing cleanly.

---

## Reload after editing

1. Go to `chrome://extensions`
2. Click the **↻ refresh** icon on the Spend or Swipe card
3. Reload your test page

---

## License

MIT — use it, fork it, build on it.
