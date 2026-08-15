import { api, requireAuth, toast } from './api.js';
import { renderLayout } from './layout.js';

if (!requireAuth()) throw new Error('no auth');
const main = renderLayout('/customers.html');

let customers = [];

main.innerHTML = `
  <div class="page-header">
    <h1>Clientes</h1>
    <button class="primary" id="new-customer-btn">+ Cliente</button>
  </div>
  <div class="card">
    <input type="text" id="search-input" placeholder="Buscar por nombre, teléfono o correo…" style="max-width:360px; margin-bottom:14px;" />
    <div id="customers-table"></div>
  </div>
`;

const table = document.getElementById('customers-table');
const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', render);
document.getElementById('new-customer-btn').addEventListener('click', () => customerModal(null));

async function loadAll() {
  try {
    const res = await api.get('/api/customers');
    customers = res.customers;
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function render() {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = q
    ? customers.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q)
      )
    : customers;

  if (filtered.length === 0) {
    table.innerHTML = '<div class="empty-state">No hay clientes.</div>';
    return;
  }

  table.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th></th></tr></thead>
      <tbody>
        ${filtered
          .map(
            (c) => `
          <tr>
            <td>${c.name}</td>
            <td>${c.phone || '—'}</td>
            <td>${c.email || '—'}</td>
            <td class="flex gap-8">
              <button class="ghost" data-action="edit" data-id="${c.id}">Editar</button>
              <button class="ghost" data-action="delete" data-id="${c.id}">Eliminar</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  table.querySelectorAll('button[data-action="edit"]').forEach((btn) =>
    btn.addEventListener('click', () => customerModal(customers.find((c) => c.id === Number(btn.dataset.id))))
  );
  table.querySelectorAll('button[data-action="delete"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este cliente?')) return;
      try {
        await api.delete(`/api/customers/${btn.dataset.id}`);
        toast('Cliente eliminado.', 'success');
        loadAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}

function customerModal(customer) {
  const isEdit = !!customer;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? 'Editar cliente' : 'Nuevo cliente'}</h3>
      <div class="field"><label>Nombre</label><input id="f-name" value="${customer?.name || ''}" /></div>
      <div class="grid grid-2">
        <div class="field"><label>Teléfono</label><input id="f-phone" value="${customer?.phone || ''}" /></div>
        <div class="field"><label>Correo</label><input id="f-email" value="${customer?.email || ''}" /></div>
      </div>
      <div class="field"><label>RFC / ID fiscal</label><input id="f-tax-id" value="${customer?.tax_id || ''}" /></div>
      <div class="field"><label>Dirección</label><input id="f-address" value="${customer?.address || ''}" /></div>
      <div class="field"><label>Notas</label><textarea id="f-notes" rows="2">${customer?.notes || ''}</textarea></div>
      <div class="modal-actions">
        <button class="ghost" id="cancel-modal">Cancelar</button>
        <button class="primary" id="save-customer">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#cancel-modal').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#save-customer').addEventListener('click', async () => {
    const body = {
      name: overlay.querySelector('#f-name').value.trim(),
      phone: overlay.querySelector('#f-phone').value.trim(),
      email: overlay.querySelector('#f-email').value.trim(),
      tax_id: overlay.querySelector('#f-tax-id').value.trim(),
      address: overlay.querySelector('#f-address').value.trim(),
      notes: overlay.querySelector('#f-notes').value.trim(),
    };
    if (!body.name) { toast('El nombre es requerido.', 'error'); return; }
    try {
      if (isEdit) await api.put(`/api/customers/${customer.id}`, body);
      else await api.post('/api/customers', body);
      toast('Cliente guardado.', 'success');
      overlay.remove();
      loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

loadAll();
