const messageList = document.getElementById('messages');
const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const userIdInput = document.getElementById('user-id');
const memoryToggle = document.getElementById('memory-toggle');
const memoryStatus = document.getElementById('memory-status');
const memoryList = document.getElementById('memory-list');

const renderMemory = (facts = []) => {
  if (!facts.length) {
    memoryList.innerHTML = '<p class="empty-state">No remembered facts yet.</p>';
    return;
  }

  const grouped = facts.reduce((acc, fact) => {
    acc[fact.category] = fact.fact;
    return acc;
  }, {});

  const items = Object.entries(grouped)
    .map(([label, value]) => `
      <div class="memory-item">
        <div class="label">${label}</div>
        <div class="value">${value}</div>
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
  memoryStatus.className = `badge ${enabled ? 'active' : 'inactive'}`;
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
