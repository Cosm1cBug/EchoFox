const Redis = require('ioredis');
const { proto } = require('@whiskeysockets/baileys');

function makeRedisStore(url, logger, groupCache) {
    const client = new Redis(url);

    return {
        async getMessage(key) {
            const buf = await client.getBuffer(`msg:${key.remoteJid}:${key.id}`);
            return buf ? proto.Message.decode(buf) : undefined;
        },
        async getGroupMetadata(jid) {
            const mem = groupCache.get(jid);
            if (mem) return mem;
            const str = await client.get(`group:${jid}`);
            if (!str) return undefined;
            const meta = JSON.parse(str);
            groupCache.set(jid, meta);
            return meta;
        },
        async saveGroupMetadata(jid, meta) {
            groupCache.set(jid, meta);
            await client.set(`group:${jid}`, JSON.stringify(meta));
        },
        recordStat(key, inc = 1) {
            client.incrby(`stat:${key}`, inc).catch(() => {});
        },
        async getStats() {
            try {
                const keys = await client.keys('stat:*');
                const stats = {};
                if (keys.length) {
                    const values = await client.mget(keys);
                    keys.forEach((k, i) => stats[k.split(':')[1]] = Number(values[i]));
                }
                return stats;
            } catch (e) { return {}; }
        },
        bind(ev) {
            ev.on('messages.upsert', async ({ messages }) => {
                const pipeline = client.pipeline();
                for (const m of messages) {
                    if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
                    const msgBuf = Buffer.from(proto.Message.encode(m.message).finish());
                    // Keep recent messages to limit redis memory usage
                    pipeline.set(`msg:${m.key.remoteJid}:${m.key.id}`, msgBuf, 'EX', 604800); 
                }
                pipeline.exec().catch(() => {});
            });
            ev.on('groups.upsert', (groups) => {
                for (const g of groups) this.saveGroupMetadata(g.id, g);
            });
        },
        close() { client.quit(); }
    };
}

module.exports = { makeRedisStore };