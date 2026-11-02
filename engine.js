/* First Impression Engine — core analysis (hand-written, no framework).
   Everything runs locally. Score = Photo Presentation Score (presentation only,
   never a rating of the person). Formula published in BUILD-SPEC.md v2. */
'use strict';

/* ---------- image measurement (canvas pixel stats) ---------- */
function measureImage(img) {
  const MAX = 480;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(2, Math.round(img.naturalWidth * scale));
  const h = Math.max(2, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  let blown = 0, crushed = 0, sum = 0;
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const L = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
    lum[i] = L; sum += L;
    if (L >= 250) blown++;
    if (L <= 6) crushed++;
  }
  const mean = sum / lum.length;
  let sd = 0; for (let i = 0; i < lum.length; i++) sd += (lum[i] - mean) * (lum[i] - mean);
  sd = Math.sqrt(sd / lum.length);
  // sharpness: mean absolute horizontal+vertical gradient (edge energy)
  let grad = 0, n = 0;
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = y * w + x;
    grad += Math.abs(lum[i] - lum[i + 1]) + Math.abs(lum[i] - lum[i + w]); n += 2;
  }
  return {
    w, h, lum,
    blownPct: +(100 * blown / lum.length).toFixed(2),
    crushedPct: +(100 * crushed / lum.length).toFixed(2),
    meanLum: +mean.toFixed(1), contrast: +sd.toFixed(1),
    sharpness: +(grad / n).toFixed(2),
  };
}

/* face-region stats from a normalised box {x,y,w,h} in 0..1 coords */
function faceStats(m, box) {
  if (!box) return null;
  const x0 = Math.floor(box.x * m.w), x1 = Math.ceil((box.x + box.w) * m.w);
  const y0 = Math.floor(box.y * m.h), y1 = Math.ceil((box.y + box.h) * m.h);
  let blown = 0, tot = 0, sumL = 0, sumR = 0, nL = 0, nR = 0;
  const midX = (x0 + x1) / 2;
  for (let y = y0; y < y1 && y < m.h; y++) for (let x = x0; x < x1 && x < m.w; x++) {
    const L = m.lum[y * m.w + x]; tot++;
    if (L >= 250) blown++;
    if (x < midX) { sumL += L; nL++; } else { sumR += L; nR++; }
  }
  if (!tot) return null;
  const meanL = sumL / Math.max(1, nL), meanR = sumR / Math.max(1, nR);
  return {
    blownPct: +(100 * blown / tot).toFixed(2),
    mean: +((meanL + meanR) / 2).toFixed(1),
    split: +Math.abs(meanL - meanR).toFixed(1),
    faceWidthPct: +(100 * box.w).toFixed(1),
    headroomPct: +(100 * box.y).toFixed(1),
    centerOffsetPct: +(100 * Math.abs((box.x + box.w / 2) - 0.5)).toFixed(1),
  };
}

/* ---------- scoring: published formula, cluster caps, no double-count ---------- */
const BANDS = [[85, 'Exceptional'], [70, 'Strong'], [55, 'Mixed'], [40, 'Taxed'], [0, 'Working against you']];
function bandOf(v) { for (const [t, n] of BANDS) if (v >= t) return n; return 'Working against you'; }
function spannedLabel(lo, hi) {
  const a = bandOf(lo), b = bandOf(hi);
  return a === b ? a : a + '–' + b;
}

