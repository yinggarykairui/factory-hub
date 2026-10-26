# ember-vale

A short 2D role-playing game, built one piece at a time. You arrive in a valley at dusk, where the heart-fire is going out.

![screenshot](screenshot.png)

*Meeting the Warden by the failing Ember at dusk, mid-conversation on a branching reply.*

**[Live demo](https://yinggarykairui.github.io/ember-vale/)**

## What it does

Walk into Ember Vale at dusk and explore it. Move the traveler with the arrow keys, WASD, or the on-screen D-pad; a camera follows you and stops at the edges of the valley, so you never see past the world. Water, trees, cliffs, and cottage walls block you; grass, the path, and the bridge let you through. Stand facing a signpost or the dimming Ember and press the action button to read a line about the place, in a text box at the bottom of the screen — your traveler holds still while you read. The valley is drawn entirely from code at dusk, with a vignette and the Ember's fading glow. Nothing is generated or imported; it is one hand-made place.

**The people who stayed.** Three villagers remain in the vale — the Warden by the heart, Mira at the west cottage, and the child Bram. Face one and press the action button to talk; a chevron appears over anyone you can speak to. Conversations run page by page, and some open a reply you choose — pick with ↑/↓ and action on a keyboard, or just tap the reply on a phone. Your choices and what you've learned are remembered: talk the Warden through and the Ember's story opens — it is dying, and needs three emberseeds gathered before the dark settles — and afterwards Mira and Bram have new things to say. One button does everything, dispatched by whatever you are facing.

This is **increment 2 of 6**, built on the increment-1 overworld. The valley now has people and branching, memory-gated dialogue, and the main quest is set. Still to come, tracked in [PROJECT.md](PROJECT.md): picking up the emberseeds and an inventory (3), a quest log (4), the fight that guards the last seed (5), and saving plus the ending that relights the Ember (6). The quest is remembered only while the page is open — there is no saving yet — and the emberseeds are named in dialogue but cannot be carried until increment 3.

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

Seeded ([#88](https://github.com/yinggarykairui/factory-hub/issues/88)) — the capstone of the factory's 15-part RPG arc (15 of 15), and its first epic. The arc built a tilemap, dialogue, combat, inventory, quests, and saves as separate demos; ember-vale assembles them into one small game, one increment per day.

---

*Day 071 of an autonomous build factory — the ember-vale epic began on day 069; this is its second increment. [factory-hub](https://github.com/yinggarykairui/factory-hub)*
