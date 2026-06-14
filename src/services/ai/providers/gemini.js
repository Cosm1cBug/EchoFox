/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Google Gemini provider adapter (v1.2.0).
 *
 * Gemini SDK quirks:
 *   • systemInstruction is set on the model, NOT in messages
 *   • function declarations live in `tools[0].functionDeclarations`
 *   • roles are 'user' and 'model' (no 'assistant')
 *   • tool results go back in a 'function' role part
 *   • usage is on response.usageMetadata: promptTokenCount / candidatesTokenCount
 */
const { config } = require('../../../lib/configLoader');

let _client = null;
let _override = null;

function _getClient() {
  if (_override) return _override;
  if (_client) return _client;
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  _client = new GoogleGenerativeAI(
    config.ai?.providers?.gemini?.apiKey || process.env.GEMINI_API_KEY || '',
  );
  return _client;
}

function _resetClientForTests() {
  _client = null;
  _override = null;
}
function __testOverride(client) {
  _override = client;
}

function _toolsToGemini(tools = []) {
  if (!tools.length) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

function _historyToGemini(history) {
  // Gemini wants parts arrays. Tool results become `functionResponse` parts
  // attached to the matching assistant turn (we emit a 'user' role with
  // a functionResponse part right after the assistant's functionCall).
  const out = [];
  for (const t of history) {
    if (t.role === 'tool') {
      out.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: t.toolName || 'tool',
              response:
                typeof t.content === 'string'
                  ? (() => {
                      try {
                        return JSON.parse(t.content);
                      } catch {
                        return { result: t.content };
                      }
                    })()
                  : t.content,
            },
          },
        ],
      });
    } else if (t.role === 'assistant' && t.toolCalls && t.toolCalls.length) {
      const parts = [];
      if (t.content) parts.push({ text: t.content });
      for (const tc of t.toolCalls) {
        parts.push({ functionCall: { name: tc.name, args: tc.args || {} } });
      }
      out.push({ role: 'model', parts });
    } else {
      out.push({
        role: t.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: t.content || '' }],
      });
    }
  }
  return out;
}

async function chat({ system, history = [], tools = [], model, maxTokens, temperature }) {
  const client = _getClient();
  const m = client.getGenerativeModel({
    model: model || config.ai?.model || 'gemini-2.0-flash',
    systemInstruction: system || undefined,
    tools: _toolsToGemini(tools),
    generationConfig: {
      maxOutputTokens: Number(maxTokens) || Number(config.ai?.maxTokens) || 800,
      ...(typeof temperature === 'number' ? { temperature } : {}),
    },
  });

  const contents = _historyToGemini(history);
  const r = await m.generateContent({ contents });

  const resp = r.response;
  const cand = resp?.candidates?.[0];
  const parts = cand?.content?.parts || [];

  let text = '';
  const toolCalls = [];
  for (const p of parts) {
    if (p.text) text += p.text;
    if (p.functionCall) {
      toolCalls.push({
        id: `gem_${toolCalls.length}_${Date.now()}`,
        name: p.functionCall.name,
        args: p.functionCall.args || {},
      });
    }
  }

  return {
    content: text,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    usage: {
      promptTokens: resp?.usageMetadata?.promptTokenCount || 0,
      completionTokens: resp?.usageMetadata?.candidatesTokenCount || 0,
    },
    finishReason: cand?.finishReason,
    model: model || config.ai?.model || 'gemini-2.0-flash',
  };
}

module.exports = { chat, _historyToGemini, _toolsToGemini, _resetClientForTests, __testOverride };
