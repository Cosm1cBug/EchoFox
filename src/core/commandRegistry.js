'use strict';
/**
 * CommandRegistry
 *  • Loads commands lazily and recursively from a directory.
 *  • Supports hot-reload (fs.watch) without restarting the bot.
 *  • Builds an alias→name map so command lookup is O(1).
 */
const fs = require('node:fs');
const path = require('node:path');

class CommandRegistry {
  constructor({ dir, prefix, logger }) {
    this.dir = dir;
    this.prefix = prefix;
    this.logger = logger;
    this.commands = new Map();   // name -> cmd
    this.aliases  = new Map();   // alias -> name
    this.categories = new Map(); // category -> [cmd]
  }

  async load() {
    this.commands.clear();
    this.aliases.clear();
    this.categories.clear();

    const cats = fs.readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const cat of cats) {
      const catDir = path.join(this.dir, cat.name);
      const files = fs.readdirSync(catDir).filter((f) => f.endsWith('.js'));
      const list = [];
      for (const f of files) {
        const full = path.join(catDir, f);
        try {
          delete require.cache[require.resolve(full)];
          const cmd = require(full);
          if (!cmd?.name || typeof cmd.start !== 'function') {
            this.logger.warn({ file: full }, 'skipped: malformed command');
            continue;
          }
          cmd.category = cat.name;
          this.commands.set(cmd.name.toLowerCase(), cmd);
          for (const a of cmd.alias || []) this.aliases.set(a.toLowerCase(), cmd.name.toLowerCase());
          list.push(cmd);
        } catch (e) {
          this.logger.error({ err: e, file: full }, 'failed to load command');
        }
      }
      this.categories.set(cat.name, list);
    }

    this.logger.info({ commands: this.commands.size, categories: this.categories.size }, 'commands loaded');

    // Hot-reload (debounced)
    if (!this._watching) {
      this._watching = true;
      let t;
      fs.watch(this.dir, { recursive: true }, () => {
        clearTimeout(t);
        t = setTimeout(() => this.load().catch(() => {}), 250);
      });
    }
  }

  resolve(name) {
    if (!name) return null;
    const lower = name.toLowerCase();
    return this.commands.get(lower) || this.commands.get(this.aliases.get(lower)) || null;
  }

  all() { return [...this.commands.values()]; }
}

module.exports = CommandRegistry;
