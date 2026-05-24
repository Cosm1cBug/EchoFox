const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const fs = require('fs');

module.exports = {
    name: "antiViewOnce",
    alias: ["vv","avv"],
    type: "hide",
    start: async(sock, m, { commands, args = [], prefix, text, toUpper }) => {
        if (m.mtype && m.msg && m.msg.hasOwnProperty("viewOnce")) {
            console.log('viewOnce Message Detected!')
            try {
                const type = m.msg.mimetype.split("/")[0],
                    media = await downloadContentFromMessage(m.msg, type);
                let buffer = Buffer.from([]);
                for await (const chunk of media) buffer = Buffer.concat([buffer, chunk]);
                const fileSize = formatFileSize(m.msg.fileLength),
                    timestamp = getTimestamp(m.msg.mediaKeyTimestamp),
                    description = `*Anti-ViewOnce*\n*Media Type:* ${"image" === type ? 
                        "Image" : "video" === type ? 
                        "Video" : "audio" === type ? 
                        "Audio" : "Unknown"}\n*Caption:* ${m.msg.caption || "N/A"}\n*Size:* ${fileSize}\n*Timestamp:* ${timestamp}\n*Sender:* @${m.from}`;
                /image|video|audio/.test(type) && (await sock.sendFile(m.chat, buffer, type, description || type, m, !1, {
                    mentions: [m.sender]
                })),    
                console.log(`[📷 View Once ${type}] Detected)`)
            } catch (error) {
                console.error("Error processing media:", error);
            }
        }
        else {
            console.log('Not a viewOnceMsg')
        }
    }
}
  
function formatFileSize(bytes) {
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + " " + ["Bytes", "KB", "MB", "GB", "TB", "PB", "TY", "EY"][i];
}
  
function getTimestamp(timestamp) {
    return new Date(1e3 * timestamp).toLocaleString("en-US", {
        timeZone: "Asia/Kolkata"
    });
}