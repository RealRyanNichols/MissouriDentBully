(function () {
  'use strict';

  // Prevent double-injection
  if (document.getElementById('mdb-chat-widget')) return;

  // --- Configuration ----------------------------------------------------------
  var BASE_URL = '';
  var GREETING = "Hey! \uD83D\uDC4B\n\nI'm Jason's assistant at **Dent Bully**.\n\nWhat's going on with your vehicle?\n\n[CHIPS: Hail damage | Door ding / dent | Full detail / ceramic | Just looking around]";
  var STORAGE_KEY = 'mdb-chat-state';
  var STORAGE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  // --- State ------------------------------------------------------------------
  var isOpen = false;
  var messages = [];
  var isLoading = false;
  var leadCaptured = false;
  var collectedInfo = { name: null, phone: null, damageType: null, vehicle: null };
  var hasGreeted = false;

  // --- DOM references ---------------------------------------------------------
  var els = {};

  // --- Detect base URL from script src ----------------------------------------
  function detectBaseUrl() {
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src;
      if (src.indexOf('widget.js') !== -1) {
        try {
          var url = new URL(src);
          BASE_URL = url.origin;
        } catch (e) {
          // Fallback: extract origin manually
          var a = document.createElement('a');
          a.href = src;
          BASE_URL = a.protocol + '//' + a.host;
        }
        break;
      }
    }
  }

  // --- Inject styles ---------------------------------------------------------
  function injectStyles() {
    var style = document.createElement('style');
    style.id = 'mdb-chat-styles';
    style.textContent = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');\n" +
      "#mdb-chat-widget{--mdb-black:#0D0D0D;--mdb-red:#C0392B;--mdb-white:#F5F5F5;--mdb-gray:#1E1E1E;--mdb-border:#333;--mdb-font:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-family:var(--mdb-font);font-size:14px;line-height:1.5;box-sizing:border-box}" +
      "#mdb-chat-widget *,#mdb-chat-widget *::before,#mdb-chat-widget *::after{box-sizing:border-box;margin:0;padding:0}" +
      "#mdb-chat-widget .mdb-bubble{position:fixed;bottom:24px;right:24px;width:60px;height:60px;background:var(--mdb-red);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(192,57,43,0.5);z-index:999999;transition:transform 0.2s ease;border:none;outline:none}" +
      "#mdb-chat-widget .mdb-bubble:hover{transform:scale(1.08)}" +
      "#mdb-chat-widget .mdb-bubble svg{width:28px;height:28px;fill:#fff}" +
      "#mdb-chat-widget .mdb-window{position:fixed;bottom:96px;right:24px;width:370px;height:520px;background:var(--mdb-black);border:1px solid var(--mdb-border);border-radius:6px;display:none;flex-direction:column;z-index:999998;font-family:var(--mdb-font);overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.6)}" +
      "#mdb-chat-widget .mdb-window.mdb-open{display:flex}" +
      "#mdb-chat-widget .mdb-header{background:var(--mdb-gray);padding:14px 16px;border-bottom:2px solid var(--mdb-red);display:flex;align-items:center;justify-content:space-between;flex-shrink:0}" +
      "#mdb-chat-widget .mdb-header-info{display:flex;flex-direction:column;gap:2px}" +
      "#mdb-chat-widget .mdb-header-title{color:var(--mdb-white);font-weight:700;font-size:15px;letter-spacing:1px;text-transform:uppercase}" +
      "#mdb-chat-widget .mdb-header-title span{color:var(--mdb-red)}" +
      "#mdb-chat-widget .mdb-header-subtitle{color:#888;font-size:11px;letter-spacing:0.5px;text-transform:uppercase}" +
      "#mdb-chat-widget .mdb-close{background:none;border:none;color:#888;font-size:22px;cursor:pointer;padding:4px 8px;line-height:1;transition:color 0.15s ease}" +
      "#mdb-chat-widget .mdb-close:hover{color:var(--mdb-white)}" +
      "#mdb-chat-widget .mdb-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}" +
      "#mdb-chat-widget .mdb-messages::-webkit-scrollbar{width:5px}" +
      "#mdb-chat-widget .mdb-messages::-webkit-scrollbar-track{background:var(--mdb-black)}" +
      "#mdb-chat-widget .mdb-messages::-webkit-scrollbar-thumb{background:#444;border-radius:3px}" +
      "#mdb-chat-widget .mdb-messages::-webkit-scrollbar-thumb:hover{background:var(--mdb-red)}" +
      "#mdb-chat-widget .mdb-msg{max-width:85%;padding:10px 13px;border-radius:4px;font-size:14px;line-height:1.5;word-wrap:break-word}" +
      "#mdb-chat-widget .mdb-msg.mdb-bot{background:var(--mdb-gray);color:var(--mdb-white);align-self:flex-start;border-left:3px solid var(--mdb-red)}" +
      "#mdb-chat-widget .mdb-msg.mdb-user{background:var(--mdb-red);color:#fff;align-self:flex-end}" +
      "#mdb-chat-widget .mdb-typing{display:none;align-self:flex-start;padding:10px 16px;background:var(--mdb-gray);border-radius:4px;border-left:3px solid var(--mdb-red)}" +
      "#mdb-chat-widget .mdb-typing.mdb-visible{display:flex;gap:4px;align-items:center}" +
      "#mdb-chat-widget .mdb-typing-dot{width:7px;height:7px;background:var(--mdb-red);border-radius:50%;animation:mdb-bounce 1.4s infinite ease-in-out both}" +
      "#mdb-chat-widget .mdb-typing-dot:nth-child(1){animation-delay:0s}" +
      "#mdb-chat-widget .mdb-typing-dot:nth-child(2){animation-delay:0.16s}" +
      "#mdb-chat-widget .mdb-typing-dot:nth-child(3){animation-delay:0.32s}" +
      "@keyframes mdb-bounce{0%,80%,100%{transform:scale(0.6);opacity:0.4}40%{transform:scale(1);opacity:1}}" +
      "#mdb-chat-widget .mdb-input-row{display:flex;border-top:1px solid var(--mdb-border);padding:10px;gap:8px;background:var(--mdb-gray);flex-shrink:0}" +
      "#mdb-chat-widget .mdb-input{flex:1;background:var(--mdb-black);border:1px solid var(--mdb-border);color:var(--mdb-white);padding:10px 12px;border-radius:4px;font-size:14px;font-family:var(--mdb-font);outline:none;transition:border-color 0.15s ease}" +
      "#mdb-chat-widget .mdb-input:focus{border-color:var(--mdb-red)}" +
      "#mdb-chat-widget .mdb-input::placeholder{color:#666}" +
      "#mdb-chat-widget .mdb-send{background:var(--mdb-red);color:#fff;border:none;padding:10px 16px;border-radius:4px;cursor:pointer;font-weight:700;font-size:13px;font-family:var(--mdb-font);letter-spacing:0.5px;text-transform:uppercase;transition:background 0.15s ease}" +
      "#mdb-chat-widget .mdb-send:hover{background:#a93226}" +
      "#mdb-chat-widget .mdb-send:disabled{opacity:0.5;cursor:not-allowed}" +
      "#mdb-chat-widget .mdb-lead-captured{background:var(--mdb-gray);padding:16px;text-align:center;flex-shrink:0;border-top:1px solid var(--mdb-border)}" +
      "#mdb-chat-widget .mdb-lead-check{font-size:28px;color:#27ae60;margin-bottom:6px}" +
      "#mdb-chat-widget .mdb-lead-captured p{color:var(--mdb-white);font-size:13px;margin-bottom:4px}" +
      "#mdb-chat-widget .mdb-lead-captured a{color:var(--mdb-red);font-weight:700;font-size:16px;text-decoration:none;letter-spacing:0.5px}" +
      "#mdb-chat-widget .mdb-lead-captured a:hover{text-decoration:underline}" +
      "#mdb-chat-widget .mdb-msg p{margin-bottom:8px}" +
      "#mdb-chat-widget .mdb-msg p:last-child{margin-bottom:0}" +
      "#mdb-chat-widget .mdb-msg strong{color:#fff;font-weight:700}" +
      "#mdb-chat-widget .mdb-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-self:flex-start;max-width:85%}" +
      "#mdb-chat-widget .mdb-chip{background:transparent;color:var(--mdb-white);border:1.5px solid var(--mdb-red);padding:7px 12px;border-radius:2px;cursor:pointer;font-size:13px;font-weight:600;font-family:var(--mdb-font);transition:all 0.15s ease}" +
      "#mdb-chat-widget .mdb-chip:hover{background:var(--mdb-red);color:#fff}" +
      "#mdb-chat-widget .mdb-chip:disabled{opacity:0.4;cursor:not-allowed;pointer-events:none}" +
      "@media(max-width:480px){" +
        "#mdb-chat-widget .mdb-bubble{bottom:16px;right:16px}" +
        "#mdb-chat-widget .mdb-window{width:100%;height:100%;bottom:0;right:0;border-radius:0;border:none}" +
        "#mdb-chat-widget .mdb-window.mdb-open~.mdb-bubble{display:none}" +
        "#mdb-chat-widget .mdb-close{font-size:26px;padding:8px 12px}" +
        "#mdb-chat-widget .mdb-input{font-size:16px}" +
      "}";
    document.head.appendChild(style);
  }

  // --- Inject HTML ------------------------------------------------------------
  function injectHTML() {
    var container = document.createElement('div');
    container.id = 'mdb-chat-widget';
    container.innerHTML =
      // Chat window (placed before bubble so CSS ~ selector works on mobile)
      '<div class="mdb-window" role="dialog" aria-label="Chat with Missouri Dent Bully">' +
        '<div class="mdb-header">' +
          '<div class="mdb-header-info">' +
            '<div class="mdb-header-title">DENT <span>BULLY</span></div>' +
            '<div class="mdb-header-subtitle">PDR &amp; Reconditioning</div>' +
          '</div>' +
          '<button class="mdb-close" aria-label="Close chat">&times;</button>' +
        '</div>' +
        '<div class="mdb-messages"></div>' +
        '<div class="mdb-typing">' +
          '<div class="mdb-typing-dot"></div>' +
          '<div class="mdb-typing-dot"></div>' +
          '<div class="mdb-typing-dot"></div>' +
        '</div>' +
        '<div class="mdb-input-row">' +
          '<input class="mdb-input" type="text" placeholder="Type your message..." aria-label="Type your message">' +
          '<button class="mdb-send">Send</button>' +
        '</div>' +
      '</div>' +
      // Chat bubble
      '<button class="mdb-bubble" aria-label="Open chat">' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
          '<path d="M22.7 14.3L21.7 15.3L19.7 13.3L20.7 12.3C20.9 12.1 21.2 12.1 21.4 12.3L22.7 13.6C22.9 13.8 22.9 14.1 22.7 14.3M13 19.9V21.9H15L21.1 15.8L19.1 13.8L13 19.9M11.2 17H3V15C3 12.3 8.3 11 11 11L11.2 17M11 4C8.8 4 7 5.8 7 8S8.8 12 11 12 15 10.2 15 8 13.2 4 11 4Z"/>' +
        '</svg>' +
      '</button>';
    document.body.appendChild(container);
  }

  // --- Cache DOM elements -----------------------------------------------------
  function cacheElements() {
    var w = document.getElementById('mdb-chat-widget');
    els.widget = w;
    els.bubble = w.querySelector('.mdb-bubble');
    els.window = w.querySelector('.mdb-window');
    els.close = w.querySelector('.mdb-close');
    els.messages = w.querySelector('.mdb-messages');
    els.typing = w.querySelector('.mdb-typing');
    els.inputRow = w.querySelector('.mdb-input-row');
    els.input = w.querySelector('.mdb-input');
    els.send = w.querySelector('.mdb-send');
  }

  // --- Event listeners -------------------------------------------------------
  function attachListeners() {
    els.bubble.addEventListener('click', toggleChat);
    els.close.addEventListener('click', toggleChat);
    els.send.addEventListener('click', handleSend);
    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
  }

  // --- Toggle chat open/close ------------------------------------------------
  function toggleChat() {
    isOpen = !isOpen;
    if (isOpen) {
      els.window.classList.add('mdb-open');
      if (!hasGreeted) {
        hasGreeted = true;
        messages.push({ role: 'assistant', content: GREETING });
        renderMessage('assistant', GREETING);
        persistState();
      }
      els.input.focus();
    } else {
      els.window.classList.remove('mdb-open');
    }
  }

  // --- Handle send button ----------------------------------------------------
  function handleSend() {
    var text = els.input.value.trim();
    if (!text || isLoading || leadCaptured) return;
    sendMessage(text);
  }

  // --- Send message ----------------------------------------------------------
  function sendMessage(userText) {
    // Add user message
    messages.push({ role: 'user', content: userText });
    renderMessage('user', userText);
    els.input.value = '';
    els.send.disabled = true;

    // Show typing indicator
    isLoading = true;
    els.typing.classList.add('mdb-visible');
    scrollToBottom();

    // API call
    fetch(BASE_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        var reply = data.reply;
        messages.push({ role: 'assistant', content: reply });
        renderMessage('assistant', reply);
        checkForLeadInfo();
        persistState();
      })
      .catch(function () {
        var errMsg = "Sorry, something went wrong on my end. Give us a call or text at 636-385-2928 and we\u2019ll get you sorted out.";
        messages.push({ role: 'assistant', content: errMsg });
        renderMessage('assistant', errMsg);
      })
      .finally(function () {
        isLoading = false;
        els.typing.classList.remove('mdb-visible');
        els.send.disabled = false;
        scrollToBottom();
      });
  }

  // --- Render a message in the DOM -------------------------------------------
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function formatBotHtml(text) {
    var paras = text.split(/\n\s*\n/);
    return paras.map(function (p) {
      var safe = escapeHtml(p.trim());
      safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      safe = safe.replace(/\n/g, '<br>');
      return '<p>' + safe + '</p>';
    }).join('');
  }
  function extractChips(text) {
    var m = text.match(/\[CHIPS:\s*([^\]]+)\]\s*$/i);
    if (!m) return { text: text, chips: [] };
    var chips = m[1].split('|').map(function (s) { return s.trim(); }).filter(Boolean);
    return { text: text.slice(0, m.index).trim(), chips: chips };
  }
  function renderMessage(role, content) {
    var div = document.createElement('div');
    div.className = 'mdb-msg ' + (role === 'user' ? 'mdb-user' : 'mdb-bot');
    if (role === 'user') {
      div.textContent = content;
      els.messages.appendChild(div);
    } else {
      var parsed = extractChips(content);
      div.innerHTML = formatBotHtml(parsed.text);
      els.messages.appendChild(div);
      if (parsed.chips.length) {
        var row = document.createElement('div');
        row.className = 'mdb-chips';
        parsed.chips.forEach(function (label) {
          var btn = document.createElement('button');
          btn.className = 'mdb-chip';
          btn.type = 'button';
          btn.textContent = label;
          btn.addEventListener('click', function () {
            // disable all chips in this row
            [].forEach.call(row.querySelectorAll('.mdb-chip'), function (b) { b.disabled = true; });
            if (isLoading || leadCaptured) return;
            sendMessage(label);
          });
          row.appendChild(btn);
        });
        els.messages.appendChild(row);
      }
    }
    scrollToBottom();
  }

  // --- Scroll messages to bottom ---------------------------------------------
  function scrollToBottom() {
    setTimeout(function () {
      els.messages.scrollTop = els.messages.scrollHeight;
    }, 50);
  }

  // --- Lead detection --------------------------------------------------------
  function checkForLeadInfo() {
    if (leadCaptured) return;

    var userText = messages
      .filter(function (m) { return m.role === 'user'; })
      .map(function (m) { return m.content; })
      .join(' ');

    // Detect phone number
    if (!collectedInfo.phone) {
      var phoneMatch = userText.match(/(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/);
      if (phoneMatch) {
        collectedInfo.phone = phoneMatch[0];
      }
    }

    // Detect name
    if (!collectedInfo.name) {
      var nameMatch = userText.match(/(?:my name is|i'm|i am|this is|name's|name is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
      if (nameMatch) {
        collectedInfo.name = nameMatch[1].trim();
      }
    }

    // Detect damage type / service need
    if (!collectedInfo.damageType) {
      var keywords = [
        'hail damage', 'hail', 'door ding', 'dent', 'ding', 'crease',
        'full detail', 'detailing', 'detail', 'ceramic coating', 'ceramic',
        'paint correction', 'interior', 'exterior', 'headlight',
        'scratch', 'paint', 'odor', 'vip refresh'
      ];
      var lower = userText.toLowerCase();
      for (var i = 0; i < keywords.length; i++) {
        if (lower.indexOf(keywords[i]) !== -1) {
          collectedInfo.damageType = keywords[i];
          break;
        }
      }
    }

    // Detect vehicle info
    if (!collectedInfo.vehicle) {
      var vehicleMatch = userText.match(/(\d{4})\s+([A-Za-z]+)\s+([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?)/);
      if (vehicleMatch) {
        collectedInfo.vehicle = vehicleMatch[0].trim();
      }
    }

    // Submit lead when we have name + phone
    if (collectedInfo.name && collectedInfo.phone) {
      submitLead();
    }
  }

  // --- Submit lead -----------------------------------------------------------
  function submitLead() {
    if (leadCaptured) return;
    leadCaptured = true;

    var leadData = {
      name: collectedInfo.name,
      phone: collectedInfo.phone,
      damage_type: collectedInfo.damageType || 'Not specified',
      vehicle: collectedInfo.vehicle || 'Not specified',
      conversation: messages,
      timestamp: new Date().toISOString()
    };

    // Save to localStorage
    try {
      var existing = JSON.parse(localStorage.getItem('mdb-leads') || '[]');
      existing.push(leadData);
      localStorage.setItem('mdb-leads', JSON.stringify(existing));
    } catch (e) { /* localStorage unavailable */ }

    // POST to server
    fetch(BASE_URL + '/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadData)
    }).catch(function (e) {
      console.error('Dent Bully: lead submission failed', e);
    });

    showLeadCapturedUI();
    persistState();
  }

  // --- Show lead captured UI -------------------------------------------------
  function showLeadCapturedUI() {
    els.inputRow.innerHTML =
      '<div class="mdb-lead-captured">' +
        '<div class="mdb-lead-check">\u2713</div>' +
        '<p>Thanks! We\u2019ll be in touch soon.</p>' +
        '<p>Or reach us now:</p>' +
        '<a href="tel:6363852928">636-385-2928</a>' +
      '</div>';
  }

  // --- Persist state to localStorage -----------------------------------------
  function persistState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        messages: messages,
        collectedInfo: collectedInfo,
        leadCaptured: leadCaptured,
        hasGreeted: hasGreeted,
        savedAt: Date.now()
      }));
    } catch (e) { /* localStorage unavailable */ }
  }

  // --- Restore state from localStorage ---------------------------------------
  function restoreState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      var state = JSON.parse(raw);

      // Check TTL
      if (Date.now() - state.savedAt > STORAGE_TTL) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }

      messages = state.messages || [];
      collectedInfo = state.collectedInfo || { name: null, phone: null, damageType: null, vehicle: null };
      leadCaptured = state.leadCaptured || false;
      hasGreeted = state.hasGreeted || false;

      // Render restored messages
      for (var i = 0; i < messages.length; i++) {
        renderMessage(messages[i].role, messages[i].content);
      }

      // Restore lead captured UI if needed
      if (leadCaptured) {
        showLeadCapturedUI();
      }
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  // --- Initialize -------------------------------------------------------------
  function init() {
    detectBaseUrl();
    injectStyles();
    injectHTML();
    cacheElements();
    attachListeners();
    restoreState();
  }

  // Run init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
