// Modo oscuro / claro — cada pantalla puede tener su propia preferencia
// guardada aparte (ej. Cocina arranca oscura por defecto, el resto del
// sistema arranca claro), identificada por `key`. El atributo se pone en
// <html> para que todo el CSS (styles.css, pos.css, kitchen.css) lo pueda
// usar con selectores tipo `:root[data-theme="dark"]`.
export function getTheme(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(key, theme) {
  try {
    localStorage.setItem(key, theme);
  } catch { /* almacenamiento no disponible, se ignora */ }
  applyTheme(theme);
}

export function toggleTheme(key, fallback) {
  const next = getTheme(key, fallback) === 'dark' ? 'light' : 'dark';
  setTheme(key, next);
  return next;
}
