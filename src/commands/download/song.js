const fs = require('fs');
const axios = require('axios');
const ytdl = require('youtubedl-core');

module.exports = {
    name: "song",
    alias: ['songdl'],
    usage: '<Song Name>',
    type: 'download',
    desc: 'Downloads a song based on the given lyrics or name.',
    start: async (sock, m, { text }) => {
        if (!text) {
            return await sock.sendMessage(m.from, { text: '*Please enter a song name or lyrics!*' });
        }

        await sock.sendMessage(m.from, { text: '*Searching for the song...*' });

        let videoUrl = '';

        try {
            let json = await parseJson(`https://toxicdevilapi.vercel.app/search/youtube?query=${encodeURIComponent(text)}`);
            let video = json.result.find(v => v.type === 'video');

            if (!video) {
                throw new Error("No video found");
            }

            videoUrl = video.url;
        } catch (e) {
            console.log(e);
            return await sock.sendMessage(m.from, { text: '*Unable to find a song matching the given lyrics!*' });
        }

        await sock.sendMessage(m.from, { text: '*Downloading song...*' });

        try {
            let file = `./song.mp3`;
            let audioStream = ytdl(videoUrl, {
                filter: 'audioonly',
                quality: 'highestaudio'
            });

            let writeStream = fs.createWriteStream(file);
            audioStream.pipe(writeStream);

            audioStream.on('end', async () => {
                await sock.sendMessage(m.from, { audio: fs.readFileSync(file), mimetype: 'audio/mpeg' });
                fs.unlinkSync(file); // Delete file after sending
            });

        } catch (error) {
            console.log(error);
            return await sock.sendMessage(m.from, { text: '*Unable to download the song!*' });
        }
    }
};

async function parseJson(url) {
    try {
        let { data } = await axios.get(url);
        return data;
    } catch (e) {
        console.log('An error occurred while fetching JSON:\n\n' + e.stack);
        return false;
    }
}
