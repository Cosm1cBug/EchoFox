const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { Sticker } = require('wa-sticker-formatter');

async function getFileBuffer(mediakey, mediaType) {
    const stream = await downloadContentFromMessage(mediakey, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
}


module.exports = {
        name: 'sticker',
        alias: ["s", "stiker"],
        type: 'convert',
        desc: "Make stickers from provided image/video",
        start: async (sock, m) => {
            try {
                const msg = m.message
                const media = msg?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage ||
                    msg?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ||
                    msg?.videoMessage || msg.imageMessage;

                console.log("Mediiaa", media)

                if (!media?.mimetype) {
                    return sock.sendMessage(m.key.remoteJid, {
                        text: `*To create a sticker, upload an image with /sticker in the caption or tag the message containing an image.*`
                    }, { quoted: message });
                }

                if (media.mimetype !== 'image/jpeg') {
                    return;
                }

                try {
                    const imgbuff = await getFileBuffer(media, 'image');

                    const newSticker = new Sticker(imgbuff, {
                        pack: 'Hacxk bot md',
                        author: 'HACXK',
                        type: 'full',
                        background: '#000000',
                        quality: 70
                    });

                    return sock.sendMessage(m.key.remoteJid, {
                        sticker: await newSticker.toBuffer()
                    }, { quoted: m });
                } catch (error) {
                    console.error('Error creating sticker:', error);
                    return sock.sendMessage(m.key.remoteJid, {
                        text: "❌ An error occurred while creating the sticker."
                    }, { quoted: m });
                }
            } catch (error) {
                console.error("Error in sticker command:", error);
                //await sendWithReaction(sock, m.key.remoteJid, "❌", "*An unexpected error occurred. Please try again.*", m);
            }
        }
}