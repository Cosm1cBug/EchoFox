const fs = require('fs');

let oldMetadata = {};

async function groupsUpdate( sock, store, grpUpdate) {
  try {
    const id = grpUpdate.id;
    const { metadataCache } = require('../cache');
    const metadata = await metadataCache.get(id);
    const groupName = metadata.subject;
    const groupDesc = metadata.desc;
    const groupSize = metadata.participants.length;
    const superAdmin = metadata.participants.find((participant) => participant.isSuperAdmin).id;
    const admins = metadata.participants
      .filter((participant) => participant.isAdmin)
      .map((admin) => admin.id);
      
    if (oldMetadata[id]) {

      const oldMeta = oldMetadata[id];

      if (groupName !== oldMeta.subject) {
        console.log(`Group name updated: ${groupName}`);
      }
      if (groupDesc !== oldMeta.desc) {
        console.log(`Group description updated: ${groupDesc}`);
      }
      if (groupSize !== oldMeta.participants.length) {
        console.log(`Group size updated: ${groupSize}`);
      }
      if (superAdmin !== oldMeta.participants.find((participant) => participant.isSuperAdmin).id) {
        console.log(`Super admin updated: ${superAdmin}`);
      }
      if (!admins.every((admin) => oldMeta.participants.some((participant) => participant.id === admin && participant.isAdmin))) {
        console.log(`Admins updated: ${admins.map((admin) => admin).join(', ')}`);
      }
    }
  
    oldMetadata[id] = metadata;

  } catch (error) {
    console.error(`Error processing group update ${grpUpdate.id}:`, error);
  }
}

module.exports = { groupsUpdate };