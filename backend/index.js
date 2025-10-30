require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const db = require('./db');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('⚠️ TELEGRAM_BOT_TOKEN não encontrado no .env');
  process.exit(1);
}

const app = express();
app.use(express.json());

// ======================== CONFIG MULTER ========================
const uploadFolder = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadFolder),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ======================== FRONTEND ========================
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

// ======================== PORTA ========================
const PORT = process.env.PORT || 3000;

// Inicializar banco
db.init();

// ======================== ROTAS WEB ========================
app.get('/conversations', (req, res) => {
  db.getConversations((err, convs) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(convs);
  });
});

app.get('/conversations/:id/messages', (req, res) => {
  const convId = parseInt(req.params.id, 10);
  if (isNaN(convId)) return res.status(400).json({ error: 'ID inválido' });

  db.getMessages(convId, (err, messages) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(messages || []);
  });
});

app.post('/conversations/:id/claim', (req, res) => {
  const convId = parseInt(req.params.id, 10);
  const { agent } = req.body;
  if (!agent) return res.status(400).json({ error: 'Informe o nome do atendente' });

  db.claimConversation(convId, agent, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post('/conversations/:id/finish', (req, res) => {
  const convId = parseInt(req.params.id, 10);
  db.finishConversation(convId, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post('/conversations/:id/reopen', (req, res) => {
  const convId = parseInt(req.params.id, 10);
  db.reopenConversation(convId, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ success: true });
  });
});

// ======================== ENVIAR MENSAGEM (TEXTO + IMAGEM) ========================
app.post('/conversations/:id/send', upload.single('image'), (req, res) => {
  const convId = parseInt(req.params.id, 10);
  const { text } = req.body;
  const imageFile = req.file;

  if (!text && !imageFile) return res.status(400).json({ error: 'Digite uma mensagem ou selecione uma imagem' });

  db.getConversations((err, convs) => {
    if (err) return res.status(500).json({ error: err.message });

    const conv = convs.find(c => c.id === convId);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    if (!conv.claimed_by) return res.status(400).json({ error: 'Você precisa claimar a conversa antes de enviar mensagens' });

    const chatId = conv.chat_id;
    let messageText = text || '';
    const imageUrl = imageFile ? `/uploads/${imageFile.filename}` : null;

    db.addMessage(convId, chatId, 'agent', messageText, imageUrl, (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });

      db.addOrUpdateConversation(chatId, messageText || '[imagem]', (err3) => {
        if (err3) console.error(err3);
      });

      const sendPromise = imageUrl
        ? bot.telegram.sendPhoto(chatId, { source: path.join(uploadFolder, imageFile.filename) }, { caption: messageText || '' })
        : bot.telegram.sendMessage(chatId, messageText);

      sendPromise
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
    if (err) return console.error('Erro ao buscar conversa:', err);

    if (!conv) {
      db.addOrUpdateConversation(chatId, text, (err2) => {
        if (err2) return console.error(err2);

        db.getConversationByChatId(chatId, (err3, newConv) => {
          if (err3 || !newConv) return console.error('Conversa não criada corretamente');

          db.addMessage(newConv.id, chatId, 'user', text, null, console.error);
          const welcomeMsg = 'Olá, seja bem-vindo! Em que posso te ajudar?';
          ctx.reply(welcomeMsg).catch(console.error);
          db.addOrUpdateConversation(chatId, welcomeMsg, console.error);
        });
      });
    } else {
      db.addMessage(conv.id, chatId, 'user', text, null, (err2) => {
        if (err2) console.error(err2);
        db.addOrUpdateConversation(chatId, text, console.error);
      });
    }
  });
});

bot.on('photo', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const photos = ctx.message.photo;
  if (!photos || photos.length === 0) return;

  const photo = photos[photos.length - 1];
  const fileId = photo.file_id;

  try {
    const fileLinkObj = await ctx.telegram.getFileLink(fileId);
    const fileLink = (typeof fileLinkObj === 'string')
      ? fileLinkObj
      : (fileLinkObj && fileLinkObj.href)
        ? fileLinkObj.href
        : String(fileLinkObj);

    const urlPath = new URL(fileLink).pathname;
    const ext = path.extname(urlPath) || '.jpg';
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const destPath = path.join(uploadFolder, filename);

    const resp = await fetch(fileLink);
    if (!resp.ok) throw new Error(`Falha ao baixar arquivo do Telegram: ${resp.status}`);

    const ab = await resp.arrayBuffer();
    const buffer = Buffer.from(ab);
    await fs.promises.writeFile(destPath, buffer);

    const imageUrl = `/uploads/${filename}`;

    db.getConversationByChatId(chatId, (err, conv) => {
      if (err) return console.error('Erro ao buscar conversa:', err);

      if (!conv) {
        db.addOrUpdateConversation(chatId, '[imagem]', (err2) => {
          if (err2) return console.error(err2);

          db.getConversationByChatId(chatId, (err3, newConv) => {
            if (err3 || !newConv) return console.error('Conversa não criada corretamente');

            db.addMessage(newConv.id, chatId, 'user', null, imageUrl, (err4) => {
              if (err4) console.error(err4);
            });
          });
        });
      } else {
        db.addMessage(conv.id, chatId, 'user', null, imageUrl, (err2) => {
          if (err2) console.error(err2);
        });
      }
    });

    ctx.reply('✅ Foto recebida com sucesso!').catch(console.error);
  } catch (error) {
    console.error('Erro ao processar imagem:', error);
    ctx.reply('❌ Ocorreu um erro ao processar a imagem.').catch(console.error);
  }
});

// ======================== SERVIDOR ========================
bot.launch().then(() => console.log('🤖 Bot iniciado...')).catch(console.error);
app.use('/uploads', express.static(uploadFolder));
app.listen(PORT, () => console.log(`🌐 Servidor rodando em http://localhost:${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
