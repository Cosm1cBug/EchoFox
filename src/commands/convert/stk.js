const { downloadContentFromMessage, extractMessageContent } = require('@whiskeysockets/baileys')
const { Sticker, createSticker, StickerTypes } = require('wa-sticker-formatter')
const { config } = require("../../config")

module.exports = {
    name: "sticker",
    alias: ["st"],
    use: "<reply>",
    desc: "Convert Image, Video, Gif To Sticker",
    type: "convert",
    example: "\nsticker : %prefix%command --media reply\nPP sticker : %prefix%command @tag\nurl sticker : %prefix%command <url>",
    start: async(sock, m, { command, prefix, text, quoted, mime }) => {
        const media = m?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage ||
        m?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ||
        m?.videoMessage || m.imageMessage

        const sticker = new Sticker(media, {
            pack: config.Exif.packName,
            author: config.Exif.packAuthor,
            type: StickerTypes.FULL,
            id: new Date(),
            quality: 100,
            background: '#000000'
        })
        
        sock.sendMessage(m.from, await sticker.toMessage())

    }
}

