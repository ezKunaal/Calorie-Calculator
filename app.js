import { FOODS } from "./foods.js";

/* ---------------- Storage ---------------- */
const STORE_KEY = "calorie-calculator:v1";
const DEFAULT_GOALS = { cal: 2000, protein: 100, fiber: 30 };

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY));
    if (data && data.days) return { goals: { ...DEFAULT_GOALS, ...data.goals }, days: data.days };
  } catch {}
  return { goals: { ...DEFAULT_GOALS }, days: {} };
}
let state = load();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Storage full: drop photo thumbnails from older days and try again.
    for (const key of Object.keys(state.days).sort().slice(0, -1)) {
      state.days[key].forEach((e) => delete e.thumb);
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch { toast("Couldn't save — your browser storage is full."); }
  }
}

/* ---------------- Dates ---------------- */
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayKey = () => dayKey(new Date());
let viewDate = new Date();
const viewKey = () => dayKey(viewDate);
const entries = () => state.days[viewKey()] || [];

/* ---------------- DOM helpers ---------------- */
const $ = (id) => document.getElementById(id);
const round1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => (Number.isInteger(round1(n)) ? String(round1(n)) : round1(n).toFixed(1));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

function openSheet(id) { $("toast").hidden = true; $(id).hidden = false; document.body.style.overflow = "hidden"; }
function closeSheet(id) { $(id).hidden = true; document.body.style.overflow = ""; }

/* ---------------- Render ---------------- */
const RING_C = 2 * Math.PI * 86;

function render() {
  const list = entries();
  const { goals } = state;
  const tot = list.reduce((a, e) => ({ cal: a.cal + e.cal, protein: a.protein + e.protein, fiber: a.fiber + e.fiber }), { cal: 0, protein: 0, fiber: 0 });

  // Header
  const isToday = viewKey() === todayKey();
  const y = new Date(); y.setDate(y.getDate() - 1);
  $("dayLabel").textContent = isToday ? "Today" : viewKey() === dayKey(y) ? "Yesterday" : viewDate.toLocaleDateString(undefined, { weekday: "long" });
  $("daySub").textContent = viewDate.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  $("nextDay").disabled = isToday;

  // Ring
  const pct = goals.cal > 0 ? tot.cal / goals.cal : 0;
  const ring = $("calRing");
  ring.style.strokeDasharray = RING_C;
  ring.style.strokeDashoffset = RING_C * (1 - Math.min(pct, 1));
  ring.classList.toggle("over", pct > 1);
  const left = Math.round(goals.cal - tot.cal);
  $("calLeft").textContent = Math.abs(left).toLocaleString();
  $("calLeft").classList.toggle("over", left < 0);
  $("calLeftLabel").textContent = left < 0 ? "kcal over" : "kcal left";
  $("calEaten").textContent = `${Math.round(tot.cal).toLocaleString()} / ${goals.cal.toLocaleString()} eaten`;

  // Macros
  $("proteinText").textContent = `${fmt(tot.protein)} / ${goals.protein} g`;
  $("fiberText").textContent = `${fmt(tot.fiber)} / ${goals.fiber} g`;
  $("proteinBar").style.width = `${Math.min(100, goals.protein ? (tot.protein / goals.protein) * 100 : 0)}%`;
  $("fiberBar").style.width = `${Math.min(100, goals.fiber ? (tot.fiber / goals.fiber) * 100 : 0)}%`;

  // Log
  $("emptyLog").hidden = list.length > 0;
  $("logCount").textContent = list.length ? `${list.length} item${list.length > 1 ? "s" : ""}` : "";
  $("logList").innerHTML = list
    .slice()
    .reverse()
    .map((e) => {
      const time = new Date(e.time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      const thumb = e.thumb ? `<img src="${e.thumb}" alt="">` : esc(e.emoji || "🍽️");
      const portion = e.portion && e.portion !== 1 ? ` · ${fmt(e.portion)}×` : "";
      return `<li class="log-item">
        <div class="log-thumb">${thumb}</div>
        <div class="log-info">
          <div class="log-name">${esc(e.name)}</div>
          <div class="log-meta">${time}${portion} · 💪 ${fmt(e.protein)}g · 🌾 ${fmt(e.fiber)}g</div>
        </div>
        <div class="log-cal">${Math.round(e.cal)}</div>
        <button class="log-del" data-id="${e.id}" aria-label="Remove">✕</button>
      </li>`;
    })
    .join("");
}

$("logList").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".log-del");
  if (!btn) return;
  const key = viewKey();
  state.days[key] = entries().filter((e) => e.id !== btn.dataset.id);
  if (!state.days[key].length) delete state.days[key];
  save();
  render();
});

$("prevDay").onclick = () => { viewDate.setDate(viewDate.getDate() - 1); render(); };
$("nextDay").onclick = () => { if (viewKey() !== todayKey()) { viewDate.setDate(viewDate.getDate() + 1); render(); } };

