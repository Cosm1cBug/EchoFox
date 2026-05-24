const fs = require('fs');
const axios = require('axios');
const path = require('path');

module.exports = {
    name: "ssweb",
    alias: ['ssw','webshot'],
    usage: '<URL>',
    type: 'tools',
    desc: 'Takes a screenshot of the provided link.',
    start: async (sock, m, { text }) => {
        if (!text) {
            await sock.sendMessage(m.from, { text: 'Please provide a URL.' }, { quoted: m });
            return;
        }

        const tempDir = path.resolve(__dirname, '../../temp');
        const filePath = path.join(tempDir, `${m.from}.png`);

        try {
            // Ensure the temp directory exists
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            // Fetch the screenshot
            const apiUrl = `https://api.vreden.my.id/api/ssweb?url=${encodeURIComponent(text)}&type=desktop`;
            const res = await axios.get(apiUrl, { responseType: 'arraybuffer' });

            // Save the image file
            fs.writeFileSync(filePath, res.data);

            // Send the image and wait for completion
            await sock.sendMessage(m.from, { 
                image: { url: filePath },
                mimetype: "image/png", 
                caption: 'Here is your screenshot.' 
            }, { quoted: m });

            // Delete the file after sending
            fs.unlink(filePath, (err) => {
                if (err) {
                    console.error('Error deleting file:', err);
                } else {
                    // File deleted successfully
                }
            });

        } catch (error) {
            console.error('Error capturing screenshot:', error);
            await sock.sendMessage(m.from, { text: 'Failed to capture the screenshot. Please try again later.' }, { quoted: m });
        }
    }
};