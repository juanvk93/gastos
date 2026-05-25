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

/** Mes contable al que pertenece una fecha. Espejo de app.js. */
function accountingMonth(isoDate, payrollDay) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const y = parseInt(isoDate.slice(0, 4), 10);
  const m = parseInt(isoDate.slice(5, 7), 10);
  const d = parseInt(isoDate.slice(8, 10), 10);
  if (!payrollDay || payrollDay <= 1) return `${y}-${String(m).padStart(2,'0')}`;
  if (d >= payrollDay) {
    if (m === 12) return `${y + 1}-01`;
    return `${y}-${String(m + 1).padStart(2,'0')}`;
  }
  return `${y}-${String(m).padStart(2,'0')}`;
}

function isInAccountingMonth(isoDate, year, month, payrollDay) {
  if (!isoDate) return false;
  return accountingMonth(isoDate, payrollDay) === ymKey(year, month);
}

function isInAccountingYear(isoDate, year, payrollDay) {
  if (!isoDate) return false;
  const ym = accountingMonth(isoDate, payrollDay);
  return ym != null && ym.startsWith(String(year));
}

function isRecurringActiveIn(r, year, month) {
  if (!r.active) return false;
  const ym = ymKey(year, month);
  if (r.startMonth && ym < r.startMonth) return false;
  if (r.endMonth   && ym > r.endMonth)   return false;
  return true;
}

function computeMonthTotal(expenses, year, month, payrollDay) {
  const exp = expenses.filter((e) => isInAccountingMonth(e.date, year, month, payrollDay));
  const expTotal = exp.reduce((s, e) => s + e.amountCents, 0);
  // Solo gasto REAL. Las proyecciones no se suman aquí.
  return { total: expTotal, expCount: exp.length };
}

function computeReports(payload) {
  const { year, refMonth, expenses, recurring, categories } = payload;
  const payrollDay = payload.payrollDay || 1;
  const inYear = (e) => isInAccountingYear(e.date, year, payrollDay);

  // Trend últimos 12 meses (todo real)
  const trend = [];
  let y = year, m = refMonth;
  for (let i = 0; i < 12; i++) {
    trend.unshift({ year: y, month: m, ...computeMonthTotal(expenses, y, m, payrollDay) });
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

  // Top gastos del año (contable)
  const yearExpenses = expenses
    .filter(inYear)
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 8);

  // Distribución anual por categoría (año contable)
  const catYear = {};
  categories.forEach((c) => { catYear[c.id] = { ...c, totalCents: 0 }; });
  let uncatYearTotal = 0;
  expenses.forEach((e) => {
    if (!inYear(e)) return;
    if (catYear[e.categoryId]) catYear[e.categoryId].totalCents += e.amountCents;
    else uncatYearTotal += e.amountCents;
  });
  // Solo gasto real: nada de añadir proyección por encima.
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

  // Coste fijo vs variable — solo gasto REAL.
  // Fijo = gastos materializados desde un recurrente (sourceRecurringId presente).
  // Variable = gastos ad-hoc.
  const fixedYearly = expenses
    .filter((e) => inYear(e) && e.sourceRecurringId)
    .reduce((s, e) => s + e.amountCents, 0);
  const variableYearly = expenses
    .filter((e) => inYear(e) && !e.sourceRecurringId)
    .reduce((s, e) => s + e.amountCents, 0);

  // Gasto por día de la semana (año contable). 0=Lun, 6=Dom.
  const byDow = [0, 0, 0, 0, 0, 0, 0];
  expenses.forEach((e) => {
    if (!inYear(e)) return;
    const d = new Date(e.date + 'T12:00:00');
    if (isNaN(d.getTime())) return;
    const dow = (d.getDay() + 6) % 7;
    byDow[dow] += e.amountCents;
  });

  // Inflación YoY por categoría (comparando años contables)
  const prevYear = year - 1;
  const yoyMap = {};
  categories.forEach((c) => { yoyMap[c.id] = { ...c, current: 0, previous: 0 }; });
  expenses.forEach((e) => {
    if (!e.date) return;
    const inCur  = isInAccountingYear(e.date, year, payrollDay);
    const inPrev = isInAccountingYear(e.date, prevYear, payrollDay);
    if (!inCur && !inPrev) return;
    const bucket = yoyMap[e.categoryId];
    if (!bucket) return;
    if (inCur) bucket.current += e.amountCents;
    else       bucket.previous += e.amountCents;
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
