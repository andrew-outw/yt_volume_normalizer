const OFFSCREEN_PATH = "src/offscreen.html";
const sessions = new Map();

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.some(context => context.documentUrl?.endsWith(OFFSCREEN_PATH))) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Capture the active YouTube tab and stream audio to the local transcription service."
  });
}

async function startTranscription(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const hostname = new URL(tab.url || "").hostname;
  if (!(hostname === "youtube.com" || hostname.endsWith(".youtube.com"))) {
    throw new Error("請先開啟 YouTube 分頁");
  }
  await ensureOffscreen();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  sessions.set(tabId, { state: "starting", text: "" });
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "START_CAPTURE",
    tabId,
    streamId
  });
  return { ok: true };
}

async function stopTranscription(tabId) {
  sessions.delete(tabId);
  try {
    await chrome.runtime.sendMessage({ target: "offscreen", type: "STOP_CAPTURE", tabId });
  } catch {}
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "START_TRANSCRIPTION") {
      sendResponse(await startTranscription(message.tabId));
      return;
    }
    if (message?.type === "STOP_TRANSCRIPTION") {
      sendResponse(await stopTranscription(message.tabId));
      return;
    }
    if (message?.type === "GET_TRANSCRIPTION_STATUS") {
      sendResponse(sessions.get(message.tabId) || { state: "off", text: "" });
      return;
    }
    if (message?.target === "background" && message.type === "TRANSCRIPTION_EVENT") {
      sessions.set(message.tabId, message.status);
      try {
        await chrome.tabs.sendMessage(message.tabId, {
          type: "TRANSCRIPTION_EVENT",
          status: message.status
        });
      } catch {}
      sendResponse({ ok: true });
    }
  })().catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => stopTranscription(tabId));
