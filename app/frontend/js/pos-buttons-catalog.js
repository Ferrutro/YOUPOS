// Catálogo de botones/funciones del punto de venta que el administrador puede
// agregar, quitar y reordenar desde Configuración → Personalizar el punto de
// venta. Cualquier botón del catálogo se puede colocar en CUALQUIER barra
// (superior, inferior o acciones rápidas del ticket) — `sections` es solo
// información de referencia sobre dónde suele usarse cada uno; el permiso
// real de "dónde puede vivir" ya no lo limita (ver `availableIdsFor` en
// settings.js), para que la personalización no esté atada a una sola barra.
export const POS_BUTTON_CATALOG = [
  // Barra superior (funciones)
  { id: 'opentab', label: 'Abrir cuenta', ico: 'layers', sections: ['top'] },
  { id: 'stock', label: 'Existencias', ico: 'box', sections: ['top'] },
  { id: 'switchuser', label: 'Cambiar usuario', ico: 'user', sections: ['top'] },

  // Barra inferior
  { id: 'printticket', label: 'Imprimir cuenta', ico: 'printer', sections: ['bottom'] },
  { id: 'reprint', label: 'Reimprimir ticket', ico: 'printerCheck', sections: ['bottom'] },
  { id: 'drawer', label: 'Abrir cajón', ico: 'drawer', sections: ['bottom'] },
  { id: 'notes', label: 'Notas', ico: 'note', sections: ['bottom'] },
  { id: 'calculator', label: 'Calculadora', ico: 'calculator', sections: ['bottom'] },
  { id: 'scale', label: 'Báscula', ico: 'scale', sections: ['bottom'] },
  { id: 'accounts', label: 'Cuentas', ico: 'user', sections: ['bottom'] },
  { id: 'tickets', label: 'Tickets', ico: 'ticket', sections: ['bottom'] },
  { id: 'reports', label: 'Reportes', ico: 'barChart', sections: ['bottom'] },

  // Acciones rápidas del ticket
  { id: 'newproduct', label: 'Nuevo producto', ico: 'box', sections: ['quick'] },
  { id: 'saveaccount', label: 'Guardar cuenta', ico: 'save', sections: ['quick'] },
  { id: 'sendkitchen', label: 'Enviar a cocina', ico: 'send', sections: ['quick'] },
];

export const POS_TOOLBAR_SECTIONS = [
  { key: 'top', label: 'Barra superior (funciones)' },
  { key: 'bottom', label: 'Barra inferior' },
  { key: 'quick', label: 'Acciones rápidas del ticket' },
];

// Orden que se muestra cuando el administrador todavía no ha personalizado
// una barra. Son listas explícitas (no dependen del orden del catálogo de
// arriba) para que cada barra conserve su orden original sin importar en
// qué otras barras también esté disponible ese mismo botón.
const DEFAULT_IDS = {
  top: ['opentab', 'stock', 'switchuser'],
  bottom: ['printticket', 'reprint', 'drawer', 'notes', 'calculator', 'scale', 'accounts', 'tickets', 'reports'],
  quick: ['newproduct', 'saveaccount', 'sendkitchen'],
};

// Ids del catálogo que se muestran por defecto en una sección, en el orden
// por defecto (antes de cualquier personalización).
export function defaultIdsForSection(section) {
  return (DEFAULT_IDS[section] || []).slice();
}

// Aplica una lista guardada de ids activos (en el orden elegido por el
// usuario) sobre el arreglo real de botones ya construido (con sus
// onClick/disabled ya resueltos). `null`/`undefined` significa "sin
// personalizar todavía": se muestran todos, en el orden por defecto. Un
// arreglo vacío `[]` es distinto — significa que el administrador quitó
// TODOS los botones a propósito, así que esa barra se queda sin nada.
export function applyToolbarLayout(buttons, activeIds) {
  if (activeIds == null) return buttons;
  const byId = new Map(buttons.map((b) => [b.id, b]));
  return activeIds.map((id) => byId.get(id)).filter(Boolean);
}

// Lee `settings.pos_toolbar_layout` (formato nuevo) o, si no existe, migra
// desde el esquema anterior `settings.pos_hidden_buttons` (una lista de ids
// ocultos) para no perder personalizaciones ya guardadas. Cada barra vale
// `null` si nunca se personalizó (usa los botones por defecto) o un arreglo
// (posiblemente vacío) si el administrador ya la editó — un arreglo vacío
// NO es lo mismo que "nunca se tocó": es "se dejó sin botones a propósito".
export function resolveToolbarLayout(settings) {
  if (settings && settings.pos_toolbar_layout) {
    try {
      const parsed = JSON.parse(settings.pos_toolbar_layout);
      return {
        top: Array.isArray(parsed.top) ? parsed.top : null,
        bottom: Array.isArray(parsed.bottom) ? parsed.bottom : null,
        quick: Array.isArray(parsed.quick) ? parsed.quick : null,
      };
    } catch {
      // cae a la migración de abajo si el JSON guardado está corrupto
    }
  }
  const layout = { top: null, bottom: null, quick: null };
  if (settings && settings.pos_hidden_buttons) {
    try {
      const hidden = new Set(JSON.parse(settings.pos_hidden_buttons));
      for (const key of ['top', 'bottom', 'quick']) {
        const defaults = defaultIdsForSection(key);
        const filtered = defaults.filter((id) => !hidden.has(id));
        if (filtered.length !== defaults.length) layout[key] = filtered;
      }
    } catch {
      // ignorar si también está corrupto: se queda en null (= por defecto)
    }
  }
  return layout;
}
