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

  function createWidget(options = {}) {
    const scriptTag = document.currentScript || document.querySelector('script[data-project-id]');
    const dataProjectId = scriptTag ? scriptTag.getAttribute('data-project-id') : '';
    const dataPublicKey = scriptTag ? (scriptTag.getAttribute('data-public-key') || scriptTag.getAttribute('data-api-key')) : '';

    const config = {
      projectId: options.projectId || dataProjectId || '',
      publicKey: options.publicKey || options.projectKey || dataPublicKey || '',
      userId: options.userId || 'customer_' + Math.random().toString(36).slice(2, 8),
      title: options.title || options.agentName || DEFAULT_TITLE,
      welcome: options.welcomeMessage || options.welcome || 'Hi! How can we help you today?',
      accent: options.accentColor || options.accent || DEFAULT_ACCENT,
      position: options.position || 'bottom-right',
      theme: options.theme || 'dark',
      placeholder: options.placeholder || 'Type your message...',
      apiEndpoint: options.apiEndpoint || '/v1/support/chat',
      root: options.root || document.body,
    };

    // Prevent duplicate widget
    if (document.getElementById('contextis-widget-root')) {
      return window.ContextisWidget;
    }

    const container = document.createElement('div');
    container.id = 'contextis-widget-root';
    container.style.position = 'fixed';
    container.style.bottom = '24px';
    container.style[config.position === 'bottom-left' ? 'left' : 'right'] = '24px';
    container.style.zIndex = '999999';
    container.style.fontFamily = 'Inter, system-ui, -apple-system, sans-serif';

    const shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;

    const styles = document.createElement('style');
    styles.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
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
        width: 380px;
        max-width: calc(100vw - 36px);
        height: 520px;
        max-height: calc(100vh - 100px);
        background: ${config.theme === 'light' ? 'rgba(255, 255, 255, 0.95)' : 'rgba(11, 19, 41, 0.94)'};
        color: ${config.theme === 'light' ? '#0f172a' : '#f8fafc'};
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid ${config.theme === 'light' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.12)'};
        border-radius: 20px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5), 0 0 30px rgba(56, 189, 248, 0.08);
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
        padding: 16px 20px;
        background: ${config.theme === 'light' ? 'rgba(240, 246, 255, 0.8)' : 'rgba(16, 28, 58, 0.8)'};
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
      .header h3 { font-size: 14px; font-weight: 600; }
      .header p { font-size: 11px; opacity: 0.7; }
      .header-actions { display: flex; align-items: center; gap: 8px; }
      .icon-btn {
        background: transparent; border: 0; color: inherit; cursor: pointer;
        padding: 4px 8px; border-radius: 6px; font-size: 14px; opacity: 0.7;
      }
      .icon-btn:hover { opacity: 1; background: rgba(255,255,255,0.1); }
      .user-bar {
        padding: 8px 16px; font-size: 11px; background: rgba(0,0,0,0.15);
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
        padding: 16px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .bubble {
        max-width: 82%;
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
      .form {
        padding: 12px 16px;
        border-top: 1px solid ${config.theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'};
        display: flex;
        gap: 8px;
        background: ${config.theme === 'light' ? '#f8fafc' : 'rgba(11, 19, 41, 0.8)'};
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
        width: 38px;
        height: 38px;
        border-radius: 10px;
        border: 0;
        background: ${config.accent};
        color: #031525;
        cursor: pointer;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.15s ease;
      }
      .send-btn:hover { opacity: 0.9; }
      .footer-badge {
        text-align: center;
        font-size: 10px;
        padding: 6px 0;
        opacity: 0.5;
        letter-spacing: 0.04em;
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
            <button class="icon-btn" id="reset-btn" title="Reset conversation">↺</button>
            <button class="icon-btn" id="close-btn" title="Close">✕</button>
          </div>
        </div>
        <div class="user-bar">
          <span>Identity Context:</span>
          <input id="user-id-input" value="${escapeHtml(config.userId)}" title="Customer ID (Identity Context)" />
        </div>
        <div class="messages" id="messages">
          <div class="bubble agent">${escapeHtml(config.welcome)}</div>
        </div>
        <form class="form" id="chat-form">
          <textarea id="chat-input" placeholder="${escapeHtml(config.placeholder)}" rows="1"></textarea>
          <button type="submit" class="send-btn" id="send-btn" aria-label="Send">➤</button>
        </form>
        <div class="footer-badge">Powered by Contextis · Identity-Centric Support</div>
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
    const messagesContainer = shadow.getElementById('messages');
    const chatForm = shadow.getElementById('chat-form');
    const chatInput = shadow.getElementById('chat-input');
    const userIdInput = shadow.getElementById('user-id-input');

    let isOpen = false;

    function toggleChat(forceOpen) {
      isOpen = typeof forceOpen === 'boolean' ? forceOpen : !isOpen;
      panel.classList.toggle('open', isOpen);
      launcherIcon.textContent = isOpen ? '✕' : '💬';
      if (isOpen) {
        setTimeout(() => chatInput.focus(), 150);
      }
    }

    launcher.addEventListener('click', () => toggleChat());
    closeBtn.addEventListener('click', () => toggleChat(false));

    resetBtn.addEventListener('click', () => {
      messagesContainer.innerHTML = `<div class="bubble agent">${escapeHtml(config.welcome)}</div>`;
    });

    function appendBubble(role, text, isTyping = false) {
      const bubble = document.createElement('div');
      bubble.className = `bubble ${role} ${isTyping ? 'typing' : ''}`;
      bubble.textContent = text;
      messagesContainer.appendChild(bubble);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      return bubble;
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
          userId: userIdInput.value.trim() || config.userId,
          message: text.trim(),
          metadata: { source: 'contextis-widget', platform: navigator.platform },
        };

        const endpoint = config.apiEndpoint;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        typingBubble.classList.remove('typing');

        if (res.ok && (data.response || data.reply || data.message)) {
          typingBubble.textContent = data.response || data.reply || data.message;
        } else {
          const errMsg = data.error?.message || 'We encountered an error processing your request.';
          typingBubble.textContent = errMsg;
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

  // Support Contextis and backwards-compatible Continuity branding
  window.ContextisWidget = ContextisWidget;
  window.ContextisWidget.default = ContextisWidget;
  window.ContinuityWidget = ContextisWidget;
  window.ContinuityWidget.default = ContextisWidget;

  // Auto-initialize if loaded with data attributes
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
