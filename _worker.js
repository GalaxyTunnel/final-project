import { connect } from "cloudflare:sockets";

// =========================================================================
// 🌟 ALL-IN-ONE HYBRID CLOUDFLARE WORKER (VLESS + TROJAN + AdBlock)
// =========================================================================

// 🔑 1. DEFAULT CONFIGURATION (Hardcoded Fallback - စိတ်ချစွာ ပြောင်းလဲနိုင်သည်)
const DEFAULT_UUID = "d342d11e-d424-4583-b36e-524ab1f0afa4";
const DEFAULT_WS_PATH = "/"; // လျှို့ဝှက်လမ်းကြောင်း ထားလိုပါက "/your-secret-path" ဟု ပြောင်းပါ

// 🌐 2. BALANCED GLOBAL PROXY POOL (Fast Anycast CDNs)
const GLOBAL_PROXY_POOL = [
    "cdn.xn--b6gac.eu.org",
    "cdn-all.xn--b6gac.eu.org",
    "cdn-b100.xn--b6gac.eu.org",
    "www.visa.com.sg",
    "www.visa.com.hk",
    "icook.hk",
    "icook.tw",
    "workers.cloudflare.com"
];

// 🛡️ 3. DoH DNS PROVIDERS (UDP Port 53 Failover)
const DOH_PROVIDERS = [
    "https://cloudflare-dns.com/dns-query",
    "https://dns.google/dns-query",
    "https://dns.quad9.net/dns-query"
];

// 🚫 4. FAST O(1) AD & TELEMETRY BLOCK LIST
const AD_DOMAINS = new Set([
    "doubleclick.net", "googleadservices.com", "googlesyndication.com",
    "adservice.google.com", "pagead2.googlesyndication.com", "adcolony.com",
    "appsflyer.com", "unityads.unity3d.com", "vungle.com", "applovin.com",
    "flurry.com", "adjust.com", "branch.io", "admob.com", "mopub.com",
    "criteo.com", "taboola.com", "outbrain.com", "scorecardresearch.com",
    "quantserve.com", "popads.net", "inmobi.com", "adroll.com",
    "amazon-adsystem.com", "adsafeprotected.com", "moatads.com", "openx.net"
]);

function isAdDomain(domain) {
    if (!domain) return false;
    const lower = domain.toLowerCase().trim();
    if (AD_DOMAINS.has(lower)) return true;
    for (const suffix of AD_DOMAINS) {
        if (lower.endsWith("." + suffix)) return true;
    }
    return /^(ad|ads|adservice|adserver|telemetry|track|tracker|analytics)\./i.test(lower);
}

function isValidUUID(uuid) {
    if (!uuid) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid.trim());
}

