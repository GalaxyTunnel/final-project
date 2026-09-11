// ==============================================================================
// PURE VLESS CLOUDFLARE WORKER RELAY (CLEAN & MINIMAL)
// - Protocol: 100% Pure VLESS (No Trojan conflicts)
// - Ports: Port 80, 8080, 8880 (No-TLS) & Port 443, 8443 (TLS 1.3)
// - Features: Hybrid Proxy IP Fallback (No 1000 Error) | Multi-DoH Race DNS
// - Compatibility: v2rayNG, v2rayN, Shadowrocket, Sing-box, Clash Meta, Nekobox
// ==============================================================================

import { connect } from "cloudflare:sockets";

// Default UUID (Can be overridden by Cloudflare Environment Variable 'UUID')
const DEFAULT_UUID = "";
const DEFAULT_PROXY_IP = "cdn-b100.xn--b6gac.eu.org";
const DEFAULT_PROXY_URL = "https://gprox-galaxy.github.io/PROXYIP.txt";

let cachedProxyList = [];
let lastProxyFetchTime = 0;
const PROXY_CACHE_TTL = 3600000; // 1 hour

// ------------------------------------------------------------------------------
// Helper: UUID Parsing & Comparison
// ------------------------------------------------------------------------------
function isValidUUID(uuid) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return re.test(uuid);
}

function stringToUUIDBytes(uuidStr) {
  const clean = uuidStr.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

function compareBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function base64ToArrayBuffer(base64Str) {
  if (!base64Str) return { earlyData: null, error: null };
  try {
    const b64 = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { earlyData: bytes.buffer, error: null };
  } catch (err) {
    return { earlyData: null, error: err };
  }
}

function safeCloseWebSocket(ws) {
  try {
    if (ws.readyState === 1 || ws.readyState === 0) {
      ws.close(1000, "Normal Closure");
    }
  } catch (_) {}
}

// ------------------------------------------------------------------------------
// Hybrid Proxy IP Pool (Fixes Cloudflare 1000/1001 Direct Connection Loop Errors)
// ------------------------------------------------------------------------------
async function getHybridProxyIP(fallbackProxyIP, githubProxyURL) {
  const now = Date.now();
  if (cachedProxyList.length > 0 && now - lastProxyFetchTime < PROXY_CACHE_TTL) {
    return cachedProxyList[Math.floor(Math.random() * cachedProxyList.length)];
  }

  const targetURL = githubProxyURL || DEFAULT_PROXY_URL;
  try {
    const res = await fetch(targetURL, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cf: { cacheTtl: 3600 }
    });
    if (res.ok) {
      const text = await res.text();
      const list = text
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && (l.includes(".") || l.includes(":")));
      if (list.length > 0) {
        cachedProxyList = list;
        lastProxyFetchTime = now;
        return cachedProxyList[Math.floor(Math.random() * cachedProxyList.length)];
      }
    }
  } catch (_) {}

  return fallbackProxyIP || DEFAULT_PROXY_IP;
}

// ------------------------------------------------------------------------------
// Multi-DoH DNS Pool (Fast UDP DNS Resolution via Promise.any Race)
// ------------------------------------------------------------------------------
const DOH_PROVIDERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/dns-query",
  "https://dns.quad9.net/dns-query",
  "https://doh.opendns.com/dns-query"
];

