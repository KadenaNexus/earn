// Background sounds for Kadena Nexus Games, generated live with the Web Audio API.
// No instruments and no recordings: wind, water, rain, waves, birdsong and crickets.
// Desert night is the default. Browsers only allow sound after the first tap or key
// press, so it starts then. The speaker button opens a menu to pick a sound or Off,
// and the choice is remembered on this device.
const KEY = 'ke-sound';
export const SOUNDS = [
  ['night', 'Desert night', 'Crickets and soft wind'],
  ['wind', 'Wind and water', 'Desert breeze, flowing water'],
  ['rain', 'Rain', 'Rainfall, distant thunder'],
  ['ocean', 'Ocean waves', 'Slow waves on a beach'],
  ['birds', 'Birds at dawn', 'Birdsong over a breeze'],
];
const DEFAULT = 'night', LEVEL = 0.3;
let ac = null, master = null, bus = null, playing = null, stops = [];

function choice() {
  let v = null; try { v = localStorage.getItem(KEY); } catch { /* private mode */ }
  if (v === 'off') return 'off';
  return SOUNDS.some(s => s[0] === v) ? v : DEFAULT; // older 'on' means the default
}
const remember = v => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } };

function context() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ac = new AC(); master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
function noise(kind, sec = 4) {
  const b = ac.createBuffer(1, ac.sampleRate * sec, ac.sampleRate), d = b.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else { b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.5; }
  }
  return b;
}
const gain = v => { const g = ac.createGain(); g.gain.value = v; return g; };
const filt = (type, f, q = 0.7) => { const x = ac.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
function src(kind) { const s = ac.createBufferSource(); s.buffer = noise(kind); s.loop = true; s.start(); stops.push(() => { try { s.stop(); } catch { /* done */ } }); return s; }
function lfo(param, rate, depth) { const o = ac.createOscillator(), g = gain(depth); o.frequency.value = rate; o.connect(g).connect(param); o.start(); stops.push(() => { try { o.stop(); } catch { /* done */ } }); }
function every(fn, min, max) { let t; const go = () => { if (!document.hidden) fn(); t = setTimeout(go, min + Math.random() * (max - min)); }; t = setTimeout(go, 300); stops.push(() => clearTimeout(t)); }
function wind(out, level) { const f = filt('bandpass', 420, 0.6), g = gain(0.55 * level); src('brown').connect(f).connect(g).connect(out); lfo(g.gain, 0.07, 0.3 * level); lfo(f.frequency, 0.05, 220); }
function tone(out, freq, t, attack, level, release) { const o = ac.createOscillator(), e = gain(0); o.frequency.value = freq; o.connect(e).connect(out); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(level, t + attack); e.gain.linearRampToValueAtTime(0, t + release); o.start(t); o.stop(t + release + 0.01); return o; }

const BUILD = {
  night(out) {
    wind(out, 0.5);
    every(() => { const f = 4300 + Math.random() * 500, t0 = ac.currentTime, n = 3 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) tone(out, f, t0 + i * 0.07, 0.01, 0.025, 0.045); }, 450, 900);
  },
  wind(out) { wind(out, 1); const g = gain(0.12); src('brown').connect(filt('highpass', 1400, 0.3)).connect(g).connect(out); lfo(g.gain, 0.35, 0.05); },
  rain(out) {
    const g = gain(0.5); src('pink').connect(filt('highpass', 900, 0.4)).connect(filt('lowpass', 7000)).connect(g).connect(out); lfo(g.gain, 0.1, 0.06);
    every(() => { const t = ac.currentTime, o = ac.createOscillator(), e = gain(0); o.frequency.value = 2200 + Math.random() * 2500; o.connect(filt('bandpass', 3000, 2)).connect(e).connect(out); e.gain.setValueAtTime(0.05, t); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.04); o.start(t); o.stop(t + 0.05); }, 40, 160);
    every(() => { const t = ac.currentTime, s = ac.createBufferSource(), e = gain(0); s.buffer = noise('brown', 6); s.connect(filt('lowpass', 160)).connect(e).connect(out); e.gain.linearRampToValueAtTime(1.4, t + 0.8); e.gain.exponentialRampToValueAtTime(0.001, t + 5.5); s.start(t); s.stop(t + 6); }, 14000, 30000);
  },
  ocean(out) { const g = gain(0.2), h = gain(0.05); src('brown').connect(filt('lowpass', 700)).connect(g).connect(out); src('pink').connect(filt('highpass', 1200)).connect(h).connect(out); lfo(g.gain, 0.09, 0.18); lfo(h.gain, 0.09, 0.05); },
  birds(out) {
    wind(out, 0.4);
    every(() => {
      const n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1800; let t = ac.currentTime;
      for (let i = 0; i < n; i++) {
        const o = ac.createOscillator(), e = gain(0);
        o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.5), t + 0.07); o.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.12);
        o.connect(e).connect(out); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.05, t + 0.02); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
        o.start(t); o.stop(t + 0.15); t += 0.12 + Math.random() * 0.08;
      }
    }, 500, 2200);
  },
};

function stop(fade = 0.6) {
  if (!ac || !playing) return;
  const old = stops, oldBus = bus; stops = []; playing = null; bus = null;
  oldBus.gain.setTargetAtTime(0, ac.currentTime, fade / 3);
  setTimeout(() => { old.forEach(f => f()); oldBus.disconnect(); }, fade * 1000 + 100);
}
function play(key) {
  if (key === 'off' || !context()) return stop();
  if (playing === key) return;
  stop(0.4);
  bus = gain(1); bus.connect(master); BUILD[key](bus); playing = key;
  master.gain.cancelScheduledValues(ac.currentTime); master.gain.setValueAtTime(master.gain.value, ac.currentTime);
  master.gain.linearRampToValueAtTime(LEVEL, ac.currentTime + 2);
}

export function setupAmbience(button) {
  if (!button) return;
  const wrap = button.parentElement; wrap.style.position ||= 'relative';
  const menu = document.createElement('div');
  menu.className = 'sound-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  menu.innerHTML = '<p>Background sound</p>' + [...SOUNDS, ['off', 'Off', 'No sound']].map(([k, name, sub]) =>
    `<button role="menuitemradio" data-k="${k}"><b>${name}</b><span>${sub}</span></button>`).join('');
  button.after(menu);
  const show = () => {
    const c = choice();
    button.classList.toggle('off', c === 'off');
    button.setAttribute('aria-label', c === 'off' ? 'Background sound: off' : 'Background sound: ' + SOUNDS.find(s => s[0] === c)[1]);
    menu.querySelectorAll('[data-k]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.k === c)));
  };
  const open = v => { menu.hidden = !v; button.setAttribute('aria-expanded', String(v)); };
  button.setAttribute('aria-haspopup', 'true');
  button.onclick = e => { e.stopPropagation(); open(menu.hidden); };
  menu.onclick = e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    e.stopPropagation(); remember(b.dataset.k); play(b.dataset.k); show(); open(false);
  };
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) open(false); });
  const first = e => {
    if (button.contains(e.target) || menu.contains(e.target)) return; // the menu itself decides
    removeEventListener('pointerdown', first); removeEventListener('keydown', first);
    if (choice() !== 'off') play(choice());
  };
  addEventListener('pointerdown', first); addEventListener('keydown', first);
  document.addEventListener('visibilitychange', () => { if (!ac) return; if (document.hidden) ac.suspend(); else if (choice() !== 'off') ac.resume(); });
  show();
}
