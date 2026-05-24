const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function downloadQuotedMedia(sock, m) {
    // Check if the message has a quoted message
    if (!m.message || !m.message.extendedTextMessage || !m.message.extendedTextMessage.contextInfo) {
        return await sock.sendMessage(m.from, { text: '*Please reply to a media message!*' }, { quoted: m });
    }

    // Extract quoted message
    let quoted = m.message.extendedTextMessage.contextInfo.quotedMessage;

    // Determine media type (image, video, audio, document, sticker, etc.)
    let mediaType = Object.keys(quoted)[0]; // Example: "imageMessage", "videoMessage", etc.

    if (!['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(mediaType)) {
        return await sock.sendMessage(m.from, { text: '*Quoted message is not a media file!*' }, { quoted: m });
    }

    // Extract media content
    let mediaMessage = quoted[mediaType];
    let stream = await downloadContentFromMessage(mediaMessage, mediaType.replace('Message', ''));

    // Convert stream to buffer
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }

    // Define file extension based on media type
    let extension = mediaType.includes('image') ? 'jpg' :
                    mediaType.includes('video') ? 'mp4' :
                    mediaType.includes('audio') ? 'mp3' :
                    mediaType.includes('document') ? mediaMessage.mimetype.split('/')[1] :
                    mediaType.includes('sticker') ? 'webp' : '';

    // Save file
    let fileName = `downloaded_media.${extension}`;
    let filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, buffer);

    // Send back the downloaded file
    let sendOptions = {
        caption: `*Here is your downloaded media*`,
        mimetype: mediaMessage.mimetype,
        fileName: fileName
    };

    if (mediaType.includes('image')) {
        sendOptions.image = buffer;
    } else if (mediaType.includes('video')) {
        sendOptions.video = buffer;
    } else if (mediaType.includes('audio')) {
        sendOptions.audio = buffer;
    } else if (mediaType.includes('document')) {
        sendOptions.document = buffer;
    } else if (mediaType.includes('sticker')) {
        sendOptions.sticker = buffer;
    }

    await sock.sendMessage(m.from, sendOptions, { quoted: m });

    console.log(`Media saved as ${filePath}`);
}

module.exports = {
    name: "dwnlod",
    alias: ["fetchmedia"],
    type: "admin",
    desc: "Downloads media from quoted messages",
    start: async (sock, m) => {
        await downloadQuotedMedia(sock, m);
    }
};