/* ---------------- Food recognition (runs in the browser) ---------------- */
// CLIP compares the photo to every food name in our list and ranks them.
// The model (~150 MB) downloads once, then the browser caches it for offline use.
const MODEL_ID = "Xenova/clip-vit-base-patch32";
let classifierPromise = null;

function getClassifier(onProgress) {
  if (window.__mockClassifier) return Promise.resolve(window.__mockClassifier);
  if (!classifierPromise) {
    classifierPromise = (async () => {
      const { pipeline } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");
      const files = {};
      return pipeline("zero-shot-image-classification", MODEL_ID, {
        progress_callback: (p) => {
          if (p.status === "progress" && p.total) {
            files[p.file] = { loaded: p.loaded, total: p.total };
            const all = Object.values(files);
            const loaded = all.reduce((a, f) => a + f.loaded, 0);
            const total = all.reduce((a, f) => a + f.total, 0);
            onProgress?.(loaded, total);
          }
        },
      });
    })().catch((err) => { classifierPromise = null; throw err; });
  }
  return classifierPromise;
}

async function recognize(dataUrl) {
  $("analyzing").hidden = false;
  $("suggestBlock").hidden = true;
  $("analyzingText").textContent = "Analyzing your food…";
  $("progressWrap").hidden = true;
  $("progressNote").textContent = "";

  try {
    const classifier = await getClassifier((loaded, total) => {
      $("analyzingText").textContent = "Downloading the food model (first time only)…";
      $("progressWrap").hidden = false;
      $("progressFill").style.width = `${Math.round((loaded / total) * 100)}%`;
      $("progressNote").textContent = `${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} MB`;
    });
    $("analyzingText").textContent = "Analyzing your food…";
    $("progressWrap").hidden = true;
    $("progressNote").textContent = "";

    const labels = FOODS.map((f) => f.name);
    const results = await classifier(dataUrl, labels, { hypothesis_template: "a photo of {}, a type of food." });
    const top = results.slice(0, 4);

    $("chips").innerHTML = top
      .map((r, i) => {
        const f = FOODS.find((x) => x.name === r.label);
        return `<button class="chip${i === 0 ? " active" : ""}" data-name="${esc(f.name)}">${f.emoji} ${esc(f.name)}<small>${Math.round(r.score * 100)}%</small></button>`;
      })
      .join("");
    $("suggestBlock").hidden = false;
    choose(FOODS.find((x) => x.name === top[0].label));
  } catch (err) {
    console.error(err);
    toast("Couldn't analyze the photo. Pick the food from the search below.");
    $("foodSearch").focus();
  } finally {
    $("analyzing").hidden = true;
  }
}

$("chips").addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  choose(FOODS.find((f) => f.name === chip.dataset.name));
});

/* ---------------- Add sheet ---------------- */
let current = { food: null, portion: 1, thumb: null };

function resetAddSheet() {
  current = { food: null, portion: 1, thumb: null };
  $("preview").hidden = true;
  $("analyzing").hidden = true;
  $("suggestBlock").hidden = true;
  $("chosen").hidden = true;
  $("foodSearch").value = "";
  $("searchResults").innerHTML = "";
  ["cName", "cCal", "cPro", "cFib"].forEach((id) => ($(id).value = ""));
  document.querySelector(".custom").open = false;
  setPortion(1);
}

function setPortion(p) {
  current.portion = p;
  document.querySelectorAll("#portions button").forEach((b) => b.classList.toggle("active", Number(b.dataset.p) === p));
  updateNutri();
}

function updateNutri() {
  const f = current.food;
  if (!f) return;
  $("nCal").textContent = Math.round(f.cal * current.portion);
  $("nPro").textContent = fmt(f.protein * current.portion);
  $("nFib").textContent = fmt(f.fiber * current.portion);
}

function choose(food) {
  if (!food) return;
  current.food = food;
  $("chosen").hidden = false;
  $("chosenEmoji").textContent = food.emoji;
  $("chosenName").textContent = food.name;
  $("chosenServing").textContent = `1× = ${food.serving}`;
  updateNutri();
}

$("portions").addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (b) setPortion(Number(b.dataset.p));
});

$("foodSearch").addEventListener("input", () => {
  const q = $("foodSearch").value.trim().toLowerCase();
  if (!q) { $("searchResults").innerHTML = ""; return; }
  const hits = FOODS.filter((f) => f.name.includes(q)).slice(0, 12);
  $("searchResults").innerHTML = hits.length
    ? hits.map((f) => `<li><button data-name="${esc(f.name)}"><span>${f.emoji}</span>${esc(f.name)}<span class="sr-cal">${f.cal} kcal · ${esc(f.serving)}</span></button></li>`).join("")
    : `<li class="muted small" style="padding:8px">No match. Use “Enter values yourself” below.</li>`;
});

