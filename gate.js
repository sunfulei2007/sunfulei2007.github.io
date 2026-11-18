/* Casual same-tab gate for sunfulei.com. Not a security boundary:
   the HTML source stays public. Check is SHA-256 of the trimmed UTF-8 input.
   Remembered only in sessionStorage (never localStorage). A fresh tab asks again.
   Tests may set window.__SUNFULEI_GATE_TEST__ before this file loads
   ({digest: 64 hex chars} and/or {storage:'deny'}). The URL is ignored. */
(function () {
  'use strict';

  var KEY = 'sfl-gate-v2';
  var MARK = '1';
  var REAL_DIGEST = '2e4779f9bc31f2d42190443bc47953353e0abc7c741c12595c2bfeabac2c702c';

  function fixture() {
    var t = window.__SUNFULEI_GATE_TEST__;
    if (!t || typeof t !== 'object') return null;
    return t;
  }

  function expectedDigest() {
    var t = fixture();
    if (t && typeof t.digest === 'string' && /^[0-9a-f]{64}$/.test(t.digest)) return t.digest;
    return REAL_DIGEST;
  }

  function storageDenied() {
    var t = fixture();
    return !!(t && t.storage === 'deny');
  }

  function readMark() {
    if (storageDenied()) return null;
    try {
      return sessionStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  }

  function writeMark() {
    if (storageDenied()) return false;
    try {
      sessionStorage.setItem(KEY, MARK);
      return sessionStorage.getItem(KEY) === MARK;
    } catch (e) {
      return false;
    }
  }

  function nudgeLayout() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try {
          window.dispatchEvent(new Event('resize'));
        } catch (e) {}
      });
    });
  }

  function apply(open) {
    var root = document.documentElement;
    var wasOpen = root.classList.contains('gate-open');
    root.classList.toggle('gate-open', !!open);
    root.classList.toggle('gate-locked', !open);
    var gate = document.getElementById('gate');
    if (gate) gate.setAttribute('aria-hidden', open ? 'true' : 'false');
    var body = document.body;
    if (body) {
      var child = body.firstElementChild;
      while (child) {
        var skip = child === gate || child.tagName === 'SCRIPT' || child.tagName === 'NOSCRIPT' || child.id === 'gate-storage-banner';
        if (!skip) {
          if (open) child.removeAttribute('inert');
          else child.setAttribute('inert', '');
        }
        child = child.nextElementSibling;
      }
    }
    if (open && !wasOpen) nudgeLayout();
  }

  function showStorageNote() {
    if (document.getElementById('gate-storage-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'gate-storage-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = '浏览器没有记住这次验证。刷新或重新打开页面时，需要再输入一次。';
    if (document.body) document.body.insertBefore(banner, document.body.firstChild);
  }

  function hex(buf) {
    var bytes = new Uint8Array(buf);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
  }

  function sameDigest(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function digestOf(text) {
    if (!window.crypto || !crypto.subtle || typeof TextEncoder === 'undefined') {
      return Promise.reject(new Error('no-crypto'));
    }
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', data).then(hex);
  }

  function bind() {
    var form = document.getElementById('gate-form');
    if (!form || form.getAttribute('data-bound') === '1') return;
    form.setAttribute('data-bound', '1');
    var input = document.getElementById('gate-input');
    var error = document.getElementById('gate-error');
    var button = document.getElementById('gate-submit');

    function setError(msg) {
      var field = document.getElementById('gate-field');
      var icon = document.getElementById('gate-status-icon');
      if (error) error.textContent = msg || '';
      if (input) {
        input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        input.classList.toggle('gate-bad', !!msg);
      }
      if (icon) icon.hidden = !msg;
      if (field) {
        field.classList.remove('gate-shake');
        if (msg) {
          void field.offsetWidth;
          field.classList.add('gate-shake');
        }
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!input || (button && button.disabled)) return;
      var value = String(input.value || '').trim();
      if (!value) {
        setError('请先输入内容。');
        input.focus();
        return;
      }
      if (button) button.disabled = true;
      setError('');
      digestOf(value).then(function (got) {
        if (!sameDigest(got, expectedDigest())) {
          setError('不对，请再试一次。');
          input.focus();
          if (typeof input.select === 'function') input.select();
          return;
        }
        input.value = '';
        var remembered = writeMark();
        apply(true);
        if (!remembered) showStorageNote();
      }).catch(function () {
        setError('这个浏览器没法完成验证，请换一个较新的浏览器再试。');
      }).then(function () {
        if (button) button.disabled = false;
      });
    });

    if (document.documentElement.classList.contains('gate-locked') && input) {
      setTimeout(function () {
        try { input.focus({ preventScroll: true }); } catch (e) { try { input.focus(); } catch (e2) {} }
      }, 0);
    }
  }

  apply(readMark() === MARK);

  window.addEventListener('pageshow', function () {
    if (readMark() === MARK) apply(true);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () {
    apply(readMark() === MARK);
    bind();
  });
  else {
    apply(readMark() === MARK);
    bind();
  }
})();
