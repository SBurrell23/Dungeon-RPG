import { cavern } from './cavern.js';
import { crypt } from './crypt.js';

/**
 * Terrain looks, selectable at runtime.
 *
 * Each entry owns everything about how a floor is painted - masonry, floors,
 * decor - behind one `bake` call, so a new look is a new module rather than a
 * rewrite, and the old one keeps working untouched. The generator stays
 * ignorant of all of it: it decides where rock and floor are, and the tileset
 * decides what they look like.
 */
export const TILESETS = { cavern, crypt };

export const DEFAULT_TILESET = 'crypt';

export function getTileset(id) {
  return TILESETS[id] || TILESETS[DEFAULT_TILESET] || cavern;
}
