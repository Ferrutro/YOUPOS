// Pantalla de cocina (KDS) — pensada para quedarse prendida en una tablet en
// la cocina. Un solo tablero de tickets (sin columnas de estado): cada
// tarjeta tiene su propio color para que, además del nombre, se reconozca
// de un vistazo. Tocar el encabezado cierra el ticket (ya se entregó).
import { api, requireAuth, getUser, clearSession, toast } from './api.js';
import { icon } from './icons.js';
import { getTheme, applyTheme, toggleTheme } from './theme.js';

const THEME_KEY = 'youpos_kitchen_theme';
applyTheme(getTheme(THEME_KEY, 'dark'));

if (!requireAuth()) throw new Error('no auth');
const user = getUser();

const POLL_MS = 6000;
const LATE_AFTER_MIN = 10;

let orders = [];
let knownIds = new Set();
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
      <button class="kd-icon-btn" id="kd-settings-btn" title="Configuración">${icon('settings', 18)}</button>
      <button class="kd-icon-btn" id="kd-logout-btn" title="Salir">${icon('logout', 18)}</button>
    </div>
    <div class="kd-board" id="kd-board">
      <div class="kd-loading">Cargando…</div>
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

// ---------- Tuerca: configuración (modo oscuro/claro, y lo que se agregue después) ----------
function openSettings() {
  document.querySelectorAll('.kd-settings-overlay').forEach((m) => m.remove());
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay kd-settings-overlay';
  const current = getTheme(THEME_KEY, 'dark');
  overlay.innerHTML = `
    <div class="modal kd-settings-modal">
      <h3 style="margin-top:0;">Configuración de cocina</h3>
      <button type="button" class="kd-settings-row" id="kd-theme-toggle">
        <span>${icon(current === 'dark' ? 'sun' : 'moon', 20)}</span>
        <span class="kd-settings-row-label">${current === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}</span>
      </button>
      <div class="modal-actions"><button class="ghost" id="kd-settings-close">Cerrar</button></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#kd-settings-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#kd-theme-toggle').addEventListener('click', () => {
    const next = toggleTheme(THEME_KEY, 'dark');
    overlay.remove();
    openSettings();
    toast(`Modo ${next === 'dark' ? 'oscuro' : 'claro'} activado.`, 'success');
  });
}
document.getElementById('kd-settings-btn').addEventListener('click', openSettings);

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

// ---------- Tiempo ----------
function parseDbDate(dateStr) {
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}
function minutesSince(dateStr) {
  return Math.max(0, Math.floor((Date.now() - parseDbDate(dateStr).getTime()) / 60000));
}
function formatElapsed(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}
function formatClock(dateStr) {
  return parseDbDate(dateStr).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// ---------- 30 colores de ticket ----------
// Un tono por ticket (según su id, así que siempre es el mismo color para
// el mismo ticket) — de fondo pastel con texto oscuro fijo, para que se lea
// bien tanto en modo claro como oscuro.
const TICKET_HUES = Array.from({ length: 30 }, (_, i) => Math.round(i * (360 / 30)));
function ticketColor(id) {
  const hue = TICKET_HUES[id % TICKET_HUES.length];
  return `hsl(${hue}, 62%, 82%)`;
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
  const isLate = mins >= LATE_AFTER_MIN;
  const label = order.order_type ? order.order_type.label : order.customer_name || 'Ticket vacío';

  return `
    <div class="kd-card ${isLate ? 'kd-late' : ''}" data-id="${order.id}">
      <div class="kd-card-head" style="background:${ticketColor(order.id)};" data-action="dismiss" title="Tocar para cerrar el ticket">
        <div class="kd-card-title">${label}</div>
        <div class="kd-card-sub">${formatClock(order.created_at)}, ${order.user_name}</div>
        <div class="kd-timer ${isLate ? 'kd-late' : ''}">${formatElapsed(mins)}</div>
      </div>
      <div class="kd-card-body">
        <div class="kd-items">${itemsHtml(order)}</div>
        <div class="kd-note-zone" data-id="${order.id}">
          ${order.note ? `<div class="kd-note">${order.note}</div>` : ''}
          <button type="button" class="kd-note-add" data-action="note">${icon('note', 14)} ${order.note ? 'Editar comentario' : '+ Comentario'}</button>
        </div>
      </div>
    </div>
  `;
}

function render() {
  const board = document.getElementById('kd-board');
  if (orders.length === 0) {
    board.innerHTML = `<div class="kd-empty-board">No hay tickets abiertos en cocina ahora mismo.</div>`;
    return;
  }
  board.innerHTML = orders.map(cardHtml).join('');
}

// Actualiza solo el "hace X min" de cada tarjeta ya pintada, sin reconstruir
// el tablero — así no se reinicia la animación de entrada de las tarjetas
// que no cambiaron (eso era lo que hacía parpadear todo a cada rato).
function updateTimers() {
  document.querySelectorAll('.kd-card[data-id]').forEach((card) => {
    const order = orders.find((o) => o.id === Number(card.dataset.id));
    if (!order) return;
    const mins = minutesSince(order.kitchen_sent_at || order.created_at);
    const isLate = mins >= LATE_AFTER_MIN;
    card.classList.toggle('kd-late', isLate);
    const timer = card.querySelector('.kd-timer');
    if (timer) {
      timer.textContent = formatElapsed(mins);
      timer.classList.toggle('kd-late', isLate);
    }
  });
}

async function dismiss(id, card) {
  const head = card.querySelector('.kd-card-head');
  card.classList.add('kd-leaving');
  try {
    await Promise.all([
      api.post(`/api/held-sales/${id}/kitchen-status`, { status: null }),
      new Promise((resolve) => setTimeout(resolve, 180)),
    ]);
    await load();
  } catch (err) {
    card.classList.remove('kd-leaving');
    toast(err.message, 'error');
  }
  void head;
}

function openNoteEditor(id, zone) {
  const order = orders.find((o) => o.id === id);
  zone.innerHTML = `
    <textarea class="kd-note-input" rows="2" placeholder="Ej. sin hielo para toda la mesa...">${order?.note || ''}</textarea>
    <div class="kd-note-actions">
      <button type="button" class="ghost" data-action="note-cancel">Cancelar</button>
      <button type="button" class="primary" data-action="note-save">Guardar</button>
    </div>
  `;
  zone.querySelector('textarea').focus();
}

async function saveNote(id, zone) {
  const textarea = zone.querySelector('textarea');
  const note = textarea.value.trim();
  try {
    await api.post(`/api/held-sales/${id}/note`, { note });
    const order = orders.find((o) => o.id === id);
    if (order) order.note = note || null;
    lastSignature = orders.map(orderSignature).join('|');
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('kd-board').addEventListener('click', (e) => {
  const noteZone = e.target.closest('.kd-note-zone');

  if (e.target.closest('[data-action="dismiss"]')) {
    const card = e.target.closest('[data-id]');
    dismiss(Number(card.dataset.id), card);
    return;
  }
  if (e.target.closest('[data-action="note"]')) {
    openNoteEditor(Number(noteZone.dataset.id), noteZone);
    return;
  }
  if (e.target.closest('[data-action="note-save"]')) {
    saveNote(Number(noteZone.dataset.id), noteZone);
    return;
  }
  if (e.target.closest('[data-action="note-cancel"]')) {
    render();
  }
});

// ---------- Carga y refresco automático ----------
// Firma de lo que se ve en pantalla por ticket: mientras no cambie, no hay
// razón para reconstruir el tablero en cada sondeo (cada 6s) — eso era lo
// que causaba el parpadeo, porque las tarjetas se destruían y volvían a
// crear (con su animación de entrada) aunque no hubiera nada nuevo.
function orderSignature(o) {
  return `${o.id}:${o.kitchen_sent_at}:${o.note || ''}:${JSON.stringify(o.items)}:${JSON.stringify(o.order_type)}`;
}
let lastSignature = '';

async function load() {
  try {
    const { heldSales } = await api.get('/api/held-sales?kitchen=1');
    orders = heldSales;

    if (!firstLoad) {
      const newlyArrived = orders.filter((o) => !knownIds.has(o.id));
      if (newlyArrived.length > 0) playChime();
    }
    knownIds = new Set(orders.map((o) => o.id));
    firstLoad = false;

    const signature = orders.map(orderSignature).join('|');
    if (signature !== lastSignature) {
      lastSignature = signature;
      render();
    } else {
      updateTimers();
    }
    document.getElementById('kd-dot').style.background = '';
  } catch (err) {
    document.getElementById('kd-dot').style.background = '#e5534b';
  }
}

// Vuelve a pintar los relojitos de "hace X min" a cada rato sin tener que
// re-pedir todo al servidor ni reconstruir las tarjetas.
setInterval(() => {
  if (orders.length) updateTimers();
}, 20000);

load();
setInterval(load, POLL_MS);
