import { api, requireAuth, getUser, clearSession, toast, formatMoney } from './api.js';
import { icon } from './icons.js';

if (!requireAuth()) throw new Error('redirect');

const user = getUser();

// ---------- Estado ----------
let products = [];
let categories = [];
let customers = [];
let heldSales = [];
let settings = { currency: 'MXN' };

let cart = []; // { lineId, productId, name, qty, unitPrice, taxRate, discount, stock, trackStock }
let nextLineId = 1;
let currentOrderType = null; // { type, label, detail? }
let currentAccountHeldId = null;
let selectedCustomerId = null;

const ORDER_TYPES = [
  { type: 'table', ico: 'utensils', label: 'Mesas' },
  { type: 'takeaway', ico: 'bag', label: 'Para llevar' },
  { type: 'delivery', ico: 'truck', label: 'A domicilio' },
  { type: 'platform', ico: 'tabletSmartphone', label: 'Plataforma digital' },
];

const shell = document.createElement('div');
shell.className = 'pos-shell comandero-shell';
document.body.innerHTML = '';
document.body.appendChild(shell);

async function init() {
  shell.innerHTML = `<div style="margin:auto; color:var(--pos-ink-muted);">Cargando…</div>`;
  try {
    const [p, c, cu, hs, st] = await Promise.all([
      api.get('/api/products'),
      api.get('/api/categories'),
      api.get('/api/customers'),
      api.get('/api/held-sales'),
      api.get('/api/settings'),
    ]);
    products = p.products;
    categories = c.categories;
    customers = cu.customers;
    heldSales = hs.heldSales;
    settings = st.settings;
  } catch (err) {
    shell.innerHTML = `<div style="margin:auto; color:var(--pos-cancel-color);">Error cargando: ${err.message}</div>`;
    return;
  }
  renderShell();
}

function renderShell() {
  shell.innerHTML = `
    <div class="cmd-topbar">
      <div class="brand">🧾 Comandero</div>
      <div class="spacer"></div>
      <button class="icon-btn" id="cmd-accounts-btn" title="Cuentas abiertas">${icon('layers', 18)}</button>
      <button class="icon-btn" id="cmd-switch-user-btn" title="Cambiar usuario">${icon('user', 18)}</button>
      <button class="icon-btn" id="cmd-logout-btn" title="Salir">${icon('logout', 18)}</button>
    </div>
    <div class="cmd-ordertypes" id="cmd-ordertypes"></div>
    <div class="cmd-account-bar">
      <div class="cmd-account-label empty" id="cmd-account-label">Sin cuenta abierta</div>
      <select id="cmd-customer-select">
        <option value="">Cliente (opcional)</option>
        ${customers.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}
      </select>
    </div>
    <div class="comandero-main">
      <div class="cmd-cart-wrap">
        <table class="ticket-table" id="cmd-cart-table">
          <thead>
            <tr><th>Cant</th><th>Descripción</th><th class="num">Dscto</th><th class="num">Precio</th><th class="num">Importe</th><th></th></tr>
          </thead>
          <tbody id="cmd-cart-body"></tbody>
        </table>
      </div>
      <button class="cmd-add-btn" id="cmd-add-product-btn">+ Agregar producto</button>
      <div class="estado-row">Estado: <strong id="cmd-estado-text">Sin ticket activo</strong></div>
      <div class="totals-row">
        <div class="trow"><span>Subtotal</span><span id="cmd-sum-subtotal">$0.00</span></div>
        <div class="trow"><span>Descuento</span><span id="cmd-sum-discount">$0.00</span></div>
        <div class="trow"><span>Impuestos</span><span id="cmd-sum-tax">$0.00</span></div>
        <div class="trow total"><span>Total</span><span id="cmd-sum-total">$0.00</span></div>
      </div>
      <div class="big-actions-row">
        <button class="big-btn cancel" id="cmd-cancel-btn">Cancelar</button>
        <button class="big-btn pay" id="cmd-send-btn">Enviar a cocina</button>
      </div>
    </div>
  `;

  renderOrderTypeButtons();
  renderCart();

  shell.querySelector('#cmd-accounts-btn').addEventListener('click', openAccountsModal);
  shell.querySelector('#cmd-switch-user-btn').addEventListener('click', logout);
  shell.querySelector('#cmd-logout-btn').addEventListener('click', logout);
  shell.querySelector('#cmd-add-product-btn').addEventListener('click', openProductPicker);
  shell.querySelector('#cmd-cancel-btn').addEventListener('click', cancelCurrentAccount);
  shell.querySelector('#cmd-send-btn').addEventListener('click', sendToKitchen);
  shell.querySelector('#cmd-customer-select').addEventListener('change', (e) => {
    selectedCustomerId = e.target.value ? Number(e.target.value) : null;
  });
}

