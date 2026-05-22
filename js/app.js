/**
 * app.js — Lógica principal de la aplicación Gastos
 *
 * Estado global: year, month (seleccionados), y los datos que se recargan desde IndexedDB.
 * Sin frameworks; manipulación directa del DOM con Utils.el().
 */

const { el, clear, fmtEUR, eurToCents, today, monthName, fmtDate, isInMonth } = Utils;

let state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  categories: [],
  expenses: [],
  recurring: [],
  income: [],
  annualGoal: 0,
  people: [],
  tagFilter: null,
  view: 'dashboard',
};

/* ================================================================
   Inicialización
   ================================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  await DB.open();
  await DB.seedCategories();
  await reload();
  bindGlobalEvents();
});

async function reload() {
  [state.categories, state.expenses, state.recurring, state.income] = await Promise.all([
    DB.getCategories(), DB.getExpenses(), DB.getRecurring(), DB.getAllIncome(),
  ]);
  const [goalEntry, peopleEntry] = await Promise.all([
    DB.getSetting('annual-goal'),
    DB.getSetting('people'),
  ]);
  state.annualGoal = goalEntry?.value  || 0;
  state.people     = peopleEntry?.value || [];
  render();
}

/* ================================================================
   Eventos globales (navegación, tabs)
   ================================================================ */

function bindGlobalEvents() {
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (state.month === 1) { state.year--; state.month = 12; }
    else state.month--;
    render();
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    if (state.month === 12) { state.year++; state.month = 1; }
    else state.month++;
    render();
  });

  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchToTab(btn.dataset.tab));
  });

  // Toggle tema
  const savedTheme = localStorage.getItem('theme') || 'dark';
  updateThemeIcon(savedTheme);
  document.getElementById('btn-theme').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
  });

  // Sidebar
  document.getElementById('btn-menu').addEventListener('click', openSidebar);
  document.getElementById('btn-sidebar-close').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

  // Modal
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', closeModal);

  // Tecla Escape: cierra modal primero, sidebar después
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('modal').classList.contains('open')) {
      closeModal();
    } else if (document.getElementById('sidebar').classList.contains('open')) {
      closeSidebar();
    }
  });

  // Selector de mes
  document.getElementById('btn-month-picker').addEventListener('click', openMonthPicker);

  // FAB quick-add
  document.getElementById('btn-quick-add').addEventListener('click', () => openQuickAdd());

  // Inyectar iconos SVG en los botones de cerrar, menú y FAB
  document.getElementById('btn-sidebar-close').innerHTML = Icons.svg('close', 18);
  document.getElementById('btn-modal-close').innerHTML   = Icons.svg('close', 18);
  document.getElementById('btn-menu').innerHTML          = Icons.svg('menu', 18);
  document.getElementById('btn-quick-add').innerHTML     = Icons.svg('plus', 22);
}

function updateThemeIcon(theme) {
  const btn = document.getElementById('btn-theme');
  if (btn) btn.innerHTML = Icons.svg(theme === 'dark' ? 'sun' : 'moon', 16);
}

/* ================================================================
   Helpers de iconos
   ================================================================ */

/** Añade un icono SVG (si existe) seguido de texto a un elemento padre. */
function appendIconText(parent, iconStr, text, iconSize = 14) {
  if (Icons.has(iconStr)) {
    const ico = el('span', { class: 'ico-wrap' });
    ico.innerHTML = Icons.svg(iconStr, iconSize);
    parent.appendChild(ico);
    parent.appendChild(document.createTextNode(' '));
  } else if (iconStr) {
    parent.appendChild(document.createTextNode(iconStr + ' '));
  }
  if (text) parent.appendChild(document.createTextNode(text));
  return parent;
}

/** Construye el selector visual de iconos para el formulario de categoría. */
function buildIconPicker(initial) {
  const picker = el('div', { class: 'icon-picker' });
  picker.dataset.value = initial || '';

  Icons.catalog.forEach(icon => {
    const btn = el('button', {
      type: 'button',
      class: 'icon-pick-item',
      title: icon.name,
    });
    btn.innerHTML = Icons.svg(icon.id, 18);
    btn.dataset.id = icon.id;
    if (initial === icon.id) btn.classList.add('selected');

    btn.addEventListener('click', () => {
      picker.querySelectorAll('.icon-pick-item').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      picker.dataset.value = icon.id;
    });

    picker.appendChild(btn);
  });

  return picker;
}

/* ================================================================
   Helpers de etiquetas e importación/exportación
   ================================================================ */

