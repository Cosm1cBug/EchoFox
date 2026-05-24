const sqlite3 = require("better-sqlite3");
const { LRUCache } = require("lru-cache");
const pino = require("pino");
const path = require("path");
const { existsSync } = require("fs");
const { mkdir } = require("fs/promises");

async function makeInSQLiteStore(instanceId, dbPath, logger) {
  const dbDirectory = path.dirname(dbPath);
  if (!existsSync(dbDirectory)) {
    await mkdir(dbDirectory, { recursive: true });
  }

  const db = sqlite3(dbPath);
  const log = logger || pino({ level: "warn" });
  const cache = new LRUCache({ max: 10000 });

  // Database optimization
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Table initialization
  db.exec(`
        CREATE TABLE IF NOT EXISTS chats (
            remoteJid TEXT PRIMARY KEY,
            conversationTimestamp INTEGER DEFAULT 0,
            unreadCount INTEGER DEFAULT 0,
            archived INTEGER DEFAULT 0,
            pinned INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS messages (
            messageId TEXT PRIMARY KEY,
            remoteJid TEXT NOT NULL,
            sender TEXT,
            message BLOB,
            messageTimestamp INTEGER,
            status INTEGER DEFAULT 0,
            FOREIGN KEY(remoteJid) REFERENCES chats(remoteJid)
        );

        CREATE TABLE IF NOT EXISTS contacts (
            remoteJid TEXT PRIMARY KEY,
            name TEXT,
            imgUrl TEXT
        );

        CREATE TABLE IF NOT EXISTS groups (
            remoteJid TEXT PRIMARY KEY,
            subject TEXT,
            creation INTEGER,
            participants TEXT
        );

        CREATE TABLE IF NOT EXISTS blocklist (
            remoteJid TEXT PRIMARY KEY
        );
    `);

  // Prepared statements
  const stmts = {
    chats: {
      upsert: db.prepare(`
              INSERT OR REPLACE INTO chats 
              (remoteJid, conversationTimestamp, unreadCount, archived, pinned)
              VALUES (?, ?, ?, ?, ?)
          `),
      delete: db.prepare("DELETE FROM chats WHERE remoteJid = ?")
    },
    messages: {
      upsert: db.prepare(`
              INSERT OR REPLACE INTO messages 
              (messageId, remoteJid, sender, message, messageTimestamp, status)
              VALUES (?, ?, ?, ?, ?, ?)
          `),
      updateStatus: db.prepare("UPDATE messages SET status = ? WHERE messageId = ?"),
      getByJid: db.prepare(`
              SELECT * FROM messages 
              WHERE remoteJid = ? 
              ORDER BY messageTimestamp DESC 
              LIMIT ?
          `)
    },
    contacts: {
      upsert: db.prepare(`
                INSERT OR REPLACE INTO contacts 
                (remoteJid, name, imgUrl)
                VALUES (?, ?, ?)
            `)
    },
    groups: {
      upsert: db.prepare(`
                INSERT OR REPLACE INTO groups 
                (remoteJid, subject, creation, participants)
                VALUES (?, ?, ?, ?)
            `),
      get: db.prepare("SELECT * FROM groups WHERE remoteJid = ?"),
      getAll: db.prepare("SELECT * FROM groups"),
      delete: db.prepare("DELETE FROM groups WHERE remoteJid = ?")
    },
    blocklist: {
      add: db.prepare("INSERT OR REPLACE INTO blocklist (remoteJid) VALUES (?)"),
      remove: db.prepare("DELETE FROM blocklist WHERE remoteJid = ?"),
      getAll: db.prepare("SELECT remoteJid FROM blocklist")
    }
  };

  // Helper functions
  const ensureChatExists = (remoteJid) => {
    if (!db.prepare("SELECT 1 FROM chats WHERE remoteJid = ?").get(remoteJid)) {
      stmts.chats.upsert.run(
        remoteJid,
        Math.floor(Date.now() / 1000), // UNIX timestamp
        0,    // unreadCount
        0,    // archived (0 = false)
        0     // pinned (0 = false)
      );
    }
  };

  // Data retrieval methods
  const getters = {
    getChat: (remoteJid) => stmts.chats.get.get(remoteJid),

    getMessagesByJid: (remoteJid, limit = 50) => {
      return stmts.messages.getByJid.all(remoteJid, limit).map(row => ({
        ...row,
        message: row.message ? JSON.parse(row.message.toString()) : null
      }));
    },

    getGroup: (remoteJid) => {
      if (cache.has(remoteJid)) return cache.get(remoteJid);

      const group = stmts.groups.get.get(remoteJid);
      if (group) {
        group.participants = JSON.parse(group.participants);
        cache.set(remoteJid, group);
      }
      return group;
    },

    getAllGroups: () => {
      return stmts.groups.getAll.all().map(g => ({
        ...g,
        participants: JSON.parse(g.participants)
      }));
    },

    getContact: (remoteJid) => {
      return db.prepare("SELECT * FROM contacts WHERE remoteJid = ?").get(remoteJid);
    },

    getBlocklist: () => {
      return stmts.blocklist.getAll.all().map(row => row.remoteJid);
    }
  };

  // Event binding
  const bind = (ev, sock) => {
    ev.on("connection.update", async (update) => {
      if (update.connection === "open" && sock) {
        try {
          log.info("[SQLite] Syncing groups...");
          const groups = await sock.groupFetchAllParticipating();

          db.transaction(() => {
            for (const group of Object.values(groups)) {
              stmts.groups.upsert.run(
                group.id,
                group.subject,
                group.creation,
                JSON.stringify(group.participants)
              );
            }
          })();

          log.info(`[SQLite] Synced ${Object.keys(groups).length} groups`);
        } catch (error) {
          log.error(`[SQLite] Group sync failed: ${error.message}`);
        }
      }
    });

    ev.on("chats.upsert", (chats) => {
      db.transaction(() => {
        for (const chat of chats) {
          stmts.chats.upsert.run(
            chat.id,
            Math.floor((chat.conversationTimestamp || Date.now()) / 1000),
            Number(chat.unreadCount) || 0,
            chat.archived ? 1 : 0, // Convert boolean to integer
            chat.pinned ? 1 : 0    // Convert boolean to integer
          );
        }
      })();
    });

    ev.on("chats.update", (updates) => {
      db.transaction(() => {
        for (const update of updates) {
          const existing = db.prepare("SELECT * FROM chats WHERE remoteJid = ?")
            .get(update.id);

          if (existing) {
            stmts.chats.upsert.run(
              update.id,
              update.conversationTimestamp || existing.conversationTimestamp,
              update.unreadCount ?? existing.unreadCount,
              'archived' in update ? (update.archived ? 1 : 0) : existing.archived,
              'pinned' in update ? (update.pinned ? 1 : 0) : existing.pinned
            );
          }
        }
      })();
    });

    ev.on("messages.upsert", ({ messages }) => {
      db.transaction(() => {
        for (const msg of messages) {
          if (!msg?.key?.remoteJid || !msg?.key?.id) continue;

          ensureChatExists(msg.key.remoteJid);

          stmts.messages.upsert.run(
            msg.key.id,
            msg.key.remoteJid,
            msg.key.participant || msg.pushName || 'system',
            msg.message ? Buffer.from(JSON.stringify(msg.message)) : null,
            Math.floor((msg.messageTimestamp || Date.now()) / 1000),
            Number(msg.status) || 0
          );
        }
      })();
    });

    ev.on("message-receipt.update", (updates) => {
      db.transaction(() => {
        for (const { key, receipt } of updates) {
          stmts.messages.updateStatus.run(
            receipt.isRead ? 1 : 0,
            key.id
          );
        }
      })();
    });

    ev.on("contacts.upsert", (contacts) => {
      db.transaction(() => {
        for (const contact of contacts) {
          stmts.contacts.upsert.run(
            contact.id,
            contact.name?.toString() || 'Unknown',
            contact.imgUrl?.toString() || ''
          );
        }
      })();
    });

    ev.on("groups.upsert", (groups) => {
      db.transaction(() => {
        for (const group of groups) {
          stmts.groups.upsert.run(
            group.id,
            group.subject,
            group.creation,
            JSON.stringify(group.participants || [])
          );
        }
      })();
    });

    ev.on("blocklist.update", ({ blocklist, type }) => {
      db.transaction(() => {
        for (const jid of blocklist) {
          type === "add"
            ? stmts.blocklist.add.run(jid)
            : stmts.blocklist.remove.run(jid);
        }
      })();
    });
  };

  return {
    bind,
    ...getters,
    db,
    instanceId: () => instanceId,
    // Add any additional methods you need
  };
}

module.exports = { makeInSQLiteStore };