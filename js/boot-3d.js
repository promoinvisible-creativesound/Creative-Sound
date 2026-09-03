// Progressive enhancement for the boot overlay: swaps the flat logo-mark
// image (#boot-mark) for a real extruded 3D object — built with Three.js
// from the same SVG path, bevelled, with a studio-lit metal material —
// when WebGL is available and the library loads fast enough. Anything
// short of full success (no WebGL, slow/broken CDN, old browser, a
// mid-scene error) silently leaves the existing 2D CSS animation running
// untouched; nothing here can block or break the page.
(async () => {
  'use strict';

  const overlay = document.getElementById('boot-overlay');
  const mark2d = document.getElementById('boot-mark');
  if (!overlay || !mark2d || document.body.classList.contains('no-boot')) return;

  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
        (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }
  if (!hasWebGL()) return;

  const TIMEOUT_MS = 900;
  const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

  try {
    // SVGLoader's own source imports THREE via the bare specifier "three",
    // which only resolves because index.html declares an import map right
    // before this script tag. No import map (very old browser) means this
    // import rejects, which is caught below same as any other failure.
    const [THREE, { SVGLoader }] = await Promise.all([
      Promise.race([import('three'), timeout(TIMEOUT_MS)]),
      Promise.race([import('three/addons/loaders/SVGLoader.js'), timeout(TIMEOUT_MS)]),
    ]);

    // Same path data as assets/img/logo-mark.svg. It's a single compound
    // path (3 subpaths) that only reads as the actual mark — a badge with
    // two cut-out notches — when those subpaths combine via the SVG
    // nonzero fill rule. SVGLoader's createShapes() resolves that solid/hole
    // relationship the same way the browser does when it paints the flat
    // logo, so extruding its output can't lose or misplace any part of it.
    const D = 'M1017.09,1395.56c19.9,20.43,47.22,31.96,75.75,31.96h-299.82c-43.2,0-78.23-35.02-78.23-78.23v-263.94l302.29,310.21ZM1366.97,697.12h-118.66c23.68,0,46.45,9.09,63.63,25.4l90.41,85.78h-98.71c-30.27-.01-59.27-12.14-80.55-33.67-9.17-9.27-21.68-14.51-34.72-14.51h-.16l-15.67.04c-12.71.03-19.02,15.44-9.96,24.38l282.62,278.4v-287.59c0-43.2-35.02-78.23-78.23-78.23ZM1445.2,1349.3v-189.11h-128.76c-44.52,0-80.62,36.1-80.62,80.64l.06,153.32-298.17-299.12,223.85,1.12c63.66.26,95.74-76.67,50.77-121.72l-276.79-277.29h-142.51c-43.2,0-78.23,35.02-78.23,78.23v189.11h104.14c46.17,0,83.58-37.45,83.55-83.62l-.13-150.45,273.47,272.74c17.27,17.22,5.11,46.75-19.28,46.82l-327.59,1.02c-.5,0-.76.62-.4.96l375.72,375.6h162.69c43.2,0,78.23-35.02,78.23-78.23Z';

    const svgData = new SVGLoader().parse('<svg xmlns="http://www.w3.org/2000/svg"><path d="' + D + '"/></svg>');
    const shapes = [];
    svgData.paths.forEach((p) => shapes.push(...SVGLoader.createShapes(p)));

    const amber = new THREE.MeshStandardMaterial({ color: 0xe8862c, roughness: 0.32, metalness: 0.4, side: THREE.DoubleSide });
    const extrudeOpts = { depth: 130, bevelEnabled: true, bevelThickness: 3, bevelSize: 2.5, bevelSegments: 3, curveSegments: 20 };
    const partGeoms = shapes.map((s) => new THREE.ExtrudeGeometry(s, extrudeOpts));

    // The "assembled" transform every fragment below converges to — worked
    // out from the whole, correct mark before it gets cut into pieces, so
    // the rest pose can never end up wrong no matter how it's fragmented.
    const wholeBox = new THREE.Box3();
    partGeoms.forEach((g) => { g.computeBoundingBox(); wholeBox.union(g.boundingBox); });
    const center = wholeBox.getCenter(new THREE.Vector3());
    const modelScale = 1.7 / wholeBox.getSize(new THREE.Vector3()).y;

    // Cut each part's geometry into a handful of pieces by where its faces
    // sit in the plane — a spatial split of the SAME verified-correct
    // triangles, never a re-derived outline. So once every fragment reaches
    // offset zero, the result is pixel-identical to the merged shape;
    // fragmentation can only change how it arrives, not what it looks like
    // at rest.
    function splitIntoFragments(geometry, grid) {
      const box = geometry.boundingBox;
      const sizeX = (box.max.x - box.min.x) || 1;
      const sizeY = (box.max.y - box.min.y) || 1;
      const pos = geometry.attributes.position;
      const norm = geometry.attributes.normal;
      const index = geometry.index;
      const triCount = index ? index.count / 3 : pos.count / 3;
      const buckets = new Map();
      const vi = (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k);
      for (let t = 0; t < triCount; t++) {
        const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
        const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
        const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
        const gx = Math.min(grid - 1, Math.floor(((cx - box.min.x) / sizeX) * grid));
        const gy = Math.min(grid - 1, Math.floor(((cy - box.min.y) / sizeY) * grid));
        const key = gx + '_' + gy;
        if (!buckets.has(key)) buckets.set(key, { positions: [], normals: [] });
        const bucket = buckets.get(key);
        [a, b, c].forEach((i) => {
          bucket.positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
          bucket.normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
        });
      }
      return [...buckets.values()].map((bucket) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3));
        return geo;
      });
    }

    const model = new THREE.Group();
    const fragments = [];
    partGeoms.forEach((geo) => {
      splitIntoFragments(geo, 3).forEach((fragGeo) => {
        const mesh = new THREE.Mesh(fragGeo, amber);
        mesh.position.sub(center);
        model.add(mesh);
        const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
        if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
        dir.normalize().multiplyScalar(1.3 + Math.random() * 1.7);
        fragments.push({
          mesh,
          assembledPos: mesh.position.clone(),
          startOffset: dir,
          startRot: new THREE.Euler((Math.random() * 2 - 1) * 1.4, (Math.random() * 2 - 1) * 1.4, (Math.random() * 2 - 1) * 1.4),
          delay: Math.random() * 0.55,
        });
      });
    });

    // SVGLoader keeps SVG's y-down coordinates; flip to three's y-up via a
    // negative y scale. (Mirroring inverts triangle winding, which is why
    // the material above is double-sided — otherwise the now-inward-facing
    // normals go dark.)
    model.scale.set(modelScale, -modelScale, modelScale);

    const scene = new THREE.Scene();
    scene.add(model);
    scene.add(new THREE.HemisphereLight(0xfff4e6, 0x1a1408, 1.1));
    const key = new THREE.DirectionalLight(0xffe4b3, 2.6);
    key.position.set(3, 4, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xe8862c, 0.8);
    fill.position.set(-3, -1, -2);
    scene.add(fill);

    const px = mark2d.clientWidth || 220;
    const canvas = document.createElement('canvas');
    canvas.id = 'boot-3d';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'width:' + px + 'px;height:' + px + 'px;opacity:0;filter:drop-shadow(0 0 30px rgba(232,134,44,0.7));';
    overlay.insertBefore(canvas, mark2d);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.25, 3.4);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(px, px, false);

    // Everything upstream succeeded — only now hide the 2D fallback and
    // start the 3D reveal, so a mid-setup throw above never leaves the
    // overlay with neither version visible.
    mark2d.style.display = 'none';

    // Pieces fly in and lock together (ENTRANCE), then a real continuous
    // turntable spin once fully assembled (HOLD), then the spin stops dead
    // — rest on that frame — and only then fades, instead of still turning
    // as it disappears.
    const DURATION = 3500;
    const ENTRANCE_END = 0.24;
    const HOLD_END = 0.88;
    const HOLD_ROTATIONS = 1.4;
    const startTime = performance.now();
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
    function frame(now) {
      const t = Math.min((now - startTime) / DURATION, 1);

      if (t < ENTRANCE_END) {
        const globalT = t / ENTRANCE_END;
        fragments.forEach((f) => {
          const localT = Math.min(Math.max((globalT - f.delay) / (1 - f.delay), 0), 1);
          const eased = easeOut(localT);
          const k = 1 - eased;
          f.mesh.position.set(
            f.assembledPos.x + f.startOffset.x * k,
            f.assembledPos.y + f.startOffset.y * k,
            f.assembledPos.z + f.startOffset.z * k
          );
          f.mesh.rotation.set(f.startRot.x * k, f.startRot.y * k, f.startRot.z * k);
        });
        model.rotation.y = -0.35 * (1 - easeOut(globalT));
      } else if (t < HOLD_END) {
        model.rotation.y = ((t - ENTRANCE_END) / (HOLD_END - ENTRANCE_END)) * HOLD_ROTATIONS * Math.PI * 2;
      } else {
        // Frozen at exactly the angle the HOLD phase ended on (no jump) —
        // it stops turning before the fade below ever starts, rather than
        // still spinning as it vanishes.
        model.rotation.y = HOLD_ROTATIONS * Math.PI * 2;
      }

      const fadeIn = Math.min(t / 0.1, 1);
      const fadeOut = t > HOLD_END ? Math.max(1 - (t - HOLD_END) / (1 - HOLD_END), 0) : 1;
      canvas.style.opacity = String(fadeIn * fadeOut);

      renderer.render(scene, camera);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch (err) {
    // No WebGL/CDN/parse failure recovery needed — #boot-mark was never
    // hidden, so the existing 2D animation is already carrying the boot
    // overlay on its own.
  }
})();
