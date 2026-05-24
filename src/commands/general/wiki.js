const axios = require('axios')
const cheerio = require('cheerio')

module.exports = {
    name: 'wiki',
    alias: ['wikipedia'],
    usage: "<query>",
    desc: "Search contents from wikipedia!",
    start: async (sock, m, { text, args }) => {
        if (!text) {
            return await sock.sendMessage(m.from, { text: 'No query to search.' }, { quoted: m });
        }
        try {
            const res = await axios.get(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(text)}&limit=1&namespace=0&format=json`);
            
            // Check if there are results
            if (!res.data[1] || res.data[1].length === 0) {
                return await sock.sendMessage(
                    m.from,
                    { text: `No Wikipedia page found for "${text}".` },
                    { quoted: m }
                );
            }
            const pageTitle = res.data[1][0];
            const pageUrl = res.data[3][0];

            const pageResponse = await axios.get(pageUrl);
            const $ = cheerio.load(pageResponse.data);

            let wikresult = '';
            $('#mw-content-text p').each((i, element) => {
                if (i < 3) { // Get up to 3 paragraphs
                    const paragraph = $(element).text().trim();
                    if (paragraph) wikresult += paragraph + '\n\n';
                }
            });
            if (!wikresult) {
                return await sock.sendMessage(m.from, { text: `No content found for ${text} on Wikipedia.` }, { quoted: m });
            }

            await sock.sendMessage(m.from, { text:`WIKIPEDIA\n\nQuery: ${pageTitle}\n${wikresult}\nRead more: ${pageUrl}`}, {quoted: m});
        } catch (e) {
            if (e.res && e.res.status === 404) {
                await sock.sendMessage(
                    m.from,
                    { text: `No Wikipedia page found for "${text}".` },
                    { quoted: m }
                );
            } else {
                console.log(`Wiki:`, e);
                await sock.sendMessage(m.from, { text: 'An error occurred while fetching data from Wikipedia.' }, { quoted: m });
            }
            
        }
    }
};