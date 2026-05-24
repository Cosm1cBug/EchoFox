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
