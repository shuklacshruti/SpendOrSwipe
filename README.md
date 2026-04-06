# Spend or Swipe -- v3.0

A behavioral checkout intervention tool. Polished, reliable, slightly personalized.

---

## File Structure

```
spend-or-swipe/
├── manifest.json      # MV3 config, minimal permissions
├── content.js         # Detection, extraction, modal logic (v2)
├── modal.css          # Modal styles, Inter, semantic color tokens
├── popup.html         # Extension popup: settings + stats
├── popup.js           # Popup logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Install in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `spend-or-swipe/` folder
4. Pin the extension icon for quick settings access

**After any code edit:** click the ↻ refresh icon on the extension card, then reload your test page.

---

## Testing

### Real checkout pages

| Store | URL to test |
|-------|------------|
| Amazon | `amazon.com/gp/cart/view.html` |
| Shopify stores | Any `/cart` page |
| eBay | `ebay.com/cart` |
| Etsy | `etsy.com/cart` |
| Best Buy | `bestbuy.com/cart` |

### Quick console test
Open any page → DevTools console:
```js
// Simulate checkout URL (triggers SPA detection)
history.pushState({}, '', '/checkout');
```
Then wait ~1.5s for the debounced trigger.

### Inspect stored data
```js
chrome.storage.local.get(null, console.log)
```

---

## What Changed in v3

### Detection (more reliable)
- MutationObserver now waits for price elements to appear in the DOM before triggering, handles async/lazy-loaded checkout pages
- 1.5s debounce prevents double-triggers on SPA route changes
- `shouldTrigger()` checks for an existing overlay before firing
- URL patterns improved with boundary matching

### Price extraction (more accurate)
- 25+ targeted selectors covering Shopify, Amazon, WooCommerce, Magento, BigCommerce
- Scans last element (not first) per selector, grand totals are usually last
- Tighter value range (0.5–25000) to reduce false positives

### Personalization (no AI)
- Reads last 20 events to build context: triggers today, average spend, similar past amounts
- ±8% jitter on adjusted price so risk scores feel less mechanical
- Separate message pools per risk level (low / medium / high), no more generic lines on all pages
- Context line shown in modal when relevant ("You've triggered this 4 times today")

### Strict Mode
- Lowers thresholds: Medium risk at $20 (was $30), High risk at $75 (was $100)
- Stronger recommendation copy ("Strongly skip this")
- Orange badge shown in modal header when active

### Settings popup
- Click extension icon → settings + stats
- Hourly wage input (default $20, persisted)
- Strict Mode toggle (persisted)
- Live stats: total checks, estimated avoided spend, ignored count
- Insight banner with behavioral pattern detection
- Recent activity log (last 6 events)
- Data reset button

### UI
- Full design refresh: Inter font, consistent 8-point spacing
- Semantic color tokens, green/yellow/red applied to risk dot, badge, recommendation
- `all: revert` CSS reset prevents host-page style leakage
- Smoother animation: scale(0.95 → 1.0) + translateY with spring easing
- Wait screen uses green checkmark circle instead of emoji
- Friction bar uses indigo gradient

---

## Risk Thresholds

| Mode | Low | Medium | High |
|------|-----|--------|------|
| Normal | < $30 | $30–$100 | > $100 |
| Strict | < $20 | $20–$75 | > $75 |
