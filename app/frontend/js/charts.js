// Gráficas SVG simples, sin librerías externas. Sigue las especificaciones
// del skill de dataviz: marcas delgadas, extremos redondeados de 4px,
// gridlines recesivas, leyenda cuando hay 2+ series, tooltip al pasar el mouse.

function niceMax(value) {
  if (value <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const residual = value / magnitude;
  let niceResidual;
  if (residual <= 1) niceResidual = 1;
  else if (residual <= 2) niceResidual = 2;
  else if (residual <= 5) niceResidual = 5;
  else niceResidual = 10;
  return niceResidual * magnitude;
}

function ensureTooltip(container) {
  let tooltip = container.querySelector('.chart-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    container.style.position = 'relative';
    container.appendChild(tooltip);
  }
  return tooltip;
}

function showTooltip(tooltip, container, evt, html) {
  tooltip.innerHTML = html;
  tooltip.style.opacity = '1';
  const rect = container.getBoundingClientRect();
  tooltip.style.left = `${evt.clientX - rect.left + 12}px`;
  tooltip.style.top = `${evt.clientY - rect.top - 28}px`;
}

function hideTooltip(tooltip) {
  tooltip.style.opacity = '0';
}

// Gráfica de barras verticales (columnas), un solo valor por categoría.
export function renderBarChart(container, { data, color = 'var(--series-1)', formatValue = (v) => v, emptyMessage = 'Sin datos en este periodo' }) {
  container.innerHTML = '';
  if (!data || data.length === 0) {
    container.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
    return;
  }

  const width = container.clientWidth || 600;
  const height = 220;
  const paddingLeft = 46;
  const paddingBottom = 28;
  const paddingTop = 12;
  const paddingRight = 8;

  const maxVal = niceMax(Math.max(...data.map((d) => d.value)));
  const plotW = width - paddingLeft - paddingRight;
  const plotH = height - paddingTop - paddingBottom;
  const bandWidth = plotW / data.length;
  const barWidth = Math.min(24, bandWidth * 0.55);

  const ticks = 4;
  let gridlines = '';
  let axisLabels = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (maxVal / ticks) * i;
    const y = paddingTop + plotH - (v / maxVal) * plotH;
    gridlines += `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="var(--gridline)" stroke-width="1" />`;
    axisLabels += `<text x="${paddingLeft - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--text-muted)">${Math.round(v).toLocaleString('es-MX')}</text>`;
  }

  let bars = '';
  let xLabels = '';
  data.forEach((d, i) => {
    const x = paddingLeft + i * bandWidth + (bandWidth - barWidth) / 2;
    const barH = maxVal > 0 ? (d.value / maxVal) * plotH : 0;
    const y = paddingTop + plotH - barH;
    bars += `<rect data-idx="${i}" x="${x}" y="${y}" width="${barWidth}" height="${Math.max(barH, 1)}" rx="4" fill="${color}" style="cursor:pointer" />`;
    xLabels += `<text x="${x + barWidth / 2}" y="${height - 8}" text-anchor="middle" font-size="11" fill="var(--text-muted)">${d.label}</text>`;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Gráfica de barras">
      ${gridlines}
      <line x1="${paddingLeft}" y1="${paddingTop + plotH}" x2="${width - paddingRight}" y2="${paddingTop + plotH}" stroke="var(--border-strong)" stroke-width="1" />
      ${bars}
      ${axisLabels}
      ${xLabels}
    </svg>
  `;

  const tooltip = ensureTooltip(container);
  container.querySelectorAll('rect[data-idx]').forEach((rect) => {
    const d = data[Number(rect.getAttribute('data-idx'))];
    rect.addEventListener('mousemove', (evt) => {
      showTooltip(tooltip, container, evt, `<strong>${d.label}</strong><br>${formatValue(d.value)}`);
    });
    rect.addEventListener('mouseleave', () => hideTooltip(tooltip));
  });
}

// Gráfica de barras horizontales; admite color por barra (para datos categóricos).
export function renderHBarChart(container, { data, formatValue = (v) => v, emptyMessage = 'Sin datos en este periodo' }) {
  container.innerHTML = '';
  if (!data || data.length === 0) {
    container.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
    return;
  }

  const rowHeight = 34;
  const width = container.clientWidth || 600;
  const height = data.length * rowHeight + 16;
  const paddingLeft = 8;
  const labelWidth = 130;
  const paddingRight = 70;
  const plotW = width - labelWidth - paddingRight;

  const maxVal = Math.max(...data.map((d) => d.value), 1);

  let bars = '';
  data.forEach((d, i) => {
    const y = 8 + i * rowHeight;
    const barW = Math.max((d.value / maxVal) * plotW, 2);
    const barH = 18;
    bars += `
      <text x="${labelWidth - 10}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="12" fill="var(--text-primary)">${d.label.length > 18 ? d.label.slice(0, 17) + '…' : d.label}</text>
      <rect data-idx="${i}" x="${labelWidth}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${d.color || 'var(--series-1)'}" style="cursor:pointer" />
      <text x="${labelWidth + barW + 8}" y="${y + barH / 2 + 4}" font-size="12" fill="var(--text-secondary)">${formatValue(d.value)}</text>
    `;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Gráfica de barras horizontales">
      ${bars}
    </svg>
  `;

  const tooltip = ensureTooltip(container);
  container.querySelectorAll('rect[data-idx]').forEach((rect) => {
    const d = data[Number(rect.getAttribute('data-idx'))];
    rect.addEventListener('mousemove', (evt) => {
      showTooltip(tooltip, container, evt, `<strong>${d.label}</strong><br>${formatValue(d.value)}`);
    });
    rect.addEventListener('mouseleave', () => hideTooltip(tooltip));
  });
}

export function renderLegend(container, items) {
  container.innerHTML = items
    .map((i) => `<span class="item"><span class="swatch" style="background:${i.color}"></span>${i.label}</span>`)
    .join('');
}
