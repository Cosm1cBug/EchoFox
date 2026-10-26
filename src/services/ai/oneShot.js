/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { config } = require('../../lib/configLoader');
const { getStore } = require('../../store/instance');
const { isConfiguredAdmin } = require('../../lib/jidResolve');
const cost = require('./costTracker');
const router = require('./router');

/** Explicit per-request prompts do not need an enabled ambient opt-in, but
 * MUST honor explicit opt-out, private mode, quotas, privacy and accounting.
 */
async function run({
  sock,
  ctx,
  system,
  prompt,
  maxTokens = 1024,
  temperature = 0.4,
  reaction = '🧠',
}) {
  const providerName = config.ai.defaultProvider;
  const model = config.ai.model;
  const provider = require('./index').providers[providerName];
  if (!provider) throw new Error('Unknown AI provider');
  const history = [{ role: 'user', content: prompt }];
  const inputBytes = Buffer.byteLength(JSON.stringify({ system, history }), 'utf8');
  if (inputBytes > config.ai.maxInputBytes)
    throw Object.assign(new Error('AI prompt exceeds configured byte limit'), {
      code: 'EAI_INPUT_LIMIT',
    });
  maxTokens = Math.min(maxTokens, config.ai.maxTokens);
  const estimate = cost.estimateMaxCostUsd(providerName, model, { inputBytes, maxTokens });
  const context = {
    chatJid: ctx.chat,
    userJid: ctx.sender,
    isAdmin: await isConfiguredAdmin(sock, getStore(), ctx.sender, config.admins, ctx.senderPn),
  };
  const reservation = await router.admitRequest(context, estimate);
  let attempted = false;
  let accounted = false;
  try {
    await ctx.react?.(reaction);
    attempted = true;
    const response = await provider.chat({
      system,
      history,
      tools: [],
      model,
      maxTokens,
      temperature,
    });
    await cost.recordResponse(providerName, response.model || model, response.usage, estimate);
    accounted = true;
    return response;
  } finally {
    try {
      if (attempted && !accounted)
        await cost.recordRaw(providerName, `${model}:unconfirmed-estimate`, estimate);
    } finally {
      cost.release(reservation);
    }
  }
}

module.exports = { run };
