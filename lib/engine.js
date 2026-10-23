
import { badWord } from "./badwords";

/**
 * Mounts the mandrake field onto the markup rendered by app/page.tsx.
 * api.load()          -> Promise<{id, text}[]>   newest first
 * api.subscribe(cb)   -> unsubscribe fn; cb({id, text}) for each new row
 * api.plant(text)     -> Promise<{ok: true} | {ok: false, code, message}>
 * Returns a cleanup function.
 */
export function startMandragora(api) {
const cleanups = [];
const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); cleanups.push(() => t.removeEventListener(ev, fn, o)); };
const $ = s => document.querySelector(s);
const field = $("#field"), bgC = $("#bg"), fgC = $("#fg"), fxC = $("#fx"), input = $("#msg"), countEl = $("#count"), form = $("#plantForm"),
      toastEl = $("#toast"), statusEl = $("#status"), muteBtn = $("#mute");
const MAX = 100, COOLDOWN = 30000, GROUND = 78;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let canPlant = true;
let pool = new Map();
const plots = new Set();
const recent = [];
let drag = null, S = 100, cap = 8, hintEl = null, busy = false;
let G = { W: 0, H: 0, cx: 0, cy: 0, rx: 0, ry: 0 };

function store(k, v) {
  try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
}

/* ---------------- sound (synthesised, no files) ---------------- */
const audio = (() => {
  let ctx = null, master = null, noiseBuf = null, tugSrc = null, tugGain = null, tugFilt = null;
  let muted = store("mdk.muted") === "1";
  function init() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.85; master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
  }
  function setMuted(m) {
    muted = m; store("mdk.muted", m ? "1" : "0");
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.85, ctx.currentTime, 0.02);
  }
  function noise(dur, type, f0, f1, vol, t) {
    if (!ctx) return; t = t ?? ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur + 0.03);
  }
  function tone(type, f0, f1, dur, vol, t) {
    if (!ctx) return; t = t ?? ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.03);
  }
  function tugStart() {
    if (!ctx) return; tugStop();
    tugSrc = ctx.createBufferSource(); tugSrc.buffer = noiseBuf; tugSrc.loop = true;
    tugFilt = ctx.createBiquadFilter(); tugFilt.type = "bandpass"; tugFilt.Q.value = 1.4; tugFilt.frequency.value = 220;
    tugGain = ctx.createGain(); tugGain.gain.value = 0;
    tugSrc.connect(tugFilt).connect(tugGain).connect(master); tugSrc.start();
  }
  function tug(t) {
    if (!tugSrc) return; const now = ctx.currentTime;
    tugFilt.frequency.setTargetAtTime(200 + t * 1000, now, 0.03);
    tugGain.gain.setTargetAtTime(0.04 + t * 0.24, now, 0.03);
  }
  function tugStop() {
    if (!tugSrc) return;
    try { tugGain.gain.setTargetAtTime(0, ctx.currentTime, 0.03); tugSrc.stop(ctx.currentTime + 0.15); } catch (e) {}
    tugSrc = null;
  }
  function pop() { tone("sine", 950, 130, 0.14, 0.55); noise(0.07, "highpass", 2500, 900, 0.3); }
  function scream() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.03, base = 480 + Math.random() * 560, dur = 0.7 + Math.random() * 0.45;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
    g.gain.setValueAtTime(0.42, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f1 = ctx.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = 950 + Math.random() * 200; f1.Q.value = 2.5;
    const f2 = ctx.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = 2500; f2.Q.value = 4;
    const f2g = ctx.createGain(); f2g.gain.value = 0.6;
    f1.connect(g); f2.connect(f2g).connect(g); g.connect(master);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 20 + Math.random() * 14;
    const lg = ctx.createGain(); lg.gain.value = base * 0.07; lfo.connect(lg);
    [["sawtooth", 0], ["square", 18]].forEach(([type, det]) => {
      const o = ctx.createOscillator(); o.type = type; o.detune.value = det;
      const fr = o.frequency;
      fr.setValueAtTime(base * 0.7, t); fr.exponentialRampToValueAtTime(base * 1.55, t + 0.07);
      fr.exponentialRampToValueAtTime(base * 1.25, t + dur * 0.6); fr.exponentialRampToValueAtTime(base * 0.55, t + dur);
      lg.connect(fr); o.connect(f1); o.connect(f2); o.start(t); o.stop(t + dur + 0.05);
    });
    lfo.start(t); lfo.stop(t + dur + 0.05);
    noise(0.06, "highpass", 4200, 3000, 0.22, t);
  }
  function poof() { noise(0.3, "lowpass", 4200, 280, 0.35); tone("sine", 280, 1150, 0.16, 0.22); }
  function sprout() { tone("sine", 380, 920, 0.12, 0.28); if (ctx) tone("triangle", 760, 1500, 0.1, 0.12, ctx.currentTime + 0.08); }
  function squeak() { if (!ctx) return; const f0 = 700 + Math.random() * 500; tone("triangle", f0, f0 * 1.5, .09, .07); }
  function sink() { tone("sine", 520, 160, 0.2, 0.22); }
  return { init, setMuted, get muted() { return muted; }, tugStart, tug, tugStop, pop, scream, poof, sprout, sink, squeak };
})();


