/**
 * chart.js — Gráfica donut de gastos por categoría y gráfica de líneas (patrimonio).
 *
 * Depende de Chart.js cargado desde CDN.
 */

let _donutChart = null;
let _donutFocused = null; // índice (en data) de la categoría enfocada, o null
let _donutHovered = null; // índice hovered actualmente (para dim en runtime)

function _isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}
function _segmentBorder() {
  return _isDark() ? '#221f1b' : '#faf9f7';
}

/** Plugin custom: dibuja el % sobre cada segmento con suficiente tamaño. */
const _datalabelsPlugin = {
  id: 'donutDataLabels',
  afterDatasetDraw(chart, args) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const ds = chart.data.datasets[0];
    if (!meta || !meta.data) return;

    const total = ds.data.reduce((s, v) => s + (v || 0), 0);
    if (total <= 0) return;

    ctx.save();
    ctx.font = "700 11px 'Inter', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    meta.data.forEach((arc, i) => {
      const value = ds.data[i] || 0;
      const pct = (value / total) * 100;
      // Sólo mostramos % si el segmento ocupa al menos un 6% (sino se amontona).
      if (pct < 6) return;

      const { x, y, startAngle, endAngle, innerRadius, outerRadius } = arc.getProps(
        ['x', 'y', 'startAngle', 'endAngle', 'innerRadius', 'outerRadius'],
        true,
      );
      const midAngle = (startAngle + endAngle) / 2;
      const midRadius = (innerRadius + outerRadius) / 2;
      const lx = x + Math.cos(midAngle) * midRadius;
      const ly = y + Math.sin(midAngle) * midRadius;

      const label = pct.toFixed(0) + '%';
      // Sombra leve para legibilidad sobre colores claros.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillText(label, lx + 0.6, ly + 0.6);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, lx, ly);
    });
    ctx.restore();
  },
};

/** Convierte hex (#rrggbb) a rgba con alpha. */
function _hexToRgba(hex, alpha) {
  if (!hex || hex[0] !== '#') return hex;
  const h = hex.length === 4
    ? '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
    : hex;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Recalcula los colores del dataset aplicando el dim (hover o foco). */
function _applyDim(chart) {
  if (!chart) return;
  const ds = chart.data.datasets[0];
  if (!ds._baseColors) return;
  const focus = _donutFocused;
  const hover = _donutHovered;
  const active = (hover != null) ? hover : focus;
  ds.backgroundColor = ds._baseColors.map((c, i) => {
    if (active == null) return c;
    return i === active ? c : _hexToRgba(c, 0.18);
  });
}

window.DonutChart = {
  /**
   * Renderiza o actualiza la gráfica donut.
   * @param {string} canvasId
   * @param {{ name: string, color: string, totalCents: number }[]} data
   * @param {number} grandTotal - total en céntimos
   */
  render(canvasId, data, grandTotal) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const labels = data.map(d => d.name);
    const values = data.map(d => d.totalCents / 100);
    const colors = data.map(d => d.color);
    const pcts   = data.map(d => grandTotal > 0 ? ((d.totalCents / grandTotal) * 100).toFixed(1) : 0);

    // Si el foco apunta a un índice que ya no existe (datos cambiaron), reseteamos.
    if (_donutFocused != null && _donutFocused >= data.length) _donutFocused = null;

    const segmentBorder = _segmentBorder();

    if (_donutChart) {
      _donutChart.data.labels = labels;
      _donutChart.data.datasets[0]._baseColors = colors;
      _donutChart.data.datasets[0].data = values;
      _donutChart.data.datasets[0].backgroundColor = colors.slice();
      _donutChart.data.datasets[0].borderColor = segmentBorder;
      _donutChart.data.datasets[0].hoverBorderColor = segmentBorder;
      _donutChart.options.plugins.tooltip.callbacks.label = _tooltipCb(pcts);
      _applyDim(_donutChart);
      _donutChart.update();
      return;
    }

    _donutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          _baseColors: colors,
          backgroundColor: colors.slice(),
          borderWidth: 2,
          borderColor: segmentBorder,
          hoverBorderColor: segmentBorder,
          borderRadius: 6,
          spacing: 1,
          hoverOffset: 14,
          borderAlign: 'inner',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '66%',
        layout: { padding: 8 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1815',
            titleFont: { family: "'Inter', sans-serif", size: 13, weight: 600 },
            bodyFont:  { family: "'DM Mono', monospace", size: 13 },
            padding: 10,
            cornerRadius: 8,
            displayColors: true,
            boxWidth: 10,
            boxHeight: 10,
            boxPadding: 4,
            callbacks: {
              label: _tooltipCb(pcts),
            },
          },
        },
        onHover: (evt, elements) => {
          const newHover = elements && elements.length > 0 ? elements[0].index : null;
          if (newHover !== _donutHovered) {
            _donutHovered = newHover;
            _applyDim(_donutChart);
            _donutChart.update('none');
          }
        },
        animation: {
          animateRotate: true,
          duration: 700,
          easing: 'easeOutQuart',
        },
      },
      plugins: [_datalabelsPlugin],
    });
  },

  /** Refresca colores dependientes del tema (borde de los segmentos). */
  updateTheme() {
    if (!_donutChart) return;
    const segmentBorder = _segmentBorder();
    _donutChart.data.datasets[0].borderColor = segmentBorder;
    _donutChart.data.datasets[0].hoverBorderColor = segmentBorder;
    _donutChart.update('none');
  },

  /** Marca la categoría enfocada (índice o null para limpiar). */
  setFocus(index) {
    _donutFocused = (index == null) ? null : index;
    if (!_donutChart) return;
    _applyDim(_donutChart);
    _donutChart.update('none');
  },

  getFocus() { return _donutFocused; },

  destroy() {
    if (_donutChart) { _donutChart.destroy(); _donutChart = null; }
    _donutFocused = null;
    _donutHovered = null;
  },
};

