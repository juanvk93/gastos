/**
 * db.js — Capa IndexedDB
 *
 * Stores:
 *   categories       { id (autoIncrement), name, color, icon, monthlyLimitCents? }
 *   expenses         { id (autoIncrement), date, amountCents, description, categoryId,
 *                      tags?, sourceRecurringId?, recurringInstanceKey? }
 *   recurring        { id (autoIncrement), name, amountCents, categoryId, active,
 *                      startMonth?, endMonth?, paymentDay, paymentMonth?,
 *                      frequency: 'monthly' | 'annualized' | 'annual' }
 *   incomes          { id (autoIncrement), date, amountCents, description, categoryId,
 *                      tags?, sourceRecurringIncomeId?, recurringInstanceKey? }  ← v5
 *   incomeCategories { id (autoIncrement), name, color, icon }                   ← v5
 *   recurringIncome  { id (autoIncrement), name, amountCents, categoryId, active,
 *                      startMonth?, endMonth?, paymentDay, paymentMonth?,
 *                      frequency: 'monthly' | 'annualized' | 'annual' }          ← v5
 *   income           { id ('YYYY-MM'), amountCents }  ← LEGACY: agregado mensual,
 *                      solo se conserva como fuente de la migración a `incomes`.
 *   settings         { key, value }   // 'annual-goal', 'payroll-day', 'income-migrated'…
 *
 * Materialización (v3): los recurrentes mensuales generan gastos/ingresos reales
 * cuando llega su paymentDay (último día disponible del mes si paymentDay no existe).
 *   - sourceRecurringId / sourceRecurringIncomeId: id del recurrente origen
 *   - recurringInstanceKey: 'YYYY-MM-<recurringId>' — usado para garantizar
 *     idempotencia (no crear dos veces el mismo recurrente del mismo mes). Las
 *     claves de gasto e ingreso viven en stores distintos: no colisionan.
 *
 * v5: los ingresos dejan de ser un agregado mensual (`income`, clave 'YYYY-MM')
 * y pasan a ser líneas con fecha (`incomes`), con categorías propias
 * (`incomeCategories`) y recurrentes propios (`recurringIncome`). La conversión
 * del agregado antiguo a líneas la hace app.js (migrateIncomeToEntries), donde ya
 * está disponible el payrollDay para asignar cada línea al mes contable correcto.
 */

const DB_NAME = 'gastos';
const DB_VERSION = 5;

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction;
      const oldVersion = e.oldVersion;

      if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('expenses')) {
        const s = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date', { unique: false });
        s.createIndex('categoryId', 'categoryId', { unique: false });
      }
      if (!db.objectStoreNames.contains('recurring')) {
        db.createObjectStore('recurring', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('income')) {
        // id = 'YYYY-MM', único por mes. LEGACY (v1-v4): agregado mensual.
        db.createObjectStore('income', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // v5: ingresos como líneas con fecha + categorías y recurrentes propios.
      if (!db.objectStoreNames.contains('incomes')) {
        const s = db.createObjectStore('incomes', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date', { unique: false });
        // No-unique: la mayoría de líneas no tendrán este campo (igual que en expenses).
        s.createIndex('recurringInstanceKey', 'recurringInstanceKey', { unique: false });
      }
      if (!db.objectStoreNames.contains('incomeCategories')) {
        db.createObjectStore('incomeCategories', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('recurringIncome')) {
        db.createObjectStore('recurringIncome', { keyPath: 'id', autoIncrement: true });
      }

      // v3: índice para idempotencia + paymentDay por defecto en recurrentes existentes.
      if (oldVersion < 3) {
        const expStore = tx.objectStore('expenses');
        if (!expStore.indexNames.contains('recurringInstanceKey')) {
          // No-unique a propósito: la mayoría de gastos no tendrán este campo
          // y queremos evitar conflictos con múltiples 'undefined'/null. La
          // unicidad se garantiza en código antes de insertar.
          expStore.createIndex('recurringInstanceKey', 'recurringInstanceKey', { unique: false });
        }
        const recStore = tx.objectStore('recurring');
        recStore.openCursor().onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;
          const r = cursor.value;
          if (r.paymentDay == null) {
            r.paymentDay = 1;
            cursor.update(r);
          }
          cursor.continue();
        };
      }

      // v4: frequency reemplaza al boolean `annual` y añade soporte para anual one-shot.
      //   annual:true  → frequency:'annualized' (comportamiento /12 actual)
      //   annual:false → frequency:'monthly'
      //   'annual' nuevo se introduce vía la UI, no via migración.
      if (oldVersion < 4) {
        const recStore = tx.objectStore('recurring');
        recStore.openCursor().onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;
          const r = cursor.value;
          if (!r.frequency) {
            r.frequency = r.annual ? 'annualized' : 'monthly';
            cursor.update(r);
          }
          cursor.continue();
        };
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

/* ---- Helpers genéricos ---- */

async function getAll(storeName) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getById(storeName, id) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function add(storeName, obj) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).add(obj);
    req.onsuccess = () => resolve(req.result); // devuelve el id generado
    req.onerror = () => reject(req.error);
  });
}

async function put(storeName, obj) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(obj);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function remove(storeName, id) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function clearStore(storeName) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ---- Categorías ---- */

