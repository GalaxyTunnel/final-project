import { connect } from "cloudflare:sockets";

// ============================================
// DEFAULT FALLBACK CONFIGURATION
// (UUID is configured via Cloudflare Dashboard / Environment Variables)
// ============================================
const DEFAULT_UUID = "";
const DEFAULT_PROXY_IP = "www.visa.com.sg";
const DEFAULT_PROXY_URL = "https://galaxytunnel.github.io/PROXYIP.txt";
const DEFAULT_DOH_URL = "https://cloudflare-dns.com/dns-query";
const DEFAULT_WS_PATH = "galaxy-tunnel";

let userID = "";
let proxyIP = DEFAULT_PROXY_IP;
let githubProxyURL = DEFAULT_PROXY_URL;
let dohURL = DEFAULT_DOH_URL;
let wsPath = DEFAULT_WS_PATH;

function isValidUUID(uuid) {
    if (!uuid) return false;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid.trim());
}

// ============================================
// Hybrid Proxy IP Pool (Local Fast Safe List)
// ============================================
const DEFAULT_LOCAL_PROXIES = [
    "cdn-b100.xn--b6gac.eu.org",
    "cdn.xn--b6gac.eu.org",
    "bpb.yousef.isegaro.com",
    "icook.hk",
    "icook.tw",
    "www.visa.com.sg"
];

let activeProxyPool = [...DEFAULT_LOCAL_PROXIES];

async function getHybridProxyIP(defaultProxy, rawUrl) {
    if (!rawUrl || rawUrl.includes("YOUR_USERNAME")) {
        return activeProxyPool[Math.floor(Math.random() * activeProxyPool.length)] || defaultProxy;
    }
    try {
        const response = await fetch(rawUrl, {
            cf: { cacheTtl: 300, cacheEverything: true }
        });
        if (response.ok) {
            const text = await response.text();
            const fetchedIPs = text.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith('#'));
            
            if (fetchedIPs.length > 0) {
                activeProxyPool = Array.from(new Set([...fetchedIPs, ...DEFAULT_LOCAL_PROXIES]));
                if (defaultProxy && !activeProxyPool.includes(defaultProxy)) {
                    activeProxyPool.unshift(defaultProxy);
                }
            }
        }
    } catch (err) {
        console.warn("GitHub ProxyIP Fetch Error, falling back to local pool:", err);
    }
    return activeProxyPool[Math.floor(Math.random() * activeProxyPool.length)] || defaultProxy;
}

// ============================================
// Ads & Tracker Block List
// ============================================
const AD_DOMAIN_SUFFIXES = [
    "doubleclick.net",
    "googleadservices.com",
    "googlesyndication.com",
    "adservice.google.com",
    "pagead2.googlesyndication.com",
    "adcolony.com",
    "appsflyer.com",
    "unityads.unity3d.com",
    "vungle.com",
    "applovin.com",
    "flurry.com",
    "adjust.com",
    "branch.io",
    "admob.com",
    "mopub.com",
    "criteo.com",
    "taboola.com",
    "outbrain.com",
    "scorecardresearch.com",
    "quantserve.com",
    "popads.net",
    "inmobi.com",
    "adroll.com",
    "amazon-adsystem.com",
    "adsafeprotected.com",
    "moatads.com",
    "openx.net",
    "rubiconproject.com",
    "pubmatic.com"
];

function isAdDomain(domain) {
    if (!domain) return false;
    const lower = domain.toLowerCase().trim();
    if (AD_DOMAIN_SUFFIXES.some(suffix => lower === suffix || lower.endsWith("." + suffix))) {
        return true;
    }
    if (/^(ad|ads|adservice|adserver|telemetry|track|tracker|analytics)\./i.test(lower)) {
        return true;
    }
    return false;
}

// ============================================
// Direct Local Bypass & Intranet Logic
// ============================================
const DIRECT_BYPASS_DOMAINS = [
    "localhost",
    "local",
    "internal",
    "lan",
    "home.arpa"
];

function isPrivateOrLocalAddress(address) {
    if (!address) return false;
    const lower = address.toLowerCase().trim();
    
    if (DIRECT_BYPASS_DOMAINS.some(d => lower === d || lower.endsWith("." + d))) {
        return true;
    }

    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;
    const match172 = lower.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
    if (match172) {
        const secondOctet = parseInt(match172[1], 10);
        if (secondOctet >= 16 && secondOctet <= 31) return true;
    }
    if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;

    if (lower === "::1" || lower.startsWith("fc00:") || lower.startsWith("fe80:") || lower.startsWith("fd")) {
        return true;
    }

    return false;
}

// ============================================
// URL Parsing Helper for Dynamic Configs
// ============================================
function extractDynamicConfig(url) {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname.split("/").filter(Boolean);

    let extractedUUID = null;
    let extractedPath = null;
    let isSubRequest = false;

    // Check query params
    const qUUID = parsed.searchParams.get("uuid") || parsed.searchParams.get("id");
    const qProxyIP = parsed.searchParams.get("proxyip") || parsed.searchParams.get("ip");
    const qWSPath = parsed.searchParams.get("path") || parsed.searchParams.get("wspath");

    if (qUUID && isValidUUID(qUUID)) {
        extractedUUID = qUUID.trim().toLowerCase();
    }

    if (pathSegments[0] === "sub") {
        isSubRequest = true;
        if (pathSegments[1] && isValidUUID(pathSegments[1])) {
            extractedUUID = pathSegments[1].toLowerCase();
        }
    } else if (isValidUUID(pathSegments[0])) {
        extractedUUID = pathSegments[0].toLowerCase();
        if (pathSegments[1] === "sub") {
            isSubRequest = true;
        } else if (pathSegments[1]) {
            extractedPath = pathSegments.slice(1).join("/");
        }
    }

    return {
        uuid: extractedUUID,
        proxyIP: qProxyIP ? qProxyIP.trim() : null,
        wsPath: qWSPath ? qWSPath.trim().replace(/^\/+/, "") : (extractedPath || null),
        isSubRequest
    };
}

// ============================================
// Subscription / Config Generator
// ============================================
function generateVlessConfigs(host, activeUUID, activeWSPath, activeProxy) {
    const cleanPath = (activeWSPath || DEFAULT_WS_PATH).replace(/^\/+/, "");
    const titleHost = host.replace(/[^a-zA-Z0-9.-]/g, "");

    // VLESS + TLS + WS (Port 443)
    const vlessTls = `vless://${activeUUID}@${host}:443?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=%2F${encodeURIComponent(cleanPath)}%3Fed%3D2048#Galaxy-VLESS-TLS%20(${titleHost})`;

    // VLESS + Direct WS (Port 80 - Non-TLS)
    const vlessHttp = `vless://${activeUUID}@${host}:80?encryption=none&security=none&type=ws&host=${host}&path=%2F${encodeURIComponent(cleanPath)}%3Fed%3D2048#Galaxy-VLESS-HTTP%20(${titleHost})`;

    // VLESS + gRPC (Port 443)
    const vlessGrpc = `vless://${activeUUID}@${host}:443?encryption=none&security=tls&sni=${host}&type=grpc&serviceName=${encodeURIComponent(cleanPath)}#Galaxy-VLESS-gRPC%20(${titleHost})`;

    // VLESS with Proxy IP if provided
    let vlessProxy = "";
    if (activeProxy) {
        vlessProxy = `vless://${activeUUID}@${activeProxy}:443?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=%2F${encodeURIComponent(cleanPath)}%3Fed%3D2048#Galaxy-VLESS-ProxyIP%20(${activeProxy})`;
    }

    const configs = [vlessTls, vlessGrpc, vlessHttp];
    if (vlessProxy) configs.push(vlessProxy);

    return {
        plainList: configs.join("\n"),
        base64: btoa(unescape(encodeURIComponent(configs.join("\n")))),
        links: {
            tls: vlessTls,
            grpc: vlessGrpc,
            http: vlessHttp,
            proxy: vlessProxy
        }
    };
}

