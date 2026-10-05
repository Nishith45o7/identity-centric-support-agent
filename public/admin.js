const $ = (selector) => document.querySelector(selector);
const state = {
  user: null,
  organization: null,
  projects: [],
  usage: {},
  billing: {},
  loaded: new Set(),
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]));

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && url !== '/v1/auth/session') {
    location.assign('/login');
    throw new Error('Your session expired.');
  }
  if (!response.ok) throw new Error(data.error?.message || 'Request failed.');
  return data;
};

const money = (cents = 0) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
}).format(Number(cents || 0) / 100);

const date = (value) => value ? new Date(value).toLocaleDateString(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}) : '—';

const toast = (message) => {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => { node.hidden = true; }, 2600);
};

const showView = (name) => {
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('active', view.id === `view-${name}`);
  });
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === name);
  });
  $('#page-title').textContent = ({
    overview: 'Overview',
    projects: 'Projects',
    team: 'Team',
    billing: 'Billing',
    activity: 'Activity',
    'platform-overview': 'Platform Overview',
    organizations: 'Organizations',
    'platform-users': 'Platform Users',
    'system-health': 'System Health',
    'audit-logs': 'Audit Logs',
  })[name] || 'Overview';
  history.replaceState(null, '', `#${name}`);
  loadSection(name).catch((error) => {
    if (error.message !== 'Your session expired.') toast(error.message);
  });
};

const projectRows = () => state.projects.map((project) => `
  <tr>
    <td><strong>${escapeHtml(project.name || 'Untitled project')}</strong><small class="table-sub mono">${escapeHtml(project.id)}</small></td>
    <td><span class="tag">${escapeHtml(project.environment || 'test')}</span></td>
    <td>${escapeHtml(project.status || 'active')}</td>
    <td><button class="text-button" data-action="open-project" data-id="${escapeHtml(project.id)}">Open tools →</button></td>
  </tr>
`).join('') || '<tr><td colspan="4" class="empty-cell">No projects yet. Create a project to get started.</td></tr>';

