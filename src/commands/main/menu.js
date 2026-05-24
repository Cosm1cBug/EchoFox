const fs = require('fs').promises;
const { config } = require('../../config');
const {
    proto,
    generateWAMessageFromContent,
    prepareWAMessageMedia
} = require('@whiskeysockets/baileys');

const thumbImg = "./src/Utils/assets/buggy.jpg";
let thumbImgBuffer = null;

// Preload the image once to reduce file read operations
fs.readFile(thumbImg)
    .then(buffer => thumbImgBuffer = buffer)
    .catch(err => console.error("Error reading thumbnail image:", err));

module.exports = {
    name: "menu",
    alias: ["listmenu"],
    desc: 'Shows all the available features.',
    type: "hide",
    start: async (sock, m, { commands, prefix, toUpper }) => {
        const isAdmin = config.options.BAdmin.includes(m.sender);
        const groupedCommands = {};

        // Cache sender ID without domain part
        const senderID = m.sender.replace(/@.+/g, '');

        // Filter & Group Commands
        for (const command of commands.values()) {
            if (!command.type || command.type === "hide") continue; // Exclude hidden & no-type commands
            if (!isAdmin && command.type === "admin") continue; // Exclude admin commands for normal users

            (groupedCommands[command.type] ||= []).push(command);
        }

        // Prepare Media Once
        const mediaMessage = thumbImgBuffer
            ? await prepareWAMessageMedia({ image: thumbImgBuffer }, { upload: sock.waUploadToServer })
            : null;

        if (m.isPrivate) {
            const cards = [];
            for (const type of Object.keys(groupedCommands)) {
                const commandsText = groupedCommands[type]
                    .map(cmd => `> ${prefix}${cmd.name} ${cmd.usage || ''}`)
                    .join('\n');

                cards.push({
                    body: proto.Message.InteractiveMessage.Body.fromObject({ text: commandsText }),
                    footer: proto.Message.InteractiveMessage.Footer.fromObject({}),
                    header: proto.Message.InteractiveMessage.Header.fromObject({
                        title: `</> ${toUpper(type)} </>\n`,
                        hasMediaAttachment: !!mediaMessage,
                        ...mediaMessage
                    }),
                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                        buttons: [{
                            name: "cta_url",
                            buttonParamsJson: {
                                "display_text": `More ${toUpper(type)} Commands`,
                                "url": "https://wa.me/919746824845",
                                "merchant_url": "https://wa.me/919746824845"
                            }
                        }]
                    })
                });
            }

            const msg = generateWAMessageFromContent(m.chat, {
                viewOnceMessage: {
                    message: {
                        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                        interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                            contextInfo: { mentionedJid: [m.sender], externalAdReply: { showAdAttribution: false } },
                            body: proto.Message.InteractiveMessage.Body.fromObject({
                                text: `Hello, @${senderID}\n\nPlease find the features listed by category!`
                            }),
                            footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: '© 2025 Team EchoFox' }),
                            carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({ cards })
                        })
                    }
                }
            }, {});

            return await sock.relayMessage(msg.key.remoteJid, msg.message, { messageId: msg.key.id });
        }

        if (m.isGroup) {
            let txt = `Hello, @${senderID}\n\nPlease find the features listed by category!\n\n`;

            for (const type of Object.keys(groupedCommands)) {
                txt += `✗ ${toUpper(type)} Menu\n\n`;
                txt += groupedCommands[type]
                    .map(cmd => `❐ ${prefix}${cmd.name} ${cmd.usage ? " " + cmd.usage : ""}`)
                    .join("\n") + "\n\n";
            }

            txt += `> © 2025 Team EchoFox`;

            return await sock.sendMessage(m.from, {
                text: txt,
                contextInfo: {
                    mentionedJid: [m.sender],
                    externalAdReply: {
                        showAdAttribution: false,
                        renderLargerThumbnail: true,
                        title: `🔰ＢＵＧＧＹ ｖ5.0.1`,
                        body: `Made with 💖 by COSMICBUG`,
                        previewType: 0,
                        mediaType: 1,
                        thumbnail: thumbImgBuffer
                    }
                }
            });
        }
    },
    noLimit: true,
};
