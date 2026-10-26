/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

// Opt-in diagnostics before the existing 60-second test deadline. This never
// forces exit, ignores failures, closes application resources, or extends timeouts.
if (process.env.TEST_RESOURCE_DIAGNOSTICS === '1') {
  const report = () => {
    const resources = process.getActiveResourcesInfo();
    const counts = resources.reduce((out, name) => {
      out[name] = (out[name] || 0) + 1;
      return out;
    }, {});
    // Types/counts only: no request headers, arguments, DB URLs or credentials.
    console.error(
      JSON.stringify({ event: 'test-resource-diagnostics', pid: process.pid, resources: counts }),
    );
  };
  const timer = setInterval(report, 45000);
  timer.unref();
}
