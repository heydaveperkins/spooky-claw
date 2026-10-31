/* Spooky Claw: game logic.
 *
 * Rive draws everything and runs the animation state machines. This file
 * owns the rules: input, the claw cycle, grab odds, the prize heap, the timer
 * and the score. It talks to Rive only through the "Game" view model
 * (see README.md for every property).
 *
 * All positions are in artboard units (the artboard is 1950 x 900).
 */
(function () {
  "use strict";

  // ------------------------------------------------------------ constants
  const ART_W = 1950;
  const ART_H = 900;
  const ROUND_SECONDS = 60;
  const COUNTDOWN_SECONDS = 3;
  const BEST_KEY = "spookyClaw.bestScore";

  // Claw geometry, matching scene.rml. Lengths in the claw's own space are
  // multiplied by CLAW_SCALE (the "Claw Front" / "Claw Back" nodes).
  const RAIL_Y = 262;        // trolley sits on the rail here
  const CLAW_SCALE = 1.3;
  const PRONG_PIVOT = { x: 26, y: 42 };  // side prong pivots, either side of the hub
  const PRONG_TIP = { x: 8, y: 89 };     // rubber tip centre in the prong's space
  const TIP_RADIUS = 8.5;
  const HELD_TOP = 68;       // a held prize's top sits here, just under the hub
  const OPEN_TIP_DROP = 150; // hub top to the tips with the claw wide open
  const PRONG_RELAXED = 0.12, PRONG_OPEN = 0.85, PRONG_SHUT = -0.2; // radians
  const GRIP_INSET = 4;      // how far the rubber tips press into the plush
  const FLOOR_Y = 800;       // bottom of the pile
  const CLAW_MIN_X = 470;
  const CLAW_MAX_X = 1495;
  const HOME_X = 525;        // where the claw parks, just right of the chute
  const CHUTE_X = 470;
  const CHUTE_MOUTH_Y = 740; // a prize whose centre passes this is in the chute
  const REST_L = 14;         // cable length at rest: high enough to carry over the heap
  const MAX_L = 420;

  // Feel. A cycle is roughly 7 s, so a decent player lands 7-10 a minute.
  const MOVE_MAX = 560;
  const MOVE_ACCEL = 2600;
  const MOVE_DECEL = 9000;
  const DESCEND_SPEED = 620;
  const LIFT_SPEED = 420;
  const CARRY_SPEED = 580;
  const CLOSE_TIME = 0.55;
  const RELEASE_TIME = 0.45;
  const GRAVITY = 2600;

  // Grab odds by alignment (0 = dead centre, 1 = the prize's edge)
  const CENTER_ZONE = 0.42;
  const EDGE_ZONE = 0.75;
  const CENTER_GRAB = 0.9, CENTER_SLIP = 0.13;
  const EDGE_GRAB = 0.5, EDGE_SLIP = 0.5;
  const SLIP_SAFE_X = 640;   // past here, on the way to the chute, a prize no longer slips

  const GOLD_CHANCE = 1 / 15;
  const KINDS = ["ghost", "blackCat", "pumpkin", "bat", "skeleton", "mummy",
    "spider", "candyCorn", "fullMoon", "wrappedCandy"];
  const GOLD = "goldenPumpkin";

  // The heap, matching tools/gen_prize.py. Slots 0-2 top, 3-6 middle,
  // 7-11 bottom. `on` lists the slots resting on each one.
  const SLOTS = [
    { x: 905, y: 571, s: 1.28, r: -0.06, on: [] },
    { x: 1090, y: 575, s: 1.28, r: 0.05, on: [] },
    { x: 1275, y: 569, s: 1.28, r: 0.08, on: [] },
    { x: 812, y: 653, s: 1.36, r: 0.07, on: [0] },
    { x: 997, y: 649, s: 1.36, r: -0.05, on: [0, 1] },
    { x: 1182, y: 655, s: 1.36, r: 0.04, on: [1, 2] },
    { x: 1367, y: 651, s: 1.36, r: -0.08, on: [2] },
    { x: 720, y: 733, s: 1.45, r: -0.04, on: [3] },
    { x: 905, y: 731, s: 1.45, r: 0.05, on: [3, 4] },
    { x: 1090, y: 734, s: 1.45, r: -0.03, on: [4, 5] },
    { x: 1275, y: 732, s: 1.45, r: 0.06, on: [5, 6] },
    { x: 1460, y: 733, s: 1.45, r: -0.05, on: [6] },
  ];
  const HIDDEN_Y = 2000;

  // Each design's outline as [height, half-width] pairs in the plush's own
  // units: 0 is its bottom, negative is up, matching tools/gen_prize.py. The
  // first pair is the top, where the claw's hub comes to rest.
  const GUMDROP = [[-94, 0], [-86, 27], [-76, 39], [-66, 46], [-56, 50], [-46, 52], [-28, 52], [-14, 50], [-6, 44], [0, 34], [2, 0]];
  const PUMPKIN = [[-93, 0], [-88, 28], [-80, 45], [-70, 56], [-58, 62], [-46, 65], [-32, 62], [-20, 56], [-10, 44], [-2, 24], [0, 0]];
  const PROFILES = {
    ghost: [[-94, 0], [-86, 30], [-74, 42], [-62, 48], [-50, 50], [-14, 50], [-6, 46], [-1, 30], [0, 0]],
    blackCat: GUMDROP, skeleton: GUMDROP, mummy: GUMDROP,
    pumpkin: PUMPKIN, goldenPumpkin: PUMPKIN,
    bat: [[-91, 0], [-85, 24], [-76, 35], [-64, 43], [-46, 48], [-28, 43], [-16, 35], [-7, 24], [-1, 0]],
    spider: [[-92, 0], [-84, 26], [-74, 37], [-62, 45], [-46, 50], [-30, 45], [-18, 37], [-8, 26], [0, 0]],
    fullMoon: [[-102, 0], [-94, 26], [-84, 37], [-72, 46], [-50, 52], [-28, 46], [-16, 37], [-6, 26], [2, 0]],
    candyCorn: [[-104, 0], [-100, 6], [-80, 18], [-60, 29], [-40, 40], [-20, 50], [-8, 52], [-2, 30], [0, 0]],
    wrappedCandy: [[-81, 0], [-76, 22], [-68, 36], [-56, 46], [-42, 48], [-28, 46], [-16, 36], [-8, 22], [-3, 0]],
  };
  const BODY_PIVOT = 46; // the plush's bottom sits this far below its centre

  function outlineAt(kind, yb) {
    const pts = PROFILES[kind] || GUMDROP;
    if (yb <= pts[0][0] || yb >= pts[pts.length - 1][0]) return 0;
    for (let i = 1; i < pts.length; i++) {
      if (yb <= pts[i][0]) {
        const [y0, w0] = pts[i - 1];
        const [y1, w1] = pts[i];
        return w0 + (w1 - w0) * ((yb - y0) / (y1 - y0));
      }
    }
    return 0;
  }
  const maxHalfWidth = (kind) => Math.max(...(PROFILES[kind] || GUMDROP).map((p) => p[1]));
  const topY = (kind) => (PROFILES[kind] || GUMDROP)[0][0];
  // A slot's prize: its top edge, and its widest half-width, in artboard units
  const prizeTop = (p) => p.y + (BODY_PIVOT + topY(p.kind)) * p.def.s;
  const prizeHalfWidth = (p) => maxHalfWidth(p.kind) * p.def.s;

  // Tappable areas in artboard units (the art is in scene.rml)
  const BUTTONS = {
    left: { x0: 15, x1: 175, y0: 540, y1: 770 },     // left wing, arrows
    right: { x0: 175, x1: 340, y0: 540, y1: 770 },
    drop: { cx: 1775, cy: 650, r: 150 },              // right wing
    start: { x0: 720, x1: 1030, y0: 545, y1: 685 },   // title card START
    sound: { x0: 1045, x1: 1265, y0: 545, y1: 685 },  // title card SOUND ON/OFF
    again: { x0: 720, x1: 1030, y0: 545, y1: 685 },   // results card PLAY AGAIN
    leave: { x0: 1045, x1: 1265, y0: 545, y1: 685 },  // results card LEAVE
    music: { cx: 112, cy: 470, r: 62 },               // left wing: music on/off
    exit: { cx: 238, cy: 470, r: 62 },                // left wing: leave the game
  };

  // The build stamp on this script's URL (game.js?v=...), reused for the .riv
  // so an update is fetched fresh rather than from the browser's cache
  const BUILD = (document.currentScript && new URL(document.currentScript.src).searchParams.get("v")) || "";

  // ------------------------------------------------------------ analytics
  // Visit and play counts through GoatCounter: no cookies, no personal data,
  // no consent banner. Set your site code (the part before .goatcounter.com)
  // to switch it on; left empty, nothing is loaded or sent. It is also off
  // with ?debug or ?tip in the address, and GoatCounter ignores localhost.
  const GOATCOUNTER_CODE = "clawgame";
  const analyticsOn = !!GOATCOUNTER_CODE && !/[?&](debug|tip)\b/.test(window.location.search);
  const pendingEvents = [];

  // Events show in the dashboard by name (a few go in as "play-start" etc.)
  function track(name, title) {
    if (!analyticsOn) return;
    const gc = window.goatcounter;
    if (gc && typeof gc.count === "function") gc.count({ path: name, title: title || name, event: true });
    else pendingEvents.push([name, title]); // the script is still loading
  }

  function loadAnalytics() {
    if (!analyticsOn) return;
    const tag = document.createElement("script");
    tag.async = true;
    tag.src = "https://gc.zgo.at/count.js";
    tag.dataset.goatcounter = "https://" + GOATCOUNTER_CODE + ".goatcounter.com/count";
    // Count plays inside an iframe too, such as the Webflow embed
    tag.dataset.goatcounterSettings = JSON.stringify({ allow_frame: true });
    tag.onload = () => pendingEvents.splice(0).forEach(([name, title]) => track(name, title));
    document.head.appendChild(tag);
  }

  // ------------------------------------------------------------ DOM
  const canvas = document.getElementById("game");
  const loader = document.getElementById("loader");
  const loaderBar = document.getElementById("loaderBar");
  const loaderFill = document.getElementById("loaderFill");
  const loaderStatus = document.getElementById("loaderStatus");
  const loaderPercent = document.getElementById("loaderPercent");
  const loaderProgress = document.getElementById("loaderProgress");
  const enterButton = document.getElementById("enterButton");
  const portraitQuery = window.matchMedia("(orientation: portrait) and (pointer: coarse)");

  // ------------------------------------------------------------ Rive
  const riveLib = window.rive;
  riveLib.RuntimeLoader.setWasmUrl("vendor/rive-webgl2-2.44.2/rive.wasm");
  riveLib.RuntimeLoader.setWasmFallbackUrl("vendor/rive-webgl2-2.44.2/rive_fallback.wasm");

  let r = null;
  let vm = null;
  const handles = new Map();
  const sent = new Map();

  function handle(type, path) {
    const key = type + ":" + path;
    if (!handles.has(key)) {
      const h = vm ? vm[type](path) : null;
      if (!h) console.warn("Spooky Claw: no view model property", path);
      handles.set(key, h);
    }
    return handles.get(key);
  }

  // Write a view model value only when it changes
  function set(type, path, value) {
    if (sent.get(path) === value) return;
    const h = handle(type, path);
    if (!h) return;
    h.value = value;
    sent.set(path, value);
  }
  const setNum = (path, v) => set("number", path, Math.round(v * 100) / 100);
  const setBool = (path, v) => set("boolean", path, v);
  const setEnum = (path, v) => set("enum", path, v);
  function fire(path) {
    const h = handle("trigger", path);
    if (h) h.trigger();
  }

  // Rive starts from the bytes boot() already downloaded (or the URL, if
  // that download failed)
  function startRive(rivBuffer) {
    r = new riveLib.Rive({
    ...(rivBuffer ? { buffer: rivBuffer } : { src: BUILD ? "game.riv?v=" + BUILD : "game.riv" }),
    canvas,
    stateMachine: "Cabinet",
    autoplay: true,
    autoBind: true,
    shouldDisableRiveListeners: true, // input is handled below
    layout: new riveLib.Layout({ fit: riveLib.Fit.Contain, alignment: riveLib.Alignment.Center }),
    onLoad: () => {
      vm = r.viewModelInstance;
      resize();
      resetHeap();
      enterAttract();
      requestAnimationFrame(frame);
      riveReady = true;
      showEnter();
    },
    onLoadError: (e) => {
      loaderStatus.textContent = "Couldn't load the game. Please reload.";
      loaderPercent.textContent = "";
      console.error(e);
    },
    });
  }

  // How the 1950 x 900 artboard fits the window: whole, always. The
  // controls and readouts live in the wings at the far left and right, so
  // nothing can be cropped; spare space shows the page's cabinet colour.
  function viewBounds() {
    return { minX: 0, maxX: ART_W, minY: 0, maxY: ART_H };
  }

  // The same fit as screen numbers: artboard -> CSS pixels
  function viewTransform(rect) {
    const b = viewBounds();
    const scale = Math.min(rect.width / (b.maxX - b.minX), rect.height / ART_H);
    return {
      scale,
      ox: rect.left + (rect.width - (b.maxX - b.minX) * scale) / 2 - b.minX * scale,
      oy: rect.top + (rect.height - ART_H * scale) / 2,
    };
  }

  // Size the stage to what is actually visible: the smaller of the visual
  // viewport and the small viewport height (100svh), sitting at the bottom of
  // the visual viewport, so a toolbar floating over the top hides nothing.
  const stage = document.getElementById("stage");
  const svhProbe = document.createElement("div");
  svhProbe.style.cssText = "position:fixed;left:0;top:0;width:0;height:100vh;height:100svh;visibility:hidden;pointer-events:none";
  document.body.appendChild(svhProbe);
  let debugReadout = null;

  function fitStage() {
    // If the page has been zoomed, the visual viewport is the zoomed-in
    // window, not the screen: size to the page instead
    const vv = window.visualViewport && Math.abs(window.visualViewport.scale - 1) < 0.01 ? window.visualViewport : null;
    const vvH = vv ? vv.height : window.innerHeight;
    const vvTop = vv ? vv.offsetTop : 0;
    const svh = svhProbe.getBoundingClientRect().height || window.innerHeight;
    const h = Math.min(vvH, svh, window.innerHeight);
    stage.style.top = Math.round(vvTop + vvH - h) + "px";
    stage.style.height = Math.round(h) + "px";
    stage.style.bottom = "auto";
    if (debugReadout) {
      const sr = stage.getBoundingClientRect();
      debugReadout.textContent =
        `inner ${window.innerWidth}x${window.innerHeight}  dpr ${window.devicePixelRatio}\n` +
        `visual ${window.visualViewport ? Math.round(window.visualViewport.width) + "x" + Math.round(window.visualViewport.height) +
          " @" + Math.round(window.visualViewport.offsetTop) + " zoom " + window.visualViewport.scale.toFixed(2) : "n/a"}\n` +
        `svh ${Math.round(svh)}  stage ${Math.round(sr.width)}x${Math.round(sr.height)} @${Math.round(sr.top)}`;
    }
  }

  let lastBounds = "";
  function resize() {
    fitStage();
    if (!r) return;
    r.resizeDrawingSurfaceToCanvas(Math.min(window.devicePixelRatio || 1, 2));
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const b = viewBounds();
    const key = [b.minX, b.maxX].map(Math.round).join(",");
    if (key === lastBounds) return;
    lastBounds = key;
    r.layout = new riveLib.Layout({ fit: riveLib.Fit.Contain, alignment: riveLib.Alignment.Center, ...b });
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  // Safari's toolbars sliding in and out resize the page without always
  // firing a window resize, so watch the canvas itself too
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  // Safari ignores maximum-scale, so stop pinch-zoom here; a zoomed page
  // crops the game
  document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("touchmove", (e) => {
    if (e.scale !== undefined && e.scale !== 1) e.preventDefault();
  }, { passive: false });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resize);
    window.visualViewport.addEventListener("scroll", resize);
  }
  if (/[?&]debug\b/.test(window.location.search)) {
    debugReadout = document.createElement("div");
    debugReadout.className = "viewport-debug";
    document.body.appendChild(debugReadout);
  }
  fitStage();

  // ------------------------------------------------------------ audio
  // Everything is synthesised with Web Audio: no sound files. Browsers only
  // allow sound after a tap or key press, so the context starts on the first
  // one. Two continuous voices (the rail motor and the cable winch) follow the
  // claw; everything else is a one-shot.
  const SOUND_KEY = "spookyClaw.sound";
  const sound = { on: loadSoundSetting(), ctx: null, master: null, noise: null, motor: null, winch: null };

  // Background music: streamed from a media element (a 2-minute track would
  // take ~46 MB decoded), routed through Web Audio so the SOUND button and
  // pausing control it. Volume per game state, relative to the master.
  const MUSIC_SRC = "audio/music.mp3";
  const MUSIC_LEVEL = { attract: 0.22, countdown: 0.4, playing: 0.4, timesUp: 0 };
  const MUSIC_BONUS_LEVEL = 0.65; // the music swells for the bonus dance
  const MUSIC_KEY = "spookyClaw.music";
  const music = { el: null, gain: null, level: -1, on: loadMusicSetting() };

  function loadMusicSetting() {
    try {
      return window.localStorage.getItem(MUSIC_KEY) !== "off";
    } catch (e) {
      return true;
    }
  }

  // The cabinet's music button: music only; sound effects carry on
  function setMusicOn(on) {
    music.on = on;
    try {
      window.localStorage.setItem(MUSIC_KEY, on ? "on" : "off");
    } catch (e) {
      /* blocked storage: the setting lasts this visit only */
    }
    updateMusic();
    if (on) syncMusicPlayback();
    else setTimeout(syncMusicPlayback, 500); // let it fade first
  }

  // The track is fully downloaded during loading (boot), then played from
  // that in-memory copy
  function setMusicSource(url) {
    try {
      music.el = new Audio(url);
      music.el.loop = true;
      music.el.preload = "auto";
    } catch (e) {
      music.el = null;
    }
    attachMusic();
  }

  // Route the music through Web Audio once both it and the context exist
  function attachMusic() {
    if (!music.el || music.gain || !sound.ctx) return;
    try {
      music.gain = sound.ctx.createGain();
      music.gain.gain.value = 0;
      sound.ctx.createMediaElementSource(music.el).connect(music.gain).connect(sound.master);
    } catch (e) {
      music.el = null; // no Web Audio routing here: go without music
    }
    syncMusicPlayback();
  }

  function musicShouldPlay() {
    return !!(music.el && sound.ctx && sound.on && music.on && !paused && game.mode !== "goodbye");
  }

  function syncMusicPlayback() {
    if (!music.el) return;
    if (musicShouldPlay()) {
      if (music.el.paused) music.el.play().catch(() => { /* blocked until a tap */ });
    } else if (!music.el.paused) {
      music.el.pause();
    }
  }

  // Fade the music to the level for the current state: softer on the title,
  // fuller in play, out at time's up so the organ has the stage
  function updateMusic() {
    if (!music.gain) return;
    const level = !music.on ? 0 : game.bonus ? MUSIC_BONUS_LEVEL : MUSIC_LEVEL[game.mode] || 0;
    if (level !== music.level) {
      const quick = game.mode === "timesUp" || !music.on;
      music.gain.gain.setTargetAtTime(level, sound.ctx.currentTime, quick ? 0.2 : 0.6);
      music.level = level;
    }
  }

  function loadSoundSetting() {
    try {
      return window.localStorage.getItem(SOUND_KEY) !== "off";
    } catch (e) {
      return true;
    }
  }

  function setSoundOn(on) {
    sound.on = on;
    try {
      window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch (e) {
      /* blocked storage: the setting lasts this visit only */
    }
    if (sound.master) sound.master.gain.setTargetAtTime(on ? 0.8 : 0, sound.ctx.currentTime, 0.02);
    syncMusicPlayback(); // no point streaming music nobody can hear
  }

  // A looping voice: oscillators through a filter into a gain we can ride
  function loopVoice(ctx, oscs, filterType, freq, q, lfoRate, lfoDepth) {
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const nodes = oscs.map(([type, f, detune]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune || 0;
      o.connect(filter);
      o.start();
      return o;
    });
    // A wobble on the filter gives the grinding, rattling texture
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = lfoRate;
    lfoGain.gain.value = lfoDepth;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    filter.connect(gain).connect(sound.master);
    return { oscs: nodes, gain, base: oscs.map((o) => o[1]), level: 0, pitch: 1 };
  }

  function rideVoice(v, level, pitch) {
    if (!v) return;
    const t = sound.ctx.currentTime;
    if (Math.abs(level - v.level) > 0.002) {
      v.gain.gain.setTargetAtTime(level, t, 0.06);
      v.level = level;
    }
    if (Math.abs(pitch - v.pitch) > 0.01) {
      v.oscs.forEach((o, i) => o.frequency.setTargetAtTime(v.base[i] * pitch, t, 0.08));
      v.pitch = pitch;
    }
  }

  function unlockAudio() {
    if (sound.ctx) {
      if (sound.ctx.state === "suspended" && !paused) sound.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    sound.ctx = ctx;
    sound.master = ctx.createGain();
    sound.master.gain.value = sound.on ? 0.8 : 0;
    sound.master.connect(ctx.destination);
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    sound.noise = buf;
    sound.motor = loopVoice(ctx, [["sawtooth", 48], ["square", 96, 7]], "lowpass", 300, 5, 11, 90);
    sound.winch = loopVoice(ctx, [["triangle", 150], ["square", 75, -5]], "bandpass", 850, 2, 23, 260);
    attachMusic();
    if (ctx.state === "suspended") ctx.resume();
    syncMusicPlayback(); // inside the tap that unlocked audio, as iOS requires
  }

  const audible = () => sound.ctx && sound.on && sound.ctx.state === "running";

  function tone(freq, dur, opts) {
    if (!audible()) return;
    const o = opts || {};
    const ctx = sound.ctx;
    const t = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(freq, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + dur);
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = o.vibrato;
      depth.gain.value = freq * 0.04;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    const attack = o.attack || 0.005;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(o.vol || 0.1, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    if (o.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = o.lowpass;
      gain.connect(f).connect(sound.master);
    } else {
      gain.connect(sound.master);
    }
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(dur, opts) {
    if (!audible()) return;
    const o = opts || {};
    const ctx = sound.ctx;
    const t = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = sound.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter || "bandpass";
    filter.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.sweepTo) filter.frequency.exponentialRampToValueAtTime(o.sweepTo, t + dur);
    filter.Q.value = o.q || 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(o.vol || 0.1, t + (o.attack || 0.004));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(sound.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // A soft bell: a sine with a slightly sour overtone, for a spooky shimmer
  function bell(freq, dur, vol, delay) {
    tone(freq, dur, { vol, delay });
    tone(freq * 2.76, dur * 0.5, { vol: vol * 0.35, delay });
    tone(freq * 0.5, dur * 0.7, { type: "triangle", vol: vol * 0.3, delay });
  }

  let lastLand = 0;
  const sfx = {
    click: () => {
      noise(0.03, { freq: 3200, q: 3, vol: 0.12 });
      tone(1250, 0.04, { type: "triangle", vol: 0.05 });
    },
    start: () => {
      sfx.click();
      bell(784, 0.6, 0.08, 0.05);
    },
    tick: () => {
      tone(1050, 0.07, { type: "triangle", vol: 0.12 });
      noise(0.02, { freq: 2600, q: 4, vol: 0.06 });
    },
    go: () => {
      bell(659, 0.7, 0.09);
      bell(988, 0.7, 0.07, 0.04);
    },
    clock: () => {
      tone(1700, 0.025, { vol: 0.06 });
      noise(0.015, { freq: 4500, q: 5, vol: 0.05 });
    },
    drop: () => {
      noise(0.09, { freq: 420, q: 2, vol: 0.12 });
      tone(170, 0.16, { type: "triangle", vol: 0.1, slideTo: 90 });
    },
    open: () => {
      noise(0.05, { freq: 2300, q: 7, vol: 0.12 });
      tone(720, 0.05, { type: "square", vol: 0.025, slideTo: 520, lowpass: 2000 });
    },
    close: () => {
      noise(0.05, { freq: 1900, q: 7, vol: 0.13 });
      noise(0.05, { freq: 1500, q: 7, vol: 0.1, delay: 0.07 });
    },
    grab: () => {
      tone(330, 0.18, { vol: 0.16, slideTo: 175 });
      noise(0.12, { filter: "lowpass", freq: 700, vol: 0.07, delay: 0.01 });
    },
    miss: () => {
      tone(196, 0.22, { type: "triangle", vol: 0.12, slideTo: 185 });
      tone(185, 0.38, { type: "triangle", vol: 0.12, slideTo: 132, delay: 0.25 });
    },
    slip: () => tone(950, 0.55, { vol: 0.1, slideTo: 250, vibrato: 9 }),
    land: (vol) => {
      const now = sound.ctx ? sound.ctx.currentTime : 0;
      if (now - lastLand < 0.06) return; // a settling heap thuds, it doesn't machine-gun
      lastLand = now;
      tone(150, 0.13, { vol: 0.13 * vol, slideTo: 70 });
      noise(0.08, { filter: "lowpass", freq: 320, vol: 0.08 * vol });
    },
    nudge: () => tone(1350, 0.08, { vol: 0.04, slideTo: 1750 }),
    deliver: () => {
      [659, 784, 988, 1319].forEach((f, i) => bell(f, 0.9, 0.07, i * 0.09));
      // ...and a little ghostly giggle
      for (let i = 0; i < 5; i++) {
        tone(1000 - i * 70, 0.07, { vol: 0.05, slideTo: 1150 - i * 70, vibrato: 30, delay: 0.42 + i * 0.075 });
      }
    },
    refill: () => {
      noise(0.9, { freq: 300, sweepTo: 2600, q: 1.5, vol: 0.08, attack: 0.3 });
      [523, 659, 784].forEach((f, i) => bell(f, 0.7, 0.06, 0.6 + i * 0.1));
    },
    timeUp: () => {
      // A wobbly haunted-organ cadence
      [[294, 0], [220, 0.35], [175, 0.7]].forEach(([f, d], i) => {
        const dur = i === 2 ? 1.2 : 0.4;
        tone(f, dur, { type: "square", vol: 0.05, delay: d, lowpass: 1100, attack: 0.03, vibrato: 5 });
        tone(f * 1.006, dur, { type: "square", vol: 0.04, delay: d, lowpass: 1100, attack: 0.03 });
      });
    },
    bonus: () => {
      // A fanfare, then a vampire's "mwah-ha-ha"
      [523, 659, 784, 1047, 1319].forEach((f, i) => bell(f, 0.9, 0.08, i * 0.1));
      [[330, 0.16], [300, 0.16], [270, 0.16], [240, 0.5]].forEach(([f, d], i) => {
        tone(f, d, { type: "sawtooth", vol: 0.07, delay: 0.75 + i * 0.2, lowpass: 1400, vibrato: 22, attack: 0.02 });
        tone(f * 1.5, d, { type: "square", vol: 0.025, delay: 0.75 + i * 0.2, lowpass: 1600, attack: 0.02 });
      });
    },
    goodbye: () => {
      // Wah, wah, wah, waaah
      [[392, 0.32], [370, 0.32], [349, 0.32], [330, 1.1]].forEach(([f, d], i) => {
        tone(f, d, { type: "sawtooth", vol: 0.06, delay: i * 0.38, lowpass: 900, attack: 0.04, vibrato: i === 3 ? 6 : 0,
          slideTo: i === 3 ? 300 : f * 0.97 });
      });
    },
    newBest: () => [784, 988, 1175, 1568].forEach((f, i) => bell(f, 0.8, 0.07, 1.3 + i * 0.11)),
  };

  // The rail motor hums with the claw's speed; the winch whirs while the
  // cable pays out or reels in.
  function updateSoundLoops() {
    if (!sound.ctx) return;
    const speed = Math.min(1, Math.abs(claw.v) / MOVE_MAX);
    const quiet = game.mode === "attract" ? 0.35 : 1;
    rideVoice(sound.motor, speed > 0.05 ? (0.012 + 0.028 * speed) * quiet : 0, 0.8 + 0.6 * speed);
    const reeling = claw.phase === "descending" || claw.phase === "lifting"
      || (claw.phase === "returning" && claw.L > REST_L + 1);
    const strain = claw.holding ? 0.85 : 1;
    rideVoice(sound.winch, reeling ? 0.045 : 0, claw.phase === "descending" ? 0.8 : 1.15 * strain);
  }

  // ------------------------------------------------------------ storage
  function loadBest() {
    try {
      return parseInt(window.localStorage.getItem(BEST_KEY), 10) || 0;
    } catch (e) {
      return 0;
    }
  }
  function saveBest(v) {
    try {
      window.localStorage.setItem(BEST_KEY, String(v));
    } catch (e) {
      /* private mode or blocked storage: the best score lasts this visit only */
    }
  }

  // ------------------------------------------------------------ game state
  const game = {
    mode: "attract",   // attract | countdown | playing | timesUp
    clock: 0,          // seconds into the current mode
    time: ROUND_SECONDS,
    score: 0,
    best: loadBest(),
    roundOver: false,  // timer hit 0 while an attempt was still running
    slips: 0,
    bonus: false,      // the clear-the-machine celebration is playing
    bonusClock: 0,
    bonusPending: false, // the last prize just landed; the bonus starts in a moment
  };

  const claw = {
    x: HOME_X, v: 0, L: REST_L,
    phase: "idle",     // the ClawState enum
    timer: 0,
    targetL: REST_L,
    target: -1,        // slot under the claw when it dropped
    holding: false,
    slipTimer: -1,     // seconds of lift and carry before the prize slips, or -1
    alignment: 1,
  };

  // Slot contents; each slot is drawn by its own Rive placement prize0..11
  const slots = SLOTS.map((def) => ({
    def, kind: null, x: def.x, y: HIDDEN_Y, state: "resting", stateTimer: 0, fall: null, busy: false,
  }));
  // The prize in the claw. lx/ly are in the claw head's space (it hangs
  // inside the claw in Rive); x/y are the same point on the artboard.
  const held = { kind: null, x: 0, y: HIDDEN_Y, lx: 0, ly: HIDDEN_Y, dx: 0, s: 1.36, state: "resting", jitter: 0 };
  // The prize dropping into the chute after a release
  const chute = { kind: null, x: 0, y: HIDDEN_Y, s: 1.36, r: 0, state: "inChute", vy: 0, scored: false };
  const prongs = { l: PRONG_RELAXED, r: PRONG_RELAXED, vl: 0, vr: 0 };
  const scheduled = [];

  function after(seconds, fn) {
    scheduled.push({ at: game.clock + seconds, fn });
  }

  function randomKind() {
    return Math.random() < GOLD_CHANCE ? GOLD : KINDS[(Math.random() * KINDS.length) | 0];
  }

  function resetHeap() {
    const bag = KINDS.slice().sort(() => Math.random() - 0.5);
    slots.forEach((slot, i) => {
      slot.kind = i < bag.length ? bag[i] : randomKind();
      slot.x = slot.def.x;
      slot.y = slot.def.y;
      slot.fall = null;
      slot.busy = false;
      slot.ring = null;
      slot.scale = null;
      slot.rot = undefined;
      setPrizeState(slot, "resting");
    });
    game.bonus = false;
    game.bonusPending = false;
    if (Math.random() < 0.5) slots[(Math.random() * 3) | 0].kind = GOLD; // a rare treat up top
    scheduled.length = 0;
  }

  // The heap is not topped up after each prize: only once the player has
  // cleared it does the machine refill all 12, dropping them in from the top.
  function refillAll() {
    const bag = KINDS.slice().sort(() => Math.random() - 0.5);
    const order = [7, 8, 9, 10, 11, 3, 4, 5, 6, 0, 1, 2]; // bottom layer first
    order.forEach((i, n) => {
      const kind = n < bag.length ? bag[n] : randomKind();
      fallInto(i, Math.random() < GOLD_CHANCE ? GOLD : kind, SLOTS[i].x, 200, 0.5 + n * 0.12);
    });
    sfx.refill();
  }

  const heapEmpty = () => slots.every((slot) => !slot.kind);

  // ------------------------------------------------------------ bonus
  // Clearing all 12 before time runs out earns the MONSTER BONUS: the clock
  // stops, Rive plays the Dracula dance (Game.bonus), and every plush design
  // dances in a ring around him, using the now-empty heap slots. Then the
  // machine refills and play carries on.
  const BONUS_SECONDS = 7;
  const BONUS_RING = [[655, 770], [805, 790], [1145, 790], [1295, 770], [560, 600], [1390, 600],
    [700, 470], [1310, 445], [800, 330], [975, 285], [1150, 330]];

  function startBonus() {
    if (game.bonus) return;
    game.bonusPending = false;
    game.bonus = true;
    track("bonus", "Monster Bonus earned");
    game.bonusClock = 0;
    const kinds = KINDS.concat(GOLD);
    slots.forEach((slot, i) => {
      slot.fall = null;
      slot.busy = true;
      slot.kind = i < BONUS_RING.length ? kinds[i] : null;
      if (!slot.kind) return;
      slot.ring = BONUS_RING[i];
      slot.x = slot.ring[0];
      slot.y = slot.ring[1];
      slot.scale = 1.05;
      slot.rot = 0;
      setPrizeState(slot, "inChute"); // happy faces
    });
    sfx.bonus();
  }

  function updateBonus(dt) {
    game.bonusClock += dt;
    const t = game.bonusClock;
    slots.forEach((slot, i) => {
      if (!slot.ring) return;
      // Two hops a second, in time with Dracula's bounce, each a little out of step
      slot.y = slot.ring[1] - Math.abs(Math.sin(t * Math.PI * 2 + i * 0.6)) * 26;
      slot.x = slot.ring[0] + Math.sin(t * Math.PI + i) * 8;
      slot.rot = Math.sin(t * Math.PI * 2 + i) * 0.15;
    });
    if (t >= BONUS_SECONDS) endBonus();
  }

  function endBonus() {
    game.bonus = false;
    slots.forEach((slot) => {
      slot.kind = null;
      slot.busy = false;
      slot.ring = null;
      slot.scale = null;
      slot.rot = undefined;
      slot.y = HIDDEN_Y;
      setPrizeState(slot, "resting");
    });
    if (game.roundOver) {
      if (!cycleRunning()) endRound();
    } else {
      refillAll();
    }
  }

  // Slots a prize can rest in: the bottom layer, or a slot whose supports are
  // all filled
  const supports = SLOTS.map((_, i) => SLOTS.map((d, c) => (d.on.includes(i) ? c : -1)).filter((c) => c >= 0));
  function landingSlot(x) {
    let best = -1;
    let bestScore = Infinity;
    slots.forEach((slot, i) => {
      if (slot.kind || slot.busy) return;
      if (!supports[i].every((c) => slots[c].kind)) return;
      // Nearest first; a prize falls past higher gaps to a lower one beneath it
      const score = Math.abs(SLOTS[i].x - x) - SLOTS[i].y * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  }

  function setPrizeState(p, state, seconds) {
    p.state = state;
    p.stateTimer = seconds || 0;
  }

  // Start a prize falling from (x0, y0) into a slot
  function fallInto(slotIndex, kind, x0, y0, delay) {
    const slot = slots[slotIndex];
    const dy = Math.max(1, slot.def.y - y0);
    slot.kind = kind;
    slot.busy = true;
    slot.fall = { x0, y0, t: -(delay || 0), dur: Math.max(0.18, Math.sqrt((2 * dy) / GRAVITY)) };
    slot.x = x0;
    slot.y = delay ? HIDDEN_Y : y0;
    setPrizeState(slot, "dangling");
  }

  // Slot e just emptied: the prize resting on it slides down, and so on up
  // the heap. Returns the slot left empty at the top of the chain.
  function cascade(e, delay) {
    const above = SLOTS[e].on.filter((c) => slots[c].kind && !slots[c].busy);
    if (!above.length) return e;
    above.sort((a, b) => Math.abs(SLOTS[a].x - SLOTS[e].x) - Math.abs(SLOTS[b].x - SLOTS[e].x));
    const c = above[0];
    const from = slots[c];
    const kind = from.kind;
    from.busy = true;
    after(delay, () => {
      fallInto(e, kind, from.def.x, from.def.y, 0);
      // A slipped prize may already be dropping into `from`; leave it be
      if (!from.fall) {
        from.kind = null;
        from.busy = false;
        from.y = HIDDEN_Y;
      }
      nudgeNear(SLOTS[e].x, 1.6);
    });
    return cascade(c, delay + 0.14);
  }


  function nudgeNear(x, reach) {
    let wobbled = false;
    slots.forEach((slot) => {
      if (!slot.kind || slot.fall || slot.state !== "resting") return;
      if (Math.abs(slot.x - x) < prizeHalfWidth(slot) * reach) {
        setPrizeState(slot, "nudged", 0.7);
        wobbled = true;
      }
    });
    if (wobbled) sfx.nudge();
  }

  // The highest prize under the claw, or -1 for bare floor
  function prizeUnder(x) {
    let best = -1;
    let bestTop = Infinity;
    slots.forEach((slot, i) => {
      if (!slot.kind || slot.fall || slot.busy) return;
      if (Math.abs(slot.x - x) > prizeHalfWidth(slot)) return;
      const top = prizeTop(slot);
      if (top < bestTop) {
        bestTop = top;
        best = i;
      }
    });
    return best;
  }

  // ------------------------------------------------------------ input
  const input = { left: false, right: false, drop: false, start: false };
  const pointers = new Map(); // pointerId -> button name

  function toArtboard(e) {
    const t = viewTransform(canvas.getBoundingClientRect());
    return { x: (e.clientX - t.ox) / t.scale, y: (e.clientY - t.oy) / t.scale };
  }

  function buttonAt(p) {
    const inRect = (b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
    if (game.mode === "attract") return inRect(BUTTONS.start) ? "start" : inRect(BUTTONS.sound) ? "sound" : null;
    if (game.mode === "timesUp") return inRect(BUTTONS.again) ? "start" : inRect(BUTTONS.leave) ? "leave" : null;
    if (game.mode === "goodbye") return null;
    const inCircle = (b) => (p.x - b.cx) ** 2 + (p.y - b.cy) ** 2 <= b.r * b.r;
    if (inCircle(BUTTONS.music)) return "music";
    if (inCircle(BUTTONS.exit)) return "exit";
    if (inRect(BUTTONS.left)) return "left";
    if (inRect(BUTTONS.right)) return "right";
    const d = BUTTONS.drop;
    if ((p.x - d.cx) ** 2 + (p.y - d.cy) ** 2 <= d.r * d.r) return "drop";
    return null;
  }

  function syncPointerButtons() {
    input.left = input.right = input.start = input.sound = false;
    input.music = input.exit = input.leave = false;
    let dropHeld = false;
    pointers.forEach((name) => {
      if (name === "left") input.left = true;
      if (name === "right") input.right = true;
      if (name === "drop") dropHeld = true;
      if (name === "start") input.start = true;
      if (name === "sound") input.sound = true;
      if (name === "music") input.music = true;
      if (name === "exit") input.exit = true;
      if (name === "leave") input.leave = true;
    });
    input.drop = dropHeld || keys.drop;
    input.left = input.left || keys.left;
    input.right = input.right || keys.right;
  }

  function press(name) {
    if (name === "drop") tryDrop();
    if (name === "start") {
      goFullscreen();
      tryStart();
    }
    if (name === "sound" && game.mode === "attract") {
      setSoundOn(!sound.on);
      sfx.click();
    }
    if (name === "music") {
      setMusicOn(!music.on);
      sfx.click();
    }
    if (name === "exit" || name === "leave") leaveGame();
  }

  canvas.addEventListener("pointerdown", (e) => {
    unlockAudio();
    e.preventDefault();
    const name = buttonAt(toArtboard(e));
    pointers.set(e.pointerId, name);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (name) press(name);
    syncPointerButtons();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    // Sliding a thumb between the arrows switches direction; onto DROP does not fire it
    const name = buttonAt(toArtboard(e));
    const was = pointers.get(e.pointerId);
    if (name !== was) {
      pointers.set(e.pointerId, name === "left" || name === "right" ? name : null);
      syncPointerButtons();
    }
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    syncPointerButtons();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const keys = { left: false, right: false, drop: false };
  const KEYMAP = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", Space: "drop" };
  window.addEventListener("keydown", (e) => {
    if (!entered) {
      // On the loading screen, Enter or Space is the ENTER button
      if ((e.code === "Enter" || e.code === "Space") && canEnter) {
        e.preventDefault();
        enterGame();
      }
      return;
    }
    unlockAudio();
    if (game.mode === "goodbye") {
      if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        comeBack();
      }
      return;
    }
    if (e.code === "KeyM" && !e.repeat) {
      setMusicOn(!music.on);
      return;
    }
    if (e.code === "Enter" || (e.code === "Space" && (game.mode === "attract" || game.mode === "timesUp"))) {
      e.preventDefault();
      if (!e.repeat) {
        goFullscreen();
        tryStart();
      }
      return;
    }
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    if (!keys[k] && k === "drop") tryDrop();
    keys[k] = true;
    syncPointerButtons();
  });
  window.addEventListener("keyup", (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    keys[k] = false;
    syncPointerButtons();
  });
  window.addEventListener("blur", () => {
    keys.left = keys.right = keys.drop = false;
    pointers.clear();
    syncPointerButtons();
  });

  // ------------------------------------------------------------ flow
  function enterAttract() {
    game.mode = "attract";
    game.clock = 0;
  }

  // Go fullscreen on ENTER and START wherever the browser allows it
  // (computers, Android, iPad). iPhone Safari only allows fullscreen video,
  // so there the way is "Add to Home Screen". Must run inside the tap or key
  // press itself. If the player leaves fullscreen (Esc), we stop asking.
  let leftFullscreen = false;
  let fullscreenNote = ""; // what happened last time we asked (shown by ?debug)
  let wasFullscreen = false;
  const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function onFullscreenChange() {
    if (wasFullscreen && !isFullscreen()) leftFullscreen = true;
    wasFullscreen = isFullscreen();
    resize();
  }

  function goFullscreen() {
    const el = document.documentElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    const installed = window.matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches;
    if (!request || isFullscreen() || installed || leftFullscreen) return;
    try {
      fullscreenNote = "requested";
      const done = request.call(el, { navigationUI: "hide" });
      if (done && done.then) {
        done.then(() => {
          if (screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(() => {});
        }).catch((err) => { fullscreenNote = "refused: " + err.message; }); // carry on in the page
      }
    } catch (e) {
      /* not allowed here (an iframe without allow="fullscreen", say) */
    }
  }

  function tryStart() {
    if (game.mode === "attract" || (game.mode === "timesUp" && game.clock > 0.8)) {
      // Every round starts with a full heap of 12
      if (game.mode === "timesUp" || slots.some((slot) => !slot.kind)) resetHeap();
      game.mode = "countdown";
      track("play-start", "Round started");
      game.clock = 0;
      game.score = 0;
      game.time = ROUND_SECONDS;
      game.roundOver = false;
      game.lastCount = 0;
      game.lastSecond = ROUND_SECONDS;
      claw.phase = "returning"; // park at home before the round starts
      sfx.start();
    }
  }

  function endRound() {
    game.mode = "timesUp";
    track("round-complete", "Round finished");
    track("score-" + (game.score >= 15 ? "15plus" : game.score), "Score " + game.score);
    game.clock = 0;
    game.newBest = game.score > game.best;
    if (game.newBest) {
      game.best = game.score;
      saveBest(game.best);
      sfx.newBest();
    }
    sfx.timeUp();
  }

  const cycleRunning = () => !(claw.phase === "idle" || claw.phase === "moving");
  // The bonus is playing or about to: the round waits for it to finish
  const bonusDue = () => game.bonus || game.bonusPending;

  function tryDrop() {
    if (game.mode !== "playing" || game.roundOver || game.bonus || cycleRunning()) return;
    claw.v = 0;
    claw.slipped = false;
    claw.target = prizeUnder(claw.x);
    if (claw.target >= 0) {
      const slot = slots[claw.target];
      // The hub comes to rest on top of the prize
      claw.targetL = prizeTop(slot) - HELD_TOP - RAIL_Y;
      claw.alignment = Math.abs(claw.x - slot.x) / prizeHalfWidth(slot);
    } else {
      claw.targetL = FLOOR_Y - OPEN_TIP_DROP - RAIL_Y;
      claw.alignment = 1;
    }
    claw.targetL = Math.min(MAX_L, Math.max(REST_L, claw.targetL));
    claw.phase = "descending";
    sfx.open();
    fire("drop");
    sfx.drop();
  }

  function decideGrab() {
    const a = claw.alignment;
    let grab = false;
    let slipChance = 0;
    if (claw.target >= 0 && a <= CENTER_ZONE) {
      grab = Math.random() < CENTER_GRAB;
      slipChance = CENTER_SLIP;
    } else if (claw.target >= 0 && a <= EDGE_ZONE) {
      grab = Math.random() < EDGE_GRAB;
      slipChance = EDGE_SLIP;
    }
    claw.holding = grab;
    // A slip can come at any moment of the lift or the trip toward the chute
    const liftTime = (claw.L - REST_L) / LIFT_SPEED;
    const carryTime = Math.max(0, claw.x - SLIP_SAFE_X) / CARRY_SPEED;
    claw.slipTimer = grab && Math.random() < slipChance
      ? 0.1 + Math.random() * (liftTime + carryTime) * 0.95
      : -1;
    // Set before the claw state so the pose picks "grip" or "close" correctly
    setBool("gripSuccess", grab);
    if (grab) {
      const slot = slots[claw.target];
      held.kind = slot.kind;
      held.s = slot.def.s;
      held.dx = slot.x - claw.x; // off-centre grabs hang off-centre, then swing in
      held.jitter = 0;
      heldFollowClaw(0);
      setPrizeState(held, "gripped");
      slot.kind = null;
      slot.y = HIDDEN_Y;
      setNum("prizeIndex", claw.target);
      sfx.grab();
    } else {
      nudgeNear(claw.x, 1.4);
      sfx.miss();
    }
  }

  function heldFollowClaw(dt) {
    held.dx *= Math.exp(-3 * (dt || 0));
    held.lx = held.dx + held.jitter;
    // The prize's top sits under the hub; its centre is BODY_PIVOT above its bottom
    held.ly = HELD_TOP + (-BODY_PIVOT - topY(held.kind)) * held.s;
    held.x = claw.x + held.lx;
    held.y = RAIL_Y + claw.L + held.ly;
  }

  // Where a side prong's rubber tip touches, for prong angle a (left prong;
  // the right prong is its mirror image). Claw head space.
  function prongContact(a) {
    const k = CLAW_SCALE;
    const tx = PRONG_TIP.x * Math.cos(a) - PRONG_TIP.y * Math.sin(a);
    const ty = PRONG_TIP.x * Math.sin(a) + PRONG_TIP.y * Math.cos(a);
    return { x: k * (-PRONG_PIVOT.x + tx + TIP_RADIUS), y: k * (PRONG_PIVOT.y + ty) };
  }

  // The angle that brings one side prong's tip onto the held prize's outline.
  // side = -1 left, +1 right; the right side is solved in the mirrored frame.
  function gripAngle(side) {
    const squeeze = 0.94; // the plush's scaleX while gripped (prize.rml)
    const dx = side < 0 ? held.lx : -held.lx;
    const gap = (a) => {
      const c = prongContact(a);
      const pts = PROFILES[held.kind] || GUMDROP;
      const top = pts[0][0], bottom = pts[pts.length - 1][0];
      // On a short prize the tips would pass below it and cross in front;
      // stop them at its lower edge instead, tucked under
      const yb = Math.min(top + (c.y - HELD_TOP) / held.s, top + 0.82 * (bottom - top));
      const edge = dx - outlineAt(held.kind, yb) * held.s * squeeze;
      return c.x - (edge + GRIP_INSET);
    };
    if (gap(PRONG_OPEN) > 0) return PRONG_OPEN;   // too wide to close on
    if (gap(PRONG_SHUT) < 0) return PRONG_SHUT;   // tips meet underneath it
    let lo = PRONG_SHUT, hi = PRONG_OPEN;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (gap(mid) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // Springy prongs: they overshoot a touch and settle, like a real claw
  function updateProngs(dt) {
    const c = claw;
    let tl = PRONG_RELAXED, tr = PRONG_RELAXED;
    if (c.phase === "descending" || c.phase === "releasing") {
      tl = tr = PRONG_OPEN;
    } else if (c.phase === "closing" || c.phase === "lifting" || c.phase === "carrying") {
      if (c.holding) {
        tl = gripAngle(-1);
        tr = gripAngle(1);
        // Tension before a slip: the grip loosens and the prize trembles
        if (c.slipTimer >= 0 && c.slipTimer < 0.4) {
          const loosen = (0.4 - c.slipTimer) * 0.5;
          tl += loosen;
          tr += loosen;
        }
      } else {
        tl = tr = c.slipped ? 0.35 : PRONG_SHUT;
      }
    }
    const step = (pos, vel, target) => {
      vel += (target - pos) * 320 * dt;
      vel *= Math.exp(-22 * dt);
      return [pos + vel * dt, vel];
    };
    [prongs.l, prongs.vl] = step(prongs.l, prongs.vl, tl);
    [prongs.r, prongs.vr] = step(prongs.r, prongs.vr, tr);
  }

  function maybeSlip(dt) {
    held.jitter = 0;
    if (claw.slipTimer < 0 || claw.x <= SLIP_SAFE_X) return;
    claw.slipTimer -= dt;
    if (claw.slipTimer < 0.4) held.jitter = Math.sin(game.clock * 70) * 3; // it's going...
    if (claw.slipTimer <= 0) slip();
  }

  // ------------------------------------------------------------ update
  function approach(v, target, rate, dt) {
    return v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt);
  }

  function updateClaw(dt) {
    const c = claw;
    switch (c.phase) {
      case "idle":
      case "moving": {
        let want = 0;
        if (game.mode === "playing" && !game.roundOver) {
          want = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        } else if (game.mode === "attract") {
          // Attract mode: the claw browses the heap on its own
          want = Math.sin(game.clock * 0.6) > 0 ? 1 : -1;
          if (c.x > 1450) want = -1;
          if (c.x < 600) want = 1;
          want *= 0.5;
        }
        const accel = want === 0 || Math.sign(want) !== Math.sign(c.v) ? MOVE_DECEL : MOVE_ACCEL;
        c.v = approach(c.v, want * MOVE_MAX, accel, dt);
        c.x += c.v * dt;
        if (c.x < CLAW_MIN_X) { c.x = CLAW_MIN_X; c.v = 0; }
        if (c.x > CLAW_MAX_X) { c.x = CLAW_MAX_X; c.v = 0; }
        c.phase = Math.abs(c.v) > 1 ? "moving" : "idle";
        break;
      }
      case "descending":
        c.L = Math.min(c.targetL, c.L + DESCEND_SPEED * dt);
        if (c.L >= c.targetL) {
          decideGrab();
          sfx.close();
          c.phase = "closing";
          c.timer = CLOSE_TIME;
        }
        break;
      case "closing":
        c.timer -= dt;
        if (c.holding) heldFollowClaw(0);
        if (c.timer <= 0) {
          c.phase = "lifting";
          if (c.holding) {
            setPrizeState(held, "dangling");
            cascade(c.target, 0.15);
          }
        }
        break;
      case "lifting":
        c.L = Math.max(REST_L, c.L - LIFT_SPEED * dt);
        if (c.holding) {
          heldFollowClaw(dt);
          maybeSlip(dt);
        }
        // Like a real machine, the claw always goes to the chute, prize or not
        if (c.L <= REST_L) c.phase = "carrying";
        break;
      case "carrying":
        c.x = approach(c.x, CHUTE_X, CARRY_SPEED, dt);
        c.v = -CARRY_SPEED;
        if (c.holding) {
          heldFollowClaw(dt);
          maybeSlip(dt);
        }
        if (c.x <= CHUTE_X) {
          c.v = 0;
          c.phase = "releasing";
          sfx.open();
          c.timer = RELEASE_TIME;
          setBool("gripSuccess", false);
          if (c.holding) {
            // Hand the prize to the chute copy, which falls in world space
            c.holding = false;
            chute.kind = held.kind;
            chute.s = held.s;
            chute.x = held.x;
            chute.y = held.y;
            chute.vy = 0;
            chute.scored = false;
            held.kind = null;
          }
        }
        break;
      case "releasing":
        c.timer -= dt;
        if (c.timer <= 0) c.phase = "returning";
        break;
      case "returning":
        c.L = Math.max(REST_L, c.L - LIFT_SPEED * dt);
        c.v = c.x === HOME_X ? 0 : Math.sign(HOME_X - c.x) * CARRY_SPEED;
        c.x = approach(c.x, HOME_X, CARRY_SPEED, dt);
        if (c.x === HOME_X && c.L <= REST_L) {
          c.v = 0;
          c.phase = "idle";
          setNum("prizeIndex", -1);
          if (game.roundOver && !bonusDue()) endRound();
        }
        break;
    }
  }

  // The prize slips out of the claw and drops back onto the heap
  function slip() {
    claw.holding = false;
    claw.slipTimer = -1;
    game.slips += 1;
    setBool("gripSuccess", false);
    sfx.slip();
    claw.slipped = true;
    const spot = landingSlot(held.x);
    fallInto(spot >= 0 ? spot : claw.target, held.kind, held.x, held.y, 0);
    held.kind = null;
  }

  function updateChute(dt) {
    if (!chute.kind) return;
    chute.vy += GRAVITY * dt;
    chute.y += chute.vy * dt;
    chute.x = approach(chute.x, CHUTE_X, 200, dt);
    if (!chute.scored && chute.y > CHUTE_MOUTH_Y) {
      chute.scored = true;
      game.score += 1;
      fire("delivered");
      sfx.deliver();
      // Cleared the whole machine: the bonus dance, then a fresh heap
      // Marked at once, so the round can't end before the bonus plays, even
      // when this was the last attempt as the clock ran out
      if (heapEmpty() && !held.kind) {
        game.bonusPending = true;
        after(0.6, startBonus);
      }
    }
    if (chute.y > 980) {
      chute.kind = null;
      chute.y = HIDDEN_Y;
    }
  }

  function updateSlots(dt) {
    slots.forEach((slot) => {
      if (slot.fall) {
        const f = slot.fall;
        f.t += dt;
        if (f.t < 0) return;
        const k = Math.min(1, f.t / f.dur);
        slot.x = f.x0 + (slot.def.x - f.x0) * k;
        slot.y = f.y0 + (slot.def.y - f.y0) * k * k;
        if (k >= 1) {
          slot.fall = null;
          slot.busy = false;
          slot.x = slot.def.x;
          slot.y = slot.def.y;
          setPrizeState(slot, "dropped", 0.6);
          nudgeNear(slot.x, 1.3);
          sfx.land(Math.min(1, f.dur * 2.5));
        }
      } else if (slot.stateTimer > 0) {
        slot.stateTimer -= dt;
        if (slot.stateTimer <= 0) setPrizeState(slot, "resting");
      }
    });
  }

  function updateGame(dt) {
    game.clock += dt;
    for (let i = scheduled.length - 1; i >= 0; i--) {
      if (scheduled[i].at <= game.clock) {
        const job = scheduled.splice(i, 1)[0];
        job.fn();
      }
    }
    if (game.mode === "countdown") {
      const n = Math.ceil(COUNTDOWN_SECONDS - game.clock);
      if (n !== game.lastCount && n > 0) {
        game.lastCount = n;
        sfx.tick();
      }
      if (game.clock >= COUNTDOWN_SECONDS) {
        game.mode = "playing";
        game.clock = 0;
        sfx.go();
      }
    } else if (game.mode === "playing" && !game.roundOver) {
      if (!game.bonus) game.time = Math.max(0, game.time - dt); // the clock stops for the bonus
      const second = Math.ceil(game.time);
      if (second !== game.lastSecond && second <= 10 && second > 0) sfx.clock(); // the last ten seconds tick
      game.lastSecond = second;
      if (game.time <= 0) {
        // Let an attempt in progress finish and count
        if (cycleRunning() || bonusDue()) game.roundOver = true;
        else endRound();
      }
    }
    updateClaw(dt);
    updateSoundLoops();
    updateMusic();
    updateProngs(dt);
    updateChute(dt);
    updateSlots(dt);
    if (game.bonus) updateBonus(dt);
  }

  // ------------------------------------------------------------ push to Rive
  function pushPrize(path, p, x, y, s, rot) {
    setEnum(path + "/kind", p.kind || "ghost");
    setNum(path + "/x", x);
    setNum(path + "/y", p.kind ? y : HIDDEN_Y);
    setNum(path + "/scale", s);
    setNum(path + "/rotation", rot);
    setEnum(path + "/prizeState", p.state);
  }

  function render() {
    // The goodbye slide is HTML over the cabinet; behind it the title card waits
    setEnum("gameState", game.mode === "goodbye" ? "attract" : game.mode);
    setNum("timeRemaining", game.mode === "playing" || game.mode === "timesUp" ? Math.ceil(game.time) : ROUND_SECONDS);
    setNum("score", game.score);
    setNum("bestScore", game.best);
    setBool("newBest", !!game.newBest && game.mode === "timesUp");
    // Only during the countdown: the number keeps its last value as it zooms away
    if (game.mode === "countdown") setNum("countdown", Math.max(1, Math.ceil(COUNTDOWN_SECONDS - game.clock)));

    setNum("clawX", claw.x);
    setNum("cableLength", claw.L);
    setNum("moveDirection", claw.v > 40 ? 1 : claw.v < -40 ? -1 : 0);
    setEnum("clawState", claw.phase);

    const live = game.mode === "playing" && !game.roundOver;
    setBool("controlsLocked", !live || game.bonus || cycleRunning());
    setBool("bonus", game.bonus);
    setBool("leftPressed", live && input.left);
    setBool("rightPressed", live && input.right);
    setBool("dropPressed", live && input.drop);
    setBool("startPressed", input.start && (game.mode === "attract" || game.mode === "timesUp"));
    setBool("soundPressed", input.sound && game.mode === "attract");
    setBool("musicPressed", !!input.music);
    setBool("exitPressed", !!input.exit);
    setBool("leavePressed", !!input.leave && game.mode === "timesUp");
    setBool("musicOn", music.on);
    setBool("soundOn", sound.on);

    slots.forEach((slot, i) => pushPrize("prize" + i, slot, slot.x, slot.y, slot.scale || slot.def.s,
      slot.rot !== undefined ? slot.rot : slot.def.r));
    pushPrize("heldPrize", held, held.lx, held.ly, held.s, 0);
    pushPrize("chutePrize", chute, chute.x, chute.y, chute.s, 0);
    setNum("prongLeft", prongs.l);
    setNum("prongRight", -prongs.r);
  }

  // ------------------------------------------------------------ loop, pause
  let last = 0;
  let paused = false;

  function updatePaused() {
    const shouldPause = document.hidden || portraitQuery.matches;
    if (shouldPause === paused || !r) return;
    paused = shouldPause;
    if (sound.ctx) {
      if (paused) sound.ctx.suspend();
      else sound.ctx.resume();
    }
    syncMusicPlayback();
    if (paused) {
      r.stopRendering();
      pointers.clear();
      keys.left = keys.right = keys.drop = false;
      syncPointerButtons();
    } else {
      last = 0;
      r.startRendering();
      resize();
    }
  }
  document.addEventListener("visibilitychange", updatePaused);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  if (portraitQuery.addEventListener) portraitQuery.addEventListener("change", updatePaused);
  else portraitQuery.addListener(updatePaused);

  // Add ?debug to the URL to inspect the game from the console
  if (/[?&]debug\b/.test(window.location.search)) window.spookyClaw = {
    game, claw, slots, held, chute, prongs, input, keys, sound, sfx, music, tryStart, tryDrop, startBonus, leaveGame, comeBack,
    get fullscreenNote() { return fullscreenNote; },
    step(seconds, dt) { for (let t = 0; t < seconds; t += dt || 1 / 60) updateGame(dt || 1 / 60); render(); },
  };

  function frame(now) {
    requestAnimationFrame(frame);
    updatePaused();
    if (paused) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (window.spookyClaw && window.spookyClaw.frozen) return; // ?debug only
    updateGame(dt);
    render();
  }

  // ------------------------------------------------------------ leaving
  // The cabinet's exit button and LEAVE on the results card both end here: a
  // goodbye slide with the title plushies in tears. A round in progress is
  // abandoned (its score isn't kept). "Play again" brings back the title card.
  const goodbye = document.getElementById("goodbye");

  function leaveGame() {
    if (game.mode === "goodbye") return;
    const finished = game.mode === "timesUp";
    track(finished ? "leave-after-round" : "leave-mid-round", "Left the game");
    game.mode = "goodbye";
    game.clock = 0;
    game.bonus = false;
    game.bonusPending = false;
    game.roundOver = false;
    claw.phase = "returning";
    claw.holding = false;
    held.kind = null;
    chute.kind = null;
    pointers.clear();
    keys.left = keys.right = keys.drop = false;
    syncPointerButtons();
    document.getElementById("goodbyeScore").textContent = finished
      ? `You delivered ${game.score} ${game.score === 1 ? "plushy" : "plushies"}.`
      : "The plushies will miss you.";
    goodbye.hidden = false;
    document.getElementById("goodbyeAgain").focus({ preventScroll: true });
    updateMusic(); // fades out...
    setTimeout(syncMusicPlayback, 1500); // ...then stops
    sfx.goodbye();
    if (isFullscreen()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        exit.call(document);
        wasFullscreen = false; // leaving on purpose, so START may ask again later
      }
    }
  }

  function comeBack() {
    if (game.mode !== "goodbye") return;
    goodbye.hidden = true;
    resetHeap();
    enterAttract();
    syncMusicPlayback();
    sfx.click();
  }
  document.getElementById("goodbyeAgain").addEventListener("click", () => {
    unlockAudio();
    comeBack();
  });
  document.querySelector(".melonbird-card")?.addEventListener("click", () => {
    track("melonbird", "Opened Melonbird");
  });

  // ------------------------------------------------------------ loading
  // Download the Rive runtime, the game and the music with one progress bar,
  // so the game never starts with something missing. Sizes are estimates
  // used when the server compresses a file (its byte count is then unknown).
  const PRELOAD = [
    { key: "wasm", url: "vendor/rive-webgl2-2.44.2/rive.wasm", size: 2178508 },
    { key: "riv", url: BUILD ? "game.riv?v=" + BUILD : "game.riv", size: 72000 },
    { key: "music", url: MUSIC_SRC, size: 2660000 },
  ];
  const STATUS = [[0.25, "Waking the ghosts..."], [0.5, "Stuffing the plushies..."],
    [0.75, "Oiling the claw..."], [1.01, "Tuning the haunted organ..."]];
  // The bar never finishes sooner than this, however fast the downloads, so
  // each of the four messages stays up long enough to read (~1.2 s each).
  // A slow connection is simply slower than this: the bar follows the real
  // progress. Lower it for a quicker start.
  const MIN_LOAD_MS = 4800;
  const loadStart = performance.now();
  let loadTicker = 0;
  let riveReady = false;
  let canEnter = false; // the bar has finished and TAP TO ENTER is showing
  let entered = false;

  function showProgress() {
    const total = PRELOAD.reduce((a, it) => a + it.size, 0);
    const got = PRELOAD.reduce((a, it) => a + Math.min(it.got || 0, it.size), 0);
    const real = got / total;
    const paced = (performance.now() - loadStart) / MIN_LOAD_MS;
    const p = Math.min(0.99, real, paced); // 100% only once the game is running and the pacing is done
    const pct = Math.floor(p * 100);
    loaderFill.style.width = pct + "%";
    loaderBar.setAttribute("aria-valuenow", String(pct));
    loaderPercent.textContent = pct + "%";
    loaderStatus.textContent = STATUS.find(([upTo]) => p < upTo)[1];
  }

  async function fetchWithProgress(item) {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(item.url + " " + res.status);
    const length = Number(res.headers.get("content-length")) || 0;
    if (length && !res.headers.get("content-encoding")) item.size = length;
    if (!res.body || !res.body.getReader) {
      const buf = await res.arrayBuffer();
      item.got = buf.byteLength;
      return buf;
    }
    const reader = res.body.getReader();
    const chunks = [];
    item.got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      item.got += value.length;
      showProgress();
    }
    const out = new Uint8Array(item.got);
    let at = 0;
    chunks.forEach((c) => {
      out.set(c, at);
      at += c.length;
    });
    return out.buffer;
  }

  async function boot() {
    loadAnalytics();
    const installed = window.navigator.standalone || window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;
    track(installed ? "open-home-screen" : window.self !== window.top ? "open-embed" : "open-browser", "How it was opened");
    showInstallTip();
    showProgress();
    loadTicker = setInterval(showProgress, 80); // keeps the paced bar moving between downloads
    const files = {};
    await Promise.all(PRELOAD.map((item) => fetchWithProgress(item)
      .then((buf) => { files[item.key] = buf; })
      .catch((err) => { console.warn("Spooky Claw: couldn't preload", item.url, err); })
      .then(() => { item.got = item.size; showProgress(); })));
    if (files.wasm) riveLib.RuntimeLoader.setWasmBinary(files.wasm);
    if (files.music) setMusicSource(URL.createObjectURL(new Blob([files.music], { type: "audio/mpeg" })));
    startRive(files.riv || null);
  }

  // Called when the game is running. The bar may still be pacing itself:
  // wait until the messages have all had their time, then finish.
  function showEnter() {
    const wait = Math.max(0, MIN_LOAD_MS - (performance.now() - loadStart));
    setTimeout(() => {
      clearInterval(loadTicker);
      loaderFill.style.width = "100%";
      loaderBar.setAttribute("aria-valuenow", "100");
      loaderPercent.textContent = "100%";
      loaderStatus.textContent = "Ready!";
      setTimeout(() => {
        canEnter = true;
        loaderProgress.hidden = true;
        enterButton.hidden = false;
        enterButton.focus({ preventScroll: true });
      }, 450);
    }, wait);
  }

  // The ENTER tap is the first touch, so it also unlocks sound and music
  function enterGame() {
    if (entered || !canEnter) return;
    entered = true;
    track("enter", "Tapped to enter");
    goFullscreen();
    unlockAudio();
    sfx.click();
    loader.classList.add("is-gone");
    setTimeout(() => { loader.hidden = true; }, 600);
  }
  enterButton.addEventListener("click", enterGame);

  // ------------------------------------------------------------ install tip
  // On a phone or tablet in a browser tab, explain how to add the game to
  // the home screen, where it runs full screen. Not shown once installed, in
  // an embed (that would install the host page), or after "Don't show again".
  const TIP_KEY = "spookyClaw.hideInstallTip";
  const tip = document.getElementById("installTip");
  const tipInstall = document.getElementById("tipInstall");
  let installPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    // Chrome on Android offers a real install; use it from the tip's button
    e.preventDefault();
    installPrompt = e;
    tipInstall.hidden = false;
  });

  function showInstallTip() {
    const forced = /[?&]tip\b/.test(window.location.search); // for testing on desktop
    const installed = window.navigator.standalone ||
      window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;
    const embedded = window.self !== window.top;
    let hidden = false;
    try {
      hidden = window.localStorage.getItem(TIP_KEY) === "1";
    } catch (e) {
      /* blocked storage: show it */
    }
    const ua = window.navigator.userAgent;
    const ios = /iP(hone|ad|od)/.test(ua) || (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
    const android = /Android/i.test(ua);
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (!forced && (installed || embedded || hidden || !touch || !(ios || android))) return;
    document.getElementById(android && !forced ? "tipStepsAndroid" : "tipStepsIos").hidden = false;
    tip.hidden = false;
    track("install-tip-shown", "Home-screen tip shown");
    document.getElementById("tipOk").focus({ preventScroll: true });
  }

  function closeTip() {
    if (document.getElementById("tipNever").checked) {
      try {
        window.localStorage.setItem(TIP_KEY, "1");
      } catch (e) {
        /* blocked storage: it will show again next visit */
      }
    }
    tip.hidden = true;
    if (canEnter) enterButton.focus({ preventScroll: true });
  }
  document.getElementById("tipOk").addEventListener("click", closeTip);
  tipInstall.addEventListener("click", () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.finally(() => {
      installPrompt = null;
      tipInstall.hidden = true;
      closeTip();
    });
  });

  window.addEventListener("appinstalled", () => track("installed", "Added to home screen"));

  boot();
})();
