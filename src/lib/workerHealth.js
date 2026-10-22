/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

// `killed` means kill() was requested, NOT that a naturally exited process is
// alive. Keep this observational helper separate from restart/shutdown policy.
function isWorkerAlive(worker) {
  return !!worker?.pid && !worker.killed && worker.exitCode === null && worker.signalCode === null;
}
module.exports = { isWorkerAlive };
