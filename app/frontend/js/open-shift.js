// Pantalla de "Abrir turno": paso obligatorio entre el login y el punto de
// venta. Nadie llega al POS sin antes indicar el fondo de caja con el que
// arranca el turno — así siempre hay un turno abierto detrás de cada venta.
import { api, requireAuth, getUser, clearSession, toast } from './api.js';

if (!requireAuth()) throw new Error('no auth');
const user = getUser();

document.body.innerHTML = `
  <div class="login-screen">
    <div class="login-card">
      <div class="brand"><img src="/img/YOUPOS.png" alt="Mi POS" style="height:64px; width:auto; display:block; margin:0 auto 8px;" /> Mi POS</div>
      <div class="subtitle">Hola, ${user.name}. Antes de vender, abrí tu turno de caja.</div>
      <div class="field">
        <label for="opening-amount">Fondo inicial</label>
        <input type="number" id="opening-amount" min="0" step="0.01" value="0" autofocus />
      </div>
      <button type="button" class="primary" style="width:100%" id="open-btn">Abrir turno y continuar</button>
      <button type="button" class="ghost mt-16" style="width:100%" id="logout-btn">Cerrar sesión</button>
    </div>
  </div>
`;

const amountInput = document.getElementById('opening-amount');
const openBtn = document.getElementById('open-btn');

amountInput.addEventListener('focus', () => amountInput.select());

// Si ya tenía un turno abierto (volvió a esta pantalla por el botón "atrás",
// o lo abrió en otra pestaña), no lo hacemos abrir uno de más — lo mandamos
// directo al POS.
api
  .get('/api/cash-sessions/current')
  .then(({ session }) => {
    if (session) window.location.href = '/pos.html';
  })
  .catch(() => { /* si falla la revisión, se queda aquí y puede abrir turno igual */ });

openBtn.addEventListener('click', async () => {
  const amount = Number(amountInput.value || 0);
  if (amount < 0) {
    toast('El fondo inicial no puede ser negativo.', 'error');
    return;
  }
  openBtn.disabled = true;
  openBtn.textContent = 'Abriendo…';
  try {
    await api.post('/api/cash-sessions/open', { opening_amount: amount });
    openBtn.textContent = 'Turno abierto — entrando…';
    window.location.assign('/pos.html');
    // Red de seguridad: si por lo que sea la navegación automática no
    // ocurre (el turno ya quedó abierto de todos modos), dejamos un enlace
    // directo en vez de dejar a alguien varado en esta pantalla.
    setTimeout(() => {
      openBtn.outerHTML =
        '<a href="/pos.html" class="primary" style="display:block; width:100%; padding:9px 16px; border-radius:var(--radius-sm); text-decoration:none; text-align:center; box-sizing:border-box;">Ir al punto de venta →</a>';
    }, 1200);
  } catch (err) {
    toast(err.message, 'error');
    openBtn.disabled = false;
    openBtn.textContent = 'Abrir turno y continuar';
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  clearSession();
  window.location.href = '/index.html';
});
