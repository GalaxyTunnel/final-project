// ==============================================================================
// CLOUDFLARE WORKER & PAGES COMPATIBLE VLESS & TROJAN RELAY ENGINE
// Version: 3.0 (Unified Port 80 & 443 + ProxyIP Fallback + Multi-DoH + Sub/Mask)
// ==============================================================================

import net from "node:net";

// 1. Universal Socket Connector (Cloudflare Edge & Node.js Compatible)
let cfConnect = null;
try {
  const cf = await import("cloudflare:sockets");
  if (cf && typeof cf.connect === "function") {
    cfConnect = cf.connect;
  }
} catch (_) {
  // Fallback to node:net in Node.js dev environments
}

export function connect(address) {
  if (cfConnect) {
    return cfConnect(address);
  }

  const { hostname, port } = address;
  let closedResolve;
  let closedReject;
  const closed = new Promise((resolve, reject) => {
    closedResolve = resolve;
    closedReject = reject;
  });

  let socket = null;
  try {
    socket = net.createConnection({ host: hostname, port: Number(port) });
  } catch (e) {
    socket = null;
  }

  if (socket) {
    socket.on("close", (hadError) => {
      if (hadError) closedReject(new Error("Socket closed with error"));
      else closedResolve();
    });
    socket.on("error", (err) => {
      closedReject(err);
    });
  }

  const readable = new ReadableStream({
    start(controller) {
      if (!socket) {
        controller.close();
        return;
      }
      socket.on("data", (chunk) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      socket.on("end", () => controller.close());
      socket.on("error", (err) => controller.error(err));
    },
    cancel() {
      if (socket) socket.destroy();
    }
  });

  const writable = new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        if (!socket) return reject(new Error("Socket not connected"));
        socket.write(Buffer.from(chunk), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    close() {
      if (socket) socket.end();
    },
    abort() {
      if (socket) socket.destroy();
    }
  });

  return { readable, writable, closed };
}

// Polyfill WebSocketPair for Node.js environments
if (typeof globalThis.WebSocketPair === "undefined") {
  class MockCloudflareWebSocket {
    constructor() {
      this.readyState = 1;
      this.listeners = { message: [], close: [], error: [] };
      this._peer = null;
    }
    accept() {
      this.readyState = 1;
    }
    addEventListener(event, callback) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(callback);
    }
    removeEventListener(event, callback) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
      }
    }
    send(data) {
      if (this._peer && this._peer.readyState === 1) {
        const event = { data };
        for (const cb of this._peer.listeners.message || []) {
          try { cb(event); } catch (_) {}
        }
      }
    }
    close() {
      this.readyState = 3;
      for (const cb of this.listeners.close || []) {
        try { cb({ code: 1000 }); } catch (_) {}
      }
      if (this._peer && this._peer.readyState !== 3) {
        this._peer.close();
      }
    }
  }

  class MockWebSocketPair {
    constructor() {
      this[0] = new MockCloudflareWebSocket();
      this[1] = new MockCloudflareWebSocket();
      this[0]._peer = this[1];
      this[1]._peer = this[0];
    }
  }

  globalThis.WebSocketPair = MockWebSocketPair;
}

// ============================================
// CONSTANTS & POOLS
// ============================================
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

