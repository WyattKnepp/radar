// Pure scan logic, shared by the page (app.js) and the tests.
//
// Needle angle is in degrees from notRad up: negative leans left
// (NOT RAD), positive leans right (RAD). The arc spans -90..90.

export const ARC_MAX = 90;

// Where a final reading may land for each result. The gap around 0 keeps
// every result clearly on one side.
export const ZONES = {
  notRad: [-78, -18],
  rad: [18, 78],
};

// The rigged part: the left half of the button reads RAD, the right half
// NOT RAD (opposite of where the needle ends up, so it's harder to spot).
// The exact center counts as right.
export function resultForTap(x, rect) {
  return x < rect.left + rect.width / 2 ? 'rad' : 'notRad';
}

// Compass rigging. Headings are compass degrees (0-360, clockwise from
// north) and every comparison goes around the circle.

export const normalizeHeading = (h) => ((h % 360) + 360) % 360;

// Smallest angle between two headings, 0..180.
export function circularDistance(a, b) {
  const d = Math.abs(normalizeHeading(a) - normalizeHeading(b));
  return d > 180 ? 360 - d : d;
}

const opposite = (label) => (label === 'rad' ? 'notRad' : 'rad');

// Label of the saved point {heading, label} nearest to the heading. With no
// points the result is a coin flip. With exactly one point the circle is
// split in half: a virtual point with the opposite label sits at heading+180.
// Ties go to the earlier point (a real point beats the virtual one).
export function classifyHeading(points, heading, rng = Math.random) {
  if (points.length === 0) return rng() < 0.5 ? 'rad' : 'notRad';
  const candidates = points.length === 1
    ? [points[0], { heading: points[0].heading + 180, label: opposite(points[0].label) }]
    : points;
  let best = candidates[0];
  let bestDist = circularDistance(heading, best.heading);
  for (const c of candidates.slice(1)) {
    const d = circularDistance(heading, c.heading);
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return best.label;
}

// Normal-mode result: the compass decides and the tapped side is ignored.
// Without a heading (no compass, or denied) it falls back to the tap rule.
export function resultForScan(points, heading, tapResult, rng = Math.random) {
  if (heading == null) return tapResult;
  return classifyHeading(points, heading, rng);
}

// Compass heading from a deviceorientation(absolute) event, or null.
// iOS gives webkitCompassHeading directly; Android's absolute alpha runs
// counterclockwise from north, so it is flipped.
export function headingFromEvent(e) {
  if (Number.isFinite(e.webkitCompassHeading)) return normalizeHeading(e.webkitCompassHeading);
  if (e.absolute && Number.isFinite(e.alpha)) return normalizeHeading(360 - e.alpha);
  return null;
}

const rand = (rng, min, max) => min + rng() * (max - min);

export function finalAngle(result, rng = Math.random) {
  const [min, max] = ZONES[result];
  return rand(rng, min, max);
}

// Plan one scan as a list of keyframes {at (ms), angle, ease}. Each keyframe
// is reached from the previous one using its ease ('inOut' or 'out').
// Random duration, swing count and amplitudes; at least one swing goes deep
// into the losing side, and it ends with an overshoot and a wobble.
export function planScan(result, rng = Math.random, startAngle = 0) {
  const duration = rand(rng, 2500, 4500);
  const final = finalAngle(result, rng);
  const winSign = result === 'rad' ? 1 : -1;

  const swings = Math.floor(rand(rng, 3, 7)); // 3..6 erratic swings
  const settleTime = rand(rng, 0.28, 0.38) * duration;
  const swingTime = duration - settleTime;

  // Uneven swing lengths so the rhythm isn't regular.
  const weights = Array.from({ length: swings }, () => rand(rng, 0.6, 1.4));
  const total = weights.reduce((a, b) => a + b, 0);

  // Start toward a random side, then alternate, sometimes doubling back.
  let side = rng() < 0.5 ? -1 : 1;
  const deepIndex = Math.floor(rng() * swings);
  const frames = [];
  let at = 0;
  for (let i = 0; i < swings; i++) {
    at += (weights[i] / total) * swingTime;
    let angle;
    if (i === deepIndex) {
      // The guaranteed fake-out: well into the side that won't win.
      angle = -winSign * rand(rng, 50, 84);
    } else {
      angle = side * rand(rng, 12, 86);
    }
    frames.push({ at, angle, ease: 'inOut' });
    side = rng() < 0.8 ? -Math.sign(angle) : Math.sign(angle);
  }

  // Settle: swing past the final angle, wobble back, come to rest.
  const overshoot = winSign * rand(rng, 6, 12);
  const back = winSign * rand(rng, 2, 4.5);
  const s1 = swingTime + settleTime * rand(rng, 0.4, 0.5);
  const s2 = swingTime + settleTime * rand(rng, 0.68, 0.78);
  frames.push({ at: s1, angle: clamp(final + overshoot), ease: 'out' });
  frames.push({ at: s2, angle: clamp(final - back), ease: 'inOut' });
  frames.push({ at: duration, angle: final, ease: 'out' });

  return { result, duration, final, start: startAngle, frames };
}

function clamp(a) {
  return Math.max(-ARC_MAX + 2, Math.min(ARC_MAX - 2, a));
}

const easings = {
  inOut: (t) => 0.5 - Math.cos(Math.PI * t) / 2,
  out: (t) => 1 - (1 - t) ** 3,
};

// Needle angle at time t (ms) into the scan.
export function angleAt(plan, t) {
  let prevAt = 0;
  let prevAngle = plan.start;
  for (const f of plan.frames) {
    if (t <= f.at) {
      const span = f.at - prevAt || 1;
      const p = easings[f.ease](Math.min(1, Math.max(0, (t - prevAt) / span)));
      return prevAngle + (f.angle - prevAngle) * p;
    }
    prevAt = f.at;
    prevAngle = f.angle;
  }
  return plan.final;
}