function parseTags(str) {
  return str.trim()
    .split(/[\s,]+/)
    .map(t => t.replace(/^#/, '').toLowerCase().trim())
    .filter(Boolean);
}

/* ---- Helpers de rango de fechas para recurrentes ---- */

/** 'YYYY-MM' a partir de (year, month). */
function ymKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** 'YYYY-MM' del mes real en curso. */
function currentYmKey() {
  const d = new Date();
  return ymKey(d.getFullYear(), d.getMonth() + 1);
}

/** Convierte 'YYYY-MM' a una etiqueta legible "Ene 2025". */
function fmtYearMonth(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return '';
  const y = parseInt(ym.slice(0, 4), 10);
  const m = parseInt(ym.slice(5, 7), 10);
  return `${Utils.monthShort(m)} ${y}`;
}

/** ¿El recurrente está activo (toggle + dentro de rango) en (year, month)? */
function isRecurringActiveIn(r, year, month) {
  if (!r.active) return false;
  const ym = ymKey(year, month);
  if (r.startMonth && ym < r.startMonth) return false;
  if (r.endMonth   && ym > r.endMonth)   return false;
  return true;
}

/** ¿Recurrente expirado respecto al mes real en curso? (endMonth definido y ya pasado). */
function isRecurringExpired(r) {
  return !!(r.endMonth && r.endMonth < currentYmKey());
}

/** Nº de meses (0..12) que un recurrente está activo dentro de un año dado. */
function recurringMonthsInYear(r, year) {
  if (!r.active) return 0;
  let count = 0;
  for (let m = 1; m <= 12; m++) {
    if (isRecurringActiveIn(r, year, m)) count++;
  }
  return count;
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseImportDate(str) {
  if (!str) return null;
  str = str.trim();
  let m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m = str.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function exportJSON() {
  const data = {
    categories: state.categories,
    expenses:   state.expenses,
    recurring:  state.recurring,
    income:     state.income,
    annualGoal: state.annualGoal,
    people:     state.people,
    exportedAt: new Date().toISOString(),
    version: 1,
  };
  downloadFile(JSON.stringify(data, null, 2), 'gastos-backup.json', 'application/json');
}

function exportCSV() {
  const header = ['Fecha', 'Importe (€)', 'Categoría', 'Descripción', 'Etiquetas', 'Pagado por'];
  const rows = [...state.expenses]
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(e => {
      const cat = state.categories.find(c => c.id === e.categoryId);
      return [
        e.date || '',
        (e.amountCents / 100).toFixed(2).replace('.', ','),
        cat?.name || '',
        e.description || '',
        (e.tags || []).map(t => '#' + t).join(' '),
        e.paidBy || '',
      ];
    });
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
    .join('\n');
  downloadFile('﻿' + csv, 'gastos-expenses.csv', 'text/csv;charset=utf-8');
}

/** Aplica un backup JSON a la base de datos.
 *  mode = 'replace'  → vacía todos los stores y restaura tal cual (manteniendo ids).
 *  mode = 'merge'    → conserva lo existente; añade gastos/recurrentes con nuevos ids,
 *                      remapea categoryId por nombre y sobreescribe ingresos por mes. */
async function applyJSONImport(backup, mode) {
  if (mode === 'replace') {
    await DB.clearAll();
    for (const c of backup.categories || []) await DB.putCategory(c);
    for (const e of backup.expenses   || []) await DB.putExpense(e);
    for (const r of backup.recurring  || []) await DB.putRecurring(r);
    for (const inc of backup.income   || []) await DB.putIncome(inc);
    await DB.setSetting('annual-goal', backup.annualGoal || 0);
    await DB.setSetting('people',      backup.people     || []);
    // Las categorías por defecto se siembran si no quedó ninguna en el backup.
    await DB.seedCategories();
    return;
  }

  // Modo merge: remapear categoryId por nombre.
  const current = await DB.getCategories();
  const nameToId = new Map(current.map(c => [(c.name || '').toLowerCase(), c.id]));
  const idMap   = new Map();

  for (const c of backup.categories || []) {
    const key = (c.name || '').toLowerCase();
    if (nameToId.has(key)) {
      idMap.set(c.id, nameToId.get(key));
    } else {
      const newId = await DB.addCategory({
        name: c.name,
        color: c.color,
        icon: c.icon,
        ...(c.monthlyLimitCents != null ? { monthlyLimitCents: c.monthlyLimitCents } : {}),
      });
      idMap.set(c.id, newId);
      nameToId.set(key, newId);
    }
  }

  for (const e of backup.expenses || []) {
    const { id, ...rest } = e;
    if (rest.categoryId != null && idMap.has(rest.categoryId)) {
      rest.categoryId = idMap.get(rest.categoryId);
    }
    await DB.addExpense(rest);
  }

  for (const r of backup.recurring || []) {
    const { id, ...rest } = r;
    if (rest.categoryId != null && idMap.has(rest.categoryId)) {
      rest.categoryId = idMap.get(rest.categoryId);
    }
    await DB.addRecurring(rest);
  }

  for (const inc of backup.income || []) {
    if (inc && inc.id && typeof inc.amountCents === 'number') {
      await DB.putIncome({ id: inc.id, amountCents: inc.amountCents });
    }
  }
  // annualGoal y people no se tocan en modo merge.
}

function buildJSONImportPreview(jsonText, container) {
  clear(container);

  let backup;
  try {
    backup = JSON.parse(jsonText);
  } catch (err) {
    container.appendChild(el('div', { class: 'empty-state', text: 'El archivo no es un JSON válido' }));
    return;
  }

  const isObj = backup && typeof backup === 'object' && !Array.isArray(backup);
  const hasAny = isObj && (
    Array.isArray(backup.categories) || Array.isArray(backup.expenses) ||
    Array.isArray(backup.recurring)  || Array.isArray(backup.income)
  );
  if (!hasAny) {
    container.appendChild(el('div', { class: 'empty-state', text: 'El JSON no tiene el formato esperado (categories, expenses, recurring, income)' }));
    return;
  }

  const counts = {
    categorías: (backup.categories || []).length,
    gastos:     (backup.expenses   || []).length,
    recurrentes:(backup.recurring  || []).length,
    'meses de ingresos': (backup.income || []).length,
  };

  const info = el('div', { class: 'import-json-info' });
  info.appendChild(el('div', { class: 'report-section-title', style: { marginBottom: '8px' }, text: 'Contenido del backup' }));

  const list = el('ul', { class: 'import-json-list' });
  for (const [label, n] of Object.entries(counts)) {
    const li = el('li');
    li.appendChild(el('strong', { text: String(n) }));
    li.appendChild(document.createTextNode(' ' + label));
    list.appendChild(li);
  }
  info.appendChild(list);

  const meta = [];
  if (backup.version)    meta.push(`versión ${backup.version}`);
  if (backup.exportedAt) {
    const d = new Date(backup.exportedAt);
    if (!isNaN(d)) meta.push(`exportado ${fmtDate(d.toISOString().slice(0, 10))}`);
  }
  if (typeof backup.annualGoal === 'number' && backup.annualGoal > 0) {
    meta.push(`objetivo anual ${fmtEUR(backup.annualGoal)}`);
  }
  if (meta.length) {
    info.appendChild(el('p', { class: 'expense-meta', text: meta.join(' · ') }));
  }
  container.appendChild(info);

  const actions = el('div', { class: 'import-json-actions' });
  const mergeBtn = el('button', {
    type: 'button', class: 'btn btn-primary',
    text: 'Fusionar con datos actuales',
  });
  const replaceBtn = el('button', {
    type: 'button', class: 'btn btn-danger',
    text: 'Reemplazar todo',
  });
  actions.appendChild(mergeBtn);
  actions.appendChild(replaceBtn);
  container.appendChild(actions);

  const status = el('div', { class: 'import-json-status' });
  container.appendChild(status);

  async function run(mode) {
    mergeBtn.disabled = true;
    replaceBtn.disabled = true;
    status.textContent = mode === 'replace' ? 'Reemplazando datos…' : 'Fusionando datos…';
    try {
      await applyJSONImport(backup, mode);
      // reload() reconstruye la vista actual, así que el mensaje en `status` se pierde.
      // Avisamos con alert tras refrescar.
      await reload();
      alert(mode === 'replace'
        ? 'Backup restaurado correctamente.'
        : 'Backup fusionado correctamente.');
    } catch (err) {
      console.error(err);
      status.textContent = '✗ Error al importar: ' + (err?.message || err);
      mergeBtn.disabled = false;
      replaceBtn.disabled = false;
    }
  }

  mergeBtn.addEventListener('click', () => run('merge'));
  replaceBtn.addEventListener('click', () => {
    const ok = confirm(
      'Esto borrará TODOS los datos actuales (categorías, gastos, recurrentes, ingresos y ajustes) ' +
      'y los reemplazará por el contenido del backup.\n\n¿Continuar?'
    );
    if (ok) run('replace');
  });
}

/* ================================================================
   Render principal
   ================================================================ */

function render() {
  // Header mes/año
  document.getElementById('month-label').textContent = monthName(state.month);
  document.getElementById('year-label').textContent  = state.year;

  DonutChart.destroy();
  LineChart.destroy();
  const main = document.getElementById('main-content');
  clear(main);

  switch (state.view) {
    case 'dashboard':  renderDashboard(main); break;
    case 'calendar':   renderCalendar(main); break;
    case 'recurring':  renderRecurring(main); break;
    case 'reports':    renderReports(main); break;
    case 'savings':    renderSavings(main); break;
    case 'categories': renderCategories(main); break;
  }

  // FAB visible solo si la app está lista (no en vista categories donde estorba)
  const fab = document.getElementById('btn-quick-add');
  if (fab) fab.classList.toggle('hidden', state.view === 'categories');
}

/* ---- Idle scheduling helper ---- */
const onIdle = (fn) => {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: 1500 });
  } else {
    setTimeout(fn, 1);
  }
};

/* ================================================================
   Helpers de datos compartidos
   ================================================================ */

function computeMonthTotal(year, month) {
  const exp = state.expenses.filter(e => isInMonth(e.date, year, month));
  const expTotal   = exp.reduce((s, e) => s + e.amountCents, 0);
  const annualMo   = state.recurring.filter(r => isRecurringActiveIn(r, year, month) && r.annual)
    .reduce((s, r) => s + Math.round(r.amountCents / 12), 0);
  const recurringT = state.recurring.filter(r => isRecurringActiveIn(r, year, month) && !r.annual)
    .reduce((s, r) => s + r.amountCents, 0);
  return { total: expTotal + annualMo + recurringT, expCount: exp.length };
}

function getMonthIncome(year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const entry = state.income.find(i => i.id === key);
  return entry ? entry.amountCents : 0;
}

function computeCatBreakdown(year, month) {
  const exp = state.expenses.filter(e => isInMonth(e.date, year, month));
  const byCat = {};
  state.categories.forEach(c => { byCat[c.id] = { ...c, totalCents: 0 }; });
  let uncatTotal = 0;
  exp.forEach(e => {
    if (byCat[e.categoryId]) byCat[e.categoryId].totalCents += e.amountCents;
    else uncatTotal += e.amountCents;
  });
  state.recurring.filter(r => isRecurringActiveIn(r, year, month) && !r.annual).forEach(r => {
    if (byCat[r.categoryId]) byCat[r.categoryId].totalCents += r.amountCents;
    else uncatTotal += r.amountCents;
  });
  state.recurring.filter(r => isRecurringActiveIn(r, year, month) && r.annual).forEach(r => {
    if (byCat[r.categoryId]) byCat[r.categoryId].totalCents += Math.round(r.amountCents / 12);
    else uncatTotal += Math.round(r.amountCents / 12);
  });
  if (uncatTotal > 0) {
    byCat['__uncat__'] = { id: '__uncat__', name: 'Sin categoría', color: '#7f8c8d', icon: 'package', totalCents: uncatTotal };
  }
  return byCat;
}

/* ================================================================
   Gastos (vista principal — internamente 'dashboard')
   ================================================================ */

function renderDashboard(container) {
  // Gastos del mes seleccionado
  const monthExpenses = state.expenses.filter(
    e => isInMonth(e.date, state.year, state.month)
  );

  // Gastos anualizados prorrateados (/12) — solo los activos en este mes
  const activeAnnual = state.recurring.filter(r => isRecurringActiveIn(r, state.year, state.month) && r.annual);
  const annualMonthly = activeAnnual.reduce((s, r) => s + Math.round(r.amountCents / 12), 0);

  // Gastos recurrentes mensuales — solo los activos en este mes
  const activeMonthly = state.recurring.filter(r => isRecurringActiveIn(r, state.year, state.month) && !r.annual);
  const recurringTotal = activeMonthly.reduce((s, r) => s + r.amountCents, 0);

  // Totales
  const expensesTotal = monthExpenses.reduce((s, e) => s + e.amountCents, 0);
  const grandTotal = expensesTotal + annualMonthly + recurringTotal;

  // Agrupa por categoría (para el donut). Los gastos huérfanos (categoría borrada)
  // se acumulan en un bucket sintético "Sin categoría" para que el donut sume el total real.
  const byCat = {};
  state.categories.forEach(c => { byCat[c.id] = { ...c, totalCents: 0 }; });
  let uncatTotal = 0;

  monthExpenses.forEach(e => {
    if (byCat[e.categoryId]) byCat[e.categoryId].totalCents += e.amountCents;
    else uncatTotal += e.amountCents;
  });
  activeMonthly.forEach(r => {
    if (byCat[r.categoryId]) byCat[r.categoryId].totalCents += r.amountCents;
    else uncatTotal += r.amountCents;
  });
  activeAnnual.forEach(r => {
    if (byCat[r.categoryId]) byCat[r.categoryId].totalCents += Math.round(r.amountCents / 12);
    else uncatTotal += Math.round(r.amountCents / 12);
  });

  const chartData = Object.values(byCat).filter(c => c.totalCents > 0)
    .sort((a, b) => b.totalCents - a.totalCents);

  if (uncatTotal > 0) {
    chartData.push({ id: '__uncat__', name: 'Sin categoría', color: '#7f8c8d', icon: 'package', totalCents: uncatTotal });
  }

  // Comprobar límites mensuales superados
  const overLimit = Object.values(byCat)
    .filter(c => c.monthlyLimitCents > 0 && c.totalCents > c.monthlyLimitCents)
    .map(c => ({ ...c, excess: c.totalCents - c.monthlyLimitCents }))
    .sort((a, b) => b.excess - a.excess);

  // ---- Layout ----

  // Banner de aviso por límites superados
  if (overLimit.length > 0) {
    const banner = el('div', { class: 'limit-banner' });
    const header = el('div', { class: 'limit-banner-header' });
    const icoSpan = el('span', { class: 'limit-banner-icon' });
    icoSpan.innerHTML = Icons.svg('warning', 18);
    header.appendChild(icoSpan);
    header.appendChild(el('span', {
      text: `${overLimit.length} categoría${overLimit.length !== 1 ? 's' : ''} ha${overLimit.length !== 1 ? 'n' : ''} superado el límite mensual`,
    }));
    banner.appendChild(header);

    overLimit.forEach(c => {
      const r = el('div', { class: 'limit-banner-row' });
      r.appendChild(el('span', { class: 'dot', style: { backgroundColor: c.color } }));
      const lbl = el('span', { class: 'limit-banner-name' });
      appendIconText(lbl, c.icon, c.name, 13);
      r.appendChild(lbl);
      r.appendChild(el('span', {
        class: 'limit-banner-amount mono',
        text: `${fmtEUR(c.totalCents)} / ${fmtEUR(c.monthlyLimitCents)}`,
      }));
      r.appendChild(el('span', {
        class: 'limit-banner-excess mono',
        text: `+${fmtEUR(c.excess)}`,
      }));
      banner.appendChild(r);
    });
    container.appendChild(banner);
  }

  const grid = el('div', { class: 'dashboard-grid' });

  // Columna izquierda: donut + leyenda
  const leftCol = el('div', { class: 'card chart-card' });
  const chartHeader = el('div', { class: 'card-header' },
    el('h2', { class: 'card-title', text: 'Distribución por categoría' }),
    el('span', { class: 'badge', text: `${monthExpenses.length + activeMonthly.length + activeAnnual.length} conceptos` }),
  );
  leftCol.appendChild(chartHeader);

  // Canvas del donut
  const chartWrap = el('div', { class: 'chart-wrapper' });
  const canvas = el('canvas', { id: 'donut-canvas' });
  chartWrap.appendChild(canvas);

  // Total central (overlay encima del donut, lo hacemos con CSS)
  const centerOverlay = el('div', { class: 'chart-center' },
    el('span', { class: 'chart-center-label', text: 'Total mes' }),
    el('span', { class: 'chart-center-amount', text: fmtEUR(grandTotal) }),
  );
  chartWrap.appendChild(centerOverlay);
  leftCol.appendChild(chartWrap);

  // Leyenda
  if (chartData.length > 0) {
    const legend = el('div', { class: 'chart-legend' });
    chartData.forEach(c => {
      const pct = grandTotal > 0 ? ((c.totalCents / grandTotal) * 100).toFixed(1) : '0.0';
      const nameSpan = el('span', { class: 'legend-name' });
      appendIconText(nameSpan, c.icon, c.name, 12);
      legend.appendChild(
        el('div', { class: 'legend-item' },
          el('span', { class: 'legend-dot', style: { backgroundColor: c.color } }),
          nameSpan,
          el('span', { class: 'legend-value', text: fmtEUR(c.totalCents) }),
          el('span', { class: 'legend-pct', text: `${pct}%` }),
        )
      );
    });
    leftCol.appendChild(legend);
  }

  grid.appendChild(leftCol);

  // Columna derecha: formulario + resumen
  const rightCol = el('div', { class: 'right-col' });

  // Resumen rápido
  const summary = el('div', { class: 'card summary-card' });
  summary.appendChild(el('h2', { class: 'card-title', text: 'Resumen del mes' }));
  const summaryGrid = el('div', { class: 'summary-grid' });
  summaryGrid.appendChild(summaryItem('Gastos puntuales', expensesTotal, monthExpenses.length));
  summaryGrid.appendChild(summaryItem('Fijos mensuales', recurringTotal, activeMonthly.length));
  summaryGrid.appendChild(summaryItem('Anualizados (/12)', annualMonthly, activeAnnual.length));
  summary.appendChild(summaryGrid);
  const totalRow = el('div', { class: 'summary-total' },
    el('span', { text: 'Total' }),
    el('span', { class: 'mono', text: fmtEUR(grandTotal) }),
  );
  summary.appendChild(totalRow);
  rightCol.appendChild(summary);

  // Formulario
  rightCol.appendChild(buildExpenseForm());
  grid.appendChild(rightCol);
  container.appendChild(grid);

  // Lista de movimientos
  container.appendChild(buildExpenseList(monthExpenses, activeMonthly, activeAnnual));

  // Liquidación de gastos compartidos
  if (state.people.length >= 2) {
    const sc = buildSettlementCard(monthExpenses);
    if (sc) container.appendChild(sc);
  }

  // Proyección de fin de mes (al final; solo si miramos el mes actual)
  const projectionCard = buildProjectionCard({
    year: state.year,
    month: state.month,
    expensesTotal,
    recurringTotal,
    annualMonthly,
    monthExpenses,
  });
  if (projectionCard) container.appendChild(projectionCard);

  // Render chart
  requestAnimationFrame(() => {
    if (chartData.length > 0) {
      DonutChart.render('donut-canvas', chartData, grandTotal);
    } else {
      DonutChart.destroy();
      const wrap = document.querySelector('.chart-wrapper');
      if (wrap) {
        clear(wrap);
        wrap.appendChild(el('div', { class: 'empty-state', text: 'Sin gastos este mes' }));
      }
    }
  });
}

function summaryItem(label, cents, count) {
  return el('div', { class: 'summary-item' },
    el('div', { class: 'summary-item-label', text: label }),
    el('div', { class: 'summary-item-value mono', text: fmtEUR(cents) }),
    el('div', { class: 'summary-item-count', text: `${count} concepto${count !== 1 ? 's' : ''}` }),
  );
}

/** Card de proyección de fin de mes. Solo aparece si miramos el mes en curso
 *  (en meses pasados los totales ya son definitivos; en meses futuros no hay datos). */
function buildProjectionCard({ year, month, expensesTotal, recurringTotal, annualMonthly, monthExpenses }) {
  const now = new Date();
  const isCurrentMonth = (year === now.getFullYear() && month === now.getMonth() + 1);
  if (!isCurrentMonth) return null;

  const daysInMonth = new Date(year, month, 0).getDate();
  const elapsed = Math.max(1, Math.min(now.getDate(), daysInMonth));
  const fixedMonth = recurringTotal + annualMonthly;

  // Proyectamos solo los gastos puntuales (los fijos ya están imputados al mes)
  const projectedVariable = Math.round((expensesTotal / elapsed) * daysInMonth);
  const projectedTotal = projectedVariable + fixedMonth;
  const actualSoFar = expensesTotal + fixedMonth;
  const pctOfProjected = projectedTotal > 0 ? Math.min(100, (actualSoFar / projectedTotal) * 100) : 0;
  const pctOfMonth = (elapsed / daysInMonth) * 100;

  const card = el('div', { class: 'card projection-card' });

  const header = el('div', { class: 'projection-header' });
  header.appendChild(el('span', { class: 'report-section-title', text: 'Proyección fin de mes' }));
  header.appendChild(el('span', { class: 'projection-total mono', text: fmtEUR(projectedTotal) }));
  card.appendChild(header);

  // Barra de progreso doble: ya gastado (oscuro) sobre proyectado (claro)
  const barWrap = el('div', { class: 'projection-bar-wrap' });
  const barInner = el('div', { class: 'projection-bar-inner', style: { width: `${pctOfProjected.toFixed(1)}%` } });
  barWrap.appendChild(barInner);
  // Marca opcional del día actual sobre el ancho total
  const dayMark = el('div', { class: 'projection-bar-mark', style: { left: `${pctOfMonth.toFixed(1)}%` } });
  barWrap.appendChild(dayMark);
  card.appendChild(barWrap);

  const meta = el('div', { class: 'projection-meta' });
  meta.appendChild(el('span', { text: `Día ${elapsed} de ${daysInMonth}` }));
  meta.appendChild(el('span', { class: 'mono', text: `Gastado ${fmtEUR(actualSoFar)}` }));
  if (monthExpenses.length > 0) {
    meta.appendChild(el('span', { class: 'mono', text: `Por venir ~${fmtEUR(Math.max(0, projectedTotal - actualSoFar))}` }));
  } else {
    meta.appendChild(el('span', { class: 'projection-hint', text: 'Sin gastos puntuales aún' }));
  }
  card.appendChild(meta);

  // Helper explicativo: qué muestra y cómo se calcula
  const help = el('div', { class: 'projection-help' });
  help.appendChild(el('p', {
    html: '<strong>Qué indica:</strong> estimación del gasto total que tendrás al cierre del mes.',
  }));
  help.appendChild(el('p', {
    html: '<strong>Cómo se calcula:</strong> proyecta tus gastos puntuales al ritmo actual ' +
          '(Σ&nbsp;puntuales &times; días&nbsp;del&nbsp;mes &divide; día&nbsp;actual) ' +
          'y le suma los fijos mensuales y los anualizados&nbsp;/&nbsp;12.',
  }));
  card.appendChild(help);

  return card;
}

/* ================================================================
   Formulario de gasto
   ================================================================ */

function buildExpenseForm() {
  const card = el('div', { class: 'card form-card' });
  card.appendChild(el('h2', { class: 'card-title', text: 'Añadir gasto' }));

  const form = el('form', { class: 'expense-form' });

  // Importe
  const amountGroup = el('div', { class: 'form-group full-width' });
  amountGroup.appendChild(el('label', { class: 'form-label', text: 'Importe (€)' }));
  const amountInput = el('input', {
    type: 'text', inputmode: 'decimal', placeholder: '0,00',
    class: 'form-input amount-input', id: 'inp-amount',
  });
  amountGroup.appendChild(amountInput);
  form.appendChild(amountGroup);

  // Categoría
  const catGroup = el('div', { class: 'form-group' });
  catGroup.appendChild(el('label', { class: 'form-label', text: 'Categoría' }));
  const select = el('select', { class: 'form-input', id: 'inp-category' });
  select.appendChild(el('option', { value: '', text: '— Selecciona —' }));
  state.categories.forEach(c => {
    select.appendChild(el('option', { value: c.id, text: c.name }));
  });
  catGroup.appendChild(select);
  form.appendChild(catGroup);

  // Fecha
  const dateGroup = el('div', { class: 'form-group' });
  dateGroup.appendChild(el('label', { class: 'form-label', text: 'Fecha' }));
  const dateInput = el('input', {
    type: 'date', value: today(), class: 'form-input', id: 'inp-date',
  });
  dateGroup.appendChild(dateInput);
  form.appendChild(dateGroup);

  // Descripción
  const descGroup = el('div', { class: 'form-group full-width' });
  descGroup.appendChild(el('label', { class: 'form-label', text: 'Descripción (opcional)' }));
  const descInput = el('input', {
    type: 'text', placeholder: 'p.ej. Mercadona', class: 'form-input', id: 'inp-desc',
  });
  descGroup.appendChild(descInput);
  form.appendChild(descGroup);

  // Etiquetas
  const tagsGroup = el('div', { class: 'form-group full-width' });
  tagsGroup.appendChild(el('label', { class: 'form-label', text: 'Etiquetas (opcional)' }));
  const tagsInput = el('input', {
    type: 'text', placeholder: '#vacaciones #extraordinario…', class: 'form-input', id: 'inp-tags',
  });
  tagsGroup.appendChild(tagsInput);
  form.appendChild(tagsGroup);

  // Pagado por (solo si hay personas configuradas)
  let paidBySelect = null;
  if (state.people.length >= 2) {
    const paidByGroup = el('div', { class: 'form-group full-width' });
    paidByGroup.appendChild(el('label', { class: 'form-label', text: 'Pagado por' }));
    paidBySelect = el('select', { class: 'form-input' });
    paidBySelect.appendChild(el('option', { value: '', text: '— Gasto personal —' }));
    state.people.forEach(p => paidBySelect.appendChild(el('option', { value: p, text: p })));
    paidByGroup.appendChild(paidBySelect);
    form.appendChild(paidByGroup);
  }

  // Submit
  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary full-width', text: 'Guardar gasto' });
  form.appendChild(submitBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cents = eurToCents(amountInput.value);
    const catId = parseInt(select.value);
    if (!cents || !catId) return;
    await DB.addExpense({
      date: dateInput.value || today(),
      amountCents: cents,
      description: descInput.value.trim(),
      categoryId: catId,
      tags:   parseTags(tagsInput.value),
      paidBy: paidBySelect?.value || null,
    });
    amountInput.value = '';
    descInput.value   = '';
    tagsInput.value   = '';
    if (paidBySelect) paidBySelect.value = '';
    await reload();
  });

  card.appendChild(form);
  return card;
}

/* ================================================================
   Lista de movimientos
   ================================================================ */