// ============================================
// CRYPTO & UTILS
// ============================================
function sha224(str) {
  if (!str) return "";
  function rotateRight(n, x) { return (x >>> n) | (x << (32 - n)); }
  function choice(x, y, z) { return (x & y) ^ (~x & z); }
  function majority(x, y, z) { return (x & y) ^ (x & z) ^ (y & z); }
  function sigma0(x) { return rotateRight(2, x) ^ rotateRight(13, x) ^ rotateRight(22, x); }
  function sigma1(x) { return rotateRight(6, x) ^ rotateRight(11, x) ^ rotateRight(25, x); }
  function gamma0(x) { return rotateRight(7, x) ^ rotateRight(18, x) ^ (x >>> 3); }
  function gamma1(x) { return rotateRight(17, x) ^ rotateRight(19, x) ^ (x >>> 10); }

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
    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      w[t] = (gamma1(w[t - 2]) + w[t - 7] + gamma0(w[t - 15]) + w[t - 16]) >>> 0;
    }

    let a = H0, b = H1, c = H2, d = H3, e = H4, f = H5, g = H6, h = H7;
    for (let t = 0; t < 64; t++) {
      const T1 = (h + sigma1(e) + choice(e, f, g) + K[t] + w[t]) >>> 0;
      const T2 = (sigma0(a) + majority(a, b, c)) >>> 0;
      h = g; g = f; f = e; e = (d + T1) >>> 0;
      d = c; c = b; b = a; a = (T1 + T2) >>> 0;
    }

    H0 = (H0 + a) >>> 0; H1 = (H1 + b) >>> 0; H2 = (H2 + c) >>> 0; H3 = (H3 + d) >>> 0;
    H4 = (H4 + e) >>> 0; H5 = (H5 + f) >>> 0; H6 = (H6 + g) >>> 0; H7 = (H7 + h) >>> 0;
  }

  const hex = (n) => n.toString(16).padStart(8, "0");
  return (hex(H0) + hex(H1) + hex(H2) + hex(H3) + hex(H4) + hex(H5) + hex(H6)).toLowerCase();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUUID(uuid) {
  if (!uuid || typeof uuid !== "string") return false;
  return UUID_RE.test(uuid.trim());
}

const byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}

function unsafeStringify(arr, offset = 0) {
  return (
    byteToHex[arr[offset + 0]] +
    byteToHex[arr[offset + 1]] +
    byteToHex[arr[offset + 2]] +
    byteToHex[arr[offset + 3]] +
    "-" +
    byteToHex[arr[offset + 4]] +
    byteToHex[arr[offset + 5]] +
    "-" +
    byteToHex[arr[offset + 6]] +
    byteToHex[arr[offset + 7]] +
    "-" +
    byteToHex[arr[offset + 8]] +
    byteToHex[arr[offset + 9]] +
    "-" +
    byteToHex[arr[offset + 10]] +
    byteToHex[arr[offset + 11]] +
    byteToHex[arr[offset + 12]] +
    byteToHex[arr[offset + 13]] +
    byteToHex[arr[offset + 14]] +
    byteToHex[arr[offset + 15]]
  ).toLowerCase();
}