async function handleUDPOutBound(webSocketServer, responseHeader, client) {
  let isHeaderSent = false;

  const transformStream = new TransformStream({
    async transform(chunk, controller) {
      let offset = 0;
      while (offset < chunk.byteLength) {
        if (offset + 2 > chunk.byteLength) break;
        const length = (chunk[offset] << 8) | chunk[offset + 1];
        offset += 2;
        if (offset + length > chunk.byteLength) break;
        const dnsQuery = chunk.slice(offset, offset + length);
        offset += length;

        try {
          const fetchDOH = (url) =>
            fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/dns-message",
                Accept: "application/dns-message"
              },
              body: dnsQuery
            });

          const res = await Promise.any(DOH_PROVIDERS.map((doh) => fetchDOH(doh)));
          if (res.ok) {
            const dnsResponse = await res.arrayBuffer();
            const respBytes = new Uint8Array(dnsResponse);
            const respLen = respBytes.length;
            const packet = new Uint8Array(2 + respLen);
            packet[0] = (respLen >> 8) & 0xff;
            packet[1] = respLen & 0xff;
            packet.set(respBytes, 2);

            if (!isHeaderSent) {
              controller.enqueue(new Uint8Array([...responseHeader, ...packet]));
              isHeaderSent = true;
            } else {
              controller.enqueue(packet);
            }
          }
        } catch (_) {}
      }
    }
  });

  transformStream.readable
    .pipeTo(
      new WritableStream({
        write(chunk) {
          if (client.readyState === 1) client.send(chunk);
        },
        close() {
          safeCloseWebSocket(webSocketServer);
        },
        abort() {
          safeCloseWebSocket(webSocketServer);
        }
      })
    )
    .catch(() => safeCloseWebSocket(webSocketServer));

  return transformStream.writable;
}

// ------------------------------------------------------------------------------
// TCP Outbound Relay with Fallback Proxy IP
// ------------------------------------------------------------------------------
async function handleTCPOutBound(remoteSocket, addressRemote, portRemote, rawClientData, client, responseHeader, proxyIP, githubProxyURL) {
  async function connectAndWrite(address, port) {
    const tcpSocket = connect({ hostname: address, port });
    remoteSocket.value = tcpSocket;
    const writer = tcpSocket.writable.getWriter();
    await writer.write(rawClientData);
    writer.releaseLock();
    return tcpSocket;
  }

  async function retry() {
    const activeProxy = await getHybridProxyIP(proxyIP, githubProxyURL);
    const target = activeProxy || addressRemote;
    try {
      const fallbackSocket = await connectAndWrite(target, portRemote);
      fallbackSocket.closed.catch(() => {}).finally(() => safeCloseWebSocket(client));
      remoteSocketToClient(fallbackSocket, client, responseHeader, null);
    } catch (_) {
      safeCloseWebSocket(client);
    }
  }

  try {
    const primarySocket = await connectAndWrite(addressRemote, portRemote);
    remoteSocketToClient(primarySocket, client, responseHeader, retry);
  } catch (_) {
    await retry();
  }
}

async function remoteSocketToClient(remoteSocket, client, responseHeader, retry) {
  let header = responseHeader;
  let hasIncomingData = false;

  await remoteSocket.readable
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          hasIncomingData = true;
          if (client.readyState !== 1) {
            controller.error("WebSocket closed");
            return;
          }
          if (header) {
            client.send(await new Blob([header, chunk]).arrayBuffer());
            header = null;
          } else {
            client.send(chunk);
          }
        },
        close() {
          safeCloseWebSocket(client);
        },
        abort() {
          safeCloseWebSocket(client);
        }
      })
    )
    .catch(() => {
      safeCloseWebSocket(client);
      if (!hasIncomingData && retry) retry();
    });
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader) {
  return new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => controller.enqueue(event.data));
      webSocketServer.addEventListener("close", () => {
        safeCloseWebSocket(webSocketServer);
        controller.close();
      });
      webSocketServer.addEventListener("error", (err) => controller.error(err));

      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) controller.error(error);
      else if (earlyData) controller.enqueue(earlyData);
    },
    cancel() {
      safeCloseWebSocket(webSocketServer);
    }
  });
}