function buildExpenseList(monthExpenses, activeMonthly, activeAnnual) {
  const section = el('div', { class: 'card list-card' });

  // Etiquetas únicas del mes para el filtro
  const allTags = [...new Set(monthExpenses.flatMap(e => e.tags || []))].sort();
  const hasFilter = !!state.tagFilter;

  const header = el('div', { class: 'card-header' });
  header.appendChild(el('h2', { class: 'card-title', text: 'Movimientos del mes' }));
  section.appendChild(header);

  if (allTags.length > 0) {
    const filterRow = el('div', { class: 'tag-filter-row' });
    filterRow.appendChild(el('span', { class: 'tag-filter-label', text: 'Filtrar:' }));
    allTags.forEach(tag => {
      filterRow.appendChild(el('button', {
        class: `tag-chip${state.tagFilter === tag ? ' active' : ''}`,
        text: '#' + tag,
        onClick: () => { state.tagFilter = state.tagFilter === tag ? null : tag; render(); },
      }));
    });
    if (hasFilter) {
      filterRow.appendChild(el('button', {
        class: 'btn btn-ghost btn-sm tag-clear-btn', text: '× Quitar filtro',
        onClick: () => { state.tagFilter = null; render(); },
      }));
    }
    section.appendChild(filterRow);
  }

  // Aplicar filtro
  const visibleExpenses = hasFilter
    ? monthExpenses.filter(e => (e.tags || []).includes(state.tagFilter))
    : monthExpenses;
  const visibleMonthly  = hasFilter ? [] : activeMonthly;
  const visibleAnnual   = hasFilter ? [] : activeAnnual;

  const allItems = [];

  // Gastos puntuales
  visibleExpenses.forEach(e => {
    const cat = state.categories.find(c => c.id === e.categoryId);
    allItems.push({
      id: e.id,
      type: 'expense',
      desc: e.description || cat?.name || 'Gasto',
      description: e.description,
      categoryId: e.categoryId,
      catName: cat?.name || 'Sin categoría',
      color: cat?.color || '#999',
      icon: cat?.icon || '',
      amount: e.amountCents,
      date: e.date,
      badge: null,
      tags:   e.tags   || [],
      paidBy: e.paidBy || null,
    });
  });

  // Recurrentes mensuales
  visibleMonthly.forEach(r => {
    const cat = state.categories.find(c => c.id === r.categoryId);
    allItems.push({
      id: r.id,
      type: 'recurring',
      desc: r.name,
      catName: cat?.name || 'Sin categoría',
      color: cat?.color || '#999',
      icon: cat?.icon || '',
      amount: r.amountCents,
      date: null,
      badge: 'Fijo',
      tags: [], paidBy: null,
    });
  });

  // Anualizados
  visibleAnnual.forEach(r => {
    const cat = state.categories.find(c => c.id === r.categoryId);
    allItems.push({
      id: r.id,
      type: 'annual',
      desc: r.name,
      catName: cat?.name || 'Sin categoría',
      color: cat?.color || '#999',
      icon: cat?.icon || '',
      amount: Math.round(r.amountCents / 12),
      date: null,
      badge: 'Anual',
      fullAmount: r.amountCents,
      tags: [], paidBy: null,
    });
  });

  if (allItems.length === 0) {
    const msg = hasFilter ? `No hay gastos con la etiqueta #${state.tagFilter}` : 'No hay movimientos este mes';
    section.appendChild(el('div', { class: 'empty-state', text: msg }));
    return section;
  }

  // Ordenar: puntuales por fecha desc, luego fijos, luego anuales
  allItems.sort((a, b) => {
    if (a.type === 'expense' && b.type === 'expense') return (b.date || '').localeCompare(a.date || '');
    const order = { expense: 0, recurring: 1, annual: 2 };
    return order[a.type] - order[b.type];
  });

  const list = el('div', { class: 'expense-list' });
  allItems.forEach(item => {
    const row = el('div', { class: 'expense-row' });

    row.appendChild(el('span', { class: 'dot', style: { backgroundColor: item.color } }));

    const info = el('div', { class: 'expense-info' });
    const topLine = el('div', { class: 'expense-top-line' });
    const descSpan = el('span', { class: 'expense-desc' });
    appendIconText(descSpan, item.icon, item.desc, 14);
    topLine.appendChild(descSpan);
    if (item.badge) {
      topLine.appendChild(el('span', { class: `badge badge-${item.type}`, text: item.badge }));
    }
    // Badges de etiquetas
    if (item.tags && item.tags.length > 0) {
      item.tags.forEach(tag => {
        topLine.appendChild(el('button', {
          class: `tag-chip tag-chip-sm${state.tagFilter === tag ? ' active' : ''}`,
          text: '#' + tag,
          onClick: () => { state.tagFilter = tag; render(); },
        }));
      });
    }
    info.appendChild(topLine);

    let meta = item.catName;
    if (item.date) meta += ` · ${fmtDate(item.date)}`;
    if (item.fullAmount) meta += ` · ${fmtEUR(item.fullAmount)}/año`;
    if (item.paidBy) meta += ` · Pagó ${item.paidBy}`;
    info.appendChild(el('div', { class: 'expense-meta', text: meta }));
    row.appendChild(info);

    row.appendChild(el('span', { class: 'expense-amount mono', text: fmtEUR(item.amount) }));

    // Botones editar y eliminar — todos los tipos los llevan para mantener la columna
    // de importes alineada y dar acceso rápido también a los recurrentes/anualizados.
    if (item.type === 'expense') {
      row.appendChild(el('button', {
        class: 'btn-edit', html: Icons.svg('edit', 14), title: 'Editar',
        onClick: () => openInlineEdit(item, row),
      }));
      row.appendChild(el('button', {
        class: 'btn-delete', html: Icons.svg('close', 14), title: 'Eliminar',
        onClick: async () => {
          if (!confirm('¿Eliminar este gasto?')) return;
          await DB.deleteExpense(item.id);
          await reload();
        },
      }));
    } else {
      // recurring / annual → editar abre el modal de recurrentes; eliminar borra con confirmación
      const recId = item.id;
      row.appendChild(el('button', {
        class: 'btn-edit', html: Icons.svg('edit', 14), title: 'Editar recurrente',
        onClick: () => {
          const r = state.recurring.find(x => x.id === recId);
          if (r) openRecurringEdit(r);
        },
      }));
      row.appendChild(el('button', {
        class: 'btn-delete', html: Icons.svg('close', 14), title: 'Eliminar recurrente',
        onClick: async () => {
          const r = state.recurring.find(x => x.id === recId);
          if (!r) return;
          if (!confirm(`¿Eliminar el recurrente "${r.name}"?`)) return;
          await DB.deleteRecurring(recId);
          await reload();
        },
      }));
    }

    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

/* ================================================================
   Edición inline de gasto
   ================================================================ */

function openInlineEdit(item, row) {
  clear(row);
  row.classList.add('expense-row--editing');

  const amountVal = (item.amount / 100).toFixed(2).replace('.', ',');

  const amtInput = el('input', {
    type: 'text', inputmode: 'decimal', class: 'form-input mono',
    value: amountVal, style: { width: '110px' },
  });

  const catSelect = el('select', { class: 'form-input', style: { flex: '1', minWidth: '130px' } });
  state.categories.forEach(c => {
    const opt = el('option', { value: c.id, text: c.name });
    if (c.id === item.categoryId) opt.selected = true;
    catSelect.appendChild(opt);
  });

  const dateInput = el('input', {
    type: 'date', class: 'form-input',
    value: item.date, style: { width: '145px' },
  });

  const descInput = el('input', {
    type: 'text', class: 'form-input',
    value: item.description || '', placeholder: 'Descripción',
    style: { flex: '1', minWidth: '120px' },
  });

  const tagsInlineInput = el('input', {
    type: 'text', class: 'form-input',
    value: (item.tags || []).map(t => '#' + t).join(' '),
    placeholder: 'Etiquetas',
    style: { minWidth: '110px' },
  });

  let paidBySel = null;
  if (state.people.length >= 2) {
    paidBySel = el('select', { class: 'form-input', style: { minWidth: '110px' } });
    paidBySel.appendChild(el('option', { value: '', text: 'Personal' }));
    state.people.forEach(p => {
      const opt = el('option', { value: p, text: p });
      if (item.paidBy === p) opt.selected = true;
      paidBySel.appendChild(opt);
    });
  }

  const fields = el('div', { class: 'edit-row-fields' });
  [amtInput, catSelect, dateInput, descInput, tagsInlineInput].forEach(f => fields.appendChild(f));
  if (paidBySel) fields.appendChild(paidBySel);
  row.appendChild(fields);

  async function save() {
    const cents = eurToCents(amtInput.value);
    const catId = parseInt(catSelect.value);
    if (!cents || !catId) return;
    await DB.updateExpense({
      id: item.id,
      date: dateInput.value || today(),
      amountCents: cents,
      description: descInput.value.trim(),
      categoryId: catId,
      tags:   parseTags(tagsInlineInput.value),
      paidBy: paidBySel?.value || null,
    });
    await reload();
  }

  const saveBtn   = el('button', { class: 'btn btn-primary btn-sm', text: 'Guardar',  onClick: save });
  const cancelBtn = el('button', { class: 'btn btn-ghost btn-sm',   text: 'Cancelar', onClick: reload });

  row.appendChild(el('div', { class: 'edit-row-actions' }, cancelBtn, saveBtn));

  [amtInput, descInput, dateInput, tagsInlineInput].forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') reload();
    });
  });

  amtInput.focus();
  amtInput.select();
}

/* ================================================================
   Vista: Gastos recurrentes
   ================================================================ */

function renderRecurring(container) {
  const card = el('div', { class: 'card' });
  card.style.maxWidth = '720px';
  card.style.margin = '0 auto';

  card.appendChild(
    el('div', { class: 'card-header' },
      el('h2', { class: 'card-title', text: 'Gastos recurrentes y anualizados' }),
    )
  );

  // Formulario
  const form = el('form', { class: 'recurring-form' });

  const nameInput = el('input', { class: 'form-input', placeholder: 'Nombre (Hipoteca, Netflix…)', id: 'rec-name' });
  form.appendChild(wrap('Nombre', nameInput));

  const amtInput = el('input', { class: 'form-input mono', placeholder: '0,00', inputmode: 'decimal', id: 'rec-amount' });
  form.appendChild(wrap('Importe (€)', amtInput));

  const catSelect = el('select', { class: 'form-input', id: 'rec-cat' });
  catSelect.appendChild(el('option', { value: '', text: '— Categoría —' }));
  state.categories.forEach(c => {
    catSelect.appendChild(el('option', { value: c.id, text: c.name }));
  });
  // Categoría a ancho completo para que "Desde" y "Hasta" puedan compartir fila debajo.
  const catGroup = wrap('Categoría', catSelect);
  catGroup.classList.add('full-width');
  form.appendChild(catGroup);

  // Rango de vigencia (mes de inicio obligatorio, fin opcional) — comparten la misma fila
  const defaultStart = ymKey(state.year, state.month);
  const startInput = el('input', { type: 'month', class: 'form-input', id: 'rec-start', value: defaultStart });
  form.appendChild(wrap('Desde (mes)', startInput));
  const endInput = el('input', { type: 'month', class: 'form-input', id: 'rec-end' });
  form.appendChild(wrap('Hasta (opcional)', endInput));

  const annualChk = el('input', { type: 'checkbox', id: 'rec-annual' });
  const annualLabel = el('label', { class: 'check-label', html: ' Gasto anualizado <small>(se prorratea /12 cada mes)</small>' });
  annualLabel.prepend(annualChk);
  const checkWrap = el('div', { class: 'form-group full-width' });
  checkWrap.appendChild(annualLabel);
  form.appendChild(checkWrap);

  form.appendChild(el('button', { type: 'submit', class: 'btn btn-primary', text: 'Añadir recurrente' }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cents = eurToCents(amtInput.value);
    const catId = parseInt(catSelect.value);
    if (!nameInput.value.trim() || !cents || !catId) return;
    const startMonth = startInput.value || currentYmKey();
    const endMonth   = endInput.value || null;
    if (endMonth && endMonth < startMonth) {
      alert('La fecha "Hasta" no puede ser anterior a "Desde"');
      return;
    }
    await DB.addRecurring({
      name: nameInput.value.trim(),
      amountCents: cents,
      categoryId: catId,
      annual: annualChk.checked,
      active: true,
      startMonth,
      endMonth,
    });
    nameInput.value = '';
    amtInput.value = '';
    annualChk.checked = false;
    endInput.value = '';
    startInput.value = ymKey(state.year, state.month);
    await reload();
  });

  card.appendChild(form);

  // Lista
  const divider = el('hr', { class: 'divider' });
  card.appendChild(divider);

  if (state.recurring.length === 0) {
    card.appendChild(el('div', { class: 'empty-state', text: 'Sin gastos recurrentes definidos' }));
  } else {
    const list = el('div', { class: 'recurring-list' });
    // Ordenar: vigentes primero, expirados al final
    const sorted = [...state.recurring].sort((a, b) => {
      const ae = isRecurringExpired(a) ? 1 : 0;
      const be = isRecurringExpired(b) ? 1 : 0;
      return ae - be;
    });
    sorted.forEach(r => list.appendChild(buildRecurringRow(r)));
    card.appendChild(list);
  }

  container.appendChild(card);
}

/** Construye una fila de la lista de recurrentes. */
function buildRecurringRow(r) {
  const cat = state.categories.find(c => c.id === r.categoryId);
  const expired = isRecurringExpired(r);
  const row = el('div', {
    class: `recurring-row ${r.active ? '' : 'inactive'} ${expired ? 'expired' : ''}`.trim(),
  });

  row.appendChild(el('span', { class: 'dot', style: { backgroundColor: cat?.color || '#999' } }));

  const info = el('div', { class: 'expense-info' });

  // Línea principal: nombre + (badge expirado si aplica)
  const descLine = el('div', { class: 'expense-desc recurring-desc-line' });
  const descInner = el('span', { class: 'recurring-name-wrap' });
  appendIconText(descInner, cat?.icon, r.name, 14);
  descLine.appendChild(descInner);
  if (expired) {
    descLine.appendChild(el('span', { class: 'badge-expired', text: 'Expirado' }));
  }
  info.appendChild(descLine);

  // Línea de detalles: importe + rango
  const metaParts = [];
  metaParts.push(cat?.name || 'Sin categoría');
  metaParts.push(r.annual
    ? `${fmtEUR(r.amountCents)}/año → ${fmtEUR(Math.round(r.amountCents / 12))}/mes`
    : 'mensual');
  if (r.startMonth || r.endMonth) {
    if (r.startMonth && r.endMonth) {
      metaParts.push(`${fmtYearMonth(r.startMonth)} — ${fmtYearMonth(r.endMonth)}`);
    } else if (r.startMonth) {
      metaParts.push(`desde ${fmtYearMonth(r.startMonth)}`);
    } else if (r.endMonth) {
      metaParts.push(`hasta ${fmtYearMonth(r.endMonth)}`);
    }
  }
  info.appendChild(el('div', { class: 'expense-meta', text: metaParts.join(' · ') }));
  row.appendChild(info);

  row.appendChild(el('span', {
    class: 'expense-amount mono',
    text: r.annual ? fmtEUR(Math.round(r.amountCents / 12)) + '/mes' : fmtEUR(r.amountCents),
  }));

  const editBtn = el('button', {
    class: 'btn-edit', html: Icons.svg('edit', 14),
    onClick: () => openRecurringEdit(r),
  });
  row.appendChild(editBtn);

  const toggleBtn = el('button', {
    class: 'btn btn-ghost btn-sm',
    text: r.active ? 'Pausar' : 'Activar',
    onClick: async () => { await DB.updateRecurring({ ...r, active: !r.active }); await reload(); },
  });
  row.appendChild(toggleBtn);

  const delBtn = el('button', {
    class: 'btn-delete', html: Icons.svg('close', 14),
    onClick: async () => {
      if (!confirm(`¿Eliminar "${r.name}"?`)) return;
      await DB.deleteRecurring(r.id);
      await reload();
    },
  });
  row.appendChild(delBtn);

  return row;
}

/** Abre un modal para editar un recurrente existente (todos los campos). */
function openRecurringEdit(r) {
  openModal(`Editar "${r.name}"`, (body) => {
    const form = el('form', { class: 'recurring-form' });

    const nameInput = el('input', { class: 'form-input', value: r.name });
    form.appendChild(wrap('Nombre', nameInput));

    const amtInput = el('input', {
      class: 'form-input mono', inputmode: 'decimal',
      value: (r.amountCents / 100).toFixed(2).replace('.', ','),
    });
    form.appendChild(wrap('Importe (€)', amtInput));

    const catSelect = el('select', { class: 'form-input' });
    state.categories.forEach(c => {
      const opt = el('option', { value: c.id, text: c.name });
      if (c.id === r.categoryId) opt.selected = true;
      catSelect.appendChild(opt);
    });
    const catGroup = wrap('Categoría', catSelect);
    catGroup.classList.add('full-width');
    form.appendChild(catGroup);

    const startInput = el('input', { type: 'month', class: 'form-input', value: r.startMonth || '' });
    form.appendChild(wrap('Desde (mes)', startInput));

    const endInput = el('input', { type: 'month', class: 'form-input', value: r.endMonth || '' });
    form.appendChild(wrap('Hasta (opcional)', endInput));

    const annualChk = el('input', { type: 'checkbox' });
    annualChk.checked = !!r.annual;
    const annualLabel = el('label', { class: 'check-label', html: ' Gasto anualizado <small>(se prorratea /12 cada mes)</small>' });
    annualLabel.prepend(annualChk);
    const checkWrap = el('div', { class: 'form-group full-width' });
    checkWrap.appendChild(annualLabel);
    form.appendChild(checkWrap);

    const actions = el('div', { class: 'form-group full-width', style: { display: 'flex', gap: '10px' } });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Guardar' });
    const cancelBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancelar', onClick: closeModal });
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cents = eurToCents(amtInput.value);
      const catId = parseInt(catSelect.value);
      if (!nameInput.value.trim() || !cents || !catId) return;
      const startMonth = startInput.value || null;
      const endMonth   = endInput.value   || null;
      if (startMonth && endMonth && endMonth < startMonth) {
        alert('La fecha "Hasta" no puede ser anterior a "Desde"');
        return;
      }
      await DB.updateRecurring({
        ...r,
        name: nameInput.value.trim(),
        amountCents: cents,
        categoryId: catId,
        annual: annualChk.checked,
        startMonth,
        endMonth,
      });
      closeModal();
      await reload();
    });

    body.appendChild(form);
  });
}

