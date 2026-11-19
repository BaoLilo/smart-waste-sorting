/* ===================================================================
   app.js – camera, giao diện, thống kê, lịch sử, cài đặt
   =================================================================== */
const $ = id => document.getElementById(id);
const { CLASSES, SMOOTH, STABLE_FRAMES, INTERVAL_MS } = CONFIG;
const HISTORY_SIZE = 5;
const UNSURE = "__unsure__";

const video = $("video"), photo = $("photo"), stage = $("stage");
const state = {
  stream: null, running: false, facing: "environment",
  lastRun: 0, lastFrame: 0, loopId: 0, busy: false,
  buffer: [],
  predictionHistory: [],
  stableLabel: null, stableCount: 0, locked: false,
  counts: Object.fromEntries(CLASSES.map(c => [c, 0])),
  history: []
};

/* ---------- Lưu cài đặt (không bắt buộc, lỗi thì bỏ qua) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("sws_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("sws_" + k, JSON.stringify(v)); } catch {} }
};
function clampThreshold(v) {
  v = Number(v);
  return Number.isFinite(v) ? Math.min(95, Math.max(30, Math.round(v / 5) * 5)) : CONFIG.DEFAULT_THRESHOLD;
}
const settings = {
  threshold: clampThreshold(store.get("threshold_v2", CONFIG.DEFAULT_THRESHOLD)),
  mirror: store.get("mirror", false),
  speak: store.get("speak", false),
  demo: false,
  theme: store.get("theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
};

/* ---------- Dựng giao diện từ cấu hình ---------- */
function buildBars(el, prefix) {
  el.innerHTML = CLASSES.map(c => `
    <div class="row"><span>${INFO[c].vi}</span>
      <div class="track"><div class="fill" id="${prefix}f-${c}" style="background:${INFO[c].color}"></div></div>
      <b id="${prefix}p-${c}">0${prefix ? "" : "%"}</b></div>`).join("");
}
buildBars($("bars"), "");
buildBars($("counts"), "c");

$("guideGrid").innerHTML = CLASSES.map(c => `
  <article class="guide" style="--c:${INFO[c].color}">
    <header><b>${INFO[c].vi}</b><span>${c}</span></header>
    <div class="body">
      <div><b>Bỏ vào:</b> ${INFO[c].bin}</div>
      <div><b>Ví dụ:</b> ${INFO[c].examples}</div>
      <p>${INFO[c].tip}</p>
    </div>
  </article>`).join("");

/* ---------- Tiện ích ---------- */
function setStatus(kind, text) { $("dot").className = "dot " + kind; $("statusText").textContent = text; }
let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  store.set("theme", settings.theme);
}
function applySettings() {
  $("threshold").value = settings.threshold;
  $("thVal").textContent = settings.threshold + "%";
  $("mirror").checked = settings.mirror;
  $("speak").checked = settings.speak;
  $("demo").checked = settings.demo;
  stage.classList.toggle("mirror", settings.mirror);
}

/* ---------- Tabs ---------- */
document.querySelectorAll(".tabs [role=tab]").forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll(".tabs [role=tab]").forEach(t => {
      const on = t === tab;
      t.setAttribute("aria-selected", on);
      $(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (tab.id !== "tab-detect" && state.running) stopCamera();
  };
});

/* ---------- Camera ---------- */
async function startCamera() {
  try {
    stopCamera();
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facing, width: { ideal: 960 }, height: { ideal: 720 } }, audio: false
    });
    video.srcObject = state.stream; await video.play();
    state.buffer = [];
    photo.hidden = true; video.hidden = false; $("empty").hidden = true;
    state.running = true; stage.classList.add("running");
    $("startBtn").disabled = true; $("stopBtn").disabled = false; $("flipBtn").disabled = false;
    resetPredictionHistory();
    resetStable();
    const id = ++state.loopId;
    requestAnimationFrame(ts => loop(ts, id));
  } catch (err) {
    stopCamera();
    $("empty").hidden = false;
    $("empty").textContent = err.name === "NotAllowedError"
      ? "Trình duyệt đang chặn camera. Hãy cho phép camera trong thanh địa chỉ rồi thử lại."
      : "Không mở được camera. Kiểm tra thiết bị có webcam và trang đang chạy qua https hoặc localhost.";
  }
}
function stopCamera() {
  state.running = false; state.loopId++; stage.classList.remove("running");
  resetPredictionHistory();
  if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
  video.hidden = true;
  $("startBtn").disabled = false; $("stopBtn").disabled = true; $("flipBtn").disabled = true;
}
function toggleCamera() { state.running ? stopCameraWithMessage() : startCamera(); }
function stopCameraWithMessage() {
  stopCamera();
  if (photo.hidden) { $("empty").hidden = false; $("empty").textContent = "Camera đã dừng. Bấm “Bắt đầu” để tiếp tục."; }
}