const renderProjects = () => {
  $('#overview-projects').innerHTML = projectRows();
  $('#projects-table').innerHTML = state.projects.map((project) => `
    <tr>
      <td><strong>${escapeHtml(project.name || 'Untitled project')}</strong><small class="table-sub mono">${escapeHtml(project.id)}</small></td>
      <td><span class="tag">${escapeHtml(project.environment || 'test')}</span></td>
      <td>${date(project.createdAt)}</td>
      <td><span class="status-dot">${escapeHtml(project.status || 'active')}</span></td>
      <td><button class="text-button" data-action="open-project" data-id="${escapeHtml(project.id)}">Manage →</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-cell">No projects yet. Create a project to get started.</td></tr>';
  $('#project-count').textContent = state.projects.length;
  $('#projects-caption').textContent = `${state.projects.length} project${state.projects.length === 1 ? '' : 's'} in this workspace`;
};

const usageItem = (label, used, limit, suffix = 'used') => {
  const max = Math.max(Number(limit || 0), 1);
  const count = Number(used || 0);
  const percent = Math.min((count / max) * 100, 100);
  return `<div class="usage-item"><div class="usage-label"><span>${label}</span><strong>${count.toLocaleString()} <small>/ ${Number(limit || 0).toLocaleString()}</small></strong></div><div class="progress"><i style="width:${percent}%"></i></div><small class="usage-note">${suffix}</small></div>`;
};

const renderOverview = () => {
  const org = state.organization || {};
  const usage = state.usage || {};
  const billing = state.billing || {};
  const name = org.name || 'Workspace';
  $('#workspace-name').textContent = name;
  $('#workspace-name').title = name;
  $('#welcome-title').textContent = `Good to see you, ${(state.user?.name || 'there').split(' ')[0]}`;
  $('#user-name').textContent = state.user?.name || 'Workspace admin';
  $('#user-email').textContent = state.user?.email || '';
  $('#user-avatar').textContent = (state.user?.name || 'C').trim().charAt(0).toUpperCase();
  $('#member-count').textContent = Number(org.memberCount || usage.memberCount || 0).toLocaleString();
  $('#request-count').textContent = Number(usage.requestCount || 0).toLocaleString();
  $('#plan-name').textContent = org.planName || billing.planName || 'Starter';
  $('#billing-status').textContent = `Billing ${billing.billingStatus || org.billingStatus || 'active'}`;
  renderProjects();
  $('#overview-usage').innerHTML = [
    usageItem('Projects', usage.projectCount ?? state.projects.length, usage.projectLimit, 'Project limit'),
    usageItem('Customers', usage.customerCount, usage.customerLimit, 'Customer limit'),
    usageItem('Requests', usage.requestCount, usage.requestLimit, 'Current usage window'),
    usageItem('Team seats', usage.supportSeatsUsed ?? usage.memberCount, usage.supportSeatsLimit, 'Seat limit'),
  ].join('');
};

const loadMembers = async () => {
  const data = await api('/v1/organization/members');
  const members = data.members || [];
  $('#team-caption').textContent = `${members.length} member${members.length === 1 ? '' : 's'} with workspace access`;
  $('#team-table').innerHTML = members.map((member) => {
    const isOwner = member.role === 'owner';
    const isSelf = member.id === state.user?.id;
    return `<tr>
      <td><div class="member-cell"><span class="avatar small-avatar">${escapeHtml((member.name || member.email || '?').trim().charAt(0).toUpperCase())}</span><span><strong>${escapeHtml(member.name || 'Workspace member')}</strong><small class="table-sub">${escapeHtml(member.email || '')}</small></span></div></td>
      <td>${isOwner ? '<span class="tag owner-tag">Owner</span>' : `<select class="table-select" data-action="change-role" data-id="${escapeHtml(member.id)}" aria-label="Role for ${escapeHtml(member.email)}"><option value="member" ${member.role === 'member' ? 'selected' : ''}>Member</option><option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option></select>`}</td>
      <td>${date(member.joinedAt)}</td>
      <td>${!isOwner && !isSelf ? `<button class="text-button danger-text" data-action="remove-member" data-id="${escapeHtml(member.id)}">Remove</button>` : ''}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="empty-cell">No workspace members found.</td></tr>';
  $('#member-count').textContent = members.length.toLocaleString();
};

const loadInvoices = async () => {
  const [invoiceData, billingData] = await Promise.all([
    api('/v1/organization/invoices'),
    api('/v1/organization/billing'),
  ]);
  const billing = billingData.billing || {};
  $('#billing-plan').textContent = billing.planName || state.organization?.planName || 'Starter';
  $('#paid-total').textContent = money(billing.paidBalanceCents);
  $('#outstanding-total').textContent = money(billing.outstandingBalanceCents);
  $('#plan-select').value = billing.planName || 'starter';
  const invoices = invoiceData.invoices || [];
  $('#invoice-table').innerHTML = invoices.map((invoice) => `
    <tr><td><strong>${escapeHtml(invoice.invoiceNumber || invoice.id)}</strong></td><td>${escapeHtml(invoice.description || 'Workspace services')}</td><td>${date(invoice.createdAt)}</td><td>${money(invoice.amountCents)}</td><td><span class="invoice-status ${invoice.status === 'paid' ? 'paid' : ''}">${escapeHtml(invoice.status || 'open')}</span></td></tr>
  `).join('') || '<tr><td colspan="5" class="empty-cell">No invoices have been recorded.</td></tr>';
};

const renderActivity = (events) => {
  const rows = events.map((event) => `
    <article class="activity-row"><span class="activity-mark">${escapeHtml((event.action || 'A').charAt(0).toUpperCase())}</span><div class="activity-copy"><strong>${escapeHtml((event.action || 'Workspace update').replace(/[._]/g, ' '))}</strong><small>${escapeHtml(event.metadata?.email || event.metadata?.planName || event.metadata?.userId || 'Workspace event')}</small></div><time>${date(event.createdAt)}</time></article>
  `).join('') || '<p class="empty-cell">No activity has been recorded yet.</p>';
  $('#activity-list').innerHTML = rows;
  $('#overview-activity').innerHTML = events.slice(0, 3).map((event) => `
    <article class="activity-row"><span class="activity-mark">${escapeHtml((event.action || 'A').charAt(0).toUpperCase())}</span><div class="activity-copy"><strong>${escapeHtml((event.action || 'Workspace update').replace(/[._]/g, ' '))}</strong><small>${escapeHtml(event.metadata?.email || event.metadata?.planName || 'Workspace event')}</small></div><time>${date(event.createdAt)}</time></article>
  `).join('') || '<p class="empty-cell">No recent changes.</p>';
};

const loadPlatformOverview = async () => {
  const data = await api('/v1/admin/overview');
  const stats = data.stats || {};
  $('#po-orgs').textContent = Number(stats.organizations || 0).toLocaleString();
  $('#po-projects').textContent = Number(stats.projects || 0).toLocaleString();
  $('#po-requests').textContent = Number(stats.requests || 0).toLocaleString();
  $('#po-memory').textContent = Number(stats.memoryOperations || 0).toLocaleString();

  const plans = stats.plans || {};
  const planKeys = Object.keys(plans);
  if (planKeys.length === 0) {
    $('#po-plans').innerHTML = '<p class="loading-cell">No active subscriptions recorded.</p>';
  } else {
    $('#po-plans').innerHTML = planKeys.map((p) => `
      <div class="usage-item">
        <div class="usage-label"><span>Tier: ${escapeHtml(p.toUpperCase())}</span><strong>${Number(plans[p]).toLocaleString()} orgs</strong></div>
      </div>
    `).join('');
  }

  const health = stats.health || {};
  $('#po-health').innerHTML = `
    <div class="usage-item"><div class="usage-label"><span>Core API Gateway</span><strong style="color:var(--green)">${escapeHtml(health.api || 'healthy')}</strong></div></div>
    <div class="usage-item"><div class="usage-label"><span>PostgreSQL / SQLite Database</span><strong style="color:var(--green)">${escapeHtml(health.database || 'healthy')}</strong></div></div>
    <div class="usage-item"><div class="usage-label"><span>Hindsight Memory Provider</span><strong style="color:var(--green)">${escapeHtml(health.memoryProvider || 'healthy')}</strong></div></div>
    <div class="usage-item"><div class="usage-label"><span>Groq Inference Gateway</span><strong style="color:var(--green)">${escapeHtml(health.inferenceProvider || 'healthy')}</strong></div></div>
  `;
};

const loadOrganizations = async () => {
  const data = await api('/v1/admin/organizations');
  const orgs = data.organizations || [];
  $('#orgs-caption').textContent = `${orgs.length} registered customer organization${orgs.length === 1 ? '' : 's'}`;
  $('#orgs-table-body').innerHTML = orgs.map((org) => {
    const isSuspended = org.status === 'suspended';
    return `
      <tr>
        <td><strong>${escapeHtml(org.name || 'Workspace')}</strong><small class="table-sub mono">${escapeHtml(org.id)}</small></td>
        <td><small>${escapeHtml(org.ownerEmail || '—')}</small></td>
        <td><span class="tag">${escapeHtml(org.planName || 'starter')}</span></td>
        <td>${Number(org.projectCount || 0).toLocaleString()}</td>
        <td>${Number(org.requestCount || 0).toLocaleString()}</td>
        <td><span class="status-dot" style="${isSuspended ? 'color: var(--red);' : ''}">${escapeHtml(org.status || 'active')}</span></td>
        <td>
          <button class="text-button ${isSuspended ? '' : 'danger-text'}" data-action="toggle-org-status" data-id="${escapeHtml(org.id)}" data-status="${isSuspended ? 'active' : 'suspended'}">
            ${isSuspended ? 'Reactivate' : 'Suspend'}
          </button>
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="7" class="empty-cell">No organizations found.</td></tr>';
};

const loadPlatformUsers = async () => {
  const data = await api('/v1/admin/users');
  const users = data.users || [];
  $('#users-table-body').innerHTML = users.map((u) => `
    <tr>
      <td><strong>${escapeHtml(u.name || 'User')}</strong>${u.isPlatformAdmin ? ' <span class="tag owner-tag">Admin</span>' : ''}</td>
      <td><small class="mono">${escapeHtml(u.email || '')}</small></td>
      <td>${Number(u.membershipCount || 0)} organization${u.membershipCount === 1 ? '' : 's'}</td>
      <td>${date(u.createdAt)}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="empty-cell">No users registered yet.</td></tr>';
};

const loadSystemHealth = async () => {
  const data = await api('/v1/admin/health');
  const h = data.health || {};
  $('#sh-api').textContent = (h.status || 'healthy').toUpperCase();
  $('#sh-api').style.color = h.status === 'healthy' ? 'var(--green)' : 'var(--red)';
  $('#sh-db').textContent = (h.database || 'healthy').toUpperCase();
  $('#sh-db-engine').textContent = `Engine: ${escapeHtml(h.databaseEngine || 'connected')}`;
  $('#sh-memory').textContent = (h.memoryProvider || 'healthy').toUpperCase();
  $('#sh-memory-provider').textContent = 'Multi-tenant bank isolation';
  $('#sh-inference').textContent = (h.inferenceProvider || 'healthy').toUpperCase();
  $('#sh-inference-provider').textContent = 'Groq Cloud Llama-3.3-70b-versatile';
};

const loadGlobalAudit = async () => {
  const data = await api('/v1/admin/audit');
  const logs = data.auditLogs || [];
  $('#global-audit-body').innerHTML = logs.map((log) => `
    <tr>
      <td><strong>${escapeHtml((log.action || '').replace(/[._]/g, ' '))}</strong></td>
      <td><small class="mono">${escapeHtml(log.organizationId ? log.organizationId.slice(0, 12) + '…' : 'global')}</small></td>
      <td><small>${escapeHtml(log.actorEmail || log.userId || 'system')}</small></td>
      <td><small class="table-sub mono">${escapeHtml(JSON.stringify(log.metadata || {}).slice(0, 75))}</small></td>
      <td>${date(log.createdAt)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-cell">No audit logs recorded yet.</td></tr>';
};

const loadSection = async (name, refresh = false) => {
  if (state.loaded.has(name) && !refresh) return;
  if (name === 'team') await loadMembers();
  if (name === 'billing') await loadInvoices();
  if (name === 'activity') {
    const data = await api('/v1/organization/audit');
    renderActivity(data.events || []);
  }
  if (name === 'platform-overview') await loadPlatformOverview();
  if (name === 'organizations') await loadOrganizations();
  if (name === 'platform-users') await loadPlatformUsers();
  if (name === 'system-health') await loadSystemHealth();
  if (name === 'audit-logs') await loadGlobalAudit();
  state.loaded.add(name);
};

const loadAdmin = async () => {
  const session = await api('/v1/auth/session');
  if (!session.user) {
    location.replace('/login');
    return;
  }
  state.user = session.user;
  const [organization, usage, billing, projects] = await Promise.all([
    api('/v1/organization'),
    api('/v1/organization/usage'),
    api('/v1/organization/billing'),
    api('/v1/projects'),
  ]);
  state.organization = organization.organization || {};
  state.usage = usage.usage || {};
  state.billing = billing.billing || {};
  state.projects = projects.projects || [];
  renderOverview();
  const initialView = location.hash.slice(1);
  const validViews = ['overview', 'projects', 'team', 'billing', 'activity', 'platform-overview', 'organizations', 'platform-users', 'system-health', 'audit-logs'];
  if (validViews.includes(initialView) && initialView !== 'overview') {
    showView(initialView);
  } else {
    state.loaded.add('overview');
  }
};

const refreshWorkspace = async () => {
  const [organization, usage, billing, projects] = await Promise.all([
    api('/v1/organization'),
    api('/v1/organization/usage'),
    api('/v1/organization/billing'),
    api('/v1/projects'),
  ]);
  state.organization = organization.organization || {};
  state.usage = usage.usage || {};
  state.billing = billing.billing || {};
  state.projects = projects.projects || [];
  renderOverview();
  state.loaded.delete('projects');
};

document.addEventListener('click', async (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    showView(viewButton.dataset.view);
    return;
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const { action: name, id } = action.dataset;
  try {
    if (name === 'new-project') $('#project-dialog').showModal();
    if (name === 'close-project') $('#project-dialog').close();
    if (name === 'edit-workspace') {
      $('#workspace-form').elements.name.value = state.organization?.name || '';
      $('#workspace-dialog').showModal();
    }
    if (name === 'close-workspace') $('#workspace-dialog').close();
    if (name === 'show-add-member') $('#add-member-panel').hidden = !$('#add-member-panel').hidden;
    if (name === 'open-project') {
      localStorage.setItem('continuity_project', id);
      location.assign('/dashboard#projects');
    }
    if (name === 'remove-member' && confirm('Remove this person from the workspace?')) {
      await api(`/v1/organization/members/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.loaded.delete('team');
      await loadMembers();
      toast('Member removed');
    }
    if (name === 'toggle-org-status') {
      const targetStatus = action.dataset.status;
      if (confirm(`Are you sure you want to ${targetStatus === 'suspended' ? 'suspend' : 'reactivate'} this organization?`)) {
        await api(`/v1/admin/organizations/${encodeURIComponent(id)}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: targetStatus }),
        });
        state.loaded.delete('organizations');
        await loadOrganizations();
        toast(`Organization ${targetStatus === 'suspended' ? 'suspended' : 'reactivated'}`);
      }
    }
    if (name === 'refresh') {
      await refreshWorkspace();
      state.loaded.delete('activity');
      state.loaded.delete('team');
      state.loaded.delete('billing');
      await loadSection($('#page-title').textContent.toLowerCase(), true);
      toast('Workspace refreshed');
    }
  } catch (error) {
    if (error.message !== 'Your session expired.') toast(error.message);
  }
});

document.addEventListener('change', async (event) => {
  const select = event.target.closest('[data-action="change-role"]');
  if (!select) return;
  const original = select.value;
  try {
    await api(`/v1/organization/members/${encodeURIComponent(select.dataset.id)}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: original }),
    });
    state.loaded.delete('team');
    await loadMembers();
    toast('Member role updated');
  } catch (error) {
    if (error.message !== 'Your session expired.') toast(error.message);
    state.loaded.delete('team');
    await loadMembers().catch(() => {});
  }
});

