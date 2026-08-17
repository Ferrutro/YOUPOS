// Pantalla de cocina (KDS) — pensada para quedarse prendida en una tablet en
// la cocina. Un solo tablero de tickets (sin columnas de estado): cada
// tarjeta tiene su propio color para que, además del nombre, se reconozca
// de un vistazo. Tocar el encabezado cierra el ticket (ya se entregó).
import { api, getToken, setSession, clearSession, toast, getApiBase, setApiBase, setLoginRedirectPath } from './api.js';
import { icon } from './icons.js';
import { getTheme, applyTheme, toggleTheme } from './theme.js';

const THEME_KEY = 'youpos_kitchen_theme';
applyTheme(getTheme(THEME_KEY, 'dark'));

// Cocina también se empaca como APK aparte (Capacitor) — no trae index.html
// consigo, así que trae su propio login en vez de depender del compartido.
setLoginRedirectPath('/kitchen.html');

if (!getToken()) {
  renderLoginScreen();
  throw new Error('no auth'); // no sigue armando el tablero sin sesión
}

const POLL_MS = 6000;

let orders = [];
let knownIds = new Set();
let firstLoad = true;
let audioCtx = null;

// ---------- Preferencias de esta pantalla (por equipo, no por negocio —
// cada tablet de cocina puede tener su propio sonido/tiempos) ----------
const SOUND_ENABLED_KEY = 'youpos_kitchen_sound_enabled';
const SOUND_PRESET_KEY = 'youpos_kitchen_sound_preset';
const SOUND_CUSTOM_KEY = 'youpos_kitchen_sound_custom';
const WARNING_MIN_KEY = 'youpos_kitchen_warning_min';
const EMERGENCY_MIN_KEY = 'youpos_kitchen_emergency_min';

function getSoundEnabled() { return localStorage.getItem(SOUND_ENABLED_KEY) !== '0'; }
function setSoundEnabled(v) { try { localStorage.setItem(SOUND_ENABLED_KEY, v ? '1' : '0'); } catch { /* localStorage lleno o bloqueado */ } }
function getSoundPreset() { return localStorage.getItem(SOUND_PRESET_KEY) || 'chime'; }
function setSoundPreset(v) { try { localStorage.setItem(SOUND_PRESET_KEY, v); } catch { /* localStorage lleno o bloqueado */ } }
function getCustomSound() { try { return localStorage.getItem(SOUND_CUSTOM_KEY) || null; } catch { return null; } }

function getWarningMin() { return Number(localStorage.getItem(WARNING_MIN_KEY)) || 10; }
function setWarningMin(v) { try { localStorage.setItem(WARNING_MIN_KEY, String(v)); } catch { /* localStorage lleno o bloqueado */ } }
function getEmergencyMin() { return Number(localStorage.getItem(EMERGENCY_MIN_KEY)) || 20; }
function setEmergencyMin(v) { try { localStorage.setItem(EMERGENCY_MIN_KEY, String(v)); } catch { /* localStorage lleno o bloqueado */ } }

// 'normal' -> nada especial; 'warning' -> se está tardando, amarillo;
// 'emergency' -> ya se tardó demasiado, rojo.
function urgencyLevel(mins) {
  if (mins >= getEmergencyMin()) return 'emergency';
  if (mins >= getWarningMin()) return 'warning';
  return 'normal';
}

