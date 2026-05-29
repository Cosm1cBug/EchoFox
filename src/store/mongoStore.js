const mongoose = require('mongoose');
const { proto } = require('@whiskeysockets/baileys');

function makeMongoStore(uri, logger, groupCache) {
    const conn = mongoose.createConnection(uri);

    const Message = conn.model('Message', new mongoose.Schema({
        jid: String, id: String, from_me: Boolean, participant: String, msg: Buffer, ts: Number
    }).index({ jid: 1, id: 1 }, { unique: true }));

    const Group = conn.model('Group', new mongoose.Schema({
        jid: { type: String, unique: true }, subject: String, creation: Number, meta: Object
    }));

    const Stat = conn.model('Stat', new mongoose.Schema({
        key: { type: String, unique: true }, value: { type: Number, default: 0 }
    }));

    return {
        async getMessage(key) {
            const doc = await Message.findOne({ jid: key.remoteJid, id: key.id });
            return doc ? proto.Message.decode(doc.msg) : undefined;
        },
        async getGroupMetadata(jid) {
            const mem = groupCache.get(jid);
            if (mem) return mem;
            const doc = await Group.findOne({ jid });
            if (!doc) return undefined;
            groupCache.set(jid, doc.meta);
            return doc.meta;
        },
        async saveGroupMetadata(jid, meta) {
            groupCache.set(jid, meta);
            await Group.updateOne({ jid }, { jid, subject: meta.subject, creation: meta.creation, meta }, { upsert: true });
        },
        recordStat(key, inc = 1) {
            Stat.updateOne({ key }, { $inc: { value: inc } }, { upsert: true }).catch(() => {});
        },
        async getStats() {
            try {
                const docs = await Stat.find({});
                return docs.reduce((acc, d) => ({...acc, [d.key]: d.value}), {});
            } catch (e) { return {}; }
        },
        bind(ev) {
            ev.on('messages.upsert', async ({ messages }) => {
                const ops = [];
                for (const m of messages) {
                    if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
                    const msgBuf = Buffer.from(proto.Message.encode(m.message).finish());
                    ops.push({
                        updateOne: {
                            filter: { jid: m.key.remoteJid, id: m.key.id },
                            update: { jid: m.key.remoteJid, id: m.key.id, from_me: !!m.key.fromMe, participant: m.key.participant, msg: msgBuf, ts: Number(m.messageTimestamp) },
                            upsert: true
                        }
                    });
                }
                if (ops.length) Message.bulkWrite(ops).catch(() => {});
            });
            ev.on('groups.upsert', (groups) => {
                for (const g of groups) this.saveGroupMetadata(g.id, g);
            });
        },
        close() { conn.close(); }
    };
}

module.exports = { makeMongoStore };