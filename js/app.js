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
  tagFilter: null,
  view: 'dashboard',
  // Set de recurringInstanceKey ya materializadas. Se reconstruye en cada reload
  // y es consultado por getPendingForPeriod() y otros helpers en O(1).
  materializedKeys: new Set(),
  // Día (1-28) en el que empieza el mes contable. 1 = mes natural (default).
  // El mes contable lleva el nombre del mes en que TERMINA (convención bancaria):
  // payrollDay=25 → "Mayo 2026" = 25-abril → 24-mayo.
  payrollDay: 1,
};

/* ================================================================
   Inicialización
   ================================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  await DB.open();
  await DB.seedCategories();
  await materializeRecurrings();
  await reload();
  bindGlobalEvents();
});

async function reload() {
  [state.categories, state.expenses, state.recurring, state.income] = await Promise.all([
    DB.getCategories(), DB.getExpenses(), DB.getRecurring(), DB.getAllIncome(),
  ]);
  const [goalEntry, payrollEntry] = await Promise.all([
    DB.getSetting('annual-goal'),
    DB.getSetting('payroll-day'),
  ]);
  state.annualGoal = goalEntry?.value || 0;
  const pd = payrollEntry?.value;
  state.payrollDay = (typeof pd === 'number' && pd >= 1 && pd <= 28) ? pd : 1;
  // Reconstruye el set de instanceKeys materializadas (consultado en getPendingForPeriod).
  state.materializedKeys = new Set();
  for (const e of state.expenses) {
    if (e.recurringInstanceKey) state.materializedKeys.add(e.recurringInstanceKey);
  }
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

/** 'YYYY-MM' del mes contable real en curso (depende de state.payrollDay). */
function currentYmKey() {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return accountingMonth(iso, state.payrollDay);
}

/* ---- Helpers de mes contable ----
 *
 * payrollDay = 1 → mes contable = mes natural (default).
 * payrollDay ∈ [2..28] → el mes contable empieza ese día del mes natural anterior
 * y termina el día (payrollDay-1) del mes natural homónimo.
 *
 * Ejemplo payrollDay=25:
 *   "Mayo 2026"  = 25-abril-2026 → 24-mayo-2026
 *   "Junio 2026" = 25-mayo-2026  → 24-junio-2026
 *
 * Se nombra por el mes en que TERMINA (convención bancaria). */

/** Devuelve el 'YYYY-MM' del mes contable al que pertenece una fecha ISO. */
function accountingMonth(isoDate, payrollDay = 1) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const y = parseInt(isoDate.slice(0, 4), 10);
  const m = parseInt(isoDate.slice(5, 7), 10);
  const d = parseInt(isoDate.slice(8, 10), 10);
  if (!payrollDay || payrollDay <= 1) return `${y}-${String(m).padStart(2,'0')}`;
  // Si el día es >= payrollDay, la fecha pertenece al periodo que TERMINA el mes siguiente.
  if (d >= payrollDay) {
    if (m === 12) return `${y + 1}-01`;
    return `${y}-${String(m + 1).padStart(2,'0')}`;
  }
  return `${y}-${String(m).padStart(2,'0')}`;
}

/** Rango ISO [startDate, endDate] del mes contable nombrado (year, month). */
function monthBounds(year, month, payrollDay = 1) {
  if (!payrollDay || payrollDay <= 1) {
    const lastDay = new Date(year, month, 0).getDate();
    return [
      `${year}-${String(month).padStart(2,'0')}-01`,
      `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`,
    ];
  }
  let sy = year, sm = month - 1;
  if (sm === 0) { sm = 12; sy = year - 1; }
  const startISO = `${sy}-${String(sm).padStart(2,'0')}-${String(payrollDay).padStart(2,'0')}`;
  const endISO   = `${year}-${String(month).padStart(2,'0')}-${String(payrollDay - 1).padStart(2,'0')}`;
  return [startISO, endISO];
}

/** ¿La fecha ISO cae dentro del mes contable (year, month)? */
function isInAccountingMonth(isoDate, year, month, payrollDay = 1) {
  if (!isoDate) return false;
  return accountingMonth(isoDate, payrollDay) === ymKey(year, month);
}

