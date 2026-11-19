# Tab Watch

Manifest V3 extension for Web Security Homework 4. It compares the visible viewport of a tab before and after you switch away. An amber badge and an on-page grid highlight flag potential changes.

## Install and activate

1. Open `chrome://extensions` in Chrome 106 or later and turn on **Developer mode**.
2. Click **Load unpacked** and select the `tab-watch` folder containing `manifest.json`.
3. Pin **Tab Watch** from the puzzle-piece Extensions menu. On the HTTP or HTTPS page you want to monitor, click **Tab Watch** once and wait for `SET`.

Click once per page you want to monitor. Switching tabs or windows and returning needs no new click. After a reload or full navigation, click again to start a fresh baseline. Chrome internal pages, the Chrome Web Store, local `file:` pages, and split-view tabs are outside the supported workflow.

| Badge | Meaning |
| --- | --- |
| Empty | Click to start monitoring this page. |
| Blue `WAIT` | Waiting for a usable baseline. Hover for details, including a resize or expired baseline. |
| Blue `SET` | The initial or replacement baseline is ready. |
| Green `OK` | The last return comparison found no significant viewport change. |
| Amber `!` | The last return comparison found a potential change. The tint identifies the affected cells. |
| Gray `N/A` | Chrome restricted access or the page is unsupported. |

## Demos

From the `tab-watch` folder containing `manifest.json`, run:

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory demo
```

### Checkout scenario

1. Open `http://127.0.0.1:8765/checkout.html` and a second tab. The order shows home delivery in Alderfield.
2. Click **Queue delivery change**, click **Tab Watch**, and wait for `SET`. If the page is already monitored, wait about three seconds after queuing so the latest baseline includes the demo controls.
3. Switch away and return. The delivery tile now shows **Summit Parcel Locker 04** in Westhaven, while the total stays at **$139.32**. Look for `!` and the highlight over the delivery tile before selecting **Place order**.
4. Switch away and return again. The destination stays the same, the overlay clears, and the badge reads `OK`. **Place order** shows a simulated confirmation with the selected address. **Reset** reloads the checkout for another run, so activate Tab Watch again afterward.

### Solid-panel check

1. Open `http://127.0.0.1:8765/` and another tab. On the demo, click **Queue one change**, then click **Tab Watch** and wait for `SET`.
2. Switch to the other tab and return. The panel turns purple, `!` appears, and amber cells cover the panel to within one grid cell at the edges.
3. Switch away and return again without clicking **Queue one change**. The panel stays purple, the badge becomes `OK`, and the overlay clears. You can queue another change to repeat the demo in the opposite direction. If monitoring is already on, wait about three seconds after queuing so the visible button feedback is in the baseline.

For the focus check, leave the demo tab selected, focus another Chrome window or another app, then return. For the resize check, select the other tab, resize the Chrome window, then return to the demo. Expect a brief `WAIT` and then `SET` once a replacement baseline is captured.

## Permissions and comparison

- `activeTab` grants temporary access to the current tab after the toolbar click. Chrome's `captureVisibleTab` requires this grant or `<all_urls>`. Tab switching preserves the grant, so each opted-in tab can resume automatically without a persistent site grant. [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) · [Chrome captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab)
- `scripting` injects the comparison and overlay scripts into the authorized top-level document. The extension uses the tab and window APIs for activation and focus events with the permissions above. [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting) · [Chrome host permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions#host-permissions)

The extension samples lossless PNGs about every two seconds while a monitored tab is active in the focused window. Calls across windows are at least 650 ms apart, within Chrome's two-per-second limit. The worker checks the tab, window, and focus before and after capture. The page's isolated content script keeps one baseline in memory across normal worker idle shutdowns. It drops that baseline when the document closes or navigates away, or after 30 minutes of age. Comparisons run locally and screenshots stay in memory. [Chrome capture limit](https://developer.chrome.com/docs/extensions/reference/api/tabs#property-MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND) · [Manifest V3 worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

In `diff.js`, a pixel counts as changed when any RGB channel differs by more than **24**. A roughly **32 CSS pixel** cell is highlighted if at least **8%** of its pixels differ and at least **4** pixels differ. Screenshot dimensions are mapped to viewport CSS coordinates. The overlay allows pointer and keyboard interaction. It stays visible for **eight seconds** unless you switch away, scroll, or resize. Periodic sampling pauses while the grid is visible and resumes when it clears. The warning badge stays until the next comparison, which runs right away if you leave and return during the display period.

Tab Watch sees only visible pixels at the two sample times. Scrolling, animation, and ordinary page updates can trigger a potential-change warning. Off-screen or brief changes between captures can be missed. A viewport size or scale mismatch requires a fresh baseline.

## Verification

Passed in desktop Chrome on Windows. A first visit went from `WAIT` to `SET`, a changed return showed `!` and highlighted the panel, and the next unchanged return showed `OK` and cleared the overlay. Rapid back-and-forth switches, focus loss to a second Chrome window, highlight alignment at 125% zoom, resize recovery (`WAIT` to `SET`), reload reset, and an unchanged return after Chrome put the service worker to sleep also passed.

In the checkout demo, the grid stayed visible through the usual capture intervals and cleared after its eight-second display period. The badge stayed at `!` until an unchanged return. Switching away and back during the display period produced `OK` promptly.

JavaScript checks covered the comparison thresholds, capture throttling, rejection of an in-flight capture after rapid switching, restricted pages, and cleanup on navigation. Chrome tab discarding, the 30-minute expiry, and other display-scale configurations were outside the live demo.
