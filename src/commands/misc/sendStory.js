const {
  downloadMediaMessage,
  generateWAMessage,
} = require("@whiskeysockets/baileys");
const { config } = require("../../config");
const pino = require("pino");

module.exports = async (sock, m) => {
    try {
      if (m.type !== "extendedTextMessage") return;

      const msg = m.message.extendedTextMessage;
      if (msg?.contextInfo?.remoteJid !== "status@broadcast") return;

      if (!msg.text || msg.text !== "send") return;

      const quotedMsg = msg.contextInfo?.quotedMessage;
      if (!quotedMsg) return;

      if (m.type !== "imageMessage" || m.type !== "videoMessage") return;

      const fakeObj = await generateWAMessage(
        msg.contextInfo?.participant,
        {
          forward: {
            key: {
              id: msg.contextInfo?.stanzaId,
              remoteJid: msg.contextInfo.participant,
            },
            message: quotedMsg || {},
          },
        },
        { logger: pino() }
      );

      const buffer = await downloadMediaMessage(
        fakeObj,
        "buffer",
        {},
        {
          reuploadRequest: sock.updateMediaMessage,
          logger: pino(),
        }
      );

      const mediaMessage = {
        image: type === "imageMessage" ? buffer : undefined,
        video: type === "videoMessage" ? buffer : undefined,
        jpegThumbnail: fakeObj.message[type]?.jpegThumbnail,
      };

      await sock.sendMessage(m.from, mediaMessage);
    } catch (e) {
      sock.sendMessage(config.WApp.ErrLogs, {
        text: `Error sharing story content with your friend.\n\nRequested by: ${m.from}`,
      });
    }
};
