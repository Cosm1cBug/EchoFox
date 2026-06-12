/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * OpenAI provider adapter (v1.2.0).
 *
 *   chat({ system, history, tools, model, maxTokens })
 *     -> { content, toolCalls?, usage: { promptTokens, completionTokens } }
 *
 *   - `system`   string
 *   - `history`  array of { role: 'user'|'assistant'|'tool', content, toolName?, toolId? }
 *   - `tools`    array of { name, description, parameters } from toolRegistry.getActiveSpec()
 *
 * Uses singleton client pattern; _resetClientForTests() + __testOverride
 * allow mocking from tests without touching env.
 */
const { config } = require('../../../lib/configLoader');

let _client = null;
let _override = null;

function _getClient() {
  if (_override) return _override;
  if (_client) return _client;
  // Lazy-require so missing SDK doesn't crash boot when ai.enabled = false.
  const OpenAI = require('openai').default || require('openai');
  const opts = {
    apiKey: config.ai?.providers?.openai?.apiKey || process.env.OPENAI_API_KEY || '',
  };
  if (config.ai?.providers?.openai?.baseUrl) opts.baseURL = config.ai.providers.openai.baseUrl;
  _client = new OpenAI(opts);
  return _client;
}

function _resetClientForTests() { _client = null; _override = null; }
function __testOverride(client) { _override = client; }

function toOpenAITools(tools = []) {
  if (!tools.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name:        t.name,
      description: t.description,
      parameters:  t.parameters,
    },
  }));
}

/** History rows -> OpenAI message rows. */
function toOpenAIMessages(system, history) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });

  for (const t of history) {
    if (t.role === 'tool') {
      out.push({
        role:           'tool',
        tool_call_id:   t.toolId || `tool_${Date.now()}`,
        content:        typeof t.content === 'string' ? t.content : JSON.stringify(t.content),
      });
    } else if (t.role === 'assistant' && t.toolCalls && t.toolCalls.length) {
      out.push({
        role:       'assistant',
        content:    t.content || '',
        tool_calls: t.toolCalls.map((tc) => ({
          id:       tc.id,
          type:     'function',
          function: { name: tc.name, arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {}) },
        })),
      });
    } else {
      out.push({ role: t.role, content: t.content || '' });
    }
  }
  return out;
}

async function chat({ system, history = [], tools = [], model, maxTokens, temperature }) {
  const client = _getClient();
  const req = {
    model:      model || config.ai?.model || 'gpt-4o-mini',
    messages:   toOpenAIMessages(system, history),
    max_tokens: Number(maxTokens) || Number(config.ai?.maxTokens) || 800,
  };
  if (typeof temperature === 'number') req.temperature = temperature;
  const oaiTools = toOpenAITools(tools);
  if (oaiTools) {
    req.tools       = oaiTools;
    req.tool_choice = 'auto';
  }

  const r = await client.chat.completions.create(req);
  const choice = r.choices?.[0];
  const msg = choice?.message || {};

  let toolCalls;
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    toolCalls = msg.tool_calls.map((tc) => {
      let args = {};
      try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; }
      catch { args = { __raw: tc.function?.arguments }; }
      return { id: tc.id, name: tc.function?.name, args };
    });
  }

  return {
    content:   msg.content || '',
    toolCalls,
    usage: {
      promptTokens:     r.usage?.prompt_tokens     || 0,
      completionTokens: r.usage?.completion_tokens || 0,
    },
    finishReason: choice?.finish_reason,
    model:        r.model,
  };
}

module.exports = { chat, toOpenAITools, toOpenAIMessages, _resetClientForTests, __testOverride };
