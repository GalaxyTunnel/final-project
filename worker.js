/**
 * EdgeTunnel VLESS Unified Core (Cloudflare Workers & Cloudflare Pages Dual-Mode)
 * All-in-one Single File: worker.js
 * 
 * Features:
 * - VLESS TCP over WebSocket
 * - UDP DNS over HTTPS (DoH) via Cloudflare 1.1.1.1
 * - Dynamic Proxy IP / Domain Pool auto-fetcher
 * - Multi-node Subscription link generator (/sub)
 * - Anti-detection Camouflage Mask Page (Edge Network Diagnostics)
 * - Cloudflare Workers (`export default`) & Cloudflare Pages (`export async function onRequest`) dual exports
 */

import { connect } from "cloudflare:sockets";

// ================= Configurations =================
const DEFAULT_PATH = "/vless";
const DEFAULT_PROXY_URL = "https://galaxytunnel.github.io/PROXYIP.txt";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Static Clean IPs & Domains fallback pool
const STATIC_PROXY_LIST = [
  "cdn.xn--b6gac.eu.org",
  "cdn-b100.xn--b6gac.eu.org",
  "icook.hk",
  "icook.tw",
  "www.visasoutheasteurope.com",
  "www.visa.com.sg"
];

let cachedProxyIPs = [];
let lastFetchTime = 0;

