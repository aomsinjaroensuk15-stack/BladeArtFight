'use strict';
/* =========================================================
   BladeArtFight - battle.js
   Matter.js physics arena. Tops self-steer toward each
   other, damage on contact scales with the attacker's ATK
   and impact speed. Spin drains over time -- slower for
   symmetric blades, and hits knock spin off both tops.
   A top with 0 HP or 0 spin loses.
   ========================================================= */

const Battle = (() => {
  const { Engine, Render, Bodies, Body, Composite, Events, Vector } = Matter;

  let engine = null, render = null, raf = null;
  let running = false, inited = false;
  let player = null, enemy = null;
  let pStats = null, eStats = null;
  let hp = { p: 0, e: 0 };
  let spin = { p: 1, e: 1 };
  let onEnd = null;

  const arenaSize = () =>
    Math.floor(Math.min(window.innerWidth - 16, (window.innerHeight - 150) * 0.92));

  /* recolor the white drawing into a team color, keep alpha */
  function tint(src, color) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function makeBlade(canvas, stats, color, x, y) {
    const tex = tint(canvas, color);
    const b = Bodies.circle(x, y, stats.r, {
      label: 'blade',
      restitution: 0.55,
      friction: 0.02,
      frictionAir: 0.008,
      render: {
        sprite: {
          texture: tex.toDataURL(),
          xscale: (stats.r * 2) / tex.width,
          yscale: (stats.r * 2) / tex.height,
        },
      },
    });
    b.plugin = { stats, dash: 0, dashCd: 80 + Math.random() * 80 };
    return b;
  }

  function clampSpeed(b, max) {
    const v = b.velocity;
    const s = Math.hypot(v.x, v.y);
    if (s > max) Body.setVelocity(b, { x: (v.x / s) * max, y: (v.y / s) * max });
  }

  /* self-steering: gently chase the opponent, with dash bursts */
  function steer(self, other, stats, key) {
    if (spin[key] <= 0) return;
    const d = Vector.sub(other.position, self.position);
    const dist = Math.hypot(d.x, d.y) || 1;
    let f = 0.085 * self.mass;

    if (self.plugin.dashCd-- <= 0) {
      self.plugin.dash = 14;
      self.plugin.dashCd = 70 + Math.random() * 120;
    }
    if (self.plugin.dash > 0) { f *= 2.4; self.plugin.dash--; }

    Body.applyForce(self, self.position, { x: (d.x / dist) * f, y: (d.y / dist) * f });

    /* wobble: unbalanced blades drift sideways as they spin */
    if (stats.wobble > 0.05) {
      const t = engine.timing.timestamp * 0.012 + (key === 'p' ? 0 : 2.1);
      const side = { x: -d.y / dist, y: d.x / dist };
      const wf = Math.sin(t) * stats.wobble * 0.03 * self.mass;
      Body.applyForce(self, self.position, { x: side.x * wf, y: side.y * wf });
    }
    clampSpeed(self, 4.3);
  }

  function tick() {
    if (!running) return;
    steer(player, enemy, pStats, 'p');
    steer(enemy, player, eStats, 'e');

    /* spin decay: good balance = slow drain, wobble = fast drain */
    spin.p = Math.max(0, spin.p - 0.00045 * (1.7 - pStats.bal) * (1 + pStats.wobble));
    spin.e = Math.max(0, spin.e - 0.00045 * (1.7 - eStats.bal) * (1 + eStats.wobble));
    Body.setAngularVelocity(player, -0.36 * spin.p);
    Body.setAngularVelocity(enemy,  0.36 * spin.e);

    Engine.update(engine, 1000 / 60);
    HUD.update(hp, spin);
    checkEnd();
    if (running) raf = requestAnimationFrame(tick);
  }

  function checkEnd() {
    const pDead = hp.p <= 0, eDead = hp.e <= 0;
    const pOut = spin.p <= 0.02, eOut = spin.e <= 0.02;
    if ((pDead || pOut) && (eDead || eOut))
      return finish(hp.p > hp.e ? 'win' : hp.p < hp.e ? 'lose' : 'draw');
    if (pDead || pOut) return finish('lose');
    if (eDead || eOut) return finish('win');
  }

  function finish(result) {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    HUD.update(hp, spin);
    setTimeout(() => { cleanup(); if (onEnd) onEnd(result); }, 900);
  }

  function cleanup() {
    if (!inited) return;
    try {
      Render.stop(render);
      Events.off(engine);
      Composite.clear(engine.world, false);
      Engine.clear(engine);
      if (render.canvas) render.canvas.remove();
      render.textures = {};
    } catch (e) { /* engine already gone */ }
  }

  function start(playerCanvas, enemyCanvas, ps, es, endCb) {
    if (running) return;
    cleanup();
    onEnd = endCb;
    pStats = ps; eStats = es;
    hp = { p: ps.hp, e: es.hp };
    spin = { p: 1, e: 1 };

    const S = arenaSize();
    const R = S / 2;
    const arenaEl = document.getElementById('arena');
    arenaEl.innerHTML = '';
    document.getElementById('arenaWrap').style.width = S + 'px';
    document.getElementById('arenaWrap').style.height = S + 'px';

    engine = Engine.create();
    engine.gravity.y = 0;                    // top-down arena!

    render = Render.create({
      element: arenaEl,
      engine,
      options: {
        width: S, height: S,
        wireframes: false,
        background: 'transparent',
        pixelRatio: window.devicePixelRatio || 1,
      },
    });

    /* circular wall: a ring of static segments */
    const wall = [];
    const segs = 40;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      wall.push(Bodies.rectangle(
        R + Math.cos(a) * (R - 2), R + Math.sin(a) * (R - 2),
        (2 * Math.PI * R) / segs + 6, 20,
        { isStatic: true, angle: a + Math.PI / 2, render: { visible: false } }
      ));
    }

    player = makeBlade(playerCanvas, ps, '#3b9dff', R, R + R * 0.42);
    enemy  = makeBlade(enemyCanvas,  es, '#ff6a3d', R, R - R * 0.42);
    Body.setVelocity(player, { x: -2.2, y: 0 });
    Body.setVelocity(enemy,  { x:  2.2, y: 0 });
    Composite.add(engine.world, [...wall, player, enemy]);

    /* damage on blade-vs-blade contact */
    Events.on(engine, 'collisionStart', (ev) => {
      for (const pair of ev.pairs) {
        const a = pair.bodyA, b = pair.bodyB;
        if (a.label !== 'blade' || b.label !== 'blade') continue;
        const speed = Vector.magnitude(Vector.sub(a.velocity, b.velocity));
        if (speed < 2) continue;
        const dmgToA = Math.min(45, b.plugin.stats.atk * speed * 0.085);
        const dmgToB = Math.min(45, a.plugin.stats.atk * speed * 0.085);
        hp[a === player ? 'p' : 'e'] -= dmgToA;
        hp[b === player ? 'p' : 'e'] -= dmgToB;
        spin.p = Math.max(0, spin.p - speed * 0.012);
        spin.e = Math.max(0, spin.e - speed * 0.012);
        if (window.blip) window.blip(Math.min(1, speed / 8));
      }
    });

    inited = true;
    running = true;
    HUD.setMaxes(ps.hp, es.hp);
    Render.run(render);
    raf = requestAnimationFrame(tick);
  }

  return { start, arenaSize };
})();