document.body.innerHTML = `
  <div class="kd-shell">
    <div class="kd-topbar">
      <img src="/img/YOUPOS.png" alt="" />
      <div class="kd-title">Cocina</div>
      <span class="kd-dot" id="kd-dot" title="Actualizando en vivo"></span>
      <div class="kd-spacer"></div>
      <div class="kd-clock" id="kd-clock">--:--</div>
      <button class="kd-icon-btn" id="kd-history-btn" title="Historial de pedidos">${icon('clock', 18)}</button>
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
  // Recargar simplemente vuelve a pasar por el chequeo de sesión de arriba,
  // que al no encontrar token muestra el login de nuevo — no hace falta
  // "navegar" a ningún lado (Cocina empacada no trae index.html).
  window.location.reload();
});

// ---------- Reloj ----------
function tickClock() {
  document.getElementById('kd-clock').textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
tickClock();
setInterval(tickClock, 15000);

// ---------- Sonido de aviso (sintetizado, sin archivos externos — más un
// sonido personalizado opcional que el usuario suba) ----------
const SOUND_PRESETS = {
  chime: { label: 'Timbre', tones: [880, 1175] },
  bell: { label: 'Campana', tones: [660, 880, 1320] },
  soft: { label: 'Suave', tones: [520] },
};
// Tamaño máximo de un sonido personalizado — se guarda como data URL en
// localStorage (por equipo), que en la mayoría de navegadores tiene un
// límite de unos 5-10 MB en total, así que se limita bastante por debajo.
const MAX_CUSTOM_SOUND_BYTES = 700 * 1024;

function playTones(tones) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    tones.forEach((freq, i) => {
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

// Reproduce el sonido elegido sin importar si el aviso por sonido está
// activado — lo usa el botón "Probar sonido" de configuración, para poder
// escucharlo aunque esté apagado mientras se decide cuál dejar.
function previewSound() {
  const preset = getSoundPreset();
  if (preset === 'custom') {
    const dataUrl = getCustomSound();
    if (!dataUrl) { toast('Todavía no subiste ningún sonido personalizado.', 'error'); return; }
    try { new Audio(dataUrl).play(); } catch { /* algunos navegadores bloquean audio sin gesto reciente */ }
    return;
  }
  playTones((SOUND_PRESETS[preset] || SOUND_PRESETS.chime).tones);
}

function playChime() {
  if (!getSoundEnabled()) return;
  previewSound();
}

// ---------- Tuerca: configuración ----------
function openSettings() {
  document.querySelectorAll('.kd-settings-overlay').forEach((m) => m.remove());
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay kd-settings-overlay';
  const current = getTheme(THEME_KEY, 'dark');
  const soundEnabled = getSoundEnabled();
  const preset = getSoundPreset();
  const hasCustomSound = !!getCustomSound();
  const soundOptions = Object.entries(SOUND_PRESETS)
    .map(([k, v]) => `<option value="${k}" ${preset === k ? 'selected' : ''}>${v.label}</option>`)
    .join('') + (hasCustomSound ? `<option value="custom" ${preset === 'custom' ? 'selected' : ''}>Personalizado (subido)</option>` : '');

  overlay.innerHTML = `
    <div class="modal kd-settings-modal">
      <h3 style="margin-top:0;">Configuración de cocina</h3>

      <button type="button" class="kd-settings-row" id="kd-theme-toggle">
        <span>${icon(current === 'dark' ? 'sun' : 'moon', 20)}</span>
        <span class="kd-settings-row-label">${current === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}</span>
      </button>

      <div class="kd-settings-section">
        <div class="kd-settings-section-title">Sonido</div>
        <label class="kd-settings-check-row">
          <input type="checkbox" id="kd-sound-enabled" ${soundEnabled ? 'checked' : ''} />
          <span>Sonido al recibir un pedido nuevo</span>
        </label>
        <div class="field">
          <label>Sonido</label>
          <select id="kd-sound-preset">${soundOptions}</select>
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="ghost" id="kd-sound-test" style="flex:1;">Probar sonido</button>
          <label class="ghost kd-settings-upload-btn" for="kd-sound-upload">Subir sonido</label>
          <input type="file" id="kd-sound-upload" accept="audio/*" style="display:none;" />
        </div>
      </div>

      <div class="kd-settings-section">
        <div class="kd-settings-section-title">Tiempos de aviso</div>
        <div class="field">
          <label>Advertencia (minutos) — para apurar el pedido</label>
          <input type="number" id="kd-warning-min" min="1" value="${getWarningMin()}" />
        </div>
        <div class="field">
          <label>Emergencia (minutos) — ya se tardó demasiado</label>
          <input type="number" id="kd-emergency-min" min="1" value="${getEmergencyMin()}" />
        </div>
      </div>

      <button type="button" class="kd-settings-row" id="kd-logout-row" style="color:var(--kd-danger);">
        <span>${icon('logout', 20)}</span>
        <span class="kd-settings-row-label">Cerrar sesión</span>
      </button>

      <div class="kd-settings-section">
        <div class="kd-settings-section-title">Conectar otra tablet</div>
        <p class="kd-settings-hint" id="kd-server-info">Buscando la dirección de este equipo…</p>
      </div>

      <div class="modal-actions"><button class="primary" id="kd-settings-close">Listo</button></div>
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

  overlay.querySelector('#kd-sound-enabled').addEventListener('change', (e) => setSoundEnabled(e.target.checked));
  overlay.querySelector('#kd-sound-preset').addEventListener('change', (e) => setSoundPreset(e.target.value));
  overlay.querySelector('#kd-sound-test').addEventListener('click', previewSound);
  overlay.querySelector('#kd-sound-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_CUSTOM_SOUND_BYTES) {
      toast(`Ese sonido pesa demasiado (máximo ${Math.round(MAX_CUSTOM_SOUND_BYTES / 1024)} KB).`, 'error');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        localStorage.setItem(SOUND_CUSTOM_KEY, reader.result);
        setSoundPreset('custom');
        overlay.remove();
        openSettings();
        toast('Sonido personalizado guardado.', 'success');
      } catch {
        toast('No se pudo guardar el sonido en este equipo (sin espacio).', 'error');
      }
    };
    reader.readAsDataURL(file);
  });

  overlay.querySelector('#kd-warning-min').addEventListener('change', (e) => {
    const v = Math.max(1, Number(e.target.value) || 1);
    setWarningMin(v);
    updateTimers();
  });
  overlay.querySelector('#kd-emergency-min').addEventListener('change', (e) => {
    const v = Math.max(1, Number(e.target.value) || 1);
    setEmergencyMin(v);
    updateTimers();
  });

  overlay.querySelector('#kd-logout-row').addEventListener('click', () => {
    clearSession();
    window.location.reload();
  });

  // La dirección IP en sí no se puede "configurar" — el navegador de la
  // otra tablet ya llega al servidor correcto con solo escribirla, porque
  // esta pantalla pide todo con rutas relativas (/api/...). Lo único que
  // hacía falta era mostrarla, para no tener que ir a buscarla a mano.
  api
    .get('/api/server-info')
    .then(({ addresses, port }) => {
      const hint = overlay.querySelector('#kd-server-info');
      if (!hint) return;
      hint.innerHTML = addresses.length
        ? `Desde otra tablet en la misma red, entra a:<br>${addresses.map((a) => `<strong>http://${a}:${port}/kitchen.html</strong>`).join('<br>')}`
        : 'No se encontró una dirección de red — revisa que el equipo esté conectado al WiFi/red local.';
    })
    .catch(() => {
      const hint = overlay.querySelector('#kd-server-info');
      if (hint) hint.textContent = 'No se pudo obtener la dirección del servidor.';
    });
}
document.getElementById('kd-settings-btn').addEventListener('click', openSettings);