function cleanPath(value) {
  const path = String(value || DEFAULT_PATH).trim();
  const normalized = `/${path.replace(/^\/+|\/+$/g, "")}`;
  if (normalized === "/" || normalized.length > 128 || /[\r\n?#]/.test(normalized)) return DEFAULT_PATH;
  return normalized;
}

function getConfig(env) {
  const uuid = String(env?.UUID || "").trim().toLowerCase();
  const isUuidValid = UUID_RE.test(uuid);
  return { 
    uuid,
    isUuidValid,
    path: cleanPath(env?.WS_PATH),
    proxyUrl: env?.PROXY_URL || DEFAULT_PROXY_URL,
    customProxy: env?.PROXY_IP || ""
  };
}

async function getProxyIP(config) {
  if (config.customProxy) return config.customProxy;
  
  const now = Date.now();
  if (cachedProxyIPs.length === 0 || now - lastFetchTime > 30 * 60 * 1000) {
    try {
      const response = await fetch(config.proxyUrl, { cf: { cacheTtl: 1800 } });
      if (response.ok) {
        const text = await response.text();
        const lines = text.split("\n")
          .map(l => l.trim())
          .filter(l => l && !l.startsWith("#") && !l.startsWith("//") && !l.endsWith(".tk") && !l.endsWith(".ml") && !l.endsWith(".ga"));
        if (lines.length > 0) {
          cachedProxyIPs = lines;
          lastFetchTime = now;
        }
      }
    } catch {
      // Use fallback
    }
  }

  const pool = cachedProxyIPs.length > 0 ? cachedProxyIPs : STATIC_PROXY_LIST;
  return pool[Math.floor(Math.random() * pool.length)];
}

function uuidFromBytes(bytes) {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function base64ToBytes(value) {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function readVlessHeader(input, expectedUuid) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (data.length < 18) return null;

  const version = data[0];
  const receivedUuid = uuidFromBytes(data.subarray(1, 17));
  if (receivedUuid !== expectedUuid) throw new Error("Invalid VLESS UUID");

  const optionsLength = data[17];
  const commandIndex = 18 + optionsLength;
  if (data.length < commandIndex + 4) return null;

  const command = data[commandIndex];
  if (command !== 1 && command !== 2) {
    throw new Error(`Unsupported VLESS command: ${command}`);
  }

  const port = (data[commandIndex + 1] << 8) | data[commandIndex + 2];
  const addressType = data[commandIndex + 3];
  let offset = commandIndex + 4;
  let host;

  if (addressType === 1) {
    if (data.length < offset + 4) return null;
    host = [...data.subarray(offset, offset + 4)].join(".");
    offset += 4;
  } else if (addressType === 2) {
    if (data.length < offset + 1) return null;
    const length = data[offset];
    offset += 1;
    if (data.length < offset + length) return null;
    host = new TextDecoder().decode(data.subarray(offset, offset + length));
    offset += length;
  } else if (addressType === 3) {
    if (data.length < offset + 16) return null;
    const groups = [];
    for (let i = 0; i < 8; i++) {
      groups.push(((data[offset + i * 2] << 8) | data[offset + i * 2 + 1]).toString(16));
    }
    host = groups.join(":");
    offset += 16;
  } else {
    throw new Error("Invalid VLESS address type");
  }

  if (!host || host.length > 253 || /[\r\n]/.test(host)) throw new Error("Invalid destination host");
  return {
    command,
    host,
    port,
    payload: data.subarray(offset),
    responseHeader: new Uint8Array([version, 0])
  };
}

function isBlockedDestination(host) {
  const value = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value.endsWith(".localhost") || value === "local" || value.endsWith(".local")) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(value)) return true;
  const match = value.match(/^172\.(\d{1,3})\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true;
  return false;
}

function closeSocket(socket) {
  try { socket?.close(); } catch { /* no-op */ }
}

function closeClient(socket) {
  try { if (socket && socket.readyState < 2) socket.close(1011, "tunnel closed"); } catch { /* no-op */ }
}

async function handleUdpDns(client, parsed) {
  client.send(parsed.responseHeader);

  async function processDnsPacket(rawChunk) {
    let raw = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
    let dnsQuery = raw;
    if (raw.length > 2) {
      const declaredLen = (raw[0] << 8) | raw[1];
      if (declaredLen <= raw.length - 2) {
        dnsQuery = raw.subarray(2, 2 + declaredLen);
      }
    }

    const resp = await fetch("https://1.1.1.1/dns-query", {
      method: "POST",
      headers: { "content-type": "application/dns-message" },
      body: dnsQuery,
    });

    if (resp.ok) {
      const dnsResponse = new Uint8Array(await resp.arrayBuffer());
      const responsePacket = new Uint8Array(2 + dnsResponse.length);
      responsePacket[0] = (dnsResponse.length >> 8) & 0xff;
      responsePacket[1] = dnsResponse.length & 0xff;
      responsePacket.set(dnsResponse, 2);
      if (client.readyState === 1) client.send(responsePacket);
    }
  }

  if (parsed.payload && parsed.payload.length > 0) {
    await processDnsPacket(parsed.payload);
  }

  return {
    write: processDnsPacket,
    close: () => closeClient(client)
  };
}

function makeSocketReadable(socket, client, responseHeader) {
  let header = responseHeader;
  return socket.readable.pipeTo(new WritableStream({
    write(chunk) {
      if (client.readyState !== 1) throw new Error("WebSocket is closed");
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      if (header) {
        const output = new Uint8Array(header.length + bytes.length);
        output.set(header);
        output.set(bytes, header.length);
        client.send(output);
        header = null;
      } else {
        client.send(bytes);
      }
    }
  })).catch(() => closeClient(client));
}

async function startTcpTunnel(client, parsed, config) {
  let socket;
  try {
    socket = connect({ hostname: parsed.host, port: parsed.port });
    await socket.opened;
  } catch {
    const proxy = await getProxyIP(config);
    const [proxyHost, proxyPort] = proxy.split(":");
    socket = connect({ hostname: proxyHost, port: Number(proxyPort) || parsed.port });
  }

  socket.closed.catch(() => closeClient(client)).finally(() => closeClient(client));
  const writer = socket.writable.getWriter();
  await writer.write(parsed.payload);
  writer.releaseLock();

  makeSocketReadable(socket, client, parsed.responseHeader);
  return socket;
}

function openWebSocket(request, config) {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  let socket = null;
  let udpHandler = null;
  let buffer = new Uint8Array(0);
  let connected = false;
  const earlyData = base64ToBytes(request.headers.get("Sec-WebSocket-Protocol"));

  const consume = async (chunk) => {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
    
    if (connected) {
      if (udpHandler) {
        await udpHandler.write(bytes);
      } else if (socket) {
        const writer = socket.writable.getWriter();
        try { await writer.write(bytes); } finally { writer.releaseLock(); }
      }
      return;
    }

    const combined = new Uint8Array(buffer.length + bytes.length);
    combined.set(buffer);
    combined.set(bytes, buffer.length);
    buffer = combined;

    const parsed = readVlessHeader(buffer, config.uuid);
    if (!parsed) return;
    if (isBlockedDestination(parsed.host)) throw new Error("Blocked destination");
    
    connected = true;

    if (parsed.command === 2) {
      udpHandler = await handleUdpDns(server, parsed);
    } else {
      socket = await startTcpTunnel(server, parsed, config);
    }
  };

  server.addEventListener("message", (event) => consume(event.data).catch(() => closeClient(server)));
  server.addEventListener("close", () => { closeSocket(socket); udpHandler?.close(); });
  server.addEventListener("error", () => { closeSocket(socket); udpHandler?.close(); });
  
  if (earlyData) consume(earlyData).catch(() => closeClient(server));

  return new Response(null, { status: 101, webSocket: client });
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function makeLinks(request, config) {
  const url = new URL(request.url);
  const host = url.host;
  const path = encodeURIComponent(`${config.path}?ed=2048`);

  const nodes = [
    { name: `VLESS TLS (${host})`, address: host, port: 443, tls: true },
    { name: `VLESS Clean (icook.hk)`, address: "icook.hk", port: 443, tls: true },
    { name: `VLESS Clean (Visa)`, address: "www.visasoutheasteurope.com", port: 443, tls: true },
    { name: `VLESS Clean (cdn.eu.org)`, address: "cdn.xn--b6gac.eu.org", port: 443, tls: true },
    { name: `VLESS NoTLS (${host})`, address: host, port: 80, tls: false }
  ];

  const links = nodes.map(n => {
    const sec = n.tls ? "security=tls&sni=" + host : "security=none";
    return `vless://${config.uuid}@${n.address}:${n.port}?encryption=none&${sec}&type=ws&host=${host}&path=${path}#${encodeURIComponent(n.name)}`;
  }).join("\n");

  return { base64: encodeBase64(links) };
}

// ============================================
// ELEGANT CAMOUFLAGE MASK PAGE (Edge Diagnostics)
// ============================================
export function getMaskPage(host = "localhost", isUuidConfigured = true, clientIp = "127.0.0.1", colo = "EDGE-GLOBAL") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edge Gateway | Cloud Diagnostics &amp; Latency Monitor</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: #ffffff;
      border-bottom: 1px solid #e2e8f0;
      padding: 14px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .logo-area {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 800;
      font-size: 16px;
      color: #0f172a;
    }
    .logo-icon {
      width: 32px;
      height: 32px;
      background: #0f172a;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      font-weight: 900;
      font-size: 15px;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: ${isUuidConfigured ? '#0f172a' : '#991b1b'};
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      color: #ffffff;
    }
    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: ${isUuidConfigured ? '#22c55e' : '#fca5a5'};
      box-shadow: 0 0 8px ${isUuidConfigured ? '#22c55e' : '#f87171'};
    }
    main {
      flex: 1;
      max-width: 920px;
      width: 100%;
      margin: 0 auto;
      padding: 32px 16px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .hero-card {
      background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 40%);
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 28px 24px;
      box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.03);
      position: relative;
    }
    .hero-top-badge {
      position: absolute;
      top: 24px;
      right: 24px;
      background: #dcfce7;
      border: 1px solid #bbf7d0;
      color: #166534;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 9999px;
    }
    .hero-title {
      font-size: 22px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 8px;
    }
    .hero-desc {
      color: #475569;
      font-size: 14px;
      line-height: 1.6;
      max-width: 680px;
      margin-bottom: 20px;
    }
    .btn-run {
      background: #0f172a;
      color: #ffffff;
      border: none;
      padding: 9px 18px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .bench-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 20px;
    }
    .bench-box {
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .bench-box-1 { background: #ecfdf5; border: 1px solid #a7f3d0; }
    .bench-box-2 { background: #f0fdf4; border: 1px solid #bbf7d0; }
    .bench-box-3 { background: #eef2ff; border: 1px solid #c7d2fe; }
    .bench-box-4 { background: #faf5ff; border: 1px solid #e9d5ff; }
    .bench-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: #475569;
    }
    .bench-val {
      font-size: 24px;
      font-weight: 800;
      color: #0f172a;
      margin-top: 4px;
      font-family: monospace;
    }
    .bench-meta {
      font-size: 12px;
      font-weight: 600;
      margin-top: 2px;
      color: #16a34a;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    @media (min-width: 768px) {
      .grid-2 { grid-template-columns: 1fr 1fr; }
    }
    .card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
    }
    .card-heading {
      font-size: 14px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 9px 0;
      border-bottom: 1px solid #f1f5f9;
      font-size: 13px;
    }
    .info-row:last-child { border-bottom: none; }
    .info-k { color: #64748b; font-weight: 500; }
    .info-v { color: #0f172a; font-family: monospace; font-weight: 700; }
    footer {
      background: #ffffff;
      border-top: 1px solid #e2e8f0;
      padding: 16px;
      text-align: center;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo-area">
      <div class="logo-icon">⚡</div>
      <span>EdgeTunnel Cloud</span>
    </div>
    <div class="status-pill">
      <span class="status-dot"></span>
      <span>${isUuidConfigured ? 'EDGE OPERATIONAL' : 'CONFIGURATION REQUIRED'}</span>
    </div>
  </header>

  <main>
    <div class="hero-card">
      <div class="hero-top-badge">${isUuidConfigured ? 'Ready' : 'Standby'}</div>
      <h1 class="hero-title">Edge Network Diagnostics &amp; Telemetry</h1>
      <p class="hero-desc">Real-time edge server telemetry, DNS-over-HTTPS status verification, and full-duplex socket connectivity diagnostics for cloud edge clusters.</p>
      
      <button class="btn-run" id="btnBench" onclick="runDiagnostics()">
        ⚡ Re-Run Benchmark
      </button>

      <div class="bench-grid">
        <div class="bench-box bench-box-1">
          <div class="bench-label">Roundtrip Ping</div>
          <div class="bench-val" id="pingVal">-- ms</div>
          <div class="bench-meta" id="pingStatus">Measuring...</div>
        </div>
        <div class="bench-box bench-box-2">
          <div class="bench-label">DNS-Over-HTTPS</div>
          <div class="bench-val">Active</div>
          <div class="bench-meta">Cloudflare 1.1.1.1</div>
        </div>
        <div class="bench-box bench-box-3">
          <div class="bench-label">WebSocket Engine</div>
          <div class="bench-val">Optimized</div>
          <div class="bench-meta">RFC 6455 Fast WS</div>
        </div>
        <div class="bench-box bench-box-4">
          <div class="bench-label">Edge Cluster Location</div>
          <div class="bench-val">${colo}</div>
          <div class="bench-meta">Anycast Network</div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-heading">🌐 Connection Telemetry</div>
        <div class="info-row">
          <span class="info-k">Client Remote IP:</span>
          <span class="info-v">${clientIp}</span>
        </div>
        <div class="info-row">
          <span class="info-k">Serving Host (SNI):</span>
          <span class="info-v">${host}</span>
        </div>
        <div class="info-row">
          <span class="info-k">HTTP Protocol:</span>
          <span class="info-v">HTTP/2 &amp; HTTP/3 (QUIC)</span>
        </div>
        <div class="info-row">
          <span class="info-k">Encryption &amp; Cipher:</span>
          <span class="info-v">TLS 1.3 / AEAD ChaCha20</span>
        </div>
      </div>

      <div class="card">
        <div class="card-heading">🛡️ Edge Security &amp; Health</div>
        <div class="info-row">
          <span class="info-k">Security Layer:</span>
          <span class="info-v" style="color: #16a34a;">Active</span>
        </div>
        <div class="info-row">
          <span class="info-k">Global Edge Cache:</span>
          <span class="info-v">100% Operational</span>
        </div>
        <div class="info-row">
          <span class="info-k">Service Status:</span>
          <span class="info-v" style="color: #16a34a;">Optimal (99.99%)</span>
        </div>
      </div>
    </div>
  </main>

  <footer>
    EdgeTunnel Cloud Network • High Availability Edge Gateway • All Systems Running
  </footer>

  <script>
    async function runDiagnostics() {
      const btn = document.getElementById('btnBench');
      const pingVal = document.getElementById('pingVal');
      const pingStatus = document.getElementById('pingStatus');

      btn.disabled = true;
      btn.textContent = "Testing...";
      pingVal.textContent = "...";

      const pings = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        try {
          await fetch('/healthz?t=' + Date.now(), { cache: 'no-store' });
          pings.push(Math.round(performance.now() - start));
        } catch (e) {
          pings.push(24);
        }
        await new Promise(r => setTimeout(r, 100));
      }

      const avg = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
      pingVal.textContent = avg + ' ms';
      pingStatus.textContent = "Optimal Latency";
      btn.disabled = false;
      btn.textContent = "⚡ Re-Run Benchmark";
    }

    setTimeout(runDiagnostics, 400);
  </script>
</body>
</html>`;
}

// ================= Unified Handler =================
async function handleRequest(request, env, ctx) {
  const config = getConfig(env);
  const url = new URL(request.url);
  const upgrade = request.headers.get("Upgrade");

  // 1. WebSocket VLESS Tunnel
  if (upgrade && upgrade.toLowerCase() === "websocket") {
    if (!config.isUuidValid) {
      return new Response("Unauthorized: Missing or invalid UUID configuration", { status: 401 });
    }
    if (url.pathname !== config.path) {
      return new Response("Not found", { status: 404 });
    }
    return openWebSocket(request, config);
  }

  // 2. Subscription Link (/sub)
  if (url.pathname === "/sub") {
    if (!config.isUuidValid) {
      return new Response("UUID not set in environment", { status: 400 });
    }
    const links = makeLinks(request, config);
    return new Response(links.base64, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "access-control-allow-origin": "*",
        "profile-update-interval": "12"
      }
    });
  }

  // 3. Health Check
  if (url.pathname === "/healthz") {
    return new Response("ok", { 
      headers: { 
        "cache-control": "no-store", 
        "content-type": "text/plain" 
      } 
    });
  }

  // 4. Default: Camouflage Mask Page
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const colo = (request.cf && request.cf.colo) ? request.cf.colo : "EDGE-ANYCAST";
  const html = getMaskPage(url.host, config.isUuidValid, clientIp, colo);

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0"
    }
  });
}

// Export 1: Standard Cloudflare Worker export
const worker = {
  fetch: handleRequest
};
export default worker;

// Export 2: Cloudflare Pages Functions export (Single-file Pages compatibility)
export async function onRequest(context) {
  return handleRequest(context.request, context.env, context);
}
export const onRequestGet = onRequest;
export const onRequestPost = onRequest;
