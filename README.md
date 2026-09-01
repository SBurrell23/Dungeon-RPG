# Dungeon RPG

A vanilla-JS, peer-to-peer top-down dungeon crawler. One to four players pick from
six classes and descend ten procedurally generated floors. There is no way back up.

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
| `I` / `C` / `P` / `B` | Character inventory / stats / spellbook / compendium |
| `M` | Full floor map |
| `Space` | While downed: switch which ally you are watching |
| `Esc` | Options and the full control list, or close the open panel |
| `Ctrl+Shift+~` | Dev console (testing tools, host only) |

Right-click an item in your bag for its options - equip or use it, or **drop it on
the ground**, where a teammate can pick it up. That is how the party trades gear.

---

## How a run works

Ten floors, each larger and meaner than the last. Every floor has one **boss chamber**
holding the stairway. To go down, stand on the descent marker for **ten uninterrupted
seconds** — take a hit or swing at anything and the ritual resets — so the chamber has
to be cleared first. Descending is one-way and acts as the checkpoint: the party is
restored to their feet on arrival.

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
    classes.js        the six playable classes
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
    sync.js           prediction, reconciliation, host-side intent bookkeeping
    events.js         applying the host's event stream to a client world

  version.js          build stamp, shown faintly bottom-right

tests/
  index.html          test runner page
  net-sim.js          four-player session with the transport taken out
  net-tests.js        regression cases, each named after the symptom
