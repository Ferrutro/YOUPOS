// Pantalla de cocina (KDS) — pensada para quedarse prendida en una tablet en
// la cocina. Se refresca sola (no hace falta tocar nada) y avisa con un
// sonido cuando llega un pedido nuevo.
import { api, requireAuth, getUser, clearSession } from './api.js';
import { icon } from './icons.js';

if (!requireAuth()) throw new Error('no auth');
const user = getUser();

const POLL_MS = 6000;
const LATE_AFTER_MIN = { pending: 8, preparing: 12, ready: 5 };
const COLUMNS = [
  { key: 'pending', label: 'Pendiente' },
  { key: 'preparing', label: 'Preparando' },
  { key: 'ready', label: 'Listo' },
];

let orders = [];
let knownPendingIds = new Set();
let firstLoad = true;
let audioCtx = null;

document.body.innerHTML = `
  <div class="kd-shell">
    <div class="kd-topbar">
      <img src="/img/YOUPOS.png" alt="" />
      <div class="kd-title">Cocina</div>
      <span class="kd-dot" id="kd-dot" title="Actualizando en vivo"></span>
      <div class="kd-spacer"></div>
      <div class="kd-clock" id="kd-clock">--:--</div>
      <button class="kd-icon-btn" id="kd-logout-btn" title="Salir">${icon('logout', 18)}</button>
    </div>
    <div class="kd-board" id="kd-board">
      ${COLUMNS.map(
        (c) => `
        <div class="kd-column" data-col="${c.key}">
          <div class="kd-column-head">
            <span class="dot"></span>
            <span class="title">${c.label}</span>
            <span class="count" id="kd-count-${c.key}">0</span>
          </div>
          <div class="kd-column-body" id="kd-body-${c.key}"><div class="kd-loading">Cargando…</div></div>
        </div>
      `
      ).join('')}
    </div>
  </div>
`;

document.getElementById('kd-logout-btn').addEventListener('click', () => {
  clearSession();
  window.location.href = '/index.html';
});

// ---------- Reloj ----------
function tickClock() {
  document.getElementById('kd-clock').textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
tickClock();
setInterval(tickClock, 15000);

// ---------- Sonido de aviso (sintetizado, sin archivos externos) ----------
function playChime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.14);
      gain.gain.linearRampToValueAtTime(0.18, now + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.4);
    });
  } catch { /* si el navegador bloquea audio sin interacción previa, no pasa nada grave */ }
}

// ---------- Tiempo transcurrido ----------
function minutesSince(dateStr) {
  const then = new Date(dateStr.replace(' ', 'T') + 'Z').getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / 60000));
}
function formatElapsed(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

// ---------- Agrupar artículos por persona (igual que el POS/comanda impresa) ----------
function lineExtraText(i) {
  const parts = [];
  if (i.modifiers && i.modifiers.length) parts.push(i.modifiers.join(', '));
  if (i.ingredients && i.ingredients.length) parts.push(i.ingredients.join(', '));
  if (i.note) parts.push(i.note);
  return parts.join(' · ');
}
function groupByPerson(items) {
  const splitByPerson = items.some((i) => (i.person || 1) > 1);
  if (!splitByPerson) return [{ person: null, items }];
  const byPerson = new Map();
  items.forEach((i) => {
    const p = i.person || 1;
    if (!byPerson.has(p)) byPerson.set(p, []);
    byPerson.get(p).push(i);
  });
  return Array.from(byPerson.keys())
    .sort((a, b) => a - b)
    .map((p) => ({ person: p, items: byPerson.get(p) }));
}

function itemsHtml(order) {
  const groups = groupByPerson(order.items);
  return groups
    .map(
      (g) => `
      ${g.person ? `<div class="kd-person-label">Persona ${g.person}</div>` : ''}
      ${g.items
        .map(
          (i) => `
        <div class="kd-item">
          <span class="qty">${i.qty}×</span> <span class="name">${i.name}</span>
          ${lineExtraText(i) ? `<span class="extra">${lineExtraText(i)}</span>` : ''}
        </div>
      `
        )
        .join('')}
    `
    )
    .join('');
}

function cardHtml(order) {
  const mins = minutesSince(order.kitchen_sent_at || order.created_at);
  const isLate = mins >= (LATE_AFTER_MIN[order.kitchen_status] || 99);
  const label = order.order_type ? order.order_type.label : order.customer_name || 'Sin nombre';
  const detail = order.order_type && order.order_type.detail ? order.order_type.detail : null;

  const actionsByStatus = {
    pending: `<button class="kd-btn kd-start" data-action="preparing">Empezar</button>`,
    preparing: `<button class="kd-btn kd-ready" data-action="ready">Listo</button>`,
    ready: `<button class="kd-btn kd-deliver" data-action="deliver">Entregado ✓</button>`,
  };

  return `
    <div class="kd-card ${isLate ? 'kd-late' : ''}" data-col="${order.kitchen_status}" data-id="${order.id}">
      <div class="kd-card-head">
        <div>
          <div class="kd-card-title">${label}</div>
          <div class="kd-card-sub">${detail ? detail + ' · ' : ''}${order.user_name}</div>
        </div>
        <div class="kd-timer ${isLate ? 'kd-late' : ''}">${formatElapsed(mins)}</div>
      </div>
      <div class="kd-items">${itemsHtml(order)}</div>
      ${order.note ? `<div class="kd-note">${order.note}</div>` : ''}
      <div class="kd-card-actions">${actionsByStatus[order.kitchen_status] || ''}</div>
    </div>
  `;
}

function render() {
  for (const col of COLUMNS) {
    const list = orders.filter((o) => o.kitchen_status === col.key);
    document.getElementById(`kd-count-${col.key}`).textContent = list.length;
    const body = document.getElementById(`kd-body-${col.key}`);
    body.innerHTML = list.length ? list.map(cardHtml).join('') : `<div class="kd-empty">Sin pedidos</div>`;
  }
}

async function act(id, action) {
  const statusByAction = { preparing: 'preparing', ready: 'ready', deliver: null };
  try {
    await api.post(`/api/held-sales/${id}/kitchen-status`, { status: statusByAction[action] });
    await load();
  } catch (err) {
    alert(err.message);
  }
}

document.getElementById('kd-board').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const card = btn.closest('[data-id]');
  act(Number(card.dataset.id), btn.dataset.action);
});

// ---------- Carga y refresco automático ----------
async function load() {
  try {
    const { heldSales } = await api.get('/api/held-sales?kitchen=1');
    orders = heldSales;

    if (!firstLoad) {
      const newlyPending = orders.filter((o) => o.kitchen_status === 'pending' && !knownPendingIds.has(o.id));
      if (newlyPending.length > 0) playChime();
    }
    knownPendingIds = new Set(orders.filter((o) => o.kitchen_status === 'pending').map((o) => o.id));
    firstLoad = false;

    render();
    document.getElementById('kd-dot').style.background = '';
  } catch (err) {
    document.getElementById('kd-dot').style.background = '#e5534b';
  }
}

// Vuelve a pintar los relojitos de "hace X min" a cada rato sin tener que
// re-pedir todo al servidor.
setInterval(() => {
  if (orders.length) render();
}, 20000);

load();
setInterval(load, POLL_MS);
