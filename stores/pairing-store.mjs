// SQLite-backed stand-in for the Durable Object namespace binding used by panel/src/app-pairing.js.
// The Worker only needs: idFromName(name) -> id, get(id) -> stub, stub.fetch(Request) -> Response,
// and on the object side state.storage.{get,put,delete,deleteAll,setAlarm,transaction}.
// Semantics preserved: one object per name, requests to the same object run one at a time,
// transaction() is atomic, alarm() fires after setAlarm() and wipes the object's storage.
import { DatabaseSync } from "node:sqlite";

export class SqliteDurableObjectNamespace {
  constructor({ databasePath, className, ObjectClass, env, log = console }) {
    this.className = className;
    this.ObjectClass = ObjectClass;
    this.env = env;
    this.log = log;
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS do_storage (
        class TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY (class, name, key)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS do_alarm (
        class TEXT NOT NULL, name TEXT NOT NULL, at INTEGER NOT NULL,
        PRIMARY KEY (class, name)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS idx_do_alarm_at ON do_alarm(at);
    `);
    this.statements = {
      get: this.db.prepare("SELECT value FROM do_storage WHERE class = ? AND name = ? AND key = ?"),
      put: this.db.prepare("INSERT INTO do_storage (class, name, key, value) VALUES (?, ?, ?, ?) ON CONFLICT(class, name, key) DO UPDATE SET value = excluded.value"),
      del: this.db.prepare("DELETE FROM do_storage WHERE class = ? AND name = ? AND key = ?"),
      delAll: this.db.prepare("DELETE FROM do_storage WHERE class = ? AND name = ?"),
      setAlarm: this.db.prepare("INSERT INTO do_alarm (class, name, at) VALUES (?, ?, ?) ON CONFLICT(class, name) DO UPDATE SET at = excluded.at"),
      getAlarm: this.db.prepare("SELECT at FROM do_alarm WHERE class = ? AND name = ?"),
      delAlarm: this.db.prepare("DELETE FROM do_alarm WHERE class = ? AND name = ?"),
      dueAlarms: this.db.prepare("SELECT name FROM do_alarm WHERE class = ? AND at <= ? ORDER BY at LIMIT 100"),
      countNames: this.db.prepare("SELECT COUNT(DISTINCT name) AS n FROM do_storage WHERE class = ?")
    };
    this.locks = new Map();
    this.sweeper = setInterval(() => this.runDueAlarms().catch((error) => this.log.error("durable object alarm sweep failed", error)), 15_000);
    this.sweeper.unref();
  }

  idFromName(name) {
    if (typeof name !== "string" || !name) throw new TypeError("invalid Durable Object name");
    return { name, toString: () => name, equals: (other) => other && other.name === name };
  }

  get(id) {
    const name = id && id.name;
    if (typeof name !== "string") throw new TypeError("invalid Durable Object id");
    return { id, fetch: (input, init) => this.dispatch(name, input, init) };
  }

  // Serialises everything that touches a given object, mirroring DO input gates.
  withLock(name, fn) {
    const previous = this.locks.get(name) || Promise.resolve();
    const next = previous.then(fn, fn);
    const settled = next.then(() => undefined, () => undefined);
    this.locks.set(name, settled);
    settled.then(() => { if (this.locks.get(name) === settled) this.locks.delete(name); });
    return next;
  }

  storageFor(name) {
    const cls = this.className;
    const parse = (row) => (row ? JSON.parse(row.value) : undefined);
    const plain = {
      get: async (key) => parse(this.statements.get.get(cls, name, key)),
      put: async (key, value) => { this.statements.put.run(cls, name, key, JSON.stringify(value)); },
      delete: async (key) => { this.statements.del.run(cls, name, key); },
      deleteAll: async () => { this.statements.delAll.run(cls, name); },
      setAlarm: async (time) => {
        const at = time instanceof Date ? time.getTime() : Number(time);
        if (!Number.isFinite(at)) throw new TypeError("invalid alarm time");
        this.statements.setAlarm.run(cls, name, Math.floor(at));
      },
      getAlarm: async () => { const row = this.statements.getAlarm.get(cls, name); return row ? row.at : null; },
      deleteAlarm: async () => { this.statements.delAlarm.run(cls, name); }
    };
    plain.transaction = async (fn) => {
      // Objects are already serialised per name and node:sqlite is synchronous, so a plain SQLite
      // transaction around the callback gives atomicity; a throw rolls everything back.
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(plain);
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        try { this.db.exec("ROLLBACK"); } catch {}
        throw error;
      }
    };
    return plain;
  }

  instance(name) {
    const state = {
      id: this.idFromName(name),
      storage: this.storageFor(name),
      waitUntil: () => {},
      blockConcurrencyWhile: (fn) => fn()
    };
    return new this.ObjectClass(state, this.env);
  }

  dispatch(name, input, init) {
    return this.withLock(name, async () => {
      const request = input instanceof Request ? input : new Request(input, init);
      return this.instance(name).fetch(request);
    });
  }

  async runDueAlarms() {
    const due = this.statements.dueAlarms.all(this.className, Date.now());
    for (const { name } of due) {
      await this.withLock(name, async () => {
        this.statements.delAlarm.run(this.className, name);
        const object = this.instance(name);
        if (typeof object.alarm === "function") await object.alarm();
      });
    }
  }

  stats() {
    return { objects: this.statements.countNames.get(this.className).n };
  }

  close() {
    clearInterval(this.sweeper);
    this.db.close();
  }
}
