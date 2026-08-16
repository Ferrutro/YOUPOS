import { api, requireAuth, getUser, clearSession, toast, formatMoney, formatDate } from './api.js';
import { icon } from './icons.js';
import { applyToolbarLayout, resolveToolbarLayout, defaultIdsForSection } from './pos-buttons-catalog.js';
import { openNavDrawer } from './layout.js';

if (!requireAuth()) throw new Error('no auth');

const user = getUser();

// ---------- Estado ----------
let products = [];
let categories = [];
let cart = []; // { lineId, productId, name, qty, unitPrice, taxRate, discount, stock, trackStock }
// Contador para dar a cada línea del ticket un id propio (lineId), independiente
// del productId. Así, si el mismo producto se agrega dos veces por separado
// (no seguido), quedan como dos líneas distintas en vez de sumarse en una sola.
let nextLineId = 1;
let customers = [];
let selectedCustomerId = null;
let currentCashSession = null;
let settings = {};
let activeCategoryId = null;
let railMode = 'all'; // 'all' | 'favorites' | 'recent'
let ticketNote = '';
let lastSale = null;
let heldSales = [];
let toolbarLayout = { top: null, bottom: null, quick: null };
let currentOrderType = null; // { type, label, detail, customer_name } | null = sin cuenta abierta todavía
let currentAccountHeldId = null; // id en held_sales que respalda la cuenta en pantalla, o null si todavía no se ha guardado

// Valor especial para el <select> de "Cliente" cuando la cuenta abierta trae
// un nombre escrito a mano (ej. "Familia Pérez" al abrir la Mesa 5) que no
// corresponde a ningún cliente registrado — se muestra igual, nada más no
// tiene un customer_id real detrás.
const FREE_NAME_VALUE = '__free_name__';

// ---------- Cobro: constantes compartidas ----------
// Nombres viejos, fijos, de antes de que los métodos de pago fueran
// configurables — se conservan solo para mostrar bien el historial de
// ventas ya registradas con ellos. Los métodos nuevos (aparte de "cash")
// usan directamente el nombre que se configuró en Ticket y venta.
const PAYMENT_METHOD_LABELS = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };
// Billetes comunes en pesos mexicanos, usados para sugerir montos de efectivo.
const CASH_DENOMINATIONS = [20, 50, 100, 200, 500, 1000, 2000];

// Métodos de pago adicionales a "Efectivo" (que siempre está fijo), tal como
// se configuraron en Configuración → Ticket y venta. Cada uno puede traer su
// propio % de recargo (ej. tarjeta de crédito) — devuelve [{name, surchargePct}].
const DEFAULT_PAYMENT_METHODS = [
  { name: 'Tarjeta', surchargePct: 0 },
  { name: 'Transferencia', surchargePct: 0 },
];
function customPaymentMethods() {
  try {
    const arr = JSON.parse(settings.payment_methods || '[]');
    if (!Array.isArray(arr)) return DEFAULT_PAYMENT_METHODS;
    return arr
      .filter((m) => m && typeof m.name === 'string' && m.name.trim())
      .map((m) => ({ name: m.name.trim(), surchargePct: Number(m.surchargePct) || 0 }));
  } catch {
    return DEFAULT_PAYMENT_METHODS;
  }
}

const FAV_KEY = 'pos_favorite_products';
function getFavorites() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { return new Set(); }
}
function toggleFavorite(id) {
  const favs = getFavorites();
  if (favs.has(id)) favs.delete(id); else favs.add(id);
  localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
}
let recentProductIds = [];

// ---------- Construcción del shell (sin la barra lateral estándar: esta
// pantalla es de uso intensivo y va a pantalla completa) ----------
const shell = document.createElement('div');
shell.className = 'pos-shell';
document.body.insertBefore(shell, document.getElementById('print-area'));

const canManageCatalog = ['admin', 'manager'].includes(user.role);
const canSeeReports = ['admin', 'manager'].includes(user.role);

// Marca de "Mi POS" (el software), discreta, centrada arriba en la barra —
// distinta del logo del negocio del cliente (ese se configura aparte, en
// Configuración → Negocio, y sale en los tickets impresos).
const MIPOS_BRAND_MARK = `<img src="/img/YOUPOS.png" alt="Mi POS" style="height:50px; width:auto; display:block;" />`;

shell.innerHTML = `
  <div class="pos-topbar">
    <div class="brand" id="brand-name">Mi POS</div>
    <div class="pos-topbar-logo" title="Mi POS">${MIPOS_BRAND_MARK}</div>
    <div class="pos-topbar-info">
      <div class="meta">Ticket No. <strong id="ticket-no">Nuevo</strong></div>
      <div class="meta">Artículos: <strong id="item-count">0</strong></div>
      <div class="meta" id="currency-label">MXN</div>
      <div class="meta" id="order-type-meta" style="display:none; font-weight:600;"></div>
    </div>
    <div class="spacer"></div>
    <div class="meta">${user.name}</div>
    <div class="meta clock" id="clock">--:--</div>
    <button class="icon-btn" id="settings-menu-btn" title="Menú">${icon('menu', 18)}</button>
  </div>

  <div class="pos-toolbar" id="function-toolbar"></div>

  <div class="pos-main">
    <div class="ticket-panel">
      <div class="cliente-row">
        <label>Cliente <span class="req">*</span></label>
        <div class="cliente-select-row">
          <select id="customer-select"><option value="">Ticket vacío</option></select>
          <button class="icon-btn" id="edit-customer-btn" title="Nuevo cliente rápido">${icon('edit', 17)}</button>
        </div>
      </div>

      <div class="ticket-table-wrap">
        <table class="ticket-table">
          <thead>
            <tr>
              <th style="width:78px">Cant</th>
              <th>Descripción</th>
              <th class="num" style="width:70px">Dscto</th>
              <th class="num" style="width:78px">Precio</th>
              <th class="num" style="width:84px">Importe</th>
              <th style="width:26px"></th>
            </tr>
          </thead>
          <tbody id="ticket-body"></tbody>
        </table>
        <div class="ticket-empty" id="ticket-empty"><div class="wordmark" id="ticket-watermark">Mi POS</div></div>
      </div>

      <div class="ticket-quickactions" id="ticket-quickactions"></div>

      <div class="estado-row">Estado: <strong id="estado-label">Sin ticket activo</strong></div>

      <div class="totals-row">
        <div class="trow"><span>Subtotal</span><span id="sum-subtotal">$0.00</span></div>
        <div class="trow"><span>Descuento</span><span id="sum-discount">$0.00</span></div>
        <div class="trow"><span>Impuestos</span><span id="sum-tax">$0.00</span></div>
        <div class="trow total"><span>Total</span><span id="sum-total">$0.00</span></div>
      </div>

      <div class="big-actions-row">
        <button class="big-btn cancel" id="cancel-btn">Cancelar</button>
        <button class="big-btn pay" id="pay-btn">Pagar $0</button>
      </div>
    </div>

    <div class="pos-resize-handle" id="ticket-resize-handle" title="Arrastra para cambiar el tamaño"></div>

    <div class="catalog-panel">
      <div class="search-row">
        <input type="text" id="search-input" placeholder="Buscar (F8)" />
      </div>
      <div class="product-grid-wrap">
        <div class="pos-product-grid" id="product-grid"></div>
      </div>
    </div>

    <div class="category-rail" id="category-rail"></div>
  </div>

  <div class="pos-toolbar bottom" id="bottom-toolbar"></div>

  <div class="pos-statusline">
    <b>Ctrl+E</b> Cliente<span class="sep">|</span><b>F8</b> Buscar<span class="sep">|</span><b>F5</b> Recargar página<span class="sep">|</span>Sesión: ${user.name} (${user.role})
  </div>
`;

// ---------- Referencias ----------
const searchInput = document.getElementById('search-input');
const productGrid = document.getElementById('product-grid');
const categoryRail = document.getElementById('category-rail');
const ticketBody = document.getElementById('ticket-body');
const ticketEmpty = document.getElementById('ticket-empty');
const customerSelect = document.getElementById('customer-select');
const functionToolbar = document.getElementById('function-toolbar');
const bottomToolbar = document.getElementById('bottom-toolbar');
const ticketQuickActions = document.getElementById('ticket-quickactions');

document.getElementById('settings-menu-btn').addEventListener('click', () => openNavDrawer());

// ---------- Panel del ticket redimensionable (arrastrar con mouse o dedo,
// como el control de una línea de tiempo de video) ----------
const TICKET_WIDTH_KEY = 'pos_ticket_width';
const TICKET_WIDTH_MIN = 320;
const TICKET_WIDTH_MAX = 720;
const resizeHandle = document.getElementById('ticket-resize-handle');

function applyTicketWidth(px) {
  shell.style.setProperty('--pos-ticket-w', `${px}px`);
}

(function restoreTicketWidth() {
  const saved = Number(localStorage.getItem(TICKET_WIDTH_KEY));
  if (saved && saved >= TICKET_WIDTH_MIN && saved <= TICKET_WIDTH_MAX) {
    applyTicketWidth(saved);
  }
})();

(function wireTicketResize() {
  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = document.querySelector('.ticket-panel').getBoundingClientRect().width;
    resizeHandle.classList.add('dragging');
    shell.classList.add('resizing-cols');
    resizeHandle.setPointerCapture(e.pointerId);
  });

  resizeHandle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const delta = e.clientX - startX;
    const maxAllowed = Math.min(TICKET_WIDTH_MAX, window.innerWidth - 96 - 260);
    const next = Math.max(TICKET_WIDTH_MIN, Math.min(maxAllowed, startWidth + delta));
    applyTicketWidth(next);
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    resizeHandle.classList.remove('dragging');
    shell.classList.remove('resizing-cols');
    const finalWidth = document.querySelector('.ticket-panel').getBoundingClientRect().width;
    localStorage.setItem(TICKET_WIDTH_KEY, String(Math.round(finalWidth)));
    try { resizeHandle.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
  }

  resizeHandle.addEventListener('pointerup', endDrag);
  resizeHandle.addEventListener('pointercancel', endDrag);

  // Doble clic (o doble toque) regresa al tamaño de siempre.
  resizeHandle.addEventListener('dblclick', () => {
    applyTicketWidth(420);
    localStorage.removeItem(TICKET_WIDTH_KEY);
  });
})();

// ---------- Reloj ----------
function tickClock() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
tickClock();
setInterval(tickClock, 1000 * 15);

// ---------- Barra de funciones (superior) ----------
function toolButton({ id, key, ico, label, onClick, disabled }) {
  return { id, key, ico, label, onClick, disabled };
}

function stub(name) {
  return () => toast(`"${name}" todavía no está disponible en esta vista previa.`, 'info');
}

function renderToolbar(container, buttons) {
  const visible = buttons;
  container.innerHTML = visible
    .map(
      (b, i) => `
      <button class="toolbtn" data-i="${i}" ${b.disabled ? 'disabled' : ''}>
        ${b.key ? `<span class="key">${b.key}</span>` : ''}
        <span class="ico">${icon(b.ico, 20)}</span>
        <span class="lbl">${b.label}</span>
      </button>
    `
    )
    .join('');
  container.querySelectorAll('.toolbtn').forEach((btn) => {
    const b = visible[Number(btn.dataset.i)];
    if (b.onClick) btn.addEventListener('click', b.onClick);
  });
}

// Un solo catálogo de botones "en vivo" (con sus onClick/disabled ya
// resueltos) para TODA la pantalla de venta. Antes cada barra tenía su
// propio arreglo fijo de botones; ahora viven todos juntos para que
// cualquier botón se pueda colocar en cualquier barra (superior, inferior o
// acciones rápidas) desde Configuración → Personalizar el punto de venta.
function buildAllToolbarButtons() {
  return [
    toolButton({ id: 'opentab', key: 'F3', ico: 'layers', label: 'Abrir cuenta', onClick: () => openAccountsModal() }),
    toolButton({
      id: 'stock', key: 'F10', ico: 'box', label: 'Existencias',
      onClick: () => (window.location.href = '/inventory.html'),
      disabled: !canManageCatalog,
    }),
    toolButton({ id: 'switchuser', key: 'F12', ico: 'user', label: 'Cambiar usuario', onClick: () => logout() }),
    toolButton({ id: 'printticket', key: 'Ctrl+P', ico: 'printer', label: 'Imprimir cuenta', onClick: () => openPrintAccountModal() }),
    toolButton({ id: 'reprint', key: 'Ctrl+O', ico: 'printerCheck', label: 'Reimprimir ticket', onClick: () => openReprintTicketModal() }),
    toolButton({ id: 'drawer', key: 'Ctrl+A', ico: 'drawer', label: 'Abrir cajón', onClick: stub('Abrir cajón (requiere hardware)') }),
    toolButton({ id: 'notes', key: 'Ctrl+K', ico: 'note', label: 'Notas', onClick: () => openStickyNotesBoard() }),
    toolButton({ id: 'calculator', key: 'Ctrl+U', ico: 'calculator', label: 'Calculadora', onClick: () => openCalculator() }),
    toolButton({ id: 'scale', key: 'Ctrl+B', ico: 'scale', label: 'Báscula', onClick: () => openScaleModal() }),
    toolButton({ id: 'accounts', key: 'Alt', ico: 'user', label: 'Cuentas', onClick: () => openAccountsModal() }),
    toolButton({ id: 'tickets', key: 'Alt+T', ico: 'ticket', label: 'Tickets', onClick: () => (window.location.href = '/sales.html') }),
    toolButton({ id: 'reports', key: 'Alt+R', ico: 'barChart', label: 'Reportes', onClick: () => (window.location.href = '/reports.html'), disabled: !canSeeReports }),
  ];
}

