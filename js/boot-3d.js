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
    const [THREE, { SVGLoader }] = await Promise.all([
      Promise.race([
        import('https://unpkg.com/three@0.184.0/build/three.module.js'),
        timeout(TIMEOUT_MS),
      ]),
      Promise.race([
        import('https://unpkg.com/three@0.184.0/examples/jsm/loaders/SVGLoader.js'),
        timeout(TIMEOUT_MS),
      ]),
    ]);

    // Same path data as assets/img/logo-mark.svg. It's a single compound
    // path (3 subpaths) that only reads as the actual mark — a badge with
    // two cut-out notches — when those subpaths combine via the SVG
    // nonzero fill rule. Extruding each subpath as its own solid (an
    // earlier version of this file did that with a hand-rolled parser)
    // throws the holes away and renders as disconnected chunks. SVGLoader's
    // createShapes() resolves the real solid/hole relationships, same as
    // the browser does when it paints the flat logo.
    const D = 'M1017.09,1395.56c19.9,20.43,47.22,31.96,75.75,31.96h-299.82c-43.2,0-78.23-35.02-78.23-78.23v-263.94l302.29,310.21ZM1366.97,697.12h-118.66c23.68,0,46.45,9.09,63.63,25.4l90.41,85.78h-98.71c-30.27-.01-59.27-12.14-80.55-33.67-9.17-9.27-21.68-14.51-34.72-14.51h-.16l-15.67.04c-12.71.03-19.02,15.44-9.96,24.38l282.62,278.4v-287.59c0-43.2-35.02-78.23-78.23-78.23ZM1445.2,1349.3v-189.11h-128.76c-44.52,0-80.62,36.1-80.62,80.64l.06,153.32-298.17-299.12,223.85,1.12c63.66.26,95.74-76.67,50.77-121.72l-276.79-277.29h-142.51c-43.2,0-78.23,35.02-78.23,78.23v189.11h104.14c46.17,0,83.58-37.45,83.55-83.62l-.13-150.45,273.47,272.74c17.27,17.22,5.11,46.75-19.28,46.82l-327.59,1.02c-.5,0-.76.62-.4.96l375.72,375.6h162.69c43.2,0,78.23-35.02,78.23-78.23Z';

    const svgData = new SVGLoader().parse('<svg xmlns="http://www.w3.org/2000/svg"><path d="' + D + '"/></svg>');
    const shapes = [];
    svgData.paths.forEach((p) => shapes.push(...SVGLoader.createShapes(p)));

    const amber = new THREE.MeshStandardMaterial({ color: 0xe8862c, roughness: 0.32, metalness: 0.4, side: THREE.DoubleSide });

    // Just the extruded mark — no backing plate behind it (the site owner
    // asked for the dark rectangle to go).
    const model = new THREE.Group();
    const extrudeOpts = { depth: 130, bevelEnabled: true, bevelThickness: 3, bevelSize: 2.5, bevelSegments: 3, curveSegments: 20 };
    shapes.forEach((s) => model.add(new THREE.Mesh(new THREE.ExtrudeGeometry(s, extrudeOpts), amber)));

    // Center in the shape's native (unflipped) space — flipping the sign
    // of scale.y afterwards keeps it centered either way.
    const full = new THREE.Box3().setFromObject(model);
    const center = full.getCenter(new THREE.Vector3());
    model.children.forEach((m) => m.position.sub(center));
    const modelScale = 1.7 / full.getSize(new THREE.Vector3()).y;

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

    // Entrance settle, then a real continuous turntable spin (not an
    // ease that stalls out), then fade — long enough to actually look at
    // the lit surface turning, not just a blink.
    const DURATION = 5500;
    const ENTRANCE_END = 0.10;
    const HOLD_END = 0.88;
    const HOLD_ROTATIONS = 2.5;
    const startTime = performance.now();
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
    function frame(now) {
      const t = Math.min((now - startTime) / DURATION, 1);
      let rotY;
      if (t < ENTRANCE_END) {
        rotY = -1.3 * (1 - easeOut(t / ENTRANCE_END));
      } else if (t < HOLD_END) {
        rotY = ((t - ENTRANCE_END) / (HOLD_END - ENTRANCE_END)) * HOLD_ROTATIONS * Math.PI * 2;
      } else {
        rotY = HOLD_ROTATIONS * Math.PI * 2 + ((t - HOLD_END) / (1 - HOLD_END)) * (Math.PI * 0.6);
      }
      const fadeIn = Math.min(t / 0.08, 1);
      const fadeOut = t > HOLD_END ? Math.max(1 - (t - HOLD_END) / (1 - HOLD_END), 0) : 1;
      canvas.style.opacity = String(fadeIn * fadeOut);
      model.rotation.y = rotY;
      const scaleT = t < ENTRANCE_END ? easeOut(t / ENTRANCE_END) : 1;
      const s = modelScale * (0.55 + scaleT * 0.45);
      model.scale.set(s, -s, s); // keep the y-flip (SVG y-down -> three y-up)
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
