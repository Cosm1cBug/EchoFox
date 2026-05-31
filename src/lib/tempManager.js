/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const tempDir = path.join(__dirname, '..', '..', 'temp');

function initTempDir() {
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
}

function getTempFile(ext = '') {
    initTempDir();
    const name = crypto.randomBytes(8).toString('hex') + (ext.startsWith('.') ? ext : `.${ext}`);
    return path.join(tempDir, name);
}

function startGC(logger) {
    initTempDir();
    // Run every 15 minutes
    setInterval(() => {
        try {
            const files = fs.readdirSync(tempDir);
            const now = Date.now();
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                const stats = fs.statSync(filePath);
                // Delete files older than 30 minutes
                if (now - stats.mtimeMs > 30 * 60 * 1000) {
                    fs.unlinkSync(filePath);
                }
            }
        } catch (e) {
            logger?.warn({ err: e }, 'Temp GC failed');
        }
    }, 15 * 60 * 1000).unref();
}

module.exports = { tempDir, getTempFile, startGC };