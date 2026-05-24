const fs = require('fs');
const axios = require('axios');
const path = require('path');

module.exports = {
    name: "mediafire",
    alias: ["mfdl"],
    usage: "<MediaFire URL>",
    type: "download",
    desc: "Download a file from MediaFire",
    start: async (sock, m, { text }) => {
        if (!text || !text.includes("mediafire.com")) {
            return await sock.sendMessage(m.from, { text: '*Please provide a valid MediaFire link!*' });
        }
        await sendMediafireFile(sock, m, text);
    }
};

async function getMediafireFile(url) {
    try {
        let response = await axios.get(`http://api.vreden.my.id/api/mediafiredl?url=${encodeURIComponent(url)}`);
        
        if (response.data.status !== 200 || !response.data.result.length) {
            throw new Error("Invalid response or no file found.");
        }

        let fileData = response.data.result[0]; // Extract first result

        let fileName = fileData.nama;
        let mimeType = fileData.mime;
        let fileSize = fileData.size; // Readable size (e.g., "13.35MB")
        let fileSizeBytes = fileData.sizeB; // Size in bytes (e.g., 13350)
        let downloadLink = fileData.link;

        return { fileName, mimeType, fileSize, fileSizeBytes, downloadLink };
    } catch (error) {
        console.error("Error fetching file:", error);
        return null;
    }
}

async function sendMediafireFile(sock, m, mediafireUrl) {
    let fileDetails = await getMediafireFile(mediafireUrl);

    if (!fileDetails) {
        return await sock.sendMessage(m.from, { text: '*Failed to fetch file details!*' });
    }

    let { fileName, mimeType, fileSizeBytes, downloadLink } = fileDetails;

    await sock.sendMessage(m.from, { text: `*Downloading:* ${fileName}\n*Size:* ${fileSize}` });

    try {
        let response = await axios.get(downloadLink, { responseType: 'arraybuffer' });
        let buffer = Buffer.from(response.data);
        let filePath = path.join(__dirname, fileName);

        fs.writeFileSync(filePath, buffer); // Save file locally before sending

        // Determine if the file is audio or should be sent as a document
        let isAudio = mimeType.startsWith("audio/") || fileName.endsWith(".mp3") || fileName.endsWith(".m4a") || fileName.endsWith(".wav");

        if (isAudio) {
            await sock.sendMessage(m.from, {
                audio: buffer,
                mimetype: mimeType || 'audio/mpeg',
                fileName: fileName,
                fileLength: fileSizeBytes,
                caption: `🎵 *Audio File:*\n📂 ${fileName}\n📏 ${fileSizeBytes} bytes`,
            }, { quoted: m });
        } else {
            await sock.sendMessage(m.from, {
                document: buffer,
                mimetype: mimeType || 'application/octet-stream',
                fileName: fileName,
                fileLength: fileSizeBytes,
                caption: `📄 *File Downloaded:*\n📂 ${fileName}\n📏 ${fileSizeBytes} bytes`,
            }, { quoted: m });
        }

        fs.unlinkSync(filePath); // Delete file after sending

    } catch (error) {
        console.error("Error downloading file:", error);
        return await sock.sendMessage(m.from, { text: '*Error downloading the file!*' });
    }
};