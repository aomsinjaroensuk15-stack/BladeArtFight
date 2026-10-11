'use strict';
/* =========================================================
   BladeArtFight - battle.js  (v2: Beyblade X stadium)
   Matter.js 2D physics in a big SQUARE stadium:
   - X-rail: catching the diagonal rail accelerates a top
     toward the centre and triggers an XTREME DASH
   - Exit gaps in the north wall: get knocked out through
     an OVER ZONE or the wide XTREME ZONE and you lose
   Rendering is done separately by render3d.js; this file
   only simulates and exposes state via Battle.getState().
   ========================================================= */

const Battle = (() => {
  const { Engine, Bodies, Body, Composite, Events, Vector } = Matter;

  const S = 1000;                       // stadium side (world units)
  const WALL_T = 60;
  const RAIL_W = 62;                    // half-catch width of the X rail
  const DASH_TICKS = 45;
  /* exit gaps on the north wall (matter y = 0 side) */
  const EXIT_GAPS = [ [175, 265], [415, 585], [735, 825] ];

  /* the two diagonal rails (corner to corner) */
  const RAILS = [
    { ax: 70,  ay: 70,  bx: 930, by: 930 },
    { ax: 930, ay: 70,  bx: 70,  by: 930 },
  ];

  let engine = null, raf = null;
  let running = false, inited = false;
  let player = null, enemy = null;
  let pStats = null, eStats = null;
  let hp = { p: 0, e: 0 };
  let spin = { p: 1, e: 1 };
  let dash = { p: 0, e: 0 };
  let onEnd = null;

  const arenaSize = () =>
    Math.floor(Math.min(window.innerWidth - 8, window.innerHeight - 158));

  /* ---------- collision world ---------- */

  function buildWalls() {
    const opt = { isStatic: true, restitution: 0.6, render: { visible: false } };
    const walls = [
      Bodies.rectangle(S / 2, S + WALL_T / 2, S + 2 * WALL_T, WALL_T, opt), // south
      Bodies.rectangle(-WALL_T / 2, S / 2, WALL_T, S + 2 * WALL_T, opt),   // west
      Bodies.rectangle(S + WALL_T / 2, S / 2, WALL_T, S + 2 * WALL_T, opt),// east
    ];
    /* north wall, split around the exit gaps */
    let prev = 0;
    const spans = [];
    for (const [a, b] of EXIT_GAPS) { spans.push([prev, a]); prev = b; }
    spans.push([prev, S]);
    for (const [a, b] of spans)
      walls.push(Bodies.rectangle((a + b) / 2, -WALL_T / 2, b - a, WALL_T, opt));
    return walls;
  }

  function makeBlade(stats, x, y) {
    const b = Bodies.circle(x, y, stats.r, {
      label: 'blade',
      restitution: 0.55,
      friction: 0.02,
      frictionAir: 0.006,
    });
    b.plugin = { stats, dashCd: 60 + Math.random() * 100 };
    return b;
  }

  function clampSpeed(b, max) {
    const v = b.velocity, s = Math.hypot(v.x, v.y);
    if (s > max) Body.setVelocity(b, { x: (v.x / s) * max, y: (v.y / s) * max });
  }

  /* ---------- X-rail ---------- */

  function distToRails(p) {
    let best = null;
    for (const r of RAILS) {
      const abx = r.bx - r.ax, aby = r.by - r.ay;
      const L2 = abx * abx + aby * aby;
      let t = ((p.x - r.ax) * abx + (p.y - r.ay) * aby) / L2;
      t = Math.max(0, Math.min(1, t));
      const cx = r.ax + abx * t, cy = r.ay + aby * t;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < RAIL_W && (!best || d < best.d)) best = { d, cx, cy };
    }
    return best;
  }

  /* riding the rail: gear-train acceleration toward centre,
     engagement even restores a little spin (like real bits) */
  function handleRail(b, key) {
    if (spin[key] <= 0) return;
    const ri = distToRails(b.position);
    if (!ri) return;
    const toC = { x: S / 2 - b.position.x, y: S / 2 - b.position.y };
    const L = Math.hypot(toC.x, toC.y) || 1;
    const dir = { x: Math.sign(toC.x) || 1, y: Math.sign(toC.y) || 1 };
    const n = Math.hypot(dir.x, dir.y);
    Body.applyForce(b, b.position, {
      x: (dir.x / n) * 0.30 * b.mass,
      y: (dir.y / n) * 0.30 * b.mass,
    });
    clampSpeed(b, 8.5);
    spin[key] = Math.min(1, spin[key] + 0.004);
    if (L < 150 && dash[key] <= 0) {
      dash[key] = DASH_TICKS;
      if (window.onXtreme) window.onXtreme(key);
    }
  }

  /* ---------- steering ---------- */

  function steer(self, other, stats, key) {
    if (spin[key] <= 0) return;
    if (self.position.y < 0) return;          // escaping through an exit: no control
    const d = Vector.sub(other.position, self.position);
    const dist = Math.hypot(d.x, d.y) || 1;
    let f = 0.11 * self.mass;

    if (self.plugin.dashCd-- <= 0) {
      self.plugin.dash = 14;
      self.plugin.dashCd = 60 + Math.random() * 120;
    }
    if (self.plugin.dash > 0) { f *= 2.2; self.plugin.dash--; }
    if (dash[key] > 0) f *= 3.2;

    Body.applyForce(self, self.position, { x: (d.x / dist) * f, y: (d.y / dist) * f });

    /* wobble: unbalanced blades drift sideways as they spin */
    if (stats.wobble > 0.05) {
      const t = engine.timing.timestamp * 0.012 + (key === 'p' ? 0 : 2.1);
      const side = { x: -d.y / dist, y: d.x / dist };
      const wf = Math.sin(t) * stats.wobble * 0.03 * self.mass;
      Body.applyForce(self, self.position, { x: side.x * wf, y: side.y * wf });
    }
    clampSpeed(self, dash[key] > 0 ? 9.5 : 4.6);
  }

  /* ---------- main loop ---------- */

  function tick() {
    if (!running) return;

    handleRail(player, 'p');
    handleRail(enemy, 'e');
    steer(player, enemy, pStats, 'p');
    steer(enemy, player, eStats, 'e');

    dash.p = Math.max(0, dash.p - 1);
    dash.e = Math.max(0, dash.e - 1);

    /* spin decay: good balance = slow drain, wobble = fast drain */
    spin.p = Math.max(0, spin.p - 0.00045 * (1.7 - pStats.bal) * (1 + pStats.wobble));
    spin.e = Math.max(0, spin.e - 0.00045 * (1.7 - eStats.bal) * (1 + eStats.wobble));
    Body.setAngularVelocity(player, -0.36 * spin.p);
    Body.setAngularVelocity(enemy,  0.36 * spin.e);

    Engine.update(engine, 1000 / 60);
    HUD.update(hp, spin);

    const res = checkEnd();
    if (!res) raf = requestAnimationFrame(tick);
  }

  function bodyState(b, key) {
    return {
      x: b.position.x, y: b.position.y, angle: b.angle,
      vx: b.velocity.x, vy: b.velocity.y,
      spin: spin[key], dash: dash[key] > 0, hp: hp[key],
    };
  }

  function checkEnd() {
    /* exit check first: crossing the north wall plane through a gap */
    for (const [b, key] of [[player, 'p'], [enemy, 'e']]) {
      if (b.position.y < -30) {
        const x = b.position.x;
        let finish = 'over';
        for (const [a, b2] of EXIT_GAPS)
          if (x >= a - 10 && x <= b2 + 10) finish = (b2 - a) > 150 ? 'xtreme' : 'over';
        return endMatch({ winner: key === 'p' ? 'bot' : 'player', finish });
      }
    }
    const pDead = hp.p <= 0, eDead = hp.e <= 0;
    const pOut = spin.p <= 0.02, eOut = spin.e <= 0.02;
    if ((pDead || pOut) && (eDead || eOut))
      return endMatch({ winner: hp.p > hp.e ? 'player' : hp.p < hp.e ? 'bot' : 'draw', finish: 'burst' });
    if (pDead) return endMatch({ winner: 'bot', finish: 'burst' });
    if (pOut)  return endMatch({ winner: 'bot', finish: 'spinout' });
    if (eDead) return endMatch({ winner: 'player', finish: 'burst' });
    if (eOut)  return endMatch({ winner: 'player', finish: 'spinout' });
    return null;
  }

  function endMatch(result) {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    HUD.update(hp, spin);
    if (window.battleShake) window.battleShake(14);
    setTimeout(() => { cleanup(); if (onEnd) onEnd(result); }, 1100);
    return true;
  }

  function cleanup() {
    if (!inited) return;
    try {
      Events.off(engine);
      Composite.clear(engine.world, false);
      Engine.clear(engine);
    } catch (e) { /* already gone */ }
    inited = false;
  }

  /* damage on contact; a dashing attacker deals bonus damage
     and launches the victim (that is how you score exits) */
  function onCollision(ev) {
    for (const pair of ev.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      if (a.label !== 'blade' || b.label !== 'blade') continue;
      const speed = Vector.magnitude(Vector.sub(a.velocity, b.velocity));
      if (speed < 2) continue;
      const aDash = (a === player ? dash.p : dash.e) > 0;
      const bDash = (b === player ? dash.p : dash.e) > 0;

      const dmgToA = Math.min(60, b.plugin.stats.atk * speed * 0.085 * (bDash ? 2.2 : 1));
      const dmgToB = Math.min(60, a.plugin.stats.atk * speed * 0.085 * (aDash ? 2.2 : 1));
      hp[a === player ? 'p' : 'e'] -= dmgToA;
      hp[b === player ? 'p' : 'e'] -= dmgToB;

      /* dash knockback: slingshot the victim along the dash direction */
      if (bDash) Body.setVelocity(a, { x: a.velocity.x + b.velocity.x * 0.9, y: a.velocity.y + b.velocity.y * 0.9 });
      if (aDash) Body.setVelocity(b, { x: b.velocity.x + a.velocity.x * 0.9, y: b.velocity.y + a.velocity.y * 0.9 });

      spin.p = Math.max(0, spin.p - speed * 0.012);
      spin.e = Math.max(0, spin.e - speed * 0.012);

      if (window.battleShake) window.battleShake(Math.min(10, speed));
      if (window.blip) window.blip(Math.min(1, speed / 8));
    }
  }

  function start(playerCanvas, enemyCanvas, ps, es, endCb) {
    if (running) return;
    cleanup();
    onEnd = endCb;
    pStats = ps; eStats = es;
    hp = { p: ps.hp, e: es.hp };
    spin = { p: 1, e: 1 };
    dash = { p: 0, e: 0 };

    engine = Engine.create();
    engine.gravity.y = 0;                    // top-down!

    player = makeBlade(ps, S / 2, S * 0.74);
    enemy  = makeBlade(es, S / 2, S * 0.26);
    Body.setVelocity(player, { x: -2.6, y: 0 });
    Body.setVelocity(enemy,  { x:  2.6, y: 0 });
    Composite.add(engine.world, [...buildWalls(), player, enemy]);

    Events.on(engine, 'collisionStart', onCollision);

    inited = true;
    running = true;
    HUD.setMaxes(ps.hp, es.hp);
    raf = requestAnimationFrame(tick);
  }

  function getState() {
    if (!inited) return { running: false };
    return {
      running,
      player: bodyState(player, 'p'),
      enemy: bodyState(enemy, 'e'),
    };
  }

  return { start, getState, arenaSize, S, EXIT_GAPS };
})();