function syncMute() {
  muteBtn.setAttribute("aria-pressed", String(audio.muted));
  muteBtn.setAttribute("aria-label", audio.muted ? "소리 켜기" : "소리 끄기");
}
on(muteBtn, "click", () => { audio.init(); audio.setMuted(!audio.muted); syncMute(); });
syncMute();

/* ---------------- the mandrake: a root from the art sheet, crowned with hand-made leaves ---------------- */
function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const BODIES = ["r1a", "r1b", "r1c", "r1d", "r2a", "r2c", "r3a", "r3b", "r3c", "r3d"].map(k => `/sprites/b_${k}.webp`);
BODIES.forEach(src => { const i = new Image(); i.src = src; });
// [blade, shaded half, veins]
const LEAF_PALETTES = [
  ["#7FB55E", "#5E9446", "#C9E3A6"], ["#6DA552", "#4C7F3B", "#BEDC9A"], ["#9BC765", "#76A246", "#E0F0B8"],
  ["#5A9A6E", "#3E7552", "#B5DCC2"], ["#4F7D3E", "#35592A", "#A9C98F"], ["#8FA16A", "#6C7D4B", "#D3DDB6"],
  ["#A2CF7A", "#7BAA57", "#F0F8DA"], ["#6FAE7B", "#4B8A5A", "#F4E7A0"], ["#9C6A8E", "#6F4566", "#E3C6DA"],
  ["#C7804E", "#9A5A30", "#F1D2B4"], ["#B9554F", "#8A3632", "#F0C0B8"], ["#7E9B4A", "#5D7634", "#E8D98E"]
];
const LEAF_SHAPES = ["ovate", "lance", "heart", "round", "wavy", "serrate", "lobed", "long"];
const CROWN = [60, 69];
function leafProfile(shape, t, i) {
  const s = x => Math.max(0, Math.sin(Math.PI * Math.max(0, Math.min(1, x))));
  switch (shape) {
    case "lance": case "long": return Math.pow(s(t), 1.3);
    case "heart": return Math.pow(s(.16 + .84 * t), .6);
    case "round": return Math.pow(s(t), .45);
    case "wavy": return Math.pow(s(Math.pow(t, .8)), .75) * (1 + .14 * Math.sin(t * Math.PI * 10));
    case "serrate": return Math.pow(s(Math.pow(t, .8)), .75) * (i % 2 ? .86 : 1);
    case "lobed": return Math.pow(s(Math.pow(t, .8)), .7) * (.68 + .32 * Math.abs(Math.cos(t * Math.PI * 3.5)));
    default: return Math.pow(s(Math.pow(t, .8)), .75);
  }
}
function leafSVG(shape, ang, p, L, W, droop, pal, f) {
  const rad = ang * Math.PI / 180, bend = droop * Math.sign(Math.cos(rad) || 1);
  const N = shape === "serrate" ? 34 : 24, up = [], dn = [], M = t => [p + L * t, bend * t * t];
  for (let i = 0; i <= N; i++) {
    const t = i / N, [mx, my] = M(t), w = leafProfile(shape, t, i) * W;
    up.push(`${f(mx)} ${f(my - w)}`); dn.unshift(`${f(mx)} ${f(my + w * .92)}`);
  }
  if (shape === "heart") { up.unshift(`${f(p - W * .18)} ${f(-W * .35)}`); dn.push(`${f(p - W * .18)} ${f(W * .32)}`); }
  const mid = [];
  for (let i = 0; i <= 12; i++) { const [mx, my] = M(i / 12 * .95); mid.push(`${f(mx)} ${f(my)}`); }
  let veins = "";
  for (let k = 1; k <= 4; k++) {
    const t = k / 5.3, [mx, my] = M(t), w = leafProfile(shape, t + .12, 0) * W * .72, [ex] = M(Math.min(1, t + .14));
    veins += `M${f(mx)} ${f(my)} Q${f((mx + ex) / 2)} ${f(my - w * .4)} ${f(ex)} ${f(my - w)} M${f(mx)} ${f(my)} Q${f((mx + ex) / 2)} ${f(my + w * .4)} ${f(ex)} ${f(my + w * .95)} `;
  }
  return `<g transform="translate(${CROWN[0]} ${CROWN[1]}) rotate(${f(ang)})">
    <path d="M0 0 L${f(p + 1)} ${f(bend * .02)}" stroke="${pal[1]}" stroke-width="2" stroke-linecap="round"/>
    <path d="M${f(p)} 0 L${up.join(" L")} L${dn.join(" L")}Z" fill="${pal[0]}"/>
    <path d="M${f(p)} 0 L${up.join(" L")} L${[...mid].reverse().join(" L")}Z" fill="${pal[1]}" opacity=".55"/>
    <path d="M${mid.join(" L")}" stroke="${pal[2]}" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".9"/>
    <path d="${veins}" stroke="${pal[2]}" stroke-width=".8" fill="none" stroke-linecap="round" opacity=".75"/></g>`;
}
function mandrakeSVG(seed) {
  const r = rng(seed), R = (a, b) => a + (b - a) * r(), pick = a => a[Math.floor(r() * a.length)];
  const f = n => n.toFixed(1);
  const body = pick(BODIES), flip = r() < .5;
  const pal = pick(LEAF_PALETTES), pal2 = r() < .25 ? pick(LEAF_PALETTES) : pal;
  const shape = pick(LEAF_SHAPES), shape2 = r() < .3 ? pick(LEAF_SHAPES) : shape;
  const style = pick(["fan", "droop", "tuft", "pair", "fan", "droop"]);
  const size = R(.8, 1.35);
  let n, spread, Lr, Wr, droopR, pr;
  if (style === "droop") { n = 3 + Math.floor(r() * 3); spread = 68; Lr = [34, 50]; Wr = [.32, .45]; droopR = [10, 22]; pr = [3, 9]; }
  else if (style === "tuft") { n = 5 + Math.floor(r() * 4); spread = 34; Lr = [18, 32]; Wr = [.16, .26]; droopR = [0, 5]; pr = [1, 4]; }
  else if (style === "pair") { n = 2 + Math.floor(r() * 2); spread = 44; Lr = [22, 34]; Wr = [.38, .55]; droopR = [2, 8]; pr = [4, 10]; }
  else { n = 3 + Math.floor(r() * 4); spread = 52; Lr = [26, 44]; Wr = [.3, .46]; droopR = [2, 10]; pr = [2, 7]; }
  if (shape === "long") { Lr = [Lr[0] * 1.2, Lr[1] * 1.3]; Wr = [Wr[0] * .6, Wr[1] * .6]; }
  const list = [];
  for (let i = 0; i < n; i++) {
    const a = -90 + (n === 1 ? 0 : -spread + (2 * spread / (n - 1)) * i) + R(-8, 8);
    const L = R(...Lr) * size;
    list.push({ a, L, W: L * R(...Wr) * (shape === "round" ? 1.2 : 1), droop: R(...droopR) * size, p: R(...pr), shape: i % 2 && shape2 !== shape ? shape2 : shape, pal: i % 3 === 1 ? pal2 : pal });
  }
  list.sort((x, y) => Math.abs(y.a + 90) - Math.abs(x.a + 90));
  const leaves = list.map(l => leafSVG(l.shape, l.a, l.p, l.L, l.W, l.droop, l.pal, f)).join("");
  const tone = `brightness(${f(R(.9, 1.08))}) saturate(${f(R(.88, 1.15))}) hue-rotate(${f(R(-8, 8))}deg)`;
  return `<div class="mdk" style="--d:${f(-R(0, 3))}s">
    <svg class="lv" viewBox="0 0 120 200" aria-hidden="true"><g class="leaves">${leaves}</g></svg>
    <img class="body" src="${body}" alt="" draggable="false" style="filter:${tone};${flip ? "transform:scaleX(-1)" : ""}">
  </div>`;
}