/* ================================================================
   Vista: Informes
   ================================================================ */

async function renderReports(container) {
  // Título primero para feedback inmediato
  const title = el('h2', { class: 'card-title', style: { marginBottom: '24px' } });
  title.innerHTML = `Informes &mdash; ${state.year}`;
  container.appendChild(title);

  // Skeleton mientras se calcula (solo si hay muchos datos)
  let placeholder = null;
  if (state.expenses.length > 80) {
    placeholder = el('div', { class: 'empty-state', text: 'Calculando…' });
    container.appendChild(placeholder);
  }

  // Cálculos pesados (delegado a worker si está disponible)
  const data = await computeReportsAsync(state.year, state.month);
  if (placeholder) placeholder.remove();

  // El usuario puede haber cambiado de tab durante el cálculo
  if (state.view !== 'reports') return;

  const { trend, yearTotal, yearAvg, yearBest, yearWorst,
          yearExpenses, catYearList, catYearTotal, heatmap, heatmapMax,
          fixedYearly, variableYearly, byDow, yoyList, prevYear } = data;
  const maxTotal = Math.max(...trend.map((t) => t.total), 1);
  const yearTrend = trend.filter((t) => t.year === state.year);

  // ---- Layout ----
  const grid = el('div', { class: 'reports-grid' });

  // --- Estadísticas del año ---
  const statsCard = el('div', { class: 'card' });
  statsCard.appendChild(el('div', { class: 'report-section-title', text: 'Año en números' }));
  const statG = el('div', { class: 'stat-grid' });
  function stat(label, value, sub) {
    return el('div', { class: 'stat-item' },
      el('span', { class: 'stat-label', text: label }),
      el('span', { class: 'stat-value mono', text: fmtEUR(value) }),
      sub ? el('span', { class: 'stat-sub', text: sub }) : null,
    );
  }
  statG.appendChild(stat('Total año', yearTotal, `${yearTrend.length} mes${yearTrend.length !== 1 ? 'es' : ''}`));
  statG.appendChild(stat('Media mensual', yearAvg, 'promedio'));
  if (yearBest && yearBest.total > 0) {
    statG.appendChild(stat('Mejor mes', yearBest.total, Utils.monthName(yearBest.month)));
  }
  if (yearWorst && yearWorst.total > 0) {
    statG.appendChild(stat('Peor mes', yearWorst.total, Utils.monthName(yearWorst.month)));
  }
  statsCard.appendChild(statG);
  grid.appendChild(statsCard);

  // --- Distribución anual por categoría ---
  const catCard = el('div', { class: 'card' });
  catCard.appendChild(el('div', { class: 'report-section-title', text: `Distribución ${state.year}` }));
  if (catYearList.length === 0) {
    catCard.appendChild(el('div', { class: 'empty-state', text: 'Sin datos' }));
  } else {
    catYearList.forEach(c => {
      const pct = ((c.totalCents / catYearTotal) * 100).toFixed(1);
      const row = el('div', { class: 'trend-row' });
      const nameWrap = el('div', { class: 'trend-month', style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: '110px' } });
      nameWrap.appendChild(el('span', { class: 'dot', style: { backgroundColor: c.color } }));
      const lbl = el('span');
      appendIconText(lbl, c.icon, c.name, 12);
      nameWrap.appendChild(lbl);
      row.appendChild(nameWrap);
      const barWrap = el('div', { class: 'trend-bar-wrap' });
      barWrap.appendChild(el('div', { class: 'trend-bar', style: { width: `${pct}%`, backgroundColor: c.color } }));
      row.appendChild(barWrap);
      row.appendChild(el('span', { class: 'trend-amount', text: fmtEUR(c.totalCents) }));
      row.appendChild(el('span', { class: 'trend-delta', text: `${pct}%` }));
      catCard.appendChild(row);
    });
  }
  grid.appendChild(catCard);

  // --- Tendencia últimos 12 meses ---
  const trendCard = el('div', { class: 'card' });
  trendCard.appendChild(el('div', { class: 'report-section-title', text: 'Tendencia (12 meses)' }));
  trend.forEach((t, i) => {
    const pct = Math.round((t.total / maxTotal) * 100);
    const prev = trend[i - 1];
    let delta = '', deltaClass = '';
    if (prev && prev.total > 0) {
      const diff = t.total - prev.total;
      const diffPct = ((diff / prev.total) * 100).toFixed(0);
      delta = `${diff > 0 ? '+' : ''}${diffPct}%`;
      deltaClass = diff > 0 ? 'up' : 'down';
    }
    const row = el('div', { class: 'trend-row' });
    row.appendChild(el('span', { class: 'trend-month', text: `${Utils.monthShort(t.month)} ${t.year !== state.year ? t.year : ''}`.trim() }));
    const barWrap = el('div', { class: 'trend-bar-wrap' });
    barWrap.appendChild(el('div', { class: 'trend-bar', style: { width: `${pct}%` } }));
    row.appendChild(barWrap);
    row.appendChild(el('span', { class: 'trend-amount', text: fmtEUR(t.total) }));
    if (delta) row.appendChild(el('span', { class: `trend-delta ${deltaClass}`, text: delta }));
    trendCard.appendChild(row);
  });
  grid.appendChild(trendCard);

  // --- Top gastos puntuales ---
  const topCard = el('div', { class: 'card' });
  topCard.appendChild(el('div', { class: 'report-section-title', text: `Top gastos ${state.year}` }));
  if (yearExpenses.length === 0) {
    topCard.appendChild(el('div', { class: 'empty-state', text: 'Sin gastos puntuales este año' }));
  } else {
    yearExpenses.forEach((e, i) => {
      const cat = state.categories.find(c => c.id === e.categoryId);
      const row = el('div', { class: 'top-expense-row' });
      row.appendChild(el('span', { class: 'top-rank', text: `${i + 1}.` }));
      row.appendChild(el('span', { class: 'dot', style: { backgroundColor: cat?.color || '#999' } }));
      const info = el('div', { style: { flex: '1', minWidth: '0' } });
      info.appendChild(el('div', { class: 'top-desc', text: e.description || cat?.name || 'Gasto' }));
      info.appendChild(el('div', { class: 'top-date expense-meta', text: `${cat?.name || 'Sin categoría'} · ${fmtDate(e.date)}` }));
      row.appendChild(info);
      row.appendChild(el('span', { class: 'top-amount mono', text: fmtEUR(e.amountCents) }));
      topCard.appendChild(row);
    });
  }
  grid.appendChild(topCard);

  // --- Coste fijo vs variable ---
  grid.appendChild(buildFixedVariableCard(fixedYearly, variableYearly, state.year));

  // --- Gasto por día de la semana ---
  grid.appendChild(buildDayOfWeekCard(byDow, state.year));

  // --- Inflación YoY por categoría ---
  grid.appendChild(buildYoYCard(yoyList, state.year, prevYear));

  container.appendChild(grid);

  // Secciones full-width
  const fullSection = el('div', { class: 'reports-full' });
  fullSection.appendChild(buildCompareCard());
  fullSection.appendChild(buildIncomeReportCard());
  fullSection.appendChild(buildHeatmapCard(heatmap, heatmapMax, state.year));
  container.appendChild(fullSection);
}

function wrap(labelText, input) {
  const g = el('div', { class: 'form-group' });
  g.appendChild(el('label', { class: 'form-label', text: labelText }));
  g.appendChild(input);
  return g;
}

/* ================================================================
   Vista: Categorías
   ================================================================ */

function renderCategories(container) {
  const card = el('div', { class: 'card' });
  card.style.maxWidth = '600px';
  card.style.margin = '0 auto';

  card.appendChild(el('h2', { class: 'card-title', text: 'Gestionar categorías' }));

  // Form nueva categoría
  const form = el('form', { class: 'category-form' });
  const topRow = el('div', { class: 'category-form-row' });
  const colorInp = el('input', { type: 'color', value: '#c47a1a', class: 'color-input' });
  const nameInp = el('input', { class: 'form-input', placeholder: 'Nombre de la categoría', style: { flex: '1' } });
  const addBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Añadir' });
  topRow.appendChild(colorInp);
  topRow.appendChild(nameInp);
  topRow.appendChild(addBtn);
  form.appendChild(topRow);

  // Límite mensual (opcional)
  const limitInp = el('input', {
    type: 'text', inputmode: 'decimal',
    class: 'form-input mono', placeholder: 'Sin límite',
    style: { maxWidth: '160px' },
  });
  const limitRow = el('div', { class: 'category-limit-row' },
    el('label', { class: 'form-label', text: 'Límite mensual (€)' }),
    limitInp,
  );
  form.appendChild(limitRow);

  // Selector visual de iconos
  form.appendChild(el('div', {
    class: 'form-label',
    text: 'Icono',
    style: { marginTop: '14px', marginBottom: '8px' },
  }));
  const picker = buildIconPicker(null);
  form.appendChild(picker);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!nameInp.value.trim()) return;
    const limitCents = limitInp.value.trim() ? eurToCents(limitInp.value) : 0;
    await DB.addCategory({
      name: nameInp.value.trim(),
      color: colorInp.value,
      icon: picker.dataset.value || '',
      monthlyLimitCents: limitCents,
    });
    nameInp.value = '';
    limitInp.value = '';
    picker.querySelectorAll('.icon-pick-item').forEach(b => b.classList.remove('selected'));
    picker.dataset.value = '';
    await reload();
  });
  card.appendChild(form);

  const divider = el('hr', { class: 'divider' });
  card.appendChild(divider);

  // Lista
  const list = el('div', { class: 'category-list' });
  state.categories.forEach(c => {
    const row = el('div', { class: 'category-row' });
    row.appendChild(el('span', { class: 'dot-lg', style: { backgroundColor: c.color } }));
    if (Icons.has(c.icon)) {
      const ico = el('span', { class: 'category-icon' });
      ico.innerHTML = Icons.svg(c.icon, 18);
      row.appendChild(ico);
    } else if (c.icon) {
      row.appendChild(el('span', { class: 'category-icon', text: c.icon }));
    }
    row.appendChild(el('span', { class: 'category-name', text: c.name }));
    if (c.monthlyLimitCents > 0) {
      row.appendChild(el('span', {
        class: 'category-limit mono',
        text: `${fmtEUR(c.monthlyLimitCents)} /mes`,
        title: 'Límite mensual',
      }));
    }
    row.appendChild(el('button', {
      class: 'btn-edit', html: Icons.svg('edit', 14), title: 'Editar',
      onClick: () => openCategoryEdit(c, row),
    }));
    row.appendChild(el('button', {
      class: 'btn-delete', html: Icons.svg('close', 14), title: 'Eliminar',
      onClick: async () => {
        if (!confirm(`¿Eliminar "${c.name}"?\nSus gastos asociados se mostrarán como "Sin categoría", pero no se borrarán.`)) return;
        await DB.deleteCategory(c.id);
        await reload();
      },
    }));
    list.appendChild(row);
  });
  card.appendChild(list);

  container.appendChild(card);
  container.appendChild(buildPeopleCard());
  container.appendChild(buildImportExportCard());
}

/* ================================================================
   Edición inline de categoría
   ================================================================ */

/* ================================================================
   Comparación de meses (usado en Informes)
   ================================================================ */

function buildCompareCard() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'report-section-title', text: 'Comparar meses' }));

  // Genera las últimas 24 opciones de mes
  const opts = [];
  let oy = state.year, om = state.month;
  for (let i = 0; i < 24; i++) {
    opts.push({ year: oy, month: om, value: `${oy}-${String(om).padStart(2, '0')}` });
    if (om === 1) { om = 12; oy--; } else om--;
  }

  function buildSel(selectedValue) {
    const sel = el('select', { class: 'form-input' });
    sel.appendChild(el('option', { value: '', text: '— Selecciona —' }));
    opts.forEach(o => {
      const opt = el('option', { value: o.value, text: `${monthName(o.month)} ${o.year}` });
      if (o.value === selectedValue) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  }

  const prevM = state.month === 1 ? 12 : state.month - 1;
  const prevY = state.month === 1 ? state.year - 1 : state.year;
  const defA  = `${state.year}-${String(state.month).padStart(2, '0')}`;
  const defB  = `${prevY}-${String(prevM).padStart(2, '0')}`;

  const selA = buildSel(defA);
  const selB = buildSel(defB);

  const selGroup = el('div', { class: 'compare-selects' });
  const ga = el('div', { class: 'form-group' });
  ga.appendChild(el('label', { class: 'form-label', text: 'Mes A' }));
  ga.appendChild(selA);
  selGroup.appendChild(ga);
  const gb = el('div', { class: 'form-group' });
  gb.appendChild(el('label', { class: 'form-label', text: 'Mes B' }));
  gb.appendChild(selB);
  selGroup.appendChild(gb);
  card.appendChild(selGroup);

  const resultArea = el('div', { class: 'compare-result' });
  card.appendChild(resultArea);

  function updateResult() {
    clear(resultArea);
    const vA = selA.value, vB = selB.value;
    if (!vA || !vB) return;

    const [yA, mA] = vA.split('-').map(Number);
    const [yB, mB] = vB.split('-').map(Number);
    const bdA = computeCatBreakdown(yA, mA);
    const bdB = computeCatBreakdown(yB, mB);

    const allIds = new Set([...Object.keys(bdA), ...Object.keys(bdB)]);
    const rows = [];
    allIds.forEach(id => {
      const a = bdA[id]?.totalCents || 0;
      const b = bdB[id]?.totalCents || 0;
      if (a === 0 && b === 0) return;
      rows.push({ cat: bdA[id] || bdB[id], a, b, delta: b - a });
    });
    rows.sort((r1, r2) => Math.max(r2.a, r2.b) - Math.max(r1.a, r1.b));

    const totA = rows.reduce((s, r) => s + r.a, 0);
    const totB = rows.reduce((s, r) => s + r.b, 0);
    const totDelta = totB - totA;

    const table = el('table', { class: 'compare-table' });
    const thead = el('thead');
    const hrow = el('tr');
    hrow.appendChild(el('th', { text: 'Categoría' }));
    hrow.appendChild(el('th', { text: `${Utils.monthShort(mA)} ${yA}` }));
    hrow.appendChild(el('th', { text: `${Utils.monthShort(mB)} ${yB}` }));
    hrow.appendChild(el('th', { text: 'Diferencia' }));
    thead.appendChild(hrow);
    table.appendChild(thead);

    const tbody = el('tbody');
    rows.forEach(r => {
      const tr = el('tr');
      const nameCell = el('td');
      const inner = el('div', { class: 'compare-name-cell' });
      inner.appendChild(el('span', { class: 'dot', style: { backgroundColor: r.cat.color } }));
      const lbl = el('span');
      appendIconText(lbl, r.cat.icon, r.cat.name, 12);
      inner.appendChild(lbl);
      nameCell.appendChild(inner);
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { text: r.a > 0 ? fmtEUR(r.a) : '—' }));
      tr.appendChild(el('td', { text: r.b > 0 ? fmtEUR(r.b) : '—' }));
      const dCell = el('td', { class: r.delta > 0 ? 'compare-delta-pos' : r.delta < 0 ? 'compare-delta-neg' : '' });
      if (r.delta === 0) dCell.textContent = '—';
      else if (r.delta > 0) dCell.textContent = '+' + fmtEUR(r.delta);
      else dCell.textContent = '−' + fmtEUR(-r.delta);
      tr.appendChild(dCell);
      tbody.appendChild(tr);
    });

    // Fila total gastos
    const trow = el('tr', { class: 'compare-total' });
    trow.appendChild(el('td', { text: 'Total gastos' }));
    trow.appendChild(el('td', { text: fmtEUR(totA) }));
    trow.appendChild(el('td', { text: fmtEUR(totB) }));
    const tdCell = el('td', { class: totDelta > 0 ? 'compare-delta-pos' : totDelta < 0 ? 'compare-delta-neg' : '' });
    if (totDelta === 0) tdCell.textContent = '—';
    else if (totDelta > 0) tdCell.textContent = '+' + fmtEUR(totDelta);
    else tdCell.textContent = '−' + fmtEUR(-totDelta);
    trow.appendChild(tdCell);
    tbody.appendChild(trow);

    // Filas de ingresos y ahorro
    const incA = getMonthIncome(yA, mA);
    const incB = getMonthIncome(yB, mB);
    const savA = incA - totA;
    const savB = incB - totB;
    const incDelta = incB - incA;
    const savDelta = savB - savA;

    // Fila de ingresos (más ingresos = mejor → verde)
    const incRow = el('tr', { class: 'compare-sep-row' });
    incRow.appendChild(el('td', { text: 'Ingresos' }));
    incRow.appendChild(el('td', { text: incA > 0 ? fmtEUR(incA) : '—' }));
    incRow.appendChild(el('td', { text: incB > 0 ? fmtEUR(incB) : '—' }));
    const incDeltaCell = el('td');
    if (incA > 0 && incB > 0 && incDelta !== 0) {
      incDeltaCell.className = incDelta > 0 ? 'compare-delta-neg' : 'compare-delta-pos';
      incDeltaCell.textContent = (incDelta > 0 ? '+' : '−') + fmtEUR(Math.abs(incDelta));
    } else { incDeltaCell.textContent = '—'; }
    incRow.appendChild(incDeltaCell);
    tbody.appendChild(incRow);

    // Fila de ahorro (más ahorro = mejor → verde)
    const savRow = el('tr', { class: 'compare-sep-row compare-savings-row' });
    savRow.appendChild(el('td', { text: 'Ahorro' }));
    const savCellA = el('td', { class: incA > 0 ? (savA >= 0 ? 'amount-pos' : 'amount-neg') : '' });
    savCellA.textContent = incA > 0 ? fmtEUR(savA) : '—';
    savRow.appendChild(savCellA);
    const savCellB = el('td', { class: incB > 0 ? (savB >= 0 ? 'amount-pos' : 'amount-neg') : '' });
    savCellB.textContent = incB > 0 ? fmtEUR(savB) : '—';
    savRow.appendChild(savCellB);
    const savDeltaCell = el('td');
    if (incA > 0 && incB > 0 && savDelta !== 0) {
      savDeltaCell.className = savDelta > 0 ? 'compare-delta-neg' : 'compare-delta-pos';
      savDeltaCell.textContent = (savDelta > 0 ? '+' : '−') + fmtEUR(Math.abs(savDelta));
    } else { savDeltaCell.textContent = '—'; }
    savRow.appendChild(savDeltaCell);
    tbody.appendChild(savRow);

    table.appendChild(tbody);
    resultArea.appendChild(table);
  }

  selA.addEventListener('change', updateResult);
  selB.addEventListener('change', updateResult);
  updateResult();
  return card;
}