// ------------------------------------------------------------------------------
// Pure VLESS WebSocket Stream Handler
// ------------------------------------------------------------------------------
async function handleVlessWS(request, allowedUUIDList, proxyIP, githubProxyURL) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocketServer] = Object.values(webSocketPair);
  webSocketServer.accept();

  const earlyDataHeader = request.headers.get("sec-websocket-protocol");
  const readableWebSocketStream = makeReadableWebSocketStream(webSocketServer, earlyDataHeader);

  let remoteSocket = { value: null };
  let udpWriter = null;

  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          if (udpWriter) {
            udpWriter.write(chunk);
            return;
          }

          if (remoteSocket.value) {
            const writer = remoteSocket.value.writable.getWriter();
            await writer.write(chunk);
            writer.releaseLock();
            return;
          }

          if (chunk.byteLength < 18) {
            controller.error("Invalid VLESS packet length");
            return;
          }

          // 1. Verify VLESS UUID
          const clientUUIDBytes = new Uint8Array(chunk.slice(1, 17));
          let isAuthorized = false;

          for (const validUUID of allowedUUIDList) {
            if (compareBytes(clientUUIDBytes, stringToUUIDBytes(validUUID))) {
              isAuthorized = true;
              break;
            }
          }

          if (!isAuthorized) {
            controller.error("Unauthorized VLESS UUID");
            return;
          }

          // 2. Parse VLESS Protocol Fields
          const optLen = new Uint8Array(chunk.slice(17, 18))[0];
          let cursor = 18 + optLen;

          const command = new Uint8Array(chunk.slice(cursor, cursor + 1))[0];
          cursor += 1;

          const portRemote = new DataView(chunk.slice(cursor, cursor + 2)).getUint16(0);
          cursor += 2;

          const addressType = new Uint8Array(chunk.slice(cursor, cursor + 1))[0];
          cursor += 1;

          let addressRemote = "";
          if (addressType === 1) {
            // IPv4
            addressRemote = new Uint8Array(chunk.slice(cursor, cursor + 4)).join(".");
            cursor += 4;
          } else if (addressType === 2) {
            // Domain
            const domainLength = new Uint8Array(chunk.slice(cursor, cursor + 1))[0];
            cursor += 1;
            addressRemote = new TextDecoder().decode(chunk.slice(cursor, cursor + domainLength));
            cursor += domainLength;
          } else if (addressType === 3) {
            // IPv6
            const ipv6View = new DataView(chunk.slice(cursor, cursor + 16));
            const parts = [];
            for (let i = 0; i < 8; i++) parts.push(ipv6View.getUint16(i * 2).toString(16));
            addressRemote = parts.join(":");
            cursor += 16;
          }

          const rawClientData = chunk.slice(cursor);
          const vlessResponseHeader = new Uint8Array([chunk[0], 0]);

          if (command === 1) {
            // TCP Outbound (Normal Internet Traffic)
            handleTCPOutBound(remoteSocket, addressRemote, portRemote, rawClientData, client, vlessResponseHeader, proxyIP, githubProxyURL);
          } else if (command === 2) {
            // UDP DNS Outbound (Port 53 via Multi-DoH)
            udpWriter = await handleUDPOutBound(webSocketServer, vlessResponseHeader, client);
            udpWriter.write(rawClientData);
          } else {
            controller.error(`Unsupported command: ${command}`);
          }
        },
        close() {
          safeCloseWebSocket(webSocketServer);
        },
        abort() {
          safeCloseWebSocket(webSocketServer);
        }
      })
    )
    .catch(() => safeCloseWebSocket(webSocketServer));

  return new Response(null, { status: 101, webSocket: client });
}

// ------------------------------------------------------------------------------
// Subscription Generator (Pure VLESS Links)
// ------------------------------------------------------------------------------
function makeVlessLinks(request, uuid) {
  const url = new URL(request.url);
  const host = url.host;
  const cleanIpParam = url.searchParams.get("cleanip") || "";
  const address = cleanIpParam.trim() || host;

  const path = encodeURIComponent("/?ed=2048");

  // 1. Port 80 (No-TLS) - Best for Speed / DPI Bypass
  const vless80 = `vless://${uuid}@${address}:80?encryption=none&security=none&type=ws&host=${host}&path=${path}#${encodeURIComponent(`[VLESS-NoTLS:80] ${host}`)}`;

  // 2. Port 8080 (Alternative HTTP) - MPT / Atom Best Compatibility
  const vless8080 = `vless://${uuid}@${address}:8080?encryption=none&security=none&type=ws&host=${host}&path=${path}#${encodeURIComponent(`[VLESS-NoTLS:8080] ${host}`)}`;

  // 3. Port 443 (TLS 1.3) - Standard Encrypted Node
  const vless443 = `vless://${uuid}@${address}:443?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=${path}#${encodeURIComponent(`[VLESS-TLS:443] ${host}`)}`;

  // 4. Port 8443 (Alternative TLS)
  const vless8443 = `vless://${uuid}@${address}:8443?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=${path}#${encodeURIComponent(`[VLESS-TLS:8443] ${host}`)}`;

  const allLinks = [vless80, vless8080, vless443, vless8443];
  const base64Sub = btoa(allLinks.join("\n"));

  return { vless80, vless8080, vless443, vless8443, allLinks, base64Sub };
}

