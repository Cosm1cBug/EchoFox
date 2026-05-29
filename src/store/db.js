const { makeSQLiteStore } = require('./sqliteStore');
const { makePostgresStore } = require('./postgresStore');
const { makeMongoStore } = require('./mongoStore');
const { makeRedisStore } = require('./redisStore');

function createStore(config, logger, groupCache) {
    const type = config.storeDB.type.toUpperCase();
    if (type === 'POSTGRES') {
        return makePostgresStore(config.storeDB.postgresUrl, logger, groupCache);
    } else if (type === 'MONGODB') {
        return makeMongoStore(config.storeDB.mongoUri, logger, groupCache);
    } else if (type === 'REDIS') {
        return makeRedisStore(config.storeDB.redisUrl, logger, groupCache);
    } else {
        return makeSQLiteStore({
            dbPath: config.storeDB.sqlitePath || './src/store/runtime/wa.db',
            logger,
            groupCache
        });
    }
}

module.exports = { createStore };