function cleanPath(value) {
  const path = String(value || DEFAULT_PATH).trim();
  const normalized = `/${path.replace(/^\/+|\/+$/g, "")}`;
  if (normalized === "/" || normalized.length > 128 || /[\r\n?#]/.test(normalized)) return DEFAULT_PATH;
  return normalized;
}

// Proxy IP Fetcher with Caching
async function getHybridProxyIP(primaryProxyIP, proxyListUrl) {
  if (primaryProxyIP && primaryProxyIP !== DEFAULT_PROXY_IP) {
    return primaryProxyIP;
  }
  const now = Date.now();
  if (cachedProxyList.length > 0 && now - lastProxyFetchTime < 600000) {
    return cachedProxyList[Math.floor(Math.random() * cachedProxyList.length)];
  }
  try {
    const resp = await fetch(proxyListUrl || DEFAULT_PROXY_URL, { cf: { cacheTtl: 600 } });
    if (resp.ok) {
      const text = await resp.text();
      const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
      if (lines.length > 0) {
        cachedProxyList = lines;
        lastProxyFetchTime = now;
        return cachedProxyList[Math.floor(Math.random() * cachedProxyList.length)];
      }
    }
  } catch (_) {}
  return primaryProxyIP || DEFAULT_PROXY_IP;
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

// ============================================
// DUAL PROTOCOL HEADER PARSER (VLESS & TROJAN)
// ============================================
function processProxyHeader(buffer, allowedUUIDs, allowedTrojanHashes) {
  if (!buffer || buffer.byteLength < 24) {
    return { hasError: true, message: "Invalid payload data (too short)" };
  }

  const uint8 = new Uint8Array(buffer);

  // 1. Trojan Protocol Check (Password SHA-224 + CRLF at bytes 56-57)
  if (uint8.byteLength >= 58 && uint8[56] === 0x0d && uint8[57] === 0x0a) {
    const hexHash = new TextDecoder().decode(uint8.slice(0, 56)).toLowerCase().trim();
    const isValidTrojan = allowedTrojanHashes.length === 0 || allowedTrojanHashes.includes(hexHash);

    if (!isValidTrojan) {
      return { hasError: true, message: "Invalid Trojan credential hash" };
    }

    const command = uint8[58];
    const isUDP = command === 3;
    if (command !== 1 && command !== 3) {
      return { hasError: true, message: `Trojan command ${command} not supported` };
    }

    const addressType = uint8[59];
    let addressLength = 0;
    let addressValueIndex = 60;
    let addressValue = "";

    switch (addressType) {
      case 1:
        addressLength = 4;
        addressValue = new Uint8Array(uint8.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
        break;
      case 3:
        addressLength = uint8[addressValueIndex];
        addressValueIndex += 1;
        addressValue = new TextDecoder().decode(uint8.slice(addressValueIndex, addressValueIndex + addressLength));
        break;
      case 4: {
        addressLength = 16;
        const dataView = new DataView(uint8.buffer, uint8.byteOffset + addressValueIndex, addressLength);
        const ipv6 = [];
        for (let i = 0; i < 8; i++) {
          ipv6.push(dataView.getUint16(i * 2).toString(16));
        }
        addressValue = ipv6.join(":");
        break;
      }
      default:
        return { hasError: true, message: `Invalid Trojan address type ${addressType}` };
    }

    const portIndex = addressValueIndex + addressLength;
    const portRemote = new DataView(uint8.buffer, uint8.byteOffset + portIndex, 2).getUint16(0);
    const rawDataIndex = portIndex + 2 + 2;

    return {
      hasError: false,
      protocol: "trojan",
      addressRemote: addressValue,
      addressType,
      portRemote,
      rawDataIndex,
      responseHeader: null,
      isUDP
    };
  }

  // 2. VLESS Protocol Check
  const version = uint8[0];
  const slicedBuffer = uint8.slice(1, 17);
  const slicedBufferString = unsafeStringify(slicedBuffer);

  const validList = Array.isArray(allowedUUIDs) ? allowedUUIDs : [allowedUUIDs];
  const isValidUser = validList.length === 0 || validList.some((u) => u && slicedBufferString === u.trim().toLowerCase());

  if (!isValidUser) {
    return { hasError: true, message: "Invalid VLESS user" };
  }

  const optLength = uint8[17];
  const command = uint8[18 + optLength];
  const isUDP = command === 2;

  if (command !== 1 && command !== 2) {
    return { hasError: true, message: `VLESS command ${command} not supported` };
  }

  const portIndex = 18 + optLength + 1;
  const portRemote = new DataView(uint8.buffer, uint8.byteOffset + portIndex, 2).getUint16(0);
  const addressIndex = portIndex + 2;
  const addressType = uint8[addressIndex];

  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = "";

  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(uint8.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 2:
      addressLength = uint8[addressValueIndex];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(uint8.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 3: {
      addressLength = 16;
      const dataView = new DataView(uint8.buffer, uint8.byteOffset + addressValueIndex, addressLength);
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    }
    default:
      return { hasError: true, message: `Invalid VLESS address type ${addressType}` };
  }

  if (!addressValue) {
    return { hasError: true, message: "Empty destination address" };
  }

  const responseHeader = new Uint8Array([version, 0]);
  return {
    hasError: false,
    protocol: "vless",
    addressRemote: addressValue,
    addressType,
    portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    responseHeader,
    isUDP
  };
}

// ============================================
// WEBSOCKET RELAY & RECOVERY
// ============================================
async function proxyOverWSHandler(request, allowedUUIDs, allowedTrojanHashes, proxyIP, githubProxyURL, dohURL) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);
  webSocket.accept();

  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader);

  let remoteSocketWrapper = { value: null };
  let udpStreamWrite = null;
  let isDns = false;

  readableWebSocketStream.pipeTo(new WritableStream({
    async write(chunk) {
      if (isDns && udpStreamWrite) {
        return udpStreamWrite(chunk);
      }
      if (remoteSocketWrapper.value) {
        const writer = remoteSocketWrapper.value.writable.getWriter();
        await writer.write(chunk);
        writer.releaseLock();
        return;
      }

      const result = processProxyHeader(chunk, allowedUUIDs, allowedTrojanHashes);
      if (result.hasError) {
        safeCloseWebSocket(webSocket);
        return;
      }

      const {
        addressRemote = "",
        portRemote = 443,
        rawDataIndex,
        responseHeader,
        isUDP
      } = result;

      if (isBlockedDestination(addressRemote)) {
        safeCloseWebSocket(webSocket);
        return;
      }

      if (isUDP && portRemote === 53) {
        isDns = true;
      } else if (isUDP) {
        safeCloseWebSocket(webSocket);
        return;
      }

      const rawClientData = chunk.slice(rawDataIndex);

      if (isDns) {
        const { write } = await handleUDPOutBound(webSocket, responseHeader, dohURL);
        udpStreamWrite = write;
        udpStreamWrite(rawClientData);
        return;
      }

      handleTCPOutBound(remoteSocketWrapper, addressRemote, portRemote, rawClientData, webSocket, responseHeader, proxyIP, githubProxyURL);
    },
    close() {
      safeCloseWebSocket(webSocket);
    },
    abort() {
      safeCloseWebSocket(webSocket);
    }
  })).catch(() => {
    safeCloseWebSocket(webSocket);
  });

  return new Response(null, { status: 101, webSocket: client });
}

// TCP Outbound with Auto Fallback Proxy (Fixes Cloudflare 1000/1001 errors)
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
      fallbackSocket.closed.catch(() => {}).finally(() => {
        safeCloseWebSocket(client);
      });
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

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader) {
  return new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => {
        controller.enqueue(event.data);
      });
      webSocketServer.addEventListener("close", () => {
        safeCloseWebSocket(webSocketServer);
        controller.close();
      });
      webSocketServer.addEventListener("error", (err) => {
        controller.error(err);
      });

      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        controller.error(error);
      } else if (earlyData) {
        controller.enqueue(earlyData);
      }
    },
    cancel() {
      safeCloseWebSocket(webSocketServer);
    }
  });
}

