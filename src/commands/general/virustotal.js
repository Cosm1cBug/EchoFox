const fetch = require('node-fetch');
const { config } = require("../../config");
const util = require('util');
// VirusTotal API key
const VIRUSTOTAL_API_KEY = config.virustotal.key;

// Export the command
module.exports = {
    name: 'virustotal',
    alias: ['vt'], 
    usage: '<IP/URL/Domain>',
    desc: 'Check IP/URL/Domains/Hashes in VirusTotal',
    type: 'general',
    start: async (sock, m, body, { text = '' }, args, arg) => {

        const options = {
            method: 'GET',
            headers: {
              accept: 'application/json',
              'x-apikey': '38525b92d9666a6ce85cdee9a92883e3455109bb7fb459431dc6724056b18a8f'
            }
        };
          
        fetch(`https://www.virustotal.com/api/v3/ip_addresses/${text}`, options)
            .then(res => res.json())
            .then(res => console.log(res))
            .catch(err => console.error(err));

    },
    
};