/* ---------- Dự đoán ---------- */
function smooth(p) {
  state.buffer.push(p); if (state.buffer.length > SMOOTH) state.buffer.shift();
  return CLASSES.map((_, i) => state.buffer.reduce((a, b) => a + b[i], 0) / state.buffer.length);
}
function getSmoothResult(historyArray) {
  if (historyArray.length < Math.ceil(HISTORY_SIZE / 2)) return null;
  const counts = {};
  let maxCount = 0, mostFrequent = null;
  for (const item of historyArray) {
    counts[item] = (counts[item] || 0) + 1;
    if (counts[item] > maxCount) { maxCount = counts[item]; mostFrequent = item; }
  }
  return maxCount >= Math.ceil(HISTORY_SIZE / 2) && mostFrequent !== UNSURE ? mostFrequent : null;
}
function resetPredictionHistory() {
  state.predictionHistory = [];
}
/** Sắp xếp xác suất: trả về chỉ số loại cao nhất, xác suất cao nhất và khoảng cách với loại thứ hai */
function topOf(p) {
  let best = 0, second = -1;
  p.forEach((v, i) => {
    if (v > p[best]) { second = best; best = i; }
    else if (i !== best && (second < 0 || v > p[second])) second = i;
  });
  const top = p[best], margin = top - (second >= 0 ? p[second] : 0);
  return { best, top, margin };
}
/** Đủ chắc chắn khi: vượt ngưỡng tin cậy VÀ bỏ xa loại đứng thứ hai */
function isConfident(p) {
  const { top, margin } = topOf(p);
  return top >= settings.threshold / 100 && margin >= CONFIG.MIN_MARGIN;
}
function resetStable() {
  state.stableLabel = null; state.stableCount = 0; state.locked = false;
  $("holdWrap").hidden = true; $("holdBar").style.width = "0";
  document.querySelector(".reticle").classList.remove("locked");
}

function renderBars(p) {
  CLASSES.forEach((c, i) => {
    $("f-" + c).style.width = (p[i] * 100).toFixed(0) + "%";
    $("p-" + c).textContent = (p[i] * 100).toFixed(0) + "%";
  });
}
function showUnsure(p, hint) {
  const { best, top } = topOf(p);
  $("result").style.setProperty("--bin", "#6b7b79");
  $("rName").textContent = "Chưa chắc chắn";
  $("rBin").textContent = hint || "Đưa vật vào giữa khung, lại gần hơn, giữ yên và đảm bảo đủ sáng.";
  $("rConf").textContent = `Cao nhất: ${(top * 100).toFixed(0)}% (${INFO[CLASSES[best]].vi})`;
}
function showResult(label, conf) {
  const info = INFO[label];
  $("result").style.setProperty("--bin", info.color);
  $("rName").textContent = info.vi;
  $("rBin").textContent = info.bin;
  $("rConf").textContent = "Độ tin cậy: " + (conf * 100).toFixed(1) + "%";
}

/** Camera: kết quả phải ổn định qua nhiều khung mới được chốt */
function render(p, hint) {
  renderBars(p);
  const { best } = topOf(p);
  state.predictionHistory.push(!hint && isConfident(p) ? CLASSES[best] : UNSURE);
  if (state.predictionHistory.length > HISTORY_SIZE) state.predictionHistory.shift();

  const finalResult = getSmoothResult(state.predictionHistory);
  if (!finalResult) { showUnsure(p, hint); resetStable(); return; }
  const conf = p[CLASSES.indexOf(finalResult)];
  showResult(finalResult, conf);
  trackStable(finalResult, conf);
}

