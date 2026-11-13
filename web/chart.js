// chart.js - hand-drawn <canvas> charts (no chart library). devicePixelRatio aware.
(function () {
  const C = {green: "#00d35a", red: "#ff453a", orange: "#ff9f0a", blue: "#0a84ff", sec: "rgba(235,235,245,0.6)", ter: "rgba(235,235,245,0.3)", sep: "rgba(84,84,88,0.55)", card2: "#2c2c2e"};
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function setup(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    return {g, w, h};
  }
  function tween(ms, fn) { if (reduced()) { fn(1); return; } const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); fn(k); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }

  // Home balance line: green line, gradient fill, dashed start line, marks above the line (later marks move up a row)
  function line(cv, pts, start, marks, prevLen) {
    const draw = (k, ma) => {
      const {g, w, h} = setup(cv);
      const top = 46, bot = h - 8;
      const vals = pts.map(p => p[1]).concat([start]);
      let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
      const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
      const t0 = pts.length ? pts[0][0] : 0, t1 = pts.length ? pts[pts.length - 1][0] : 1;
      const X = (t) => pts.length < 2 ? w / 2 : 4 + (w - 8) * (t - t0) / ((t1 - t0) || 1);
      const Y = (v) => bot - (bot - top) * (v - lo) / (hi - lo);
      g.setLineDash([4, 5]); g.strokeStyle = C.ter; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(start)); g.lineTo(w, Y(start)); g.stroke(); g.setLineDash([]);
      if (pts.length < 2) return;
      // slide the newest point in
      const n = pts.length; let P = pts.map(p => [X(p[0]), Y(p[1])]);
      if (k < 1 && prevLen && n > prevLen) { const a = P[n - 2], b = P[n - 1]; P[n - 1] = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; }
      const grd = g.createLinearGradient(0, top, 0, bot); grd.addColorStop(0, "rgba(0,211,90,0.28)"); grd.addColorStop(1, "rgba(0,211,90,0)");
      g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.lineTo(P[n - 1][0], bot); g.lineTo(P[0][0], bot); g.closePath(); g.fillStyle = grd; g.fill();
      g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.strokeStyle = C.green; g.lineWidth = 2.2; g.lineJoin = "round"; g.stroke();
      // marks
      g.font = "600 12px -apple-system, system-ui, sans-serif"; g.globalAlpha = ma;
      const rows = []; // per row: last right edge
      (marks || []).filter(m => m.ts >= t0 && m.ts <= t1 + 60).forEach(m => {
        const x = X(m.ts), tw = g.measureText(m.text).width + 12; let x0 = Math.max(2, Math.min(w - tw - 2, x - tw / 2));
        let r = 0; while (rows[r] !== undefined && rows[r] > x0 - 4) r++; rows[r] = x0 + tw;
        const y = 4 + (rows.length > 3 ? 0 : 0) + r * 22; if (y > top - 6 + 22 * 2) return;
        const col = m.color === "blue" ? C.blue : m.color === "green" ? C.green : C.red;
        g.fillStyle = col; roundRect(g, x0, y, tw, 18, 9); g.fill();
        g.fillStyle = m.color === "blue" || m.color === "red" ? "#fff" : "#000"; g.fillText(m.text, x0 + 6, y + 13);
        g.strokeStyle = col; g.globalAlpha = ma * 0.5; g.beginPath(); g.moveTo(x, y + 18); g.lineTo(x, top); g.stroke(); g.globalAlpha = ma;
      });
      g.globalAlpha = 1;
    };
    if (prevLen && pts.length > prevLen) tween(250, (k) => draw(k, 1)); else tween(200, (k) => draw(1, k));
  }

  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  // Coin screen: 1-minute candles + volume, orange dashed "Risk trailing stop" at the current exit line
  function candles(cv, cs, exitLine, entry) {
    const {g, w, h} = setup(cv);
    if (!cs || cs.length < 1) { g.fillStyle = C.sec; g.font = "15px -apple-system, system-ui"; g.textAlign = "center"; g.fillText("No prices yet", w / 2, h / 2); return; }
    const vh = 36, top = 8, bot = h - vh - 10;
    let lo = Math.min(...cs.map(c => c.l)), hi = Math.max(...cs.map(c => c.h));
    if (exitLine) { lo = Math.min(lo, exitLine); hi = Math.max(hi, exitLine); }
    if (entry) { lo = Math.min(lo, entry); hi = Math.max(hi, entry); }
    if (hi - lo < hi * 1e-6) { hi *= 1.01; lo *= 0.99; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const n = Math.max(cs.length, 30), cw = (w - 8) / n, Y = (v) => bot - (bot - top) * (v - lo) / (hi - lo);
    const vmax = Math.max(...cs.map(c => c.v), 1e-9);
    cs.forEach((c, i) => {
      const x = 4 + (n - cs.length + i) * cw + cw / 2, up = c.c >= c.o, col = up ? C.green : C.red;
      g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(x, Y(c.h)); g.lineTo(x, Y(c.l)); g.stroke();
      const bw = Math.max(1.5, cw * 0.62), y0 = Y(Math.max(c.o, c.c)), y1 = Y(Math.min(c.o, c.c));
      g.fillStyle = col; g.fillRect(x - bw / 2, y0, bw, Math.max(1, y1 - y0));
      const vhh = vh * c.v / vmax; g.globalAlpha = 0.45; g.fillRect(x - bw / 2, h - vhh, bw, vhh); g.globalAlpha = 1;
    });
    if (exitLine) {
      g.setLineDash([7, 5]); g.strokeStyle = C.orange; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, Y(exitLine)); g.lineTo(w, Y(exitLine)); g.stroke(); g.setLineDash([]);
      g.fillStyle = C.orange; g.font = "600 12px -apple-system, system-ui"; g.fillText("Risk trailing stop", 6, Y(exitLine) - 6);
    }
  }

  // Analyst score ring 0-100, green from min
  function ring(cv, score, min) {
    const {g, w, h} = setup(cv), r = Math.min(w, h) / 2 - 9, cx = w / 2, cy = h / 2;
    g.lineWidth = 12; g.lineCap = "round"; g.strokeStyle = C.card2; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    if (score != null) { g.strokeStyle = score >= min ? C.green : "#ffd60a"; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, score / 100)); g.stroke(); }
    g.fillStyle = "#fff"; g.font = "700 38px -apple-system, 'SF Pro Display', system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(score == null ? "–" : String(score), cx, cy + 1);
  }
  window.DeskChart = {line, candles, ring};
})();