// ---------- Historial: recuperar un ticket que se cerró por accidente ----------
async function openHistoryModal() {
  document.querySelectorAll('.kd-history-overlay').forEach((m) => m.remove());
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay kd-history-overlay';
  overlay.innerHTML = `
    <div class="modal kd-settings-modal" style="max-width:440px;">
      <h3 style="margin-top:0;">Historial de pedidos</h3>
      <p class="kd-settings-hint" style="margin-top:-6px; margin-bottom:12px;">Los últimos pedidos mandados a cocina — si cerraste alguno por accidente, lo puedes recuperar.</p>
      <div id="kd-history-list"><p class="kd-settings-hint">Cargando…</p></div>
      <div class="modal-actions"><button class="ghost" id="kd-history-close">Cerrar</button></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#kd-history-close').addEventListener('click', () => overlay.remove());

  const listEl = overlay.querySelector('#kd-history-list');
  try {
    const { heldSales } = await api.get('/api/held-sales?kitchenHistory=1');
    if (heldSales.length === 0) {
      listEl.innerHTML = '<p class="kd-settings-hint">Todavía no se ha mandado ningún pedido a cocina.</p>';
      return;
    }
    listEl.innerHTML = heldSales.map(historyRowHtml).join('');
    listEl.querySelectorAll('[data-action="restore"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Recuperando…';
        try {
          await api.post(`/api/held-sales/${btn.dataset.id}/kitchen-status`, { status: 'pending' });
          overlay.remove();
          await load();
          toast('Ticket recuperado en el tablero.', 'success');
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Recuperar';
          toast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<p class="kd-settings-hint">${err.message}</p>`;
  }
}
document.getElementById('kd-history-btn').addEventListener('click', openHistoryModal);

