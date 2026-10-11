'use strict';
/* =========================================================
   BladeArtFight - stats.js
   Turns a drawing (white ink on transparent canvas) into
   battle stats. This is the soul of the game:
   YOUR ART IS YOUR BUILD.
   ========================================================= */

function getMask(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const data = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  let count = 0;
  for (let i = 0; i < W * H; i++) {
    if (data[i * 4 + 3] > 40) { mask[i] = 1; count++; }
  }
  return { mask, count, W, H };
}

/* Returns stats object, or null if there's not enough ink. */
function analyzeBlade(canvas) {
  const { mask, count, W, H } = getMask(canvas);
  if (count < 30) return null;

  const cx = W / 2, cy = H / 2;

  // --- centroid (center of mass of the ink) ---
  let sx = 0, sy = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (mask[y * W + x]) { sx += x; sy += y; }
  const mx = sx / count, my = sy / count;

  // --- blade size: farthest ink pixel from canvas center ---
  let maxR = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (mask[y * W + x]) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > maxR) maxR = d;
      }

  // --- perimeter: drawn pixels that touch empty pixels ---
  let per = 0;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++)
      if (mask[y * W + x] &&
         (!mask[y * W + x - 1] || !mask[y * W + x + 1] ||
          !mask[(y - 1) * W + x] || !mask[(y + 1) * W + x])) per++;

  /* spikiness: for a perfect circle, perimeter^2 = 4*pi*area (ratio 1).
     Every spike, dent and jaggie pushes the ratio UP. */
  const roundness = (per * per) / (4 * Math.PI * count);   // >= 1
  const spikiness = Math.min(1, Math.max(0, roundness - 1) / 2.2);

  // --- symmetry: ink overlap with its horizontal mirror ---
  let overlap = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (mask[y * W + x] && mask[y * W + (W - 1 - x)]) overlap++;
  const symmetry = overlap / count;                        // 0..1

  const fill = Math.min(1, count / (0.28 * W * H));        // 28% ink = max

  return {
    hp:     Math.round(90 + 130 * fill),
    atk:    Math.round(6 + 46 * spikiness),
    bal:    symmetry,                                     // spin efficiency
    r:      Math.max(26, Math.min(78, maxR)),              // blade radius
    wobble: Math.min(1, Math.hypot(mx - cx, my - cy) / (W * 0.3)),
  };
}

/* Random blade generator -- used for the bot and the lazy. */
function makeRandomBlade(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.lineCap = ctx.lineJoin = 'round';
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const kind = Math.floor(Math.random() * 3);

  if (kind === 0) {                        // star
    const spikes = 5 + Math.floor(Math.random() * 5);
    const R = 110 + Math.random() * 25;
    const r = R * (0.35 + Math.random() * 0.25);
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const rad = i % 2 ? r : R;
      const a = (i * Math.PI) / spikes - Math.PI / 2;
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill();
  } else if (kind === 1) {                 // blob cluster
    const n = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const d = 68 + Math.random() * 30;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d,
              22 + Math.random() * 14, 0, 7);
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, cy, 30, 0, 7); ctx.fill();
  } else {                                 // jagged saw disc
    const R = 100 + Math.random() * 25, n = 26;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rad = R * (0.72 + Math.random() * 0.33);
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill();
  }
}
