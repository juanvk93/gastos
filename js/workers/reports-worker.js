/**
 * reports-worker.js — Worker para cálculos de informes anuales
 *
 * Recibe { year, expenses, recurring, categories } y devuelve los datos
 * agregados (trend, top expenses, distribución por categoría, heatmap).
 *
 * Se ejecuta en un hilo separado para no bloquear el render cuando
 * hay muchos gastos. Si el navegador no soporta Workers, app.js
 * llamará a las mismas funciones de forma síncrona vía `computeReports`.
 */

function isInMonth(isoDate, year, month) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const y = parseInt(isoDate.slice(0, 4), 10);
  const m = parseInt(isoDate.slice(5, 7), 10);
  return y === year && m === month;
}

function ymKey(y, m) { return `${y}-${String(m).padStart(2, '0')}`; }

function isRecurringActiveIn(r, year, month) {
  if (!r.active) return false;
  const ym = ymKey(year, month);
  if (r.startMonth && ym < r.startMonth) return false;
  if (r.endMonth   && ym > r.endMonth)   return false;
  return true;
}

function recurringMonthsInYear(r, year) {
  if (!r.active) return 0;
  let count = 0;
  for (let m = 1; m <= 12; m++) {
    if (isRecurringActiveIn(r, year, m)) count++;
  }
  return count;
}

function computeMonthTotal(expenses, recurring, year, month) {
  const exp = expenses.filter((e) => isInMonth(e.date, year, month));
  const expTotal = exp.reduce((s, e) => s + e.amountCents, 0);
  const annualMo = recurring
    .filter((r) => isRecurringActiveIn(r, year, month) && r.annual)
    .reduce((s, r) => s + Math.round(r.amountCents / 12), 0);
  const recurringT = recurring
    .filter((r) => isRecurringActiveIn(r, year, month) && !r.annual)
    .reduce((s, r) => s + r.amountCents, 0);
  return { total: expTotal + annualMo + recurringT, expCount: exp.length };
}

