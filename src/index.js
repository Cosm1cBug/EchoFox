'use strict';
//process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
require('events').EventEmitter.defaultMaxListeners = 500
const crypto = require('node:crypto');
const { 
	makeWASocket, 
	useMultiFileAuthState, 
	makeInMemoryStore, 
	jidDecode, 
	delay, 
	jidNormalizedUser, 
	makeCacheableSignalKeyStore, 
	DisconnectReason, 
	fetchLatestBaileysVersion, 
	Browsers, 
	fetchLatestWaWebVersion, 
	proto, 
	updateMessageWithReceipt 
} = require('@whiskeysockets/baileys');
const { makeInSQLiteStore } = require('./lib/makeInSQLiteStore.js');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const NodeCache = require('node-cache');
const { metadataCache, retryCache} = require('./lib/cache.js');
const { config }  = require('./config.js');
const spinnies = new (require('spinnies'))();
const { groupParticipantsUpdate } = require('./lib/Events/group-participants.update.js');
const { userDataSaver } = require('./lib/Functions/userDataSaver.js');
const { Data2sqlitedb } = require('./lib/Functions/sqliteDB.js');
const { groupsUpdate } = require('./lib/Events/groups.update.js');
const { AlienVaultService } = require('./lib/alienvault-pulse.js')
const Collection = require('./lib/Collection.js');
const mt = require('moment-timezone');
const tzone = config.options.timezone;
let cd = mt.tz(tzone).format('YYYY-MM-DD');
const logger = pino({ level: 'silent' });
const Commands = new Collection()

Commands.prefix = config.options.prefix;

const readCommands = () => {
    spinnies.add('loading', { text: 'Loading commands...' });
    let dir = path.join(__dirname, "./commands");
    let listCommand = {};
    try {
        fs.readdirSync(dir).forEach((res) => {
            let groups = res.toLowerCase();
            Commands.type = fs.readdirSync(dir).filter(v => v !== "_");
            listCommand[groups] = [];
            let files = fs.readdirSync(`${dir}/${res}`).filter((file) => file.endsWith(".js"));
            for (const file of files) {
                const command = require(`${dir}/${res}/${file}`);
                listCommand[groups].push(command);
                Commands.set(command.name, command);
            }
        });
        Commands.list = listCommand;
        spinnies.succeed('loading', { text: 'Commands loaded successfully!' });
    } catch (e) {
        spinnies.fail('loading', { text: 'Failed to load commands!' });
        console.log('Nothing is there!');
    }
};

const getMessage = async (msg) => {
    if (!store) return;

    const message = store.getMessage(msg.id);
    if (!message) return undefined;

    // If it's a media message, load the BLOB and return buffer
    if (["imageMessage", "videoMessage", "audioMessage"].includes(message.type)) {
        return {
            ...message,
            media: Buffer.from(message.media, "base64")
        };
    }

    return message;
};

const restartInterval = 30; // Restarts socket every 30 minutes 