/* ---------------- geometry: a ground plane tilted away from the viewer ---------------- */
function dims() {
  const W = field.clientWidth, H = field.clientHeight, narrow = W < 640;
  const rx = narrow ? W * 0.42 : W * 0.45;
  const ry = H * (narrow ? 0.29 : 0.3);
  G = { W, H, narrow, cx: W / 2, cy: H * 0.53, rx, ry };
  S = Math.max(40, Math.min(54, rx * 2 / 11));
  cap = Math.max(6, Math.min(48, Math.round(Math.PI * rx * ry * 0.7 / (S * S * 1.5))));
  return G;
}
// farther (higher on screen) plants are drawn smaller
const scaleAt = y => 0.72 + 0.4 * Math.max(0, Math.min(1, (y - (G.cy - G.ry)) / (2 * G.ry)));
function findSpot() {
  dims();
  for (let i = 0; i < 300; i++) {
    const t = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * 0.94;
    const x = G.cx + Math.cos(t) * G.rx * rad, y = G.cy + Math.sin(t) * G.ry * rad;
    const s = S * scaleAt(y);
    let ok = true;
    for (const p of plots) {
      const dx = (x - p.fx * G.W) / (s * 1.05), dy = (y - p.fy * G.H) / (s * 0.72);
      if (dx * dx + dy * dy < 1) { ok = false; break; }
    }
    if (ok) return { fx: x / G.W, fy: y / G.H };
  }
  return null;
}

