/**
 * icons.js — Catálogo de iconos SVG monocromáticos
 *
 * Cada icono se almacena como el contenido interior de un <svg> con viewBox 24x24.
 * Se renderiza con stroke=currentColor y fill=none, lo que permite adaptar el color
 * vía CSS y heredar del contexto (categoría, botón, etc.).
 *
 * - catalog: iconos visibles en el selector de categorías
 * - system: iconos de la interfaz (sol/luna, cerrar, editar)
 * - emojiMap: mapeo de emojis legacy a id de icono (compat. con datos antiguos)
 */

(function () {
  const CATALOG = [
    { id: 'home',        name: 'Hogar',         body: '<path d="M3 11l9-8 9 8M5 10v11h5v-7h4v7h5V10"/>' },
    { id: 'cart',        name: 'Compra',        body: '<path d="M3 4h2l2.5 12h11l2.5-9H6"/><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/>' },
    { id: 'car',         name: 'Coche',         body: '<path d="M5 12l2-5h10l2 5v6h-3v-2H8v2H5v-6z"/><circle cx="8" cy="15" r="1.5"/><circle cx="16" cy="15" r="1.5"/>' },
    { id: 'fuel',        name: 'Gasolina',      body: '<path d="M4 3h8a1 1 0 011 1v17H3V4a1 1 0 011-1zM3 10h10M14 8l3 1v9a2 2 0 002 2v-2"/>' },
    { id: 'bus',         name: 'Transporte',    body: '<rect x="3" y="3" width="18" height="15" rx="2"/><path d="M3 11h18M7 18v3M17 18v3"/><circle cx="7" cy="14" r="1"/><circle cx="17" cy="14" r="1"/>' },
    { id: 'train',       name: 'Tren',          body: '<rect x="5" y="3" width="14" height="14" rx="2"/><path d="M9 17l-2 4M15 17l2 4M5 10h14"/><circle cx="8" cy="13" r="1"/><circle cx="16" cy="13" r="1"/>' },
    { id: 'plane',       name: 'Avión',         body: '<path d="M22 11l-9-2-4-7-2 1 2 7-5 2 1 2 5-1 2 6 2-1-1-6 9-1z"/>' },
    { id: 'ticket',      name: 'Eventos',       body: '<path d="M3 9a2 2 0 012-2h14a2 2 0 012 2v1.5a1.5 1.5 0 000 3V15a2 2 0 01-2 2H5a2 2 0 01-2-2v-1.5a1.5 1.5 0 000-3V9z"/><path d="M14 7v10"/>' },
    { id: 'zap',         name: 'Electricidad',  body: '<path d="M13 2L4 14h6l-2 8 10-13h-6l1-7z"/>' },
    { id: 'flame',       name: 'Gas',           body: '<path d="M9 14c0-3 4-4 3-12 5 4 6 8 6 12a6 6 0 01-12 0c0-2 1-3 3-3z"/>' },
    { id: 'droplet',     name: 'Agua',          body: '<path d="M12 3c0 0-6 7-6 12a6 6 0 0012 0c0-5-6-12-6-12z"/>' },
    { id: 'wifi',        name: 'Internet',      body: '<path d="M5 13a10 10 0 0114 0M8 16a6 6 0 018 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>' },
    { id: 'phone',       name: 'Telefonía',     body: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>' },
    { id: 'monitor',     name: 'Suscripciones', body: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 22h8M12 18v4"/>' },
    { id: 'film',        name: 'Ocio',          body: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h4M3 15h4M17 9h4M17 15h4M7 5v14M17 5v14"/>' },
    { id: 'music',       name: 'Música',        body: '<circle cx="6" cy="18" r="3"/><circle cx="17" cy="15" r="3"/><path d="M9 18V5l11-2v12"/>' },
    { id: 'utensils',    name: 'Restaurante',   body: '<path d="M6 3v8M3 3v5a3 3 0 003 3M9 3v8M18 3v8c2 0 3-1 3-3V3M18 11v10M6 11v10"/>' },
    { id: 'coffee',      name: 'Café',          body: '<path d="M4 8h13v7a4 4 0 01-4 4H8a4 4 0 01-4-4V8zM17 10h2a2 2 0 010 4h-2M7 2v3M11 2v3M15 2v3"/>' },
    { id: 'wine',        name: 'Bar',           body: '<path d="M7 3h10v5a5 5 0 01-10 0V3zM12 13v8M8 21h8"/>' },
    { id: 'gift',        name: 'Regalos',       body: '<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M3 12h18M12 8v13M8 8a2.5 2.5 0 010-5c2 0 4 2.5 4 5M12 8c0-2.5 2-5 4-5a2.5 2.5 0 010 5"/>' },
    { id: 'heart',       name: 'Salud',         body: '<path d="M20 9a5 5 0 00-8-4 5 5 0 00-8 4c0 5 8 12 8 12s8-7 8-12z"/>' },
    { id: 'pill',        name: 'Medicación',    body: '<rect x="2" y="9" width="20" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="M8 8l8 8"/>' },
    { id: 'dumbbell',    name: 'Gimnasio',      body: '<path d="M3 9v6M6 6v12M18 6v12M21 9v6M6 12h12"/>' },
    { id: 'shield',      name: 'Seguros',       body: '<path d="M12 2l8 3v7c0 4-3 8-8 10-5-2-8-6-8-10V5l8-3z"/>' },
    { id: 'book',        name: 'Educación',     body: '<path d="M4 4a2 2 0 012-2h14v17H6a2 2 0 00-2 2V4zM6 19h14"/>' },
    { id: 'shirt',       name: 'Ropa',          body: '<path d="M8 3l4 3 4-3 5 3-2 5h-3v11H8V11H5L3 6z"/>' },
    { id: 'scissors',    name: 'Peluquería',    body: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L9 15M14 14l6 6M9 9l11 11"/>' },
    { id: 'paw',         name: 'Mascotas',      body: '<circle cx="6" cy="11" r="1.5"/><circle cx="18" cy="11" r="1.5"/><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><path d="M12 14a4 4 0 014 4c0 2-2 3-4 3s-4-1-4-3a4 4 0 014-4z"/>' },
    { id: 'tools',       name: 'Reparaciones',  body: '<path d="M14.7 6.3a4 4 0 105 5L21 11l-2-2-1 1-2-2 1-1-2-2-1.3 1.3zM12.5 8.5L4 17v3h3l8.5-8.5"/>' },
    { id: 'piggy-bank',  name: 'Ahorro',        body: '<path d="M4 13c0-4 4-7 8-7 5 0 8 3 8 7 0 2-1 4-3 5v2h-3v-1h-4v1H7v-2c-2-1-3-3-3-5zM4 11h2"/><circle cx="17" cy="11" r=".8" fill="currentColor" stroke="none"/>' },
    { id: 'credit-card', name: 'Banco',         body: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>' },
    { id: 'building',    name: 'Alquiler',      body: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 6h2M13 6h2M9 10h2M13 10h2M9 14h2M13 14h2M10 22v-4h4v4"/>' },
    { id: 'baby',        name: 'Bebé',          body: '<circle cx="12" cy="9" r="5"/><circle cx="10" cy="9" r=".5" fill="currentColor" stroke="none"/><circle cx="14" cy="9" r=".5" fill="currentColor" stroke="none"/><path d="M10 12c.5.5 1.2.8 2 .8s1.5-.3 2-.8M5 14c1 5 4 8 7 8s6-3 7-8"/>' },
    { id: 'globe',       name: 'Online',        body: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>' },
    { id: 'package',      name: 'Otros',         body: '<path d="M21 7L12 3 3 7v10l9 4 9-4V7zM3 7l9 4M21 7l-9 4M12 11v10"/>' },
    { id: 'trending-up',  name: 'Inversiones',   body: '<polyline points="22 7 13.5 15.5 8.5 10.5 1 18"/><polyline points="15 7 22 7 22 14"/>' },
  ];

  const SYSTEM = {
    sun:     '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    moon:    '<path d="M21 13a9 9 0 11-9-9 7 7 0 009 9z"/>',
    close:   '<path d="M6 6l12 12M6 18L18 6"/>',
    edit:    '<path d="M16 3l5 5L9 20H4v-5L16 3z"/>',
    warning: '<path d="M12 3L2 20h20L12 3z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".6" fill="currentColor" stroke="none"/>',
    menu:    '<path d="M3 6h18M3 12h18M3 18h18"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    plus:    '<path d="M12 5v14M5 12h14"/>',
  };

  // Compatibilidad con datos antiguos donde el icono se guardaba como emoji
  const EMOJI_MAP = {
    '🏠': 'home', '🏡': 'home',
    '🛒': 'cart', '🛍️': 'cart',
    '🚗': 'car',  '🚙': 'car',
    '⛽': 'fuel',
    '🚌': 'bus',
    '🚂': 'train', '🚆': 'train',
    '✈️': 'plane',
    '🎫': 'ticket',
    '⚡': 'zap', '💡': 'zap',
    '🔥': 'flame',
    '💧': 'droplet', '🚿': 'droplet',
    '📶': 'wifi', '🌐': 'wifi',
    '📱': 'phone', '☎️': 'phone',
    '📺': 'monitor', '💻': 'monitor',
    '🎬': 'film', '🎥': 'film',
    '🎵': 'music', '🎶': 'music',
    '🍽️': 'utensils', '🍴': 'utensils',
    '☕': 'coffee',
    '🍷': 'wine', '🍺': 'wine',
    '🎁': 'gift',
    '❤️': 'heart', '🏥': 'heart',
    '💊': 'pill',
    '🏋️': 'dumbbell', '🏃': 'dumbbell',
    '🛡️': 'shield',
    '📚': 'book', '🎓': 'book',
    '👕': 'shirt', '👔': 'shirt',
    '✂️': 'scissors', '💇': 'scissors',
    '🐾': 'paw', '🐕': 'paw', '🐈': 'paw',
    '🔧': 'tools', '🛠️': 'tools',
    '🐷': 'piggy-bank',
    '💳': 'credit-card', '🏦': 'credit-card',
    '🏢': 'building',
    '👶': 'baby',
    '📦': 'package',
  };

  const REGISTRY = {};
  CATALOG.forEach(i => { REGISTRY[i.id] = i; });
  Object.entries(SYSTEM).forEach(([id, body]) => { REGISTRY[id] = { id, body }; });

  function resolve(input) {
    if (!input) return null;
    if (REGISTRY[input]) return input;
    return EMOJI_MAP[input] || null;
  }

  function svg(input, size = 16) {
    const id = resolve(input);
    if (!id) return '';
    const icon = REGISTRY[id];
    return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon.body}</svg>`;
  }

  function el(input, size = 16, extraClass = '') {
    const span = document.createElement('span');
    span.className = `ico-wrap ${extraClass}`.trim();
    span.innerHTML = svg(input, size);
    return span;
  }

  function name(id) {
    const icon = REGISTRY[id];
    return icon && icon.name ? icon.name : '';
  }

  function has(input) {
    return !!resolve(input);
  }

  window.Icons = {
    catalog: CATALOG,
    resolve,
    svg,
    el,
    name,
    has,
  };
})();
