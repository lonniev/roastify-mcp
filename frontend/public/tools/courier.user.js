// ==UserScript==
// @name         Roastify Design Courier
// @namespace    https://roastify.tollbooth-dpyc.com
// @version      1.3
// @description  Launch the Design Courier on Roastify to shuttle designs to/from your Design Bench. Works in iPad Safari via the Userscripts extension. The coffee-cup + octocat button is draggable - move it off the Designer's zoom control and it remembers where you put it.
// @author       DPYC
// @match        https://merchant.roastify.app/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// This userscript stays tiny on purpose: it only adds a launch button. Tapping
// it loads the real courier from the CDN with a cache-buster, so the courier
// itself always runs its latest version and this script never needs updating.
// The button is draggable (it otherwise sits atop the Designer's zoom scaler)
// and remembers its position across reloads.
(function () {
  if (window.__rcourierLauncher) return;
  window.__rcourierLauncher = true;

  var POS_KEY = "rcourier-btn-pos";

  function launch() {
    var s = document.createElement("script");
    s.src = "https://roastify.tollbooth-dpyc.com/tools/courier.js?" + Date.now();
    s.onerror = function () { alert("Could not load the courier - check your connection."); };
    document.body.appendChild(s);
  }

  function placeSaved(btn) {
    try {
      var p = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (p && typeof p.left === "number" && typeof p.top === "number") {
        // Clamp into the current viewport so a rotate/resize can't strand it.
        var left = Math.max(4, Math.min(window.innerWidth - 48, p.left));
        var top = Math.max(4, Math.min(window.innerHeight - 48, p.top));
        btn.style.left = left + "px";
        btn.style.top = top + "px";
        btn.style.right = "auto";
        btn.style.bottom = "auto";
      }
    } catch (e) { /* first run / private mode - keep the default corner */ }
  }

  function makeDraggable(btn) {
    var down = null;   // {x, y, left, top}
    var moved = false; // did this gesture cross the drag threshold?

    btn.style.touchAction = "none"; // let us own the gesture on iPad (no page scroll)

    btn.addEventListener("pointerdown", function (e) {
      var r = btn.getBoundingClientRect();
      down = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      moved = false;
      try { btn.setPointerCapture(e.pointerId); } catch (_) { /* older engines */ }
    });

    btn.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 6) moved = true; // tap vs drag
      if (!moved) return;
      var left = Math.max(4, Math.min(window.innerWidth - btn.offsetWidth - 4, down.left + dx));
      var top = Math.max(4, Math.min(window.innerHeight - btn.offsetHeight - 4, down.top + dy));
      btn.style.left = left + "px";
      btn.style.top = top + "px";
      btn.style.right = "auto";
      btn.style.bottom = "auto";
    });

    btn.addEventListener("pointerup", function (e) {
      if (down) {
        try { btn.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        if (moved) {
          try {
            localStorage.setItem(POS_KEY, JSON.stringify({
              left: parseInt(btn.style.left, 10), top: parseInt(btn.style.top, 10),
            }));
          } catch (_) { /* private mode - position just won't persist */ }
        }
      }
      down = null;
    });

    // Only a real tap launches; a drag must not.
    btn.addEventListener("click", function (e) {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; return; }
      launch();
    });
  }

  function addButton() {
    if (!document.body || document.getElementById("rcourier-launch")) return;
    var btn = document.createElement("button");
    btn.id = "rcourier-launch";
    btn.title = "Tap to open the courier \u00B7 drag to move";
    // The coffee-cup emoji in an emoji-capable font (a pure monospace stack renders
    // it as tofu on some systems; using a \\u escape keeps this file pure ASCII so
    // it can't mojibake when pasted or served without a charset) plus the GitHub
    // octocat mark in place of the word "Courier", to take less space.
    btn.innerHTML =
      "<span style=\"pointer-events:none;font:16px/1 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif\">\u2615</span>" +
      "<svg viewBox=\"0 0 16 16\" width=\"17\" height=\"17\" aria-hidden=\"true\" style=\"pointer-events:none\">" +
      "<path fill=\"currentColor\" d=\"M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z\"/></svg>";
    Object.assign(btn.style, {
      position: "fixed", left: "14px", bottom: "14px", zIndex: "2147483646",
      display: "flex", alignItems: "center", gap: "7px",
      background: "#0d7c7f", color: "#0b1211", border: "0", borderRadius: "999px",
      padding: "9px 12px", boxShadow: "0 6px 20px rgba(0,0,0,.35)",
      cursor: "grab", userSelect: "none",
    });
    document.body.appendChild(btn);
    placeSaved(btn);
    makeDraggable(btn);
  }

  if (document.body) addButton();
  else document.addEventListener("DOMContentLoaded", addButton);
})();
