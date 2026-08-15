import { api, getUser, clearSession } from './api.js';

const NAV_ITEMS = [
  { href: '/pos.html', label: 'Punto de venta', roles: ['admin', 'manager', 'cashier'] },
  { href: '/comandero.html', label: 'Comandero', roles: ['admin', 'manager', 'cashier'] },
  { href: '/sales.html', label: 'Ventas', roles: ['admin', 'manager', 'cashier'] },
  { href: '/inventory.html', label: 'Inventario', roles: ['admin', 'manager'] },
  { href: '/reports.html', label: 'Reportes', roles: ['admin', 'manager'] },
  { href: '/cash.html', label: 'Caja', roles: ['admin', 'manager', 'cashier'] },
  { href: '/users.html', label: 'Usuarios', roles: ['admin'] },
  { href: '/settings.html', label: 'Configuración', roles: ['admin'] },
];

const ROLE_LABELS = { admin: 'Administrador', manager: 'Gerente', cashier: 'Cajero' };

export function renderLayout(activePage) {
  const user = getUser();
  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const links = NAV_ITEMS.filter((i) => !user || i.roles.includes(user.role))
    .map(
      (i) =>
        `<a href="${i.href}" class="${activePage === i.href ? 'active' : ''}">${i.label}</a>`
    )
    .join('');

  shell.innerHTML = `
    <aside class="sidebar">
      <div class="brand">🧾 Mi POS</div>
      <nav>${links}</nav>
      <div class="user-box">
        <strong>${user ? user.name : ''}</strong>
        <span>${user ? ROLE_LABELS[user.role] || user.role : ''}</span>
        <div class="mt-16"><button id="logout-btn" class="ghost" style="width:100%">Cerrar sesión</button></div>
      </div>
    </aside>
    <main class="main-content" id="main-content"></main>
  `;

  document.body.innerHTML = '';
  document.body.appendChild(shell);

  document.getElementById('logout-btn').addEventListener('click', () => {
    clearSession();
    window.location.href = '/index.html';
  });

  attachLowStockBadge(user);

  return document.getElementById('main-content');
}

// Insignia con el número de productos en stock bajo, junto a "Inventario" en
// el menú lateral. Se revisa cada vez que se carga cualquier pantalla, así
// siempre refleja el inventario actual sin que tengas que ir a buscarlo.
function attachLowStockBadge(user) {
  if (!user || !['admin', 'manager'].includes(user.role)) return;
  api
    .get('/api/products/low-stock')
    .then(({ products }) => {
      const count = products.length;
      if (!count) return;
      const link = document.querySelector('.sidebar nav a[href="/inventory.html"]');
      if (!link) return;
      const badge = document.createElement('span');
      badge.className = 'nav-badge';
      badge.textContent = count;
      badge.title = `${count} producto${count === 1 ? '' : 's'} con stock bajo`;
      link.appendChild(badge);
    })
    .catch(() => {
      /* si falla la consulta, simplemente no se muestra la insignia */
    });
}