/* ================================================================
   Informe de ingresos y ahorro (usado en Informes)
   ================================================================ */

function buildIncomeReportCard() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'report-section-title', text: 'Ingresos y ahorro mensual' }));

  const months12 = [];
  let y = state.year, m = state.month;
  for (let i = 0; i < 12; i++) {
    const income = getMonthIncome(y, m);
    const { total: expenses } = computeMonthTotal(y, m);
    months12.unshift({ year: y, month: m, income, expenses, savings: income - expenses, hasData: income > 0 });
    if (m === 1) { m = 12; y--; } else m--;
  }

  if (!months12.some(mo => mo.hasData)) {
    card.appendChild(el('div', {
      class: 'empty-state',
      text: 'Registra tus ingresos en la pestaña "Ahorro" para ver este informe',
    }));
    return card;
  }

  // Cabecera de columnas
  const header = el('div', { class: 'income-report-row income-report-header' });
  header.appendChild(el('span', { class: 'income-month', text: 'Mes' }));
  header.appendChild(el('span', { class: 'income-col income-val', text: 'Ingresos' }));
  header.appendChild(el('span', { class: 'income-col income-exp', text: 'Gastos' }));
  header.appendChild(el('span', { class: 'income-col income-savings', text: 'Ahorro' }));
  header.appendChild(el('span', { class: 'income-col income-delta', text: 'vs anterior' }));
  card.appendChild(header);

  months12.forEach((mo, i) => {
    const prev = months12[i - 1];
    const row = el('div', { class: 'income-report-row' });
    row.appendChild(el('span', {
      class: 'income-month',
      text: `${Utils.monthShort(mo.month)}${mo.year !== state.year ? ' ' + mo.year : ''}`,
    }));
    row.appendChild(el('span', { class: 'income-col income-val', text: mo.hasData ? fmtEUR(mo.income) : '—' }));
    row.appendChild(el('span', { class: 'income-col income-exp', text: fmtEUR(mo.expenses) }));

    if (!mo.hasData) {
      row.appendChild(el('span', { class: 'income-col income-savings' }));
      row.appendChild(el('span', { class: 'income-col income-delta' }));
    } else {
      row.appendChild(el('span', {
        class: `income-col income-savings ${mo.savings >= 0 ? 'amount-pos' : 'amount-neg'}`,
        text: mo.savings >= 0 ? fmtEUR(mo.savings) : '−' + fmtEUR(-mo.savings),
      }));

      if (prev && prev.hasData) {
        const diff = mo.savings - prev.savings;
        const deltaEl = el('span', { class: `income-col income-delta ${diff >= 0 ? 'savings-up' : 'savings-down'}` });
        if (diff < 0) deltaEl.textContent = '−' + fmtEUR(-diff);
        else if (diff > 0) deltaEl.textContent = '+' + fmtEUR(diff);
        else deltaEl.textContent = '—';
        row.appendChild(deltaEl);
      } else {
        row.appendChild(el('span', { class: 'income-col income-delta' }));
      }
    }

    card.appendChild(row);
  });

  return card;
}

/* ================================================================
   Vista: Ahorro
   ================================================================ */

function renderSavings(container) {
  const monthIncome   = getMonthIncome(state.year, state.month);
  const { total: monthExpenses } = computeMonthTotal(state.year, state.month);
  const monthSavings  = monthIncome - monthExpenses;

  // Total ahorrado en el año (solo meses con ingresos definidos)
  let yearSavings = 0, monthsWithData = 0;
  for (let mo = 1; mo <= state.month; mo++) {
    const inc = getMonthIncome(state.year, mo);
    if (inc > 0) {
      const { total: exp } = computeMonthTotal(state.year, mo);
      yearSavings += inc - exp;
      monthsWithData++;
    }
  }

  const goalPct = state.annualGoal > 0
    ? Math.min(100, Math.max(0, (yearSavings / state.annualGoal) * 100))
    : 0;

  const title = el('h2', { class: 'card-title', style: { marginBottom: '24px' } });
  title.innerHTML = `Ahorro &mdash; ${monthName(state.month)} ${state.year}`;
  container.appendChild(title);

  const grid = el('div', { class: 'savings-wrap' });

  // ---- Tarjeta del mes ----
  const monthCard = el('div', { class: 'card' });
  monthCard.appendChild(el('div', { class: 'report-section-title', text: 'Ingresos del mes' }));

  const incomeRow = el('div', { class: 'savings-income-group' });
  const incomeInput = el('input', {
    type: 'text', inputmode: 'decimal', class: 'form-input mono savings-income-input',
    placeholder: '0,00',
    value: monthIncome > 0 ? (monthIncome / 100).toFixed(2).replace('.', ',') : '',
  });
  incomeRow.appendChild(incomeInput);
  const saveBtnInc = el('button', {
    type: 'button', class: 'btn btn-primary btn-sm', text: 'Guardar',
    onClick: async () => {
      const raw = incomeInput.value.trim();
      await DB.setIncome(state.year, state.month, raw ? eurToCents(raw) : 0);
      await reload();
    },
  });
  incomeRow.appendChild(saveBtnInc);
  incomeInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtnInc.click(); });
  monthCard.appendChild(incomeRow);

  // Stats del mes
  const statsGrid = el('div', { class: 'savings-stats' });

  function savStat(label, text, extraClass = '') {
    const item = el('div', { class: `savings-stat-item${extraClass ? ' ' + extraClass : ''}` });
    item.appendChild(el('span', { class: 'savings-stat-label', text: label }));
    item.appendChild(el('span', { class: 'savings-stat-value', text }));
    return item;
  }

  statsGrid.appendChild(savStat('Gasto total', fmtEUR(monthExpenses)));
  statsGrid.appendChild(savStat('Ingresos', monthIncome > 0 ? fmtEUR(monthIncome) : '—'));

  const savMain = el('div', { class: 'savings-stat-item savings-stat-main' });
  savMain.appendChild(el('span', { class: 'savings-stat-label', text: 'Ahorro del mes' }));
  const savValEl = el('span', { class: 'savings-stat-value' });
  if (monthIncome === 0) {
    savValEl.textContent = '—';
  } else {
    savValEl.classList.add(monthSavings >= 0 ? 'amount-pos' : 'amount-neg');
    savValEl.textContent = monthSavings >= 0 ? fmtEUR(monthSavings) : '−' + fmtEUR(-monthSavings);
  }
  savMain.appendChild(savValEl);
  statsGrid.appendChild(savMain);
  monthCard.appendChild(statsGrid);
  grid.appendChild(monthCard);

  // ---- Tarjeta objetivo anual ----
  const goalCard = el('div', { class: 'card' });
  goalCard.appendChild(el('div', { class: 'report-section-title', text: `Objetivo anual ${state.year}` }));

  const goalRow = el('div', { class: 'savings-income-group' });
  const goalInput = el('input', {
    type: 'text', inputmode: 'decimal', class: 'form-input mono savings-income-input',
    placeholder: '0,00',
    value: state.annualGoal > 0 ? (state.annualGoal / 100).toFixed(2).replace('.', ',') : '',
  });
  goalRow.appendChild(goalInput);
  const saveBtnGoal = el('button', {
    type: 'button', class: 'btn btn-primary btn-sm', text: 'Guardar',
    onClick: async () => {
      const raw = goalInput.value.trim();
      await DB.setSetting('annual-goal', raw ? eurToCents(raw) : 0);
      await reload();
    },
  });
  goalRow.appendChild(saveBtnGoal);
  goalInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtnGoal.click(); });
  goalCard.appendChild(goalRow);

  // Stats del año
  const yearStatGrid = el('div', { class: 'savings-stats' });
  const yearSavEl = el('div', { class: 'savings-stat-item' });
  yearSavEl.appendChild(el('span', { class: 'savings-stat-label', text: 'Ahorrado en el año' }));
  const yearValEl = el('span', { class: 'savings-stat-value' });
  if (monthsWithData === 0) {
    yearValEl.textContent = '—';
  } else {
    yearValEl.classList.add(yearSavings >= 0 ? 'amount-pos' : 'amount-neg');
    yearValEl.textContent = yearSavings >= 0 ? fmtEUR(yearSavings) : '−' + fmtEUR(-yearSavings);
  }
  yearSavEl.appendChild(yearValEl);
  yearStatGrid.appendChild(yearSavEl);

  if (state.annualGoal > 0) {
    yearStatGrid.appendChild(savStat('Objetivo', fmtEUR(state.annualGoal)));
  }
  goalCard.appendChild(yearStatGrid);

  // Barra de progreso
  if (state.annualGoal > 0 || monthsWithData > 0) {
    const progressWrap = el('div', { class: 'savings-progress-wrap' });
    const progressHeader = el('div', { class: 'savings-progress-header' });
    progressHeader.appendChild(el('span', { text: 'Progreso anual' }));
    const pLabel = state.annualGoal > 0
      ? `${goalPct.toFixed(1)}% completado`
      : `${monthsWithData} mes${monthsWithData !== 1 ? 'es' : ''} con datos`;
    progressHeader.appendChild(el('span', { class: 'mono', text: pLabel }));
    progressWrap.appendChild(progressHeader);

    const barTrack = el('div', { class: 'savings-bar-track' });
    barTrack.appendChild(el('div', {
      class: `savings-bar-fill${yearSavings < 0 ? ' negative' : ''}`,
      style: { width: `${Math.max(yearSavings < 0 ? 4 : 0, goalPct)}%` },
    }));
    progressWrap.appendChild(barTrack);
    goalCard.appendChild(progressWrap);
  }

  grid.appendChild(goalCard);
  container.appendChild(grid);

  // ---- Gráfico de evolución acumulada ----
  const histMonths = [];
  let hy = state.year, hm = state.month;
  for (let i = 0; i < 24; i++) {
    const inc = getMonthIncome(hy, hm);
    const { total: exp } = computeMonthTotal(hy, hm);
    histMonths.unshift({ year: hy, month: hm, income: inc, expenses: exp, savings: inc - exp, hasData: inc > 0 });
    if (hm === 1) { hm = 12; hy--; } else hm--;
  }
  const dataMonths = histMonths.filter(mo => mo.hasData);
  if (dataMonths.length >= 2) {
    const chartCard = el('div', { class: 'card savings-chart-card' });
    chartCard.appendChild(el('div', { class: 'report-section-title', text: 'Evolución del ahorro acumulado' }));
    const chartWrap = el('div', { class: 'savings-chart-wrap' });
    chartWrap.appendChild(el('canvas', { id: 'patrimony-canvas' }));
    chartCard.appendChild(chartWrap);
    container.appendChild(chartCard);

    let cumulative = 0;
    const labels = [], values = [];
    dataMonths.forEach(mo => {
      cumulative += mo.savings;
      labels.push(`${Utils.monthShort(mo.month)}${mo.year !== state.year ? ' ' + mo.year : ''}`);
      values.push(+(cumulative / 100).toFixed(2));
    });

    requestAnimationFrame(() => LineChart.render('patrimony-canvas', labels, values));
  }
}

/* ================================================================
   Edición inline de categoría
   ================================================================ */

function openCategoryEdit(cat, row) {
  clear(row);
  row.classList.add('category-row--editing');

  const colorInp = el('input', { type: 'color', value: cat.color || '#c47a1a', class: 'color-input' });
  const nameInp = el('input', {
    type: 'text', class: 'form-input',
    value: cat.name, style: { flex: '1', minWidth: '120px' },
  });
  const limitInp = el('input', {
    type: 'text', inputmode: 'decimal',
    class: 'form-input mono',
    value: cat.monthlyLimitCents > 0 ? (cat.monthlyLimitCents / 100).toFixed(2).replace('.', ',') : '',
    placeholder: 'Sin límite',
    style: { maxWidth: '140px' },
    title: 'Límite mensual (€)',
  });

  async function save() {
    if (!nameInp.value.trim()) return;
    const limitCents = limitInp.value.trim() ? eurToCents(limitInp.value) : 0;
    await DB.updateCategory({
      ...cat,
      name: nameInp.value.trim(),
      color: colorInp.value,
      icon: picker.dataset.value || '',
      monthlyLimitCents: limitCents,
    });
    await reload();
  }

  const saveBtn   = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Guardar',  onClick: save });
  const cancelBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm',   text: 'Cancelar', onClick: reload });

  const topRow = el('div', { class: 'category-edit-row' }, colorInp, nameInp, limitInp, cancelBtn, saveBtn);
  row.appendChild(topRow);

  // Picker con el icono actual preseleccionado (resuelve emoji legacy → id)
  const picker = buildIconPicker(Icons.resolve(cat.icon));
  picker.classList.add('icon-picker--cat-edit');
  row.appendChild(picker);

  [nameInp, limitInp].forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') reload();
    });
  });

  nameInp.focus();
  nameInp.select();
}

/* ================================================================
   Gastos compartidos — Personas y Liquidación
   ================================================================ */

function computeSettlement(sharedExpenses, people) {
  if (people.length < 2) return [];
  const paid = {};
  people.forEach(p => { paid[p] = 0; });
  sharedExpenses.forEach(e => {
    if (Object.prototype.hasOwnProperty.call(paid, e.paidBy)) paid[e.paidBy] += e.amountCents;
  });
  const total = Object.values(paid).reduce((s, v) => s + v, 0);
  if (total === 0) return [];
  const fairShare = total / people.length;
  const creditors = [], debtors = [];
  people.forEach(p => {
    const b = paid[p] - fairShare;
    if (b > 1)  creditors.push({ name: p, balance: b });
    if (b < -1) debtors.push({ name: p, balance: b });
  });
  creditors.sort((a, b) => b.balance - a.balance);
  debtors.sort((a, b) => a.balance - b.balance);
  const txs = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const amount = Math.min(creditors[ci].balance, -debtors[di].balance);
    if (amount > 1) txs.push({ from: debtors[di].name, to: creditors[ci].name, amount: Math.round(amount) });
    creditors[ci].balance -= amount;
    debtors[di].balance  += amount;
    if (creditors[ci].balance < 1) ci++;
    if (-debtors[di].balance < 1) di++;
  }
  return txs;
}

