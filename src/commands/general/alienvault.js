/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const fs = require("fs");
const path = require("path");

const SUBSCRIBERS = path.join(__dirname, "../../store/AlienVault/pulse-subscribers.json");

// Load subscribers
function loadSubscribers() {
    if (!fs.existsSync(SUBSCRIBERS)) {
        console.log("[AlienVault] - Subscribers file does not exist. Returning empty array.");
        return [];
    }
    return JSON.parse(fs.readFileSync(SUBSCRIBERS, "utf8"));
}

// Save subscribers
function ManageSubscribers(subscribers) {
    fs.writeFileSync(SUBSCRIBERS, JSON.stringify(subscribers, null, 4));
    console.log(`[AlienVault] - Subscribers updated: ${JSON.stringify(subscribers, null, 2)}`);
}

module.exports = {
    name: "alienvault",
    aliase: ['pulse'],
    usage: `<on/off>`,
    type: 'general',
    info: "Subscribe or unsubscribe to AlienVault pulses.",
    start: async (sock, m, { text }, arg) => {
        if (!m.isPrivate) return await sock.sendMessage(m.chat, { text: '❌ Can only be used in Private Chats.'}, { quoted: m });
        let subscribers = loadSubscribers();
        let userId = String(m.sender || m.from);  // Ensure userId is always a string

        if (text === "on") {
            if (!subscribers.includes(userId)) {
                subscribers.push(userId);
                ManageSubscribers(subscribers);
                await sock.sendMessage(m.chat, { text: "✅ You are now subscribed to AlienVault pulses!" }, { quoted: m });
            } else {
                await sock.sendMessage(m.chat, { text: "⚠ You are already subscribed!" }, { quoted: m });
            }
        } else if (text === "off") {
            if (subscribers.includes(userId)) {
                // Remove the userId from the subscribers array
                subscribers = subscribers.filter(id => id !== userId);
                ManageSubscribers(subscribers);
                await sock.sendMessage(m.chat, { text: "❌ You have unsubscribed from AlienVault pulses." }, { quoted: m });
            } else {
                await sock.sendMessage(m.chat, { text: "⚠ You are not subscribed!" }, { quoted: m });
            }
        } else {
            //await sock.sendMessage(m.chat, { text: "Use $alienvault on to subscribe or $alienvault off to unsubscribe." }, { quoted: m });
        }
    }
};