function renderOrderTypeButtons() {
  const wrap = shell.querySelector('#cmd-ordertypes');
  wrap.innerHTML = ORDER_TYPES.map(
    (t) => `
      <button type="button" class="toolbtn ${currentOrderType?.type === t.type ? 'active' : ''}" data-type="${t.type}">
        <span class="ico">${icon(t.ico, 20)}</span>
        <span class="lbl">${t.label}</span>
      </button>
    `
  ).join('');
  wrap.querySelectorAll('button[data-type]').forEach((btn) => {
    btn.addEventListener('click', () => openOrderTypeDetailsModal(btn.dataset.type));
  });
}

// ---------- Tipo de cuenta (mesa / para llevar / a domicilio / barra) ----------
function openOrderTypeDetailsModal(type) {
  const meta = ORDER_TYPES.find((t) => t.type === type);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="max-width:400px;"><h3>${meta.label}</h3><div id="cmd-ot-extra"></div>
    <div class="modal-actions"><button class="ghost" id="cmd-ot-cancel">Cancelar</button></div></div>`;
  shell.appendChild(overlay);
  overlay.querySelector('#cmd-ot-cancel').addEventListener('click', () => overlay.remove());

  const extra = overlay.querySelector('#cmd-ot-extra');
  const confirmAndClose = (orderType) => {
    beginNewAccount(orderType);
    overlay.remove();
  };

  if (type === 'table') {
    extra.innerHTML = `
      <div class="field"><label>Número o nombre de mesa</label><input id="cmd-ot-table" placeholder="Ej. 5" /></div>
      <div class="field"><label>Nombre del cliente (opcional)</label><input id="cmd-ot-name" placeholder="Ej. Familia Pérez" /></div>
      <button class="primary" id="cmd-ot-confirm" style="width:100%;">Abrir mesa</button>
    `;
    extra.querySelector('#cmd-ot-confirm').addEventListener('click', () => {
      const table = extra.querySelector('#cmd-ot-table').value.trim();
      const name = extra.querySelector('#cmd-ot-name').value.trim();
      if (!table) { toast('Indica el número o nombre de la mesa.', 'error'); return; }
      confirmAndClose({ type, label: `Mesa ${table}${name ? ' · ' + name : ''}` });
    });
  } else if (type === 'takeaway') {
    extra.innerHTML = `
      <div class="field"><label>Nombre del cliente</label><input id="cmd-ot-name" placeholder="Ej. Juan" /></div>
      <button class="primary" id="cmd-ot-confirm" style="width:100%;">Abrir cuenta</button>
    `;
    extra.querySelector('#cmd-ot-confirm').addEventListener('click', () => {
      const name = extra.querySelector('#cmd-ot-name').value.trim();
      confirmAndClose({ type, label: `Para llevar${name ? ' · ' + name : ''}` });
    });
  } else if (type === 'delivery') {
    extra.innerHTML = `
      <div class="field"><label>Nombre del cliente</label><input id="cmd-ot-name" /></div>
      <div class="field"><label>Dirección de entrega</label><input id="cmd-ot-address" /></div>
      <div class="field"><label>Teléfono</label><input id="cmd-ot-phone" /></div>
      <button class="primary" id="cmd-ot-confirm" style="width:100%;">Abrir cuenta</button>
    `;
    extra.querySelector('#cmd-ot-confirm').addEventListener('click', () => {
      const name = extra.querySelector('#cmd-ot-name').value.trim();
      const address = extra.querySelector('#cmd-ot-address').value.trim();
      const phone = extra.querySelector('#cmd-ot-phone').value.trim();
      if (!address) { toast('Indica la dirección de entrega.', 'error'); return; }
      confirmAndClose({ type, label: `A domicilio${name ? ' · ' + name : ''}`, detail: [address, phone].filter(Boolean).join(' · ') });
    });
  } else if (type === 'platform') {
    extra.innerHTML = `
      <div class="field">
        <label>Plataforma</label>
        <select id="cmd-ot-platform">
          <option>Uber Eats</option>
          <option>Rappi</option>
          <option>Didi Food</option>
          <option>Otra</option>
        </select>
      </div>
      <div class="field"><label>No. de pedido (opcional)</label><input id="cmd-ot-order-id" /></div>
      <button class="primary" id="cmd-ot-confirm" style="width:100%;">Abrir cuenta</button>
    `;
    extra.querySelector('#cmd-ot-confirm').addEventListener('click', () => {
      const platform = extra.querySelector('#cmd-ot-platform').value;
      const orderId = extra.querySelector('#cmd-ot-order-id').value.trim();
      confirmAndClose({ type, label: `${platform}${orderId ? ' · #' + orderId : ''}` });
    });
  }
}

function beginNewAccount(orderType) {
  if (cart.length > 0 && !confirm('Hay artículos sin enviar en la cuenta actual. ¿Descartarlos y abrir una cuenta nueva?')) return;
  cart = [];
  currentAccountHeldId = null;
  selectedCustomerId = null;
  shell.querySelector('#cmd-customer-select').value = '';
  currentOrderType = orderType;
  renderOrderTypeButtons();
  updateAccountLabel();
  renderCart();
}

function updateAccountLabel() {
  const label = shell.querySelector('#cmd-account-label');
  if (currentOrderType) {
    label.textContent = currentOrderType.label + (currentOrderType.detail ? ` · ${currentOrderType.detail}` : '');
    label.classList.remove('empty');
  } else {
    label.textContent = 'Sin cuenta abierta';
    label.classList.add('empty');
  }
}

// ---------- Carrito ----------
function lineTotals(item) {
  const lineSubtotal = item.unitPrice * item.qty - (item.discount || 0);
  const lineTax = lineSubtotal * ((item.taxRate || 0) / 100);
  return { lineSubtotal, lineTax, lineTotal: lineSubtotal + lineTax };
}

function lineExtraText(item) {
  const parts = [];
  if (item.modifiers && item.modifiers.length) parts.push(item.modifiers.join(', '));
  if (item.ingredients && item.ingredients.length) parts.push(item.ingredients.join(', '));
  if (item.note) parts.push(item.note);
  return parts.join(' · ');
}

// Toque rápido en el producto: agrega (o suma 1 a la línea ya existente sin
// personalizar). Para pedir modificadores/ingredientes/notas se usa el
// ícono "+" de la tarjeta (ver addProductAndCustomize).
function addProductToCart(product) {
  const existing = cart.find((i) => i.productId === product.id && !i.discount && !(i.modifiers || []).length && !(i.ingredients || []).length && !i.note);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push(newCartLine(product));
  }
  renderCart();
}

function newCartLine(product) {
  return {
    lineId: nextLineId++,
    productId: product.id,
    name: product.name,
    qty: 1,
    unitPrice: product.sale_price,
    taxRate: product.tax_rate,
    discount: 0,
    stock: product.stock_qty,
    trackStock: !!product.track_stock,
    modifiers: [],
    ingredients: [],
    note: '',
  };
}

// Ícono "+" de la tarjeta: agrega una línea nueva y abre de inmediato el
// modal para que el mesero indique cantidad, modificadores, ingredientes o
// notas — lo que pida el cliente.
function addProductAndCustomize(product) {
  const line = newCartLine(product);
  cart.push(line);
  renderCart();
  openCustomizeModal(line.lineId);
}

// ---------- Modal de personalizar línea (cantidad, modificadores, ingredientes, notas) ----------
// Los modificadores/ingredientes "guardados" se recuerdan en este equipo
// (localStorage, mismas claves que usa el POS) para no reescribirlos cada vez.
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
  } catch { /* almacenamiento no disponible, se ignora */ }
}

function openCustomizeModal(lineId) {
  const item = cart.find((i) => i.lineId === lineId);
  if (!item) return;
  if (!item.modifiers) item.modifiers = [];
  if (!item.ingredients) item.ingredients = [];
  if (item.note === undefined) item.note = '';

  const savedMods = savedChipList('pos_saved_modifiers');
  const savedIngs = savedChipList('pos_saved_ingredients');
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
        <textarea id="li-note" rows="2" placeholder="Ej. sin cebolla, para regalo...">${item.note || ''}</textarea>
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
    if (item.trackStock && workingQty + 1 > item.stock) {
      toast(`No hay suficiente stock de "${item.name}".`, 'error');
      return;
    }
    workingQty += 1;
    refreshQty();
  });

  const workingMods = new Set(item.modifiers);
  const workingIngs = new Set(item.ingredients);

  function renderChips(container, list, workingSet) {
    container.innerHTML = list
      .map((label) => `<button type="button" class="chip-btn ${workingSet.has(label) ? 'selected' : ''}" data-label="${label}">${label}</button>`)
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
    item.modifiers = Array.from(workingMods);
    item.ingredients = Array.from(workingIngs);
    item.note = overlay.querySelector('#li-note').value.trim();
    close();
    renderCart();
  });
}

function renderCart() {
  const body = shell.querySelector('#cmd-cart-body');
  if (cart.length === 0) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--pos-ink-muted); padding:24px;">Sin artículos todavía</td></tr>`;
  } else {
    body.innerHTML = cart
      .map((i) => {
        const t = lineTotals(i);
        return `
          <tr data-line="${i.lineId}">
            <td>
              <div class="qty-controls">
                <button data-action="dec">−</button>
                <span>${i.qty}</span>
                <button data-action="inc">+</button>
              </div>
            </td>
            <td class="line-name" data-action="edit">
              <span class="pname">${i.name}</span>
              ${lineExtraText(i) ? `<span class="line-extra">${lineExtraText(i)}</span>` : ''}
            </td>
            <td class="num"><input type="number" min="0" step="0.01" value="${i.discount || 0}" data-action="discount" style="width:64px;" /></td>
            <td class="num">${formatMoney(i.unitPrice, settings.currency)}</td>
            <td class="num">${formatMoney(t.lineTotal, settings.currency)}</td>
            <td><button class="row-remove" data-action="remove" title="Quitar">${icon('x', 16)}</button></td>
          </tr>
        `;
      })
      .join('');
  }

  body.querySelectorAll('button[data-action="inc"]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      const line = Number(e.target.closest('tr').dataset.line);
      const item = cart.find((i) => i.lineId === line);
      if (item.trackStock && item.qty + 1 > item.stock) { toast(`Sin stock suficiente de "${item.name}".`, 'error'); return; }
      item.qty += 1;
      renderCart();
    })
  );
  body.querySelectorAll('button[data-action="dec"]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      const line = Number(e.target.closest('tr').dataset.line);
      const item = cart.find((i) => i.lineId === line);
      item.qty -= 1;
      if (item.qty <= 0) cart = cart.filter((i) => i.lineId !== line);
      renderCart();
    })
  );
  body.querySelectorAll('td[data-action="edit"]').forEach((td) =>
    td.addEventListener('click', (e) => openCustomizeModal(Number(e.target.closest('tr').dataset.line)))
  );
  body.querySelectorAll('button[data-action="remove"]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      const line = Number(e.target.closest('tr').dataset.line);
      cart = cart.filter((i) => i.lineId !== line);
      renderCart();
    })
  );
  body.querySelectorAll('input[data-action="discount"]').forEach((input) =>
    input.addEventListener('change', (e) => {
      const line = Number(e.target.closest('tr').dataset.line);
      const item = cart.find((i) => i.lineId === line);
      item.discount = Math.max(0, Number(e.target.value) || 0);
      renderCart();
    })
  );

  const subtotalGross = cart.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const discountTotal = cart.reduce((s, i) => s + (i.discount || 0), 0);
  const taxTotal = cart.reduce((s, i) => s + lineTotals(i).lineTax, 0);
  const total = cart.reduce((s, i) => s + lineTotals(i).lineTotal, 0);

  shell.querySelector('#cmd-sum-subtotal').textContent = formatMoney(subtotalGross, settings.currency);
  shell.querySelector('#cmd-sum-discount').textContent = formatMoney(discountTotal, settings.currency);
  shell.querySelector('#cmd-sum-tax').textContent = formatMoney(taxTotal, settings.currency);
  shell.querySelector('#cmd-sum-total').textContent = formatMoney(total, settings.currency);
  shell.querySelector('#cmd-estado-text').textContent =
    cart.length === 0 && !currentOrderType ? 'Sin ticket activo' : currentAccountHeldId ? 'Cuenta guardada' : 'Sin enviar';
  updateAccountLabel();
}