/** ¿La fecha ISO cae dentro del año contable (los 12 meses contables de ese year)? */
function isInAccountingYear(isoDate, year, payrollDay = 1) {
  if (!isoDate) return false;
  const ym = accountingMonth(isoDate, payrollDay);
  return ym != null && ym.startsWith(String(year));
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

/** Último día válido del (year, month). Mes 1-12. */
function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** Día efectivo de cobro en (year, month) dado un paymentDay deseado.
 *  Si paymentDay > último día disponible (29/30/31 en febrero, 31 en abril...),
 *  cae al último día del mes. */
function effectiveDay(paymentDay, year, month) {
  return Math.min(paymentDay || 1, lastDayOfMonth(year, month));
}

/** Clave única de instancia: 'YYYY-MM-<recurringId>'. Usada para idempotencia.
 *  Para recurrentes 'annual' (one-shot) el MM es el paymentMonth, lo que garantiza
 *  una sola materialización por año (solo se ejecuta en su mes). */
function buildInstanceKey(year, month, recurringId) {
  return `${ymKey(year, month)}-${recurringId}`;
}

/** Devuelve la frecuencia normalizada: 'monthly' | 'annualized' | 'annual'.
 *  Fallback para registros pre-v4 que solo tenían el bool annual. */
function getFrequency(r) {
  if (r.frequency) return r.frequency;
  return r.annual ? 'annualized' : 'monthly';
}

/** ¿El recurrente ya tiene un gasto materializado en (year, month)?
 *  Si lo tiene, la proyección NO debe sumarse para no duplicar.
 *  O(1) gracias al Set state.materializedKeys que se reconstruye en reload(). */
function hasMaterializedExpense(recurringId, year, month) {
  return state.materializedKeys.has(buildInstanceKey(year, month, recurringId));
}

/** Devuelve los recurrentes que aún tienen una materialización pendiente
 *  dentro del rango del mes contable (year, month). Cada entrada incluye la
 *  fecha esperada, el importe que se aplicaría y una referencia al recurrente.
 *  Read-only: se materializa cuando llega el día (en boot o tras editar). */
function getPendingForPeriod(year, month) {
  const payrollDay = state.payrollDay || 1;
  const [periodStart, periodEnd] = monthBounds(year, month, payrollDay);
  const out = [];

  // Calendar months que se solapan con el periodo contable (siempre 1 o 2).
  const overlapped = new Set();
  overlapped.add(periodStart.slice(0, 7));
  overlapped.add(periodEnd.slice(0, 7));

  for (const r of state.recurring) {
    if (!r.active) continue;
    if (!r.paymentDay) continue;
    const freq = getFrequency(r);

    if (freq === 'annual') {
      if (!r.paymentMonth) continue;
      // Para anual one-shot, buscamos en los años del rango (suelen ser 1).
      const years = new Set([periodStart.slice(0, 4), periodEnd.slice(0, 4)]);
      for (const yStr of years) {
        const y = parseInt(yStr, 10);
        if (!isRecurringActiveIn(r, y, r.paymentMonth)) continue;
        const day = effectiveDay(r.paymentDay, y, r.paymentMonth);
        const dateStr = `${y}-${String(r.paymentMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        if (dateStr < periodStart || dateStr > periodEnd) continue;
        if (hasMaterializedExpense(r.id, y, r.paymentMonth)) continue;
        out.push({ recurring: r, date: dateStr, amountCents: materializationAmount(r), freq });
      }
      continue;
    }

    // monthly / annualized: una materialización por mes natural.
    for (const ym of overlapped) {
      const [yStr, mStr] = ym.split('-');
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);
      if (!isRecurringActiveIn(r, y, m)) continue;
      const day = effectiveDay(r.paymentDay, y, m);
      const dateStr = `${ym}-${String(day).padStart(2,'0')}`;
      if (dateStr < periodStart || dateStr > periodEnd) continue;
      if (hasMaterializedExpense(r.id, y, m)) continue;
      out.push({ recurring: r, date: dateStr, amountCents: materializationAmount(r), freq });
    }
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/* ================================================================
   Materialización de recurrentes
   ================================================================ */

/** Importe de una materialización individual según la frecuencia.
 *    - monthly:    el importe íntegro (es lo que se paga cada mes)
 *    - annualized: importe/12 (el total anual se reparte en 12 cuotas mensuales)
 *    - annual:     el importe íntegro (un único pago al año) */
function materializationAmount(r) {
  if (getFrequency(r) === 'annualized') {
    return Math.round(r.amountCents / 12);
  }
  return r.amountCents;
}

/** Materialización con ventana de lookback de 3 meses.
 *  En cada boot/edición, recorre los meses [actual-2, actual-1, actual] y, para
 *  cada recurrente activo, crea el gasto si corresponde:
 *    - monthly:    cada mes en su paymentDay (o último día disponible)
 *    - annualized: igual que monthly pero con importe/12
 *    - annual:     solo en su paymentMonth, en su paymentDay
 *  La idempotencia (recurringInstanceKey) garantiza que no se duplica.
 *
 *  Notas:
 *  - Si el usuario borra manualmente un gasto materializado, puede re-crearse
 *    dentro de la ventana de 3 meses. Para saltar un mes, pausar el recurrente
 *    o usar el rango hasta/desde son las vías actuales.
 *  - Para meses dentro de la ventana pero futuros respecto a hoy, solo se
 *    materializa si el día efectivo ya pasó (lo que solo puede ocurrir en el
 *    mes actual; meses pasados completos se materializan siempre). */
async function materializeRecurrings() {
  const now = new Date();
  const todayDay = now.getDate();
  const curYear  = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  // Ventana: 3 meses (actual + 2 anteriores).
  const window = [];
  for (let i = 2; i >= 0; i--) {
    let yy = curYear, mm = curMonth - i;
    while (mm <= 0) { mm += 12; yy--; }
    window.push({ year: yy, month: mm });
  }

  const recurrings = await DB.getRecurring();

  for (const { year, month } of window) {
    const isCurrentMonth = (year === curYear && month === curMonth);
    for (const r of recurrings) {
      if (!r.active) continue;
      if (!r.paymentDay) continue;
      const freq = getFrequency(r);
      if (!isRecurringActiveIn(r, year, month)) continue;
      // Anual one-shot: solo se materializa en su paymentMonth.
      if (freq === 'annual' && month !== r.paymentMonth) continue;

      const day = effectiveDay(r.paymentDay, year, month);
      if (isCurrentMonth && todayDay < day) continue;

      const instanceKey = buildInstanceKey(year, month, r.id);
      if (await DB.hasExpenseByInstanceKey(instanceKey)) continue;

      const dateStr = `${ymKey(year, month)}-${String(day).padStart(2, '0')}`;
      await DB.addExpense({
        date: dateStr,
        amountCents: materializationAmount(r),
        description: r.name,
        categoryId: r.categoryId,
        tags: [],
        sourceRecurringId: r.id,
        recurringInstanceKey: instanceKey,
      });
    }
  }
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
    exportedAt: new Date().toISOString(),
    version: 1,
  };
  downloadFile(JSON.stringify(data, null, 2), 'gastos-backup.json', 'application/json');
}

function exportCSV() {
  const header = ['Fecha', 'Importe (€)', 'Categoría', 'Descripción', 'Etiquetas'];
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
    // Recurrentes: garantizar paymentDay y frequency para backups antiguos.
    for (const r of backup.recurring  || []) {
      const rr = { ...r };
      if (rr.paymentDay == null) rr.paymentDay = 1;
      if (!rr.frequency) rr.frequency = rr.annual ? 'annualized' : 'monthly';
      await DB.putRecurring(rr);
    }
    for (const inc of backup.income   || []) await DB.putIncome(inc);
    await DB.setSetting('annual-goal', backup.annualGoal || 0);
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
    const { id, sourceRecurringId, recurringInstanceKey, ...rest } = e;
    // Stripamos vínculos a recurrentes: en merge, los IDs de recurrentes
    // se reasignan y los keys antiguos quedarían huérfanos (o peor, chocarían
    // con los nuevos materializados). El gasto se conserva pero "desvinculado".
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
    if (rest.paymentDay == null) rest.paymentDay = 1; // default para backups v2
    if (!rest.frequency) rest.frequency = rest.annual ? 'annualized' : 'monthly';
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
    case 'accounting': renderAccountingMonth(main); break;
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
  const exp = state.expenses.filter(e => isInAccountingMonth(e.date, year, month, state.payrollDay));
  const total = exp.reduce((s, e) => s + e.amountCents, 0);
  // Solo gasto REAL. Las proyecciones (recurrentes no materializados aún) se
  // muestran en el bloque "Pendiente del mes contable" y en la card Proyección
  // fin de mes, pero NO se suman al total real.
  return { total, expCount: exp.length };
}

function getMonthIncome(year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const entry = state.income.find(i => i.id === key);
  return entry ? entry.amountCents : 0;
}

function computeCatBreakdown(year, month) {
  const exp = state.expenses.filter(e => isInAccountingMonth(e.date, year, month, state.payrollDay));
  const byCat = {};
  state.categories.forEach(c => { byCat[c.id] = { ...c, totalCents: 0 }; });
  let uncatTotal = 0;
  // Solo gastos reales del periodo (los materializados de recurrente ya están aquí).
  exp.forEach(e => {
    if (byCat[e.categoryId]) byCat[e.categoryId].totalCents += e.amountCents;
    else uncatTotal += e.amountCents;
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
  const { year, month } = state;
  // Gastos REALES del mes contable seleccionado (ad-hoc + materializados de recurrente).
  const monthExpenses = state.expenses.filter(e => isInAccountingMonth(e.date, year, month, state.payrollDay));

  // Dos buckets reales:
  //   variableExpenses: gastos puntuales (sin sourceRecurringId)
  //   fixedExpenses:    gastos con origen recurrente (con sourceRecurringId)
  const variableExpenses = monthExpenses.filter(e => !e.sourceRecurringId);
  const fixedExpenses    = monthExpenses.filter(e =>  e.sourceRecurringId);
  const variableTotal    = variableExpenses.reduce((s, e) => s + e.amountCents, 0);
  const fixedRealTotal   = fixedExpenses.reduce((s, e) => s + e.amountCents, 0);

  // Total REAL = lo único que cuenta para "Total".
  const realTotal = variableTotal + fixedRealTotal;

  // Pendiente: recurrentes que aún no se han materializado dentro de este periodo
  // contable. Se muestra como mini-card aparte y suma al "Esperado fin de mes".
  const pending = getPendingForPeriod(year, month);
  const pendingTotal = pending.reduce((s, p) => s + p.amountCents, 0);
  const expectedTotal = realTotal + pendingTotal;

  // Donut por categoría — solo sobre GASTO REAL.
  const byCat = {};
  state.categories.forEach(c => { byCat[c.id] = { ...c, totalCents: 0 }; });
  let uncatTotal = 0;
  monthExpenses.forEach(e => {
    if (byCat[e.categoryId]) byCat[e.categoryId].totalCents += e.amountCents;
    else uncatTotal += e.amountCents;
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
    el('span', { class: 'badge', text: `${monthExpenses.length} gasto${monthExpenses.length !== 1 ? 's' : ''}` }),
  );
  leftCol.appendChild(chartHeader);

  // Canvas del donut
  const chartWrap = el('div', { class: 'chart-wrapper' });
  const canvas = el('canvas', { id: 'donut-canvas' });
  chartWrap.appendChild(canvas);

  // Total central — solo real
  const centerOverlay = el('div', { class: 'chart-center' },
    el('span', { class: 'chart-center-label', text: 'Total mes' }),
    el('span', { class: 'chart-center-amount', text: fmtEUR(realTotal) }),
  );
  chartWrap.appendChild(centerOverlay);
  leftCol.appendChild(chartWrap);

  // Leyenda
  if (chartData.length > 0) {
    const legend = el('div', { class: 'chart-legend' });
    chartData.forEach(c => {
      const pct = realTotal > 0 ? ((c.totalCents / realTotal) * 100).toFixed(1) : '0.0';
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

  // Resumen rápido — todo en REAL.
  const summary = el('div', { class: 'card summary-card' });
  summary.appendChild(el('h2', { class: 'card-title', text: 'Resumen del mes' }));
  const summaryGrid = el('div', { class: 'summary-grid' });
  summaryGrid.appendChild(summaryItem('Puntuales', variableTotal, variableExpenses.length));
  summaryGrid.appendChild(summaryItem('Fijos (origen recurrente)', fixedRealTotal, fixedExpenses.length));
  summary.appendChild(summaryGrid);
  const totalRow = el('div', { class: 'summary-total' },
    el('span', { text: 'Total real' }),
    el('span', { class: 'mono', text: fmtEUR(realTotal) }),
  );
  summary.appendChild(totalRow);
  // Línea secundaria si hay pendientes en el periodo (esperado fin de mes).
  if (pendingTotal > 0) {
    const expectedRow = el('div', { class: 'summary-expected' },
      el('span', { text: `Esperado fin de mes (${pending.length} pendiente${pending.length !== 1 ? 's' : ''})` }),
      el('span', { class: 'mono', text: fmtEUR(expectedTotal) }),
    );
    summary.appendChild(expectedRow);
  }
  rightCol.appendChild(summary);

  // Formulario
  rightCol.appendChild(buildExpenseForm());
  grid.appendChild(rightCol);
  container.appendChild(grid);

  // Lista de gastos REALES
  container.appendChild(buildExpenseList(monthExpenses));

  // Mini-card de pendientes del mes contable
  if (pending.length > 0) {
    container.appendChild(buildPendingCard(pending));
  }

  // Proyección de fin de mes (al final; solo si miramos el mes actual)
  const projectionCard = buildProjectionCard({
    year: state.year,
    month: state.month,
    variableTotal,
    variableCount: variableExpenses.length,
    fixedRealTotal,
    pendingTotal,
  });
  if (projectionCard) container.appendChild(projectionCard);

  // Render chart
  requestAnimationFrame(() => {
    if (chartData.length > 0) {
      DonutChart.render('donut-canvas', chartData, realTotal);
    } else {
      DonutChart.destroy();
      const wrap = document.querySelector('.chart-wrapper');
      if (wrap) {
        clear(wrap);
        wrap.appendChild(el('div', { class: 'empty-state', text: 'Sin gastos reales este mes' }));
      }
    }
  });
}

/** Mini-card read-only con las materializaciones pendientes del periodo contable. */
function buildPendingCard(pending) {
  const card = el('div', { class: 'card pending-card' });
  const total = pending.reduce((s, p) => s + p.amountCents, 0);
  card.appendChild(
    el('div', { class: 'card-header' },
      el('h2', { class: 'card-title', text: 'Pendiente del mes contable' }),
      el('span', { class: 'badge', text: `${pending.length} · ${fmtEUR(total)}` }),
    )
  );
  card.appendChild(el('p', {
    class: 'expense-meta',
    style: { margin: '6px 0 12px' },
    text: 'Recurrentes que aún no se han facturado en este periodo. Se crearán como gasto editable cuando llegue su día.',
  }));

  const list = el('div', { class: 'pending-list' });
  pending.forEach(p => {
    const r   = p.recurring;
    const cat = state.categories.find(c => c.id === r.categoryId);
    const row = el('div', { class: 'pending-row' });
    row.appendChild(el('span', { class: 'dot', style: { backgroundColor: cat?.color || '#999' } }));
    const info = el('div', { class: 'expense-info' });
    const name = el('span', { class: 'expense-desc' });
    appendIconText(name, cat?.icon, r.name, 13);
    info.appendChild(name);
    const meta = `${cat?.name || 'Sin categoría'} · ${fmtDate(p.date)}`;
    info.appendChild(el('div', { class: 'expense-meta', text: meta }));
    row.appendChild(info);
    row.appendChild(el('span', { class: 'expense-amount mono', text: fmtEUR(p.amountCents) }));
    list.appendChild(row);
  });
  card.appendChild(list);
  return card;
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
function buildProjectionCard({ year, month, variableTotal, variableCount, fixedRealTotal, pendingTotal }) {
  const now = new Date();
  const isCurrentMonth = (year === now.getFullYear() && month === now.getMonth() + 1);
  if (!isCurrentMonth) return null;

  const daysInMonth = new Date(year, month, 0).getDate();
  const elapsed = Math.max(1, Math.min(now.getDate(), daysInMonth));
  // Bloque fijo del mes: lo ya materializado (real) + lo pendiente de materializar.
  const fixedMonth = (fixedRealTotal || 0) + (pendingTotal || 0);

  // Proyectamos linealmente solo los puntuales (variable); los fijos se imputan tal cual.
  const projectedVariable = Math.round((variableTotal / elapsed) * daysInMonth);
  const projectedTotal = projectedVariable + fixedMonth;
  const actualSoFar = variableTotal + (fixedRealTotal || 0);
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
  if (variableCount > 0) {
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
    });
    amountInput.value = '';
    descInput.value   = '';
    tagsInput.value   = '';
    await reload();
  });

  card.appendChild(form);
  return card;
}

/* ================================================================
   Lista de movimientos
   ================================================================ */

/** Lista solo gastos REALES (ad-hoc + materializados de recurrente). Las
 *  proyecciones se muestran en el bloque "Pendiente del mes contable" aparte,
 *  para que los botones editar/borrar de esta lista solo afecten al gasto
 *  concreto y nunca a la plantilla del recurrente. */
function buildExpenseList(monthExpenses) {
  const section = el('div', { class: 'card list-card' });

  // Etiquetas únicas del mes para el filtro
  const allTags = [...new Set(monthExpenses.flatMap(e => e.tags || []))].sort();
  const hasFilter = !!state.tagFilter;

  const header = el('div', { class: 'card-header' });
  header.appendChild(el('h2', { class: 'card-title', text: 'Gastos del mes' }));
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

  const visibleExpenses = hasFilter
    ? monthExpenses.filter(e => (e.tags || []).includes(state.tagFilter))
    : monthExpenses;

  if (visibleExpenses.length === 0) {
    const msg = hasFilter ? `No hay gastos con la etiqueta #${state.tagFilter}` : 'Sin gastos reales este mes';
    section.appendChild(el('div', { class: 'empty-state', text: msg }));
    return section;
  }

  // Orden: por fecha descendente
  const ordered = [...visibleExpenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const list = el('div', { class: 'expense-list' });
  ordered.forEach(e => {
    const cat = state.categories.find(c => c.id === e.categoryId);
    const item = {
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
      tags:   e.tags   || [],
      sourceRecurringId: e.sourceRecurringId || null,
    };

    const row = el('div', { class: 'expense-row' });
    row.appendChild(el('span', { class: 'dot', style: { backgroundColor: item.color } }));

    const info = el('div', { class: 'expense-info' });
    const topLine = el('div', { class: 'expense-top-line' });
    const descSpan = el('span', { class: 'expense-desc' });
    appendIconText(descSpan, item.icon, item.desc, 14);
    topLine.appendChild(descSpan);
    if (item.sourceRecurringId) {
      topLine.appendChild(el('span', {
        class: 'expense-recurring-mark',
        title: 'Generado a partir de un recurrente',
        'aria-label': 'Recurrente',
        html: Icons.svg('repeat', 12),
      }));
    }
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
    info.appendChild(el('div', { class: 'expense-meta', text: meta }));
    row.appendChild(info);

    row.appendChild(el('span', { class: 'expense-amount mono', text: fmtEUR(item.amount) }));

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

  const fields = el('div', { class: 'edit-row-fields' });
  [amtInput, catSelect, dateInput, descInput, tagsInlineInput].forEach(f => fields.appendChild(f));
  row.appendChild(fields);

  async function save() {
    const cents = eurToCents(amtInput.value);
    const catId = parseInt(catSelect.value);
    if (!cents || !catId) return;
    // Spread del original para preservar campos no editables aquí (sourceRecurringId,
    // recurringInstanceKey…). Sin esto, un gasto materializado perdería su vínculo y
    // se rematerializaría en el siguiente boot → duplicado.
    const original = state.expenses.find(x => x.id === item.id) || {};
    await DB.updateExpense({
      ...original,
      id: item.id,
      date: dateInput.value || today(),
      amountCents: cents,
      description: descInput.value.trim(),
      categoryId: catId,
      tags:   parseTags(tagsInlineInput.value),
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
   Frequency radio — selector de frecuencia para recurrentes
   ================================================================ */

/** 3 radios: Mensual (default), Anual, Anualizado. Expone getValue/setValue/onChange. */
function buildFrequencyRadios(initial = 'monthly') {
  const valid = ['monthly', 'annual', 'annualized'];
  let selected = valid.includes(initial) ? initial : 'monthly';
  const listeners = [];
  const radios = {};

  const root = el('div', { class: 'freq-radios' });

  const options = [
    { value: 'monthly',    label: 'Mensual',    hint: 'Cada mes en el día indicado' },
    { value: 'annual',     label: 'Anual',      hint: 'Una vez al año en una fecha concreta' },
    { value: 'annualized', label: 'Anualizado', hint: 'Pago anual repartido /12 cada mes' },
  ];

  // Nombre único por instancia para no entrar en conflicto con otros forms en pantalla.
  const groupName = 'freq-' + Math.random().toString(36).slice(2, 8);

  options.forEach((opt) => {
    const wrap = el('label', { class: 'freq-radio' });
    const radio = el('input', { type: 'radio', name: groupName, value: opt.value });
    if (opt.value === selected) radio.checked = true;
    radio.addEventListener('change', () => {
      if (radio.checked) {
        selected = opt.value;
        listeners.forEach((fn) => fn(selected));
      }
    });
    wrap.appendChild(radio);
    const txt = el('span', { class: 'freq-radio-text' });
    txt.appendChild(el('span', { class: 'freq-radio-label', text: opt.label }));
    txt.appendChild(el('span', { class: 'freq-radio-hint',  text: opt.hint }));
    wrap.appendChild(txt);
    root.appendChild(wrap);
    radios[opt.value] = radio;
  });

  return {
    element: root,
    getValue: () => selected,
    setValue: (v) => {
      if (!radios[v]) return;
      radios[v].checked = true;
      selected = v;
    },
    onChange: (fn) => listeners.push(fn),
  };
}

/* ================================================================
   Day picker — selector de día (1-31) y opcionalmente mes (1-12)
   ================================================================ */

/** Selector de día del mes con modo opcional "día + mes" para recurrentes anuales.
 *  Opciones:
 *    - day            : día inicial (1-31)
 *    - month          : mes inicial (1-12), solo si includeMonth=true
 *    - includeMonth   : si true, muestra grid de meses y getValue devuelve {day, month}
 *  Devuelve { element, getValue, setValue, setIncludeMonth, isValid }. */
function buildDayPicker(options = {}) {
  const maxDay = (options.maxDay && options.maxDay >= 1 && options.maxDay <= 31) ? options.maxDay : 31;
  let selectedDay   = (options.day   != null && options.day   >= 1 && options.day   <= maxDay) ? options.day   : null;
  let selectedMonth = (options.month != null && options.month >= 1 && options.month <= 12)     ? options.month : null;
  let includeMonth  = !!options.includeMonth;
  let outsideHandler = null;
  // Etiqueta del trigger: 'monthly' = "Día N de cada mes"; 'startDay' = "Empieza el día N".
  const triggerVariant = options.triggerVariant || 'monthly';
  const noteText = options.note || 'En meses sin ese día (29/30/31), el cobro se aplicará el último día disponible.';

  const root    = el('div', { class: 'day-picker' });
  const trigger = el('button', { type: 'button', class: 'form-input day-picker-trigger' });
  const popover = el('div', { class: 'day-picker-popover hidden' });

  // --- Day section ---
  const daySection = el('div', { class: 'day-picker-section' });
  daySection.appendChild(el('p', { class: 'day-picker-section-label', text: 'Día' }));
  const dayGrid = el('div', { class: 'day-picker-grid' });
  for (let d = 1; d <= maxDay; d++) {
    const cell = el('button', { type: 'button', class: 'day-picker-cell', text: String(d) });
    cell.dataset.day = d;
    cell.addEventListener('click', () => {
      selectedDay = d;
      refreshDayCells();
      refreshTrigger();
      // Cierra si día-only, o si en modo día+mes ya hay mes elegido.
      if (!includeMonth || selectedMonth != null) closePopover();
    });
    dayGrid.appendChild(cell);
  }
  daySection.appendChild(dayGrid);

  // --- Month section (oculto por defecto, visible si includeMonth) ---
  const monthSection = el('div', { class: 'day-picker-section month-section' });
  monthSection.appendChild(el('p', { class: 'day-picker-section-label', text: 'Mes' }));
  const monthGrid = el('div', { class: 'month-picker-grid' });
  const monthShortNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  for (let m = 1; m <= 12; m++) {
    const cell = el('button', { type: 'button', class: 'month-picker-cell', text: monthShortNames[m - 1] });
    cell.dataset.month = m;
    cell.addEventListener('click', () => {
      selectedMonth = m;
      refreshMonthCells();
      refreshTrigger();
      if (selectedDay != null) closePopover();
    });
    monthGrid.appendChild(cell);
  }
  monthSection.appendChild(monthGrid);

  const note = el('p', { class: 'day-picker-note', text: noteText });

  popover.appendChild(daySection);
  popover.appendChild(monthSection);
  popover.appendChild(note);
  root.appendChild(trigger);
  root.appendChild(popover);

  function refreshTrigger() {
    if (selectedDay == null) {
      trigger.textContent = includeMonth ? '— Selecciona fecha —' : '— Selecciona día —';
      trigger.classList.remove('has-value');
      return;
    }
    if (includeMonth) {
      if (selectedMonth == null) {
        trigger.textContent = `Día ${selectedDay} — falta mes`;
        trigger.classList.remove('has-value');
        return;
      }
      trigger.textContent = `${selectedDay} de ${monthShortNames[selectedMonth - 1].toLowerCase()} (cada año)`;
      trigger.classList.add('has-value');
    } else if (triggerVariant === 'startDay') {
      trigger.textContent = `Empieza el día ${selectedDay} del mes anterior`;
      trigger.classList.add('has-value');
    } else {
      trigger.textContent = `Día ${selectedDay} de cada mes`;
      trigger.classList.add('has-value');
    }
  }

  function refreshDayCells() {
    dayGrid.querySelectorAll('.day-picker-cell').forEach((c) => {
      c.classList.toggle('selected', parseInt(c.dataset.day, 10) === selectedDay);
    });
  }

  function refreshMonthCells() {
    monthGrid.querySelectorAll('.month-picker-cell').forEach((c) => {
      c.classList.toggle('selected', parseInt(c.dataset.month, 10) === selectedMonth);
    });
  }

  function applyIncludeMonth() {
    monthSection.classList.toggle('hidden', !includeMonth);
    refreshTrigger();
  }

  function closePopover() {
    popover.classList.add('hidden');
    if (outsideHandler) {
      document.removeEventListener('click', outsideHandler);
      outsideHandler = null;
    }
  }

  function openPopover() {
    popover.classList.remove('hidden');
    setTimeout(() => {
      outsideHandler = (e) => { if (!root.contains(e.target)) closePopover(); };
      document.addEventListener('click', outsideHandler);
    }, 0);
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    popover.classList.contains('hidden') ? openPopover() : closePopover();
  });

  applyIncludeMonth();
  refreshDayCells();
  refreshMonthCells();
  refreshTrigger();

  return {
    element: root,
    getValue: () => includeMonth ? { day: selectedDay, month: selectedMonth } : selectedDay,
    setValue: (val) => {
      if (val == null) {
        selectedDay = null;
        selectedMonth = null;
      } else if (typeof val === 'object') {
        selectedDay   = (val.day   >= 1 && val.day   <= 31) ? val.day   : null;
        selectedMonth = (val.month >= 1 && val.month <= 12) ? val.month : null;
      } else {
        selectedDay = (val >= 1 && val <= 31) ? val : null;
      }
      refreshDayCells();
      refreshMonthCells();
      refreshTrigger();
    },
    setIncludeMonth: (flag) => {
      includeMonth = !!flag;
      applyIncludeMonth();
    },
    isValid: () => {
      if (selectedDay == null) return false;
      if (includeMonth && selectedMonth == null) return false;
      return true;
    },
  };
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
  // Categoría a ancho completo.
  const catGroup = wrap('Categoría', catSelect);
  catGroup.classList.add('full-width');
  form.appendChild(catGroup);

  // Tipo (frecuencia) — radio con 3 opciones. Por defecto 'monthly'.
  const freqRadios = buildFrequencyRadios('monthly');
  const freqGroup = el('div', { class: 'form-group full-width' });
  freqGroup.appendChild(el('label', { class: 'form-label', text: 'Tipo' }));
  freqGroup.appendChild(freqRadios.element);
  form.appendChild(freqGroup);

  // Día de cobro (obligatorio) — el picker amplía a día+mes cuando freq=annual.
  const dayPicker = buildDayPicker({ includeMonth: false });
  const dayGroup = wrap('Día de cobro', dayPicker.element);
  dayGroup.classList.add('full-width');
  form.appendChild(dayGroup);

  freqRadios.onChange((freq) => {
    dayPicker.setIncludeMonth(freq === 'annual');
  });

  // Rango de vigencia (mes de inicio obligatorio, fin opcional)
  const defaultStart = ymKey(state.year, state.month);
  const startInput = el('input', { type: 'month', class: 'form-input', id: 'rec-start', value: defaultStart });
  form.appendChild(wrap('Desde (mes)', startInput));
  const endInput = el('input', { type: 'month', class: 'form-input', id: 'rec-end' });
  form.appendChild(wrap('Hasta (opcional)', endInput));

  form.appendChild(el('button', { type: 'submit', class: 'btn btn-primary', text: 'Añadir recurrente' }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cents = eurToCents(amtInput.value);
    const catId = parseInt(catSelect.value);
    if (!nameInput.value.trim() || !cents || !catId) return;
    if (!dayPicker.isValid()) {
      alert('Selecciona la fecha de cobro');
      return;
    }
    const startMonth = startInput.value || currentYmKey();
    const endMonth   = endInput.value || null;
    if (endMonth && endMonth < startMonth) {
      alert('La fecha "Hasta" no puede ser anterior a "Desde"');
      return;
    }
    const freq = freqRadios.getValue();
    const dayVal = dayPicker.getValue();
    const paymentDay   = (typeof dayVal === 'object') ? dayVal.day   : dayVal;
    const paymentMonth = (typeof dayVal === 'object') ? dayVal.month : null;
    await DB.addRecurring({
      name: nameInput.value.trim(),
      amountCents: cents,
      categoryId: catId,
      frequency: freq,
      active: true,
      startMonth,
      endMonth,
      paymentDay,
      paymentMonth,
    });
    // No limpiamos inputs: reload() reconstruye el form. Materializamos antes
    // del reload para que la fila aparezca ya con el gasto del mes en curso.
    await materializeRecurrings();
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

  // Meta: categoría · periodicidad · día/fecha de cobro
  const freq = getFrequency(r);
  const monthShortNames = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  let freqLabel = 'mensual';
  let dayLabel = '';
  if (freq === 'annualized') {
    freqLabel = 'anualizado';
    if (r.paymentDay) dayLabel = `día ${r.paymentDay}`;
  } else if (freq === 'annual') {
    freqLabel = 'anual';
    if (r.paymentDay && r.paymentMonth) {
      dayLabel = `${r.paymentDay} ${monthShortNames[r.paymentMonth - 1]}`;
    }
  } else {
    if (r.paymentDay) dayLabel = `día ${r.paymentDay}`;
  }
  const metaParts = [cat?.name || 'Sin categoría', freqLabel];
  if (dayLabel) metaParts.push(dayLabel);
  info.appendChild(el('div', { class: 'expense-meta', text: metaParts.join(' · ') }));

  // Rango de fechas en su propia línea (cuando aplique)
  let rangeText = '';
  if (r.startMonth && r.endMonth) {
    rangeText = `${fmtYearMonth(r.startMonth)} — ${fmtYearMonth(r.endMonth)}`;
  } else if (r.startMonth) {
    rangeText = `desde ${fmtYearMonth(r.startMonth)}`;
  } else if (r.endMonth) {
    rangeText = `hasta ${fmtYearMonth(r.endMonth)}`;
  }
  if (rangeText) {
    info.appendChild(el('div', { class: 'expense-meta recurring-range', text: rangeText }));
  }
  row.appendChild(info);

  let amountText;
  if (freq === 'annualized') {
    amountText = `${fmtEUR(r.amountCents)}/año → ${fmtEUR(Math.round(r.amountCents / 12))}/mes`;
  } else if (freq === 'annual') {
    amountText = `${fmtEUR(r.amountCents)}/año`;
  } else {
    amountText = `${fmtEUR(r.amountCents)}/mes`;
  }
  row.appendChild(el('span', { class: 'expense-amount mono', text: amountText }));

  const toggleBtn = el('button', {
    class: 'btn-edit btn-toggle',
    title: r.active ? 'Pausar' : 'Activar',
    'aria-label': r.active ? 'Pausar recurrente' : 'Activar recurrente',
    html: Icons.svg(r.active ? 'pause' : 'play', 14),
    onClick: async () => {
      const next = !r.active;
      await DB.updateRecurring({ ...r, active: next });
      // Si se reactiva y el día ya pasó este mes, materializar al instante.
      if (next) await materializeRecurrings();
      await reload();
    },
  });
  row.appendChild(toggleBtn);

  const editBtn = el('button', {
    class: 'btn-edit', html: Icons.svg('edit', 14),
    onClick: () => openRecurringEdit(r),
  });
  row.appendChild(editBtn);

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

    // Tipo (frecuencia) — radio justo después de categoría.
    const initialFreq = getFrequency(r);
    const freqRadios = buildFrequencyRadios(initialFreq);
    const freqGroup = el('div', { class: 'form-group full-width' });
    freqGroup.appendChild(el('label', { class: 'form-label', text: 'Tipo' }));
    freqGroup.appendChild(freqRadios.element);
    form.appendChild(freqGroup);

    // Día de cobro — picker dinámico según frecuencia.
    const dayPicker = buildDayPicker({
      day: r.paymentDay || null,
      month: r.paymentMonth || null,
      includeMonth: initialFreq === 'annual',
    });
    const dayGroup = wrap('Día de cobro', dayPicker.element);
    dayGroup.classList.add('full-width');
    form.appendChild(dayGroup);

    freqRadios.onChange((freq) => {
      dayPicker.setIncludeMonth(freq === 'annual');
    });

    const startInput = el('input', { type: 'month', class: 'form-input', value: r.startMonth || '' });
    form.appendChild(wrap('Desde (mes)', startInput));

    const endInput = el('input', { type: 'month', class: 'form-input', value: r.endMonth || '' });
    form.appendChild(wrap('Hasta (opcional)', endInput));

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
      if (!dayPicker.isValid()) {
        alert('Selecciona la fecha de cobro');
        return;
      }
      const startMonth = startInput.value || null;
      const endMonth   = endInput.value   || null;
      if (startMonth && endMonth && endMonth < startMonth) {
        alert('La fecha "Hasta" no puede ser anterior a "Desde"');
        return;
      }
      const freq = freqRadios.getValue();
      const dayVal = dayPicker.getValue();
      const paymentDay   = (typeof dayVal === 'object') ? dayVal.day   : dayVal;
      const paymentMonth = (typeof dayVal === 'object') ? dayVal.month : null;
      // Limpiamos el bool annual legacy para que getFrequency lea siempre el campo nuevo.
      const { annual, ...rest } = r;
      await DB.updateRecurring({
        ...rest,
        name: nameInput.value.trim(),
        amountCents: cents,
        categoryId: catId,
        frequency: freq,
        startMonth,
        endMonth,
        paymentDay,
        paymentMonth,
      });
      closeModal();
      // Si el nuevo día ya pasó (en cualquier mes de la ventana de lookback), materializar.
      await materializeRecurrings();
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

/* ================================================================
   Vista: Mes contable (configuración del payrollDay)
   ================================================================ */

function renderAccountingMonth(container) {
  const card = el('div', { class: 'card' });
  card.style.maxWidth = '640px';
  card.style.margin = '0 auto';

  card.appendChild(el('h2', { class: 'card-title', text: 'Mes contable' }));
  card.appendChild(el('p', {
    class: 'expense-meta',
    style: { margin: '6px 0 4px' },
    text: 'Define el día en que empieza tu mes contable. Útil si cobras un día concreto del mes y quieres que tu ahorro empiece a contar desde ese día. Afecta a Gastos, Ahorro e Informes; el Calendario sigue mostrando el mes natural.',
  }));
  card.appendChild(el('p', {
    class: 'expense-meta',
    style: { margin: '4px 0 18px' },
    text: 'Convención bancaria: cada periodo se nombra por el mes en que TERMINA. Ej: con día 25, "Mayo" abarca del 25-abril al 24-mayo.',
  }));

  const dayPicker = buildDayPicker({
    day: state.payrollDay || 1,
    maxDay: 28,
    triggerVariant: 'startDay',
    note: 'Limitado a 1-28 para que todos los periodos sean uniformes (febrero solo tiene 28 días). El día 1 equivale al mes natural.',
  });

  const dayGroup = el('div', { class: 'form-group full-width' });
  dayGroup.appendChild(el('label', { class: 'form-label', text: 'Inicio del mes contable' }));
  dayGroup.appendChild(dayPicker.element);
  card.appendChild(dayGroup);

  // Preview en vivo del periodo actual y siguientes 2 meses contables.
  const previewBox = el('div', { class: 'accounting-preview' });
  card.appendChild(previewBox);

  function refreshPreview() {
    clear(previewBox);
    const day = dayPicker.getValue() || 1;
    previewBox.appendChild(el('p', { class: 'form-label', text: 'Vista previa' }));
    const list = el('div', { class: 'accounting-preview-list' });
    // Tomamos el mes contable que contiene HOY como referencia.
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const refYm = accountingMonth(iso, day);
    let [refY, refM] = refYm.split('-').map(n => parseInt(n, 10));
    for (let i = 0; i < 3; i++) {
      const [s, e] = monthBounds(refY, refM, day);
      const row = el('div', { class: 'accounting-preview-row' });
      row.appendChild(el('span', { class: 'accounting-preview-label', text: `${monthName(refM)} ${refY}` }));
      row.appendChild(el('span', { class: 'accounting-preview-range mono', text: `${fmtPreviewDate(s)} → ${fmtPreviewDate(e)}` }));
      list.appendChild(row);
      // siguiente mes contable
      refM++;
      if (refM > 12) { refM = 1; refY++; }
    }
    previewBox.appendChild(list);
  }

  // Wrap el picker para detectar cambios. Como el picker no expone onChange,
  // engancho un MutationObserver al trigger (su textContent cambia cuando hay selección).
  const obs = new MutationObserver(refreshPreview);
  obs.observe(dayPicker.element.querySelector('.day-picker-trigger'), { childList: true, characterData: true, subtree: true });
  refreshPreview();

  // Botones acción
  const actions = el('div', { class: 'form-group full-width', style: { display: 'flex', gap: '10px', marginTop: '12px' } });
  const saveBtn = el('button', {
    class: 'btn btn-primary', text: 'Guardar',
    onClick: async () => {
      const day = dayPicker.getValue() || 1;
      await DB.setSetting('payroll-day', day);
      state.payrollDay = day;
      saveBtn.textContent = '✓ Guardado';
      setTimeout(() => { saveBtn.textContent = 'Guardar'; }, 1400);
      await reload();
    },
  });
  const resetBtn = el('button', {
    class: 'btn btn-ghost', text: 'Restablecer a día 1 (mes natural)',
    onClick: async () => {
      dayPicker.setValue(1);
      await DB.setSetting('payroll-day', 1);
      state.payrollDay = 1;
      await reload();
    },
  });
  actions.appendChild(saveBtn);
  actions.appendChild(resetBtn);
  card.appendChild(actions);

  container.appendChild(card);
}

/** Formatea 'YYYY-MM-DD' como '25-abr-2026' para la preview. */
function fmtPreviewDate(iso) {
  if (!iso) return '';
  const monthShort = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const y = iso.slice(0, 4);
  const m = parseInt(iso.slice(5, 7), 10);
  const d = iso.slice(8, 10);
  return `${d}-${monthShort[m - 1]}-${y}`;
}

function renderCategories(container) {
  const card = el('div', { class: 'card' });
  card.style.maxWidth = '600px';
  card.style.margin = '0 auto';

  card.appendChild(el('h2', { class: 'card-title', text: 'Gestionar categorías' }));

  // Botón "+ Nueva categoría" — abre modal con preview vivo y form completo.
  const addBtn = el('button', {
    type: 'button',
    class: 'btn btn-primary category-add-btn',
    onClick: () => openCategoryModal(null),
  });
  addBtn.innerHTML = `${Icons.svg('plus', 14)} <span>Nueva categoría</span>`;
  card.appendChild(addBtn);

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
      onClick: () => openCategoryModal(c),
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
}

/** Modal de creación/edición de categoría. Si `cat` es null → modo creación. */
function openCategoryModal(cat) {
  const isEdit = !!cat;
  const initial = cat || { name: '', color: '#c47a1a', icon: '', monthlyLimitCents: 0 };

  openModal(isEdit ? `Editar "${cat.name}"` : 'Nueva categoría', (body) => {
    // ---- Preview chip (live) ----
    const preview = el('div', { class: 'category-preview' });
    const previewDot  = el('span', { class: 'dot-lg', style: { backgroundColor: initial.color } });
    const previewIcon = el('span', { class: 'category-icon' });
    if (Icons.has(initial.icon)) previewIcon.innerHTML = Icons.svg(initial.icon, 18);
    const previewName = el('span', {
      class: 'category-preview-name',
      text: initial.name || 'Nombre de la categoría',
    });
    const previewLimit = el('span', { class: 'category-preview-limit mono' });
    if (initial.monthlyLimitCents > 0) {
      previewLimit.textContent = `${fmtEUR(initial.monthlyLimitCents)} /mes`;
    }
    preview.appendChild(previewDot);
    preview.appendChild(previewIcon);
    preview.appendChild(previewName);
    preview.appendChild(previewLimit);
    body.appendChild(preview);

    // ---- Form ----
    const form = el('form', { class: 'category-modal-form' });

    // Nombre (full)
    const nameGroup = el('div', { class: 'form-group full-width' });
    nameGroup.appendChild(el('label', { class: 'form-label', text: 'Nombre' }));
    const nameInp = el('input', { class: 'form-input', value: initial.name, placeholder: 'Ej. Comida' });
    nameGroup.appendChild(nameInp);
    form.appendChild(nameGroup);

    // Color
    const colorGroup = el('div', { class: 'form-group' });
    colorGroup.appendChild(el('label', { class: 'form-label', text: 'Color' }));
    const colorInp = el('input', { type: 'color', value: initial.color, class: 'color-input' });
    colorGroup.appendChild(colorInp);
    form.appendChild(colorGroup);

    // Límite mensual
    const limitGroup = el('div', { class: 'form-group' });
    limitGroup.appendChild(el('label', { class: 'form-label', text: 'Límite mensual (€)' }));
    const limitInp = el('input', {
      type: 'text', inputmode: 'decimal',
      class: 'form-input mono',
      value: initial.monthlyLimitCents > 0
        ? (initial.monthlyLimitCents / 100).toFixed(2).replace('.', ',')
        : '',
      placeholder: 'Sin límite',
    });
    limitGroup.appendChild(limitInp);
    form.appendChild(limitGroup);

    // Icono (full)
    const iconGroup = el('div', { class: 'form-group full-width' });
    iconGroup.appendChild(el('label', { class: 'form-label', text: 'Icono' }));
    const picker = buildIconPicker(Icons.resolve(initial.icon));
    iconGroup.appendChild(picker);
    form.appendChild(iconGroup);

    // Acciones
    const actions = el('div', {
      class: 'form-group full-width',
      style: { display: 'flex', gap: '10px', marginTop: '4px' },
    });
    const saveBtn = el('button', {
      type: 'submit',
      class: 'btn btn-primary',
      text: isEdit ? 'Guardar' : 'Añadir',
    });
    const cancelBtn = el('button', {
      type: 'button',
      class: 'btn btn-ghost',
      text: 'Cancelar',
      onClick: closeModal,
    });
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);

    // ---- Live preview wiring ----
    function refreshPreview() {
      previewDot.style.backgroundColor = colorInp.value;
      previewName.textContent = nameInp.value.trim() || 'Nombre de la categoría';
      const iconId = picker.dataset.value || '';
      previewIcon.innerHTML = Icons.has(iconId) ? Icons.svg(iconId, 18) : '';
      const raw = limitInp.value.trim();
      previewLimit.textContent = raw ? `${fmtEUR(eurToCents(raw))} /mes` : '';
    }
    nameInp.addEventListener('input', refreshPreview);
    colorInp.addEventListener('input', refreshPreview);
    limitInp.addEventListener('input', refreshPreview);
    picker.querySelectorAll('.icon-pick-item').forEach(btn => {
      btn.addEventListener('click', refreshPreview);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!nameInp.value.trim()) return;
      const limitCents = limitInp.value.trim() ? eurToCents(limitInp.value) : 0;
      const payload = {
        name: nameInp.value.trim(),
        color: colorInp.value,
        icon: picker.dataset.value || '',
        monthlyLimitCents: limitCents,
      };
      if (isEdit) {
        await DB.updateCategory({ ...cat, ...payload });
      } else {
        await DB.addCategory(payload);
      }
      closeModal();
      await reload();
    });

    body.appendChild(form);
    setTimeout(() => nameInp.focus(), 50);
  });
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

  const title = el('h2', { class: 'card-title', style: { marginBottom: '8px' } });
  title.innerHTML = `Ahorro &mdash; ${monthName(state.month)} ${state.year}`;
  container.appendChild(title);

  // Indicador del rango del mes contable (solo cuando difiere del mes natural).
  if ((state.payrollDay || 1) > 1) {
    const [s, e] = monthBounds(state.year, state.month, state.payrollDay);
    container.appendChild(el('p', {
      class: 'expense-meta',
      style: { marginBottom: '20px' },
      text: `Periodo contable: ${fmtPreviewDate(s)} → ${fmtPreviewDate(e)}`,
    }));
  } else {
    container.appendChild(el('div', { style: { marginBottom: '16px' } }));
  }

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

  statsGrid.appendChild(savStat('Gasto real', fmtEUR(monthExpenses)));
  statsGrid.appendChild(savStat('Ingresos', monthIncome > 0 ? fmtEUR(monthIncome) : '—'));

  const savMain = el('div', { class: 'savings-stat-item savings-stat-main' });
  savMain.appendChild(el('span', { class: 'savings-stat-label', text: 'Ahorro real' }));
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

  // Indicador secundario: ahorro proyectado si se materializa todo lo pendiente.
  const pending = getPendingForPeriod(state.year, state.month);
  if (monthIncome > 0 && pending.length > 0) {
    const pendingTotal = pending.reduce((s, p) => s + p.amountCents, 0);
    const projectedSavings = monthIncome - (monthExpenses + pendingTotal);
    const hint = el('div', { class: 'savings-projection-hint' });
    hint.appendChild(el('span', { text: `Si se materializa lo pendiente (${pending.length}, ${fmtEUR(pendingTotal)})` }));
    const proj = el('span', { class: `mono ${projectedSavings >= 0 ? 'amount-pos' : 'amount-neg'}` });
    proj.textContent = projectedSavings >= 0 ? fmtEUR(projectedSavings) : '−' + fmtEUR(-projectedSavings);
    hint.appendChild(proj);
    monthCard.appendChild(hint);
  }

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
    version: '1.14',
    date: 'Mayo 2026',
    items: [
      'Eliminada la funcionalidad "Personas / Gastos compartidos": campo "Pagado por" fuera del form de gasto, del modal de edición y del CSV; eliminada la card de Liquidación y la sección Personas en Categorías',
      'Quitada la card de Importar/Exportar de la vista Categorías (sigue accesible desde el menú lateral en Datos)',
      'Vista Categorías rediseñada: botón "+ Nueva categoría" arriba y lista debajo. La creación y edición ahora se hace en un modal dedicado',
      'Modal de categoría con preview en vivo (chip con color+icono+nombre+límite) que se actualiza al escribir, elegir color, picar icono o cambiar el límite',
      'Mismo modal sirve para crear y editar — flujo coherente y sin form mezclado con la lista',
    ],
  },
  {
    version: '1.13',
    date: 'Mayo 2026',
    items: [
      'La lista "Gastos del mes" solo muestra gastos REALES (puntuales y los materializados de recurrentes). Editar/borrar afecta solo a ese gasto concreto, nunca a la plantilla del recurrente',
      'Los gastos anualizados ahora se materializan cada mes con importe = total anual / 12 (12 hits al año en el día elegido)',
      'Nuevo bloque "Pendiente del mes contable" debajo de la lista: muestra los recurrentes que todavía no se han facturado en este periodo (read-only; se materializan al llegar su día)',
      'Resumen del mes simplificado a 2 buckets reales: Puntuales (sin origen recurrente) y Fijos (con origen recurrente). Total real más línea secundaria "Esperado fin de mes" si hay pendientes',
      'Ahorro pasa a usar el valor REAL (ingreso - gasto materializado). Si hay pendientes, una línea aparte indica "Si se materializa lo pendiente: ahorro proyectado X €"',
      'Informes, donut y trend recalculados sobre gasto real (Fijo vs Variable, distribución anual, YoY, byDow)',
      'Para editar la plantilla de un recurrente, ahora la única vía es la pestaña Recurrentes — separación clara entre instancia (gasto) y plantilla',
    ],
  },
  {
    version: '1.12',
    date: 'Mayo 2026',
    items: [
      'Mes contable configurable: nueva sección "Mes contable" en el menú lateral permite elegir el día (1-28) en que empieza tu mes contable, útil si cobras un día concreto del mes',
      'Convención bancaria: el periodo se nombra por el mes en que termina (ej. con día 25, "Mayo" abarca del 25-abril al 24-mayo)',
      'Vista previa en vivo de los rangos al elegir el día, y aviso en Ahorro con las fechas exactas del periodo cuando difiere del mes natural',
      'Día 1 (default) = comportamiento idéntico al actual (mes natural)',
      'Gastos, Ahorro, Informes y selector de mes ahora respetan el periodo contable elegido',
      'Calendario y heatmap diario se mantienen en mes natural (su visualización es por fecha de calendario)',
    ],
  },
  {
    version: '1.11',
    date: 'Mayo 2026',
    items: [
      'Gastos recurrentes con 3 tipos de frecuencia (radio): Mensual, Anual (un pago al año en una fecha concreta), Anualizado (pago anual repartido /12)',
      'Selector de Día de cobro tipo calendario (1-31). En tipo Anual, se amplía con selector de mes para fijar día + mes del año',
      'Los recurrentes mensuales y anuales materializan automáticamente un gasto real al llegar su fecha (editable individualmente sin afectar a la plantilla); los anualizados siguen siendo proyección /12',
      'Ventana de materialización: al arrancar la app se revisan los 3 últimos meses para crear los gastos que falten dentro del periodo de vigencia del recurrente',
      'Idempotencia por instancia (clave mes-año-recurrente): no se duplican aunque la app se abra varias veces',
      'En meses sin el día indicado (29/30/31 en febrero, 31 en meses de 30 días) el cobro se aplica el último día disponible',
      'Pequeño icono ↻ junto al nombre de los gastos generados desde un recurrente, para distinguirlos de los ad-hoc',
      'Fila de recurrentes rediseñada en móvil: layout en grid (nombre, importe destacado, meta, rango+botones) sin solapes',
      'Botón Pausar/Activar de recurrente convertido en icono ⏸ / ▶ con tinte verde/ámbar según estado',
      'Modal Añadir gasto móvil reordenado: Descripción y Fecha antes de Categoría; recuadros de categoría con color neutro y selección marcada con acento',
      'Resumen del mes reclasificado: los gastos generados por recurrentes cuentan como Fijos (no como Puntuales), incluida la proyección de fin de mes',
      'Informe Coste fijo vs variable: el bloque Fijo agrupa toda la huella recurrente (proyección + materializados), separado de los gastos ad-hoc',
      'Corregido bug: la edición inline de un gasto materializado preservaba mal los vínculos al recurrente y podía duplicarse en el siguiente arranque',
      'Importación de backup robusta: se sanea el modelo antiguo (añade paymentDay y frequency por defecto) y se desvinculan referencias huérfanas en modo Fusionar',
    ],
  },
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
  { id: 'accounting', label: 'Mes contable' },
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
        const hasExpenses = state.expenses.some(e => isInAccountingMonth(e.date, pickerYear, m, state.payrollDay));
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
    payrollDay: state.payrollDay || 1,
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
  const payrollDay = state.payrollDay || 1;
  const inYear = (e) => isInAccountingYear(e.date, year, payrollDay);
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
    .filter(inYear)
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 8);
  const catYear = {};
  categories.forEach((c) => { catYear[c.id] = { ...c, totalCents: 0 }; });
  let uncatYearTotal = 0;
  expenses.forEach((e) => {
    if (!inYear(e)) return;
    if (catYear[e.categoryId]) catYear[e.categoryId].totalCents += e.amountCents;
    else uncatYearTotal += e.amountCents;
  });
  // Solo gasto real: no sumamos proyección por encima.
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

  // Heatmap diario: se conserva por año NATURAL (su visualización es un grid
  // de 12 meses × 31 días; mezclarlo con año contable produciría asociaciones
  // raras entre la columna y la fecha real).
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
  const fixedYearly = expenses
    .filter((e) => inYear(e) && e.sourceRecurringId)
    .reduce((s, e) => s + e.amountCents, 0);
  const variableYearly = expenses
    .filter((e) => inYear(e) && !e.sourceRecurringId)
    .reduce((s, e) => s + e.amountCents, 0);

  // Gasto por día de la semana (0=Lun, 6=Dom)
  const byDow = [0, 0, 0, 0, 0, 0, 0];
  expenses.forEach((e) => {
    if (!inYear(e)) return;
    const d = new Date(e.date + 'T12:00:00');
    if (isNaN(d.getTime())) return;
    const dow = (d.getDay() + 6) % 7;
    byDow[dow] += e.amountCents;
  });

  // Inflación YoY por categoría (comparando años contables completos)
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
      const ico = el('span', { class: 'qa-cat-ico' });
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
