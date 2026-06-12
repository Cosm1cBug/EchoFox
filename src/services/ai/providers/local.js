/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Local LLM (Ollama) provider adapter (v1.2.0).
 *
 * The ollama npm SDK exposes `{ Ollama }` and a `default` singleton.
 * We instantiate per-config so multiple bot configs / tests can coexist.
 *
 *   - Ollama tool calling follows the OpenAI shape closely
 *     (messages[].tool_calls[].function.{ name, arguments }), and
 *     tool results go back as messages with role: 'tool'.
 *   - No public token billing → cost is reported as 0 by costTracker.
 */
const { config } = require('../../../lib/configLoader');

let _client = null;
let _override = null;

function _getClient() {
  if (_override) return _override;
  if (_client) return _client;
  const { Ollama } = require('ollama');
  _client = new Ollama({ host: config.ai?.providers?.local?.baseUrl || 'http://localhost:11434' });
  return _client;
}

function _resetClientForTests() { _client = null; _override = null; }
function __testOverride(client) { _override = client; }

function _toolsToOllama(tools = []) {
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

function _historyToOllama(system, history) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const t of history) {
    if (t.role === 'tool') {
      out.push({
        role:    'tool',
        content: typeof t.content === 'string' ? t.content : JSON.stringify(t.content),
        ...(t.toolId ? { tool_call_id: t.toolId } : {}),
      });
    } else if (t.role === 'assistant' && t.toolCalls && t.toolCalls.length) {
      out.push({
        role:       'assistant',
        content:    t.content || '',
        tool_calls: t.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.args || {} },
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
    model:    model || config.ai?.providers?.local?.model || config.ai?.model || 'llama3.2',
    messages: _historyToOllama(system, history),
    stream:   false,
    options: {
      num_predict: Number(maxTokens) || Number(config.ai?.maxTokens) || 800,
      ...(typeof temperature === 'number' ? { temperature } : {}),
    },
  };
  const ot = _toolsToOllama(tools);
  if (ot) req.tools = ot;

  const r = await client.chat(req);
  const msg = r.message || {};

  let toolCalls;
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    toolCalls = msg.tool_calls.map((tc, i) => ({
      id:   tc.id || `ollama_${i}_${Date.now()}`,
      name: tc.function?.name,
      args: tc.function?.arguments || {},
    }));
  }

  return {
    content:   msg.content || '',
    toolCalls,
    usage: {
      promptTokens:     r.prompt_eval_count || 0,
      completionTokens: r.eval_count        || 0,
    },
    finishReason: r.done_reason || (r.done ? 'stop' : undefined),
    model:        r.model || req.model,
  };
}

module.exports = { chat, _historyToOllama, _toolsToOllama, _resetClientForTests, __testOverride };