function scorePhoto(m, f, ctx, expr, detection) {
  /* ctx: {audience:'story'|'dating'|'public', takenBy:'selfie'|'timer'|'someone'|'unknown',
          setting:'car'|'indoors'|'outdoors'|'unknown', sticker:'none'|'hook'|'romantic'|'unknown'}
     expr: {mouth:'flat'|'slight'|'open', eyes:'open'|'squint'|'closed', source:'landmarks'|'toggles'} */
  const items = []; // {cluster, label, pts, strength}
  const add = (cluster, label, pts, strength) => items.push({ cluster, label, pts, strength });

  /* Capture (cap -10) */
  let cap = 0;
  if (ctx.takenBy === 'selfie') { cap = -8; add('Capture', 'Selfie capture', -8, 'peer-reviewed'); }
  else if (ctx.takenBy === 'timer') { cap = -3; add('Capture', 'Timer / tripod capture', -3, 'inference'); }
  else add('Capture', ctx.takenBy === 'someone' ? 'Taken by someone else' : 'Who took it — not provided', 0, 'measured');

  /* Framing (cap -18) — only when a face box exists */
  let frame = 0;
  if (f) {
    if (f.faceWidthPct > 38) { frame += -10; add('Framing', 'Close-crop risk — face ' + f.faceWidthPct + '% of frame width', -10, 'inference'); }
    else if (f.faceWidthPct >= 30) { frame += -5; add('Framing', 'Tight crop — face ' + f.faceWidthPct + '% of frame width', -5, 'inference'); }
    else add('Framing', 'Face scale — ' + f.faceWidthPct + '% of frame width', 0, 'measured');
    if (f.headroomPct < 4) { frame += -4; add('Framing', 'Headroom under 4%', -4, 'measured'); }
    else add('Framing', 'Headroom — ' + f.headroomPct + '%', 0, 'measured');
    if (f.faceWidthPct < 12) { frame += -6; add('Framing', 'Subject small in frame — ' + f.faceWidthPct + '%', -6, 'measured'); }
    if (f.centerOffsetPct > 30) { frame += -3; add('Framing', 'Face far off-centre', -3, 'measured'); }
    frame = Math.max(frame, -18);
  } else {
    add('Framing', 'No face box — framing not scored', 0, 'unknown');
  }

  /* Light (cap -20) */
  let light = 0;
  const blownRef = f ? f.blownPct : m.blownPct;
  const blownPts = blownRef <= 1 ? 0 : Math.max(-10, -Math.round((blownRef - 1) * 1.2));
  if (blownPts) { light += blownPts; add('Light', 'Blown highlights — ' + blownRef + '% clipped', blownPts, 'measured'); }
  else add('Light', 'Blown highlights — ' + blownRef + '% clipped', 0, 'measured');
  if (f && f.split > 42) { light += -6; add('Light', 'Harsh light split across the face', -6, 'measured'); }
  else add('Light', 'Light split across the face — ' + (f ? f.split : 'n/a'), 0, 'measured');
  const faceMean = f ? f.mean : m.meanLum;
  if (faceMean < 70) { light += -6; add('Light', 'Face underexposed vs the frame', -6, 'measured'); }
  else add('Light', 'Face exposure', 0, 'measured');
  light = Math.max(light, -20);

  /* Sharpness (cap -8) */
  let sharp = 0;
  if (m.sharpness < 7) { sharp = Math.max(-8, -Math.round((7 - m.sharpness) * 2)); add('Sharpness', 'Softness — cause unknown (motion, focus, or depth)', sharp, 'measured'); }
  else add('Sharpness', 'Edge detail', 0, 'measured');

  /* Expression (cap: story/public -6, dating -12) */
  let exprPts = 0; const cold = ctx.audience === 'dating';
  if (expr.mouth === 'flat') {
    exprPts = cold ? -10 : -5;
    add('Expression', 'Flat mouth + direct gaze', exprPts, 'industry');
  } else add('Expression', expr.mouth === 'slight' ? 'Slight closed-mouth smile' : 'Open smile', 0, expr.source === 'landmarks' ? 'measured' : 'inference');
  if (expr.eyes === 'squint') { exprPts += -3; add('Expression', 'Squinted eyes', -3, 'measured'); }
  if (expr.eyes === 'closed') { exprPts += -4; add('Expression', 'Eyes closed / covered', -4, 'measured'); }
  exprPts = Math.max(exprPts, cold ? -12 : -6);

  /* Context (cap -8) — inference only, never more */
  let context = 0;
  if (ctx.setting === 'car') { context += -4; add('Context', 'Car interior setting', -4, 'industry'); }
  else add('Context', 'Setting — ' + ctx.setting, 0, 'inference');
  if (ctx.sticker === 'romantic' && cold) { context += -4; add('Context', 'Romantic / yearning lyric shown to a cold audience', -4, 'inference'); }
  else add('Context', 'Music sticker — ' + ctx.sticker, 0, 'inference');
  context = Math.max(context, -8);

  const total = cap + frame + light + sharp + exprPts + context;
  const centre = Math.max(5, Math.min(97, 82 + total));

  /* range width: published design rule, not a confidence interval */
  let half = 5; const widthItems = [{ label: 'Base width', pts: 5 }];
  if (expr.source === 'toggles') { half += 4; widthItems.push({ label: 'Expression set by controls, not landmarks', pts: 4 }); }
  const unknowns = [ctx.takenBy, ctx.setting, ctx.sticker].filter(v => v === 'unknown').length;
  if (unknowns) { half += 3; widthItems.push({ label: 'Context not provided', pts: 3 }); }
  if (!f || detection === 'marked' || detection === 'none') { half += 3; widthItems.push({ label: detection === 'marked' ? 'Face box marked by hand' : 'No face box', pts: 3 }); }

  const lo = Math.max(1, centre - half), hi = Math.min(100, centre + half);
  return { centre, lo, hi, total, items, widthItems, label: spannedLabel(lo, hi),
           clusters: { Capture: cap, Framing: frame, Light: light, Sharpness: sharp, Expression: exprPts, Context: context } };
}

/* ---------- vibe: explicit rules tree, reads of the POST, never the person ---------- */
function vibeReads(s, ctx, f) {
  const know = [], cold = [];
  const flat = s.clusters.Expression <= -5;
  if (flat) { cold.push(['Reads distant / hard to approach', 'flat expression held at the camera']); know.push(['Reads quiet / low-key', 'people who know you fill in the warmth the frame withholds']); }
  if (ctx.takenBy === 'selfie') cold.push(['May read as posted for reaction', 'a solo selfie has no occasion attached']);
  if (ctx.setting === 'car') cold.push(['May read as low-effort', 'the driver-seat is the most-used backdrop there is']);
  if (ctx.sticker === 'romantic') cold.push(['May read as in-his-feelings', 'a yearning lyric over a solo portrait']);
  if (s.clusters.Light <= -8) cold.push(['May read as careless', 'the light is visibly fighting the subject']);
  if (s.centre >= 70) { know.push(['Reads confident and put-together', 'light, framing and expression are working together']); cold.push(['Reads confident', 'the presentation holds up cold']); }
  if (!cold.length) cold.push(['No strong negative read triggered', 'nothing in the measured set stacks against it']);
  if (!know.length) know.push(['Reads as a clean, ordinary post', 'no strong signal either way']);
  return { know, cold };
}

function verdictHeadline(s, ctx) {
  const worst = Object.entries(s.clusters).sort((a, b) => a[1] - b[1])[0];
  if (s.centre >= 78) return 'The frame is doing its job.';
  if (worst[0] === 'Light') return 'Good subject. Hostile light.';
  if (worst[0] === 'Framing') return 'Good face. Careless frame.';
  if (worst[0] === 'Expression') return 'The expression is withholding the photo.';
  if (worst[0] === 'Capture' || worst[0] === 'Context') return 'The format is doing the damage.';
  return 'A mixed frame with one clear fix.';
}

window.FIE = { measureImage, faceStats, scorePhoto, vibeReads, verdictHeadline, bandOf };