// Ids efectivos de una barra: los que el administrador personalizó (puede
// ser un arreglo vacío a propósito), o si nunca la tocó (null), los que
// trae esa barra por defecto.
function effectiveIds(section) {
  return toolbarLayout[section] == null ? defaultIdsForSection(section) : toolbarLayout[section];
}

function buildFunctionToolbar() {
  renderToolbar(functionToolbar, applyToolbarLayout(buildAllToolbarButtons(), effectiveIds('top')));
}

function buildBottomToolbar() {
  renderToolbar(bottomToolbar, applyToolbarLayout(buildAllToolbarButtons(), effectiveIds('bottom')));
}

function logout() {
  if (!confirm('¿Cerrar sesión y cambiar de usuario?')) return;
  clearSession();
  window.location.href = '/index.html';
}

// ---------- Carga de datos ----------
async function loadAll() {
  try {
    const [productsRes, categoriesRes, customersRes, settingsRes, sessionRes, heldRes] = await Promise.all([
      api.get('/api/products'),
      api.get('/api/categories'),
      api.get('/api/customers'),
      api.get('/api/settings'),
      api.get('/api/cash-sessions/current'),
      api.get('/api/held-sales'),
    ]);
    // Nadie usa el POS sin un turno de caja abierto (se abre justo después
    // de iniciar sesión) — si por alguna razón llega aquí sin uno (URL
    // directa, volvió después de cerrar su turno, etc.), lo mandamos a
    // abrirlo antes de seguir.
    if (!sessionRes.session) {
      window.location.href = '/open-shift.html';
      return;
    }

    products = productsRes.products;
    categories = categoriesRes.categories;
    customers = customersRes.customers;
    settings = settingsRes.settings;
    currentCashSession = sessionRes.session;
    heldSales = heldRes.heldSales;

    toolbarLayout = resolveToolbarLayout(settings);

    document.getElementById('currency-label').textContent = settings.currency || 'MXN';
    document.getElementById('brand-name').textContent = settings.business_name || 'Mi POS';
    // El texto de la marca de agua se puede personalizar aparte del nombre
    // del negocio (por ejemplo, un eslogan); si no se definió, usa el
    // nombre del negocio como antes.
    document.getElementById('ticket-watermark').textContent = settings.pos_watermark_text || settings.business_name || 'Mi POS';
    renderCategoryRail();
    renderProducts();
    renderCustomerOptions();
    // Se reconstruyen para reflejar el contador de "En espera" y los botones
    // que el administrador haya ocultado desde Configuración.
    buildFunctionToolbar();
    buildBottomToolbar();
    buildTicketQuickActions();
    maybeShowLowStockAlert();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Aviso de stock bajo: se muestra una sola vez por sesión (no en cada
// recarga ni después de cada venta) para no volverse molesto si dejas el
// POS abierto todo el día. Solo para quien puede ver Inventario.
function maybeShowLowStockAlert() {
  if (!canManageCatalog) return;
  const key = 'pos_lowstock_alert_shown';
  if (sessionStorage.getItem(key)) return;
  const lowStock = products.filter((p) => p.track_stock && p.stock_qty <= p.min_stock);
  if (lowStock.length === 0) return;
  sessionStorage.setItem(key, '1');
  const label = lowStock.length === 1 ? '1 producto con stock bajo' : `${lowStock.length} productos con stock bajo`;
  toast(`⚠ ${label} — revisa Inventario.`, 'warning');
}

function renderCustomerOptions() {
  const current = customerSelect.value;
  // Si la cuenta abierta trae un nombre escrito a mano y no hay un cliente
  // REGISTRADO elegido, ese nombre se agrega como opción (así se ve en
  // "Cliente" aunque no exista como cliente de verdad en el sistema).
  const freeName = !selectedCustomerId && currentOrderType?.customer_name ? currentOrderType.customer_name : null;
  customerSelect.innerHTML =
    '<option value="">Ticket vacío</option>' +
    (freeName ? `<option value="${FREE_NAME_VALUE}">${freeName}</option>` : '') +
    customers.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  customerSelect.value = freeName ? FREE_NAME_VALUE : current;
  customerSelect.onchange = () => {
    const v = customerSelect.value;
    selectedCustomerId = v && v !== FREE_NAME_VALUE ? v : null;
    if (v !== FREE_NAME_VALUE) renderCustomerOptions(); // si eligen otra cosa, la opción del nombre libre ya no aplica
  };
}

// ---------- Rail de categorías ----------
function renderCategoryRail() {
  const top = [
    { mode: 'all', ico: 'home', label: 'Inicio' },
    { mode: 'favorites', ico: 'star', label: 'Favoritos' },
    { mode: 'recent', ico: 'clock', label: 'Recientes' },
  ];
  const topHtml = top
    .map(
      (t) => `<button class="railbtn ${railMode === t.mode ? 'active' : ''}" data-mode="${t.mode}">${icon(t.ico, 18)}<span>${t.label}</span></button>`
    )
    .join('');

  const catHtml = categories
    .map((c) => {
      const isActive = activeCategoryId === c.id;
      // Si la categoría tiene color propio, se usa ese en vez del acento
      // general — así se distinguen entre sí en la barra lateral.
      const style = c.color ? `color:${c.color};${isActive ? ` border-color:${c.color}; background:${c.color}22;` : ''}` : '';
      return `<button class="railbtn ${isActive ? 'active' : ''}" data-cat="${c.id}" style="${style}">${icon('grid', 18)}<span>${c.name}</span></button>`;
    })
    .join('');

  categoryRail.innerHTML = topHtml + '<hr>' + catHtml;

  categoryRail.querySelectorAll('button[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      railMode = btn.dataset.mode;
      activeCategoryId = null;
      renderCategoryRail();
      renderProducts();
    });
  });
  categoryRail.querySelectorAll('button[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCategoryId = Number(btn.dataset.cat);
      railMode = 'all';
      renderCategoryRail();
      renderProducts();
    });
  });
}

// ---------- Catálogo de productos ----------
function renderProducts() {
  const query = searchInput.value.trim().toLowerCase();
  let filtered = products;

  if (railMode === 'favorites') {
    const favs = getFavorites();
    filtered = filtered.filter((p) => favs.has(p.id));
  } else if (railMode === 'recent') {
    filtered = recentProductIds.map((id) => products.find((p) => p.id === id)).filter(Boolean);
  } else if (activeCategoryId) {
    filtered = filtered.filter((p) => p.category_id === activeCategoryId);
  }

  if (query) {
    filtered = filtered.filter(
      (p) => p.name.toLowerCase().includes(query) || (p.sku && p.sku.toLowerCase().includes(query)) || (p.barcode && p.barcode.toLowerCase().includes(query))
    );
  }

  if (filtered.length === 0) {
    productGrid.innerHTML = '<div class="empty-state">Sin productos para mostrar</div>';
    return;
  }

  const favs = getFavorites();
  productGrid.innerHTML = filtered
    .map((p) => {
      const outOfStock = p.track_stock && p.stock_qty <= 0;
      const isFav = favs.has(p.id);
      const thumbContent = p.image_data
        ? `<img src="${p.image_data}" alt="" style="width:100%; height:100%; object-fit:cover;" />`
        : icon('box', 26);
      // El producto puede traer su propio color; si no, hereda el de su
      // categoría (si esa categoría tiene uno). Se ve como una franja
      // arriba de la tarjeta y, si no hay foto, tiñe el fondo del ícono.
      const category = categories.find((c) => c.id === p.category_id);
      const tileColor = p.color || category?.color || null;
      const tileStyle = tileColor ? `box-shadow: inset 0 3px 0 ${tileColor};` : '';
      const thumbStyle = tileColor && !p.image_data ? `background:${tileColor}22; color:${tileColor};` : '';
      return `
        <button class="pos-product-tile" data-id="${p.id}" style="${tileStyle}" ${outOfStock ? 'disabled' : ''}>
          <span class="corner tl" data-action="add" data-id="${p.id}" title="Agregar y personalizar (cantidad, modificadores...)">${icon('plus', 13)}</span>
          <span class="corner tr" data-action="fav" data-id="${p.id}" title="Favorito" style="${isFav ? 'color:#161615' : ''}">${icon('star', 13)}</span>
          ${canManageCatalog ? `<span class="corner br" data-action="edit" data-id="${p.id}" title="Editar">${icon('edit', 13)}</span>` : ''}
          <div class="thumb" style="${thumbStyle}">${thumbContent}</div>
          <div class="pname">${p.name}</div>
          <div class="pprice">${formatMoney(p.sale_price, settings.currency)} · ${p.track_stock ? `${p.stock_qty} ${p.unit}` : 'sin control'}</div>
        </button>
      `;
    })
    .join('');

  productGrid.querySelectorAll('.pos-product-tile').forEach((tile) => {
    tile.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      const id = Number(tile.dataset.id);
      if (actionEl) {
        e.stopPropagation();
        const action = actionEl.dataset.action;
        if (action === 'fav') { toggleFavorite(id); renderProducts(); }
        else if (action === 'edit') window.location.href = '/inventory.html';
        else if (action === 'add') { const lineId = addToCart(id); if (lineId) openLineItemModal(lineId); }
        else addToCart(id);
        return;
      }
      addToCart(id);
    });
  });
}

// ---------- Carrito / ticket ----------
// Solo se junta con la línea de arriba si fue el MISMO producto agregado justo
// antes (toques seguidos, uno tras otro). Si en medio se agregó otra cosa, o si
// el mismo producto ya estaba en el ticket pero no fue lo último que se tocó, se
// crea una línea nueva y separada — así se pueden separar platos (por ejemplo,
// dos tacos de dos clientes distintos en la misma cuenta).
// Devuelve el lineId de la línea que quedó afectada (nueva o la que se sumó).
function addToCart(productId, qty = 1) {
  // No se puede vender "al aire" — hay que abrir una cuenta (mesa, para
  // llevar, a domicilio...) primero, para que cocina y el ticket siempre
  // sepan de dónde viene el pedido.
  if (!currentOrderType) {
    toast('Abre una cuenta (mesa, para llevar, etc.) antes de agregar productos.', 'error');
    openOrderTypeModal();
    return null;
  }
  const product = products.find((p) => p.id === productId);
  if (!product) return null;

  const totalQtyInCart = cart.filter((i) => i.productId === productId).reduce((s, i) => s + i.qty, 0);
  if (product.track_stock && totalQtyInCart + qty > product.stock_qty) {
    toast(`No hay suficiente stock de "${product.name}".`, 'error');
    return null;
  }

  // Solo se suma a la última línea si además de ser el mismo producto no
  // tiene ninguna personalización propia (persona, modificadores,
  // ingredientes, notas, descuento) — si no, un toque rápido de "Agua"
  // después de haberla personalizado para la Persona 2 le sumaría cantidad
  // A ESA línea en vez de crear una nueva para la persona que corresponde.
  const last = cart[cart.length - 1];
  const lastIsPlainMatch =
    last &&
    last.productId === productId &&
    (last.person || 1) === 1 &&
    !last.discount &&
    !(last.modifiers || []).length &&
    !(last.ingredients || []).length &&
    !last.note;
  let lineId;
  if (lastIsPlainMatch) {
    last.qty += qty;
    lineId = last.lineId;
  } else {
    lineId = nextLineId++;
    cart.push({
      lineId,
      productId: product.id,
      name: product.name,
      qty,
      unitPrice: product.sale_price,
      taxRate: product.tax_rate,
      discount: 0,
      stock: product.stock_qty,
      trackStock: !!product.track_stock,
      modifiers: [],
      ingredients: [],
      note: '',
    });
  }

  recentProductIds = [productId, ...recentProductIds.filter((id) => id !== productId)].slice(0, 24);
  renderCart();
  return lineId;
}

