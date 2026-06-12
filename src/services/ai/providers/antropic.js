/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Anthropic Claude provider adapter (v1.2.0).
 *
 * Quirks:
 *   • `system` is a top-level field, NOT a message
 *   • tool use is content-block based: `{ type: 'tool_use', id, name, input }`
 *     and `{ type: 'tool_result', tool_use_id, content }`
 *   • messages alternate user/assistant; tool_result goes in a `user` message
 *   • SDK is a default export → `require('@anthropic-ai/sdk').default`
 */
const { config } = require('../../../lib/configLoader');

let _client = null;
let _override = null;

function _getClient() {
  if (_override) return _override;
  if (_client) return _client;
  const AnthropicMod = require('@anthropic-ai/sdk');
  const Anthropic = AnthropicMod.default || AnthropicMod;
  _client = new Anthropic({
    apiKey:  config.ai?.providers?.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY || '',
    ...(config.ai?.providers?.anthropic?.baseUrl ? { baseURL: config.ai.providers.anthropic.baseUrl } : {}),
  });
  return _client;
}

function _resetClientForTests() { _client = null; _override = null; }
function __testOverride(client) { _override = client; }

function _toolsToAnthropic(tools = []) {
  if (!tools.length) return undefined;
  return tools.map((t) => ({
    name:         t.name,
    description:  t.description,
    input_schema: t.parameters,
  }));
}

function _historyToAnthropic(history) {
  const out = [];
  let pending = null;

  const flush = () => { if (pending) { out.push(pending); pending = null; } };

  for (const t of history) {
    if (t.role === 'tool') {
      // tool result -> user-role tool_result content block
      flush();
      out.push({
        role: 'user',
        content: [{
          type:         'tool_result',
          tool_use_id:  t.toolId,
          content:      typeof t.content === 'string' ? t.content : JSON.stringify(t.content),
        }],
      });
    } else if (t.role === 'assistant' && t.toolCalls && t.toolCalls.length) {
      flush();
      const content = [];
      if (t.content) content.push({ type: 'text', text: t.content });
      for (const tc of t.toolCalls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args || {} });
      }
      out.push({ role: 'assistant', content });
    } else {
      flush();
      out.push({ role: t.role === 'assistant' ? 'assistant' : 'user', content: t.content || '' });
    }
  }
  flush();
  return out;
}

async function chat({ system, history = [], tools = [], model, maxTokens, temperature }) {
  const client = _getClient();
  const req = {
    model:       model || config.ai?.model || 'claude-3-5-haiku-latest',
    max_tokens:  Number(maxTokens) || Number(config.ai?.maxTokens) || 800,
    messages:    _historyToAnthropic(history),
  };
  if (system) req.system = system;
  if (typeof temperature === 'number') req.temperature = temperature;
  const at = _toolsToAnthropic(tools);
  if (at) req.tools = at;

  const r = await client.messages.create(req);

  let text = '';
  const toolCalls = [];
  for (const block of (r.content || [])) {
    if (block.type === 'text')     text += block.text || '';
    else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, args: block.input || {} });
    }
  }

  return {
    content:   text,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    usage: {
      promptTokens:     r.usage?.input_tokens  || 0,
      completionTokens: r.usage?.output_tokens || 0,
    },
    finishReason: r.stop_reason,
    model:        r.model,
  };
}

module.exports = { chat, _historyToAnthropic, _toolsToAnthropic, _resetClientForTests, __testOverride };