// ---------- Selector de productos ----------
function openProductPicker() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal cmd-picker-modal">
      <div class="cmd-picker-header">
        <input type="text" id="cmd-picker-search" placeholder="Buscar producto…" autofocus />
        <button class="icon-btn" id="cmd-picker-close">${icon('x', 18)}</button>
      </div>
      <div class="cmd-picker-cats" id="cmd-picker-cats"></div>
      <div class="cmd-picker-grid-wrap"><div class="pos-product-grid" id="cmd-picker-grid"></div></div>
      <div class="cmd-picker-footer">
        <span id="cmd-picker-count" class="text-secondary"></span>
        <button class="primary" id="cmd-picker-done">Listo</button>
      </div>
    </div>
  `;
  shell.appendChild(overlay);
  overlay.querySelector('#cmd-picker-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cmd-picker-done').addEventListener('click', () => overlay.remove());

  let activeCategory = null;
  const catsEl = overlay.querySelector('#cmd-picker-cats');
  catsEl.innerHTML =
    `<button type="button" class="chip-btn selected" data-cat="">Todas</button>` +
    categories.map((c) => `<button type="button" class="chip-btn" data-cat="${c.id}">${c.name}</button>`).join('');
  catsEl.querySelectorAll('button[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat || null;
      catsEl.querySelectorAll('.chip-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      renderGrid();
    });
  });

  const searchInput = overlay.querySelector('#cmd-picker-search');
  searchInput.addEventListener('input', renderGrid);

  function renderGrid() {
    const q = searchInput.value.trim().toLowerCase();
    const grid = overlay.querySelector('#cmd-picker-grid');
    const filtered = products.filter((p) => {
      if (activeCategory && String(p.category_id) !== String(activeCategory)) return false;
      if (q && !p.name.toLowerCase().includes(q) && !(p.sku || '').toLowerCase().includes(q)) return false;
      return true;
    });
    grid.innerHTML = filtered
      .map(
        (p) => `
        <button type="button" class="pos-product-tile" data-id="${p.id}" ${p.track_stock && p.stock_qty <= 0 ? 'disabled' : ''}>
          <span class="corner tl" data-action="add" data-id="${p.id}" title="Agregar y personalizar (cantidad, modificadores...)">${icon('plus', 13)}</span>
          <span class="pname">${p.name}</span>
          <span class="pprice">${formatMoney(p.sale_price, settings.currency)}${p.track_stock ? ` · ${p.stock_qty} ${p.unit || ''}` : ''}</span>
        </button>
      `
      )
      .join('');
    const updateCount = () => { overlay.querySelector('#cmd-picker-count').textContent = `${cart.reduce((s, i) => s + i.qty, 0)} en el carrito`; };
    grid.querySelectorAll('.pos-product-tile').forEach((tile) => {
      tile.addEventListener('click', (e) => {
        const product = products.find((p) => p.id === Number(tile.dataset.id));
        if (e.target.closest('[data-action="add"]')) {
          addProductAndCustomize(product);
        } else {
          addProductToCart(product);
        }
        updateCount();
      });
    });
  }
  renderGrid();
}

// ---------- Cuentas abiertas ----------
async function openAccountsModal() {
  let latestHeld = heldSales;
  try {
    latestHeld = (await api.get('/api/held-sales')).heldSales;
    heldSales = latestHeld;
  } catch { /* usa lo que ya había en memoria si falla */ }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <h3>Cuentas abiertas</h3>
      <p class="text-secondary">Toca una para retomarla y seguir agregando artículos.</p>
      <div id="cmd-accounts-list"></div>
      <div class="modal-actions"><button class="ghost" id="cmd-accounts-close">Cerrar</button></div>
    </div>
  `;
  shell.appendChild(overlay);
  overlay.querySelector('#cmd-accounts-close').addEventListener('click', () => overlay.remove());

  const listEl = overlay.querySelector('#cmd-accounts-list');
  if (heldSales.length === 0) {
    listEl.innerHTML = '<p class="text-secondary">No hay cuentas abiertas todavía.</p>';
  } else {
    listEl.innerHTML = heldSales
      .map((h) => {
        const label = h.order_type ? h.order_type.label : h.customer_name || 'Cuenta sin nombre';
        const itemCount = h.items.length;
        return `
          <button type="button" class="ghost" data-id="${h.id}" style="width:100%; text-align:left; display:flex; justify-content:space-between; margin-bottom:8px; padding:12px;">
            <span><strong>${label}</strong><br><span class="text-secondary" style="font-size:11.5px;">${itemCount} artículo(s)</span></span>
          </button>
        `;
      })
      .join('');
    listEl.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        loadHeldAccount(Number(btn.dataset.id));
        overlay.remove();
      });
    });
  }
}

