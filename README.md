# YouTube Volume Normalizer v1.1.2

Chrome Manifest V3 extension that normalizes YouTube playback loudness.

## Download

Get the latest pre-packaged release:

[![Download Release](https://img.shields.io/badge/Download-Latest%20Release-blue?style=for-the-badge&logo=github)](https://github.com/andrew-outw/yt_volume_normalizer/releases/latest)



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

## Development Installation

1. Go to `chrome://extensions/`.
2. Enable "Developer mode" in the top right corner.
3. Click "Load unpacked".
4. Select this project directory.
5. Open or refresh YouTube.
6. Click the extension icon and select "Enable on Current YouTube Page".

## 開發者安裝指南

1. 開啟 Chrome 網址列並輸入 `chrome://extensions/`。
2. 開啟右上角的「開發人員模式」。
3. 點擊「載入未封裝項目」。
4. 選擇本專案資料夾。
5. 開啟或重新整理 YouTube 頁面。
6. 點擊擴充功能圖示，並按「在目前 YouTube 頁面啟用」。

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


## v1.1.2 changes

- Delayed initial loudness calibration until valid audio blocks have accumulated.
- Started the analysis timer from the first valid audio block instead of graph initialization.
- Prevented cached calibration loading from racing with the first live calibration.
- Added `[YTVN]` console logs for initialization, analysis progress and calibration results.


## v1.1.1 changes

- Reduced volume differences after refreshing YouTube by reusing per-video calibration.
- Applied the initial gain directly after analysis instead of ramping up from 0 dB.
- Moved calibration storage access out of audio graph initialization so playback is not blocked.


## v1.1.0 changes

- Broader target loudness selection: -30 to -6 LUFS, plus 0.1-step custom input.
- Added quick presets for Normal, Voice/Podcast, Music and Dynamic Range.
- Advanced settings now show the current value, unit, explanation and recommended range.
- Added a clear Chrome toolbar pinning hint.
- Added a reset-to-recommended button.
- Fixed terminology to consistently use LUFS.
