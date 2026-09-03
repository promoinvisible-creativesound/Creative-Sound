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
    const THREE = await Promise.race([
      import('https://unpkg.com/three@0.184.0/build/three.module.js'),
      timeout(TIMEOUT_MS),
    ]);

    // Same path data as assets/img/logo-mark.svg.
    const D = 'M1017.09,1395.56c19.9,20.43,47.22,31.96,75.75,31.96h-299.82c-43.2,0-78.23-35.02-78.23-78.23v-263.94l302.29,310.21ZM1366.97,697.12h-118.66c23.68,0,46.45,9.09,63.63,25.4l90.41,85.78h-98.71c-30.27-.01-59.27-12.14-80.55-33.67-9.17-9.27-21.68-14.51-34.72-14.51h-.16l-15.67.04c-12.71.03-19.02,15.44-9.96,24.38l282.62,278.4v-287.59c0-43.2-35.02-78.23-78.23-78.23ZM1445.2,1349.3v-189.11h-128.76c-44.52,0-80.62,36.1-80.62,80.64l.06,153.32-298.17-299.12,223.85,1.12c63.66.26,95.74-76.67,50.77-121.72l-276.79-277.29h-142.51c-43.2,0-78.23,35.02-78.23,78.23v189.11h104.14c46.17,0,83.58-37.45,83.55-83.62l-.13-150.45,273.47,272.74c17.27,17.22,5.11,46.75-19.28,46.82l-327.59,1.02c-.5,0-.76.62-.4.96l375.72,375.6h162.69c43.2,0,78.23-35.02,78.23-78.23Z';

    // Minimal SVG path -> THREE.Shape list (subset of commands the mark
    // actually uses: M/L/C/Z). y is negated (SVG is y-down, three is y-up).
    function parsePath(d) {
      const tokens = d.match(/[MmLlHhVvCcSsQqTtZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
      const shapes = [];
      let path = null, cmd = null, x = 0, y = 0, sx = 0, sy = 0;
      let i = 0;
      const num = () => parseFloat(tokens[i++]);
      const start = () => { path = new THREE.Shape(); path.curveSegments = 20; shapes.push(path); };
      while (i < tokens.length) {
        if (/[a-z]/i.test(tokens[i])) { cmd = tokens[i++]; }
        switch (cmd) {
          case 'M': case 'm': {
            let nx = num(), ny = num();
            if (cmd === 'm') { nx += x; ny += y; }
            x = sx = nx; y = sy = ny;
            start(); path.moveTo(x, -y);
            cmd = (cmd === 'M') ? 'L' : 'l';
            break;
          }
          case 'L': case 'l': {
            let nx = num(), ny = num();
            if (cmd === 'l') { nx += x; ny += y; }
            x = nx; y = ny; path.lineTo(x, -y); break;
          }
          case 'C': case 'c': {
            let a = num(), b = num(), cc = num(), dd = num(), e = num(), f = num();
            if (cmd === 'c') { a += x; b += y; cc += x; dd += y; e += x; f += y; }
            path.bezierCurveTo(a, -b, cc, -dd, e, -f);
            x = e; y = f; break;
          }
          case 'Z': case 'z': { path.closePath(); x = sx; y = sy; cmd = null; break; }
          default: i++;
        }
      }
      return shapes;
    }

    const shapes = parsePath(D);
    const amber = new THREE.MeshStandardMaterial({ color: 0xe8862c, roughness: 0.32, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 0.6, metalness: 0.12 });

    const model = new THREE.Group();
    const extrudeOpts = { depth: 130, bevelEnabled: true, bevelThickness: 3, bevelSize: 2.5, bevelSegments: 3, curveSegments: 20 };
    shapes.forEach((s) => model.add(new THREE.Mesh(new THREE.ExtrudeGeometry(s, extrudeOpts), amber)));

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const pad = 90;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(size.x + pad * 2, size.y + pad * 2, 46), dark);
    plate.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, -23 - 1);
    model.add(plate);

    const full = new THREE.Box3().setFromObject(model);
    const center = full.getCenter(new THREE.Vector3());
    model.children.forEach((m) => m.position.sub(center));
    const modelScale = 1.7 / full.getSize(new THREE.Vector3()).y;
    model.scale.setScalar(modelScale);

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

    const DURATION = 1500;
    const startTime = performance.now();
    function ease(t) { return 1 - Math.pow(1 - t, 3); }
    function frame(now) {
      const t = Math.min((now - startTime) / DURATION, 1);
      const eased = ease(t);
      const fadeIn = Math.min(t / 0.18, 1);
      const fadeOut = t > 0.82 ? Math.max(1 - (t - 0.82) / 0.18, 0) : 1;
      canvas.style.opacity = String(fadeIn * fadeOut);
      model.rotation.y = -1.1 + eased * (Math.PI * 2 + 1.1);
      model.rotation.x = 0.15 - eased * 0.15;
      const s = modelScale * (0.55 + eased * 0.45);
      model.scale.setScalar(s);
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
