# First Impression Engine — FIE-01

A local, in-browser audit of how a photo presents. Scores the **photo** — its light,
framing, expression and context — never the person in it.

**Live:** https://lucianbrn.github.io

- No image data is uploaded or transmitted. All analysis runs in the visitor's browser.
- The score is a Photo Presentation Score, always shown as a range with the full
  point build-up published in the Findings tab.
- Face detection uses MediaPipe Tasks Vision (pinned v0.10.14). The JS bundle and
  WASM loaders are vendored in `vendor/`; the binary model files load from the
  pinned public mirror of the same version, with vendored copies as fallback.
- Hand-written HTML/CSS/JS. No framework, no build step.
