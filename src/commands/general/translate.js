const { config } = require('../../config');
const { translate } = require("google-translate-api-x");
const iso6391 = require('iso-639-1');

module.exports = {
    name: 'translate',
    alias:['tr','trt'],
    usage: "<reply>",
    desc: "Translate the quoted/replied text.",
    type: "general",
    start: async(sock, m, { command, prefix, quoted, args }) => {
        if (!args) {
            return await sock.sendMessage(m.from, { text: 'Missing argument. Need language code to translate. Eg: ml, en'}, { quoted: m })
        }    
        try {
            const txt2translate = m.quoted?.text;
            if (!txt2translate) {
                return await sock.sendMessage(m.from, { text: 'Please quote a message to translate!'}, { quoted: m})
            }
            const res = await translate(txt2translate, { to: `${args}`})
            SLang = await iso6391.getName(res.from.language.iso);
            TLang = await iso6391.getName(`${args}`);

            let txt = `\`</> Original: ${SLang} </>\`\n\n`;
                txt += `> ${txt2translate}\n\n`;
                txt += `\`</> Translated to: ${TLang} </>\`\n\n`;
                txt += `> ${res.text}`;

            await sock.sendMessage(m.from, { text: txt}, { quoted: m})
        } catch (e) {
            console.log(e)
            await sock.sendMessage(config.WApp.ErrLogs, { text: `Command Error\n\n${e}`}, {quoted: m});
        }


    }
}
