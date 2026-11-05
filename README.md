# Radar

A small zero-dependency PWA that shows a "scanner" dial. Tap SCAN and a needle
sweeps for a few seconds, then lands on one of two labels. The outcome is
decided by the device compass using a nearest-neighbor classifier over
labeled headings.

## How it works

**Headings and circular angle math.** Headings are compass degrees (0-360,
clockwise from north). Every comparison goes around the circle: a heading is
normalized with `((h % 360) + 360) % 360`, and the distance between two
headings is the smaller arc, `d = |a - b|`, then `360 - d` if `d > 180`
(range 0..180). So 359 and 1 are 2 degrees apart.

**Nearest-neighbor classifier.** Labeled points `{heading, label}` are kept in
memory. A scan returns the label of the point with the smallest circular
distance to the current heading. Decision boundaries sit midway between
neighboring points with different labels. Edge cases:

- no points: random 50/50
- one point: a virtual point with the opposite label is placed at heading + 180
- exact ties: the earlier saved point wins

**Training mode.** Triple-tap the dial to toggle it (no visual change; off by
default). While on, each SCAN tap saves the current heading with a label
chosen by which half of the button was tapped (left = `rad`, right =
`notRad`). Long-press the dial (~700 ms) to clear all points. Points are
memory-only, so reloading clears them.

**Compass.** iOS requests motion permission on first tap and reads
`webkitCompassHeading`; Android uses `deviceorientationabsolute`. Without a
heading, the tapped half of the button decides.

**Scan animation.** Duration (2.5-4.5 s), swing count and size, a fake-out,
an overshoot-and-wobble settle, and the final angle within the result zone
are all randomized. Taps during a scan are ignored.

## Zero dependencies

Plain ES modules in the browser and the Node standard library on the server
(`node:http`, `node:fs`). No build step. `public/logic.js` is a pure module
shared by the page and the tests; `server.js` is a small static server.

## Run it

```
npm start          # http://127.0.0.1:3000 (HOST / PORT env vars override)
npm test           # node:test: logic and server
npm run icons      # regenerate public/icons/*.png
```

On iPhone, open in Safari and choose Share, then Add to Home Screen.

## Configuration

Copy `.env.example` to `.env` and edit it (`.env` is gitignored; if it is
missing, the server falls back to `.env.example`):

```
VAR_A=rad
VAR_B=not rad
VAR_TITLE=Raddar
```

`VAR_TITLE` fills the page title, heading, iOS app title and manifest
`name`/`short_name`. `VAR_A` and `VAR_B` fill the two dial ends and the result
text. The server reads the file on each request and serves `/config.json`
from it, so no restart is needed; reload the page. There is no service
worker, so no cache to bump.
