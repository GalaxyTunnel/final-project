import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, QrCode, Shield, Zap, RefreshCw, Globe, ArrowRight, ExternalLink } from 'lucide-react';
import { MYANMAR_CLEAN_IPS } from '../constants';

interface Props {
  domain: string;
  setDomain: (d: string) => void;
  uuid: string;
  setUuid: (u: string) => void;
  trojanPass: string;
  setTrojanPass: (p: string) => void;
  wsPath: string;
  setWsPath: (p: string) => void;
  cleanIp: string;
  setCleanIp: (ip: string) => void;
}

export const ConfigGenerator: React.FC<Props> = ({
  domain,
  setDomain,
  uuid,
  setUuid,
  trojanPass,
  setTrojanPass,
  wsPath,
  setWsPath,
  cleanIp,
  setCleanIp
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeQr, setActiveQr] = useState<{ title: string; link: string; dataUrl: string } | null>(null);

  const cleanDomain = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'your-worker.workers.dev';
  const cleanPath = `/${wsPath.trim().replace(/^\/+|\/+$/g, '') || 'vless'}`;
  const effectiveAddress = cleanIp.trim() || cleanDomain;
  const encodedPath = encodeURIComponent(`${cleanPath}?ed=2048`);

  // Node 1: VLESS Port 80 (No-TLS)
  const vlessPort80 = `vless://${uuid}@${effectiveAddress}:80?encryption=none&security=none&type=ws&host=${cleanDomain}&path=${encodedPath}#${encodeURIComponent(`[VLESS-NoTLS:80] ${cleanDomain}`)}`;

  // Node 2: VLESS Port 443 (TLS)
  const vlessPort443 = `vless://${uuid}@${effectiveAddress}:443?encryption=none&security=tls&sni=${cleanDomain}&type=ws&host=${cleanDomain}&path=${encodedPath}#${encodeURIComponent(`[VLESS-TLS:443] ${cleanDomain}`)}`;

  // Node 3: Trojan Port 80 (No-TLS)
  const trojanPort80 = `trojan://${trojanPass || uuid}@${effectiveAddress}:80?security=none&type=ws&host=${cleanDomain}&path=${encodedPath}#${encodeURIComponent(`[Trojan-NoTLS:80] ${cleanDomain}`)}`;

  // Node 4: Trojan Port 443 (TLS)
  const trojanPort443 = `trojan://${trojanPass || uuid}@${effectiveAddress}:443?security=tls&sni=${cleanDomain}&type=ws&host=${cleanDomain}&path=${encodedPath}#${encodeURIComponent(`[Trojan-TLS:443] ${cleanDomain}`)}`;

  const nodes = [
    {
      id: 'vless-80',
      title: 'VLESS (Port 80 • No-TLS)',
      desc: 'HTTP Port 80 - DPI / SNI Throttling ကိုကျော်လွှားနိုင်ပြီး မြန်မာနိုင်ငံရှိ ISP များတွင် ပိုမိုပေါ့ပါးမြန်ဆန်သည်။',
      port: 80,
      protocol: 'VLESS',
      tls: false,
      tag: 'Port 80 (Recommended for Speed)',
      link: vlessPort80,
      badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/30'
    },
    {
      id: 'vless-443',
      title: 'VLESS (Port 443 • TLS 1.3)',
      desc: 'HTTPS Port 443 - Standard Encryption ဖြင့် အချက်အလက်လုံခြုံမှုအပြည့်ရှိသော Standard Node။',
      port: 443,
      protocol: 'VLESS',
      tls: true,
      tag: 'Port 443 (TLS Encrypted)',
      link: vlessPort443,
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    },
    {
      id: 'trojan-80',
      title: 'Trojan (Port 80 • No-TLS)',
      desc: 'SHA-224 Password Hash Authentication ဖြင့် Trojan protocol သုံးလိုသူများအတွက် Port 80 Node။',
      port: 80,
      protocol: 'Trojan',
      tls: false,
      tag: 'Port 80 (Trojan Alternative)',
      link: trojanPort80,
      badgeColor: 'bg-sky-500/10 text-sky-400 border-sky-500/30'
    },
    {
      id: 'trojan-443',
      title: 'Trojan (Port 443 • TLS 1.3)',
      desc: 'HTTPS Port 443 - Trojan clients များ (Shadowrocket, Clash, Sing-box) အတွက် TLS အပြည့်အစုံ။',
      port: 443,
      protocol: 'Trojan',
      tls: true,
      tag: 'Port 443 (Trojan Secure)',
      link: trojanPort443,
      badgeColor: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
    }
  ];

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleShowQr = async (title: string, link: string) => {
    try {
      const url = await QRCode.toDataURL(link, { width: 320, margin: 2 });
      setActiveQr({ title, link, dataUrl: url });
    } catch (e) {
      console.error(e);
    }
  };

  const generateNewUuid = () => {
    const newUuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    setUuid(newUuid);
    setTrojanPass(newUuid);
  };

  const subUrl = `https://${cleanDomain}/sub${cleanIp ? `?cleanip=${cleanIp}` : ''}`;

  return (
    <div className="space-y-6">
      {/* Parameter Settings Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl backdrop-blur-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-5 border-b border-slate-800/80 gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-sky-400" />
              Node Configuration & Clean IP Settings
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Port 80 (No-TLS) နှင့် Port 443 (TLS) နှစ်မျိုးစလုံးအတွက် Client Links များကို အချိန်နှင့်တပြေးညီ ပြင်ဆင်ထုတ်ယူနိုင်သည်
            </p>
          </div>
          <button
            onClick={generateNewUuid}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-xs font-medium transition cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Generate New UUID
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Cloudflare Worker / Custom Domain
            </label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g. vless-node.yourdomain.com or *.workers.dev"
              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              VLESS UUID (User Identifier)
            </label>
            <input
              type="text"
              value={uuid}
              onChange={(e) => setUuid(e.target.value)}
              placeholder="e.g. d342d11e-d424-4583-b36e-524ab1f0afa4"
              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              WebSocket Path
            </label>
            <input
              type="text"
              value={wsPath}
              onChange={(e) => setWsPath(e.target.value)}
              placeholder="/vless"
              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Trojan Password / Hash Key
            </label>
            <input
              type="text"
              value={trojanPass}
              onChange={(e) => setTrojanPass(e.target.value)}
              placeholder="Trojan Password (Defaults to UUID)"
              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>
        </div>

        {/* Clean IP presets */}
        <div className="mt-5 pt-4 border-t border-slate-800/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-sky-400" />
              Clean IP / Address Replacement (Optional - ISP အလိုက် အဆင်ပြေဆုံး IP ထည့်နိုင်သည်)
            </label>
            {cleanIp && (
              <button
                onClick={() => setCleanIp('')}
                className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Reset to Domain
              </button>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={cleanIp}
              onChange={(e) => setCleanIp(e.target.value)}
              placeholder="မထည့်ပါက Worker Domain ကို တိုက်ရိုက်အသုံးပြုမည် (ဥပမာ 104.16.1.1)"
              className="flex-1 bg-slate-950 border border-slate-700/80 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="text-[11px] text-slate-400 self-center">Clean IP Presets:</span>
            {MYANMAR_CLEAN_IPS.map((item) => (
              <button
                key={item.ip}
                onClick={() => setCleanIp(item.ip)}
                className={`text-xs px-2.5 py-1 rounded-md border transition cursor-pointer ${
                  cleanIp === item.ip
                    ? 'bg-sky-500/20 border-sky-500 text-sky-300 font-medium'
                    : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {item.ip} <span className="text-[10px] opacity-70">({item.tag})</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Generated Nodes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {nodes.map((node) => (
          <div
            key={node.id}
            className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    {node.title}
                  </h3>
                  <span className={`inline-block mt-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border ${node.badgeColor}`}>
                    {node.tag}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleShowQr(node.title, node.link)}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                    title="QR Code ပြသရန်"
                  >
                    <QrCode className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleCopy(node.link, node.id)}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                    title="Link ကူးယူရန်"
                  >
                    {copiedId === node.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-2 mb-3 leading-relaxed">
                {node.desc}
              </p>
            </div>

            <div className="mt-2 pt-3 border-t border-slate-800/80">
              <div className="text-[11px] font-mono text-slate-400 truncate bg-slate-950/80 px-2.5 py-1.5 rounded border border-slate-800 select-all">
                {node.link}
              </div>
              <div className="flex justify-between items-center mt-2.5 text-[11px]">
                <span className="text-slate-500">Port: <strong className="text-slate-300">{node.port}</strong></span>
                <span className="text-slate-500">Security: <strong className="text-slate-300">{node.tls ? 'TLS' : 'none'}</strong></span>
                <button
                  onClick={() => handleCopy(node.link, node.id)}
                  className="text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
                >
                  {copiedId === node.id ? 'Copied!' : 'Copy Config Link'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Subscription Link Card */}
      <div className="bg-gradient-to-r from-sky-950/40 via-slate-900 to-indigo-950/40 border border-sky-500/30 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-sky-400" />
              <h3 className="text-sm font-semibold text-white">
                One-Click Subscription URL (/sub)
              </h3>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              v2rayNG, Shadowrocket, Sing-box သို့မဟုတ် v2rayN များတွင် Subscription Link အဖြစ် တိုက်ရိုက်ထည့်သွင်းနိုင်ပါသည် (Port 80 နှင့် 443 nodes အားလုံးပါဝင်သည်)
            </p>
          </div>
          <button
            onClick={() => handleCopy(subUrl, 'sub-url')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-medium text-xs transition cursor-pointer self-start sm:self-auto shrink-0"
          >
            {copiedId === 'sub-url' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copiedId === 'sub-url' ? 'Sub Link Copied' : 'Copy Sub Link'}
          </button>
        </div>

        <div className="mt-3 bg-slate-950/90 rounded-lg p-2.5 border border-slate-800 text-xs font-mono text-sky-300 select-all break-all">
          {subUrl}
        </div>
      </div>

      {/* QR Code Modal Popup */}
      {activeQr && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl">
            <h3 className="text-base font-semibold text-white mb-1">{activeQr.title}</h3>
            <p className="text-xs text-slate-400 mb-4">v2rayNG / Shadowrocket ဖြင့် Scan ဖတ်ပါ</p>
            
            <div className="bg-white p-4 rounded-xl inline-block shadow-inner mb-4">
              <img src={activeQr.dataUrl} alt="QR Code" className="w-56 h-56 mx-auto" />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleCopy(activeQr.link, 'modal-link')}
                className="flex-1 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium transition cursor-pointer"
              >
                {copiedId === 'modal-link' ? 'Copied!' : 'Copy Link'}
              </button>
              <button
                onClick={() => setActiveQr(null)}
                className="py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