function changeQty(lineId, delta) {
  const item = cart.find((i) => i.lineId === lineId);
  if (!item) return;
  const product = products.find((p) => p.id === item.productId);
  const newQty = item.qty + delta;
  if (newQty <= 0) {
    cart = cart.filter((i) => i.lineId !== lineId);
  } else if (product && product.track_stock && newQty > product.stock_qty) {
    toast(`No hay suficiente stock de "${item.name}".`, 'error');
    return;
  } else {
    item.qty = newQty;
  }
  renderCart();
}

function lineTotals(item) {
  const lineSubtotal = item.unitPrice * item.qty - (item.discount || 0);
  const lineTax = lineSubtotal * (item.taxRate / 100);
  return { lineSubtotal, lineTax, lineTotal: lineSubtotal + lineTax };
}

function lineExtraText(item) {
  const parts = [];
  if (item.modifiers && item.modifiers.length) parts.push(item.modifiers.join(', '));
  if (item.ingredients && item.ingredients.length) parts.push(item.ingredients.join(', '));
  if (item.note) parts.push(item.note);
  return parts.join(' · ');
}

// ---------- Modal de detalle de línea (cantidad, modificadores, ingredientes) ----------
// Los modificadores/ingredientes "guardados" se recuerdan en este equipo (localStorage)
// para no tener que volver a escribirlos cada vez. Es una primera versión sencilla;
// más adelante se puede ligar cada modificador a un producto/categoría específico.
function savedChipList(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveChipList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* almacenamiento no disponible, se ignora */
  }
}

function openLineItemModal(lineId) {
  const item = cart.find((i) => i.lineId === lineId);
  if (!item) return;
  if (!item.modifiers) item.modifiers = [];
  if (!item.ingredients) item.ingredients = [];
  if (item.note === undefined) item.note = '';

  const product = products.find((p) => p.id === item.productId);
  const savedMods = savedChipList('pos_saved_modifiers');
  const savedIngs = savedChipList('pos_saved_ingredients');
  // Asegura que los modificadores/ingredientes ya elegidos en esta línea aparezcan como chip aunque sean nuevos.
  item.modifiers.forEach((m) => { if (!savedMods.includes(m)) savedMods.push(m); });
  item.ingredients.forEach((m) => { if (!savedIngs.includes(m)) savedIngs.push(m); });

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:560px;">
      <div class="flex" style="justify-content:space-between; align-items:center;">
        <h3 style="margin:0;">${item.name}</h3>
        <button class="ghost" id="li-close" title="Cerrar" style="padding:6px 10px;">${icon('x', 16)}</button>
      </div>
      <div class="field">
        <label>Cantidad</label>
        <div class="flex" style="align-items:center; gap:16px; justify-content:center; margin:8px 0 4px;">
          <button class="toolbtn" id="li-dec" style="width:42px; height:42px; padding:0;">${icon('minus', 18)}</button>
          <div id="li-qty" style="min-width:64px; text-align:center; font-size:22px; font-weight:700; background:var(--pos-surface-2); border-radius:var(--pos-radius); padding:8px 10px;">${item.qty}</div>
          <button class="toolbtn" id="li-inc" style="width:42px; height:42px; padding:0;">${icon('plus', 18)}</button>
        </div>
      </div>
      <div class="field">
        <div class="flex" style="justify-content:space-between; align-items:center;">
          <label style="margin:0;">Modificadores</label>
          <button type="button" class="link-btn" id="li-new-mod">+ Nuevo modificador</button>
        </div>
        <div id="li-mod-chips" class="chip-row"></div>
      </div>
      <div class="field">
        <div class="flex" style="justify-content:space-between; align-items:center;">
          <label style="margin:0;">Ingredientes o complementos</label>
          <button type="button" class="link-btn" id="li-new-ing">+ Nuevo</button>
        </div>
        <div id="li-ing-chips" class="chip-row"></div>
      </div>
      <div class="field">
        <label>Notas</label>
        <textarea id="li-note" rows="2" placeholder="Ej. sin bolsa, para regalo...">${item.note || ''}</textarea>
      </div>
      <div class="field">
        <div class="flex" style="justify-content:space-between; align-items:center;">
          <label style="margin:0;">Persona</label>
          <button type="button" class="link-btn" id="li-new-person">+ Persona</button>
        </div>
        <p class="text-secondary" style="margin:2px 0 6px; font-size:11.5px;">Para dividir la comanda de la mesa por persona (ej. cocina la manda separada por comensal).</p>
        <div id="li-person-chips" class="chip-row"></div>
      </div>
      <div class="modal-actions">
        <button class="ghost" id="li-cancel">Cancelar</button>
        <button class="primary" id="li-save">Guardar</button>
      </div>
    </div>
  `;
  shell.appendChild(overlay);

  const qtyEl = overlay.querySelector('#li-qty');
  let workingQty = item.qty;
  function refreshQty() { qtyEl.textContent = workingQty; }
  overlay.querySelector('#li-dec').addEventListener('click', () => {
    if (workingQty <= 1) return;
    workingQty -= 1;
    refreshQty();
  });
  overlay.querySelector('#li-inc').addEventListener('click', () => {
    if (product && product.track_stock && workingQty + 1 > product.stock_qty) {
      toast(`No hay suficiente stock de "${item.name}".`, 'error');
      return;
    }
    workingQty += 1;
    refreshQty();
  });

  let workingPerson = item.person || 1;
  function maxPersonInCart() {
    return cart.reduce((m, i) => Math.max(m, i.person || 1), 1);
  }
  function renderPersonChips() {
    const max = Math.max(10, maxPersonInCart(), workingPerson);
    const chipsEl = overlay.querySelector('#li-person-chips');
    chipsEl.innerHTML = Array.from({ length: max }, (_, idx) => idx + 1)
      .map((n) => `<button type="button" class="chip-btn ${n === workingPerson ? 'selected' : ''}" data-person="${n}">Persona ${n}</button>`)
      .join('');
    chipsEl.querySelectorAll('.chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        workingPerson = Number(btn.dataset.person);
        renderPersonChips();
      });
    });
  }
  renderPersonChips();
  overlay.querySelector('#li-new-person').addEventListener('click', () => {
    workingPerson = maxPersonInCart() + 1;
    renderPersonChips();
  });

  const workingMods = new Set(item.modifiers);
  const workingIngs = new Set(item.ingredients);

  function renderChips(container, list, workingSet) {
    container.innerHTML = list
      .map(
        (label) => `<button type="button" class="chip-btn ${workingSet.has(label) ? 'selected' : ''}" data-label="${label}">${label}</button>`
      )
      .join('');
    container.querySelectorAll('.chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const label = btn.dataset.label;
        if (workingSet.has(label)) workingSet.delete(label);
        else workingSet.add(label);
        btn.classList.toggle('selected');
      });
    });
  }
  const modChipsEl = overlay.querySelector('#li-mod-chips');
  const ingChipsEl = overlay.querySelector('#li-ing-chips');
  renderChips(modChipsEl, savedMods, workingMods);
  renderChips(ingChipsEl, savedIngs, workingIngs);

  overlay.querySelector('#li-new-mod').addEventListener('click', () => {
    const label = prompt('Nombre del modificador (ej. Sin cebolla, Extra queso...)');
    if (!label || !label.trim()) return;
    const clean = label.trim();
    if (!savedMods.includes(clean)) savedMods.push(clean);
    saveChipList('pos_saved_modifiers', savedMods);
    workingMods.add(clean);
    renderChips(modChipsEl, savedMods, workingMods);
  });
  overlay.querySelector('#li-new-ing').addEventListener('click', () => {
    const label = prompt('Nombre del ingrediente o complemento (ej. Queso extra, Papas...)');
    if (!label || !label.trim()) return;
    const clean = label.trim();
    if (!savedIngs.includes(clean)) savedIngs.push(clean);
    saveChipList('pos_saved_ingredients', savedIngs);
    workingIngs.add(clean);
    renderChips(ingChipsEl, savedIngs, workingIngs);
  });

  function close() { overlay.remove(); }
  overlay.querySelector('#li-close').addEventListener('click', close);
  overlay.querySelector('#li-cancel').addEventListener('click', close);
  overlay.querySelector('#li-save').addEventListener('click', () => {
    item.qty = workingQty;
    item.person = workingPerson;
    item.modifiers = Array.from(workingMods);
    item.ingredients = Array.from(workingIngs);
    item.note = overlay.querySelector('#li-note').value.trim();
    close();
    renderCart();
  });
}

function renderCart() {
  ticketEmpty.style.display = cart.length === 0 ? 'flex' : 'none';

  // La etiqueta "Persona N" solo se muestra si de verdad se está dividiendo
  // la cuenta por persona (más de una persona en uso) — si todos son
  // "Persona 1" (el caso normal), no ensucia la vista con algo irrelevante.
  const splitByPerson = cart.some((i) => (i.person || 1) > 1);

  ticketBody.innerHTML = cart
    .map((i) => {
      const { lineTotal } = lineTotals(i);
      return `
        <tr data-id="${i.lineId}">
          <td>
            <div class="qty-controls">
              <button data-action="dec" data-id="${i.lineId}">−</button>
              <span>${i.qty}</span>
              <button data-action="inc" data-id="${i.lineId}">+</button>
            </div>
          </td>
          <td class="line-name" data-id="${i.lineId}">
            ${splitByPerson ? `<span class="chip-btn selected" style="padding:1px 8px; font-size:10.5px; margin-right:4px;">P${i.person || 1}</span>` : ''}
            <span class="pname">${i.name}</span>
            ${lineExtraText(i) ? `<span class="line-extra">${lineExtraText(i)}</span>` : ''}
          </td>
          <td class="num">
            <input type="number" min="0" step="0.01" value="${i.discount || 0}" data-action="discount" data-id="${i.lineId}"
              style="width:56px; text-align:right; padding:3px 4px; font-size:12px;" />
          </td>
          <td class="num">${formatMoney(i.unitPrice, settings.currency)}</td>
          <td class="num">${formatMoney(lineTotal, settings.currency)}</td>
          <td><button class="row-remove" data-action="remove" data-id="${i.lineId}" title="Quitar">${icon('x', 14)}</button></td>
        </tr>
      `;
    })
    .join('');

  ticketBody.querySelectorAll('button[data-action]').forEach((btn) => {
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;
    btn.addEventListener('click', () => {
      if (action === 'inc') changeQty(id, 1);
      if (action === 'dec') changeQty(id, -1);
      if (action === 'remove') { cart = cart.filter((i) => i.lineId !== id); renderCart(); }
    });
  });
  ticketBody.querySelectorAll('.line-name').forEach((td) => {
    td.addEventListener('click', () => openLineItemModal(Number(td.dataset.id)));
  });
  ticketBody.querySelectorAll('input[data-action="discount"]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = Number(input.dataset.id);
      const item = cart.find((i) => i.lineId === id);
      if (!item) return;
      item.discount = Math.max(0, Number(input.value) || 0);
      renderCart();
    });
  });

  const subtotalGross = cart.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const discountTotal = cart.reduce((s, i) => s + (i.discount || 0), 0);
  const taxTotal = cart.reduce((s, i) => s + lineTotals(i).lineTax, 0);
  const total = cart.reduce((s, i) => s + lineTotals(i).lineTotal, 0);

  document.getElementById('item-count').textContent = cart.reduce((s, i) => s + i.qty, 0);
  document.getElementById('sum-subtotal').textContent = formatMoney(subtotalGross, settings.currency);
  document.getElementById('sum-discount').textContent = formatMoney(discountTotal, settings.currency);
  document.getElementById('sum-tax').textContent = formatMoney(taxTotal, settings.currency);
  document.getElementById('sum-total').textContent = formatMoney(total, settings.currency);
  document.getElementById('estado-label').textContent = cart.length ? 'Ticket abierto' : 'Sin ticket activo';
  document.getElementById('pay-btn').textContent = `Pagar ${formatMoney(total, settings.currency)}`;
}

function buildTicketQuickActions() {
  const buttons = [
    toolButton({
      id: 'newproduct', ico: 'box', label: 'Nuevo prod.',
      onClick: canManageCatalog ? () => (window.location.href = '/inventory.html') : stub('Nuevo producto (requiere permisos)'),
    }),
    toolButton({ id: 'saveaccount', ico: 'save', label: 'Guardar', onClick: () => saveCurrentAccountManually() }),
    toolButton({ id: 'sendkitchen', ico: 'send', label: 'Enviar', onClick: () => printKitchenTicket() }),
  ];
  renderToolbar(ticketQuickActions, applyToolbarLayout(buttons, effectiveIds('quick')));
}

async function newSale() {
  const hasSomething = cart.length > 0 || !!currentOrderType;
  const message = currentOrderType
    ? `¿Cancelar la cuenta "${currentOrderType.label}"? Se pierde por completo, no queda guardada.`
    : '¿Descartar el ticket actual y empezar uno nuevo?';
  if (hasSomething && !confirm(message)) return;
  if (currentAccountHeldId) {
    try {
      await api.delete(`/api/held-sales/${currentAccountHeldId}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  cart = [];
  ticketNote = '';
  selectedCustomerId = null;
  currentAccountHeldId = null;
  setOrderType(null);
  renderCustomerOptions();
  renderCart();
  await refreshHeldSales();
}

