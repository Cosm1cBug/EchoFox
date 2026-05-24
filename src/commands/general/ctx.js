const { proto, generateWAMessageFromContent, prepareWAMessageMedia } = require("@whiskeysockets/baileys") 
const fs = require('fs');
const { config }  = require('../../config.js');

module.exports = {
    name: 'ctx',
    alias: ['ctest'],
    type: "hide",
    start: async(sock, m, { command, prefix, text }) => {
        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2
                    },
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        contextInfo: {
                            mentionedJid: [m.sender],
                            externalAdReply: {  
                                title: 'BUGGY BOT', 
                                thumbnailUrl: fs.readFileSync("./src/Utils/assets/buggy.jpg"), 
                                mediaType: 1,
                                renderLargerThumbnail: false
                            }
                        }, 
                        body: proto.Message.InteractiveMessage.Body.fromObject({

                            text: `Hello ${m.pushName}\nHow can i help you today?\n\n`
                        }),
                        footer: proto.Message.InteractiveMessage.Footer.fromObject({
                            text: '© 2024 BUGGY | COSMIC BUG'
                        }),
                        header: proto.Message.InteractiveMessage.Header.fromObject({
                            hasMediaAttachment: false
                        }),
                        carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({
                            cards: [
                                {
                                    body: proto.Message.InteractiveMessage.Body.fromObject({
                                        text: '❐ $sticker\n❐ $toimg\n❐ $tovideo'
                                    }),
                                    footer: proto.Message.InteractiveMessage.Footer.fromObject({
                                    }),
                                    header: proto.Message.InteractiveMessage.Header.fromObject({
                                        title: '`Convert Menu`\n',
                                        hasMediaAttachment: true,
                                        ...(await prepareWAMessageMedia({ 
                                            image: fs.readFileSync("./src/Utils/assets/buggy.jpg") 
                                            }, 
                                            { upload: sock.waUploadToServer }
                                        ))
                                    }),
                                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                                        buttons: [
                                        ]   
                                    })
                                },
                                {
                                    body: proto.Message.InteractiveMessage.Body.fromObject({
                                        text: '❐ $ig\n❐ $pinterest\n❐ $spotify\n❐ $ytmp3\n❐ $ytmp4'
                                    }),
                                    footer: proto.Message.InteractiveMessage.Footer.fromObject({
                                    }),
                                    header: proto.Message.InteractiveMessage.Header.fromObject({
                                        title: '`Download Menu`\n',
                                        hasMediaAttachment: true,
                                        ...(await prepareWAMessageMedia({ 
                                            image: fs.readFileSync("./src/Utils/assets/buggy.jpg") 
                                            }, 
                                            { upload: sock.waUploadToServer }
                                        ))
                                    }),
                                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                                        buttons: [
                                        ]   
                                    })
                                }
                            ]
                        })
                    })
                }
            }
        }, {})
        sock.relayMessage(m.from, msg.message, { messageId: m.key.id })
    }
}