'use strict';
/* =========================================================
   BladeArtFight - main.js
   UI glue: drawing canvas, live stat preview, screen flow,
   HUD, result overlay, tiny synth hit sound.
   ========================================================= */

/* ---------- HUD ---------- */
const hpP  = document.getElementById('hpPlayer');
const hpE  = document.getElementById('hpEnemy');
const spP  = document.getElementById('spinPlayer');
const spE  = document.getElementById('spinEnemy');

let maxP = 1, maxE = 1;

window.HUD = {
  setMaxes(p, e) { maxP = p; maxE = e; this.update({ p, e }, { p: 1, e: 1 }); },
  update(hp, spin) {
    hpP.style.width = Math.max(0, Math.min(100, (hp.p / maxP) * 100)) + '%';
    hpE.style.width = Math.max(0, Math.min(100, (hp.e / maxE) * 100)) + '%';
    spP.style.width = Math.max(0, spin.p * 100) + '%';
    spE.style.width = Math.max(0, spin.e * 100) + '%';
  },
};

/* ---------- tiny hit sound (WebAudio, no assets) ---------- */
let AC = null;
window.blip = (intensity = 1) => {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'square';
    o.frequency.value = 140 + 260 * intensity + Math.random() * 40;
    g.gain.setValueAtTime(0.06, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.09);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + 0.1);
  } catch (e) { /* silent is fine */ }
};

/* ---------- drawing canvas ---------- */
const drawCanvas = document.getElementById('drawCanvas');
const dctx = drawCanvas.getContext('2d');
dctx.lineWidth = 16;
dctx.lineCap = dctx.lineJoin = 'round';
dctx.strokeStyle = '#fff';

let drawing = false, last = null;

function pos(e) {
  const r = drawCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (drawCanvas.width / r.width),
    y: (e.clientY - r.top) * (drawCanvas.height / r.height),
  };
}

function dot(p) {
  dctx.beginPath();
  dctx.arc(p.x, p.y, 8, 0, 7);
  dctx.fillStyle = '#fff';
  dctx.fill();
}

drawCanvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  drawing = true;
  last = pos(e);
  dot(last);
  drawCanvas.setPointerCapture(e.pointerId);
  previewSoon();
});
drawCanvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  e.preventDefault();
  const p = pos(e);
  dctx.beginPath();
  dctx.moveTo(last.x, last.y);
  dctx.lineTo(p.x, p.y);
  dctx.stroke();
  last = p;
  previewSoon();
});
const stopDraw = () => { drawing = false; };
drawCanvas.addEventListener('pointerup', stopDraw);
drawCanvas.addEventListener('pointercancel', stopDraw);

/* ---------- live stat preview ---------- */
const barHp  = document.getElementById('barHp');
const barAtk = document.getElementById('barAtk');
const barBal = document.getElementById('barBal');

function preview() {
  const s = analyzeBlade(drawCanvas);
  barHp.style.width  = s ? ((s.hp - 90) / 130) * 100 + '%' : '0%';
  barAtk.style.width = s ? ((s.atk - 6) / 46) * 100 + '%' : '0%';
  barBal.style.width = s ? s.bal * 100 + '%' : '0%';
}
let queued = false;
function previewSoon() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; preview(); });
}

/* ---------- screens ---------- */
const drawScreen   = document.getElementById('drawScreen');
const battleScreen = document.getElementById('battleScreen');
const resultOverlay = document.getElementById('resultOverlay');
const resultText   = document.getElementById('resultText');

function show(el) {
  drawScreen.classList.remove('active');
  battleScreen.classList.remove('active');
  el.classList.add('active');
}

/* ---------- bot blade ---------- */
const botCanvas = document.createElement('canvas');
botCanvas.width = botCanvas.height = 320;

let lastPlayerStats = null, lastEnemyStats = null;

function fight() {
  let pStats = analyzeBlade(drawCanvas);
  if (!pStats) {                        // drew nothing? randomize for them
    makeRandomBlade(drawCanvas);
    pStats = analyzeBlade(drawCanvas);
    preview();
  }
  makeRandomBlade(botCanvas);
  const eStats = analyzeBlade(botCanvas);
  lastPlayerStats = pStats;
  lastEnemyStats = eStats;

  resultOverlay.classList.add('hidden');
  show(battleScreen);
  Battle.start(drawCanvas, botCanvas, pStats, eStats, onBattleEnd);
}

function onBattleEnd(result) {
  resultText.textContent =
    result === 'win'  ? 'VICTORY' :
    result === 'lose' ? 'DEFEAT'  : 'DRAW';
  resultText.style.color =
    result === 'win' ? '#55efc4' : result === 'lose' ? '#ff7675' : '#ffeaa7';
  resultOverlay.classList.remove('hidden');
}

/* ---------- buttons ---------- */
document.getElementById('btnClear').addEventListener('click', () => {
  dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  preview();
});
document.getElementById('btnRandom').addEventListener('click', () => {
  makeRandomBlade(drawCanvas);
  preview();
});
document.getElementById('btnFight').addEventListener('click', fight);
document.getElementById('btnNewBlade').addEventListener('click', () => {
  show(drawScreen);
});
document.getElementById('btnRematch').addEventListener('click', () => {
  resultOverlay.classList.add('hidden');
  Battle.start(drawCanvas, botCanvas, lastPlayerStats, lastEnemyStats, onBattleEnd);
});

/* ---------- boot ---------- */
makeRandomBlade(drawCanvas);   // start with something fun on the canvas
preview();