document.getElementById('cancel-btn').addEventListener('click', newSale);

let searchDebounce;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderProducts, 120);
});

// Soporte para lectores de código de barras: Enter con coincidencia exacta agrega directo.
searchInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const query = searchInput.value.trim();
  if (!query) return;
  const match = products.find((p) => p.barcode === query || p.sku === query);
  if (match) {
    addToCart(match.id);
    searchInput.value = '';
    renderProducts();
  }
});

// ---------- Atajos de teclado ----------
document.addEventListener('keydown', (e) => {
  if (e.key === 'F8') {
    e.preventDefault();
    searchInput.focus();
  }
});

// ---------- Cliente rápido ----------
document.getElementById('edit-customer-btn').addEventListener('click', () => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Nuevo cliente rápido</h3>
      <div class="field"><label>Nombre</label><input id="qc-name" /></div>
      <div class="field"><label>Teléfono (opcional)</label><input id="qc-phone" /></div>
      <div class="modal-actions">
        <button class="ghost" id="qc-cancel">Cancelar</button>
        <button class="primary" id="qc-save">Guardar</button>
      </div>
    </div>
  `;
  shell.appendChild(overlay);
  overlay.querySelector('#qc-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#qc-save').addEventListener('click', async () => {
    const name = overlay.querySelector('#qc-name').value.trim();
    if (!name) { toast('El nombre es requerido.', 'error'); return; }
    try {
      const res = await api.post('/api/customers', { name, phone: overlay.querySelector('#qc-phone').value.trim() });
      const customersRes = await api.get('/api/customers');
      customers = customersRes.customers;
      renderCustomerOptions();
      customerSelect.value = res.id;
      selectedCustomerId = res.id;
      overlay.remove();
      toast('Cliente creado.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
});

// ---------- Cuentas (mesa / para llevar / a domicilio / plataforma) ----------
// Pueden quedar varias abiertas a la vez (una por mesa, una para llevar,
// etc.) y se pueden juntar entre sí. La cuenta que no está en pantalla se
// guarda como "venta en espera" (held_sales) hasta que se retoma.
function setOrderType(orderType) {
  currentOrderType = orderType;
  const el = document.getElementById('order-type-meta');
  if (orderType) {
    el.textContent = orderType.label;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

// Guarda la cuenta que está en pantalla ahorita, ya sea creándola en
// held_sales (primera vez) o actualizando la misma fila de siempre (si ya
// tenía una) — así una cuenta conserva el mismo id durante toda su vida en
// vez de borrarse y recrearse cada vez. Se llama sola al abrir/cambiar de
// cuenta, y también la dispara el botón "Guardar".
async function persistCurrentAccount() {
  if (cart.length === 0 && !currentOrderType && !currentAccountHeldId) return;
  const customerName = customerSelect.selectedOptions[0]?.textContent || null;
  const payload = {
    customer_id: selectedCustomerId || null,
    customer_name: currentOrderType?.label || customerName,
    note: ticketNote || null,
    items: cart,
    order_type: currentOrderType || null,
  };
  try {
    if (currentAccountHeldId) {
      await api.put(`/api/held-sales/${currentAccountHeldId}`, payload);
    } else if (cart.length > 0 || currentOrderType) {
      const res = await api.post('/api/held-sales', payload);
      currentAccountHeldId = res.id;
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Guardado explícito (botón "Guardar"): igual que arriba, pero con aviso en
// pantalla, para cuando el cajero/mesero quiere confirmar que sí quedó.
async function saveCurrentAccountManually() {
  if (cart.length === 0 && !currentOrderType) {
    toast('No hay nada que guardar todavía.', 'info');
    return;
  }
  await persistCurrentAccount();
  await refreshHeldSales();
  toast(currentOrderType ? `Cuenta "${currentOrderType.label}" guardada.` : 'Cuenta guardada.', 'success');
}

async function startNewAccount(orderType) {
  await persistCurrentAccount();
  cart = [];
  ticketNote = '';
  selectedCustomerId = null;
  currentAccountHeldId = null;
  setOrderType(orderType);
  renderCustomerOptions(); // refleja el nombre escrito al abrir la cuenta (si trae uno) en "Cliente"
  renderCart();
  await persistCurrentAccount(); // crea de inmediato el respaldo de la cuenta nueva, aunque esté vacía
  await refreshHeldSales();
  toast(`Cuenta abierta: ${orderType.label}.`, 'success');
}

async function switchToHeldAccount(id) {
  const held = heldSales.find((h) => h.id === id);
  if (!held) return;
  await persistCurrentAccount();

  // Cada línea recibe un lineId nuevo al restaurar (las cuentas guardadas antes
  // de esta función no traían lineId, y aunque lo trajeran, así se evita
  // cualquier choque con líneas de otra cuenta que ya estén en pantalla).
  const restoredCart = held.items.map((i) => {
    const lineId = nextLineId++;
    const product = products.find((p) => p.id === i.productId);
    if (product) {
      return {
        lineId,
        productId: product.id,
        name: product.name,
        qty: i.qty,
        unitPrice: product.sale_price,
        taxRate: product.tax_rate,
        discount: i.discount || 0,
        stock: product.stock_qty,
        trackStock: !!product.track_stock,
        modifiers: i.modifiers || [],
        ingredients: i.ingredients || [],
        note: i.note || '',
        person: i.person || 1,
      };
    }
    toast(`"${i.name}" ya no está disponible en el catálogo; se agregó con el precio guardado.`, 'info');
    return { ...i, lineId, stock: 0, trackStock: false };
  });

  cart = restoredCart;
  ticketNote = held.note || '';
  selectedCustomerId = held.customer_id || null;
  setOrderType(held.order_type || null);
  currentAccountHeldId = held.id; // seguimos respaldados por el MISMO id, no se borra ni se recrea
  renderCustomerOptions(); // refleja el cliente real o el nombre escrito de esta cuenta en "Cliente"
  renderCart();
  await refreshHeldSales();
  toast('Cuenta abierta.', 'success');
}

function accountLabel(entry) {
  if (entry.order_type) return entry.order_type.label;
  return entry.customer_name || 'Cuenta sin nombre';
}

async function mergeAccounts(selectedRefs, entries) {
  const selectedEntries = selectedRefs
    .map((ref) => entries.find((e) => e.source === ref.source && String(e.id) === String(ref.id)))
    .filter(Boolean);
  if (selectedEntries.length < 2) return;

  const defaultLabel = selectedEntries.map((e) => accountLabel(e)).join(' + ');
  const finalLabel = (prompt('Nombre para la cuenta junta:', defaultLabel) || '').trim() || defaultLabel;

  // Se les da un lineId nuevo a todas para evitar choques entre líneas que
  // venían de cuentas distintas (por ejemplo, si ambas tenían una línea con
  // lineId=1 por haberse creado por separado).
  const mergedItems = selectedEntries.flatMap((e) => e.items).map((i) => ({ ...i, lineId: nextLineId++ }));
  const includesCurrent = selectedEntries.some((e) => e.source === 'current');
  const heldToDelete = selectedEntries.filter((e) => e.source === 'held').map((e) => e.id);

  try {
    if (includesCurrent) {
      cart = mergedItems;
      setOrderType({ type: 'merged', label: finalLabel });
      renderCart();
      await persistCurrentAccount();
      for (const id of heldToDelete) await api.delete(`/api/held-sales/${id}`);
    } else {
      await api.post('/api/held-sales', {
        customer_name: finalLabel,
        items: mergedItems,
        order_type: { type: 'merged', label: finalLabel },
      });
      for (const id of heldToDelete) await api.delete(`/api/held-sales/${id}`);
    }
    await refreshHeldSales();
    toast('Cuentas juntadas.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Modal "Cuentas": ver/cambiar cuentas abiertas, juntar varias, o abrir una nueva ----------
// Elimina la cuenta que está en pantalla ahorita: borra su respaldo (si ya
// tenía uno) y deja el ticket en blanco. Comparte lógica con "Cancelar".
async function discardCurrentAccount() {
  if (currentAccountHeldId) {
    try {
      await api.delete(`/api/held-sales/${currentAccountHeldId}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  cart = [];
  ticketNote = '';
  selectedCustomerId = null;
  currentAccountHeldId = null;
  setOrderType(null);
  renderCustomerOptions();
  renderCart();
  await refreshHeldSales();
}

async function openAccountsModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:560px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <h3 style="margin:0;">Cuentas</h3>
        <button class="icon-btn" id="acc-merge-icon" disabled title="Marca 2 o más cuentas para juntarlas">${icon('merge', 20)}</button>
      </div>
      <p class="text-secondary">Abre una cuenta nueva, cambia a otra que ya esté abierta, o marca varias y toca el ícono de juntar.</p>
      <button class="primary" id="acc-new" style="width:100%; margin:10px 0 16px;">+ Nueva cuenta</button>
      <div id="accounts-list"><p class="text-secondary">Cargando…</p></div>
      <div class="modal-actions">
        <button class="ghost" id="acc-close">Cerrar</button>
      </div>
    </div>
  `;
  shell.appendChild(overlay);
  overlay.querySelector('#acc-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#acc-new').addEventListener('click', () => openOrderTypeModal(null, overlay));

  // Vuelve a pedir las cuentas al servidor cada vez que se abre este modal —
  // si no, se mostraba la lista tal como quedó la última vez que ESTA
  // pantalla guardó/mandó algo, y no reflejaba lo que se hubiera guardado o
  // enviado mientras tanto desde el Comandero (u otra terminal), hasta
  // recargar la página entera.
  try {
    heldSales = (await api.get('/api/held-sales')).heldSales;
  } catch (err) {
    toast(err.message, 'error');
  }
  if (!overlay.isConnected) return; // se cerró mientras cargaba
  renderAccountsList(overlay);
}

function renderAccountsList(overlay) {
  const listEl = overlay.querySelector('#accounts-list');
  const entries = [];
  if (cart.length > 0 || currentOrderType) {
    entries.push({
      source: 'current',
      id: 'current',
      order_type: currentOrderType,
      items: cart,
      customer_name: customerSelect.selectedOptions[0]?.textContent,
    });
  }
  heldSales.forEach((h) => {
    if (h.id === currentAccountHeldId) return; // ya se muestra como "current" (misma cuenta, mismo id)
    entries.push({ source: 'held', id: h.id, order_type: h.order_type, items: h.items, customer_name: h.customer_name });
  });

  if (entries.length === 0) {
    listEl.innerHTML = '<p class="text-secondary">No hay cuentas abiertas todavía.</p>';
  } else {
    listEl.innerHTML = entries
      .map(
        (e) => `
      <div class="held-sale-row" style="display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--pos-line, #e5e5e3);">
        <input type="checkbox" class="acc-check" data-source="${e.source}" data-id="${e.id}" style="width:16px; height:16px; flex:0 0 auto;" />
        <div style="flex:1 1 auto; min-width:0;">
          <div style="font-weight:600; font-size:13px;">
            ${accountLabel(e)}${e.source === 'current' ? ' <span style="color:var(--pos-accent, #2e7d32); font-weight:700;">(en pantalla)</span>' : ''}
            · ${formatMoney(heldSaleTotal(e), settings.currency)}
          </div>
          <div class="text-secondary" style="font-size:11.5px;">${e.items.length} artículo(s)${e.order_type?.detail ? ' · ' + e.order_type.detail : ''}</div>
        </div>
        ${
          e.source === 'held'
            ? `<button class="ghost" data-action="switch" data-id="${e.id}" style="flex:0 0 auto; white-space:nowrap; width:auto;">Cambiar a esta</button>
               <button class="ghost" data-action="discard" data-id="${e.id}" title="Eliminar cuenta" style="flex:0 0 auto; width:auto;">${icon('trash', 16)}</button>`
            : `<button class="ghost" data-action="discard-current" title="Eliminar cuenta" style="flex:0 0 auto; width:auto;">${icon('trash', 16)}</button>`
        }
      </div>
    `
      )
      .join('');
  }

  listEl.querySelectorAll('button[data-action="switch"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await switchToHeldAccount(Number(btn.dataset.id));
      overlay.remove();
    });
  });
  listEl.querySelectorAll('button[data-action="discard"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta cuenta? No se puede deshacer.')) return;
      try {
        await api.delete(`/api/held-sales/${btn.dataset.id}`);
        await refreshHeldSales();
        renderAccountsList(overlay);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
  listEl.querySelectorAll('button[data-action="discard-current"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta cuenta? Se descarta el ticket actual por completo, no se puede deshacer.')) return;
      await discardCurrentAccount();
      renderAccountsList(overlay);
    });
  });

  const mergeIconBtn = overlay.querySelector('#acc-merge-icon');
  listEl.querySelectorAll('.acc-check').forEach((chk) => {
    chk.addEventListener('change', () => {
      const checked = listEl.querySelectorAll('.acc-check:checked');
      mergeIconBtn.disabled = checked.length < 2;
    });
  });
  mergeIconBtn.onclick = async () => {
    const checked = [...listEl.querySelectorAll('.acc-check:checked')].map((c) => ({
      source: c.dataset.source,
      id: c.dataset.source === 'current' ? 'current' : Number(c.dataset.id),
    }));
    await mergeAccounts(checked, entries);
    overlay.remove();
  };
}

function openOrderTypeModal(preset, parentOverlay) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px;">
      <h3>Nueva cuenta</h3>
      <p class="text-secondary">Elige el tipo de cuenta.</p>
      <div id="order-type-options" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:14px 0;"></div>
      <div id="order-type-extra"></div>
      <div class="modal-actions">
        <button class="ghost" id="ot-cancel">Cancelar</button>
      </div>
    </div>
  `;
  shell.appendChild(overlay);
  overlay.querySelector('#ot-cancel').addEventListener('click', () => overlay.remove());

  const TYPES = [
    { type: 'table', ico: 'utensils', label: 'En mesa' },
    { type: 'takeaway', ico: 'bag', label: 'Para llevar' },
    { type: 'delivery', ico: 'truck', label: 'A domicilio' },
    { type: 'platform', ico: 'tabletSmartphone', label: 'Plataforma digital' },
  ];
  const optionsEl = overlay.querySelector('#order-type-options');
  optionsEl.innerHTML = TYPES.map(
    (t) => `
      <button type="button" class="ghost" data-type="${t.type}" style="display:flex; flex-direction:column; align-items:center; gap:6px; padding:16px 8px;">
        ${icon(t.ico, 24)}<span>${t.label}</span>
      </button>
    `
  ).join('');
  optionsEl.querySelectorAll('button[data-type]').forEach((btn) => {
    btn.addEventListener('click', () => showOrderTypeExtra(btn.dataset.type, overlay, parentOverlay));
  });

  if (preset) showOrderTypeExtra(preset, overlay, parentOverlay);
}