function buildSettlementCard(monthExpenses) {
  const shared = monthExpenses.filter(e => e.paidBy && state.people.includes(e.paidBy));
  if (shared.length === 0) return null;
  const txs = computeSettlement(shared, state.people);

  const card = el('div', { class: 'card settlement-card' });
  card.appendChild(
    el('div', { class: 'card-header' },
      el('h2', { class: 'card-title', text: 'Liquidar gastos compartidos' }),
      el('span', { class: 'badge', text: `${shared.length} gasto${shared.length !== 1 ? 's' : ''}` }),
    )
  );

  if (txs.length === 0) {
    card.appendChild(el('div', { class: 'empty-state', style: { padding: '14px 0' },
      text: '¡Todo liquidado! Los pagos están equilibrados.' }));
  } else {
    txs.forEach(tx => {
      const row = el('div', { class: 'settlement-row' });
      row.appendChild(el('span', { class: 'settlement-from', text: tx.from }));
      row.appendChild(el('span', { class: 'settlement-arrow', text: '→' }));
      row.appendChild(el('span', { class: 'settlement-to',   text: tx.to }));
      row.appendChild(el('span', { class: 'settlement-amount mono', text: fmtEUR(tx.amount) }));
      card.appendChild(row);
    });
  }

  // Resumen de lo que pagó cada persona
  const paid = {};
  state.people.forEach(p => { paid[p] = 0; });
  shared.forEach(e => { paid[e.paidBy] = (paid[e.paidBy] || 0) + e.amountCents; });
  const total = Object.values(paid).reduce((s, v) => s + v, 0);

  card.appendChild(el('hr', { class: 'divider', style: { margin: '14px 0' } }));
  const summary = el('div', { class: 'settlement-summary' });
  state.people.forEach(p => {
    const pct = total > 0 ? ((paid[p] / total) * 100).toFixed(0) : 0;
    const row = el('div', { class: 'settlement-summary-row' });
    row.appendChild(el('span', { text: p }));
    row.appendChild(el('span', { class: 'mono', text: `${fmtEUR(paid[p] || 0)} (${pct}%)` }));
    summary.appendChild(row);
  });
  card.appendChild(summary);
  return card;
}

function buildPeopleCard() {
  const card = el('div', { class: 'card' });
  card.style.maxWidth = '600px';
  card.style.margin = '24px auto 0';

  card.appendChild(el('h2', { class: 'card-title', text: 'Personas (gastos compartidos)' }));
  const note = el('p', { class: 'expense-meta', style: { margin: '6px 0 14px' } });
  note.textContent = 'Añade los nombres de quienes comparten gastos para calcular la liquidación mensual.';
  card.appendChild(note);

  const addRow = el('div', { class: 'people-add-row' });
  const nameInp = el('input', { class: 'form-input', placeholder: 'Nombre (ej. María)', style: { flex: '1' } });
  const addBtn = el('button', {
    class: 'btn btn-primary btn-sm', text: 'Añadir',
    onClick: async () => {
      const name = nameInp.value.trim();
      if (!name || state.people.includes(name)) return;
      await DB.setSetting('people', [...state.people, name]);
      nameInp.value = '';
      await reload();
    },
  });
  nameInp.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
  addRow.appendChild(nameInp);
  addRow.appendChild(addBtn);
  card.appendChild(addRow);

  if (state.people.length > 0) {
    card.appendChild(el('hr', { class: 'divider' }));
    const list = el('div', { class: 'people-list' });
    state.people.forEach(person => {
      const row = el('div', { class: 'people-row' });
      row.appendChild(el('span', { class: 'people-name', text: person }));
      row.appendChild(el('button', {
        class: 'btn-delete', html: Icons.svg('close', 14), title: 'Eliminar',
        onClick: async () => {
          await DB.setSetting('people', state.people.filter(p => p !== person));
          await reload();
        },
      }));
      list.appendChild(row);
    });
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
    card.appendChild(list);
  }
  return card;
}

/* ================================================================
   Importar / Exportar
   ================================================================ */

function buildImportPreview(csvText, container) {
  clear(container);
  const firstLine = csvText.split(/\r?\n/)[0] || '';
  const sep = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';

  function parseRow(line) {
    const result = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }
        inQ = !inQ;
        continue;
      }
      if (c === sep && !inQ) { result.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    result.push(cur.trim());
    return result;
  }

  const lines     = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    container.appendChild(el('div', { class: 'empty-state', text: 'Archivo sin datos suficientes' }));
    return;
  }
  const headers  = parseRow(lines[0]);
  const dataRows = lines.slice(1).map(parseRow).filter(r => r.some(c => c));
  if (dataRows.length === 0) {
    container.appendChild(el('div', { class: 'empty-state', text: 'No se encontraron filas de datos' }));
    return;
  }

  // Vista previa (primeras 4 filas)
  const previewWrap = el('div', { class: 'import-table-wrap' });
  const table = el('table', { class: 'import-preview-table' });
  const thead = el('thead'), hrow = el('tr');
  headers.forEach(h => hrow.appendChild(el('th', { text: h || '—' })));
  thead.appendChild(hrow); table.appendChild(thead);
  const tbody = el('tbody');
  dataRows.slice(0, 4).forEach(row => {
    const tr = el('tr');
    row.forEach(cell => tr.appendChild(el('td', { text: cell })));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody); previewWrap.appendChild(table);
  container.appendChild(previewWrap);

  // Mapping de columnas
  const mappingDiv = el('div', { style: { marginTop: '16px' } });
  mappingDiv.appendChild(el('div', { class: 'report-section-title', style: { marginBottom: '10px' }, text: 'Asignar columnas' }));
  const grid = el('div', { class: 'import-mapping' });

  function colSel(label, hint) {
    const g = el('div', { class: 'form-group' });
    g.appendChild(el('label', { class: 'form-label', text: label }));
    const sel = el('select', { class: 'form-input' });
    sel.appendChild(el('option', { value: '-1', text: '— Ninguna —' }));
    headers.forEach((h, i) => {
      const opt = el('option', { value: i, text: h || 'Col ' + (i + 1) });
      if (hint && new RegExp(hint, 'i').test(h)) opt.selected = true;
      sel.appendChild(opt);
    });
    return { g, sel };
  }

  const { g: gDate, sel: selDate } = colSel('Fecha',       'fecha|date|fec');
  const { g: gAmt,  sel: selAmt  } = colSel('Importe',     'importe|amount|valor|cargo');
  const { g: gDesc, sel: selDesc } = colSel('Descripción', 'concepto|descripci|movimiento|comercio');
  grid.appendChild(gDate); grid.appendChild(gAmt); grid.appendChild(gDesc);

  const gCat = el('div', { class: 'form-group' });
  gCat.appendChild(el('label', { class: 'form-label', text: 'Categoría por defecto' }));
  const selCat = el('select', { class: 'form-input' });
  selCat.appendChild(el('option', { value: '', text: '— Sin categoría —' }));
  state.categories.forEach(c => selCat.appendChild(el('option', { value: c.id, text: c.name })));
  gCat.appendChild(selCat); grid.appendChild(gCat);
  mappingDiv.appendChild(grid);

  const chkWrap = el('div', { class: 'form-group', style: { marginTop: '10px' } });
  const chkLabel = el('label', { class: 'check-label' });
  const onlyNegChk = el('input', { type: 'checkbox' });
  onlyNegChk.checked = true;
  chkLabel.appendChild(onlyNegChk);
  chkLabel.appendChild(document.createTextNode(' Solo importar importes negativos (gastos)'));
  chkWrap.appendChild(chkLabel);
  mappingDiv.appendChild(chkWrap);

  const importBtn = el('button', {
    type: 'button', class: 'btn btn-primary', style: { marginTop: '14px' },
    text: `Importar ${dataRows.length} filas`,
  });
  importBtn.addEventListener('click', async () => {
    const dIdx    = parseInt(selDate.value);
    const aIdx    = parseInt(selAmt.value);
    const descIdx = parseInt(selDesc.value);
    const catId   = selCat.value ? parseInt(selCat.value) : null;
    const onlyNeg = onlyNegChk.checked;
    if (isNaN(dIdx) || dIdx < 0) { alert('Selecciona la columna de fecha'); return; }
    if (isNaN(aIdx) || aIdx < 0) { alert('Selecciona la columna de importe'); return; }

    let imported = 0;
    for (const row of dataRows) {
      const dateStr = parseImportDate(row[dIdx] || '');
      if (!dateStr) continue;
      const amtStr   = (row[aIdx] || '').replace(',', '.').replace(/[^\d.\-]/g, '');
      const amtFloat = parseFloat(amtStr);
      if (isNaN(amtFloat) || amtFloat === 0) continue;
      if (onlyNeg && amtFloat > 0) continue;
      const cents = Math.round(Math.abs(amtFloat) * 100);
      if (cents === 0) continue;
      const desc = descIdx >= 0 && !isNaN(descIdx) ? row[descIdx] || '' : '';
      const expense = { date: dateStr, amountCents: cents, description: desc, tags: [] };
      if (catId) expense.categoryId = catId;
      await DB.addExpense(expense);
      imported++;
    }
    importBtn.textContent = `✓ ${imported} gasto${imported !== 1 ? 's' : ''} importados`;
    importBtn.disabled = true;
    if (imported > 0) await reload();
  });
  mappingDiv.appendChild(importBtn);
  container.appendChild(mappingDiv);
}

function buildImportExportCard() {
  const card = el('div', { class: 'card' });
  card.style.maxWidth = '600px';
  card.style.margin = '24px auto 0';

  card.appendChild(el('h2', { class: 'card-title', text: 'Importar / Exportar' }));

  card.appendChild(el('div', { class: 'report-section-title', style: { marginBottom: '10px' }, text: 'Exportar' }));
  const exportRow = el('div', { class: 'ie-export-row' });
  exportRow.appendChild(el('button', { class: 'btn btn-ghost', text: '↑ Backup JSON',   onClick: exportJSON }));
  exportRow.appendChild(el('button', { class: 'btn btn-ghost', text: '↑ Gastos CSV (Excel)', onClick: exportCSV }));
  card.appendChild(exportRow);

  card.appendChild(el('hr', { class: 'divider' }));
  card.appendChild(el('div', { class: 'report-section-title', style: { marginBottom: '8px' }, text: 'Importar backup (JSON)' }));
  const jsonNote = el('p', { class: 'expense-meta', style: { marginBottom: '12px' } });
  jsonNote.textContent = 'Restaura un backup completo previamente exportado. Podrás elegir reemplazar todo o fusionar con los datos actuales.';
  card.appendChild(jsonNote);

  const jsonWrap = el('div', { class: 'ie-file-wrap' });
  const jsonId   = 'import-json-' + Date.now();
  const jsonInput = el('input', { type: 'file', accept: '.json,application/json', id: jsonId, class: 'ie-file-input' });
  const jsonLabel = el('label', { class: 'btn btn-ghost ie-file-label', html: '↓ Seleccionar JSON', for: jsonId });
  jsonWrap.appendChild(jsonInput);
  jsonWrap.appendChild(jsonLabel);
  card.appendChild(jsonWrap);

  const jsonPreviewArea = el('div', { class: 'import-preview-area' });
  card.appendChild(jsonPreviewArea);

  jsonInput.addEventListener('change', () => {
    const file = jsonInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => buildJSONImportPreview(e.target.result, jsonPreviewArea);
    reader.readAsText(file, 'utf-8');
  });

  card.appendChild(el('hr', { class: 'divider' }));
  card.appendChild(el('div', { class: 'report-section-title', style: { marginBottom: '8px' }, text: 'Importar extracto bancario (CSV)' }));
  const note = el('p', { class: 'expense-meta', style: { marginBottom: '12px' } });
  note.textContent = 'Exporta el extracto de tu banco como CSV. Podrás asignar las columnas antes de importar.';
  card.appendChild(note);

  const fileWrap = el('div', { class: 'ie-file-wrap' });
  const fileId   = 'import-file-' + Date.now();
  const fileInput = el('input', { type: 'file', accept: '.csv,.txt', id: fileId, class: 'ie-file-input' });
  const fileLabel = el('label', { class: 'btn btn-ghost ie-file-label', html: '↓ Seleccionar CSV', for: fileId });
  fileWrap.appendChild(fileInput);
  fileWrap.appendChild(fileLabel);
  card.appendChild(fileWrap);

  const previewArea = el('div', { class: 'import-preview-area' });
  card.appendChild(previewArea);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => buildImportPreview(e.target.result, previewArea);
    reader.readAsText(file, 'utf-8');
  });

  return card;
}

/* ================================================================
   Sidebar lateral
   ================================================================ */

const CHANGELOG = [
  {
    version: '1.10',
    date: 'Mayo 2026',
    items: [
      'Gastos recurrentes con mes de inicio y mes de fin opcional (vigencia limitada)',
      'Edición completa de recurrentes existentes desde un modal (nombre, importe, categoría, rango, anualizado) — botón lápiz visible en cada fila',
      'Etiqueta "Expirado" en rojo desaturado para recurrentes cuya vigencia ya pasó',
      'Recurrentes expirados aparecen al final de la lista y dejan de contar en informes y dashboard',
      'Cálculos de Informes ajustados: cada recurrente aporta solo a los meses en los que está vigente',
      'Proyección fin de mes movida al final de la vista Gastos',
    ],
  },
  {
    version: '1.9',
    date: 'Mayo 2026',
    items: [
      'Proyección de fin de mes en Gastos: estimación, barra de progreso y marca del día actual',
      'Nuevo informe — Coste fijo vs variable del año (recurrentes anualizados vs gasto puntual)',
      'Nuevo informe — Gasto por día de la semana con destacado de fin de semana',
      'Nuevo informe — Variación interanual (YoY) por categoría con resumen global',
    ],
  },
  {
    version: '1.8',
    date: 'Mayo 2026',
    items: [
      'Importación de backup JSON con dos modos: Reemplazar todo o Fusionar con datos actuales',
      'Reorganización de la navegación: tabs reducidas a Gastos · Ahorro · Calendario · Informes',
      'Recurrentes y Categorías movidos al menú lateral en sección Configuración',
      'Tabs en móvil rediseñadas con subrayado, fade en los bordes y auto-centrado al cambiar',
      'Tooltip estilizado al hacer hover en el mapa de calor (sustituye al tooltip nativo lento)',
      'Mapa de calor movido al final de Informes para no interrumpir las métricas principales',
      'Corregido bug en modo oscuro móvil que ocultaba el texto de la pestaña activa',
      'Parser CSV ahora maneja correctamente comillas escapadas ("") según el estándar',
      'Corregida la grafía de "prorratea" en el texto de gasto anualizado',
    ],
  },
  {
    version: '1.7',
    date: 'Mayo 2026',
    items: [
      'PWA instalable con service worker (uso offline tras primera carga)',
      'Nueva vista Calendario con desglose diario por intensidad',
      'Mapa de calor diario anual en Informes',
      'Botón flotante de añadir gasto rápido en móvil',
      'Informes calculados en Web Worker para datasets grandes',
      'requestIdleCallback para stats no críticas (uso de IndexedDB)',
    ],
  },
  {
    version: '1.6',
    date: 'Mayo 2026',
    items: [
      'Selector visual de mes con calendario y atajo "Mes actual"',
      'Diseño responsive completo para uso desde móvil',
      'Modal de novedades con uso detallado de IndexedDB',
      'Navegación completa desde el menú lateral',
      'Flechas direccionales correctas en importar/exportar',
      'Soporte para tecla Escape en sidebar y modales',
      'Corrección de bug en variables CSS del menú lateral',
    ],
  },
  {
    version: '1.5',
    date: 'Mayo 2026',
    items: [
      'Menú lateral con acceso a tema, datos y novedades',
      'Icono de Inversiones en el catálogo de categorías',
      'Diferencia de ahorro en el comparador de meses',
    ],
  },
  {
    version: '1.4',
    date: 'Mayo 2026',
    items: [
      'Importación de extracto bancario CSV con mapeo de columnas',
      'Exportación JSON y CSV',
      'Gastos compartidos y liquidación automática entre personas',
      'Etiquetas libres (#tag) con filtrado por tag',
      'Gráfico de evolución del patrimonio en Ahorro',
    ],
  },
  {
    version: '1.3',
    date: 'Mayo 2026',
    items: [
      'Tab Ahorro: ingresos mensuales, estadísticas y objetivo anual',
      'Informes — Comparar meses',
      'Informes — Ingresos y ahorro mensual',
    ],
  },
  {
    version: '1.2',
    date: 'Abril 2026',
    items: [
      'Sistema de iconos SVG monocromáticos',
      'Límites de gasto mensuales por categoría con banner de alerta',
      'Edición inline de categorías',
    ],
  },
  {
    version: '1.1',
    date: 'Abril 2026',
    items: [
      'Edición inline de gastos puntuales',
      'Tab Informes: tendencia anual, distribución, top gastos',
      'Bucket "Sin categoría" para gastos huérfanos',
      'Toggle de tema oscuro / claro',
    ],
  },
];