/** Ảnh tải lên: chỉ có 1 khung nên quyết định ngay */
function renderStill(p, hint) {
  renderBars(p);
  if (hint || !isConfident(p)) { showUnsure(p, hint || "Ảnh chưa đủ rõ. Hãy chụp vật ở giữa ảnh, nền đơn giản và đủ sáng."); return; }
  const { best, top } = topOf(p);
  showResult(CLASSES[best], top);
  confirmItem(CLASSES[best], top);
}

/* Giữ yên cùng một loại đủ lâu thì mới ghi nhận */
function trackStable(c, conf) {
  if (c !== state.stableLabel) { resetStable(); state.stableLabel = c; }
  if (state.locked) return;
  state.stableCount++;
  $("holdWrap").hidden = false;
  $("holdBar").style.width = Math.min(100, state.stableCount / STABLE_FRAMES * 100) + "%";
  if (state.stableCount >= STABLE_FRAMES) {
    state.locked = true;
    document.querySelector(".reticle").classList.add("locked");
    confirmItem(c, conf);
  }
}

function confirmItem(c, conf) {
  state.counts[c]++;
  state.history.unshift({ time: new Date(), label: c, conf });
  renderStats(); renderHistory();
  toast("Đã ghi nhận: " + INFO[c].vi);
  if (settings.speak && "speechSynthesis" in window) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(INFO[c].vi + ". " + INFO[c].bin);
    u.lang = "vi-VN"; speechSynthesis.speak(u);
  }
}

function renderStats() {
  const total = CLASSES.reduce((a, c) => a + state.counts[c], 0);
  $("totalCount").textContent = total + " vật";
  CLASSES.forEach(c => {
    $("cf-" + c).style.width = (total ? state.counts[c] / total * 100 : 0) + "%";
    $("cp-" + c).textContent = state.counts[c];
  });
}
function renderHistory() {
  const ul = $("hist");
  if (!state.history.length) {
    ul.innerHTML = '<li class="placeholder"><span>Giữ vật yên khoảng 1 giây để hệ thống ghi nhận.</span></li>';
    return;
  }
  ul.innerHTML = state.history.slice(0, 40).map(h => `
    <li style="--c:${INFO[h.label].color}"><span>${INFO[h.label].vi}</span>
    <span>${(h.conf * 100).toFixed(0)}% · ${h.time.toLocaleTimeString("vi-VN")}</span></li>`).join("");
}

/** Vùng cắt quanh khung ngắm, tính theo đúng phần video đang hiển thị (object-fit: cover) */
function cameraBox() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const sw = stage.clientWidth || vw, sh = stage.clientHeight || vh;
  const scale = Math.max(sw / vw, sh / vh);
  const visW = Math.min(1, sw / scale / vw), visH = Math.min(1, sh / scale / vh);
  const inset = CONFIG.CROP_INSET;
  const x1 = (1 - visW) / 2 + visW * inset, x2 = 1 - x1;
  const y1 = (1 - visH) / 2 + visH * inset, y2 = 1 - y1;
  return [[y1, x1, y2, x2]];
}
/** Ảnh tĩnh: nhìn toàn ảnh và phần giữa ảnh rồi lấy trung bình */
const STILL_BOXES = [[0, 0, 1, 1], [0.1, 0.1, 0.9, 0.9], [0.2, 0.2, 0.8, 0.8]];

async function runModel(source, boxes) {
  const t0 = performance.now();
  let res = null;
  if (settings.demo || !Classifier.ready) res = Classifier.demo();
  else {
    try { res = await Classifier.predict(source, boxes); }
    catch (err) { console.error("Lỗi khi dự đoán:", err); }
  }
  $("lat").textContent = (performance.now() - t0).toFixed(0);
  return res;
}
function lightHint(res) {
  return res.brightness < CONFIG.MIN_BRIGHTNESS ? "Khung hình quá tối. Hãy bật thêm đèn hoặc đưa vật ra chỗ sáng hơn." : null;
}

