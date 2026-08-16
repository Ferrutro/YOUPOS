import { api, getUser, clearSession } from './api.js';
import { icon } from './icons.js';
import { getTheme, applyTheme, toggleTheme } from './theme.js';

const ROLE_LABELS = { admin: 'Administrador', manager: 'Gerente', cashier: 'Cajero' };
const THEME_KEY = 'youpos_theme';

// Se aplica de inmediato al cargar el módulo (antes de pintar nada), para
// que no haya un parpadeo claro→oscuro apenas se abre la pantalla.
applyTheme(getTheme(THEME_KEY, 'light'));

// Un solo menú de navegación (panel deslizante desde la derecha), igual en
// TODAS las pantallas — punto de venta incluido — para que desde cualquier
// lado se pueda volver al POS, ir a otra sección, o cerrar sesión.
// Comandero y Cocina ya NO viven aquí — se van a convertir en apps de
// Android (APK) aparte, así que no tiene caso que aparezcan como opción
// dentro del punto de venta web.
const NAV_ITEMS = [
  { label: 'Punto de venta', ico: 'home', href: '/pos.html', roles: ['admin', 'manager', 'cashier'] },
  { label: 'Ventas / Tickets', ico: 'ticket', href: '/sales.html', roles: ['admin', 'manager', 'cashier'] },
  { label: 'Inventario', ico: 'box', href: '/inventory.html', roles: ['admin', 'manager'] },
  { label: 'Corte de caja', ico: 'scissors', href: '/cash.html', roles: ['admin', 'manager', 'cashier'] },
  { label: 'Configuración', ico: 'settings', href: '/settings.html', roles: ['admin'] },
];

export function openNavDrawer() {
  const user = getUser();
  document.querySelectorAll('.pos-drawer-overlay, .pos-side-drawer').forEach((m) => m.remove());

  const items = NAV_ITEMS.filter((i) => !user || i.roles.includes(user.role));

  const overlay = document.createElement('div');
  overlay.className = 'pos-drawer-overlay';
  const drawer = document.createElement('div');
  drawer.className = 'pos-side-drawer';
  drawer.innerHTML = `
    <div class="pos-drawer-header">
      <div class="biz-name" id="nav-drawer-biz-name">Mi Negocio</div>
      <div class="user-name">${user ? `${user.name} · ${ROLE_LABELS[user.role] || user.role}` : ''}</div>
    </div>
    <nav class="pos-drawer-list">
      ${items.map((i) => `<a href="${i.href}">${icon(i.ico, 18)}<span>${i.label}</span></a>`).join('')}
      <button type="button" id="drawer-theme-toggle" class="pos-drawer-theme-btn">
        ${icon(getTheme(THEME_KEY, 'light') === 'dark' ? 'sun' : 'moon', 18)}
        <span>${getTheme(THEME_KEY, 'light') === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>
      </button>
      <a href="/index.html" id="drawer-logout" class="logout">${icon('logout', 18)}<span>Cerrar sesión</span></a>
    </nav>
  `;
  document.body.appendChild(overlay);
  document.body.appendChild(drawer);
  // Un ratito después de insertarlas (no en el mismo tick) para que el
  // navegador sí anime la transición de entrada.
  setTimeout(() => {
    overlay.classList.add('open');
    drawer.classList.add('open');
  }, 10);

  function close() {
    overlay.classList.remove('open');
    drawer.classList.remove('open');
    setTimeout(() => {
      overlay.remove();
      drawer.remove();
    }, 220);
  }
  overlay.addEventListener('click', close);
  drawer.querySelector('#drawer-logout').addEventListener('click', (e) => {
    e.preventDefault();
    clearSession();
    window.location.href = '/index.html';
  });
  drawer.querySelector('#drawer-theme-toggle').addEventListener('click', () => {
    const next = toggleTheme(THEME_KEY, 'light');
    const btn = drawer.querySelector('#drawer-theme-toggle');
    btn.innerHTML = `${icon(next === 'dark' ? 'sun' : 'moon', 18)}<span>${next === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>`;
  });

  // El nombre del negocio se completa aparte (no bloquea abrir el menú).
  api
    .get('/api/settings')
    .then(({ settings }) => {
      const el = document.getElementById('nav-drawer-biz-name');
      if (el && settings.business_name) el.textContent = settings.business_name;
    })
    .catch(() => { /* si falla, se queda el nombre genérico */ });
}

// Pantallas fuera del punto de venta (Ventas, Inventario, Caja,
// Configuración...): cada una es dueña de toda la página, sin barra
// lateral fija — solo un botón de "3 rayitas" arriba a la derecha que abre
// el mismo menú de navegación que el POS.
export function renderLayout() {
  const shell = document.createElement('div');
  shell.className = 'app-shell';
  shell.innerHTML = `
    <button id="nav-menu-btn" class="icon-btn" title="Menú" style="position:fixed; top:14px; right:16px; z-index:50;">${icon('menu', 18)}</button>
    <main class="main-content" id="main-content"></main>
  `;

  document.body.innerHTML = '';
  document.body.appendChild(shell);

  document.getElementById('nav-menu-btn').addEventListener('click', () => openNavDrawer());

  return document.getElementById('main-content');
}
