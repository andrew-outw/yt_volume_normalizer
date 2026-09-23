let capture = null;
let audioContext = null;
let processor = null;
let source = null;
let websocket = null;
let activeTabId = null;
let inputSampleRate = 48000;
let pendingSamples = [];
let reconnectTimer = null;

function postStatus(status) {
  chrome.runtime.sendMessage({
    target: "background",
    type: "TRANSCRIPTION_EVENT",
    tabId: activeTabId,
    status
  }).catch(() => {});
}

function connectSocket() {
  if (websocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(websocket.readyState)) return;
  websocket = new WebSocket("ws://127.0.0.1:8765");
  websocket.binaryType = "arraybuffer";
  websocket.onopen = () => {
    websocket.send(JSON.stringify({
      type: "start",
      sampleRate: 16000,
      language: null,
      task: "transcribe"
    }));
    postStatus({ state: "connected", text: "" });
    flushSamples();
  };
  websocket.onmessage = event => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "partial" || data.type === "final") {
        postStatus({ state: data.type, text: data.text || "", timestamp: data.timestamp });
      }
      if (data.type === "error") postStatus({ state: "error", text: data.message || "辨識服務錯誤" });
    } catch {}
  };
  websocket.onerror = () => postStatus({ state: "error", text: "無法連線到 Python 辨識服務" });
  websocket.onclose = () => {
    if (activeTabId !== null) {
      postStatus({ state: "reconnecting", text: "辨識服務連線中斷，正在重試..." });
      reconnectTimer = setTimeout(connectSocket, 1500);
    }
  };
}

function flushSamples() {
  if (!websocket || websocket.readyState !== WebSocket.OPEN || !pendingSamples.length) return;
  const samples = pendingSamples.splice(0, pendingSamples.length);
  websocket.send(new Int16Array(samples).buffer);
}

function downsampleTo16k(input) {
  const ratio = inputSampleRate / 16000;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const sample = end > start ? sum / (end - start) : input[start] || 0;
    output[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
  }
  pendingSamples.push(...output);
  if (pendingSamples.length >= 16000) flushSamples();
}

async function stopCapture() {
  clearTimeout(reconnectTimer);
  activeTabId = null;
  websocket?.close();
  websocket = null;
  processor?.disconnect();
  source?.disconnect();
  processor = source = null;
  capture?.getTracks().forEach(track => track.stop());
  capture = null;
  pendingSamples = [];
  if (audioContext) {
    await audioContext.close().catch(() => {});
    audioContext = null;
  }
}

async function startCapture({ tabId, streamId }) {
  await stopCapture();
  activeTabId = tabId;
  capture = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });
  audioContext = new AudioContext();
  inputSampleRate = audioContext.sampleRate;
  source = audioContext.createMediaStreamSource(capture);
  processor = audioContext.createScriptProcessor(4096, 2, 1);
  processor.onaudioprocess = event => downsampleTo16k(event.inputBuffer.getChannelData(0));
  source.connect(audioContext.destination);
  source.connect(processor);
  connectSocket();
  postStatus({ state: "capturing", text: "正在擷取分頁音訊..." });
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.target !== "offscreen") return;
  if (message.type === "START_CAPTURE") startCapture(message).catch(error => {
    postStatus({ state: "error", text: error.message || String(error) });
  });
  if (message.type === "STOP_CAPTURE") stopCapture();
});
