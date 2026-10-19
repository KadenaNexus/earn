// Background sound for Kadena Nexus Games: a soft desert wind and flowing water,
// generated live with the Web Audio API. No instruments and no recordings.
// On by default; browsers only allow sound after the first tap or key press,
// so it starts then. The speaker button turns it off, and the choice is remembered.
const KEY = 'ke-sound';
let ctx = null, master = null;
const wanted = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
const remember = on => { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode */ } };

function noiseBuffer(ac, seconds = 4) {
  // Brown noise: a gentle, deep rumble (each sample drifts a little from the last).
  const buf = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  return buf;
}
function layer(ac, out, { type, freq, q, gain, lfoRate, lfoDepth, sweep }) {
  const src = ac.createBufferSource(); src.buffer = noiseBuffer(ac); src.loop = true;
  const filter = ac.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
  const g = ac.createGain(); g.gain.value = gain;
  // Slow swell, like gusts of wind or the rise and fall of water.
  const lfo = ac.createOscillator(), depth = ac.createGain();
  lfo.frequency.value = lfoRate; depth.gain.value = lfoDepth; lfo.connect(depth).connect(g.gain);
  if (sweep) { const s = ac.createOscillator(), sd = ac.createGain(); s.frequency.value = sweep.rate; sd.gain.value = sweep.depth; s.connect(sd).connect(filter.frequency); s.start(); }
  src.connect(filter).connect(g).connect(out); src.start(); lfo.start();
}
function start() {
  if (ctx) { ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC(); master = ctx.createGain(); master.gain.value = 0;
  master.connect(ctx.destination);
  layer(ctx, master, { type: 'bandpass', freq: 420, q: 0.6, gain: 0.55, lfoRate: 0.07, lfoDepth: 0.3, sweep: { rate: 0.05, depth: 220 } }); // wind
  layer(ctx, master, { type: 'highpass', freq: 1400, q: 0.3, gain: 0.12, lfoRate: 0.35, lfoDepth: 0.05 }); // water
  master.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 3); // fade in
}
function stop() {
  if (!ctx) return;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
  setTimeout(() => ctx?.suspend(), 700);
}
function resumeIfWanted() { if (!wanted() || !ctx) return; ctx.resume(); master.gain.cancelScheduledValues(ctx.currentTime); master.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 1.5); }

export function setupAmbience(button) {
  if (!button) return;
  const show = () => { const on = wanted(); button.setAttribute('aria-pressed', String(on)); button.title = on ? 'Background sound on (tap to turn off)' : 'Background sound off (tap to turn on)'; button.classList.toggle('off', !on); };
  button.onclick = e => { e.stopPropagation(); const on = !wanted(); remember(on); if (on) { start(); resumeIfWanted(); } else stop(); show(); };
  const firstTouch = () => { if (wanted()) { start(); resumeIfWanted(); } removeEventListener('pointerdown', firstTouch); removeEventListener('keydown', firstTouch); };
  addEventListener('pointerdown', firstTouch); addEventListener('keydown', firstTouch);
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else if (wanted()) ctx.resume(); });
  show();
}