function computeReports(payload) {
  const { year, refMonth, expenses, recurring, categories } = payload;

  // Trend últimos 12 meses
  const trend = [];
  let y = year, m = refMonth;
  for (let i = 0; i < 12; i++) {
    trend.unshift({ year: y, month: m, ...computeMonthTotal(expenses, recurring, y, m) });
    if (m === 1) { m = 12; y--; } else m--;
  }

  // Año seleccionado
  const yearTrend = trend.filter((t) => t.year === year);
  const yearTotal = yearTrend.reduce((s, t) => s + t.total, 0);
  const yearAvg = yearTrend.length ? Math.round(yearTotal / yearTrend.length) : 0;
  const yearBest = yearTrend.length
    ? yearTrend.reduce((min, t) => (t.total < min.total ? t : min))
    : null;
  const yearWorst = yearTrend.length
    ? yearTrend.reduce((max, t) => (t.total > max.total ? t : max))
    : null;

  // Top gastos del año
  const yearExpenses = expenses
    .filter((e) => /^\d{4}-/.test(e.date || '') && e.date.startsWith(String(year)))
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 8);

  // Distribución anual por categoría
  const catYear = {};
  categories.forEach((c) => { catYear[c.id] = { ...c, totalCents: 0 }; });
  let uncatYearTotal = 0;
  expenses.forEach((e) => {
    if (!e.date || !e.date.startsWith(String(year))) return;
    if (catYear[e.categoryId]) catYear[e.categoryId].totalCents += e.amountCents;
    else uncatYearTotal += e.amountCents;
  });
  recurring.forEach((r) => {
    const months = recurringMonthsInYear(r, year);
    if (months === 0) return;
    const monthly = r.annual ? Math.round(r.amountCents / 12) : r.amountCents;
    const yearly = monthly * months;
    if (catYear[r.categoryId]) catYear[r.categoryId].totalCents += yearly;
    else uncatYearTotal += yearly;
  });
  const catYearList = Object.values(catYear)
    .filter((c) => c.totalCents > 0)
    .sort((a, b) => b.totalCents - a.totalCents);
  if (uncatYearTotal > 0) {
    catYearList.push({
      id: '__uncat__', name: 'Sin categoría',
      color: '#7f8c8d', icon: 'package', totalCents: uncatYearTotal,
    });
  }
  const catYearTotal = catYearList.reduce((s, c) => s + c.totalCents, 0) || 1;

  // Heatmap diario: matriz 12x31 con totales por día del año seleccionado
  const heatmap = [];
  for (let mo = 0; mo < 12; mo++) heatmap.push(new Array(31).fill(0));
  let heatmapMax = 0;
  expenses.forEach((e) => {
    if (!e.date || !e.date.startsWith(String(year))) return;
    const mIdx = parseInt(e.date.slice(5, 7), 10) - 1;
    const dIdx = parseInt(e.date.slice(8, 10), 10) - 1;
    if (mIdx >= 0 && mIdx < 12 && dIdx >= 0 && dIdx < 31) {
      heatmap[mIdx][dIdx] += e.amountCents;
      if (heatmap[mIdx][dIdx] > heatmapMax) heatmapMax = heatmap[mIdx][dIdx];
    }
  });

  // Coste fijo vs variable (año seleccionado)
  // Cada recurrente aporta (importe mensualizado × meses activos del año).
  const fixedYearly = recurring.reduce((s, r) => {
    const months = recurringMonthsInYear(r, year);
    if (months === 0) return s;
    const monthly = r.annual ? Math.round(r.amountCents / 12) : r.amountCents;
    return s + monthly * months;
  }, 0);
  const variableYearly = expenses
    .filter((e) => e.date && e.date.startsWith(String(year)))
    .reduce((s, e) => s + e.amountCents, 0);

  // Gasto por día de la semana (solo puntuales del año). 0=Lun, 6=Dom.
  const byDow = [0, 0, 0, 0, 0, 0, 0];
  expenses.forEach((e) => {
    if (!e.date || !e.date.startsWith(String(year))) return;
    // mediodía para evitar saltos por zona horaria
    const d = new Date(e.date + 'T12:00:00');
    if (isNaN(d.getTime())) return;
    const dow = (d.getDay() + 6) % 7; // JS: 0=Dom..6=Sáb → 0=Lun..6=Dom
    byDow[dow] += e.amountCents;
  });

  // Inflación YoY por categoría (año actual vs año anterior, solo puntuales)
  const prevYear = year - 1;
  const yoyMap = {};
  categories.forEach((c) => { yoyMap[c.id] = { ...c, current: 0, previous: 0 }; });
  expenses.forEach((e) => {
    if (!e.date) return;
    const yy = e.date.slice(0, 4);
    if (yy !== String(year) && yy !== String(prevYear)) return;
    const bucket = yoyMap[e.categoryId];
    if (!bucket) return;
    if (yy === String(year)) bucket.current += e.amountCents;
    else bucket.previous += e.amountCents;
  });
  const yoyList = Object.values(yoyMap)
    .filter((c) => c.current > 0 || c.previous > 0)
    .map((c) => ({
      ...c,
      delta: c.current - c.previous,
      pct: c.previous > 0 ? ((c.current - c.previous) / c.previous) * 100 : null,
    }))
    .sort((a, b) => {
      // Comparables (con pct) primero, ordenados por magnitud absoluta del cambio
      if (a.pct === null && b.pct === null) return b.current - a.current;
      if (a.pct === null) return 1;
      if (b.pct === null) return -1;
      return Math.abs(b.pct) - Math.abs(a.pct);
    });

  return {
    trend,
    yearTotal,
    yearAvg,
    yearBest,
    yearWorst,
    yearExpenses,
    catYearList,
    catYearTotal,
    heatmap,
    heatmapMax,
    fixedYearly,
    variableYearly,
    byDow,
    yoyList,
    prevYear,
  };
}

// Si se ejecuta como Worker, escuchar mensajes
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.addEventListener('message', (e) => {
    try {
      const result = computeReports(e.data);
      self.postMessage({ ok: true, result });
    } catch (err) {
      self.postMessage({ ok: false, error: String(err) });
    }
  });
}

// Si se carga como script normal (fallback sin worker), exponer al window
if (typeof window !== 'undefined') {
  window.ReportsCompute = { computeReports };
}
