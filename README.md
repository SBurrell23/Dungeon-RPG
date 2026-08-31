# Dungeon RPG

A vanilla-JS, peer-to-peer top-down dungeon crawler. One to four players pick from
seven classes and descend ten procedurally generated floors. There is no way back up.

No build step, no framework, no bundler — ES modules and a canvas.

---

## Running it

The game **must be served over http://**; browsers refuse ES modules on `file://`.

```bash
python serve.py
```

That starts a threaded, no-cache static server on <http://localhost:8123> and opens
your browser. On Windows you can double-click `run.bat` instead. Any static server
works (`npx serve`, `php -S`, …) — `serve.py` just adds no-cache headers so editing a
module and hitting reload actually shows the edit.

### Playing together

1. One player clicks **Host a Party** and reads out the five-character room code.
2. Everyone else types it into the box and clicks **Join**.
3. Pick classes, ready up, host clicks **Begin Descent**.

Connections are WebRTC via [PeerJS](https://peerjs.com) using their free public broker
for signalling only — no game traffic touches a server. **Play Solo** skips networking
entirely.

### Controls

| | |
|---|---|
| `WASD` | Move |
| Mouse | Aim (your character always faces the cursor) |
| Left mouse | Basic attack |
| `1` `2` `3` `4` | Hotbar abilities |
| `Q` / `R` | Drink health / mana potion |
| `E` | Open chests, talk to merchants, take the stairs |
| `Shift` | Dash (brief invulnerability) |
| `I` / `C` / `P` | Inventory / character sheet / spellbook |
| `M` | Full floor map |
| `Space` | While downed: switch which ally you are watching |
| `Esc` | Options, or close the open panel |

---

## How a run works

Ten floors, each larger and meaner than the last. Every floor has one **boss chamber**
holding the stairway; the stairs stay sealed until everything in that room is dead.
Descending is one-way and acts as the checkpoint — the party is restored to their feet
on arrival.

Scattered through each floor: chests, hidden traps, a merchant who buys and sells, a
shrine that fully restores the party once, and a treasure vault. The minimap fills in
as you explore.

When a player dies they are **downed**, not gone. They keep watching through a
teammate's eyes and can be raised by a Resurrection tome or a Draught of Return —
both of which are deliberately rare and do not appear before floor 5. If everyone goes
down, the run ends and you get a full stat screen.

**The host autosaves to `localStorage` every 20 seconds and on every descent.** If
someone disconnects or you want to stop for the night, the host picks **Continue Run**
from the main menu.

---

## Project layout

```
index.html            markup for every screen and the HUD
css/style.css         all UI styling
serve.py              dev server (threaded, no-cache)

js/
  main.js             orchestrator: boot, menu flow, game loop, net glue

  core/               engine primitives, no game knowledge
    rng.js            seeded mulberry32 - the whole dungeon derives from this
    loop.js           fixed 60 Hz simulation, decoupled render
    input.js          keyboard/mouse -> the intent object that also goes on the wire
    events.js         tiny synchronous event bus
    util.js           maths and array helpers

  assets/
    manifest.js       every asset path and atlas coordinate in the project
    loader.js         image loading, sprite-sheet slicing, palette recolouring

  gen/
    dungeon.js        BSP room graph, corridors, roles, props, spawns
    autotile.js       quadrant autotiler + rock rim

  game/
    stats.js          stat model, damage/mitigation, level and monster curves
    classes.js        the seven classes
    abilities.js      ability registry (basic attacks, class skills, tomes)
    items.js          equipment rolling, affixes, consumables, loot tables
    monsters.js       bestiary and bosses
    entities.js       entity construction, animation state, buffs
    ai.js             flow-field pathing and monster behaviours
    world.js          the simulation and every verb abilities can call
    save.js           host-side autosave

  render/
    camera.js         following camera with look-ahead and shake
    tilemap.js        chunked terrain baking
    renderer.js       sprites, particles, overhead bars, lighting

  ui/
    ui.js             screen stack, tooltips, item rendering helpers
    lobby.js          menu and party lobby
    hud.js            bars, hotbar, party frames, objective
    panels.js         inventory, character sheet, spellbook, shop
    minimap.js        fog-of-war minimap and full map
    endscreen.js      run summary

  net/
    net.js            PeerJS transport (star topology, host at the centre)
    protocol.js       message types, snapshot encoding, floor manifests
```

---

## Design notes

Things worth knowing before you extend it.

### The seed is the map

`generateFloor(seed, floorNo, partySize)` is pure and deterministic. The host sends a
seed string; every client regenerates a byte-identical floor. No terrain, prop or
decoration data ever crosses the network — and the same property is what lets the save
file store a floor in a few kilobytes instead of megabytes.

Merchant inventories are generated from `seed:shop:floor` for the same reason.

### Generation is a room graph, not a cave

A BSP partition guarantees rooms never overlap and hands you an obvious spanning tree
to carve corridors along, so connectivity is *structural* rather than something to
verify and hope for. Extra chord edges between nearby rooms turn the tree into a graph
with loops, which is what stops a floor feeling like a branching maze. Room *shapes*
(rectangles, ovals, cellular-automata caves, crosses, pillared halls) hide the grid.

Entrance and boss rooms are placed at the two ends of the room graph's diameter, so
every floor demands a real traversal.

After carving there are three cleanup passes — smoothing, largest-region pruning, and
a pit pass that reverts any chasm which would cut the floor in half. `generateFloor`
has been run across hundreds of seeds with a full connectivity assertion.

### Terrain rendering

The art pack stores ground as a *blob autotile*: a 3×3 set of edges and convex corners
plus four concave corners. `gen/autotile.js` composes each 48px tile from four 24px
quadrants, choosing each quadrant from the three mask cells that touch that corner.
That yields the full 47-case behaviour from 13 source tiles, and it works for any
mask — which is how accent patches (moss, gravel) get properly rounded edges instead
of looking like coloured-in rectangles.

The rock rim where floor meets void is sampled out of the cavern sheet's pit prefab.
Its south edge is deliberately taller: in the source art that edge is the lit front
face of the rock, and it is what gives the caverns their sense of depth.

Terrain is baked into 576px chunks on demand and evicted LRU, so scrolling costs one
bake per newly-visible chunk and nothing after that.

### Sprites mirror, they do not rotate

The characters are top-down and drawn facing **right**. The renderer mirrors them
horizontally to face left and never rotates them, so there are only two facings.
Aiming near-vertical would otherwise flip the sprite back and forth every frame, so
`facesLeft()` keeps the last decision until the aim is clearly to one side.

The shadow-free sheets are used and the shadow is drawn separately, because mirroring
a sprite mirrors its baked drop shadow with it.

### Networking is host-authoritative

The host simulates everything. Clients predict only their own movement and reconcile
against the host's position (blend under 90px of error, snap over it). There is no
second copy of the AI anywhere, so there is nothing to desync.

Clients send an intent packet at 30 Hz; the host broadcasts a snapshot at 20 Hz plus a
compact event stream for the things a snapshot cannot express (damage numbers, sounds,
level-ups, chest opens). Inventory changes are request/response: the client asks, the
host applies, the host returns the authoritative character.

Snapshots only include monsters within 1500px of a player, capped at 90.

### The ability API is the extension point

Every ability is a description plus a `cast(ctx)` that calls verbs on the world:
`melee`, `fireProjectile`, `explode`, `groundZone`, `chain`, `telegraph`, `applyBuff`,
`healAllies`, `blink`, `reviveNearest`… That small surface is deliberately the *only*
way anything affects the world, which is why a new spell is a data entry plus three
lines rather than a new system.

### Balance is tuned, not guessed

`stats.js` carries the numbers that matter. They were fitted against the actual monster
budget per floor:

- A single grunt takes **1.5–2.5 seconds** of focused attention on every floor. What
  changes with depth is how hard it hits and how many friends it brought.
- A party clearing ~88% of each floor arrives at roughly level **3, 4, 6, 9, 11, 16,
  20, 24, 28, 32** on floors 1–10.
- Bosses run **30–60 seconds** for a full party; their health scales with party size so
  four people do not melt them in a quarter of the time.
- A full run lands around **1–2 hours**.

---

## Extending it

**A new monster** — add an entry to `MONSTERS` in `game/monsters.js`. If it reuses
existing art, that is the only change; `sheet` points at any key in `MONSTER_SHEETS`.
Reusing a sprite at a higher level, a larger `scale` and a different `ai` genuinely
reads as a new enemy. New art needs one extra entry in `assets/manifest.js`.

**A new boss** — add to `BOSSES`. It reuses a base monster's art with its own scale,
stat multipliers and special list.

**A new spell** — add to `ABILITIES` in `game/abilities.js` with `tome: true` and a
`minFloor`, and it enters the drop and shop pools automatically.

**A new AI behaviour** — add to `BEHAVIOURS` in `game/ai.js` and name it in a monster's
`ai` field. Specials (charge, slam, summon, blink, enrage, volley) live in the same
file and are shared by every monster that lists them.

**A new item type** — `FAMILY_INFO` and `ICON_FAMILIES` map families to slots and icon
rows. Because the icon sheet's columns read left-to-right as increasing power, an
item's art is derived from its tier and rarity, so new tiers cost nothing.

**A new floor theme** — add to `THEMES` in `gen/dungeon.js`: a base floor variant, two
or three tonally-close accents and an ambient light colour.

### Debugging

`window.DUNGEON` exposes the live game — `world`, `camera`, `renderer`, `assets`,
`net`, `localPlayer`. Useful pokes:

```js
DUNGEON.renderer.enableLighting = false   // see the raw terrain
DUNGEON.camera.targetZoom = 0.6           // zoom out over the whole floor
DUNGEON.world.explored.fill(1)            // reveal the map
DUNGEON.world.stairsUnlocked = true       // skip the boss chamber
```

---

## Assets

Character sprites, terrain and icons are third-party art dropped in `assets/`. All
sound effects are synthesised at runtime in `audio/sfx.js` — there are no sample files.
The single background music track loops for the whole run, slowing slightly with depth.
