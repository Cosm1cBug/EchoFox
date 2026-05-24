const NodeCache = require('node-cache');

const retryCache = new NodeCache({
    stdTTL: 20,
    checkperiod: 20
}) 

const metadataCache =new NodeCache({
    stdTTL: 3600,
    checkperiod: 30,
    deleteOnExpire: true
})

module.exports = { metadataCache, retryCache }