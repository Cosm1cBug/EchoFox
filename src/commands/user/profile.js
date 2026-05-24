const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { config } = require("../../config");
const { getStream } = require('@whiskeysockets/baileys');

module.exports = {
    name: "profile",
    alias: ["me"],
    info: "profile Check Information",
    type: "user",
    start: async(sock, m ) => {

		let usrData;

		try {
			usrData = await sock.fetchStatus(m.from);
			if (!usrData || usrdata.length === 0) {
				throw new Error("No user status data available.");
			}
		} catch (error) {
			usrdata = [{ id: "Unknown", status: { status: "No status available"} }];
		}

		let pp;

		try {
			// Attempt to fetch the profile pictire url
			pp = await sock.profilePictureUrl(m.from, 'image');
			// Check if the URL is valid (not empty or null)
            if (!pp || pp === "") {
                throw new Error("Invalid profile picture URL.");
            }

		} catch (error) {
			console.error("Error fetching profile picture:", error);

			try {
				const businessProfile = await sock.getBusinessProfile(m.from);
				if (businessProfile && businessProfile.profilePictureUrl) {
					pp = businessProfile.profilePictureUrl;
				} else {
					throw new Error("Business profile picture not available.");
				}
			} catch (businessError) {
				console.error("Error fetching business profile:", businessError);

				const defaultImg = path.join(__dirname, "../../Utils/assets/default.jpg");
				//Check if the default image exists or not.
				if (fs.existsSync(defaultImg)) {
					pp = fs.createReadStream(defaultImg);
				} else {
					//console.error("Default image not found at:", defaultImg);
					return sock.sendMessage(config.WApp.ErrLogs, { 
						text: `Error: Default image not found at: ${defaultImg}`
					}, { quoted: m });
				}
			}		
		}
		// Check if pp is a valid stream or path, log if it's still undefined
        if (!pp) {
            //console.error("Error: Profile picture or default image not found.");
            return sock.sendMessage(config.WApp.ErrLogs, { 
            	text: "Error: Profile picture or default image not found." 
            }, { quoted: m });
        }

		// Prepare the caption with profile information
		let caption =  `Name : ${m.pushName}\n`;
		    caption += `ID : ${usrData[0].id}\n`;
		    caption += `About : ${usrData[0].status.status}\n`;

		// Send the profile picture along with the caption
		try {
            sock.sendMessage(m.from, {
            	text: caption,
                contextInfo: {
                    externalAdReply: {
                        showAdAttribution: false,
                        renderLargerThumbnail: true,
                        title: 'PROFILE',
                        body: 'User profile',
                        previewType: 0,
                        mediaType: 1,
                        thumbnailUrl: pp,
                    }
                }
            }, {quoted: m}); 
		} catch (error) {
			console.error("Error sending message:", error);
		}
    }
};

