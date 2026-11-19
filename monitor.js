(() => {
  if (globalThis.tabWatchMonitorInstalled) return;
  globalThis.tabWatchMonitorInstalled = true;

  const SAMPLE_INTERVAL_MS = 2000;
  const HIGHLIGHT_DURATION_MS = 8000;
  const RETRY_MS = 750;
  const MAX_BASELINE_AGE_MS = 30 * 60 * 1000;

  let armed = false;
  let timer;
  let expiry;
  let busy = false;
  let wakePending = false;
  let visibilityRevision = 0;
  let geometryRevision = 0;
  let baseline;
  let overlay;
  let highlightTimer;
  let overlayNeedsPaint = false;
  let status;

  function report(state) {
    if (state === status) return;
    status = state;
    void chrome.runtime.sendMessage({ kind: "tab-watch:status", state }).catch(() => {});
  }

  function viewport() {
    const visual = window.visualViewport;
    const scale = visual?.scale || 1;
    // innerWidth and innerHeight include classic scrollbars, as does capture.
    return {
      width: innerWidth / scale,
      height: innerHeight / scale,
      left: visual?.offsetLeft ?? 0,
      top: visual?.offsetTop ?? 0,
      scale,
      dpr: devicePixelRatio
    };
  }

  function sameSize(a, b) {
    return a.width === b.width && a.height === b.height && a.scale === b.scale && a.dpr === b.dpr;
  }

  function clearOverlay() {
    if (!overlay) return false;
    clearTimeout(highlightTimer);
    overlay.remove();
    overlay = undefined;
    overlayNeedsPaint = true;
    return true;
  }

  function dismissOverlay() {
    if (clearOverlay()) schedule();
  }

  function highlight({ width, height, regions }, view) {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("data-tab-watch-overlay", "");
    for (const [property, value] of Object.entries({
      all: "initial", display: "block", position: "fixed", left: `${view.left}px`,
      top: `${view.top}px`, width: `${view.width}px`, height: `${view.height}px`,
      "pointer-events": "none", "z-index": "2147483647"
    })) host.style.setProperty(property, value, "important");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.style.cssText = "display:block;width:100%;height:100%;pointer-events:none";
    const context = canvas.getContext("2d");
    context.fillStyle = "rgba(255, 145, 31, 0.28)";
    context.strokeStyle = "rgba(194, 70, 0, 0.9)";
    context.lineWidth = Math.max(1, width / view.width);
    const inset = context.lineWidth / 2;
    for (const cell of regions) {
      context.fillRect(cell.x, cell.y, cell.width, cell.height);
      if (cell.width > context.lineWidth && cell.height > context.lineWidth) {
        context.strokeRect(cell.x + inset, cell.y + inset,
          cell.width - context.lineWidth, cell.height - context.lineWidth);
      }
    }
    host.attachShadow({ mode: "closed" }).append(canvas);
    document.documentElement.append(host);
    overlay = host;
    highlightTimer = setTimeout(dismissOverlay, HIGHLIGHT_DURATION_MS);
  }

  function forgetBaseline() {
    clearTimeout(expiry);
    baseline = undefined;
  }

  function expireBaseline() {
    forgetBaseline();
    clearOverlay();
    report("expired");
  }

  function keepBaseline(png, visit, view) {
    clearTimeout(expiry);
    baseline = { png, visit, view, visibilityRevision, time: Date.now() };
    expiry = setTimeout(expireBaseline, MAX_BASELINE_AGE_MS);
  }

  function schedule(delay = 0) {
    // Keep the grid continuously visible and retain the clean return capture.
    if (!armed || overlay || document.visibilityState !== "visible") return;
    if (busy) {
      wakePending = true;
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(takeSample, delay);
  }

  function nextPaint() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function takeSample() {
    if (!armed || overlay || document.visibilityState !== "visible") return;
    busy = true;
    let nextDelay = RETRY_MS;
    const pass = visibilityRevision;
    const geometry = geometryRevision;
    const view = viewport();
    const isCurrent = () => {
      const now = viewport();
      return armed && document.visibilityState === "visible" && pass === visibilityRevision &&
        geometry === geometryRevision && sameSize(view, now) && view.left === now.left && view.top === now.top;
    };
    try {
      if (overlayNeedsPaint || !baseline || baseline.visibilityRevision !== pass) {
        // Let the compositor paint without a dismissed grid before capturing.
        await nextPaint();
      }
      if (!isCurrent()) return;
      overlayNeedsPaint = false;

      const result = await chrome.runtime.sendMessage({ kind: "tab-watch:capture" });
      if (!isCurrent()) return;
      if (result.kind === "away") {
        nextDelay = null; // Tab/window activation will wake us again.
        return;
      }
      if (result.kind === "blocked") {
        armed = false;
        forgetBaseline();
        clearOverlay();
        report("unavailable");
        return;
      }
      if (result.kind !== "sample") return;

      if (baseline && Date.now() - baseline.time >= MAX_BASELINE_AGE_MS) expireBaseline();
      if (!baseline) {
        keepBaseline(result.png, result.visit, view);
        report("ready");
      } else if (baseline.visit !== result.visit || baseline.visibilityRevision !== pass) {
        const diff = sameSize(baseline.view, view)
          ? await globalThis.tabWatchCompare(baseline.png, result.png, view)
          : null;
        if (!isCurrent()) return;
        clearOverlay();
        if (diff === null) {
          forgetBaseline();
          report("resized");
        } else {
          if (diff.regions.length) highlight(diff, view);
          keepBaseline(result.png, result.visit, view);
          report(diff.regions.length ? "warning" : "clear");
        }
      } else {
        keepBaseline(result.png, result.visit, view);
      }
      nextDelay = SAMPLE_INTERVAL_MS;
    } catch {
      // A renderer or the worker can disappear during an outstanding request.
      if (!chrome.runtime.id) armed = false;
    } finally {
      busy = false;
      const delay = wakePending ? 80 : nextDelay;
      wakePending = false;
      if (delay !== null) schedule(delay);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.kind === "tab-watch:arm") {
      if (!armed) {
        armed = true;
        status = undefined;
        report("waiting");
      }
      schedule();
      respond();
    } else if (message.kind === "tab-watch:resume") {
      if (overlay && message.visit !== baseline?.visit) clearOverlay();
      schedule();
      respond();
    }
  });

  document.addEventListener("visibilitychange", () => {
    visibilityRevision++;
    clearTimeout(timer);
    clearOverlay();
    schedule();
  });

  window.addEventListener("pagehide", () => {
    armed = false;
    visibilityRevision++;
    clearTimeout(timer);
    forgetBaseline();
    clearOverlay();
  });

  function geometryChanged() {
    geometryRevision++;
    dismissOverlay();
  }
  window.addEventListener("resize", geometryChanged);
  window.visualViewport?.addEventListener("resize", geometryChanged);
  window.visualViewport?.addEventListener("scroll", geometryChanged);
  window.addEventListener("scroll", dismissOverlay, { capture: true, passive: true });
})();
