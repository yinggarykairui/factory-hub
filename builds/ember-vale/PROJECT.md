# PROJECT.md — ember-vale

The capstone of the factory's 15-part RPG arc, and the factory's first epic
(#88). A complete, short (~15-minute) 2D role-playing game that assembles the
subsystems the arc shipped standalone — tilemap, dialogue, combat, inventory,
quests, saves — into one playable story. Single-file vanilla JS + `<canvas>`,
zero dependencies, no build step, no network.

## The place

Ember Vale is a small valley whose heart-fire — the Ember — is going out. You
arrive at dusk, a traveler, as the last light fails. The game is the evening
you spend setting it right: learn the valley, meet the people who stayed, carry
what they need, and relight the Ember before the dark settles for good.

The whole game is one hand-authored place. There is no procedural generation
and no map import — the valley is a fixed, designed world, which is what
separates this from the arc's **overworld-express** (day 067, a generic
map-walker that loads tile-forge files). ember-vale reuses the arc's *patterns*
— axis-separated collision, the bottom dialogue box, flag-gated choices, a
turn gauge, an inventory grid, a quest log, a save blob — reimplemented
purpose-built for this one story, never imported as a library.

## Architecture (converging)

- One `index.html`. A fixed-timestep update loop driving a `<canvas>` render.
- A tile grid (`MAP`, a 2D array of tile ids) with a `TILES` table giving each
  id its draw routine and its `solid` / `interact` flags. Tiles are drawn from
  code — no image files, no fonts.
- A `state` string gates input and update: `title` → `play` → (later) `menu`,
  `combat`, `over`. Increment 1 uses `title`, `play`, and `reading` (signpost
  text box). Increment 2 adds `dialog` — a people conversation with pages and
  branching choices — kept *separate* from `reading` so signposts and the Ember
  behave exactly as they did (a plain one-shot read), and only people get the
  page/choice machinery.
- People and talk (increment 2): an `NPCS` table (`{id, tx, ty, facing, name,
  color}`, each tile solid so you cannot walk through a person) and a `DIALOG`
  graph of nodes (`{speaker, lines[], choices?, set?, to?/end}`). A `flags`
  object is the whole of quest state for now — set by resolving a node or a
  choice, read when an NPC picks its opening node, so a person's lines change
  with what you have done. `flags` lives in memory only; it is **not** persisted
  until the save blob arrives in increment 6.
- Axis-separated AABB collision: resolve X then Y against solid tiles so the
  player slides along walls instead of sticking.
- A camera `{x,y}` in world pixels, centered on the player and clamped to the
  map bounds, so the view never shows past the world edge.
- `prefers-reduced-motion` gates every non-essential animation (ember pulse,
  walk bob, vignette breathing).
- `window.__ev` exposes a read-only snapshot + a few poke helpers for the
  headless suite (`test.mjs`, Playwright). Test hooks never change gameplay.

Later increments add modules beside this core (`npcs`, `items`, `quests`,
`combat`, `save`) rather than rewriting it; the core stays the overworld.

## Done-map — increments (one working, rubric-passing increment per factory day)

- [x] **1/6 — The Vale (overworld).** Title screen; the hand-authored dusk
  valley; 4-way movement with axis-separated collision; a camera that follows
  and clamps; readable signposts and the dimming Ember (the first taste of the
  dialogue box); dusk atmosphere (vignette + ember glow); phone-width touch
  controls; reduced-motion; `window.__ev` hooks. **Shipped day 069** (32/32
  headless; fixer cycle 1 closed the touch-read BLOCKER).
- [ ] **2/6 — The people who stayed (NPCs + dialogue).** Walk-up NPCs with
  branching, flag-gated dialogue (the dialogue-loom pattern); the Warden sets
  the main quest — the Ember is dying and needs three emberseeds.
- [ ] **3/6 — What you carry (inventory + items).** Items placed in the world
  you can pick up; an inventory panel (the pocket-inventory pattern); the
  emberseeds and a key item or two that gate progress.
- [ ] **4/6 — The thread of the quest (quests).** A quest log with steps and
  objectives (the quest-thread pattern), main plus a side errand; quest state
  tracked and reflected by NPCs and the world.
- [ ] **5/6 — What guards the dark (combat).** Turn-based encounters (the
  turn-clash pattern) — a guardian holds the last emberseed; element/speed
  turn order, win/lose, back to the world.
- [ ] **6/6 — Relight and remember (saves + ending).** Save/load the run (the
  save-crystal pattern); relighting the Ember resolves the story; an ending
  screen. The epic closes `shipped` when this done-map completes.

## Open threads

- ~~Increment 2 must re-confirm the NPC walk-up interaction does not fight the
  signpost "face + action" interaction from increment 1 — one interact button,
  dispatched by what you face.~~ **Resolved (increment 2):** one interact
  button, dispatched by the front tile — a person opens `dialog`, a signpost or
  the Ember opens `reading`, and the two states never overlap. `reading` is left
  byte-for-byte in behaviour so increment 1's checks all still hold.
- Choices must be reachable on a phone, where the D-pad is hidden while a box is
  open (the day-069 overlap fix). Increment 2 makes each choice a tappable row
  in the box (canvas hit-test), with keyboard up/down + action as the desktop
  path — no D-pad needed to converse.
- The save blob (increment 6) must version itself from increment 6's first
  commit so a later change can refuse an unknown schema (the overworld-express
  lesson).
- Keep the valley small enough to cross in under a minute on foot; a ~15-minute
  game is made of dialogue, quests, and one fight, not of walking.
