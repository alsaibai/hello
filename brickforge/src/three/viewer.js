import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { COLORS } from '../engine/palette.js';
import { studCells } from '../engine/parts.js';

// 1 stud = 1 unit. Real LEGO: pitch 8 mm, plate 3.2 mm (0.4), brick 9.6 mm (1.2), stud dia 4.8 mm, stud height 1.7 mm.
const PLATE = 0.4, STUD_R = 0.3, STUD_H = 0.2125, GAP = 0.02;

export const LOOKS = {
  studio: { label: 'Studio', bg: '#ebebeb', floor: '#d9d9d9', env: 0.85, exposure: 0.95, floorRough: 0.9,
    key: ['#ffffff', 2.2, [7, 13, 9]], fill: ['#e8eeff', 0.5, [-9, 6, 4]], rim: ['#ffffff', 0.8, [-2, 8, -10]], hemi: 0.15, blur: 5 },
  day: { label: 'Daylight', bg: '#c3ccd3', floor: '#a9b0b5', env: 0.7, exposure: 1.05, floorRough: 0.95,
    key: ['#fff3dd', 4.2, [12, 16, 5]], fill: ['#bcd4ff', 0.6, [-8, 5, 8]], rim: ['#ffffff', 0.3, [0, 6, -10]], hemi: 0.55, blur: 1 },
  golden: { label: 'Golden hour', bg: '#2a2725', floor: '#373330', env: 0.3, exposure: 1.1, floorRough: 0.9,
    key: ['#ffc48a', 5.0, [15, 5.5, 3]], fill: ['#6a83c9', 0.7, [-9, 6, 8]], rim: ['#ffd9a8', 1.6, [-6, 5, -10]], hemi: 0.1, blur: 3 },
  noir: { label: 'Noir', bg: '#0b0b0b', floor: '#181818', env: 0.12, exposure: 1.1, floorRough: 0.75,
    key: ['#ffffff', 5, [2, 20, 7]], fill: ['#9fb4ff', 0.25, [-9, 4, 8]], rim: ['#ffffff', 3, [-5, 7, -11]], hemi: 0.02, blur: 1.5 },
};

const bodyCache = new Map(), studGeo = (() => {
  const pts = [[0, 0], [STUD_R, 0], [STUD_R, STUD_H - 0.04], [STUD_R - 0.035, STUD_H], [0, STUD_H]].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 20);
})();
function slopeGeo(across, dir) {
  const H = 3 * PLATE - GAP * 0.6, len = 2 - GAP, lip = 0.4;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.lineTo(len, 0); sh.lineTo(len, lip); sh.lineTo(1, H); sh.lineTo(0, H); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: across - GAP - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 1 });
  g.translate(-len / 2, -H / 2, -(across - GAP - 0.06) / 2);
  g.rotateY(dir === 1 ? 0 : dir === 2 ? Math.PI : dir === 3 ? -Math.PI / 2 : Math.PI / 2); // local +x = the way the slope descends
  return g;
}
const partKey = (p) => (p.kind === 'slope' ? `slope|${p.across}|${p.dir}` : `${p.w}x${p.h}x${p.d}`);
function bodyGeo(p) {
  const key = partKey(p);
  if (!bodyCache.has(key)) {
    bodyCache.set(key, p.kind === 'slope' ? slopeGeo(p.across, p.dir)
      : new RoundedBoxGeometry(p.w - GAP, p.h * PLATE - GAP * 0.6, p.d - GAP, 2, p.kind === 'tile' ? 0.03 : 0.045));
  }
  return bodyCache.get(key);
}

const upper = (arr, n) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < n) lo = m + 1; else hi = m; } return lo; };

export class Viewer {
  constructor(canvasHost) {
    this.host = canvasHost;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // shadows only depend on geometry and lights: redraw them when those change, not every pulse frame
    this.shadowDirty = true;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvasHost.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pm.fromScene(new RoomEnvironment(), 0.03).texture;
    this.scene.environment = this.envTex;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.controls.addEventListener('start', () => { this.userMoved = true; });

    this.key = new THREE.DirectionalLight(); this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.03;
    this.fill = new THREE.DirectionalLight(); this.rim = new THREE.DirectionalLight();
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 0.2);
    this.scene.add(this.key, this.key.target, this.fill, this.rim, this.hemi);

