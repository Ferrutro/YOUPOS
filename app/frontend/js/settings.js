import { api, requireAuth, requireRole, toast } from './api.js';
import { renderLayout } from './layout.js';
import { icon } from './icons.js';
import {
  POS_BUTTON_CATALOG,
  POS_TOOLBAR_SECTIONS,
  defaultIdsForSection,
  resolveToolbarLayout,
} from './pos-buttons-catalog.js';

if (!requireAuth()) throw new Error('no auth');
if (!requireRole('admin')) throw new Error('no role');
const main = renderLayout('/settings.html');

// Configuración está organizada en pestañas (mismo patrón que Inventario)
// para que cada tema viva en su propio espacio en vez de ser una fila larga
// de tarjetas mezcladas:
//   Negocio            → identidad: logo, nombre, dirección, teléfono
//   Ticket y venta      → moneda, impuesto, pie de ticket, marca de agua
//   Personalizar pantalla → editor de botones de la pantalla de venta
//   Cuenta              → cambiar mi contraseña
const TABS = [
  { key: 'business', label: 'Negocio' },
  { key: 'ticket', label: 'Ticket y venta' },
  { key: 'toolbar', label: 'Personalizar pantalla' },
  { key: 'functions', label: 'Funciones' },
  { key: 'billing', label: 'Facturación y suscripciones' },
  { key: 'taxes', label: 'Impuestos' },
  { key: 'receipt', label: 'Recibo' },
  { key: 'opentickets', label: 'Tickets abiertos' },
  { key: 'kitchenprinters', label: 'Impresoras de cocina' },
  { key: 'account', label: 'Cuenta' },
];

// Pestañas nuevas que todavía no tienen contenido definido — se agregan
// como espacio reservado en el menú mientras se decide qué va en cada una.
const PLACEHOLDER_TABS = new Set(['functions', 'billing', 'taxes', 'receipt', 'opentickets', 'kitchenprinters']);

let settings = {};
let activeTab = 'business';
// Copia de trabajo de los métodos de pago adicionales a "Efectivo" (que
// siempre está fijo). Se edita agregando/quitando chips y se guarda junto
// con el resto de la pestaña "Ticket y venta".
let paymentMethodsWorking = [];
// Logo del negocio en memoria (base64). Cadena vacía = sin logo (no se manda
// `null` porque el endpoint genérico de settings lo convertiría en el texto
// "null" en vez de borrarlo).
let logoDataValue = '';
// Copia de trabajo del acomodo de botones — se guarda explícitamente con
// "Guardar personalización" (arrastrar/tocar solo actualiza la vista previa).
let toolbarLayout = { top: [], bottom: [], quick: [] };

const catalogById = new Map(POS_BUTTON_CATALOG.map((b) => [b.id, b]));

main.innerHTML = `
  <div class="page-header"><h1>Configuración</h1></div>
  <div class="tabs">
    ${TABS.map((t) => `<button data-tab="${t.key}" class="${t.key === activeTab ? 'active' : ''}">${t.label}</button>`).join('')}
  </div>
  <div class="card">
    <div id="tab-content"></div>
  </div>
`;

const tabContent = document.getElementById('tab-content');

document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    render();
  });
});

function render() {
  if (activeTab === 'business') renderBusinessTab();
  else if (activeTab === 'ticket') renderTicketTab();
  else if (activeTab === 'toolbar') renderToolbarTab();
  else if (activeTab === 'account') renderAccountTab();
  else if (PLACEHOLDER_TABS.has(activeTab)) renderPlaceholderTab();
  else renderAccountTab();
}

// Pestañas agregadas al menú pero sin configuración todavía (se define más
// adelante qué va en cada una).
function renderPlaceholderTab() {
  const label = TABS.find((t) => t.key === activeTab)?.label || '';
  tabContent.innerHTML = `
    <p class="text-secondary">"${label}" todavía no está configurado en esta pantalla — se va a definir más adelante.</p>
  `;
}

