import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resultForTap, finalAngle, planScan, angleAt, ZONES,
  circularDistance, classifyHeading, resultForScan, headingFromEvent,
} from '../public/logic.js';

// Small seeded PRNG (mulberry32) so random runs are reproducible.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rect = { left: 40, width: 300 }; // center at x = 190

describe('logic: tap side (training and fallback)', () => {
  test('a tap left of center reads rad', () => {
    assert.equal(resultForTap(100, rect), 'rad');
  });
  test('a tap right of center reads notRad', () => {
    assert.equal(resultForTap(280, rect), 'notRad');
  });
  test('the far left edge reads rad', () => {
    assert.equal(resultForTap(40, rect), 'rad');
  });
  test('the far right edge reads notRad', () => {
    assert.equal(resultForTap(340, rect), 'notRad');
  });
  test('just either side of center splits the button exactly in half', () => {
    assert.equal(resultForTap(189.99, rect), 'rad');
    assert.equal(resultForTap(190, rect), 'notRad');
  });
});

describe('logic: final angle', () => {
  test('the rad zone is on the right and the notRad zone on the left', () => {
    assert.ok(ZONES.rad[0] > 0 && ZONES.notRad[1] < 0);
  });

  test('final angles always land inside the winning zone over many runs', () => {
    const rng = seeded(1);
    for (const result of ['rad', 'notRad']) {
      const [min, max] = ZONES[result];
      for (let i = 0; i < 5000; i++) {
        const a = finalAngle(result, rng);
        assert.ok(a >= min && a <= max, `${result}: ${a} outside [${min}, ${max}]`);
      }
    }
  });

  test('final angles vary from scan to scan', () => {
    const rng = seeded(2);
    const seen = new Set(Array.from({ length: 50 }, () => finalAngle('rad', rng).toFixed(1)));
    assert.ok(seen.size > 30);
  });
});

describe('logic: scan plan', () => {
  const plans = [];
  const rng = seeded(3);
  for (let i = 0; i < 2000; i++) {
    const result = i % 2 ? 'rad' : 'notRad';
    plans.push(planScan(result, rng, (rng() - 0.5) * 20));
  }

  test('every scan ends with the needle inside the winning zone', () => {
    for (const p of plans) {
      const [min, max] = ZONES[p.result];
      const end = angleAt(p, p.duration);
      assert.ok(end >= min && end <= max, `${p.result} ended at ${end}`);
      assert.equal(angleAt(p, p.duration + 1000), p.final);
    }
  });

  test('scans last between 2.5 and 4.5 seconds', () => {
    for (const p of plans) assert.ok(p.duration >= 2500 && p.duration <= 4500, String(p.duration));
  });

  test('every scan swings well into the losing side at least once', () => {
    for (const p of plans) {
      const lose = p.result === 'rad' ? -1 : 1;
      assert.ok(p.frames.some((f) => f.angle * lose >= 45), JSON.stringify(p.frames));
    }
  });

  test('every scan overshoots the final angle before settling', () => {
    for (const p of plans) {
      const win = p.result === 'rad' ? 1 : -1;
      const [overshoot, back] = p.frames.slice(-3);
      assert.ok((overshoot.angle - p.final) * win > 0, 'overshoot past final');
      assert.ok((back.angle - p.final) * win < 0, 'wobble back');
    }
  });

  test('the needle never leaves the arc during a scan', () => {
    for (const p of plans.slice(0, 200)) {
      for (let t = 0; t <= p.duration; t += 25) {
        const a = angleAt(p, t);
        assert.ok(a >= -90 && a <= 90, `angle ${a} at ${t}ms`);
      }
    }
  });

  test('keyframes are in time order and the scan starts from the current needle angle', () => {
    for (const p of plans) {
      let prev = 0;
      for (const f of p.frames) {
        assert.ok(f.at >= prev);
        prev = f.at;
      }
      assert.equal(angleAt(p, 0), p.start);
    }
  });

  test('no two scans look alike', () => {
    const keys = new Set(plans.map((p) => `${p.frames.length}:${p.frames.map((f) => f.angle.toFixed(0)).join(',')}`));
    assert.equal(keys.size, plans.length);
  });
});

const P = (heading, label) => ({ heading, label });
const never = () => { throw new Error('rng should not be used'); };
const example = [P(0, 'rad'), P(60, 'notRad'), P(90, 'rad'), P(180, 'notRad'), P(270, 'notRad')];