// ============================================
// Worker Main Fetch Handler
// ============================================
// Worker Main Fetch Handler with Camouflage Mask & Auth Gate
// ============================================
var worker_default = {
    async fetch(request, env = {}, ctx) {
        const url = new URL(request.url);
        const host = request.headers.get("Host") || url.host;

        // 1. Resolve Environment Variables from Cloudflare Dashboard
        const envUUID = env.UUID || env.uuid;
        const envPassword = (env.PASSWORD || env.password || "").trim();
        const maskPageEnabled = (env.MASK_PAGE !== "false" && env.MASK_PAGE !== false);

        userID = envUUID && isValidUUID(envUUID) ? envUUID.trim().toLowerCase() : "";
        proxyIP = env.PROXYIP || env.proxyip || env.PROXY_IP || DEFAULT_PROXY_IP;
        githubProxyURL = env.PROXY_LIST_URL || DEFAULT_PROXY_URL;
        dohURL = env.DNS_RESOLVER_URL || DEFAULT_DOH_URL;
        wsPath = (env.WS_PATH || DEFAULT_WS_PATH).replace(/^\/+/, "");

        // 2. Dynamic Runtime Config extraction from Request (No Redeploy Needed!)
        const dynConfig = extractDynamicConfig(request.url);
        const runtimeUUID = dynConfig.uuid || userID;
        const runtimeWSPath = dynConfig.wsPath || wsPath;
        const runtimeProxyIP = dynConfig.proxyIP || proxyIP;

        // Build list of valid UUIDs for this session (Dashboard UUID, Dynamic URL UUID, etc.)
        const allowedUUIDList = Array.from(
            new Set([
                ...(userID && isValidUUID(userID) ? [userID] : []),
                ...(dynConfig.uuid && isValidUUID(dynConfig.uuid) ? [dynConfig.uuid] : []),
                ...(envUUID && envUUID.includes(",") ? envUUID.split(",").map(u => u.trim().toLowerCase()).filter(isValidUUID) : [])
            ])
        ).filter(Boolean);

        // 3. WebSocket proxy request (Never block WebSocket connections!)
        const upgradeHeader = request.headers.get("Upgrade");
        if (upgradeHeader === "websocket") {
            return await proxyOverWSHandler(request, allowedUUIDList);
        }

        // 4. gRPC HTTP/2 Stream proxy request (Never block gRPC proxy traffic!)
        const contentType = request.headers.get("Content-Type") || request.headers.get("content-type") || "";
        if (contentType.includes("application/grpc")) {
            return await proxyOverGRPCHandler(request, allowedUUIDList);
        }

        // 5. Auth Verification for Dashboard
        const cookieHeader = request.headers.get("Cookie") || "";
        const hasAuthCookie = cookieHeader.includes("galaxy_auth=1") || (envPassword && cookieHeader.includes(`galaxy_pwd=${encodeURIComponent(envPassword)}`));
        const qPwd = url.searchParams.get("pwd") || url.searchParams.get("password") || url.searchParams.get("key");
        const isAuthorizedByPwd = (envPassword && qPwd === envPassword) || (userID && qPwd === userID);
        const isAuthorizedByUuid = (dynConfig.uuid && isValidUUID(dynConfig.uuid));
        const pathSegments = url.pathname.split("/").filter(Boolean);
        const isDirectUuidPath = (pathSegments[0] && isValidUUID(pathSegments[0]));

        // Login API endpoint
        if (url.pathname === "/api/login" && request.method === "POST") {
            try {
                const body = await request.json().catch(() => ({}));
                const submittedKey = (body.key || body.password || body.uuid || "").trim();
                const isValidKey = (envPassword && submittedKey === envPassword) || 
                                   (userID && submittedKey.toLowerCase() === userID.toLowerCase()) || 
                                   isValidUUID(submittedKey);

                if (isValidKey) {
                    return new Response(JSON.stringify({ success: true, redirect: isValidUUID(submittedKey) ? `/${submittedKey}` : `/?pwd=${encodeURIComponent(submittedKey)}` }), {
                        status: 200,
                        headers: {
                            "Content-Type": "application/json",
                            "Set-Cookie": "galaxy_auth=1; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly"
                        }
                    });
                }
                return new Response(JSON.stringify({ success: false, message: "Invalid UUID or Password" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" }
                });
            } catch (e) {
                return new Response(JSON.stringify({ success: false, message: "Login error" }), { status: 400 });
            }
        }

        // Logout API endpoint -> returns to Camouflage Mask site
        if (url.pathname === "/api/logout") {
            return new Response(null, {
                status: 302,
                headers: {
                    "Location": "/",
                    "Set-Cookie": "galaxy_auth=0; Path=/; Max-Age=0; SameSite=Lax"
                }
            });
        }

        // 6. Subscription Link Endpoint (/sub or /<UUID>/sub or ?sub=1)
        if (dynConfig.isSubRequest || url.pathname === "/sub" || url.searchParams.has("sub")) {
            const subData = generateVlessConfigs(host, runtimeUUID, runtimeWSPath, runtimeProxyIP);
            
            // If User-Agent is a browser requesting HTML
            const acceptHeader = request.headers.get("Accept") || "";
            if (acceptHeader.includes("text/html") && !url.searchParams.has("raw")) {
                if (isDirectUuidPath || isAuthorizedByUuid || isAuthorizedByPwd || hasAuthCookie || !maskPageEnabled) {
                    return new Response(getGalaxyPage(host, runtimeUUID, runtimeWSPath, runtimeProxyIP, subData), {
                        status: 200,
                        headers: { "Content-Type": "text/html; charset=utf-8" }
                    });
                }
            }

            // Raw Base64 for V2Ray / Shadowrocket / Sing-Box subscriptions
            return new Response(subData.base64, {
                status: 200,
                headers: {
                    "Content-Type": "text/plain; charset=utf-8",
                    "Subscription-Userinfo": "upload=0; download=0; total=1073741824000; expire=0",
                    "Profile-Update-Interval": "24",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

        // 7. API Health & Edge Status Endpoint (Innocent disguise info for testers)
        if (url.pathname === "/api/health" || url.pathname === "/api/ping") {
            return new Response(JSON.stringify({
                status: "healthy",
                edge: "Cloudflare Anycast",
                colo: request.cf?.colo || "EDGE",
                country: request.cf?.country || "US",
                clientIp: request.headers.get("CF-Connecting-IP") || "127.0.0.1",
                timestamp: Date.now()
            }), {
                status: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        // 8. Decide whether to render Camouflage Mask Page or Galaxy Dashboard
        const isAuthorizedToViewDashboard = !maskPageEnabled || isDirectUuidPath || isAuthorizedByUuid || isAuthorizedByPwd || hasAuthCookie;

        if (isAuthorizedToViewDashboard) {
            const subData = generateVlessConfigs(host, runtimeUUID, runtimeWSPath, runtimeProxyIP);
            return new Response(getGalaxyPage(host, runtimeUUID, runtimeWSPath, runtimeProxyIP, subData), {
                status: 200,
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    ...(qPwd || isAuthorizedByUuid ? { "Set-Cookie": "galaxy_auth=1; Path=/; Max-Age=86400; SameSite=Lax" } : {})
                }
            });
        }

        // 9. Default Public Visitors / ISPs / Host Checkers -> Render Camouflage Mask Website
        const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
        const colo = request.cf?.colo || "EDGE-GLOBAL";
        return new Response(getMaskPage(host, Boolean(envPassword || userID), clientIp, colo), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" }
        });
    }
};

// ============================================
// gRPC HTTP/2 Stream Proxy Handler
// ============================================
function makeGrpcFrame(data) {
    const rawBytes = data instanceof Uint8Array 
        ? data 
        : (data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data));
    const len = rawBytes.byteLength;
    const frame = new Uint8Array(5 + len);
    frame[0] = 0; // Uncompressed flag
    frame[1] = (len >> 24) & 255;
    frame[2] = (len >> 16) & 255;
    frame[3] = (len >> 8) & 255;
    frame[4] = len & 255;
    frame.set(rawBytes, 5);
    return frame;
}

async function proxyOverGRPCHandler(request, allowedUUIDs) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    let address = "";
    let portWithRandomLog = "";

    const log = (info, event) => {
        console.log(`[gRPC][${address}:${portWithRandomLog}] ${info}`, event || "");
    };

    let remoteSocketWrapper = { value: null };
    let udpStreamWrite = null;
    let isDns = false;
    let accumulatedBuffer = new Uint8Array(0);

    const grpcClient = {
        isGrpc: true,
        send: async (data) => {
            try {
                const framed = makeGrpcFrame(data);
                await writer.write(framed);
            } catch (err) {
                log("gRPC send error", err);
            }
        },
        close: async () => {
            try {
                await writer.close();
            } catch (err) {}
        }
    };

    (async () => {
        const reader = request.body.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    log("gRPC body stream finished");
                    break;
                }
                if (!value || value.byteLength === 0) continue;

                if (isDns && udpStreamWrite) {
                    await udpStreamWrite(value);
                    continue;
                }

                if (remoteSocketWrapper.value) {
                    const tcpWriter = remoteSocketWrapper.value.writable.getWriter();
                    await tcpWriter.write(value);
                    tcpWriter.releaseLock();
                    continue;
                }

                const combined = new Uint8Array(accumulatedBuffer.length + value.length);
                combined.set(accumulatedBuffer, 0);
                combined.set(value, accumulatedBuffer.length);
                accumulatedBuffer = combined;

                let payload = null;
                if (accumulatedBuffer.length >= 5 && accumulatedBuffer[0] === 0) {
                    const msgLen = (accumulatedBuffer[1] << 24) | (accumulatedBuffer[2] << 16) | (accumulatedBuffer[3] << 8) | accumulatedBuffer[4];
                    if (accumulatedBuffer.length >= 5 + msgLen) {
                        payload = accumulatedBuffer.slice(5, 5 + msgLen);
                        accumulatedBuffer = accumulatedBuffer.slice(5 + msgLen);
                    }
                } else if (accumulatedBuffer.length >= 24) {
                    payload = accumulatedBuffer;
                    accumulatedBuffer = new Uint8Array(0);
                }

                if (!payload || payload.length < 24) {
                    continue;
                }

                const result = processVlessHeader(payload.buffer ? payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) : payload, allowedUUIDs);
                if (result.hasError) {
                    throw new Error(result.message);
                }

                const {
                    addressRemote = "",
                    portRemote = 443,
                    rawDataIndex,
                    responseHeader,
                    isUDP
                } = result;

                address = addressRemote;
                portWithRandomLog = `${portRemote} ${isUDP ? "udp" : "tcp"}`;

                if (isUDP && portRemote !== 53) {
                    throw new Error("UDP proxy only enabled for DNS (port 53)");
                }
                if (isUDP && portRemote === 53) {
                    isDns = true;
                }

                const rawClientData = payload.slice(rawDataIndex);

                if (isDns) {
                    const { write } = await handleUDPOutBound(grpcClient, responseHeader, log);
                    udpStreamWrite = write;
                    if (rawClientData.length > 0) {
                        await udpStreamWrite(rawClientData);
                    }
                    continue;
                }

                handleTCPOutBound(remoteSocketWrapper, addressRemote, portRemote, rawClientData, grpcClient, responseHeader, log);
            }
        } catch (err) {
            log("gRPC processing error", err);
        } finally {
            safeCloseClient(grpcClient);
        }
    })();

    return new Response(readable, {
        status: 200,
        headers: {
            "Content-Type": "application/grpc",
            "Trailer": "grpc-status, grpc-message"
        }
    });
}

