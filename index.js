require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const path = require('path');
const db = require('./db');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('⚠️ TELEGRAM_BOT_TOKEN não encontrado no .env');
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Inicializar banco
db.init();

// ======================== ROTAS WEB ========================

// Listar todas as conversas
app.get('/conversations', (req, res) => {
  db.getConversations((err, convs) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(convs);
  });
});

// Listar mensagens de uma conversa
app.get('/conversations/:id/messages', (req, res) => {
  const convId = parseInt(req.params.id, 10);
  if (isNaN(convId)) return res.status(400).json({ error: 'ID inválido' });

  db.getMessages(convId, (err, messages) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(messages || []);
  });
});

// Claim de conversa
app.post('/conversations/:id/claim', (req, res) => {
  const convId = parseInt(req.params.id, 10);
  const { agent } = req.body;
  if (!agent) return res.status(400).json({ error: 'Informe o nome do atendente' });

  db.claimConversation(convId, agent, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ success: true });
    
  });
});





// Finalizar conversa
app.post('/conversations/:id/finish', (req, res) => {
  const convId = parseInt(req.params.id, 10);
  db.finishConversation(convId, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ success: true });
  });
});

// Rota opcional para reabrir manualmente
app.post('/conversations/:id/reopen', (req, res) => {
  const convId = parseInt(req.params.id, 10);
  db.reopenConversation(convId, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ success: true });
  });
});

// Enviar mensagem do atendente
app.post('/conversations/:id/send', (req, res) => {
  const convId = parseInt(req.params.id, 10);
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Texto é obrigatório' });

  db.getConversations((err, convs) => {
    if (err) return res.status(500).json({ error: err.message });

    const conv = convs.find(c => c.id === convId);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    if (!conv.claimed_by) return res.status(400).json({ error: 'Você precisa claimar a conversa antes de enviar mensagens' });

    // Salvar mensagem no banco
    db.addMessage(convId, conv.chat_id, 'agent', text, (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });

      // Atualiza last_message
      db.addOrUpdateConversation(conv.chat_id, text, (err3) => {
        if (err3) console.error(err3);
      });

      // Enviar mensagem pelo Telegram
      bot.telegram.sendMessage(conv.chat_id, text)
        .then(() => res.json({ success: true }))
        .catch(e => res.status(500).json({ error: e.message }));
    });
  });
});

// ======================== BOT TELEGRAM ========================
const bot = new Telegraf(BOT_TOKEN);

bot.on('text', (ctx) => {
  const chatId = ctx.chat.id.toString();
  const text = ctx.message.text;

  db.getConversationByChatId(chatId, (err, conv) => {
    if (err) {
      console.error('Erro ao buscar conversa:', err);
      return;
    }

    // Se não existir conversa ainda -> cria e responde com boas-vindas
    if (!conv) {
      db.addOrUpdateConversation(chatId, text, (err2) => {
        if (err2) return console.error(err2);

        db.getConversationByChatId(chatId, (err3, newConv) => {
          if (err3) return console.error(err3);
          if (!newConv) return console.error('Conversa não criada corretamente');

          db.addMessage(newConv.id, chatId, 'user', text, (err4) => {
            if (err4) console.error(err4);
          });

          // envia mensagem de boas-vindas (apenas na primeira interação)
          const welcomeMsg = 'Olá, seja bem-vindo! Em que posso te ajudar?';
          ctx.reply(welcomeMsg).catch(console.error);

          // atualiza last_message para a resposta inicial
          db.addOrUpdateConversation(chatId, welcomeMsg, (err5) => {
            if (err5) console.error(err5);
          });
        });
      });

    } else {
      // Se existe conversa e está finalizada -> reabrir via db.reopenConversation
      if (conv.finished) {
        db.reopenConversation(conv.id, (errReopen) => {
          if (errReopen) {
            console.error('Erro ao reabrir conversa:', errReopen);
            // prossegue mesmo com erro para não perder a mensagem
          } else {
            console.log(`Conversa ${conv.id} reaberta automaticamente.`);
          }

          // Em ambos os casos (reaberta ou erro), salva a mensagem do usuário
          db.addMessage(conv.id, chatId, 'user', text, (err2) => {
            if (err2) return console.error(err2);
            db.addOrUpdateConversation(chatId, text, (err3) => {
              if (err3) console.error(err3);
            });
          });
        });
      } else {
        // conversa existe e não está finalizada -> apenas salvar a mensagem
        db.addMessage(conv.id, chatId, 'user', text, (err2) => {
          if (err2) return console.error(err2);
          // atualiza last_message
          db.addOrUpdateConversation(chatId, text, (err3) => {
            if (err3) console.error(err3);
          });
        });
      }
    }
  });
});

// ======================== INICIAR SERVIDOR ========================
bot.launch().then(() => console.log('🤖 Bot iniciado...')).catch(console.error);
app.listen(PORT, () => console.log(`🌐 Servidor rodando em http://localhost:${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