function loadHeldAccount(id) {
  const held = heldSales.find((h) => h.id === id);
  if (!held) return;
  if (cart.length > 0 && !confirm('Hay artículos sin enviar en la cuenta actual. ¿Descartarlos?')) return;

  cart = held.items.map((i) => {
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
      };
    }
    return { ...i, lineId };
  });
  currentOrderType = held.order_type || null;
  currentAccountHeldId = held.id;
  selectedCustomerId = held.customer_id || null;
  shell.querySelector('#cmd-customer-select').value = held.customer_id || '';
  renderOrderTypeButtons();
  renderCart();
  toast('Cuenta cargada.', 'success');
}

// ---------- Enviar a cocina / cancelar ----------
async function sendToKitchen() {
  if (cart.length === 0) { toast('Agrega al menos un producto antes de enviar.', 'error'); return; }
  if (!currentOrderType) { toast('Elige el tipo de cuenta (mesa, para llevar, etc.) antes de enviar.', 'error'); return; }

  const customerName = shell.querySelector('#cmd-customer-select').selectedOptions[0]?.textContent;
  const payload = {
    customer_id: selectedCustomerId || null,
    customer_name: currentOrderType.label || customerName,
    items: cart,
    order_type: currentOrderType,
  };
  const btn = shell.querySelector('#cmd-send-btn');
  btn.disabled = true;
  try {
    if (currentAccountHeldId) {
      await api.put(`/api/held-sales/${currentAccountHeldId}`, payload);
    } else {
      const res = await api.post('/api/held-sales', payload);
      currentAccountHeldId = res.id;
    }
    toast(`Pedido enviado: ${currentOrderType.label}.`, 'success');
    heldSales = (await api.get('/api/held-sales')).heldSales;
    cart = [];
    currentOrderType = null;
    currentAccountHeldId = null;
    selectedCustomerId = null;
    shell.querySelector('#cmd-customer-select').value = '';
    renderOrderTypeButtons();
    renderCart();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function cancelCurrentAccount() {
  if (cart.length === 0 && !currentOrderType) return;
  if (!confirm('¿Cancelar esta cuenta? Se perderán los artículos agregados.')) return;
  if (currentAccountHeldId) {
    try {
      await api.delete(`/api/held-sales/${currentAccountHeldId}`);
      heldSales = heldSales.filter((h) => h.id !== currentAccountHeldId);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  cart = [];
  currentOrderType = null;
  currentAccountHeldId = null;
  selectedCustomerId = null;
  shell.querySelector('#cmd-customer-select').value = '';
  renderOrderTypeButtons();
  renderCart();
}

function logout() {
  clearSession();
  window.location.href = '/index.html';
}

init();
