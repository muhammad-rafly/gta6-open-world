// The city of Port Meridian: a road grid, blocks of buildings, districts and a central
// plaza, and the road graph the traffic and the police drive on. Everything is built
// from the seed, so the same seed always gives the same city. The whole map is dense
// city: every block holds buildings, edge to edge, with no parkland and no water.
//
// Each building carries a seeded extrusion height (`hgt`) and a seeded roof-vent
// position (`vent`, 0..1); the 3D renderer turns hgt into a real height. Some downtown
// and commercial buildings also get a neon sign (a word + a colour), a ground-floor
// shopfront, a rooftop water tower or a blinking antenna. The `props` are the street
// furniture the renderer draws instanced: hydrants, bins, traffic lights and bus
// stops — the small things that make a street read as a real street. Nothing here
// affects the simulation: collisions still use the flat footprint rectangle.

const ROAD_HALF = CITY.roadWidth / 2;

function onRoad(x, y) {
  for (const rx of CITY.roadsX) if (Math.abs(x - rx) <= ROAD_HALF) return true;
  for (const ry of CITY.roadsY) if (Math.abs(y - ry) <= ROAD_HALF) return true;
  return false;
}

function nearestRoadPoint(x, y) {
  let bestX = x;
  let bestY = y;
  let bestD = Infinity;
  for (const rx of CITY.roadsX) {
    const d = Math.abs(x - rx);
    if (d < bestD) { bestD = d; bestX = rx; bestY = y; }
  }
  for (const ry of CITY.roadsY) {
    const d = Math.abs(y - ry);
    if (d < bestD) { bestD = d; bestX = x; bestY = ry; }
  }
  return { x: bestX, y: bestY };
}

function blockBounds(col, row) {
  const x0 = col === 0 ? 0 : CITY.roadsX[col - 1] + ROAD_HALF;
  const x1 = col >= CITY.roadsX.length ? WORLD.width : CITY.roadsX[col] - ROAD_HALF;
  const y0 = row === 0 ? 0 : CITY.roadsY[row - 1] + ROAD_HALF;
  const y1 = row >= CITY.roadsY.length ? WORLD.height : CITY.roadsY[row] - ROAD_HALF;
  return { x0, y0, x1, y1 };
}

