/**
 * chart.js — Gráfica donut de gastos por categoría
 *
 * Depende de Chart.js cargado desde CDN y del plugin chartjs-plugin-datalabels.
 */

let _donutChart = null;

window.DonutChart = {
  /**
   * Renderiza o actualiza la gráfica donut.
   * @param {string} canvasId - id del <canvas>
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

    const isDarkUpd = document.documentElement.getAttribute('data-theme') === 'dark';
    const segmentBorderUpd = isDarkUpd ? '#221f1b' : '#faf9f7';

    if (_donutChart) {
      _donutChart.data.labels = labels;
      _donutChart.data.datasets[0].data = values;
      _donutChart.data.datasets[0].backgroundColor = colors;
      _donutChart.data.datasets[0].borderColor = segmentBorderUpd;
      _donutChart.data.datasets[0].hoverBorderColor = segmentBorderUpd;
      _donutChart.options.plugins.tooltip.callbacks.label = tooltipCb(pcts);
      _donutChart.update();
      return;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const segmentBorder = isDark ? '#221f1b' : '#faf9f7';

    _donutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: segmentBorder,
          hoverBorderColor: segmentBorder,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '64%',
        layout: { padding: 4 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1815',
            titleFont: { family: "'DM Sans', sans-serif", size: 13, weight: 600 },
            bodyFont:  { family: "'DM Mono', monospace",   size: 13 },
            padding: 10,
            cornerRadius: 8,
            displayColors: true,
            boxWidth: 10,
            boxHeight: 10,
            boxPadding: 4,
            callbacks: {
              label: tooltipCb(pcts),
            },
          },
        },
        animation: {
          animateRotate: true,
          duration: 700,
          easing: 'easeOutQuart',
        },
      },
    });
  },

  destroy() {
    if (_donutChart) { _donutChart.destroy(); _donutChart = null; }
  },
};

function tooltipCb(pcts) {
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

    const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
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
            titleFont: { family: "'DM Sans', sans-serif", size: 12, weight: 600 },
            bodyFont:  { family: "'DM Mono', monospace", size: 12 },
            padding: 10,
            cornerRadius: 8,
            callbacks: { label: ctx => ' ' + fmt(ctx.raw) },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: tickColor, font: { family: "'DM Sans', sans-serif", size: 11 } },
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