function historyRowHtml(order) {
  const label = order.order_type ? order.order_type.label : order.customer_name || 'Ticket vacío';
  const isOnBoard = !!order.kitchen_status;
  return `
    <div class="kd-history-row">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; font-size:14px;">${label}</div>
        <div class="kd-settings-hint" style="margin:2px 0 0;">${formatDateTime(order.kitchen_sent_at)} · ${order.user_name} · ${order.items.length} artículo(s)</div>
      </div>
      ${
        isOnBoard
          ? '<span class="kd-history-badge">En el tablero</span>'
          : `<button type="button" class="ghost" data-action="restore" data-id="${order.id}">Recuperar</button>`
      }
    </div>
  `;
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
function formatDateTime(dateStr) {
  return parseDbDate(dateStr).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
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
  const level = urgencyLevel(mins);
  const levelClass = level === 'normal' ? '' : `kd-${level}`;
  const label = order.order_type ? order.order_type.label : order.customer_name || 'Ticket vacío';

  return `
    <div class="kd-card ${levelClass}" data-id="${order.id}">
      <div class="kd-card-head" style="background:${ticketColor(order.id)};" data-action="dismiss" title="Tocar para cerrar el ticket">
        <div class="kd-card-title">${label}</div>
        <div class="kd-card-sub">${formatClock(order.created_at)}, ${order.user_name}</div>
        <div class="kd-timer ${levelClass}">${formatElapsed(mins)}</div>
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
    const level = urgencyLevel(mins);
    card.classList.remove('kd-warning', 'kd-emergency');
    if (level !== 'normal') card.classList.add(`kd-${level}`);
    const timer = card.querySelector('.kd-timer');
    if (timer) {
      timer.textContent = formatElapsed(mins);
      timer.classList.remove('kd-warning', 'kd-emergency');
      if (level !== 'normal') timer.classList.add(`kd-${level}`);
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
// null (no un string vacío) para que el primer load() SIEMPRE dibuje el
// tablero, aunque no haya ningún ticket — si no, un tablero vacío la
// primera vez (firma '') coincidiría con este valor inicial y el mensaje
// "Cargando…" se quedaría para siempre en vez de mostrar "sin tickets".
let lastSignature = null;

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

// ---------- Login (Cocina trae el suyo — no depende de index.html) ----------
// Empacada como APK (Capacitor), la página ya no vive en el mismo servidor
// que el backend — por eso, ahí SÍ es obligatorio poner la dirección antes
// de poder entrar (en un navegador normal, servido por el propio backend, no
// hace falta nada de esto).
function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function renderLoginScreen() {
  const savedBase = getApiBase();
  const needsServer = isNativeApp();
  document.body.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="brand"><img src="/img/YOUPOS.png" alt="YOUPOS" style="height:64px; width:auto; display:block; margin:0 auto 8px;" /> Cocina</div>
        <div class="subtitle">Inicia sesión para continuar</div>
        <div id="kd-login-error" class="login-error"></div>
        <form id="kd-login-form">
          <div class="field">
            <label for="kd-login-user">Usuario</label>
            <input type="text" id="kd-login-user" autocomplete="username" required />
          </div>
          <div class="field">
            <label for="kd-login-pass">Contraseña</label>
            <input type="password" id="kd-login-pass" autocomplete="current-password" required />
          </div>
          <button type="submit" class="primary" style="width:100%" id="kd-login-btn">Entrar</button>
        </form>
        <details style="margin-top:18px;" ${needsServer ? 'open' : ''}>
          <summary style="cursor:pointer; font-size:12.5px; color:var(--text-secondary);">Dirección del servidor${needsServer ? ' (obligatoria)' : ''}</summary>
          <p class="text-secondary" style="font-size:11.5px; margin:8px 0;">
            ${needsServer ? 'Esta app necesita saber a qué computadora conectarse.' : 'Solo hace falta si esta app se instaló aparte (APK).'}
            Es la misma dirección que usas para conectar el Comandero.
          </p>
          <div class="field">
            <input type="text" id="kd-server-url" placeholder="http://192.168.1.23:3000" value="${savedBase}" />
          </div>
          <button type="button" class="ghost" style="width:100%;" id="kd-server-save">Guardar dirección</button>
        </details>
      </div>
    </div>
  `;

  document.getElementById('kd-server-save').addEventListener('click', () => {
    const url = document.getElementById('kd-server-url').value.trim();
    setApiBase(url);
    toast(url ? `Servidor guardado: ${url}` : 'Se usará la misma dirección de esta página.', 'success');
  });

  const form = document.getElementById('kd-login-form');
  const errorBox = document.getElementById('kd-login-error');
  const btn = document.getElementById('kd-login-btn');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';

    const serverUrl = document.getElementById('kd-server-url').value.trim();
    if (needsServer && !serverUrl) {
      errorBox.textContent = 'Pon la dirección del servidor antes de entrar (abre "Dirección del servidor" arriba).';
      errorBox.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Entrando…';
    setApiBase(serverUrl);
    try {
      const username = document.getElementById('kd-login-user').value.trim();
      const password = document.getElementById('kd-login-pass').value;
      const result = await api.post('/api/auth/login', { username, password });
      setSession(result.token, result.user);
      // Recargar vuelve a evaluar este archivo desde cero, y esta vez sí
      // encuentra el token y arma el tablero normalmente.
      window.location.reload();
    } catch (err) {
      errorBox.textContent = err.message || 'No se pudo iniciar sesión.';
      errorBox.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
}
