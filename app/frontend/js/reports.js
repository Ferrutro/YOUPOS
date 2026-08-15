import { api, requireAuth, requireRole, toast, formatMoney } from './api.js';
import { renderLayout } from './layout.js';
import { renderBarChart, renderHBarChart, renderLegend } from './charts.js';

if (!requireAuth()) throw new Error('no auth');
if (!requireRole('admin', 'manager')) throw new Error('no role');
const main = renderLayout('/reports.html');

let settings = {};

function isoDate(d) { return d.toISOString().slice(0, 10); }
const today = new Date();
const sevenDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);

main.innerHTML = `
  <div class="page-header">
    <h1>Reportes</h1>
    <div class="flex gap-8">
      <input type="date" id="from-date" value="${isoDate(sevenDaysAgo)}" />
      <input type="date" id="to-date" value="${isoDate(today)}" />
      <button id="filter-btn">Actualizar</button>
    </div>
  </div>

  <div class="grid grid-4 mb-16">
    <div class="stat-tile"><div class="label">Ventas</div><div class="value" id="stat-sales-count">—</div></div>
    <div class="stat-tile"><div class="label">Ingresos totales</div><div class="value" id="stat-revenue">—</div></div>
    <div class="stat-tile"><div class="label">Utilidad bruta</div><div class="value" id="stat-profit">—</div></div>
    <div class="stat-tile"><div class="label">Productos con stock bajo</div><div class="value" id="stat-low-stock">—</div></div>
  </div>

  <div class="grid grid-2">
    <div class="card">
      <h3>Ventas por día</h3>
      <div id="chart-sales-day"></div>
    </div>
    <div class="card">
      <h3>Métodos de pago</h3>
      <div id="chart-payments"></div>
      <div class="chart-legend" id="legend-payments"></div>
    </div>
  </div>

  <div class="card mt-16">
    <h3>Productos más vendidos</h3>
    <div id="chart-top-products"></div>
  </div>

  <div class="card mt-16">
    <h3>Ventas por cajero</h3>
    <div id="sales-by-user-table"></div>
  </div>
`;

document.getElementById('filter-btn').addEventListener('click', loadAll);

const PAYMENT_LABELS = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };
const PAYMENT_COLORS = { cash: 'var(--series-1)', card: 'var(--series-2)', transfer: 'var(--series-3)', other: 'var(--series-4)' };

function range() {
  const from = document.getElementById('from-date').value;
  const to = document.getElementById('to-date').value;
  return { from: `${from} 00:00:00`, to: `${to} 23:59:59` };
}

async function loadAll() {
  try {
    const { from, to } = range();
    const qs = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

    const [settingsRes, summary, byDay, topProducts, payments, byUser] = await Promise.all([
      api.get('/api/settings'),
      api.get(`/api/reports/summary${qs}`),
      api.get(`/api/reports/sales-by-day${qs}`),
      api.get(`/api/reports/top-products${qs}`),
      api.get(`/api/reports/payments${qs}`),
      api.get(`/api/reports/sales-by-user${qs}`),
    ]);
    settings = settingsRes.settings;

    document.getElementById('stat-sales-count').textContent = summary.sales_count;
    document.getElementById('stat-revenue').textContent = formatMoney(summary.total_revenue, settings.currency);
    document.getElementById('stat-profit').textContent = formatMoney(summary.gross_profit, settings.currency);
    document.getElementById('stat-low-stock').textContent = summary.low_stock_count;

    renderBarChart(document.getElementById('chart-sales-day'), {
      data: byDay.rows.map((r) => ({ label: r.day.slice(5), value: r.total })),
      color: 'var(--series-1)',
      formatValue: (v) => formatMoney(v, settings.currency),
      emptyMessage: 'No hay ventas en este periodo.',
    });

    renderHBarChart(document.getElementById('chart-top-products'), {
      data: topProducts.rows.map((r) => ({ label: r.product_name, value: r.total_qty })),
      formatValue: (v) => `${v} und.`,
      emptyMessage: 'No hay ventas en este periodo.',
    });

    const paymentData = payments.rows.map((r) => ({
      label: PAYMENT_LABELS[r.method] || r.method,
      value: r.total,
      color: PAYMENT_COLORS[r.method] || 'var(--series-5)',
    }));
    renderHBarChart(document.getElementById('chart-payments'), {
      data: paymentData,
      formatValue: (v) => formatMoney(v, settings.currency),
      emptyMessage: 'No hay pagos en este periodo.',
    });
    if (paymentData.length > 1) {
      renderLegend(
        document.getElementById('legend-payments'),
        paymentData.map((d) => ({ label: d.label, color: d.color }))
      );
    } else {
      document.getElementById('legend-payments').innerHTML = '';
    }

    const userTable = document.getElementById('sales-by-user-table');
    if (byUser.rows.length === 0) {
      userTable.innerHTML = '<div class="empty-state">No hay ventas en este periodo.</div>';
    } else {
      userTable.innerHTML = `
        <table>
          <thead><tr><th>Cajero</th><th class="num">Ventas</th><th class="num">Total</th></tr></thead>
          <tbody>
            ${byUser.rows.map((r) => `<tr><td>${r.user_name}</td><td class="num">${r.sales_count}</td><td class="num">${formatMoney(r.total, settings.currency)}</td></tr>`).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

loadAll();
