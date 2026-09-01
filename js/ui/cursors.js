/**
 * Aiming cursor styles.
 *
 * Each is an inline SVG so there is no asset to load and no extra request, and
 * each carries its own hotspot - the point the game actually aims at - which
 * has to sit dead centre or shots land where the art is rather than where the
 * player is pointing.
 *
 * All of them are drawn dark-outlined first and bright on top, so they stay
 * readable over both a lit floor and an unlit one.
 */

const svg = (body, w = 22) =>
  `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}" viewBox="0 0 ${w} ${w}">${body}</svg>') ${w / 2} ${w / 2}, crosshair`;

/** Outline pass then colour pass, from the same path data. */
const stroked = (paths, colour) =>
  `<g stroke="%23241a12" stroke-width="3.4" stroke-linecap="round" fill="none">${paths}</g>`
  + `<g stroke="${colour}" stroke-width="1.6" stroke-linecap="round" fill="none">${paths}</g>`;

export const CURSORS = {
  torch: {
    name: 'Torchlight',
    css: svg(
      stroked('<path d="M11 2.5 L11 7"/><path d="M11 15 L11 19.5"/><path d="M2.5 11 L7 11"/><path d="M15 11 L19.5 11"/>', '%23ffc45c')
      + '<circle cx="11" cy="11" r="1.6" fill="%23ffc45c" stroke="%23241a12" stroke-width="1"/>',
    ),
  },
  ring: {
    name: 'Iron Ring',
    css: svg(
      '<circle cx="11" cy="11" r="7" fill="none" stroke="%23241a12" stroke-width="3.6"/>'
      + '<circle cx="11" cy="11" r="7" fill="none" stroke="%23dfe4ee" stroke-width="1.6"/>'
      + '<circle cx="11" cy="11" r="1.4" fill="%23dfe4ee" stroke="%23241a12" stroke-width="1"/>',
    ),
  },
  rune: {
    name: 'Rune',
    css: svg(
      stroked('<path d="M11 3.5 L18.5 11 L11 18.5 L3.5 11 Z"/>', '%23b48aff')
      + '<circle cx="11" cy="11" r="1.5" fill="%23b48aff" stroke="%23241a12" stroke-width="1"/>',
    ),
  },
  highvis: {
    name: 'High Vis',
    // Deliberately the loudest option: a large hot-pink cross for anyone who
    // loses the cursor against a dark floor mid-fight.
    css: svg(
      '<g stroke="%23200a18" stroke-width="7" stroke-linecap="round">'
      + '<path d="M6 6 L22 22"/><path d="M22 6 L6 22"/></g>'
      + '<g stroke="%23ff2fd0" stroke-width="4" stroke-linecap="round">'
      + '<path d="M6 6 L22 22"/><path d="M22 6 L6 22"/></g>',
      28,
    ),
  },
};

export const DEFAULT_CURSOR = 'torch';

/** Point the game canvas at one of them. */
export function applyCursor(id) {
  const c = CURSORS[id] || CURSORS[DEFAULT_CURSOR];
  document.documentElement.style.setProperty('--cursor-aim', c.css);
}
