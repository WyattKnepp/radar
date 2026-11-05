import { resultForTap, resultForScan, headingFromEvent, planScan, angleAt } from './logic.js';

const app = document.querySelector('.app');
const needle = document.getElementById('needle');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
// Display strings come from config.json so the labels are swappable.
const config = await fetch('config.json', { cache: 'no-cache' }).then((r) => r.json());
const resultEl = document.getElementById('result');
const button = document.getElementById('scan');
const scanLabel = button.querySelector('.scan-label');
const dial = document.querySelector('.dial');

// Ticks every 10° across the arc, skipping the center so there's no
// middle marking.
const ticks = document.getElementById('ticks');
for (let a = -80; a <= 80; a += 10) {
  if (a === 0) continue;
  const r = (a * Math.PI) / 180;
  const inner = a % 30 === 0 ? 118 : 124;
  const x1 = 160 + inner * Math.sin(r), y1 = 170 - inner * Math.cos(r);
  const x2 = 160 + 131 * Math.sin(r), y2 = 170 - 131 * Math.cos(r);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1); line.setAttribute('y1', y1);
  line.setAttribute('x2', x2); line.setAttribute('y2', y2);
  line.setAttribute('stroke-width', a % 30 === 0 ? 2.2 : 1.2);
  line.setAttribute('opacity', a % 30 === 0 ? 0.9 : 0.5);
  ticks.appendChild(line);
}

const setNeedle = (deg) => needle.setAttribute('transform', `rotate(${deg.toFixed(2)} 160 170)`);

const PHRASES = ['Scanning', 'Analyzing', 'Calibrating', 'Reading aura', 'Cross-referencing', 'Analyzing'];

let mode = 'idle'; // idle | scanning | result
let angle = 0;
let plan = null;
let scanStart = 0;
let restAngle = 0;
let jitter = 0;
let phraseAt = 0;

function frame(now) {
  // Small smoothed random noise so the needle always looks "live".
  jitter += (Math.random() - 0.5) * 0.9 - jitter * 0.15;

  if (mode === 'idle') {
    angle = 7 * Math.sin(now / 1400) + 4 * Math.sin(now / 530 + 1.3) + jitter * 1.4;
  } else if (mode === 'scanning') {
    const t = now - scanStart;
    // Shake fades out during the settle so it comes to rest cleanly.
    const shake = Math.max(0, 1 - t / (plan.duration * 0.7));
    angle = angleAt(plan, t) + jitter * 3 * shake;
    if (now > phraseAt) {
      statusText.textContent = PHRASES[Math.floor(Math.random() * PHRASES.length)];
      phraseAt = now + 500 + Math.random() * 500;
    }
    if (t >= plan.duration) finish();
  } else {
    angle = restAngle + jitter * 0.3;
  }

  setNeedle(angle);
  requestAnimationFrame(frame);
}

function startScan(result) {
  plan = planScan(result, Math.random, angle);
  scanStart = performance.now();
  phraseAt = 0;
  mode = 'scanning';
  app.classList.add('scanning');
  statusEl.classList.remove('done');
  resultEl.classList.remove('show');
}

function finish() {
  mode = 'result';
  restAngle = plan.final;
  app.classList.remove('scanning');
  statusText.textContent = 'Scan complete';
  statusEl.classList.add('done');
  resultEl.innerHTML = `<small>RESULT:</small><b>${config.labels[plan.result].toUpperCase()}</b>`;
  resultEl.classList.add('show');
}

// Compass. readHeading() returns the latest heading in degrees or null; it
// is a plain function so tests can swap it out.
let latestHeading = null;
let readHeading = () => latestHeading;
export const setHeadingSource = (fn) => { readHeading = fn; };

const onOrientation = (e) => {
  const h = headingFromEvent(e);
  if (h != null) latestHeading = h;
};
function listenCompass() {
  window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);
}

// iOS asks for permission, and only from a user gesture. Other browsers
// just start listening.
let compassAsked = false;
function enableCompass() {
  if (compassAsked || typeof DeviceOrientationEvent === 'undefined') return;
  compassAsked = true;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then((state) => { if (state === 'granted') listenCompass(); })
      .catch(() => { compassAsked = false; });
  } else {
    listenCompass();
  }
}

// Training: while on, each scan saves (heading, tapped side) in memory only.
let training = false;
const points = [];

button.addEventListener('pointerdown', (e) => {
  button.classList.add('pressed');
  if (mode === 'scanning') return;
  const tapResult = resultForTap(e.clientX, button.getBoundingClientRect());
  const heading = readHeading();
  let result;
  if (training) {
    if (heading != null) points.push({ heading, label: tapResult });
    result = tapResult;
  } else {
    result = resultForScan(points, heading, tapResult);
  }
  startScan(result);
});
button.addEventListener('click', enableCompass);

// Dial: triple-tap toggles training, long-press (~700 ms) clears the points.
// Neither shows anything, except that a clear turns SCAN into SCON for 0.5 s.
const LONG_PRESS_MS = 700;
const TAP_MAX_MS = 350;
const TAP_GAP_MS = 500;
let pressTimer = null;
let pressAt = 0;
let pressX = 0;
let pressY = 0;
let taps = [];

function clearPoints() {
  points.length = 0;
  scanLabel.textContent = 'SCON';
  setTimeout(() => { scanLabel.textContent = 'SCAN'; }, 500);
}

dial.addEventListener('pointerdown', (e) => {
  enableCompass();
  pressAt = performance.now();
  pressX = e.clientX;
  pressY = e.clientY;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    pressTimer = null;
    taps = [];
    clearPoints();
  }, LONG_PRESS_MS);
});
dial.addEventListener('pointermove', (e) => {
  if (pressTimer && Math.hypot(e.clientX - pressX, e.clientY - pressY) > 12) {
    clearTimeout(pressTimer);
    pressTimer = null;
    taps = [];
  }
});
dial.addEventListener('pointerup', () => {
  if (!pressTimer) return; // was a long press or a drag
  clearTimeout(pressTimer);
  pressTimer = null;
  const now = performance.now();
  if (now - pressAt > TAP_MAX_MS) { taps = []; return; }
  taps = taps.filter((t) => now - t < TAP_GAP_MS * 2);
  if (taps.length && now - taps[taps.length - 1] > TAP_GAP_MS) taps = [];
  taps.push(now);
  if (taps.length >= 3) {
    taps = [];
    training = !training;
  }
});
dial.addEventListener('pointercancel', () => {
  clearTimeout(pressTimer);
  pressTimer = null;
  taps = [];
});
dial.addEventListener('selectstart', (e) => e.preventDefault());

const release = () => button.classList.remove('pressed');
button.addEventListener('pointerup', release);
button.addEventListener('pointercancel', release);
button.addEventListener('pointerleave', release);

// No context menus, gesture zoom or double-tap zoom anywhere.
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

requestAnimationFrame(frame);
