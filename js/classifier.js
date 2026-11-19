/* ===================================================================
   classifier.js – Kết hợp MobileNetV2 (TrashNet) + COCO-SSD + ImageNet
   =================================================================== */
const Classifier = {
  model: null,
  detector: null,
  imagenet: null,
  _canvas: null,

  get ready() { return this.model !== null; },

  async load() {
    await tf.ready();
    const tasks = [
      tf.loadLayersModel(CONFIG.MODEL_URL + "?v=" + Date.now()).then(m => {
        this.model = m;
        tf.tidy(() => { this.model.predict(tf.zeros([2, CONFIG.IMG_SIZE, CONFIG.IMG_SIZE, 3])).dataSync(); });
      }),
      typeof cocoSsd !== "undefined"
        ? cocoSsd.load().then(d => { this.detector = d; }).catch(() => {})
        : Promise.resolve(),
      typeof mobilenet !== "undefined"
        ? mobilenet.load({ version: 2, alpha: 1.0 }).then(m => { this.imagenet = m; }).catch(() => {})
        : Promise.resolve()
    ];
    await Promise.all(tasks);
    if (!this.model) throw new Error("Không tải được mô hình chính");
  },

  /** Kích thước thật của nguồn ảnh (video/canvas/img) */
  sizeOf(source) {
    const w = source.videoWidth || source.naturalWidth || source.width || 0;
    const h = source.videoHeight || source.naturalHeight || source.height || 0;
    return { w, h };
  },

  /** Chuẩn hóa ảnh giống lúc huấn luyện */
  normalize(x) {
    return CONFIG.PREPROCESS === "01" ? x.div(255) : x.div(127.5).sub(1);
  },

  /** Ánh xạ nhãn ImageNet sang đúng thứ tự 6 lớp TrashNet */
  mapImageNet(preds) {
    const scores = [0, 0, 0, 0, 0, 0];
    const rules = [
      [0, ["carton", "crate", "packet"]],
      [1, ["wine bottle", "beer bottle", "beer glass", "goblet", "perfume", "beaker", "vase", "pitcher", "hourglass"]],
      [2, ["can opener", "milk can", "frying pan", "wok", "cleaver", "ladle", "screw", "padlock", "safety pin", "whistle", "cocktail shaker", "coffee pot", "teapot", "strainer", "bottlecap", "scissors", "wrench", "hammer", "screwdriver", "ashcan", "oil filter", "hair spray", "lighter"]],
      [3, ["envelope", "paper towel", "toilet tissue", "book jacket", "comic book", "menu", "binder", "notebook", "origami", "crossword puzzle"]],
      [4, ["water bottle", "plastic bag", "pop bottle", "soda bottle", "pill bottle", "water jug", "lotion", "soap dispenser", "bucket", "pail", "measuring cup", "shopping basket", "washbasin"]],
      [5, ["diaper", "banana", "orange", "lemon", "pizza", "cheeseburger", "hotdog", "burrito", "band aid"]]
    ];
    for (let i = 0; i < preds.length; i++) {
      const name = preds[i].className.toLowerCase();
      const p = preds[i].probability;
      for (let r = 0; r < rules.length; r++) {
        const idx = rules[r][0];
        const keys = rules[r][1];
        let matched = false;
        for (let k = 0; k < keys.length; k++) {
          if (name.indexOf(keys[k]) !== -1) {
            scores[idx] += p;
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
    }
    return scores;
  },

  /** Cắt vùng vật thể vào canvas 224x224 dùng chung để giảm tốn bộ nhớ */
  cropToCanvas(source, box, w, h) {
    if (!this._canvas) {
      this._canvas = document.createElement("canvas");
      this._canvas.width = CONFIG.IMG_SIZE;
      this._canvas.height = CONFIG.IMG_SIZE;
    }
    const ctx = this._canvas.getContext("2d");
    const sx = box[1] * w;
    const sy = box[0] * h;
    const sw = Math.max(1, (box[3] - box[1]) * w);
    const sh = Math.max(1, (box[2] - box[0]) * h);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, this._canvas.width, this._canvas.height);
    return this._canvas;
  },

  async predict(source, boxes = [[0, 0, 1, 1]]) {
    const { w, h } = this.sizeOf(source);
    if (!w || !h) return null;

    let useBoxes = boxes;
    let mainBox = boxes[0];

    // 1. Dùng COCO-SSD tự động tìm và cắt sát vật thể (bỏ qua người)
    if (this.detector) {
      try {
        const dets = await this.detector.detect(source);
        const filtered = dets.filter(d => d.class !== "person" && d.score >= 0.35);
        if (filtered.length > 0) {
          filtered.sort((a, b) => b.score - a.score);
          const b = filtered[0].bbox;
          const padX = b[2] * 0.08;
          const padY = b[3] * 0.08;
          const x1 = Math.max(0, (b[0] - padX) / w);
          const y1 = Math.max(0, (b[1] - padY) / h);
          const x2 = Math.min(1, (b[0] + b[2] + padX) / w);
          const y2 = Math.min(1, (b[1] + b[3] + padY) / h);
          if (x2 > x1 && y2 > y1) {
            mainBox = [y1, x1, y2, x2];
            useBoxes = [mainBox];
          }
        }
      } catch (e) {}
    }

    // 2. Chạy mô hình MobileNetV2 fine-tuned (TrashNet) của nhóm + TTA lật ngang
    const S = CONFIG.IMG_SIZE;
    const baseResult = tf.tidy(() => {
      const img = tf.browser.fromPixels(source).toFloat().expandDims(0);
      const crops = tf.image.cropAndResize(img, useBoxes, new Array(useBoxes.length).fill(0), [S, S], "bilinear");
      const brightness = crops.slice([0, 0, 0, 0], [1, S, S, 3]).mean().dataSync()[0];
      const batch = this.normalize(tf.concat([crops, tf.image.flipLeftRight(crops)], 0));
      let out = this.model.predict(batch);
      if (Array.isArray(out)) out = out[0];
      const probs = Array.from(out.mean(0).dataSync());
      const sum = probs.reduce((a, b) => a + b, 0) || 1;
      return { probs: probs.map(v => v / sum), brightness };
    });

    let finalProbs = baseResult.probs;

    // 3. Phối hợp xác suất (ensemble) với MobileNetV2 ImageNet khi nhận diện rõ vật thể
    if (this.imagenet) {
      try {
        const cropped = this.cropToCanvas(source, mainBox, w, h);
        const inetPreds = await this.imagenet.classify(cropped, 5);
        const inetScores = this.mapImageNet(inetPreds);
        const inetSum = inetScores.reduce((a, b) => a + b, 0);
        if (inetSum >= 0.15) {
          const inetNorm = inetScores.map(v => v / inetSum);
          const alpha = Math.min(0.78, inetSum * 0.95);
          finalProbs = finalProbs.map((v, i) => (1 - alpha) * v + alpha * inetNorm[i]);
          const s = finalProbs.reduce((a, b) => a + b, 0) || 1;
          finalProbs = finalProbs.map(v => v / s);
        }
      } catch (e) {}
    }

    return { probs: finalProbs, brightness: baseResult.brightness };
  },

  /** Xác suất giả, chỉ để xem thử giao diện khi chưa có model */
  demo() {
    const k = Math.floor(Date.now() / 3000) % CONFIG.CLASSES.length;
    const p = CONFIG.CLASSES.map((_, i) => (i === k ? 0.75 + Math.random() * 0.2 : Math.random() * 0.05));
    const s = p.reduce((a, b) => a + b, 0);
    return { probs: p.map(v => v / s), brightness: 128 };
  }
};
