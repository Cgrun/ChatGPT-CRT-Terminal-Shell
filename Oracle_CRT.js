// ==UserScript==
// @name         J's Oracle CRT Terminal Shell for ChatGPT v15 optimized
// @namespace    js-oracle-crt-chatgpt-v14
// @version      1.4.9
// @description  A retro WebGL CRT terminal interface for ChatGPT with curved-screen rendering, inline terminal input, popup composer, visible thinking-status display, preserved code formatting, glowing copy-code controls, and persistent SCRIPT ON/OFF standby toggle.
// @author       CrJia
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const ROOT_ID = "oracle-crt-v14-root";
  const STYLE_ID = "oracle-crt-v14-style";
  const ROOT_CLASS = "oracle-crt-v14-on";
  const STANDBY_CLASS = "oracle-v14-standby";
  const STORE_ON = "oracleCrtV14Enabled";

  const MAX_MESSAGES = 12;

  const COLORS = {
    amber: "#e08901",
    amberHot: "#eda227",
    amberStrong: "#ffb000",
    amberDim: "#bf7302",
    amberDeep: "#694302",
    red: "#e05a1a",
    black: "#000000",
    select: "#ffcf03",
    selectHot: "#ffd40e",
    selectGlow: "#ff9a00"
  };

  const MODEL_CLICKABLE_SELECTOR = [
    "button",
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="tab"]',
    '[data-testid]',
    '[cmdk-item]',
    '[data-cmdk-item]',
    '[tabindex]'
  ].join(", ");

  const MODEL_TEXT_SELECTOR = [
    "button",
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="tab"]',
    "span",
    "div",
    "p"
  ].join(", ");

  const MODEL_CHILD_OPTION_SELECTOR = [
    "button",
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="tab"]',
    "span",
    "div"
  ].join(", ");

  const MODEL_OPTION_CANDIDATE_SELECTOR = [
    MODEL_CLICKABLE_SELECTOR,
    "div",
    "span"
  ].join(", ");

  const MODEL_MENU_SELECTOR = [
    '[role="menu"]',
    '[role="listbox"]',
    '[data-radix-popper-content-wrapper]',
    '[cmdk-list]',
    '[data-cmdk-list]',
    '[data-testid*="model" i]',
    '[class*="model" i]'
  ].join(", ");

  const SIDEBAR_LINK_SELECTOR = [
    "nav a",
    "aside a",
    '[data-testid="sidebar"] a',
    'a[href^="/c/"]',
    'a[href*="/c/"]'
  ].join(", ");

  const SIDEBAR_CONTAINER_SELECTOR = [
    "aside",
    "nav",
    '[data-testid="sidebar"]',
    '[data-testid*="sidebar" i]',
    '[id*="sidebar" i]',
    '[class*="sidebar" i]',
    '[id*="history" i]',
    '[class*="history" i]'
  ].join(", ");

  const CHAT_LINK_SELECTOR = 'a[href^="/c/"], a[href*="/c/"]';

  let shell = null;
  let screenCanvas = null;
  let gl = null;
  let glProgram = null;
  let glTex = null;
  let glUniforms = {};
  let offscreen = null;
  let offctx = null;
  let dpr = Math.max(1, window.devicePixelRatio || 1);

  let syncTimer = null;
  let renderQueued = false;
  let resizeTimer = null;
  let sidebarLoadTimer = null;
  let sidebarAutoLoadBusy = false;

  let movedComposer = null;
  let composerPlaceholder = null;
  const boundNativePromptSync = new WeakSet();

  const state = {
    shellOn: true,
    autoFollow: true,
    inputFocused: false,
    inputCursor: 0,
    inputSelectionEnd: 0,
    mainScrollY: 0,
    totalContentHeight: 0,
    popup: {
      sidebar: false,
      thinking: false,
      chatbox: false,
      model: false
    },
    lastMessagesHash: "",
    renderCache: {
      key: "",
      lines: []
    },
    data: {
      messages: [],
      thinking: [],
      thinkingModules: [],
      draft: "",
      chatLinks: [],
      modelLabel: "MODEL",
      modelOptions: [],
      isThinking: false
    }
  };

  function getBool(key, fallback) {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return value === "true";
  }

  function setBool(key, value) {
    localStorage.setItem(key, value ? "true" : "false");
  }

  function isMine(node) {
    return Boolean(node && node.closest && node.closest(`#${ROOT_ID}`));
  }

  function qsAll(selector, base = document) {
    try {
      return Array.from(base.querySelectorAll(selector));
    } catch (_) {
      return [];
    }
  }

  function engineQsAll(selector) {
    return qsAll(selector).filter((el) => {
      if (!el) return false;

      if (isMine(el)) {
        return Boolean(el.closest(".oracle-v14-native-composer"));
      }

      return true;
    });
  }

  function txt(el) {
    if (!el) return "";

    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      return (el.value || "").replace(/\u00a0/g, " ").trim();
    }

    if (el.isContentEditable) {
      return (el.textContent || "").replace(/\u00a0/g, " ").trim();
    }

    return (el.textContent || "").replace(/\u00a0/g, " ").trim();
  }

  function usableDomNode(el) {
    if (!el || isMine(el)) return false;

    const style = window.getComputedStyle(el);
    if (style.display === "none") return false;

    const text = txt(el);
    const rect = el.getBoundingClientRect();

    return text.length > 0 || rect.width > 1 || rect.height > 1;
  }

  function ignoreShellMutations(mutations) {
    return mutations.every((mutation) => {
      if (isMine(mutation.target)) return true;

      const nodes = [
        ...Array.from(mutation.addedNodes || []),
        ...Array.from(mutation.removedNodes || [])
      ];

      return nodes.length > 0 && nodes.every((node) => {
        return node.nodeType === 1 && isMine(node);
      });
    });
  }

  function bestMessageContent(message) {
    return (
      message.querySelector(".markdown") ||
      message.querySelector('[data-message-author-role] > div') ||
      message
    );
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      :root {
        --oracle-font:
          "Glass TTY VT220",
          "VT323",
          "Terminus",
          "Terminess Nerd Font",
          "Px437 IBM VGA 8x16",
          "Perfect DOS VGA 437",
          "Cascadia Mono",
          "Consolas",
          "Courier New",
          monospace;

        --oracle-code-font:
          "Cascadia Mono",
          "Consolas",
          "Courier New",
          monospace;

        --oracle-amber: ${COLORS.amber};
        --oracle-amber-hot: ${COLORS.amberHot};
        --oracle-amber-strong: ${COLORS.amberStrong};
        --oracle-amber-dim: ${COLORS.amberDim};
        --oracle-amber-deep: ${COLORS.amberDeep};
        --oracle-red: ${COLORS.red};
        --oracle-black: ${COLORS.black};
        --oracle-select: ${COLORS.select};
      }

      html.${ROOT_CLASS},
      html.${ROOT_CLASS} body {
        background: #000 !important;
        overflow: hidden !important;
      }

      html.${ROOT_CLASS} body > *:not(#${ROOT_ID}):not(script):not(style):not(link):not(meta) {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      html.${ROOT_CLASS} body > :is(
        [role="dialog"],
        [role="menu"],
        [role="listbox"],
        [aria-modal="true"],
        [data-radix-popper-content-wrapper]
      ),
      html.${ROOT_CLASS} body > *:has([role="dialog"]),
      html.${ROOT_CLASS} body > *:has([role="menu"]),
      html.${ROOT_CLASS} body > *:has([role="listbox"]),
      html.${ROOT_CLASS} body > *:has([data-radix-popper-content-wrapper]) {
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
        z-index: 2147483600 !important;
      }

      #${ROOT_ID},
      #${ROOT_ID} *:not(pre):not(code):not(kbd):not(samp) {
        font-family: var(--oracle-font) !important;
        font-variant-ligatures: none !important;
        font-feature-settings: "liga" 0, "calt" 0 !important;
        box-sizing: border-box !important;
      }

      #${ROOT_ID} pre,
      #${ROOT_ID} code,
      #${ROOT_ID} kbd,
      #${ROOT_ID} samp {
        font-family: var(--oracle-code-font) !important;
      }

      #${ROOT_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483001;
        background: #000;
        color: var(--oracle-amber);
      }

      #${ROOT_ID}.${STANDBY_CLASS} {
        background: transparent !important;
        pointer-events: none !important;
      }

      #${ROOT_ID}.${STANDBY_CLASS} .oracle-v14-main,
      #${ROOT_ID}.${STANDBY_CLASS} .oracle-v14-popup {
        display: none !important;
      }

      #${ROOT_ID}.${STANDBY_CLASS} .oracle-v14-bottom-bar {
        pointer-events: auto !important;
        background: transparent !important;
      }

      #${ROOT_ID}.${STANDBY_CLASS} .oracle-v14-bottom-bar .oracle-v14-btn:not([data-action="toggle-shell"]) {
        visibility: hidden !important;
        pointer-events: none !important;
      }

      #${ROOT_ID}.${STANDBY_CLASS} .oracle-v14-bottom-bar .oracle-v14-btn[data-action="toggle-shell"] {
        visibility: visible !important;
        pointer-events: auto !important;
      }

      #${ROOT_ID}.oracle-v14-booting {
        pointer-events: auto !important;
      }

      .oracle-v14-boot-overlay {
        position: absolute;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 1);
        pointer-events: auto;
        opacity: 0;
        /* 先渐入，再渐出 */
        transition:
          opacity 360ms ease-out,
          background 360ms ease-out;
      }

      .oracle-v14-boot-overlay.show {
        opacity: 1;
      }

      .oracle-v14-boot-overlay.hide {
        opacity: 0;
      }

      .oracle-v14-boot-logo {
        white-space: pre;
        color: var(--oracle-select);
        font-family: var(--oracle-font) !important;
        font-size: clamp(11px, 1.45vw, 20px);
        line-height: 1.05;
        letter-spacing: 0.03em;
        text-align: left;
        transform: translateY(-48px);
        text-shadow:
           0 0 1px rgba(255, 255, 210, 1),
           0 0 5px rgba(255, 207, 3, 0.95),
           0 0 14px rgba(255, 154, 0, 0.85),
           0 0 32px rgba(255, 102, 0, 0.55),
           0 0 58px rgba(255, 80, 0, 0.35);
      }
      .oracle-v14-main {
        position: absolute;
        inset: 0 0 48px 0;
        background: #000;
        cursor: text;
        overflow: hidden;
      }

      #oracle-v14-webgl {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
        background: #000;
        z-index: 5;
      }

      .oracle-v14-select-layer {
        position: absolute;
        inset: 0;
        z-index: 20;
        overflow: hidden;
        background: transparent !important;
        pointer-events: auto;
        user-select: text;
        cursor: text;
        padding: 14px 18px 0 18px;
      }

      .oracle-v14-select-content {
        white-space: pre-wrap;
        line-height: 24px;
        font-size: 17px;
        color: rgba(224, 137, 1, 0.012);
        text-shadow: none !important;
        font-family:
          "Glass TTY VT220",
          "VT323",
          "Cascadia Mono",
          "Consolas",
          "Courier New",
          monospace !important;
        user-select: text;
        pointer-events: auto;
      }

      .oracle-v14-select-layer ::selection,
      .oracle-v14-select-content::selection,
      .oracle-v14-select-content *::selection,
      #${ROOT_ID} ::selection,
      #${ROOT_ID} *::selection,
      .oracle-v14-native-composer ::selection,
      .oracle-v14-native-composer *::selection {
        background: #ffcf03 !important;
        color: #050200 !important;
        text-shadow:
          0 0 1px rgba(255, 255, 210, 1),
          0 0 5px rgba(255, 207, 3, 0.95),
          0 0 14px rgba(255, 154, 0, 0.75),
          0 0 28px rgba(255, 102, 0, 0.38) !important;
      }

      .oracle-v14-code-copy-overlay {
        position: absolute;
        left: 18px;
        right: 18px;
        height: 24px;
        z-index: 35;
        border: 0 !important;
        outline: 0 !important;
        cursor: pointer;
        background: transparent !important;
        color: transparent !important;
        font-family: var(--oracle-font) !important;
        text-align: center;
        letter-spacing: 0.08em;
        box-shadow: none !important;
        text-shadow: none !important;
      }

      .oracle-v14-code-copy-overlay:hover {
        background: transparent !important;
        color: transparent !important;
        box-shadow: none !important;
        filter: none !important;
      }

      .oracle-v14-inline-input {
        position: absolute;
        left: 18px;
        bottom: 54px;
        width: 1px;
        height: 1px;
        opacity: 0;
        color: transparent;
        background: transparent;
        border: 0;
        outline: 0;
        resize: none;
        overflow: hidden;
        pointer-events: none;
        z-index: 1;
      }

      .oracle-v14-bottom-bar {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 48px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        background: #000;
        border-top: 0;
        z-index: 80;
        pointer-events: auto;
      }

      .oracle-v14-btn {
        border: 0 !important;
        outline: 0 !important;
        background: #000 !important;
        color: var(--oracle-amber-hot) !important;
        padding: 4px 10px;
        cursor: pointer;
        white-space: nowrap;
        text-shadow:
          0 0 1px rgba(255, 202, 70, 0.95),
          0 0 5px rgba(224, 137, 1, 0.82),
          0 0 13px rgba(224, 100, 0, 0.45);
      }

      .oracle-v14-btn::before {
        content: "[";
        color: var(--oracle-amber-dim);
      }

      .oracle-v14-btn::after {
        content: "]";
        color: var(--oracle-amber-dim);
      }

      .oracle-v14-btn:hover {
        background: var(--oracle-amber-hot) !important;
        color: #000 !important;
        text-shadow: none !important;
      }

      .oracle-v14-popup {
        position: absolute;
        background: #000;
        color: var(--oracle-amber);
        z-index: 100;
        display: none;
        overflow: hidden;
        box-shadow:
          inset 0 0 24px rgba(224,137,1,0.04),
          inset 0 0 80px rgba(224,80,0,0.02);
      }

      .oracle-v14-popup.show {
        display: block;
      }

      .oracle-v14-popup::before {
        content: "#--- " attr(data-title) " ------------------------------------------------------------------------------------------------------------------------------------------------";
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 22px;
        line-height: 22px;
        overflow: hidden;
        white-space: nowrap;
        color: var(--oracle-amber-hot);
        text-shadow:
          0 0 1px rgba(255, 218, 104, 1),
          0 0 8px rgba(237, 162, 39, 0.95),
          0 0 20px rgba(224, 137, 1, 0.62);
      }

      .oracle-v14-popup::after {
        content: "#----------------------------------------------------------------------------------------------------------------------------------------------------------------";
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 20px;
        line-height: 20px;
        overflow: hidden;
        white-space: nowrap;
        color: var(--oracle-amber-dim);
      }

      .oracle-v14-popup-body {
        position: absolute;
        inset: 24px 12px 22px 12px;
        overflow: auto;
        white-space: pre-wrap;
        line-height: 1.45;
        color: var(--oracle-amber);
        scrollbar-width: thin;
        scrollbar-color: var(--oracle-amber-hot) #000;
      }

      .oracle-v14-popup-body::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }

      .oracle-v14-popup-body::-webkit-scrollbar-thumb {
        background: var(--oracle-amber-hot);
        border: 2px solid #000;
      }

      .oracle-v14-popup-body::-webkit-scrollbar-track {
        background: #000;
      }

      #oracle-v14-sidebar-popup {
        left: 28px;
        top: 28px;
        width: 360px;
        height: 65vh;
      }

      #oracle-v14-thinking-popup {
        right: 28px;
        top: 28px;
        width: 420px;
        height: 65vh;
      }

      #oracle-v14-chatbox-popup {
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: min(920px, 88vw);
        height: min(320px, 44vh);
      }

      #oracle-v14-model-popup {
        left: 50%;
        bottom: 54px;
        transform: translateX(-50%);
        width: min(560px, 86vw);
        height: min(420px, 48vh);
        top: auto;
      }

      .oracle-v14-model-option {
        display: block;
        width: 100%;
        border: 0 !important;
        outline: 0 !important;
        background: #000 !important;
        color: var(--oracle-amber-hot) !important;
        text-align: left;
        padding: 7px 0;
        cursor: pointer;
        white-space: pre-wrap;
        text-shadow:
          0 0 1px rgba(255, 202, 70, 0.95),
          0 0 5px rgba(224, 137, 1, 0.82),
          0 0 13px rgba(224, 100, 0, 0.45);
      }

      .oracle-v14-model-option:hover {
        background: var(--oracle-amber-hot) !important;
        color: #000 !important;
        text-shadow: none !important;
      }

      .oracle-v14-model-option.current::before {
        content: "> ";
        color: var(--oracle-select);
      }

      .oracle-v14-model-status {
        color: var(--oracle-amber-dim);
        margin-bottom: 10px;
      }

      .oracle-v14-link-btn {
        display: block;
        width: 100%;
        border: 0 !important;
        outline: 0 !important;
        background: #000 !important;
        color: var(--oracle-amber-hot) !important;
        text-align: left;
        padding: 4px 0;
        cursor: pointer;
      }

      .oracle-v14-link-btn:hover {
        background: var(--oracle-amber-hot) !important;
        color: #000 !important;
        text-shadow: none !important;
      }

      .oracle-v14-line-head {
        color: var(--oracle-amber-hot);
      }

      .oracle-v14-line-user {
        color: var(--oracle-red);
      }

      .oracle-v14-empty {
        color: var(--oracle-amber-deep);
      }

      .oracle-v14-native-composer {
        display: block !important;
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        min-width: 0 !important;
        margin: 0 !important;
        background: #000 !important;
        box-shadow: none !important;
        border: 0 !important;
        outline: 0 !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }

      .oracle-v14-native-composer,
      .oracle-v14-native-composer *:not(pre):not(code):not(kbd):not(samp) {
        font-family: var(--oracle-font) !important;
        color: var(--oracle-amber-hot) !important;
        text-shadow:
          0 0 1px rgba(255, 202, 70, 0.95),
          0 0 5px rgba(224, 137, 1, 0.82),
          0 0 13px rgba(224, 100, 0, 0.45) !important;
      }

      .oracle-v14-native-composer * {
        visibility: visible !important;
      }

      .oracle-v14-native-composer :where(textarea, input, [contenteditable="true"], #prompt-textarea) {
        background: #000 !important;
        color: var(--oracle-amber-hot) !important;
        caret-color: var(--oracle-amber-hot) !important;
        border: 0 !important;
        outline: 0 !important;
        box-shadow: none !important;
      }

      .oracle-v14-native-composer :where(button, [role="button"]) {
        background: #000 !important;
        color: var(--oracle-amber-hot) !important;
        border: 0 !important;
        box-shadow: none !important;
      }

      .oracle-v14-native-composer :where(button:hover, [role="button"]:hover) {
        background: var(--oracle-amber-hot) !important;
        color: #000 !important;
        text-shadow: none !important;
      }

      .oracle-v14-native-composer svg,
      .oracle-v14-native-composer svg * {
        color: var(--oracle-amber-hot) !important;
        stroke: currentColor !important;
      }
    `;
    document.head.appendChild(style);
  }

  function buildShell() {
    if (document.getElementById(ROOT_ID)) return;

    const root = document.createElement("div");
    root.id = ROOT_ID;

    root.innerHTML = `
      <div class="oracle-v14-main" title="Click to focus terminal input">
        <canvas id="oracle-v14-webgl"></canvas>
        <div id="oracle-v14-select-layer" class="oracle-v14-select-layer">
          <div id="oracle-v14-select-content" class="oracle-v14-select-content"></div>
        </div>
        <textarea id="oracle-v14-inline-input" class="oracle-v14-inline-input" spellcheck="true"></textarea>
      </div>

      <div id="oracle-v14-sidebar-popup" class="oracle-v14-popup" data-title="SIDEBAR">
        <div class="oracle-v14-popup-body" id="oracle-v14-sidebar-body"></div>
      </div>

      <div id="oracle-v14-thinking-popup" class="oracle-v14-popup" data-title="THINKING">
        <div class="oracle-v14-popup-body" id="oracle-v14-thinking-body"></div>
      </div>

      <div id="oracle-v14-chatbox-popup" class="oracle-v14-popup" data-title="CHATBOX">
        <div class="oracle-v14-popup-body" id="oracle-v14-chatbox-body">
          <div class="oracle-v14-empty">NATIVE CHATGPT COMPOSER WILL BE DOCKED HERE.</div>
        </div>
      </div>

      <div id="oracle-v14-model-popup" class="oracle-v14-popup oracle-v14-model-popup" data-title="MODEL SELECT">
        <div class="oracle-v14-popup-body" id="oracle-v14-model-body">
          <div class="oracle-v14-empty">PRESS MODEL SELECT TO READ REAL CHATGPT MODEL MENU.</div>
        </div>
      </div>

      <div class="oracle-v14-bottom-bar">
        <button class="oracle-v14-btn" data-action="sidebar">SIDEBAR</button>
        <button class="oracle-v14-btn" data-action="thinking">THINKING</button>
        <button class="oracle-v14-btn" data-action="toggle-shell">SCRIPT OFF</button>
        <button class="oracle-v14-btn" data-action="send">SEND</button>
        <button class="oracle-v14-btn" data-action="add-file">ADD FILE</button>
        <button class="oracle-v14-btn" data-action="dictate">DICTATE</button>
        <button class="oracle-v14-btn" data-action="model">MODEL SELECT</button>
        <button class="oracle-v14-btn" data-action="chatbox">CHATBOX</button>
      </div>
    `;

    document.body.appendChild(root);
    shell = root;
    screenCanvas = root.querySelector("#oracle-v14-webgl");

    bindBottomButtons();
    bindInlineInput();

    const sidebarBody = root.querySelector("#oracle-v14-sidebar-body");
    if (sidebarBody) {
      sidebarBody.addEventListener("scroll", onSidebarPopupScroll, { passive: true });
    }

    const main = root.querySelector(".oracle-v14-main");
    const selectLayer = root.querySelector("#oracle-v14-select-layer");

    const focusTerminal = () => {
      const selectedText = String(window.getSelection ? window.getSelection().toString() : "").trim();
      if (selectedText) return;
      focusInlineInput();
    };

    main.addEventListener("wheel", onMainWheel, { passive: false });
    main.addEventListener("click", focusTerminal);

    if (selectLayer) {
      selectLayer.addEventListener("wheel", onMainWheel, { passive: false });
      selectLayer.addEventListener("click", focusTerminal);
    }
  }

  function getInlineInput() {
    return document.getElementById("oracle-v14-inline-input");
  }

  function bindInlineInput() {
    const input = getInlineInput();
    if (!input) return;

    input.addEventListener("focus", () => {
      state.inputFocused = true;
      syncInlineInputState();
    });

    input.addEventListener("blur", () => {
      state.inputFocused = false;
      syncInlineInputState();
    });

    input.addEventListener("input", () => {
      syncInlineInputState();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        sendCurrentPrompt();
        return;
      }

      setTimeout(syncInlineInputState, 0);
    });

    ["keyup", "click", "mouseup", "select", "compositionend"].forEach((type) => {
      input.addEventListener(type, () => {
        setTimeout(syncInlineInputState, 0);
      });
    });

    input.addEventListener("paste", () => {
      setTimeout(syncInlineInputState, 0);
    });
  }

  function focusInlineInput(moveCursorToEnd = false) {
    const input = getInlineInput();
    if (!input) return false;

    try {
      input.focus();

      if (moveCursorToEnd) {
        const end = input.value.length;
        input.selectionStart = end;
        input.selectionEnd = end;
      }

      state.inputFocused = true;
      syncInlineInputState();
      return true;
    } catch (_) {
      return false;
    }
  }

  function syncInlineInputState() {
    const input = getInlineInput();
    if (!input) return;

    const value = input.value || "";
    state.data.draft = value;

    const start = typeof input.selectionStart === "number"
      ? input.selectionStart
      : value.length;

    const end = typeof input.selectionEnd === "number"
      ? input.selectionEnd
      : start;

    state.inputCursor = Math.max(0, Math.min(value.length, start));
    state.inputSelectionEnd = Math.max(0, Math.min(value.length, end));

    requestRender();
  }

  function setInlineDraftValue(value, moveCursorToEnd = true) {
    const input = getInlineInput();
    if (!input) return false;

    input.value = value || "";

    if (moveCursorToEnd) {
      const end = input.value.length;

      try {
        input.selectionStart = end;
        input.selectionEnd = end;
      } catch (_) {}
    }

    syncInlineInputState();
    return true;
  }

  function readInlineDraft() {
    const input = getInlineInput();
    return input ? (input.value || "") : "";
  }

  function clearInlineInput() {
    setInlineDraftValue("", true);
  }

  function readPromptValue(target) {
    if (!target) return "";

    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      return target.value || "";
    }

    if (target.isContentEditable) {
      return (target.innerText || target.textContent || "")
        .replace(/\u00a0/g, " ")
        .replace(/\n$/, "");
    }

    return txt(target);
  }

  function getDockedNativePrompt() {
    return document.querySelector(`#${ROOT_ID} .oracle-v14-native-composer #prompt-textarea`)
      || document.querySelector(`#${ROOT_ID} .oracle-v14-native-composer textarea`)
      || document.querySelector(`#${ROOT_ID} .oracle-v14-native-composer [contenteditable="true"]`)
      || null;
  }

  function syncNativeDraftToInline(moveCursorToEnd = true) {
    const prompt = getDockedNativePrompt() || findNativePromptOutsideShell();
    if (!prompt) return false;

    const value = readPromptValue(prompt);
    return setInlineDraftValue(value, moveCursorToEnd);
  }

  function bindNativePromptDraftSync(prompt) {
    if (!prompt || boundNativePromptSync.has(prompt)) return;

    boundNativePromptSync.add(prompt);

    const handler = () => {
      if (!state.popup.chatbox) return;

      const value = readPromptValue(prompt);
      setInlineDraftValue(value, true);
      state.data.draft = value;
      requestRender();
    };

    ["input", "change", "keyup", "paste", "cut", "compositionend"].forEach((type) => {
      prompt.addEventListener(type, () => setTimeout(handler, 0), true);
    });
  }

  function bindBottomButtons() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    const bind = (action, handler) => {
      const btn = root.querySelector(`[data-action="${action}"]`);
      if (!btn) return;

      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handler();
      });
    };

    bind("sidebar", () => {
      state.popup.sidebar = !state.popup.sidebar;
      updatePopups();
      refreshSidebarPopup();

      if (state.popup.sidebar) {
        requestSidebarHistoryLoad(180);
      }
    });

    bind("thinking", () => {
      state.popup.thinking = !state.popup.thinking;
      updatePopups();
      refreshThinkingPopup();
      scheduleSync(40);
    });

    bind("chatbox", () => {
      toggleChatbox();
    });

    bind("toggle-shell", () => {
      const nowOn = document.documentElement.classList.contains(ROOT_CLASS);

      showBootOverlay(2000);

      afterOverlayPaint(() => {
        if (nowOn) {
          setBool(STORE_ON, false);
          disableShell();
        } else {
          setBool(STORE_ON, true);
          enableShell();
        }

        updateToggleButtonLabel();
      });
    });

    bind("send", () => {
      sendCurrentPrompt();
    });

    bind("add-file", () => {
      triggerOriginalAddFile();
    });

    bind("dictate", () => {
      triggerOriginalDictate();
    });

    bind("model", () => {
      toggleModelPopup();
    });
  }

  function toggleChatbox() {
    const opening = !state.popup.chatbox;
    const inlineDraft = readInlineDraft();
    const input = getInlineInput();

    if (opening) {
      state.popup.chatbox = true;
      state.inputFocused = false;

      if (input) {
        try { input.blur(); } catch (_) {}
      }

      updatePopups();

      setTimeout(() => {
        const docked = dockNativeComposer(true);
        const prompt = getDockedNativePrompt() || findNativePromptOutsideShell();

        if (prompt) {
          bindNativePromptDraftSync(prompt);

          const nativeDraft = readPromptValue(prompt);

          if (inlineDraft || !nativeDraft) {
            setNativePromptValue(inlineDraft);
          } else {
            setInlineDraftValue(nativeDraft, true);
          }
        }

        if (docked) {
          setTimeout(focusNativePrompt, 60);
        }

        scheduleSync(80);
        requestRender();
      }, 60);

      return;
    }

    syncNativeDraftToInline(true);

    state.popup.chatbox = false;
    updatePopups();
    restoreNativeComposer();
    focusInlineInput(true);
    scheduleSync(80);
    requestRender();
  }

  function updatePopups() {
    const map = {
      sidebar: "oracle-v14-sidebar-popup",
      thinking: "oracle-v14-thinking-popup",
      chatbox: "oracle-v14-chatbox-popup",
      model: "oracle-v14-model-popup"
    };

    Object.entries(map).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle("show", !!state.popup[key]);
    });
  }

  function updateToggleButtonLabel() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    const btn = root.querySelector('[data-action="toggle-shell"]');
    if (!btn) return;

    const isOn = document.documentElement.classList.contains(ROOT_CLASS);
    btn.textContent = isOn ? "SCRIPT OFF" : "SCRIPT ON";
  }

  function showBootOverlay(duration = 2000) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return null;

    const old = root.querySelector(".oracle-v14-boot-overlay");
    if (old) old.remove();

    root.classList.add("oracle-v14-booting");

    const overlay = document.createElement("div");
    overlay.className = "oracle-v14-boot-overlay";

    const logo = document.createElement("pre");
    logo.className = "oracle-v14-boot-logo";
    logo.textContent = String.raw`
         ::::::::  :::::::::  ::::::::::: :::::::::::     :::
        :+:    :+: :+:    :+:     :+:         :+:       :+: :+:
       +:+        +:+    +:+     +:+         +:+      +:+   +:+
      +#+        +#++:++#:      +#+         +#+     +#++:++#++:
     +#+        +#+    +#+     +#+         +#+     +#+     +#+
    #+#    #+# #+#    #+#     #+#         #+#     #+#     #+#
    ########  ###    ###  #####      ########### ###     ###
  `.trimEnd();

    overlay.appendChild(logo);
    root.appendChild(overlay);

    /* 强制让浏览器先记录初始 opacity: 0 */
    overlay.getBoundingClientRect();

    /* 下一帧进入 opacity: 1，实现渐入 */
    requestAnimationFrame(() => {
      overlay.classList.add("show");
    });

    /* 2 秒总时长，最后 360ms 渐出 */
    setTimeout(() => {
      overlay.classList.remove("show");
      overlay.classList.add("hide");
    }, Math.max(0, duration - 360));

    setTimeout(() => {
      overlay.remove();
      root.classList.remove("oracle-v14-booting");
    }, duration);

    return overlay;
  }

  function afterOverlayPaint(fn) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(fn, 0);
      });
    });
  }
  function disableShell() {
    restoreNativeComposer();

    state.popup.sidebar = false;
    state.popup.thinking = false;
    state.popup.chatbox = false;
    state.popup.model = false;
    state.popup.model = false;
    restoreNativeModelMenusSoftly();
    updatePopups();

    document.documentElement.classList.remove(ROOT_CLASS);

    if (shell) {
      shell.hidden = false;
      shell.classList.add(STANDBY_CLASS);
    }

    state.shellOn = false;
    updateToggleButtonLabel();
  }

  function enableShell() {
    document.documentElement.classList.add(ROOT_CLASS);

    if (shell) {
      shell.hidden = false;
      shell.classList.remove(STANDBY_CLASS);
    }

    state.shellOn = true;
    setBool(STORE_ON, true);
    updateToggleButtonLabel();
    scheduleSync(50);
    requestRender();
  }

  function findNativePromptOutsideShell() {
    const docked = getDockedNativePrompt();
    if (docked) return docked;

    const candidates = engineQsAll('#prompt-textarea, textarea, [contenteditable="true"]')
      .filter((el) => {
        if (!el) return false;
        if (el.id === "oracle-v14-inline-input") return false;

        const style = window.getComputedStyle(el);
        return style.display !== "none";
      });

    return candidates.find((el) => el.matches("#prompt-textarea"))
      || candidates.find((el) => el.isContentEditable)
      || candidates.find((el) => el.tagName === "TEXTAREA")
      || null;
  }

  function findNativeComposerOutsideShell() {
    const prompt = findNativePromptOutsideShell();
    if (!prompt) return null;

    return (
      prompt.closest("form") ||
      prompt.closest('[data-testid*="composer" i]') ||
      prompt.closest('[class*="composer" i]') ||
      prompt.closest('[class*="prompt" i]') ||
      prompt.parentElement
    );
  }

  function setNativePromptValue(value) {
    const target = findNativePromptOutsideShell();
    if (!target) return false;

    const nextValue = value || "";

    try {
      target.focus();
    } catch (_) {}

    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      const proto = target.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;

      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

      if (setter) {
        setter.call(target, nextValue);
      } else {
        target.value = nextValue;
      }

      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      bindNativePromptDraftSync(target);
      return true;
    }

    if (target.isContentEditable) {
      try {
        const range = document.createRange();
        range.selectNodeContents(target);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        const ok = document.execCommand("insertText", false, nextValue);

        if (!ok) {
          target.textContent = nextValue;
        }
      } catch (_) {
        target.textContent = nextValue;
      }

      target.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: nextValue
      }));

      target.dispatchEvent(new Event("change", { bubbles: true }));
      bindNativePromptDraftSync(target);
      return true;
    }

    return false;
  }

  function dockNativeComposer(shouldFocus = false) {
    const dock = document.getElementById("oracle-v14-chatbox-body");
    if (!dock) return false;

    let composer = dock.querySelector(".oracle-v14-native-composer");
    if (!composer) composer = findNativeComposerOutsideShell();

    if (!composer) {
      dock.innerHTML = `<div class="oracle-v14-empty">NATIVE CHATGPT COMPOSER NOT FOUND. OPEN A CHAT, THEN PRESS CHATBOX AGAIN.</div>`;
      return false;
    }

    if (!isMine(composer)) {
      if (!composerPlaceholder && composer.parentNode) {
        composerPlaceholder = document.createComment("oracle-v14-composer-placeholder");
        composer.parentNode.insertBefore(composerPlaceholder, composer);
      }

      movedComposer = composer;
      dock.textContent = "";
      dock.appendChild(composer);
    }

    composer.classList.add("oracle-v14-native-composer");

    composer.style.setProperty("display", "block", "important");
    composer.style.setProperty("visibility", "visible", "important");
    composer.style.setProperty("opacity", "1", "important");
    composer.style.setProperty("pointer-events", "auto", "important");
    composer.style.setProperty("width", "100%", "important");
    composer.style.setProperty("height", "100%", "important");
    composer.style.setProperty("max-width", "none", "important");
    composer.style.setProperty("background", "#000000", "important");

    const prompt = getDockedNativePrompt();
    if (prompt) bindNativePromptDraftSync(prompt);

    if (shouldFocus) {
      setTimeout(focusNativePrompt, 80);
    }

    return true;
  }

  function focusNativePrompt() {
    const prompt = getDockedNativePrompt() || findNativePromptOutsideShell();

    if (!prompt) return false;

    try {
      prompt.focus();
      return true;
    } catch (_) {
      return false;
    }
  }

  function restoreNativeComposer() {
    const composer = movedComposer || document.querySelector(`#${ROOT_ID} .oracle-v14-native-composer`);
    if (!composer) return;

    composer.classList.remove("oracle-v14-native-composer");

    if (composerPlaceholder && composerPlaceholder.parentNode) {
      composerPlaceholder.parentNode.insertBefore(composer, composerPlaceholder);
    }
  }

  function isSendCandidate(el) {
    if (!el) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;

    const label = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("data-testid") || ""} ${txt(el)}`.toLowerCase();

    if (/stop|cancel|停止|取消/.test(label)) return false;

    return /send|submit|发送|送出|composer-submit/.test(label)
      || el.getAttribute("type") === "submit";
  }

  function clickOriginalSend() {
    const selectors = [
      '.oracle-v14-native-composer [data-testid="send-button"]',
      '.oracle-v14-native-composer [data-testid="composer-submit-button"]',
      '.oracle-v14-native-composer button[data-testid*="send" i]',
      '.oracle-v14-native-composer button[data-testid*="submit" i]',
      '.oracle-v14-native-composer button[aria-label*="Send" i]',
      '.oracle-v14-native-composer button[aria-label*="发送" i]',
      '.oracle-v14-native-composer button[type="submit"]',
      '[data-testid="send-button"]',
      '[data-testid="composer-submit-button"]',
      'button[data-testid*="send" i]',
      'button[data-testid*="submit" i]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="发送" i]',
      'button[type="submit"]'
    ];

    for (const selector of selectors) {
      const btn = engineQsAll(selector).find(isSendCandidate);

      if (btn) {
        btn.click();
        scheduleSync(600);
        return true;
      }
    }

    const prompt = findNativePromptOutsideShell();
    const form = prompt ? prompt.closest("form") : null;

    if (form) {
      try {
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else {
          form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
        }

        scheduleSync(600);
        return true;
      } catch (_) {}
    }

    return false;
  }

  function retryClickOriginalSend(maxAttempts = 12, delay = 90, onSuccess = null, onFail = null) {
    let attempts = 0;

    const tick = () => {
      attempts += 1;

      if (clickOriginalSend()) {
        if (typeof onSuccess === "function") onSuccess();
        return;
      }

      if (attempts < maxAttempts) {
        setTimeout(tick, delay);
      } else if (typeof onFail === "function") {
        onFail();
      }
    };

    tick();
  }

  function sendCurrentPrompt() {
    const input = getInlineInput();
    const inlineDraftRaw = input ? (input.value || "") : "";
    const inlineDraft = inlineDraftRaw.trim();

    if (state.popup.chatbox) {
      syncNativeDraftToInline(false);
    }

    if (inlineDraft) {
      const inserted = setNativePromptValue(inlineDraftRaw);

      if (!inserted) {
        state.data.draft = `${inlineDraftRaw}\n[ORACLE ERROR: native ChatGPT prompt not found. Open CHATBOX once, then try again.]`;
        requestRender();
        return false;
      }

      retryClickOriginalSend(14, 90, () => {
        clearInlineInput();
        state.autoFollow = true;
        scheduleSync(650);
      }, () => {
        state.data.draft = `${inlineDraftRaw}\n[ORACLE ERROR: send button not found or still disabled.]`;
        requestRender();
      });

      return true;
    }

    const sent = clickOriginalSend();

    if (sent) {
      clearInlineInput();
      state.autoFollow = true;
    }

    return sent;
  }

  function triggerOriginalAddFile() {
    if (state.popup.chatbox) dockNativeComposer();

    const fileInput = engineQsAll('input[type="file"]').find((el) => !el.disabled);

    if (fileInput) {
      fileInput.click();
      return true;
    }

    const attachBtn = engineQsAll(
      'button[aria-label*="Attach" i], button[aria-label*="Upload" i], button[aria-label*="Add photos" i], button[aria-label*="Add files" i], button[aria-label*="文件" i], button[aria-label*="附件" i], [role="button"][aria-label*="Attach" i]'
    ).find(Boolean);

    if (attachBtn) {
      attachBtn.click();
      return true;
    }

    return false;
  }

  function triggerOriginalDictate() {
    if (state.popup.chatbox) dockNativeComposer();

    const btn = engineQsAll(
      'button[aria-label*="Dictate" i], [role="button"][aria-label*="Dictate" i], button[aria-label*="dictation" i], [role="button"][aria-label*="dictation" i], button[aria-label*="语音" i], [role="button"][aria-label*="语音" i]'
    ).find(Boolean);

    if (btn) {
      btn.click();
      return true;
    }

    return false;
  }

  let hiddenNativeModelMenus = [];

  function triggerOriginalModelSelect() {
    toggleModelPopup();
    return true;
  }

  function hardClick(el) {
    if (!el) return false;

    try {
      el.scrollIntoView({
        block: "center",
        inline: "center"
      });
    } catch (_) {}

    try {
      el.focus();
    } catch (_) {}

    const rect = el.getBoundingClientRect();
    const x = rect.left + Math.max(1, rect.width / 2);
    const y = rect.top + Math.max(1, rect.height / 2);

    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y
    };

    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
      try {
        el.dispatchEvent(new MouseEvent(type, eventInit));
      } catch (_) {}
    });

    try {
      el.click();
    } catch (_) {}

    return true;
  }

  function isVisibleEnough(el) {
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;

    const style = window.getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;

    return true;
  }

  function getElementTextForModel(el) {
    return String(el ? (el.innerText || el.textContent || "") : "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isInsideConversationMessage(el) {
    return Boolean(
      el &&
      el.closest &&
      el.closest('[data-message-author-role], article')
    );
  }

  function looksLikeRetryOrMessageAction(label) {
    return /(try again|retry|regenerate|response|continue|copy|edit|share|read aloud|重新|重试|再试|重新生成|继续|复制|编辑|分享)/i.test(
      String(label || "")
    );
  }

  function looksLikeModelOptionText(label) {
    return /(gpt|o3|o4|4o|5\.5|5|auto|instant|medium|high|fast|thinking|mini|pro|model|intelligence|模型|智能|推理|快速)/i.test(
      String(label || "")
    );
  }

  function normalizeModelLabel(label) {
    return String(label || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^✓\s*/, "")
      .trim();
  }

  function modelLabelScore(label) {
    const raw = String(label || "");
    let score = 0;

    if (/(select model|switch model|model selector|model picker|choose model|选择模型|模型选择)/i.test(raw)) score += 80;
    if (looksLikeModelOptionText(raw)) score += 25;
    if (looksLikeRetryOrMessageAction(raw)) score -= 200;
    if (/(send|stop|cancel|attach|upload|voice|dictate|share|copy|edit|sidebar|history|发送|停止|取消|附件|上传|语音|分享|复制|编辑|侧边栏|历史)/i.test(raw)) score -= 120;

    return score;
  }

  function isDisabledControl(el) {
    return Boolean(el && (el.disabled || el.getAttribute("aria-disabled") === "true"));
  }

  function hasRectSize(el, minWidth = 2, minHeight = 2) {
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    return rect.width >= minWidth && rect.height >= minHeight;
  }

  function getModelCandidateLabel(el) {
    if (!el) return "";

    return [
      el.getAttribute("aria-label") || "",
      el.getAttribute("data-testid") || "",
      getElementTextForModel(el)
    ].join(" ").trim();
  }

  function hasAllTerms(text, terms) {
    return terms.every((term) => text.includes(term));
  }

  function pushSplitModelOptions(out, names, rootEl, menu, sourceLabel) {
    names.forEach((name) => {
      const child = findSmallestTextNodeElement(rootEl, name) || rootEl;
      const target = getClickableAncestorForModel(child, menu);

      out.push({
        label: name,
        el: target,
        textEl: child,
        sourceLabel,
        split: true,
        current: false
      });
    });
  }

  function pushUniqueModelOption(options, seen, option, key = option.label.toLowerCase()) {
    if (seen.has(key)) return false;

    seen.add(key);
    options.push(option);
    return true;
  }

  function getClickableAncestorForModel(el, stopAt = null) {
    let node = el;

    while (node && node !== document.body && node !== document.documentElement) {
      if (
        node.matches &&
        node.matches(MODEL_CLICKABLE_SELECTOR)
      ) {
        return node;
      }

      if (stopAt && node === stopAt) break;

      node = node.parentElement;
    }

    return el;
  }

  function findSmallestTextNodeElement(root, wantedLabel) {
    const wanted = normalizeModelLabel(wantedLabel).toLowerCase();
    if (!root || !wanted) return null;

    const nodes = qsAll(MODEL_TEXT_SELECTOR, root);

    const candidates = nodes
      .map((el) => {
        const text = normalizeModelLabel(getElementTextForModel(el));
        return { el, text };
      })
      .filter((item) => {
        if (!item.el || !item.text) return false;
        if (!isVisibleEnough(item.el)) return false;

        const lower = item.text.toLowerCase();

        return lower === wanted || lower.includes(wanted);
      });

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      const al = a.text.toLowerCase();
      const bl = b.text.toLowerCase();

      let ascore = 0;
      let bscore = 0;

      if (al === wanted) ascore -= 1000;
      if (bl === wanted) bscore -= 1000;

      ascore += a.text.length;
      bscore += b.text.length;

      return ascore - bscore;
    });

    return candidates[0].el;
  }

  function extractSplitModelOptions(label, rootEl, menu) {
    const text = normalizeModelLabel(label);
    const lower = text.toLowerCase();

    const out = [];

    /*
      ChatGPT sometimes renders this as one large row:
      "Intelligence Instant Medium High"
      We split it into the real selectable children.
    */
    const intelligenceGroup =
      hasAllTerms(lower, ["intelligence", "instant", "medium", "high"]);

    const compactReasoningGroup =
      hasAllTerms(lower, ["instant", "medium", "high"]) &&
      text.length < 120;

    if (intelligenceGroup || compactReasoningGroup) {
      pushSplitModelOptions(out, ["Instant", "Medium", "High"], rootEl, menu, text);
      return out;
    }

    /*
      Similar possible compact row:
      "Speed Auto Fast Thinking"
    */
    const speedGroup =
      hasAllTerms(lower, ["auto", "fast", "thinking"]) &&
      text.length < 120;

    if (speedGroup) {
      pushSplitModelOptions(out, ["Auto", "Fast", "Thinking"], rootEl, menu, text);
      return out;
    }

    return out;
  }

  function hasBetterChildModelOption(el, ownLabel) {
    const own = normalizeModelLabel(ownLabel);
    if (!el || !own) return false;

    const children = qsAll(MODEL_CHILD_OPTION_SELECTOR, el);

    return children.some((child) => {
      if (!child || child === el) return false;
      if (!isVisibleEnough(child)) return false;

      const childText = normalizeModelLabel(getElementTextForModel(child));
      if (!childText) return false;
      if (childText === own) return false;
      if (childText.length >= own.length) return false;

      if (!looksLikeModelOptionText(childText)) return false;
      if (looksLikeRetryOrMessageAction(childText)) return false;

      return true;
    });
  }

  function findRealModelButton() {
    const prompt = findNativePromptOutsideShell() || getDockedNativePrompt();

    const composer =
      document.querySelector(`#${ROOT_ID} .oracle-v14-native-composer`) ||
      findNativeComposerOutsideShell() ||
      (prompt ? prompt.closest("form") : null) ||
      (prompt ? prompt.closest('[data-testid*="composer" i]') : null) ||
      (prompt ? prompt.closest('[class*="composer" i]') : null);

    const searchBases = [];

    if (composer) searchBases.push(composer);

    searchBases.push(document);

    const seen = new Set();
    const candidates = [];

    searchBases.forEach((base) => {
      qsAll(
        [
          'button[aria-haspopup="menu"]',
          'button[aria-haspopup="listbox"]',
          '[role="button"][aria-haspopup="menu"]',
          '[role="button"][aria-haspopup="listbox"]',
          'button[data-testid*="model" i]',
          '[role="button"][data-testid*="model" i]',
          'button[aria-label*="model" i]',
          '[role="button"][aria-label*="model" i]',
          'button[aria-label*="模型" i]',
          '[role="button"][aria-label*="模型" i]',
          'button'
        ].join(", "),
        base
      ).forEach((el) => {
        if (!el) return;
        if (seen.has(el)) return;
        seen.add(el);

        if (isMine(el) && !el.closest(".oracle-v14-native-composer")) return;
        if (isInsideConversationMessage(el)) return;
        if (isDisabledControl(el)) return;

        const label = getModelCandidateLabel(el);
        if (!label) return;

        if (looksLikeRetryOrMessageAction(label)) return;

        if (!hasRectSize(el)) return;

        const explicit =
          /(select model|switch model|model selector|model picker|choose model|选择模型|模型选择)/i.test(label) ||
          /model/i.test(el.getAttribute("data-testid") || "") ||
          /model/i.test(el.getAttribute("aria-label") || "");

        const modelish =
          /\b(gpt|o3|o4|4o|5\.5|5|thinking|instant|auto|fast|mini|pro)\b/i.test(label) ||
          /(模型|推理|快速)/i.test(label);

        if (!explicit && !modelish) return;

        candidates.push(el);
      });
    });

    if (!candidates.length) return null;

    const promptRect = prompt ? prompt.getBoundingClientRect() : null;

    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();

      const alabel = getModelCandidateLabel(a);
      const blabel = getModelCandidateLabel(b);

      let ascore = -modelLabelScore(alabel);
      let bscore = -modelLabelScore(blabel);

      if (composer && composer.contains(a)) ascore -= 500;
      if (composer && composer.contains(b)) bscore -= 500;

      if (/model/i.test(a.getAttribute("data-testid") || "")) ascore -= 700;
      if (/model/i.test(b.getAttribute("data-testid") || "")) bscore -= 700;

      if (promptRect) {
        const acx = (ar.left + ar.right) / 2;
        const acy = (ar.top + ar.bottom) / 2;
        const bcx = (br.left + br.right) / 2;
        const bcy = (br.top + br.bottom) / 2;

        ascore += Math.abs(acy - (promptRect.top + promptRect.bottom) / 2);
        bscore += Math.abs(bcy - (promptRect.top + promptRect.bottom) / 2);

        ascore += Math.abs(acx - promptRect.right) * 0.35;
        bscore += Math.abs(bcx - promptRect.right) * 0.35;
      } else {
        ascore -= ar.top * 0.05;
        bscore -= br.top * 0.05;
      }

      return ascore - bscore;
    });

    return candidates[0];
  }

  function dispatchModelShortcut() {
    const eventInit = {
      key: "M",
      code: "KeyM",
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      shiftKey: true
    };

    try {
      document.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      document.dispatchEvent(new KeyboardEvent("keyup", eventInit));
      return true;
    } catch (_) {
      return false;
    }
  }

  function getOpenNativeModelMenus() {
    return engineQsAll(MODEL_MENU_SELECTOR)
      .filter((el) => {
        if (!el) return false;
        if (isMine(el)) return false;
        if (isInsideConversationMessage(el)) return false;

        const text = getElementTextForModel(el);
        if (!text) return false;
        if (looksLikeRetryOrMessageAction(text)) return false;

        if (!hasRectSize(el, 20, 20)) return false;

        const modelHits = (text.match(/gpt|o3|o4|4o|5\.5|5|auto|instant|medium|high|thinking|fast|mini|pro|intelligence|模型|智能|推理|快速/gi) || []).length;

        return modelHits >= 1;
      });
  }

  function collectRealModelOptions() {
    const menus = getOpenNativeModelMenus();

    const seen = new Set();
    const options = [];

    menus.forEach((menu) => {
      const nodes = qsAll(MODEL_OPTION_CANDIDATE_SELECTOR, menu);

      nodes.forEach((el) => {
        if (!el || isMine(el)) return;
        if (isInsideConversationMessage(el)) return;
        if (isDisabledControl(el)) return;
        if (!isVisibleEnough(el)) return;

        let label = normalizeModelLabel(getElementTextForModel(el));
        if (!label) return;

        if (label.length < 2 || label.length > 220) return;

        if (looksLikeRetryOrMessageAction(label)) return;

        if (/(new chat|temporary chat|customize|settings|upgrade|help|learn more|close|search|新聊天|临时聊天|设置|升级|帮助|关闭|搜索)/i.test(label)) {
          return;
        }

        const split = extractSplitModelOptions(label, el, menu);

        if (split.length) {
          split.forEach((item) => {
            pushUniqueModelOption(options, seen, item, `split:${item.label.toLowerCase()}`);
          });

          return;
        }

        if (!looksLikeModelOptionText(label)) return;

        /*
          Avoid parent rows swallowing child options.
          This is the important part for "Intelligence / Instant / Medium / High".
        */
        if (hasBetterChildModelOption(el, label)) return;

        /*
          Reject large combined section labels that are not a single option.
        */
        if (
          label.length > 80 &&
          /(instant|medium|high)/i.test(label) &&
          /(intelligence|智能)/i.test(label)
        ) {
          return;
        }

        const target = getClickableAncestorForModel(el, menu);
        const finalLabel = label;

        const ariaChecked = el.getAttribute("aria-checked") || target.getAttribute("aria-checked");
        const ariaSelected = el.getAttribute("aria-selected") || target.getAttribute("aria-selected");

        pushUniqueModelOption(options, seen, {
          label: finalLabel,
          el: target,
          textEl: el,
          sourceLabel: label,
          split: false,
          current: ariaChecked === "true" || ariaSelected === "true"
        });
      });
    });

    /*
      If we still collected a giant combined option, remove it when its children exist.
    */
    const hasInstant = options.some((x) => /^instant$/i.test(x.label));
    const hasMedium = options.some((x) => /^medium$/i.test(x.label));
    const hasHigh = options.some((x) => /^high$/i.test(x.label));

    const filtered = options.filter((x) => {
      if ((hasInstant || hasMedium || hasHigh) && /intelligence/i.test(x.label) && /(instant|medium|high)/i.test(x.label)) {
        return false;
      }

      return true;
    });

    return filtered.slice(0, 50);
  }

  function restoreNativeModelMenusSoftly() {
    hiddenNativeModelMenus.forEach((item) => {
      const menu = item && item.el;
      if (!menu) return;

      menu.style.opacity = item.opacity;
      menu.style.pointerEvents = item.pointerEvents;
      menu.style.transform = item.transform;
      menu.style.zIndex = item.zIndex;
    });

    hiddenNativeModelMenus = [];
  }

  function hideNativeModelMenusSoftly() {
    restoreNativeModelMenusSoftly();

    const menus = getOpenNativeModelMenus();

    hiddenNativeModelMenus = menus.map((menu) => ({
      el: menu,
      opacity: menu.style.opacity || "",
      pointerEvents: menu.style.pointerEvents || "",
      transform: menu.style.transform || "",
      zIndex: menu.style.zIndex || ""
    }));

    menus.forEach((menu) => {
      /*
        Do not move the menu offscreen.
        Moving it breaks coordinate-based and React-based clicks.
      */
      menu.style.setProperty("opacity", "0", "important");
      menu.style.setProperty("pointer-events", "none", "important");
      menu.style.setProperty("transform", "none", "important");
    });
  }

  function findOpenOptionByLabel(label) {
    const wanted = normalizeModelLabel(label).toLowerCase();
    if (!wanted) return null;

    const menus = getOpenNativeModelMenus();

    for (const menu of menus) {
      const exact = findSmallestTextNodeElement(menu, label);

      if (exact) {
        return getClickableAncestorForModel(exact, menu);
      }
    }

    return null;
  }

  function renderModelPopup(statusText = "") {
    const body = document.getElementById("oracle-v14-model-body");
    if (!body) return;

    body.textContent = "";

    if (statusText) {
      const status = document.createElement("div");
      status.className = "oracle-v14-model-status";
      status.textContent = statusText;
      body.appendChild(status);
    }

    const options = state.data.modelOptions || [];

    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "oracle-v14-empty";
      empty.textContent = "NO REAL MODEL OPTIONS DETECTED. TRY OPENING CHATBOX ONCE, THEN PRESS MODEL SELECT AGAIN.";
      body.appendChild(empty);
      return;
    }

    options.forEach((option, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `oracle-v14-model-option${option.current ? " current" : ""}`;
      btn.textContent = option.label;

      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        selectRealModelOption(idx);
      });

      body.appendChild(btn);
    });
  }

  function refreshRealModelOptionsAfterOpen(source = "button") {
    restoreNativeModelMenusSoftly();

    const options = collectRealModelOptions();

    state.data.modelOptions = options;

    if (!options.length) {
      renderModelPopup(
        source === "shortcut"
          ? "REAL MODEL MENU WAS NOT DETECTED AFTER CTRL+SHIFT+M."
          : "REAL MODEL MENU WAS NOT DETECTED. TRYING CTRL+SHIFT+M FALLBACK..."
      );

      if (source !== "shortcut") {
        dispatchModelShortcut();

        setTimeout(() => {
          refreshRealModelOptionsAfterOpen("shortcut");
        }, 420);
      }

      return;
    }

    renderModelPopup(`REAL MODEL OPTIONS DETECTED: ${options.length}`);

    /*
      Hide native menu from view, but keep it in the DOM.
      We restore it before actually clicking.
    */
    hideNativeModelMenusSoftly();
  }

  function toggleModelPopup() {
    state.popup.model = !state.popup.model;

    if (!state.popup.model) {
      updatePopups();
      state.data.modelOptions = [];
      restoreNativeModelMenusSoftly();
      return;
    }

    state.popup.sidebar = false;
    state.popup.thinking = false;
    updatePopups();

    state.data.modelOptions = [];
    renderModelPopup("OPENING REAL CHATGPT MODEL SELECTOR...");

    restoreNativeModelMenusSoftly();

    const btn = findRealModelButton();

    if (!btn) {
      renderModelPopup("REAL CHATGPT MODEL BUTTON NOT FOUND. TRYING CTRL+SHIFT+M FALLBACK...");
      dispatchModelShortcut();

      setTimeout(() => {
        refreshRealModelOptionsAfterOpen("shortcut");
      }, 500);

      return;
    }

    const label = `${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("data-testid") || ""} ${getElementTextForModel(btn)}`;

    if (looksLikeRetryOrMessageAction(label) || isInsideConversationMessage(btn)) {
      renderModelPopup("WRONG BUTTON REJECTED: RETRY / MESSAGE ACTION BUTTON. TRYING CTRL+SHIFT+M FALLBACK...");
      dispatchModelShortcut();

      setTimeout(() => {
        refreshRealModelOptionsAfterOpen("shortcut");
      }, 500);

      return;
    }

    hardClick(btn);

    setTimeout(() => {
      refreshRealModelOptionsAfterOpen("button");
    }, 420);

    setTimeout(() => {
      if (!state.data.modelOptions || !state.data.modelOptions.length) {
        refreshRealModelOptionsAfterOpen("button");
      }
    }, 960);
  }

  function selectRealModelOption(index) {
    const option = state.data.modelOptions && state.data.modelOptions[index];

    if (!option || !option.label) {
      renderModelPopup("MODEL OPTION LOST. PRESS MODEL SELECT AGAIN.");
      return;
    }

    renderModelPopup(`SWITCHING MODEL: ${option.label}`);

    restoreNativeModelMenusSoftly();

    const clickNow = () => {
      /*
        First, try to find the current live DOM option by label.
        This is safer than clicking an old saved element.
      */
      let target = findOpenOptionByLabel(option.label);

      if (!target && option.el && document.contains(option.el)) {
        target = option.el;
      }

      if (target) {
        hardClick(target);

        setTimeout(() => {
          state.popup.model = false;
          updatePopups();
          state.data.modelOptions = [];
          restoreNativeModelMenusSoftly();
          scheduleSync(350);
        }, 360);

        return;
      }

      /*
        If the real menu closed, reopen it and try again.
      */
      const btn = findRealModelButton();

      if (!btn) {
        renderModelPopup(`FAILED TO SWITCH: REAL MODEL BUTTON LOST FOR ${option.label}`);
        return;
      }

      hardClick(btn);

      setTimeout(() => {
        const reopenedTarget = findOpenOptionByLabel(option.label);

        if (!reopenedTarget) {
          renderModelPopup(`FAILED TO FIND REAL OPTION AFTER REOPEN: ${option.label}`);
          return;
        }

        hardClick(reopenedTarget);

        setTimeout(() => {
          state.popup.model = false;
          updatePopups();
          state.data.modelOptions = [];
          restoreNativeModelMenusSoftly();
          scheduleSync(350);
        }, 360);
      }, 420);
    };

    requestAnimationFrame(() => {
      setTimeout(clickNow, 0);
    });
  }
  function isChatGPTThinking() {
    const stopBtn = engineQsAll(
      [
        '[data-testid="stop-button"]',
        '[data-testid="composer-stop-button"]',
        'button[aria-label*="Stop" i]',
        'button[aria-label*="停止" i]',
        'button[aria-label*="Cancel" i]',
        'button[aria-label*="取消" i]'
      ].join(", ")
    ).find((el) => {
      if (!el) return false;
      if (el.disabled) return false;
      if (el.getAttribute("aria-disabled") === "true") return false;

      const label = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("data-testid") || ""} ${txt(el)}`.toLowerCase();

      return /stop|cancel|停止|取消/.test(label);
    });

    if (stopBtn) return true;

    const busyNode = engineQsAll(
      [
        '[aria-busy="true"]',
        '[data-testid*="streaming" i]',
        '[data-testid*="generating" i]',
        '[class*="streaming" i]'
      ].join(", ")
    ).find((el) => {
      if (!el) return false;
      if (isMine(el) && !el.closest(".oracle-v14-native-composer")) return false;

      const label = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("data-testid") || ""} ${el.className || ""}`.toLowerCase();

      if (/history|sidebar|model|selector|menu/.test(label)) return false;

      return true;
    });

    if (busyNode) return true;

    return false;
  }

  function forceOpenThinking() {
    engineQsAll("details").forEach((d) => {
      const label = txt(d).slice(0, 180);

      if (/(thinking|reasoning|thought for|思考|推理)/i.test(label)) {
        d.open = true;
        d.setAttribute("open", "");
      }
    });

    engineQsAll('button[aria-expanded="false"], [role="button"][aria-expanded="false"], summary').forEach((el) => {
      const label = `${txt(el)} ${el.getAttribute("aria-label") || ""}`;

      if (/(thinking|reasoning|thought for|思考|推理)/i.test(label)) {
        try { el.click(); } catch (_) {}
      }
    });
  }

  function normalizeProseText(str) {
    return String(str || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeCodeText(str) {
    return String(str || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/^\n+/, "")
      .replace(/\n+$/g, "");
  }

  function scoreCodeTextForIndentation(str) {
    const lines = String(str || "").split("\n");
    let score = 0;

    score += lines.length * 3;

    lines.forEach((line) => {
      if (/^[ \t]+/.test(line)) score += 5;
      if (line.includes("  ")) score += 1;
      if (/[{}()[\];,:]/.test(line)) score += 1;
    });

    return score;
  }

  function extractRawCodeTextFromPre(preEl) {
    if (!preEl) return "";

    const codeEl = preEl.querySelector("code") || preEl;

    const lineNodes = Array.from(
      codeEl.querySelectorAll('[data-line], [data-testid*="line" i], [class~="line"]')
    ).filter((node) => {
      const text = node.textContent || "";
      return text.length > 0;
    });

    if (lineNodes.length >= 2) {
      const byLines = lineNodes
        .map((node) => node.textContent || "")
        .join("\n");

      const normalizedByLines = normalizeCodeText(byLines);

      if (normalizedByLines.trim()) {
        return normalizedByLines;
      }
    }

    const fromTextContent = normalizeCodeText(codeEl.textContent || "");
    const fromInnerText = normalizeCodeText(codeEl.innerText || "");

    if (!fromTextContent) return fromInnerText;
    if (!fromInnerText) return fromTextContent;

    return scoreCodeTextForIndentation(fromInnerText) > scoreCodeTextForIndentation(fromTextContent)
      ? fromInnerText
      : fromTextContent;
  }

  function extractMessageSegments(root) {
    if (!root) return [];

    const segments = [];
    let prose = "";

    const blockTags = new Set([
      "P", "DIV", "LI", "UL", "OL", "SECTION", "ARTICLE",
      "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6",
      "TABLE", "THEAD", "TBODY", "TR"
    ]);

    const skipTags = new Set(["SCRIPT", "STYLE", "SVG", "BUTTON"]);

    const ensureNewline = () => {
      if (prose && !prose.endsWith("\n")) prose += "\n";
    };

    const flushProse = () => {
      const clean = normalizeProseText(prose);

      if (clean) {
        segments.push({
          type: "text",
          text: clean
        });
      }

      prose = "";
    };

    const walk = (node) => {
      if (!node) return;

      if (node.nodeType === Node.TEXT_NODE) {
        prose += node.nodeValue || "";
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const el = node;
      const tag = el.tagName;

      if (skipTags.has(tag)) return;

      if (tag === "PRE") {
        flushProse();

        const codeText = extractRawCodeTextFromPre(el);

        if (codeText.trim()) {
          segments.push({
            type: "code",
            text: codeText,
            copyText: codeText
          });
        }

        return;
      }

      if (tag === "BR") {
        prose += "\n";
        return;
      }

      const isBlock = blockTags.has(tag);

      if (isBlock) ensureNewline();

      Array.from(el.childNodes || []).forEach(walk);

      if (tag === "LI") prose += "\n";
      if (isBlock) ensureNewline();
    };

    walk(root);
    flushProse();

    if (!segments.length) {
      const fallback = normalizeProseText(txt(root));

      if (fallback) {
        segments.push({
          type: "text",
          text: fallback
        });
      }
    }

    return segments;
  }

  function cleanThinkingText(raw) {
    return String(raw || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function cleanThinkingTitle(raw) {
    const firstLine = cleanThinkingText(raw)
      .split(/\n+/)
      .map((x) => x.trim())
      .find(Boolean) || "";

    return firstLine
      .replace(/\s+/g, " ")
      .replace(/^#+\s*/, "")
      .slice(0, 72)
      .trim();
  }

  function looksLikeThinkingText(raw) {
    return /(thinking|reasoning|reasoned|thought|analyz|analysis|search|reading|browse|tool|思考|推理|分析|搜索|检索|浏览|读取|工具)/i.test(String(raw || ""));
  }

  function looksLikeNonThinkingUi(raw) {
    return /(model|selector|sidebar|history|conversation|menu|gpt|o3|o4|4o|share|copy|edit|retry|模型|侧边栏|历史|菜单)/i.test(String(raw || ""));
  }

  function extractThinkingBlock(el) {
    if (!el) return null;

    const summary = el.matches && el.matches("details")
      ? el.querySelector("summary")
      : null;

    const aria = el.getAttribute ? el.getAttribute("aria-label") || "" : "";
    const testid = el.getAttribute ? el.getAttribute("data-testid") || "" : "";

    const fullText = cleanThinkingText(el.innerText || el.textContent || "");
    const summaryText = cleanThinkingText(summary ? (summary.innerText || summary.textContent || "") : "");

    const title =
      cleanThinkingTitle(summaryText) ||
      cleanThinkingTitle(aria) ||
      cleanThinkingTitle(fullText) ||
      cleanThinkingTitle(testid);

    if (!title && !fullText) return null;

    const combined = `${title}\n${fullText}\n${aria}\n${testid}`;

    if (!looksLikeThinkingText(combined)) return null;
    if (looksLikeNonThinkingUi(title) && !looksLikeThinkingText(fullText)) return null;

    let content = fullText;

    if (summaryText && content.startsWith(summaryText)) {
      content = content.slice(summaryText.length).trim();
    }

    if (!content || content.length < 3) {
      content = fullText || title;
    }

    return {
      title: title || "visible thinking",
      content: content || title || "visible thinking"
    };
  }

  function collectVisibleThinkingModules() {
    const nodes = engineQsAll([
      'main details',
      'main [data-testid*="thinking" i]',
      'main [data-testid*="reasoning" i]',
      'main [data-testid*="thought" i]',
      'main [class*="thinking" i]',
      'main [class*="reasoning" i]',
      'main [class*="thought" i]',
      'main [aria-label*="Thinking" i]',
      'main [aria-label*="Reasoning" i]',
      'main [aria-label*="思考" i]',
      'main [aria-label*="推理" i]'
    ].join(", "));

    const seen = new Set();
    const modules = [];

    nodes.forEach((el) => {
      if (!usableDomNode(el)) return;

      const block = extractThinkingBlock(el);
      if (!block) return;

      const key = `${block.title}\n${block.content}`.toLowerCase();

      if (seen.has(key)) return;
      seen.add(key);

      modules.push(block);
    });

    return modules.slice(-8);
  }

  function normalizeSidebarHref(href) {
    return String(href || "").replace(/#.*$/, "");
  }

  function sidebarLinkKey(link) {
    const href = normalizeSidebarHref(link && link.href);
    const label = String(link && link.label || "");

    return href.includes("/c/") ? href : `${href}|${label}`;
  }

  function collectCurrentSidebarLinks() {
    return engineQsAll(SIDEBAR_LINK_SELECTOR)
      .map((a) => {
        const label = txt(a);
        const href = normalizeSidebarHref(a.href || a.getAttribute("href") || "");

        return { label, href, el: a };
      })
      .filter((link) => {
        if (!link.label || link.label.length < 2) return false;
        if (/skip|privacy|terms/i.test(link.label)) return false;
        if (!link.href) return false;

        return true;
      });
  }

  function mergeSidebarLinks(currentLinks) {
    const out = [];
    const byKey = new Map();

    const remember = (link) => {
      const key = sidebarLinkKey(link);
      if (!key) return;

      const existing = byKey.get(key);

      if (existing) {
        if (link.el) existing.el = link.el;
        if (link.href) existing.href = link.href;
        if (link.label && link.label.length >= existing.label.length) {
          existing.label = link.label;
        }

        return;
      }

      const item = {
        label: link.label,
        href: normalizeSidebarHref(link.href),
        el: link.el || null
      };

      byKey.set(key, item);
      out.push(item);
    };

    (state.data.chatLinks || []).forEach(remember);
    currentLinks.forEach(remember);

    return out;
  }

  function sidebarScrollerCandidateInfo(el) {
    if (!el || isMine(el)) return null;

    const clientHeight = el.clientHeight || 0;
    const scrollHeight = el.scrollHeight || 0;

    if (clientHeight < 20 || scrollHeight <= clientHeight + 32) return null;

    const chatCount = qsAll(CHAT_LINK_SELECTOR, el).length;
    if (!chatCount) return null;

    return {
      el,
      chatCount,
      scrollableRange: scrollHeight - clientHeight
    };
  }

  function findNativeSidebarScroller() {
    const candidates = new Map();
    const addCandidate = (el) => {
      const info = sidebarScrollerCandidateInfo(el);
      if (info && !candidates.has(info.el)) {
        candidates.set(info.el, info);
      }
    };

    engineQsAll(CHAT_LINK_SELECTOR).forEach((link) => {
      let node = link.parentElement;
      let depth = 0;

      while (node && node !== document.body && depth < 12) {
        addCandidate(node);
        node = node.parentElement;
        depth += 1;
      }
    });

    engineQsAll(SIDEBAR_CONTAINER_SELECTOR).forEach((root) => {
      addCandidate(root);
      qsAll("div, nav, aside, section", root).forEach(addCandidate);
    });

    return Array.from(candidates.values())
      .sort((a, b) => {
        if (b.chatCount !== a.chatCount) return b.chatCount - a.chatCount;
        return b.scrollableRange - a.scrollableRange;
      })[0]?.el || null;
  }

  function scrollNativeSidebarForOlderChats() {
    const scroller = findNativeSidebarScroller();
    if (!scroller) return false;

    const beforeTop = scroller.scrollTop || 0;
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (maxScroll <= 0) return false;

    const step = Math.max(420, Math.round((scroller.clientHeight || 0) * 0.85));
    const nextTop = Math.min(maxScroll, beforeTop + step);

    scroller.scrollTop = nextTop;

    try {
      scroller.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: step
      }));
    } catch (_) {}

    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));

    return scroller.scrollTop !== beforeTop || beforeTop < maxScroll;
  }

  function isSidebarPopupNearBottom() {
    const body = document.getElementById("oracle-v14-sidebar-body");
    if (!body) return false;

    return body.scrollTop + body.clientHeight >= body.scrollHeight - 96;
  }

  function requestSidebarHistoryLoad(delay = 120) {
    clearTimeout(sidebarLoadTimer);
    sidebarLoadTimer = setTimeout(loadMoreSidebarChats, delay);
  }

  function loadMoreSidebarChats() {
    if (sidebarAutoLoadBusy) return false;

    sidebarAutoLoadBusy = true;
    refreshSidebarPopup();

    const beforeCount = (state.data.chatLinks || []).length;
    const moved = scrollNativeSidebarForOlderChats();

    if (!moved) {
      sidebarAutoLoadBusy = false;
      refreshSidebarPopup();
      return false;
    }

    setTimeout(() => {
      collectData();
      sidebarAutoLoadBusy = false;
      refreshSidebarPopup();

      if (
        state.popup.sidebar &&
        state.data.chatLinks.length > beforeCount &&
        isSidebarPopupNearBottom()
      ) {
        requestSidebarHistoryLoad(360);
      }
    }, 700);

    return true;
  }

  function onSidebarPopupScroll() {
    if (!state.popup.sidebar || sidebarAutoLoadBusy) return;
    if (isSidebarPopupNearBottom()) requestSidebarHistoryLoad(140);
  }

  function collectData() {
    const currentlyThinking = isChatGPTThinking();

    if (currentlyThinking || state.popup.thinking) {
      forceOpenThinking();
    }

    const messages = engineQsAll('[data-message-author-role="assistant"], [data-message-author-role="user"]')
      .filter(usableDomNode)
      .slice(-MAX_MESSAGES)
      .map((msg) => {
        const role = msg.getAttribute("data-message-author-role") || "assistant";
        const contentNode = bestMessageContent(msg);
        const segments = extractMessageSegments(contentNode);
        const content = segments.map((seg) => seg.text).join("\n").trim() || txt(contentNode);

        return {
          role,
          content,
          segments
        };
      })
      .filter((m) => m.content);

    const thinkingModules = currentlyThinking || state.popup.thinking
      ? collectVisibleThinkingModules()
      : [];

    const thinking = thinkingModules
      .map((module) => {
        const title = module.title || "visible thinking";
        const content = module.content || "";

        if (!content || content === title) {
          return title;
        }

        return `${title}\n\n${content}`;
      })
      .filter(Boolean)
      .slice(-8);

    const links = mergeSidebarLinks(collectCurrentSidebarLinks());

    const inlineDraft = readInlineDraft();
    const nativePrompt = getDockedNativePrompt() || findNativePromptOutsideShell();
    const nativeDraft = nativePrompt ? readPromptValue(nativePrompt) : "";

    const draft = state.popup.chatbox
      ? (nativeDraft || inlineDraft)
      : (inlineDraft || nativeDraft);

    let modelLabel = "MODEL";
    const modelBtn = engineQsAll('button, [role="button"]').find((el) => {
      const label = `${el.getAttribute("aria-label") || ""} ${txt(el)}`;
      return /gpt|o3|o4|4o|model|模型/.test(label.toLowerCase());
    });

    if (modelBtn) {
      modelLabel = txt(modelBtn).slice(0, 28) || "MODEL";
    }

    state.data = {
      messages,
      thinking,
      thinkingModules,
      draft,
      chatLinks: links,
      modelLabel,
      modelOptions: state.data.modelOptions || [],
      isThinking: currentlyThinking
    };
  }

  function openSidebarLink(link) {
    if (!link) return;

    if (link.el && document.documentElement.contains(link.el)) {
      link.el.click();
      return;
    }

    if (link.href) {
      window.location.assign(link.href);
    }
  }

  function appendSidebarLoadButton(body) {
    const btn = document.createElement("button");
    btn.className = "oracle-v14-link-btn";
    btn.textContent = sidebarAutoLoadBusy ? "LOADING OLDER CHATS..." : "LOAD OLDER CHATS";
    btn.disabled = sidebarAutoLoadBusy;
    btn.addEventListener("click", () => {
      requestSidebarHistoryLoad(0);
    });
    body.appendChild(btn);
  }

  function refreshSidebarPopup() {
    const body = document.getElementById("oracle-v14-sidebar-body");
    if (!body) return;

    const previousScrollTop = body.scrollTop;

    body.textContent = "";

    if (!state.data.chatLinks.length) {
      const empty = document.createElement("div");
      empty.className = "oracle-v14-empty";
      empty.textContent = "NO SIDEBAR ITEMS DETECTED.";
      body.appendChild(empty);
      appendSidebarLoadButton(body);
      return;
    }

    state.data.chatLinks.forEach((link) => {
      const btn = document.createElement("button");
      btn.className = "oracle-v14-link-btn";
      btn.textContent = link.label;
      btn.addEventListener("click", () => {
        openSidebarLink(link);
        state.popup.sidebar = false;
        updatePopups();
        scheduleSync(350);
      });
      body.appendChild(btn);
    });

    appendSidebarLoadButton(body);
    body.scrollTop = Math.min(previousScrollTop, body.scrollHeight);
  }

  function refreshThinkingPopup() {
    const body = document.getElementById("oracle-v14-thinking-body");
    if (!body) return;

    body.textContent = "";

    const modules = state.data.thinkingModules && state.data.thinkingModules.length
      ? state.data.thinkingModules
      : [];

    if (!modules.length) {
      body.innerHTML = `<div class="oracle-v14-empty">NO VISIBLE THINKING BLOCK DETECTED. THE PAGE MAY NOT EXPOSE THINKING CONTENT.</div>`;
      return;
    }

    modules.forEach((module, idx) => {
      const div = document.createElement("div");
      div.style.marginBottom = "16px";

      const title = escapeHtml(module.title || `THINKING SIGNAL ${idx + 1}`);
      const content = escapeHtml(module.content || "");

      div.innerHTML = `
        <div class="oracle-v14-line-head">#--- ${title}</div>
        <div>${content}</div>
      `;

      body.appendChild(div);
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[m]));
  }

  function onMainWheel(event) {
    event.preventDefault();

    const viewH = screenCanvas ? screenCanvas.clientHeight : 0;
    const contentH = state.totalContentHeight || 0;
    const maxScroll = Math.max(0, contentH - Math.max(0, viewH - 56));

    state.mainScrollY += event.deltaY;

    if (state.mainScrollY < 0) state.mainScrollY = 0;
    if (state.mainScrollY > maxScroll) state.mainScrollY = maxScroll;

    state.autoFollow = state.mainScrollY >= maxScroll - 8;

    requestRender();
  }

  function hashMessages(messages, draft, modelLabel, isThinking, inputFocused, thinkingModules = []) {
    return JSON.stringify({
      m: messages.map((x) => [x.role, x.content]),
      d: draft,
      model: modelLabel,
      thinking: isThinking,
      thinkingModules: thinkingModules.map((x) => [x.title, x.content]),
      focused: inputFocused
    });
  }

  function scheduleSync(delay = 160) {
    clearTimeout(syncTimer);

    syncTimer = setTimeout(() => {
      if (!document.documentElement.classList.contains(ROOT_CLASS)) return;

      collectData();
      refreshSidebarPopup();
      refreshThinkingPopup();

      const nextHash = hashMessages(
        state.data.messages,
        state.data.draft,
        state.data.modelLabel,
        state.data.isThinking,
        state.inputFocused,
        state.data.thinkingModules
      );

      if (nextHash !== state.lastMessagesHash) {
        state.lastMessagesHash = nextHash;
        state.renderCache.key = "";
        requestRender();
      }
    }, delay);
  }

  function requestRender() {
    if (renderQueued) return;

    renderQueued = true;

    requestAnimationFrame(() => {
      renderQueued = false;
      renderMainTerminal();
    });
  }

  function initWebGL() {
    gl = screenCanvas.getContext("webgl", {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: false
    });

    if (!gl) return false;

    const vsSource = `
      attribute vec2 a_pos;
      varying vec2 v_uv;

      void main() {
        v_uv = (a_pos + 1.0) * 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision mediump float;

      varying vec2 v_uv;
      uniform sampler2D u_tex;
      uniform float u_curve;

      vec2 curve(vec2 uv) {
        vec2 p = uv * 2.0 - 1.0;

        float x2 = p.x * p.x;
        float y2 = p.y * p.y;

        p.x *= 1.0 + u_curve * y2;
        p.y *= 1.0 + u_curve * x2;

        return p * 0.5 + 0.5;
      }

      void main() {
        vec2 uv = curve(v_uv);

        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }

        vec4 color = texture2D(u_tex, vec2(uv.x, 1.0 - uv.y));

        float d = distance(v_uv, vec2(0.5, 0.5));
        float vignette = 1.0 - smoothstep(0.55, 0.92, d);

        color.rgb *= (0.86 + vignette * 0.20);

        gl_FragColor = color;
      }
    `;

    function compile(type, source) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, source);
      gl.compileShader(sh);

      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(sh));
        return null;
      }

      return sh;
    }

    const vs = compile(gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl.FRAGMENT_SHADER, fsSource);

    if (!vs || !fs) return false;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return false;
    }

    glProgram = program;
    gl.useProgram(program);
    glUniforms = {
      curve: gl.getUniformLocation(program, "u_curve"),
      tex: gl.getUniformLocation(program, "u_tex")
    };

    if (glUniforms.tex) {
      gl.uniform1i(glUniforms.tex, 0);
    }

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    glTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    return true;
  }

  function resizeCanvases() {
    dpr = Math.max(1, window.devicePixelRatio || 1);

    const rect = screenCanvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));

    if (screenCanvas.width !== w || screenCanvas.height !== h) {
      screenCanvas.width = w;
      screenCanvas.height = h;
    }

    if (!offscreen) {
      offscreen = document.createElement("canvas");
      offctx = offscreen.getContext("2d");
    }

    if (offscreen.width !== w || offscreen.height !== h) {
      offscreen.width = w;
      offscreen.height = h;
    }

    if (gl) {
      gl.viewport(0, 0, w, h);
    }

    state.renderCache.key = "";
    requestRender();
  }

  function wrapText(text, maxWidth, ctx) {
    if (!text) return [""];

    const paragraphs = String(text).split(/\n+/);
    const out = [];

    for (const para of paragraphs) {
      if (!para.trim()) {
        out.push("");
        continue;
      }

      const words = para.split(/\s+/);
      let line = "";

      for (const word of words) {
        const test = line ? `${line} ${word}` : word;

        if (ctx.measureText(test).width <= maxWidth) {
          line = test;
        } else {
          if (line) out.push(line);

          if (ctx.measureText(word).width <= maxWidth) {
            line = word;
          } else {
            let chunk = "";

            for (const ch of word) {
              const t = chunk + ch;

              if (ctx.measureText(t).width <= maxWidth) {
                chunk = t;
              } else {
                if (chunk) out.push(chunk);
                chunk = ch;
              }
            }

            line = chunk;
          }
        }
      }

      if (line) out.push(line);
    }

    return out.length ? out : [""];
  }

  function wrapPreservedLine(rawLine, maxWidth, ctx) {
    const lineText = String(rawLine || "").replace(/\t/g, "    ");

    if (!lineText) return [""];

    const out = [];
    let line = "";

    for (const ch of lineText) {
      const test = line + ch;

      if (!line || ctx.measureText(test).width <= maxWidth) {
        line = test;
      } else {
        out.push(line);
        line = ch;
      }
    }

    if (line || !out.length) out.push(line);

    return out;
  }

  function wrapCodeText(text, maxWidth, ctx) {
    const normalized = String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

    const out = [];

    normalized.split("\n").forEach((line) => {
      wrapPreservedLine(line, maxWidth, ctx).forEach((wrapped) => out.push(wrapped));
    });

    return out.length ? out : [""];
  }

  function drawGlowText(ctx, text, x, y, color, font) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10 * dpr;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }

  function drawRetroCenteredText(ctx, text, centerX, centerY, font, color) {
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = COLORS.selectGlow;
    ctx.shadowBlur = 7 * dpr;
    ctx.fillText(text, centerX, centerY);
    ctx.restore();
  }

  function drawCopyButtonLine(ctx, text, x, y, width, height, font) {
    ctx.save();

    ctx.shadowColor = COLORS.selectGlow;
    ctx.shadowBlur = 18 * dpr;
    ctx.fillStyle = COLORS.select;
    ctx.fillRect(x, y + 2 * dpr, width, Math.max(1, height - 4 * dpr));

    ctx.shadowBlur = 0;
    ctx.strokeStyle = COLORS.selectHot;
    ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(
      x + 0.5 * dpr,
      y + 2.5 * dpr,
      width - 1 * dpr,
      Math.max(1, height - 5 * dpr)
    );

    ctx.restore();

    drawRetroCenteredText(
      ctx,
      text,
      x + width / 2,
      y + height / 2,
      font,
      "#050200"
    );
  }

  function copyTextToClipboard(text) {
    const value = String(text || "");

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(value).catch(() => fallbackCopyText(value));
    }

    return fallbackCopyText(value);
  }

  function fallbackCopyText(text) {
    return new Promise((resolve, reject) => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      ta.setAttribute("readonly", "readonly");

      document.body.appendChild(ta);
      ta.select();

      try {
        const ok = document.execCommand("copy");

        if (ok) resolve();
        else reject(new Error("copy command failed"));
      } catch (err) {
        reject(err);
      } finally {
        if (ta.parentNode) {
          ta.parentNode.removeChild(ta);
        }
      }
    });
  }

  function makeThinkingProgressLines(title = "answer generation", moduleIndex = 1, moduleTotal = 1) {
    const t = performance.now() * 0.001;

    const pct = Math.floor((t * 20 + moduleIndex * 9) % 101);
    const barWidth = 44;
    const fill = Math.floor((pct / 100) * barWidth);

    let bar = "";

    for (let i = 0; i < barWidth; i += 1) {
      if (i < fill) {
        bar += "-";
      } else if (i === fill && pct < 100) {
        bar += ">";
      } else {
        bar += " ";
      }
    }

    const size = (18 + ((t * 13 + moduleIndex * 7) % 64)).toFixed(1).padStart(5, " ");
    const speed = Math.floor(320 + ((Math.sin(t * 2.4 + moduleIndex) + 1) * 420));
    const sec = String(Math.floor(t % 60)).padStart(2, "0");

    const safeTitle = String(title || "thinking")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 72);

    const phase = Math.floor(t * 2 + moduleIndex) % 4;
    const hooks = [
      "(1/1) reading visible reasoning module",
      "(1/1) syncing page thinking title",
      "(1/1) checking visible stream state",
      "(1/1) rendering CRT progress signal"
    ];

    return [
      `:: ${safeTitle}`,
      `:: visible thinking module ${moduleIndex}/${moduleTotal}`,
      `oracle-thinking.pkg.tar.zst   ${size} KiB  ${speed} KiB/s 00:${sec} [${bar}] ${String(pct).padStart(3, " ")}%`,
      hooks[phase]
    ];
  }

  function pushWrappedPromptLines(lines, prefix, draft, cursor, contentW, ctx) {
    const safeDraft = String(draft || "");
    const cursorIndex = Math.max(0, Math.min(safeDraft.length, state.inputCursor ?? safeDraft.length));
    const full = `${prefix}${safeDraft.slice(0, cursorIndex)}${cursor}${safeDraft.slice(cursorIndex)}`;
    const wrapped = wrapCodeText(full, contentW, ctx);

    wrapped.forEach((ln, idx) => {
      lines.push({
        text: ln,
        color: COLORS.amberHot,
        head: idx === 0
      });
    });
  }

  function pushCodeBlockLines(lines, codeText, contentW, ctx, codeId) {
    const copyText = String(codeText || "");

    wrapCodeText(copyText, contentW, ctx).forEach((ln) => {
      lines.push({
        text: ln,
        color: COLORS.amberHot,
        head: false,
        code: true
      });
    });

    lines.push({
      text: "COPY CODE",
      color: COLORS.select,
      head: false,
      kind: "copyButton",
      codeId,
      codeText: copyText
    });
  }

  function getStaticLinesCacheKey(contentW) {
    return JSON.stringify({
      width: Math.round(contentW),
      dpr: Math.round(dpr * 100),
      messages: state.data.messages.map((msg) => [
        msg.role,
        msg.content,
        (msg.segments || []).map((seg) => [seg.type, seg.text, seg.copyText || ""])
      ])
    });
  }

  function buildStaticMessageLines(contentW, bodyFont, codeFont, ctx) {
    const key = getStaticLinesCacheKey(contentW);

    if (state.renderCache.key === key && state.renderCache.lines.length) {
      return state.renderCache.lines.slice();
    }

    const lines = [];

    if (!state.data.messages.length) {
      lines.push({
        text: "oracle@chatgpt ~]$ waiting for answer signal...",
        color: COLORS.amberDeep,
        head: false
      });

      lines.push({
        text: "oracle@chatgpt ~]$ click screen to focus terminal input",
        color: COLORS.amberDeep,
        head: false
      });

      lines.push({
        text: "oracle@chatgpt ~]$ press [CHATBOX] only when you need native composer / upload UI",
        color: COLORS.amberDeep,
        head: false
      });

      lines.push({
        text: "",
        color: COLORS.amberDeep,
        head: false
      });
    }

    let codeBlockCounter = 0;

    state.data.messages.forEach((msg, idx) => {
      const head = msg.role === "user"
        ? "user@oracle ~]$"
        : `oracle[${idx + 1}]>`;

      lines.push({
        text: head,
        color: msg.role === "user" ? COLORS.red : COLORS.amberHot,
        head: true
      });

      const segments = msg.segments && msg.segments.length
        ? msg.segments
        : [{ type: "text", text: msg.content || "" }];

      segments.forEach((segment) => {
        if (!segment || !segment.text) return;

        if (segment.type === "code") {
          codeBlockCounter += 1;
          ctx.font = codeFont;
          pushCodeBlockLines(
            lines,
            segment.copyText || segment.text,
            contentW,
            ctx,
            `code-${idx}-${codeBlockCounter}`
          );
          ctx.font = bodyFont;
          return;
        }

        ctx.font = bodyFont;

        const wrapped = wrapText(segment.text, contentW, ctx);

        wrapped.forEach((ln) => {
          lines.push({
            text: ln,
            color: COLORS.amber,
            head: false
          });
        });
      });

      lines.push({
        text: "",
        color: COLORS.amber,
        head: false
      });
    });

    state.renderCache.key = key;
    state.renderCache.lines = lines.slice();

    return lines;
  }

  function updateSelectableLayer(lines, lineHeight, padTop, scrollY, blankScrollHeight) {
    const layer = document.getElementById("oracle-v14-select-layer");
    const content = document.getElementById("oracle-v14-select-content");

    if (!layer || !content) return;

    layer.querySelectorAll(".oracle-v14-code-copy-overlay").forEach((btn) => btn.remove());

    layer.style.paddingTop = `${Math.round(padTop / dpr)}px`;
    layer.style.paddingLeft = "18px";
    layer.style.paddingRight = "18px";

    content.style.lineHeight = `${Math.round(lineHeight / dpr)}px`;
    content.style.fontSize = "17px";
    content.style.transform = `translateY(${-Math.round(scrollY / dpr)}px)`;

    const text = lines.map((line) => line.text || "").join("\n");

    content.textContent = text;

    const spacer = document.createElement("div");
    spacer.style.height = `${Math.max(0, Math.round(blankScrollHeight / dpr))}px`;
    spacer.textContent = " ";
    content.appendChild(spacer);

    const visibleH = layer.clientHeight || 0;
    const cssLineHeight = Math.max(18, Math.round(lineHeight / dpr));

    lines.forEach((line, idx) => {
      if (!line || line.kind !== "copyButton") return;

      const top = Math.round((padTop + idx * lineHeight - scrollY) / dpr);

      if (top + cssLineHeight < 0 || top > visibleH) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "oracle-v14-code-copy-overlay";
      btn.textContent = "COPY CODE";
      btn.style.top = `${top}px`;
      btn.style.height = `${cssLineHeight}px`;
      btn.title = "Copy this code block";

      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        copyTextToClipboard(line.codeText).then(() => {
          btn.title = "Copied";
        }).catch(() => {
          btn.title = "Copy failed";
        });
      });

      layer.appendChild(btn);
    });
  }

  function appendThinkingProgressLines(lines) {
    if (!state.data.isThinking) return;

    const modules = state.data.thinkingModules && state.data.thinkingModules.length
      ? state.data.thinkingModules
      : [{ title: "answer generation", content: "" }];

    modules.forEach((module, moduleIdx) => {
      makeThinkingProgressLines(module.title, moduleIdx + 1, modules.length).forEach((ln, idx) => {
        lines.push({
          text: ln,
          color: idx < 2 ? COLORS.amberDim : COLORS.amberHot,
          head: idx === 2
        });
      });

      lines.push({
        text: "",
        color: COLORS.amber,
        head: false
      });
    });
  }

  function drawTerminalLines(lines, layout, fonts) {
    let y = layout.padTop - state.mainScrollY;

    for (const line of lines) {
      if (y > -layout.lineHeight && y < layout.contentH + layout.padTop) {
        if (line.kind === "copyButton") {
          drawCopyButtonLine(
            offctx,
            line.text,
            layout.padX,
            y,
            layout.contentW,
            layout.lineHeight,
            fonts.copyButton
          );
        } else {
          drawGlowText(
            offctx,
            line.text,
            layout.padX,
            y,
            line.color,
            line.code ? fonts.code : (line.head ? fonts.head : fonts.body)
          );
        }
      }

      y += layout.lineHeight;
    }
  }

  function renderMainTerminal() {
    if (!offctx || !gl || !glProgram || !screenCanvas) return;

    const w = offscreen.width;
    const h = offscreen.height;

    offctx.save();
    offctx.clearRect(0, 0, w, h);
    offctx.fillStyle = "#000000";
    offctx.fillRect(0, 0, w, h);

    const padX = 18 * dpr;
    const padTop = 14 * dpr;
    const padBottom = 12 * dpr;
    const contentW = w - padX * 2;
    const contentH = h - padTop - padBottom;

    const fontSize = 17 * dpr;
    const lineHeight = 24 * dpr;

    const headFont = `${fontSize}px "Glass TTY VT220", "VT323", "Cascadia Mono", monospace`;
    const bodyFont = `${fontSize}px "Glass TTY VT220", "VT323", "Cascadia Mono", monospace`;
    const codeFont = `${fontSize}px "Cascadia Mono", "Consolas", "Courier New", monospace`;
    const copyButtonFont = `${fontSize}px "Glass TTY VT220", "VT323", "Cascadia Mono", monospace`;

    offctx.textBaseline = "top";
    offctx.font = bodyFont;

    const lines = buildStaticMessageLines(contentW, bodyFont, codeFont, offctx);

    appendThinkingProgressLines(lines);

    const draft = state.data.draft || "";
    const cursorVisible = state.inputFocused && Math.floor(performance.now() / 530) % 2 === 0;
    const cursor = state.inputFocused ? (cursorVisible ? "█" : " ") : "";

    offctx.font = bodyFont;

    pushWrappedPromptLines(
      lines,
      "user@oracle ~]$ ",
      draft,
      cursor,
      contentW,
      offctx
    );

    const blankScrollHeight = Math.max(0, contentH - lineHeight);

    const textHeight = lines.length * lineHeight + 8 * dpr;
    const totalHeight = Math.max(contentH, textHeight + blankScrollHeight);

    state.totalContentHeight = totalHeight;

    const maxScroll = Math.max(0, totalHeight - contentH);

    if (state.autoFollow) {
      state.mainScrollY = maxScroll;
    } else {
      if (state.mainScrollY > maxScroll) state.mainScrollY = maxScroll;
      if (state.mainScrollY < 0) state.mainScrollY = 0;
    }

    updateSelectableLayer(lines, lineHeight, padTop, state.mainScrollY, blankScrollHeight);

    drawTerminalLines(
      lines,
      { padX, padTop, contentW, contentH, lineHeight },
      {
        head: headFont,
        body: bodyFont,
        code: codeFont,
        copyButton: copyButtonFont
      }
    );

    offctx.restore();

    gl.useProgram(glProgram);
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen);

    if (glUniforms.curve) {
      gl.uniform1f(glUniforms.curve, 0.11);
    }

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (
      (state.data.isThinking || state.inputFocused) &&
      document.documentElement.classList.contains(ROOT_CLASS)
    ) {
      const delay = state.data.isThinking ? 140 : 520;
      setTimeout(requestRender, delay);
    }
  }

  function init() {
    injectStyle();
    buildShell();

    if (!initWebGL()) {
      console.error("[oracle-v14-standby-toggle] WebGL init failed.");
      return;
    }

    resizeCanvases();

    if (getBool(STORE_ON, true)) {
      enableShell(true);
    } else {
      disableShell();
    }

    const observer = new MutationObserver((mutations) => {
      if (ignoreShellMutations(mutations)) return;
      scheduleSync(state.data.isThinking ? 120 : 420);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-message-author-role",
        "aria-label",
        "aria-expanded",
        "open",
        "data-testid"
      ]
    });

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeCanvases();
        scheduleSync(80);
      }, 100);
    });

    window.addEventListener("focus", () => {
      scheduleSync(160);
      requestRender();
    });

    document.addEventListener("keydown", (event) => {
      const input = getInlineInput();

      if (
        input &&
        document.activeElement === input &&
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        event.stopPropagation();
        sendCurrentPrompt();
        return;
      }

      if (event.altKey && event.shiftKey && event.key.toLowerCase() === "o") {
        const nowOn = document.documentElement.classList.contains(ROOT_CLASS);

        showBootOverlay(2000);

        afterOverlayPaint(() => {
          if (nowOn) {
            setBool(STORE_ON, false);
            disableShell();
          } else {
            setBool(STORE_ON, true);
            enableShell();
          }

          updateToggleButtonLabel();
        });
      }
    });

    setInterval(() => {
      if (!document.documentElement.classList.contains(ROOT_CLASS)) return;

      if (!state.inputFocused) {
        scheduleSync(state.data.isThinking ? 180 : 900);
      }

      if (state.popup.chatbox) {
        dockNativeComposer(false);
      }
    }, 1400);

    updateToggleButtonLabel();

    console.log("[Oracle CRT v14.9 Standby Toggle] loaded. Alt+Shift+O toggles shell.");
  }

  function waitForBody() {
    if (document.body) {
      init();
      return;
    }

    setTimeout(waitForBody, 100);
  }

  waitForBody();
})();
