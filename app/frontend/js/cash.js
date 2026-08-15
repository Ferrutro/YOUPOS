import { api, requireAuth, getUser, toast, formatMoney, formatDate } from './api.js';
import { renderLayout } from './layout.js';

if (!requireAuth()) throw new Error('no auth');
const user = getUser();
const main = renderLayout('/cash.html');

let currentSession = null;
let sessions = [];
let settings = {};
let movements = [];
let summary = null;

main.innerHTML = `
  <div class="page-header"><h1>Turno</h1></div>
  <div id="current-session-card"></div>
  <div class="card mt-16" id="movements-card" style="display:none;"></div>
  <div class="card mt-16">
    <h3>Historial de turnos</h3>
    <div id="sessions-table"></div>
  </div>
`;

const currentCard = document.getElementById('current-session-card');
const movementsCard = document.getElementById('movements-card');
const sessionsTable = document.getElementById('sessions-table');

async function loadAll() {
  try {
    const [settingsRes, currentRes, sessionsRes] = await Promise.all([
      api.get('/api/settings'),
      api.get('/api/cash-sessions/current'),
      api.get('/api/cash-sessions'),
    ]);
    settings = settingsRes.settings;
    currentSession = currentRes.session;
    sessions = sessionsRes.sessions;
    if (currentSession) {
      const summaryRes = await api.get(`/api/cash-sessions/${currentSession.id}/summary`);
      summary = summaryRes.summary;
      await loadMovements();
    } else {
      summary = null;
      movements = [];
      movementsCard.style.display = 'none';
    }
    renderCurrent();
    renderTable();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function money(n) {
  return formatMoney(n, settings.currency);
}

function turnoRow(label, value, { bold = false, divider = false } = {}) {
  return `
    <div class="cash-turno-row ${bold ? 'bold' : ''} ${divider ? 'divider' : ''}">
      <span>${label}</span>
      <span>${money(value)}</span>
    </div>
  `;
}

function renderCurrent() {
  if (!currentSession) {
    currentCard.innerHTML = `
      <div class="cash-turno">
        <div class="cash-turno-title">No tienes un turno abierto</div>
        <p class="cash-turno-sub">Abre un turno para comenzar a registrar tus ventas de hoy.</p>
        <div class="cash-turno-field">
          <label>Fondo inicial</label>
          <input type="number" id="opening-amount" value="0" step="0.01" />
        </div>
        <button class="cash-turno-btn" id="open-btn">Abrir turno</button>
      </div>
    `;
    document.getElementById('open-btn').addEventListener('click', async () => {
      const amount = Number(document.getElementById('opening-amount').value || 0);
      try {
        await api.post('/api/cash-sessions/open', { opening_amount: amount });
        toast('Turno abierto.', 'success');
        loadAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    return;
  }

  currentCard.innerHTML = `
    <div class="cash-turno">
      <div class="cash-turno-title">Número del cierre de caja: ${currentSession.id}</div>
      <div class="cash-turno-row header-line">
        <span>Abierto: ${user.name}</span>
        <span>${formatDate(currentSession.opened_at)}</span>
      </div>

      <div class="cash-turno-section">Cajón de efectivo</div>
      ${turnoRow('Fondo de caja anterior', summary.opening_amount)}
      ${turnoRow('Cobros en efectivo', summary.cash_collections)}
      ${turnoRow('Reembolsos en efectivo', summary.cash_refunds)}
      ${turnoRow('Depositado', summary.deposited)}
      ${turnoRow('Pagos/Salidas', summary.paid_out)}
      ${turnoRow('Efectivo teórico en caja', summary.theoretical_cash, { bold: true })}

      <div class="cash-turno-section">Resumen de ventas</div>
      ${turnoRow('Ventas brutas', summary.gross_sales, { bold: true })}
      ${turnoRow('Reembolsos', summary.refunds)}
      ${turnoRow('Descuentos', summary.discounts)}
      ${turnoRow('Ventas netas', summary.net_sales, { bold: true, divider: true })}

      <div class="cash-turno-section">Cerrar turno</div>
      <div class="cash-turno-field">
        <label>Monto contado en caja</label>
        <input type="number" id="closing-amount" value="0" step="0.01" />
      </div>
      <div class="cash-turno-field">
        <label>Notas</label>
        <input id="closing-notes" placeholder="Opcional" />
      </div>
      <button class="cash-turno-btn danger" id="close-btn">Cerrar turno</button>
    </div>
  `;
  document.getElementById('close-btn').addEventListener('click', async () => {
    const closing_amount = Number(document.getElementById('closing-amount').value || 0);
    const notes = document.getElementById('closing-notes').value;
    if (!confirm('¿Cerrar el turno de caja actual?')) return;
    try {
      const result = await api.post(`/api/cash-sessions/${currentSession.id}/close`, { closing_amount, notes });
      toast(`Turno cerrado. Diferencia: ${formatMoney(result.difference, settings.currency)}`, result.difference === 0 ? 'success' : 'info');
      loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function loadMovements() {
  try {
    const res = await api.get(`/api/cash-sessions/${currentSession.id}/movements`);
    movements = res.movements;
    renderMovements();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderMovements() {
  movementsCard.style.display = 'block';
  const deposits = movements.filter((m) => m.type === 'deposit').reduce((s, m) => s + m.amount, 0);
  const withdrawals = movements.filter((m) => m.type === 'withdrawal').reduce((s, m) => s + m.amount, 0);

  const rowsHtml =
    movements.length === 0
      ? '<div class="empty-state">Sin retiros ni depósitos en este turno.</div>'
      : `
        <table>
          <thead><tr><th>Tipo</th><th>Nota</th><th>Cajero</th><th>Hora</th><th class="num">Monto</th></tr></thead>
          <tbody>
            ${movements
              .map(
                (m) => `
              <tr>
                <td>${m.type === 'deposit' ? '<span class="badge good">Depósito</span>' : '<span class="badge warning">Retiro</span>'}</td>
                <td>${m.note || '—'}</td>
                <td>${m.user_name}</td>
                <td>${formatDate(m.created_at)}</td>
                <td class="num">${m.type === 'withdrawal' ? '-' : ''}${formatMoney(m.amount, settings.currency)}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `;

  movementsCard.innerHTML = `
    <h3>Retiros y depósitos de caja</h3>
    <p class="text-secondary">Depósitos: ${formatMoney(deposits, settings.currency)} · Retiros: ${formatMoney(withdrawals, settings.currency)}</p>
    <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; margin-bottom:16px;">
      <div class="field" style="max-width:160px; margin-bottom:0;">
        <label>Tipo</label>
        <select id="mov-type">
          <option value="withdrawal">Retiro</option>
          <option value="deposit">Depósito</option>
        </select>
      </div>
      <div class="field" style="max-width:140px; margin-bottom:0;">
        <label>Monto</label>
        <input type="number" id="mov-amount" step="0.01" min="0" />
      </div>
      <div class="field" style="flex:1; min-width:180px; margin-bottom:0;">
        <label>Nota (opcional)</label>
        <input id="mov-note" placeholder="Ej. Depósito a bóveda" />
      </div>
      <button class="primary" id="mov-add">Registrar</button>
    </div>
    ${rowsHtml}
  `;

  document.getElementById('mov-add').addEventListener('click', async () => {
    const type = document.getElementById('mov-type').value;
    const amount = Number(document.getElementById('mov-amount').value || 0);
    const note = document.getElementById('mov-note').value.trim();
    if (!amount || amount <= 0) { toast('Indica un monto mayor a cero.', 'error'); return; }
    try {
      await api.post(`/api/cash-sessions/${currentSession.id}/movements`, { type, amount, note: note || null });
      toast(type === 'deposit' ? 'Depósito registrado.' : 'Retiro registrado.', 'success');
      await loadMovements();
      const summaryRes = await api.get(`/api/cash-sessions/${currentSession.id}/summary`);
      summary = summaryRes.summary;
      renderCurrent();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function renderTable() {
  if (sessions.length === 0) {
    sessionsTable.innerHTML = '<div class="empty-state">Sin turnos registrados aún.</div>';
    return;
  }
  sessionsTable.innerHTML = `
    <table>
      <thead>
        <tr><th>Cajero</th><th>Apertura</th><th>Cierre</th><th class="num">Fondo inicial</th><th class="num">Esperado</th><th class="num">Contado</th><th class="num">Diferencia</th><th>Estado</th></tr>
      </thead>
      <tbody>
        ${sessions
          .map(
            (s) => `
          <tr>
            <td>${s.user_name}</td>
            <td>${formatDate(s.opened_at)}</td>
            <td>${s.closed_at ? formatDate(s.closed_at) : '—'}</td>
            <td class="num">${formatMoney(s.opening_amount, settings.currency)}</td>
            <td class="num">${s.expected_amount != null ? formatMoney(s.expected_amount, settings.currency) : '—'}</td>
            <td class="num">${s.closing_amount != null ? formatMoney(s.closing_amount, settings.currency) : '—'}</td>
            <td class="num">${s.difference != null ? formatMoney(s.difference, settings.currency) : '—'}</td>
            <td>${s.status === 'open' ? '<span class="badge good">Abierto</span>' : '<span class="badge muted">Cerrado</span>'}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

loadAll();
