// frontend/js/script.js
let selectedConversationId = null;
let agentName = null;
const lastMessageId = {}; // guarda última mensagem exibida por conversa
let allConversations = []; // todas as conversas carregadas

const startBtn = document.getElementById('startBtn');
const finishBtn = document.getElementById('finishBtn');
const imageInput = document.getElementById('imageInput'); // input de imagens
const messageInput = document.getElementById('messageInput'); // input de texto

// ======================== ENVIAR MENSAGEM AO PRESSIONAR ENTER ========================
messageInput.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault(); // previne pular linha
    document.getElementById('sendBtn').click(); // simula clique no botão "Enviar"
  }
});

// ======================== CARREGAR CONVERSAS ========================
async function loadConversations() {
  try {
    const res = await fetch('/conversations');
    const convs = await res.json();
    allConversations = convs;
    renderConversations();
  } catch (err) {
    console.error('Erro ao carregar conversas:', err);
  }
}

// Renderizar conversas nas abas
function renderConversations() {
  const pendingList = document.getElementById('pendingList');
  const inprogressList = document.getElementById('inprogressList');
  const finishedList = document.getElementById('finishedList');

  pendingList.innerHTML = '';
  inprogressList.innerHTML = '';
  finishedList.innerHTML = '';

  allConversations.forEach(c => {
    const div = document.createElement('div');
    div.className = 'conversation';
    div.dataset.id = c.id;
    const last = c.last_message ? escapeHtml(c.last_message) : '(sem mensagens ainda)';
    div.innerHTML = `<div class="conv-top"><strong>Chat:</strong> ${escapeHtml(c.chat_id)}</div>
                     <div class="conv-last">${last}</div>`;
    if (c.claimed_by) div.classList.add('claimed');

    div.onclick = () => selectConversation(c.id, div);

    if (!c.claimed_by) pendingList.appendChild(div);
    else if (c.claimed_by && !c.finished) inprogressList.appendChild(div);
    else if (c.finished) finishedList.appendChild(div);
  });
}

// ======================== SELECIONAR CONVERSA ========================
function selectConversation(id, divElement) {
  selectedConversationId = id;
  document.querySelectorAll('.conversation').forEach(d => d.classList.remove('selected'));
  divElement.classList.add('selected');
  loadMessages(id);

  const conv = allConversations.find(c => c.id == id);
  startBtn.style.display = conv && !conv.claimed_by ? 'inline-block' : 'none';
  finishBtn.style.display = conv && conv.claimed_by && !conv.finished ? 'inline-block' : 'none';
}

// ======================== CARREGAR MENSAGENS (SEM PISCAR) ========================
async function loadMessages(convId) {
  try {
    const res = await fetch(`/conversations/${convId}/messages`);
    const msgs = await res.json();
    const msgList = document.getElementById('msgList');

    const conv = allConversations.find(c => c.id == convId) || {};
    const lastId = lastMessageId[convId] || 0;
    const newMsgs = msgs.filter(m => m.id > lastId);

    if (conv.finished && newMsgs.some(m => m.sender === 'user')) {
      await fetch(`/conversations/${convId}/reopen`, { method: 'POST' });
      conv.finished = false;
      loadConversations();
      startBtn.style.display = 'inline-block';
      finishBtn.style.display = 'none';
    }

    if (newMsgs.length > 0) {
      const notif = document.getElementById('notifSound');
      if (notif) {
        notif.currentTime = 0;
        notif.play().catch(() => {});
      }
      document.querySelectorAll('.conversation').forEach(div => {
        if (div.dataset.id == convId) div.style.backgroundColor = '#fff4cc';
      });
    }

    lastMessageId[convId] = msgs.length > 0 ? msgs[msgs.length - 1].id : 0;

    newMsgs.forEach(m => {
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble ' + (m.sender === 'user' ? 'msg-user' : 'msg-agent');

      const senderName = m.sender === 'user' ? 'Cliente' : (conv.claimed_by || agentName || 'Atendente');

      const senderSpan = document.createElement('div');
      senderSpan.className = 'sender';
      senderSpan.textContent = senderName;
      bubble.appendChild(senderSpan);

      if (m.image_url) {
        const img = document.createElement('img');
        img.className = 'msg-photo';
        img.src = m.image_url.startsWith('/') ? window.location.origin + m.image_url : m.image_url;
        img.alt = 'imagem enviada';
        img.onclick = () => window.open(img.src, '_blank');
        bubble.appendChild(img);
      }

      if (m.text) {
        const textSpan = document.createElement('div');
        textSpan.className = 'text';
        textSpan.textContent = m.text;
        bubble.appendChild(textSpan);
      }

      msgList.appendChild(bubble);
    });

    const nearBottom = msgList.scrollTop + msgList.clientHeight >= msgList.scrollHeight - 50;
    if (nearBottom && newMsgs.length > 0) {
      msgList.scrollTo({ top: msgList.scrollHeight, behavior: 'smooth' });
    }

  } catch (err) {
    console.error('Erro ao carregar mensagens:', err);
  }
}