    this.floor = new THREE.Mesh(new THREE.CircleGeometry(120, 64), new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.2, envMapIntensity: 1 });
    this.studMat = this.bodyMat;
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.hl = new THREE.Group(); this.scene.add(this.hl);
    this.hlMats = [];
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x000000 }); this.edgeCache = new Map();
    this.model = null; this.meshes = []; this.studs = null;
    this.dim = 1; this.pulse = true; this.dirty = true;
    this.look = 'studio';
    this.applyLook('studio');

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvasHost);
    this.onWinResize = () => this.resize(); window.addEventListener('resize', this.onWinResize); // zoom / moving between monitors changes devicePixelRatio
    // GPU context loss (driver reset, tab in background): stop drawing, then rebuild what lived on the GPU
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => { this.lost = false; this.restoreGpu(); });
    this.resize();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.dirty = true;
    if (this.center && !this.userMoved) this.resetView(); // keep the whole model in view as the window changes shape
  }

  applyLook(name) {
    const L = LOOKS[name] || LOOKS.studio; this.look = name;
    this.scene.background = new THREE.Color(L.bg);
    this.floor.material.color.set(L.floor); this.floor.material.roughness = L.floorRough;
    this.scene.environmentIntensity = L.env; this.renderer.toneMappingExposure = L.exposure;
    for (const [light, spec] of [[this.key, L.key], [this.fill, L.fill], [this.rim, L.rim]]) { light.color.set(spec[0]); light.intensity = spec[1]; light.userData.dir = new THREE.Vector3(...spec[2]).normalize(); }
    this.key.shadow.radius = L.blur;
    this.placeLights();
    this.edgeMat.color.copy(new THREE.Color(name === 'noir' || name === 'golden' ? '#ffffff' : '#000000'));
    this.hemi.intensity = L.hemi;
    this.dirty = true; this.shadowDirty = true;
  }

  /** Lights sit at a fixed direction from the model's centre, far enough out for any model size; fog hides the floor's rim. */
  placeLights() {
    const R = Math.max(this.radius || 8, 8), c = this.center || new THREE.Vector3(0, 4, 0), dist = R * 2.4 + 10;
    for (const light of [this.key, this.fill, this.rim]) light.position.copy(c).addScaledVector(light.userData.dir || new THREE.Vector3(0, 1, 0), dist);
    const sh = this.key.shadow.camera, e = R * 1.7;
    Object.assign(sh, { left: -e, right: e, top: e, bottom: -e, near: 1, far: dist + R * 4 }); sh.updateProjectionMatrix();
    this.key.target.position.copy(c); this.key.target.updateMatrixWorld();
    const L = LOOKS[this.look] || LOOKS.studio;
    this.scene.fog = new THREE.Fog(new THREE.Color(L.bg), R * 5, Math.min(R * 16, 105));
    this.shadowDirty = true; this.dirty = true;
  }

  setModel(model) {
    this.model = model;
    this.meshes.forEach((m) => { m.mesh.dispose(); this.group.remove(m.mesh); });
    if (this.studs) { this.studs.mesh.dispose(); this.group.remove(this.studs.mesh); }
    this.meshes = []; this.studs = null;
    if (!model) return;
    const { parts, grid } = model;
    const ox = -grid.W / 2, oz = -grid.D / 2;
    this.origin = { ox, oz };
    const byKey = new Map();
    const ordered = parts.filter((p) => p.kind !== 'baseplate').sort((a, b) => a.order - b.order);
    this.buildBaseplate(parts.find((p) => p.kind === 'baseplate'), ox, oz);
    for (const p of ordered) {
      const k = partKey(p);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(p);
    }
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    for (const [, list] of byKey) {
      const p0 = list[0];
      const mesh = new THREE.InstancedMesh(bodyGeo(p0), this.bodyMat, list.length);
      mesh.castShadow = mesh.receiveShadow = true;
      list.forEach((p, i) => {
        m4.makeTranslation(p.x + p.w / 2 + ox, (p.y + p.h / 2) * PLATE, p.z + p.d / 2 + oz);
        mesh.setMatrixAt(i, m4); mesh.setColorAt(i, c.set(COLORS[p.color].hex));
      });
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.meshes.push({ mesh, orders: list.map((p) => p.order), total: list.length });
    }
    // studs: one instance per stud, sorted by owning part's build order
    const studList = [];
    for (const p of ordered) for (const [cx, cz] of studCells(p)) studList.push({ p, cx, cz });
    const sm = new THREE.InstancedMesh(studGeo, this.studMat, studList.length);
    sm.castShadow = sm.receiveShadow = true;
    studList.forEach((s, n) => {
      m4.makeTranslation(s.cx + 0.5 + ox, (s.p.y + s.p.h) * PLATE - GAP * 0.3, s.cz + 0.5 + oz);
      sm.setMatrixAt(n, m4); sm.setColorAt(n, c.set(COLORS[s.p.color].hex));
    });
    sm.instanceMatrix.needsUpdate = true; sm.instanceColor.needsUpdate = true;
    this.group.add(sm);
    this.studs = { mesh: sm, orders: studList.map((s) => s.p.order), total: studList.length };

    const H = grid.H * PLATE, r = Math.hypot(grid.W, grid.D, H) / 2;
    this.radius = r; this.center = new THREE.Vector3(0, H / 2, 0);
    this.placeLights();
    this.showUpTo(parts.length, []);
    this.resetView();
  }

  /** The baseplate is one big part: a slab with its studs, drawn on its own. */
  buildBaseplate(bp, ox, oz) {
    if (this.baseGroup) { this.baseGroup.traverse((o) => { if (o.geometry && o.geometry !== studGeo) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); /* frees the per-instance buffer too */ }); this.scene.remove(this.baseGroup); if (this.baseMat) this.baseMat.dispose(); }
    this.baseGroup = null; this.baseMat = null; this.baseId = null; this.baseHighlight = false; this.floor.position.y = -0.001;
    if (!bp) return;
    const mat = this.bodyMat.clone(); mat.color.set(COLORS[bp.color].hex); mat.emissive = new THREE.Color(COLORS[bp.color].hex); mat.emissiveIntensity = 0;
    const g = new THREE.Group();
    const slab = new THREE.Mesh(new RoundedBoxGeometry(bp.w - GAP, PLATE, bp.d - GAP, 2, 0.045), mat); slab.receiveShadow = true; slab.castShadow = true;
    slab.position.set(bp.x + bp.w / 2 + ox, -PLATE / 2, bp.z + bp.d / 2 + oz); g.add(slab);
    const studs = new THREE.InstancedMesh(studGeo, mat, bp.w * bp.d); studs.receiveShadow = true; studs.castShadow = true;
    const m4 = new THREE.Matrix4(); let n = 0;
    for (let z = 0; z < bp.d; z++) for (let x = 0; x < bp.w; x++) { m4.makeTranslation(bp.x + x + 0.5 + ox, -GAP * 0.3, bp.z + z + 0.5 + oz); studs.setMatrixAt(n++, m4); }
    g.add(studs); this.scene.add(g);
    this.baseGroup = g; this.baseMat = mat; this.baseId = bp.id; this.floor.position.y = -PLATE - 0.001;
  }

  /** Show parts with build order < n as normal; `highlight` part ids as glowing pieces. */
  showUpTo(n, highlight = [], dim = 1) {
    this.dim = dim;
    this.bodyMat.color.setScalar(dim);
    if (this.baseMat && this.model) { const c = new THREE.Color(COLORS[this.model.parts[this.baseId].color].hex); this.baseMat.color.copy(c).multiplyScalar(dim); }
    for (const m of this.meshes) m.mesh.count = upper(m.orders, n);
    if (this.studs) this.studs.mesh.count = upper(this.studs.orders, n);
    this.hl.clear(); this.hlMats.forEach((m) => m.dispose()); this.hlMats = [];
    if (this.baseGroup) { this.baseGroup.visible = n > 0 || highlight.includes(this.baseId); this.baseHighlight = highlight.includes(this.baseId); this.baseMat.emissiveIntensity = this.baseHighlight ? 0.4 : 0; }
    if (this.model && highlight.length) {
      const { ox, oz } = this.origin;
      for (const id of highlight) {
        if (id === this.baseId) continue;
        const p = this.model.parts[id];
        const mat = this.bodyMat.clone(); mat.color.set(COLORS[p.color].hex); mat.emissive = new THREE.Color(COLORS[p.color].hex); mat.emissiveIntensity = 0.4;
        const g = new THREE.Group();
        const body = new THREE.Mesh(bodyGeo(p), mat); body.castShadow = body.receiveShadow = true; g.add(body);
        const ek = `${p.w}x${p.h}x${p.d}`;
        if (!this.edgeCache.has(ek)) this.edgeCache.set(ek, new THREE.EdgesGeometry(new THREE.BoxGeometry(p.w + 0.06, p.h * PLATE + 0.03, p.d + 0.06)));
        g.add(new THREE.LineSegments(this.edgeCache.get(ek), this.edgeMat)); // shared geometry and material: nothing to leak per step
        for (const [cx, cz] of studCells(p)) {
          const st = new THREE.Mesh(studGeo, mat); st.castShadow = true;
          st.position.set(cx + 0.5 - (p.x + p.w / 2), p.h * PLATE / 2 - GAP * 0.3, cz + 0.5 - (p.z + p.d / 2)); g.add(st);
        }
        g.position.set(p.x + p.w / 2 + ox, (p.y + p.h / 2) * PLATE, p.z + p.d / 2 + oz);
        this.hl.add(g); this.hlMats.push(mat);
      }
    }
    this.dirty = true; this.shadowDirty = true;
  }

  resetView() {
    if (!this.center) return;
    // distance so the bounding sphere fits the LIMITING field of view (narrow windows are limited by width)
    const vfov = THREE.MathUtils.degToRad(this.camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const d = (this.radius * 1.25) / Math.sin(Math.min(vfov, hfov) / 2) + 2;
    const az = 0.62, el = 0.5;
    this.camera.position.set(this.center.x + d * Math.cos(el) * Math.sin(az), this.center.y + d * Math.sin(el), this.center.z + d * Math.cos(el) * Math.cos(az));
    this.controls.target.copy(this.center);
    this.controls.minDistance = this.radius * 0.8; this.controls.maxDistance = this.radius * 8 + 20;
    this.controls.update(); this.dirty = true; this.userMoved = false;
  }

  setAutoRotate(on) { this.controls.autoRotate = on; }

  frame(t) {
    const moved = this.controls.update();
    let draw = this.dirty || moved || this.controls.autoRotate;
    if ((this.hlMats.length || this.baseHighlight) && this.pulse && t - (this.lastPulse || 0) > 45) {
      const k = 0.4 + 0.3 * Math.sin(t / 260);
      this.hlMats.forEach((m) => { m.emissiveIntensity = k; });
      if (this.baseHighlight) this.baseMat.emissiveIntensity = k;
      this.lastPulse = t; draw = true;
    }
    if (!draw || this.lost) return;
    this.dirty = false;
    if (this.shadowDirty) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    this.renderer.render(this.scene, this.camera);
  }

  /** After a lost context the environment map (a render target) is empty: regenerate it and redraw everything. */
  restoreGpu() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    if (this.envTex) this.envTex.dispose();
    this.envTex = pm.fromScene(new RoomEnvironment(), 0.03).texture;
    this.scene.environment = this.envTex;
    this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    this.applyLook(this.look);
    this.dirty = true; this.shadowDirty = true;
  }

  snapshot() { this.renderer.shadowMap.needsUpdate = true; this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
  dispose() { window.removeEventListener('resize', this.onWinResize); this.renderer.setAnimationLoop(null); this.ro.disconnect(); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
