(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (val) => String(val ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const state = {
    user: null,
    organization: null,
    projects: [],
    projectId: '',
    keys: [],
    customers: [],
    selectedCustomer: null,
    conversations: [],
    selectedConversation: null,
    tools: [],
    toolTemplates: [],
    widgetSettings: null,
    usage: {},
  };

  const api = async (url, options = {}) => {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });

    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== '/v1/auth/session') {
      location.assign('/login');
      throw new Error('Your session expired.');
    }
    if (!res.ok) {
      throw new Error(data.error?.message || 'Request failed.');
    }
    return data;
  };

  const toast = (msg) => {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
  };

  const showView = (viewName) => {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach((btn) => btn.classList.remove('active'));

    const targetView = $(`#view-${viewName}`);
    if (targetView) targetView.classList.add('active');

    const navBtn = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (navBtn) navBtn.classList.add('active');

    const titleMap = {
      overview: 'Overview',
      projects: 'Projects',
      keys: 'API Keys',
      widget: 'Chat Widget Customizer',
      conversations: 'Conversations',
      customers: 'Customers & Memory',
      tools: 'Tools & Integrations',
      usage: 'Usage & Limits',
      docs: 'Developer Documentation',
      settings: 'Workspace Settings',
    };
    $('#page-title').textContent = titleMap[viewName] || 'Dashboard';

    if (viewName === 'widget') loadWidgetSettings();
    if (viewName === 'conversations') loadConversations();
    if (viewName === 'tools') loadTools();
  };

  // Nav click handlers
  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

  const renderProjectOptions = () => {
    const select = $('#project-select');
    if (!select) return;

    if (!state.projects.length) {
      select.innerHTML = '<option value="">No projects found</option>';
      return;
    }

    select.innerHTML = state.projects.map((p) =>
      `<option value="${escapeHtml(p.id)}" ${p.id === state.projectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');

    $('#overview-sub').textContent = `Managing persistent customer memory for ${state.projects.find((p) => p.id === state.projectId)?.name || 'active project'}.`;
    $('#quickstart-code').textContent = `curl -X POST ${location.origin}/v1/support/chat \\\n  -H "Authorization: Bearer $CONTEXTIS_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"user_id":"customer_123","message":"My issue is still happening."}'`;

    const overviewList = $('#overview-projects-list');
    if (overviewList) {
      overviewList.innerHTML = state.projects.map((p) => `
        <div style="padding: 12px; border-radius: 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--card-border); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${escapeHtml(p.name)}</strong>
            <small style="display: block; color: var(--muted); font-size: 11px;">${escapeHtml(p.id)}</small>
          </div>
          <button class="btn btn-secondary btn-small" data-select-id="${escapeHtml(p.id)}">Switch</button>
        </div>
      `).join('');

      overviewList.querySelectorAll('[data-select-id]').forEach((b) => {
        b.addEventListener('click', () => {
          state.projectId = b.dataset.selectId;
          select.value = state.projectId;
          loadProjectDetails();
        });
      });
    }

    const tableBody = $('#projects-table-body');
    if (tableBody) {
      tableBody.innerHTML = state.projects.map((p) => `
        <tr>
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td><code>${escapeHtml(p.id)}</code></td>
          <td><span class="tag">${escapeHtml(p.status)}</span></td>
          <td>${new Date(p.createdAt).toLocaleDateString()}</td>
          <td>
            <button class="btn btn-secondary btn-small" data-select-id="${escapeHtml(p.id)}">Select</button>
          </td>
        </tr>
      `).join('');

      tableBody.querySelectorAll('[data-select-id]').forEach((b) => {
        b.addEventListener('click', () => {
          state.projectId = b.dataset.selectId;
          select.value = state.projectId;
          loadProjectDetails();
          showView('overview');
        });
      });
    }
  };

  const renderKeys = () => {
    const tbody = $('#keys-table-body');
    if (!tbody) return;

    if (!state.keys.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="color: var(--muted)">No API keys created yet for this project.</td></tr>';
      return;
    }

    tbody.innerHTML = state.keys.map((k) => `
      <tr>
        <td><strong>${escapeHtml(k.name)}</strong></td>
        <td><code>${escapeHtml(k.prefix)}••••••</code></td>
        <td><span class="tag ${k.keyType === 'public' ? '' : 'tag-live'}">${escapeHtml(k.keyType || 'secret')}</span></td>
        <td><span class="tag ${k.environment === 'live' ? 'tag-live' : ''}">${escapeHtml(k.environment)}</span></td>
        <td><span class="tag ${k.status === 'active' ? 'tag-live' : 'tag-revoked'}">${escapeHtml(k.status)}</span></td>
        <td>${new Date(k.createdAt).toLocaleDateString()}</td>
        <td>
          ${k.status === 'active' ? `<button class="btn btn-danger btn-small" data-revoke-id="${escapeHtml(k.id)}">Revoke</button>` : ''}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-revoke-id]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to revoke this API key?')) return;
        try {
          await api(`/v1/projects/${encodeURIComponent(state.projectId)}/api-keys/${encodeURIComponent(b.dataset.revokeId)}`, { method: 'DELETE' });
          toast('API key revoked.');
          loadKeys();
        } catch (err) {
          toast(err.message);
        }
      });
    });
  };

  const renderCustomers = () => {
    const list = $('#customers-list');
    if (!list) return;

    if (!state.customers.length) {
      list.innerHTML = '<p style="color: var(--muted)">No customer conversations recorded in this project yet.</p>';
      return;
    }

    list.innerHTML = state.customers.map((c) => `
      <div style="padding: 12px; border-radius: 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--card-border); cursor: pointer; display: flex; justify-content: space-between; align-items: center;" data-customer-id="${escapeHtml(c.userId)}">
        <div>
          <strong style="color: var(--accent);">${escapeHtml(c.userId)}</strong>
          <small style="display: block; color: var(--muted); font-size: 11px;">Last seen ${new Date(c.lastSeenAt).toLocaleString()}</small>
        </div>
        <span style="font-size: 11px; color: var(--muted);">Inspect →</span>
      </div>
    `).join('');

    list.querySelectorAll('[data-customer-id]').forEach((el) => {
      el.addEventListener('click', () => {
        inspectCustomerMemory(el.dataset.customerId);
      });
    });
  };

  const inspectCustomerMemory = async (userId) => {
    state.selectedCustomer = userId;
    $('#memory-target-title').textContent = `Remembered Context: ${userId}`;
    $('#clear-memory-btn').disabled = false;
    const box = $('#memory-facts-box');
    box.innerHTML = '<p style="color: var(--muted)">Recalling customer memory…</p>';

    try {
      const data = await api(`/v1/support/customers/${encodeURIComponent(userId)}/memory?project_id=${encodeURIComponent(state.projectId)}`);
      const facts = data.memory || [];

      if (!facts.length) {
        box.innerHTML = '<p style="color: var(--muted)">No durable facts stored for this customer identity yet.</p>';
        return;
      }

      box.innerHTML = facts.map((f) => `
        <div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
          <span style="font-size: 10px; text-transform: uppercase; color: var(--accent); font-weight: 700;">${escapeHtml(f.category || 'context')}</span>
          <div style="font-size: 13px; margin-top: 3px;">${escapeHtml(f.fact)}</div>
        </div>
      `).join('');
    } catch (err) {
      box.innerHTML = `<p style="color: var(--danger)">Error: ${escapeHtml(err.message)}</p>`;
    }
  };

  $('#clear-memory-btn')?.addEventListener('click', async () => {
    if (!state.selectedCustomer) return;
    if (!confirm(`Delete all remembered memory for customer ${state.selectedCustomer}?`)) return;

    try {
      await api(`/v1/support/customers/${encodeURIComponent(state.selectedCustomer)}/memory?project_id=${encodeURIComponent(state.projectId)}`, { method: 'DELETE' });
      toast('Customer memory cleared.');
      inspectCustomerMemory(state.selectedCustomer);
    } catch (err) {
      toast(err.message);
    }
  });

  const loadConversations = async () => {
    const list = $('#conversations-list');
    if (!list || !state.projectId) return;

    list.innerHTML = '<p style="color: var(--muted)">Loading conversations…</p>';
    try {
      const data = await api(`/v1/projects/${encodeURIComponent(state.projectId)}/conversations`);
      state.conversations = data.conversations || [];

      if (!state.conversations.length) {
        list.innerHTML = '<p style="color: var(--muted)">No conversation threads in this project yet.</p>';
        return;
      }

      list.innerHTML = state.conversations.map((c) => `
        <div style="padding: 12px; border-radius: 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--card-border); cursor: pointer;" data-conv-id="${escapeHtml(c.id)}">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <strong style="color: var(--accent); font-size: 12px;">${escapeHtml(c.externalUserId)}</strong>
            <span class="tag">${escapeHtml(c.status)}</span>
          </div>
          <p style="font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${escapeHtml(c.lastMessage || 'No messages')}
          </p>
          <small style="font-size: 10px; color: var(--muted); display: block; margin-top: 6px;">
            ${new Date(c.updatedAt).toLocaleString()} · ${c.messageCount || 0} messages
          </small>
        </div>
      `).join('');

      list.querySelectorAll('[data-conv-id]').forEach((el) => {
        el.addEventListener('click', () => inspectConversation(el.dataset.convId));
      });
    } catch (err) {
      list.innerHTML = `<p style="color: var(--danger)">Error: ${escapeHtml(err.message)}</p>`;
    }
  };

  const inspectConversation = async (convId) => {
    const container = $('#conv-messages-container');
    container.innerHTML = '<p style="color: var(--muted); text-align: center; margin-top: 40px;">Loading transcript…</p>';

    try {
      const data = await api(`/v1/projects/${encodeURIComponent(state.projectId)}/conversations/${encodeURIComponent(convId)}`);
      $('#conv-transcript-title').textContent = `Transcript: ${data.conversation.externalUserId} (${data.conversation.status})`;

      const messages = data.messages || [];
      if (!messages.length) {
        container.innerHTML = '<p style="color: var(--muted); text-align: center; margin-top: 40px;">No messages recorded in this conversation.</p>';
        return;
      }

      container.innerHTML = messages.map((m) => {
        const isUser = m.senderType === 'customer';
        return `
          <div style="max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 12px; line-height: 1.5; ${
            isUser
              ? 'margin-left: auto; background: var(--accent); color: #031525; font-weight: 500;'
              : 'margin-right: auto; background: rgba(255,255,255,0.08); border: 1px solid var(--card-border);'
          }">
            <div style="font-size: 10px; opacity: 0.7; margin-bottom: 2px;">${escapeHtml(m.senderType.toUpperCase())} · ${new Date(m.createdAt).toLocaleTimeString()}</div>
            <div>${escapeHtml(m.content)}</div>
          </div>
        `;
      }).join('');
    } catch (err) {
      container.innerHTML = `<p style="color: var(--danger)">Error: ${escapeHtml(err.message)}</p>`;
    }
  };

  const loadWidgetSettings = async () => {
    if (!state.projectId) return;

    try {
      const data = await api(`/v1/projects/${encodeURIComponent(state.projectId)}/widget`);
      const w = data.widget || {};
      $('#w-agent-name').value = w.agentName || 'Contextis Support';
      $('#w-welcome').value = w.welcomeMessage || 'Hi! How can we help you today?';
      $('#w-color').value = w.accentColor || '#38bdf8';
      $('#w-position').value = w.position || 'bottom-right';
      $('#w-placeholder').value = w.placeholder || 'Type your message...';

      updateWidgetSnippet();
    } catch (err) {
      console.warn('Widget load error', err);
    }
  };

  const updateWidgetSnippet = () => {
    const pubKey = state.keys.find((k) => k.keyType === 'public')?.prefix || 'pk_live_your_public_key';
    const code = `<!-- Contextis Embeddable Chat Widget -->\n<script\n  src="${location.origin}/widget.js"\n  data-project-id="${escapeHtml(state.projectId)}"\n  data-public-key="${escapeHtml(pubKey)}">\n</script>`;
    $('#widget-embed-code').textContent = code;
  };

  $('#save-widget-btn')?.addEventListener('click', async () => {
    if (!state.projectId) return;
    try {
      await api(`/v1/projects/${encodeURIComponent(state.projectId)}/widget`, {
        method: 'PUT',
        body: JSON.stringify({
          agentName: $('#w-agent-name').value,
          welcomeMessage: $('#w-welcome').value,
          accentColor: $('#w-color').value,
          position: $('#w-position').value,
          placeholder: $('#w-placeholder').value,
        }),
      });
      toast('Widget settings saved.');
      updateWidgetSnippet();
    } catch (err) {
      toast(err.message);
    }
  });

  const loadTools = async () => {
    if (!state.projectId) return;

    try {
      const [toolsData, templatesData] = await Promise.all([
        api(`/v1/projects/${encodeURIComponent(state.projectId)}/tools`),
        api(`/v1/projects/${encodeURIComponent(state.projectId)}/tool-templates`),
      ]);

      state.tools = toolsData.tools || [];
      state.toolTemplates = templatesData.templates || [];

      const tbody = $('#tools-table-body');
      if (tbody) {
        if (!state.tools.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="color: var(--muted)">No custom tools configured yet for this project.</td></tr>';
        } else {
          tbody.innerHTML = state.tools.map((t) => `
            <tr>
              <td><strong>${escapeHtml(t.name)}</strong><small style="display: block; color: var(--muted);">${escapeHtml(t.description)}</small></td>
              <td><span class="tag">${escapeHtml(t.sensitivity)}</span></td>
              <td><code>${escapeHtml(JSON.stringify(t.permissions))}</code></td>
              <td><span class="tag tag-live">${escapeHtml(t.status)}</span></td>
              <td>
                <button class="btn btn-secondary btn-small" data-test-tool="${escapeHtml(t.id)}">Execute Test</button>
              </td>
            </tr>
          `).join('');

          tbody.querySelectorAll('[data-test-tool]').forEach((b) => {
            b.addEventListener('click', async () => {
              const testKey = state.keys[0];
              if (!testKey) {
                alert('Please issue an API key in the API Keys tab before testing tools.');
                return;
              }
              try {
                const res = await api(`/v1/projects/${encodeURIComponent(state.projectId)}/tools/${encodeURIComponent(b.dataset.testTool)}/execute`, {
                  method: 'POST',
                  headers: { 'x-api-key': testKey.prefix },
                  body: JSON.stringify({ customerId: 'alice@acme.com', orderId: 'ord_9842', email: 'alice@acme.com' }),
                });
                alert('Tool execution result:\n' + JSON.stringify(res.result, null, 2));
              } catch (err) {
                alert('Tool execution failed: ' + err.message);
              }
            });
          });
        }
      }

      const templatesList = $('#tool-templates-list');
      if (templatesList) {
        templatesList.innerHTML = state.toolTemplates.map((tpl) => `
          <div style="padding: 16px; border-radius: 12px; background: rgba(0,0,0,0.2); border: 1px solid var(--card-border);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <strong>${escapeHtml(tpl.name)}</strong>
              <span class="tag">${escapeHtml(tpl.sensitivity)}</span>
            </div>
            <p style="font-size: 12px; color: var(--muted); margin-bottom: 12px;">${escapeHtml(tpl.description)}</p>
            <button class="btn btn-secondary btn-small" data-install-tool="${escapeHtml(tpl.name)}">Install Tool</button>
          </div>
        `).join('');

        templatesList.querySelectorAll('[data-install-tool]').forEach((b) => {
          b.addEventListener('click', async () => {
            const tpl = state.toolTemplates.find((t) => t.name === b.dataset.installTool);
            if (!tpl) return;
            try {
              await api(`/v1/projects/${encodeURIComponent(state.projectId)}/tools`, {
                method: 'POST',
                body: JSON.stringify(tpl),
              });
              toast(`Installed ${tpl.name}.`);
              loadTools();
            } catch (err) {
              toast(err.message);
            }
          });
        });
      }
    } catch (err) {
      console.warn('Tools error', err);
    }
  };

  const loadKeys = async () => {
    if (!state.projectId) return;
    try {
      const data = await api(`/v1/projects/${encodeURIComponent(state.projectId)}/api-keys`);
      state.keys = data.keys || [];
      renderKeys();
      updateWidgetSnippet();
    } catch (err) {
      console.warn('Keys error', err);
    }
  };

  const loadProjectDetails = async () => {
    if (!state.projectId) return;

    try {
      const [keysData, usageData, customersData] = await Promise.all([
        api(`/v1/projects/${encodeURIComponent(state.projectId)}/api-keys`),
        api(`/v1/projects/${encodeURIComponent(state.projectId)}/usage`),
        api(`/v1/support/customers?project_id=${encodeURIComponent(state.projectId)}`),
      ]);

      state.keys = keysData.keys || [];
      state.customers = customersData.customers || [];
      const u = usageData.usage || {};

      $('#metric-requests').textContent = Number(u.total_requests || 0).toLocaleString();
      $('#metric-success').textContent = Number(u.successful_requests || 0).toLocaleString();
      $('#metric-failed').textContent = Number(u.failed_requests || 0).toLocaleString();
      $('#metric-latency').textContent = `${Math.round(Number(u.average_response_time_ms || 0))} ms`;

      $('#usage-requests').textContent = Number(u.total_requests || 0).toLocaleString();
      $('#usage-success').textContent = Number(u.successful_requests || 0).toLocaleString();
      $('#usage-failed').textContent = Number(u.failed_requests || 0).toLocaleString();
      $('#usage-memory').textContent = Number(u.memory_operations || 0).toLocaleString();

      renderKeys();
      renderCustomers();
      renderProjectOptions();
    } catch (err) {
      console.warn('Project details error', err);
    }
  };

  $('#project-select')?.addEventListener('change', (e) => {
    state.projectId = e.target.value;
    loadProjectDetails();
  });

  // Modal dialog triggers
  $('[data-action="new-project"]')?.addEventListener('click', () => {
    $('#new-project-dialog').showModal();
  });
  $('#close-proj-dialog')?.addEventListener('click', () => {
    $('#new-project-dialog').close();
  });
  $('#new-project-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#new-proj-name').value.trim();
    if (!name) return;

    try {
      const res = await api('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      $('#new-project-dialog').close();
      $('#new-proj-name').value = '';
      toast(`Project "${name}" created.`);
      state.projects.unshift(res.project);
      state.projectId = res.project.id;
      renderProjectOptions();
      loadProjectDetails();
    } catch (err) {
      toast(err.message);
    }
  });

  $('[data-action="new-key"]')?.addEventListener('click', () => {
    $('#new-key-dialog').showModal();
  });
  $('#close-key-dialog')?.addEventListener('click', () => {
    $('#new-key-dialog').close();
  });
  $('#new-key-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#new-key-name').value.trim();
    const type = $('#new-key-type').value;
    const environment = $('#new-key-env').value;

    try {
      const res = await api(`/v1/projects/${encodeURIComponent(state.projectId)}/api-keys`, {
        method: 'POST',
        body: JSON.stringify({ name, type, environment }),
      });
      $('#new-key-dialog').close();
      $('#displayed-secret').textContent = res.key;
      $('#show-secret-dialog').showModal();
      loadKeys();
    } catch (err) {
      toast(err.message);
    }
  });

  $('#copy-secret-btn')?.addEventListener('click', () => {
    const text = $('#displayed-secret').textContent;
    navigator.clipboard.writeText(text);
    toast('API key copied to clipboard.');
  });
  $('#close-secret-btn')?.addEventListener('click', () => {
    $('#show-secret-dialog').close();
  });

  $('#signout')?.addEventListener('click', async () => {
    await api('/v1/auth/logout', { method: 'POST' });
    location.assign('/login');
  });

  // Initialization
  const init = async () => {
    try {
      const session = await api('/v1/auth/session');
      if (!session.user) {
        location.assign('/login');
        return;
      }
      state.user = session.user;
      $('#side-name').textContent = session.user.name;
      $('#side-email').textContent = session.user.email;

      const [orgRes, projRes] = await Promise.all([
        api('/v1/organization').catch(() => ({ organization: {} })),
        api('/v1/projects').catch(() => ({ projects: [] })),
      ]);

      state.organization = orgRes.organization || {};
      state.projects = projRes.projects || [];
      if (state.projects.length) {
        state.projectId = state.projects[0].id;
      }

      $('#setting-org-name').value = state.organization.name || 'My Workspace';
      $('#setting-plan-name').value = (state.organization.planName || 'starter').toUpperCase();

      renderProjectOptions();
      if (state.projectId) {
        loadProjectDetails();
      }
    } catch (err) {
      console.warn('Initialization error', err);
    }
  };

  init();
})();