// Build the city from the seed. Returns buildings, trees, lamps, props (street
// furniture), nodes (road-graph intersections + neighbour lists) and named spots.
function createCity(random) {
  const buildings = [];
  const trees = [];
  const lamps = [];
  const props = { hydrants: [], bins: [], trafficLights: [], busStops: [] };
  const cols = CITY.roadsX.length + 1;
  const rows = CITY.roadsY.length + 1;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const b = blockBounds(col, row);
      const isPlaza = col === CITY.plazaBlock.col && row === CITY.plazaBlock.row;
      const isHospital = col === CITY.hospitalBlock.col && row === CITY.hospitalBlock.row;
      const isCommercial = col >= cols - 2;
      const isDowntown = col >= 3 && col <= 6 && row >= 2 && row <= 4;
      if (isPlaza) {
        // A city plaza: a paved square ringed by buildings, a few trees in the middle.
        const bw = b.x1 - b.x0;
        const bh = b.y1 - b.y0;
        const fronts = [
          { x: b.x0 + 14, y: b.y0 + 14, w: bw * 0.42, h: 62 },
          { x: b.x1 - 14 - bw * 0.42, y: b.y1 - 14 - 62, w: bw * 0.42, h: 62 },
        ];
        for (const s of fronts) {
          const range = HEIGHT.normal;
          buildings.push({
            x: s.x, y: s.y, w: s.w, h: s.h,
            color: pick(random, PALETTE.building),
            roof: pick(random, PALETTE.roof),
            lit: random() < 0.55,
            district: 'plaza',
            hospital: false,
            hgt: range[0] + random() * (range[1] - range[0]),
            vent: random(),
            sign: null,
          });
        }
        for (let t = 0; t < 5; t += 1) {
          trees.push({ x: b.x0 + bw * 0.3 + random() * bw * 0.4, y: b.y0 + bh * 0.35 + random() * bh * 0.3, r: 10 + random() * 6 });
        }
        continue;
      }
      // 1-3 buildings per block, each inset from the block edges. Footprints cluster
      // around the middle of the range (gauss) instead of spreading flat, so blocks
      // read as grown, not rolled.
      const count = isDowntown ? 3 : isCommercial ? 2 : 1 + Math.floor(random() * 2);
      for (let i = 0; i < count; i += 1) {
        // Edge blocks are only 128 wide, so cap the footprint to the block (minus inset).
        const w = Math.min(range(random, 70, 140) + gauss(random) * 12, Math.max(30, (b.x1 - b.x0) - 28));
        const h = Math.min(range(random, 60, 130) + gauss(random) * 12, Math.max(30, (b.y1 - b.y0) - 28));
        const x = b.x0 + 14 + random() * Math.max(1, (b.x1 - b.x0 - 28 - w));
        const y = b.y0 + 14 + random() * Math.max(1, (b.y1 - b.y0 - 28 - h));
        const color = pick(random, PALETTE.building);
        const roof = isHospital ? '#e8e8e8' : pick(random, PALETTE.roof);
        // Extrusion height: downtown towers read tallest, commercial blocks next.
        const rangeH = isDowntown ? HEIGHT.downtown : isCommercial ? HEIGHT.commercial : HEIGHT.normal;
        const hgt = rangeH[0] + random() * (rangeH[1] - rangeH[0]);
        // Neon signs on downtown and commercial faces: the Velvet City glow.
        let sign = null;
        if ((isDowntown || isCommercial) && random() < 0.45) {
          sign = { word: pick(random, PALETTE.neonWords), color: pick(random, PALETTE.neon) };
        }
        buildings.push({
          x, y, w, h, color, roof,
          lit: random() < 0.55,
          district: isDowntown ? 'downtown' : isCommercial ? 'commercial' : isHospital ? 'hospital' : 'north',
          hospital: isHospital && i === 0,
          hgt,
          vent: random(),
          sign,
          shopfront: (isDowntown || isCommercial) && random() < 0.3,
          waterTower: hgt > 34 && random() < 0.18,
          antenna: isDowntown && hgt > 36 && random() < 0.25,
        });
      }
      // A few street trees on ordinary blocks.
      if (random() < 0.5) {
        trees.push({ x: b.x0 + 24 + random() * (b.x1 - b.x0 - 48), y: b.y0 + 24 + random() * (b.y1 - b.y0 - 48), r: range(random, 10, 16) + gauss(random) * 2 });
      }
    }
  }

  // Street lamps: along every road, every other block, on alternating sides.
  for (let yi = 0; yi < CITY.roadsY.length; yi += 1) {
    for (let xi = 0; xi < CITY.roadsX.length - 1; xi += 1) {
      if ((xi + yi) % 2 === 0) {
        lamps.push({ x: (CITY.roadsX[xi] + CITY.roadsX[xi + 1]) / 2, y: CITY.roadsY[yi] - ROAD_HALF + 8 });
      }
    }
  }
  for (let xi = 0; xi < CITY.roadsX.length; xi += 1) {
    for (let yi = 0; yi < CITY.roadsY.length - 1; yi += 1) {
      if ((xi + yi) % 2 === 1) {
        lamps.push({ x: CITY.roadsX[xi] + ROAD_HALF - 8, y: (CITY.roadsY[yi] + CITY.roadsY[yi + 1]) / 2 });
      }
    }
  }

  // Street furniture: hydrants and bins on sidewalk corners, traffic lights at every
  // other intersection (neighbours run half a cycle out of phase), bus stops along the
  // main roads. All sit on sidewalks, clear of the road and of building footprints.
  for (let yi = 0; yi < CITY.roadsY.length; yi += 1) {
    for (let xi = 0; xi < CITY.roadsX.length; xi += 1) {
      const rx = CITY.roadsX[xi];
      const ry = CITY.roadsY[yi];
      if ((xi + yi) % 2 === 0) {
        props.trafficLights.push({ x: rx + ROAD_HALF + 5, y: ry + ROAD_HALF + 5, phase: ((xi + yi) % 4 < 2 ? 0 : 1) });
      }
      if ((xi + yi) % 3 === 0) {
        props.hydrants.push({ x: rx - ROAD_HALF - 7, y: ry + ROAD_HALF + 7 });
      }
      if ((xi + yi) % 3 === 1) {
        props.bins.push({ x: rx + ROAD_HALF + 7, y: ry - ROAD_HALF - 7 });
      }
    }
  }
  for (let i = 0; i < 8; i += 1) {
    const rx = CITY.roadsX[2 + (i % 6)];
    const ry = CITY.roadsY[1 + Math.floor(i / 6) * 4];
    props.busStops.push({ x: rx + ROAD_HALF + 10, y: ry - 60, angle: 0 });
  }

  // Road-graph nodes at every intersection.
  const nodes = [];
  const nodeIndex = new Map();
  for (let yi = 0; yi < CITY.roadsY.length; yi += 1) {
    for (let xi = 0; xi < CITY.roadsX.length; xi += 1) {
      const node = { x: CITY.roadsX[xi], y: CITY.roadsY[yi], xi, yi, next: [] };
      nodeIndex.set(xi + ',' + yi, nodes.length);
      nodes.push(node);
    }
  }
  function link(a, b) {
    nodes[a].next.push(b);
    nodes[b].next.push(a);
  }
  for (let yi = 0; yi < CITY.roadsY.length; yi += 1) {
    for (let xi = 0; xi < CITY.roadsX.length; xi += 1) {
      const i = nodeIndex.get(xi + ',' + yi);
      if (xi + 1 < CITY.roadsX.length) link(i, nodeIndex.get((xi + 1) + ',' + yi));
      if (yi + 1 < CITY.roadsY.length) link(i, nodeIndex.get(xi + ',' + (yi + 1)));
    }
  }

  // Named places, all on roads.
  const spots = {
    garage: { x: CITY.roadsX[2], y: CITY.roadsY[5], label: 'Garage' },
    safehouse: { x: CITY.roadsX[1], y: CITY.roadsY[1], label: 'Safehouse' },
    vault: { x: CITY.roadsX[5], y: CITY.roadsY[3], label: 'Central Bank' },
    hospital: { x: CITY.roadsX[5], y: CITY.roadsY[1], label: 'Hospital' },
    crew: { x: CITY.roadsX[8], y: CITY.roadsY[3], label: 'Crew' },
    package: { x: CITY.roadsX[3], y: CITY.roadsY[2], label: 'Package' },
    delivery: { x: CITY.roadsX[8], y: CITY.roadsY[6], label: 'Drop-off' },
    target: { x: CITY.roadsX[6], y: CITY.roadsY[4], label: 'Target' },
  };

  return { buildings, trees, lamps, props, nodes, nodeIndex, spots };
}

