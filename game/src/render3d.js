// VELVET CITY — the 3D renderer (three.js, vendored). The sim stays a flat top-down
// world (x, y, angle); this file turns it into a dusk city. Mapping: world (x, y) ->
// three (x, 0, y); a sim heading `a` becomes rotation.y = -a.
//
// Realism: a procedural environment map (dusk sky rendered once through PMREM) lights
// the PBR paint, glass and wet asphalt; facades are procedural canvas textures (framed
// windows, warm/cool lit glass, shopfronts, grime); rooftops carry water towers and
// blinking antennas; the streets have hydrants, bins, bus stops and working traffic
// lights; a distant skyline, stars and drifting clouds ring the map. All visuals
// derive from the seed or sim time, so two runs stay byte-identical.

const SCREEN_TITLE = 0;
const SCREEN_PLAY = 1;
const SCREEN_PAUSED = 2;
const SCREEN_OVER = 3;
const SCREEN_WIN = 4;

function createRenderer(canvas, highQuality) {
  // Screenshot mode gets MSAA; live play runs without it — under a software renderer
  // MSAA costs more than a frame per second, and the game must stay responsive.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !!highQuality });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(VIEW.width, VIEW.height, false);
  renderer.shadowMap.enabled = true;
  // Screenshot mode gets soft shadows; live play uses a single-tap shadow map.
  renderer.shadowMap.type = highQuality ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = REALISM.exposure;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 700, 2600);

  // Dusk sky: a vertical gradient canvas behind everything.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d');
  const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 256);
  skyGrad.addColorStop(0, PALETTE.skyTop);
  skyGrad.addColorStop(0.5, PALETTE.skyMid);
  skyGrad.addColorStop(0.78, '#b45a6a');
  skyGrad.addColorStop(1, PALETTE.skyHorizon);
  skyCtx.fillStyle = skyGrad;
  skyCtx.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.encoding = THREE.sRGBEncoding;
  scene.background = skyTex;

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, VIEW.width / VIEW.height, 1, 5000);
  camera.position.set(0, 200, 400);

  // Environment map: a tiny dusk scene rendered once through PMREM, so standard
  // materials reflect sky, sun and neon instead of nothing. Fixed geometry, no
  // random draws — identical on every run.
  {
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(
      new THREE.SphereGeometry(50, 16, 12),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })
    );
    envScene.add(envSky);
    const envSun = new THREE.Mesh(
      new THREE.CircleGeometry(6, 24),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0') })
    );
    envSun.position.set(-30, 12, -35);
    envSun.lookAt(0, 0, 0);
    envScene.add(envSun);
    // Neon strips on the horizon: the city's glow, as seen by a reflection.
    const stripColors = ['#29e6ff', '#ff2e88', '#ffb03f', '#a8ff3f'];
    for (let i = 0; i < 8; i += 1) {
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 1.6),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(stripColors[i % stripColors.length]) })
      );
      const a = (i / 8) * TAU;
      strip.position.set(Math.cos(a) * 44, 2 + (i % 3), Math.sin(a) * 44);
      strip.lookAt(0, 2, 0);
      envScene.add(strip);
    }
    const envGround = new THREE.Mesh(
      new THREE.CircleGeometry(48, 24),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#14101e') })
    );
    envGround.rotation.x = -Math.PI / 2;
    envGround.position.y = -8;
    envScene.add(envGround);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();
  }

  // Lighting: low warm sun (long shadows) + purple sky fill + a touch of ambient.
  const hemi = new THREE.HemisphereLight(new THREE.Color('#6a5acd'), new THREE.Color('#1c1626'), 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.sun), 1.35);
  sun.position.set(-900, 700, -500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(
    highQuality ? REALISM.shadowMapShot : REALISM.shadowMapPlay,
    highQuality ? REALISM.shadowMapShot : REALISM.shadowMapPlay
  );
  sun.shadow.camera.left = -500;
  sun.shadow.camera.right = 500;
  sun.shadow.camera.top = 500;
  sun.shadow.camera.bottom = -500;
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 3000;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  const amb = new THREE.AmbientLight(new THREE.Color('#30284a'), 0.5);
  scene.add(amb);

  // Sun disc + glow sprite, low on the horizon.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(90, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0'), fog: false })
  );
  sunDisc.position.set(-1400, 260, -1800);
  sunDisc.lookAt(1600, 200, 1200);
  scene.add(sunDisc);

  // Canvas texture helpers.
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  // Radial glow texture (white core, warm edge).
  const glowTex = canvasTex(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,244,214,1)');
    grad.addColorStop(0.35, 'rgba(255,214,130,0.55)');
    grad.addColorStop(1, 'rgba(255,180,80,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
  // Soft cloud blob texture (overlapping radial gradients).
  const cloudTex = canvasTex(256, 128, (g) => {
    const blobs = [[70, 70, 52], [128, 58, 64], [186, 72, 50], [110, 84, 44], [160, 88, 40]];
    for (const [x, y, r] of blobs) {
      const grad = g.createRadialGradient(x, y, 2, x, y, r);
      grad.addColorStop(0, 'rgba(214,180,220,0.55)');
      grad.addColorStop(1, 'rgba(214,180,220,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 128);
    }
  });

  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: new THREE.Color('#ffb03f'), transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sunGlow.position.set(-1400, 260, -1800);
  sunGlow.scale.set(720, 720, 1);
  scene.add(sunGlow);

  // Stars: faint points high above the city, positions from the index (golden angle).
  {
    const starCount = 220;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const a = (i * 2.39996) % TAU; // golden-angle spread, no RNG needed
      const e = 0.35 + ((i * 0.61803) % 1) * 1.1;
      const r = 3800;
      starPos[i * 3] = WORLD.width / 2 + Math.cos(a) * Math.cos(e) * r;
      starPos[i * 3 + 1] = 500 + Math.sin(e) * r * 0.6;
      starPos[i * 3 + 2] = WORLD.height / 2 + Math.sin(a) * Math.cos(e) * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: new THREE.Color('#cdd6ff'), size: 2.4, sizeAttenuation: false,
      transparent: true, opacity: 0.7, fog: false,
    }));
    scene.add(stars);
  }

  // Drifting clouds: soft sprites high up, positions from sim time (deterministic).
  const clouds = [];
  for (let i = 0; i < 7; i += 1) {
    const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, opacity: 0.16 + (i % 3) * 0.04, depthWrite: false, fog: false,
    }));
    cloud.position.set(200 + i * 420, 760 + (i % 3) * 90, 300 + (i % 4) * 380);
    cloud.scale.set(520 + (i % 3) * 160, 200 + (i % 2) * 60, 1);
    cloud.userData.baseX = cloud.position.x;
    cloud.userData.speed = 2 + (i % 3);
    scene.add(cloud);
    clouds.push(cloud);
  }

  // Distant skyline: dark silhouette towers ringing the map, so the horizon reads
  // as a real city. One instanced mesh, positions from the index.
  {
    const skyCount = 64;
    const skyGeo = new THREE.BoxGeometry(1, 1, 1);
    skyGeo.translate(0, 0.5, 0);
    const skyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.skyline), fog: false });
    const skyInst = new THREE.InstancedMesh(skyGeo, skyMat, skyCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < skyCount; i += 1) {
      const side = i % 4;
      const t = ((i * 0.61803) % 1);
      const along = -500 + t * 4400;
      const out = 2600 + ((i * 0.38197) % 1) * 500;
      let x = along;
      let z = along;
      if (side === 0) { x = along; z = -out; }
      else if (side === 1) { x = WORLD.width + out; z = along; }
      else if (side === 2) { x = along; z = WORLD.height + out; }
      else { x = -out; z = along; }
      const h = 150 + ((i * 0.75488) % 1) * 280;
      dummy.position.set(x, 0, z);
      dummy.scale.set(90 + ((i * 0.31831) % 1) * 90, h, 90 + ((i * 0.5236) % 1) * 90);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      skyInst.setMatrixAt(i, dummy.matrix);
    }
    skyInst.instanceMatrix.needsUpdate = true;
    scene.add(skyInst);
  }

  // Facades: one per building colour, lit/dark, plus a shopfront variant. Windows
  // have frames and two lit tones (warm/cool); the wall has grime and a dark base.
  const facadeMats = {};
  for (const color of PALETTE.building) {
    for (const lit of [true, false]) {
      for (const shop of [false, true]) {
        facadeMats[color + (lit ? '|lit' : '|dark') + (shop ? '|shop' : '')] = new THREE.MeshLambertMaterial({
          map: canvasTex(256, 256, (g) => {
            g.fillStyle = color;
            g.fillRect(0, 0, 256, 256);
            // Subtle vertical grime streaks + a darker base floor.
            for (let s = 0; s < 7; s += 1) {
              const sx = 12 + ((s * 37) % 220);
              g.fillStyle = 'rgba(0,0,0,0.10)';
              g.fillRect(sx, 0, 5 + (s % 3) * 3, 256);
            }
            g.fillStyle = 'rgba(0,0,0,0.22)';
            g.fillRect(0, 228, 256, 28);
            const cols = 5;
            const rows = 9;
            for (let row = 0; row < rows; row += 1) {
              for (let col = 0; col < cols; col += 1) {
                const wx = 12 + col * 48;
                const wy = 10 + row * 24;
                const idx = row * cols + col;
                // Window frame.
                g.fillStyle = 'rgba(0,0,0,0.35)';
                g.fillRect(wx - 2, wy - 2, 32, 20);
                const on = lit ? (idx % 3 !== 0) : (idx % 5 === 0);
                if (on) {
                  g.fillStyle = idx % 4 === 0 ? PALETTE.windowLitCool : PALETTE.windowLit;
                } else {
                  g.fillStyle = PALETTE.windowDark;
                }
                g.fillRect(wx, wy, 28, 16);
                // A lit window's warm spill on the frame below it.
                if (on && row < rows - 1) {
                  g.fillStyle = 'rgba(255,215,106,0.10)';
                  g.fillRect(wx, wy + 16, 28, 4);
                }
              }
            }
            if (shop) {
              // Ground-floor retail: glass storefront with mullions, a striped awning,
              // and a lit band above it.
              g.fillStyle = PALETTE.shopGlass;
              g.fillRect(8, 226, 240, 26);
              g.fillStyle = 'rgba(20,26,40,0.55)';
              for (let m = 0; m < 6; m += 1) g.fillRect(8 + m * 42, 226, 4, 26);
              g.fillStyle = 'rgba(255,215,106,0.35)';
              g.fillRect(8, 226, 240, 4);
              for (let a = 0; a < 8; a += 1) {
                g.fillStyle = a % 2 === 0 ? '#ff2e88' : '#f2f0e8';
                g.fillRect(8 + a * 30, 210, 30, 14);
              }
              g.fillStyle = 'rgba(0,0,0,0.25)';
              g.fillRect(8, 224, 240, 2);
            } else {
              // A dark entrance door and steps at the base.
              g.fillStyle = '#14161f';
              g.fillRect(112, 228, 32, 28);
              g.fillStyle = 'rgba(255,255,255,0.12)';
              g.fillRect(108, 252, 40, 4);
            }
          }),
        });
      }
    }
  }

  // Neon sign textures, cached per word+colour.
  const signTexCache = {};
  function signTexture(word, color) {
    const key = word + '|' + color;
    if (signTexCache[key]) return signTexCache[key];
    const t = canvasTex(256, 48, (g) => {
      g.clearRect(0, 0, 256, 48);
      g.font = 'bold 34px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = color;
      g.shadowBlur = 16;
      g.fillStyle = color;
      g.fillText(word, 128, 26);
      g.shadowBlur = 4;
      g.fillStyle = '#ffffff';
      g.fillText(word, 128, 26);
    });
    signTexCache[key] = t;
    return t;
  }

  // Ground texture: roads, sidewalks, crosswalks, plaza — plus wear (asphalt patches,
  // oil stains, manhole covers, curb lines) and warm light pools under every lamp.
  function buildGroundTexture(city) {
    const scale = 2048 / WORLD.width;
    return canvasTex(2048, 1536, (g) => {
      g.fillStyle = PALETTE.ground;
      g.fillRect(0, 0, 2048, 1536);
      // Blocks (sidewalks) first, so roads read as gaps between them.
      const cols = CITY.roadsX.length + 1;
      const rows = CITY.roadsY.length + 1;
      g.fillStyle = PALETTE.sidewalk;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const x0 = col === 0 ? 0 : CITY.roadsX[col - 1] + ROAD_HALF;
          const x1 = col >= CITY.roadsX.length ? WORLD.width : CITY.roadsX[col] - ROAD_HALF;
          const y0 = row === 0 ? 0 : CITY.roadsY[row - 1] + ROAD_HALF;
          const y1 = row >= CITY.roadsY.length ? WORLD.height : CITY.roadsY[row] - ROAD_HALF;
          g.fillRect(x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale);
          // Sidewalk tile seams.
          g.strokeStyle = 'rgba(0,0,0,0.18)';
          g.lineWidth = 1;
          for (let tx = x0 + 64; tx < x1; tx += 64) {
            g.beginPath();
            g.moveTo(tx * scale, y0 * scale);
            g.lineTo(tx * scale, y1 * scale);
            g.stroke();
          }
          for (let ty = y0 + 64; ty < y1; ty += 64) {
            g.beginPath();
            g.moveTo(x0 * scale, ty * scale);
            g.lineTo(x1 * scale, ty * scale);
            g.stroke();
          }
        }
      }
      // Plaza paving with a tile grid.
      const pb = CITY.plazaBlock;
      const px0 = CITY.roadsX[pb.col - 1] + ROAD_HALF;
      const px1 = CITY.roadsX[pb.col] - ROAD_HALF;
      const py0 = CITY.roadsY[pb.row - 1] + ROAD_HALF;
      const py1 = CITY.roadsY[pb.row] - ROAD_HALF;
      g.fillStyle = PALETTE.plaza;
      g.fillRect(px0 * scale, py0 * scale, (px1 - px0) * scale, (py1 - py0) * scale);
      g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.lineWidth = 2;
      g.strokeRect(px0 * scale + 6, py0 * scale + 6, (px1 - px0) * scale - 12, (py1 - py0) * scale - 12);
      g.strokeStyle = 'rgba(0,0,0,0.16)';
      g.lineWidth = 1;
      for (let tx = px0 + 48; tx < px1; tx += 48) {
        g.beginPath(); g.moveTo(tx * scale, py0 * scale); g.lineTo(tx * scale, py1 * scale); g.stroke();
      }
      for (let ty = py0 + 48; ty < py1; ty += 48) {
        g.beginPath(); g.moveTo(px0 * scale, ty * scale); g.lineTo(px1 * scale, ty * scale); g.stroke();
      }
      // Roads.
      g.fillStyle = PALETTE.road;
      for (const rx of CITY.roadsX) g.fillRect((rx - ROAD_HALF) * scale, 0, CITY.roadWidth * scale, 1536);
      for (const ry of CITY.roadsY) g.fillRect(0, (ry - ROAD_HALF) * scale, 2048, CITY.roadWidth * scale);
      // Asphalt wear: patches and oil stains (deterministic).
      for (let i = 0; i < 60; i += 1) {
        const rx = CITY.roadsX[i % CITY.roadsX.length];
        const wy = ((i * 197) % WORLD.height);
        g.fillStyle = 'rgba(0,0,0,0.10)';
        g.beginPath();
        g.ellipse(rx * scale + ((i * 53) % 40 - 20) * scale, wy * scale, (18 + (i % 5) * 6) * scale, (10 + (i % 3) * 5) * scale, 0, 0, TAU);
        g.fill();
      }
      // Manhole covers at some intersections.
      for (let xi = 0; xi < CITY.roadsX.length; xi += 1) {
        for (let yi = 0; yi < CITY.roadsY.length; yi += 1) {
          if ((xi + yi) % 3 !== 0) continue;
          const cx = CITY.roadsX[xi] * scale;
          const cy = CITY.roadsY[yi] * scale;
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.beginPath(); g.arc(cx, cy, 9 * scale, 0, TAU); g.fill();
          g.strokeStyle = 'rgba(255,255,255,0.18)';
          g.lineWidth = 1.5;
          g.beginPath(); g.arc(cx, cy, 9 * scale, 0, TAU); g.stroke();
        }
      }
      // Lane dashes.
      g.fillStyle = PALETTE.lane;
      for (const rx of CITY.roadsX) {
        for (let y = 0; y < WORLD.height; y += 96) g.fillRect(rx * scale - 2, y * scale, 4, 44 * scale);
      }
      for (const ry of CITY.roadsY) {
        for (let x = 0; x < WORLD.width; x += 96) g.fillRect(x * scale, ry * scale - 2, 44 * scale, 4);
      }
      // Crosswalks at every intersection.
      g.fillStyle = 'rgba(255,255,255,0.55)';
      for (const rx of CITY.roadsX) {
        for (const ry of CITY.roadsY) {
          for (let i = -2; i <= 2; i += 1) {
            g.fillRect((rx - 24 + i * 10) * scale, (ry - ROAD_HALF + 6) * scale, 5 * scale, 12 * scale);
            g.fillRect((rx - 24 + i * 10) * scale, (ry + ROAD_HALF - 18) * scale, 5 * scale, 12 * scale);
          }
        }
      }
      // Light pools under every lamp.
      for (const l of city.lamps) {
        const grad = g.createRadialGradient(l.x * scale, l.y * scale, 2, l.x * scale, l.y * scale, 70 * scale);
        grad.addColorStop(0, 'rgba(255,214,130,0.28)');
        grad.addColorStop(1, 'rgba(255,214,130,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(l.x * scale, l.y * scale, 70 * scale, 0, TAU);
        g.fill();
      }
    });
  }

  // ---- Static city ----
  let cityGroup = null;
  let beaconInst = null;
  let beaconCount = 0;
  const bulbMeshes = { red: null, amber: null, green: null };
  let trafficLights = [];
  const beaconPositions = [];

  function buildCity(city) {
    if (cityGroup) {
      scene.remove(cityGroup);
      cityGroup = null;
    }
    cityGroup = new THREE.Group();
    // Ground: a standard material so the dusk sky reflects faintly off the asphalt.
    const groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.width, WORLD.height),
      new THREE.MeshStandardMaterial({
        map: buildGroundTexture(city), roughness: 0.55, metalness: 0.12,
        envMapIntensity: REALISM.envIntensityGround,
      })
    );
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.set(WORLD.width / 2, 0, WORLD.height / 2);
    groundMesh.receiveShadow = true;
    cityGroup.add(groundMesh);

    // Buildings: one InstancedMesh per facade material, one for roofs.
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    unitBox.translate(0, 0.5, 0); // base at y=0, so scale.y = height
    const byMat = {};
    for (const b of city.buildings) {
      const key = b.color + (b.lit ? '|lit' : '|dark') + (b.shopfront ? '|shop' : '');
      if (!byMat[key]) byMat[key] = [];
      byMat[key].push(b);
    }
    const dummy = new THREE.Object3D();
    for (const key of Object.keys(byMat)) {
      const list = byMat[key];
      const inst = new THREE.InstancedMesh(unitBox, facadeMats[key], list.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      list.forEach((b, i) => {
        dummy.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
        dummy.scale.set(b.w, buildingHeight(b), b.h);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      cityGroup.add(inst);
    }
    // Roof caps, coloured per building.
    const roofInst = new THREE.InstancedMesh(unitBox, new THREE.MeshLambertMaterial({ color: 0xffffff }), city.buildings.length);
    roofInst.castShadow = false;
    roofInst.receiveShadow = true;
    city.buildings.forEach((b, i) => {
      dummy.position.set(b.x + b.w / 2, buildingHeight(b), b.y + b.h / 2);
      dummy.scale.set(b.w + 2, 3, b.h + 2);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      roofInst.setMatrixAt(i, dummy.matrix);
      roofInst.setColorAt(i, new THREE.Color(b.roof));
    });
    roofInst.instanceMatrix.needsUpdate = true;
    if (roofInst.instanceColor) roofInst.instanceColor.needsUpdate = true;
    cityGroup.add(roofInst);
    // Roof vents.
    const ventGeo = new THREE.BoxGeometry(10, 6, 10);
    const ventMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#3a3f4c') });
    const vents = city.buildings.filter((b) => b.vent > 0.4);
    const ventInst = new THREE.InstancedMesh(ventGeo, ventMat, Math.max(1, vents.length));
    vents.forEach((b, i) => {
      dummy.position.set(b.x + b.w * b.vent, buildingHeight(b) + 3, b.y + b.h / 2);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      ventInst.setMatrixAt(i, dummy.matrix);
    });
    ventInst.count = vents.length;
    ventInst.instanceMatrix.needsUpdate = true;
    cityGroup.add(ventInst);
    // Rooftop water towers.
    const towers = city.buildings.filter((b) => b.waterTower);
    if (towers.length > 0) {
      const tankGeo = new THREE.CylinderGeometry(9, 9, 16, 10);
      const tankMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#5a4632') });
      const tankInst = new THREE.InstancedMesh(tankGeo, tankMat, towers.length);
      const capGeo = new THREE.ConeGeometry(10, 7, 10);
      const capInst = new THREE.InstancedMesh(capGeo, tankMat, towers.length);
      towers.forEach((b, i) => {
        const tx = b.x + b.w * 0.5;
        const tz = b.y + b.h * 0.3;
        const ty = buildingHeight(b) + 12;
        dummy.position.set(tx, ty, tz);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        tankInst.setMatrixAt(i, dummy.matrix);
        dummy.position.set(tx, ty + 11, tz);
        dummy.updateMatrix();
        capInst.setMatrixAt(i, dummy.matrix);
      });
      tankInst.instanceMatrix.needsUpdate = true;
      capInst.instanceMatrix.needsUpdate = true;
      cityGroup.add(tankInst);
      cityGroup.add(capInst);
    }
    // Antennas + blinking beacons.
    const antennas = city.buildings.filter((b) => b.antenna);
    beaconCount = antennas.length;
    if (antennas.length > 0) {
      const antGeo = new THREE.CylinderGeometry(0.8, 1.4, 34, 6);
      antGeo.translate(0, 17, 0);
      const antMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#22242c') });
      const antInst = new THREE.InstancedMesh(antGeo, antMat, antennas.length);
      const beaconGeo = new THREE.SphereGeometry(2.6, 8, 6);
      const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2e2e') });
      beaconInst = new THREE.InstancedMesh(beaconGeo, beaconMat, antennas.length);
      antennas.forEach((b, i) => {
        const ax = b.x + b.w * 0.5;
        const az = b.y + b.h * 0.5;
        const ay = buildingHeight(b) + 3;
        dummy.position.set(ax, ay, az);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        antInst.setMatrixAt(i, dummy.matrix);
        dummy.position.set(ax, ay + 35, az);
        dummy.updateMatrix();
        beaconInst.setMatrixAt(i, dummy.matrix);
        beaconPositions.push(new THREE.Vector3(ax, ay + 35, az));
      });
      antInst.instanceMatrix.needsUpdate = true;
      beaconInst.instanceMatrix.needsUpdate = true;
      cityGroup.add(antInst);
      cityGroup.add(beaconInst);
    }

    // Neon signs (south face).
    for (const b of city.buildings) {
      if (!b.sign) continue;
      const w = Math.min(b.w * 0.8, 12 + b.sign.word.length * 9);
      const mat = new THREE.MeshBasicMaterial({
        map: signTexture(b.sign.word, b.sign.color),
        transparent: true,
        side: THREE.DoubleSide,
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 48 / 256), mat);
      sign.position.set(b.x + b.w / 2, Math.min(buildingHeight(b) * 0.62, 120), b.y + b.h + 1.5);
      cityGroup.add(sign);
    }

    // Street lamps (poles + heads).
    const poleGeo = new THREE.CylinderGeometry(1.2, 1.6, 42, 6);
    poleGeo.translate(0, 21, 0);
    const poleMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#22242c') });
    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, city.lamps.length);
    const headGeo = new THREE.SphereGeometry(3.2, 8, 6);
    const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.headlight) });
    const headInst = new THREE.InstancedMesh(headGeo, headMat, city.lamps.length);
    city.lamps.forEach((l, i) => {
      dummy.position.set(l.x, 0, l.y);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poleInst.setMatrixAt(i, dummy.matrix);
      dummy.position.set(l.x, 44, l.y);
      dummy.updateMatrix();
      headInst.setMatrixAt(i, dummy.matrix);
    });
    poleInst.instanceMatrix.needsUpdate = true;
    headInst.instanceMatrix.needsUpdate = true;
    cityGroup.add(poleInst);
    cityGroup.add(headInst);

    // Trees.
    const trunkGeo = new THREE.CylinderGeometry(2, 3, 14, 6);
    trunkGeo.translate(0, 7, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#4a3220') });
    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, city.trees.length));
    const canopyGeo = new THREE.IcosahedronGeometry(1, 0);
    const canopyMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(PALETTE.treeMid) });
    const canopyInst = new THREE.InstancedMesh(canopyGeo, canopyMat, Math.max(1, city.trees.length));
    canopyInst.castShadow = true;
    city.trees.forEach((t, i) => {
      dummy.position.set(t.x, 0, t.y);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);
      dummy.position.set(t.x, 16 + t.r * 0.4, t.y);
      dummy.scale.set(t.r, t.r * 0.9, t.r);
      dummy.updateMatrix();
      canopyInst.setMatrixAt(i, dummy.matrix);
    });
    trunkInst.count = city.trees.length;
    canopyInst.count = city.trees.length;
    trunkInst.instanceMatrix.needsUpdate = true;
    canopyInst.instanceMatrix.needsUpdate = true;
    cityGroup.add(trunkInst);
    cityGroup.add(canopyInst);

    // Street furniture (instanced, one draw each).
    const props = city.props || { hydrants: [], bins: [], trafficLights: [], busStops: [] };
    // Hydrants.
    if (props.hydrants.length > 0) {
      const hydGeo = new THREE.CylinderGeometry(3.5, 4.5, 12, 8);
      hydGeo.translate(0, 6, 0);
      const hydMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(PALETTE.hydrant) });
      const hydInst = new THREE.InstancedMesh(hydGeo, hydMat, props.hydrants.length);
      props.hydrants.forEach((h, i) => {
        dummy.position.set(h.x, 0, h.y);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        hydInst.setMatrixAt(i, dummy.matrix);
      });
      hydInst.instanceMatrix.needsUpdate = true;
      cityGroup.add(hydInst);
    }
    // Bins.
    if (props.bins.length > 0) {
      const binGeo = new THREE.BoxGeometry(10, 14, 10);
      binGeo.translate(0, 7, 0);
      const binMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(PALETTE.bin) });
      const binInst = new THREE.InstancedMesh(binGeo, binMat, props.bins.length);
      props.bins.forEach((b, i) => {
        dummy.position.set(b.x, 0, b.y);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        binInst.setMatrixAt(i, dummy.matrix);
      });
      binInst.instanceMatrix.needsUpdate = true;
      cityGroup.add(binInst);
    }
    // Bus stops.
    if (props.busStops.length > 0) {
      const benchGeo = new THREE.BoxGeometry(26, 3, 8);
      benchGeo.translate(0, 8, 0);
      const benchMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#3a3f4c') });
      const benchInst = new THREE.InstancedMesh(benchGeo, benchMat, props.busStops.length);
      const signGeo = new THREE.PlaneGeometry(12, 12);
      const signMat = new THREE.MeshBasicMaterial({
        map: canvasTex(64, 64, (g) => {
          g.fillStyle = PALETTE.busStop;
          g.fillRect(0, 0, 64, 64);
          g.fillStyle = '#ffffff';
          g.font = 'bold 34px system-ui, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('B', 32, 34);
        }),
        side: THREE.DoubleSide,
      });
      const busSignInst = new THREE.InstancedMesh(signGeo, signMat, props.busStops.length);
      props.busStops.forEach((s, i) => {
        dummy.position.set(s.x, 0, s.y);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        benchInst.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x, 34, s.y);
        dummy.updateMatrix();
        busSignInst.setMatrixAt(i, dummy.matrix);
      });
      benchInst.instanceMatrix.needsUpdate = true;
      busSignInst.instanceMatrix.needsUpdate = true;
      cityGroup.add(benchInst);
      cityGroup.add(busSignInst);
    }
    // Traffic lights: two heads per intersection on instanced poles; the bulbs are
    // three instanced meshes (red/amber/green) toggled per frame from sim time.
    trafficLights = props.trafficLights;
    if (trafficLights.length > 0) {
      const tlPoleGeo = new THREE.CylinderGeometry(1.4, 1.8, 52, 6);
      tlPoleGeo.translate(0, 26, 0);
      const tlPoleMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#22242c') });
      const tlPoleInst = new THREE.InstancedMesh(tlPoleGeo, tlPoleMat, trafficLights.length * 2);
      const tlHeadGeo = new THREE.BoxGeometry(7, 20, 7);
      const tlHeadMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#14161c') });
      const tlHeadInst = new THREE.InstancedMesh(tlHeadGeo, tlHeadMat, trafficLights.length * 2);
      const bulbGeo = new THREE.SphereGeometry(2.4, 8, 6);
      const bulbColors = { red: '#ff2e2e', amber: '#ffb03f', green: '#3fd47e' };
      for (const key of Object.keys(bulbColors)) {
        bulbMeshes[key] = new THREE.InstancedMesh(
          bulbGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(bulbColors[key]) }),
          trafficLights.length * 2
        );
        cityGroup.add(bulbMeshes[key]);
      }
      trafficLights.forEach((t, i) => {
        // Two heads on opposite corners of the intersection.
        const rx = t.x - ROAD_HALF - 5;
        const ry = t.y - ROAD_HALF - 5;
        const heads = [
          { x: t.x, y: t.y },
          { x: 2 * rx - t.x, y: 2 * ry - t.y },
        ];
        heads.forEach((h, j) => {
          const k = i * 2 + j;
          dummy.position.set(h.x, 0, h.y);
          dummy.scale.set(1, 1, 1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          tlPoleInst.setMatrixAt(k, dummy.matrix);
          dummy.position.set(h.x, 48, h.y);
          dummy.updateMatrix();
          tlHeadInst.setMatrixAt(k, dummy.matrix);
          // Bulbs stacked red/amber/green on the head; positions fixed, scale
          // toggled per frame by updateTrafficLights.
          for (let b = 0; b < 3; b += 1) {
            dummy.position.set(h.x, 54 - b * 6, h.y);
            dummy.updateMatrix();
            bulbMeshes[['red', 'amber', 'green'][b]].setMatrixAt(k, dummy.matrix);
          }
        });
      });
      tlPoleInst.instanceMatrix.needsUpdate = true;
      tlHeadInst.instanceMatrix.needsUpdate = true;
      for (const key of Object.keys(bulbMeshes)) bulbMeshes[key].instanceMatrix.needsUpdate = true;
      cityGroup.add(tlPoleInst);
      cityGroup.add(tlHeadInst);
    }
    // Puddles: glossy discs catching the sky.
    {
      const puddleSpots = [];
      for (let xi = 0; xi < CITY.roadsX.length; xi += 1) {
        for (let yi = 0; yi < CITY.roadsY.length; yi += 1) {
          if ((xi * 3 + yi) % 5 !== 0) continue;
          puddleSpots.push({
            x: CITY.roadsX[xi] + 18 + ((xi * 7 + yi * 13) % 20),
            y: CITY.roadsY[yi] - 12 - ((xi * 11 + yi * 5) % 16),
            r: 14 + ((xi * 5 + yi * 3) % 10),
          });
        }
      }
      if (puddleSpots.length > 0) {
        const pudGeo = new THREE.CircleGeometry(1, 20);
        pudGeo.rotateX(-Math.PI / 2);
        const pudMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(PALETTE.puddle), roughness: 0.06, metalness: 0.85,
          envMapIntensity: 1.6, transparent: true, opacity: 0.85,
        });
        const pudInst = new THREE.InstancedMesh(pudGeo, pudMat, puddleSpots.length);
        puddleSpots.forEach((p, i) => {
          dummy.position.set(p.x, 0.4, p.y);
          dummy.scale.set(p.r, 1, p.r * 0.6);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          pudInst.setMatrixAt(i, dummy.matrix);
        });
        pudInst.instanceMatrix.needsUpdate = true;
        cityGroup.add(pudInst);
      }
    }

    scene.add(cityGroup);
  }

  // Traffic lights from sim time: an 18 s cycle (7 green, 2 amber, then the cross
  // street). Head A shows north-south, head B east-west.
  const _tlDummy = new THREE.Object3D();
  function updateTrafficLights(elapsed) {
    if (!trafficLights.length) return;
    const cycle = REALISM.lightCycle;
    const green = REALISM.lightGreen;
    const amber = REALISM.lightAmber;
    trafficLights.forEach((t, i) => {
      const phase = (elapsed + t.phase * (cycle / 2)) % cycle;
      // [red, amber, green] per direction.
      const ns = [phase >= green + amber, phase >= green && phase < green + amber, phase < green];
      const ew = [phase < green + amber, phase >= green + amber + green, phase >= green + amber && phase < green + amber + green];
      for (let h = 0; h < 2; h += 1) {
        const k = i * 2 + h;
        const rx = t.x - ROAD_HALF - 5;
        const ry = t.y - ROAD_HALF - 5;
        const hx = h === 0 ? t.x : 2 * rx - t.x;
        const hy = h === 0 ? t.y : 2 * ry - t.y;
        const on = h === 0 ? ns : ew;
        for (let b = 0; b < 3; b += 1) {
          _tlDummy.position.set(hx, 54 - b * 6, hy);
          _tlDummy.scale.set(on[b] ? 1 : 0.001, on[b] ? 1 : 0.001, on[b] ? 1 : 0.001);
          _tlDummy.rotation.set(0, 0, 0);
          _tlDummy.updateMatrix();
          bulbMeshes[['red', 'amber', 'green'][b]].setMatrixAt(k, _tlDummy.matrix);
        }
      }
    });
    for (const key of Object.keys(bulbMeshes)) {
      if (bulbMeshes[key]) bulbMeshes[key].instanceMatrix.needsUpdate = true;
    }
  }

  // Antenna beacons blink on sim time. Positions are stored at build time so the
  // per-frame update reuses one dummy and allocates nothing.
  function updateBeacons(elapsed) {
    if (!beaconInst || beaconCount === 0) return;
    const on = Math.floor(elapsed * 1.5) % 2 === 0;
    const s = on ? 1 : 0.001;
    for (let i = 0; i < beaconCount; i += 1) {
      _tlDummy.position.copy(beaconPositions[i]);
      _tlDummy.scale.set(s, s, s);
      _tlDummy.rotation.set(0, 0, 0);
      _tlDummy.updateMatrix();
      beaconInst.setMatrixAt(i, _tlDummy.matrix);
    }
    beaconInst.instanceMatrix.needsUpdate = true;
  }

  // Vehicles + people.
  const wheelGeo = new THREE.CylinderGeometry(6, 6, 5, 10);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#14141a') });
  const hubGeo = new THREE.CylinderGeometry(2.6, 2.6, 5.4, 8);
  hubGeo.rotateX(Math.PI / 2);
  const hubMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c8ccd4'), metalness: 0.9, roughness: 0.25, envMapIntensity: 1.2 });
  // Glass and paint are standard materials: they reflect the dusk environment map.
  const glassMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0e1826'), metalness: 1, roughness: 0.08, envMapIntensity: REALISM.envIntensityGlass });
  const chromeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c8ccd4'), metalness: 0.9, roughness: 0.25, envMapIntensity: 1.2 });

  function buildCarMesh() {
    const g = new THREE.Group();
    // Paint: metallic, env-mapped.
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x888888, metalness: 0.85, roughness: 0.3, envMapIntensity: REALISM.envIntensityPaint,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(CAR.length, CAR.height, CAR.width), bodyMat);
    body.position.y = CAR.height / 2 + 5;
    body.castShadow = true;
    g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(CAR.length * 0.5, 9, CAR.width * 0.86), glassMat);
    cabin.position.set(-CAR.length * 0.04, CAR.height + 8, 0);
    cabin.castShadow = true;
    g.add(cabin);
    // Front wheels steer (pivots); every wheel gets a hubcap.
    const wheelFL = new THREE.Group();
    const wheelFR = new THREE.Group();
    const wheelPos = [
      [wheelFL, CAR.length * 0.32, -CAR.width / 2], [wheelFR, CAR.length * 0.32, CAR.width / 2],
      [null, -CAR.length * 0.32, -CAR.width / 2], [null, -CAR.length * 0.32, CAR.width / 2],
    ];
    for (const [pivot, wx, wz] of wheelPos) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(0, 0, 0);
      w.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, hubMat);
      if (pivot) {
        pivot.position.set(wx, 6, wz);
        pivot.add(w);
        pivot.add(hub);
        g.add(pivot);
      } else {
        w.position.set(wx, 6, wz);
        hub.position.set(wx, 6, wz);
        g.add(w);
        g.add(hub);
      }
    }
    // Side mirrors.
    for (const side of [-1, 1]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 2), chromeMat);
      mirror.position.set(CAR.length * 0.22, CAR.height + 6, side * (CAR.width / 2 + 1.5));
      g.add(mirror);
    }
    // Per-car head/tail materials (dimming, brake flare).
    const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.headlight) });
    const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#a01818') });
    const hl = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 5), headMat);
    hl.position.set(CAR.length / 2 + 0.5, 9, -CAR.width / 2 + 5);
    g.add(hl);
    const hl2 = hl.clone();
    hl2.position.z = CAR.width / 2 - 5;
    g.add(hl2);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 5), tailMat);
    tl.position.set(-CAR.length / 2 - 0.5, 9, -CAR.width / 2 + 5);
    g.add(tl);
    const tl2 = tl.clone();
    tl2.position.z = CAR.width / 2 - 5;
    g.add(tl2);
    // Sport spoiler.
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, CAR.width * 0.9), bodyMat);
    spoiler.position.set(-CAR.length / 2 - 1, CAR.height + 8, 0);
    spoiler.visible = false;
    g.add(spoiler);
    g.userData.bodyMat = bodyMat;
    g.userData.body = body;
    g.userData.cabin = cabin;
    g.userData.wheelFL = wheelFL;
    g.userData.wheelFR = wheelFR;
    g.userData.headMat = headMat;
    g.userData.tailMat = tailMat;
    g.userData.spoiler = spoiler;
    return g;
  }

  function buildPersonMesh(shirtColor) {
    const g = new THREE.Group();
    const shirt = new THREE.MeshLambertMaterial({ color: new THREE.Color(shirtColor) });
    const skin = new THREE.MeshLambertMaterial({ color: new THREE.Color('#d0a080') });
    const pants = new THREE.MeshLambertMaterial({ color: new THREE.Color('#2a2e3a') });
    const body = new THREE.Mesh(new THREE.BoxGeometry(11, 13, 7), shirt);
    body.position.y = 15;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(5, 10, 8), skin);
    head.position.y = 25;
    head.castShadow = true;
    g.add(head);
    // Hats on some pedestrians.
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(5.4, 5.8, 2.6, 10),
      new THREE.MeshLambertMaterial({ color: new THREE.Color('#3a3f4c') })
    );
    hat.position.y = 29;
    hat.visible = false;
    g.add(hat);
    const legGeo = new THREE.BoxGeometry(4, 11, 4);
    legGeo.translate(0, -5.5, 0);
    const legL = new THREE.Mesh(legGeo, pants);
    legL.position.set(0, 10, -2.5);
    g.add(legL);
    const legR = new THREE.Mesh(legGeo, pants);
    legR.position.set(0, 10, 2.5);
    g.add(legR);
    const armGeo = new THREE.BoxGeometry(3.4, 10, 3.4);
    armGeo.translate(0, -5, 0);
    const armL = new THREE.Mesh(armGeo, shirt);
    armL.position.set(0, 20, -5.5);
    g.add(armL);
    const armR = new THREE.Mesh(armGeo, shirt);
    armR.position.set(0, 20, 5.5);
    g.add(armR);
    g.userData.legL = legL;
    g.userData.legR = legR;
    g.userData.armL = armL;
    g.userData.armR = armR;
    g.userData.shirt = shirt;
    g.userData.skin = skin;
    g.userData.hat = hat;
    return g;
  }

  // Helicopter (4-5 stars).
  const heliGroup = new THREE.Group();
  {
    const heliMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#20242e') });
    const body = new THREE.Mesh(new THREE.BoxGeometry(26, 12, 14), heliMat);
    body.castShadow = true;
    heliGroup.add(body);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(22, 5, 5), heliMat);
    tail.position.set(-22, 2, 0);
    heliGroup.add(tail);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(44, 1.2, 4), chromeMat);
    rotor.position.y = 9;
    heliGroup.add(rotor);
    heliGroup.userData.rotor = rotor;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.headlight) }));
    lamp.position.set(12, -5, 0);
    heliGroup.add(lamp);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2e2e') }));
    beacon.position.set(0, 8, 0);
    heliGroup.add(beacon);
    heliGroup.userData.beacon = beacon;
    const coneGeo = new THREE.ConeGeometry(26, 220, 16, 1, true);
    coneGeo.translate(0, -110, 0);
    coneGeo.rotateX(Math.PI / 2);
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffe9a8'), transparent: true, opacity: 0.14,
      side: THREE.DoubleSide, depthWrite: false,
    }));
    cone.position.set(12, -5, 0);
    heliGroup.add(cone);
    heliGroup.visible = false;
    scene.add(heliGroup);
  }

  // Mission marker.
  const markerGroup = new THREE.Group();
  const markerBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 14, 320, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.marker), transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  );
  markerBeam.position.y = 160;
  markerGroup.add(markerBeam);
  const markerDiamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.marker) })
  );
  markerDiamond.position.y = 90;
  markerGroup.add(markerDiamond);
  markerGroup.visible = false;
  scene.add(markerGroup);

  // Particles.
  const PARTICLE_MAX = 140;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PARTICLE_MAX * 3);
  const pCol = new Float32Array(PARTICLE_MAX * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({ size: 7, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);

  // Bullets.
  const bulletMeshes = [];
  const bulletGeo = new THREE.BoxGeometry(16, 2, 2);
  const bulletMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd76a') });
  for (let i = 0; i < 24; i += 1) {
    const m = new THREE.Mesh(bulletGeo, bulletMat);
    m.visible = false;
    scene.add(m);
    bulletMeshes.push(m);
  }

  // Pickups.
  const pickupMeshes = [];
  const pickupGeo = new THREE.BoxGeometry(14, 14, 14);
  const pickupMats = {
    cash: new THREE.MeshBasicMaterial({ color: new THREE.Color('#3fd47e') }),
    health: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff') }),
    ammo: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb03f') }),
  };
  for (let i = 0; i < 12; i += 1) {
    const m = new THREE.Mesh(pickupGeo, pickupMats.cash);
    m.visible = false;
    scene.add(m);
    pickupMeshes.push(m);
  }

  // Headlight beams + glows (player + police, pool of 7).
  const beamGeo = new THREE.ConeGeometry(REALISM.beamWidth / 2, REALISM.beamLength, 12, 1, true);
  beamGeo.translate(0, -REALISM.beamLength / 2, 0);
  beamGeo.rotateZ(Math.PI / 2); // apex at the headlight, widening forward (+X)
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffe9a8'), transparent: true, opacity: REALISM.beamOpacity,
    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const beamMeshes = [];
  const headlightGlows = [];
  for (let i = 0; i < 7; i += 1) {
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.visible = false;
    scene.add(beam);
    beamMeshes.push(beam);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color('#ffe9a8'), transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.set(30, 30, 1);
    glow.visible = false;
    scene.add(glow);
    headlightGlows.push(glow);
  }
  let headlightsOn = REALISM.headlightsOn;

  // ---- Dynamic object pools ----
  const carMeshes = [];
  for (let i = 0; i < 42; i += 1) {
    const g = buildCarMesh();
    g.visible = false;
    // Police light bar.
    const barR = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.policeLightR) }));
    barR.position.set(-2, CAR.height + 14, -5);
    barR.visible = false;
    g.add(barR);
    const barB = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.policeLightB) }));
    barB.position.set(-2, CAR.height + 14, 5);
    barB.visible = false;
    g.add(barB);
    g.userData.barR = barR;
    g.userData.barB = barB;
    scene.add(g);
    carMeshes.push(g);
  }

  const personMeshes = [];
  for (let i = 0; i < 80; i += 1) {
    const g = buildPersonMesh('#e8e0d0');
    g.visible = false;
    scene.add(g);
    personMeshes.push(g);
  }
  const playerMesh = buildPersonMesh(PALETTE.player);
  scene.add(playerMesh);

  // ---- HUD (DOM) ----
  const hud = {
    health: document.getElementById('hud-health'),
    healthBar: document.getElementById('hud-health-bar'),
    money: document.getElementById('hud-money'),
    stars: document.getElementById('hud-stars'),
    objective: document.getElementById('hud-objective'),
    distance: document.getElementById('hud-distance'),
    timer: document.getElementById('hud-timer'),
    speed: document.getElementById('hud-speed'),
    ammo: document.getElementById('hud-ammo'),
    banner: document.getElementById('hud-banner'),
    radio: document.getElementById('hud-radio'),
    title: document.getElementById('screen-title'),
    paused: document.getElementById('screen-paused'),
    over: document.getElementById('screen-over'),
    win: document.getElementById('screen-win'),
    overText: document.getElementById('over-text'),
    winText: document.getElementById('win-text'),
    titleSave: document.getElementById('title-save'),
    minimap: document.getElementById('minimap'),
  };
  const mapCtx = hud.minimap ? hud.minimap.getContext('2d') : null;

  // ---- Camera ----
  const camPos = new THREE.Vector3(0, 200, 400);
  const camLook = new THREE.Vector3(0, 0, 0);
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  let shake = 0;
  let titleAngle = 0.6;

  function updateCamera(state, dt, screen) {
    const p = state.player;
    const fwdX = Math.cos(p.angle);
    const fwdY = Math.sin(p.angle);
    if (screen === SCREEN_TITLE) {
      // Title orbit (sim time).
      titleAngle = 0.6 + state.elapsed * 0.02;
      const cx = WORLD.width / 2 + Math.cos(titleAngle) * 900;
      const cy = WORLD.height / 2 + Math.sin(titleAngle) * 900;
      desiredPos.set(cx, 520, cy);
      desiredLook.set(WORLD.width / 2, 40, WORLD.height / 2);
      camera.fov = 55;
    } else if (p.inCar) {
      const car = p.inCar;
      const back = CAMERA.carBack;
      const up = CAMERA.carUp;
      desiredPos.set(car.x - fwdX * back, up, car.y - fwdY * back);
      desiredLook.set(car.x + fwdX * CAMERA.carLook, 26, car.y + fwdY * CAMERA.carLook);
      const speedNorm = Math.min(1, Math.abs(car.speed) / 720);
      camera.fov = CAMERA.fov + CAMERA.fovKick * speedNorm;
    } else {
      desiredPos.set(p.x - fwdX * CAMERA.onFootBack, CAMERA.onFootUp, p.y - fwdY * CAMERA.onFootBack);
      desiredLook.set(p.x + fwdX * CAMERA.onFootLook, 22, p.y + fwdY * CAMERA.onFootLook);
      camera.fov = CAMERA.fov;
    }
    camera.updateProjectionMatrix();
    const k = 1 - Math.exp(-CAMERA.smooth * dt);
    camPos.lerp(desiredPos, k);
    camLook.lerp(desiredLook, k);
    if (shake > 0.2) {
      shake *= Math.exp(-6 * dt);
      // Deterministic jitter from sim time (no Math.random in the renderer).
      camPos.x += Math.sin(state.elapsed * 91.7) * shake;
      camPos.y += Math.cos(state.elapsed * 113.3) * shake * 0.5;
    }
    // Keep the camera inside the world, above the streets.
    camPos.x = Math.max(-100, Math.min(WORLD.width + 100, camPos.x));
    camPos.z = Math.max(-100, Math.min(WORLD.height + 100, camPos.z));
    camPos.y = Math.max(45, camPos.y);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    // The sun's shadow box follows the player.
    sun.position.set(p.x - 900, 700, p.y - 500);
    sun.target.position.set(p.x, 0, p.y);
    sun.target.updateMatrixWorld();
  }

  function syncCarMesh(g, car, elapsed) {
    g.visible = true;
    g.position.set(car.x, 0, car.y);
    g.rotation.y = -car.angle;
    const isPolice = car.driver === 'police';
    const isPlayer = car.driver === 'player';
    g.userData.bodyMat.color.set(car.color);
    // Wrecked cars sit low.
    g.userData.body.position.y = CAR.height / 2 + 5 - (car.health <= 0 ? 3 : 0);
    g.userData.barR.visible = isPolice;
    g.userData.barB.visible = isPolice;
    if (isPolice) {
      // Alternating light bar.
      const phase = Math.floor(elapsed * 4) % 2 === 0;
      g.userData.barR.material.color.set(phase ? '#ff2e2e' : '#5a1010');
      g.userData.barB.material.color.set(phase ? '#101c5a' : '#2e7dff');
    }
    // Steering + brake lights.
    const steerAngle = (car.steerVis || 0) * CAR.wheelTurn;
    g.userData.wheelFL.rotation.y = steerAngle;
    g.userData.wheelFR.rotation.y = steerAngle;
    g.userData.tailMat.color.set(car.braking ? '#ff2e2e' : '#a01818');
    g.userData.headMat.color.set(headlightsOn ? PALETTE.headlight : '#5a5348');
    g.userData.spoiler.visible = car.kind === 'sport';
    // Gold plate under the player's car.
    if (isPlayer && !g.userData.goldPlate) {
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(CAR.length + 6, 1.5, CAR.width + 6),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffcf3f') })
      );
      plate.position.y = 2;
      g.add(plate);
      g.userData.goldPlate = plate;
    }
    if (g.userData.goldPlate) g.userData.goldPlate.visible = isPlayer;
  }

  function syncPersonMesh(g, x, y, angle, walkPhase, moving, shirtColor, scale, skin, hat) {
    g.visible = true;
    g.position.set(x, 0, y);
    g.rotation.y = -angle;
    g.scale.setScalar(scale || 1);
    if (g.userData.shirt) g.userData.shirt.color.set(shirtColor);
    if (g.userData.skin && skin) g.userData.skin.color.set(skin);
    if (g.userData.hat) g.userData.hat.visible = !!hat;
    const swing = moving ? Math.sin(walkPhase) * 0.55 : 0;
    g.userData.legL.rotation.z = swing;
    g.userData.legR.rotation.z = -swing;
    g.userData.armL.rotation.z = -swing * 0.7;
    g.userData.armR.rotation.z = swing * 0.7;
  }

  // ---- Minimap (2D top-down) ----
  function drawMinimap(state) {
    if (!mapCtx) return;
    const mw = 228;
    const mh = 172;
    const sx = mw / WORLD.width;
    const sy = mh / WORLD.height;
    mapCtx.fillStyle = '#171a24';
    mapCtx.fillRect(0, 0, mw, mh);
    // Blocks.
    mapCtx.fillStyle = '#23262f';
    const cols = CITY.roadsX.length + 1;
    const rows = CITY.roadsY.length + 1;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x0 = col === 0 ? 0 : CITY.roadsX[col - 1] + ROAD_HALF;
        const x1 = col >= CITY.roadsX.length ? WORLD.width : CITY.roadsX[col] - ROAD_HALF;
        const y0 = row === 0 ? 0 : CITY.roadsY[row - 1] + ROAD_HALF;
        const y1 = row >= CITY.roadsY.length ? WORLD.height : CITY.roadsY[row] - ROAD_HALF;
        mapCtx.fillRect(x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy);
      }
    }
    // Plaza.
    const pb = CITY.plazaBlock;
    mapCtx.fillStyle = '#565d6b';
    mapCtx.fillRect(
      (CITY.roadsX[pb.col - 1] + ROAD_HALF) * sx, (CITY.roadsY[pb.row - 1] + ROAD_HALF) * sy,
      (CITY.roadsX[pb.col] - CITY.roadsX[pb.col - 1] - CITY.roadWidth) * sx,
      (CITY.roadsY[pb.row] - CITY.roadsY[pb.row - 1] - CITY.roadWidth) * sy
    );
    // Roads.
    mapCtx.fillStyle = '#4a4f5c';
    for (const rx of CITY.roadsX) mapCtx.fillRect((rx - ROAD_HALF) * sx, 0, CITY.roadWidth * sx, mh);
    for (const ry of CITY.roadsY) mapCtx.fillRect(0, (ry - ROAD_HALF) * sy, mw, CITY.roadWidth * sy);
    // Mission marker (pulsing).
    const m = state.mission;
    if (m.marker) {
      const pulse = 3 + Math.sin(state.elapsed * 5) * 1.5;
      mapCtx.fillStyle = PALETTE.marker;
      mapCtx.beginPath();
      mapCtx.arc(m.marker.x * sx, m.marker.y * sy, pulse + 2, 0, TAU);
      mapCtx.fill();
    }
    // Police blips.
    mapCtx.fillStyle = '#2e7dff';
    for (const c of state.cars) {
      if (!c.active || c.driver !== 'police') continue;
      mapCtx.fillRect(c.x * sx - 2, c.y * sy - 2, 4, 4);
    }
    // Player arrow.
    const p = state.player;
    mapCtx.save();
    mapCtx.translate(p.x * sx, p.y * sy);
    mapCtx.rotate(Math.atan2(Math.sin(p.angle), Math.cos(p.angle)));
    mapCtx.fillStyle = '#ffcf3f';
    mapCtx.beginPath();
    mapCtx.moveTo(7, 0);
    mapCtx.lineTo(-5, -5);
    mapCtx.lineTo(-5, 5);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
  }

  // ---- HUD ----
  function updateHud(state, screen, best) {
    const p = state.player;
    const m = state.mission;
    if (hud.health) hud.health.textContent = Math.ceil(p.health) + '';
    if (hud.healthBar) hud.healthBar.style.width = Math.max(0, p.health) + '%';
    if (hud.money) hud.money.textContent = '$' + p.money;
    if (hud.stars) {
      let s = '';
      for (let i = 0; i < 5; i += 1) s += i < state.wanted.stars ? '★' : '☆';
      hud.stars.textContent = s;
      hud.stars.style.color = state.wanted.stars > 0 ? '#ffd23f' : '#a8a294';
    }
    if (hud.objective) hud.objective.textContent = m.objective || '';
    if (hud.distance) {
      if (m.marker) {
        const d = Math.hypot(p.x - m.marker.x, p.y - m.marker.y);
        hud.distance.textContent = Math.round(d / 50) + ' m · ' + (m.markerLabel || '');
      } else {
        hud.distance.textContent = '';
      }
    }
    if (hud.timer) {
      if (m.timerMax > 0 && m.timer > 0) {
        hud.timer.textContent = Math.ceil(m.timer) + ' s';
        hud.timer.style.color = m.timer < 20 ? '#ff4a4a' : '#f2f0e8';
      } else {
        hud.timer.textContent = '';
      }
    }
    if (hud.speed) hud.speed.textContent = Math.round(Math.abs(p.inCar ? p.inCar.speed : p.speed) * 0.24) + ' km/h';
    if (hud.ammo) hud.ammo.textContent = p.reloading > 0 ? 'RELOADING' : 'Ammo ' + p.ammo;
    if (hud.banner) {
      // Banner is play-screen only (must not bleed onto the title).
      hud.banner.textContent = m.banner || '';
      hud.banner.style.opacity = screen === SCREEN_PLAY && m.bannerTimer > 0 ? '1' : '0';
    }
    if (hud.titleSave) hud.titleSave.textContent = best > 0 ? 'Best haul $' + best : '';
    // Screen overlays.
    if (hud.title) hud.title.style.display = screen === SCREEN_TITLE ? 'flex' : 'none';
    if (hud.paused) hud.paused.style.display = screen === SCREEN_PAUSED ? 'flex' : 'none';
    if (hud.over) hud.over.style.display = screen === SCREEN_OVER ? 'flex' : 'none';
    if (hud.win) hud.win.style.display = screen === SCREEN_WIN ? 'flex' : 'none';
    if (screen === SCREEN_OVER && hud.overText) {
      hud.overText.textContent = state.wasted
        ? 'Wasted. Haul $' + p.money + '.'
        : 'Busted. Haul $' + p.money + '.';
    }
    if (screen === SCREEN_WIN && hud.winText) {
      hud.winText.textContent = 'Story complete! Final haul $' + p.money + '.';
    }
    drawMinimap(state);
  }

  let builtCity = null;
  const _tmpColor = new THREE.Color();

  function draw(state, screen, best, dt) {
    if (state.city !== builtCity) {
      buildCity(state.city);
      builtCity = state.city;
    }
    const step = dt === undefined ? STEP : dt;
    updateCamera(state, step, screen);
    updateTrafficLights(state.elapsed);
    updateBeacons(state.elapsed);
    // Clouds drift on sim time.
    for (let i = 0; i < clouds.length; i += 1) {
      const c = clouds[i];
      const span = WORLD.width + 1400;
      c.position.x = ((c.userData.baseX + state.elapsed * c.userData.speed + 700) % span) - 700;
    }
    const p = state.player;

    // Player.
    if (p.inCar) {
      playerMesh.visible = false;
    } else {
      syncPersonMesh(playerMesh, p.x, p.y, p.angle, p.walkPhase, p.moving, PALETTE.player, 1, '#d0a080', false);
    }

    // Cars.
    let beamSlot = 0;
    for (let i = 0; i < state.cars.length; i += 1) {
      const c = state.cars[i];
      if (!c.active) { carMeshes[i].visible = false; continue; }
      syncCarMesh(carMeshes[i], c, state.elapsed);
      // Beams for player + police.
      const lit = headlightsOn && (c.driver === 'player' || c.driver === 'police') && c.health > 0;
      if (lit && beamSlot < beamMeshes.length) {
        const beam = beamMeshes[beamSlot];
        const glow = headlightGlows[beamSlot];
        beamSlot += 1;
        beam.visible = true;
        glow.visible = true;
        beam.position.set(c.x + Math.cos(c.angle) * (CAR.length / 2), 9, c.y + Math.sin(c.angle) * (CAR.length / 2));
        beam.rotation.y = -c.angle;
        glow.position.set(c.x + Math.cos(c.angle) * (CAR.length / 2 + 4), 9, c.y + Math.sin(c.angle) * (CAR.length / 2 + 4));
      }
    }
    for (let i = beamSlot; i < beamMeshes.length; i += 1) {
      beamMeshes[i].visible = false;
      headlightGlows[i].visible = false;
    }
    // People.
    for (let i = 0; i < state.peds.length; i += 1) {
      const ped = state.peds[i];
      if (!ped.active) { personMeshes[i].visible = false; continue; }
      if (ped.state === 'down') {
        personMeshes[i].visible = true;
        personMeshes[i].position.set(ped.x, 2, ped.y);
        personMeshes[i].rotation.set(0, -ped.angle, Math.PI / 2);
        personMeshes[i].scale.setScalar(ped.scale || 1);
        personMeshes[i].userData.legL.rotation.z = 0;
        personMeshes[i].userData.legR.rotation.z = 0;
      } else {
        syncPersonMesh(personMeshes[i], ped.x, ped.y, ped.angle, ped.walkPhase, true, ped.color, ped.scale, ped.skin, ped.hat);
      }
    }

    // Bullets.
    for (let i = 0; i < state.bullets.length; i += 1) {
      const b = state.bullets[i];
      const mesh = bulletMeshes[i];
      if (!b.active) { mesh.visible = false; continue; }
      mesh.visible = true;
      mesh.position.set(b.x, 14, b.y);
      mesh.rotation.y = -Math.atan2(b.vy, b.vx);
    }

    // Particles.
    let pi = 0;
    for (const pt of state.particles) {
      if (!pt.active) continue;
      pPos[pi * 3] = pt.x;
      pPos[pi * 3 + 1] = 14;
      pPos[pi * 3 + 2] = pt.y;
      _tmpColor.set(pt.color);
      pCol[pi * 3] = _tmpColor.r;
      pCol[pi * 3 + 1] = _tmpColor.g;
      pCol[pi * 3 + 2] = _tmpColor.b;
      pi += 1;
    }
    for (let i = pi; i < PARTICLE_MAX; i += 1) {
      pPos[i * 3 + 1] = -1000; // park unused points underground
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;

    // Pickups.
    for (let i = 0; i < state.pickups.length; i += 1) {
      const pk = state.pickups[i];
      const mesh = pickupMeshes[i];
      if (!pk.active) { mesh.visible = false; continue; }
      mesh.visible = true;
      mesh.material = pickupMats[pk.kind] || pickupMats.cash;
      mesh.position.set(pk.x, 16 + Math.sin(state.elapsed * 3 + i) * 4, pk.y);
      mesh.rotation.y = state.elapsed * 2 + i;
    }

    // Mission marker.
    const m = state.mission;
    if (m.marker && !state.over) {
      markerGroup.visible = true;
      markerGroup.position.set(m.marker.x, 0, m.marker.y);
      const s = 1 + Math.sin(state.elapsed * 4) * 0.15;
      markerDiamond.scale.set(s, s, s);
      markerDiamond.position.y = 90 + Math.sin(state.elapsed * 3) * 10;
      markerBeam.material.opacity = 0.13 + Math.sin(state.elapsed * 4) * 0.04;
    } else {
      markerGroup.visible = false;
    }

    // Helicopter.
    const heli = state.heli;
    if (heli.active && !state.over) {
      heliGroup.visible = true;
      heliGroup.position.set(heli.x, heli.z, heli.y);
      heliGroup.rotation.y = -Math.atan2(p.y - heli.y, p.x - heli.x) + Math.PI;
      heliGroup.userData.rotor.rotation.y = state.elapsed * 22;
      heliGroup.userData.beacon.visible = Math.floor(state.elapsed * 1.5) % 2 === 0;
    } else {
      heliGroup.visible = false;
    }

    updateHud(state, screen, best);
    renderer.render(scene, camera);
  }

  // Mouse screen point -> world ground point (for aiming).
  function screenToWorld(mx, my) {
    const ndc = new THREE.Vector2((mx / VIEW.width) * 2 - 1, -((my / VIEW.height) * 2 - 1));
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    if (Math.abs(d.y) < 0.0001) return { x: 0, y: 0 };
    const t = -o.y / d.y;
    if (t < 0) return { x: o.x, y: o.z };
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }

  function resize() {
    const w = window.innerWidth || VIEW.width;
    const h = window.innerHeight || VIEW.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  return {
    draw,
    screenToWorld,
    addShake(a) { shake = Math.min(30, shake + a); },
    resize,
    setHeadlights(on) { headlightsOn = !!on; },
    headlightsAreOn() { return headlightsOn; },
  };
}
