// captureVisibleTab targets a window, not a tab. Serialize calls across all
// windows and leave enough space for at most two calls in a rolling second.
const MIN_CAPTURE_GAP_MS = 650;
const workerId = crypto.randomUUID();
let focusRevision = 0;
let nextCapture = 0;
let capturing = false;
const selections = new Map();
const navigations = new Map();
const monitored = new Map();

const badges = {
  waiting: ["WAIT", "#315985", "Waiting for a usable baseline"],
  ready: ["SET", "#315985", "Baseline ready. Switch away and return to compare"],
  clear: ["OK", "#176343", "No significant viewport change"],
  warning: ["!", "#a3460c", "Potential change while you were away"],
  resized: ["WAIT", "#315985", "Viewport changed size or scale. A new baseline is needed"],
  expired: ["WAIT", "#315985", "Baseline expired. Waiting for a fresh baseline"],
  unavailable: ["N/A", "#505764", "Page unavailable or restricted. Click on a supported webpage"]
};

function publish(tabId, state) {
  const [text, color, title] = badges[state];
  return Promise.all([
    chrome.action.setBadgeText({ tabId, text }),
    chrome.action.setBadgeBackgroundColor({ tabId, color }),
    chrome.action.setTitle({ tabId, title: `Tab Watch · ${title}` })
  ]).catch(() => {}); // The tab can close while updates are in flight.
}

function isWebPage(url) {
  return /^https?:\/\//i.test(url ?? "");
}

function visitId(windowId) {
  return `${workerId}:${windowId}:${focusRevision}:${selections.get(windowId) ?? 0}`;
}

function isSingleTab(tab) {
  return tab.splitViewId === undefined || tab.splitViewId === -1;
}

async function foregroundTab(windowId, tabId) {
  const [window, tab] = await Promise.all([chrome.windows.get(windowId), chrome.tabs.get(tabId)]);
  return window.focused && window.state !== "minimized" && tab.windowId === windowId && tab.active
    ? tab : null;
}

async function capture(sender) {
  const { id: tabId, windowId } = sender.tab;
  const visit = visitId(windowId);
  const navigation = navigations.get(tabId);
  const stillCurrent = () => visitId(windowId) === visit && navigations.get(tabId) === navigation;

  try {
    const tab = await foregroundTab(windowId, tabId);
    if (!tab) return { kind: "away" };
    if (!stillCurrent()) return { kind: "retry" };
    // A missing URL here also means the temporary grant is gone.
    if (!isWebPage(tab.url) || !isSingleTab(tab)) return { kind: "blocked" };
    if (tab.status === "loading" || capturing || performance.now() < nextCapture) {
      return { kind: "retry" };
    }

    capturing = true;
    nextCapture = performance.now() + MIN_CAPTURE_GAP_MS;
    try {
      const png = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      const current = await foregroundTab(windowId, tabId);
      if (!current) return { kind: "away" };
      if (!stillCurrent() || !isSingleTab(current) || current.url !== tab.url) {
        return { kind: "retry" };
      }
      return { kind: "sample", visit, png };
    } finally {
      capturing = false;
    }
  } catch {
    // Capture can fail while Chrome is switching its compositor or loading a page.
    return { kind: "retry" };
  }
}

function nudge(tabId, windowId) {
  const message = { kind: "tab-watch:resume", visit: visitId(windowId) };
  void chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => {});
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  selections.set(windowId, (selections.get(windowId) ?? 0) + 1);
  nudge(tabId, windowId);
});

chrome.windows.onFocusChanged.addListener(windowId => {
  const revision = ++focusRevision;
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void chrome.tabs.query({ windowId, active: true }).then(tabs => {
    if (focusRevision !== revision) return;
    for (const tab of tabs) nudge(tab.id, windowId);
  }).catch(() => {});
});

chrome.windows.onRemoved.addListener(windowId => selections.delete(windowId));

chrome.tabs.onDetached.addListener((tabId, { oldWindowId }) => {
  selections.set(oldWindowId, (selections.get(oldWindowId) ?? 0) + 1);
});
chrome.tabs.onAttached.addListener((tabId, { newWindowId }) => nudge(tabId, newWindowId));

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if ((change.status === "loading" || change.discarded) && monitored.has(tabId)) {
    navigations.set(tabId, (navigations.get(tabId) ?? 0) + 1);
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  monitored.delete(tabId);
  navigations.delete(tabId);
});

chrome.action.onClicked.addListener(async tab => {
  if (!isWebPage(tab.url) || !isSingleTab(tab)) {
    await publish(tab.id, "unavailable");
    return;
  }
  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["diff.js", "monitor.js"]
    });
    monitored.set(tab.id, frame.documentId);
    await chrome.tabs.sendMessage(tab.id, { kind: "tab-watch:arm" }, { documentId: frame.documentId });
  } catch {
    await publish(tab.id, "unavailable");
  }
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || !sender.tab || sender.frameId !== 0 || sender.documentLifecycle !== "active" ||
      !isWebPage(sender.url)) return;

  const tabId = sender.tab.id;
  if (message.kind === "tab-watch:capture") {
    // The injected document can reconnect after an idle worker restarts.
    monitored.set(tabId, sender.documentId);
    void capture(sender).then(respond);
    return true;
  }
  const documentId = monitored.get(tabId);
  if (message.kind === "tab-watch:status" && Object.hasOwn(badges, message.state) &&
      (documentId === undefined || documentId === sender.documentId)) {
    void publish(tabId, message.state);
  }
});
