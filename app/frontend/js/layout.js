import { clearSession } from './api.js';
import { icon } from './icons.js';

// Cada pantalla (Ventas, Inventario, Caja, Configuración...) ocupa toda la
// página, sin barra lateral de navegación fija — para moverse entre
// pantallas se usa el menú del punto de venta. Acá solo queda un botón
// chico para cerrar sesión, ya que en ningún otro lado de estas pantallas
// hay forma de hacerlo.
export function renderLayout() {
  const shell = document.createElement('div');
  shell.className = 'app-shell';
  shell.innerHTML = `
    <button id="logout-btn" class="ghost" title="Cerrar sesión"
      style="position:fixed; top:14px; right:16px; z-index:50; display:flex; align-items:center; gap:6px;">
      ${icon('logout', 15)} Cerrar sesión
    </button>
    <main class="main-content" id="main-content"></main>
  `;

  document.body.innerHTML = '';
  document.body.appendChild(shell);

  document.getElementById('logout-btn').addEventListener('click', () => {
    clearSession();
    window.location.href = '/index.html';
  });

  return document.getElementById('main-content');
}
