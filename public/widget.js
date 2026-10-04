(function () {
  const DEFAULT_TITLE = 'Continuity Widget';

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function buildWidget(config = {}) {
    const root = config.root || document.body;
    const userId = config.userId || 'customer_demo';
    const projectKey = config.projectKey || '';
    const title = config.title || DEFAULT_TITLE;

    const widget = createElement('div', 'continuity-widget-shell');
    widget.style.position = 'fixed';
    widget.style.right = '22px';
    widget.style.bottom = '22px';
    widget.style.width = '360px';
    widget.style.maxWidth = 'calc(100vw - 28px)';
    widget.style.border = '1px solid rgba(148,163,184,0.25)';
    widget.style.borderRadius = '18px';
    widget.style.background = '#0f172a';
    widget.style.color = '#f8fafc';
    widget.style.boxShadow = '0 22px 40px rgba(15, 23, 42, 0.45)';
    widget.style.overflow = 'hidden';
    widget.style.zIndex = '99999';
    widget.style.fontFamily = 'Inter, Arial, sans-serif';

    const header = createElement('div', 'continuity-widget-header');
    header.style.padding = '16px 18px';
    header.style.background = 'rgba(56, 189, 248, 0.08)';
    header.style.borderBottom = '1px solid rgba(148,163,184,0.25)';
    const titleNode = createElement('h3', 'continuity-widget-title', title);
    titleNode.style.margin = '0';
    titleNode.style.fontSize = '1rem';
    titleNode.style.lineHeight = '1.2';
    const subtitle = createElement('p', 'continuity-widget-subtitle', 'customer-support assistant');
    subtitle.style.margin = '6px 0 0';
    subtitle.style.fontSize = '0.72rem';
    subtitle.style.color = '#b7cce3';
    header.appendChild(titleNode);
    header.appendChild(subtitle);

    const body = createElement('div', 'continuity-widget-body');
    body.style.padding = '14px';

    const customerField = createElement('div', 'continuity-widget-field');
    customerField.style.marginBottom = '12px';
    const customerLabel = createElement('label', 'continuity-widget-label', 'Customer ID');
    customerLabel.style.display = 'block';
    customerLabel.style.marginBottom = '6px';
    customerLabel.style.fontSize = '0.68rem';
    customerLabel.style.textTransform = 'uppercase';
    customerLabel.style.letterSpacing = '0.06em';
    customerLabel.style.color = '#bfd0e8';
    const customerInput = document.createElement('input');
    customerInput.type = 'text';
    customerInput.value = userId;
    customerInput.style.width = '100%';
    customerInput.style.border = '1px solid rgba(148,163,184,0.25)';
    customerInput.style.borderRadius = '10px';
    customerInput.style.background = 'rgba(15, 23, 42, 0.8)';
    customerInput.style.color = '#f8fafc';
    customerInput.style.padding = '10px 12px';
    customerInput.style.fontSize = '0.92rem';
    customerField.appendChild(customerLabel);
    customerField.appendChild(customerInput);

    const messages = createElement('div', 'continuity-widget-messages');
    messages.style.minHeight = '200px';
    messages.style.maxHeight = '260px';
    messages.style.overflowY = 'auto';
    messages.style.border = '1px solid rgba(148,163,184,0.25)';
    messages.style.borderRadius = '12px';
    messages.style.padding = '12px';
    messages.style.background = 'rgba(15, 23, 42, 0.7)';
    messages.style.display = 'flex';
    messages.style.flexDirection = 'column';
    messages.style.gap = '8px';

    const welcome = createElement('div', 'continuity-widget-bubble continuity-widget-bubble-agent', 'Hi there. I can help with account and product questions.');
    welcome.style.maxWidth = '82%';
    welcome.style.padding = '10px 12px';
    welcome.style.borderRadius = '12px';
    welcome.style.background = 'rgba(148,163,184,0.08)';
    welcome.style.border = '1px solid rgba(148,163,184,0.25)';
    welcome.style.lineHeight = '1.5';
    welcome.style.fontSize = '0.88rem';
    messages.appendChild(welcome);

    const composer = createElement('form', 'continuity-widget-form');
    composer.style.display = 'grid';
    composer.style.gridTemplateColumns = '1fr auto';
    composer.style.gap = '10px';
    composer.style.marginTop = '12px';

    const input = document.createElement('textarea');
    input.placeholder = 'Ask a question...';
    input.rows = 2;
    input.style.resize = 'vertical';
    input.style.minHeight = '52px';
    input.style.border = '1px solid rgba(148,163,184,0.25)';
    input.style.borderRadius = '10px';
    input.style.background = 'rgba(15, 23, 42, 0.8)';
    input.style.color = '#f8fafc';
    input.style.padding = '10px 12px';
    input.style.fontSize = '0.92rem';

    const button = document.createElement('button');
    button.type = 'submit';
    button.textContent = 'Send';
    button.style.border = '0';
    button.style.borderRadius = '10px';
    button.style.background = 'linear-gradient(135deg, #7dd3fc 0%, #38bdf8 100%)';
    button.style.color = '#031525';
    button.style.fontWeight = '700';
    button.style.padding = '0 16px';
    button.style.cursor = 'pointer';

    composer.appendChild(input);
    composer.appendChild(button);

    const addBubble = (role, message) => {
      const bubble = createElement('div', `continuity-widget-bubble continuity-widget-bubble-${role}`);
      bubble.textContent = message;
      bubble.style.maxWidth = '82%';
      bubble.style.padding = '10px 12px';
      bubble.style.borderRadius = '12px';
      bubble.style.lineHeight = '1.5';
      bubble.style.fontSize = '0.88rem';
      bubble.style.whiteSpace = 'pre-wrap';
      if (role === 'user') {
        bubble.style.marginLeft = 'auto';
        bubble.style.background = 'rgba(56,189,248,0.18)';
        bubble.style.border = '1px solid rgba(56,189,248,0.25)';
      } else {
        bubble.style.marginRight = 'auto';
        bubble.style.background = 'rgba(148,163,184,0.08)';
        bubble.style.border = '1px solid rgba(148,163,184,0.25)';
      }
      messages.appendChild(bubble);
      messages.scrollTop = messages.scrollHeight;
    };

    composer.addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = input.value.trim();
      const resolvedUserId = customerInput.value.trim() || userId;
      if (!message || !resolvedUserId) {
        return;
      }

      addBubble('user', message);
      input.value = '';
      addBubble('agent', 'Thinking...');

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (projectKey) {
          headers.Authorization = `Bearer ${projectKey}`;
        }

        const response = await fetch('/api/support/chat', {
          method: 'POST',
          headers,
          body: JSON.stringify({ userId: resolvedUserId, message, memoryMode: 'on' }),
        });

        const data = await response.json();
        const lastBubble = messages.querySelector('.continuity-widget-bubble-agent:last-child');
        if (lastBubble) {
          lastBubble.textContent = data.reply || 'I could not answer that yet.';
        }
      } catch (error) {
        const lastBubble = messages.querySelector('.continuity-widget-bubble-agent:last-child');
        if (lastBubble) {
          lastBubble.textContent = 'The support service is currently unavailable.';
        }
      }
    });

    body.appendChild(customerField);
    body.appendChild(messages);
    body.appendChild(composer);

    widget.appendChild(header);
    widget.appendChild(body);

    if (root && typeof root.appendChild === 'function') {
      root.appendChild(widget);
    }

    return widget;
  }

  const ContinuityWidget = {
    init(config = {}) {
      const target = config.target ? document.querySelector(config.target) : document.body;
      const root = target || document.body;
      return buildWidget({ ...config, root });
    },
  };

  window.ContinuityWidget = ContinuityWidget;
  window.ContinuityWidget.default = ContinuityWidget;
})();
