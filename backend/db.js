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
    // Cria tabela conversations se não existir
    db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT UNIQUE,
        last_message TEXT,
        claimed_by TEXT,
        finished INTEGER DEFAULT 0,
        updated_at TEXT
      )
    `);

    // Cria tabela messages se não existir (com image_url)
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER,
        chat_id TEXT,
        sender TEXT,
        text TEXT,
        image_url TEXT,
        created_at TEXT,
        UNIQUE(conversation_id, chat_id, text, IFNULL(image_url, '')),
        FOREIGN KEY(conversation_id) REFERENCES conversations(id)
      )
    `);

    // Verifica colunas da tabela conversations (para bancos antigos)
    db.all("PRAGMA table_info(conversations)", (err, rows) => {
      if (err) {
        console.error('Erro ao ler estrutura de conversations:', err);
      } else {
        const columns = rows ? rows.map(r => r.name) : [];

        if (!columns.includes('finished')) {
          db.run(`ALTER TABLE conversations ADD COLUMN finished INTEGER DEFAULT 0`, (err2) => {
            if (err2 && !/duplicate column/i.test(err2.message)) console.error('Erro ao adicionar coluna finished:', err2.message);
            else if (!err2) console.log("Coluna 'finished' adicionada com sucesso!");
          });
        }

        if (!columns.includes('updated_at')) {
          db.run(`ALTER TABLE conversations ADD COLUMN updated_at TEXT`, (err3) => {
            if (err3 && !/duplicate column/i.test(err3.message)) console.error('Erro ao adicionar coluna updated_at:', err3.message);
            else if (!err3) console.log("Coluna 'updated_at' adicionada com sucesso!");
          });
        }
      }
    });

    // Verifica colunas da tabela messages (para bancos antigos) e adiciona image_url se faltar
    db.all("PRAGMA table_info(messages)", (err, rows) => {
      if (err) {
        console.error('Erro ao ler estrutura de messages:', err);
      } else {
        const msgCols = rows ? rows.map(r => r.name) : [];

        if (!msgCols.includes('image_url')) {
          db.run(`ALTER TABLE messages ADD COLUMN image_url TEXT`, (err2) => {
            if (err2 && !/duplicate column/i.test(err2.message)) {
              console.error("Erro ao adicionar coluna image_url (pode ignorar se já existir):", err2.message);
            } else if (!err2) {
              console.log("Coluna 'image_url' adicionada com sucesso à tabela messages.");
            }
          });
        }
      }
    });
  });
}

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
          if (callback) callback(err2);
        }
      );
    } else {
      db.run(
        `INSERT INTO conversations (chat_id, last_message, updated_at, claimed_by, finished) VALUES (?, ?, ?, NULL, 0)`,
        [chat_id, last_message, now],
        function (err3) {
          if (callback) callback(err3);
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
// agora aceita image_url (opcional) e previne duplicação considerando text + image_url
function addMessage(conversation_id, chat_id, sender, text = null, image_url = null, callback) {
  const now = new Date().toISOString();

  // Busca última mensagem do mesmo remetente
  db.get(
    `SELECT text, image_url FROM messages WHERE conversation_id = ? AND sender = ? ORDER BY id DESC LIMIT 1`,
    [conversation_id, sender],
    (err, row) => {
      if (err) return callback ? callback(err) : null;

      // Normaliza undefined/null para comparações seguras
      const lastText = row && row.text !== null ? row.text : null;
      const lastImage = row && row.image_url !== null ? row.image_url : null;

      if (lastText === text && lastImage === image_url) {
        // Mensagem duplicada (mesmo texto e mesma imagem) -> não insere
        return callback ? callback(null) : null;
      }

      db.run(
        `INSERT INTO messages (conversation_id, chat_id, sender, text, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [conversation_id, chat_id, sender, text, image_url, now],
        function (err2) {
          if (callback) callback(err2);
        }
      );
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
    callback(null, row);
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
        if (callback) callback(err2);
      }
    );
  });
}

// ======================== FINALIZAR CONVERSA ========================
function finishConversation(id, callback) {
  const now = new Date().toISOString();
  db.run(`UPDATE conversations SET finished = 1, updated_at = ? WHERE id = ?`, [now, id], function (err) {
    if (err) return callback(err);
    callback(null);
  });
}

// ======================== Reabrir conversa ========================
function reopenConversation(conversation_id, callback) {
  db.get(`SELECT id FROM conversations WHERE id = ?`, [conversation_id], (err, row) => {
    if (err) return callback ? callback(err) : null;
    if (!row) return callback ? callback(new Error('Conversa não encontrada')) : null;

    const now = new Date().toISOString();
    db.run(
      `UPDATE conversations SET finished = 0, claimed_by = NULL, updated_at = ? WHERE id = ?`,
      [now, conversation_id],
      function (err2) {
        if (callback) callback(err2);
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
  reopenConversation
};