// Vistas de consulta (aparecen en la barra superior).
const MAIN_TABS = [
  { id: 'dashboard',  label: 'Gastos' },
  { id: 'savings',    label: 'Ahorro' },
  { id: 'calendar',   label: 'Calendario' },
  { id: 'reports',    label: 'Informes' },
];

// Vistas de configuración (solo accesibles desde el sidebar).
const CONFIG_TABS = [
  { id: 'recurring',  label: 'Recurrentes' },
  { id: 'categories', label: 'Categorías' },
];

const TAB_DEFS = [...MAIN_TABS, ...CONFIG_TABS];

function switchToTab(tabId) {
  state.view = tabId;
  let activeBtn = null;
  document.querySelectorAll('[data-tab]').forEach(b => {
    const isActive = b.dataset.tab === tabId;
    b.classList.toggle('active', isActive);
    if (isActive && b.closest('.tabs')) activeBtn = b;
  });
  // Centrar la pestaña activa en el strip scrollable (relevante en móvil)
  if (activeBtn) {
    const tabsEl = activeBtn.closest('.tabs');
    const target = activeBtn.offsetLeft + activeBtn.offsetWidth / 2 - tabsEl.clientWidth / 2;
    tabsEl.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }
  render();
}

function buildSidebar() {
  const body = document.getElementById('sidebar-body');
  if (!body) return;
  body.innerHTML = '';

  function navBtn(tab) {
    const btn = el('button', {
      class: `sidebar-action-btn${state.view === tab.id ? ' active' : ''}`,
    });
    btn.appendChild(el('span', { class: 'sidebar-action-arrow', text: state.view === tab.id ? '●' : '○' }));
    btn.appendChild(el('span', { text: tab.label }));
    btn.addEventListener('click', () => {
      closeSidebar();
      switchToTab(tab.id);
    });
    return btn;
  }

  // ---- Sección: Navegación (vistas de consulta) ----
  const secNav = el('div', { class: 'sidebar-section' });
  secNav.appendChild(el('div', { class: 'sidebar-section-title', text: 'Navegación' }));
  MAIN_TABS.forEach(tab => secNav.appendChild(navBtn(tab)));
  body.appendChild(secNav);

  // ---- Sección: Configuración ----
  const secConfig = el('div', { class: 'sidebar-section' });
  secConfig.appendChild(el('div', { class: 'sidebar-section-title', text: 'Configuración' }));
  CONFIG_TABS.forEach(tab => secConfig.appendChild(navBtn(tab)));
  body.appendChild(secConfig);

  // ---- Sección: Apariencia ----
  const secTheme = el('div', { class: 'sidebar-section' });
  secTheme.appendChild(el('div', { class: 'sidebar-section-title', text: 'Apariencia' }));

  const themeRow = el('div', { class: 'sidebar-row sidebar-theme-row' });
  themeRow.appendChild(el('span', { class: 'sidebar-row-label', text: 'Tema oscuro' }));
  const toggle = el('label', { class: 'sidebar-toggle' });
  const chk = el('input', { type: 'checkbox' });
  chk.checked = document.documentElement.getAttribute('data-theme') === 'dark';
  const slider = el('span', { class: 'sidebar-toggle-slider' });
  toggle.appendChild(chk);
  toggle.appendChild(slider);
  themeRow.appendChild(toggle);
  secTheme.appendChild(themeRow);

  chk.addEventListener('change', () => {
    const next = chk.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
  });

  body.appendChild(secTheme);

  // ---- Sección: Datos ----
  const secData = el('div', { class: 'sidebar-section' });
  secData.appendChild(el('div', { class: 'sidebar-section-title', text: 'Datos' }));

  function dataBtn(arrow, label, onClick) {
    const btn = el('button', { class: 'sidebar-action-btn' });
    btn.appendChild(el('span', { class: 'sidebar-action-arrow', text: arrow }));
    btn.appendChild(el('span', { text: label }));
    btn.addEventListener('click', onClick);
    return btn;
  }

  secData.appendChild(dataBtn('↑', 'Exportar backup JSON', () => { exportJSON(); closeSidebar(); }));
  secData.appendChild(dataBtn('↑', 'Exportar gastos CSV',  () => { exportCSV();  closeSidebar(); }));

  function openImportFile(selector) {
    closeSidebar();
    switchToTab('categories');
    setTimeout(() => {
      const lbl = document.querySelector(selector);
      if (lbl) {
        lbl.click();
        lbl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }

  secData.appendChild(dataBtn('↓', 'Importar backup JSON',
    () => openImportFile('label[for^="import-json-"]')));
  secData.appendChild(dataBtn('↓', 'Importar extracto CSV',
    () => openImportFile('label[for^="import-file-"]')));
  body.appendChild(secData);

  // ---- Sección: Información ----
  const secInfo = el('div', { class: 'sidebar-section' });
  secInfo.appendChild(el('div', { class: 'sidebar-section-title', text: 'Información' }));
  const btnCL = el('button', { class: 'sidebar-action-btn' });
  btnCL.appendChild(el('span', { class: 'sidebar-action-arrow', text: '✦' }));
  btnCL.appendChild(el('span', { text: 'Novedades y uso de datos' }));
  btnCL.addEventListener('click', () => { closeSidebar(); openChangelogModal(); });
  secInfo.appendChild(btnCL);
  body.appendChild(secInfo);
}

function openSidebar() {
  buildSidebar();
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

/* ================================================================
   Modal genérico + Modal de novedades
   ================================================================ */

function openModal(titleText, bodyBuilder) {
  document.getElementById('modal-title').textContent = titleText;
  const body = document.getElementById('modal-body');
  clear(body);
  bodyBuilder(body);
  document.getElementById('modal').classList.add('open');
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  document.getElementById('modal-overlay').classList.remove('open');
}

/** Estima el tamaño en bytes de los datos almacenados. */
function estimateDataBytes() {
  const payload = {
    categories: state.categories,
    expenses:   state.expenses,
    recurring:  state.recurring,
    income:     state.income,
    annualGoal: state.annualGoal,
    people:     state.people,
  };
  try {
    return new Blob([JSON.stringify(payload)]).size;
  } catch {
    return JSON.stringify(payload).length;
  }
}

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function openMonthPicker() {
  openModal('Selecciona mes', (body) => {
    // Estado local del picker (puede diferir del state hasta que se confirma)
    let pickerYear = state.year;

    const yearRow = el('div', { class: 'mp-year-row' });
    const yearPrev = el('button', { class: 'btn-nav', text: '‹', type: 'button' });
    const yearLabel = el('span', { class: 'mp-year-label' });
    const yearNext = el('button', { class: 'btn-nav', text: '›', type: 'button' });
    yearRow.appendChild(yearPrev);
    yearRow.appendChild(yearLabel);
    yearRow.appendChild(yearNext);
    body.appendChild(yearRow);

    const grid = el('div', { class: 'mp-grid' });
    body.appendChild(grid);

    function renderGrid() {
      yearLabel.textContent = pickerYear;
      clear(grid);
      for (let m = 1; m <= 12; m++) {
        const btn = el('button', {
          type: 'button',
          class: 'mp-month-btn',
          text: Utils.monthShort(m),
        });
        if (pickerYear === state.year && m === state.month) btn.classList.add('current');
        // Marcar meses que tienen datos
        const hasExpenses = state.expenses.some(e => Utils.isInMonth(e.date, pickerYear, m));
        const hasIncome   = state.income.some(i => i.id === `${pickerYear}-${String(m).padStart(2, '0')}`);
        if (hasExpenses || hasIncome) btn.classList.add('has-data');

        btn.addEventListener('click', () => {
          state.year = pickerYear;
          state.month = m;
          closeModal();
          render();
        });
        grid.appendChild(btn);
      }
    }

    yearPrev.addEventListener('click', () => { pickerYear--; renderGrid(); });
    yearNext.addEventListener('click', () => { pickerYear++; renderGrid(); });

    // Botón "Mes actual"
    const now = new Date();
    const todayY = now.getFullYear();
    const todayM = now.getMonth() + 1;
    if (state.year !== todayY || state.month !== todayM) {
      const todayBtn = el('button', {
        type: 'button',
        class: 'btn btn-ghost mp-today-btn',
        text: `Ir al mes actual (${Utils.monthName(todayM)} ${todayY})`,
      });
      todayBtn.addEventListener('click', () => {
        state.year = todayY;
        state.month = todayM;
        closeModal();
        render();
      });
      body.appendChild(todayBtn);
    }

    renderGrid();
  });
}

async function openChangelogModal() {
  openModal('Novedades y uso de datos', async (body) => {
    // ---- Bloque: uso de IndexedDB ----
    body.appendChild(el('div', { class: 'cl-section-title', text: 'Uso de IndexedDB' }));

    const totalRecords = state.categories.length + state.expenses.length
      + state.recurring.length + state.income.length;

    const grid = el('div', { class: 'db-stats-grid' });
    function dbStat(label, value) {
      const it = el('div', { class: 'db-stat-item' });
      it.appendChild(el('span', { class: 'db-stat-label', text: label }));
      it.appendChild(el('span', { class: 'db-stat-value', text: value }));
      return it;
    }
    grid.appendChild(dbStat('Categorías',        state.categories.length));
    grid.appendChild(dbStat('Gastos puntuales',  state.expenses.length));
    grid.appendChild(dbStat('Recurrentes',       state.recurring.length));
    grid.appendChild(dbStat('Meses con ingresos', state.income.length));
    grid.appendChild(dbStat('Personas',          state.people.length));
    grid.appendChild(dbStat('Total registros',   totalRecords));
    body.appendChild(grid);

    // Meta inicial vacía; se rellena en idle para no bloquear el modal
    const meta = el('div', { class: 'db-stats-meta', text: 'Calculando tamaño…' });
    body.appendChild(meta);
    const quotaMeta = el('div', { class: 'db-stats-meta' });
    body.appendChild(quotaMeta);

    onIdle(async () => {
      meta.textContent = `Tamaño estimado de los datos: ${fmtBytes(estimateDataBytes())}. Almacenados localmente en tu navegador (IndexedDB v${DB.version}).`;
      if (navigator.storage && navigator.storage.estimate) {
        try {
          const est = await navigator.storage.estimate();
          if (est && est.quota) {
            const used = est.usage || 0;
            const pct  = est.quota > 0 ? ((used / est.quota) * 100).toFixed(3) : '0';
            quotaMeta.textContent = `Cuota total del navegador: ${fmtBytes(est.quota)} · usado ${fmtBytes(used)} (${pct}%).`;
          }
        } catch { /* ignorar */ }
      }
    });

    // ---- Bloque: changelog ----
    body.appendChild(el('div', { class: 'cl-section-title', text: 'Historial de cambios' }));
    CHANGELOG.forEach(entry => {
      const block = el('div', { class: 'cl-block' });
      const hdr = el('div', { class: 'cl-header' });
      hdr.appendChild(el('span', { class: 'cl-version', text: `v${entry.version}` }));
      hdr.appendChild(el('span', { class: 'cl-date', text: entry.date }));
      block.appendChild(hdr);
      const ul = el('ul', { class: 'cl-list' });
      entry.items.forEach(item => ul.appendChild(el('li', { text: item })));
      block.appendChild(ul);
      body.appendChild(block);
    });
  });
}

/* ================================================================
   Reports — Wrapper con Web Worker (con fallback síncrono)
   ================================================================ */

let _reportsWorker = null;
let _workerSupported = null;

function getReportsWorker() {
  if (_workerSupported === false) return null;
  if (_reportsWorker) return _reportsWorker;
  try {
    _reportsWorker = new Worker('./js/workers/reports-worker.js');
    _workerSupported = true;
    return _reportsWorker;
  } catch {
    _workerSupported = false;
    return null;
  }
}

/** Calcula informes en worker si es posible; síncrono si no. */
function computeReportsAsync(year, refMonth) {
  const payload = {
    year,
    refMonth,
    expenses:   state.expenses,
    recurring:  state.recurring,
    categories: state.categories,
  };

  // Heurística: solo usar worker si el dataset es razonablemente grande
  const useWorker = state.expenses.length > 80 && getReportsWorker();

  if (useWorker) {
    return new Promise((resolve) => {
      const w = getReportsWorker();
      const handler = (e) => {
        w.removeEventListener('message', handler);
        if (e.data && e.data.ok) resolve(e.data.result);
        else resolve(computeReportsSync(payload));
      };
      w.addEventListener('message', handler);
      w.postMessage(payload);
    });
  }
  return Promise.resolve(computeReportsSync(payload));
}

/** Versión síncrona (misma lógica que el worker, inline). */
function computeReportsSync(payload) {
  const { year, refMonth, expenses, recurring, categories } = payload;
  const trend = [];
  let yy = year, mm = refMonth;
  for (let i = 0; i < 12; i++) {
    trend.unshift({ year: yy, month: mm, ...computeMonthTotal(yy, mm) });
    if (mm === 1) { mm = 12; yy--; } else mm--;
  }
  const yearTrend = trend.filter((t) => t.year === year);
  const yearTotal = yearTrend.reduce((s, t) => s + t.total, 0);
  const yearAvg = yearTrend.length ? Math.round(yearTotal / yearTrend.length) : 0;
  const yearBest = yearTrend.length
    ? yearTrend.reduce((min, t) => (t.total < min.total ? t : min))
    : null;
  const yearWorst = yearTrend.length
    ? yearTrend.reduce((max, t) => (t.total > max.total ? t : max))
    : null;
  const yearExpenses = expenses
    .filter((e) => e.date && e.date.startsWith(String(year)))
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 8);
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

  // Heatmap diario
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
  // Cada recurrente aporta (importe mensualizado × meses_activos_en_año)
  const fixedYearly = recurring.reduce((s, r) => {
    const months = recurringMonthsInYear(r, year);
    if (months === 0) return s;
    const monthly = r.annual ? Math.round(r.amountCents / 12) : r.amountCents;
    return s + monthly * months;
  }, 0);
  const variableYearly = expenses
    .filter((e) => e.date && e.date.startsWith(String(year)))
    .reduce((s, e) => s + e.amountCents, 0);

  // Gasto por día de la semana (0=Lun, 6=Dom)
  const byDow = [0, 0, 0, 0, 0, 0, 0];
  expenses.forEach((e) => {
    if (!e.date || !e.date.startsWith(String(year))) return;
    const d = new Date(e.date + 'T12:00:00');
    if (isNaN(d.getTime())) return;
    const dow = (d.getDay() + 6) % 7;
    byDow[dow] += e.amountCents;
  });

  // Inflación YoY por categoría
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
      if (a.pct === null && b.pct === null) return b.current - a.current;
      if (a.pct === null) return 1;
      if (b.pct === null) return -1;
      return Math.abs(b.pct) - Math.abs(a.pct);
    });

  return { trend, yearTotal, yearAvg, yearBest, yearWorst,
           yearExpenses, catYearList, catYearTotal, heatmap, heatmapMax,
           fixedYearly, variableYearly, byDow, yoyList, prevYear };
}

/* ================================================================
   Vista: Calendario mensual
   ================================================================ */

function renderCalendar(container) {
  const { year, month } = state;
  const monthExpenses = state.expenses.filter((e) => isInMonth(e.date, year, month));
  const daysInMonth = new Date(year, month, 0).getDate();
  // Día de la semana del primer día (0=Dom, 1=Lun…); ajustar a lunes=0
  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;

  // Agrupar gastos por día
  const byDay = {};
  monthExpenses.forEach((e) => {
    const d = parseInt(e.date.slice(8, 10), 10);
    if (!byDay[d]) byDay[d] = { total: 0, items: [] };
    byDay[d].total += e.amountCents;
    byDay[d].items.push(e);
  });

  const maxDayTotal = Math.max(...Object.values(byDay).map((d) => d.total), 1);

  const title = el('h2', { class: 'card-title', style: { marginBottom: '16px' } });
  title.innerHTML = `Calendario &mdash; ${monthName(month)} ${year}`;
  container.appendChild(title);

  const card = el('div', { class: 'card calendar-card' });

  // Leyenda
  const legend = el('div', { class: 'cal-legend' });
  legend.appendChild(el('span', { class: 'cal-legend-label', text: 'Intensidad de gasto:' }));
  for (let i = 0; i < 5; i++) {
    const sq = el('span', { class: 'cal-legend-sq' });
    sq.style.opacity = (0.15 + i * 0.21).toFixed(2);
    legend.appendChild(sq);
  }
  legend.appendChild(el('span', { class: 'cal-legend-end', text: 'más' }));
  card.appendChild(legend);

  // Cabecera con días de la semana
  const grid = el('div', { class: 'cal-grid' });
  ['L', 'M', 'X', 'J', 'V', 'S', 'D'].forEach((d) => {
    grid.appendChild(el('div', { class: 'cal-dow', text: d }));
  });

  // Huecos previos
  for (let i = 0; i < firstDow; i++) {
    grid.appendChild(el('div', { class: 'cal-cell cal-cell-empty' }));
  }

  // Días del mes
  const today = new Date();
  const isThisMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const todayDay = today.getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const data = byDay[d];
    const cell = el('button', { type: 'button', class: 'cal-cell' });
    if (isThisMonth && d === todayDay) cell.classList.add('cal-cell-today');

    if (data) {
      const intensity = Math.min(1, data.total / maxDayTotal);
      cell.classList.add('cal-cell-has');
      cell.style.setProperty('--cal-intensity', intensity.toFixed(2));
    }

    cell.appendChild(el('span', { class: 'cal-day-num', text: d }));
    if (data) {
      cell.appendChild(el('span', { class: 'cal-day-amt', text: fmtEUR(data.total) }));
    }

    cell.addEventListener('click', () => openDayDetail(year, month, d, data));
    grid.appendChild(cell);
  }

  card.appendChild(grid);

  // Resumen mensual
  const total = monthExpenses.reduce((s, e) => s + e.amountCents, 0);
  const daysWith = Object.keys(byDay).length;
  const summary = el('div', { class: 'cal-summary' });
  summary.appendChild(el('div', { class: 'cal-summary-item' },
    el('span', { class: 'cal-summary-label', text: 'Total puntuales' }),
    el('span', { class: 'cal-summary-value mono', text: fmtEUR(total) }),
  ));
  summary.appendChild(el('div', { class: 'cal-summary-item' },
    el('span', { class: 'cal-summary-label', text: 'Días con gasto' }),
    el('span', { class: 'cal-summary-value mono', text: `${daysWith} / ${daysInMonth}` }),
  ));
  summary.appendChild(el('div', { class: 'cal-summary-item' },
    el('span', { class: 'cal-summary-label', text: 'Media por día gastado' }),
    el('span', { class: 'cal-summary-value mono',
      text: daysWith > 0 ? fmtEUR(Math.round(total / daysWith)) : '—' }),
  ));
  card.appendChild(summary);

  container.appendChild(card);
}

