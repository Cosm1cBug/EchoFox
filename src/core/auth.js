const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const Database = require('better-sqlite3');
const Redis = require('ioredis');
const fs = require('fs');
const path = require('path');

const writeData = (data, file) => fs.writeFileSync(file, JSON.stringify(data, BufferJSON.replacer));
const readData = (file) => {
    try {
        return JSON.parse(fs.readFileSync(file, { encoding: 'utf-8' }), BufferJSON.reviver);
    } catch {
        return null;
    }
};

// ----------------------------------------------------
// Redis Auth State
// ----------------------------------------------------
async function useRedisAuth(redisUrl, sessionName) {
    const client = new Redis(redisUrl);
    
    const read = async (key) => {
        const val = await client.get(`${sessionName}:${key}`);
        return val ? JSON.parse(val, BufferJSON.reviver) : null;
    };
    const write = async (data, key) => {
        await client.set(`${sessionName}:${key}`, JSON.stringify(data, BufferJSON.replacer));
    };
    const remove = async (key) => {
        await client.del(`${sessionName}:${key}`);
    };

    let creds = await read('creds');
    if (!creds) {
        creds = initAuthCreds();
        await write(creds, 'creds');
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async id => {
                        let value = await read(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category of Object.keys(data)) {
                        for (const id of Object.keys(data[category])) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? write(value, key) : remove(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => write(creds, 'creds'),
        clear: async () => {
            const keys = await client.keys(`${sessionName}:*`);
            if (keys.length) await client.del(keys);
        }
    };
}

// ----------------------------------------------------
// SQLite Auth State
// ----------------------------------------------------
async function useSqliteAuth(sqlitePath, sessionName) {
    const dir = path.dirname(sqlitePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const db = new Database(sqlitePath);
    db.exec(`CREATE TABLE IF NOT EXISTS auth (
        session TEXT,
        key TEXT,
        value TEXT,
        PRIMARY KEY (session, key)
    )`);

    const readStmt = db.prepare(`SELECT value FROM auth WHERE session = ? AND key = ?`);
    const writeStmt = db.prepare(`INSERT OR REPLACE INTO auth (session, key, value) VALUES (?, ?, ?)`);
    const delStmt = db.prepare(`DELETE FROM auth WHERE session = ? AND key = ?`);

    const read = (key) => {
        const row = readStmt.get(sessionName, key);
        return row ? JSON.parse(row.value, BufferJSON.reviver) : null;
    };
    const write = (data, key) => {
        writeStmt.run(sessionName, key, JSON.stringify(data, BufferJSON.replacer));
    };
    const remove = (key) => {
        delStmt.run(sessionName, key);
    };

    let creds = read('creds');
    if (!creds) {
        creds = initAuthCreds();
        write(creds, 'creds');
    }

    return {
        state: {
            creds,
            keys: {
                get: (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        let value = read(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }
                    return data;
                },
                set: (data) => {
                    db.transaction(() => {
                        for (const category of Object.keys(data)) {
                            for (const id of Object.keys(data[category])) {
                                const value = data[category][id];
                                const key = `${category}-${id}`;
                                if (value) write(value, key);
                                else remove(key);
                            }
                        }
                    })();
                }
            }
        },
        saveCreds: () => write(creds, 'creds'),
        clear: () => db.prepare(`DELETE FROM auth WHERE session = ?`).run(sessionName)
    };
}

module.exports = { useRedisAuth, useSqliteAuth };