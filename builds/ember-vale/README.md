# ember-vale

A short 2D role-playing game, built one piece at a time. You arrive in a valley at dusk, where the heart-fire is going out.

![screenshot](screenshot.png)

*The "What you carry" pouch open at dusk — a collected emberseed and the iron key — with the ✦ seed count in the corner.*

**[Live demo](https://yinggarykairui.github.io/ember-vale/)**

## What it does

Walk into Ember Vale at dusk and explore it. Move the traveler with the arrow keys, WASD, or the on-screen D-pad; a camera follows you and stops at the edges of the valley, so you never see past the world. Water, trees, cliffs, and cottage walls block you; grass, the path, and the bridge let you through. Stand facing a signpost or the dimming Ember and press the action button to read a line about the place, in a text box at the bottom of the screen — your traveler holds still while you read. The valley is drawn entirely from code at dusk, with a vignette and the Ember's fading glow. Nothing is generated or imported; it is one hand-made place.

**The people who stayed.** Three villagers remain in the vale — the Warden by the heart, Mira at the west cottage, and the child Bram. Face one and press the action button to talk; a chevron appears over anyone you can speak to. Conversations run page by page, and some open a reply you choose — pick with ↑/↓ and action on a keyboard, or just tap the reply on a phone. Your choices and what you've learned are remembered: talk the Warden through and the Ember's story opens — it is dying, and needs three emberseeds gathered before the dark settles — and afterwards Mira and Bram have new things to say. One button does everything, dispatched by whatever you are facing.

**What you carry.** The emberseeds are out in the valley now, and so is an iron key — each a glint of light you pick up just by walking onto it, with a small note of what you found. A ✦ counter in the corner keeps the tally of seeds, out of three. Press `I`, tap the counter, or tap the pouch button to open **What you carry**: a pouch of what you're holding, each with a line about it — move the selection with the arrow keys or a tap, close with `I`, Esc, or action. One seed is shut inside a cottage whose door is locked; find the iron key first, face the door, and it turns. Two seeds lie in the open — one by the old bridge, one up in the eastern heights where things are oldest.

This is **increment 3 of 6**, built on the increment-1 overworld and the increment-2 people. The valley now has items you pick up, a pouch to carry them, and one locked door the key opens. Still to come, tracked in [PROJECT.md](PROJECT.md): a quest log that tracks the steps (4), the fight that guards the last seed (5), and saving plus the ending that relights the Ember (6). What you carry and which doors you've opened are remembered only while the page is open — there is no saving yet — and reaching three seeds does not relight the Ember; that is the ending, increment 6.

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

*Day 073 of an autonomous build factory — the ember-vale epic began on day 069; this is its third increment. [factory-hub](https://github.com/yinggarykairui/factory-hub)*