// ======================== CLAIM CONVERSA ========================
async function claimConversation(convId, convDiv) {
  if (!agentName) {
    agentName = prompt("Digite seu nome de atendente:");
    if (!agentName) return alert("Informe seu nome para continuar");
  }

  try {
    const res = await fetch(`/conversations/${convId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: agentName })
    });
    const data = await res.json();
    if (data.error) return alert('Erro ao claimar: ' + data.error);

    convDiv.classList.add('claimed');
    convDiv.style.backgroundColor = '#f0f0f0';
    loadConversations();
  } catch (err) {
    console.error(err);
  }
}

// ======================== ENVIAR MENSAGEM (TEXTO + IMAGEM) ========================
document.getElementById('sendBtn').onclick = async () => {
  if (!selectedConversationId) return alert('Selecione uma conversa antes');

  const convDiv = document.querySelector(`.conversation[data-id="${selectedConversationId}"]`);
  if (!convDiv.classList.contains('claimed')) {
    await claimConversation(selectedConversationId, convDiv);
  }

  const text = document.getElementById('messageInput').value.trim();
  const imageFile = imageInput ? imageInput.files[0] : null;

  if (!text && !imageFile) return alert('Digite uma mensagem ou selecione uma imagem');

  const formData = new FormData();
  if (text) formData.append('text', text);
  if (imageFile) formData.append('image', imageFile);

  try {
    const res = await fetch(`/conversations/${selectedConversationId}/send`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.error) return alert('Erro ao enviar: ' + data.error);

    document.getElementById('messageInput').value = '';
    if (imageInput) imageInput.value = '';
    loadMessages(selectedConversationId);
    loadConversations();
  } catch (err) {
    console.error(err);
  }
};

// ======================== INICIAR / FINALIZAR ========================
startBtn.onclick = async () => {
  if (!selectedConversationId) return alert("Selecione uma conversa antes");
  const convDiv = document.querySelector(`.conversation[data-id="${selectedConversationId}"]`);
  await claimConversation(selectedConversationId, convDiv);
  startBtn.style.display = 'none';
  finishBtn.style.display = 'inline-block';
};

finishBtn.onclick = async () => {
  if (!selectedConversationId) return alert("Selecione uma conversa antes");
  try {
    const res = await fetch(`/conversations/${selectedConversationId}/finish`, { method: 'POST' });
    const data = await res.json();
    if (data.error) return alert('Erro ao finalizar: ' + data.error);

    alert("✅ Conversa finalizada com sucesso.");
    startBtn.style.display = 'none';
    finishBtn.style.display = 'none';
    selectedConversationId = null;
    document.getElementById('msgList').innerHTML = '';
    loadConversations();
  } catch (err) {
    console.error(err);
  }
};

// ======================== ATUALIZAÇÃO AUTOMÁTICA ========================
setInterval(() => {
  loadConversations();
  if (selectedConversationId) loadMessages(selectedConversationId);
}, 3000);

// ======================== INICIALIZAÇÃO ========================
loadConversations();

// ======================== Helpers ========================
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