function openDayDetail(year, month, day, data) {
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const titleStr = `${Utils.fmtDate(isoDate)}`;
  openModal(titleStr, (body) => {
    if (!data || data.items.length === 0) {
      body.appendChild(el('div', { class: 'empty-state', text: 'Sin gastos este día' }));
      const addBtn = el('button', {
        class: 'btn btn-primary', text: 'Añadir gasto',
        style: { marginTop: '12px', width: '100%' },
      });
      addBtn.addEventListener('click', () => { closeModal(); openQuickAdd(isoDate); });
      body.appendChild(addBtn);
      return;
    }

    const list = el('div', { class: 'day-detail-list' });
    [...data.items].sort((a, b) => b.amountCents - a.amountCents).forEach((e) => {
      const cat = state.categories.find((c) => c.id === e.categoryId);
      const row = el('div', { class: 'day-detail-row' });
      row.appendChild(el('span', { class: 'dot', style: { backgroundColor: cat?.color || '#999' } }));
      const info = el('div', { class: 'day-detail-info' });
      const descSpan = el('span', { class: 'day-detail-desc' });
      appendIconText(descSpan, cat?.icon, e.description || cat?.name || 'Gasto', 13);
      info.appendChild(descSpan);
      const meta = el('span', { class: 'day-detail-meta' });
      meta.textContent = cat?.name || 'Sin categoría';
      if (e.paidBy) meta.textContent += ` · Pagó ${e.paidBy}`;
      info.appendChild(meta);
      row.appendChild(info);
      row.appendChild(el('span', { class: 'day-detail-amount mono', text: fmtEUR(e.amountCents) }));
      list.appendChild(row);
    });
    body.appendChild(list);

    const total = data.items.reduce((s, e) => s + e.amountCents, 0);
    const totalRow = el('div', { class: 'day-detail-total' },
      el('span', { text: 'Total del día' }),
      el('span', { class: 'mono', text: fmtEUR(total) }),
    );
    body.appendChild(totalRow);

    const addBtn = el('button', {
      class: 'btn btn-ghost', text: '+ Añadir gasto en este día',
      style: { marginTop: '14px', width: '100%' },
    });
    addBtn.addEventListener('click', () => { closeModal(); openQuickAdd(isoDate); });
    body.appendChild(addBtn);
  });
}

/* ================================================================
   Heatmap anual (usado en Informes)
   ================================================================ */

function buildHeatmapCard(heatmap, heatmapMax, year) {
  const card = el('div', { class: 'card heatmap-card' });
  card.appendChild(el('div', { class: 'report-section-title', text: `Mapa de calor diario ${year}` }));

  if (heatmapMax === 0) {
    card.appendChild(el('div', { class: 'empty-state', text: 'Sin gastos puntuales este año' }));
    return card;
  }

  const wrap = el('div', { class: 'heatmap-wrap' });
  // Tooltip único compartido para todas las celdas (se reposiciona en hover)
  const tooltip = el('div', { class: 'heatmap-tooltip' });
  wrap.appendChild(tooltip);

  function showTooltip(cell, label) {
    tooltip.textContent = label;
    tooltip.style.left = (cell.offsetLeft + cell.offsetWidth / 2) + 'px';
    tooltip.style.top  = (cell.offsetTop - 6) + 'px';
    tooltip.classList.add('visible');
  }
  function hideTooltip() {
    tooltip.classList.remove('visible');
  }

  // Cabecera con números de día (1..31)
  const headerRow = el('div', { class: 'heatmap-row heatmap-header' });
  headerRow.appendChild(el('span', { class: 'heatmap-month-label' }));
  for (let d = 1; d <= 31; d++) {
    headerRow.appendChild(el('span', {
      class: 'heatmap-day-num',
      text: d % 5 === 0 || d === 1 ? String(d) : '',
    }));
  }
  wrap.appendChild(headerRow);

  // Una fila por mes
  for (let mo = 0; mo < 12; mo++) {
    const daysInMonth = new Date(year, mo + 1, 0).getDate();
    const row = el('div', { class: 'heatmap-row' });
    row.appendChild(el('span', { class: 'heatmap-month-label', text: Utils.monthShort(mo + 1) }));
    for (let d = 0; d < 31; d++) {
      if (d >= daysInMonth) {
        row.appendChild(el('span', { class: 'heatmap-cell heatmap-cell-empty' }));
        continue;
      }
      const val = heatmap[mo][d];
      const cell = el('span', { class: 'heatmap-cell' });
      if (val > 0) {
        const intensity = Math.max(0.12, Math.min(1, val / heatmapMax));
        cell.style.setProperty('--hm-intensity', intensity.toFixed(2));
        cell.classList.add('has-data');
        const label = `${Utils.monthShort(mo + 1)} ${d + 1} — ${fmtEUR(val)}`;
        cell.addEventListener('pointerenter', () => showTooltip(cell, label));
        cell.addEventListener('pointerleave', hideTooltip);
      }
      row.appendChild(cell);
    }
    wrap.appendChild(row);
  }

  // Scroll horizontal en móvil
  const scroller = el('div', { class: 'heatmap-scroller' });
  scroller.appendChild(wrap);
  // Si el scroll cambia, ocultamos el tooltip (su posición quedaría desfasada)
  scroller.addEventListener('scroll', hideTooltip, { passive: true });
  card.appendChild(scroller);

  return card;
}

/* ----- Coste fijo vs variable ----- */
function buildFixedVariableCard(fixedYearly, variableYearly, year) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'report-section-title', text: `Fijo vs variable ${year}` }));

  const total = fixedYearly + variableYearly;
  if (total === 0) {
    card.appendChild(el('div', { class: 'empty-state', text: 'Sin datos suficientes' }));
    return card;
  }

  const fixedPct = (fixedYearly / total) * 100;
  const varPct   = 100 - fixedPct;

  // Barra apilada horizontal
  const bar = el('div', { class: 'fv-bar' });
  const segFixed = el('div', { class: 'fv-bar-fixed',    style: { width: `${fixedPct.toFixed(1)}%` } });
  const segVar   = el('div', { class: 'fv-bar-variable', style: { width: `${varPct.toFixed(1)}%` } });
  bar.appendChild(segFixed);
  bar.appendChild(segVar);
  card.appendChild(bar);

  // Leyenda con dos filas
  const legend = el('div', { class: 'fv-legend' });

  function fvRow(cls, label, value, pct, hint) {
    const row = el('div', { class: 'fv-legend-row' });
    row.appendChild(el('span', { class: `fv-dot ${cls}` }));
    row.appendChild(el('span', { class: 'fv-label', text: label }));
    row.appendChild(el('span', { class: 'fv-pct mono', text: `${pct.toFixed(0)}%` }));
    row.appendChild(el('span', { class: 'fv-value mono', text: fmtEUR(value) }));
    if (hint) row.appendChild(el('span', { class: 'fv-hint expense-meta', text: hint }));
    return row;
  }
  legend.appendChild(fvRow('fv-dot-fixed', 'Fijo (recurrentes anualizados)',  fixedYearly, fixedPct,
    `${fmtEUR(Math.round(fixedYearly / 12))} /mes`));
  legend.appendChild(fvRow('fv-dot-variable', 'Variable (gastos puntuales)', variableYearly, varPct,
    `${fmtEUR(Math.round(variableYearly / 12))} /mes promedio`));
  card.appendChild(legend);

  return card;
}

/* ----- Gasto por día de la semana ----- */
function buildDayOfWeekCard(byDow, year) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'report-section-title', text: `Día de la semana ${year}` }));

  const total = byDow.reduce((s, v) => s + v, 0);
  if (total === 0) {
    card.appendChild(el('div', { class: 'empty-state', text: 'Sin gastos puntuales este año' }));
    return card;
  }
  const maxVal = Math.max(...byDow);
  const labels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  const list = el('div', { class: 'dow-list' });
  byDow.forEach((val, i) => {
    const pct = total > 0 ? (val / total) * 100 : 0;
    const barWidth = maxVal > 0 ? (val / maxVal) * 100 : 0;
    const row = el('div', { class: `dow-row${i >= 5 ? ' dow-weekend' : ''}` });
    row.appendChild(el('span', { class: 'dow-label', text: labels[i] }));
    const barWrap = el('div', { class: 'dow-bar-wrap' });
    barWrap.appendChild(el('div', { class: 'dow-bar', style: { width: `${barWidth.toFixed(1)}%` } }));
    row.appendChild(barWrap);
    row.appendChild(el('span', { class: 'dow-amount mono', text: fmtEUR(val) }));
    row.appendChild(el('span', { class: 'dow-pct', text: `${pct.toFixed(0)}%` }));
    list.appendChild(row);
  });
  card.appendChild(list);

  // Insight: cuánto cae en finde
  const weekendTotal = byDow[5] + byDow[6];
  const weekendPct = (weekendTotal / total) * 100;
  card.appendChild(el('p', { class: 'expense-meta',
    style: { marginTop: '10px' },
    text: `${weekendPct.toFixed(0)}% del gasto cae en fin de semana (${fmtEUR(weekendTotal)})`,
  }));

  return card;
}

/* ----- Inflación YoY por categoría ----- */
function buildYoYCard(yoyList, year, prevYear) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'report-section-title', text: `Variación vs ${prevYear}` }));

  if (yoyList.length === 0) {
    card.appendChild(el('div', { class: 'empty-state', text: 'Sin datos de comparación' }));
    return card;
  }
  const comparable = yoyList.filter(c => c.pct !== null);
  if (comparable.length === 0) {
    card.appendChild(el('div', { class: 'empty-state',
      text: `No hay categorías con gastos en ${prevYear} para comparar` }));
    return card;
  }

  const list = el('div', { class: 'yoy-list' });
  comparable.slice(0, 8).forEach((c) => {
    const row = el('div', { class: 'yoy-row' });
    const nameWrap = el('div', { class: 'yoy-name' });
    nameWrap.appendChild(el('span', { class: 'dot', style: { backgroundColor: c.color } }));
    const nameSpan = el('span');
    appendIconText(nameSpan, c.icon, c.name, 12);
    nameWrap.appendChild(nameSpan);
    row.appendChild(nameWrap);

    const compare = el('div', { class: 'yoy-compare mono' });
    compare.appendChild(el('span', { class: 'yoy-prev', text: fmtEUR(c.previous) }));
    compare.appendChild(el('span', { class: 'yoy-arrow', text: '→' }));
    compare.appendChild(el('span', { class: 'yoy-curr', text: fmtEUR(c.current) }));
    row.appendChild(compare);

    const pct = c.pct;
    const sign = pct >= 0 ? '+' : '';
    const pctCls = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
    row.appendChild(el('span', {
      class: `yoy-pct ${pctCls}`,
      text: `${sign}${pct.toFixed(0)}%`,
    }));
    list.appendChild(row);
  });
  card.appendChild(list);

  // Resumen agregado
  const sumCurrent  = comparable.reduce((s, c) => s + c.current, 0);
  const sumPrevious = comparable.reduce((s, c) => s + c.previous, 0);
  if (sumPrevious > 0) {
    const globalPct = ((sumCurrent - sumPrevious) / sumPrevious) * 100;
    card.appendChild(el('p', {
      class: 'expense-meta',
      style: { marginTop: '10px' },
      text: `Variación global comparable: ${globalPct >= 0 ? '+' : ''}${globalPct.toFixed(1)}% (${fmtEUR(sumPrevious)} → ${fmtEUR(sumCurrent)})`,
    }));
  }

  return card;
}

/* ================================================================
   Quick-add — Modal mini para añadir gasto rápido
   ================================================================ */

function openQuickAdd(dateOverride) {
  const lastCatId = parseInt(localStorage.getItem('lastQuickCat')) || null;

  openModal('Añadir gasto', (body) => {
    const form = el('form', { class: 'quick-add-form' });

    // Importe (grande)
    const amtWrap = el('div', { class: 'qa-amount-wrap' });
    const amtInput = el('input', {
      type: 'text', inputmode: 'decimal',
      class: 'form-input mono qa-amount-input',
      placeholder: '0,00', autocomplete: 'off',
    });
    amtWrap.appendChild(amtInput);
    amtWrap.appendChild(el('span', { class: 'qa-amount-currency', text: '€' }));
    form.appendChild(amtWrap);

    // Categoría como grid de botones
    form.appendChild(el('label', { class: 'form-label', text: 'Categoría' }));
    const catGrid = el('div', { class: 'qa-cat-grid' });
    let selectedCatId = lastCatId && state.categories.some((c) => c.id === lastCatId)
      ? lastCatId : null;
    state.categories.forEach((c) => {
      const btn = el('button', {
        type: 'button',
        class: 'qa-cat-btn',
        title: c.name,
      });
      btn.dataset.id = c.id;
      btn.style.borderColor = c.color;
      const ico = el('span', { class: 'qa-cat-ico' });
      ico.style.color = c.color;
      ico.innerHTML = Icons.svg(c.icon, 18);
      btn.appendChild(ico);
      btn.appendChild(el('span', { class: 'qa-cat-name', text: c.name }));
      if (c.id === selectedCatId) btn.classList.add('selected');
      btn.addEventListener('click', () => {
        catGrid.querySelectorAll('.qa-cat-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedCatId = c.id;
      });
      catGrid.appendChild(btn);
    });
    form.appendChild(catGrid);

    // Descripción opcional
    form.appendChild(el('label', { class: 'form-label', text: 'Descripción (opcional)' }));
    const descInput = el('input', {
      type: 'text', class: 'form-input',
      placeholder: 'p.ej. Mercadona',
    });
    form.appendChild(descInput);

    // Fecha (con override si se pasa)
    form.appendChild(el('label', { class: 'form-label', text: 'Fecha' }));
    const dateInput = el('input', {
      type: 'date', class: 'form-input',
      value: dateOverride || today(),
    });
    form.appendChild(dateInput);

    // Botón guardar
    const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary qa-submit', text: 'Guardar' });
    form.appendChild(submitBtn);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cents = eurToCents(amtInput.value);
      if (!cents) { amtInput.focus(); return; }
      if (!selectedCatId) {
        catGrid.classList.add('shake');
        setTimeout(() => catGrid.classList.remove('shake'), 400);
        return;
      }
      await DB.addExpense({
        date: dateInput.value || today(),
        amountCents: cents,
        description: descInput.value.trim(),
        categoryId: selectedCatId,
        tags: [],
        paidBy: null,
      });
      localStorage.setItem('lastQuickCat', String(selectedCatId));
      closeModal();
      await reload();
    });

    body.appendChild(form);
    // Focus al importe tras la animación de apertura
    setTimeout(() => amtInput.focus(), 200);
  });
}