/* ---------------- painting: white page, a quiet tilted ground ---------------- */
function sizeCanvas(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(G.W * dpr); c.height = Math.round(G.H * dpr);
  const ctx = c.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return ctx;
}
function ell(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2); }
function paintJungle() {
  const g = sizeCanvas(bgC);
  g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, G.W, G.H);
  sizeCanvas(fgC);
  sizeCanvas(fxC);
}

/* ---------------- plots ---------------- */
function layoutPlot(p) {
  const Sz = S * p.sc, k = Sz / 120, svgH = Sz * 200 / 120, el = p.el;
  el.style.left = (p.fx * 100) + "%"; el.style.top = (p.fy * 100) + "%";
  el.style.zIndex = String(10 + Math.round(p.fy * 1000));
  el.style.setProperty("--sh", (64 * k) + "px");
  const clip = el.querySelector(".clip");
  clip.style.left = (-Sz) + "px"; clip.style.width = (Sz * 2) + "px"; clip.style.height = (svgH + Sz) + "px";
  if (p.state === "ground") {
    p.svg.style.left = (Sz / 2) + "px"; p.svg.style.width = Sz + "px"; p.svg.style.height = svgH + "px"; p.svg.style.bottom = (-(svgH - GROUND * k)) + "px";
  }
  const m = el.querySelector(".mound"); m.style.width = (Sz * 0.56) + "px"; m.style.height = (Sz * 0.17) + "px";
  const g = el.querySelector(".grab"); g.style.width = (Sz * 0.78) + "px"; g.style.height = (62 * k + Sz * 0.22) + "px"; g.style.bottom = (-Sz * 0.1) + "px";
}
function makePlot(text, spot, delay) {
  const seed = (Math.random() * 4294967296) >>> 0;
  const el = document.createElement("div");
  el.className = "plot sprout";
  el.innerHTML = `<div class="clip"><div class="lift">${mandrakeSVG(seed)}</div></div><div class="mound"></div><div class="grab" tabindex="0" role="button" aria-label="만드라고라 뽑기"></div>`;
  el.style.setProperty("--delay", (delay || 0) + "ms");
  const vr = 0.78 + Math.random() * 0.44;
  const p = { el, text, fx: spot.fx, fy: spot.fy, vr, sc: scaleAt(spot.fy * G.H) * vr, state: "ground", svg: el.querySelector(".mdk") };
  layoutPlot(p);
  const grab = el.querySelector(".grab");
  grab.addEventListener("pointerdown", e => startDrag(e, p));
  grab.addEventListener("keydown", e => keyPull(e, p));
  field.insertBefore(el, fgC);
  plots.add(p);
  setTimeout(() => el.classList.remove("sprout"), 800 + (delay || 0));
  return p;
}
function removePlot(p) {
  plots.delete(p);
  p.el.classList.add("gone");
  setTimeout(() => p.el.remove(), 320);
}
function pickText() {
  const onField = new Set([...plots].map(p => p.text));
  const all = [...pool.values()];
  let c = all.filter(t => !onField.has(t) && !recent.includes(t));
  if (!c.length) c = all.filter(t => !onField.has(t));
  if (!c.length) c = all;
  return c[Math.floor(Math.random() * c.length)];
}
function refill(initial) {
  if (!pool.size) return;
  dims();
  let i = 0;
  while (plots.size < cap) {
    const spot = findSpot(); if (!spot) break;
    makePlot(pickText(), spot, initial ? i * 25 : 0);
    i++;
  }
  if (initial) showHint();
}
function showHint() {
  if (hintEl || store("mdk.pulled") === "1" || !plots.size) return;
  const first = [...plots].sort((a, b) => Math.hypot(a.fx - .5, a.fy - .5) - Math.hypot(b.fx - .5, b.fy - .5))[0];
  hintEl = document.createElement("div");
  hintEl.className = "hint";
  hintEl.textContent = "잎을 잡고 위로 당겨보세요";
  hintEl.style.left = Math.max(100, Math.min(G.W - 100, first.fx * G.W)) + "px";
  hintEl.style.top = Math.max(60, first.fy * G.H - S * 1.05) + "px";
  field.appendChild(hintEl);
}
function hideHint() { if (hintEl) { hintEl.remove(); hintEl = null; } }

