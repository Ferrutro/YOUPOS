// Cliente API + utilidades compartidas por todas las páginas.

const TOKEN_KEY = 'pos_token';
const USER_KEY = 'pos_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function requireAuth() {
  if (!getToken()) {
    window.location.href = '/index.html';
    return false;
  }
  return true;
}

export function requireRole(...roles) {
  const user = getUser();
  if (!user || !roles.includes(user.role)) {
    window.location.href = '/pos.html';
    return false;
  }
  return true;
}

// A dónde mandar al usuario justo después de iniciar sesión (o al volver a
// index.html/pos.html ya logueado): si todavía no tiene un turno de caja
// abierto, primero pasa por "Abrir turno" — recién ahí puede usar el POS.
export async function goToPostLoginScreen() {
  try {
    const { session } = await apiFetch('/api/cash-sessions/current');
    window.location.href = session ? '/pos.html' : '/open-shift.html';
  } catch {
    // Si la revisión falla (ej. red caída un instante), no dejamos a nadie
    // varado en la pantalla de login — lo mandamos al POS de todos modos.
    window.location.href = '/pos.html';
  }
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }

  // Solo forzamos el redirect a login si YA había una sesión y el servidor la
  // rechazó (token expirado/inválido). Si no había token (p. ej. un intento
  // de login fallido), dejamos que el error se muestre normalmente.
  if (res.status === 401 && token) {
    clearSession();
    window.location.href = '/index.html';
    throw new ApiError(401, 'Sesión expirada');
  }

  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || 'Error en la solicitud');
  }
  return data;
}

export const api = {
  get: (path) => apiFetch(path, { method: 'GET' }),
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body || {}) }),
  put: (path, body) => apiFetch(path, { method: 'PUT', body: JSON.stringify(body || {}) }),
  delete: (path) => apiFetch(path, { method: 'DELETE' }),
};

// --- Notificaciones tipo "toast" ---
export function toast(message, type = 'info') {
  // Si la pantalla tiene su propio shell con overrides de estilo (p. ej. el
  // POS, que por ahora se mantiene sin color), los toasts se anclan ahí
  // para heredar esos overrides en vez de ir al body a secas.
  const root = document.querySelector('.pos-shell') || document.body;
  let container = root.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    root.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// --- Formato de moneda ---
export function formatMoney(amount, currency = 'MXN') {
  const n = Number(amount || 0);
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(n);
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}
