'use strict';
/* =========================================================
   BladeArtFight - render3d.js
   Three.js visuals synced to the Matter.js physics in
   battle.js. Owns: camera, stadium mesh (square dish,
   slanted walls, exit gaps, green X-rail), the two 3D
   tops (built from the player's drawings), spin/wobble/
   dash effects and camera shake.
   ========================================================= */

const R3D = (() => {
  if (!window.THREE) {
    console.error('Three.js failed to load');
    return { start() {}, stop() {} };
  }

  const S = 1000;                          // must match battle.js
  const GAP_X = [-500, 500];               // rebuilt from Battle.EXIT_GAPS below

  let renderer = null, scene = null, camera = null;
  let topP = null, topE = null;
  let pStats = null, eStats = null;
  let raf = null, running = false;
  let shake = 0, fovKick = 0;
  const BASE_FOV = 46;
  const CAM_DIR = new THREE.Vector3(0, 1.02, 0.86).normalize();
  let camDist = 1500;

  /* ---------- textures ---------- */

  function gridTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#cfd6dd'; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = '#b9c2cb'; x.lineWidth = 3;
    x.strokeRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(18, 18);
    return t;
  }

  /* tint the white drawing into a team color, cropped to a disc */
  function artTexture(srcCanvas, color) {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d');
    x.beginPath(); x.arc(256, 256, 254, 0, 7); x.clip();
    x.drawImage(srcCanvas, 0, 0, 512, 512);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, 512, 512);
    x.globalCompositeOperation = 'source-over';
    x.strokeStyle = 'rgba(255,255,255,.9)';
    x.lineWidth = 12;
    x.beginPath(); x.arc(256, 256, 246, 0, 7); x.stroke();
    return new THREE.CanvasTexture(c);
  }

  /* ---------- stadium ---------- */

  function buildStadium() {
    const dish = new THREE.Group();

    /* battle floor */
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(S, 24, S),
      new THREE.MeshStandardMaterial({ color: 0xeef1f5, roughness: 0.55, metalness: 0.05 })
    );
    floor.position.y = -12;
    floor.receiveShadow = true;
    dish.add(floor);

    /* centre circle + ring lines, like the source videos */
    for (const frac of [0.66, 0.33]) {
      const r = (S / 2) * frac;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 4, r, 72),
        new THREE.MeshBasicMaterial({ color: 0xc9d2db, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.6;
      dish.add(ring);
    }
    const centre = new THREE.Mesh(
      new THREE.CircleGeometry(72, 48),
      new THREE.MeshBasicMaterial({ color: 0xe2e8ee })
    );
    centre.rotation.x = -Math.PI / 2;
    centre.position.y = 0.6;
    dish.add(centre);

    /* slanted walls (outward-leaning, like a real dish) */
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf7f9fb, roughness: 0.4, metalness: 0.05 });
    const mkWall = (w, x, z, rx, rz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 74, 26), wallMat);
      m.position.set(x, 32, z);
      m.rotation.x = rx; m.rotation.z = rz;
      m.castShadow = true; m.receiveShadow = true;
      dish.add(m);
    };
    mkWall(S + 120, 0, S / 2 - 6, -0.30, 0);                    // south
    mkWall(S + 120, -S / 2 + 6, 0, 0, 0.30);                    // west
    mkWall(S + 120,  S / 2 - 6, 0, 0, -0.30);                   // east
    /* north wall in segments, honouring the exit gaps */
    let prev = 0;
    const spans = [];
    for (const [a, b] of Battle.EXIT_GAPS) { spans.push([prev, a]); prev = b; }
    spans.push([prev, S]);
    for (const [a, b] of spans)
      mkWall(b - a, (a + b) / 2 - S / 2, -S / 2 + 6, 0.30, 0);

    /* exit pads outside the gaps: orange over-zones, red xtreme zone */
    for (const [a, b] of Battle.EXIT_GAPS) {
      const wide = (b - a) > 150;
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(b - a, 3, 110),
        new THREE.MeshStandardMaterial({
          color: wide ? 0xff7675 : 0xfab1a0,
          roughness: 0.5, emissive: wide ? 0x661412 : 0x4d1d12, emissiveIntensity: 0.35,
        })
      );
      pad.position.set((a + b) / 2 - S / 2, 1, -S / 2 - 52);
      pad.receiveShadow = true;
      dish.add(pad);
    }

    /* THE X-CELERATOR RAIL: two green geared strips corner to corner */
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x00b894, roughness: 0.25, metalness: 0.35,
      emissive: 0x00b894, emissiveIntensity: 0.18,
    });
    for (const rot of [Math.PI / 4, -Math.PI / 4]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(S * 1.32, 9, 44), railMat);
      rail.position.y = 4;
      rail.rotation.y = rot;
      rail.receiveShadow = true;
      dish.add(rail);
    }

    scene.add(dish);

    /* grid floor stretching into the fog */
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(7000, 7000),
      new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.9 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -25;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  /* ---------- tops ---------- */

  function buildTop(artCanvas, color, stats) {
    const g = new THREE.Group();
    const r = stats.r;

    const bladeMat = new THREE.MeshStandardMaterial({
      map: artTexture(artCanvas, color), roughness: 0.35, metalness: 0.3,
    });
    const sideMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), roughness: 0.3, metalness: 0.45,
    });
    const blade = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 0.9, 26, 64),
      [sideMat, bladeMat, sideMat]
    );
    blade.position.y = 46;
    blade.castShadow = true;

    const ratchet = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.5, r * 0.56, 14, 32),
      new THREE.MeshStandardMaterial({ color: 0x2d3436, roughness: 0.5, metalness: 0.4 })
    );
    ratchet.position.y = 25;
    ratchet.castShadow = true;

    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(13, 22, 24),
      new THREE.MeshStandardMaterial({ color: 0x8395a7, roughness: 0.25, metalness: 0.85 })
    );
    tip.rotation.x = Math.PI;
    tip.position.y = 9;

    g.add(blade, ratchet, tip);
    g.userData = { blade, bladeMat, sideMat };
    return g;
  }

  /* ---------- camera ---------- */

  function autoFit() {
    /* push the camera back until all four dish corners fit any screen */
    const corners = [
      new THREE.Vector3(-S / 2, 0, -S / 2), new THREE.Vector3(S / 2, 0, -S / 2),
      new THREE.Vector3(-S / 2, 0,  S / 2), new THREE.Vector3(S / 2, 0,  S / 2),
    ];
    camDist = 900;
    for (let i = 0; i < 50; i++) {
      camera.position.copy(CAM_DIR).multiplyScalar(camDist);
      camera.lookAt(0, 0, -30);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      let maxAbs = 0;
      for (const c of corners) {
        const ndc = c.clone().project(camera);
        maxAbs = Math.max(maxAbs, Math.abs(ndc.x), Math.abs(ndc.y));
      }
      if (maxAbs < 0.9) break;
      camDist *= 1.06;
    }
  }

  function placeCamera(midX, midZ) {
    const m = Math.min(1, shake);
    camera.position.set(
      CAM_DIR.x * camDist + midX * 0.12 + (Math.random() - 0.5) * m * 10,
      CAM_DIR.y * camDist + (Math.random() - 0.5) * m * 8,
      CAM_DIR.z * camDist + midZ * 0.10 + (Math.random() - 0.5) * m * 10
    );
    camera.fov = BASE_FOV + fovKick;
    camera.updateProjectionMatrix();
    camera.lookAt(midX * 0.12, 0, -30 + midZ * 0.10);
    shake *= 0.88;
  }

  /* ---------- sync ---------- */

  function placeTop(mesh, st, stats, dir, t) {
    if (!st) return;
    mesh.position.x = st.x - S / 2;
    mesh.position.z = st.y - S / 2;

    /* spin the blade layer (the art!) */
    mesh.userData.blade.rotation.y += dir * st.spin * 1.5;

    /* wobble tilt for unbalanced art */
    mesh.rotation.x = Math.sin(t * 0.021) * stats.wobble * 0.22;
    mesh.rotation.z = Math.cos(t * 0.017) * stats.wobble * 0.22;

    /* dash hop + glow */
    const targetY = st.dash ? 16 + Math.sin(t * 0.02) * 5 : 0;
    mesh.position.y += (targetY - mesh.position.y) * 0.2;
    if (st.dash) {
      mesh.userData.bladeMat.emissive = mesh.userData.bladeMat.emissive || new THREE.Color();
      mesh.userData.bladeMat.emissive.setHex(0x2dffd8);
      mesh.userData.bladeMat.emissiveIntensity = 0.75;
    } else {
      mesh.userData.bladeMat.emissiveIntensity = 0;
    }
  }

  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const st = Battle.getState();
    const t = performance.now();

    placeTop(topP, st.player, pStats, -1, t);
    placeTop(topE, st.enemy, eStats, 1, t);

    const anyDash = (st.player && st.player.dash) || (st.enemy && st.enemy.dash);
    fovKick += ((anyDash ? 8 : 0) - fovKick) * 0.12;

    const midX = st.player && st.enemy ? ((st.player.x + st.enemy.x) / 2 - S / 2) * 0.9 : 0;
    const midZ = st.player && st.enemy ? ((st.player.y + st.enemy.y) / 2 - S / 2) * 0.9 : 0;
    placeCamera(midX, midZ);

    renderer.render(scene, camera);
  }

  /* ---------- lifecycle ---------- */

  function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdfe4ea);
    scene.fog = new THREE.Fog(0xdfe4ea, 1700, 5200);

    camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 10, 12000);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a97a5, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(500, 1100, 350);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -750; sun.shadow.camera.right = 750;
    sun.shadow.camera.top = 750;   sun.shadow.camera.bottom = -750;
    sun.shadow.camera.far = 3200;
    scene.add(sun);

    buildStadium();
  }

  function start(playerCanvas, enemyCanvas, ps, es) {
    pStats = ps; eStats = es;
    const wrap = document.getElementById('arenaWrap');
    wrap.innerHTML = '';

    const size = Battle.arenaSize();
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      initScene();
    }
    /* reset dynamic bits */
    if (topP) scene.remove(topP);
    if (topE) scene.remove(topE);
    topP = buildTop(playerCanvas, '#3b9dff', ps);
    topE = buildTop(enemyCanvas, '#ff6a3d', es);
    scene.add(topP, topE);

    renderer.setSize(size, size);
    camera.aspect = 1;
    wrap.style.width = size + 'px';
    wrap.style.height = size + 'px';
    wrap.appendChild(renderer.domElement);
    autoFit();

    running = true;
    shake = 0; fovKick = 0;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
  }

  window.battleShake = (v) => { shake = Math.min(1.4, shake + v * 0.09); };

  return { start, stop };
})();