// ------------------------------------------------------------------------------
// Camouflage Webpage
// ------------------------------------------------------------------------------
function getMaskPage(host, clientIp, colo) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edge Network Gateway</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0e17; color: #f1f5f9; min-height: 100vh; display: flex; flex-direction: column; }
    header { background: #0f172a; border-bottom: 1px solid #1e293b; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; }
    .status { color: #10b981; font-size: 13px; font-weight: 600; }
    main { max-width: 600px; margin: 40px auto; padding: 0 20px; flex: 1; }
    .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 24px; }
    h1 { font-size: 18px; margin-bottom: 8px; color: #38bdf8; }
    p { font-size: 13px; color: #94a3b8; line-height: 1.6; }
    .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1e293b; font-size: 13px; }
    .lbl { color: #64748b; }
    .val { font-family: monospace; color: #e2e8f0; }
  </style>
</head>
<body>
  <header>
    <div style="font-weight: 700; color: #38bdf8;">Cloudflare Anycast Gateway</div>
    <div class="status">● Active</div>
  </header>
  <main>
    <div class="card">
      <h1>VLESS Relay Gateway Online</h1>
      <p>WebSocket Anycast Ingress Node.</p>
      <div style="margin-top: 20px;">
        <div class="row"><span class="lbl">Host</span><span class="val">${host}</span></div>
        <div class="row"><span class="lbl">Client IP</span><span class="val">${clientIp}</span></div>
        <div class="row"><span class="lbl">POP Location</span><span class="val">${colo}</span></div>
        <div class="row"><span class="lbl">HTTP Ports</span><span class="val">80, 8080, 8880</span></div>
        <div class="row"><span class="lbl">HTTPS Ports</span><span class="val">443, 8443</span></div>
      </div>
    </div>
  </main>
</body>
</html>`;
}

// ------------------------------------------------------------------------------
// Main Fetch Handler
// ------------------------------------------------------------------------------
export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);

    // 1. Config
    const envUUID = (env.UUID || "").trim().toLowerCase();
    const proxyIP = (env.PROXYIP || "").trim() || DEFAULT_PROXY_IP;
    const proxyURL = (env.PROXY_LIST_URL || "").trim() || DEFAULT_PROXY_URL;

    const allowedUUIDList = envUUID
      ? envUUID.includes(",")
        ? envUUID.split(",").map((u) => u.trim().toLowerCase()).filter(isValidUUID)
        : [envUUID]
      : [DEFAULT_UUID];

    const activeUUID = allowedUUIDList[0] || DEFAULT_UUID;

    // 2. Pure VLESS WebSocket Relay
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      return await handleVlessWS(request, allowedUUIDList, proxyIP, proxyURL);
    }

    // 3. Subscription Endpoint (/sub)
    if (url.pathname === "/sub") {
      const { allLinks, base64Sub } = makeVlessLinks(request, activeUUID);
      const isPlain = url.searchParams.get("format") === "plain";
      return new Response(isPlain ? allLinks.join("\n") : base64Sub, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Profile-Update-Interval": "24"
        }
      });
    }

    // 4. API Health Check
    if (url.pathname === "/api/health" || url.pathname === "/api/ping") {
      return new Response(
        JSON.stringify({
          status: "ok",
          protocol: "vless",
          ports: [80, 8080, 8880, 443, 8443],
          colo: request.cf?.colo || "EDGE",
          timestamp: Date.now()
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // 5. Default: Camouflage Webpage
    const host = request.headers.get("Host") || url.host;
    const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
    const colo = request.cf?.colo || "EDGE-ANYCAST";

    return new Response(getMaskPage(host, clientIp, colo), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600"
      }
    });
  }
};
