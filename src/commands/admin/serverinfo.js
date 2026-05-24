const { runtime } = require('../../lib/Func');
const { performance } = require('perf_hooks');
const os = require('os');

module.exports = {
    name: 'serverinfo',
    alias: ['sinfo'], 
    type: 'admin',
    desc: 'Check server status.',
    start: async (sock, m) => {
        const startTime = performance.now();   
        const endTime = performance.now();
        const pingTime = endTime - startTime; 

        let txt = '`</> Server Details </>`\n\n'
            txt += '`Host Info`\n\n'
            txt += `*- Hostname :* ${os.hostname()}\n`
            txt += `*- Platform :* ${os.platform()}\n`
            txt += `*- OS :* ${os.version()}\n`
            txt += `*- Arch :* ${os.arch()}\n\n`
            txt += '`Memory Info`\n\n'
            txt += `*- Total :* ${formatSize(os.totalmem())}\n`
            txt += `*- Used :* ${formatSize(os.totalmem() - os.freemem())}\n`
            txt += `*- Free :* ${formatSize(os.freemem())}\n\n`
            txt += '`Runtime`\n\n'
            txt += `*- OS :*\n${runtime(os.uptime())}\n`
            txt += `*- Bot:*\n${runtime(process.uptime())}\n\n`
            txt += '`Ping`\n\n'
            txt += `*- Response time:* ${pingTime.toFixed(2)}Ms\n\n> © 2025 Team EchoFox`

        await sock.sendMessage(m.key.remoteJid, { text: txt }, { quoted: m });
    } 
}

function formatSize(bytes, si = true, dp = 2) {
	const thresh = si ? 1000 : 1024;

	if (Math.abs(bytes) < thresh) {
		return `${bytes} B`;
	}

	const units = si ? ['KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
	let u = -1;
	const r = 10 ** dp;

	do {
		bytes /= thresh;
		u++;
	} while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);

	return `${bytes.toFixed(dp)} ${units[u]}`;
}