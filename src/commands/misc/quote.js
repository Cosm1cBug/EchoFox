
const fs = require('fs');
const { config }  = require('../../config.js');

module.exports = {
    name: 'dlang',
    alias: ['mov'],
    //type: "entertainment",
    start: async(sock, m, { command, prefix, text }) => {
        const DetectLanguage = require('detectlanguage');
        var detectLang = new DetectLanguage('fd575662941c54af6f308031f3ff395f');
        var cntxt = text;
        console.log(text)
        detectLang.detect(text).then(function(result) {
            console.log(result)
            console.log(JSON.stringify(result));

        });
    }
}



