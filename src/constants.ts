export const DEFAULT_WORKER_CODE = `// ==============================================================================
// CLOUDFLARE WORKER & PAGES COMPATIBLE VLESS & TROJAN RELAY ENGINE
// Version: 3.0 (Unified Port 80 & 443 + ProxyIP Fallback + Multi-DoH + Sub/Mask)
// ==============================================================================

import net from "node:net";

let cfConnect = null;
try {
  const cf = await import("cloudflare:sockets");
  if (cf && typeof cf.connect === "function") {
    cfConnect = cf.connect;
  }
} catch (_) {}

export function connect(address) {
  if (cfConnect) return cfConnect(address);

  const { hostname, port } = address;
  let closedResolve, closedReject;
  const closed = new Promise((res, rej) => { closedResolve = res; closedReject = rej; });
  let socket = null;
  try { socket = net.createConnection({ host: hostname, port: Number(port) }); } catch (_) {}
  if (socket) {
    socket.on("close", (err) => (err ? closedReject(new Error("Closed with error")) : closedResolve()));
    socket.on("error", (err) => closedReject(err));
  }
  const readable = new ReadableStream({
    start(controller) {
      if (!socket) { controller.close(); return; }
      socket.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
      socket.on("end", () => controller.close());
      socket.on("error", (err) => controller.error(err));
    },
    cancel() { if (socket) socket.destroy(); }
  });
  const writable = new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        if (!socket) return reject(new Error("Socket not connected"));
        socket.write(Buffer.from(chunk), (err) => (err ? reject(err) : resolve()));
      });
    },
    close() { if (socket) socket.end(); },
    abort() { if (socket) socket.destroy(); }
  });
  return { readable, writable, closed };
}

if (typeof globalThis.WebSocketPair === "undefined") {
  class MockWebSocket {
    constructor() { this.readyState = 1; this.listeners = {}; this._peer = null; }
    accept() { this.readyState = 1; }
    addEventListener(e, cb) { (this.listeners[e] = this.listeners[e] || []).push(cb); }
    removeEventListener(e, cb) { if (this.listeners[e]) this.listeners[e] = this.listeners[e].filter(x => x !== cb); }
    send(data) { if (this._peer?.readyState === 1) (this._peer.listeners["message"] || []).forEach(cb => { try { cb({ data }); } catch (_) {} }); }
    close() { this.readyState = 3; (this.listeners["close"] || []).forEach(cb => { try { cb({ code: 1000 }); } catch (_) {} }); if (this._peer?.readyState !== 3) this._peer.close(); }
  }
  globalThis.WebSocketPair = class { constructor() { this[0] = new MockWebSocket(); this[1] = new MockWebSocket(); this[0]._peer = this[1]; this[1]._peer = this[0]; } };
}

const DEFAULT_PATH = "/vless";
const DEFAULT_PROXY_IP = "cdn-b100.xn--b6gac.eu.org";
const DEFAULT_PROXY_URL = "https://gprox-galaxy.github.io/PROXYIP.txt";
const DOH_RESOLVERS_POOL = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/dns-query",
  "https://dns.quad9.net/dns-query",
  "https://doh.opendns.com/dns-query"
];
const DEFAULT_DOH_URL = DOH_RESOLVERS_POOL[0];

let cachedProxyList = [];
let lastProxyFetchTime = 0;

function sha224(str) {
  if (!str) return "";
  function r(n, x) { return (x >>> n) | (x << (32 - n)); }
  function ch(x, y, z) { return (x & y) ^ (~x & z); }
  function maj(x, y, z) { return (x & y) ^ (x & z) ^ (y & z); }
  function s0(x) { return r(2, x) ^ r(13, x) ^ r(22, x); }
  function s1(x) { return r(6, x) ^ r(11, x) ^ r(25, x); }
  function g0(x) { return r(7, x) ^ r(18, x) ^ (x >>> 3); }
  function g1(x) { return r(17, x) ^ r(19, x) ^ (x >>> 10); }
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  let H0 = 0xc1059ed8, H1 = 0x367cd507, H2 = 0x3070dd17, H3 = 0xf70e5939;
  let H4 = 0xffc00b31, H5 = 0x68581511, H6 = 0x64f98fa7, H7 = 0xbefa4fa4;
  const utf8 = new TextEncoder().encode(str);
  const l = utf8.length * 8;
  const k = (448 - 1 - (l % 512) + 512) % 512;
  const padded = new Uint8Array(utf8.length + 1 + k / 8 + 8);
  padded.set(utf8);
  padded[utf8.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, l, false);
  const w = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) w[t] = (g1(w[t - 2]) + w[t - 7] + g0(w[t - 15]) + w[t - 16]) >>> 0;
    let a = H0, b = H1, c = H2, d = H3, e = H4, f = H5, g = H6, h = H7;
    for (let t = 0; t < 64; t++) {
      const T1 = (h + s1(e) + ch(e, f, g) + K[t] + w[t]) >>> 0;
      const T2 = (s0(a) + maj(a, b, c)) >>> 0;
      h = g; g = f; f = e; e = (d + T1) >>> 0; d = c; c = b; b = a; a = (T1 + T2) >>> 0;
    }
    H0 = (H0 + a) >>> 0; H1 = (H1 + b) >>> 0; H2 = (H2 + c) >>> 0; H3 = (H3 + d) >>> 0;
    H4 = (H4 + e) >>> 0; H5 = (H5 + f) >>> 0; H6 = (H6 + g) >>> 0; H7 = (H7 + h) >>> 0;
  }
  const hex = (n) => n.toString(16).padStart(8, "0");
  return (hex(H0) + hex(H1) + hex(H2) + hex(H3) + hex(H4) + hex(H5) + hex(H6)).toLowerCase();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(uuid) { return uuid && typeof uuid === "string" && UUID_RE.test(uuid.trim()); }

const byteToHex = Array.from({ length: 256 }, (_, i) => (i + 256).toString(16).slice(1));
function unsafeStringify(arr, o = 0) {
  return (
    byteToHex[arr[o]] + byteToHex[arr[o+1]] + byteToHex[arr[o+2]] + byteToHex[arr[o+3]] + "-" +
    byteToHex[arr[o+4]] + byteToHex[arr[o+5]] + "-" +
    byteToHex[arr[o+6]] + byteToHex[arr[o+7]] + "-" +
    byteToHex[arr[o+8]] + byteToHex[arr[o+9]] + "-" +
    byteToHex[arr[o+10]] + byteToHex[arr[o+11]] + byteToHex[arr[o+12]] + byteToHex[arr[o+13]] + byteToHex[arr[o+14]] + byteToHex[arr[o+15]]
  ).toLowerCase();
}

function cleanPath(val) {
  const p = String(val || DEFAULT_PATH).trim();
  const n = \`/\${p.replace(/^\\/+|\\/+$/g, "")}\`;
  return n === "/" || n.length > 128 || /[\\r\\n?#]/.test(n) ? DEFAULT_PATH : n;
}

async function getHybridProxyIP(primary, url) {
  if (primary && primary !== DEFAULT_PROXY_IP) return primary;
  const now = Date.now();
  if (cachedProxyList.length > 0 && now - lastProxyFetchTime < 600000) {
    return cachedProxyList[Math.floor(Math.random() * cachedProxyList.length)];
  }
  try {
    const res = await fetch(url || DEFAULT_PROXY_URL, { cf: { cacheTtl: 600 } });
    if (res.ok) {
      const lines = (await res.text()).split("\\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
      if (lines.length > 0) {
        cachedProxyList = lines;
        lastProxyFetchTime = now;
        return cachedProxyList[Math.floor(Math.random() * cachedProxyList.length)];
      }
    }
  } catch (_) {}
  return primary || DEFAULT_PROXY_IP;
}

function isBlocked(h) {
  const v = String(h).toLowerCase().replace(/^\\[|\\]$/g, "");
  if (v === "localhost" || v.endsWith(".localhost") || v === "local" || v.endsWith(".local")) return true;
  if (/^(127\\.|10\\.|192\\.168\\.|169\\.254\\.)/.test(v)) return true;
  const m = v.match(/^172\\.(\\d{1,3})\\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80:")) return true;
  return false;
}

function processProxyHeader(buffer, allowedUUIDs, allowedTrojanHashes) {
  if (!buffer || buffer.byteLength < 24) return { hasError: true, message: "Too short" };
  const u = new Uint8Array(buffer);

  // Trojan check
  if (u.byteLength >= 58 && u[56] === 0x0d && u[57] === 0x0a) {
    const hash = new TextDecoder().decode(u.slice(0, 56)).toLowerCase().trim();
    if (allowedTrojanHashes.length > 0 && !allowedTrojanHashes.includes(hash)) return { hasError: true };
    const cmd = u[58];
    const isUDP = cmd === 3;
    if (cmd !== 1 && cmd !== 3) return { hasError: true };
    const aType = u[59];
    let aLen = 0, aIdx = 60, aVal = "";
    if (aType === 1) { aLen = 4; aVal = Array.from(u.slice(aIdx, aIdx + 4)).join("."); }
    else if (aType === 3) { aLen = u[aIdx++]; aVal = new TextDecoder().decode(u.slice(aIdx, aIdx + aLen)); }
    else if (aType === 4) {
      aLen = 16; const dv = new DataView(u.buffer, u.byteOffset + aIdx, 16);
      aVal = Array.from({ length: 8 }, (_, i) => dv.getUint16(i * 2).toString(16)).join(":");
    } else return { hasError: true };
    const pIdx = aIdx + aLen;
    const pRemote = new DataView(u.buffer, u.byteOffset + pIdx, 2).getUint16(0);
    return { hasError: false, protocol: "trojan", addressRemote: aVal, portRemote: pRemote, rawDataIndex: pIdx + 4, responseHeader: null, isUDP };
  }

  // VLESS check
  const version = u[0];
  const str = unsafeStringify(u.slice(1, 17));
  const valid = Array.isArray(allowedUUIDs) ? allowedUUIDs : [allowedUUIDs];
  if (valid.length > 0 && !valid.some(x => x && str === x.trim().toLowerCase())) return { hasError: true };
  const optLen = u[17];
  const cmd = u[18 + optLen];
  const isUDP = cmd === 2;
  if (cmd !== 1 && cmd !== 2) return { hasError: true };
  const pIdx = 18 + optLen + 1;
  const pRemote = new DataView(u.buffer, u.byteOffset + pIdx, 2).getUint16(0);
  const aIdx = pIdx + 2;
  const aType = u[aIdx];
  let aLen = 0, aValIdx = aIdx + 1, aVal = "";
  if (aType === 1) { aLen = 4; aVal = Array.from(u.slice(aValIdx, aValIdx + 4)).join("."); }
  else if (aType === 2) { aLen = u[aValIdx++]; aVal = new TextDecoder().decode(u.slice(aValIdx, aValIdx + aLen)); }
  else if (aType === 3) {
    aLen = 16; const dv = new DataView(u.buffer, u.byteOffset + aValIdx, 16);
    aVal = Array.from({ length: 8 }, (_, i) => dv.getUint16(i * 2).toString(16)).join(":");
  } else return { hasError: true };
  if (!aVal) return { hasError: true };
  return { hasError: false, protocol: "vless", addressRemote: aVal, portRemote: pRemote, rawDataIndex: aValIdx + aLen, responseHeader: new Uint8Array([version, 0]), isUDP };
}

async function proxyOverWSHandler(req, uuids, hashes, proxyIP, proxyURL, dohURL) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  const early = req.headers.get("sec-websocket-protocol") || "";
  const wsStream = makeReadableWS(server, early);
  let remoteSocket = { value: null }, udpWrite = null, isDns = false;

  wsStream.pipeTo(new WritableStream({
    async write(chunk) {
      if (isDns && udpWrite) return udpWrite(chunk);
      if (remoteSocket.value) {
        const w = remoteSocket.value.writable.getWriter();
        await w.write(chunk);
        w.releaseLock();
        return;
      }
      const res = processProxyHeader(chunk, uuids, hashes);
      if (res.hasError) { safeClose(server); return; }
      const { addressRemote, portRemote = 443, rawDataIndex, responseHeader, isUDP } = res;
      if (isBlocked(addressRemote)) { safeClose(server); return; }
      if (isUDP && portRemote === 53) isDns = true;
      else if (isUDP) { safeClose(server); return; }
      const raw = chunk.slice(rawDataIndex);
      if (isDns) {
        const { write } = await handleUDP(server, responseHeader, dohURL);
        udpWrite = write; udpWrite(raw); return;
      }
      handleTCP(remoteSocket, addressRemote, portRemote, raw, server, responseHeader, proxyIP, proxyURL);
    },
    close() { safeClose(server); },
    abort() { safeClose(server); }
  })).catch(() => safeClose(server));

  return new Response(null, { status: 101, webSocket: client });
}

async function handleTCP(remoteSocket, host, port, raw, client, header, proxyIP, proxyURL) {
  async function connectWrite(addr, p) {
    const s = connect({ hostname: addr, port: p });
    remoteSocket.value = s;
    const w = s.writable.getWriter();
    await w.write(raw);
    w.releaseLock();
    return s;
  }
  async function retry() {
    const active = await getHybridProxyIP(proxyIP, proxyURL);
    try {
      const s = await connectWrite(active || host, port);
      s.closed.catch(() => {}).finally(() => safeClose(client));
      streamToClient(s, client, header, null);
    } catch (_) { safeClose(client); }
  }
  try {
    const s = await connectWrite(host, port);
    streamToClient(s, client, header, retry);
  } catch (_) { await retry(); }
}

function makeReadableWS(ws, early) {
  return new ReadableStream({
    start(c) {
      ws.addEventListener("message", e => c.enqueue(e.data));
      ws.addEventListener("close", () => { safeClose(ws); c.close(); });
      ws.addEventListener("error", err => c.error(err));
      if (early) {
        try {
          const b = atob(early.replace(/-/g, "+").replace(/_/g, "/"));
          c.enqueue(Uint8Array.from(b, x => x.charCodeAt(0)).buffer);
        } catch (_) {}
      }
    },
    cancel() { safeClose(ws); }
  });
}

async function streamToClient(s, client, header, retry) {
  let h = header, hasData = false;
  await s.readable.pipeTo(new WritableStream({
    async write(chunk, c) {
      hasData = true;
      if (client.readyState !== 1) c.error("Closed");
      if (h) { client.send(await new Blob([h, chunk]).arrayBuffer()); h = null; }
      else client.send(chunk);
    },
    close() { safeClose(client); },
    abort() { safeClose(client); }
  })).catch(() => safeClose(client));
  if (!hasData && retry) retry();
}

function safeClose(ws) { try { if (ws && ws.readyState < 3) ws.close(); } catch (_) {} }

async function handleUDP(client, header, dohURL) {
  let sent = false;
  const ts = new TransformStream({
    transform(chunk, controller) {
      for (let i = 0; i < chunk.byteLength;) {
        const len = new DataView(chunk.slice(i, i + 2)).getUint16(0);
        controller.enqueue(new Uint8Array(chunk.slice(i + 2, i + 2 + len)));
        i += 2 + len;
      }
    }
  });
  ts.readable.pipeTo(new WritableStream({
    async write(chunk) {
      let dnsRes = null;
      try {
        const r = await fetch(dohURL, { method: "POST", headers: { "content-type": "application/dns-message" }, body: chunk });
        if (r.ok) dnsRes = await r.arrayBuffer();
      } catch (_) {}
      if (!dnsRes) {
        const others = DOH_RESOLVERS_POOL.filter(u => u !== dohURL);
        dnsRes = await Promise.any(others.map(u => fetch(u, { method: "POST", headers: { "content-type": "application/dns-message" }, body: chunk }).then(r => r.arrayBuffer()))).catch(() => null);
      }
      if (!dnsRes) return;
      const sz = dnsRes.byteLength;
      const b = new Uint8Array([sz >> 8 & 255, sz & 255]);
      const full = sent || !header ? new Uint8Array([...b, ...new Uint8Array(dnsRes)]) : new Uint8Array([...header, ...b, ...new Uint8Array(dnsRes)]);
      sent = true;
      if (client.readyState === 1) client.send(full.buffer);
    }
  })).catch(() => safeClose(client));
  const w = ts.writable.getWriter();
  return { write: c => w.write(c) };
}

function makeDualLinks(req, cfg) {
  const url = new URL(req.url);
  const host = url.host;
  const clean = (url.searchParams.get("cleanip") || "").trim();
  const addr = clean || host;
  const vUuid = cfg.uuid;
  const tPass = cfg.trojanPass || cfg.uuid;
  const p = encodeURIComponent(\`\${cfg.path}?ed=2048\`);

  const vTls = \`vless://\${vUuid}@\${addr}:443?encryption=none&security=tls&sni=\${host}&type=ws&host=\${host}&path=\${p}#\${encodeURIComponent("[VLESS-TLS:443] " + host)}\`;
  const vNoTls = \`vless://\${vUuid}@\${addr}:80?encryption=none&security=none&type=ws&host=\${host}&path=\${p}#\${encodeURIComponent("[VLESS-NoTLS:80] " + host)}\`;
  const tTls = \`trojan://\${tPass}@\${addr}:443?security=tls&sni=\${host}&type=ws&host=\${host}&path=\${p}#\${encodeURIComponent("[Trojan-TLS:443] " + host)}\`;
  const tNoTls = \`trojan://\${tPass}@\${addr}:80?security=none&type=ws&host=\${host}&path=\${p}#\${encodeURIComponent("[Trojan-NoTLS:80] " + host)}\`;

  const all = [vTls, vNoTls, tTls, tNoTls];
  const b64 = btoa(all.join("\\n"));
  return { all, b64 };
}

export default {
  async fetch(req, env = {}) {
    const url = new URL(req.url);
    const envUUID = (env.UUID || "").trim().toLowerCase();
    const envTrojan = (env.TROJAN_PASS || "").trim();
    const wsPath = cleanPath(env.WS_PATH || DEFAULT_PATH);
    const proxyIP = env.PROXYIP || DEFAULT_PROXY_IP;
    const proxyURL = env.PROXY_LIST_URL || DEFAULT_PROXY_URL;
    const dohURL = env.DNS_RESOLVER_URL || DEFAULT_DOH_URL;
    const subToken = (env.SUB_TOKEN || "").trim();

    const uuids = envUUID ? (envUUID.includes(",") ? envUUID.split(",").map(u => u.trim().toLowerCase()).filter(isValidUUID) : [envUUID]) : [];
    const hashes = [];
    if (envTrojan) hashes.push(sha224(envTrojan));
    uuids.forEach(u => hashes.push(sha224(u)));

    const cfg = { uuid: uuids[0] || "d342d11e-d424-4583-b36e-524ab1f0afa4", trojanPass: envTrojan || uuids[0] || "trojan-secret", path: wsPath };

    // WebSocket Proxy (Port 80 & 443)
    if (req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      if (wsPath !== "/" && !url.pathname.startsWith(wsPath) && url.pathname !== "/vless") return new Response("Not found", { status: 404 });
      return await proxyOverWSHandler(req, uuids, hashes, proxyIP, proxyURL, dohURL);
    }

    // Subscription
    if (url.pathname === "/sub" || url.pathname === \`\${wsPath}/sub\`) {
      if (subToken && url.searchParams.get("token") !== subToken) return new Response("Unauthorized", { status: 403 });
      const { all, b64 } = makeDualLinks(req, cfg);
      const plain = url.searchParams.get("format") === "plain";
      return new Response(plain ? all.join("\\n") : b64, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*", "Profile-Update-Interval": "24" }
      });
    }

    // Health / Diagnostics
    if (url.pathname === "/api/health" || url.pathname === "/healthz") {
      return new Response(JSON.stringify({ status: "ok", colo: req.cf?.colo || "EDGE", ports: [80, 443] }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Camouflage Page
    return new Response(\`<!DOCTYPE html><html><head><title>Edge Gateway Status</title><style>body{background:#090d16;color:#f1f5f9;font-family:sans-serif;padding:40px;text-align:center;}h1{color:#38bdf8;}.card{display:inline-block;background:#1e293b;padding:20px 30px;border-radius:8px;margin-top:20px;border:1px solid #334155;}</style></head><body><h1>⚡ Cloudflare Edge Node</h1><div class="card"><p>Status: <strong>Operational</strong></p><p>Ports: <strong>80 (No-TLS) • 443 (TLS)</strong></p><p>Location: <strong>\${req.cf?.colo || "ANYCAST"}</strong></p></div></body></html>\`, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};`;

