const axios = require('axios');
const fs = require('fs');
const path = require('path');

module.exports = {
    name: "apk",
    alias: ['apkdl'],
    usage: '<App Name>',
    desc: 'Search and download APKs from Aptoide.',
    type: 'download',
    start: async (sock, m, {args, text}) => {
        try {
            // Ensure an app name is provided
            const appName = args.length ? args.join(' ') : text; // Use args if available, otherwise fallback to text

            if (!appName) {
                await sock.sendMessage(m.from, { text: 'Please provide an app name to search.' }, { quoted: m });
                return;
            }

            // API Key and URL for fetching APK details
            const apiKey = '582fc39fae4c5e14ae';
            const apiUrl = `https://api.maher-zubair.xyz/downloader/apk?apikey=${apiKey}&q=${encodeURIComponent(appName)}`;

            let response;
            try {
                response = await axios.get(apiUrl);
                console.log('Response:', response);
            } catch (error) {
                await sock.sendMessage(m.from, { text: 'Failed to fetch APK search results.' }, { quoted: m });
                return;
            }

            const apkData = response.data.result;

            // Prepare APK details message
            const apkInfoMessage = `
╭━━ 📥 Download APK 📥
┃ 📲 App: ${apkData.name}
┃ 📦 Package: ${apkData.package}
┃ 📅 Last Updated: ${apkData.lastup}
┃ 📏 Size: ${apkData.size}
╰━━━
            `;

            await sock.sendMessage(m.from, { text: apkInfoMessage });

            // Check if APK size is within allowed limits
            const maxSizeMB = 70;
            const apkSize = parseFloat(apkData.size.split(' ')[0]); // Extract numeric value

            if (apkSize <= maxSizeMB) {
                const downloadUrl = apkData.dllink;
                await sock.sendMessage(m.from, { text: `Downloading ${apkData.name}...` }); // Use sendMessage instead of reply

                let fileResponse;
                try {
                    fileResponse = await axios({
                        method: 'get',
                        url: downloadUrl,
                        responseType: 'stream',
                    });
                } catch (error) {
                    await sock.sendMessage(m.from, { text: `Failed to download ${apkData.name}.` }); // Use sendMessage instead of reply
                    return;
                }

                // Define file path
                const tempDir = '../src/temp';
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

                const filePath = path.join(tempDir, `${apkData.name}.apk`);
                const fileStream = fs.createWriteStream(filePath);

                fileResponse.data.pipe(fileStream);

                fileStream.on('finish', async () => {
                    console.log(`Downloaded ${apkData.name}.apk`);
                    await sock.sendMessage(m.from, {
                        document: fs.readFileSync(filePath),
                        mimetype: 'application/vnd.android.package-archive',
                        fileName: `${apkData.name}.apk`
                    });
                    //fs.unlinkSync(filePath); // Delete the file after sending
                });

                fileStream.on('error', async (error) => {
                    console.error('Error downloading file:', error);
                    await sock.sendMessage(m.from, { text: `Error downloading ${apkData.name}. Please try again later.` }); // Use sendMessage instead of reply
                });
            } else {
                await sock.sendMessage(m.from, { text: 'File size exceeds maximum allowed size.' }); // Use sendMessage instead of reply
            }
        } catch (error) {
            console.error('Error executing APK command:', error.message);
            await sock.sendMessage(m.from, { text: `Failed to fetch APK information: ${error.message}` });
        }
    }
};