/* ---------------- pulling ---------------- */
const popDist = () => Math.max(80, S * 0.95);
function startDrag(e, p) {
  if (drag || p.state !== "ground" || e.button > 0) return;
  e.preventDefault();
  audio.init();
  drag = { p, id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, popped: false };
  p.svg.classList.add("tug");
  audio.tugStart();
  hideHint();
}
function tug() {
  const { p } = drag;
  const dy = Math.max(0, drag.y0 - drag.lastY), dx = drag.lastX - drag.x0;
  const t = Math.min(1, dy / popDist());
  const jit = reduceMotion ? 0 : t * 3;
  const rise = t * S * 0.42;
  p.svg.style.transform = `translate(${((Math.random() - .5) * jit).toFixed(1)}px, ${(-rise + (Math.random() - .5) * jit).toFixed(1)}px)`;
  p.svg.style.setProperty("--stretch", (1 + t * 0.4).toFixed(3));
  p.svg.style.setProperty("--tilt", Math.max(-25, Math.min(25, dx * 0.25)).toFixed(1) + "deg");
  p.el.querySelector(".mound").style.transform = `translate(-50%,-55%) scale(${(1 + t * .15).toFixed(3)},${(1 + t * .3).toFixed(3)})`;
  audio.tug(t);
  if (dy >= popDist()) doPop();
}
function doPop() {
  const p = drag.p;
  drag.popped = true; p.state = "out";
  const rect = p.svg.getBoundingClientRect();
  const ground = p.el.getBoundingClientRect();
  const held = document.createElement("div"); held.className = "held";
  const K = 1;
  held.style.width = rect.width * K + "px"; held.style.height = rect.height * K + "px";
  const wig = document.createElement("div"); wig.className = "wiggle";
  p.svg.style.transform = ""; p.svg.style.removeProperty("--stretch"); p.svg.style.removeProperty("--tilt");
  p.svg.style.width = ""; p.svg.style.height = ""; p.svg.style.bottom = ""; p.svg.style.left = "";
  p.svg.classList.remove("tug"); p.svg.classList.add("out");
  wig.appendChild(p.svg); held.appendChild(wig); document.body.appendChild(held);
  p.el.classList.add("empty");
  p.el.querySelector(".mound").style.transform = "";
  drag.held = held;
  drag.offX = drag.lastX - rect.left; drag.offY = drag.lastY - rect.top;
  const b = document.createElement("div"); b.className = "bubble"; b.textContent = p.text;
  document.body.appendChild(b); drag.bubble = b;
  moveHeld();
  startStruggle(drag, wig);
  if (!reduceMotion) {
    b.animate([{ scale: .4, opacity: 0 }, { scale: 1.06, opacity: 1, offset: .6 }, { scale: 1, opacity: 1 }], { duration: 260, easing: "ease-out" });
  }
  dirtBurst(ground.left, ground.top);
  audio.tugStop(); audio.pop(); audio.scream();
  store("mdk.pulled", "1");
  recent.push(p.text);
  while (recent.length > Math.min(12, Math.floor(pool.size / 3))) recent.shift();
}
/* struggling while held: it hangs from your grip like a pendulum, swings with your drag,
   kicks its legs and wriggles in bursts */
