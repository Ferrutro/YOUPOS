// Set de iconos de línea, minimalistas, sin color (heredan currentColor).
// Cada entrada es el contenido interno de un <svg viewBox="0 0 24 24">.
// Estilo consistente: stroke=currentColor, sin relleno, trazos redondeados.

const RAW = {
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  truck: '<rect x="1" y="7" width="13" height="10" rx="1"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="6" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>',
  archiveIn: '<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="5" y="8" width="14" height="12" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/>',
  tag: '<path d="M12 3h6a2 2 0 0 1 2 2v6l-9.5 9.5a2 2 0 0 1-2.8 0L3.5 16.3a2 2 0 0 1 0-2.8L12 3z"/><circle cx="16" cy="8" r="1.6"/>',
  box: '<path d="M3 8l9-5 9 5-9 5-9-5z"/><path d="M3 8v9l9 5 9-5V8"/><line x1="12" y1="13" x2="12" y2="22"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 13a8 8 0 0 0 14.6 4.5"/><polyline points="20 4 20 11 13 11"/><polyline points="4 20 4 13 11 13"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9c.2.6.7 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  printer: '<path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="1"/><path d="M6 14h12v7H6z"/>',
  printerCheck: '<path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="6" rx="1"/><path d="M6 14h12v7H6z"/><polyline points="9 17.5 11 19.5 15 15.5"/>',
  drawer: '<rect x="3" y="4" width="18" height="16" rx="1"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="10" y1="16" x2="14" y2="16"/>',
  note: '<path d="M6 3h9l5 5v13H6z"/><path d="M15 3v5h5"/><line x1="9" y1="12" x2="16" y2="12"/><line x1="9" y1="16" x2="14" y2="16"/>',
  calculator: '<rect x="5" y="2" width="14" height="20" rx="1.5"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="8" y2="11"/><line x1="12" y1="11" x2="12" y2="11"/><line x1="16" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="8" y2="15"/><line x1="12" y1="15" x2="12" y2="15"/><line x1="16" y1="15" x2="16" y2="15"/><line x1="8" y1="19" x2="8" y2="19"/><line x1="12" y1="19" x2="12" y2="19"/><line x1="16" y1="19" x2="16" y2="19"/>',
  scale: '<line x1="12" y1="3" x2="12" y2="21"/><line x1="4" y1="7" x2="20" y2="7"/><path d="M4 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/><path d="M20 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/><rect x="8" y="19" width="8" height="2" rx="1"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="1.5"/><line x1="6" y1="10" x2="6" y2="10"/><line x1="9" y1="10" x2="9" y2="10"/><line x1="12" y1="10" x2="12" y2="10"/><line x1="15" y1="10" x2="15" y2="10"/><line x1="18" y1="10" x2="18" y2="10"/><line x1="7" y1="14" x2="17" y2="14"/>',
  keypad: '<rect x="6" y="2" width="12" height="20" rx="1.5"/><line x1="9" y1="6" x2="9" y2="6"/><line x1="12" y1="6" x2="12" y2="6"/><line x1="15" y1="6" x2="15" y2="6"/><line x1="9" y1="10" x2="9" y2="10"/><line x1="12" y1="10" x2="12" y2="10"/><line x1="15" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="9" y2="14"/><line x1="12" y1="14" x2="12" y2="14"/><line x1="15" y1="14" x2="15" y2="14"/>',
  banknote: '<rect x="2" y="6" width="20" height="12" rx="1.5"/><circle cx="12" cy="12" r="2.5"/><line x1="6" y1="9" x2="6" y2="9"/><line x1="18" y1="15" x2="18" y2="15"/>',
  ticket: '<path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a1.6 1.6 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a1.6 1.6 0 0 0 0-4z"/><line x1="10" y1="7" x2="10" y2="17" stroke-dasharray="2 2"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/>',
  creditCard: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/>',
  barChart: '<line x1="5" y1="21" x2="5" y2="11"/><line x1="12" y1="21" x2="12" y2="6"/><line x1="19" y1="21" x2="19" y2="15"/>',
  scissors: '<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><line x1="8" y1="7.6" x2="20" y2="19"/><line x1="8" y1="16.4" x2="20" y2="5"/>',
  percent: '<line x1="5" y1="19" x2="19" y2="5"/><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/>',
  x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  check: '<polyline points="4 13 9 18 20 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.2" y2="16.2"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-10-9.3C.4 7.7 2.4 4 6 4c2 0 3.6 1.1 4.5 2.7C11.4 5.1 13 4 15 4c3.6 0 5.6 3.7 4 7.2-2.5 4.7-10 9.3-10 9.3z"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16z"/><line x1="13" y1="6" x2="17" y2="10"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>',
  star: '<polygon points="12 3 14.8 9 21 9.7 16.3 13.9 17.7 20 12 16.8 6.3 20 7.7 13.9 3 9.7 9.2 9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  menu: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  share: '<circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><line x1="8.2" y1="10.7" x2="15.8" y2="6.3"/><line x1="8.2" y1="13.3" x2="15.8" y2="17.7"/>',
  layers: '<polygon points="12 3 21 8.2 12 13.4 3 8.2"/><polyline points="3 13.5 12 18.7 21 13.5"/>',
  utensils: '<path d="M6 2v8a2 2 0 0 0 4 0V2"/><line x1="8" y1="2" x2="8" y2="22"/><path d="M17 2c-2 0-3 2-3 5s1 4 3 4v11"/>',
  bag: '<path d="M6 8h12l1 13H5z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  tabletSmartphone: '<rect x="3" y="4" width="12" height="16" rx="1.5"/><line x1="9" y1="17" x2="9" y2="17"/><rect x="16" y="9" width="6" height="11" rx="1"/>',
  save: '<path d="M5 3h11l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v6h8V3"/><rect x="7" y="13" width="10" height="8" rx="0.5"/>',
  send: '<line x1="21" y1="3" x2="10" y2="14"/><polygon points="21 3 14 21 10 14 3 10 21 3"/>',
  merge: '<rect x="1.5" y="9" width="7" height="7" rx="1.3"/><rect x="15.5" y="9" width="7" height="7" rx="1.3"/><line x1="9" y1="12.5" x2="15" y2="12.5"/><polyline points="12 10 15 12.5 12 15"/>',
};

export function icon(name, size = 18) {
  const inner = RAW[name] || RAW.box;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
