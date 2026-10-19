(function () {
  'use strict';

  const DEFAULT_TITLE = 'Contextis Support';
  const DEFAULT_ACCENT = '#38bdf8';

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function getStoredValue(key, fallback = '') {
    try {
      return localStorage.getItem(key) || sessionStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function setStoredValue(key, value) {
    try {
      localStorage.setItem(key, value);
      sessionStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }

  function createWidget(options = {}) {
    const scriptTag = document.currentScript || document.querySelector('script[data-project-id]');
    const dataProjectId = scriptTag ? scriptTag.getAttribute('data-project-id') : '';
    const dataPublicKey = scriptTag ? (scriptTag.getAttribute('data-public-key') || scriptTag.getAttribute('data-api-key')) : '';

    const storedUserId = getStoredValue('contextis_user_id', '');
    const generatedUserId = 'customer_' + Math.random().toString(36).slice(2, 8);
    const initialUserId = options.userId || dataProjectId ? (options.userId || storedUserId || generatedUserId) : generatedUserId;
    setStoredValue('contextis_user_id', initialUserId);

    const config = {
      projectId: options.projectId || dataProjectId || '',
      publicKey: options.publicKey || options.projectKey || dataPublicKey || '',
      userId: initialUserId,
      title: options.title || options.agentName || DEFAULT_TITLE,
      welcome: options.welcomeMessage || options.welcome || 'Hi! How can we help you today?',
      accent: options.accentColor || options.accent || DEFAULT_ACCENT,
      position: options.position || 'bottom-right',
      theme: options.theme || 'dark',
      placeholder: options.placeholder || 'Type your message...',
      apiEndpoint: options.apiEndpoint || '/v1/support/chat',
      openingEndpoint: options.openingEndpoint || '/v1/support/opening',
      feedbackEndpoint: options.feedbackEndpoint || '/v1/support/feedback',
      escalateEndpoint: options.escalateEndpoint || '/v1/support/escalate',
      root: options.root || document.body,
    };

    // Prevent duplicate widget
    if (document.getElementById('contextis-widget-root')) {
      return window.ContextisWidget;
    }

    let conversationId = getStoredValue('contextis_conv_id', '');

    const container = document.createElement('div');
    container.id = 'contextis-widget-root';
    container.style.position = 'fixed';
    container.style.bottom = 'calc(24px + env(safe-area-inset-bottom, 0px))';
    container.style[config.position === 'bottom-left' ? 'left' : 'right'] = '24px';
    container.style.zIndex = '999999';
    container.style.fontFamily = 'Inter, system-ui, -apple-system, sans-serif';

    const shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;

    const styles = document.createElement('style');
    styles.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      @media (prefers-reduced-motion: reduce) {
        .launcher, .panel { transition: none !important; transform: none !important; }
      }
      .launcher {
        width: 58px;
        height: 58px;
        border-radius: 50%;
        background: ${config.accent};
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 0 16px ${config.accent}44;
        border: 1px solid rgba(255, 255, 255, 0.25);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #031525;
        font-weight: 700;
        font-size: 24px;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
      }
      .launcher:hover {
        transform: scale(1.06);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45), 0 0 24px ${config.accent}66;
      }
      .panel {
        position: absolute;
        bottom: 74px;
        ${config.position === 'bottom-left' ? 'left: 0;' : 'right: 0;'}
        width: 390px;
        max-width: calc(100vw - 32px);
        height: 550px;
        max-height: calc(100vh - 100px);
        background: ${config.theme === 'light' ? 'rgba(255, 255, 255, 0.98)' : 'rgba(11, 19, 41, 0.96)'};
        color: ${config.theme === 'light' ? '#0f172a' : '#f8fafc'};
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        border: 1px solid ${config.theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.12)'};
        border-radius: 20px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55), 0 0 30px rgba(56, 189, 248, 0.08);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
        transform: translateY(16px) scale(0.96);
        transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .panel.open {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0) scale(1);
      }
      .header {
        padding: 14px 18px;
        background: ${config.theme === 'light' ? 'rgba(240, 246, 255, 0.9)' : 'rgba(16, 28, 58, 0.9)'};
        border-bottom: 1px solid ${config.theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'};
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .header-title-box { display: flex; align-items: center; gap: 10px; }
      .header-icon {
        width: 32px; height: 32px; border-radius: 8px;
        background: ${config.accent}; color: #031525;
        display: flex; align-items: center; justify-content: center;
        font-weight: 800; font-size: 14px;
      }
      .header h3 { font-size: 13px; font-weight: 700; }
      .header p { font-size: 10px; opacity: 0.7; }
      .header-actions { display: flex; align-items: center; gap: 6px; }
      .icon-btn {
        background: transparent; border: 0; color: inherit; cursor: pointer;
        padding: 4px 6px; border-radius: 6px; font-size: 12px; opacity: 0.7;
      }
      .icon-btn:hover { opacity: 1; background: rgba(255,255,255,0.1); }
      .user-bar {
        padding: 6px 14px; font-size: 10px; background: rgba(0,0,0,0.18);
        border-bottom: 1px solid rgba(255,255,255,0.05);
        display: flex; align-items: center; justify-content: space-between;
      }
      .user-bar input {
        background: transparent; border: 1px solid rgba(255,255,255,0.15);
        color: inherit; border-radius: 4px; padding: 2px 6px; font-size: 10px;
        font-family: monospace; width: 140px;
      }
      .messages {
        flex: 1;
        padding: 14px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .bubble-wrapper {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .bubble {
        max-width: 84%;
        padding: 10px 14px;
        border-radius: 14px;
        font-size: 13px;
        line-height: 1.5;
        word-break: break-word;
      }
      .bubble.agent {
        margin-right: auto;
        background: ${config.theme === 'light' ? '#f1f5f9' : 'rgba(255, 255, 255, 0.08)'};
        border: 1px solid ${config.theme === 'light' ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)'};
        border-bottom-left-radius: 4px;
      }
      .bubble.user {
        margin-left: auto;
        background: ${config.accent};
        color: #031525;
        font-weight: 500;
        border-bottom-right-radius: 4px;
      }
      .bubble.typing {
        opacity: 0.6; font-style: italic; font-size: 12px;
      }
      .chips-container {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 6px;
      }
      .chip {
        background: rgba(56, 189, 248, 0.12);
        border: 1px solid rgba(56, 189, 248, 0.3);
        color: ${config.accent};
        font-size: 11px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .chip:hover {
        background: ${config.accent};
        color: #031525;
      }
      .feedback-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: rgba(255,255,255,0.4);
        margin-left: 4px;
      }
      .feedback-btn {
        background: none; border: 0; cursor: pointer; font-size: 12px; opacity: 0.5;
        padding: 2px;
      }
      .feedback-btn:hover { opacity: 1; transform: scale(1.15); }
      .feedback-reasons {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
      }
      .reason-tag {
        font-size: 10px; padding: 2px 6px; border-radius: 4px;
        background: rgba(248, 113, 113, 0.15); border: 1px solid rgba(248, 113, 113, 0.3);
        color: #f87171; cursor: pointer;
      }
      .reason-tag:hover { background: #f87171; color: #fff; }
      .form {
        padding: 10px 14px;
        border-top: 1px solid ${config.theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'};
        display: flex;
        gap: 8px;
        background: ${config.theme === 'light' ? '#f8fafc' : 'rgba(11, 19, 41, 0.85)'};
      }
      .form textarea {
        flex: 1;
        background: ${config.theme === 'light' ? '#fff' : 'rgba(255,255,255,0.06)'};
        color: inherit;
        border: 1px solid ${config.theme === 'light' ? '#cbd5e1' : 'rgba(255,255,255,0.15)'};
        border-radius: 10px;
        padding: 8px 12px;
        font-size: 13px;
        resize: none;
        height: 38px;
        outline: none;
        font-family: inherit;
      }
      .form textarea:focus { border-color: ${config.accent}; }
      .send-btn {
        width: 38px; height: 38px; border-radius: 10px; border: 0;
        background: ${config.accent}; color: #031525; cursor: pointer;
        font-weight: bold; display: flex; align-items: center; justify-content: center;
      }
      .footer-badge {
        text-align: center; font-size: 9px; padding: 4px 0; opacity: 0.5; letter-spacing: 0.04em;
      }
    `;

    const html = `
      <div class="panel" id="panel">
        <div class="header">
          <div class="header-title-box">
            <div class="header-icon">C</div>
            <div>
              <h3>${escapeHtml(config.title)}</h3>
              <p>AI support that remembers</p>
            </div>
          </div>
          <div class="header-actions">
            <button class="icon-btn" id="escalate-btn" title="Request human escalation">👤 Human</button>
            <button class="icon-btn" id="reset-btn" title="Restart conversation">↺</button>
            <button class="icon-btn" id="close-btn" title="Close">✕</button>
          </div>
        </div>
        <div class="user-bar">
          <span>Customer Identity:</span>
          <input id="user-id-input" value="${escapeHtml(config.userId)}" title="Stable customer ID context" />
        </div>
        <div class="messages" id="messages">
          <div class="bubble-wrapper" id="opening-wrapper">
            <div class="bubble agent" id="opening-bubble">${escapeHtml(config.welcome)}</div>
            <div class="chips-container" id="opening-chips"></div>
          </div>
        </div>
        <form class="form" id="chat-form">
          <textarea id="chat-input" placeholder="${escapeHtml(config.placeholder)}" rows="1"></textarea>
          <button type="submit" class="send-btn" id="send-btn" aria-label="Send message">➤</button>
        </form>
        <div class="footer-badge">Powered by Contextis · Identity-Centric Support Infrastructure</div>
      </div>
      <button class="launcher" id="launcher" aria-label="Open support chat" title="Open support chat">
        <span id="launcher-icon">💬</span>
      </button>
    `;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    shadow.appendChild(styles);
    shadow.appendChild(wrapper);
    config.root.appendChild(container);

    const panel = shadow.getElementById('panel');
    const launcher = shadow.getElementById('launcher');
    const launcherIcon = shadow.getElementById('launcher-icon');
    const closeBtn = shadow.getElementById('close-btn');
    const resetBtn = shadow.getElementById('reset-btn');
    const escalateBtn = shadow.getElementById('escalate-btn');
    const messagesContainer = shadow.getElementById('messages');
    const chatForm = shadow.getElementById('chat-form');
    const chatInput = shadow.getElementById('chat-input');
    const userIdInput = shadow.getElementById('user-id-input');
    const openingBubble = shadow.getElementById('opening-bubble');
    const openingChips = shadow.getElementById('opening-chips');

    let isOpen = false;
    let openingLoaded = false;

    // Fetch dynamic opening context from ConversationExperienceEngine
    async function fetchDynamicOpening() {
      if (openingLoaded) return;
      openingLoaded = true;

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (config.publicKey) {
          headers['Authorization'] = `Bearer ${config.publicKey}`;
          headers['x-api-key'] = config.publicKey;
        }

        const res = await fetch(config.openingEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            user_id: userIdInput.value.trim() || config.userId,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
            language: navigator.language || 'en',
            page_context: { url: location.href, title: document.title },
          }),
        });

        if (!res.ok) return;
        const data = await res.json();
        if (data.greeting) {
          openingBubble.textContent = data.greeting;
        }

        if (Array.isArray(data.suggestedActions) && data.suggestedActions.length > 0) {
          openingChips.innerHTML = '';
          data.suggestedActions.forEach((action) => {
            const chip = document.createElement('button');
            chip.className = 'chip';
            chip.type = 'button';
            chip.textContent = action.label;
            chip.addEventListener('click', () => {
              sendMessage(action.prompt || action.label);
            });
            openingChips.appendChild(chip);
          });
        }
      } catch {
        // keep fallback welcome
      }
    }

    function toggleChat(forceOpen) {
      isOpen = typeof forceOpen === 'boolean' ? forceOpen : !isOpen;
      panel.classList.toggle('open', isOpen);
      launcherIcon.textContent = isOpen ? '✕' : '💬';
      if (isOpen) {
        fetchDynamicOpening();
        setTimeout(() => chatInput.focus(), 150);
      }
    }

    launcher.addEventListener('click', () => toggleChat());
    closeBtn.addEventListener('click', () => toggleChat(false));

    resetBtn.addEventListener('click', () => {
      messagesContainer.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'bubble-wrapper';
      wrap.innerHTML = `<div class="bubble agent">${escapeHtml(config.welcome)}</div><div class="chips-container" id="opening-chips"></div>`;
      messagesContainer.appendChild(wrap);
      openingLoaded = false;
      fetchDynamicOpening();
    });

    escalateBtn.addEventListener('click', async () => {
      const confirmed = confirm('Would you like to escalate this issue to a human support agent with your full conversation and context transferred?');
      if (!confirmed) return;

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (config.publicKey) headers['Authorization'] = `Bearer ${config.publicKey}`;

        const res = await fetch(config.escalateEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            user_id: userIdInput.value.trim() || config.userId,
            conversation_id: conversationId,
            reason: 'Customer initiated human handoff from widget header',
          }),
        });

        if (res.ok) {
          appendBubble('agent', 'Your issue has been transferred to a human support agent with your full context and history attached. An agent will follow up shortly.');
        } else {
          appendBubble('agent', 'We noted your request for human escalation. Our team will review your conversation.');
        }
      } catch {
        appendBubble('agent', 'Human escalation request recorded.');
      }
    });

    userIdInput.addEventListener('change', () => {
      setStoredValue('contextis_user_id', userIdInput.value.trim());
      openingLoaded = false;
      fetchDynamicOpening();
    });

    function appendBubble(role, text, isTyping = false) {
      const wrapper = document.createElement('div');
      wrapper.className = 'bubble-wrapper';

      const bubble = document.createElement('div');
      bubble.className = `bubble ${role} ${isTyping ? 'typing' : ''}`;
      bubble.textContent = text;
      wrapper.appendChild(bubble);

      if (role === 'agent' && !isTyping) {
        const feedbackBar = document.createElement('div');
        feedbackBar.className = 'feedback-bar';
        feedbackBar.innerHTML = `
          <span>Was this helpful?</span>
          <button class="feedback-btn" title="Helpful">👍</button>
          <button class="feedback-btn" title="Not helpful">👎</button>
        `;

        const [upBtn, downBtn] = feedbackBar.querySelectorAll('.feedback-btn');
        upBtn.addEventListener('click', () => {
          sendFeedback('positive');
          feedbackBar.innerHTML = '<span style="color:#34d399">Thanks for your feedback!</span>';
        });

        downBtn.addEventListener('click', () => {
          feedbackBar.innerHTML = `
            <span>What was the issue?</span>
            <div class="feedback-reasons">
              <span class="reason-tag" data-reason="Not relevant">Not relevant</span>
              <span class="reason-tag" data-reason="Incorrect">Incorrect</span>
              <span class="reason-tag" data-reason="Did not solve issue">Did not solve</span>
            </div>
          `;
          feedbackBar.querySelectorAll('.reason-tag').forEach((tag) => {
            tag.addEventListener('click', () => {
              sendFeedback('negative', tag.dataset.reason);
              feedbackBar.innerHTML = '<span>Feedback recorded.</span>';
            });
          });
        });

        wrapper.appendChild(feedbackBar);
      }

      messagesContainer.appendChild(wrapper);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      return bubble;
    }

    async function sendFeedback(rating, reason = null) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (config.publicKey) headers['Authorization'] = `Bearer ${config.publicKey}`;

        await fetch(config.feedbackEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            conversation_id: conversationId,
            customer_id: userIdInput.value.trim() || config.userId,
            rating,
            reason,
          }),
        });
      } catch {
        // ignore
      }
    }

    async function sendMessage(text) {
      if (!text || !text.trim()) return;

      appendBubble('user', text);
      chatInput.value = '';
      const typingBubble = appendBubble('agent', 'Consulting customer memory...', true);

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (config.publicKey) {
          headers['Authorization'] = `Bearer ${config.publicKey}`;
          headers['x-api-key'] = config.publicKey;
        }

        const payload = {
          user_id: userIdInput.value.trim() || config.userId,
          message: text.trim(),
          conversation_id: conversationId || undefined,
          metadata: { source: 'contextis-widget', platform: navigator.platform },
        };

        const res = await fetch(config.apiEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        typingBubble.classList.remove('typing');

        if (res.ok) {
          const replyText = data.response || data.reply || data.message || 'Support reply received.';
          typingBubble.textContent = replyText;

          if (data.conversation_id || data.conversationId) {
            conversationId = data.conversation_id || data.conversationId;
            setStoredValue('contextis_conv_id', conversationId);
          }
        } else {
          typingBubble.textContent = data.error?.message || 'We encountered an error processing your request.';
        }
      } catch (err) {
        typingBubble.classList.remove('typing');
        typingBubble.textContent = 'Support agent is currently unavailable. Please check connectivity.';
      }
    }

    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      sendMessage(chatInput.value);
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(chatInput.value);
      }
    });

    return {
      open: () => toggleChat(true),
      close: () => toggleChat(false),
      sendMessage,
      config,
    };
  }

  const ContextisWidget = {
    init(config = {}) {
      const target = config.target ? document.querySelector(config.target) : document.body;
      const root = target || document.body;
      return createWidget({ ...config, root });
    },
  };

  window.ContextisWidget = ContextisWidget;
  window.ContextisWidget.default = ContextisWidget;
  window.ContinuityWidget = ContextisWidget;
  window.ContinuityWidget.default = ContextisWidget;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.querySelector('script[data-project-id]') || document.querySelector('script[data-public-key]')) {
        ContextisWidget.init();
      }
    });
  } else {
    if (document.querySelector('script[data-project-id]') || document.querySelector('script[data-public-key]')) {
      ContextisWidget.init();
    }
  }
})();