$("searchResults").addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
  choose(FOODS.find((f) => f.name === b.dataset.name));
  $("searchResults").innerHTML = "";
  $("foodSearch").value = "";
});

function addEntry(entry) {
  const key = viewKey();
  (state.days[key] ||= []).push({
    id: Math.random().toString(36).slice(2, 10),
    time: Date.now(),
    ...entry,
  });
  save();
  closeSheet("addSheet");
  render();
  toast(`Added ${entry.name} · ${Math.round(entry.cal)} kcal`);
}

$("addConfirm").onclick = () => {
  const f = current.food;
  if (!f) return;
  const p = current.portion;
  addEntry({ name: f.name, emoji: f.emoji, portion: p, cal: f.cal * p, protein: round1(f.protein * p), fiber: round1(f.fiber * p), thumb: current.thumb });
};

$("customAdd").onclick = () => {
  const name = $("cName").value.trim();
  const cal = parseFloat($("cCal").value);
  if (!name || !(cal >= 0)) { toast("Add a name and calories."); return; }
  addEntry({ name, emoji: "🍽️", portion: 1, cal, protein: parseFloat($("cPro").value) || 0, fiber: parseFloat($("cFib").value) || 0, thumb: current.thumb });
};

$("addClose").onclick = () => closeSheet("addSheet");
$("searchBtn").onclick = () => { resetAddSheet(); openSheet("addSheet"); setTimeout(() => $("foodSearch").focus(), 50); };

/* ---------------- Images ---------------- */
function resize(source, w, h, max, quality = 0.85) {
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

function squareThumb(source, w, h, size = 96) {
  const s = Math.min(w, h);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d").drawImage(source, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.7);
}

function handleImage(source, w, h) {
  resetAddSheet();
  const full = resize(source, w, h, 512);
  current.thumb = squareThumb(source, w, h);
  $("preview").src = full;
  $("preview").hidden = false;
  openSheet("addSheet");
  recognize(full);
}

function handleFile(file) {
  if (!file) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => { handleImage(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(url); };
  img.onerror = () => toast("That file doesn't look like an image.");
  img.src = url;
}

$("fileInput").onchange = (e) => { handleFile(e.target.files[0]); e.target.value = ""; };
$("uploadInput").onchange = (e) => { handleFile(e.target.files[0]); e.target.value = ""; };
$("uploadBtn").onclick = () => $("uploadInput").click();

/* ---------------- Camera ---------------- */
let stream = null;
let facing = "environment";

async function startCamera() {
  stopCamera();
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false });
  $("video").srcObject = stream;
}
function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

$("snapBtn").onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia) { $("fileInput").click(); return; }
  try {
    openSheet("cameraSheet");
    await startCamera();
  } catch (err) {
    console.warn(err);
    closeSheet("cameraSheet");
    $("fileInput").click(); // fall back to the phone's own camera / file picker
  }
};
$("cameraFlip").onclick = async () => {
  facing = facing === "environment" ? "user" : "environment";
  try { await startCamera(); } catch { toast("Couldn't switch camera."); }
};
$("cameraCancel").onclick = () => { stopCamera(); closeSheet("cameraSheet"); };
$("shutter").onclick = () => {
  const v = $("video");
  if (!v.videoWidth) return;
  const c = document.createElement("canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  stopCamera();
  closeSheet("cameraSheet");
  handleImage(c, c.width, c.height);
};

/* ---------------- Goals ---------------- */
$("openSettings").onclick = () => {
  $("goalCal").value = state.goals.cal;
  $("goalPro").value = state.goals.protein;
  $("goalFib").value = state.goals.fiber;
  openSheet("settingsSheet");
};
$("settingsClose").onclick = () => closeSheet("settingsSheet");
$("saveGoals").onclick = () => {
  const cal = Math.round(parseFloat($("goalCal").value));
  const protein = Math.round(parseFloat($("goalPro").value));
  const fiber = Math.round(parseFloat($("goalFib").value));
  if (!(cal > 0)) { toast("Set a calorie goal above 0."); return; }
  state.goals = { cal, protein: protein >= 0 ? protein : 0, fiber: fiber >= 0 ? fiber : 0 };
  save();
  closeSheet("settingsSheet");
  render();
  toast("Goals saved");
};
$("clearDay").onclick = () => {
  if (!entries().length) { toast("Nothing to clear."); return; }
  delete state.days[viewKey()];
  save();
  closeSheet("settingsSheet");
  render();
  toast("Day cleared");
};

// Close sheets by tapping the dark background
document.querySelectorAll(".sheet-backdrop").forEach((bd) =>
  bd.addEventListener("click", (e) => {
    if (e.target !== bd) return;
    if (bd.id === "cameraSheet") stopCamera();
    closeSheet(bd.id);
  })
);

// Keep "Today" correct if the app is left open past midnight
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

render();