function startStruggle(d, wig) {
  const mdk = wig.querySelector(".mdk"), torso = mdk.querySelector("img.body");
  if (!torso) return;
  const base = torso.style.transform || "";
  const legs = torso.cloneNode();
  torso.classList.add("torso"); legs.classList.add("legs");
  const rootBody = document.createElement("div"); rootBody.className = "rootbody";
  mdk.insertBefore(rootBody, torso); rootBody.appendChild(torso); rootBody.appendChild(legs);
  if (reduceMotion) return;
  let th = (Math.random() - .5) * .3, om = 0, last = performance.now(), prevX = d.lastX, prevVx = 0;
  let burst = 1, nextKick = last + 120, legPhase = Math.random() * 6;
  const step = now => {
    if (drag !== d || !d.popped) return;
    const dt = Math.min(.033, Math.max(.001, (now - last) / 1000)); last = now;
    const vx = (d.lastX - prevX) / dt, ax = Math.max(-6000, Math.min(6000, (vx - prevVx) / dt));
    prevX = d.lastX; prevVx = vx;
    if (now > nextKick) {
      om += (Math.random() < .5 ? -1 : 1) * (1.6 + Math.random() * 2.6);
      burst = 1; nextKick = now + 200 + Math.random() * 450; legPhase += Math.PI * (Math.random() < .5 ? 1 : .5);
      if (Math.random() < .5) audio.squeak();
    }
    burst *= Math.exp(-dt * 2.6);
    const alpha = -20 * Math.sin(th) - ax * .0022 * Math.cos(th) - 3.2 * om;
    om += alpha * dt; th += om * dt; th = Math.max(-1.1, Math.min(1.1, th));
    const t = now / 1000, wob = Math.sin(t * 21 + legPhase);
    const sx = 1 + .045 * burst * wob, sy = 1 - .04 * burst * wob;
    rootBody.style.transform = `rotate(${(th * 57.3).toFixed(2)}deg) scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
    const kick = (8 + 16 * burst) * Math.sin(t * 15 + legPhase);
    legs.style.transform = `${base} skewX(${kick.toFixed(2)}deg) rotate(${(kick * .25).toFixed(2)}deg)`;
    torso.style.transform = `${base} skewX(${(-kick * .18).toFixed(2)}deg)`;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function moveHeld() {
  const { held, bubble } = drag;
  const vw = document.documentElement.clientWidth, hw = held.offsetWidth, hh = held.offsetHeight;
  const x = drag.lastX - drag.offX, y = drag.lastY - drag.offY;
  held.style.left = x + "px"; held.style.top = y + "px";
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
  let bx = Math.max(12, Math.min(vw - bw - 12, x + hw / 2 - bw / 2));
  let by = y - bh - 2;
  const below = by < 8;
  if (below) by = y + hh * 0.97 + 14;
  bubble.classList.toggle("below", below);
  bubble.style.left = bx + "px"; bubble.style.top = by + "px";
  bubble.style.setProperty("--tail", Math.max(22, Math.min(bw - 22, x + hw / 2 - bx)) + "px");
}
function end(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const d = drag; drag = null;
  audio.tugStop();
  if (d.popped) release(d); else springBack(d.p);
}
function springBack(p) {
  const s = p.svg;
  s.classList.remove("tug");
  s.style.transition = "transform .35s cubic-bezier(.3,1.6,.5,1)";
  s.style.transform = ""; s.style.removeProperty("--stretch"); s.style.removeProperty("--tilt");
  p.el.querySelector(".mound").style.transform = "";
  setTimeout(() => { s.style.transition = ""; }, 400);
  audio.sink();
}
function release(d) {
  const { held, bubble, p } = d;
  const r = held.getBoundingClientRect();
  puffBurst(r.left + r.width / 2, r.top + r.height * 0.55);
  audio.poof();
  held.animate([{ opacity: 1, scale: 1 }, { opacity: 0, scale: .7 }], { duration: 300, easing: "ease-in", fill: "forwards" });
  bubble.animate([{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: "0 -12px" }], { duration: 300, fill: "forwards" });
  setTimeout(() => { held.remove(); bubble.remove(); }, 420);
  setTimeout(() => { removePlot(p); refill(false); }, 1400);
}
function keyPull(e, p) {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  if (drag && drag.id === "kb") { end({ pointerId: "kb" }); return; }
  if (drag || p.state !== "ground") return;
  audio.init(); hideHint();
  const r = p.el.getBoundingClientRect();
  drag = { p, id: "kb", x0: r.left, y0: r.top, lastX: r.left, lastY: r.top - S * 0.95, popped: false };
  doPop();
}
on(window, "pointermove", e => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.lastX = e.clientX; drag.lastY = e.clientY;
  if (drag.popped) moveHeld(); else tug();
});
on(window, "pointerup", end);
on(window, "pointercancel", end);
on(window, "keydown", e => { if (e.key === "Escape" && drag && drag.id === "kb") end({ pointerId: "kb" }); });
on(window, "blur", () => { if (drag) end({ pointerId: drag.id }); });

function dirtBurst(x, y) {
  const n = reduceMotion ? 3 : 9;
  for (let i = 0; i < n; i++) {
    const d = document.createElement("div"); d.className = "dirt";
    const s = 3 + Math.random() * 5; d.style.width = d.style.height = s + "px";
    document.body.appendChild(d);
    const ang = -Math.PI * (0.08 + Math.random() * 0.84), v = 50 + Math.random() * 90;
    const dx = Math.cos(ang) * v, dy = Math.sin(ang) * v;
    const a = d.animate([
      { transform: `translate(${x}px,${y}px)`, opacity: 1 },
      { transform: `translate(${x + dx}px,${y + dy}px)`, opacity: 1, offset: .55 },
      { transform: `translate(${x + dx * 1.25}px,${y + dy + 80}px)`, opacity: 0 }
    ], { duration: 650 + Math.random() * 250, easing: "cubic-bezier(.2,.7,.4,1)" });
    a.onfinish = () => d.remove();
  }
}
function puffBurst(x, y) {
  const n = reduceMotion ? 3 : 8;
  for (let i = 0; i < n; i++) {
    const d = document.createElement("div"); d.className = "puff";
    const s = 14 + Math.random() * 16; d.style.width = d.style.height = s + "px";
    document.body.appendChild(d);
    const ang = (i / n) * Math.PI * 2 + Math.random() * .5, v = 26 + Math.random() * 26;
    const a = d.animate([
      { transform: `translate(${x - s / 2}px,${y - s / 2}px) scale(.3)`, opacity: 1 },
      { transform: `translate(${x - s / 2 + Math.cos(ang) * v}px,${y - s / 2 + Math.sin(ang) * v}px) scale(1.1)`, opacity: 0 }
    ], { duration: 480, easing: "ease-out" });
    a.onfinish = () => d.remove();
  }
}


/* ---------------- planting panel ---------------- */
let toastTimer = 0;
function toast(msg, kind) {
  toastEl.textContent = msg;
  toastEl.classList.toggle("bad", kind === "bad");
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
}
function showErr(msg) { if (msg) toast(msg, "bad"); }
function updateCount() {
  const n = [...input.value].length;
  countEl.textContent = `${n}/${MAX}`;
  countEl.classList.toggle("full", n >= MAX);
  sendBtn.disabled = busy || !canPlant || !input.value.trim();
}
const sendBtn = $("#sendBtn");
function setBusy(b) { busy = b; input.readOnly = b; updateCount(); }
on(input, "input", updateCount);

on(form, "submit", async e => {
  e.preventDefault();
  if (busy) return;
  const text = input.value.replace(/\s+/g, " ").trim();
  if (!text) return;
  if (!canPlant) return;
  const wait = COOLDOWN - (Date.now() - (+store("mdk.lastPlant") || 0));
  if (wait > 0) return showErr(`${Math.ceil(wait / 1000)}초 뒤에 다시 입력할 수 있어요.`);
  if (badWord(text)) return showErr("욕설이나 누군가를 깎아내리는 표현은 빼고 입력해 주세요.");
  setBusy(true);
  const res = await api.plant(text).catch(() => ({ ok: false }));
  setBusy(false);
  if (!res.ok) {
    if (res.code === "rate") return showErr(res.message || "잠시 뒤에 다시 입력할 수 있어요.");
    if (res.code === "bad") return showErr("욕설이나 누군가를 깎아내리는 표현은 빼고 입력해 주세요.");
    return showErr(res.message || "저장하다 문제가 생겼어요. 잠시 뒤 다시 입력해 주세요.");
  }
  store("mdk.lastPlant", String(Date.now()));
  input.value = ""; setBusy(false); updateCount();
  let spot = findSpot();
  if (!spot) {
    const cand = [...plots].filter(p => p.state === "ground");
    if (cand.length) { const v = cand[Math.floor(Math.random() * cand.length)]; spot = { fx: v.fx, fy: v.fy }; removePlot(v); }
  }
  if (spot) { makePlot(text, spot, 0).el.classList.add("mine"); audio.sprout(); }
  setStatus("");
  
});

/* ---------------- boot ---------------- */
function setStatus(msg) { statusEl.textContent = msg; statusEl.hidden = !msg; }
function disablePlanting() { canPlant = false; input.disabled = true; updateCount(); }

let resizeT = 0;
on(window, "resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { dims(); paintJungle(); plots.forEach(p => { p.sc = scaleAt(p.fy * G.H) * (p.vr || 1); layoutPlot(p); }); refill(false); }, 150);
});

const clean = t => (typeof t === "string" && t.trim() && !badWord(t)) ? t.trim().slice(0, MAX) : null;
(async () => {
  dims(); paintJungle(); updateCount();
  try {
    const rows = await api.load();
    for (const r of rows) { const t = clean(r.text); if (t) pool.set(r.id, t); }
  } catch (e) {
    setStatus("불러오다 문제가 생겼어요. 새로고침해 주세요"); disablePlanting(); return;
  }
  if (!pool.size) setStatus("아직 아무 말도 없어요. 첫 마디를 남겨보세요");
  else { setStatus(""); refill(true); }
  cleanups.push(api.subscribe(row => {
    const t = clean(row && row.text); if (!t) return;
    pool.set(row.id, t); setStatus("");
    if (plots.size < cap) refill(false);
  }));
})();

return () => {
  cleanups.forEach(f => f());
  drag = null;
  plots.forEach(p => p.el.remove()); plots.clear();
  document.querySelectorAll(".held,.bubble,.dirt,.puff").forEach(e => e.remove());
  if (hintEl) hintEl.remove();
};
}
