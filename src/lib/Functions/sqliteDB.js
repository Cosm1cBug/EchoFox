const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const parsePhoneNumber = require('libphonenumber-js');
const countries = require('iso-3166-1-alpha-2');
const mt = require('moment-timezone');
const { getDevice, getContentType } = require('@whiskeysockets/baileys')
const dbpath = './src/store/users.db';
const lid = './src/store/lastID.txt';

if (!fs.existsSync(dbpath)) {
    console.log('Database file not found. Creating a new database file...');
    fs.writeFileSync(dbpath, '');
}

let db = new sqlite3.Database(dbpath);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users
        ( ID INTEGER PRIMARY KEY AUTOINCREMENT, 
          JID TEXT UNIQUE NOT NULL, 
          Name TEXT, 
          Device TEXT,
          Contact TEXT, 
          CountryCode TEXT, 
          Country TEXT, 
          Join_Date TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS stats 
        (   ID INTEGER PRIMARY KEY AUTOINCREMENT,
            JID TEXT NOT NULL,
            GroupJID TEXT DEFAULT NULL,
            TotalMessages INTEGER DEFAULT 0,
            TextMessages INTEGER DEFAULT 0,
            ImageMessages INTEGER DEFAULT 0,
            VideoMessages INTEGER DEFAULT 0,
            AudioMessages INTEGER DEFAULT 0,
            DocumentMessages INTEGER DEFAULT 0,
            StickerMessages INTEGER DEFAULT 0,
            ReactionMessages INTEGER DEFAULT 0,
            LocationMessages INTEGER DEFAULT 0,
            CommandUsage INTEGER DEFAULT 0,
            Timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (JID) REFERENCES users(JID)
        )
    `);
        
    db.run(`
        CREATE TABLE IF NOT EXISTS command_usage 
        (   ID INTEGER PRIMARY KEY AUTOINCREMENT,
            JID TEXT NOT NULL,
            Command TEXT NOT NULL,
            UsageCount INTEGER DEFAULT 0,
            LastUsed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (JID) REFERENCES users(JID)
        )
    `);

});

function getUserStats(userJid, callback) {
    db.get(`
        SELECT * FROM stats 
        WHERE JID = ? AND Timestamp >= DATE('now') 
        ORDER BY Timestamp DESC 
        LIMIT 1
    `, [userJid], (err, row) => {
        if (err) {
            console.error("Error fetching user stats:", err);
            return callback(null);
        }
        return callback(row);
    });
}

function getGroupStats(groupJid, callback) {
    db.get(`
        SELECT SUM(TotalMessages) as TotalMessages, 
               SUM(TextMessages) as TextMessages, 
               SUM(ImageMessages) as ImageMessages,
               SUM(VideoMessages) as VideoMessages,
               SUM(AudioMessages) as AudioMessages,
               SUM(DocumentMessages) as DocumentMessages,
               SUM(StickerMessages) as StickerMessages,
               SUM(ReactionMessages) as ReactionMessages
        FROM stats 
        WHERE GroupJID = ? AND Timestamp >= DATE('now')
    `, [groupJid], (err, row) => {
        if (err) {
            console.error("Error fetching group stats:", err);
            return callback(null);
        }
        return callback(row);
    });
}

function getStatsByDate(userJid, date, callback) {
    db.get(`
        SELECT * FROM stats 
        WHERE JID = ? AND DATE(Timestamp) = ?
    `, [userJid, date], (err, row) => {
        if (err) {
            console.error("Error fetching stats:", err);
            return callback(null);
        }
        return callback(row);
    });
}

function getLeaderboard(callback) {
    db.all(`
        SELECT JID, SUM(TotalMessages) as TotalMessages 
        FROM stats 
        WHERE Timestamp >= DATE('now', '-7 days') 
        GROUP BY JID 
        ORDER BY TotalMessages DESC 
        LIMIT 10
    `, [], (err, rows) => {
        if (err) {
            console.error("Error fetching leaderboard:", err);
            return callback([]);
        }
        return callback(rows);
    });
}

function trackCommandUsage(userJid, command) {
    db.get(`SELECT * FROM command_usage WHERE JID = ? AND Command = ?`, [userJid, command], (err, row) => {
        if (err) {
            console.error("Error checking command usage:", err);
            return;
        }

        if (!row) {
            // 📌 First-time command usage for this user
            db.run(`
                INSERT INTO command_usage (JID, Command, UsageCount, LastUsed)
                VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            `, [userJid, command], (err) => {
                if (err) console.error("Error inserting command usage:", err);
            });
        } else {
            // 📌 Update existing command usage
            db.run(`
                UPDATE command_usage 
                SET UsageCount = UsageCount + 1, LastUsed = CURRENT_TIMESTAMP 
                WHERE JID = ? AND Command = ?
            `, [userJid, command], (err) => {
                if (err) console.error("Error updating command usage:", err);
            });
        }
    });
}

function getUserCommandUsage(userJid, callback) {
    db.all(`
        SELECT Command, UsageCount, LastUsed 
        FROM command_usage 
        WHERE JID = ? 
        ORDER BY UsageCount DESC
    `, [userJid], (err, rows) => {
        if (err) {
            console.error("Error fetching user command usage:", err);
            return callback([]);
        }
        return callback(rows);
    });
}

function getCommandStats(command, callback) {
    db.all(`
        SELECT JID, UsageCount, LastUsed 
        FROM command_usage 
        WHERE Command = ? 
        ORDER BY UsageCount DESC
    `, [command], (err, rows) => {
        if (err) {
            console.error("Error fetching command stats:", err);
            return callback([]);
        }
        return callback(rows);
    });
}

function getCommandLeaderboard(callback) {
    db.all(`
        SELECT Command, SUM(UsageCount) as TotalUsage 
        FROM command_usage 
        GROUP BY Command 
        ORDER BY TotalUsage DESC 
        LIMIT 10
    `, [], (err, rows) => {
        if (err) {
            console.error("Error fetching command leaderboard:", err);
            return callback([]);
        }
        return callback(rows);
    });
}


function saveLastID() {
    db.get(`SELECT MAX(ID) AS lastID FROM users`, (err, row) => {
        if (err) {
            console.error('Error fetching last ID:', err);
            return;
        }

        const lastID = row?.lastID || 0; 

        fs.writeFile(lid, lastID.toString(), (err) => {
            if (err) {
                console.error('Error writing last ID to file:', err);
            } else {
                //console.log(`Last ID (${lastID}) saved to ${lid}`);
            }
        });
    });
}

async function Data2sqlitedb(chat) {
    if (chat.messages && chat.messages.length) {
        const msg = chat.messages[0];
        const userJid = msg.key.remoteJid.endsWith('@s.whatsapp.net') ? msg.key.remoteJid : msg.key.participant; //Only fetch participants
        const groupJid = msg.key.remoteJid.endsWith('@g.us') ? msg.key.remoteJid : null; //Track group ID
        const Contakt = userJid?.split('@')[0] || ''; //userJid && userJid.includes('@') ? userJid.split('@')[0] : ''; //userJid ? userJid.split('@')[0] : ''; // Check if userJid is not undefined before splitting
        const phoneNumber = `+${Contakt}`;
        let deviceID = await getDevice(msg.key.id) || 'Unknown';
        let countryCode = null;
        let countryName = null;
        let PhoneNumberWithCountryCode = null;
        
        try {
            const phoneNumberObj = parsePhoneNumber(phoneNumber, { extended: true}); // We set extended: true for more detailed parsing
            // Get the country code
            if (phoneNumberObj) {
                countryCode = phoneNumberObj.country || 'Unknown';
                // Get the country name
                countryName = countries.getCountry(countryCode) || 'Unknown';
                // Get the formatted phone number with country code
                PhoneNumberWithCountryCode = phoneNumberObj.formatInternational() || 'Invalid Contact';
            }
        }
        catch (e) {
            console.log('Invalid phone number', phoneNumber);
        }
        const pushName = msg.pushName || 'Unknown User';
        const JoinTime = mt(new Date()).format('DD/MM/YYYY hh:mm:ss')

        //Validation Check
        if (!userJid || !PhoneNumberWithCountryCode || !countryCode || !countryName ) {
            return; //Skip the entry
        }
        //Check if the user already exists
        db.get(`SELECT * FROM users WHERE JID = ?`, [userJid], (err, row) => {
            if (err) {
                console.error('database error during SELECT:',err);
                return;
            }
            if (row) {
                // console.log('User already exists in database');
                return;
            }

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                db.run(`
                    INSERT OR IGNORE INTO users (JID, Name, Device, Contact, CountryCode, Country, Join_Date)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [userJid, pushName, deviceID, PhoneNumberWithCountryCode, countryCode, countryName, JoinTime], (err) => {
                if (err) {
                    console.error('Error inserting into database:', err);
                }
                });
                db.run('COMMIT');
                saveLastID(); // Save last ID after the transaction
            });
            
        });

        let messageType = getContentType(msg.message) || "Unknown";

        // Map different message types to valid column names in stats table
        const messageTypeMap = {
            "conversation": "Text",
            "extendedTextMessage": "Text",
            "imageMessage": "Image",
            "videoMessage": "Video",
            "audioMessage": "Audio",
            "documentMessage": "Document",
            "stickerMessage": "Sticker",
            "locationMessage": "Location",
            "reactionMessage": "Reaction",
        };

        // Default to "Unknown" if not in mapping
        const mappedType = messageTypeMap[messageType] || "Unknown";

        if (mappedType === "Unknown") {
            console.warn(`Skipping unknown message type: ${messageType}`);
            return;
        }

        const columnName = `${mappedType}Messages`;

        db.get(`SELECT * FROM stats WHERE JID = ? AND Timestamp >= DATE('now')`, [userJid], (err, row) => {
            if (err) {
                console.error('Error checking stats:', err);
                return;
            }

            if (!row) {
                db.run(`
                    INSERT INTO stats (JID, GroupJID, TotalMessages, ${columnName}, Timestamp)
                    VALUES (?, ?, 1, 1, CURRENT_TIMESTAMP)
                `, [userJid, groupJid]);
            } else {

                db.run(`
                    UPDATE stats 
                    SET TotalMessages = TotalMessages + 1, 
                    ${columnName} = ${columnName} + 1
                    WHERE JID = ? AND Timestamp >= DATE('now')
                `, [userJid]);
            }
        });
    } 
}  

