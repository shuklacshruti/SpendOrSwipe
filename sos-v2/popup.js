'use strict';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function formatPrice(p) {
  return p.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function actionLabel(action) {
  return { wait: 'Waited 48h', continue: 'Continued', close: 'Dismissed' }[action] || action;
}

function actionDotClass(action) {
  return { wait: 'dot-wait', continue: 'dot-continue', close: 'dot-close' }[action] || 'dot-close';
}

// ─── Stats Computation ────────────────────────────────────────────────────────
function computeStats(events) {
  const total = events.length;
  const ignored = events.filter(e => e.action === 'continue').length;
  const avoided = events
    .filter(e => e.action === 'wait')
    .reduce((sum, e) => sum + (e.price || 0), 0);
  return { total, ignored, avoided };
}

function generateInsight(events) {
  if (!events.length) return null;

  const oneWeekAgo = Date.now() - 7 * 86400000;
  const oneDay = Date.now() - 86400000;
  const weekEvents = events.filter(e => e.timestamp > oneWeekAgo);
  const todayIgnored = events.filter(e => e.timestamp > oneDay && e.action === 'continue').length;
  const weekAvoided = weekEvents.filter(e => e.action === 'wait').reduce((s, e) => s + (e.price || 0), 0);

  if (todayIgnored >= 3) {
    return `You ignored <strong>${todayIgnored} warnings today</strong>. That's a pattern worth noticing.`;
  }
  if (weekAvoided > 0) {
    return `You've paused on <strong>${formatPrice(weekAvoided)}</strong> in potential purchases this week.`;
  }
  if (weekEvents.length >= 5) {
    return `<strong>${weekEvents.length} checkout checks</strong> this week. You're staying aware.`;
  }
  const continueRate = events.length
    ? Math.round((events.filter(e => e.action === 'continue').length / events.length) * 100)
    : 0;
  if (continueRate > 60) {
    return `You continue past <strong>${continueRate}% of warnings</strong>. Consider enabling Strict Mode.`;
  }
  return null;
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderStats(events) {
  const { total, ignored, avoided } = computeStats(events);
  $('stat-total').textContent = total;
  $('stat-ignored').textContent = ignored;
  $('stat-avoided').textContent = formatPrice(avoided);
}

function renderInsight(events) {
  const banner = $('insight-banner');
  const insight = generateInsight(events);
  if (insight) {
    banner.innerHTML = insight;
    banner.classList.add('visible');
  } else {
    banner.classList.remove('visible');
  }
}

function renderActivity(events) {
  const list = $('activity-list');
  if (!events.length) {
    list.innerHTML = `<div class="empty-state">No checks recorded yet.<br>Visit a checkout page to begin.</div>`;
    return;
  }

  const recent = events.slice(0, 6);
  list.innerHTML = recent.map(e => `
    <div class="activity-item">
      <div class="activity-left">
        <div class="activity-dot ${actionDotClass(e.action)}"></div>
        <div class="activity-action">${actionLabel(e.action)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        ${e.price ? `<div class="activity-price">${formatPrice(e.price)}</div>` : ''}
        <div class="activity-time">${timeAgo(e.timestamp)}</div>
      </div>
    </div>
  `).join('');
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettings() {
  chrome.storage.local.get(['settings'], (r) => {
    const s = Object.assign({ hourlyRate: 20, strictMode: false }, r.settings || {});
    $('wage-input').value = s.hourlyRate;
    $('strict-toggle').checked = s.strictMode;
  });
}

function saveSettings() {
  const hourlyRate = Math.max(1, Math.min(999, parseInt($('wage-input').value) || 20));
  const strictMode = $('strict-toggle').checked;
  $('wage-input').value = hourlyRate; // clamp display
  chrome.storage.local.set({ settings: { hourlyRate, strictMode } });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  loadSettings();

  chrome.storage.local.get(['events'], (r) => {
    const events = r.events || [];
    renderStats(events);
    renderInsight(events);
    renderActivity(events);
  });

  // Settings listeners
  $('wage-input').addEventListener('change', saveSettings);
  $('wage-input').addEventListener('blur', saveSettings);
  $('strict-toggle').addEventListener('change', saveSettings);

  // Reset
  $('btn-reset').addEventListener('click', () => {
    if (confirm('Clear all Spend or Swipe data?')) {
      chrome.storage.local.remove(['events'], () => {
        renderStats([]);
        renderInsight([]);
        renderActivity([]);
      });
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
