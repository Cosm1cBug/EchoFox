const { performance } = require('perf_hooks');

module.exports = {
    name: 'ping',
    alias: ['p'], 
    desc: 'Check ping in ms',
    type: 'admin',
    start: async (sock, m) => {
        const startTime = performance.now();   
        const endTime = performance.now();
        const pingTime = endTime - startTime; 

        await sock.sendMessage(m.key.remoteJid, { 
            text: `Latency: ${pingTime.toFixed(2)} ms` 
        }, { quoted: m });
    }
}