describe('logic: circular distance', () => {
  test('wraps around 0/360', () => {
    assert.equal(circularDistance(350, 10), 20);
    assert.equal(circularDistance(10, 350), 20);
    assert.equal(circularDistance(0, 360), 0);
  });
  test('never exceeds 180', () => {
    assert.equal(circularDistance(0, 180), 180);
    assert.equal(circularDistance(90, 300), 150);
  });
});

describe('logic: compass classification', () => {
  test('the example table gives the expected zones', () => {
    const expect = [
      [0, 'rad'], [20, 'rad'], [29, 'rad'], [31, 'notRad'], [60, 'notRad'], [74, 'notRad'],
      [76, 'rad'], [90, 'rad'], [134, 'rad'], [136, 'notRad'], [180, 'notRad'],
      [270, 'notRad'], [314, 'notRad'], [316, 'rad'], [359, 'rad'],
    ];
    for (const [h, label] of expect) assert.equal(classifyHeading(example, h, never), label, `heading ${h}`);
  });

  test('wraps around 0/360 when the nearest point is across the seam', () => {
    const pts = [P(350, 'notRad'), P(100, 'rad')];
    assert.equal(classifyHeading(pts, 5, never), 'notRad');
    assert.equal(classifyHeading(pts, 355, never), 'notRad');
    assert.equal(classifyHeading(pts, 80, never), 'rad');
  });

  test('headings outside 0-360 are treated circularly', () => {
    assert.equal(classifyHeading(example, 370, never), 'rad');
    assert.equal(classifyHeading(example, -10, never), 'rad');
  });

  test('no saved points gives a 50/50 random result', () => {
    assert.equal(classifyHeading([], 123, () => 0.2), 'rad');
    assert.equal(classifyHeading([], 123, () => 0.8), 'notRad');
    const rng = seeded(7);
    let rad = 0;
    for (let i = 0; i < 2000; i++) if (classifyHeading([], 0, rng) === 'rad') rad++;
    assert.ok(rad > 900 && rad < 1100, String(rad));
  });

  test('one point splits the circle in half, opposite label across', () => {
    const pts = [P(100, 'notRad')];
    assert.equal(classifyHeading(pts, 100, never), 'notRad');
    assert.equal(classifyHeading(pts, 11, never), 'notRad');
    assert.equal(classifyHeading(pts, 189, never), 'notRad');
    assert.equal(classifyHeading(pts, 191, never), 'rad');
    assert.equal(classifyHeading(pts, 280, never), 'rad');
    assert.equal(classifyHeading(pts, 9, never), 'rad');
    assert.equal(classifyHeading([P(10, 'rad')], 200, never), 'notRad');
  });

  test('ties are deterministic: the earlier saved point wins', () => {
    const a = [P(0, 'rad'), P(60, 'notRad')];
    const b = [P(60, 'notRad'), P(0, 'rad')];
    assert.equal(classifyHeading(a, 30, never), 'rad');
    assert.equal(classifyHeading(b, 30, never), 'notRad');
    for (let i = 0; i < 5; i++) assert.equal(classifyHeading(a, 30, never), 'rad');
  });

  test('a one-point exact tie goes to the real point', () => {
    assert.equal(classifyHeading([P(0, 'rad')], 90, never), 'rad');
  });
});

describe('logic: scan result in normal mode', () => {
  test('the compass decides and the tapped side is ignored', () => {
    assert.equal(resultForScan(example, 0, 'notRad', never), 'rad');
    assert.equal(resultForScan(example, 180, 'rad', never), 'notRad');
  });
  test('without a heading it falls back to the tapped side', () => {
    assert.equal(resultForScan(example, null, 'rad', never), 'rad');
    assert.equal(resultForScan([], null, 'notRad', never), 'notRad');
  });
});

describe('logic: heading from sensor events', () => {
  test('uses webkitCompassHeading on iOS', () => {
    assert.equal(headingFromEvent({ webkitCompassHeading: 123.5, alpha: 10 }), 123.5);
  });
  test('converts absolute alpha to a compass heading on Android', () => {
    assert.equal(headingFromEvent({ absolute: true, alpha: 90 }), 270);
    assert.equal(headingFromEvent({ absolute: true, alpha: 0 }), 0);
    assert.equal(headingFromEvent({ absolute: true, alpha: 350 }), 10);
  });
  test('ignores relative alpha and empty events', () => {
    assert.equal(headingFromEvent({ absolute: false, alpha: 90 }), null);
    assert.equal(headingFromEvent({ alpha: null, absolute: true }), null);
    assert.equal(headingFromEvent({}), null);
  });
});
