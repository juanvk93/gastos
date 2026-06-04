/**
 * icons.js — Catálogo de iconos SVG (Lucide)
 *
 * Iconos basados en Lucide (https://lucide.dev, ISC license), almacenados como
 * el contenido interior de un <svg> con viewBox 24x24. Se renderizan con
 * stroke=currentColor y fill=none, lo que permite adaptar el color vía CSS y
 * heredar del contexto (categoría, botón, etc.).
 *
 * - catalog: iconos visibles en el selector de categorías
 * - system: iconos de la interfaz (sol/luna, cerrar, editar)
 * - emojiMap: mapeo de emojis legacy a id de icono (compat. con datos antiguos)
 */

(function () {
  const CATALOG = [
    { id: 'home',        name: 'Hogar',         body: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />' },
    { id: 'cart',        name: 'Compra',        body: '<circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />' },
    { id: 'car',         name: 'Coche',         body: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" /><circle cx="7" cy="17" r="2" /><path d="M9 17h6" /><circle cx="17" cy="17" r="2" />' },
    { id: 'fuel',        name: 'Gasolina',      body: '<path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5" /><path d="M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16" /><path d="M2 21h13" /><path d="M3 9h11" />' },
    { id: 'bus',         name: 'Transporte',    body: '<path d="M8 6v6" /><path d="M15 6v6" /><path d="M2 12h19.6" /><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3" /><circle cx="7" cy="18" r="2" /><path d="M9 18h5" /><circle cx="16" cy="18" r="2" />' },
    { id: 'van',         name: 'Furgoneta',     body: '<path d="M13 6v5a1 1 0 0 0 1 1h6.102a1 1 0 0 1 .712.298l.898.91a1 1 0 0 1 .288.702V17a1 1 0 0 1-1 1h-3" /><path d="M5 18H3a1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h12c1.1 0 2.1.8 2.4 1.8l1.176 4.2" /><path d="M9 18h5" /><circle cx="16" cy="18" r="2" /><circle cx="7" cy="18" r="2" />' },
    { id: 'train',       name: 'Tren',          body: '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1" /><path d="m9 15-1-1" /><path d="m15 15 1-1" /><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z" /><path d="m8 19-2 3" /><path d="m16 19 2 3" />' },
    { id: 'plane',       name: 'Avión',         body: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />' },
    { id: 'ticket',      name: 'Eventos',       body: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M13 5v2" /><path d="M13 17v2" /><path d="M13 11v2" />' },
    { id: 'zap',         name: 'Electricidad',  body: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />' },
    { id: 'flame',       name: 'Gas',           body: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" />' },
    { id: 'droplet',     name: 'Agua',          body: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />' },
    { id: 'wifi',        name: 'Internet',      body: '<path d="M12 20h.01" /><path d="M2 8.82a15 15 0 0 1 20 0" /><path d="M5 12.859a10 10 0 0 1 14 0" /><path d="M8.5 16.429a5 5 0 0 1 7 0" />' },
    { id: 'phone',       name: 'Telefonía',     body: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2" /><path d="M12 18h.01" />' },
    { id: 'monitor',     name: 'Suscripciones', body: '<rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" />' },
    { id: 'tv-minimal-play', name: 'Streaming', body: '<path d="M15.033 9.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56V7.648a.645.645 0 0 1 .967-.56z" /><path d="M7 21h10" /><rect width="20" height="14" x="2" y="3" rx="2" />' },
    { id: 'film',        name: 'Ocio',          body: '<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18" /><path d="M3 7.5h4" /><path d="M3 12h18" /><path d="M3 16.5h4" /><path d="M17 3v18" /><path d="M17 7.5h4" /><path d="M17 16.5h4" />' },
    { id: 'music',       name: 'Música',        body: '<path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />' },
    { id: 'utensils',    name: 'Restaurante',   body: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />' },
    { id: 'coffee',      name: 'Café',          body: '<path d="M10 2v2" /><path d="M14 2v2" /><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" /><path d="M6 2v2" />' },
    { id: 'wine',        name: 'Bar',           body: '<path d="M8 22h8" /><path d="M7 10h10" /><path d="M12 15v7" /><path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z" />' },
    { id: 'gift',        name: 'Regalos',       body: '<path d="M12 7v14" /><path d="M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" /><path d="M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5" /><rect x="3" y="7" width="18" height="4" rx="1" />' },
    { id: 'heart',       name: 'Salud',         body: '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />' },
    { id: 'pill',        name: 'Medicación',    body: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" /><path d="m8.5 8.5 7 7" />' },
    { id: 'dumbbell',    name: 'Gimnasio',      body: '<path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z" /><path d="m2.5 21.5 1.4-1.4" /><path d="m20.1 3.9 1.4-1.4" /><path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z" /><path d="m9.6 14.4 4.8-4.8" />' },
    { id: 'shield',      name: 'Seguros',       body: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="M12 22V2" />' },
    { id: 'book',        name: 'Educación',     body: '<path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />' },
    { id: 'shirt',       name: 'Ropa',          body: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />' },
    { id: 'scissors',    name: 'Peluquería',    body: '<circle cx="6" cy="6" r="3" /><path d="M8.12 8.12 12 12" /><path d="M20 4 8.12 15.88" /><circle cx="6" cy="18" r="3" /><path d="M14.8 14.8 20 20" />' },
    { id: 'paw',         name: 'Mascotas',      body: '<circle cx="11" cy="4" r="2" /><circle cx="18" cy="8" r="2" /><circle cx="20" cy="16" r="2" /><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z" />' },
    { id: 'tools',       name: 'Reparaciones',  body: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" />' },
    { id: 'piggy-bank',  name: 'Ahorro',        body: '<path d="M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z" /><path d="M16 10h.01" /><path d="M2 8v1a2 2 0 0 0 2 2h1" />' },
    { id: 'credit-card', name: 'Banco',         body: '<rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" />' },
    { id: 'banknote-arrow-down', name: 'Nómina', body: '<path d="M12 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5" /><path d="m16 19 3 3 3-3" /><path d="M18 12h.01" /><path d="M19 16v6" /><path d="M6 12h.01" /><circle cx="12" cy="12" r="2" />' },
    { id: 'building',    name: 'Alquiler',      body: '<path d="M12 10h.01" /><path d="M12 14h.01" /><path d="M12 6h.01" /><path d="M16 10h.01" /><path d="M16 14h.01" /><path d="M16 6h.01" /><path d="M8 10h.01" /><path d="M8 14h.01" /><path d="M8 6h.01" /><path d="M9 22v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /><rect x="4" y="2" width="16" height="20" rx="2" />' },
    { id: 'baby',        name: 'Bebé',          body: '<path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5" /><path d="M15 12h.01" /><path d="M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1" /><path d="M9 12h.01" />' },
    { id: 'globe',       name: 'Online',        body: '<circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />' },
    { id: 'package',     name: 'Otros',         body: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /><path d="M12 22V12" /><polyline points="3.29 7 12 12 20.71 7" /><path d="m7.5 4.27 9 5.15" />' },
    { id: 'trending-up', name: 'Inversiones',   body: '<path d="M16 7h6v6" /><path d="m22 7-8.5 8.5-5-5L2 17" />' },
  ];

  const SYSTEM = {
    sun:      '<circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />',
    moon:     '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />',
    close:    '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
    edit:     '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />',
    warning:  '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />',
    menu:     '<path d="M4 5h16" /><path d="M4 12h16" /><path d="M4 19h16" />',
    calendar: '<path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" />',
    plus:     '<path d="M5 12h14" /><path d="M12 5v14" />',
    pause:    '<rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />',
    play:     '<polygon points="6 3 20 12 6 21 6 3" />',
    repeat:   '<path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" />',
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
