const fs = require('fs');
const axios = require('axios');
const path = require('path');
const tempDir = path.join(__dirname, '../../temp');

module.exports = {
    name: "spotify",
    alias: ['spotifydl'],
    usage: '<url>',
    type: 'download',
    desc: 'Downloads song from given spotify URL.',
    start: async (sock, m, {text}) => {
        if (!text) {
            await sock.sendMessage(m.from, { text: 'Query missing.' }, { quoted: m });
            return;
        }

        const apiUrl = `https://vapis.my.id/api/spotify?url=${encodeURIComponent(text)}`;

        try {
            const res = await axios.get(apiUrl);
            const { title, download, image, duration_ms } = res.data.data;

            // Convert duration from milliseconds to a readable format (minutes:seconds)
            const minutes = Math.floor(duration_ms / 60000);
            const seconds = ((duration_ms % 60000) / 1000).toFixed(0);
            const duration = `${minutes}:${seconds.padStart(2, '0')}`;

            const filePath = path.join(tempDir, `${title}.mp3`);
            const imagePath = path.join(tempDir, `${title}-thumbnail.jpg`);

            // Create streams for the audio and image downloads
            const downloadAudio = axios.get(download, { responseType: 'stream' });
            const downloadImage = axios.get(image, { responseType: 'stream' });

            // Wait for both the audio file and image to be fetched
            const [audioResponse, imageResponse] = await Promise.all([downloadAudio, downloadImage]);

            // Save the audio file
            const audioWriter = fs.createWriteStream(filePath);
            audioResponse.data.pipe(audioWriter);

            // Save the image file
            const imageWriter = fs.createWriteStream(imagePath);
            imageResponse.data.pipe(imageWriter);

            // Once both downloads are finished, proceed with sending the file
            await Promise.all([
                new Promise((resolve, reject) => {
                    audioWriter.on('finish', resolve);
                    audioWriter.on('error', reject);
                }),
                new Promise((resolve, reject) => {
                    imageWriter.on('finish', resolve);
                    imageWriter.on('error', reject);
                })
            ]);

            // Get file size after download
            const stats = fs.statSync(filePath);
            const fileLength = stats.size; // Accurate file size in bytes

            // Read the image file as a buffer
            const imageBuffer = fs.readFileSync(imagePath);

            // Read the audio file as a buffer
            const buffer = fs.readFileSync(filePath);

            // Send the document message
            await sock.sendMessage(m.from, {
                audio: buffer,
                mimetype: 'audio/mpeg',
                fileName: `${title}.mp3`,
                fileLength: fileLength,
                caption: `*Title*: ${title}\n*Duration*: ${duration}`,
                contextInfo: {
                    externalAdReply: {
                        showAdAttribution: false,
                        renderLargerThumbnail: true,
                        title: title,
                        body: `Requested by: ${m.pushName}`,
                        previewType: 0,
                        mediaType: 1,
                        thumbnail: imageBuffer, // Use the image buffer as the thumbnail
                    }
                }
            }, { quoted: m });

            // Clean up the temp files after sending
            fs.unlinkSync(filePath);
            fs.unlinkSync(imagePath); // Delete the image after use

        } catch (error) {
            console.error('Error:', error);
            await sock.sendMessage(m.from, { text: 'Failed to fetch details from Spotify.' }, { quoted: m });
        }
    }
};

/*
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const tempDir = path.join(__dirname, '../../temp');

module.exports = {
    name: "spotify",
    alias: ['spotifydl'],
    usage: '<url>',
    type: 'download',
    desc: 'Downloads song from given spotify URL.',
    start: async (sock, m, {text}) => {
        if (!text) {
            await sock.sendMessage(m.from, { text: 'Query missing.' }, { quoted: m });
            return;
        }

        const apiUrl = `https://vapis.my.id/api/spotify?url=${encodeURIComponent(text)}`;

        let res;

        try {
            res = await axios.get(apiUrl);
            const { title, download, image, duration_ms } = res.data.data;

            // Convert duration from milliseconds to a readable format (minutes:seconds)
            const minutes = Math.floor(duration_ms / 60000);
            const seconds = ((duration_ms % 60000) / 1000).toFixed(0);
            const duration = `${minutes}:${seconds.padStart(2, '0')}`;

            const filePath = path.join(tempDir, `${title}.mp3`);
            const writer = fs.createWriteStream(filePath);

            const $File = await axios.get(download, {
                responseType: 'stream',
            });

            $File.data.pipe(writer);

            writer.on('finish', async () => {
                console.log('File downloaded successfully.');

                // Get accurate file size using fs.statSync
                const stats = fs.statSync(filePath);
                const fileLength = stats.size; // Accurate file size in bytes

                // Read the file as a buffer
                const buffer = fs.readFileSync(filePath);

                // Download the image and save it to a temporary location
                const imagePath = path.join(tempDir, `${title}-thumbnail.jpg`);
                const imageResponse = await axios.get(image, { responseType: 'stream' });
                const imageWriter = fs.createWriteStream(imagePath);

                imageResponse.data.pipe(imageWriter);

                imageWriter.on('finish', async () => {
                    try {
                        // Read the image file as a buffer
                        const imageBuffer = fs.readFileSync(imagePath);

                        // Send the document message
                        await sock.sendMessage(m.from, {
                            document: buffer,
                            mimetype: 'audio/mpeg',
                            fileName: `${title}.mp3`,
                            fileLength: fileLength,
                            caption: `*Title*: ${title}\n*Duration*: ${duration}`,
                            contextInfo: {
                                externalAdReply: {
                                    showAdAttribution: false,
                                    renderLargerThumbnail: true,
                                    title: title,
                                    body: `Requested by: ${m.pushName}`,
                                    previewType: 0,
                                    mediaType: 1,
                                    thumbnail: imageBuffer, // Use the image buffer as the thumbnail
                                }
                            }
                        }, { quoted: m });

                        // Clean up the temp files after sending
                        fs.unlinkSync(filePath);
                        fs.unlinkSync(imagePath); // Delete the image after use
                    } catch (err) {
                        console.error('Error reading the image buffer:', err);
                        sock.sendMessage(m.from, { text: 'Failed to process the image.' }, { quoted: m });
                    }
                });

                imageWriter.on('error', (err) => {
                    console.error('Error downloading the image:', err);
                    sock.sendMessage(m.from, { text: 'Failed to download the image.' }, { quoted: m });
                });
            });

            writer.on('error', (err) => {
                console.error('Error downloading file:', err);
                sock.sendMessage(m.from, { text: 'Failed to download the file.' }, { quoted: m });
            });

        } catch (error) {
            console.error('Error:', error);
            await sock.sendMessage(m.from, { text: 'Failed to fetch details from Spotify.' }, { quoted: m });
        }
    }
};
*/