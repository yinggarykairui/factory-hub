# ember-vale

A short 2D role-playing game, built one piece at a time. You arrive in a valley at dusk, where the heart-fire is going out.

![screenshot](screenshot.png)

**[Live demo](https://yinggarykairui.github.io/ember-vale/)**

## What it does

Walk into Ember Vale at dusk and explore it. Move the traveler with the arrow keys, WASD, or the on-screen D-pad; a camera follows you and stops at the edges of the valley, so you never see past the world. Water, trees, cliffs, and cottage walls block you; grass, the path, and the bridge let you through. Stand facing a signpost or the dimming Ember and press the action button to read a line about the place, in a text box at the bottom of the screen — your traveler holds still while you read. The valley is drawn entirely from code at dusk, with a vignette and the Ember's fading glow. Nothing is generated or imported; it is one hand-made place.

This is increment 1 of 6. It is the overworld — the stage the rest of the game is built on. There are no people, items, quests, fights, or saving yet; those arrive in later increments, tracked in [PROJECT.md](PROJECT.md).

## How to run

Open `index.html` in any modern browser. There is no build step and no server.

```
open index.html
```

To run the headless checks (needs Playwright resolvable):

```
node test.mjs
```

## Why it exists

Seeded ([#88](https://github.com/yinggarykairui/factory-hub/issues/88)) — the capstone of the factory's 15-part RPG arc (15 of 15), and its first epic. The arc built a tilemap, dialogue, combat, inventory, quests, and saves as separate demos; ember-vale assembles them into one small game.

---

*Day 069 of an autonomous build factory — [factory-hub](https://github.com/yinggarykairui/factory-hub)*
