async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(msg) {
  const tab = await getTab();
  if (!tab?.id || !/^https:\/\/(www\.)?youtube\.com\//.test(tab.url || "")) {
    throw new Error("請先開啟 YouTube 分頁");
  }
  return chrome.tabs.sendMessage(tab.id, msg);
}

function updateCustomVisibility() {
  customTargetRow.classList.toggle("hidden", targetLUFS.value !== "custom");
}

async function applyTarget(value) {
  value = Math.max(-30, Math.min(-6, Number(value)));
  if (!Number.isFinite(value)) return;
  await chrome.storage.sync.set({ targetLUFS: value });
  try {
    await send({ type: "SET_SETTINGS", settings: { targetLUFS: value } });
  } catch {}
}

async function refresh() {
  try {
    const s = await send({ type: "GET_STATUS" });
    enabled.checked = !!s.enabled;
    const value = Number(s.targetLUFS);
    if (value >= -30 && value <= -6 && Number.isFinite(value)) {
      const whole = Math.round(value * 10) / 10;
      const opt = [...targetLUFS.options].find(o => o.value !== "custom" && Number(o.value) === whole);
      if (opt) {
        targetLUFS.value = opt.value;
        customTargetRow.classList.add("hidden");
      } else {
        targetLUFS.value = "custom";
        customTarget.value = whole;
        customTargetRow.classList.remove("hidden");
      }
    }
    lufs.textContent = Number.isFinite(s.lufs) ? `${s.lufs.toFixed(1)} LUFS` : "--";
    gain.textContent = Number.isFinite(s.gainDb)
      ? `Gain：${s.gainDb >= 0 ? "+" : ""}${s.gainDb.toFixed(1)} dB`
      : "Gain：--";
    message.textContent = s.initialized ? "已連接目前播放器" : "尚未連接播放器";
  } catch {
    message.textContent = "請重新整理 YouTube 頁面後再試。";
  }
}

enabled.addEventListener("change", async () => {
  try {
    await send({ type: enabled.checked ? "ENABLE" : "DISABLE" });
    await refresh();
  } catch (e) { message.textContent = e.message; }
});

targetLUFS.addEventListener("change", async () => {
  updateCustomVisibility();
  if (targetLUFS.value !== "custom") {
    await applyTarget(Number(targetLUFS.value));
    await refresh();
  }
});

customTarget.addEventListener("change", async () => {
  await applyTarget(customTarget.value);
  await refresh();
});

customTarget.addEventListener("keydown", async e => {
  if (e.key === "Enter") {
    await applyTarget(customTarget.value);
    await refresh();
  }
});

enableAudio.addEventListener("click", async () => {
  try {
    const result = await send({ type: "ENABLE" });
    message.textContent = result?.ok ? "已啟用。" : "啟用失敗，請看 Console。";
    await refresh();
  } catch (e) {
    message.textContent = e.message;
  }
});

const showOverlayCheckbox = document.getElementById("showOverlay");
const showOverlayValue = document.getElementById("showOverlayValue");

function updateLabel(checked) {
  if (showOverlayValue) {
    showOverlayValue.textContent = checked ? "開啟" : "關閉";
  }
}

// 1. 初始化讀取當前設定
chrome.storage.sync.get({ showOverlay: true }, (res) => {
  showOverlayCheckbox.checked = res.showOverlay;
  updateLabel(res.showOverlay);
});

// 2. 監聽勾選變更
showOverlayCheckbox.addEventListener("change", async () => {
  const isEnabled = showOverlayCheckbox.checked;
  updateLabel(isEnabled);

  try {
    await send({ type: "SET_SETTINGS", settings: { showOverlay: isEnabled } });
  } catch (e) {
    message.textContent = e.message;
  }
});

options.addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();