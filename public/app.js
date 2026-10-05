const messageList = document.getElementById('messages');
const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const userIdInput = document.getElementById('user-id');
const memoryToggle = document.getElementById('memory-toggle');
const memoryStatus = document.getElementById('memory-status');
const memoryList = document.getElementById('memory-list');
const workspaceName = document.getElementById('workspace-name');
const workspacePlan = document.getElementById('workspace-plan');
const projectCount = document.getElementById('project-count');
const memberCount = document.getElementById('member-count');
const billingStatus = document.getElementById('billing-status');
const invoiceTotal = document.getElementById('invoice-total');
const ownerName = document.getElementById('owner-name');
const planName = document.getElementById('plan-name');
const seatUsage = document.getElementById('seat-usage');
const projectList = document.getElementById('project-list');
const usageList = document.getElementById('usage-list');
const memberList = document.getElementById('member-list');
const billingSummary = document.getElementById('billing-summary');
const auditList = document.getElementById('audit-list');

const formatCurrency = (cents = 0) => {
  const value = Number(cents || 0) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
};

const renderMemory = (facts = []) => {
  if (!facts.length) {
    memoryList.innerHTML = '<p class="empty-state">No remembered facts yet.</p>';
    return;
  }

  const grouped = facts.reduce((acc, fact) => {
    acc[fact.category || 'general'] = fact.fact;
    return acc;
  }, {});

  const items = Object.entries(grouped)
    .map(([label, value]) => `
      <div class="memory-item">
        <span class="memory-label">${label}</span>
        <strong>${value}</strong>
      </div>
    `)
    .join('');

  memoryList.innerHTML = items;
};

const renderMessage = (role, text) => {
  const item = document.createElement('div');
  item.className = `message ${role}`;
  item.textContent = text;
  messageList.appendChild(item);
  messageList.scrollTop = messageList.scrollHeight;
};

const updateMemoryStatus = () => {
  const enabled = memoryToggle.checked;
  memoryStatus.textContent = enabled ? 'Memory Active' : 'Memory Off';
  memoryStatus.className = `status-pill ${enabled ? 'success' : 'danger'}`;
};

const renderProjectList = (items = []) => {
  if (!items.length) {
    projectList.innerHTML = '<p class="empty-state">No projects yet.</p>';
    return;
  }

  projectList.innerHTML = items.map((project) => `
    <div class="stack-item">
      <div>
        <strong>${project.name || 'Untitled project'}</strong>
        <small>${project.environment || 'test'} environment</small>
      </div>
      <span class="tag">${project.environment || 'test'}</span>
    </div>
  `).join('');
};

const renderUsageBars = (usage) => {
  const members = Number(usage?.memberCount || 0);
  const projects = Number(usage?.projectCount || 0);
  const customers = Number(usage?.customerCount || 0);
  const requestCount = Number(usage?.requestCount || 0);
  const plan = usage?.planName || 'starter';

  const usageItems = [
    { label: 'Projects', value: projects, max: Number(usage?.projectLimit || 1), suffix: 'used' },
    { label: 'Customers', value: customers, max: Number(usage?.customerLimit || 1), suffix: 'tracked' },
    { label: 'Support seats', value: members, max: Number(usage?.supportSeatsLimit || 1), suffix: 'members' },
    { label: 'Recent requests', value: requestCount, max: Number(usage?.requestLimit || 1), suffix: 'last 30d' },
  ];

  usageList.innerHTML = usageItems.map((item) => {
    const pct = Math.min((item.value / Math.max(item.max, 1)) * 100, 100);
    return `
      <div class="usage-row">
        <div class="usage-topline">
          <span>${item.label}</span>
          <strong>${item.value} / ${item.max}</strong>
        </div>
        <div class="progress-track">
          <span style="width: ${pct}%"></span>
        </div>
        <small>${plan} plan · ${item.suffix}</small>
      </div>
    `;
  }).join('');
};

const renderMembers = (items = []) => {
  if (!items.length) {
    memberList.innerHTML = '<p class="empty-state">No members yet.</p>';
    return;
  }

  memberList.innerHTML = items.map((member) => `
    <div class="stack-item compact-item">
      <div>
        <strong>${member.name || member.email || 'Member'}</strong>
        <small>${member.email || 'Workspace member'}</small>
      </div>
      <span class="tag muted">${member.role || 'member'}</span>
    </div>
  `).join('');
};

const renderBilling = (billing = {}, invoices = []) => {
  const total = invoices.reduce((sum, invoice) => sum + Number(invoice.amountCents || 0), 0);
  const paid = invoices.filter((invoice) => invoice.status === 'paid').reduce((sum, invoice) => sum + Number(invoice.amountCents || 0), 0);
  const outstanding = invoices.filter((invoice) => invoice.status !== 'paid').reduce((sum, invoice) => sum + Number(invoice.amountCents || 0), 0);

  billingSummary.innerHTML = `
    <div class="billing-grid">
      <div class="billing-box">
        <span>Cycle total</span>
        <strong>${formatCurrency(total)}</strong>
      </div>
      <div class="billing-box">
        <span>Paid</span>
        <strong>${formatCurrency(paid)}</strong>
      </div>
      <div class="billing-box">
        <span>Outstanding</span>
        <strong>${formatCurrency(outstanding)}</strong>
      </div>
      <div class="billing-box">
        <span>Status</span>
        <strong>${billing.billingStatus || 'active'}</strong>
      </div>
    </div>
  `;
};

