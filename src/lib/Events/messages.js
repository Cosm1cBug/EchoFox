const { config } = require("../../config");
const { proto, jidNormalizedUser, getContentType, extractMessageContent, generateWAMessage, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { correct } = require("../Correct");
const mt = require('moment-timezone');
const fs = require('fs');
const pino = require('pino');
const path = require('path');
const { Function } = require("../Func");

const logMessage = (type, message) => {
    console.log(`\x1b[38;5;201m[ ${type} ] 👽 [ ${mt(new Date()).format('DD/MM/YYYY hh:mm:ss')} ]\x1b[0m`);
    console.log(`\x1b[38;5;117m${message}\x1b[0m`);
    console.log('\x1b[38;5;201m----------------------------------------\x1b[0m');
};

module.exports = async function(chat, sock, commands) {
    if (!chat || !chat.messages || chat.messages.length === 0) return;

    const m = chat.messages[0];
    if (m.key.fromMe) return; // Skip if the message is from the bot itself

    const { from, sender, isGroup, isPrivate } = handleMessageMetadata(m, sock);
    const body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    const isCmd = body.startsWith('$');
    const prefix = '$';
    const args = body.trim().split(/ +/).slice(1);
    const cmdName = body.replace(prefix, '').trim().split(/ +/).shift().toLowerCase();

    const cmd = commands.get(cmdName) || Array.from(commands.values()).find((v) => v?.alias?.includes(cmdName));

    // Handling Read Messages
    if (config.options.ReadMessages) {
        await sock.readMessages([m.key]);
    }

    // Handle Status Update
    if (config.options.ReadStatus && m.chat.endsWith('status@broadcast')) {
        await handleStatusUpdate(m, sock);
    }

    // Handle 'Buggy' message
    if (m.message.conversation === 'Buggy') {
        await sendBuggyInfo(m, sock);
    }

    // Handle command not found
    if (isCmd && !cmd) {
        await handleUnknownCommand(cmdName, commands, m, sock);
    }

    // If -h flag is present, show help message
    if (args.includes('-h') && cmd) {
        await sendHelpMessage(cmd, m, sock);
    }

    // Handle the command execution
    if (isCmd && cmd) {
        try {
            await executeCommand(cmd, sock, m, { body, args, cmdName, prefix });
        } catch (error) {
            console.error(error);
        }
    }

    // Log the incoming message
    logMessage(isGroup ? 'GROUP CHAT' : 'PRIVATE CHAT', `From: ${m.pushName}\nMessageType: ${getContentType(m.message)}\nMessage: ${body}`);

    return m;
};

// Handle message metadata
function handleMessageMetadata(m, sock) {
    m.id = m.key.id;
    m.chat = m.key.remoteJid;
    m.from = jidNormalizedUser(m.key.remoteJid || m.key.participant);
    m.isPrivate = m.from.endsWith("@s.whatsapp.net");
    m.isGroup = m.from.endsWith("@g.us");
    m.sender = sock.decodeJid(m.from || m.key.participant || m.from || "");
    return { from: m.from, sender: m.sender, isGroup: m.isGroup, isPrivate: m.isPrivate };
}

// Handle Status Update
async function handleStatusUpdate(m, sock) {
    await sock.readMessages([m.key]);
    await sock.sendMessage(m.key.remoteJid, {
        react: {
            key: m.key,
            text: '💚',
        },
    });
}

// Send Buggy info when received message is "Buggy"
async function sendBuggyInfo(m, sock) {
    await sock.sendMessage(m.from, {
        text: `*BUGGY* – Your Smart WhatsApp Assistant.\n\nMeet Buggy, an intuitive and evolving WhatsApp bot designed to simplify your experience. Currently in beta, Buggy is continuously improving to offer smarter automation, quick responses, and seamless assistance.\n\nKey Features:\n✅ Effortless Commands:– Just type $menu to explore features.\n✅ Instant Help:– Use -h with any command (e.g., $command -h) for guidance.\n✅ Always Evolving:– More features coming soon to enhance your experience.\n\nEnjoy a seamless WhatsApp experience with Buggy. Stay tuned for updates!\n\n© 2025 Team EchoFox`,
        contextInfo: {
            externalAdReply: {
                showAdAttribution: false,
                renderLargerThumbnail: true,
                title: `🔰ＢＵＧＧＹ ｖ5.0.1`,
                body: `Made with 💖 by COSMICBUG`,
                previewType: 0,
                mediaType: 1,
                thumbnail: fs.readFileSync("./src/Utils/assets/buggy.jpg"),
                mediaUrl: ``,
            },
        },
    });
}

// Handle Unknown Command
async function handleUnknownCommand(cmdName, commands, m, sock) {
    const availableCommands = Array.from(commands.keys()).concat(commands.values().flatMap(cmd => cmd.alias || []));
    const correctedCmd = correct(cmdName, availableCommands);
    const alias = commands.get(correctedCmd.result) || Array.from(commands.values()).find(v => v.alias?.includes(correctedCmd.result));

    let aliasText = alias?.alias.join(", ") || "N/A";
    const q1 = `Command Not Found!`;
    const q2 = `Did you mean?\n\n*Command :* ${'$' + correctedCmd.result}\n*Alias :* ${aliasText}`;

    await sock.sendMessage(m.from, { text: q1 }, { quoted: m });
    await sock.sendMessage(m.from, { text: q2 });
}

// Send Help message for command
async function sendHelpMessage(cmd, m, sock) {
    const helpMsg = `Command: .${cmd.name}\nDescription: ${cmd.desc}`;
    await sock.sendMessage(m.from, { text: helpMsg });
}

// Execute the command
async function executeCommand(cmd, sock, m, { body, args, cmdName, prefix }) {
    const { from, isPrivate, isGroup, sender } = handleMessageMetadata(m, sock);
    const metadata = m.isGroup ? await sock.groupMetadata(m.key.remoteJid).catch(() => {}) : '';

    await cmd.start(sock, m, {
        name: 'BUGGY',
        metadata,
        pushName: m.pushName || 'Unknown User',
        isPrivate,
        isGroup,
        body,
        args,
        prefix,
        command: cmd.name,
        commands,
        Function,
        toUpper: (query) => query.replace(/^\w/, c => c.toUpperCase()),
    });
}
