const { config } = require("../../config")
const { proto, jidNormalizedUser, getContentType, getDevice, protocolMessage, extractMessageContent, generateWAMessage, downloadMediaMessage } = require('@whiskeysockets/baileys')
const { correct } = require("../Correct")
const mt = require('moment-timezone')
const fs = require('fs')
const pino = require('pino');
const util = require('util'); // If you want to inspect complex objects
const path = require('path')
const { Function } = require("../Func")
const { trackCommandUsage } = require("../Functions/sqliteDB");
const statsFile = path.join(__dirname, "../../store/stats.json");

function loadStats() {
    if (!fs.existsSync(statsFile)) {
        fs.writeFileSync(statsFile, JSON.stringify({}, null, 2));
    }
    return JSON.parse(fs.readFileSync(statsFile));
}

function saveStats(stats) {
    try {
        fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
    } catch (err) {
        console.error("Error saving stats:", err);
    }
}

module.exports = async function(chat, sock, commands) {
    if (chat && chat.messages && chat.messages.length > 0) {
        const m = chat.messages?.[0];
        //console.log(m);
        if (m.key.fromMe) return
        if (!m.message) return 

        let stats = loadStats();

        if (m.key) {
            m.id = m.key.id;
            m.chat = m.key.remoteJid;
            m.from = jidNormalizedUser(m.key.remoteJid || m.key.participant);
            m.me = sock.user.id.includes(':') ? sock.user.id.split(':')[0]+'@s.whatsapp.net' : sock.user.id;
            m.fromMe = m.key.fromMe;
            m.isPrivate = m.from.endsWith("@s.whatsapp.net");
            m.isGroup = m.from.endsWith("@g.us");
            m.sender = sock.decodeJid((m.fromMe && sock.user.id) || m.participant || m.key.participant || m.from || "");
        }
        if (m.message) {
            m.type = getContentType(m.message);
            m.message = extractMessageContent(m.message);
            m.text = (m.type === 'conversation') ? m.message.conversation : (m.type == 'imageMessage') ? m.message.imageMessage.caption : (m.type == 'videoMessage') ? m.message.videoMessage.caption : (m.type == 'extendedTextMessage') ? m.message.extendedTextMessage.text : (m.type == 'buttonsResponseMessage') ? m.message.buttonsResponseMessage.selectedButtonId : (m.type == 'listResponseMessage') ? m.message.listResponseMessage.singleSelectReply.selectedRowId : (m.type == 'templateButtonReplyMessage') ? m.message.templateButtonReplyMessage.selectedId : (m.type === 'messageContextInfo') ? (m.message.buttonsResponseMessage?.selectedButtonId || m.message.listResponseMessage?.singleSelectReply.selectedRowId || m.msg) : ''
            m.msg = (m.mtype == 'viewOnceMessage' ? m.message[m.type].message[getContentType(m.message[m.type].message)] : m.message[m.type]);
            m.mentions = m.msg?.contextInfo ? m.msg?.contextInfo.mentionedJid : [];
            m.quoted = m.msg?.contextInfo ? m.msg?.contextInfo.quotedMessage : null;
            m.replied = m.msg?.contextInfo ? m.msg.contextInfo.quotedMessage : false;
        }
        if (m.quoted) {
            m.quoted.type = getContentType(m.quoted);
            m.quoted.msg = m.quoted[m.quoted.type];
            m.quoted.mentions = m.msg.contextInfo.mentionedJid;
            m.quoted.id = m.msg.contextInfo.stanzaId;
            m.quoted.sender = jidNormalizedUser(m.msg.contextInfo.participant || m.sender);
            m.quoted.from = m.from;
            m.quoted.isGroup = m.quoted.from.endsWith("@g.us");
            m.quoted.fromMe = m.quoted.sender == jidNormalizedUser(sock.user && sock.user?.id);
            m.quoted.text = m.quoted.msg?.text || m.quoted.msg?.caption || m.quoted.msg?.conversation || m.quoted.msg?.contentText || m.quoted.msg?.selectedDisplayText || m.quoted.msg?.title || "";
        }
        if (m.replied) {
            m.replied.id = m.msg.contextInfo.stanzaId || false
            m.replied.chat = m.msg.contextInfo.remoteJid || m.chat
            m.replied.sender = m.replied.from = m.msg.contextInfo.participant || false
            m.replied.mentions = m.msg.contextInfo ? m.msg.contextInfo.mentionedJid : []
            m.replied.fromMe = m.replied.me = m.replied.sender === m.me
            m.replied.mtype = getContentType(m.replied)
            m.replied.text = m.replied.text || m.replied.caption || m.replied.conversation || m.replied.contentText || m.replied.selectedDisplayText || m.replied.title || false
            m.replied.image = m.replied.imageMessage || false
            m.replied.video = m.replied.videoMessage || false
            m.replied.audio = m.replied.audioMessage || false
            m.replied.sticker = m.replied.stickerMessage || false
            m.replied.document = m.replied.documentMessage || false
        }
        m.reply = (text, chatId = m.from, options = {}) => Buffer.isBuffer(text) ? sock.sendFile(chatId, text, 'file', '', m, { ...options }) : sock.sendText(chatId, text, m, { ...options })

        let body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';

        let budy = m.message && m.message.conversation ? m.message.conversation :
                     m.message && m.message.extendedTextMessage ? m.message.extendedTextMessage.text :
                     m.message && m.message.buttonsResponseMessage ? m.message.buttonsResponseMessage.selectedButtonId :
                     m.message && m.message.listResponseMessage ? m.message.listResponseMessage.singleSelectReply.selectedRowId :
                     m.message && m.message.templateButtonreplyMessage ? m.message.templateButtonreplyMessage.selectedId :
                     m.message && m.message.ephemeralMessage ? m.message.ephemeralMessage.message :
                     m.message && m.message.imageMessage ? m.message.imageMessage.caption || '[No caption available]' :
                     m.message && m.message.videoMessage ? m.message.videoMessage.caption || '[No caption available]' :
                     m.message && m.message.reactionMessage ? m.message.reactionMessage.text || 'Reaction Removed!':
                     m.message && m.message.stickerMessage ?  '[Sticker]' :
                     m.message && m.message.imageMessage ?  '[Image]' :
                     m.message && m.message.audioMessage ?  '[Audio]' :
                     m.message && m.message.videoMessage ?  '[Video]' :
                     m.message && m.message.documentMessage ?  '[Document]' :
                     m.message && m.message.contactMessage ?  '[Contact]' :
                     m.message && m.message.locationMessage ? '[Location]' :
                     m.message && m.message.liveLocationMessage ? '[Live Location]' :
                     m.message && m.message.productMessage ?  '[Product Msg]' :
                     m.message && m.message.shoppingMessage ?  '[Shopping Msg]' :
                    '[Unknown Message Type]';
        //console.log(typeof body); // Should log "string"
        if (typeof budy === 'object') {
            budy = JSON.stringify(budy);  // Convert objects/arrays to a JSON string
        }

        if (!stats[m.sender]) {
            stats[m.sender] = {
                totalMessages: 0,
                textMessages: 0,
                imageMessages: 0,
                videoMessages: 0,
                audioMessages: 0,
                documentMessages: 0,
                stickerMessages: 0,
                contactMessages: 0,
                locationMessages: 0,
                commandUsage: {}
            };
        }

        stats[m.sender].totalMessages++;

        switch (m.type) {
            case 'conversation':
            case 'extendedTextMessage':
                stats[m.sender].textMessages++;
            break;
            case 'imageMessage':
                stats[m.sender].imageMessages++;
            break;
            case 'videoMessage':
                stats[m.sender].videoMessages++;
            break;
            case 'audioMessage':
                stats[m.sender].audioMessages++;
            break;
            case 'documentMessage':
                stats[m.sender].documentMessages++;
            break;
            case 'stickerMessage':
                stats[m.sender].stickerMessages++;
            break;
            case 'contactMessage':
                stats[m.sender].reactionMessages++;
            break;
            case 'locationMessage':
                stats[m.sender].locationMessages++;
            break;
        }

        saveStats(stats);

        let metadata = m.isGroup ? await sock.groupMetadata(m.key.remoteJid).catch(() => {}) : '';
        let participants = m.isGroup ? metadata?.participant || [m.key.participant] : '';
        let groupAdmin = m.isGroup ? (participants || []).filter(v => v.admin !== null).map(v => v.id) : [];
        let deviceID = await getDevice(m.key.id)
        let pushName =  m.pushName || 'Unknown User'
        Jid = m.key.remoteJid;
        const isPrivate = m.from.endsWith("@s.whatsapp.net");
        const isGroup = m.from.endsWith("@g.us");
        const prefix =  /^[$]/gi.test(body) ? body.match(/^[$]/gi)[0] : '.'  
        let isCmd = (typeof body === 'string' && body.startsWith(prefix)) ? true : false; //let isCmd = body.startsWith(prefix)
        const cTime = mt(new Date()).format('DD/MM/YYYY hh:mm:ss')
        let args = (body == null ? '' : String(body)).trim().split(/ +/).slice(1); //let args = body.trim().split(/ +/).slice(1)
        let arg = args.map((v) => v.toLowerCase())
        let text = arg.join(" ")
        let cmdName = body.replace(prefix, '').trim().split(/ +/).shift().toLowerCase()
        const cmd = commands.get(cmdName) || Array.from(commands.values()).find((v) => v?.alias?.find((x) => x.toLowerCase() == cmdName)) || "" 

        // ReadMessages
        if (config.options.ReadMessages) { 
            await sock.readMessages([m.key]);
        }

        // ReadStatusUpdates
        if (config.options.ReadStatus && m.chat.endsWith('status@broadcast')) { //Add separate parameter for react story.
            await sock.readMessages([m.key]);
            await sock.sendMessage(m.key.remoteJid, { 
                react: { 
                    key: m.key, 
                    text: '💚'   //Add this to config.js
                }
            }, 
            { 
                statusJidList: [
                    m.key.participant, 
                    sock.user.id
                ] 
            });
        }
        
        // If msg is Buggy sends this reply
        if (m.message.conversation == 'Buggy') {
            await sock.sendMessage(m.from, { 
                text: `*BUGGY* – Your Smart WhatsApp Assistant.\n\nMeet Buggy, an intuitive and evolving WhatsApp bot designed to simplify your experience. Currently in beta, Buggy is continuously improving to offer smarter automation, quick responses, and seamless assistance.\n\nKey Features:\n✅ Effortless Commands:– Just type $menu to explore features.\n✅ Instant Help:– Use -h with any command (e.g., $command -h) for guidance.\n✅ Always Evolving:– More features coming soon to enhance your experience.\n\nEnjoy a seamless WhatsApp experience with Buggy. Stay tuned for updates!\n\n© 2025 Team EchoFox`,
                contextInfo: {
                    externalAdReply: {
                        showAdAttribution: false,
                        renderLargerThumbnail: true,
                        title: `🔰ＢＵＧＧＹ ｖ5.0.1`,
                        body: `Made with 💖 by COSMICBUG`,
                        previewType: 0,
                        mediaType: 1, // 0 for none, 1 for image, 2 for video
                        thumbnail: fs.readFileSync("./src/Utils/assets/buggy.jpg"),
                        mediaUrl: ``,
                    },
                }
            }); 
        }

        if (cmdName === 'stats') {
            const userStats = stats[m.sender] || { totalMessages: 0 };

            let message = `📊 *User Stats*\n`;
                message += `👤 *User:* ${pushName}\n`;
                message += `💬 *Total Messages:* ${userStats.totalMessages}\n`;
                message += `📝 *Text Messages:* ${userStats.textMessages || 0}\n`;
                message += `🖼️ *Image Messages:* ${userStats.imageMessages || 0}\n`;
                message += `🎥 *Video Messages:* ${userStats.videoMessages || 0}\n`;
                message += `🎵 *Audio Messages:* ${userStats.audioMessages || 0}\n`;
                message += `📄 *Document Messages:* ${userStats.documentMessages || 0}\n`;
                message += `📍 *Location Messages:* ${userStats.locationMessages || 0}\n`;
                message += `🧩 *Sticker Messages:* ${userStats.stickerMessages || 0}\n\n`;

            if (userStats.commandUsage) {
                message += `⚡ *Top Commands Used:*\n`;
                Object.entries(userStats.commandUsage).forEach(([cmd, count]) => {
                    message += `- ${cmd}: ${count} times\n`;
                });
            }

            await sock.sendMessage(m.from, { text: message }, { quoted: m });
        }

        // 📌 Handle $leaderboard Command
        if (cmdName === 'leaderboard') {
            const sortedUsers = Object.entries(stats)
                .sort(([, a], [, b]) => (b.totalMessages || 0) - (a.totalMessages || 0))
                .slice(0, 10); // Top 10 users
        
            let leaderboard = "🏆 *Top 10 Users by Messages Sent* 🏆\n\n";
                sortedUsers.forEach(([jid, data], index) => {
                    leaderboard += `${index + 1}. ${jid.replace("@s.whatsapp.net", "")} → ${data.totalMessages} messages\n`;
                });
        
                await sock.sendMessage(m.from, { text: leaderboard }, { quoted: m });
        }

        const mtype = getContentType(m.message)
        if (mtype === "extendedTextMessage") {
            const msg = m.message.extendedTextMessage
            if (msg?.contextInfo?.remoteJid === "status@broadcast") {
                if (msg.text) {
                    switch (msg.text) {
                        case "send":
                        try {
                            if (!msg.contextInfo?.quotedMessage?.extendedTextMessage?.text) {
                                const type = getContentType(msg.contextInfo?.quotedMessage)
                                if (type === "imageMessage") {
                                    const fakeObj = await generateWAMessage(m.quoted.sender, {
                                        forward: {
                                            key: {
                                                id: m.quoted.id,
                                                remoteJid: m.quoted.sender
                                            },
                                            message: m.message.extendedTextMessage.contextInfo.quotedMessage || {}
                                        }
                                    }, { logger: pino() })
                                const buffer = await downloadMediaMessage(fakeObj, "buffer", {}, { reuploadRequest: sock.updateMediaMessage, logger: pino() })
                                // change the fakeObj jid
                                fakeObj.key.remoteJid = "status@broadcast"
                                await sock.sendMessage(m.from, { image: buffer, jpegThumbnail: fakeObj.message.imageMessage.jpegThumbnail, mimetype: "image/png", caption: m.quoted.text || ''}, { quoted: fakeObj })
                                await sock.sendMessage(config.WApp.BotLogs, { text: `Story Image has been sent to user: ${m.from}` }) //Need to change it to pushName
                                console.log('Sent story image to user!');
                            }
                            else if (type === "videoMessage") { //Sends video from story to user.
                                const fakeObj = await generateWAMessage(msg?.contextInfo?.participant, {
                                    forward: {
                                        key: {
                                            id: msg?.contextInfo?.stanzaId,
                                            remoteJid: msg?.contextInfo?.participant
                                        },
                                        message: msg?.contextInfo?.quotedMessage || {}
                                    }
                                    }, { logger: pino() })
                                    const buffer = await downloadMediaMessage(fakeObj, "buffer", {}, { reuploadRequest: sock.updateMediaMessage, logger: pino() })
                                    await sock.sendMessage(m.from, { video: buffer, jpegThumbnail: fakeObj.message.videoMessage.jpegThumbnail, caption: m.quoted.text || '' })
                                    await sock.sendMessage(config.WApp.BotLogs, { text: `Story Video has been sent to user: ${m.key.remoteJid}` }) //Need to change it to pushName
                                    console.log('Sent story video to user!');
                                }
                            }
                        }
                        catch (e) {
                            console.log(e)
                        }
                        break;
                    }
                } else {
                    sock.sendMessage(config.options.BotLogs, { text: `Error occured while sending story Image/Video to user: ${m.key.remoteJid}` })
                }
            }
        }

        if (isCmd) {
            if (!stats[m.sender].commandUsage[cmdName]) {
                stats[m.sender].commandUsage[cmdName] = 0;
            }
            stats[m.sender].commandUsage[cmdName]++;
            saveStats(stats);
        }


        
        // Notify if someone tagged you in groups!
        //let type = getContentType(m.message);
        let mentions = m?.message[m.type]?.contextInfo?.mentionedJid || [];

        if (mentions.includes(jidNormalizedUser(sock.user.id))) {
            console.log('Got Tagged');
            sock.sendMessage(config.WApp.BotLogs, { text: `You've been tagged!` })
        }
        if (m.isPrivate && !isCmd) {
            console.log('\x1b[38;5;201m',`[ BUGGY ] 👽 [ ${cTime} ] - PRIVATE CHAT\n`,'\x1b[0m');
            console.log('\x1b[38;5;117m',`From: ${m.pushName}`,'\x1b[0m');
            console.log('\x1b[38;5;117m',`User ID: ${m.key.remoteJid}`,'\x1b[0m');
            console.log('\x1b[38;5;117m',`MessageType: ${m.type}`,'\x1b[0m');
            console.log('\x1b[38;5;201m','----------------------------------------','\x1b[0m');
        }
        if (m.isGroup && !isCmd) {
            console.log('\x1b[38;5;201m',`[ BUGGY ] 👽 [ ${cTime} ] - GROUP CHAT\n`, '\x1b[0m');
            console.log('\x1b[38;5;117m',`From: ${m.pushName}`, '\x1b[0m');
            console.log('\x1b[38;5;117m',`User ID: ${m.key.participant}`, '\x1b[0m');
            console.log('\x1b[38;5;117m',`Group ID: ${m.key.remoteJid}`, '\x1b[0m');
            console.log('\x1b[38;5;117m',`MessageType: ${m.type}`, '\x1b[0m');
            console.log('\x1b[38;5;201m','----------------------------------------','\x1b[0m');
        }
        if (isCmd) {
            const cType = m.isGroup ? 'GROUP CHAT' : 'PRIVATE CHAT';
            const jid = m.isGroup ? m.key.participant : m.key.remoteJid;
            console.log('\x1b[38;5;198m',`[ BUGGY ] 👽 [ ${cTime} ] - COMMAND\n`,'\x1b[0m');
            console.log('\x1b[38;5;117m',`From: ${m.pushName}`,'\x1b[0m');
            console.log('\x1b[38;5;117m',`User ID: ${jid}`,'\x1b[0m');
            console.log('\x1b[38;5;117m',`IN: ${cType}`,'\x1b[0m');
            console.log('\x1b[38;5;117m',`Command: ${cmdName}`,'\x1b[0m');
            console.log('\x1b[38;5;201m','----------------------------------------','\x1b[0m');
        }
        if (m.message && m.message.locationMessage) {
            // Let's say the user sent their location!
            console.log('Location Shared');
            sock.sendMessage(config.WApp.BotLogs, {
                text: `Location Shared by: ${m.pushName} -\n\`\`\`${util.inspect(m.message.locationMessage)}\`\`\``,
            });
        }
        if (protocolMessage && protocolMessage.editedMessage) {
            const editedMessageText = protocolMessage.editedMessage.conversation;
            const editorJid = m.key.participant || m.key.remoteJid;
            console.log('\x1b[1m\x1b[35m%s\x1b[0m', `\n[ BUGGY ] 👽 [ ${cTime} ] - ✏️ Edited Message\n\n👤 Editor: \x1b[38;5;117m${editorJid}\x1b[0m\n📝 New Message: ${editedMessageText}`);
        }
        if (isCmd && !cmd) {
            var array = Array.from(commands.keys());
            // Safely map aliases, filtering out commands without aliases
            Array.from(commands.values())
                .filter(v => v.alias) // Ensure v.alias is defined
                .map(v => v.alias)
                .join(" ")
                .replace(/ +/gi, ",")
                .split(",")
                .forEach(v => array.push(v));
            
            var anu = correct(cmdName, array);
            var alias = commands.get(anu.result) || Array.from(commands.values()).find(v => (v.alias || []).find(x => x.toLowerCase() === anu.result)) || "";
        
            // Check if alias is found and handles it properly
            let aliasText = Array.isArray(alias?.alias) ? alias.alias.join(", ") : "N/A";
            //let aliasText = alias ? alias.alias.join(", ") : "N/A";
            let q1 = `Command Not Found!`;
            let q2 = `Did you mean?\n\n*Command :* ${prefix + anu.result}\n*Alias :* ${aliasText}`;
            sock.sendMessage(m.from, {text: q1}, {quoted: m})
            await sock.sendMessage(m.from, {text: q2})
            
        } else if (!cmd) {
            return;
        }
        
        if (arg.includes('-h')) {
            const helpMsg = `Command: .${cmdName}\nDescription: ${cmd.desc}`
            await sock.sendMessage(m.from, {text: helpMsg})
        }

        if (isCmd && cmd) {
            trackCommandUsage(m.sender, cmdName);
            try {
                cmd.start(sock, m, {
                    name: 'BUGGY',
                    metadata,
                    pushName,
                    isPrivate,
                    isGroup,
                    //participants,
                    body,
                    arg,
                    args,
                    text,
                    prefix,
                    command: cmd.name,
                    commands,
                    Function: Function,
                    toUpper: function toUpper(query) {
                        return query.replace(/^\w/, c => c.toUpperCase())
                    }
                })
            } catch (e) {
                console.error(e);
            }
        }
        // Save this as an outgoing message.
        return m;
    }

}

const file = require.resolve(__filename);
const fileName = path.basename(__filename);
fs.watchFile(file, () => {
	fs.unwatchFile(file);
	console.log((`updated: ${fileName}`));
	delete require.cache[file];
	require(file);
})