async function WaBot() {
	const { state, saveCreds } = await useMultiFileAuthState(`./src/${config.options.sessionName}`);
	const { version, isLatest, error } = await fetchLatestWaWebVersion() //fetchLatestBaileysVersion() //fetchLatestWaWebVersion() 
	
	if (error) {
		console.log('Check your Internet connection...!');
		await delay(30000)
		return WaBot()
	}
	console.log(`Connected Using WAWeb v${version.join(".")}, isLatest: ${isLatest}`);
	
	const store = await makeInSQLiteStore("1", "./src/store/wa-store.db", pino({ level: "warn" }));

	const sock = makeWASocket({
		connectTimeoutMs: 20_000,
		defaultQueryTimeoutMs: 60_000,
		keepAliveIntervalMs: 30_000,
		logger: logger,
		version: version,
		browser: Browsers.windows('Desktop'),
		printQRInTerminal: true,
		qrTimeout: 20_000,
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, logger)
		},
		syncFullHistory: true,
		shouldSyncHistoryMessage: true,
		markOnlineOnConnect: false,
		generateHighQualityLinkPreview: true,
		msgRetryCounterCache: retryCache, // Resolve waiting for this message!
		cachedGroupMetadata: async(jid) => metadataCache.get(jid),
		getMessage: async (msg) => {
			return store.getMessagesByJid(msg.id);
		}
	});

	await readCommands()
	AlienVaultService(sock)

	store.bind(sock.ev, sock);

	//Listen for connection updates
	sock.ev.on('connection.update', async (update) => {
		//console.log('Connection Update:', update);
		const { connection, lastDisconnect, qr, receivedPendingNotifications } = update;
		if (connection === 'undefined' && qr != 'undefined'){
			console.log('[ BUGGY ] - Please scan the QR-Code to begin..!')
			qrcode.generate(qr, {small: true});
		}
		if (connection === 'connecting'){
			spinnies.add('start', {text: 'Connecting...'});
		}
		if (connection === 'open'){
			const currentTime = mt().tz(tzone).format("DD-MMM-YYYY | hh:mm A z");
			const botNumber = sock.user.id.split(":")[0];

			spinnies.succeed('start', {text: `Connected Successfully.\nLogged in as: ${sock?.user?.name || "BUGGY"}\nOn Number: ${botNumber}`});			
			await sock.sendMessage(config.WApp.Syslogs, {
				text: `✅ *Connection Successful!*\n🤖 *Bot Name:* BUGGY\n📱 *Connected Number:* ${botNumber}\n📅 *Date & Time:* ${currentTime}`,
				contextInfo: {
					externalAdReply: {
						showAdAttribution: false,
						renderLargerThumbnail: true,
						title: `🔰BUGGY v5.0.1`,
						body: `Connection established successfully ✅`,
						previewType: 0, 
						mediaType: 1,
						thumbnail: fs.readFileSync("./src/Utils/assets/buggy.jpg")
					},
				},
			});
		}
		if (receivedPendingNotifications) {
			console.log('[ BUGGY ] - Waiting for new messages!')
		}
		if (connection === "close") {
            const status = lastDisconnect?.error?.output?.statusCode;
            const reason = Object.entries(DisconnectReason).find(i => i[1] === status)?.[0] || 'unknown' ;
            console.log(`[ BUGGY ] - Closed connection, status: ${reason}| ${status}`)

            if (status !== 403 && status !== 401){
				await delay(5000)
                return WaBot()
            }
		}	
	});
		
	sock.ev.on('creds.update', saveCreds); {
		console.log('[ BUGGY ] - Credentials Updated!');
	}
	
	sock.ev.on('messaging-history.set', async (history) =>  {
		const { chats, contacts, messages, isLatest, progress, syncType } = history;
		if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
			console.log('Received On-Demand History Sync, Messages:', messages)
		}
		console.log(`[ BUGGY ] - Received: ${chats.length} Chats, ${contacts.length} Contacts & ${messages.length} Messages. (isLatest: ${isLatest}, progress: ${progress}%), SyncType: ${syncType}`)
	});

	sock.ev.on('messages.upsert', async (chat) => {
		await require('./lib/Events/messages.upsert.js')(chat, sock, Commands);
		await userDataSaver(chat, sock);
		await Data2sqlitedb(chat);
    });
	
	sock.ev.on('messages.update', async () => {
		//console.log(`Message Update:`, JSON.stringify(m));
	});

	sock.decodeJid = (jid) => {
		if (!jid) return jid;
		if (/:\d+@/gi.test(jid)) {
			let decode = jidDecode(jid) || {};
			return (decode.user && decode.server && decode.user + "@" + decode.server) || jid;
		} else return jid;
	};

	sock.ev.on('chats.set', () => {
		console.log('Got some chats..', store.chats.all())
	});

	sock.ev.on('chats.upsert', (chat) => {
		console.log(`Chat upsert: ${chat.id} (${chat.name})`);
	});

	sock.ev.on("contacts.update", (update) => {
		for (let contact of update) {
			let id = jidNormalizedUser(contact.id)
			//console.log(id);
		}
	});

	sock.ev.on('message-receipt.update', (msgupdates) => {
		for (const {key, receipt} of msgupdates) {
			const obj = msgupdates[key.remoteJid];
			const msg = obj === null || obj === void 0? void 0 : obj.get(key.id);
			if (msg) {
				updateMessageWithReceipt(msg, receipt);
				console.log('Message-receipt.update:', updateMessageWithReceipt);
			}
		}
	});

	sock.ev.on('contacts.upsert', (update) => {
		for (let contact of update) {
			let id = jidNormalizedUser(contact.id)
			if(store && store.contacts)
				store.contacts[id] = {
				...(contact || {}),
				isContact:true
			}
		}
	});

	sock.ev.on('contacts.set', () => {
		console.log('New contacts received!', Object.values(store.contacts))
	});

	sock.ev.on('groups.update', async (grpUpdate) => {
		//metadataCache.set(grpUpdate);
		//await groupsUpdate(sock, grpUpdate)
	});

	sock.ev.on('group-participants.update', async ({ id, author, participants, action }) => {		
		//await groupParticipantsUpdate( sock, metadataCache, store, id, author, participants, action )
	});

	// Schedule a function to restart the socket
	setTimeout(() => {
		console.log('Restarting socket...');
		sock.end(new Error('Scheduled socket restart, for stability.'));
	}, restartInterval * 60_000); 
};	

// Start the bot
WaBot()

process.on("unhandledRejection", (err) => console.error(err));
process.on("uncaughtException", (err) => console.error(err));