function showOrderTypeExtra(type, overlay, parentOverlay) {
  const extra = overlay.querySelector('#order-type-extra');
  const confirmAndClose = (orderType) => {
    startNewAccount(orderType);
    overlay.remove();
    if (parentOverlay) parentOverlay.remove();
  };

  if (type === 'table') {
    extra.innerHTML = `
      <div class="field"><label>Número o nombre de mesa</label><input id="ot-table" placeholder="Ej. 5" /></div>
      <div class="field"><label>Nombre del cliente (opcional)</label><input id="ot-name" placeholder="Ej. Familia Pérez" /></div>
      <button class="primary" id="ot-confirm" style="width:100%;">Abrir cuenta</button>
    `;
    extra.querySelector('#ot-confirm').addEventListener('click', () => {
      const table = extra.querySelector('#ot-table').value.trim();
      const name = extra.querySelector('#ot-name').value.trim();
      if (!table) { toast('Indica el número o nombre de la mesa.', 'error'); return; }
      confirmAndClose({ type, label: `Mesa ${table}${name ? ' · ' + name : ''}`, customer_name: name || null });
    });
  } else if (type === 'takeaway') {
    extra.innerHTML = `
      <div class="field"><label>Nombre del cliente</label><input id="ot-name" placeholder="Ej. Juan" /></div>
      <button class="primary" id="ot-confirm" style="width:100%;">Abrir cuenta</button>
    `;
    extra.querySelector('#ot-confirm').addEventListener('click', () => {
      const name = extra.querySelector('#ot-name').value.trim();
      confirmAndClose({ type, label: `Para llevar${name ? ' · ' + name : ''}`, customer_name: name || null });
    });
  } else if (type === 'delivery') {
    extra.innerHTML = `
      <div class="field"><label>Nombre del cliente</label><input id="ot-name" /></div>
      <div class="field"><label>Dirección de entrega</label><input id="ot-address" /></div>
      <div class="field"><label>Teléfono</label><input id="ot-phone" /></div>
      <button class="primary" id="ot-confirm" style="width:100%;">Abrir cuenta</button>
    `;
    extra.querySelector('#ot-confirm').addEventListener('click', () => {
      const name = extra.querySelector('#ot-name').value.trim();
      const address = extra.querySelector('#ot-address').value.trim();
      const phone = extra.querySelector('#ot-phone').value.trim();
      if (!address) { toast('Indica la dirección de entrega.', 'error'); return; }
      confirmAndClose({
        type,
        label: `A domicilio${name ? ' · ' + name : ''}`,
        detail: [address, phone].filter(Boolean).join(' · '),
        customer_name: name || null,
      });
    });
  } else if (type === 'platform') {
    extra.innerHTML = `
      <div class="field">
        <label>Plataforma</label>
        <select id="ot-platform">
          <option>Uber Eats</option>
          <option>Rappi</option>
          <option>Didi Food</option>
          <option>Otra</option>
        </select>
      </div>
      <div class="field"><label>No. de pedido (opcional)</label><input id="ot-order-id" /></div>
      <button class="primary" id="ot-confirm" style="width:100%;">Abrir cuenta</button>
    `;
    extra.querySelector('#ot-confirm').addEventListener('click', () => {
      const platform = extra.querySelector('#ot-platform').value;
      const orderId = extra.querySelector('#ot-order-id').value.trim();
      confirmAndClose({ type, label: `Plataforma: ${platform}`, detail: orderId ? `Pedido #${orderId}` : '' });
    });
  }
}

// ---------- Menú: catálogo completo agrupado por categoría, para ver todo de un vistazo ----------
// ---------- Notas tipo "sticky note": pizarrón compartido de la terminal ----------
const STICKY_COLORS = {
  yellow: '#fff394',
  pink: '#ffd0e0',
  blue: '#cfe8ff',
  green: '#d6f5d6',
  orange: '#ffdcb3',
};
let stickyZTop = 850;

// Las notas nuevas se acomodan en fila (no en diagonal encimada) para que
// una nota nueva no tape los botones de la anterior; si se sale de la
// pantalla, empieza otra fila.
function nextNotePosition(fromX, fromY) {
  const maxX = Math.max(320, window.innerWidth - 260);
  const maxY = Math.max(320, window.innerHeight - 260);
  let x = fromX + 250;
  let y = fromY;
  if (x > maxX) {
    x = 40;
    y = fromY + 260;
  }
  if (y > maxY) y = 40;
  return { x, y };
}