// ============================================
// SHA224 (Trojan Protocol Hashing)
// ============================================
function sha224(str) {
    function rightRotate(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
    }
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let result = '';
    const words = [];
    const asciiBitLength = str.length * 8;
    let hash = [
        0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939,
        0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4
    ];
    const k = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    let s = str;
    s += '\x80';
    while (s.length % 64 - 56) s += '\x00';
    for (let i = 0; i < s.length; i++) {
        const j = s.charCodeAt(i);
        if (j >> 8) return null;
        words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = (asciiBitLength);
    for (let j = 0; j < words.length;) {
        const w = words.slice(j, j += 16);
        const oldHash = hash.slice(0);
        for (let i = 0; i < 64; i++) {
            if (i >= 16) {
                const w15 = w[i - 15], w2 = w[i - 2];
                w[i] = (
                    w[i - 16] +
                    (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                    w[i - 7] +
                    (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
                ) | 0;
            }
            const a = hash[0], e = hash[4];
            const temp1 = (
                hash[7] +
                (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
                ((e & hash[5]) ^ (~e & hash[6])) +
                k[i] +
                w[i]
            );
            const temp2 = (
                (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
                ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))
            );
            hash = [(temp1 + temp2) | 0].concat(hash);
            hash[4] = (hash[4] + temp1) | 0;
            hash.pop();
        }
        for (let i = 0; i < 8; i++) {
            hash[i] = (hash[i] + oldHash[i]) | 0;
        }
    }
    for (let i = 0; i < 7; i++) {
        const hex = hash[i];
        result += ((hex >> 28) & 0xf).toString(16) +
            ((hex >> 24) & 0xf).toString(16) +
            ((hex >> 20) & 0xf).toString(16) +
            ((hex >> 16) & 0xf).toString(16) +
            ((hex >> 12) & 0xf).toString(16) +
            ((hex >> 8) & 0xf).toString(16) +
            ((hex >> 4) & 0xf).toString(16) +
            (hex & 0xf).toString(16);
    }
    return result;
}

// ============================================
// MAIN WORKER FETCH HANDLER
// ============================================
export default {
    async fetch(request, env = {}, ctx = {}) {
        // 1. UUID & Trojan Pass Resolution (One-UUID-For-All)
        const userID = (env.UUID || env.uuid || DEFAULT_UUID).trim().toLowerCase();
        const trojanPass = env.TROJAN_PASS || env.trojan_pass || userID; // UUID တစ်ခုတည်းဖြင့် Trojan ပါ အလိုအလျောက် သုံးနိုင်သည်
        
        // 2. Secret WS Path
        const rawSecretPath = env.WS_PATH || env.ws_path || DEFAULT_WS_PATH;
        const expectedSecretPath = rawSecretPath.startsWith("/") ? rawSecretPath : "/" + rawSecretPath;

        // 3. User Requested Proxy IP Override
        const customProxy = env.PROXYIP || env.proxyip || null;

        const url = new URL(request.url);
        const pathname = url.pathname;
        const upgradeHeader = request.headers.get("Upgrade");

        // 4. WebSocket Proxy Request (Works for TLS Port 443 AND Non-TLS Port 80!)
        if (upgradeHeader === "websocket") {
            // Secret Path Protection: Scanner probing ကာကွယ်ခြင်း
            if (expectedSecretPath !== "/" && pathname !== expectedSecretPath) {
                return new Response("Not Found", { status: 404 });
            }
            return await handleProxyWS(request, userID, trojanPass, customProxy);
        }

        // 5. Diagnostics API
        if (pathname === "/api/health" || pathname === "/api/ping") {
            return new Response(JSON.stringify({
                status: "operational",
                colo: request.cf?.colo || "EDGE-GLOBAL",
                ip: request.headers.get("CF-Connecting-IP") || "127.0.0.1",
                time: Date.now()
            }), {
                status: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        // 6. Camouflage Mask Page (Corporate Latency Diagnostics - Zero Leaks)
        const host = request.headers.get("Host") || url.host;
        const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
        const colo = request.cf?.colo || "EDGE-GLOBAL";
        return new Response(getCamouflagePage(host, clientIp, colo), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" }
        });
    }
};

// ============================================
// DUAL-PROTOCOL WEBSOCKET PROXY HANDLER
// ============================================
async function handleProxyWS(request, validUUID, trojanPassword, customProxy) {
    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);
    webSocket.accept();

    // 🟢 35-Second Keep-Alive Heartbeat (Mobile Data Idle Timeout Prevention)
    const keepAlive = setInterval(() => {
        if (webSocket.readyState === 1) {
            try { webSocket.send(new Uint8Array(0)); } catch (e) { clearInterval(keepAlive); }
        } else {
            clearInterval(keepAlive);
        }
    }, 35000);

    webSocket.addEventListener("close", () => clearInterval(keepAlive));
    webSocket.addEventListener("error", () => clearInterval(keepAlive));

    const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
    const readableStream = makeReadableWSStream(webSocket, earlyDataHeader);

    let remoteSocketWrapper = { value: null };
    let udpStreamWrite = null;
    let isDns = false;

    readableStream.pipeTo(new WritableStream({
        async write(chunk) {
            if (isDns && udpStreamWrite) return udpStreamWrite(chunk);
            if (remoteSocketWrapper.value) {
                const writer = remoteSocketWrapper.value.writable.getWriter();
                await writer.write(chunk);
                writer.releaseLock();
                return;
            }

            const firstByte = new Uint8Array(chunk.slice(0, 1))[0];
            let result = null;

            // 1. Try VLESS (First Byte == 0x00)
            if (firstByte === 0x00) {
                try {
                    result = processVlessHeader(chunk, validUUID);
                } catch (e) {
                    result = { hasError: true, message: e.message };
                }
            }

            // 2. Fallback to TROJAN
            if ((!result || result.hasError) && trojanPassword) {
                result = processTrojanHeader(chunk, trojanPassword);
            }

            if (!result || result.hasError) {
                throw new Error(result ? result.message : "Authentication Failed");
            }

            const { addressRemote = "", portRemote = 443, rawDataIndex, responseHeader, isUDP } = result;

            // 🛡️ AD & TRACKER BLOCK CHECK
            if (isAdDomain(addressRemote)) {
                safeCloseWS(webSocket);
                return;
            }

            if (isUDP && portRemote === 53) isDns = true;

            const rawClientData = chunk.slice(rawDataIndex);

            if (isDns) {
                const { write } = await handleUDPOutBound(webSocket, responseHeader);
                udpStreamWrite = write;
                udpStreamWrite(rawClientData);
                return;
            }

            // TCP Outbound Connection
            handleTCPOutbound(remoteSocketWrapper, addressRemote, portRemote, rawClientData, webSocket, responseHeader, customProxy);
        },
        close() { safeCloseWS(webSocket); },
        abort() { safeCloseWS(webSocket); }
    })).catch(() => safeCloseWS(webSocket));

    return new Response(null, { status: 101, webSocket: client });
}

// ============================================
// TCP OUTBOUND WITH SMART PROXY FALLBACK
// ============================================
async function handleTCPOutbound(remoteSocket, addressRemote, portRemote, rawClientData, webSocket, responseHeader, customProxy) {
    async function connectAndWrite(targetHost, targetPort) {
        const tcpSocket = connect({ hostname: targetHost, port: targetPort });
        remoteSocket.value = tcpSocket;
        const writer = tcpSocket.writable.getWriter();
        await writer.write(rawClientData);
        writer.releaseLock();
        return tcpSocket;
    }

    async function retryWithProxy() {
        // Select clean proxy IP: custom override first, or pick from balanced global pool
        const selectedProxy = customProxy || GLOBAL_PROXY_POOL[Math.floor(Math.random() * GLOBAL_PROXY_POOL.length)];
        try {
            const fallbackSocket = await connectAndWrite(selectedProxy, portRemote);
            fallbackSocket.closed.catch(() => safeCloseWS(webSocket));
            pipeRemoteToWS(fallbackSocket, webSocket, null, null);
        } catch (e) {
            safeCloseWS(webSocket);
        }
    }

    try {
        const directSocket = await connectAndWrite(addressRemote, portRemote);
        pipeRemoteToWS(directSocket, webSocket, responseHeader, retryWithProxy);
    } catch (err) {
        await retryWithProxy();
    }
}

// ============================================
// REMOTE TO WEBSOCKET PIPE
// ============================================
async function pipeRemoteToWS(remoteSocket, webSocket, responseHeader, retry) {
    let header = responseHeader;
    let hasData = false;

    await remoteSocket.readable.pipeTo(new WritableStream({
        async write(chunk, controller) {
            hasData = true;
            if (webSocket.readyState !== 1) controller.error("WS closed");
            if (header && header.byteLength > 0) {
                webSocket.send(await new Blob([header, chunk]).arrayBuffer());
                header = null;
            } else {
                webSocket.send(chunk);
            }
        }
    })).catch(() => safeCloseWS(webSocket));

    if (!hasData && retry) retry();
}

// ============================================
// PROTOCOL PARSERS (VLESS & TROJAN)
// ============================================
function processVlessHeader(vlessBuffer, validUUID) {
    if (vlessBuffer.byteLength < 24) return { hasError: true, message: "Too short" };
    const version = new Uint8Array(vlessBuffer.slice(0, 1));
    const slicedUUID = unsafeStringify(new Uint8Array(vlessBuffer.slice(1, 17)));

    if (slicedUUID !== validUUID.toLowerCase()) {
        return { hasError: true, message: "Invalid UUID" };
    }

    const optLen = new Uint8Array(vlessBuffer.slice(17, 18))[0];
    const command = new Uint8Array(vlessBuffer.slice(18 + optLen, 19 + optLen))[0];
    const isUDP = command === 2;

    const portIndex = 19 + optLen;
    const portRemote = new DataView(vlessBuffer.slice(portIndex, portIndex + 2)).getUint16(0);

    const addrIndex = portIndex + 2;
    const addrType = new Uint8Array(vlessBuffer.slice(addrIndex, addrIndex + 1))[0];
    let addrLen = 0, valIndex = addrIndex + 1, addressRemote = "";

    if (addrType === 1) { // IPv4
        addrLen = 4;
        addressRemote = new Uint8Array(vlessBuffer.slice(valIndex, valIndex + addrLen)).join(".");
    } else if (addrType === 2) { // Domain
        addrLen = new Uint8Array(vlessBuffer.slice(valIndex, valIndex + 1))[0];
        valIndex += 1;
        addressRemote = new TextDecoder().decode(vlessBuffer.slice(valIndex, valIndex + addrLen));
    } else if (addrType === 3) { // IPv6
        addrLen = 16;
        const view = new DataView(vlessBuffer.slice(valIndex, valIndex + addrLen));
        const parts = [];
        for (let i = 0; i < 8; i++) parts.push(view.getUint16(i * 2).toString(16));
        addressRemote = parts.join(":");
    }

    return {
        hasError: false,
        addressRemote,
        portRemote,
        rawDataIndex: valIndex + addrLen,
        responseHeader: new Uint8Array([version[0], 0]),
        isUDP
    };
}

function processTrojanHeader(trojanBuffer, password) {
    if (trojanBuffer.byteLength < 58) return { hasError: true, message: "Trojan short" };
    const bytes = new Uint8Array(trojanBuffer);
    if (bytes[56] !== 0x0d || bytes[57] !== 0x0a) return { hasError: true, message: "Missing CRLF" };

    const receivedHash = new TextDecoder().decode(bytes.slice(0, 56));
    if (receivedHash !== sha224(password)) return { hasError: true, message: "Wrong Trojan pass" };

    const command = bytes[58];
    const addrType = bytes[59];
    let addressRemote = "", addrLen = 0, valIndex = 60;
    const view = new DataView(trojanBuffer);

    if (addrType === 0x01) {
        addrLen = 4;
        addressRemote = Array.from(bytes.slice(valIndex, valIndex + addrLen)).join(".");
    } else if (addrType === 0x03) {
        addrLen = bytes[60]; valIndex = 61;
        addressRemote = new TextDecoder().decode(bytes.slice(valIndex, valIndex + addrLen));
    } else if (addrType === 0x04) {
        addrLen = 16;
        addressRemote = Array.from({ length: 8 }, (_, i) => view.getUint16(valIndex + i * 2).toString(16)).join(":");
    }

    const portIndex = valIndex + addrLen;
    const portRemote = view.getUint16(portIndex);
    const crlf = portIndex + 2;

    return {
        hasError: false,
        addressRemote,
        portRemote,
        rawDataIndex: crlf + 2,
        responseHeader: new Uint8Array(0),
        isUDP: command === 0x03
    };
}

// ============================================
// UDP DoH HANDLER
// ============================================
async function handleUDPOutBound(webSocket, responseHeader) {
    let isHeaderSent = false;
    const transformStream = new TransformStream({
        transform(chunk, controller) {
            for (let i = 0; i < chunk.byteLength; ) {
                const len = new DataView(chunk.slice(i, i + 2)).getUint16(0);
                controller.enqueue(new Uint8Array(chunk.slice(i + 2, i + 2 + len)));
                i += 2 + len;
            }
        }
    });

    transformStream.readable.pipeTo(new WritableStream({
        async write(chunk) {
            for (const url of DOH_PROVIDERS) {
                try {
                    const resp = await fetch(url, {
                        method: "POST",
                        headers: { "content-type": "application/dns-message" },
                        body: chunk
                    });
                    const dnsResult = await resp.arrayBuffer();
                    const size = dnsResult.byteLength;
                    const sizeBuf = new Uint8Array([size >> 8 & 255, size & 255]);

                    if (webSocket.readyState === 1) {
                        if (isHeaderSent) {
                            webSocket.send(await new Blob([sizeBuf, dnsResult]).arrayBuffer());
                        } else {
                            webSocket.send(await new Blob([responseHeader, sizeBuf, dnsResult]).arrayBuffer());
                            isHeaderSent = true;
                        }
                        return;
                    }
                } catch (e) { /* failover to next provider */ }
            }
        }
    })).catch(() => {});

    const writer = transformStream.writable.getWriter();
    return { write: (c) => writer.write(c) };
}

// ============================================
// UTILITIES
// ============================================
function makeReadableWSStream(webSocket, earlyDataHeader) {
    return new ReadableStream({
        start(controller) {
            webSocket.addEventListener("message", (e) => controller.enqueue(e.data));
            webSocket.addEventListener("close", () => controller.close());
            webSocket.addEventListener("error", (e) => controller.error(e));
            if (earlyDataHeader) {
                try {
                    const dec = atob(earlyDataHeader.replace(/-/g, "+").replace(/_/g, "/"));
                    controller.enqueue(Uint8Array.from(dec, c => c.charCodeAt(0)).buffer);
                } catch (e) {}
            }
        },
        cancel() { safeCloseWS(webSocket); }
    });
}

function safeCloseWS(ws) {
    try { if (ws && (ws.readyState === 1 || ws.readyState === 2)) ws.close(); } catch(e) {}
}

const byteToHex = Array.from({ length: 256 }, (_, i) => (i + 256).toString(16).slice(1));
function unsafeStringify(arr, offset = 0) {
    return (byteToHex[arr[offset]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" +
        byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" +
        byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" +
        byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" +
        byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}

// ============================================
// CAMOUFLAGE MASK PAGE (Edge Diagnostics)
// ============================================
function getCamouflagePage(host, clientIp, colo) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edge Network Gateway | Latency & Health Diagnostics</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0b0f17; color: #e2e8f0; margin: 0; padding: 24px; display: flex; justify-content: center; align-items: center; min-height: 100vh; box-sizing: border-box; }
    .card { background: #131b2e; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; max-width: 540px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(34,197,94,0.15); color: #4ade80; padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid rgba(34,197,94,0.3); }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px #22c55e; }
    h1 { font-size: 20px; font-weight: 800; margin: 16px 0 8px 0; color: #ffffff; }
    p { font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0 0 20px 0; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
    .box { background: #0f172a; padding: 12px 14px; border-radius: 10px; border: 1px solid #1e293b; }
    .label { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; }
    .val { font-size: 14px; font-weight: 700; color: #f8fafc; font-family: monospace; margin-top: 4px; }
    .btn { width: 100%; background: #2563eb; color: #fff; border: none; padding: 10px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge"><span class="dot"></span> EDGE OPERATIONAL</div>
    <h1>Cloud Network Edge Gateway</h1>
    <p>Real-time edge cluster connectivity and Anycast latency telemetry active.</p>
    <div class="grid">
      <div class="box"><div class="label">POP Region</div><div class="val">${colo}</div></div>
      <div class="box"><div class="label">Roundtrip Ping</div><div class="val" id="p">-- ms</div></div>
      <div class="box"><div class="label">Protocol</div><div class="val">HTTP/2 & HTTP/3</div></div>
      <div class="box"><div class="label">Client IP</div><div class="val">${clientIp}</div></div>
    </div>
    <button class="btn" onclick="t()">⚡ Test Latency</button>
  </div>
  <script>
    async function t() {
      const s = performance.now();
      try { await fetch('/api/health?t=' + Date.now()); const d = Math.round(performance.now() - s); document.getElementById('p').textContent = d + ' ms'; }
      catch(e) { document.getElementById('p').textContent = '22 ms'; }
    }
    setTimeout(t, 200);
  </script>
</body>
</html>`;
      }
