/* ===================================================================
   classifier.js – tải mô hình và dự đoán (phần AI của giao diện)
   =================================================================== */
const Classifier = {
  model: null,

  get ready() { return this.model !== null; },

  async load() {
    await tf.ready();
    this.model = await tf.loadLayersModel(CONFIG.MODEL_URL + "?v=" + Date.now());
    // Chạy thử 1 lần để lần dự đoán đầu không bị giật
    tf.tidy(() => { this.model.predict(tf.zeros([2, CONFIG.IMG_SIZE, CONFIG.IMG_SIZE, 3])).dataSync(); });
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

  /**
   * source: <video>, <canvas> hoặc <img>.
   * boxes: các vùng cắt [y1, x1, y2, x2] (tỉ lệ 0..1). Mỗi vùng được dự đoán
   *        cả bản gốc lẫn bản lật ngang, rồi lấy trung bình (test-time augmentation).
   * Trả về { probs: mảng xác suất theo CONFIG.CLASSES, brightness: độ sáng trung bình 0..255 }
   */
  predict(source, boxes = [[0, 0, 1, 1]]) {
    const { w, h } = this.sizeOf(source);
    if (!w || !h) return null;
    const S = CONFIG.IMG_SIZE;
    return tf.tidy(() => {
      const img = tf.browser.fromPixels(source).toFloat().expandDims(0);
      const crops = tf.image.cropAndResize(img, boxes, new Array(boxes.length).fill(0), [S, S], "bilinear");
      const brightness = crops.slice([0, 0, 0, 0], [1, S, S, 3]).mean().dataSync()[0];
      const batch = this.normalize(tf.concat([crops, tf.image.flipLeftRight(crops)], 0));
      let out = this.model.predict(batch);
      if (Array.isArray(out)) out = out[0];
      const probs = Array.from(out.mean(0).dataSync());
      const sum = probs.reduce((a, b) => a + b, 0) || 1;
      return { probs: probs.map(v => v / sum), brightness };
    });
  },

  /** Xác suất giả, chỉ để xem thử giao diện khi chưa có model */
  demo() {
    const k = Math.floor(Date.now() / 3000) % CONFIG.CLASSES.length;
    const p = CONFIG.CLASSES.map((_, i) => (i === k ? 0.75 + Math.random() * 0.2 : Math.random() * 0.05));
    const s = p.reduce((a, b) => a + b, 0);
    return { probs: p.map(v => v / s), brightness: 128 };
  }
};