```

---

## Design notes

### Music follows the fight

Two tracks play at once and only one is turned up, so entering a boss chamber is
a crossfade rather than a stutter and a reload. The switch is driven by
`bossPresence()`: a living boss close by, or anyone standing inside the boss
room. Room membership is the part that matters - a corridor running past the
chamber wall is metres away and has nothing to do with the fight.

### Traps are on a clock, not a trigger

Most traps no longer wait to be stepped on. A fire vent, a spike bed and a
crusher each run a cycle, and the frame of that cycle is a pure function of the
world clock and a per-trap offset - so every client animates them identically
without a byte of traffic, and the frame that hurts you is the frame you can
see. `TRAP_SHEETS` in the manifest names the damage window alongside the sheet
geometry, which keeps the two from drifting apart.

Only the host applies the damage. `updatePlayer` runs on clients too, so both
`checkTraps` and `updateTraps` return early off-host; a client that dealt trap
damage locally would double-count it against the host's authoritative value.

The bear trap is the one that still waits for a footfall - it bites once, hard,
and is finished. Crushers only generate in corridors two or three tiles across,
because a ram needs an opposing wall to close against; in an open room you would
simply walk around it.

### Levels, shops and the gap between them

Monster level climbs linearly with depth while XP-to-level used to climb as
L^1.70, so a party fell further behind the deeper it went - six levels under the
monsters by floor 10, which also put every merchant item out of reach. The curve
is now fitted so that clearing about three quarters of a floor keeps you level
with it. `expectedLevelForFloor` is the single reference the rest of the game
balances against, so "right for this floor" and "right for this party" cannot
drift apart again: a merchant stocks against it rather than against the floor
number, which is what used to put its window several levels out of reach.

### The build stamp

`js/version.js` holds a version and a build date, rendered faintly in the bottom-right
corner on every screen. Bump it when you ship. It exists so that a bug report and the
deployed game can be checked against each other before anyone goes looking for a fault
that was fixed two builds ago.

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

Leaves are kept small and roughly constant with depth, so a floor is many modest
chambers joined by short halls rather than a handful of large open ones - deeper
floors get *more* rooms, not bigger ones. A minority of rooms fill their whole leaf,
which keeps the occasional hall worth walking into.

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
bake per newly-visible chunk and nothing after that. Each chunk is finished with a
per-floor tint multiplied over it - near-white colours that shift the cast of a floor
without recolouring the art, which is what makes the tenth floor feel unlike the
first using one tileset.

### Smooth movement

The simulation is a fixed 60 Hz while frames arrive at the display rate, so the
renderer blends each body from its previous tick position toward its current one by
the loop's leftover alpha - without that, a 144 Hz display draws the same position
twice and then jumps. The camera translation is separately snapped to whole device
pixels, because at nearest-neighbour scaling a fractional offset makes every terrain
pixel shimmer as it rounds one way or the other.

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
level-ups, chest opens). Alongside those, each client gets its own volatile numbers -
xp, gold, mana, cooldowns - at 10 Hz, because the shared snapshot has no room for
per-player detail and waiting for the next inventory action to carry them left the xp
bar frozen. Inventory changes are request/response: the client asks, the host applies,
the host returns the authoritative character.

Snapshots only include monsters within 1500px of a player, nearest first and capped at
90, and carry the ids of any the host has retired so a corpse does not linger on every
client. They also carry each animation's `loop` flag - without it the renderer wraps
every animation and a dead body replays its death forever - and the attack wind-up
telegraphs, which used to exist only on the host, so everyone else was dodging attacks
that gave them no tell.

Monsters born mid-floor - a boss's summoned adds, a slime's children - are announced on
the event stream, because the floor manifest went out long before they existed. So are
sprung traps, whose state otherwise only travelled in the manifest. Both carry the floor
they belong to: `loadFloor` clears the event queue, and the client checks the stamp, so
a straggler cannot conjure a monster onto the floor after the one it came from.

An intent separates *held* inputs (movement, aim, the attack button) from *edge* flags
(dash, ability slots, use-potion, interact). Held inputs come from the latest packet, so
releasing a button turns them off; edge flags are OR-ed in so a tap between two sends is
not swallowed, then cleared by the tick that acts on them. Held inputs persist between
packets - a walking player keeps walking - but only for `INPUT_TIMEOUT` (0.6s). Past
that the host treats the client as gone quiet and neutralises the intent, which is what
stops an alt-tabbed player (browsers suspend a hidden tab's frame loop, so it stops
sending) from running into a wall swinging forever.

`js/net/sync.js` holds the parts of this that are pure state transforms, which is what
makes them testable without a transport - see **Netcode tests** below.

### The ability API is the extension point

Every ability is a description plus a `cast(ctx)` that calls verbs on the world:
`melee`, `fireProjectile`, `explode`, `groundZone`, `chain`, `telegraph`, `applyBuff`,
`healAllies`, `blink`, `reviveNearest`… That small surface is deliberately the *only*
way anything affects the world, which is why a new spell is a data entry plus three
lines rather than a new system.

### Balance is tuned, not guessed

`stats.js` carries the numbers that matter. They were fitted against the actual monster
budget per floor:

- A single grunt takes **1–3 seconds** of focused attention on every floor. What
  changes with depth is how hard it hits and how many friends it brought.
- Health and mana potions sit on **shared 14–20 second cooldowns** per kind, so a
  stack of twenty is not a second health bar.
- Loot is deliberately scarce: roughly **7 items on floor 1 rising to 22 on floor 10**
  per player, and about **3,000 gold across a whole run** against a top-tier item
  price of ~370g.
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

### Netcode tests

`tests/` runs a four-player session with the transport taken out: one authoritative host
world and three client worlds in the same page, wired together through the real protocol
and sync functions at the real rates with a simulated delay. PeerJS is the one part that
cannot be exercised offline, and it is also the part least likely to be wrong - it moves
tagged envelopes. What breaks is what either side does to a world around them.

Open <http://localhost:8123/tests/> and press **Run tests**, or from the console:

```js
const { runNetTests } = await import('/tests/net-tests.js');
console.table(runNetTests().results);
```

Each case is named after the symptom it used to produce ("a client that goes quiet stops
acting"), because that is how it will be recognised if it comes back. `NetSim` in
`tests/net-sim.js` also exposes `divergence()` and `monsterSync()` for poking at a
scenario by hand.

Note that a browser only runs `requestAnimationFrame` for the visible tab, so driving
several live clients at once in one browser is not possible - which is itself the reason
the input timeout exists.

### Dev console

Press `Ctrl+Shift+~` mid-run for the testing panel: god mode, noclip,
one-hit kills, 3x speed, reveal map, jump to any floor, unlock or clear the boss
chamber, grant levels/gold/loot/tomes, and teleport to the stairs or the merchant.

It is host-only, and everything in it drives `world.debug` flags or calls the same
verbs normal play uses - there is no separate "cheat" code path to keep in sync.

### Generation invariants

Two connectivity guarantees, both asserted rather than assumed:

- `pruneDisconnected` keeps only the largest floor region, and the pit pass reverts any
  chasm that would cut the floor in half.
- `pruneBlockingProps` adds each solid prop one at a time and keeps it only if the
  reachable set is unchanged. Boulders are up to three tiles wide and a torch lands in
  a doorway often enough to matter; without this, either can seal a corridor and strand
  the stairs. Verified at 100% reachability across every seed and floor tested.

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
