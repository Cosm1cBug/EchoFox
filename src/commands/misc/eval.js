const { exec } = require('child_process');
const { format } = require('util');

module.exports = {
    name: 'exec',
    alias: ['>'],
    type: 'hide',
    start: async (m, sock) => {
        let data;
        switch (m.cmd){
            case '>':
                try {
                    if (!m.text) return;
                    data = m.text.includes('return') 
                        ? await eval(`(async () => { ${m.text} })()`)
                        : await eval(`(async () => { return ${m.text} })()`);
                    await sock.sendmessage(m.from, { text: (format(data))}); //m.reply(format(data));
                } catch (e) {
                    await sock.sendmessage(m.from, { text: (format(e))}); //m.reply(format(e));
                }
            break;

            case 'exec':
            case '$':
                if (!m.text) return;
                await sock.sendmessage(m.from, { text:'Executing...'});
                exec(m.text, async (e, s) => {
                    if (e) await sock.sendmessage(m.from, { text: (format(e))}); //m.reply(format(e));
                    if (s) await sock.sendmessage(m.from, { text: (format(s))}); //m.reply(format(s));
                });
            break;
        }
    }
}