export const DEFAULT_WRANGLER_CODE = `name = "vless-trojan-relay"
main = "worker.js"
compatibility_date = "2026-09-11"
compatibility_flags = ["nodejs_compat"]

[vars]
WS_PATH = "/vless"
PROXYIP = "cdn-b100.xn--b6gac.eu.org"
PROXY_LIST_URL = "https://gprox-galaxy.github.io/PROXYIP.txt"
DNS_RESOLVER_URL = "https://cloudflare-dns.com/dns-query"
# SUB_TOKEN = "your-sub-token" # Optional subscription protection

# Secrets to set via 'wrangler secret put UUID' or Cloudflare Dashboard:
# UUID = "d342d11e-d424-4583-b36e-524ab1f0afa4"
# TROJAN_PASS = "your-trojan-password"
`;

export const DEFAULT_PAGES_ADAPTER = `// Cloudflare Pages Functions Adapter
// Save this as functions/[[path]].js
import worker from "../worker.js";

export const onRequest = (context) => {
  return worker.fetch(context.request, context.env, context);
};
`;

export const MYANMAR_CLEAN_IPS = [
  { ip: "104.16.1.1", label: "Cloudflare Anycast (104.16.1.1)", tag: "Universal" },
  { ip: "104.17.2.2", label: "Cloudflare Anycast (104.17.2.2)", tag: "Universal" },
  { ip: "162.159.192.1", label: "Cloudflare Singapore Edge", tag: "Low Latency" },
  { ip: "172.67.1.1", label: "Cloudflare CDN Anycast", tag: "MPT / Atom" },
  { ip: "104.21.1.1", label: "Cloudflare CDN Anycast 2", tag: "Ooredoo / MyTel" },
  { ip: "www.visa.com.sg", label: "Visa Singapore (Domain Fronting)", tag: "SNI Bypass" },
  { ip: "www.speedtest.net", label: "Speedtest Ookla (Domain Fronting)", tag: "SNI Bypass" }
];
