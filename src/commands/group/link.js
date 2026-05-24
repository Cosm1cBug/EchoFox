module.exports = {
    name: 'link',
    alias: ['grouplink'],
    type: 'group',
    desc: 'Fetches group\'s invitation link.',
    start: async (sock, m, isAdmin, isBotAdmin, isGroup) => {
      if (!isGroup) return await sock.sendMessage(m.from, { text: '`This command can only be used in group!`' },{ quoted: m });
      if (!isBotAdmin) return await sock.sendMessage(m.from, { text: '`I dont have the right permission to perform this action. Make me an admin in this group to perform such tasks!`' },{ quoted: m });
      if (!isAdmin) return await sock.sendMessage(m.from, { text: '`Only group admins can perform this action!`' },{ quoted: m });
      return await sock.sendMessage(m.from, { text: 'https://chat.whatsapp.com/' + (await sock.groupInviteCode(m.chat)) },{ quoted:m });
    }
}