const { config } = require('../../config');
const gtts = require('node-gtts');
const gttsML = require('node-tts-ml');
const translate = require("google-translate-api-x");
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const defaultLang = 'en';

module.exports = {
    name: 'text2speech',
    alias: ['tts'],
    usage: "<reply>",
    type: 'convert',
    desc: "Convert text to speech! If a language code is provided, it translates first.",
    start: async (sock, m, { args }) => {
        // Extract quoted text
        let text = m.quoted?.text || "";
        if (!text.trim()) {
            return await sock.sendMessage(m.from, { text: 'Please reply to a message to convert to speech.' }, { quoted: m });
        }

        // Extract language argument (default to English if missing)
        let targetLang = args[0] && args[0].length === 2 ? args[0] : defaultLang;

        // If a language code is provided, translate before speech conversion
        if (args[0]) {
            try {
                //console.log(`Translating text to ${targetLang}...`);
                let translatedResult = await translate(text, { to: targetLang });
                text = translatedResult.text || text; // Ensure valid text after translation
                //console.log(`Translated Text: ${text}`);
            } catch (err) {
                //console.error("Translation failed:", err);
                return await sock.sendMessage(m.from, { text: 'Translation failed. Try again later.' }, { quoted: m });
            }
        }

        // Ensure text is a string before processing
        if (typeof text !== "string" || !text.trim()) {
            return await sock.sendMessage(m.from, { text: 'Error processing text.' }, { quoted: m });
        }

        // Process text to speech
        let chunks = text.match(/[^.!?]+[.!?]/g) || [text];

        // Generate filename with date and time
        let date = new Date();
        let day = date.getDate().toString().padStart(2, '0');
        let month = (date.getMonth() + 1).toString().padStart(2, '0');
        let year = date.getFullYear();
        let hours = date.getHours() % 12 || 12;
        let minutes = date.getMinutes().toString().padStart(2, '0');
        let seconds = date.getSeconds().toString().padStart(2, '0');
        let ampm = date.getHours() >= 12 ? 'PM' : 'AM';

        let filename = `Text2Speech-${day}-${month}-${year}-${hours}-${minutes}-${seconds}-${ampm}.mp3`;
        const tempDir = path.join(__dirname, '../../temp');
        const finalOutput = path.join(tempDir, filename);

        let audioFiles = [];

        for (let i = 0; i < chunks.length; i++) {
            let filePath = await tts(chunks[i].trim(), targetLang, i);
            if (filePath) audioFiles.push(filePath);
        }
        if (audioFiles.length === 1) {
            fs.renameSync(audioFiles[0], finalOutput);
        } else {
            await mergeAudioFiles(audioFiles, finalOutput);
        }
        // Send final audio
        await sock.sendMessage(m.from, {
            audio: { url: finalOutput },
            mimetype: 'audio/mpeg',
            ptt: true
        });

        // Schedule file deletion after 48 hours
        setTimeout(() => {
            fs.unlink(finalOutput, (err) => {
                if (err) console.error(`Error deleting file: ${finalOutput}`, err);
            });
        }, 48 * 60 * 60 * 1000);
    }
};

// Convert text to speech
function tts(text, lang = defaultLang, index = 0) {
    return new Promise((resolve, reject) => {
        try {
            let ttsEngine = lang === 'ml' ? gttsML : gtts;
            let tts = ttsEngine(lang);
            const tempDir = path.join(__dirname, '../../temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            let filepath = path.join(tempDir, `tts_chunk_${index}.mp3`);

            tts.save(filepath, text, () => {
                resolve(filepath);
            });
        } catch (e) {
            reject(e);
        }
    });
}
// Merge audio files into one using ffmpeg
function mergeAudioFiles(files, outputFile) {
    return new Promise((resolve, reject) => {
        let command = ffmpeg();
        files.forEach(file => command.input(file));

        command
            .on('end', () => {
                files.forEach(file => fs.unlinkSync(file)); // Cleanup chunks
                resolve(outputFile);
            })
            .on('error', (err) => {
                console.error('Error merging audio files:', err);
                reject(err);
            })
            .mergeToFile(outputFile, path.dirname(outputFile));
    });
};