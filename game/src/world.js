// Static Port Meridian: ground, roads, sidewalks, 176 buildings, street lamps.
// All placement is seeded-deterministic. Returns collision data + road lists.
const THREE = window.THREE;

export const MAP_X = 1600;
export const MAP_Z = 1200;
export const ROADS_V = [-1200, -600, 0, 600, 1200];
export const ROADS_H = [-800, -400, 0, 400, 800];
const ROAD_HALF = 12;
const WALK_HALF = 18;

function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#17191d';
  g.fillRect(0, 0, 128, 512);
  g.fillStyle = '#202329';
  g.fillRect(8, 0, 112, 512);
  g.fillStyle = '#c9a227';
  g.fillRect(60, 40, 8, 180);
  g.fillRect(60, 300, 8, 180);
  g.fillStyle = '#9aa0a8';
  g.fillRect(4, 0, 4, 512);
  g.fillRect(120, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

function facadeTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3f47';
  g.fillRect(0, 0, 256, 512);
  for (let y = 24; y < 488; y += 44) {
    for (let x = 20; x < 236; x += 40) {
      const lit = ((x * 7 + y * 13) % 5) === 0;
      g.fillStyle = lit ? '#ffd98a' : '#20242c';
      g.fillRect(x, y, 24, 28);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

function envTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#1a2a4a');
  grad.addColorStop(0.45, '#4a5a7a');
  grad.addColorStop(0.55, '#c97e4a');
  grad.addColorStop(0.62, '#2a2018');
  grad.addColorStop(1, '#101014');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#ffe9b0';
  for (let i = 0; i < 40; i += 1) {
    const x = (i * 53) % 256;
    const y = 78 + ((i * 29) % 40);
    g.fillRect(x, y, 3, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

export function buildWorld(scene, rng, renderer) {
  const data = { buildings: [], lamps: [] };
  // Night-city environment reflections (one-time PMREM build at load).
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(envTexture()).texture;
  pmrem.dispose();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_X * 2 + 200, MAP_Z * 2 + 200),
    new THREE.MeshBasicMaterial({ color: 0x252a2f }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Roads + sidewalks.
  const tex = roadTexture();
  tex.anisotropy = maxAniso;
  const roadMat = new THREE.MeshBasicMaterial({ map: tex });
  const walkMat = new THREE.MeshBasicMaterial({ color: 0x4a5058 });
  for (const x of ROADS_V) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, MAP_Z * 2), roadMat.clone());
    r.material.map = tex.clone();
    r.material.map.repeat.set(1, Math.round((MAP_Z * 2) / 64));
    r.material.map.needsUpdate = true;
    r.rotation.x = -Math.PI / 2;
    r.rotation.z = Math.PI / 2;
    r.position.set(x, 0.02, 0);
    scene.add(r);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(WALK_HALF - ROAD_HALF, MAP_Z * 2), walkMat);
      w.rotation.x = -Math.PI / 2;
      w.position.set(x + s * (ROAD_HALF + (WALK_HALF - ROAD_HALF) / 2), 0.03, 0);
      scene.add(w);
    }
  }
  for (const z of ROADS_H) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(MAP_X * 2, ROAD_HALF * 2), roadMat.clone());
    r.material.map = tex.clone();
    r.material.map.repeat.set(Math.round((MAP_X * 2) / 64), 1);
    r.material.map.needsUpdate = true;
    r.rotation.x = -Math.PI / 2;
    r.position.set(0, 0.02, z);
    scene.add(r);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(MAP_X * 2, WALK_HALF - ROAD_HALF), walkMat);
      w.rotation.x = -Math.PI / 2;
      w.position.set(0, 0.03, z + s * (ROAD_HALF + (WALK_HALF - ROAD_HALF) / 2));
      scene.add(w);
    }
  }

  // Buildings: 36 blocks, 5 each, 4 corner blocks get 4 -> 176 total.
  const xEdges = [-MAP_X, -1200, -600, 0, 600, 1200, MAP_X];
  const zEdges = [-MAP_Z, -800, -400, 0, 400, 800, MAP_Z];
  const palette = [0x5a5f6a, 0x6a5a4a, 0x4a5a6a, 0x6a6a5a, 0x55455a, 0x45504a, 0x7a6a5a, 0x3f4a5a];
  const slots = [];
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 6; j += 1) {
      const x0 = xEdges[i] + 24;
      const x1 = xEdges[i + 1] - 24;
      const z0 = zEdges[j] + 24;
      const z1 = zEdges[j + 1] - 24;
      const corner = (i === 0 || i === 5) && (j === 0 || j === 5);
      const n = corner ? 4 : 5;
      for (let k = 0; k < n; k += 1) {
        const gx = k % 3;
        const gz = Math.floor(k / 3);
        const cx = x0 + ((gx + 0.5) / 3) * (x1 - x0) + (rng() - 0.5) * 30;
        const cz = z0 + ((gz + 0.5) / 2) * (z1 - z0) + (rng() - 0.5) * 30;
        const w = 30 + rng() * 42;
        const d = 30 + rng() * 42;
        const h = 14 + rng() * rng() * 78;
        slots.push({ cx, cz, w, d, h, color: palette[Math.floor(rng() * palette.length)] });
      }
    }
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const facade = facadeTexture();
  facade.anisotropy = maxAniso;
  const bMat = new THREE.MeshLambertMaterial({ map: facade });
  const inst = new THREE.InstancedMesh(boxGeo, bMat, slots.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const col = new THREE.Color();
  slots.forEach((b, idx) => {
    pos.set(b.cx, b.h / 2, b.cz);
    sc.set(b.w, b.h, b.d);
    m4.compose(pos, q, sc);
    inst.setMatrixAt(idx, m4);
    inst.setColorAt(idx, col.setHex(b.color));
    data.buildings.push({ minX: b.cx - b.w / 2, maxX: b.cx + b.w / 2, minZ: b.cz - b.d / 2, maxZ: b.cz + b.d / 2 });
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.castShadow = true;
  inst.receiveShadow = true;
  scene.add(inst);

  // Street lamps along roads (instanced poles + emissive heads).
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 8, 5);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x22262c });
  const lampSpots = [];
  for (const x of ROADS_V) {
    for (let z = -MAP_Z + 100; z <= MAP_Z - 100; z += 250) lampSpots.push([x + 15, z]);
    for (let z = -MAP_Z + 220; z <= MAP_Z - 100; z += 250) lampSpots.push([x - 15, z]);
  }
  for (const z of ROADS_H) {
    for (let x = -MAP_X + 100; x <= MAP_X - 100; x += 250) lampSpots.push([x, z + 15]);
    for (let x = -MAP_X + 220; x <= MAP_X - 100; x += 250) lampSpots.push([x, z - 15]);
  }
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length);
  const headGeo = new THREE.BoxGeometry(1.6, 0.3, 0.6);
  const headMat = new THREE.MeshLambertMaterial({ color: 0x333333, emissive: 0xffd98a, emissiveIntensity: 1.6 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length);
  lampSpots.forEach((p, idx) => {
    pos.set(p[0], 4, p[1]);
    sc.set(1, 1, 1);
    m4.compose(pos, q, sc);
    poles.setMatrixAt(idx, m4);
    pos.set(p[0], 8.1, p[1]);
    m4.compose(pos, q, sc);
    heads.setMatrixAt(idx, m4);
    data.lamps.push(p);
  });
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  scene.add(poles);
  scene.add(heads);

  return data;
}
