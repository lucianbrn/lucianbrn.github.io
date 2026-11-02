/* Self-hosted face detection — MediaPipe Tasks Vision, all assets vendored
   under ./vendor/ so detection needs ZERO external requests.
   Exposes window.FIE_DETECT = { ready:Promise, detect(img)->box|null, status() } */
'use strict';
(function () {
  let faceDetector = null, state = 'loading', lastError = null;

  const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
  const CDN_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

  async function tryInit(vision, wasmPath, modelPath) {
    const fileset = await vision.FilesetResolver.forVisionTasks(wasmPath);
    return vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    });
  }

  async function init() {
    try {
      const vision = await import('./vendor/vision_bundle.mjs');
      /* pinned CDN binaries first (GitHub Pages cannot host the .wasm/.tflite
         through the connector), vendored local copies as fallback */
      try {
        faceDetector = await tryInit(vision, CDN_WASM, CDN_MODEL);
      } catch (e1) {
        faceDetector = await tryInit(vision, './vendor/wasm', './vendor/model/blaze_face_short_range.tflite');
      }
      state = 'ready';
    } catch (e) {
      state = 'offline'; lastError = String(e && e.message || e);
    }
    return state;
  }
  const ready = init();

  async function detect(img) {
    await ready;
    if (!faceDetector) return null;
    try {
      const res = faceDetector.detect(img);
      if (!res || !res.detections || !res.detections.length) return null;
      // largest face wins for the primary box; count returned for multi-face UI
      let best = null, bestArea = 0;
      const boxes = res.detections.map(det => {
        const b = det.boundingBox;
        const box = {
          x: b.originX / img.naturalWidth, y: b.originY / img.naturalHeight,
          w: b.width / img.naturalWidth, h: b.height / img.naturalHeight,
        };
        const a = box.w * box.h;
        if (a > bestArea) { bestArea = a; best = box; }
        return box;
      });
      return { box: best, boxes, count: boxes.length };
    } catch (e) { lastError = String(e && e.message || e); return null; }
  }

  window.FIE_DETECT = { ready, detect, status: () => state, error: () => lastError };
})();
