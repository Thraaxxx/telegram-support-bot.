let selectedConversationId = null;
let agentName = null;
const lastMessageId = {}; // guarda última mensagem exibida por conversa
let allConversations = []; // todas as conversas carregadas

const startBtn = document.getElementById('startBtn');
const finishBtn = document.getElementById('finishBtn');

// ======================== CARREGAR CONVERSAS ========================
async function loadConversations() {
  try {
    const res = await fetch('/conversations');
    const convs = await res.json();
    allConversations = convs;
    renderConversations();
    if (!c.claimed_by) pendingList.appendChild(div);
else if (c.claimed_by && !c.finished) inprogressList.appendChild(div);
else if (c.finished) finishedList.appendChild(div);

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
    div.textContent = `ChatID: ${c.chat_id} | Última mensagem: ${c.last_message || ''}`;
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

// ======================== CARREGAR MENSAGENS ========================
async function loadMessages(convId) {
  try {
    const res = await fetch(`/conversations/${convId}/messages`);
    const msgs = await res.json();
    const msgList = document.getElementById('msgList');

    const conv = allConversations.find(c => c.id == convId);

    // ==================== NOVO: REABRIR CONVERSA FINALIZADA ====================
    const lastId = lastMessageId[convId] || 0;
    const newUserMsgs = msgs.filter(m => m.id > lastId && m.sender === 'user');

    if (conv.finished && newUserMsgs.length > 0) {
      // Reabre a conversa no backend
      await fetch(`/conversations/${convId}/reopen`, { method: 'POST' });
      conv.finished = false; // atualiza localmente
      loadConversations();
      startBtn.style.display = 'inline-block';
      finishBtn.style.display = 'none';
    }

    // ==================== NOTIFICAÇÃO ====================
    if (newUserMsgs.length > 0) {
      document.getElementById('notifSound').play();
      document.querySelectorAll('.conversation').forEach(div => {
        if (div.dataset.id == convId) div.style.backgroundColor = '#ffeb3b';
      });
    }

    lastMessageId[convId] = msgs.length > 0 ? msgs[msgs.length - 1].id : 0;

    // Renderiza mensagens
    msgList.innerHTML = '';
    msgs.forEach(m => {
      const p = document.createElement('p');
      p.textContent = `[${m.sender}] ${m.text}`;
      msgList.appendChild(p);
    });
    msgList.scrollTop = msgList.scrollHeight;
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

// ======================== ENVIAR MENSAGEM ========================
document.getElementById('sendBtn').onclick = async () => {
  const text = document.getElementById('messageInput').value;
  if (!text) return alert('Digite a mensagem');
  if (!selectedConversationId) return alert('Selecione uma conversa antes');

  const convDiv = document.querySelector(`.conversation[data-id="${selectedConversationId}"]`);

  if (!convDiv.classList.contains('claimed')) {
    await claimConversation(selectedConversationId, convDiv);
  }

  try {
    const res = await fetch(`/conversations/${selectedConversationId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (data.error) return alert('Erro ao enviar: ' + data.error);

    document.getElementById('messageInput').value = '';
    loadMessages(selectedConversationId);
  } catch (err) {
    console.error(err);
  }
};

// ======================== BOTÕES INICIAR / FINALIZAR ========================
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

    // Atualiza visualmente a interface
    alert(`✅ Conversa #${data.conversation.id} finalizada com sucesso.`);
    startBtn.style.display = 'none';
    finishBtn.style.display = 'none';
    selectedConversationId = null;
    document.getElementById('msgList').innerHTML = '';

    // Recarrega as listas para mover a conversa para “Finalizados”
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
