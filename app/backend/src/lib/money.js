// El dinero se guarda en la base de datos como enteros (centavos) para que
// las sumas en SQL (SUM, agregados de reportes, cálculo de caja) sean
// exactas y no arrastren errores de redondeo de punto flotante. La API REST
// sigue hablando en pesos (con decimales) hacia el frontend: estas dos
// funciones son la única frontera de conversión.
export function toCents(pesos) {
  return Math.round(Number(pesos || 0) * 100);
}

export function fromCents(cents) {
  if (cents === null || cents === undefined) return null;
  return Math.round(Number(cents)) / 100;
}
