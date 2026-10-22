/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

// Keep the existing JSON-hash layout, but make read/modify/write one Redis
// operation. Concurrent billed calls must not overwrite each other's charge.
const SCRIPT = `
local previous = redis.call('HGET', KEYS[1], ARGV[1])
local current = {prompt_tokens=0, completion_tokens=0, cost_usd=0, calls=0}
if previous then current = cjson.decode(previous) end
for _, field in ipairs({'prompt_tokens', 'completion_tokens', 'cost_usd', 'calls'}) do
  if type(current[field]) ~= 'number' or current[field] < 0 then
    return redis.error_reply('Invalid AI usage ledger')
  end
end
current.prompt_tokens = current.prompt_tokens + tonumber(ARGV[2])
current.completion_tokens = current.completion_tokens + tonumber(ARGV[3])
current.cost_usd = current.cost_usd + tonumber(ARGV[4])
current.calls = current.calls + 1
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(current))
redis.call('EXPIRE', KEYS[1], 8640000)
return 1
`;

async function recordUsage(
  client,
  { day, provider, model, promptTokens = 0, completionTokens = 0, costUsd = 0 },
) {
  const values = [promptTokens, completionTokens, costUsd].map(Number);
  if (!values.every((value) => Number.isFinite(value) && value >= 0))
    throw new Error('Invalid AI usage values');
  const result = await client.eval(
    SCRIPT,
    1,
    `ai_usage:${day}`,
    `${provider || ''}:${model || ''}`,
    ...values,
  );
  if (Number(result) !== 1) throw new Error('AI usage ledger write failed');
  return true;
}

function totalUsage(values) {
  let total = 0;
  for (const value of Object.values(values || {})) {
    const row = JSON.parse(value);
    if (typeof row.cost_usd !== 'number' || !Number.isFinite(row.cost_usd) || row.cost_usd < 0)
      throw new Error('Invalid AI usage ledger');
    total += row.cost_usd;
  }
  return total;
}
module.exports = { SCRIPT, recordUsage, totalUsage };
