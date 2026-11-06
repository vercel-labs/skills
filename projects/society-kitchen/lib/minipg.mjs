// Minimal zero-dependency Postgres client for the test suite (simple query
// protocol, trust auth, text results). Same surface as the bits of `pg` the
// tests use: Client, Pool, query(text, params), release().
// Parameters are inlined as escaped literals, which is fine for test fixtures.
import net from 'node:net';

function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `'${s.replace(/'/g, "''")}'`;
}
const inline = (sql, params) =>
  params && params.length ? sql.replace(/\$(\d+)/g, (_, n) => literal(params[n - 1])) : sql;

function parseValue(oid, s) {
  switch (oid) {
    case 16: return s === 't';
    case 20: case 21: case 23: return Number(s);
    case 700: case 701: case 1700: return Number(s);
    case 114: case 3802: return JSON.parse(s);
    case 1184: case 1114:
      return new Date(s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
    default: return s;
  }
}

export class Client {
  constructor({ connectionString }) {
    const u = new URL(connectionString);
    this.opts = {
      host: u.hostname, port: Number(u.port) || 5432,
      user: decodeURIComponent(u.username), database: u.pathname.slice(1) || decodeURIComponent(u.username),
    };
    this.buf = Buffer.alloc(0);
    this.chain = Promise.resolve();
    this.cur = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.cur = { resolve, reject, rows: [], fields: null, error: null };
      this.sock = net.connect(this.opts.port, this.opts.host);
      this.sock.on('data', (d) => this._onData(d));
      this.sock.on('error', (e) => { const c = this.cur; this.cur = null; c?.reject(e); });
      this.sock.on('connect', () => {
        const kv = ['user', this.opts.user, 'database', this.opts.database, 'TimeZone', 'UTC', 'client_encoding', 'UTF8']
          .map((x) => `${x}\0`).join('') + '\0';
        const body = Buffer.concat([Buffer.from([0, 3, 0, 0]), Buffer.from(kv)]);
        const len = Buffer.alloc(4); len.writeInt32BE(body.length + 4);
        this.sock.write(Buffer.concat([len, body]));
      });
    });
  }

  query(text, params) {
    const sql = inline(text, params);
    const run = () => new Promise((resolve, reject) => {
      this.cur = { resolve, reject, rows: [], fields: null, error: null };
      const body = Buffer.from(sql + '\0');
      const head = Buffer.alloc(5); head[0] = 0x51; head.writeInt32BE(body.length + 4, 1);
      this.sock.write(Buffer.concat([head, body]));
    });
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  end() {
    try { this.sock.write(Buffer.from([0x58, 0, 0, 0, 4])); } catch {}
    this.sock.end();
  }

  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < 1 + len) break;
      const type = String.fromCharCode(this.buf[0]);
      const msg = this.buf.subarray(5, 1 + len);
      this.buf = this.buf.subarray(1 + len);
      this._handle(type, msg);
    }
  }

  _handle(type, m) {
    const cur = this.cur;
    if (type === 'R') {
      if (m.readInt32BE(0) !== 0) cur.error = new Error('minipg supports trust auth only');
    } else if (type === 'T') {
      const n = m.readInt16BE(0); let o = 2; cur.fields = []; cur.rows = [];
      for (let i = 0; i < n; i++) {
        const end = m.indexOf(0, o); const name = m.toString('utf8', o, end); o = end + 1;
        const oid = m.readInt32BE(o + 6); o += 18;
        cur.fields.push({ name, oid });
      }
    } else if (type === 'D') {
      const n = m.readInt16BE(0); let o = 2; const row = {};
      for (let i = 0; i < n; i++) {
        const l = m.readInt32BE(o); o += 4;
        const f = cur.fields[i];
        if (l === -1) row[f.name] = null;
        else { row[f.name] = parseValue(f.oid, m.toString('utf8', o, o + l)); o += l; }
      }
      cur.rows.push(row);
    } else if (type === 'E') {
      const f = {}; let o = 0;
      while (m[o] !== 0) { const k = String.fromCharCode(m[o]); const end = m.indexOf(0, o + 1); f[k] = m.toString('utf8', o + 1, end); o = end + 1; }
      const e = new Error(f.M); e.code = f.C; e.detail = f.D; e.severity = f.S;
      cur.error = e;
    } else if (type === 'Z') {
      this.cur = null;
      if (cur.error) cur.reject(cur.error); else cur.resolve({ rows: cur.rows });
    }
  }
}

export class Pool {
  constructor({ connectionString, max = 10 }) {
    this.cs = connectionString; this.max = max; this.idle = []; this.all = []; this.waiters = []; this.count = 0;
  }
  _lease(c) {
    c.release = () => { const w = this.waiters.shift(); if (w) w(this._lease(c)); else this.idle.push(c); };
    return c;
  }
  async connect() {
    if (this.idle.length) return this._lease(this.idle.pop());
    if (this.count < this.max) {
      this.count++;
      const c = new Client({ connectionString: this.cs });
      try { await c.connect(); } catch (e) { this.count--; throw e; }
      this.all.push(c);
      return this._lease(c);
    }
    return new Promise((res) => this.waiters.push(res));
  }
  async query(text, params) {
    const c = await this.connect();
    try { return await c.query(text, params); } finally { c.release(); }
  }
  async end() { for (const c of this.all) c.end(); }
}

export default { Client, Pool };
