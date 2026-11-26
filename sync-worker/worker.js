// Planner phone sync: a private mailbox between the Mac and the iPhone, on Cloudflare's free plan.
//
// It only ever holds encrypted files (AES-256-GCM, the key never leaves the two devices), so Cloudflare cannot read
// the plan. Two kinds of file:
//   snapshot   the plan as the Mac last saved it, written by the Mac, read by the phone
//   ops/<name> one change made on the phone, written by the phone, read and deleted by the Mac
//   audio/<id>/<n>  a recording from the phone in parts, read by the Mac, deleted once it is in Brain
//                   (since 21 Nov 2026 also PDFs from the Mac for the phone's reader, sealed as kind "file", deleted by the phone)
//   text/<id>/<n>   the reading versions (Docling text) of the course PDFs, from the Mac, kept (since 26 Nov 2026, the
//                   user's request: the phone's library stays on Cloudflare, so it can fetch any text with the Mac off);
//                   the Mac replaces one when its text or marks change and deletes it when the PDF is gone. 1 GB in all.
//   web        the page the phone shows (encrypted like the rest), written by the Mac only when a rebuild changed it
//   backup     the Mac's off-device copy of the data (plan, Brain notes, the data folder's text files), at most 200 MB,
//              uploaded in chunks of 4 MB (a request body is at most 100 MB on the free plan, and the object has about
//              128 MB of memory) under a new generation; commit makes it current and deletes the old one, so a broken
//              upload never replaces a good backup
// Every request needs the bearer token; the Worker keeps only its SHA-256 (secret TOKEN_HASH).
//
// Free-plan guard rails (Workers Free: 100,000 requests a day; Durable Objects Free: 100,000 requests a day):
//   - at most DAILY_CAP authorised requests a day (UTC); after that every call gets 429 until midnight UTC
//   - wrong or missing token: rejected in the Worker, the storage object is never touched
//   - recordings: parts of at most 96 KB, 200 MB waiting in all (free Durable Object storage: 5 GB)
//   - kept reading versions: parts of at most 96 KB, 1 GB in all
//   - snapshot and page at most 1 MB each, a change at most 96 KB, at most 300 changes waiting, 32 MB stored in all
//   - the apps poll slowly on top of this (phone 60 s while open, Mac 30 s while open) and upload only on change

const DAILY_CAP = 20000;
const MAX_SNAPSHOT = 1 << 20;
const MAX_BACKUP = 200 << 20;     // one backup (it is not counted in MAX_TOTAL; two generations exist only during an upload)
const BAK_CHUNK = 4 << 20;        // one backup upload or download request
const BAK_GEN = /^\d{13}-[a-f0-9]{8}$/;
const MAX_OP = 96 << 10;          // one stored value in a Durable Object is limited to 128 KB
const PART = 100 << 10;           // the snapshot is stored in parts of this size
const MAX_OPS = 300;
const MAX_TOTAL = 32 << 20;
const OP_NAME = /^\d{13}-[a-f0-9]{8}\.bin$/;
const AUDIO_ID = /^\d{13}-[a-f0-9]{8}$/;
const MAX_AUDIO = 200 << 20;      // recordings waiting for the Mac, all together (deleted once the Mac has them)
const MAX_AUDIO_PARTS = 4000;     // one recording: 4000 parts of up to 96 KB, about 25 hours of speech
const MAX_TEXT = 1 << 30;         // kept reading versions, all together (about 6 MB in Nov 2026); guards the 5 GB store
                                  // against a runaway upload, so the snapshot, changes and recordings keep their room

const enc = new TextEncoder();
async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const text = (s, status) => new Response(s, { status, headers: { "cache-control": "no-store" } });

export default {
  async fetch(request, env) {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!env.TOKEN_HASH || !token || token.length > 200 || !sameText(await sha256hex(token), env.TOKEN_HASH)) return text("no", 401);
    const id = env.BOX.idFromName("planner");
    return env.BOX.get(id).fetch(request);
  },
};

export class Box {
  constructor(ctx) { this.ctx = ctx; this.s = ctx.storage; }

