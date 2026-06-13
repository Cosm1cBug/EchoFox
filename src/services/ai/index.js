/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * AI service facade (v1.2.0).
 *
 *   chat({ chatJid, userJid, text, providerName?, modelName?, persona? })
 *     -> { reply, usage: { promptTokens, completionTokens, costUsd },
 *          rounds, toolCalls: [{name,args,result}] }
 *
 * Responsibilities:
 *   1. resolve provider, model, persona (per-chat override → config default)
 *   2. load rolling-window history from conversationStore
 *   3. persist the user turn immediately (so memory survives crashes)
 *   4. run a tool-call loop (max MAX_TOOL_ROUNDS rounds)
 *   5. on each round: aggregate token usage; on tool_use, dispatch via
 *      toolRegistry.invoke() and feed result back to the model
 *   6. record cost to ai_usage_daily via costTracker.record()
 *   7. persist the final assistant turn
 *
 * Streaming UX: this module does NOT stream incrementally. The caller
 * (messages.upsert.js in Group C) handles the 'composing' presence
 * indicator while this promise is in flight, then sends a single
 * finished message.
 */
const logger = require('../../core/logger').child({ mod: 'ai' });
const { config } = require('../../lib/configLoader');

const conv      = require('./conversationStore');
const router    = require('./router');
const cost      = require('./costTracker');
const personas  = require('./personas');
const tools     = require('./toolRegistry');
const metrics   = require('../metrics');

const providers = {
  openai:    require('./providers/openai'),
  gemini:    require('./providers/gemini'),
  anthropic: require('./providers/anthropic'),
  local:     require('./providers/local'),
};

const MAX_TOOL_ROUNDS = 3;

function _resolveProvider(name) {
  const p = providers[name];
  if (!p) throw new Error(`unknown AI provider: ${name}`);
  return p;
}

function _resolveSettings({ optIn, providerName, modelName, persona }) {
  const aiCfg = config.ai || {};
  return {
    provider: providerName || optIn?.provider || aiCfg.defaultProvider || 'openai',
    model:    modelName    || optIn?.model    || aiCfg.model           || 'gpt-4o-mini',
    persona:  persona      || optIn?.persona  || aiCfg.persona         || 'threat-intel',
  };
}

/**
 * Main entry point. Caller MUST have already gated through router.shouldRespond().
 */
async function chat({ chatJid, userJid, text, optIn, providerName, modelName, persona: personaName }) {
  metrics.incAiRequest('start');
  const aiCfg = config.ai || {};
  const { provider, model, persona: pname } = _resolveSettings({ optIn, providerName, modelName, persona: personaName });

  const system = personas.pick({ persona: pname, customPersona: aiCfg.customPersona });
  const prov = _resolveProvider(provider);

  // 1) persist user turn early
  const userTs = Date.now();
  await conv.append(chatJid, { role: 'user', content: text, ts: userTs });

  // 2) load rolling window (already includes the just-appended user turn)
  const memTurns = Math.max(0, Number(aiCfg.memoryTurns) || 20);
  const history = await conv.recent(chatJid, memTurns);

  // 3) tool spec (intersected with whitelist + key presence)
  const toolSpec = aiCfg.enableToolCalling ? tools.getActiveSpec() : [];

  // 4) tool-call loop
  const aggUsage   = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
  const toolTrace  = [];
  let rounds = 0;
  let finalContent = '';
  const workingHistory = history.slice();   // local copy we mutate per round

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds += 1;

    const resp = await prov.chat({
      system,
      history: workingHistory,
      tools:   toolSpec,
      model,
      maxTokens: aiCfg.maxTokens,
    });

    // accumulate token + cost
    const { costUsd } = await cost.record(provider, resp.model || model,
      resp.usage?.promptTokens || 0, resp.usage?.completionTokens || 0);
    metrics.incAiTokens(resp.usage?.promptTokens || 0, resp.usage?.completionTokens || 0);
    aggUsage.promptTokens     += resp.usage?.promptTokens     || 0;
    aggUsage.completionTokens += resp.usage?.completionTokens || 0;
    aggUsage.costUsd          += costUsd;

    // No tool calls → final answer
    if (!resp.toolCalls || !resp.toolCalls.length) {
      finalContent = resp.content || '';
      break;
    }

    // Append the assistant tool-call turn to working history AND persist it
    const assistantTurn = {
      role:      'assistant',
      content:   resp.content || '',
      toolCalls: resp.toolCalls,
      model:     resp.model || model,
      provider,
      promptTokens:     resp.usage?.promptTokens     || 0,
      completionTokens: resp.usage?.completionTokens || 0,
      ts:        Date.now(),
    };
    workingHistory.push(assistantTurn);
    await conv.append(chatJid, assistantTurn);

    // Dispatch each tool call, append result
    for (const tc of resp.toolCalls) {
      const r = await tools.invoke(tc.name, tc.args);
      metrics.incAiTool(r.ok ? 'success' : 'failure');
      const resultContent = r.ok ? JSON.stringify(r.result) : JSON.stringify({ error: r.error });
      toolTrace.push({ name: tc.name, args: tc.args, ok: r.ok, result: r.result, error: r.error });
      const toolTurn = {
        role:     'tool',
        content:  resultContent,
        toolName: tc.name,
        toolId:   tc.id,
        ts:       Date.now(),
      };
      workingHistory.push(toolTurn);
      await conv.append(chatJid, toolTurn);
    }

    // loop again — model may produce another tool_use round or a final reply.
    // Loop terminates either by no toolCalls or hitting MAX_TOOL_ROUNDS.
    if (rounds === MAX_TOOL_ROUNDS) {
      finalContent = resp.content || '(reached max tool rounds)';
    }
  }

  // 5) persist the final assistant turn (only if not already persisted as a tool-call turn)
  if (finalContent) {
    await conv.append(chatJid, {
      role:     'assistant',
      content:  finalContent,
      model,
      provider,
      promptTokens:     aggUsage.promptTokens,
      completionTokens: aggUsage.completionTokens,
      ts:       Date.now(),
    });
  }

  // 6) bump rate counters
  try { router.noteSent({ chatJid, userJid }); } catch (e) { logger.warn({ err: e }, 'noteSent failed'); }

  return {
    reply:     finalContent,
    rounds,
    provider,
    model,
    persona:   pname,
    usage:     aggUsage,
    toolCalls: toolTrace,
  };
}

async function clearMemory(chatJid) {
  return conv.clear(chatJid);
}

module.exports = {
  chat,
  clearMemory,
  MAX_TOOL_ROUNDS,
  // re-exports for tests + commands
  router,
  cost,
  conv,
  tools,
  personas,
  providers,
};
