const { config }  = require('../../config.js');
const fetch = require('node-fetch');
const { pipeline } = require('stream');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { type } = require('os');

module.exports = {
    name: 'omdb',
    alias: ['movie','series','imdb'],
    type: 'entertainment',
    usage: '<query>',
    desc: 'Fetches the OMDB info of Movie/Series.',
    start: async (sock, m, { text }) => {
        const apiUrl = `${config.omdb.url}?apikey=${config.omdb.key}&t=${text}&plot=full`;

        return fetcher(apiUrl, sock, m, text);
    }
};

async function getBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Unexpected response: ${response.statusText}`);
    }
    
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.join(tempDir, 'tempfile.jpg');
    const dest = fs.createWriteStream(tempFilePath);
    await promisify(pipeline)(response.body, dest);
    const buffer = fs.readFileSync(tempFilePath);

    // Clean up the file after reading
    fs.unlinkSync(tempFilePath);

    return buffer;
}

async function fetcher(apiUrl, sock, m, text) {
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`HTTP error!\nStatus: ${response.status}`);
        
        const data = await response.json();
        if (data.Response === "False") {
            throw new Error(data.Error);
        }

        let msg = `*${data.Title} (${data.Year})*\n\nRated: ${data.Rated}\nRuntime: ${data.Runtime}\nGenre: ${data.Genre}\nLanguage: ${data.Language}\n\nPlot: ${data.Plot}\n\nDirector: ${data.Director}\nActors: ${data.Actors}\n\n> © COSMIC-CREW`;

        return await sock.sendMessage(m.from, {
            text: msg,
            contextInfo:{
                externalAdReply: {
                    title: `OMDB Info`,
                    body: `Details of query ${text}`,
                    previewType: 0,
                    mediaType: 1,
                    thumbnail: await getBuffer(data.Poster)
                }
            }
        }, {quoted: m});


    } catch (error) {
        console.error('Error:', error);
        await sock.sendMessage(m.from, { 
            text: `Failed to fetch OMDB details for the query ${text}. Please try again later.` }, { quoted: m });
    }
}
