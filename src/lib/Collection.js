'use strict';
/**
 * Backwards-compat shim. The old code passed a `Collection` (extends Map) to
 * commands so they could do `commands.get(name)` / iterate. The new
 * CommandRegistry exposes `commands.resolve(name)` and `commands.all()`.
 * For old commands that still pass `commands` straight from the handler,
 * we still expose a `.get(name)` and `.values()` so they don't break.
 *
 * If you want to construct one manually:
 *
 *     const c = new Collection();
 *     c.set('ping', { name: 'ping', start: …});
 */
class Collection extends Map {
  setOptions(name, options = {}) {
    const cmd = this.get(name);
    if (!cmd) return null;
    this.set(name, { ...cmd, options: { ...cmd.options, ...options } });
    return this.get(name);
  }
  rename(oldName, newName) {
    const cmd = this.get(oldName);
    if (!cmd || this.has(newName)) return null;
    this.set(newName, { ...cmd, name: newName, alias: [] });
    this.delete(oldName);
    return this.get(newName);
  }
}
module.exports = Collection;
