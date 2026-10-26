#!/usr/bin/env node
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

function parseAudit(text, status) {
  if (![0, 1].includes(status)) throw new Error('npm audit could not complete');
  const report = JSON.parse(text);
  if (report.error || !report.metadata?.vulnerabilities)
    throw new Error('npm audit returned an error or missing metadata');
  const counts = report.metadata.vulnerabilities;
  const severities = ['info', 'low', 'moderate', 'high', 'critical'];
  for (const key of [...severities, 'total']) {
    if (!Number.isInteger(counts[key]) || counts[key] < 0)
      throw new Error('npm audit returned invalid vulnerability counts');
  }
  if (severities.reduce((total, key) => total + counts[key], 0) !== counts.total)
    throw new Error('npm audit returned inconsistent counts');
  return { highCritical: counts.high + counts.critical, total: counts.total };
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (part) => {
    input += part;
  });
  process.stdin.on('end', () => {
    try {
      const counts = parseAudit(input, Number(process.argv[2]));
      console.log(
        `production audit: ${counts.highCritical} high/critical; ${counts.total} total findings`,
      );
      process.exitCode = counts.highCritical ? 1 : 0;
    } catch {
      // Registry error bodies can include credentials. Do not print raw JSON.
      console.error(
        'Audit unavailable or malformed — gate failed, not a zero-vulnerability result.',
      );
      process.exitCode = 2;
    }
  });
}

module.exports = { parseAudit };
