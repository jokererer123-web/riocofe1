/*
 * RIO Coffee — 3D Hero Entry Animation
 * ------------------------------------------------------------
 * Pure Three.js (self-hosted, no build step) with a lightweight
 * custom physics/timeline. Sequence:
 *   1. A giant glossy, translucent boba sphere floats in the viewport.
 *   2. It bursts into tapioca pearls (instanced, gravity + funnel).
 *   3. The pearls fall into a clear 3D boba cup below.
 *   4. A colourful drink pours in and fills the cup to the top.
 *   5. A lid snaps on, a straw pierces the lid.
 *   6. The RIO logo appears as a decal on the cup.
 *   7. The camera settles and the real hero content fades in.
 *
 * Falls back gracefully to the CSS-drawn cup if WebGL is unavailable.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

(function () {
  const container = document.getElementById('hero3d');
  if (!container) return;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutBack = (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  // progress of `time` inside [start,end] eased with fn
  const prog = (time, start, end, fn) => {
    if (time <= start) return 0;
    if (time >= end) return 1;
    const t = (time - start) / (end - start);
    return (fn || easeInOutCubic)(t);
  };

  // ------------------------------------------------------------------
  // Timeline constants (seconds)
  // ------------------------------------------------------------------
  const T = {
    burst: 3.0,        // sphere pops
    pourStart: 3.9,    // liquid begins to pour
    pourEnd: 6.3,      // cup full
    lidStart: 6.5, lidEnd: 7.15,
    strawStart: 7.4, strawEnd: 8.0,
    logoStart: 8.05, logoEnd: 8.7,
    done: 8.9,         // camera settles + content reveal
    total: 9.2
  };

  // ------------------------------------------------------------------
  // World / cup dimensions
  // ------------------------------------------------------------------
  const SPHERE_Y = 2.6;   // giant sphere centre height
  const CUP = {
    topY: 1.0, bottomY: -2.0,
    height: 3.0,
    outerTop: 1.12, outerBottom: 0.9,
    innerTop: 1.03, innerBottom: 0.83,
    liquidBottom: -1.97, liquidFullTop: 0.5
  };
  const GRAV = 10.5;
  const FUNNEL = 2.0;
  const GROUND_Y = CUP.bottomY - 0.22; // invisible "table" pearls can rest on

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  let renderer, scene, camera, clock;
  let isMobile = false;
  let elapsed = 0;
  let started = false;
  let skipMode = false;
  let done = false;
  let burstTriggered = false;
  let disposed = false;

  // objects
  let sphereGroup, sphere, sphereCore;
  let cupGroup, cupBody, cupRim, cupBase, shadowDisc;
  let liquidMesh, liquidSurface, foamRing, pourMesh, iceGroup;
  let lidGroup;
  let strawGroup;
  let logoBadge, logoMat;
  let pearlMesh, pearlCount;
  const pearls = []; // {px,py,pz,vx,vy,vz,settled}
  let camPos, camLook, camPosTarget, camLookTarget;
  let dummy;

  // ---------------------------------------------------------------
  // Renderer / scene / camera
  // ---------------------------------------------------------------
  function initRenderer() {
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return false;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
    camPos = new THREE.Vector3(0, 1.9, 9.4);
    camLook = new THREE.Vector3(0, 2.1, 0);
    camPosTarget = camPos.clone();
    camLookTarget = camLook.clone();
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    return true;
  }

  function initEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    scene.environment = env;
    pmrem.dispose();
  }

  function initLights() {
    const hemi = new THREE.HemisphereLight(0xfff3df, 0x160d07, 1.15);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(5, 8, 4);
    scene.add(key);

    const gold = new THREE.PointLight(0xc8a45d, 20, 0, 2);
    gold.position.set(-3, 1.5, 4.5);
    scene.add(gold);

    const rim = new THREE.PointLight(0xfff6e8, 14, 0, 2);
    rim.position.set(3.5, 1.2, -3);
    scene.add(rim);
  }

  // ---------------------------------------------------------------
  // Build scene objects
  // ---------------------------------------------------------------
  function buildSphere() {
    sphereGroup = new THREE.Group();
    sphereGroup.position.set(0, SPHERE_Y, 0);

    sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 56, 40),
      new THREE.MeshPhysicalMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0.82,
        roughness: 0.06,
        metalness: 0.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.06,
        envMapIntensity: 2.1,
        depthWrite: false
      })
    );
    sphereCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.94, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0.7 })
    );
    const innerGlow = new THREE.PointLight(0xffb45a, 14, 0, 2);
    innerGlow.position.set(0, 0, 0);
    sphereGroup.add(sphereCore, sphere, innerGlow);
    scene.add(sphereGroup);
  }

  function buildCup() {
    cupGroup = new THREE.Group();
    cupGroup.position.set(0, 0, 0);

    // clear cup body (open ended tapered cylinder)
    cupBody = new THREE.Mesh(
      new THREE.CylinderGeometry(CUP.outerTop, CUP.outerBottom, CUP.height, 48, 1, true),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transmission: 0.0,
        transparent: true,
        opacity: 0.26,
        roughness: 0.04,
        metalness: 0.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        side: THREE.DoubleSide,
        envMapIntensity: 1.35,
        depthWrite: false
      })
    );
    cupBody.position.y = (CUP.topY + CUP.bottomY) / 2;

    // gold lip rim
    cupRim = new THREE.Mesh(
      new THREE.TorusGeometry(CUP.outerTop, 0.045, 16, 64),
      new THREE.MeshStandardMaterial({ color: 0xc8a45d, metalness: 0.85, roughness: 0.28, envMapIntensity: 1.1 })
    );
    cupRim.rotation.x = Math.PI / 2;
    cupRim.position.y = CUP.topY;

    // base ring
    cupBase = new THREE.Mesh(
      new THREE.TorusGeometry(CUP.outerBottom * 0.94, 0.035, 12, 48),
      new THREE.MeshStandardMaterial({ color: 0xa5823f, metalness: 0.7, roughness: 0.35 })
    );
    cupBase.rotation.x = Math.PI / 2;
    cupBase.position.y = CUP.bottomY + 0.04;

    // soft fake shadow under the cup
    shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1.9, 48),
      new THREE.MeshBasicMaterial({
        map: radialGradientTexture(0x000000, 0.55),
        transparent: true,
        depthWrite: false
      })
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = GROUND_Y + 0.01;

    cupGroup.add(cupBody, cupRim, cupBase, shadowDisc);
    scene.add(cupGroup);
  }

  function buildLiquid() {
    const innerTop = CUP.innerTop, innerBottom = CUP.innerBottom;
    const fullH = CUP.liquidFullTop - CUP.liquidBottom;

    const geo = new THREE.CylinderGeometry(innerTop, innerBottom, fullH, 40, 1, false);
    geo.translate(0, fullH / 2, 0); // origin at bottom
    liquidMesh = new THREE.Mesh(
      geo,
      new THREE.MeshPhysicalMaterial({
        color: 0xffb347,
        roughness: 0.15,
        metalness: 0.0,
        clearcoat: 0.5,
        clearcoatRoughness: 0.2,
        transmission: 0.25,
        thickness: 0.6,
        ior: 1.33,
        attenuationColor: 0xd88a2f,
        attenuationDistance: 3.0,
        emissive: 0x6b3a08,
        emissiveIntensity: 0.5,
        envMapIntensity: 1.4
      })
    );
    liquidMesh.position.y = CUP.liquidBottom;
    liquidMesh.scale.y = 0.0001;

    // glossy surface disc
    liquidSurface = new THREE.Mesh(
      new THREE.CircleGeometry(innerTop * 0.995, 40),
      new THREE.MeshPhysicalMaterial({
        color: 0xeeb46a,
        roughness: 0.08,
        clearcoat: 1.0,
        clearcoatRoughness: 0.06,
        envMapIntensity: 1.2
      })
    );
    liquidSurface.rotation.x = -Math.PI / 2;
    liquidSurface.visible = false;

    // creamy foam ring on the surface
    foamRing = new THREE.Mesh(
      new THREE.TorusGeometry(innerTop * 0.86, 0.035, 10, 40),
      new THREE.MeshStandardMaterial({ color: 0xf6e9cf, roughness: 0.7 })
    );
    foamRing.rotation.x = -Math.PI / 2;
    foamRing.visible = false;

    // pour stream (thin tapered column from above into the cup)
    pourMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.12, 1, 12, 1, true),
      new THREE.MeshPhysicalMaterial({
        color: 0xe9ab56,
        roughness: 0.2,
        transparent: true,
        opacity: 0.9,
        transmission: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    pourMesh.visible = false;

    // ice cubes (float near the surface)
    iceGroup = new THREE.Group();
    const iceGeo = new THREE.BoxGeometry(0.36, 0.36, 0.36);
    const iceMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 1.0,
      thickness: 0.5,
      roughness: 0.08,
      ior: 1.31,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.2
    });
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(iceGeo, iceMat);
      const a = (i / 4) * Math.PI * 2 + 0.4;
      c.position.set(Math.cos(a) * 0.5, rand(-1.6, -0.9), Math.sin(a) * 0.5);
      c.rotation.set(rand(0, 1), rand(0, 1), rand(0, 1));
      iceGroup.add(c);
    }
    iceGroup.visible = false;

    cupGroup.add(liquidMesh, liquidSurface, foamRing, pourMesh, iceGroup);
  }

  function buildLid() {
    lidGroup = new THREE.Group();
    const dark = 0x201408;
    const lidMat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.38, metalness: 0.15, envMapIntensity: 0.8 });

    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.27, 1.27, 0.1, 48), lidMat);
    disc.position.y = 0.05;

    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.05, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), lidMat);
    dome.scale.set(1, 0.55, 1);
    dome.position.y = 0.1;

    const goldEdge = new THREE.Mesh(
      new THREE.TorusGeometry(1.27, 0.045, 16, 64),
      new THREE.MeshStandardMaterial({ color: 0xc8a45d, metalness: 0.9, roughness: 0.25, envMapIntensity: 1.2 })
    );
    goldEdge.rotation.x = Math.PI / 2;
    goldEdge.position.y = 0.04;

    // straw hole + rim
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), new THREE.MeshBasicMaterial({ color: 0x0a0503 }));
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = 0.575;
    const holeRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.085, 0.02, 12, 32),
      new THREE.MeshStandardMaterial({ color: 0xc8a45d, metalness: 0.85, roughness: 0.3 })
    );
    holeRim.rotation.x = Math.PI / 2;
    holeRim.position.y = 0.575;

    lidGroup.add(disc, dome, goldEdge, hole, holeRim);
    lidGroup.position.y = 3.0; // hidden above view initially
    lidGroup.visible = false;
    scene.add(lidGroup);
  }

  function buildStraw() {
    strawGroup = new THREE.Group();
    const strawMat = new THREE.MeshStandardMaterial({ color: 0xf1e6d2, roughness: 0.42, envMapIntensity: 0.9 });
    const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.7, 16), strawMat);
    straw.position.y = 1.85;
    straw.rotation.z = 0.16;
    straw.rotation.x = -0.1;
    strawGroup.add(straw);

    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.012, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xc8a45d, metalness: 0.85, roughness: 0.3 })
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = 1.15;
    straw.add(band);

    strawGroup.position.set(0, 4.2, 0);
    strawGroup.visible = false;
    scene.add(strawGroup);
  }

  function buildPearls() {
    pearlCount = isMobile ? 92 : 150;
    const geo = new THREE.SphereGeometry(0.115, 20, 14);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x2a130c,
      roughness: 0.28,
      metalness: 0.0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.9
    });
    pearlMesh = new THREE.InstancedMesh(geo, mat, pearlCount);
    pearlMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pearlMesh.visible = false;
    cupGroup.add(pearlMesh);

    // spawn positions: fibonacci sphere over the giant sphere's surface + a little interior
    const R = 1.5;
    const n = pearlCount;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2; // -1..1
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const th = golden * i;
      const rr = i % 7 === 0 ? R * rand(0.35, 0.7) : R * 0.99;
      const px = Math.cos(th) * radius * rr;
      const pz = Math.sin(th) * radius * rr;
      const py = y * rr;
      pearls.push({
        px, py: py + SPHERE_Y, pz,
        vx: (px / R) * rand(0.4, 1.15) + rand(-0.25, 0.25),
        vy: rand(1.6, 3.9),
        vz: (pz / R) * rand(0.4, 1.15) + rand(-0.25, 0.25),
        settled: false
      });
    }
  }

  function buildLogo() {
    // curved decal band hugging the cup front
    const bandGeo = new THREE.CylinderGeometry(CUP.outerTop + 0.045, CUP.outerTop + 0.045, 1.18, 40, 1, true, -0.62, 1.24);
    logoMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: null,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    logoBadge = new THREE.Mesh(bandGeo, logoMat);
    logoBadge.position.y = -0.28;
    cupGroup.add(logoBadge);

    const loader = new THREE.TextureLoader();
    loader.load(
      'img/logo.png',
      (tex) => {
        const img = tex.image;
        if (!img || !img.width) return;
        const cvs = buildBadgeCanvas(img);
        cvs.colorSpace = THREE.SRGBColorSpace;
        cvs.anisotropy = 4;
        logoMat.map = cvs;
        logoMat.needsUpdate = true;
      },
      undefined,
      () => { /* logo missing — badge simply stays invisible */ }
    );
  }

  // Draw the (square, background-filled) logo into a circular badge with a gold ring
  function buildBadgeCanvas(img) {
    const S = 512;
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = S;
    const ctx = cvs.getContext('2d');

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, 0, 0, S, S);
    ctx.restore();

    ctx.lineWidth = S * 0.022;
    ctx.strokeStyle = '#c8a45d';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = S * 0.006;
    ctx.strokeStyle = '#f5ecdd';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.425, 0, Math.PI * 2);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function radialGradientTexture(hex, alpha) {
    const S = 256;
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = S;
    const ctx = cvs.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    const col = new THREE.Color(hex);
    g.addColorStop(0, `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${alpha})`);
    g.addColorStop(0.65, `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${alpha * 0.35})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---------------------------------------------------------------
  // Layout targets per breakpoint
  // ---------------------------------------------------------------
  function layoutTargets() {
    if (isMobile) {
      return {
        camPos: new THREE.Vector3(0, 0.7, 10.2),
        camLook: new THREE.Vector3(0, 1.0, 0),
        cupPos: new THREE.Vector3(0, 1.1, 0),
        cupScale: 0.58
      };
    }
    return {
      camPos: new THREE.Vector3(0, -0.35, 8.6),
      camLook: new THREE.Vector3(0, -0.3, 0),
      cupPos: new THREE.Vector3(2.35, -0.1, 0),
      cupScale: 1.0
    };
  }

  // ---------------------------------------------------------------
  // Pearl physics
  // ---------------------------------------------------------------
  function liquidSurfaceY() {
    const t = prog(elapsed, T.pourStart, T.pourEnd, easeInOutCubic);
    return lerp(CUP.liquidBottom, CUP.liquidFullTop, t);
  }

  function stepPearls(dt) {
    const surfaceY = liquidSurfaceY();
    const prePour = elapsed < T.pourStart;
    for (let i = 0; i < pearlCount; i++) {
      const p = pearls[i];

      p.vy -= GRAV * dt;
      p.vx += -p.px * FUNNEL * dt;
      p.vz += -p.pz * FUNNEL * dt;
      p.vx *= (1 - 0.25 * dt);
      p.vz *= (1 - 0.25 * dt);

      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;

      const r = 0.115;
      const hd = Math.hypot(p.px, p.pz);
      const inY = p.py > CUP.bottomY && p.py < CUP.topY;
      const innerR = inY
        ? lerp(CUP.innerBottom, CUP.innerTop, (p.py - CUP.bottomY) / CUP.height)
        : (p.py <= CUP.bottomY ? CUP.innerBottom : CUP.innerTop);

      // keep inside the cup walls
      const maxR = innerR - r * 0.55;
      if (inY && hd > maxR) {
        const s = maxR / hd;
        p.px *= s; p.pz *= s;
        p.vx *= 0.4; p.vz *= 0.4;
      }

      // rest on the liquid surface (or the cup floor before pouring starts)
      const restY = prePour ? CUP.bottomY + r + 0.02 : surfaceY + r * 0.4;
      if (hd <= innerR - r * 0.3 && p.py <= restY) {
        p.py = restY;
        p.vy = 0;
        p.vx *= 0.2; p.vz *= 0.2;
        if (hd < CUP.innerTop) p.settled = true;
      } else if (p.py - r <= GROUND_Y) {
        // stray pearls rest on the table around the cup
        p.py = GROUND_Y + r;
        p.vy = 0;
        p.vx *= 0.3; p.vz *= 0.3;
        p.settled = true;
      }

      const bob = p.settled && surfaceY > CUP.bottomY + 0.2
        ? Math.sin(elapsed * 2.1 + p.px * 7 + p.pz * 5) * 0.008
        : 0;
      dummy.position.set(p.px, p.py + bob, p.pz);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      pearlMesh.setMatrixAt(i, dummy.matrix);
    }
  }

  // ---------------------------------------------------------------
  // Timeline update
  // ---------------------------------------------------------------
  function updateTimeline(dt) {
    // --- sphere intro & burst ---
    if (elapsed < T.burst) {
      sphereGroup.visible = true;
      const bobY = Math.sin(elapsed * 1.4) * 0.12;
      sphereGroup.position.y = SPHERE_Y + bobY;
      sphereGroup.rotation.y += dt * 0.15;
      sphereGroup.rotation.x = Math.sin(elapsed * 0.7) * 0.05;
      const introScale = clamp(elapsed / 0.8, 0.001, 1);
      sphereGroup.scale.setScalar(introScale);
      sphereCore.material.opacity = 0.2 + (elapsed / T.burst) * 0.18;
    } else if (elapsed < T.burst + 0.22) {
      const k = prog(elapsed, T.burst, T.burst + 0.22, easeOutCubic);
      sphereGroup.scale.setScalar(1 + k * 0.35);
      sphereGroup.visible = true;
      pearlMesh.visible = true;
    } else {
      sphereGroup.visible = false;
      pearlMesh.visible = true;
    }

    // --- liquid fill ---
    const liquidK = prog(elapsed, T.pourStart, T.pourEnd, easeInOutCubic);
    const surfaceY = liquidSurfaceY();
    const surfR = lerp(CUP.innerBottom, CUP.innerTop, liquidK);
    liquidMesh.scale.y = Math.max(0.0001, liquidK);
    liquidSurface.position.y = surfaceY;
    liquidSurface.visible = liquidK > 0.03;
    liquidSurface.scale.setScalar(surfR / CUP.innerTop);
    foamRing.position.y = surfaceY + 0.015;
    foamRing.visible = liquidK > 0.5;
    foamRing.scale.setScalar(surfR / CUP.innerTop);

    // ice cubes float near the surface
    if (liquidK > 0.12) {
      iceGroup.visible = true;
      iceGroup.position.y = surfaceY - 0.24 + Math.sin(elapsed * 1.8) * 0.03;
      iceGroup.rotation.y += dt * 0.12;
    } else {
      iceGroup.visible = false;
    }

    // --- pour stream ---
    if (elapsed >= T.pourStart && elapsed <= T.pourEnd) {
      pourMesh.visible = true;
      const topY = 3.1;
      const len = topY - surfaceY;
      pourMesh.scale.y = Math.max(0.02, len);
      pourMesh.position.y = surfaceY + len / 2;
      pourMesh.position.x = Math.sin(elapsed * 3.0) * 0.03;
      pourMesh.position.z = Math.cos(elapsed * 2.4) * 0.03;
    } else if (elapsed < T.pourEnd + 0.25) {
      pourMesh.visible = true;
      pourMesh.material.opacity = 0.9 * (1 - prog(elapsed, T.pourEnd, T.pourEnd + 0.25));
      pourMesh.scale.y = Math.max(0.02, pourMesh.scale.y - dt * 8);
    } else {
      pourMesh.visible = false;
      pourMesh.material.opacity = 0.9;
    }

    // --- lid snap ---
    lidGroup.visible = elapsed >= T.lidStart;
    const lidK = prog(elapsed, T.lidStart, T.lidEnd, easeOutBack);
    lidGroup.position.y = lerp(3.0, CUP.topY + 0.06, lidK);
    lidGroup.rotation.y = (1 - lidK) * 1.2;

    // --- straw pierce ---
    strawGroup.visible = elapsed >= T.strawStart;
    const strawK = prog(elapsed, T.strawStart, T.strawEnd, easeOutBack);
    strawGroup.position.y = lerp(4.4, 1.72, strawK);
    strawGroup.rotation.z = lerp(0.3, 0.16, strawK);

    // --- logo decal ---
    const logoK = prog(elapsed, T.logoStart, T.logoEnd, easeOutCubic);
    logoMat.opacity = logoK;

    // --- pearls ---
    if (pearlMesh.visible) {
      stepPearls(dt);
      pearlMesh.instanceMatrix.needsUpdate = true;
    }
  }

  function updateCamera(dt) {
    const t = clamp(1 - Math.exp(-4.0 * dt), 0, 1);
    camPos.lerp(camPosTarget, t);
    camLook.lerp(camLookTarget, t);
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    if (done) {
      const lt = layoutTargets();
      const ct = clamp(1 - Math.exp(-3.0 * dt), 0, 1);
      cupGroup.position.lerp(lt.cupPos, ct);
      cupGroup.scale.setScalar(lerp(cupGroup.scale.x, lt.cupScale, ct));
      cupGroup.rotation.y += dt * 0.14;
      cupGroup.position.y += Math.sin(elapsed * 1.1) * 0.0015;
    }
  }

  function setPhaseTargets() {
    if (done) {
      const lt = layoutTargets();
      camPosTarget.copy(lt.camPos);
      camLookTarget.copy(lt.camLook);
      return;
    }
    if (elapsed < T.burst) {
      camPosTarget.set(0, 1.9, 9.4);
      camLookTarget.set(0, 2.1, 0);
    } else if (elapsed < T.lidStart) {
      camPosTarget.set(0, -0.5, 7.8);
      camLookTarget.set(0, -0.35, 0);
    } else {
      camPosTarget.set(0, -0.45, 7.4);
      camLookTarget.set(0, -0.2, 0);
    }
  }

  // ---------------------------------------------------------------
  // Intro UI
  // ---------------------------------------------------------------
  function finish() {
    if (done) return;
    done = true;
    skipMode = false;
    document.body.classList.remove('intro-active', 'intro-lock');
    const skipBtn = document.getElementById('hero3dSkip');
    const orderBtn = document.getElementById('hero3dOrder');
    if (skipBtn) skipBtn.classList.add('hidden');
    if (orderBtn) orderBtn.classList.add('show');
  }

  function skip() {
    if (done) return;
    skipMode = true;
    document.body.classList.remove('intro-lock');
    const skipBtn = document.getElementById('hero3dSkip');
    if (skipBtn) skipBtn.classList.add('hidden');
  }

  // ---------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------
  function animate() {
    if (disposed) return;
    requestAnimationFrame(animate);

    const dt = Math.min(0.05, clock.getDelta());
    if (!started) { renderer.render(scene, camera); return; }

    if (skipMode && !done) {
      elapsed = Math.min(T.done + 0.2, elapsed + dt * 6.5);
    } else {
      elapsed += dt;
    }

    if (!done && elapsed >= T.done) finish();
    setPhaseTargets();
    updateTimeline(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------
  // Fallback (no WebGL / init failure)
  // ---------------------------------------------------------------
  function fallback() {
    disposed = true;
    document.body.classList.remove('intro-active', 'intro-lock');
    container.classList.add('hidden');
    const skipBtn = document.getElementById('hero3dSkip');
    if (skipBtn) skipBtn.classList.add('hidden');
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  function resize() {
    if (!renderer) return;
    isMobile = window.innerWidth < 820;
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
    renderer.setSize(w, h);
    setPhaseTargets();
  }

  function bindEvents() {
    // click / tap bursts the sphere early; a second tap skips the rest
    window.addEventListener('pointerdown', () => {
      if (done) return;
      if (elapsed < T.burst && !burstTriggered) {
        burstTriggered = true;
        elapsed = T.burst;
      } else if (!skipMode) {
        skip();
      }
    });
    // scrolling skips the intro
    window.addEventListener('wheel', () => { if (!done) skip(); }, { passive: true });
    window.addEventListener('touchmove', () => { if (!done) skip(); }, { passive: true });
    const skipBtn = document.getElementById('hero3dSkip');
    if (skipBtn) skipBtn.addEventListener('click', (e) => { e.stopPropagation(); skip(); });
    const orderBtn = document.getElementById('hero3dOrder');
    if (orderBtn) orderBtn.addEventListener('click', () => {
      const target = document.getElementById('menu');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    window.addEventListener('resize', resize);

    // nav anchor clicks also skip so the page can scroll freely
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', () => { if (!done) skip(); });
    });
  }

  function start() {
    try {
      if (!initRenderer()) { fallback(); return; }
      initEnvironment();
      initLights();
      buildSphere();
      buildCup();
      buildLiquid();
      buildLid();
      buildStraw();
      dummy = new THREE.Object3D();
      buildPearls();
      buildLogo();
      document.body.classList.add('has-3d'); // reveal canvas, hide CSS cup
      resize();
      setPhaseTargets();
      bindEvents();
      clock = new THREE.Clock();
      requestAnimationFrame(() => { started = true; });
      animate();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[hero3d] init failed, falling back:', err);
      fallback();
    }
  }

  // Respect reduced-motion preferences: show the static site immediately
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.body.classList.remove('intro-active', 'intro-lock');
    return;
  }

  document.body.classList.add('intro-lock');
  start();

  // Small read-only/debug surface (also used by automated smoke tests)
  window.RIO3D = {
    seek(t) {
      const target = clamp(Number(t) || 0, 0, T.total);
      if (target > elapsed) {
        // simulate forward so physics/timeline reach the requested time
        const step = 1 / 60;
        const steps = Math.min(600, Math.round((target - elapsed) / step));
        for (let i = 0; i < steps; i++) { elapsed += step; updateTimeline(step); }
        elapsed = target;
      } else {
        elapsed = target;
      }
      if (elapsed >= T.done) finish();
    },
    get elapsed() { return elapsed; },
    get done() { return done; },
    get pearlCount() { return pearlCount; },
    get sphereVisible() { return !!(sphereGroup && sphereGroup.visible); },
    get pearlsVisible() { return !!(pearlMesh && pearlMesh.visible); },
    get lidY() { return lidGroup ? lidGroup.position.y : null; },
    get strawY() { return strawGroup ? strawGroup.position.y : null; },
    get logoOpacity() { return logoMat ? logoMat.opacity : null; },
    get logoMapped() { return !!(logoMat && logoMat.map); },
    get liquidScale() { return liquidMesh ? liquidMesh.scale.y : null; },
    get settledPearls() { return pearls.filter((p) => p.settled).length; }
  };
})();