module.exports = { 
    Data2sqlitedb,
    getUserStats,
    getGroupStats,
    getStatsByDate,
    getLeaderboard,
    trackCommandUsage,
    getCommandStats,
    getCommandLeaderboard,
    getUserCommandUsage,
    closeConnection: () => {
        db.close((err) => {
            if (err) {
                console.log('Error: Database connection close error.')
            } else {
                console.log('Database connection closed.')
            }
        });
    }
};

// Get user data
/*
getUserStats('userJid@s.whatsapp.net', (stats) => {
    console.log(stats);
});
*/

// Get Group data
/*
getGroupStats('groupJid@g.us', (stats) => {
    console.log(stats);
});
*/

// Get stats for a specific date
/*
getStatsByDate('userJid@s.whatsapp.net', '2025-02-20', (stats) => {
    console.log(stats);
});
*/

// Get Leaderboard
/*
getLeaderboard((topUsers) => {
    console.log(topUsers);
});
*/
// const { getUserStats, getLeaderboard } = require('./path/to/Data2sqlitedb'); // Adjust the path

// Get user command usage
/*
getUserCommandUsage('918765432109@s.whatsapp.net', (commands) => {
    console.log("User Command Usage:", commands);
});
*/

// Get command stats
/*
getCommandStats('stats', (users) => {
    console.log("Users who used the 'stats' command:", users);
});
*/

