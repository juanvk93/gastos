/**
 * utils.js — Formateo, fechas y utilidades
 */

window.Utils = {
  /** Formatea céntimos a moneda EUR */
  fmtEUR(cents) {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'EUR',
    }).format((cents || 0) / 100);
  },

  /** Euros (string) a céntimos enteros.
   *  Robusto frente a separadores de miles y al separador decimal es-ES/en-US:
   *  el ÚLTIMO separador (',' o '.') que aparece se trata como decimal y el otro
   *  como separador de miles. Así "1.234,56" → 123456 y "1,234.56" → 123456.
   *  (Antes "1.234,56" se interpretaba erróneamente como 1,23 €.) */
  eurToCents(str) {
    let s = String(str).trim().replace(/[^\d.,-]/g, '');
    if (!s) return 0;
    const lastComma = s.lastIndexOf(',');
    const lastDot   = s.lastIndexOf('.');
    const lastSep   = Math.max(lastComma, lastDot);
    if (lastSep !== -1) {
      const digitsAfter = s.length - lastSep - 1;
      // El último separador es decimal solo si le siguen 1 o 2 dígitos.
      // Si le siguen 3 (p.ej. "1.000") es separador de miles, no decimal.
      if (digitsAfter >= 1 && digitsAfter <= 2) {
        const decSep  = lastComma > lastDot ? ',' : '.';
        const thouSep = decSep === ',' ? '.' : ',';
        s = s.split(thouSep).join('');   // elimina separadores de miles
        s = s.replace(decSep, '.');      // normaliza el decimal a punto
      } else {
        s = s.replace(/[.,]/g, '');      // sin decimal: todos son de miles
      }
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : Math.round(n * 100);
  },

  /** YYYY-MM-DD de hoy */
  today() {
    return new Date().toISOString().slice(0, 10);
  },

  /** Nombre completo del mes (1-12) */
  monthName(m) {
    return [
      'Enero','Febrero','Marzo','Abril','Mayo','Junio',
      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
    ][m - 1];
  },

  /** Nombre corto del mes (1-12) */
  monthShort(m) {
    return [
      'Ene','Feb','Mar','Abr','May','Jun',
      'Jul','Ago','Sep','Oct','Nov','Dic'
    ][m - 1];
  },

  /** Formatea ISO date a '14 may 2026'. Devuelve '' si el formato es inválido. */
  fmtDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  /** ¿Está la fecha ISO dentro del año-mes dado? */
  isInMonth(isoDate, year, month) {
    if (!isoDate) return false;
    const d = new Date(isoDate + 'T00:00:00');
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  },

  /** Crea un elemento con propiedades */
  el(tag, attrs = {}, ...children) {
    const elem = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') elem.className = v;
      else if (k === 'text') elem.textContent = v;
      else if (k === 'html') elem.innerHTML = v;
      else if (k.startsWith('on')) elem.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(elem.style, v);
      else elem.setAttribute(k, v);
    }
    for (const child of children) {
      if (typeof child === 'string') elem.appendChild(document.createTextNode(child));
      else if (child) elem.appendChild(child);
    }
    return elem;
  },

  /** Limpia hijos de un nodo */
  clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  },
};