// ============================================
// WebSocket Proxy Handler
// ============================================
async function proxyOverWSHandler(request, allowedUUIDs) {
    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);
    webSocket.accept();

    let address = "";
    let portWithRandomLog = "";

    const log = (info, event) => {
        console.log(`[WS][${address}:${portWithRandomLog}] ${info}`, event || "");
    };

    const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
    const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

    let remoteSocketWrapper = { value: null };
    let udpStreamWrite = null;
    let isDns = false;

    readableWebSocketStream.pipeTo(new WritableStream({
        async write(chunk, controller) {
            if (isDns && udpStreamWrite) {
                return udpStreamWrite(chunk);
            }
            if (remoteSocketWrapper.value) {
                const writer = remoteSocketWrapper.value.writable.getWriter();
                await writer.write(chunk);
                writer.releaseLock();
                return;
            }

            let result = processVlessHeader(chunk, allowedUUIDs);

            if (result.hasError) {
                throw new Error(result.message);
            }

            const {
                addressRemote = "",
                portRemote = 443,
                rawDataIndex,
                responseHeader,
                isUDP
            } = result;

            address = addressRemote;
            portWithRandomLog = `${portRemote} ${isUDP ? "udp" : "tcp"}`;

            if (isUDP && portRemote !== 53) {
                throw new Error("UDP proxy only enabled for DNS (port 53)");
            }
            if (isUDP && portRemote === 53) {
                isDns = true;
            }

            const rawClientData = chunk.slice(rawDataIndex);

            if (isDns) {
                const { write } = await handleUDPOutBound(webSocket, responseHeader, log);
                udpStreamWrite = write;
                udpStreamWrite(rawClientData);
                return;
            }

            handleTCPOutBound(remoteSocketWrapper, addressRemote, portRemote, rawClientData, webSocket, responseHeader, log);
        },
        close() {
            log("WebSocket stream closed");
        },
        abort(reason) {
            log("WebSocket stream aborted", JSON.stringify(reason));
        }
    })).catch((err) => {
        log("WebSocket pipeTo error", err);
    });

    return new Response(null, { status: 101, webSocket: client });
}

