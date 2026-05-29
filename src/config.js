const fs = require('fs');
const prefixRegex = /^[$]/gi;

const config = {
    omdb: {
        url: 'https://www.omdbapi.com/',
        key: ''
    },
    virustotal: {
        key: ''
    },
    alienvault: {
        key: '',
    },
    store: {
        ininstanceID: 'EchoFox',
        storePath: "./src/store/",
    },
    login: {
        // Type: 'QR' or 'PAIRING'
        type: 'QR',
        // If type === 'PAIRING', specify the phone number without '+' (e.g. '1234567890')
        phoneNumber: '',
    },
    // Sync full history upon login
    syncHistory: true,
    options: {
        antiCall: false, //If true, rejects calls. If false do nothing.
        aboutUpdate: "", //leave empty to do nothing.
        BAdmin: ['1234567890@s.whatsapp.net'], //Give number for administration.
        prefix: prefixRegex, //Msgs starting with '.' considered as commands.
        ReadMessages: true, //set true to read messages
        ReadStatus: true, //set true to read status/stories
        ReactStatus: false,
        sessionName: "@session", //Give session name (folderName)
        language: "en",
        timezone: "Asia/Kolkata",
    },
    auth: {
        // Method: 'MULTIFILE', 'REDIS', 'SQLITE'
        method: 'MULTIFILE', 
        redisUrl: 'redis://localhost:6379',
        sqlitePath: './src/store/auth.db',
    },
    storeDB: {
        // Type: 'SQLITE', 'POSTGRES', 'MONGODB', 'REDIS'
        type: 'SQLITE', 
        sqlitePath: './src/store/runtime/wa.db',
        postgresUrl: 'postgresql://postgres:postgres@localhost:5432/echofox',
        mongoUri: 'mongodb://localhost:27017/echofox',
        redisUrl: 'redis://localhost:6379'
    },
    // ----------------------------------------------------
    // Web Dashboard Options
    // ----------------------------------------------------
    dashboard: {
        enabled: true,
        port: 3001,
        username: 'admin',
        password: 'password'
    },
    processing: {
        concurrencyPerChat: 1,
        // Global rate limit: messages per second
        globalRateLimit: 5,
        // User rate limit: messages per user per minute
        userRateLimit: 10
    },
    Exif: {
        packName: "🗦BUGGY🗧",
        packAuthor: "🗦COSMICBUG🗧",
    },
    WApp: {
        MovGrp: "@g.us", //Mov grp
        UserLogs: "@g.us", //For saving user data.
        BotLogs: "@g.us", //Give chat/group id to send logs. 
        CallLogs: "@g.us",
        Syslogs: "@g.us",
        GrpUpdates: "@g.us",
        ErrLogs: "@g.us",
    },
    Tele: {
        userID: '',
        appID: '',
        apiHash: '',
        channelID: '', //To save image, audio, video & documents from WhatsApp.
        groupID: '', //To send messages to WhatsApp.
        botID: '',
        botUserName: '',
        botToken: '',
    },
    MongoDB: {
        URI: "mongodb://localhost:27017/"
    },
    WorkMode: {
        public: true //set true to make public
    },
    OpenAI: {
        apiKey: ''
    },
    Gemini: {
        apiKey: ''
    }
}

module.exports = { config };
//working fine!

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(`Updated:'${__filename}'`)
    delete require.cache[file]
    require(file)
})