async function openStickyNotesBoard() {
  document.querySelectorAll('.sticky-note').forEach((el) => el.remove());
  try {
    const res = await api.get('/api/notes');
    let notes = res.notes;
    if (notes.length === 0) {
      const created = await api.post('/api/notes', { content: '', pos_x: 40, pos_y: 40 });
      notes = [created.note];
    }
    notes.forEach((n) => renderStickyNote(n));
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderStickyNote(note) {
  const card = document.createElement('div');
  card.className = 'sticky-note';
  card.dataset.id = note.id;
  card.dataset.color = note.color || 'yellow';
  stickyZTop += 1;
  card.style.cssText = `
    position: fixed; left: ${note.pos_x}px; top: ${note.pos_y}px; width: 230px;
    background: ${STICKY_COLORS[note.color] || STICKY_COLORS.yellow}; border-radius: 3px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.25); z-index: ${stickyZTop}; font-family: system-ui, sans-serif;
    display: flex; flex-direction: column; overflow: hidden;
  `;
  card.innerHTML = `
    <div class="sticky-note-head" style="display:flex; justify-content:flex-end; gap:4px; padding:5px 6px; cursor:grab;">
      <button type="button" data-action="min" title="Minimizar" style="border:none; background:transparent; cursor:pointer; padding:2px; opacity:.6; line-height:0;">${icon('minus', 15)}</button>
      <button type="button" data-action="close" title="Cerrar" style="border:none; background:transparent; cursor:pointer; padding:2px; opacity:.6; line-height:0;">${icon('x', 15)}</button>
    </div>
    <div class="sticky-note-body" style="padding:0 12px 8px;">
      <textarea data-role="content" rows="6" placeholder="Escribe aquí…" style="width:100%; border:none; background:transparent; resize:vertical; font-family:inherit; font-size:13.5px; color:#2b2b2a; outline:none;">${note.content || ''}</textarea>
    </div>
    <div class="sticky-note-foot" style="display:flex; justify-content:space-between; padding:6px 10px; border-top:1px solid rgba(0,0,0,0.08);">
      <button type="button" data-action="add" title="Nueva nota" style="border:none; background:transparent; cursor:pointer; opacity:.65; line-height:0;">${icon('plus', 16)}</button>
      <button type="button" data-action="delete" title="Eliminar" style="border:none; background:transparent; cursor:pointer; opacity:.65; line-height:0;">${icon('trash', 16)}</button>
      <button type="button" data-action="color" title="Cambiar color" style="border:none; background:transparent; cursor:pointer; opacity:.65; line-height:0;">${icon('settings', 16)}</button>
      <button type="button" data-action="share" title="Copiar" style="border:none; background:transparent; cursor:pointer; opacity:.65; line-height:0;">${icon('share', 16)}</button>
    </div>
  `;
  shell.appendChild(card);

  const bringToFront = () => {
    stickyZTop += 1;
    card.style.zIndex = stickyZTop;
  };
  card.addEventListener('mousedown', bringToFront);

  const head = card.querySelector('.sticky-note-head');
  head.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = card.offsetLeft;
    const startTop = card.offsetTop;
    head.style.cursor = 'grabbing';
    function onMove(ev) {
      card.style.left = `${startLeft + (ev.clientX - startX)}px`;
      card.style.top = `${startTop + (ev.clientY - startY)}px`;
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      head.style.cursor = 'grab';
      persistNote(note.id, { pos_x: card.offsetLeft, pos_y: card.offsetTop });
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  const textarea = card.querySelector('[data-role="content"]');
  let saveDebounce;
  textarea.addEventListener('input', () => {
    clearTimeout(saveDebounce);
    saveDebounce = setTimeout(() => persistNote(note.id, { content: textarea.value }), 500);
  });

  card.querySelector('[data-action="min"]').addEventListener('click', () => {
    const collapsed = card.dataset.collapsed === '1';
    card.querySelector('.sticky-note-body').style.display = collapsed ? '' : 'none';
    card.querySelector('.sticky-note-foot').style.display = collapsed ? '' : 'none';
    card.dataset.collapsed = collapsed ? '0' : '1';
  });
  card.querySelector('[data-action="close"]').addEventListener('click', () => card.remove());
  card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta nota? No se puede deshacer.')) return;
    try {
      await api.delete(`/api/notes/${note.id}`);
      card.remove();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  card.querySelector('[data-action="add"]').addEventListener('click', async () => {
    try {
      const pos = nextNotePosition(card.offsetLeft, card.offsetTop);
      const created = await api.post('/api/notes', { content: '', pos_x: pos.x, pos_y: pos.y });
      renderStickyNote(created.note);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  card.querySelector('[data-action="color"]').addEventListener('click', () => {
    const colorKeys = Object.keys(STICKY_COLORS);
    const next = colorKeys[(colorKeys.indexOf(card.dataset.color) + 1) % colorKeys.length];
    card.dataset.color = next;
    card.style.background = STICKY_COLORS[next];
    persistNote(note.id, { color: next });
  });
  card.querySelector('[data-action="share"]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textarea.value);
      toast('Nota copiada al portapapeles.', 'success');
    } catch {
      toast('No se pudo copiar. Selecciona y copia el texto manualmente.', 'error');
    }
  });
}

async function persistNote(id, patch) {
  try {
    await api.put(`/api/notes/${id}`, patch);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Ventas en espera: base para las "Cuentas" (arriba). Cada cuenta
// que no está en pantalla se guarda aquí hasta que se retoma o se junta. ----------
function heldSaleTotal(held) {
  return held.items.reduce((s, i) => s + (i.unitPrice * i.qty - (i.discount || 0)) * (1 + (i.taxRate || 0) / 100), 0);
}

async function refreshHeldSales() {
  try {
    const res = await api.get('/api/held-sales');
    heldSales = res.heldSales;
    buildFunctionToolbar();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Calculadora ----------
function openCalculator() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:280px;">
      <h3>Calculadora</h3>
      <div id="calc-display" style="background:var(--pos-surface-2, #f4f4f2); border:1px solid var(--pos-line, #d8d8d6); border-radius:6px; padding:12px; text-align:right; font-size:26px; font-variant-numeric:tabular-nums; margin-bottom:10px; overflow-x:auto; white-space:nowrap;">0</div>
      <div id="calc-pad" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px;"></div>
      <div class="modal-actions">
        <button class="ghost" id="calc-close">Cerrar</button>
      </div>
    </div>
  `;
  shell.appendChild(overlay);

  const displayEl = overlay.querySelector('#calc-display');
  const pad = overlay.querySelector('#calc-pad');

  let display = '0';
  let accumulator = null;
  let pendingOp = null;
  let waitingForOperand = false;

  function render() { displayEl.textContent = display; }

  function inputDigit(d) {
    if (waitingForOperand) { display = d; waitingForOperand = false; }
    else { display = display === '0' ? d : display + d; }
    render();
  }
  function inputDecimal() {
    if (waitingForOperand) { display = '0.'; waitingForOperand = false; render(); return; }
    if (!display.includes('.')) { display += '.'; render(); }
  }
  function clearAll() { display = '0'; accumulator = null; pendingOp = null; waitingForOperand = false; render(); }
  function backspace() {
    display = display.length > 1 ? display.slice(0, -1) : '0';
    render();
  }
  function compute(a, b, op) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '×': return a * b;
      case '÷': return b === 0 ? NaN : a / b;
      default: return b;
    }
  }
  function setOperator(op) {
    const inputValue = Number(display);
    if (accumulator === null) {
      accumulator = inputValue;
    } else if (!waitingForOperand) {
      accumulator = compute(accumulator, inputValue, pendingOp);
      display = String(Number.isFinite(accumulator) ? Math.round(accumulator * 1e8) / 1e8 : 'Error');
      render();
    }
    pendingOp = op;
    waitingForOperand = true;
  }
  function equals() {
    if (pendingOp === null) return;
    const inputValue = Number(display);
    const result = compute(accumulator, inputValue, pendingOp);
    display = String(Number.isFinite(result) ? Math.round(result * 1e8) / 1e8 : 'Error');
    accumulator = null;
    pendingOp = null;
    waitingForOperand = true;
    render();
  }

  const keys = [
    { label: 'C', kind: 'fn', action: clearAll },
    { label: '⌫', kind: 'fn', action: backspace },
    { label: '%', kind: 'fn', action: () => { display = String(Number(display) / 100); render(); } },
    { label: '÷', kind: 'op', action: () => setOperator('÷') },
    { label: '7', kind: 'num', action: () => inputDigit('7') },
    { label: '8', kind: 'num', action: () => inputDigit('8') },
    { label: '9', kind: 'num', action: () => inputDigit('9') },
    { label: '×', kind: 'op', action: () => setOperator('×') },
    { label: '4', kind: 'num', action: () => inputDigit('4') },
    { label: '5', kind: 'num', action: () => inputDigit('5') },
    { label: '6', kind: 'num', action: () => inputDigit('6') },
    { label: '-', kind: 'op', action: () => setOperator('-') },
    { label: '1', kind: 'num', action: () => inputDigit('1') },
    { label: '2', kind: 'num', action: () => inputDigit('2') },
    { label: '3', kind: 'num', action: () => inputDigit('3') },
    { label: '+', kind: 'op', action: () => setOperator('+') },
    { label: '0', kind: 'num wide', action: () => inputDigit('0') },
    { label: '.', kind: 'num', action: inputDecimal },
    { label: '=', kind: 'op wide', action: equals },
  ];

  pad.innerHTML = keys
    .map(
      (k, i) =>
        `<button data-i="${i}" style="grid-column: span ${k.kind.includes('wide') ? 2 : 1}; padding:14px 0; font-size:16px; border-radius:6px; border:1px solid var(--pos-line-strong, #b9b9b6); background:${k.kind.startsWith('op') ? 'var(--pos-ink, #161615)' : 'var(--pos-surface, #fff)'}; color:${k.kind.startsWith('op') ? '#fff' : 'var(--pos-ink, #161615)'};">${k.label}</button>`
    )
    .join('');
  pad.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => keys[Number(btn.dataset.i)].action());
  });

  overlay.querySelector('#calc-close').addEventListener('click', () => overlay.remove());
}

// ---------- Cobro ----------
function startCheckout() {
  if (cart.length === 0) {
    toast('Agrega al menos un producto al ticket.', 'error');
    return;
  }
  openCheckoutModal();
}
document.getElementById('pay-btn').addEventListener('click', startCheckout);

// Sugiere montos de efectivo "redondos" que el cliente pudo haber dado, para
// no tener que calcular el cambio a mano: empieza con el siguiente múltiplo
// de 10 arriba del total, y le siguen billetes comunes que lo superen, hasta
// un máximo de 4 botones.
function computeQuickCashAmounts(total) {
  if (total <= 0) return [];
  const roundedUp10 = Math.ceil((total + 0.01) / 10) * 10;
  const biggerBills = CASH_DENOMINATIONS.filter((b) => b > total && b !== roundedUp10);
  const amounts = Array.from(new Set([roundedUp10, ...biggerBills])).sort((a, b) => a - b);
  return amounts.slice(0, 4);
}

function openCheckoutModal() {
  const total = cart.reduce((s, i) => s + lineTotals(i).lineTotal, 0);
  const customMethods = customPaymentMethods(); // [{name, surchargePct}]
  const allMethodNames = ['cash', ...customMethods.map((m) => m.name)];
  function surchargeFor(methodName) {
    const m = customMethods.find((x) => x.name === methodName);
    return m ? m.surchargePct : 0;
  }
  let mode = 'single'; // 'single' | 'split'
  let selectedMethod = 'cash';
  // Cada fila de "Dividir": { method, amount }
  let splitRows = [{ method: 'cash', amount: total }];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal checkout-modal">
      <div class="checkout-header">
        <h3>Cobrar</h3>
        <button type="button" class="checkout-split-btn" id="toggle-split">Dividir</button>
      </div>
      <div class="checkout-total">
        <div class="checkout-total-label">Total a pagar</div>
        <div class="checkout-total-amount">${formatMoney(total, settings.currency)}</div>
      </div>

      <div id="single-payment-view">
        <div class="checkout-methods" id="checkout-methods">
          ${allMethodNames
            .map(
              (m, idx) =>
                `<button type="button" class="method-btn ${idx === 0 ? 'selected' : ''}" data-method="${m}">${m === 'cash' ? 'Efectivo' : m}</button>`
            )
            .join('')}
        </div>
        <div id="cash-fields">
          <div class="field">
            <label>Monto recibido</label>
            <input type="number" id="payment-amount" step="0.01" value="${total.toFixed(2)}" />
          </div>
          <div class="checkout-quick-amounts" id="quick-amounts"></div>
          <div id="change-due" class="checkout-change"></div>
        </div>
        <div class="checkout-total surcharge-total" id="surcharge-total-block" style="display:none;">
          <div class="checkout-total-label" id="surcharge-total-label"></div>
          <div class="checkout-total-amount" id="surcharge-total-amount"></div>
        </div>
      </div>

      <div id="split-payment-view" style="display:none;">
        <div id="split-rows"></div>
        <button type="button" class="split-add-btn" id="add-split-row">+ Agregar pago</button>
        <div id="split-surcharge-notes"></div>
        <div id="split-remaining" class="checkout-change"></div>
      </div>

      <div class="modal-actions">
        <button class="ghost" id="cancel-checkout">Cancelar</button>
        <button class="primary" id="confirm-checkout">Cobrar</button>
      </div>
    </div>
  `;
  shell.appendChild(overlay);

  const singleView = overlay.querySelector('#single-payment-view');
  const splitView = overlay.querySelector('#split-payment-view');
  const splitToggleBtn = overlay.querySelector('#toggle-split');
  const methodsRow = overlay.querySelector('#checkout-methods');
  const cashFields = overlay.querySelector('#cash-fields');
  const amountInput = overlay.querySelector('#payment-amount');
  const quickAmountsEl = overlay.querySelector('#quick-amounts');
  const changeDue = overlay.querySelector('#change-due');
  const surchargeTotalBlock = overlay.querySelector('#surcharge-total-block');
  const surchargeTotalLabel = overlay.querySelector('#surcharge-total-label');
  const surchargeTotalAmount = overlay.querySelector('#surcharge-total-amount');
  const confirmBtn = overlay.querySelector('#confirm-checkout');
  const splitRowsEl = overlay.querySelector('#split-rows');
  const splitRemainingEl = overlay.querySelector('#split-remaining');
  const splitSurchargeNotesEl = overlay.querySelector('#split-surcharge-notes');

  // ---- Vista de un solo pago ----
  function renderQuickAmounts() {
    const suggestions = computeQuickCashAmounts(total);
    quickAmountsEl.innerHTML = suggestions
      .map((amt) => `<button type="button" class="quick-amount-btn" data-amount="${amt}">${formatMoney(amt, settings.currency)}</button>`)
      .join('');
    quickAmountsEl.querySelectorAll('.quick-amount-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        amountInput.value = btn.dataset.amount;
        updateChange();
      });
    });
  }
  function updateChange() {
    const received = Number(amountInput.value || 0);
    const diff = received - total;
    changeDue.classList.remove('ok', 'short');
    if (diff >= 0) {
      changeDue.textContent = `Cambio: ${formatMoney(diff, settings.currency)}`;
      changeDue.classList.add('ok');
    } else {
      changeDue.textContent = `Falta: ${formatMoney(-diff, settings.currency)}`;
      changeDue.classList.add('short');
    }
    quickAmountsEl.querySelectorAll('.quick-amount-btn').forEach((btn) => {
      btn.classList.toggle('selected', Number(btn.dataset.amount) === received);
    });
  }
  amountInput.addEventListener('input', updateChange);
  renderQuickAmounts();
  updateChange();

  function selectMethod(method) {
    selectedMethod = method;
    methodsRow.querySelectorAll('.method-btn').forEach((btn) => btn.classList.toggle('selected', btn.dataset.method === method));
    cashFields.style.display = method === 'cash' ? '' : 'none';
    if (method === 'cash') {
      amountInput.value = total.toFixed(2);
      updateChange();
      surchargeTotalBlock.style.display = 'none';
    } else {
      const pct = surchargeFor(method);
      if (pct > 0) {
        const withSurcharge = total * (1 + pct / 100);
        surchargeTotalLabel.textContent = `Cobra en la terminal (con ${pct}% de recargo)`;
        surchargeTotalAmount.textContent = formatMoney(withSurcharge, settings.currency);
        surchargeTotalBlock.style.display = '';
      } else {
        surchargeTotalBlock.style.display = 'none';
      }
    }
  }
  methodsRow.querySelectorAll('.method-btn').forEach((btn) => {
    btn.addEventListener('click', () => selectMethod(btn.dataset.method));
  });

  // ---- Vista "Dividir" (varios pagos que suman el total) ----
  function splitSum() {
    return splitRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  }
  function renderSplitRows() {
    splitRowsEl.innerHTML = splitRows
      .map(
        (row, idx) => `
        <div class="split-row" data-idx="${idx}">
          <select class="split-method" data-idx="${idx}">
            ${allMethodNames.map((m) => `<option value="${m}" ${row.method === m ? 'selected' : ''}>${m === 'cash' ? 'Efectivo' : m}</option>`).join('')}
          </select>
          <input type="number" class="split-amount" data-idx="${idx}" step="0.01" value="${row.amount}" />
          <button type="button" class="split-remove" data-idx="${idx}" title="Quitar" ${splitRows.length <= 1 ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>${icon('x', 16)}</button>
        </div>
      `
      )
      .join('');

    splitRowsEl.querySelectorAll('.split-method').forEach((sel) => {
      sel.addEventListener('change', () => {
        splitRows[Number(sel.dataset.idx)].method = sel.value;
        renderSplitRows();
        updateSplitRemaining();
        updateSplitSurchargeNotes();
      });
    });
    splitRowsEl.querySelectorAll('.split-amount').forEach((inp) => {
      inp.addEventListener('input', () => {
        splitRows[Number(inp.dataset.idx)].amount = inp.value;
        updateSplitRemaining();
        updateSplitSurchargeNotes();
      });
    });
    splitRowsEl.querySelectorAll('.split-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (splitRows.length <= 1) return;
        splitRows.splice(Number(btn.dataset.idx), 1);
        renderSplitRows();
        updateSplitRemaining();
        updateSplitSurchargeNotes();
      });
    });
  }
  // Para métodos con % de recargo (ej. tarjeta de crédito), muestra cuánto
  // marcar en la terminal para cada fila — no cambia el total de la venta,
  // es solo información para el cajero.
  function updateSplitSurchargeNotes() {
    const notes = splitRows
      .map((r) => {
        const pct = surchargeFor(r.method);
        if (r.method === 'cash' || !(pct > 0)) return null;
        const withSurcharge = (Number(r.amount) || 0) * (1 + pct / 100);
        return `${r.method} — cobra en terminal: <strong>${formatMoney(withSurcharge, settings.currency)}</strong> (con ${pct}% de recargo)`;
      })
      .filter(Boolean);
    splitSurchargeNotesEl.innerHTML = notes
      .map((n) => `<div style="font-size:13.5px; color:var(--pos-ink); background:var(--pos-surface-2); border-radius:var(--pos-radius); padding:6px 10px; margin:6px 0;">${n}</div>`)
      .join('');
  }
  function updateSplitRemaining() {
    const remaining = total - splitSum();
    splitRemainingEl.classList.remove('ok', 'short');
    if (Math.abs(remaining) <= 0.01) {
      splitRemainingEl.textContent = `Completo — suma ${formatMoney(total, settings.currency)}`;
      splitRemainingEl.classList.add('ok');
    } else if (remaining > 0) {
      splitRemainingEl.textContent = `Falta: ${formatMoney(remaining, settings.currency)}`;
      splitRemainingEl.classList.add('short');
    } else {
      splitRemainingEl.textContent = `Sobran: ${formatMoney(-remaining, settings.currency)} — ajusta un monto`;
      splitRemainingEl.classList.add('short');
    }
  }
  overlay.querySelector('#add-split-row').addEventListener('click', () => {
    const remaining = Math.max(0, total - splitSum());
    splitRows.push({ method: 'cash', amount: remaining > 0 ? remaining.toFixed(2) : '0.00' });
    renderSplitRows();
    updateSplitRemaining();
    updateSplitSurchargeNotes();
  });

  // ---- Alternar entre pago único y "Dividir" ----
  splitToggleBtn.addEventListener('click', () => {
    mode = mode === 'single' ? 'split' : 'single';
    splitToggleBtn.classList.toggle('active', mode === 'split');
    singleView.style.display = mode === 'single' ? '' : 'none';
    splitView.style.display = mode === 'split' ? '' : 'none';
    if (mode === 'split') {
      splitRows = [{ method: 'cash', amount: total.toFixed(2) }];
      renderSplitRows();
      updateSplitRemaining();
      updateSplitSurchargeNotes();
    }
  });

  overlay.querySelector('#cancel-checkout').addEventListener('click', () => overlay.remove());
  confirmBtn.addEventListener('click', async () => {
    let payments;
    let changeGiven = 0;

    if (mode === 'single') {
      if (selectedMethod === 'cash') {
        const amount = Number(amountInput.value || 0);
        if (amount < total - 0.009) {
          toast('El monto recibido es menor al total.', 'error');
          return;
        }
        payments = [{ method: 'cash', amount: total }];
        changeGiven = amount - total;
      } else {
        payments = [{ method: selectedMethod, amount: total }];
      }
    } else {
      const remaining = total - splitSum();
      if (Math.abs(remaining) > 0.01) {
        toast(remaining > 0 ? 'Falta completar el total entre los pagos.' : 'La suma de los pagos es mayor al total.', 'error');
        return;
      }
      if (splitRows.some((r) => !(Number(r.amount) > 0))) {
        toast('Cada pago debe tener un monto mayor a cero.', 'error');
        return;
      }
      payments = splitRows.map((r) => ({ method: r.method, amount: Number(r.amount) }));
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Procesando…';
    try {
      const sale = await api.post('/api/sales', {
        customer_id: selectedCustomerId || null,
        items: cart.map((i) => ({
          product_id: i.productId,
          quantity: i.qty,
          discount: i.discount || 0,
          notes: lineExtraText(i) || null,
          // Solo los usa el backend cuando product_id es null (línea libre,
          // ej. un artículo pesado en báscula) — si hay product_id, el
          // backend toma el precio/nombre/impuesto del catálogo y los ignora.
          unit_price: i.unitPrice,
          product_name: i.name,
          tax_rate: i.taxRate,
        })),
        payments,
      });
      lastSale = {
        ...sale,
        payments,
        change: changeGiven,
        customerName: customerSelect.selectedOptions[0]?.textContent,
        orderType: currentOrderType,
        // El cart se vacía justo después de imprimir, así que se guarda una
        // foto de los artículos aquí — si no, el ticket (y su reimpresión)
        // no podría mostrar qué se vendió.
        items: cart.map((i) => ({ qty: i.qty, name: i.name, unitPrice: i.unitPrice, lineTotal: lineTotals(i).lineTotal, extra: lineExtraText(i) })),
      };
      if (currentAccountHeldId) {
        try { await api.delete(`/api/held-sales/${currentAccountHeldId}`); } catch { /* la venta ya se registró; no bloquea el cobro */ }
      }
      toast(`Venta ${sale.folio} registrada.`, 'success');
      overlay.remove();
      printReceipt(lastSale);
      cart = [];
      ticketNote = '';
      currentAccountHeldId = null;
      setOrderType(null);
      renderCart();
      await loadAll();
    } catch (err) {
      toast(err.message, 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Cobrar';
    }
  });
}

// Línea punteada (imita la perforación de un ticket térmico) en vez de un
// <hr> liso — separa secciones sin verse como una tabla de datos.
const RECEIPT_DIVIDER = '<div style="border-top:1px dashed #999; margin:10px 0;"></div>';

// Fila con etiqueta a la izquierda y monto a la derecha (subtotal, total,
// pagos...), la forma en que se leen los importes en cualquier recibo.
function receiptRow(label, amount, { bold = false, big = false } = {}) {
  const size = big ? '16px' : '13px';
  const weight = bold ? '700' : '400';
  return `<div style="display:flex; justify-content:space-between; gap:10px; font-size:${size}; font-weight:${weight}; padding:1px 0;"><span>${label}</span><span>${amount}</span></div>`;
}

function printReceipt(sale) {
  const printArea = document.getElementById('print-area');
  // sale.payments: uno o varios pagos (si se usó "Dividir"), cada uno con su
  // método y, si es "Otro", su etiqueta libre (ej. "Vales de despensa").
  const paymentRows = (sale.payments || [])
    .map((p) => receiptRow(`${PAYMENT_METHOD_LABELS[p.method] || p.method}${p.label ? ` (${p.label})` : ''}`, formatMoney(p.amount, settings.currency)))
    .join('');

  const itemRows = (sale.items || [])
    .map(
      (i) => `
      <div style="margin-bottom:7px;">
        ${receiptRow(`${i.qty} x ${i.name}`, formatMoney(i.lineTotal, settings.currency), { bold: true })}
        ${i.qty > 1 ? `<div style="font-size:11px; color:#666;">${formatMoney(i.unitPrice, settings.currency)} c/u</div>` : ''}
        ${i.extra ? `<div style="font-size:11px; color:#666;">&raquo; ${i.extra}</div>` : ''}
      </div>
    `
    )
    .join('');

  printArea.innerHTML = `
    <div style="font-family: 'Courier New', monospace; width: 280px; margin: 0 auto; padding: 16px; color:#111;">
      ${settings.business_logo ? `<div style="text-align:center; margin-bottom:8px;"><img src="${settings.business_logo}" style="max-width:140px; max-height:140px;" /></div>` : ''}
      <h3 style="text-align:center; margin:0 0 2px; font-size:18px; letter-spacing:0.02em;">${settings.business_name || 'Mi Negocio'}</h3>
      ${settings.address || settings.phone ? `<p style="text-align:center; font-size:11px; color:#555; margin:0;">${settings.address || ''}${settings.address && settings.phone ? '<br>' : ''}${settings.phone || ''}</p>` : ''}

      ${RECEIPT_DIVIDER}
      <p style="text-align:center; font-size:12px; margin:0 0 6px;">
        ${sale.orderType ? `<strong style="font-size:14px;">${sale.orderType.label}</strong>${sale.orderType.detail ? `<br>${sale.orderType.detail}` : ''}<br>` : ''}
        Folio ${sale.folio}<br>
        ${sale.created_at ? formatDate(sale.created_at) : new Date().toLocaleString('es-MX')}<br>
        Atendió: ${user.name} · Cliente: ${sale.customerName || 'Público en general'}
      </p>

      ${RECEIPT_DIVIDER}
      ${itemRows}

      ${RECEIPT_DIVIDER}
      ${receiptRow('Subtotal', formatMoney(sale.subtotal, settings.currency))}
      ${sale.discount_total > 0.009 ? receiptRow('Descuento', '-' + formatMoney(sale.discount_total, settings.currency)) : ''}
      ${sale.tax_total > 0.009 ? receiptRow('Impuestos', formatMoney(sale.tax_total, settings.currency)) : ''}
      <div style="border-top:1px solid #111; margin:6px 0 4px;"></div>
      ${receiptRow('TOTAL', formatMoney(sale.total, settings.currency), { bold: true, big: true })}

      <div style="margin-top:10px;">
        ${paymentRows}
        ${sale.change > 0.009 ? receiptRow('Cambio', formatMoney(sale.change, settings.currency), { bold: true }) : ''}
      </div>

      ${ticketNote ? `${RECEIPT_DIVIDER}<p style="font-size:12px;"><strong>Nota:</strong> ${ticketNote}</p>` : ''}

      ${RECEIPT_DIVIDER}
      <p style="text-align:center; font-size:12px; font-style:italic; margin:0;">${settings.receipt_footer || 'Gracias por su compra'}</p>
    </div>
  `;
  window.print();
}

// Comanda para cocina: solo lo que necesita el cocinero (artículos,
// cantidades y las modificaciones/ingredientes/notas de cada línea) — sin
// precios ni totales. El mesero la manda cuando quiere avisar a cocina de
// un pedido nuevo o de un cambio (p. ej. "sin cebolla" que se agregó
// después de tomar la orden).
function printKitchenTicket() {
  if (cart.length === 0) {
    toast('No hay artículos que enviar a cocina.', 'error');
    return;
  }
  openSendToKitchenModal();
}

// Antes de mandar a cocina se puede dejar un comentario (ej. "sin cebolla
// en todo") — es opcional a propósito: no tiene sentido que en cocina lo
// tengan que escribir desde la tablet o la impresora, así que se captura
// aquí, del lado de quien manda el pedido, justo antes de enviarlo. Si no
// se escribe nada, se manda igual sin bloquear.
function openSendToKitchenModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px;">
      <h3>Enviar a cocina</h3>
      <div class="field">
        <label>Comentario para cocina (opcional)</label>
        <textarea id="kitchen-send-note" rows="3" placeholder="Ej. sin cebolla, todo para llevar...">${ticketNote || ''}</textarea>
      </div>
      <div class="modal-actions">
        <button class="ghost" id="kitchen-send-cancel">Cancelar</button>
        <button class="primary" id="kitchen-send-confirm">Enviar</button>
      </div>
    </div>
  `;
  shell.appendChild(overlay);
  const textarea = overlay.querySelector('#kitchen-send-note');
  textarea.focus();
  overlay.querySelector('#kitchen-send-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#kitchen-send-confirm').addEventListener('click', async () => {
    ticketNote = textarea.value.trim();
    overlay.remove();
    await sendToKitchenNow();
  });
}

async function sendToKitchenNow() {
  // Guarda la cuenta (si no tenía respaldo en held_sales todavía, la crea)
  // y la marca como enviada a cocina — así aparece en la pantalla de
  // cocina, además de imprimirse en papel abajo.
  await persistCurrentAccount();
  if (currentAccountHeldId) {
    try {
      await api.post(`/api/held-sales/${currentAccountHeldId}/send-to-kitchen`);
      await refreshHeldSales();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Si se usó "Persona" al personalizar algún artículo, la comanda sale
  // agrupada por persona (mismo orden de mesero: 1, 2, 3...) con una línea
  // punteada entre cada quien — así en cocina se ve clarito qué le toca a
  // cada comensal. Si nadie usó "Persona" (el caso normal), sale igual que
  // siempre, sin líneas ni agrupar nada.
  const splitByPerson = cart.some((i) => (i.person || 1) > 1);
  let groups = [cart];
  if (splitByPerson) {
    const byPerson = new Map();
    cart.forEach((i) => {
      const p = i.person || 1;
      if (!byPerson.has(p)) byPerson.set(p, []);
      byPerson.get(p).push(i);
    });
    groups = Array.from(byPerson.keys()).sort((a, b) => a - b).map((p) => byPerson.get(p));
  }
  const itemHtml = (i) => `
    <p style="margin-bottom:10px;">
      <strong style="font-size:15px;">${i.qty} x ${i.name}</strong>
      ${lineExtraText(i) ? `<br><span style="font-size:13px;">&raquo; ${lineExtraText(i)}</span>` : ''}
    </p>
  `;
  const itemsHtml = groups
    .map((group) => group.map(itemHtml).join(''))
    .join(splitByPerson ? '<hr style="border:none; border-top:1px dashed #888; margin:10px 0;" />' : '');

  const printArea = document.getElementById('print-area');
  printArea.innerHTML = `
    <div style="font-family: monospace; width: 280px; margin: 0 auto; padding: 16px;">
      <h3 style="text-align:center; margin-bottom:2px;">COMANDA</h3>
      ${currentOrderType ? `<p style="text-align:center; font-weight:bold; font-size:14px; margin:2px 0;">${currentOrderType.label}${currentOrderType.detail ? '<br>' + currentOrderType.detail : ''}</p>` : ''}
      <p style="text-align:center; font-size:12px;">${new Date().toLocaleString('es-MX')} · ${user.name}</p>
      <hr />
      ${itemsHtml}
      <hr />
      ${ticketNote ? `<p><strong>Nota general:</strong> ${ticketNote}</p>` : ''}
    </div>
  `;
  window.print();
  toast('Comanda enviada a cocina.', 'success');
}

// Imprime un pre-ticket (venta no confirmada) para cualquier lista de
// artículos + tipo de cuenta — lo usa tanto la cuenta en pantalla como
// cualquier cuenta abierta elegida en openPrintAccountModal().
function printPreTicket(items, orderType) {
  if (!items || items.length === 0) {
    toast('Esa cuenta está vacía.', 'error');
    return;
  }
  const total = items.reduce((s, i) => s + lineTotals(i).lineTotal, 0);
  const printArea = document.getElementById('print-area');
  printArea.innerHTML = `
    <div style="font-family: monospace; width: 280px; margin: 0 auto; padding: 16px;">
      ${settings.business_logo ? `<div style="text-align:center; margin-bottom:6px;"><img src="${settings.business_logo}" style="max-width:140px; max-height:140px;" /></div>` : ''}
      <h3 style="text-align:center;">${settings.business_name || 'Mi Negocio'}</h3>
      <p style="text-align:center; font-size:12px;">Pre-ticket (venta no confirmada)</p>
      ${orderType ? `<p style="text-align:center; font-size:12px;">${orderType.label}${orderType.detail ? ' · ' + orderType.detail : ''}</p>` : ''}
      <hr />
      ${items
        .map(
          (i) =>
            `<p>${i.qty} x ${i.name}<br>${formatMoney(lineTotals(i).lineTotal, settings.currency)}${lineExtraText(i) ? `<br><em>${lineExtraText(i)}</em>` : ''}</p>`
        )
        .join('')}
      <hr />
      <p><strong>Total: ${formatMoney(total, settings.currency)}</strong></p>
    </div>
  `;
  window.print();
}

// "Imprimir cuenta": elegir de entre las cuentas abiertas (la que está en
// pantalla + las guardadas) cuál imprimir — no imprime directo la cuenta
// actual, porque puede haber varias mesas abiertas a la vez.
function openPrintAccountModal() {
  const entries = [];
  if (cart.length > 0 || currentOrderType) {
    entries.push({
      source: 'current',
      id: 'current',
      order_type: currentOrderType,
      items: cart,
      customer_name: customerSelect.selectedOptions[0]?.textContent,
    });
  }
  heldSales.forEach((h) => {
    if (h.id === currentAccountHeldId) return; // ya se muestra como "current" (misma cuenta, mismo id)
    entries.push({ source: 'held', id: h.id, order_type: h.order_type, items: h.items, customer_name: h.customer_name });
  });

  if (entries.length === 0) {
    toast('No hay cuentas abiertas para imprimir.', 'info');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px;">
      <h3>Imprimir cuenta</h3>
      <p class="text-secondary">Elige una cuenta abierta para imprimir su pre-ticket.</p>
      <div id="print-account-list"></div>
      <div class="modal-actions"><button class="ghost" id="print-account-close">Cerrar</button></div>
    </div>
  `;
  shell.appendChild(overlay);
  overlay.querySelector('#print-account-close').addEventListener('click', () => overlay.remove());

  const listEl = overlay.querySelector('#print-account-list');
  listEl.innerHTML = entries
    .map(
      (e) => `
    <button type="button" class="ghost" data-source="${e.source}" data-id="${e.id}" style="width:100%; display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--pos-line, #e5e5e3);">
      <span>
        <div style="font-weight:600; font-size:13px;">${accountLabel(e)}${e.source === 'current' ? ' <span style="color:var(--pos-accent, #2e7d32); font-weight:700;">(en pantalla)</span>' : ''}</div>
        <div class="text-secondary" style="font-size:11.5px;">${e.items.length} artículo(s) · ${formatMoney(heldSaleTotal(e), settings.currency)}</div>
      </span>
      ${icon('printer', 18)}
    </button>
  `
    )
    .join('');
  listEl.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entry = entries.find((e) => e.source === btn.dataset.source && String(e.id) === btn.dataset.id);
      overlay.remove();
      printPreTicket(entry.items, entry.order_type);
    });
  });
}

