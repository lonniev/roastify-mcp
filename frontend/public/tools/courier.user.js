// ==UserScript==
// @name         Roastify Design Courier
// @namespace    https://roastify-app.pages.dev
// @version      1.0
// @description  Launch the Design Courier on Roastify to shuttle designs to/from your Design Bench. Works in iPad Safari via the Userscripts extension.
// @author       DPYC
// @match        https://merchant.roastify.app/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// This userscript stays tiny on purpose: it only adds a launch button. Tapping
// it loads the real courier from the CDN with a cache-buster, so the courier
// itself always runs its latest version and this script never needs updating.
(function () {
  if (window.__rcourierLauncher) return;
  window.__rcourierLauncher = true;

  function addButton() {
    if (!document.body || document.getElementById("rcourier-launch")) return;
    const btn = document.createElement("button");
    btn.id = "rcourier-launch";
    btn.textContent = "☕ Courier";
    Object.assign(btn.style, {
      position: "fixed", right: "14px", bottom: "14px", zIndex: "2147483646",
      background: "#0d7c7f", color: "#0b1211", border: "0", borderRadius: "999px",
      font: "700 13px ui-monospace,Menlo,monospace", padding: "10px 14px",
      boxShadow: "0 6px 20px rgba(0,0,0,.35)", cursor: "pointer",
    });
    btn.addEventListener("click", function () {
      const s = document.createElement("script");
      s.src = "https://roastify-app.pages.dev/tools/courier.js?" + Date.now();
      s.onerror = function () { alert("Could not load the courier — check your connection."); };
      document.body.appendChild(s);
    });
    document.body.appendChild(btn);
  }

  if (document.body) addButton();
  else document.addEventListener("DOMContentLoaded", addButton);
})();
