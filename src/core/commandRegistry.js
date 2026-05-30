/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';
/**
 * CommandRegistry
 *  • Loads commands lazily and recursively from a directory.
 *  • Supports hot-reload (fs.watch) without restarting the bot.
 *  • Builds an alias→name map so command lookup is O(1).
 *  • Honours per-command `requires: ['apis.omdb.apiKey']` declarations
 *    and skips (with a warning) commands whose dependencies are missing.
 *  • Ignores hidden / underscore-prefixed category folders (e.g. `_disabled/`).
 *  • v0.4.5: one failing command file no longer aborts the whole registry
 *    load — it's recorded in `this.skipped[]` and the rest continue.
 */
const fs   = require('node:fs');
const path = require('node:path');

function dig(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function isMissing(v) {
  if (v == null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

class CommandRegistry {
  constructor({ dir, prefix, logger, config }) {
    this.dir        = dir;
    this.prefix     = prefix;
    this.logger     = logger;
    this.config     = config || {};
    this.commands   = new Map();
    this.aliases    = new Map();
    this.categories = new Map();
    this.skipped    = [];
  }

  async load() {
    this.commands.clear();
    this.aliases.clear();
    this.categories.clear();
    this.skipped = [];

    const cats = fs.readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory()
        && !d.name.startsWith('_')
        && !d.name.startsWith('.'));

    for (const cat of cats) {
      const catDir = path.join(this.dir, cat.name);
      const files  = fs.readdirSync(catDir).filter((f) => f.endsWith('.js'));
      const list   = [];

      for (const f of files) {
        const full = path.join(catDir, f);
        let cmd;
        try {
          delete require.cache[require.resolve(full)];
          cmd = require(full);
        } catch (e) {
          this.logger.error({ err: e, file: full }, 'failed to load command (optional dep missing?)');
          this.skipped.push({ name: f, file: full, reason: 'load_error', err: e.message });
          continue;
        }
        if (!cmd?.name || typeof cmd.start !== 'function') {
          this.logger.warn({ file: full }, 'skipped: malformed command (missing .name or .start)');
          this.skipped.push({ name: f, file: full, reason: 'malformed' });
          continue;
        }

        if (Array.isArray(cmd.requires) && cmd.requires.length) {
          const missing = cmd.requires.filter((req) => isMissing(dig(this.config, req)));
          if (missing.length) {
            this.logger.warn({ cmd: cmd.name, missing },
              `skipped: '${cmd.name}' requires unset config (${missing.join(', ')})`);
            this.skipped.push({ name: cmd.name, file: full, reason: 'missing_config', missing });
            continue;
          }
        }

        cmd.category = cat.name;
        const lower  = cmd.name.toLowerCase();
        this.commands.set(lower, cmd);
        for (const a of cmd.alias || []) this.aliases.set(a.toLowerCase(), lower);
        list.push(cmd);
      }

      if (list.length) this.categories.set(cat.name, list);
    }

    this.logger.info({
      loaded:     this.commands.size,
      categories: this.categories.size,
      skipped:    this.skipped.length,
    }, 'commands loaded');

    if (!this._watching) {
      this._watching = true;
      let t;
      try {
        fs.watch(this.dir, { recursive: true }, () => {
          clearTimeout(t);
          t = setTimeout(() => this.load().catch((e) =>
            this.logger.error({ err: e }, 'hot-reload failed')), 250);
        });
      } catch (e) {
        this.logger.debug({ err: e }, 'fs.watch recursive unsupported; hot-reload disabled');
      }
    }
  }

  resolve(name) {
    if (!name) return null;
    const lower = name.toLowerCase();
    return this.commands.get(lower)
        || this.commands.get(this.aliases.get(lower))
        || null;
  }

  all() { return [...this.commands.values()]; }

  describe() {
    const out = {};
    for (const [cat, list] of this.categories) {
      out[cat] = list.map((c) => ({
        name:    c.name,
        alias:   c.alias || [],
        desc:    c.desc || '',
        admin:   !!c.admin,
        group:   !!c.group,
        requires: c.requires || [],
      }));
    }
    return out;
  }
}

module.exports = CommandRegistry;