  async count() {
    const day = new Date().toISOString().slice(0, 10);
    const c = (await this.s.get("count")) || { day, n: 0 };
    if (c.day !== day) { c.day = day; c.n = 0; }
    c.n++;
    await this.s.put("count", c);
    return c;
  }

  async total() {
    const blobs = ((await this.s.get("snapSize")) || 0) + ((await this.s.get("webSize")) || 0);
    const ops = await this.s.list({ prefix: "op:" });
    let n = 0; for (const v of ops.values()) n += v.byteLength;
    return { bytes: blobs + n, ops: ops.size };
  }

  // A stored file in parts of PART bytes (one Durable Object value is at most 128 KB). p: "snap" or "web".
  async getBlob(p, request) {
    const tag = await this.s.get(p + "Tag");
    if (!tag) return text("none", 404);
    const at = (await this.s.get(p + "At")) || "";
    if (request.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers: { etag: tag, "x-at": at } });
    const n = (await this.s.get(p + "Parts")) || 0, parts = await this.s.get([...Array(n).keys()].map((i) => p + ":" + i));
    const out = new Uint8Array((await this.s.get(p + "Size")) || 0); let o = 0;
    for (let i = 0; i < n; i++) { const b = new Uint8Array(parts.get(p + ":" + i)); out.set(b, o); o += b.length; }
    return new Response(out, { headers: { etag: tag, "x-at": at, "content-type": "application/octet-stream", "cache-control": "no-store" } });
  }

  async putBlob(p, request, max = MAX_SNAPSHOT) {
    const body = await request.arrayBuffer();
    if (body.byteLength < 32 || body.byteLength > max) return text("bad size", 413);
    const old = (await this.s.get(p + "Size")) || 0;
    if ((await this.total()).bytes - old + body.byteLength > MAX_TOTAL) return text("storage full", 507);
    const tag = '"' + (await sha256hex(body)).slice(0, 32) + '"', at = new Date().toISOString();
    const parts = {}, n = Math.ceil(body.byteLength / PART);
    for (let i = 0; i < n; i++) parts[p + ":" + i] = body.slice(i * PART, (i + 1) * PART);
    const oldN = (await this.s.get(p + "Parts")) || 0, stale = [];
    for (let i = n; i < oldN; i++) stale.push(p + ":" + i);
    if (stale.length) await this.s.delete(stale);
    await this.s.put(Object.assign(parts, { [p + "Parts"]: n, [p + "Tag"]: tag, [p + "At"]: at, [p + "Size"]: body.byteLength }));
    return json({ tag, at });
  }

  // Deletes every key with this prefix, 128 at a time (the most one delete takes).
  async dropPrefix(prefix) {
    for (;;) {
      const keys = [...(await this.s.list({ prefix, limit: 128 })).keys()];
      if (!keys.length) return;
      await this.s.delete(keys);
    }
  }

  //   PUT  /backup/part/<gen>/<n>   chunk n (at most BAK_CHUNK) of a new backup generation
  //   POST /backup/commit?gen=&chunks=&size=   all chunks there: it becomes the backup, the old generation goes
  //   GET  /backup                  {gen, chunks, size, at} of the current backup, 404 if none
  //   GET  /backup/part/<n>         chunk n of the current backup
  async backup(path, m, url, request) {
    const man = await this.s.get("bakMan");
    if (path === "/backup" && m === "GET") return man ? json(man) : text("none", 404);
    let x = path.match(/^\/backup\/part\/(\d{1,3})$/);
    if (x && m === "GET") {
      const n = Number(x[1]);
      if (!man || n >= man.chunks) return text("none", 404);
      const info = await this.s.get("bakc:" + man.gen + ":" + n); if (!info) return text("none", 404);
      const vals = await this.s.get([...Array(info.parts).keys()].map((i) => "bak:" + man.gen + ":" + n + ":" + i));
      const out = new Uint8Array(info.size); let o = 0;
      for (let i = 0; i < info.parts; i++) { const b = new Uint8Array(vals.get("bak:" + man.gen + ":" + n + ":" + i)); out.set(b, o); o += b.length; }
      return new Response(out, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store" } });
    }
    x = path.match(/^\/backup\/part\/([0-9a-f-]+)\/(\d{1,3})$/);
    if (x && m === "PUT") {
      const gen = x[1], n = Number(x[2]);
      if (!BAK_GEN.test(gen) || n >= Math.ceil(MAX_BACKUP / BAK_CHUNK)) return text("bad part", 400);
      const body = await request.arrayBuffer();
      if (body.byteLength < 1 || body.byteLength > BAK_CHUNK) return text("bad size", 413);
      if (n === 0) {   // a new upload: leftovers of uploads that never committed go first
        const gens = new Set([...(await this.s.list({ prefix: "bakc:" })).keys()].map((k) => k.split(":")[1]));
        for (const g of gens) if (g !== gen && (!man || g !== man.gen)) { await this.dropPrefix("bak:" + g + ":"); await this.dropPrefix("bakc:" + g + ":"); }
      }
      const parts = {}, k = Math.ceil(body.byteLength / PART);
      for (let i = 0; i < k; i++) parts["bak:" + gen + ":" + n + ":" + i] = body.slice(i * PART, (i + 1) * PART);
      parts["bakc:" + gen + ":" + n] = { size: body.byteLength, parts: k };
      await this.s.put(parts);
      return json({ ok: true });
    }
    if (path === "/backup/commit" && m === "POST") {
      const gen = url.searchParams.get("gen") || "", chunks = Number(url.searchParams.get("chunks")), size = Number(url.searchParams.get("size"));
      if (!BAK_GEN.test(gen) || !(chunks > 0) || !(size > 0) || size > MAX_BACKUP) return text("bad commit", 400);
      const infos = await this.s.get([...Array(chunks).keys()].map((n) => "bakc:" + gen + ":" + n));
      let sum = 0; for (let n = 0; n < chunks; n++) { const i = infos.get("bakc:" + gen + ":" + n); if (!i) return text("missing part " + n, 409); sum += i.size; }
      if (sum !== size) return text("size mismatch", 409);
      const at = new Date().toISOString();
      await this.s.put("bakMan", { gen, chunks, size, at });
      if (man && man.gen !== gen) { await this.dropPrefix("bak:" + man.gen + ":"); await this.dropPrefix("bakc:" + man.gen + ":"); }
      // the single-blob backup of the first version (26 Nov 2026), if it is still there
      const oldN = (await this.s.get("bakParts")) || 0;
      if (oldN) { await this.s.delete([...Array(oldN).keys()].map((i) => "bak:" + i)); await this.s.delete(["bakParts", "bakTag", "bakAt", "bakSize"]); }
      return json({ gen, at });
    }
    return text("not found", 404);
  }

  // Pieces of one file under prefix p ("au:" or "tx:"): <p><id>:<nnnn>, the bytes of each file in <p>b:<id> and of all
  // in <b>Bytes. PUT and GET one piece; DELETE ?parts=N deletes by number, never loading the pieces.
  async parts(p, b, cap, id, n, m, url, request) {
    const k = n === null ? null : p + id + ":" + String(n).padStart(4, "0"), total = b + "Bytes", mineK = p + "b:" + id;
    if (k && m === "PUT") {
      if (n >= MAX_AUDIO_PARTS) return text("too many parts", 413);
      const body = await request.arrayBuffer();
      if (body.byteLength < 32 || body.byteLength > MAX_OP) return text("bad size", 413);
      const used = (await this.s.get(total)) || 0, mine = (await this.s.get(mineK)) || 0, old = await this.s.get(k);
      const grow = body.byteLength - (old ? old.byteLength : 0);
      if (used + grow > cap) return text("storage full", 507);
      await this.s.put({ [k]: body, [total]: used + grow, [mineK]: mine + grow });
      return json({ ok: true });
    }
    if (k && m === "GET") {
      const v = await this.s.get(k);
      return v ? new Response(v, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store" } }) : text("none", 404);
    }
    if (n === null && m === "DELETE") {
      const count = Math.min(MAX_AUDIO_PARTS, Number(url.searchParams.get("parts")) || 0);
      const keys = [...Array(count).keys()].map((i) => p + id + ":" + String(i).padStart(4, "0"));
      for (let i = 0; i < keys.length; i += 128) await this.s.delete(keys.slice(i, i + 128));
      const freed = (await this.s.get(mineK)) || 0;
      await this.s.delete(mineK);
      await this.s.put(total, Math.max(0, ((await this.s.get(total)) || 0) - freed));
      return json({ deleted: keys.length, freed });
    }
    return text("not found", 404);
  }

  async fetch(request) {
    const c = await this.count();
    if (c.n > DAILY_CAP) return text("daily limit reached", 429);
    const url = new URL(request.url), path = url.pathname, m = request.method;

    if (path === "/status" && m === "GET") {
      const t = await this.total();
      return json({ snapshot: (await this.s.get("snapTag")) || null, snapshotAt: (await this.s.get("snapAt")) || null, web: (await this.s.get("webTag")) || null, audioBytes: (await this.s.get("audioBytes")) || 0, textBytes: (await this.s.get("textBytes")) || 0, backup: (await this.s.get("bakMan")) || null, ops: t.ops, bytes: t.bytes, today: c.n, cap: DAILY_CAP });
    }

    // snapshot: the plan, from the Mac. web: the page (index.html and js/), from the Mac, uploaded only after a rebuild.
    if (path === "/snapshot" && m === "GET") return this.getBlob("snap", request);
    if (path === "/snapshot" && m === "PUT") return this.putBlob("snap", request);
    if (path === "/web" && m === "GET") return this.getBlob("web", request);
    if (path === "/web" && m === "PUT") return this.putBlob("web", request);
    // every transfer piece (PDF and recording parts, au:/aub:) goes; the kept reading versions (tx:) stay; the devices ask again for what they need.
    // The snapshot, phone changes and the backup stay. The Mac calls it; ?confirm=all guards against a stray request.
    if (path === "/parts/clear" && m === "POST") {
      if (url.searchParams.get("confirm") !== "all") return text("add ?confirm=all", 400);
      const before = (await this.s.get("audioBytes")) || 0;
      await this.dropPrefix("au:"); await this.dropPrefix("aub:");
      await this.s.put("audioBytes", 0);
      return json({ cleared: before });
    }
    // backup: the Mac's off-device copy of the data, read only by a Mac with the key (Restore)
    if (path.startsWith("/backup")) return this.backup(path, m, url, request);

    if (path === "/ops" && m === "GET") {          // the Mac: every waiting change, oldest first, in one call
      const ops = await this.s.list({ prefix: "op:" });
      const out = [];
      for (const [k, v] of ops) {
        const b = new Uint8Array(v); let s = "";
        for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
        out.push({ name: k.slice(3), data: btoa(s) });
      }
      return json({ ops: out });
    }

    if (path === "/ops/delete" && m === "POST") {
      const { names } = await request.json().catch(() => ({}));
      const keys = (Array.isArray(names) ? names : []).filter((n) => OP_NAME.test(n)).slice(0, 128).map((n) => "op:" + n);
      if (keys.length) await this.s.delete(keys);
      return json({ deleted: keys.length });
    }

    // recordings (and PDFs) in transit: au:, deleted once fetched. Reading versions: tx:, kept.
    const am = path.match(/^\/(audio|text)\/([^/]+)(?:\/(\d{1,4}))?$/);
    if (am && AUDIO_ID.test(am[2])) {
      const [p, b, cap] = am[1] === "audio" ? ["au:", "audio", MAX_AUDIO] : ["tx:", "text", MAX_TEXT];
      return this.parts(p, b, cap, am[2], am[3] === undefined ? null : Number(am[3]), m, url, request);
    }

    const om = path.match(/^\/ops\/(.+)$/);
    if (om && m === "PUT") {                       // the phone: one change
      const name = om[1];
      if (!OP_NAME.test(name)) return text("bad name", 400);
      const body = await request.arrayBuffer();
      if (body.byteLength < 32 || body.byteLength > MAX_OP) return text("bad size", 413);
      const t = await this.total();
      if (t.ops >= MAX_OPS || t.bytes + body.byteLength > MAX_TOTAL) return text("storage full", 507);
      await this.s.put("op:" + name, body);
      return json({ ok: true });
    }

    return text("not found", 404);
  }
}
