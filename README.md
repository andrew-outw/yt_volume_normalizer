# YouTube Volume Normalizer v1.2.2

Chrome Manifest V3 extension that normalizes YouTube playback loudness and optionally provides local real-time speech-to-text for the active YouTube tab.

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
- Optional local real-time transcription for the active YouTube tab.
- Captured tab audio is routed back to the speakers, so enabling transcription does not mute playback.
- Automatic CUDA detection for Faster-Whisper on compatible NVIDIA systems.
- The YouTube overlay can be dragged and resized; its position and size are remembered locally.
- Configurable transcription history, with three recent sentences shown by default.

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

The loudness meter follows the structure of ITU-R BS.1770: K-weighting, 400 ms blocks, 75% overlap, absolute gating and a relative gate. The normalizer processes the YouTube media element locally. Optional transcription uses Chrome tab capture in an offscreen document and routes the captured audio back to the output before sampling it.

This extension does not download, modify, or transmit YouTube media. It processes the playback audio locally in the browser.

## Optional local real-time transcription

The popup includes an `即時語音轉文字` switch. When enabled, the extension captures audio from the current YouTube tab and sends PCM audio only to `127.0.0.1:8765`; it does not send audio to a cloud API. The transcript is displayed in the YouTube overlay.

The complete startup order is:

1. Start `transcription_server.py` and wait until it reports `listening on ws://127.0.0.1:8765`.
2. Load or reload the unpacked extension from `chrome://extensions/`.
3. Refresh the YouTube tab.
4. Enable the normalizer, then enable `即時語音轉文字` in the popup.

Install the Python dependencies from PowerShell in this folder:

```powershell
cd ..
py -m venv yt_volume_normalizer_venv
.\yt_volume_normalizer_venv\Scripts\python.exe -m pip install -r .\yt_volume_normalizer\requirements-transcription.txt
```

Start the local service before enabling the switch:

```powershell
cd ..
.\yt_volume_normalizer_venv\Scripts\python.exe .\yt_volume_normalizer\transcription_server.py
```

### One-click startup on Windows

You can double-click `start_transcription_server.bat` in the parent `chrome plugin` folder. It automatically uses `yt_volume_normalizer_venv` and starts the local service. Keep the command window open while using transcription; closing it stops the service.

The default model is `large-v3-turbo`, which gives the best quality on a strong computer. The first start downloads the model from Hugging Face and requires several GB of disk space. NVIDIA CUDA is selected automatically when available; the Windows dependencies also install CUDA 12 cuBLAS/cuDNN runtime libraries required by Faster-Whisper. If GPU initialization still fails, the server falls back to CPU `int8` mode.

### Overlay controls

- Drag the `Volume Normalizer` title to move the overlay.
- Drag the handle in the lower-right corner to resize it.
- Open `進階設定` and change `轉錄保留句數` to show 1 to 20 recent sentences. The default is 3.

Environment overrides:

```powershell
$env:YTVN_WHISPER_MODEL = "large-v3-turbo"
$env:YTVN_WHISPER_DEVICE = "cuda"
$env:YTVN_WHISPER_COMPUTE = "float16"
```

For lower VRAM, use `medium` or `small`. Reload the unpacked extension after changing `manifest.json`, then reload the YouTube tab. The toggle can be turned off at any time and the capture stream is released immediately.

### Troubleshooting transcription

- `辨識服務連線中斷`: the Python service is not listening on port `8765`; start it with the command above.
- No audio while transcription is enabled: reload the extension and the YouTube tab so the latest tab-audio routing code is active.
- First startup is slow: the selected Whisper model is downloaded and loaded into GPU memory on the first run.
- `cublas64_12.dll is not found`: reinstall with `pip install -r .\yt_volume_normalizer\requirements-transcription.txt`, then restart the Python service.
- `WinError 10048` or port `8765` is already in use: the service is already running; do not start a second window. The one-click launcher detects this automatically.


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
