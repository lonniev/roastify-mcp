// ==UserScript==
// @name         Roastify Design Courier (diagnostic)
// @namespace    https://roastify.tollbooth-dpyc.com
// @version      1.0
// @description  Same launcher, but it pops alerts at each step so we can see where a silent click stops. Temporary — replace with courier.user.js once diagnosed.
// @match        https://merchant.roastify.app/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
  if (window.__rcDiag) return;
  window.__rcDiag = true;
  function add() {
    if (!document.body || document.getElementById("rc-diag")) return;
    var b = document.createElement("button");
    b.id = "rc-diag";
    b.textContent = "☕ Courier";
    b.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2147483646;background:#0d7c7f;color:#0b1211;border:0;border-radius:999px;font:700 13px ui-monospace,monospace;padding:10px 14px;box-shadow:0 6px 20px rgba(0,0,0,.35)";
    b.addEventListener("click", function () {
      alert("1/3 click received");
      try {
        var s = document.createElement("script");
        s.src = "https://roastify.tollbooth-dpyc.com/tools/courier.js?" + Date.now();
        s.onload = function () { alert("2/3 courier.js LOADED (if no panel, the courier itself errored)"); };
        s.onerror = function () { alert("3/3 courier.js FAILED to load (blocked or network)"); };
        (document.head || document.documentElement).appendChild(s);
      } catch (e) {
        alert("EXCEPTION on inject: " + (e && e.message ? e.message : e));
      }
    });
    document.body.appendChild(b);
  }
  if (document.body) add();
  else document.addEventListener("DOMContentLoaded", add);
})();