const DEFAULT_CATEGORIES = [
  { name: 'Hipoteca',    color: '#c0392b', icon: 'home' },
  { name: 'Comida',      color: '#27ae60', icon: 'cart' },
  { name: 'Coche',       color: '#2980b9', icon: 'car' },
  { name: 'Suministros', color: '#f39c12', icon: 'zap' },
  { name: 'Ocio',        color: '#8e44ad', icon: 'film' },
  { name: 'Seguros',     color: '#16a085', icon: 'shield' },
  { name: 'Salud',       color: '#e74c3c', icon: 'heart' },
  { name: 'Otros',       color: '#7f8c8d', icon: 'package' },
];

async function seedCategories() {
  const cats = await getAll('categories');
  if (cats.length === 0) {
    for (const c of DEFAULT_CATEGORIES) {
      await add('categories', c);
    }
  }
}

/* ---- Categorías de ingreso (v5) ---- */

const DEFAULT_INCOME_CATEGORIES = [
  { name: 'Salario',     color: '#27ae60', icon: 'banknote-arrow-down' },
  { name: 'Alquileres',  color: '#2980b9', icon: 'building' },
  { name: 'Inversiones', color: '#8e44ad', icon: 'trending-up' },
  { name: 'Otros',       color: '#7f8c8d', icon: 'package' },
];

async function seedIncomeCategories() {
  const cats = await getAll('incomeCategories');
  if (cats.length === 0) {
    for (const c of DEFAULT_INCOME_CATEGORIES) {
      await add('incomeCategories', c);
    }
  }
}

/* ---- API pública ---- */

window.DB = {
  version: DB_VERSION,
  open,
  seedCategories,
  seedIncomeCategories,

  // Categorías (de gasto)
  getCategories:    () => getAll('categories'),
  getCategory:      (id) => getById('categories', id),
  addCategory:      (c) => add('categories', c),
  updateCategory:   (c) => put('categories', c),
  deleteCategory:   (id) => remove('categories', id),

  // Categorías de ingreso
  getIncomeCategories:    () => getAll('incomeCategories'),
  getIncomeCategory:      (id) => getById('incomeCategories', id),
  addIncomeCategory:      (c) => add('incomeCategories', c),
  updateIncomeCategory:   (c) => put('incomeCategories', c),
  deleteIncomeCategory:   (id) => remove('incomeCategories', id),
  putIncomeCategory:      (c) => put('incomeCategories', c),

  // Gastos
  getExpenses:      () => getAll('expenses'),
  getExpense:       (id) => getById('expenses', id),
  addExpense:       (e) => add('expenses', e),
  updateExpense:    (e) => put('expenses', e),
  deleteExpense:    (id) => remove('expenses', id),

  /** Devuelve true si ya existe un gasto materializado para el instanceKey dado.
   *  Usado por la materialización de recurrentes para garantizar idempotencia. */
  hasExpenseByInstanceKey: async (key) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('expenses', 'readonly');
      const idx = tx.objectStore('expenses').index('recurringInstanceKey');
      const req = idx.get(key);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // Recurrentes (de gasto)
  getRecurring:     () => getAll('recurring'),
  addRecurring:     (r) => add('recurring', r),
  updateRecurring:  (r) => put('recurring', r),
  deleteRecurring:  (id) => remove('recurring', id),

  // Recurrentes de ingreso
  getRecurringIncome:    () => getAll('recurringIncome'),
  addRecurringIncome:    (r) => add('recurringIncome', r),
  updateRecurringIncome: (r) => put('recurringIncome', r),
  deleteRecurringIncome: (id) => remove('recurringIncome', id),
  putRecurringIncome:    (r) => put('recurringIncome', r),

  // Ingresos como líneas con fecha (v5)
  getIncomeEntries:  () => getAll('incomes'),
  getIncomeEntry:    (id) => getById('incomes', id),
  addIncomeEntry:    (i) => add('incomes', i),
  updateIncomeEntry: (i) => put('incomes', i),
  deleteIncomeEntry: (id) => remove('incomes', id),
  putIncomeEntry:    (i) => put('incomes', i),

  /** Idempotencia de la materialización de ingresos recurrentes (análogo a
   *  hasExpenseByInstanceKey, pero sobre el store `incomes`). */
  hasIncomeByInstanceKey: async (key) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('incomes', 'readonly');
      const idx = tx.objectStore('incomes').index('recurringInstanceKey');
      const req = idx.get(key);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // Ingresos LEGACY (agregado mensual, id = 'YYYY-MM'). Solo lectura/limpieza:
  // usado por la migración a `incomes` y por la importación de backups antiguos.
  getAllIncome: () => getAll('income'),

  // Ajustes clave-valor
  getSetting: (key) => getById('settings', key),
  setSetting: (key, value) => put('settings', { key, value }),

  // Mantenimiento (usado por importar backup en modo Reemplazar)
  clearStore,
  clearAll: () => Promise.all(
    ['categories', 'expenses', 'recurring', 'incomes', 'incomeCategories',
     'recurringIncome', 'income', 'settings'].map(clearStore)
  ),
  putCategory: (c) => put('categories', c),
  putExpense:  (e) => put('expenses', e),
  putRecurring:(r) => put('recurring', r),
};
