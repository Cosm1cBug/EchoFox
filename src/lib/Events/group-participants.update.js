const { config }  = require("../../config");
const fs = require('fs');


async function groupParticipantsUpdate( sock, m, metadataCache, store, id, author, participants, action ) {
	try {
		const { metadataCache } = require('../cache');
		const metadata = await metadataCache.get(id);

		if (!metadata) {
            console.log(`Metadata for group ID: ${id} not found in cache. Fetching...`);
            metadata = await sock.groupMetadata(id); // Fetch from WhatsApp API
            metadataCache.set(id, metadata); // Cache the fetched metadata
        }

		const groupName = metadata.title || metadata.subject;
		const groupSize = metadata.size;
		const superAdmin = metadata.owner;
	
		for (const jid of participants) {
			if (action == 'add') {
				sock.sendMessage(config.WApp.GrpUpdates, {text: `Participant added in: ${groupName}\nAdded by: ${author}\nParticipant: ${jid.split('@')[0]}\n\nGroup Size: ${groupSize}\n\nOwner: ${superAdmin}`});
			} else if (action  == 'promote'){
				sock.sendMessage(config.WApp.GrpUpdates, {text: `Participant promoted in: ${metadata.subject}\nAuthor: ${author}\nParticipant: ${jid}`})
			} else if (action == 'demote'){
				sock.sendMessage(config.WApp.GrpUpdates, {text: `Participant demoted in: ${metadata.subject}\nAuthor: ${author}\nParticipant: ${jid}`})
			} else if (action == 'remove'){
				sock.sendMessage(config.WApp.GrpUpdates, {text: `Participant removed in: ${metadata.subject}\nAuthor: ${author}\nParticipant: ${jid}`})
			}
		}
	}
	catch (error){
		console.log('Error: Group Participants Update:\n',error);
	}
}

module.exports = { groupParticipantsUpdate };