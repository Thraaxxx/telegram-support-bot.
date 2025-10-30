const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Falha ao abrir o banco de dados', err);
  } else {
    console.log('Banco de dados aberto em:', DB_FILE);
  }
});

// ======================== Inicializar banco e tabelas ========================
function init() {
  db.serialize(() => {
    // 1️⃣ Cria tabela se não existir
   db.run(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT UNIQUE,
    last_message TEXT,
    claimed_by TEXT,
    finished INTEGER DEFAULT 0
  )
`);

    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER,
        chat_id TEXT,
        sender TEXT,
        text TEXT,
        created_at TEXT,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id)
      )
    `);

    // 2️⃣ Tenta adicionar coluna 'finished'
    db.run(`ALTER TABLE conversations ADD COLUMN finished INTEGER DEFAULT 0`, (err) => {
      // ignora erro se coluna já existir ou tabela ainda não tiver sido criada
      if (err && !err.message.includes('duplicate column')) {
        console.error('Erro ao adicionar coluna finished (pode ignorar se o banco é novo):', err.message);
      }
    });
  });
}


db.serialize(() => {
  // Adiciona coluna 'finished' se não existir
  db.run(`ALTER TABLE conversations ADD COLUMN finished INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Erro ao adicionar coluna finished:', err);
    }
  });
});


// ======================== Inserir ou atualizar conversa ========================
function addOrUpdateConversation(chat_id, last_message, callback) {
  const now = new Date().toISOString();
  db.get(`SELECT id FROM conversations WHERE chat_id = ?`, [chat_id], (err, row) => {
    if (err) return callback ? callback(err) : null;

    if (row) {
      db.run(
        `UPDATE conversations SET last_message = ?, updated_at = ? WHERE id = ?`,
        [last_message, now, row.id],
        function (err2) {
          if (callback) callback && callback(err2);
        }
      );
    } else {
      db.run(
        `INSERT INTO conversations (chat_id, last_message, updated_at, claimed_by, finished) VALUES (?, ?, ?, NULL, 0)`,
        [chat_id, last_message, now],
        function (err3) {
          if (callback) callback && callback(err3);
        }
      );
    }
  });
}

// ======================== Listar conversas ========================
function getConversations(callback) {
  db.all(`SELECT * FROM conversations ORDER BY updated_at DESC`, (err, rows) => {
    if (callback) callback(err, rows || []);
  });
}

// ======================== Inserir mensagem ========================
function addMessage(conversation_id, chat_id, sender, text, callback) {
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO messages (conversation_id, chat_id, sender, text, created_at) VALUES (?, ?, ?, ?, ?)`,
    [conversation_id, chat_id, sender, text, now],
    function (err) {
      if (callback) callback && callback(err);
    }
  );
}

// ======================== Listar mensagens ========================
function getMessages(conversation_id, callback) {
  db.all(
    `SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC`,
    [conversation_id],
    (err, rows) => {
      if (callback) callback(err, rows || []);
    }
  );
}

// ======================== Buscar conversa por chat_id ========================
function getConversationByChatId(chatId, callback) {
  db.get(`SELECT * FROM conversations WHERE chat_id = ? LIMIT 1`, [chatId], (err, row) => {
    if (err) return callback(err);
    callback(null, row); // undefined se não existir
  });
}

// ======================== Claim de conversa ========================
function claimConversation(conversation_id, agent, callback) {
  db.get(`SELECT claimed_by FROM conversations WHERE id = ?`, [conversation_id], (err, row) => {
    if (err) return callback ? callback(err) : null;
    if (!row) return callback ? callback(new Error('Conversa não encontrada')) : null;
    if (row.claimed_by) return callback ? callback(new Error('Conversa já está claimed por ' + row.claimed_by)) : null;

    const now = new Date().toISOString();
    db.run(
      `UPDATE conversations SET claimed_by = ?, updated_at = ? WHERE id = ?`,
      [agent, now, conversation_id],
      function (err2) {
        if (callback) callback && callback(err2);
      }
    );
  });
}

// ======================== FINALIZAR CONVERSA ========================
function finishConversation(id, callback) {
  const sql = `UPDATE conversations SET finished = 1 WHERE id = ?`;
  db.run(sql, [id], function (err) {
    if (err) return callback(err);
    callback(null);
  });
}

// Reabrir conversa (quando cliente manda mensagem após finalizada)
// Usa conversation id (number) — se quiser por chat_id, veja nota abaixo.
function reopenConversation(conversation_id, callback) {
  // checa se existe
  db.get(`SELECT id FROM conversations WHERE id = ?`, [conversation_id], (err, row) => {
    if (err) return callback ? callback(err) : null;
    if (!row) return callback ? callback(new Error('Conversa não encontrada')) : null;

    const now = new Date().toISOString();
    db.run(
      `UPDATE conversations SET finished = 0, claimed_by = NULL, updated_at = ? WHERE id = ?`,
      [now, conversation_id],
      function (err2) {
        if (callback) callback && callback(err2);
      }
    );
  });
}



// ======================== Exportar funções ========================
module.exports = {
  db,
  init,
  addOrUpdateConversation,
  getConversations,
  addMessage,
  getMessages,
  getConversationByChatId,
  claimConversation,
  finishConversation,
  reopenConversation   // <- assegure que esta linha exista
};