// Get command leaderboard
/*
getCommandLeaderboard((topCommands) => {
    console.log("Most Used Commands:", topCommands);
});
*/

/*

if (cmdName === "$commandstats") {
    getUserCommandUsage(m.sender, async (commands) => {
        if (commands.length === 0) {
            await sock.sendMessage(m.from, { text: `You have not used any commands yet.` }, { quoted: m });
            return;
        }

        let message = "📊 *Your Command Usage Stats:*\n\n";
        commands.forEach((cmd) => {
            message += `🔹 ${cmd.Command}: ${cmd.UsageCount} times (Last Used: ${cmd.LastUsed})\n`;
        });

        await sock.sendMessage(m.from, { text: message }, { quoted: m });
    });
}

*/

/*

if (cmdName === "$commandleaderboard") {
    getCommandLeaderboard(async (topCommands) => {
        if (topCommands.length === 0) {
            await sock.sendMessage(m.from, { text: "No command usage data available." }, { quoted: m });
            return;
        }

        let message = "🏆 *Most Used Commands:*\n\n";
        topCommands.forEach((cmd, index) => {
            message += `${index + 1}. ${cmd.Command} → ${cmd.TotalUsage} times\n`;
        });

        await sock.sendMessage(m.from, { text: message }, { quoted: m });
    });
}

*/