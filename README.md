# YouTube Volume Normalizer v1.1.0

Chrome Manifest V3 extension that normalizes YouTube playback loudness.

## Features

- K-weighted loudness measurement based on ITU-R BS.1770 concepts.
- 400 ms loudness blocks with 75% overlap.
- Absolute and relative gating.
- Configurable target loudness.
- Automatic gain correction.
- Optional dynamics compressor.
- Final limiter to reduce clipping risk.
- YouTube SPA/navigation detection.
- Popup and options page.
- No external JavaScript or remote code.

## Install for development

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this project directory.
5. Open/reload YouTube.
6. Click the extension icon and press "在目前 YouTube 頁面啟用".

The first activation is intentionally user-triggered so AudioContext can be resumed from a user gesture.

## Package for Chrome Web Store

The ZIP must contain `manifest.json` at its root.

PowerShell, from the parent directory:

```powershell
Compress-Archive -Path .\youtube-volume-normalizer\* -DestinationPath .\youtube-volume-normalizer.zip -Force
```

Do not put the parent folder itself inside the ZIP.

## Important technical note

The loudness meter follows the structure of ITU-R BS.1770: K-weighting, 400 ms blocks, 75% overlap, absolute gating and a relative gate. The browser audio graph still depends on the YouTube media element exposing audio to Web Audio. If a particular Chrome/YouTube player build outputs silence after connecting the media element to Web Audio, the next implementation should use a tab-capture architecture instead.

This extension does not download, modify, or transmit YouTube media. It processes the playback audio locally in the browser.


## v1.1.0 changes

- Broader target loudness selection: -30 to -6 LUFS, plus 0.1-step custom input.
- Added quick presets for Normal, Voice/Podcast, Music and Dynamic Range.
- Advanced settings now show the current value, unit, explanation and recommended range.
- Added a clear Chrome toolbar pinning hint.
- Added a reset-to-recommended button.
- Fixed terminology to consistently use LUFS (not LUVS).