$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $('#project-error').textContent = '';
  try {
    const result = await api('/v1/projects', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
    });
    state.projects.unshift(result.project);
    $('#project-dialog').close();
    event.currentTarget.reset();
    renderProjects();
    state.loaded.delete('projects');
    toast('Project created');
  } catch (error) {
    $('#project-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#member-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api('/v1/organization/members', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
    });
    event.currentTarget.reset();
    $('#add-member-panel').hidden = true;
    state.loaded.delete('team');
    await loadMembers();
    toast('Member added');
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

$('#plan-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await api('/v1/organization/plan', {
      method: 'POST',
      body: JSON.stringify({ planName: $('#plan-select').value }),
    });
    state.organization = result.organization || state.organization;
    state.loaded.delete('billing');
    state.loaded.delete('overview');
    await Promise.all([refreshWorkspace(), loadInvoices()]);
    state.loaded.add('billing');
    toast('Workspace plan updated');
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

$('#workspace-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $('#workspace-error').textContent = '';
  try {
    const result = await api('/v1/organization', {
      method: 'PATCH',
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
    });
    state.organization = { ...state.organization, ...result.organization };
    renderOverview();
    $('#workspace-dialog').close();
    toast('Workspace updated');
  } catch (error) {
    $('#workspace-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#signout').addEventListener('click', async () => {
  try {
    await api('/v1/auth/logout', { method: 'POST' });
    location.assign('/login');
  } catch (error) {
    toast(error.message);
  }
});

$('#refresh-orgs-btn')?.addEventListener('click', async () => {
  state.loaded.delete('organizations');
  await loadOrganizations();
  toast('Organizations refreshed');
});

$('#refresh-health-btn')?.addEventListener('click', async () => {
  state.loaded.delete('system-health');
  await loadSystemHealth();
  toast('System health refreshed');
});

$('#refresh-audit-btn')?.addEventListener('click', async () => {
  state.loaded.delete('audit-logs');
  await loadGlobalAudit();
  toast('Audit trail refreshed');
});

loadAdmin().catch((error) => {
  if (error.message !== 'Your session expired.') toast(error.message);
});