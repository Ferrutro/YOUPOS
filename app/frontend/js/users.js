import { api, requireAuth, requireRole, getUser, toast } from './api.js';
import { renderLayout } from './layout.js';

if (!requireAuth()) throw new Error('no auth');
if (!requireRole('admin')) throw new Error('no role');
const me = getUser();
const main = renderLayout('/users.html');

let users = [];
const ROLE_LABELS = { admin: 'Administrador', manager: 'Gerente', cashier: 'Cajero' };

main.innerHTML = `
  <div class="page-header">
    <h1>Usuarios</h1>
    <button class="primary" id="new-user-btn">+ Usuario</button>
  </div>
  <div class="card"><div id="users-table"></div></div>
`;

const table = document.getElementById('users-table');
document.getElementById('new-user-btn').addEventListener('click', () => userModal(null));

async function loadAll() {
  try {
    const res = await api.get('/api/users');
    users = res.users;
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function render() {
  table.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        ${users
          .map(
            (u) => `
          <tr>
            <td>${u.name}</td>
            <td>${u.username}</td>
            <td>${ROLE_LABELS[u.role] || u.role}</td>
            <td>${u.active ? '<span class="badge good">Activo</span>' : '<span class="badge muted">Inactivo</span>'}</td>
            <td class="flex gap-8">
              <button class="ghost" data-action="edit" data-id="${u.id}">Editar</button>
              ${u.id !== me.id ? `<button class="ghost" data-action="toggle" data-id="${u.id}">${u.active ? 'Desactivar' : 'Reactivar'}</button>` : ''}
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
  table.querySelectorAll('button[data-action="edit"]').forEach((btn) =>
    btn.addEventListener('click', () => userModal(users.find((u) => u.id === Number(btn.dataset.id))))
  );
  table.querySelectorAll('button[data-action="toggle"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const u = users.find((u) => u.id === Number(btn.dataset.id));
      try {
        await api.put(`/api/users/${u.id}`, { active: !u.active });
        toast('Usuario actualizado.', 'success');
        loadAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}

function userModal(user) {
  const isEdit = !!user;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? 'Editar usuario' : 'Nuevo usuario'}</h3>
      <div class="field"><label>Nombre completo</label><input id="f-name" value="${user?.name || ''}" /></div>
      <div class="field"><label>Usuario</label><input id="f-username" value="${user?.username || ''}" ${isEdit ? 'disabled' : ''} /></div>
      <div class="field">
        <label>Rol</label>
        <select id="f-role">
          <option value="cashier" ${user?.role === 'cashier' ? 'selected' : ''}>Cajero</option>
          <option value="manager" ${user?.role === 'manager' ? 'selected' : ''}>Gerente</option>
          <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Administrador</option>
        </select>
      </div>
      <div class="field"><label>${isEdit ? 'Nueva contraseña (opcional)' : 'Contraseña'}</label><input type="password" id="f-password" /></div>
      <div class="modal-actions">
        <button class="ghost" id="cancel-modal">Cancelar</button>
        <button class="primary" id="save-user">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#cancel-modal').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#save-user').addEventListener('click', async () => {
    const name = overlay.querySelector('#f-name').value.trim();
    const role = overlay.querySelector('#f-role').value;
    const password = overlay.querySelector('#f-password').value;
    if (!name) { toast('El nombre es requerido.', 'error'); return; }
    try {
      if (isEdit) {
        await api.put(`/api/users/${user.id}`, { name, role, ...(password ? { password } : {}) });
      } else {
        const username = overlay.querySelector('#f-username').value.trim();
        if (!username || !password) { toast('Usuario y contraseña son requeridos.', 'error'); return; }
        await api.post('/api/users', { name, username, password, role });
      }
      toast('Usuario guardado.', 'success');
      overlay.remove();
      loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

loadAll();