// ============================================
// TCP Outbound with AdBlock & Direct Bypass
// ============================================
async function handleTCPOutBound(remoteSocket, addressRemote, portRemote, rawClientData, client, responseHeader, log) {
    if (isAdDomain(addressRemote)) {
        log(`[AdBlock] Blocked outbound connection to ad domain: ${addressRemote}`);
        safeCloseClient(client);
        return;
    }

    const isDirect = isPrivateOrLocalAddress(addressRemote);
    if (isDirect) {
        log(`[DirectBypass] Local/private route detected for ${addressRemote}:${portRemote}.`);
    }

    async function connectAndWrite(address, port) {
        const tcpSocket2 = connect({ hostname: address, port });
        remoteSocket.value = tcpSocket2;
        log(`Connected to ${address}:${port}`);
        const writer = tcpSocket2.writable.getWriter();
        await writer.write(rawClientData);
        writer.releaseLock();
        return tcpSocket2;
    }

    async function retry() {
        if (isDirect) {
            log(`[DirectBypass] Target connection failed, direct route will not fallback to external proxy.`);
            safeCloseClient(client);
            return;
        }

        const activeProxy = await getHybridProxyIP(proxyIP, githubProxyURL);
        const target = activeProxy || addressRemote;
        log(`Retrying connection via Hybrid ProxyIP: ${target}`);
        
        try {
            const tcpSocket2 = await connectAndWrite(target, portRemote);
            tcpSocket2.closed.catch((error) => {
                console.log("Retry tcpSocket closed error", error);
            }).finally(() => {
                safeCloseClient(client);
            });
            remoteSocketToClient(tcpSocket2, client, responseHeader, null, log);
        } catch (err) {
            log("Retry connect error", err);
            safeCloseClient(client);
        }
    }

    try {
        const tcpSocket = await connectAndWrite(addressRemote, portRemote);
        remoteSocketToClient(tcpSocket, client, responseHeader, isDirect ? null : retry, log);
    } catch (err) {
        log("Initial TCP connect error", err);
        if (!isDirect) {
            await retry();
        } else {
            safeCloseClient(client);
        }
    }
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
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
                log("WebSocket error");
                controller.error(err);
            });

            const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
            if (error) {
                controller.error(error);
            } else if (earlyData) {
                controller.enqueue(earlyData);
            }
        },
        cancel(reason) {
            log(`ReadableStream canceled: ${reason}`);
            safeCloseWebSocket(webSocketServer);
        }
    });
}

function processVlessHeader(vlessBuffer, allowedUUIDs) {
    if (vlessBuffer.byteLength < 24) {
        return { hasError: true, message: "Invalid VLESS data (too short)" };
    }

    const version = new Uint8Array(vlessBuffer.slice(0, 1));
    const slicedBuffer = new Uint8Array(vlessBuffer.slice(1, 17));
    const slicedBufferString = unsafeStringify(slicedBuffer);

    const validList = Array.isArray(allowedUUIDs) ? allowedUUIDs : [allowedUUIDs];
    const isValidUser = validList.some((userUuid) => userUuid && slicedBufferString === userUuid.trim().toLowerCase());

    if (!isValidUser) {
        return { hasError: true, message: `Invalid VLESS user (${slicedBufferString})` };
    }

    const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
    const command = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0];

    let isUDP = false;
    if (command === 1) {
        isUDP = false;
    } else if (command === 2) {
        isUDP = true;
    } else {
        return { hasError: true, message: `VLESS command ${command} not supported` };
    }

    const portIndex = 18 + optLength + 1;
    const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
    const portRemote = new DataView(portBuffer).getUint16(0);

    let addressIndex = portIndex + 2;
    const addressType = new Uint8Array(vlessBuffer.slice(addressIndex, addressIndex + 1))[0];

    let addressLength = 0;
    let addressValueIndex = addressIndex + 1;
    let addressValue = "";

    switch (addressType) {
        case 1:
            addressLength = 4;
            addressValue = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
            break;
        case 2:
            addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
            addressValueIndex += 1;
            addressValue = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            break;
        case 3:
            addressLength = 16;
            const dataView = new DataView(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            const ipv6 = [];
            for (let i = 0; i < 8; i++) {
                ipv6.push(dataView.getUint16(i * 2).toString(16));
            }
            addressValue = ipv6.join(":");
            break;
        default:
            return { hasError: true, message: `Invalid VLESS address type ${addressType}` };
    }

    if (!addressValue) {
        return { hasError: true, message: "VLESS address value is empty" };
    }

    const responseHeader = new Uint8Array([version[0], 0]);
    return {
        hasError: false,
        addressRemote: addressValue,
        addressType,
        portRemote,
        rawDataIndex: addressValueIndex + addressLength,
        responseHeader,
        isUDP
    };
}

async function remoteSocketToClient(remoteSocket, client, responseHeader, retry, log) {
    let header = responseHeader;
    let hasIncomingData = false;

    await remoteSocket.readable.pipeTo(new WritableStream({
        async write(chunk, controller) {
            hasIncomingData = true;
            if (client.isGrpc) {
                if (header) {
                    const combined = new Uint8Array(header.length + chunk.byteLength);
                    combined.set(header, 0);
                    combined.set(new Uint8Array(chunk.buffer || chunk, chunk.byteOffset || 0, chunk.byteLength), header.length);
                    await client.send(combined);
                    header = null;
                } else {
                    await client.send(chunk);
                }
            } else {
                if (client.readyState !== 1) {
                    controller.error("WebSocket not open");
                }
                if (header) {
                    client.send(await new Blob([header, chunk]).arrayBuffer());
                    header = null;
                } else {
                    client.send(chunk);
                }
            }
        },
        close() {
            log(`Remote connection closed (had data: ${hasIncomingData})`);
        },
        abort(reason) {
            console.error("Remote readable abort", reason);
        }
    })).catch((error) => {
        console.error("remoteSocketToClient error", error.stack || error);
        safeCloseClient(client);
    });

    if (hasIncomingData === false && retry) {
        log("Retrying connection...");
        retry();
    }
}

function base64ToArrayBuffer(base64Str) {
    if (!base64Str) {
        return { earlyData: null, error: null };
    }
    try {
        base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
        const decode = atob(base64Str);
        const arrayBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
        return { earlyData: arrayBuffer.buffer, error: null };
    } catch (error) {
        return { earlyData: null, error };
    }
}

var byteToHex = [];
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

function safeCloseWebSocket(socket) {
    try {
        if (socket.readyState === 1 || socket.readyState === 2) {
            socket.close();
        }
    } catch (error) {
        console.error("safeCloseWebSocket error", error);
    }
}

function safeCloseClient(client) {
    if (!client) return;
    try {
        if (client.isGrpc && client.close) {
            client.close();
        } else if (client.readyState === 1 || client.readyState === 2) {
            client.close();
        }
    } catch (error) {
        console.error("safeCloseClient error", error);
    }
}

async function handleUDPOutBound(client, responseHeader, log) {
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
        },
        flush(controller) {}
    });

    transformStream.readable.pipeTo(new WritableStream({
        async write(chunk) {
            const resp = await fetch(dohURL, {
                method: "POST",
                headers: { "content-type": "application/dns-message" },
                body: chunk
            });
            const dnsQueryResult = await resp.arrayBuffer();
            const udpSize = dnsQueryResult.byteLength;
            const udpSizeBuffer = new Uint8Array([udpSize >> 8 & 255, udpSize & 255]);

            log(`DoH success, DNS message length: ${udpSize}`);
            const fullPacket = isHeaderSent
                ? new Uint8Array([...udpSizeBuffer, ...new Uint8Array(dnsQueryResult)])
                : new Uint8Array([...responseHeader, ...udpSizeBuffer, ...new Uint8Array(dnsQueryResult)]);
            isHeaderSent = true;

            if (client.isGrpc) {
                await client.send(fullPacket);
            } else if (client.readyState === 1) {
                client.send(fullPacket.buffer);
            }
        }
    })).catch((error) => {
        log("DNS UDP error" + error);
    });

    const writer = transformStream.writable.getWriter();
    return { write: (chunk) => writer.write(chunk) };
}

