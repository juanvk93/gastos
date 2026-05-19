/**
 * db.js — Capa IndexedDB
 *
 * Stores:
 *   categories  { id (autoIncrement), name, color, icon, monthlyLimitCents? }
 *   expenses    { id (autoIncrement), date, amountCents, description, categoryId, tags?, paidBy? }
 *   recurring   { id (autoIncrement), name, amountCents, categoryId, annual, active }
 *   income      { id ('YYYY-MM'), amountCents }
 *   settings    { key, value }   // 'annual-goal', 'people', etc.
 *
 * "annual" en recurring = true si el gasto es anualizado (se prorratea /12 al mes).
 */

const DB_NAME = 'gastos';
const DB_VERSION = 2;

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
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
        // id = 'YYYY-MM', único por mes
        db.createObjectStore('income', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
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

/* ---- API pública ---- */

window.DB = {
  version: DB_VERSION,
  open,
  seedCategories,

  // Categorías
  getCategories:    () => getAll('categories'),
  getCategory:      (id) => getById('categories', id),
  addCategory:      (c) => add('categories', c),
  updateCategory:   (c) => put('categories', c),
  deleteCategory:   (id) => remove('categories', id),

  // Gastos
  getExpenses:      () => getAll('expenses'),
  getExpense:       (id) => getById('expenses', id),
  addExpense:       (e) => add('expenses', e),
  updateExpense:    (e) => put('expenses', e),
  deleteExpense:    (id) => remove('expenses', id),

  // Recurrentes
  getRecurring:     () => getAll('recurring'),
  addRecurring:     (r) => add('recurring', r),
  updateRecurring:  (r) => put('recurring', r),
  deleteRecurring:  (id) => remove('recurring', id),

  // Ingresos mensuales (id = 'YYYY-MM')
  getAllIncome: () => getAll('income'),
  getIncome:   (year, month) => getById('income', `${year}-${String(month).padStart(2, '0')}`),
  setIncome:   (year, month, amountCents) => put('income', {
    id: `${year}-${String(month).padStart(2, '0')}`,
    amountCents,
  }),

  // Ajustes clave-valor
  getSetting: (key) => getById('settings', key),
  setSetting: (key, value) => put('settings', { key, value }),

  // Mantenimiento (usado por importar backup en modo Reemplazar)
  clearStore,
  clearAll: () => Promise.all(
    ['categories', 'expenses', 'recurring', 'income', 'settings'].map(clearStore)
  ),
  putCategory: (c) => put('categories', c),
  putExpense:  (e) => put('expenses', e),
  putRecurring:(r) => put('recurring', r),
  putIncome:   (i) => put('income', i),
};
