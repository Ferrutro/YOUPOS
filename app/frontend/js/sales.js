import { api, requireAuth, getUser, toast, formatMoney, formatDate } from './api.js';
import { renderLayout } from './layout.js';

if (!requireAuth()) throw new Error('no auth');
const user = getUser();
const main = renderLayout('/sales.html');

let sales = [];
let settings = {};

main.innerHTML = `
  <div class="page-header">
    <h1>Historial de ventas</h1>
    <div class="flex gap-8">
      <input type="date" id="from-date" />
      <input type="date" id="to-date" />
      <button id="filter-btn">Filtrar</button>
    </div>
  </div>
  <div class="card">
    <div id="sales-table"></div>
  </div>
`;

const salesTable = document.getElementById('sales-table');
document.getElementById('filter-btn').addEventListener('click', loadSales);

const METHOD_LABELS = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };
const STATUS_BADGE = {
  completed: '<span class="badge good">Completada</span>',
  cancelled: '<span class="badge critical">Cancelada</span>',
  refunded: '<span class="badge warning">Reembolsada</span>',
};

async function loadSales() {
  try {
    const settingsRes = await api.get('/api/settings');
    settings = settingsRes.settings;

    const from = document.getElementById('from-date').value;
    const to = document.getElementById('to-date').value;
    let url = '/api/sales';
    const qs = new URLSearchParams();
    if (from) qs.set('from', `${from} 00:00:00`);
    if (to) qs.set('to', `${to} 23:59:59`);
    if ([...qs].length) url += '?' + qs.toString();

    const res = await api.get(url);
    sales = res.sales;
    renderTable();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderTable() {
  if (sales.length === 0) {
    salesTable.innerHTML = '<div class="empty-state">No hay ventas registradas en este periodo.</div>';
    return;
  }
  salesTable.innerHTML = `
    <table>
      <thead>
        <tr><th>Folio</th><th>Fecha</th><th>Cajero</th><th>Cliente</th><th class="num">Total</th><th>Estado</th><th></th></tr>
      </thead>
      <tbody>
        ${sales
          .map(
            (s) => `
          <tr>
            <td>${s.folio}</td>
            <td>${formatDate(s.created_at)}</td>
            <td>${s.user_name}</td>
            <td>${s.customer_name || 'General'}</td>
            <td class="num">${formatMoney(s.total, settings.currency)}</td>
            <td>${STATUS_BADGE[s.status] || s.status}</td>
            <td class="flex gap-8">
              <button class="ghost" data-action="view" data-id="${s.id}">Ver</button>
              ${s.status === 'completed' && ['admin', 'manager'].includes(user.role) ? `<button class="ghost" data-action="cancel" data-id="${s.id}">Cancelar</button>` : ''}
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
  salesTable.querySelectorAll('button[data-action="view"]').forEach((btn) =>
    btn.addEventListener('click', () => viewSale(Number(btn.dataset.id)))
  );
  salesTable.querySelectorAll('button[data-action="cancel"]').forEach((btn) =>
    btn.addEventListener('click', () => cancelSale(Number(btn.dataset.id)))
  );
}

async function viewSale(id) {
  try {
    const { sale, items, payments } = await api.get(`/api/sales/${id}`);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px">
        <h3>Venta ${sale.folio}</h3>
        <p class="text-secondary">${formatDate(sale.created_at)} · ${STATUS_BADGE[sale.status] || sale.status}</p>
        <table>
          <thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">P. unit.</th><th class="num">Importe</th></tr></thead>
          <tbody>
            ${items.map((i) => `<tr><td>${i.product_name}</td><td class="num">${i.quantity}</td><td class="num">${formatMoney(i.unit_price, settings.currency)}</td><td class="num">${formatMoney(i.line_total, settings.currency)}</td></tr>`).join('')}
          </tbody>
        </table>
        <div class="mt-16">
          <div class="row flex-between"><span>Subtotal</span><span>${formatMoney(sale.subtotal, settings.currency)}</span></div>
          <div class="row flex-between"><span>Impuestos</span><span>${formatMoney(sale.tax_total, settings.currency)}</span></div>
          <div class="row flex-between" style="font-weight:700; font-size:18px;"><span>Total</span><span>${formatMoney(sale.total, settings.currency)}</span></div>
        </div>
        <div class="mt-16">
          <strong>Pagos:</strong>
          ${payments.map((p) => `<div>${METHOD_LABELS[p.method] || p.method}${p.label ? ` (${p.label})` : ''}: ${formatMoney(p.amount, settings.currency)}</div>`).join('')}
        </div>
        <div class="modal-actions">
          <button class="primary" id="close-modal">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#close-modal').addEventListener('click', () => overlay.remove());
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function cancelSale(id) {
  if (!confirm('¿Cancelar esta venta? El inventario de los productos se restaurará.')) return;
  try {
    await api.post(`/api/sales/${id}/cancel`);
    toast('Venta cancelada.', 'success');
    loadSales();
  } catch (err) {
    toast(err.message, 'error');
  }
}

loadSales();