// ---------------------------------------------------------------------
// Negocio: logo, nombre, dirección, teléfono
// ---------------------------------------------------------------------
function renderBusinessTab() {
  tabContent.innerHTML = `
    <p class="text-secondary">El nombre y el logo del negocio aparecen en la pantalla de venta y en los tickets impresos.</p>
    <div class="field">
      <label>Logo del negocio (aparece arriba en el ticket impreso)</label>
      <div style="display:flex; align-items:center; gap:12px;">
        <div id="logo-preview" style="width:64px; height:64px; border-radius:8px; border:1px solid var(--border); background:var(--page-plane); display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0;">
          ${logoDataValue ? `<img src="${logoDataValue}" style="width:100%; height:100%; object-fit:contain;" />` : '<span class="text-muted" style="font-size:11px;">Sin logo</span>'}
        </div>
        <input type="file" accept="image/*" id="f-logo" style="display:none;" />
        <button type="button" class="ghost" id="pick-logo-btn">Subir logo</button>
        <button type="button" class="ghost" id="remove-logo-btn" style="${logoDataValue ? '' : 'display:none;'}">Quitar</button>
      </div>
    </div>
    <div class="field"><label>Nombre del negocio</label><input id="f-business-name" value="${settings.business_name || ''}" /></div>
    <div class="field"><label>Dirección</label><input id="f-address" value="${settings.address || ''}" /></div>
    <div class="field"><label>Teléfono</label><input id="f-phone" value="${settings.phone || ''}" /></div>
    <button class="primary" id="save-business-btn">Guardar datos del negocio</button>
  `;

  const logoPreview = document.getElementById('logo-preview');
  const logoFileInput = document.getElementById('f-logo');
  const removeLogoBtn = document.getElementById('remove-logo-btn');

  function renderLogoPreview() {
    logoPreview.innerHTML = logoDataValue
      ? `<img src="${logoDataValue}" style="width:100%; height:100%; object-fit:contain;" />`
      : '<span class="text-muted" style="font-size:11px;">Sin logo</span>';
    removeLogoBtn.style.display = logoDataValue ? '' : 'none';
  }

  document.getElementById('pick-logo-btn').addEventListener('click', () => logoFileInput.click());
  logoFileInput.addEventListener('change', () => {
    const file = logoFileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Selecciona un archivo de imagen.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Se reduce a máximo 400px de lado. Se rellena de blanco antes de
        // dibujar la imagen para que un logo con fondo transparente (como el
        // cubo verde) no salga con fondo negro al convertirlo a JPEG.
        const MAX = 400;
        let { width, height } = img;
        if (width > height && width > MAX) { height = Math.round(height * (MAX / width)); width = MAX; }
        else if (height >= width && height > MAX) { width = Math.round(width * (MAX / height)); height = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        logoDataValue = canvas.toDataURL('image/jpeg', 0.9);
        renderLogoPreview();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  removeLogoBtn.addEventListener('click', () => {
    logoDataValue = '';
    logoFileInput.value = '';
    renderLogoPreview();
  });

  document.getElementById('save-business-btn').addEventListener('click', async () => {
    try {
      await api.put('/api/settings', {
        business_name: document.getElementById('f-business-name').value,
        address: document.getElementById('f-address').value,
        phone: document.getElementById('f-phone').value,
        business_logo: logoDataValue,
      });
      Object.assign(settings, {
        business_name: document.getElementById('f-business-name').value,
        address: document.getElementById('f-address').value,
        phone: document.getElementById('f-phone').value,
        business_logo: logoDataValue,
      });
      toast('Datos del negocio guardados.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---------------------------------------------------------------------
// Ticket y venta: moneda, impuesto, pie de ticket, marca de agua
// ---------------------------------------------------------------------
function renderTicketTab() {
  // Se vuelve a leer de `settings` cada vez que se entra a esta pestaña,
  // para descartar cualquier edición sin guardar de una visita anterior.
  // Formato: [{ name, surchargePct }].
  try {
    const arr = JSON.parse(settings.payment_methods || '[]');
    paymentMethodsWorking = Array.isArray(arr)
      ? arr.filter((m) => m && typeof m.name === 'string' && m.name.trim()).map((m) => ({ name: m.name.trim(), surchargePct: Number(m.surchargePct) || 0 }))
      : [];
  } catch {
    paymentMethodsWorking = [];
  }

  tabContent.innerHTML = `
    <p class="text-secondary">Cómo se calculan y se ven los tickets: la moneda, el impuesto que trae cada producto nuevo por defecto, el pie de página impreso, y el texto de fondo que aparece en la pantalla de venta cuando el ticket está vacío (si lo dejas vacío, se usa el nombre del negocio).</p>
    <div class="grid grid-2">
      <div class="field"><label>Moneda (código ISO)</label><input id="f-currency" placeholder="MXN" value="${settings.currency || 'MXN'}" /></div>
      <div class="field"><label>Impuesto por defecto (%)</label><input type="number" id="f-tax" step="0.01" value="${settings.default_tax_rate ?? '0'}" /></div>
    </div>
    <div class="field"><label>Pie de ticket</label><input id="f-footer" value="${settings.receipt_footer || ''}" /></div>
    <div class="field"><label>Texto de marca de agua (ticket vacío)</label><input id="f-watermark" placeholder="Ej. el eslogan de tu negocio" value="${settings.pos_watermark_text || ''}" /></div>
    <p class="text-secondary" style="font-size:12.5px;">El color de la pantalla de venta usa el verde del logo, y el color de cada categoría o producto se elige aparte, al editarlos en Inventario.</p>

    <div class="field" style="margin-top:22px;">
      <label>Métodos de pago</label>
      <p class="text-secondary" style="font-size:12.5px; margin-top:0;">"Efectivo" siempre está disponible en el cobro (trae su propia calculadora de cambio). Aquí agregas o quitas los demás botones que aparecen junto a él — Tarjeta, Transferencia, o cualquier otro que uses. Si le pones un % de recargo (ej. tarjeta de crédito), en el cobro se le dirá al cajero cuánto marcar en la terminal para cubrirlo — el total de la venta no cambia.</p>
      <div id="payment-methods-list" style="margin-top:8px;"></div>
      <div class="flex gap-8" style="margin-top:10px; align-items:flex-end;">
        <div class="field" style="flex:1; margin-bottom:0;">
          <label style="font-size:11.5px;">Nombre del método</label>
          <input type="text" id="f-new-payment-method" placeholder="Ej. Tarjeta de crédito" maxlength="40" />
        </div>
        <div class="field" style="width:100px; margin-bottom:0;">
          <label style="font-size:11.5px;">Recargo %</label>
          <input type="number" id="f-new-payment-surcharge" step="0.01" min="0" value="0" />
        </div>
        <button type="button" class="ghost" id="add-payment-method-btn">+ Agregar</button>
      </div>
    </div>

    <button class="primary" id="save-ticket-btn" style="margin-top:14px;">Guardar ticket y venta</button>
  `;

  function renderPaymentMethodsList() {
    const container = document.getElementById('payment-methods-list');
    if (paymentMethodsWorking.length === 0) {
      container.innerHTML = '<p class="text-secondary" style="font-size:12.5px;">Solo tienes "Efectivo" por ahora — agrega otro método abajo.</p>';
      return;
    }
    container.innerHTML = paymentMethodsWorking
      .map(
        (m, idx) => `
        <div class="flex gap-8" style="align-items:center; padding:7px 0; border-bottom:1px solid var(--border);">
          <div style="flex:1; font-weight:600; font-size:13.5px;">${m.name}</div>
          <input type="number" class="pm-surcharge" data-idx="${idx}" step="0.01" min="0" value="${m.surchargePct}" style="width:90px;" title="% de recargo" />
          <span class="text-secondary" style="font-size:12px;">% recargo</span>
          <button type="button" class="ghost" data-remove-method="${idx}" title="Quitar" style="padding:4px 10px;">Quitar</button>
        </div>
      `
      )
      .join('');

    container.querySelectorAll('.pm-surcharge').forEach((inp) => {
      inp.addEventListener('input', () => {
        paymentMethodsWorking[Number(inp.dataset.idx)].surchargePct = Number(inp.value) || 0;
      });
    });
    container.querySelectorAll('[data-remove-method]').forEach((btn) => {
      btn.addEventListener('click', () => {
        paymentMethodsWorking.splice(Number(btn.dataset.removeMethod), 1);
        renderPaymentMethodsList();
      });
    });
  }
  renderPaymentMethodsList();

  function addPaymentMethod() {
    const nameInput = document.getElementById('f-new-payment-method');
    const surchargeInput = document.getElementById('f-new-payment-surcharge');
    const name = nameInput.value.trim();
    if (!name) return;
    if (name.toLowerCase() === 'efectivo') {
      toast('"Efectivo" ya está siempre disponible, no hace falta agregarlo.', 'error');
      return;
    }
    if (paymentMethodsWorking.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      toast('Ese método ya está en la lista.', 'error');
      return;
    }
    paymentMethodsWorking.push({ name, surchargePct: Number(surchargeInput.value) || 0 });
    nameInput.value = '';
    surchargeInput.value = '0';
    renderPaymentMethodsList();
  }
  document.getElementById('add-payment-method-btn').addEventListener('click', addPaymentMethod);
  document.getElementById('f-new-payment-method').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addPaymentMethod(); }
  });

  document.getElementById('save-ticket-btn').addEventListener('click', async () => {
    try {
      const payload = {
        currency: document.getElementById('f-currency').value || 'MXN',
        default_tax_rate: document.getElementById('f-tax').value || '0',
        receipt_footer: document.getElementById('f-footer').value,
        pos_watermark_text: document.getElementById('f-watermark').value,
        payment_methods: JSON.stringify(paymentMethodsWorking),
      };
      await api.put('/api/settings', payload);
      Object.assign(settings, payload);
      toast('Ticket y venta guardados.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---------------------------------------------------------------------
// Personalizar pantalla: editor de botones de la pantalla de venta
// ---------------------------------------------------------------------
function activeIdsFor(section) {
  return toolbarLayout[section] && toolbarLayout[section].length > 0
    ? toolbarLayout[section]
    : defaultIdsForSection(section);
}

// Cualquier botón del catálogo puede agregarse a la barra superior o a la
// inferior — no solo a la que trae por defecto — para que la
// personalización no esté limitada a una sola barra. Las "acciones rápidas
// del ticket" siguen siendo su propio conjunto pequeño (no tendría sentido
// meter ahí, por ejemplo, "Reportes"); y al revés, los botones que son
// EXCLUSIVOS de esas acciones rápidas (ej. "Guardar cuenta") tampoco tienen
// sentido en la barra superior/inferior, así que se excluyen de esas dos.
function availableIdsFor(section) {
  const active = new Set(activeIdsFor(section));
  const pool =
    section === 'quick'
      ? defaultIdsForSection(section)
      : POS_BUTTON_CATALOG.filter((b) => !(b.sections.length === 1 && b.sections[0] === 'quick')).map((b) => b.id);
  return pool.filter((id) => !active.has(id));
}

function chipHtml(id, { removable }) {
  const b = catalogById.get(id);
  if (!b) return '';
  return `
    <div class="toolbtn" draggable="true" data-id="${id}" data-chip="1" style="position:relative; cursor:grab; ${removable ? '' : 'opacity:0.55; cursor:pointer;'}">
      ${removable ? `<button type="button" class="chip-remove" data-remove="${id}" title="Quitar" style="position:absolute; top:-7px; right:-7px; width:19px; height:19px; border-radius:50%; background:var(--pos-ink,#161615); color:#fff; border:2px solid var(--pos-surface-2,#f4f4f2); font-size:11px; line-height:15px; padding:0; cursor:pointer;">×</button>` : ''}
      <span class="ico">${icon(b.ico, 18)}</span>
      <span class="lbl">${b.label}</span>
    </div>
  `;
}

function renderSectionEditor(section, label) {
  const active = activeIdsFor(section);
  const available = availableIdsFor(section);
  return `
    <div class="toolbar-editor-section" data-section-block="${section}" style="margin-bottom:26px;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
        <div style="font-weight:600; font-size:13.5px;">${label}</div>
        <button type="button" class="ghost" data-reset="${section}" style="font-size:12px; padding:4px 10px;">Restablecer</button>
      </div>
      <div class="text-secondary" style="font-size:12px; margin-bottom:6px;">En tu punto de venta (arrastra para reordenar, toca la × para quitar):</div>
      <div class="pos-toolbar toolbar-editor-zone" data-zone="active" data-section="${section}" style="flex-wrap:wrap; gap:8px; padding:10px; border:1px dashed var(--pos-line-strong,#b9b9b6); border-radius:8px; min-height:76px; background:var(--pos-surface-2,#f4f4f2);">
        ${active.map((id) => chipHtml(id, { removable: true })).join('') || '<div style="padding:10px; font-size:12.5px; color:var(--text-secondary);">Ningún botón activo — toca alguno de abajo para agregarlo.</div>'}
      </div>
      <div class="text-secondary" style="font-size:12px; margin:12px 0 6px;">Disponibles — toca o arrastra para agregar:</div>
      <div class="pos-toolbar toolbar-editor-zone" data-zone="available" data-section="${section}" style="flex-wrap:wrap; gap:8px; padding:10px; border:1px dashed var(--pos-line,#d8d8d6); border-radius:8px; min-height:66px;">
        ${available.map((id) => chipHtml(id, { removable: false })).join('') || '<div style="padding:10px; font-size:12.5px; color:var(--text-secondary);">Ya agregaste todos los botones disponibles.</div>'}
      </div>
    </div>
  `;
}

function renderToolbarEditor() {
  const container = document.getElementById('toolbar-editor');
  if (!container) return;
  container.innerHTML = `
    <div class="pos-shell" style="position:static; inset:auto; display:block; height:auto; background:transparent; color:var(--pos-ink,#161615); font-family:inherit;">
      ${POS_TOOLBAR_SECTIONS.map((s) => renderSectionEditor(s.key, s.label)).join('')}
    </div>
  `;
  wireZoneDragEvents(container);
}

function wireZoneDragEvents(container) {
  container.querySelectorAll('.toolbar-editor-zone').forEach((zone) => {
    zone.addEventListener('dragover', (e) => e.preventDefault());
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      let data;
      try {
        data = JSON.parse(e.dataTransfer.getData('text/plain'));
      } catch {
        return;
      }
      if (!data || data.section !== zone.dataset.section) return; // no se mezclan entre barras distintas

      const section = data.section;
      const remaining = activeIdsFor(section).filter((x) => x !== data.id);

      if (zone.dataset.zone === 'available') {
        toolbarLayout[section] = remaining; // soltarlo en "disponibles" = quitarlo
      } else {
        const targetChip = e.target.closest('[data-chip]');
        if (targetChip && targetChip.dataset.id !== data.id) {
          const idx = remaining.indexOf(targetChip.dataset.id);
          remaining.splice(idx === -1 ? remaining.length : idx, 0, data.id);
        } else {
          remaining.push(data.id);
        }
        toolbarLayout[section] = remaining;
      }
      renderToolbarEditor();
    });
  });
}

function renderToolbarTab() {
  tabContent.innerHTML = `
    <p class="text-secondary">Arma tu pantalla de venta como quieras: toca un botón de "Disponibles" para agregarlo, arrástralo para acomodarlo donde quieras, y toca la × para quitarlo. <strong>Cualquier botón se puede poner en cualquier barra</strong> — la lista de "Disponibles" de cada barra (superior, inferior y acciones rápidas del ticket) trae TODOS los botones que todavía no están ahí, así que si un botón ya viene por defecto abajo, también lo vas a encontrar en "Disponibles" de la barra de arriba (y al revés). Los cambios se ven aquí mismo antes de guardarlos.</p>
    <div id="toolbar-editor"></div>
    <button class="primary" id="save-toolbar-btn" style="margin-top:6px;">Guardar personalización</button>
  `;

  // Delegación de eventos: el contenedor se recrea cada vez que se entra a
  // esta pestaña, así que se vuelve a enganchar aquí (no una sola vez al
  // cargar la página).
  const container = document.getElementById('toolbar-editor');
  container.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) {
      const chip = removeBtn.closest('[data-section]');
      const section = chip.dataset.section;
      toolbarLayout[section] = activeIdsFor(section).filter((id) => id !== removeBtn.dataset.remove);
      renderToolbarEditor();
      return;
    }
    const resetBtn = e.target.closest('[data-reset]');
    if (resetBtn) {
      toolbarLayout[resetBtn.dataset.reset] = [];
      renderToolbarEditor();
      return;
    }
    const addChip = e.target.closest('.toolbar-editor-zone[data-zone="available"] [data-chip]');
    if (addChip) {
      const zone = addChip.closest('.toolbar-editor-zone');
      const section = zone.dataset.section;
      toolbarLayout[section] = [...activeIdsFor(section), addChip.dataset.id];
      renderToolbarEditor();
    }
  });
  container.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (!chip) return;
    const zone = chip.closest('.toolbar-editor-zone');
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: chip.dataset.id, section: zone.dataset.section }));
    e.dataTransfer.effectAllowed = 'move';
  });

  renderToolbarEditor();

  document.getElementById('save-toolbar-btn').addEventListener('click', async () => {
    try {
      await api.put('/api/settings', { pos_toolbar_layout: JSON.stringify(toolbarLayout) });
      toast('Personalización del punto de venta guardada.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---------------------------------------------------------------------
// Cuenta: cambiar mi contraseña
// ---------------------------------------------------------------------
function renderAccountTab() {
  tabContent.innerHTML = `
    <p class="text-secondary">Cambia la contraseña con la que entras a Mi POS.</p>
    <div class="field" style="max-width:360px;"><label>Contraseña actual</label><input type="password" id="f-current-password" /></div>
    <div class="field" style="max-width:360px;"><label>Nueva contraseña</label><input type="password" id="f-new-password" /></div>
    <button id="save-password-btn">Actualizar contraseña</button>
  `;

  document.getElementById('save-password-btn').addEventListener('click', async () => {
    const currentPassword = document.getElementById('f-current-password').value;
    const newPassword = document.getElementById('f-new-password').value;
    if (!currentPassword || !newPassword) { toast('Completa ambos campos.', 'error'); return; }
    try {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      toast('Contraseña actualizada.', 'success');
      document.getElementById('f-current-password').value = '';
      document.getElementById('f-new-password').value = '';
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function loadAll() {
  try {
    const res = await api.get('/api/settings');
    settings = res.settings;
    logoDataValue = settings.business_logo || '';
    toolbarLayout = resolveToolbarLayout(settings);
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

loadAll();