// ============================================
// CAMOUFLAGE MASK WEBSITE (EDGE DIAGNOSTICS)
// ============================================
function getMaskPage(host = "localhost", isAuthEnabled = true, clientIp = "127.0.0.1", colo = "EDGE-LOCAL") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EdgeTunnel Cloud | Edge Network & Diagnostics</title>
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
      padding: 14px 20px;
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
      font-size: 17px;
      color: #000000;
      cursor: pointer;
      user-select: none;
      line-height: 1.15;
    }
    .logo-icon {
      width: 32px;
      height: 32px;
      background: #000000;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      font-weight: 900;
      font-size: 16px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #000000;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: 0.5px;
    }
    .btn-portal {
      background: transparent;
      border: none;
      color: #000000;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: opacity 0.2s;
    }
    .btn-portal:hover {
      opacity: 0.7;
    }
    main {
      flex: 1;
      max-width: 960px;
      width: 100%;
      margin: 0 auto;
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .hero-card {
      background: linear-gradient(180deg, #ecfdf5 0%, #ffffff 40%);
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 24px;
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
      font-size: 23px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 8px;
      padding-right: 70px;
      line-height: 1.25;
    }
    .hero-desc {
      color: #475569;
      font-size: 14px;
      line-height: 1.6;
      max-width: 680px;
      margin-bottom: 18px;
    }
    .btn-run {
      background: #000000;
      color: #ffffff;
      border: none;
      padding: 9px 18px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      transition: opacity 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    }
    .btn-run:hover { opacity: 0.85; }
    .btn-run:disabled { opacity: 0.6; cursor: not-allowed; }
    .bench-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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
    .bench-box-1 {
      background: linear-gradient(135deg, #d1fae5 0%, #ecfdf5 100%);
      border: 1px solid #a7f3d0;
    }
    .bench-box-2 {
      background: linear-gradient(135deg, #dcfce7 0%, #f0fdf4 100%);
      border: 1px solid #bbf7d0;
    }
    .bench-box-3 {
      background: linear-gradient(135deg, #e0e7ff 0%, #f5f3ff 100%);
      border: 1px solid #c7d2fe;
    }
    .bench-box-4 {
      background: linear-gradient(135deg, #fce7f3 0%, #fdf4ff 100%);
      border: 1px solid #fbcfe8;
    }
    .bench-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .bench-box-1 .bench-label { color: #047857; }
    .bench-box-2 .bench-label { color: #15803d; }
    .bench-box-3 .bench-label { color: #4338ca; }
    .bench-box-4 .bench-label { color: #9d174d; }
    .bench-val {
      font-size: 24px;
      font-weight: 800;
      color: #0f172a;
      margin-top: 4px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
    }
    .bench-meta {
      font-size: 12px;
      font-weight: 600;
      margin-top: 2px;
    }
    .bench-box-1 .bench-meta { color: #059669; }
    .bench-box-2 .bench-meta { color: #16a34a; }
    .bench-box-3 .bench-meta { color: #4f46e5; }
    .bench-box-4 .bench-meta { color: #db2777; }
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
      font-size: 15px;
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
    .info-k { color: #475569; font-weight: 500; }
    .info-v { color: #0f172a; font-family: monospace; font-weight: 700; }
    .footer-bar {
      background: linear-gradient(90deg, #dcfce7 0%, #bbf7d0 50%, #dcfce7 100%);
      border: 1px solid #a7f3d0;
      border-radius: 10px;
      padding: 12px;
      text-align: center;
      font-size: 12px;
      font-weight: 700;
      color: #065f46;
      margin-top: 4px;
    }
    
    /* Access Modal */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s;
    }
    .modal-overlay.open {
      opacity: 1;
      pointer-events: auto;
    }
    .modal-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
      border-radius: 16px;
      width: 100%;
      max-width: 420px;
      padding: 24px;
      margin: 16px;
    }
    .modal-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
    }
    .modal-title {
      font-size: 17px;
      font-weight: 800;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-close {
      background: transparent;
      border: none;
      color: #64748b;
      font-size: 18px;
      cursor: pointer;
    }
    .modal-input {
      width: 100%;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      padding: 11px 14px;
      border-radius: 8px;
      color: #0f172a;
      font-family: monospace;
      font-size: 14px;
      outline: none;
      margin-bottom: 14px;
    }
    .modal-input:focus {
      border-color: #000000;
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.05);
    }
    .btn-submit {
      width: 100%;
      background: #000000;
      color: #ffffff;
      border: none;
      padding: 11px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
    }
    .btn-submit:hover { opacity: 0.85; }
    .auth-msg {
      font-size: 12px;
      margin-top: 10px;
      text-align: center;
      color: #dc2626;
      font-weight: 600;
      display: none;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo-area" onclick="handleLogoClick()">
      <div class="logo-icon">⚡</div>
      <div>
        <div>EdgeTunnel</div>
        <div>Cloud</div>
      </div>
    </div>
    <div class="header-actions">
      <div class="status-pill">
        <span>EDGE OPERATIONAL</span>
      </div>
      <button class="btn-portal" onclick="openPortalModal()">
        <span>🔒 Portal Access</span>
      </button>
    </div>
  </header>

  <main>
    <div class="hero-card">
      <div class="hero-top-badge">Active</div>
      <h1 class="hero-title">Edge Network Diagnostic &amp; Latency Monitor</h1>
      <p class="hero-desc">Real-time edge server telemetry, DNS-over-HTTPS status verification, and full-duplex socket connectivity diagnostics for cloud edge clusters.</p>
      
      <button class="btn-run" id="btnBench" onclick="runDiagnostics()">
        ⚡ Re-Run Benchmark
      </button>

      <div class="bench-grid">
        <div class="bench-box bench-box-1">
          <div class="bench-label">Edge Roundtrip Ping</div>
          <div class="bench-val" id="pingVal">-- ms</div>
          <div class="bench-meta" id="pingStatus">Measuring...</div>
        </div>
        <div class="bench-box bench-box-2">
          <div class="bench-label">DNS-Over-HTTPS (DoH)</div>
          <div class="bench-val">Active</div>
          <div class="bench-meta">Cloudflare 1.1.1.1</div>
        </div>
        <div class="bench-box bench-box-3">
          <div class="bench-label">WebSocket Engine</div>
          <div class="bench-val">Full-Duplex</div>
          <div class="bench-meta">RFC 6455 Ready</div>
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
          <span class="info-k">Serving Host:</span>
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
          <span class="info-k">DDoS Mitigation:</span>
          <span class="info-v" style="color: #16a34a;">Active (Strict)</span>
        </div>
        <div class="info-row">
          <span class="info-k">Global Edge Cache:</span>
          <span class="info-v">100% Operational</span>
        </div>
        <div class="info-row">
          <span class="info-k">WAF Security Layer:</span>
          <span class="info-v">Enforced</span>
        </div>
        <div class="info-row">
          <span class="info-k">Service Status:</span>
          <span class="info-v" style="color: #16a34a;">Optimal (99.99%)</span>
        </div>
      </div>
    </div>

    <div class="footer-bar">
      EdgeTunnel Cloud Network • High Availability Edge Gateway • All Systems Running
    </div>
  </main>

  <!-- Admin Auth Modal -->
  <div class="modal-overlay" id="portalModal">
    <div class="modal-card">
      <div class="modal-head">
        <div class="modal-title">
          <span>🔒 Edge Gateway Access</span>
        </div>
        <button class="btn-close" onclick="closePortalModal()">✕</button>
      </div>
      <p style="font-size: 13px; color: #64748b; margin-bottom: 14px; line-height: 1.5;">
        Please enter your Universal Unique Identifier (UUID) or Dashboard Access Password to unlock the administrative console.
      </p>
      <form onsubmit="handlePortalLogin(event)">
        <input type="password" id="authKeyInput" class="modal-input" placeholder="Enter UUID or Password" required autofocus />
        <button type="submit" class="btn-submit" id="submitBtn">Unlock Console</button>
      </form>
      <div class="auth-msg" id="authErrorMsg">⚠️ Invalid UUID or Password. Access Denied.</div>
    </div>
  </div>

  <script>
    let logoClicks = 0;
    function handleLogoClick() {
      logoClicks++;
      if (logoClicks >= 3) {
        openPortalModal();
        logoClicks = 0;
      }
    }

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        openPortalModal();
      }
      if (e.key === 'Escape') {
        closePortalModal();
      }
    });

    function openPortalModal() {
      document.getElementById('portalModal').classList.add('open');
      document.getElementById('authKeyInput').focus();
    }

    function closePortalModal() {
      document.getElementById('portalModal').classList.remove('open');
      document.getElementById('authErrorMsg').style.display = 'none';
    }

    async function handlePortalLogin(e) {
      e.preventDefault();
      const key = document.getElementById('authKeyInput').value.trim();
      const errorMsg = document.getElementById('authErrorMsg');
      const submitBtn = document.getElementById('submitBtn');

      if (!key) return;
      submitBtn.textContent = "Verifying...";
      submitBtn.disabled = true;
      errorMsg.style.display = 'none';

      try {
        const resp = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });
        const data = await resp.json();

        if (resp.ok && data.success) {
          window.location.href = data.redirect || ('/' + encodeURIComponent(key));
        } else {
          errorMsg.textContent = data.message || "⚠️ Invalid Access Key / UUID.";
          errorMsg.style.display = 'block';
          submitBtn.textContent = "Unlock Console";
          submitBtn.disabled = false;
        }
      } catch (err) {
        // Fallback: direct navigation with key
        window.location.href = '/' + encodeURIComponent(key);
      }
    }

    async function runDiagnostics() {
      const btn = document.getElementById('btnBench');
      const pingVal = document.getElementById('pingVal');
      const pingStatus = document.getElementById('pingStatus');

      btn.disabled = true;
      btn.textContent = "Testing Edge Latency...";
      pingVal.textContent = "...";
      pingStatus.textContent = "Measuring round-trip...";

      const pings = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        try {
          await fetch('/api/health?t=' + Date.now(), { cache: 'no-store' });
          const latency = Math.round(performance.now() - start);
          pings.push(latency);
        } catch (e) {
          pings.push(32);
        }
        await new Promise(r => setTimeout(r, 120));
      }

      const avg = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
      pingVal.textContent = avg + ' ms';
      pingStatus.textContent = "Good Latency";
      btn.disabled = false;
      btn.textContent = "⚡ Re-Run Benchmark";
    }

    // Auto run once
    setTimeout(runDiagnostics, 500);
  </script>
</body>
</html>`;
}

// ============================================
// GALAXY TUNNEL VLESS UI + INTERACTIVE CONFIG PANEL
// ============================================
function getGalaxyPage(host = "localhost", currentUUID = DEFAULT_UUID, currentWSPath = DEFAULT_WS_PATH, currentProxy = DEFAULT_PROXY_IP, subData = null) {
    const defaultSub = subData || generateVlessConfigs(host, currentUUID, currentWSPath, currentProxy);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Galaxy-Tunnel VLESS</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body, html {
      width: 100%; height: 100%;
      background: #02060d; overflow-x: hidden;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      color: #e0f2fe;
    }
    .space-bg {
      position: fixed; width: 100%; height: 100%; top: 0; left: 0;
      background: 
        radial-gradient(circle at 50% 35%, rgba(10, 45, 80, 0.7) 0%, transparent 65%),
        radial-gradient(circle at 80% 80%, rgba(0, 150, 200, 0.15) 0%, transparent 50%),
        #02060d;
      z-index: 1;
    }
    .starfield {
      position: fixed; width: 100%; height: 100%; top: 0; left: 0;
      background-image: 
        radial-gradient(2px 2px at 20px 30px, #ffffff, rgba(0,0,0,0)),
        radial-gradient(2px 2px at 40px 70px, rgba(0,212,255,0.8), rgba(0,0,0,0)),
        radial-gradient(1px 1px at 90px 40px, #ffffff, rgba(0,0,0,0)),
        radial-gradient(2px 2px at 160px 120px, rgba(0,212,255,0.9), rgba(0,0,0,0));
      background-repeat: repeat; background-size: 220px 220px;
      animation: starTwinkle 4s ease-in-out infinite alternate; opacity: 0.6;
      z-index: 2;
    }
    @keyframes starTwinkle {
      0% { opacity: 0.4; transform: scale(1); }
      100% { opacity: 0.8; transform: scale(1.02); }
    }
    .top-nav {
      position: relative; z-index: 20;
      width: 100%; max-width: 620px;
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: -10px;
    }
    .btn-lock {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #fca5a5;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .btn-lock:hover {
      background: rgba(239, 68, 68, 0.3);
      color: #ffffff;
    }
    .main-container {
      position: relative; z-index: 10;
      min-height: 100vh;
      display: flex; flex-direction: column; justify-content: center; align-items: center;
      padding: 24px 16px;
      gap: 20px;
    }
    .card-frame {
      position: relative;
      width: 100%; max-width: 440px; aspect-ratio: 1 / 1;
      background: rgba(4, 14, 30, 0.8);
      border: 1.5px solid rgba(0, 212, 255, 0.6);
      box-shadow: 0 0 30px rgba(0, 212, 255, 0.25), inset 0 0 25px rgba(0, 212, 255, 0.1);
      backdrop-filter: blur(12px);
      display: flex; flex-direction: column; justify-content: space-between; align-items: center;
      padding: 32px 24px 24px 24px; border-radius: 8px;
    }
    .graphic-container {
      position: relative; width: 200px; height: 200px;
      display: flex; justify-content: center; align-items: center;
    }
    .ring {
      position: absolute; width: 220px; height: 70px;
      border: 2px solid rgba(0, 230, 255, 0.85); border-radius: 50%;
      transform: rotate(-28deg);
      box-shadow: 0 0 15px rgba(0, 212, 255, 0.8), inset 0 0 15px rgba(0, 212, 255, 0.5);
      pointer-events: none; animation: ringGlow 3s ease-in-out infinite alternate;
    }
    @keyframes ringGlow {
      0% { opacity: 0.7; box-shadow: 0 0 12px rgba(0,212,255,0.6); }
      100% { opacity: 1; box-shadow: 0 0 25px rgba(0,212,255,1); }
    }
    canvas { position: absolute; top: 0; left: 0; }
    .content-bottom {
      width: 100%; display: flex; flex-direction: column; align-items: center;
      text-align: center; position: relative;
    }
    .title {
      font-size: 30px; font-weight: 900; font-style: italic;
      color: #ffffff; letter-spacing: 2px; text-transform: uppercase;
      text-shadow: 0 0 12px rgba(255, 255, 255, 0.7); line-height: 1.1;
    }
    .subtitle {
      font-size: 14px; font-weight: 600; color: #7b93a7;
      letter-spacing: 4px; margin-top: 4px; text-transform: uppercase;
    }
    .status-row {
      width: 100%; display: flex; justify-content: space-between; align-items: center;
      margin-top: 14px;
    }
    .live-badge {
      display: inline-flex; align-items: center; gap: 6px;
      background: rgba(0, 229, 255, 0.15); border: 1px solid rgba(0, 229, 255, 0.4);
      padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; color: #00e5ff;
    }
    .dot {
      width: 7px; height: 7px; border-radius: 50%; background: #00e5ff;
      box-shadow: 0 0 8px #00e5ff; animation: pulseDot 1.5s infinite;
    }
    @keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .access-badge {
      font-size: 15px; font-weight: 900; font-style: italic; color: #00e5ff;
      text-transform: uppercase; text-align: right; letter-spacing: 1px; line-height: 1.1;
      text-shadow: 0 0 15px rgba(0, 229, 255, 0.85);
    }
    
    /* Config Panel */
    .config-panel {
      width: 100%; max-width: 620px;
      background: rgba(4, 14, 30, 0.85);
      border: 1px solid rgba(0, 212, 255, 0.35);
      border-radius: 8px;
      padding: 20px;
      backdrop-filter: blur(14px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .panel-header {
      display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid rgba(0, 212, 255, 0.2);
      padding-bottom: 12px; margin-bottom: 16px;
    }
    .panel-title {
      font-size: 18px; font-weight: 800; color: #38bdf8;
      display: flex; align-items: center; gap: 8px;
    }
    .tag {
      font-size: 11px; background: rgba(56, 189, 248, 0.2);
      color: #38bdf8; padding: 2px 8px; border-radius: 4px; font-weight: normal;
    }
    .input-grid {
      display: grid; grid-template-columns: 1fr; gap: 12px;
      margin-bottom: 16px;
    }
    @media(min-width: 540px) {
      .input-grid { grid-template-columns: 1fr 1fr; }
      .input-full { grid-column: span 2; }
    }
    .input-group label {
      display: block; font-size: 12px; font-weight: 600; color: #94a3b8;
      margin-bottom: 4px;
    }
    .input-group input {
      width: 100%; background: #071527;
      border: 1px solid rgba(0, 212, 255, 0.3);
      padding: 8px 12px; border-radius: 6px; color: #ffffff;
      font-family: monospace; font-size: 13px; outline: none;
      transition: border-color 0.2s;
    }
    .input-group input:focus {
      border-color: #00e5ff; box-shadow: 0 0 8px rgba(0, 229, 255, 0.3);
    }
    .btn-row {
      display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;
    }
    .btn {
      background: #0284c7; color: #ffffff;
      border: none; padding: 8px 14px; border-radius: 6px;
      font-size: 13px; font-weight: 700; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px;
      transition: all 0.2s;
    }
    .btn:hover { background: #0369a1; transform: translateY(-1px); }
    .btn-cyan { background: #00e5ff; color: #02060d; }
    .btn-cyan:hover { background: #38bdf8; }
    .btn-outline {
      background: transparent; border: 1px solid rgba(0, 212, 255, 0.4);
      color: #38bdf8;
    }
    .btn-outline:hover { background: rgba(0, 212, 255, 0.1); border-color: #00e5ff; }

    .node-list {
      display: flex; flex-direction: column; gap: 10px;
    }
    .node-card {
      background: #06182c; border: 1px solid rgba(0, 212, 255, 0.2);
      border-radius: 6px; padding: 12px;
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
    }
    .node-info { overflow: hidden; }
    .node-name { font-size: 14px; font-weight: 700; color: #f0f9ff; }
    .node-desc { font-size: 12px; color: #64748b; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .copy-btn {
      flex-shrink: 0; background: rgba(0, 229, 255, 0.15); border: 1px solid rgba(0, 229, 255, 0.3);
      color: #00e5ff; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: 700;
      cursor: pointer;
    }
    .copy-btn:hover { background: #00e5ff; color: #02060d; }
    .toast {
      position: fixed; bottom: 20px; right: 20px;
      background: #0284c7; color: #ffffff; padding: 10px 18px;
      border-radius: 6px; font-size: 14px; font-weight: bold;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5); z-index: 999;
      opacity: 0; pointer-events: none; transition: opacity 0.3s;
    }
    .toast.show { opacity: 1; pointer-events: auto; }
  </style>
</head>
<body>
  <div class="space-bg"></div>
  <div class="starfield"></div>

  <div class="main-container">
    <div class="top-nav">
      <span style="font-size: 13px; color: #38bdf8; font-weight: 700; letter-spacing: 1px;">🌌 CONSOLE ACTIVE</span>
      <button class="btn-lock" onclick="lockConsole()">🔒 Lock & Return to Disguise</button>
    </div>

    <!-- Visual Space Frame -->
    <div class="card-frame">
      <div class="graphic-container">
        <div class="ring"></div>
        <canvas id="nodeCanvas" width="200" height="200"></canvas>
      </div>
      <div class="content-bottom">
        <h1 class="title">GALAXY-TUNNEL</h1>
        <div class="subtitle">VLESS DUAL COMPATIBLE</div>
        <div class="status-row">
          <div class="live-badge"><div class="dot"></div> WORKER & PAGES OK</div>
          <div class="access-badge">GALAXY VPROXY<br>ACTIVE</div>
        </div>
      </div>
    </div>

    <!-- Interactive Configurator (No Rebuild / Redeploy Needed) -->
    <div class="config-panel">
      <div class="panel-header">
        <div class="panel-title">
          ⚡ Dynamic VLESS Links
          <span class="tag">Zero-Rebuild Live Setup</span>
        </div>
        <button class="btn btn-outline" onclick="generateRandomUUID()" title="Generate new UUID">🎲 New UUID</button>
      </div>

      <div class="input-grid">
        <div class="input-group input-full">
          <label>UUID (From Cloudflare Dashboard or Generate New):</label>
          <input type="text" id="cfgUUID" value="${currentUUID}" oninput="updateConfigs()" placeholder="Enter your Cloudflare Dashboard UUID or click 🎲 New UUID" />
        </div>
        <div class="input-group">
          <label>WebSocket Path (WS_PATH):</label>
          <input type="text" id="cfgPath" value="${currentWSPath}" oninput="updateConfigs()" placeholder="galaxy-tunnel" />
        </div>
        <div class="input-group">
          <label>Fallback / CDN Proxy IP:</label>
          <input type="text" id="cfgProxy" value="${currentProxy}" oninput="updateConfigs()" placeholder="cdn-b100.xn--b6gac.eu.org" />
        </div>
      </div>

      <div class="btn-row">
        <button class="btn btn-cyan" onclick="copyAllNodes()">📋 Copy All (Base64 Sub)</button>
        <button class="btn btn-outline" onclick="openSubUrl()">🔗 Open Subscription Link</button>
        <button class="btn btn-outline" onclick="copySubUrl()">📋 Copy Sub URL</button>
      </div>

      <div class="node-list">
        <div class="node-card">
          <div class="node-info">
            <div class="node-name">🔒 VLESS + TLS (Port 443)</div>
            <div class="node-desc" id="tlsDesc">WS / TLS Enabled / Best for v2rayNG & Shadowrocket</div>
          </div>
          <button class="copy-btn" onclick="copyNode('tls')">Copy Link</button>
        </div>

        <div class="node-card">
          <div class="node-info">
            <div class="node-name">⚡ VLESS + gRPC (Port 443)</div>
            <div class="node-desc" id="grpcDesc">gRPC HTTP/2 Low Latency Stream</div>
          </div>
          <button class="copy-btn" onclick="copyNode('grpc')">Copy Link</button>
        </div>

        <div class="node-card">
          <div class="node-info">
            <div class="node-name">🌐 VLESS + Direct HTTP (Port 80)</div>
            <div class="node-desc" id="httpDesc">Standard WS Port 80</div>
          </div>
          <button class="copy-btn" onclick="copyNode('http')">Copy Link</button>
        </div>
      </div>
    </div>
  </div>

  <div id="toast" class="toast">Copied to clipboard!</div>

  <script>
    // Star Node Graphic Animation
    const canvas = document.getElementById('nodeCanvas');
    const ctx = canvas.getContext('2d');
    const numNodes = 30; const nodes = []; const radius = 65;
    let angleX = 0.004; let angleY = 0.007;

    for (let i = 0; i < numNodes; i++) {
      let theta = Math.acos(Math.random() * 2 - 1);
      let phi = Math.random() * Math.PI * 2;
      nodes.push({
        x: radius * Math.sin(theta) * Math.cos(phi),
        y: radius * Math.sin(theta) * Math.sin(phi),
        z: radius * Math.cos(theta)
      });
    }

    function rotateX(node, angle) {
      let cos = Math.cos(angle); let sin = Math.sin(angle);
      let y1 = node.y * cos - node.z * sin;
      let z1 = node.z * cos + node.y * sin;
      node.y = y1; node.z = z1;
    }

    function rotateY(node, angle) {
      let cos = Math.cos(angle); let sin = Math.sin(angle);
      let x1 = node.x * cos - node.z * sin;
      let z1 = node.z * cos + node.x * sin;
      node.x = x1; node.z = z1;
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let cx = canvas.width / 2; let cy = canvas.height / 2;

      nodes.forEach(node => {
        rotateX(node, angleX);
        rotateY(node, angleY);
      });

      ctx.strokeStyle = 'rgba(0, 220, 255, 0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          let dist = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y, nodes[i].z - nodes[j].z);
          if (dist < 55) {
            ctx.beginPath();
            ctx.moveTo(nodes[i].x + cx, nodes[i].y + cy);
            ctx.lineTo(nodes[j].x + cx, nodes[j].y + cy);
            ctx.stroke();
          }
        }
      }

      nodes.forEach(node => {
        let size = (node.z + radius) / (2 * radius) * 2.8 + 1.8;
        ctx.beginPath();
        ctx.arc(node.x + cx, node.y + cy, size, 0, Math.PI * 2);
        ctx.fillStyle = '#00f0ff';
        ctx.shadowBlur = 8; ctx.shadowColor = '#00f0ff';
        ctx.fill(); ctx.shadowBlur = 0;
      });

      requestAnimationFrame(draw);
    }
    draw();

    // Configuration & Dynamic Link Generator
    const currentHost = window.location.host || "${host}";
    let generatedLinks = {};

    function updateConfigs() {
      const uuid = (document.getElementById('cfgUUID').value || "${currentUUID}").trim();
      const path = (document.getElementById('cfgPath').value || "${currentWSPath}").trim().replace(/^\\/+/, "");
      const proxy = (document.getElementById('cfgProxy').value || "${currentProxy}").trim();
      const cleanHost = currentHost.replace(/[^a-zA-Z0-9.-]/g, "");

      const tlsLink = "vless://" + uuid + "@" + currentHost + ":443?encryption=none&security=tls&sni=" + currentHost + "&type=ws&host=" + currentHost + "&path=%2F" + encodeURIComponent(path) + "%3Fed%3D2048#Galaxy-TLS%20(" + cleanHost + ")";
      const grpcLink = "vless://" + uuid + "@" + currentHost + ":443?encryption=none&security=tls&sni=" + currentHost + "&type=grpc&serviceName=" + encodeURIComponent(path) + "#Galaxy-gRPC%20(" + cleanHost + ")";
      const httpLink = "vless://" + uuid + "@" + currentHost + ":80?encryption=none&security=none&type=ws&host=" + currentHost + "&path=%2F" + encodeURIComponent(path) + "%3Fed%3D2048#Galaxy-HTTP%20(" + cleanHost + ")";

      generatedLinks = {
        tls: tlsLink,
        grpc: grpcLink,
        http: httpLink,
        all: [tlsLink, grpcLink, httpLink].join('\\n'),
        base64: btoa(unescape(encodeURIComponent([tlsLink, grpcLink, httpLink].join('\\n'))))
      };
    }
    updateConfigs();

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    }

    function copyNode(type) {
      const uuid = (document.getElementById('cfgUUID').value || "").trim();
      if (!uuid) {
        showToast('⚠️ Please enter or generate a UUID first!');
        return;
      }
      if (generatedLinks[type]) {
        navigator.clipboard.writeText(generatedLinks[type]).then(() => {
          showToast('Copied ' + type.toUpperCase() + ' VLESS link!');
        });
      }
    }

    function copyAllNodes() {
      const uuid = (document.getElementById('cfgUUID').value || "").trim();
      if (!uuid) {
        showToast('⚠️ Please enter or generate a UUID first!');
        return;
      }
      if (generatedLinks.base64) {
        navigator.clipboard.writeText(generatedLinks.base64).then(() => {
          showToast('Copied Base64 subscription data!');
        });
      }
    }

    function getSubUrl() {
      const uuid = (document.getElementById('cfgUUID').value || "${currentUUID}").trim();
      const path = (document.getElementById('cfgPath').value || "${currentWSPath}").trim();
      const proxy = (document.getElementById('cfgProxy').value || "${currentProxy}").trim();
      return window.location.origin + "/sub?uuid=" + encodeURIComponent(uuid) + "&path=" + encodeURIComponent(path) + "&proxyip=" + encodeURIComponent(proxy);
    }

    function copySubUrl() {
      const subUrl = getSubUrl();
      navigator.clipboard.writeText(subUrl).then(() => {
        showToast('Copied Subscription URL!');
      });
    }

    function openSubUrl() {
      window.open(getSubUrl(), '_blank');
    }

    function generateRandomUUID() {
      const newUUID = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      document.getElementById('cfgUUID').value = newUUID;
      updateConfigs();
      showToast('Generated new UUID!');
    }

    function lockConsole() {
      document.cookie = "galaxy_auth=0; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      window.location.href = "/api/logout";
    }
  </script>
</body>
</html>`;
}

export default worker_default;
