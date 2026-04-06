(() => {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────────────
  const FRICTION_DELAY_MS = 2000;
  const MAX_EVENTS = 20;
  const DEBOUNCE_MS = 1500;

  const CHECKOUT_URL_PATTERNS = [
    /[\/\?&]checkout/i, /[\/\?&]cart/i, /[\/\?&]basket/i,
    /[\/\?&]payment/i, /[\/\?&]order[\/\?]/i, /[\/\?&]purchase/i,
    /[\/\?&]pay[\/\?$]/i, /\/buy\//i, /step=(payment|review|billing)/i
  ];

  const CHECKOUT_PAGE_SIGNALS = [
    /place\s+order/i, /complete\s+purchase/i, /proceed\s+to\s+checkout/i,
    /review\s+(your\s+)?order/i, /order\s+summary/i, /payment\s+method/i,
    /billing\s+address/i, /secure\s+checkout/i, /confirm\s+(your\s+)?order/i,
    /cvv|card\s+number|expir(y|ation)/i
  ];

  // Messaging pools — varied per risk level
  const MESSAGES = {
    low: [
      "Small purchases add up over time.",
      "Is this in your budget this week?",
      "Quick check before you tap confirm.",
    ],
    medium: [
      "Will this matter in a week?",
      "Impulse buys like this are often regretted.",
      "Your future self will remember this decision.",
      "Most people don't use what they buy impulsively.",
    ],
    high: [
      "This is a significant purchase. Sleep on it.",
      "High-ticket items benefit most from a waiting period.",
      "Your biggest regrets are usually your fastest decisions.",
      "Is this a need, or a want dressed up as a need?",
    ],
  };

  // Context messages (injected from purchase history)
  const CONTEXT_TEMPLATES = {
    highFrequency: "You've triggered this {n} times today.",
    aboveAverage: "This is above your recent average of {avg}.",
    repeat: "You've analyzed similar amounts recently.",
    firstTime: "First time using Spend or Swipe today.",
  };

  // ─── State ───────────────────────────────────────────────────────────────────
  let hasTriggered = false;
  let domObserver = null;
  let debounceTimer = null;

  // ─── Settings Helpers ─────────────────────────────────────────────────────────
  function getSettings(cb) {
    chrome.storage.local.get(['settings'], (r) => {
      cb(Object.assign({ hourlyRate: 20, strictMode: false }, r.settings || {}));
    });
  }

  // ─── Storage ──────────────────────────────────────────────────────────────────
  function logEvent(price, action) {
    chrome.storage.local.get(['events'], (r) => {
      const events = r.events || [];
      events.unshift({ timestamp: Date.now(), price, action });
      if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
      chrome.storage.local.set({ events });
    });
  }

  function getPurchaseContext(price, cb) {
    chrome.storage.local.get(['events'], (r) => {
      const events = r.events || [];
      const today = Date.now() - 86400000;
      const todayEvents = events.filter(e => e.timestamp > today);
      const triggerCount = todayEvents.length;

      const pastPrices = events.slice(0, 10).map(e => e.price).filter(Boolean);
      const avgPrice = pastPrices.length
        ? pastPrices.reduce((a, b) => a + b, 0) / pastPrices.length
        : null;

      let contextLine = null;
      // Add ±8% jitter so scores feel less mechanical
      const jitter = 1 + (Math.random() * 0.16 - 0.08);
      const adjustedPrice = price * jitter;

      if (triggerCount >= 3) {
        contextLine = CONTEXT_TEMPLATES.highFrequency.replace('{n}', triggerCount);
      } else if (avgPrice && adjustedPrice > avgPrice * 1.3) {
        contextLine = CONTEXT_TEMPLATES.aboveAverage.replace(
          '{avg}', avgPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
        );
      } else if (pastPrices.length >= 2 && pastPrices.some(p => Math.abs(p - price) < price * 0.2)) {
        contextLine = CONTEXT_TEMPLATES.repeat;
      } else if (triggerCount === 0) {
        contextLine = null; // Don't show "first time" — that's noise
      }

      cb({ triggerCount, avgPrice, contextLine, adjustedPrice });
    });
  }

  // ─── Checkout Detection ───────────────────────────────────────────────────────
  function isCheckoutUrl() {
    const url = window.location.href;
    return CHECKOUT_URL_PATTERNS.some(p => p.test(url));
  }

  function countPageSignals() {
    const text = document.body?.innerText || '';
    return CHECKOUT_PAGE_SIGNALS.filter(p => p.test(text)).length;
  }

  function hasPriceInDom() {
    // Check whether any currency-formatted number is visible in the DOM
    const priceRegex = /\$\s*[\d,]+\.?\d{0,2}/;
    const selectors = [
      '[class*="total"]', '[class*="price"]', '[class*="amount"]',
      '[class*="summary"]', '[id*="total"]', '[id*="price"]'
    ];
    for (const sel of selectors) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (priceRegex.test(el.innerText)) return true;
        }
      } catch (_) {}
    }
    return false;
  }

  function shouldTrigger() {
    if (hasTriggered) return false;
    if (document.getElementById('sos-overlay')) return false;
    const urlMatch = isCheckoutUrl();
    const signalCount = countPageSignals();
    const priceVisible = hasPriceInDom();
    // Trigger if: URL match, OR 2+ text signals + a price is visible
    return urlMatch || (signalCount >= 2 && priceVisible);
  }

  // ─── Price Extraction ─────────────────────────────────────────────────────────
  function extractPrice() {
    const selectors = [
      // Explicit total selectors first (most reliable)
      '[data-testid*="grand-total"]', '[data-testid*="order-total"]',
      '[data-testid*="cart-total"]', '[data-testid*="checkout-total"]',
      '[class*="grand-total"]', '[class*="order-total"]', '[class*="cart-total"]',
      '[class*="checkout-total"]', '[class*="total-price"]', '[class*="summary-total"]',
      '[class*="order-summary__total"]', '[class*="payment-due"]',
      '[id*="grand-total"]', '[id*="order-total"]', '[id*="cart-total"]',
      '[data-automation*="total"]', '[aria-label*="total" i]',
      // Common platform patterns
      '.order-summary__total-recap', '.cart-subtotal__price',
      '#checkout-subtotal', '.payment-due__price',
      '[data-bind*="grandTotal"]', '.grand-total .price',
    ];

    const priceRx = /\$\s*([\d,]+\.?\d{0,2})/;

    for (const sel of selectors) {
      try {
        const els = document.querySelectorAll(sel);
        // Take the LAST match (most likely to be the grand total, not a line item)
        for (let i = els.length - 1; i >= 0; i--) {
          const text = els[i].innerText || els[i].textContent || '';
          const match = text.match(priceRx);
          if (match) {
            const val = parseFloat(match[1].replace(/,/g, ''));
            if (val > 0.5 && val < 25000) return val;
          }
        }
      } catch (_) {}
    }

    // Deep text scan as last resort
    const bodyText = document.body?.innerText || '';
    const patterns = [
      /(?:grand\s+total|order\s+total|total\s+due|amount\s+due|total\s+today)[:\s*]+\$\s*([\d,]+\.?\d{0,2})/i,
      /(?:subtotal|total)[:\s]+\$\s*([\d,]+\.?\d{0,2})/i,
    ];
    for (const p of patterns) {
      const m = bodyText.match(p);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (val > 0.5 && val < 25000) return val;
      }
    }

    return null;
  }

  // ─── Decision Logic ───────────────────────────────────────────────────────────
  function getDecision(price, strictMode, adjustedPrice) {
    const effectivePrice = adjustedPrice ?? price;

    // Strict mode lowers thresholds: High risk kicks in at $75 instead of $100
    const medThreshold  = strictMode ? 20 : 30;
    const highThreshold = strictMode ? 75 : 100;

    let risk, riskLevel, recommendation, recClass, messagePool;

    if (effectivePrice < medThreshold) {
      risk = 'Low'; riskLevel = 1;
      recommendation = 'Go ahead'; recClass = 'rec-go';
      messagePool = MESSAGES.low;
    } else if (effectivePrice <= highThreshold) {
      risk = 'Medium'; riskLevel = 2;
      recommendation = 'Wait 48 hours'; recClass = 'rec-wait';
      messagePool = MESSAGES.medium;
    } else {
      risk = 'High'; riskLevel = 3;
      recommendation = strictMode ? 'Strongly skip this' : 'Skip this';
      recClass = 'rec-skip';
      messagePool = MESSAGES.high;
    }

    const impactLine = messagePool[Math.floor(Math.random() * messagePool.length)];
    return { risk, riskLevel, recommendation, recClass, impactLine };
  }

  // ─── Judgy Stick Figure ───────────────────────────────────────────────────────
  const JUDGY_LINES = [
    "Really? *That's* what we're doing today?",
    "Bold financial decision. Bold.",
    "Your wallet called. It's crying.",
    "Interesting. Very interesting. 🤨",
    "Oh we're just buying things now, are we?",
    "Future you is watching. Judging.",
    "Another one? Really?",
    "Sure, sure. Totally necessary.",
    "Uh huh. And does your savings account know about this?",
    "Oh! What a totally essential purchase.",
    "Hmm. Let me think about this… nope.",
    "I'm not mad. I'm just disappointed.",
  ];

  const STICK_FIGURE_SVG = `
    <svg id="sos-stick-svg" viewBox="0 0 80 120" xmlns="http://www.w3.org/2000/svg" width="80" height="120">
      <!-- Body -->
      <line x1="40" y1="38" x2="40" y2="80" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <!-- Left leg -->
      <line x1="40" y1="80" x2="25" y2="105" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <!-- Right leg -->
      <line x1="40" y1="80" x2="55" y2="105" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <!-- Left arm (raised in exasperation) -->
      <line x1="40" y1="52" x2="18" y2="38" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <!-- Right arm (on hip) -->
      <line x1="40" y1="52" x2="60" y2="62" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <!-- Head -->
      <circle cx="40" cy="22" r="14" fill="none" stroke="currentColor" stroke-width="3"/>
      <!-- Left eye (normal) -->
      <circle cx="35" cy="20" r="1.8" fill="currentColor"/>
      <!-- Right eye (squinting/judging) -->
      <line x1="42" y1="20" x2="47" y2="20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      <!-- Raised right eyebrow -->
      <path d="M42 15 Q44.5 12.5 47 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <!-- Left brow (furrowed) -->
      <path d="M32 15 Q34 13.5 37 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <!-- Flat disapproving mouth -->
      <path d="M35 28 Q40 26 45 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;

  const JUDGY_DELAY_MS = 2800; // How long the stick figure stays before real modal

  function showJudgyFigure(onDone) {
    const line = JUDGY_LINES[Math.floor(Math.random() * JUDGY_LINES.length)];

    const el = document.createElement('div');
    el.id = 'sos-judgy';
    el.innerHTML = `
      <div id="sos-judgy-inner">
        <div id="sos-judgy-figure">${STICK_FIGURE_SVG}</div>
        <div id="sos-judgy-bubble">
          <p id="sos-judgy-text">${line}</p>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    // Entrance animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('sos-judgy-visible'));
    });

    setTimeout(() => {
      el.classList.add('sos-judgy-exit');
      setTimeout(() => {
        el.remove();
        onDone();
      }, 400);
    }, JUDGY_DELAY_MS);
  }

  // ─── Modal Builder ────────────────────────────────────────────────────────────
  function buildModal(price, priceKnown, settings, context) {
    const { hourlyRate, strictMode } = settings;
    const hours = (price / hourlyRate).toFixed(1);
    const decision = getDecision(price, strictMode, context?.adjustedPrice);
    const displayPrice = price.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

    const overlay = document.createElement('div');
    overlay.id = 'sos-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Spend or Swipe — Checkout Reflection');

    const strictBadge = strictMode
      ? `<span id="sos-strict-badge">Strict Mode</span>`
      : '';

    overlay.innerHTML = `
      <div id="sos-modal">

        <div id="sos-header">
          <div id="sos-eyebrow-row">
            <span id="sos-eyebrow">Spend or Swipe</span>
            ${strictBadge}
          </div>
          <h1 id="sos-title">Pause.<br>Quick check.</h1>
          ${context?.contextLine
            ? `<p id="sos-context-line">${context.contextLine}</p>`
            : ''}
        </div>

        ${priceKnown ? `
        <div id="sos-price-block">
          <div class="sos-price-row">
            <span class="sos-label">Cart total</span>
            <span id="sos-price-value">${displayPrice}</span>
          </div>
          <div class="sos-price-row sos-hours-row">
            <span class="sos-label">That's roughly</span>
            <span id="sos-hours-value">${hours} hrs of work</span>
          </div>
        </div>

        <p id="sos-impact">${decision.impactLine}</p>

        <div id="sos-decision">
          <div class="sos-decision-item">
            <span class="sos-label">Regret Risk</span>
            <span class="sos-risk-value risk-${decision.riskLevel}">
              <span class="sos-risk-dot"></span>
              ${decision.risk}
            </span>
          </div>
          <div class="sos-decision-divider"></div>
          <div class="sos-decision-item">
            <span class="sos-label">Recommendation</span>
            <span class="sos-rec-value ${decision.recClass}">${decision.recommendation}</span>
          </div>
        </div>

        <div id="sos-actions">
          <button id="sos-btn-wait" class="sos-btn sos-btn-primary" disabled>
            Wait 48 Hours
            <span class="btn-timer" aria-live="polite"></span>
          </button>
          <button id="sos-btn-continue" class="sos-btn sos-btn-secondary" disabled>Continue Anyway</button>
          <button id="sos-btn-close" class="sos-btn sos-btn-ghost" disabled>Dismiss</button>
        </div>

        <div id="sos-friction-track">
          <div id="sos-friction-fill"></div>
        </div>
        ` : `
        <div id="sos-price-block">
          <div id="sos-manual-entry">
            <label class="sos-label" for="sos-price-input">Enter the total price</label>
            <div id="sos-input-row">
              <span id="sos-dollar">$</span>
              <input id="sos-price-input" type="number" min="0.01" step="0.01"
                     placeholder="0.00" autocomplete="off" />
            </div>
            <button id="sos-price-confirm" class="sos-btn sos-btn-primary">Analyze</button>
          </div>
        </div>
        `}

      </div>
    `;

    document.body.appendChild(overlay);

    // Trigger enter animation on next paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add('sos-visible'));
    });

    if (priceKnown) {
      startFriction();
      bindMainButtons(overlay, price);
    } else {
      bindManualEntry(overlay, settings);
      // Focus input after animation settles
      setTimeout(() => document.getElementById('sos-price-input')?.focus(), 350);
    }
  }

  // ─── Friction Mechanic ────────────────────────────────────────────────────────
  function startFriction() {
    const fill     = document.getElementById('sos-friction-fill');
    const timerEl  = document.querySelector('.btn-timer');
    const buttons  = ['sos-btn-wait', 'sos-btn-continue', 'sos-btn-close']
                       .map(id => document.getElementById(id))
                       .filter(Boolean);

    // Kick off the progress bar (needs double rAF to animate from 0%)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (fill) {
          fill.style.transition = `width ${FRICTION_DELAY_MS}ms linear`;
          fill.style.width = '100%';
        }
      });
    });

    // Countdown
    let remaining = Math.ceil(FRICTION_DELAY_MS / 1000);
    if (timerEl) timerEl.textContent = `${remaining}s`;

    const tick = setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      if (timerEl) timerEl.textContent = remaining > 0 ? `${remaining}s` : '';
      if (remaining <= 0) clearInterval(tick);
    }, 1000);

    setTimeout(() => {
      buttons.forEach(b => { b.disabled = false; });
      if (fill) fill.style.opacity = '0';
    }, FRICTION_DELAY_MS);
  }

  // ─── Button Handlers ─────────────────────────────────────────────────────────
  function bindMainButtons(overlay, price) {
    document.getElementById('sos-btn-wait')?.addEventListener('click', () => {
      logEvent(price, 'wait');
      showWaitScreen(overlay);
    });

    document.getElementById('sos-btn-continue')?.addEventListener('click', () => {
      logEvent(price, 'continue');
      dismissModal(overlay);
    });

    document.getElementById('sos-btn-close')?.addEventListener('click', () => {
      logEvent(price, 'close');
      dismissModal(overlay);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        const closeBtn = document.getElementById('sos-btn-close');
        if (closeBtn && !closeBtn.disabled) {
          logEvent(price, 'close');
          dismissModal(overlay);
        }
      }
    });

    // Escape key
    const onKey = (e) => {
      if (e.key === 'Escape') {
        const closeBtn = document.getElementById('sos-btn-close');
        if (closeBtn && !closeBtn.disabled) {
          logEvent(price, 'close');
          dismissModal(overlay);
          document.removeEventListener('keydown', onKey);
        }
      }
    };
    document.addEventListener('keydown', onKey);
  }

  function bindManualEntry(overlay, settings) {
    const confirm = () => {
      const input = document.getElementById('sos-price-input');
      const val = parseFloat(input?.value);
      if (!val || val <= 0) {
        input?.classList.add('sos-input-error');
        input?.focus();
        return;
      }
      dismissModal(overlay);
      // Re-launch with the entered price
      setTimeout(() => {
        getPurchaseContext(val, (context) => {
          buildModal(val, true, settings, context);
        });
      }, 250);
    };

    document.getElementById('sos-price-confirm')?.addEventListener('click', confirm);
    document.getElementById('sos-price-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirm();
      document.getElementById('sos-price-input')?.classList.remove('sos-input-error');
    });
  }

  // ─── Wait Screen ─────────────────────────────────────────────────────────────
  function showWaitScreen(overlay) {
    const modal = overlay.querySelector('#sos-modal');
    if (!modal) return;
    modal.style.transition = 'opacity 0.2s ease';
    modal.style.opacity = '0';

    setTimeout(() => {
      modal.innerHTML = `
        <div id="sos-wait-screen">
          <div id="sos-wait-check">✓</div>
          <h2 id="sos-wait-title">Good call.</h2>
          <p id="sos-wait-body">Come back in 48 hours.<br>If you still want it, it'll be there.</p>
          <button id="sos-wait-done" class="sos-btn sos-btn-primary">Done</button>
        </div>
      `;
      modal.style.opacity = '1';
      document.getElementById('sos-wait-done')?.addEventListener('click', () => {
        dismissModal(overlay);
      });
    }, 200);
  }

  // ─── Dismiss ─────────────────────────────────────────────────────────────────
  function dismissModal(overlay) {
    overlay.classList.remove('sos-visible');
    overlay.classList.add('sos-hiding');
    setTimeout(() => {
      overlay.remove();
      if (domObserver) {
        domObserver.disconnect();
        domObserver = null;
      }
    }, 320);
  }

  // ─── Smart DOM-Aware Trigger ──────────────────────────────────────────────────
  function tryTrigger() {
    if (!shouldTrigger()) return;

    const price = extractPrice();
    if (!price && !isCheckoutUrl()) return; // No price + not clearly checkout = skip

    hasTriggered = true;
    if (domObserver) { domObserver.disconnect(); domObserver = null; }

    showJudgyFigure(() => {
      getSettings((settings) => {
        getPurchaseContext(price ?? 0, (context) => {
          buildModal(price ?? 0, price !== null, settings, context);
        });
      });
    });
  }

  function debouncedTrigger() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(tryTrigger, DEBOUNCE_MS);
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    if (hasTriggered) return;
    if (!isCheckoutUrl() && countPageSignals() < 1) return;

    // Watch DOM for price elements appearing (handles async/SPA rendering)
    domObserver = new MutationObserver(() => {
      if (shouldTrigger()) debouncedTrigger();
    });

    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: false,
      attributes: false,
    });

    // Also try immediately in case page is already rendered
    debouncedTrigger();
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // SPA navigation (pushState / replaceState / hash changes)
  let lastUrl = location.href;
  const navObserver = new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      hasTriggered = false;
      if (domObserver) { domObserver.disconnect(); domObserver = null; }
      setTimeout(init, 800);
    }
  });
  navObserver.observe(document.documentElement, { childList: true, subtree: true });

})();