async function classify(id) {
  if (state.busy) return;
  state.busy = true;
  try {
    const res = await runModel(video, cameraBox());
    if (!res || !state.running || id !== state.loopId) return;
    render(smooth(res.probs), lightHint(res));
  } finally {
    state.busy = false;
  }
}
async function classifyStill(canvas) {
  const res = await runModel(canvas, STILL_BOXES);
  if (!res) { toast("Không đọc được ảnh, hãy thử ảnh khác"); return; }
  state.buffer = [res.probs];
  renderStill(res.probs, lightHint(res));
}

function loop(ts, id) {
  if (!state.running || id !== state.loopId) return;
  if (!state.busy && ts - state.lastRun >= INTERVAL_MS && video.readyState >= 2 && video.videoWidth > 0) {
    state.lastRun = ts;
    if (state.lastFrame) $("fps").textContent = (1000 / (ts - state.lastFrame)).toFixed(1);
    state.lastFrame = ts;
    classify(id);
  }
  requestAnimationFrame(t => loop(t, id));
}

/* ---------- Sự kiện ---------- */
$("startBtn").onclick = startCamera;
$("stopBtn").onclick = stopCameraWithMessage;
$("flipBtn").onclick = () => { state.facing = state.facing === "environment" ? "user" : "environment"; startCamera(); };

$("file").onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  stopCamera();
  const img = new Image();
  img.onload = () => {
    photo.width = img.naturalWidth; photo.height = img.naturalHeight;
    photo.getContext("2d").drawImage(img, 0, 0);
    photo.hidden = false; $("empty").hidden = true;
    state.buffer = []; resetPredictionHistory(); resetStable();
    URL.revokeObjectURL(img.src);
    // Ảnh tĩnh: ghi nhận ngay, không cần giữ yên
    classifyStill(photo);
  };
  img.onerror = () => { URL.revokeObjectURL(img.src); toast("Không mở được ảnh này"); };
  img.src = URL.createObjectURL(f); e.target.value = "";
};
$("fileLabel").onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } };

$("threshold").oninput = e => {
  settings.threshold = clampThreshold(e.target.value); $("thVal").textContent = settings.threshold + "%";
  store.set("threshold_v2", settings.threshold);
};
$("mirror").onchange = e => { settings.mirror = e.target.checked; stage.classList.toggle("mirror", settings.mirror); store.set("mirror", settings.mirror); };
$("speak").onchange = e => { settings.speak = e.target.checked; store.set("speak", settings.speak); };
$("demo").onchange = e => { settings.demo = e.target.checked; state.buffer = []; resetPredictionHistory(); resetStable(); };

$("themeBtn").onclick = () => { settings.theme = settings.theme === "dark" ? "light" : "dark"; applyTheme(); };
$("fsBtn").onclick = toggleFullscreen;
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (stage.requestFullscreen) stage.requestFullscreen();
}

$("clearBtn").onclick = () => {
  state.history = []; CLASSES.forEach(c => state.counts[c] = 0);
  renderStats(); renderHistory();
};
$("csvBtn").onclick = () => {
  if (!state.history.length) { toast("Chưa có dữ liệu để xuất"); return; }
  const rows = ["thoi_gian,loai,do_tin_cay"].concat(
    state.history.slice().reverse().map(h => `${h.time.toISOString()},${h.label},${h.conf.toFixed(4)}`));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  a.download = "lich-su-phan-loai.csv"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

document.addEventListener("keydown", e => {
  if (e.target.matches("input,textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === "Space") { e.preventDefault(); toggleCamera(); }
  else if (e.key === "f" || e.key === "F") toggleFullscreen();
  else if (e.key === "t" || e.key === "T") $("themeBtn").click();
});
window.addEventListener("beforeunload", stopCamera);

/* ---------- Khởi động ---------- */
applyTheme(); applySettings();
Classifier.load()
  .then(() => setStatus("ok", "Mô hình sẵn sàng"))
  .catch(err => {
    console.error(err);
    settings.demo = true; applySettings();
    setStatus("warn", "Chưa có model/model.json – đang ở chế độ demo");
  });
