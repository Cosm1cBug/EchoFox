const { Pool } = require('pg');
const { proto } = require('@whiskeysockets/baileys');

function makePostgresStore(url, logger, groupCache) {
    const pool = new Pool({ connectionString: url });
    
    pool.query(`
        CREATE TABLE IF NOT EXISTS messages (jid TEXT, id TEXT, from_me BOOLEAN, participant TEXT, msg BYTEA, ts BIGINT, PRIMARY KEY (jid, id));
        CREATE TABLE IF NOT EXISTS groups (jid TEXT PRIMARY KEY, subject TEXT, creation BIGINT, meta JSONB);
        CREATE TABLE IF NOT EXISTS stats (key TEXT PRIMARY KEY, value BIGINT DEFAULT 0);
    `).catch(e => logger.error({ err: e }, 'Postgres init failed'));

    return {
        async getMessage(key) {
            const res = await pool.query(`SELECT msg FROM messages WHERE jid = $1 AND id = $2`, [key.remoteJid, key.id]);
            if (!res.rows[0]) return undefined;
            return proto.Message.decode(res.rows[0].msg);
        },
        async getGroupMetadata(jid) {
            const mem = groupCache.get(jid);
            if (mem) return mem;
            const res = await pool.query(`SELECT meta FROM groups WHERE jid = $1`, [jid]);
            if (!res.rows[0]) return undefined;
            groupCache.set(jid, res.rows[0].meta);
            return res.rows[0].meta;
        },
        async saveGroupMetadata(jid, meta) {
            groupCache.set(jid, meta);
            await pool.query(`
                INSERT INTO groups (jid, subject, creation, meta) VALUES ($1, $2, $3, $4)
                ON CONFLICT (jid) DO UPDATE SET subject = EXCLUDED.subject, creation = EXCLUDED.creation, meta = EXCLUDED.meta
            `, [jid, meta.subject, meta.creation, meta]);
        },
        recordStat(key, inc = 1) {
            pool.query(`
                INSERT INTO stats (key, value) VALUES ($1, $2)
                ON CONFLICT (key) DO UPDATE SET value = stats.value + EXCLUDED.value
            `, [key, inc]).catch(() => {});
        },
        async getStats() {
            try {
                const res = await pool.query(`SELECT key, value FROM stats`);
                return res.rows.reduce((acc, r) => ({...acc, [r.key]: Number(r.value)}), {});
            } catch (e) { return {}; }
        },
        bind(ev) {
            ev.on('messages.upsert', async ({ messages }) => {
                for (const m of messages) {
                    if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
                    const msgBuf = Buffer.from(proto.Message.encode(m.message).finish());
                    try {
                        await pool.query(`
                            INSERT INTO messages (jid, id, from_me, participant, msg, ts) VALUES ($1, $2, $3, $4, $5, $6)
                            ON CONFLICT (jid, id) DO UPDATE SET msg = EXCLUDED.msg
                        `, [m.key.remoteJid, m.key.id, m.key.fromMe, m.key.participant, msgBuf, Number(m.messageTimestamp)]);
                    } catch(e) {}
                }
            });
            ev.on('groups.upsert', (groups) => {
                for (const g of groups) this.saveGroupMetadata(g.id, g);
            });
        },
        close() { pool.end(); }
    };
}

module.exports = { makePostgresStore };