// "Reimprimir ticket": elegir de entre las ventas ya cobradas cuál
// reimprimir (no solo la última) — busca por folio o cliente.
function openReprintTicketModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px;">
      <h3>Reimprimir ticket</h3>
      <div class="field"><input type="text" id="reprint-search" placeholder="Buscar por folio o cliente…" /></div>
      <div id="reprint-list" style="max-height:50vh; overflow-y:auto; margin-top:6px;"><p class="text-secondary">Cargando…</p></div>
      <div class="modal-actions"><button class="ghost" id="reprint-close">Cerrar</button></div>
    </div>
  `;
  shell.appendChild(overlay);
  overlay.querySelector('#reprint-close').addEventListener('click', () => overlay.remove());

  const listEl = overlay.querySelector('#reprint-list');
  const searchEl = overlay.querySelector('#reprint-search');
  let sales = [];

  function renderList() {
    const query = searchEl.value.trim().toLowerCase();
    const filtered = !query
      ? sales
      : sales.filter((s) => s.folio.toLowerCase().includes(query) || (s.customer_name || '').toLowerCase().includes(query));
    if (filtered.length === 0) {
      listEl.innerHTML = '<p class="text-secondary">No se encontraron ventas.</p>';
      return;
    }
    listEl.innerHTML = filtered
      .slice(0, 100)
      .map(
        (s) => `
      <button type="button" class="ghost" data-id="${s.id}" style="width:100%; display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--pos-line, #e5e5e3);">
        <span>
          <div style="font-weight:600; font-size:13px;">${s.folio}${s.status !== 'completed' ? ` <span style="color:var(--pos-cancel-color, #c0392b); font-weight:700;">(${s.status === 'cancelled' ? 'cancelada' : 'reembolsada'})</span>` : ''}</div>
          <div class="text-secondary" style="font-size:11.5px;">${formatDate(s.created_at)} · ${s.customer_name || 'Público en general'}</div>
        </span>
        <span style="font-weight:600;">${formatMoney(s.total, settings.currency)}</span>
      </button>
    `
      )
      .join('');
    listEl.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        overlay.remove();
        printSaleById(Number(btn.dataset.id));
      });
    });
  }
  searchEl.addEventListener('input', renderList);

  api
    .get('/api/sales')
    .then((res) => {
      sales = res.sales;
      renderList();
    })
    .catch((err) => {
      listEl.innerHTML = `<p class="text-secondary">${err.message}</p>`;
    });
}

async function printSaleById(id) {
  try {
    const { sale, items, payments } = await api.get(`/api/sales/${id}`);
    printReceipt({
      folio: sale.folio,
      created_at: sale.created_at,
      subtotal: sale.subtotal,
      discount_total: sale.discount_total,
      tax_total: sale.tax_total,
      total: sale.total,
      customerName: sale.customer_name,
      payments,
      change: 0,
      items: items.map((i) => ({ qty: i.quantity, name: i.product_name, unitPrice: i.unit_price, lineTotal: i.line_total, extra: i.notes || '' })),
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Báscula: captura manual de peso/precio unitario (cualquier marca conectada
// al equipo puede alimentar estos mismos campos más adelante) — "Aceptar"
// agrega el resultado como línea libre al ticket.
function openScaleModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:320px;">
      <h3>Báscula</h3>
      <div class="field">
        <label>Peso (kg)</label>
        <input type="number" id="scale-weight" step="0.001" min="0" value="0.0000" />
      </div>
      <div class="field">
        <label>Precio unitario</label>
        <input type="number" id="scale-price" step="0.01" min="0" value="0.00" />
      </div>
      <div class="field">
        <label>Total</label>
        <input type="text" id="scale-total" value="${formatMoney(0, settings.currency)}" disabled />
      </div>
      <div class="modal-actions">
        <button class="ghost" id="scale-close">Cerrar</button>
        <button class="ghost" id="scale-connect">Conectar</button>
        <button class="primary" id="scale-accept">Aceptar</button>
      </div>
    </div>
  `;
  shell.appendChild(overlay);

  const weightEl = overlay.querySelector('#scale-weight');
  const priceEl = overlay.querySelector('#scale-price');
  const totalEl = overlay.querySelector('#scale-total');

  function updateTotal() {
    const weight = Number(weightEl.value) || 0;
    const price = Number(priceEl.value) || 0;
    totalEl.value = formatMoney(weight * price, settings.currency);
  }
  weightEl.addEventListener('input', updateTotal);
  priceEl.addEventListener('input', updateTotal);

  overlay.querySelector('#scale-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#scale-connect').addEventListener('click', () => {
    toast('Conectar báscula: requiere el driver del fabricante instalado en este equipo.', 'info');
  });
  overlay.querySelector('#scale-accept').addEventListener('click', () => {
    const weight = Number(weightEl.value);
    const price = Number(priceEl.value);
    if (!(weight > 0) || !(price > 0)) {
      toast('Captura el peso y el precio unitario.', 'error');
      return;
    }
    if (!currentOrderType) {
      overlay.remove();
      toast('Abre una cuenta (mesa, para llevar, etc.) antes de agregar productos.', 'error');
      openOrderTypeModal();
      return;
    }
    cart.push({
      lineId: nextLineId++,
      productId: null,
      name: 'Producto por peso',
      qty: weight,
      unitPrice: price,
      taxRate: 0,
      discount: 0,
      modifiers: [],
      ingredients: [],
      note: `${weight} kg`,
    });
    renderCart();
    overlay.remove();
    toast('Producto agregado al ticket.', 'success');
  });
}

// Refresca held_sales en segundo plano cada pocos segundos, sin avisos y sin
// tocar la cuenta que esté en pantalla — así lo que se guarda o envía desde
// el Comandero (u otra terminal) se refleja solo en listas como "Cuentas" o
// "Imprimir cuenta", sin tener que reabrir nada ni recargar la página.
const HELD_SALES_POLL_MS = 8000;
async function pollHeldSalesBackground() {
  try {
    const res = await api.get('/api/held-sales');
    heldSales = res.heldSales;
  } catch {
    // silencioso — es un refresco de fondo, no una acción que el usuario pidió
  }
}

// ---------- Arranque ----------
buildFunctionToolbar();
buildBottomToolbar();
buildTicketQuickActions();
renderCart();
loadAll();
setInterval(pollHeldSalesBackground, HELD_SALES_POLL_MS);
