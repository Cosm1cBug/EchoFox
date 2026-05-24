module.exports = {
  name: 'approve',
  alias: ['accept'],
  type: 'group',
  desc: 'Approves join request of given user.',
  func: async (sock, chat, m, {text}, isGroup, isAdmin) => {
    if (!isGroup) return await sock.sendMessage(m.from, { text: '*This command can only be used in group!*' },  { quoted: m });
    if (!(await isAdmin(m.me))) return await sock.sendMessage(m.from, { text: '*I am not an admin of this group!*' }, { quoted: m });
    if (!(await isAdmin(m.sender))) return await sock.sendMessage(m.from, { text: '*You are not an admin of this group!*' },  { quoted: m });
    if (!text || !text.startsWith('+')) return await sock.sendMessage(m.from, { text: '*Please enter the number of user with +countrycode for approving!*' },  { quoted: m });
    let list = [];
    let lis = await sock.groupRequestParticipantsList(m.chat);
      lis.map((l) => list.push('+' + l.jid.split('@')[0]));
      if (!list.includes(text)) return await sock.sendMessage(m.from, { text: '*This user didn\'t sent join request to this group!*' },  { quoted: m });
        await sock.groupRequestParticipantsUpdate(m.chat, [text.replace('+', '') + '@s.whatsapp.net'], 'approve');
      return await sock.sendMessage(m.from, { text: '*Approved @' + text.replace('+', '') + '\'s join request!*' },  { quoted: m });
  }
}
