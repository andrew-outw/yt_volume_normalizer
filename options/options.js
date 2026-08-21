const DEFAULTS = {
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

const PRESETS = {
  normal: {
    targetLUFS: -14, maxBoost: 12, maxCut: -12, analysisSeconds: 5, smoothing: 0.18,
    compressorEnabled: true, compressorThreshold: -24, compressorKnee: 12,
    compressorRatio: 4, compressorAttack: 0.005, compressorRelease: 0.25, limiterCeiling: -1
  },
  voice: {
    targetLUFS: -16, maxBoost: 12, maxCut: -14, analysisSeconds: 4, smoothing: 0.20,
    compressorEnabled: true, compressorThreshold: -30, compressorKnee: 18,
    compressorRatio: 4, compressorAttack: 0.005, compressorRelease: 0.22, limiterCeiling: -1
  },
  music: {
    targetLUFS: -14, maxBoost: 9, maxCut: -12, analysisSeconds: 7, smoothing: 0.12,
    compressorEnabled: false, compressorThreshold: -24, compressorKnee: 12,
    compressorRatio: 2, compressorAttack: 0.010, compressorRelease: 0.30, limiterCeiling: -1
  },
  dynamic: {
    targetLUFS: -16, maxBoost: 6, maxCut: -10, analysisSeconds: 8, smoothing: 0.10,
    compressorEnabled: false, compressorThreshold: -24, compressorKnee: 12,
    compressorRatio: 2, compressorAttack: 0.010, compressorRelease: 0.35, limiterCeiling: -1
  }
};

const ids = Object.keys(DEFAULTS);

// 元素選取
const saveBtn = document.getElementById("save");
const resetBtn = document.getElementById("reset");
const savedEl = document.getElementById("saved");

function fmt(id, value) {
  const units = {
    targetLUFS: "LUFS", maxBoost: "dB", maxCut: "dB",
    analysisSeconds: "秒", smoothing: "",
    compressorThreshold: "dB", compressorKnee: "dB", compressorRatio: ":1",
    compressorAttack: "秒", compressorRelease: "秒", limiterCeiling: "dB"
  };
  if (id === "compressorEnabled" || id === "showOverlay") return value ? "開啟" : "關閉";
  const n = Number(value);
  const text = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return text + (units[id] ? ` ${units[id]}` : "");
}

function updateValueLabels() {
  for (const id of ids) {
    const input = document.getElementById(id);
    const out = document.getElementById(id + "Value");
    if (input && out) {
      out.textContent = fmt(id, input.type === "checkbox" ? input.checked : input.value);
    }
  }
}

async function load(values = null) {
  const s = values || await chrome.storage.sync.get(DEFAULTS);
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!s[id];
    else el.value = s[id];
  }
  updateValueLabels();
}

async function save(show = true) {
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    out[id] = el.type === "checkbox" ? el.checked : Number(el.value);
  }
  await chrome.storage.sync.set(out);
  if (show && savedEl) {
    savedEl.textContent = "✓ 已儲存";
    setTimeout(() => {
      savedEl.textContent = "";
    }, 1400);
  }
  return out;
}

// 綁定輸入即時更新數值標籤
for (const id of ids) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("input", updateValueLabels);
    el.addEventListener("change", updateValueLabels);
  }
}

// 綁定預設集按鈕
document.querySelectorAll("[data-preset]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const preset = PRESETS[btn.dataset.preset];
    if (!preset) return;
    await chrome.storage.sync.set(preset);
    await load({ ...DEFAULTS, ...preset });
    if (savedEl) {
      savedEl.textContent = `✓ 已套用「${btn.textContent}」`;
      setTimeout(() => {
        savedEl.textContent = "";
      }, 1600);
    }
  });
});

// 綁定儲存按鈕
saveBtn?.addEventListener("click", () => save(true));

// 綁定重設按鈕
resetBtn?.addEventListener("click", async () => {
  await chrome.storage.sync.set(DEFAULTS);
  await load(DEFAULTS);
  if (savedEl) {
    savedEl.textContent = "✓ 已恢復推薦值";
    setTimeout(() => {
      savedEl.textContent = "";
    }, 1400);
  }
});

// 初始化載入
load();