function _tooltipCb(pcts) {
  return function(context) {
    const v = Utils.fmtEUR(context.raw * 100);
    const p = pcts[context.dataIndex];
    return ` ${v}  (${p}%)`;
  };
}

/* ---- Gráfico de líneas (patrimonio acumulado) ---- */

let _lineChart = null;

window.LineChart = {
  render(canvasId, labels, values) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const lastVal   = values.length > 0 ? values[values.length - 1] : 0;
    const isPos     = lastVal >= 0;
    const lineColor = isPos ? '#27ae60' : '#c0392b';
    const fillColor = isPos ? 'rgba(39,174,96,0.14)' : 'rgba(192,57,43,0.12)';

    if (_lineChart) {
      _lineChart.data.labels = labels;
      _lineChart.data.datasets[0].data           = values;
      _lineChart.data.datasets[0].borderColor     = lineColor;
      _lineChart.data.datasets[0].backgroundColor = fillColor;
      _lineChart.data.datasets[0].pointBackgroundColor = lineColor;
      _lineChart.update();
      return;
    }

    const isDark    = _isDark();
    const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
    const tickColor = '#8c8579';
    const fmt       = v => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v);

    _lineChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: lineColor,
          backgroundColor: fillColor,
          pointBackgroundColor: lineColor,
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1815',
            titleFont: { family: "'Inter', sans-serif", size: 12, weight: 600 },
            bodyFont:  { family: "'DM Mono', monospace", size: 12 },
            padding: 10,
            cornerRadius: 8,
            callbacks: { label: ctx => ' ' + fmt(ctx.raw) },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: tickColor, font: { family: "'Inter', sans-serif", size: 11 } },
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: tickColor, font: { family: "'DM Mono', monospace", size: 11 }, callback: fmt },
          },
        },
        animation: { duration: 600, easing: 'easeOutQuart' },
      },
    });
  },

  destroy() {
    if (_lineChart) { _lineChart.destroy(); _lineChart = null; }
  },
};