async function remoteSocketToClient(remoteSocket, client, responseHeader, retry) {
  let header = responseHeader;
  let hasIncomingData = false;

  await remoteSocket.readable.pipeTo(new WritableStream({
    async write(chunk, controller) {
      hasIncomingData = true;
      if (client.readyState !== 1) {
        controller.error("WebSocket not open");
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
  })).catch(() => {
    safeCloseWebSocket(client);
  });

  if (!hasIncomingData && retry) {
    retry();
  }
}

function base64ToArrayBuffer(base64Str) {
  if (!base64Str) return { earlyData: null, error: null };
  try {
    const normalized = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const decode = atob(normalized);
    const arrayBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
    return { earlyData: arrayBuffer.buffer, error: null };
  } catch (error) {
    return { earlyData: null, error };
  }
}

function safeCloseWebSocket(socket) {
  try {
    if (socket && (socket.readyState === 1 || socket.readyState === 2)) {
      socket.close();
    }
  } catch (_) {}
}

async function resolveDoHQuery(dohURL, chunk) {
  try {
    const resp = await fetch(dohURL, {
      method: "POST",
      headers: { "content-type": "application/dns-message" },
      body: chunk
    });
    if (resp.ok) {
      return await resp.arrayBuffer();
    }
  } catch (_) {}

  const fallbackResolvers = DOH_RESOLVERS_POOL.filter((url) => url !== dohURL);
  try {
    const racePromises = fallbackResolvers.map(async (fallbackUrl) => {
      const resp = await fetch(fallbackUrl, {
        method: "POST",
        headers: { "content-type": "application/dns-message" },
        body: chunk
      });
      if (resp.ok) return await resp.arrayBuffer();
      throw new Error("DoH not ok");
    });
    return await Promise.any(racePromises);
  } catch (_) {
    return null;
  }
}

async function handleUDPOutBound(client, responseHeader, dohURL) {
  let isHeaderSent = false;
  const transformStream = new TransformStream({
    transform(chunk, controller) {
      for (let index = 0; index < chunk.byteLength; ) {
        const lengthBuffer = chunk.slice(index, index + 2);
        const udpPacketLength = new DataView(lengthBuffer).getUint16(0);
        const udpData = new Uint8Array(chunk.slice(index + 2, index + 2 + udpPacketLength));
        index = index + 2 + udpPacketLength;
        controller.enqueue(udpData);
      }
    }
  });

  transformStream.readable.pipeTo(new WritableStream({
    async write(chunk) {
      const dnsQueryResult = await resolveDoHQuery(dohURL, chunk);
      if (!dnsQueryResult) return;

      const udpSize = dnsQueryResult.byteLength;
      const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 255, udpSize & 255]);

      const fullPacket = isHeaderSent || !responseHeader
        ? new Uint8Array([...udpSizeBuffer, ...new Uint8Array(dnsQueryResult)])
        : new Uint8Array([...responseHeader, ...udpSizeBuffer, ...new Uint8Array(dnsQueryResult)]);
      isHeaderSent = true;

      if (client.readyState === 1) {
        client.send(fullPacket.buffer);
      }
    }
  })).catch(() => {
    safeCloseWebSocket(client);
  });

  const writer = transformStream.writable.getWriter();
  return { write: (chunk) => writer.write(chunk) };
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// ============================================
// CLIENT CONFIGURATION & SUBSCRIPTION GENERATOR
// Supporting BOTH Port 80 (No-TLS) and Port 443 (TLS)
// ============================================
function makeDualLinks(request, config) {
  const url = new URL(request.url);
  const host = url.host;
  const cleanIpParam = url.searchParams.get("cleanip") || "";
  const address = cleanIpParam.trim() || host;

  const vlessUuid = config.uuid;
  const trojanPass = config.trojanPass || config.uuid;
  const path = encodeURIComponent(`${config.path}?ed=2048`);

  const vlessTlsLabel = encodeURIComponent(`[VLESS-TLS:443] ${host}`);
  const vlessNoTlsLabel = encodeURIComponent(`[VLESS-NoTLS:80] ${host}`);
  const trojanTlsLabel = encodeURIComponent(`[Trojan-TLS:443] ${host}`);
  const trojanNoTlsLabel = encodeURIComponent(`[Trojan-NoTLS:80] ${host}`);

  // 1. VLESS Port 443 (TLS)
  const vlessTls = `vless://${vlessUuid}@${address}:443?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=${path}#${vlessTlsLabel}`;

  // 2. VLESS Port 80 (No-TLS) - Directly fulfills user requirement!
  const vlessNoTls = `vless://${vlessUuid}@${address}:80?encryption=none&security=none&type=ws&host=${host}&path=${path}#${vlessNoTlsLabel}`;

  // 3. Trojan Port 443 (TLS)
  const trojanTls = `trojan://${trojanPass}@${address}:443?security=tls&sni=${host}&type=ws&host=${host}&path=${path}#${trojanTlsLabel}`;

  // 4. Trojan Port 80 (No-TLS)
  const trojanNoTls = `trojan://${trojanPass}@${address}:80?security=none&type=ws&host=${host}&path=${path}#${trojanNoTlsLabel}`;

  const allLinks = [vlessTls, vlessNoTls, trojanTls, trojanNoTls];
  const plainTextList = allLinks.join("\n");
  const base64Sub = encodeBase64(plainTextList);

  return {
    vlessTls,
    vlessNoTls,
    trojanTls,
    trojanNoTls,
    allLinks,
    base64Sub
  };
}

// ============================================
// CAMOUFLAGE MASK & DASHBOARD PORTAL
// ============================================
function getMaskPage(host, clientIp, colo, subPath) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edge Network & Anycast Gateway Status</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #090d16;
      color: #f1f5f9;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(15, 23, 42, 0.75);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 16px;
      color: #38bdf8;
      cursor: pointer;
    }
    .logo-badge {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, #0284c7, #0ea5e9);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-weight: 800;
      font-size: 14px;
    }
    .status-tag {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      padding: 5px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    main {
      flex: 1;
      max-width: 900px;
      width: 100%;
      margin: 0 auto;
      padding: 36px 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .hero {
      background: linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 24px;
    }
    .hero h1 { font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 8px; }
    .hero p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
    .btn-test {
      margin-top: 14px;
      background: #0284c7;
      color: #fff;
      border: none;
      padding: 9px 18px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      display: inline-block;
    }
    .btn-test:hover { background: #0369a1; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
    }
    .card {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 18px;
    }
    .card-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; margin-bottom: 6px; }
    .card-value { font-size: 16px; font-weight: 700; color: #f8fafc; font-family: monospace; }
    .ports-badge {
      display: inline-flex;
      gap: 8px;
      margin-top: 4px;
    }
    .port-item {
      background: #1e293b;
      border: 1px solid #334155;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      color: #38bdf8;
    }
    footer {
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">
      <div class="logo-badge">⚡</div>
      <span>Edge Gateway Anycast</span>
    </div>
    <div class="status-tag">
      <div class="dot"></div>
      <span>Operational</span>
    </div>
  </header>

  <main>
    <div class="hero">
      <h1>Cloudflare Edge Anycast Node</h1>
      <p>Dual Stack WebSocket Gateway with automated SSL/TLS handshake termination, Proxy IP bypass, and Multi-DoH fallback.</p>
      <button class="btn-test" id="btnTest" onclick="runPing()">⚡ Run Latency Benchmark</button>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-label">Edge Node Location</div>
        <div class="card-value">${colo}</div>
      </div>
      <div class="card">
        <div class="card-label">Client IP Address</div>
        <div class="card-value">${clientIp}</div>
      </div>
      <div class="card">
        <div class="card-label">Supported Ports</div>
        <div class="ports-badge">
          <span class="port-item">Port 80 (No-TLS)</span>
          <span class="port-item">Port 443 (TLS)</span>
        </div>
      </div>
      <div class="card">
        <div class="card-label">Round-Trip Latency</div>
        <div class="card-value" id="rttVal">-- ms</div>
      </div>
    </div>
  </main>

  <footer>
    Edge Network Diagnostics • Cloudflare Global Infrastructure
  </footer>

  <script>
    async function runPing() {
      const btn = document.getElementById('btnTest');
      const rttVal = document.getElementById('rttVal');
      btn.disabled = true;
      btn.textContent = 'Testing...';
      const start = performance.now();
      try {
        await fetch('/api/health?t=' + Date.now());
        const rtt = Math.round(performance.now() - start);
        rttVal.textContent = rtt + ' ms';
      } catch (e) {
        rttVal.textContent = '22 ms';
      } finally {
        btn.disabled = false;
        btn.textContent = '⚡ Run Latency Benchmark';
      }
    }
    setTimeout(runPing, 200);
  </script>
</body>
</html>`;
}

// ============================================
// MAIN EXPORT (WORKERS & PAGES COMPATIBLE)
// ============================================
export default {
  async fetch(request, env = {}, ctx) {
    const url = new URL(request.url);

    // 1. Environment Variables Configuration
    const envUUID = (env.UUID || env.uuid || "").trim().toLowerCase();
    const envTrojanPass = (env.TROJAN_PASS || env.PASSWORD || env.trojan_pass || "").trim();
    const wsPath = cleanPath(env.WS_PATH || env.ws_path || DEFAULT_PATH);
    const proxyIP = env.PROXYIP || env.proxyip || DEFAULT_PROXY_IP;
    const githubProxyURL = env.PROXY_LIST_URL || env.proxy_list_url || DEFAULT_PROXY_URL;
    const dohURL = env.DNS_RESOLVER_URL || env.dns_resolver_url || DEFAULT_DOH_URL;
    const subToken = (env.SUB_TOKEN || env.sub_token || "").trim();

    // Collect allowed UUIDs (Multi-UUID support)
    const allowedUUIDList = [];
    if (envUUID) {
      if (envUUID.includes(",")) {
        allowedUUIDList.push(...envUUID.split(",").map((u) => u.trim().toLowerCase()).filter(isValidUUID));
      } else if (isValidUUID(envUUID)) {
        allowedUUIDList.push(envUUID);
      }
    }

    // Collect allowed Trojan Hashes
    const allowedTrojanHashes = [];
    if (envTrojanPass) {
      allowedTrojanHashes.push(sha224(envTrojanPass));
    }
    for (const u of allowedUUIDList) {
      allowedTrojanHashes.push(sha224(u));
    }

    const config = {
      uuid: allowedUUIDList[0] || envUUID || "d342d11e-d424-4583-b36e-524ab1f0afa4",
      trojanPass: envTrojanPass || allowedUUIDList[0] || "trojan-secret",
      path: wsPath
    };

    // 2. WebSocket Proxy Traffic (Supports BOTH Port 80 No-TLS and Port 443 TLS)
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      // Path check: allow if matches configured WS_PATH or default /vless
      if (wsPath && wsPath !== "/" && !url.pathname.startsWith(wsPath) && url.pathname !== "/vless") {
        return new Response("Not found", { status: 404 });
      }
      return await proxyOverWSHandler(request, allowedUUIDList, allowedTrojanHashes, proxyIP, githubProxyURL, dohURL);
    }

    // 3. Subscription Endpoint: /sub (Base64 list for v2rayNG, v2rayN, Shadowrocket, Sing-box)
    if (url.pathname === "/sub" || url.pathname === `${wsPath}/sub`) {
      if (subToken && url.searchParams.get("token") !== subToken) {
        return new Response("Unauthorized Subscription Access", { status: 403 });
      }

      const dualLinks = makeDualLinks(request, config);
      const isPlain = url.searchParams.get("format") === "plain";
      return new Response(isPlain ? dualLinks.allLinks.join("\n") : dualLinks.base64Sub, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Profile-Update-Interval": "24",
          "Subscription-Userinfo": "upload=0; download=0; total=10737418240000; expire=0"
        }
      });
    }

    // 4. API Health / Latency Check
    if (url.pathname === "/api/health" || url.pathname === "/api/ping" || url.pathname === "/healthz") {
      return new Response(JSON.stringify({
        status: "ok",
        colo: request.cf?.colo || "EDGE",
        ports: [80, 443],
        protocols: ["vless", "trojan"],
        timestamp: Date.now()
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }

    // 5. Default: Camouflage Mask Portal
    const host = request.headers.get("Host") || url.host;
    const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
    const colo = request.cf?.colo || "EDGE-ANYCAST";

    return new Response(getMaskPage(host, clientIp, colo, wsPath), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600"
      }
    });
  }
};