// Circle (x, y, r) against a building rectangle: true when they overlap.
function circleHitsBuilding(x, y, r, building) {
  const cx = Math.max(building.x, Math.min(x, building.x + building.w));
  const cy = Math.max(building.y, Math.min(y, building.y + building.h));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < r * r;
}

// Push a circle out of a building rectangle; returns the corrected position.
function resolveCircleBuilding(x, y, r, building) {
  const cx = Math.max(building.x, Math.min(x, building.x + building.w));
  const cy = Math.max(building.y, Math.min(y, building.y + building.h));
  let dx = x - cx;
  let dy = y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return { x, y, hit: false };
  if (d2 < 0.0001) {
    // Centre inside the building: push out along the smallest penetration axis.
    const left = x - building.x;
    const right = building.x + building.w - x;
    const top = y - building.y;
    const bottom = building.y + building.h - y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) return { x: building.x - r, y, hit: true };
    if (m === right) return { x: building.x + building.w + r, y, hit: true };
    if (m === top) return { x, y: building.y - r, hit: true };
    return { x, y: building.y + building.h + r, hit: true };
  }
  const d = Math.sqrt(d2);
  dx /= d;
  dy /= d;
  return { x: cx + dx * r, y: cy + dy * r, hit: true };
}

// Breadth-first path on the road graph between two nodes (arrays of node indices).
function findPath(nodes, from, to) {
  if (from === to) return [from];
  const prev = new Int32Array(nodes.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head];
    head += 1;
    for (const n of nodes[cur].next) {
      if (prev[n] === -1) {
        prev[n] = cur;
        if (n === to) {
          const path = [to];
          let p = to;
          while (p !== from) {
            p = prev[p];
            path.push(p);
          }
          path.reverse();
          return path;
        }
        queue.push(n);
      }
    }
  }
  return [from];
}

// Cars drive on the right: this far from the road centreline, in their lane.
const LANE = 14;

// The point a car should steer for while following `path` toward `path[i]`: the node
// itself, shifted into a lane for the direction of that segment, so oncoming cars
// pass each other instead of meeting head-on. `lane` 1 is the right-hand lane, -1
// the left (used to pass a car stopped in the right lane).
function pathTarget(nodes, path, i, lane) {
  lane = lane === undefined ? 1 : lane;
  const target = nodes[path[Math.min(i, path.length - 1)]];
  const prev = nodes[path[Math.max(0, i - 1)]];
  const dx = target.x - prev.x;
  const dy = target.y - prev.y;
  let x = target.x;
  let y = target.y;
  if (Math.abs(dx) >= Math.abs(dy)) y += (dx >= 0 ? LANE : -LANE) * lane;
  else x += (dy >= 0 ? -LANE : LANE) * lane;
  return { x, y };
}

function nearestNode(nodes, x, y) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const dx = nodes[i].x - x;
    const dy = nodes[i].y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// The real 3D height of a building, from its seeded extrusion number.
function buildingHeight(b) {
  return HEIGHT.base + b.hgt * HEIGHT.scale;
}
