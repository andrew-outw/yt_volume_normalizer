(() => {
  "use strict";

  const DEFAULTS = {
    enabled: true,
    targetLUFS: -14,
    maxBoost: 12,
    maxCut: -12,
    analysisSeconds: 5,
    smoothing: 0.18,
    compressorEnabled: true,
    compressorThreshold: -24,
    compressorKnee: 12,
    compressorRatio: 4,
    compressorAttack: 0.005,
    compressorRelease: 0.25,
    limiterCeiling: -1,
    showOverlay: true
  };

  let settings = { ...DEFAULTS };
  let audioContext = null;
  let source = null;
  const mediaSources = new WeakMap();
  let meter = null;
  let compressor = null;
  let gain = null;
  let limiter = null;
  let video = null;
  let initialized = false;
  let currentGainDb = 0;
  let targetGainDb = 0;
  let gainCalibrated = false;
  let lastLUFS = null;
  let firstMeasurementAt = 0;
  let calibrationRestorePending = false;
  let lastVideoSignature = "";
  let calibrationKey = "";
  let workletReadyPromise = null;
  let initializationPromise = null;
  let transcription = { state: "off", text: "" };

  const log = (...a) => console.debug("[YTVN]", ...a);

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function dbToLinear(db) {
    return Math.pow(10, db / 20);
  }

  function getCalibrationKey() {
    const url = new URL(location.href);
    const videoId = url.searchParams.get("v") || url.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
    if (!videoId) return "";
    const profile = [
      2,
      settings.targetLUFS,
      settings.maxBoost,
      settings.maxCut,
      settings.analysisSeconds,
      settings.compressorEnabled,
      settings.compressorThreshold,
      settings.compressorKnee,
      settings.compressorRatio,
      settings.limiterCeiling
    ];
    return `${videoId}:${JSON.stringify(profile)}`;
  }

  function getVideo() {
    return document.querySelector("video.html5-main-video") ||
           document.querySelector("video");
  }

  function sendStatus() {
    chrome.runtime.sendMessage({
      type: "STATUS",
      status: {
        initialized,
        enabled: settings.enabled,
        lufs: lastLUFS,
        gainDb: currentGainDb,
        targetLUFS: settings.targetLUFS,
        url: location.href
      }
    }).catch(() => {});
  }

  function removeOverlay() {
    document.getElementById("ytvn-overlay")?.remove();
  }

  function ensureOverlay() {
    if (!settings.showOverlay) {
      removeOverlay();
      return;
    }
    let el = document.getElementById("ytvn-overlay");
    if (el) return el;

    el = document.createElement("div");
    el.id = "ytvn-overlay";
    el.innerHTML = `
      <div class="ytvn-title">🔊 Volume Normalizer</div>
      <div>狀態：<b id="ytvn-state">等待中</b></div>
      <div>響度：<b id="ytvn-lufs">--</b></div>
      <div>目標：<b id="ytvn-target">--</b></div>
      <div>Gain：<b id="ytvn-gain">0.0 dB</b></div>
      <div class="ytvn-transcription">轉錄：<b id="ytvn-transcription">關閉</b></div>
      <div class="ytvn-help">F8 開/關</div>
    `;
    Object.assign(el.style, {
      position: "fixed",
      right: "18px",
      bottom: "85px",
      zIndex: "2147483647",
      padding: "10px 12px",
      minWidth: "190px",
      color: "#fff",
      background: "rgba(18,18,18,.88)",
      border: "1px solid rgba(255,255,255,.15)",
      borderRadius: "8px",
      font: "12px/1.55 Arial,sans-serif",
      boxShadow: "0 4px 20px rgba(0,0,0,.35)",
      pointerEvents: "none",
      backdropFilter: "blur(6px)"
    });
    const style = document.createElement("style");
    style.textContent = `
      #ytvn-overlay .ytvn-title{font-weight:700;font-size:13px;margin-bottom:4px}
      #ytvn-overlay .ytvn-help{margin-top:5px;color:#aaa;font-size:10px}
      #ytvn-overlay .ytvn-transcription{margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,.12);max-width:300px;white-space:normal;overflow-wrap:anywhere}
    `;
    document.documentElement.append(style);
    document.body.append(el);
    return el;
  }
  
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes.showOverlay) return;
    settings.showOverlay = !!changes.showOverlay.newValue;
    ensureOverlay();
    updateOverlay();
  });

  function updateOverlay() {
    const el = document.getElementById("ytvn-overlay");
    if (!el) return;
    el.querySelector("#ytvn-state").textContent =
      !settings.enabled ? "停用" : initialized ? "運作中" : "等待播放";
    el.querySelector("#ytvn-lufs").textContent =
      Number.isFinite(lastLUFS) ? `${lastLUFS.toFixed(1)} LUFS` : "--";
    el.querySelector("#ytvn-target").textContent = `${settings.targetLUFS.toFixed(1)} LUFS`;
    el.querySelector("#ytvn-gain").textContent =
      `${currentGainDb >= 0 ? "+" : ""}${currentGainDb.toFixed(1)} dB`;
    el.querySelector("#ytvn-transcription").textContent = transcription.state === "off"
      ? "關閉"
      : transcription.text || transcription.state;
  }

  async function loadSettings() {
    const saved = await chrome.storage.sync.get(DEFAULTS);
    settings = { ...DEFAULTS, ...saved };
    ensureOverlay();
    updateOverlay();
  }

  function disconnectGraph() {
    for (const node of [source, meter, compressor, gain, limiter]) {
      try { node?.disconnect(); } catch {}
    }
    source = meter = compressor = gain = limiter = null;
    initialized = false;
    calibrationRestorePending = false;
  }

  async function restoreCachedCalibration(key, expectedVideo) {
    try {
      if (!key) return;
      const cached = (await chrome.storage.local.get("calibrations")).calibrations?.[key];
      if (video !== expectedVideo || gainCalibrated || !gain || !Number.isFinite(cached?.gainDb)) {
        log("cached calibration skipped", {
          hasCache: Number.isFinite(cached?.gainDb),
          sameVideo: video === expectedVideo,
          gainCalibrated
        });
        return;
      }
      currentGainDb = clamp(cached.gainDb, settings.maxCut, settings.maxBoost);
      targetGainDb = currentGainDb;
      gainCalibrated = true;
      gain.gain.setValueAtTime(dbToLinear(currentGainDb), audioContext.currentTime);
      log("cached calibration restored", { gainDb: currentGainDb });
      updateOverlay();
      sendStatus();
    } catch (err) {
      log("cached calibration unavailable", err);
    } finally {
      calibrationRestorePending = false;
    }
  }

  function getVideoSignature(v) {
    return v?.currentSrc || v?.src || "";
  }

  async function setupForVideo(v, force = false) {
    if (!v || video === v && initialized && !force && lastVideoSignature === getVideoSignature(v)) return;

    disconnectGraph();
    video = v;
    lastVideoSignature = getVideoSignature(v);
    lastLUFS = null;
    currentGainDb = 0;
    targetGainDb = 0;
    gainCalibrated = false;
    calibrationKey = getCalibrationKey();
    firstMeasurementAt = 0;

    try {
      audioContext ||= new AudioContext();

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // This must happen before a media element is connected when possible.
      // YouTube normally supplies a CORS-enabled media element; if a browser
      // build prevents Web Audio access, see the README troubleshooting note.
      try { v.crossOrigin = "anonymous"; } catch {}

      source = mediaSources.get(v);
      if (!source) {
        source = audioContext.createMediaElementSource(v);
        mediaSources.set(v, source);
      }
      meter = new AudioWorkletNode(audioContext, "ytvn-loudness-meter", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: "max",
        channelInterpretation: "speakers"
      });

      compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = settings.compressorThreshold;
      compressor.knee.value = settings.compressorKnee;
      compressor.ratio.value = settings.compressorRatio;
      compressor.attack.value = settings.compressorAttack;
      compressor.release.value = settings.compressorRelease;

      gain = audioContext.createGain();
      gain.gain.value = 1;

      limiter = audioContext.createDynamicsCompressor();
      limiter.threshold.value = settings.limiterCeiling;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.05;

      if (settings.compressorEnabled) {
        source.connect(compressor);
        compressor.connect(gain);
      } else {
        source.connect(gain);
      }

      gain.connect(limiter);
      // Measure after all processing so calibration follows the actual output.
      limiter.connect(meter);
      meter.connect(audioContext.destination);

      meter.port.onmessage = onMeterMessage;
      initialized = true;
      calibrationRestorePending = true;
      updateOverlay();
      sendStatus();
      restoreCachedCalibration(calibrationKey, v);
      log("audio graph initialized", {
        videoId: calibrationKey.split(":")[0] || "unknown",
        analysisSeconds: settings.analysisSeconds,
        requiredBlocks: Math.max(10, Math.ceil(settings.analysisSeconds * 10))
      });
    } catch (err) {
      console.error("[YTVN] 初始化失敗：", err);
      initialized = false;
      updateOverlay();
      sendStatus();
    }
  }

  async function onMeterMessage(event) {
    const d = event.data;
    if (!d || d.type !== "loudness") return;

    lastLUFS = d.integratedLUFS;

    if (!settings.enabled || !gain || !audioContext || !Number.isFinite(lastLUFS)) {
      updateOverlay();
      sendStatus();
      return;
    }

    if (calibrationRestorePending) {
      log("measurement held while cached calibration loads", { blocks: d.blocks });
      updateOverlay();
      sendStatus();
      return;
    }

    if (d.blocks > 0 && firstMeasurementAt === 0) {
      firstMeasurementAt = performance.now();
      log("first valid loudness block received", {
        blocks: d.blocks,
        lufs: lastLUFS
      });
    }

    const elapsed = firstMeasurementAt ? (performance.now() - firstMeasurementAt) / 1000 : 0;
    const requiredBlocks = Math.max(10, Math.ceil(settings.analysisSeconds * 10));
    if (elapsed < settings.analysisSeconds || d.blocks < requiredBlocks) {
      if (d.blocks > 0 && d.blocks % 10 === 0) {
        log("analysis in progress", {
          blocks: d.blocks,
          requiredBlocks,
          elapsed: Number(elapsed.toFixed(1)),
          lufs: Number(lastLUFS.toFixed(1))
        });
      }
      updateOverlay();
      sendStatus();
      return;
    }

    let desired = settings.targetLUFS - lastLUFS;
    desired = clamp(desired, settings.maxCut, settings.maxBoost);

    // Ignore tiny changes to prevent audible pumping.
    if (Math.abs(desired - targetGainDb) < 0.15) {
      desired = targetGainDb;
    }
    targetGainDb = desired;

    if (!gainCalibrated) {
      currentGainDb = targetGainDb;
      gainCalibrated = true;
      log("initial gain calibrated", {
        blocks: d.blocks,
        elapsed: Number(elapsed.toFixed(1)),
        lufs: Number(lastLUFS.toFixed(1)),
        gainDb: Number(currentGainDb.toFixed(1))
      });
      if (calibrationKey) {
        const stored = await chrome.storage.local.get("calibrations");
        await chrome.storage.local.set({
          calibrations: {
            ...stored.calibrations,
            [calibrationKey]: { gainDb: currentGainDb }
          }
        });
      }
    } else {
      currentGainDb += (targetGainDb - currentGainDb) * settings.smoothing;
    }
    currentGainDb = clamp(currentGainDb, settings.maxCut, settings.maxBoost);

    gain.gain.setTargetAtTime(
      dbToLinear(currentGainDb),
      audioContext.currentTime,
      0.12
    );

    updateOverlay();
    sendStatus();
  }

  async function enableAudio() {
    const v = getVideo();
    if (!v) return false;

    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
    try {
      audioContext ||= new AudioContext();
      if (audioContext.state === "suspended") await audioContext.resume();

      if (!workletReadyPromise) {
        const workletUrl = chrome.runtime.getURL("src/loudness-worklet.js");
        workletReadyPromise = audioContext.audioWorklet.addModule(workletUrl);
      }
      await workletReadyPromise;

      await setupForVideo(v, video === v && lastVideoSignature !== getVideoSignature(v));
      return initialized;
    } catch (e) {
      console.error("[YTVN] Audio 啟動失敗：", e);
      if (workletReadyPromise && !meter) workletReadyPromise = null;
      return false;
    }
    })();

    try {
      return await initializationPromise;
    } finally {
      initializationPromise = null;
    }
  }

  function setEnabled(enabled) {
    settings.enabled = !!enabled;
    if (!settings.enabled && gain && audioContext) {
      currentGainDb = 0;
      targetGainDb = 0;
      gain.gain.setTargetAtTime(1, audioContext.currentTime, 0.08);
    }
    updateOverlay();
    sendStatus();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      if (!msg) return;

      if (msg.type === "GET_STATUS") {
        sendResponse({
          initialized,
          enabled: settings.enabled,
          lufs: lastLUFS,
          gainDb: currentGainDb,
          targetLUFS: settings.targetLUFS
        });
        return;
      }

      if (msg.type === "TRANSCRIPTION_EVENT") {
        transcription = { state: msg.status?.state || "off", text: msg.status?.text || "" };
        updateOverlay();
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "ENABLE") {
        const ok = await enableAudio();
        setEnabled(true);
        sendResponse({ ok });
        return;
      }

      if (msg.type === "DISABLE") {
        setEnabled(false);
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "SET_SETTINGS") {
        settings = { ...settings, ...msg.settings };
        await chrome.storage.sync.set(msg.settings);
        if (initialized) {
          await setupForVideo(video);
        }
        ensureOverlay();
        updateOverlay();
        sendResponse({ ok: true });
      }
    })().catch(err => {
      console.error("[YTVN]", err);
      sendResponse({ ok: false, error: String(err) });
    });
    return true;
  });

  document.addEventListener("keydown", async (e) => {
    if (e.key !== "F8" || e.ctrlKey || e.altKey || e.shiftKey) return;
    settings.enabled = !settings.enabled;
    await chrome.storage.sync.set({ enabled: settings.enabled });
    setEnabled(settings.enabled);
  }, true);

  function observeYouTube() {
    const v = getVideo();
    if (!v) return;

    const signatureChanged = v !== video || lastVideoSignature !== getVideoSignature(v);
    if (signatureChanged || !initialized) {
      v.addEventListener("play", () => enableAudio(), { once: true });
      v.addEventListener("loadeddata", () => enableAudio(), { once: true });
      if (!v.paused || v.readyState >= HTMLMediaElement.HAVE_METADATA) enableAudio();
    }
  }

  new MutationObserver(observeYouTube).observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  setInterval(observeYouTube, 1000);

  loadSettings().then(() => observeYouTube());
})();