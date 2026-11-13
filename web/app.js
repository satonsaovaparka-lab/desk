// Desk app (STEP 8). Plan B: static files on GitHub Pages; data under data/*.bin, published ~every 10 min.
// The data is AES-256-GCM encrypted with a key derived (HKDF-SHA256) from DATA_PATH, which arrives once in the
// #d= fragment (never sent to any server), then lives only in localStorage. No SSE, no web push.
// Every FOMO link here is a string from the JSON, built by links.py on the desk. This file builds none.
(function () {
  "use strict";
  const POLL_S = 30;
  const BOT = "https://t.me/Jacob59_bot";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const usd = (n, d = 2) => n == null ? "n/a" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", {minimumFractionDigits: d, maximumFractionDigits: d});
  const kfmt = (n) => n == null ? "n/a" : "$" + (n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n.toFixed(0));
  const px = (p) => p == null ? "n/a" : "$" + (p >= 1 ? p.toFixed(4) : p.toPrecision(4));
  const tm = (iso) => iso ? new Date(typeof iso === "number" ? iso * 1000 : iso).toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok"}) : "";
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const age = (min) => min == null ? "" : min < 60 ? min + "m old" : min < 1440 ? Math.floor(min / 60) + "h old" : Math.floor(min / 1440) + "d old";

  // ---- data path + route
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get("d")) localStorage.setItem("desk_d", hp.get("d"));
  const DP = localStorage.getItem("desk_d");
  const parseRoute = () => { const p = new URLSearchParams(location.hash.slice(1)); return {s: p.get("s") || "home", m: p.get("m"), g: p.get("g")}; };
  let route = parseRoute();
  if (hp.get("d")) history.replaceState(null, "", location.pathname + location.search + (route.s !== "home" ? "#s=" + route.s + (route.m ? "&m=" + route.m : "") : ""));
  const go = (s, m, g) => { location.hash = "s=" + s + (m ? "&m=" + encodeURIComponent(m) : "") + (g ? "&g=" + g : ""); };
  const DATA = "data/";
  const te = new TextEncoder(), td = new TextDecoder();
  let KEYS = null;   // {enc: AES-GCM key, name: HMAC key}, derived once from DP (must match publish.py)
  async function keys() {
    if (KEYS) return KEYS;
    const ikm = await crypto.subtle.importKey("raw", te.encode(DP), "HKDF", false, ["deriveKey"]);
    const p = (info) => ({name: "HKDF", hash: "SHA-256", salt: te.encode("fomo-desk/pages/v1"), info: te.encode(info)});
    KEYS = {
      enc: await crypto.subtle.deriveKey(p("enc"), ikm, {name: "AES-GCM", length: 256}, false, ["decrypt"]),
      name: await crypto.subtle.deriveKey(p("name"), ikm, {name: "HMAC", hash: "SHA-256", length: 256}, false, ["sign"]),
    };
    return KEYS;
  }
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  async function coinFile(m) { const k = await keys(); return "coin/" + hex(await crypto.subtle.sign("HMAC", k.name, te.encode(m))).slice(0, 32); }

  // ---- state (last good numbers stay on screen; cached across reloads)
  const cache = JSON.parse(localStorage.getItem("desk_cache") || "null") || {};
  let S = cache.state || null, CH = cache.chart || null, ACT = cache.activity || null;
  const coins = {}, coinErr = {};
  let lastOk = cache.at || null, offline = false, nextTry = 0, range = "LIVE", actPage = 1, prevLen = 0, searchQ = null, beatAnim = {};

  async function getJSON(label) {   // label: "state" | "chart" | "activity" | "coin/<hmac>"
    const r = await fetch(DATA + label + ".bin?ts=" + Date.now(), {cache: "no-store"});
    if (!r.ok) throw new Error("HTTP " + r.status);
    const blob = new Uint8Array(await r.arrayBuffer()), k = await keys();
    let pt;
    try { pt = await crypto.subtle.decrypt({name: "AES-GCM", iv: blob.slice(0, 12), additionalData: te.encode(label)}, k.enc, blob.slice(12)); }
    catch (e) { throw new Error("wrong data link"); }
    return JSON.parse(td.decode(pt));
  }
  async function load() {
    try {
      if (!DP) throw new Error("no data path");
      const [st, ch, ac] = await Promise.all([getJSON("state"), getJSON("chart"), getJSON("activity")]);
      S = st; CH = ch; ACT = ac; offline = false; lastOk = Date.now();
      try { localStorage.setItem("desk_cache", JSON.stringify({state: S, chart: CH, activity: ACT, at: lastOk})); } catch (e) { /* quota */ }
    } catch (e) { offline = true; }
    if ((route.s === "coin" || route.s === "auditor") && route.m) await loadCoin(route.m);
    nextTry = Date.now() + POLL_S * 1000;
    render();
  }
  async function loadCoin(m) {
    try { coins[m] = await getJSON(await coinFile(m)); coinErr[m] = null; } catch (e) { coinErr[m] = String(e.message || e); }
  }
  function offlineRow() {
    const el = $("#offline");
    if (!offline) { el.hidden = true; return; }
    const n = Math.max(0, Math.ceil((nextTry - Date.now()) / 1000));
    el.hidden = false;
    el.textContent = "Desk offline · retrying in " + n + "s · last update " + (lastOk ? tm(lastOk / 1000) : "never");
  }
  setInterval(offlineRow, 1000);

  // ---- odometer: each changed digit rolls 600ms ease-out, 30ms stagger right to left
  let odoPrev = "";
  function odometer(text) {
    const chars = text.split(""), prev = odoPrev.padStart(chars.length, " ").slice(-chars.length);
    odoPrev = text;
    let di = 0;
    const html = chars.map((ch, i) => {
      if (!/\d/.test(ch)) return `<span>${esc(ch)}</span>`;
      const from = /\d/.test(prev[i]) ? +prev[i] : 0, fromRight = chars.length - 1 - i; di++;
      return `<span class="d"><span class="col" data-to="${ch}" data-from="${from}" data-delay="${fromRight * 30}" style="transform:translateY(-${from * 1.02}em)">${"0123456789".split("").map(n => `<span>${n}</span>`).join("")}</span></span>`;
    }).join("");
    return `<span class="odo" aria-label="${esc(text)}">${html}</span>`;
  }
  function rollOdo() {
    document.querySelectorAll(".odo .col").forEach(c => {
      const to = +c.dataset.to;
      if (reduced()) { c.style.transition = "none"; c.style.transform = `translateY(-${to * 1.02}em)`; return; }
      c.style.transitionDelay = c.dataset.delay + "ms";
      requestAnimationFrame(() => requestAnimationFrame(() => { c.style.transform = `translateY(-${to * 1.02}em)`; }));
    });
  }

  // ---- shared pieces
  const sk = (h, mt = 12) => `<div class="sk" style="height:${h}px;margin-top:${mt}px"></div>`;
  const loadingHome = () => sk(88, 18) + sk(30) + sk(220) + `<div class="section"><h2 class="ter">Agents</h2></div>` + `<div class="sk" style="aspect-ratio:504/470;border-radius:calc(42 * (100vw - 32px) / 504)"></div>` + sk(56, 26) + sk(56, 8);
  const loadingList = () => sk(120, 18) + sk(260) + sk(260);
  const paperPill = () => S && S.mode === "PAPER" ? `<span class="pill paper">PAPER</span>` : "";
  const coinName = (m) => { const c = (S && S.search || []).find(x => x.mint === m); return c ? (c.name || c.symbol || m.slice(0, 6)) : m.slice(0, 6); };
  const actRow = (a) => `<button class="row" data-open="${a.open}" data-m="${esc(a.mint || "")}">
      <div class="main"><div class="t">${esc(a.title)}</div><div class="s">${esc(a.sub)}${a.open === "coin" ? "" : " · " + tm(a.ts)}</div></div>
      <div class="v ${/^\+/.test(a.value) ? "pos" : /^-/.test(a.value) ? "neg" : a.right1 === "Skipped" ? "sec" : ""}">${esc(a.right1 === "Skipped" ? "Skipped" : a.value)}</div></button>`;
  const strips = (layers, runningN) => { let o = ""; for (let i = 1; i <= 8; i++) { const l = (layers || []).find(x => x.n === i);
      o += `<div class="strip ${l ? (l.pass === true ? "ok" : l.pass === false ? "red" : "") : runningN === i ? "run" : ""}"></div>`; } return `<div class="strips">${o}</div>`; };

  // ---- agent cards (content per agent prompt)
  function agentCard(name) {
    const A = S.agents, a = A[name];
    if (name === "scanner") {
      const feed = (a.feed || []).slice(0, 4).map(f => f.verdict === "pass"
        ? `<div class="r"><span>${esc(f.name || f.mint.slice(0, 6))} · liq ${kfmt(f.liquidityUsd)}</span><span class="sec">→ auditor</span></div>`
        : `<div class="r k"><span class="n">${esc(f.name || f.mint.slice(0, 6))}</span><span class="why">${esc(f.reason)}</span></div>`).join("");
      return `<div class="acard"><div class="who"><i style="background:var(--cyan)"></i>Scanner</div><div class="big" style="color:var(--cyan)">${a.count} pools</div>
        <div class="feed">${feed || `<div class="sec" style="padding-top:8px">Listening for graduations</div>`}</div><div class="foot">${a.waiting} in the waiting room</div></div>`;
    }
    if (name === "auditor") {
      const cur = a.running || a.last, runN = a.running ? (a.running.layers || []).length + 1 : 0;
      return `<div class="acard"><div class="who"><i style="background:var(--txt)"></i>Auditor</div><div class="big">${a.count} taken apart</div>
        ${strips(cur ? cur.layers : [], runN)}<div>${a.running ? "taking apart..." : cur ? (cur.passed ? "8/8 → Executor" : esc(cur.reason)) : `<span class="sec">No coin taken apart yet</span>`}</div>
        <div class="foot">${a.rejected} rejected</div></div>`;
    }
    if (name === "analyst") {
      const l = a.last;
      return `<div class="acard"><div class="who"><i style="background:var(--yellow)"></i>Analyst</div><div class="big" style="color:var(--yellow)">Scoring</div>
        <canvas class="ring" data-ring="${l ? l.score : ""}" data-min="${a.minScore}"></canvas>
        <div class="foot">${l ? (l.passed ? "passed → executor" : esc((l.failed || [])[0] || "")) : "no coin yet"} · ${esc(a.mode)} mode</div></div>`;
    }
    if (name === "executor") {
      const l = a.last, prog = a.progress ? Math.min(99, Math.round((Date.now() / 1000 - a.progress.started) / 1.2 * 100)) : (l ? 100 : 0);
      return `<div class="acard"><div class="who"><i style="background:var(--green)"></i>Executor</div><div class="big" style="color:var(--green)">${a.count} trades</div>
        <div style="margin-top:8px">${l ? usd(l.sizeUsd) + " · " + a.stackPct + "% of stack" : `<span class="sec">${usd(0)} · ${a.stackPct}% of stack</span>`}</div>
        <div class="bar"><i style="width:${prog}%"></i></div><div class="foot">${a.progress ? "Executing... " + prog + "%" : l ? "✓ Filled" : "Waiting for a passed coin"}</div></div>`;
    }
    return `<div class="acard"><div class="who"><i style="background:var(--pink)"></i>Risk</div><div class="big" style="color:var(--pink)">${a.guarding ? "Guarding" : "Idle"}</div>
      <div style="margin-top:8px">${esc(a.lastExit === "Trailed out" || a.lastExit === "Stopped" ? a.lastExit : a.lastExit || "No exit yet")}</div>
      <div class="foot"><span class="pill mono red">stop -${a.stopPct}%</span> <span class="pill mono green">trail ${a.trailPct}%</span></div></div>`;
  }

  // ---- screens
  function navHome() {
    const unread = S && S.pushCount > (+localStorage.getItem("desk_seen") || 0);
    return `<div class="navrow"><button class="avatar" data-go="account">${esc(((S && S.account.handle) || "?")[0].toUpperCase())}</button>
      <div class="navtitle">Grok Bot ›</div>
      <button class="navbtn" id="searchBtn" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></button>
      <a class="navbtn" id="bell" href="${BOT}" aria-label="Pushes"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/></svg>${unread ? `<i class="dot"></i>` : ""}</a></div>
      ${searchQ !== null ? `<input class="search" id="q" placeholder="Name, symbol or mint" value="${esc(searchQ)}" autocomplete="off">` : ""}`;
  }
  const navTitle = (t, back) => `<div class="navrow">${back ? `<button class="back" data-back="1">‹ ${esc(back)}</button>` : ""}<div class="navtitle" style="${back ? "text-align:center;margin-right:60px" : "font:700 28px var(--disp)"}">${esc(t)}</div></div>`;

  function home() {
    if (!S) return loadingHome();
    if (searchQ) {
      const q = searchQ.toLowerCase(), res = S.search.filter(c => (c.name || "").toLowerCase().includes(q) || (c.symbol || "").toLowerCase().includes(q) || c.mint.toLowerCase() === q || c.mint.startsWith(searchQ));
      return `<div class="list" style="margin-top:12px">${res.length ? res.slice(0, 30).map(c => `<button class="row" data-open="coin" data-m="${esc(c.mint)}"><div class="main"><div class="t">${esc(c.name || c.mint.slice(0, 8))}</div><div class="s">${esc(c.symbol || "")} · ${esc(c.status)}</div></div><span class="chev">›</span></button>`).join("") : `<div class="empty">No coin tonight matches “${esc(searchQ)}”</div>`}</div>`;
    }
    const pct = S.todayPct, hasTrades = (CH && CH.marks || []).length > 0;
    const running = S.agentOrder.filter(n => S.agents[n].running).length;
    return `<div class="balrow"><div class="h-big">${odometer(usd(S.balance))}</div>${paperPill()}</div>
      <div class="balrow" style="margin-top:6px"><span class="${pct >= 0 ? "pos" : "neg"}" style="font-weight:600">${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</span><span class="sec">today</span><span class="pill mult">${S.multiplier.toFixed(2)}×</span></div>
      <div style="position:relative"><canvas class="chart" id="homeChart"></canvas>${!hasTrades ? `<div class="sec" style="position:absolute;left:0;right:0;top:50%;text-align:center;transform:translateY(-120%)">Waiting for the first trade</div>` : ""}</div>
      <div class="ranges">${["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(r => `<button data-range="${r}" class="${r === range ? "on" : ""}">${r}</button>`).join("")}</div>
      <div class="section"><h2>Agents · ${running} running</h2></div>
      <div class="carousel">${S.agentOrder.map(agentCard).join("")}</div>
      <div class="section"><h2>Activity</h2><button data-go="activity">See all</button></div>
      <div class="list">${ACT && ACT.rows.length ? ACT.rows.slice(0, 5).map(actRow).join("") : `<div class="empty">Nothing yet tonight</div>`}</div>`;
  }

  function agents() {
    if (!S) return loadingList();
    return S.agentOrder.map(n => {
      const a = S.agents[n], locked = n === "risk" && a.locked;
      const dec = (a.decisions || []).map(d => `<div class="dec"><span class="tm">${tm(d.ts)}</span><a href="${esc(d.link)}">${esc(d.name)}</a><span class="${/kill|red|skipped|missed|stop/.test(d.verdict) ? "neg" : "sec"}">${esc(d.verdict)}</span><span class="rs">${esc(d.reason || "")}</span></div>`).join("");
      return `<div class="card"><div style="display:flex;align-items:center;gap:10px"><h3 style="flex:1"><i class="sdot ${a.running ? "" : "off"}"></i>${esc(a.name)}</h3>
          <button class="sw ${a.paused ? "" : "on"} ${locked ? "lock" : ""}" data-pause="${n}" aria-label="pause/resume"></button></div>
        <div class="sec" style="margin-top:4px">${a.count} ${esc(a.countLabel)} today · ${a.paused ? "paused" : a.running ? "running" : "not reporting"}${locked ? " · locked while a position is open" : ""}</div>
        <div style="margin-top:10px">${dec || `<div class="sec" style="padding:8px 0">${n === "scanner" ? "Listening for graduations" : "No decisions yet tonight"}</div>`}</div>
        <button class="back" data-go="account" data-g="${n}">Settings ›</button></div>`;
    }).join("");
  }

  function activity() {
    if (!ACT) return loadingList();
    const rows = ACT.rows.slice(0, actPage * ACT.pageSize);
    return `<div class="list" style="margin-top:12px">${rows.length ? rows.map(actRow).join("") : `<div class="empty">Nothing yet tonight</div>`}</div>
      ${ACT.rows.length > rows.length ? `<button class="btn sec" id="more">Load 30 more</button>` : ""}`;
  }

  function discsSVG(layers, beat) {
    // the coin as a stack of 8 discs (layer 1 on top); the beam sits on layer `beat`
    let o = ""; const W = 220;
    for (let i = 8; i >= 1; i--) {
      const l = (layers || []).find(x => x.n === i), y = 18 + (i - 1) * 20;
      const shown = l && (beat === null || i < beat || (i === beat && beatAnim.done));
      const col = shown ? (l.pass === true ? "#00d35a" : l.pass === false ? "#ff453a" : "#2c2c2e") : "#2c2c2e";
      o += `<ellipse cx="${W / 2}" cy="${y + 8}" rx="88" ry="16" fill="#1c1c1e"/><rect x="${W / 2 - 88}" y="${y}" width="176" height="8" fill="${col}" opacity="${shown ? 0.85 : 1}"/><ellipse cx="${W / 2}" cy="${y}" rx="88" ry="16" fill="${col}" stroke="#000" stroke-width="1"/>
        ${shown && l.pass === true ? `<path d="M${W / 2 - 7} ${y} l5 5 l10 -10" stroke="#000" stroke-width="3" fill="none"/>` : ""}${shown && l.pass === false ? `<path d="M${W / 2 - 6} ${y - 6} l12 12 M${W / 2 + 6} ${y - 6} l-12 12" stroke="#fff" stroke-width="3"/>` : ""}`;
    }
    if (beat !== null && beat >= 1 && beat <= 8) { const y = 18 + (beat - 1) * 20; o += `<rect x="0" y="${y - 3}" width="${W}" height="6" rx="3" fill="#64d2ff" opacity=".9"/>`; }
    return `<svg class="discs" viewBox="0 0 ${W} 200">${o}</svg>`;
  }

  function auditor() {
    if (!S) return loadingList();
    const a = S.agents.auditor, m = route.m;
    let cur = null, link = null, coin = null;
    if (m) { coin = coins[m]; if (coinErr[m]) return `<div class="card" style="margin-top:14px"><div class="neg">Couldn't load this coin</div><div class="sec">${esc(coinErr[m])}. It appears with the next publish.</div></div>`;
      if (!coin) return loadingList(); cur = coin.audit; link = coin.link; }
    else { cur = a.running || a.last; link = cur ? (S.search.find(x => x.mint === cur.mint) || {}).link : null; }
    if (!cur) return `<div class="empty" style="margin-top:40px">No coin taken apart yet</div>`;
    const name = (coin && (coin.name || coin.symbol)) || cur.name || coinName(cur.mint);
    const names = (coin && coin.layerNames) || {1: "Mint authority", 2: "Freeze authority", 3: "Dev wallet", 4: "Top 10 holders", 5: "Liquidity", 6: "Pool age", 7: "Bundled wallets", 8: "Delegations"};
    const key = cur.mint + cur.ts, sent = (cur.layers || []).filter(l => l.pass !== null).length;
    if (!beatAnim[key] && !reduced() && !a.running) startBeam(key, sent);
    const st = beatAnim[key] || {beat: null, done: true};
    const beat = reduced() ? null : st.beat;
    const showN = beat === null ? 9 : beat;
    const rows = [1, 2, 3, 4, 5, 6, 7, 8].map(i => { const l = (cur.layers || []).find(x => x.n === i) || {value: "not checked", pass: null};
      const vis = i < showN || (i === showN && st.done);
      return `<div class="lrow"><span>${i} ${esc(names[i])}</span><span class="v ${vis ? (l.pass === true ? "ok" : l.pass === false ? "red" : "nc") : "nc"}">${vis ? esc(l.value) : "…"}</span></div>`; }).join("");
    const done = beat === null;
    const sig = coin && coin.signal;
    const verdict = !done ? `<div class="sec" style="text-align:center">taking apart...</div>` : cur.passed
      ? `<div style="text-align:center"><div class="pos h-xl">Cleared · 8/8 parts</div><div class="sec">${sig && sig.size_usd ? "Sent to Executor · " + usd(sig.size_usd) : "Sent to Analyst" + (coin && coin.status === "analyst_reject" ? " · rejected there: " + esc(coin.reason) : "")}</div></div>`
      : `<div style="text-align:center"><div class="neg h-xl">Rejected · ${esc(cur.reason)}</div><div class="sec">Grok Bot won't buy ${esc(name)}</div></div>`;
    const en = S.account.auditorEnabled;
    return `<div class="card" style="margin-top:14px"><div style="text-align:center;font:600 20px var(--disp)">${esc(name)}</div>${discsSVG(cur.layers, beat)}${verdict}</div>
      <div class="card">${rows}</div>
      <div class="card"><div class="set"><label><span>Take apart before buying</span><button class="sw ${en ? "on" : ""}" id="auditToggle" aria-label="Take apart before buying"></button></label></div></div>
      ${link ? `<a class="btn" href="${esc(link)}">Open on FOMO</a>` : ""}`;
  }
  function startBeam(key, n) {
    // 350ms per layer top to bottom, then 150ms to green or red; only layers the desk actually sent
    const st = beatAnim[key] = {beat: 1, done: false};
    const step = () => {
      if (st.beat > n) { st.beat = null; st.done = true; render(); return; }
      st.done = false; render();
      setTimeout(() => { st.done = true; render(); setTimeout(() => { st.beat++; step(); }, 0); }, 350 + 150);
    };
    step();
  }

  function coinScreen() {
    const m = route.m;
    if (!m) return `<div class="empty" style="margin-top:40px">Pick a coin from Activity or search</div>`;
    if (coinErr[m] && !coins[m]) return `<div class="card" style="margin-top:14px"><div class="neg">Couldn't load this coin</div><div class="sec">${esc(coinErr[m])}. Its data appears with the next publish (about every 10 minutes).</div></div>`;
    const c = coins[m]; if (!c) return sk(60, 14) + sk(80) + sk(240) + sk(120);
    const p = c.position && c.position.status !== "closed" ? c.position : null, any = c.position;
    const shield = c.audit ? (c.audit.passed ? `<span class="chip">🛡 8/8</span>` : `<span class="chip red">🛡 ${c.audit.layersChecked}/8</span>`) : "";
    const since = any && c.price ? 100 * (c.price / any.entry_price - 1) : null;
    let exit = "";
    if (p) { const left = Math.max(0, p.timeoutAt - Date.now() / 1000), h = Math.floor(left / 3600), mi = Math.floor(left % 3600 / 60);
      exit = `<div class="card"><h3 style="font-size:17px">Exit</h3>
        <div class="lrow"><span>Stop line · -${p.stop_pct}%</span><span>${px(p.stopLine)}</span></div>
        <div class="lrow"><span>Trail line · ${S ? S.agents.risk.trailPct : ""}%</span><span>${p.trailLine ? px(p.trailLine) : "starts at +" + (S ? (S.settings.risk.find(x => x.name === "trail_start_pct") || {}).value : "") + "%"}</span></div>
        <div class="lrow"><span>Time left to timeout</span><span>${h}h ${mi}m</span></div></div>`; }
    setTimeout(() => { const cv = $("#candles"); if (cv) DeskChart.candles(cv, c.candles, p ? p.exitLine : null, any ? any.entry_price : null); }, 0);
    return `<div style="margin-top:14px;display:flex;align-items:center;gap:8px"><div class="h-xl" style="flex:1">${esc(c.name || m.slice(0, 8))}</div>${paperPill()}</div>
      <div class="sec" style="display:flex;align-items:center;gap:8px;margin-top:2px">${esc(c.symbol || "")} · Solana · ${age(c.ageMin)} ${shield}</div>
      <div class="h-xl" style="font-size:48px;margin-top:14px">${px(c.price)}</div>
      ${since != null ? `<div class="${since >= 0 ? "pos" : "neg"}" style="font-weight:600">${since >= 0 ? "▲" : "▼"} ${Math.abs(since).toFixed(2)}% since entry</div>` : ""}
      <canvas class="chart" id="candles" style="height:240px"></canvas>
      <div class="stats"><div><span class="sec">Market cap</span><b>${kfmt(c.stats.marketCap)}</b></div><div><span class="sec">Liquidity</span><b>${kfmt(c.stats.liquidity)}</b></div>
        <div><span class="sec">24h volume</span><b>${kfmt(c.stats.volume24h)}</b></div><div><span class="sec">Holders</span><b>${c.stats.holders == null ? "n/a" : c.stats.holders.toLocaleString("en-US")}</b></div></div>
      ${any ? `<div class="card" style="margin-top:14px"><div class="t" style="font-weight:600">Your position · ${usd(any.size_usd)} in · Executor</div><div class="sec">entry ${px(any.entry_price)} · ${esc(any.status)}${any.exit_reason ? " · " + esc(any.exit_reason) + " " + usd(any.pnl_usd) : ""}</div></div>` : ""}
      ${exit}
      <a class="btn ${p ? "sell" : ""}" href="${esc(c.link)}">${p ? "Sell on FOMO" : "Buy on FOMO"}</a>`;
  }

  function account() {
    if (!S) return loadingList();
    const A = S.account;
    const groups = ["scanner", "auditor", "analyst", "executor", "risk", "desk"];
    const titles = {scanner: "Scanner", auditor: "Auditor", analyst: "Analyst (incl. rules)", executor: "Executor", risk: "Risk", desk: "Desk"};
    const sets = groups.filter(g => S.settings[g]).map(g => `<div class="section" id="set-${g}"><h2>${titles[g]}</h2></div><div class="card">${S.settings[g].map(x => {
        const cmd = "set " + x.name.replace(/_/g, " ") + " to " + x.value;
        if (x.min != null) { const stp = (x.max - x.min) <= 2 ? 0.01 : (x.max - x.min) <= 200 ? 0.5 : 1;
          return `<div class="set" data-cmd="${esc(cmd)}"><label><span>${esc(x.name)}</span><input type="number" value="${x.value}" min="${x.min}" max="${x.max}" step="any" disabled></label>
            <input type="range" min="${x.min}" max="${x.max}" step="${stp}" value="${x.value}" disabled><div class="ter" style="font-size:13px">${x.min} to ${x.max}</div></div>`; }
        return `<div class="set" data-cmd="${esc(cmd)}"><label><span>${esc(x.name)}</span><span class="sec">${esc(String(x.value))}</span></label></div>`;
      }).join("")}</div>`).join("");
    return `<div class="card" style="margin-top:14px">
        <div class="set"><label><span>Mode</span><span class="seg" style="width:170px" id="modeSeg"><span class="${A.mode === "PAPER" ? "on" : ""}">PAPER</span><span class="${A.mode === "LIVE" ? "on" : ""}">LIVE</span></span></label>
          <div class="ter" style="font-size:13px">LIVE: send “live” to the bot, then type LIVE. Needs 1 full PAPER night.</div></div>
        <div class="set"><label><span>Stack</span><input type="number" value="${A.mode === "LIVE" ? A.liveStack : A.stack}" disabled></label><div class="ter" style="font-size:13px">LIVE stack: send “stack 10” to the bot</div></div></div>
      <div class="list">
        <a class="row" href="${esc(A.profileUrl)}"><div class="main"><div class="t">Your FOMO profile</div><div class="s">@${esc(A.handle)}</div></div><span class="chev">›</span></a>
        <button class="row" id="invite" data-url="${esc(A.signupUrl)}"><div class="main"><div class="t">Invite a friend</div><div class="s">Share your FOMO invite link</div></div><span class="chev">›</span></button>
      </div>
      <div class="section"><h2>Telegram</h2></div>
      <div class="list"><div class="row"><div class="main"><div class="t">${esc(A.telegram.bot)}</div><div class="s">Pushes, buttons and commands</div></div><div class="v ${A.telegram.connected ? "pos" : "neg"}">${A.telegram.connected ? "Connected" : "Not connected"}</div></div>
        <button class="row" id="testPush"><div class="main"><div class="t">Send test push</div><div class="s">Copies “test”, opens the bot</div></div><span class="chev">›</span></button></div>
      <div class="ter" style="font-size:13px;margin:10px 4px">${esc(A.hosting)}. Settings are read-only here: tap one to copy its Telegram command.</div>
      ${sets}`;
  }

  // ---- render
  function render() {
    const s = route.s;
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.s === s || (s === "auditor" && b.dataset.s === "activity") || (s === "coin" && b.dataset.s === "home")));
    $("#nav").innerHTML = s === "home" ? navHome() : s === "coin" ? navTitle(coins[route.m] ? (coins[route.m].symbol || "Coin") : "Coin", "Back") : s === "auditor" ? navTitle("Auditor", "Back") : navTitle(s === "agents" ? "Agents" : s === "activity" ? "Activity" : "Account");
    offlineRow();
    const v = $("#view");
    v.innerHTML = s === "agents" ? agents() : s === "activity" ? activity() : s === "auditor" ? auditor() : s === "coin" ? coinScreen() : s === "account" ? account() : home();
    if (s === "home" && S) { rollOdo(); const cv = $("#homeChart"); if (cv && CH) { const pts = CH.ranges[range] || []; DeskChart.line(cv, pts.length ? pts : [], CH.start, CH.marks, prevLen); prevLen = pts.length; } }
    document.querySelectorAll("canvas[data-ring]").forEach(cv => DeskChart.ring(cv, cv.dataset.ring === "" ? null : +cv.dataset.ring, +cv.dataset.min));
    if (s === "account" && route.g) { const el = $("#set-" + route.g); if (el) el.scrollIntoView(); }
    const q = $("#q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }
  function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { el.hidden = true; }, 1800); }
  async function copy(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (e2) { /* */ } ta.remove(); return ok; } }

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-go],[data-open],[data-back],[data-range],[data-pause],#more,#invite,#testPush,#auditToggle,#searchBtn,#bell,.set[data-cmd],#modeSeg,#tabs button");
    if (!t) return;
    if (t.matches("#tabs button")) { searchQ = null; return go(t.dataset.s); }
    if (t.dataset.back) return history.length > 1 ? history.back() : go("home");
    if (t.dataset.go) return go(t.dataset.go, null, t.dataset.g);
    if (t.dataset.open) { const m = t.dataset.m; if (!m) return; searchQ = null; if (!coins[m]) loadCoin(m).then(render); return go(t.dataset.open, m); }
    if (t.dataset.range) { range = t.dataset.range; prevLen = 0; return render(); }
    if (t.id === "more") { actPage++; return render(); }
    if (t.id === "searchBtn") { searchQ = searchQ === null ? "" : null; return render(); }
    if (t.id === "bell") { localStorage.setItem("desk_seen", S ? S.pushCount : 0); return; }
    if (t.id === "invite") {
      const url = t.dataset.url;
      if (navigator.share) { try { await navigator.share({title: "FOMO", text: "Trade on FOMO with me", url}); return; } catch (err) { if (err && err.name === "AbortError") return; } }
      if (await copy(url)) toast("Link copied"); return;
    }
    if (t.id === "testPush") { await copy("test"); toast("“test” copied, paste it to the bot"); location.href = BOT; return; }
    if (t.dataset.pause) {
      const n = t.dataset.pause, a = S.agents[n];
      if (n === "risk" && a.locked) return toast("Risk can't be paused while a position is open");
      const cmd = (a.paused ? "resume " : "pause ") + n; await copy(cmd); return toast("“" + cmd + "” copied, send it to the bot");
    }
    if (t.id === "auditToggle") {
      if (S.account.auditorEnabled) {
        if (!confirm("Turn off taking coins apart before buying?")) return;
        if (!confirm("Are you sure? Coins would skip all 8 safety layers.")) return;
        await copy("set auditor enabled to false"); return toast("Command copied, send it to the bot");
      }
      await copy("set auditor enabled to true"); return toast("Command copied, send it to the bot");
    }
    if (t.id === "modeSeg") { await copy(S.account.mode === "PAPER" ? "live" : "paper"); return toast("Command copied, send it to the bot"); }
    if (t.dataset.cmd) { await copy(t.dataset.cmd); return toast("“" + t.dataset.cmd + "” copied"); }
  });
  document.addEventListener("input", (e) => { if (e.target.id === "q") { searchQ = e.target.value; const pos = e.target.selectionStart; render(); const q = $("#q"); if (q) q.setSelectionRange(pos, pos); } });
  window.addEventListener("hashchange", async () => { route = parseRoute(); actPage = 1; if ((route.s === "coin" || route.s === "auditor") && route.m && !coins[route.m]) { render(); await loadCoin(route.m); } render(); });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  render(); load(); setInterval(load, POLL_S * 1000);
})();
