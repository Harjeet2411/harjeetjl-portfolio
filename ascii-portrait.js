/*
 * ascii-portrait.js: draws a photo as green matrix-style ASCII on a <canvas>.
 * The glyphs tilt in 3D with the pointer; inside a circle around the pointer they
 * scatter and the original photo shows through. No dependencies.
 *
 *   AsciiPortrait.mount(canvas, { src: "portrait.jpg" });
 *
 * Locked settings (approved 2026-10-28): radius 110, cell 16, depth 40, rain on.
 * 2026-10-29: the portfolio mounts it with { interactive: false, glitch: true }: no hover;
 * every 7-10 s a hacker glitch flickers to the original photo for ~1 s under a red warning.
 * They are measured against a 640px-wide canvas (`ref`) and scale with the
 * canvas, so a small window keeps the same look as the full-size hero.
 */
(function (root) {
  "use strict";

  var DEFAULTS = { src: "", radius: 110, cell: 16, depth: 40, rain: true, ref: 640, focusY: 0.42, interactive: true, glitch: false, glitchMin: 7000, glitchMax: 10000, glitchMs: 1000, color: "#3dff8f", bright: "#8dffbf", head: "#d9ffe9" };
  var RAMP = " .,:;-=+*ox%#@";
  var KANA = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789";

  function mount(cv, options) {
    var o = Object.assign({}, DEFAULTS, options || {});
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var g = cv.getContext("2d"), img = new Image();
    var W = 0, H = 0, dpr = 1, s = 1, cols = 0, rows = 0, cells = [], drops = [], lum = null, LW = 0, LH = 0;
    var pointer = { x: -9999, y: -9999, sx: -9999, sy: -9999, inside: false };
    var tilt = { x: 0, y: 0, tx: 0, ty: 0 };
    var photo = document.createElement("canvas"), pg = photo.getContext("2d");
    var crop = { sx: 0, sy: 0, sw: 0, sh: 0 };
    var raf = 0, last = 0, visible = true, alive = true;
    var gl = { start: 0, until: 0, next: 0 };
    function rnd(a, b) { return a + Math.random() * (b - a); }

    // the glitch: torn photo slices, red wash, scanlines and a blinking warning sign
    function drawGlitch(t) {
      var k = (t - gl.start) / o.glitchMs;
      var showPhoto = k > 0.08 && k < 0.94 && ((t / 70) | 0) % 5 !== 0; // flickers back to ASCII now and then
      if (showPhoto) {
        g.save(); g.globalAlpha = 1;
        var y = 0;
        while (y < H) {
          var sh = rnd(6, 26) * s, off = Math.random() < 0.28 ? rnd(-14, 14) * s : 0;
          g.drawImage(img, crop.sx, crop.sy + (y / H) * crop.sh, crop.sw, (sh / H) * crop.sh, off, y, W, sh);
          y += sh;
        }
        g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.35;
        g.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, rnd(3, 7) * s, 0, W, H); // red ghost
        g.restore();
      }
      g.fillStyle = "rgba(255,40,60," + (showPhoto ? 0.22 : 0.1) + ")"; g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(255,70,90,0.5)";
      for (var i = 0; i < 4; i++) g.fillRect(0, rnd(0, H), W, Math.max(1, rnd(1, 3) * s));
      if (((t / 140) | 0) % 2 === 0) {
        var cx = W / 2, cy = H * 0.42, r = 34 * s * (W / 280 > 1.5 ? 1 : 1.4);
        g.lineWidth = Math.max(2, 3 * s); g.strokeStyle = "#ff3b4e"; g.fillStyle = "rgba(20,0,4,0.75)";
        g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r * 1.1, cy + r * 0.8); g.lineTo(cx - r * 1.1, cy + r * 0.8); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = "#ff3b4e"; g.font = "700 " + Math.round(r * 0.95) + "px JetBrains Mono, ui-monospace, monospace"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText("!", cx, cy + r * 0.18);
        g.font = "700 " + Math.max(9, Math.round(r * 0.36)) + "px JetBrains Mono, ui-monospace, monospace";
        g.fillText("INTRUSION DETECTED", cx, cy + r * 1.35);
        g.textAlign = "left"; g.textBaseline = "top"; g.font = "500 " + Math.max(4, o.cell * s) + "px JetBrains Mono, ui-monospace, monospace";
      }
    }

    // "cover" crop of the photo into the canvas aspect, biased toward the face
    function computeCrop() {
      var ia = img.width / img.height, ca = W / H;
      if (ia > ca) { crop.sh = img.height; crop.sw = img.height * ca; crop.sx = (img.width - crop.sw) / 2; crop.sy = 0; }
      else { crop.sw = img.width; crop.sh = img.width / ca; crop.sx = 0; crop.sy = Math.max(0, Math.min(img.height - crop.sh, img.height * o.focusY - crop.sh / 2)); }
    }

    function sample() {
      LW = 200; LH = Math.max(1, Math.round(200 * H / W));
      var c = document.createElement("canvas"); c.width = LW; c.height = LH;
      var cg = c.getContext("2d", { willReadFrequently: true });
      cg.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, LW, LH);
      var d = cg.getImageData(0, 0, LW, LH).data; lum = new Float32Array(LW * LH);
      for (var i = 0; i < LW * LH; i++) lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
      // auto-levels: stretch the 3rd to 99.5th percentile so a low-key portrait still reads
      var sorted = Array.prototype.slice.call(lum).sort(function (a, b) { return a - b; });
      var lo = sorted[(sorted.length * 0.03) | 0], hi = sorted[(sorted.length * 0.995) | 0], span = Math.max(0.05, hi - lo);
      for (var j = 0; j < lum.length; j++) lum[j] = Math.max(0, Math.min(1, (lum[j] - lo) / span));
    }
    function L(u, v) {
      var x = Math.min(LW - 1, Math.max(0, (u * LW) | 0)), y = Math.min(LH - 1, Math.max(0, (v * LH) | 0));
      return lum[y * LW + x];
    }

    function build() {
      var r = cv.getBoundingClientRect(); if (!r.width || !r.height) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2); W = r.width; H = r.height; s = W / o.ref;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      photo.width = cv.width; photo.height = cv.height;
      computeCrop(); sample();
      var cell = Math.max(4, o.cell * s), cw = cell * 0.62;
      cols = Math.floor(W / cw); rows = Math.floor(H / cell); cells = [];
      for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
        var l = Math.min(1, Math.pow(L((x + 0.5) / cols, (y + 0.5) / rows), 0.6));
        cells.push({ bx: x * cw, by: y * cell, l: l, ox: 0, oy: 0, vx: 0, vy: 0, glitch: 0 });
      }
      drops = []; for (var c = 0; c < cols; c++) drops.push({ y: Math.random() * rows, s: 0.15 + Math.random() * 0.35 });
      g.font = "500 " + cell + "px JetBrains Mono, ui-monospace, monospace"; g.textBaseline = "top";
    }

    function render(dt, t) {
      g.clearRect(0, 0, W, H);
      pointer.sx += (pointer.x - pointer.sx) * 0.25; pointer.sy += (pointer.y - pointer.sy) * 0.25;
      tilt.x += (tilt.tx - tilt.x) * 0.06; tilt.y += (tilt.ty - tilt.y) * 0.06;
      var idleX = reduce ? 0 : Math.sin(t * 0.0005) * 0.25, idleY = reduce ? 0 : Math.cos(t * 0.0004) * 0.15;
      var depth = o.depth * s, R = o.radius * s, R2 = R * R, px = pointer.sx, py = pointer.sy;
      var tx = (tilt.x + (pointer.inside ? 0 : idleX)) * depth, ty = (tilt.y + (pointer.inside ? 0 : idleY)) * depth;

      if (pointer.inside) {
        pg.setTransform(1, 0, 0, 1, 0, 0); pg.globalCompositeOperation = "source-over";
        pg.clearRect(0, 0, photo.width, photo.height);
        pg.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, photo.width, photo.height);
        pg.globalCompositeOperation = "destination-in";
        var grd = pg.createRadialGradient(px * dpr, py * dpr, R * 0.15 * dpr, px * dpr, py * dpr, R * dpr);
        grd.addColorStop(0, "rgba(0,0,0,1)"); grd.addColorStop(0.7, "rgba(0,0,0,0.85)"); grd.addColorStop(1, "rgba(0,0,0,0)");
        pg.fillStyle = grd; pg.fillRect(0, 0, photo.width, photo.height);
        pg.globalCompositeOperation = "source-over";
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(photo, 0, 0); g.restore();
      }

      var rain = o.rain && !reduce;
      if (rain) for (var c = 0; c < drops.length; c++) {
        drops[c].y += drops[c].s * dt * 0.06;
        if (drops[c].y > rows + 12) { drops[c].y = -Math.random() * 20; drops[c].s = 0.15 + Math.random() * 0.35; }
      }

      for (var i = 0; i < cells.length; i++) {
        var cl = cells[i], col = i % cols, row = (i / cols) | 0;
        var d = cl.l - 0.35; // depth from luminance: bright parts come forward
        var x = cl.bx + tx * d, y = cl.by + ty * d;
        var dx = x - px, dy = y - py, dd = dx * dx + dy * dy, fx = 0, fy = 0;
        if (dd < R2) { var dist = Math.sqrt(dd) || 1, f = 1 - dist / R, push = f * f * R * 0.9; fx = dx / dist * push; fy = dy / dist * push; }
        cl.vx = (cl.vx + (fx - cl.ox) * 0.09) * 0.78; cl.vy = (cl.vy + (fy - cl.oy) * 0.09) * 0.78;
        cl.ox += cl.vx; cl.oy += cl.vy;

        var rainB = 0;
        if (rain) { var dr = drops[col].y - row; if (dr >= 0 && dr < 10) rainB = (1 - dr / 10) * 0.55; }
        var a = cl.l * 0.95 + rainB * 0.35;
        if (a < 0.05) continue;
        var ch;
        if (cl.glitch > 0) { cl.glitch--; ch = KANA[(Math.random() * KANA.length) | 0]; }
        else { ch = RAMP[Math.min(RAMP.length - 1, (cl.l * RAMP.length) | 0)]; if (!reduce && Math.random() < 0.0009) cl.glitch = 6; }
        if (ch === " ") ch = rainB > 0.1 ? KANA[(i * 7 + row) % KANA.length] : " ";
        if (ch === " ") continue;
        var moved = Math.min(1, Math.hypot(cl.ox, cl.oy) / (30 * s));
        g.globalAlpha = Math.min(1, a) * (1 - moved * 0.55);
        g.fillStyle = rainB > 0.45 ? o.head : (cl.l > 0.7 ? o.bright : o.color);
        g.fillText(ch, x + cl.ox, y + cl.oy);
      }
      g.globalAlpha = 1;

      if (t < gl.until && t >= gl.start) drawGlitch(t);
      if (pointer.inside) {
        g.strokeStyle = "rgba(61,255,143,0.55)"; g.lineWidth = 1; g.setLineDash([3, 5]);
        g.beginPath(); g.arc(px, py, R, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      }
    }

    function loop(now) {
      if (!alive) return;
      var dt = Math.min(50, now - (last || now)); last = now;
      if (o.glitch && !reduce && lum) {
        if (!gl.next) gl.next = now + rnd(2500, 4000); // first one comes a little sooner
        if (now >= gl.next) {
          gl.start = now; gl.until = now + o.glitchMs; gl.next = gl.until + rnd(o.glitchMin, o.glitchMax);
          cells.forEach(function (c) { if (Math.random() < 0.25) c.glitch = 10; }); // kana storm
        }
      }
      if (lum && visible) render(dt, now);
      raf = requestAnimationFrame(loop);
    }

    function setPointer(e) {
      var r = cv.getBoundingClientRect();
      pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top;
      if (pointer.sx < -9000) { pointer.sx = pointer.x; pointer.sy = pointer.y; }
      tilt.tx = (pointer.x / r.width - 0.5) * 2; tilt.ty = (pointer.y / r.height - 0.5) * 2;
    }
    function leave() { pointer.inside = false; pointer.x = pointer.y = pointer.sx = pointer.sy = -9999; tilt.tx = tilt.ty = 0; }
    function onMove(e) { pointer.inside = true; setPointer(e); }
    function onUp(e) { if (e.pointerType !== "mouse") leave(); }
    if (o.interactive) {
      cv.style.touchAction = "none"; cv.style.cursor = "none";
      cv.addEventListener("pointerenter", onMove); cv.addEventListener("pointermove", onMove);
      cv.addEventListener("pointerdown", onMove); cv.addEventListener("pointerleave", leave); cv.addEventListener("pointerup", onUp);
    }

    var ro = window.ResizeObserver ? new ResizeObserver(function () { if (img.complete && img.naturalWidth) build(); }) : null;
    if (ro) ro.observe(cv); else window.addEventListener("resize", function () { if (img.complete) build(); });
    var io = window.IntersectionObserver ? new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }) : null;
    if (io) io.observe(cv);

    img.onload = function () {
      var start = function () { build(); raf = requestAnimationFrame(loop); };
      if (document.fonts && document.fonts.load) document.fonts.load("500 10px JetBrains Mono").then(start, start); else start();
    };
    img.src = o.src;

    return {
      set: function (patch) { Object.assign(o, patch); if (lum) build(); },
      glitchNow: function () { gl.next = performance.now(); },
      destroy: function () {
        alive = false; cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (io) io.disconnect();
        cv.removeEventListener("pointerenter", onMove); cv.removeEventListener("pointermove", onMove);
        cv.removeEventListener("pointerdown", onMove); cv.removeEventListener("pointerleave", leave); cv.removeEventListener("pointerup", onUp);
      }
    };
  }

  root.AsciiPortrait = { mount: mount, defaults: DEFAULTS };
})(window);