const renderAudit = (items = []) => {
  if (!items.length) {
    auditList.innerHTML = '<p class="empty-state">No activity recorded yet.</p>';
    return;
  }

  auditList.innerHTML = items.slice(0, 6).map((event) => `
    <div class="audit-item">
      <strong>${event.action || 'activity'}</strong>
      <small>${new Date(event.createdAt || Date.now()).toLocaleString()}</small>
    </div>
  `).join('');
};

const renderWorkspaceSummary = (organization = {}, members = [], usage = {}, billing = {}, projects = [], audit = []) => {
  workspaceName.textContent = organization.name || 'Workspace';
  workspacePlan.textContent = `${organization.planName || 'starter'} plan`;
  projectCount.textContent = Number(organization.projectCount || projects.length || 0);
  memberCount.textContent = Number(organization.memberCount || members.length || 0);
  billingStatus.textContent = billing.billingStatus || 'Active';
  invoiceTotal.textContent = formatCurrency(billing.totalBalanceCents || 0);

  ownerName.textContent = organization.ownerUserId ? `User ${String(organization.ownerUserId).slice(0, 8)}` : 'Workspace owner';
  planName.textContent = organization.planName || 'starter';
  seatUsage.textContent = `${members.length} / ${usage.supportSeatsLimit || 1}`;

  renderProjectList(projects);
  renderUsageBars(usage);
  renderMembers(members);
  renderBilling(billing, []);
  renderAudit(audit);
};

const loadWorkspaceData = async () => {
  try {
    const [organizationRes, membersRes, usageRes, billingRes, projectsRes, auditRes] = await Promise.all([
      fetch('/v1/organization').catch(() => ({ ok: false })),
      fetch('/v1/organization/members').catch(() => ({ ok: false })),
      fetch('/v1/organization/usage').catch(() => ({ ok: false })),
      fetch('/v1/organization/billing').catch(() => ({ ok: false })),
      fetch('/v1/projects').catch(() => ({ ok: false })),
      fetch('/v1/organization/audit').catch(() => ({ ok: false })),
    ]);

    const org = organizationRes.ok ? await organizationRes.json() : { organization: {} };
    const members = membersRes.ok ? (await membersRes.json()).members || [] : [];
    const usage = usageRes.ok ? (await usageRes.json()).usage || {} : {};
    const billing = billingRes.ok ? (await billingRes.json()).billing || {} : {};
    const projects = projectsRes.ok ? (await projectsRes.json()).projects || [] : [];
    const audit = auditRes.ok ? (await auditRes.json()).events || [] : [];

    renderWorkspaceSummary(org.organization || {}, members, usage, billing, projects, audit);
    const invoiceRes = await fetch('/v1/organization/invoices').catch(() => ({ ok: false }));
    if (invoiceRes.ok) {
      const invoiceData = await invoiceRes.json();
      const invoices = invoiceData.invoices || [];
      renderBilling(billing, invoices);
      invoiceTotal.textContent = formatCurrency(invoices.reduce((sum, item) => sum + Number(item.amountCents || 0), 0));
    }
  } catch (error) {
    workspaceName.textContent = 'Workspace not connected';
    workspacePlan.textContent = 'Sign in to view billing';
    renderProjectList([]);
    renderUsageBars({
      memberCount: 0,
      projectCount: 0,
      customerCount: 0,
      requestCount: 0,
      projectLimit: 1,
      customerLimit: 1,
      supportSeatsLimit: 1,
      requestLimit: 1,
      planName: 'starter',
    });
    renderMembers([]);
    renderAudit([]);
  }
};

const loadMemory = async () => {
  const userId = userIdInput.value.trim();
  if (!userId) {
    renderMemory([]);
    return;
  }

  try {
    const response = await fetch(`/api/support/memory?userId=${encodeURIComponent(userId)}`);
    const data = await response.json();
    renderMemory(data.memory || []);
  } catch (error) {
    renderMemory([]);
  }
};

const talkToAgent = async (message) => {
  const userId = userIdInput.value.trim();
  const payload = {
    userId,
    message,
    memoryMode: memoryToggle.checked ? 'on' : 'off',
  };

  renderMessage('user', message);
  renderMessage('agent', 'Thinking...');

  try {
    const response = await fetch('/api/support/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    const lastMessage = document.querySelector('.message.agent:last-child');
    if (lastMessage) {
      lastMessage.textContent = data.reply || 'No response was returned.';
    }

    await loadMemory();
  } catch (error) {
    const lastMessage = document.querySelector('.message.agent:last-child');
    if (lastMessage) {
      lastMessage.textContent = 'A connection error occurred while contacting the support agent.';
    }
  }
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) {
    return;
  }

  input.value = '';
  await talkToAgent(message);
});

memoryToggle.addEventListener('change', () => {
  updateMemoryStatus();
  loadMemory();
});

document.getElementById('clear-memory').addEventListener('click', async () => {
  const userId = userIdInput.value.trim();
  if (!userId) {
    return;
  }

  await fetch('/api/support/memory', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });

  renderMemory([]);
});

document.getElementById('new-session').addEventListener('click', () => {
  messageList.innerHTML = '';
  renderMemory([]);
});

userIdInput.addEventListener('change', () => {
  loadMemory();
});

updateMemoryStatus();
loadMemory();
loadWorkspaceData();
