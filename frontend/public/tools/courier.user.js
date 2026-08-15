// ==UserScript==
// @name         Roastify Design Courier
// @namespace    https://roastify.tollbooth-dpyc.com
// @version      1.1
// @description  Launch the Design Courier on Roastify to shuttle designs to/from your Design Bench. Works in iPad Safari via the Userscripts extension. The ☕ button is draggable — move it off the Designer's zoom control and it remembers where you put it.
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
    s.onerror = function () { alert("Could not load the courier — check your connection."); };
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
    } catch (e) { /* first run / private mode — keep the default corner */ }
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
          } catch (_) { /* private mode — position just won't persist */ }
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
    btn.textContent = "☕ Courier";
    btn.title = "Tap to open the courier · drag to move";
    Object.assign(btn.style, {
      position: "fixed", left: "14px", bottom: "14px", zIndex: "2147483646",
      background: "#0d7c7f", color: "#0b1211", border: "0", borderRadius: "999px",
      font: "700 13px ui-monospace,Menlo,monospace", padding: "10px 14px",
      boxShadow: "0 6px 20px rgba(0,0,0,.35)", cursor: "grab", userSelect: "none",
    });
    document.body.appendChild(btn);
    placeSaved(btn);
    makeDraggable(btn);
  }

  if (document.body) addButton();
  else document.addEventListener("DOMContentLoaded", addButton);
})();
