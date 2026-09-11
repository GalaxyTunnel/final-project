import React from 'react';
import { ShieldCheck, Info, CheckCircle2, AlertTriangle, Cpu, Network } from 'lucide-react';

export const Port80Guide: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl">
        <h2 className="text-base font-semibold text-white flex items-center gap-2 mb-2">
          <Network className="w-5 h-5 text-amber-400" />
          Cloudflare ပေါ်တွင် Port 80 (HTTP No-TLS) အသုံးပြုခြင်း လမ်းညွှန်
        </h2>
        <p className="text-xs text-slate-300 leading-relaxed">
          မြန်မာနိုင်ငံရှိ အင်တာနက်ဝန်ဆောင်မှု (MPT, Atom, Ooredoo, MyTel) များသည် တစ်ခါတစ်ရံတွင် HTTPS (Port 443) ၏ TLS SNI Handshake ကို DPI စက်များဖြင့် စောင့်ကြည့်ပိတ်ဆို့တတ်သည်။ ထိုအခါ <strong>Port 80 (HTTP Plain WebSocket)</strong> ကို Clean IP နှင့် တွဲဖက်အသုံးပြုခြင်းဖြင့် DPI Detection ကို လျင်မြန်စွာ ကျော်လွှားနိုင်ပါသည်။
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-amber-400 flex items-center gap-1.5 mb-2">
              <CheckCircle2 className="w-4 h-4" />
              Port 80 (No-TLS) ၏ အားသာချက်များ
            </h3>
            <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside leading-relaxed">
              <li><strong>Zero TLS Handshake Delay:</strong> TLS 1.3 encryption handshake လုပ်ရန် မလိုသဖြင့် ချိတ်ဆက်မှု Ping (Latency) အလွန်နည်းပါးသည်။</li>
              <li><strong>Bypasses SNI Inspection:</strong> TLS SNI မပါဝင်သဖြင့် ISP DPI များမှ Domain ပိတ်ဆို့မှုကို ကျော်လွှားနိုင်ခြေ မြင့်မားသည်။</li>
              <li><strong>Clean IP Compatibility:</strong> Cloudflare Anycast Clean IP များနှင့် အထူးကိုက်ညီပြီး ဖုန်းလိုင်း internet packet ချွေတာသည်။</li>
            </ul>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-sky-400 flex items-center gap-1.5 mb-2">
              <Info className="w-4 h-4" />
              သတိပြုရမည့် Cloudflare HTTP Ports များ
            </h3>
            <p className="text-xs text-slate-400 mb-2">
              Cloudflare သည် Port 80 အပြင် အောက်ပါ HTTP Ports များကိုလည်း လက်ခံသည် -
            </p>
            <div className="flex flex-wrap gap-1.5 text-xs font-mono">
              {['80 (Default)', '8080', '8880', '2052', '2082', '2086', '2095'].map((p) => (
                <span key={p} className="bg-slate-800 text-slate-200 px-2 py-0.5 rounded border border-slate-700">
                  {p}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              Port 80 ပိတ်ထားသော WiFi/Hotspot များတွင် အထက်ပါ Port များသို့ ပြောင်းလဲအသုံးပြုနိုင်ပါသည်။
            </p>
          </div>
        </div>

        {/* v2rayNG Configuration Steps */}
        <div className="mt-5 pt-4 border-t border-slate-800/80">
          <h3 className="text-xs font-semibold text-white mb-2">
            v2rayNG / Shadowrocket တွင် Port 80 Node ကို Manual စစ်ဆေးခြင်း
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-500 font-semibold mb-1">အဆင့် ၁ (Port)</div>
              <div className="text-slate-200 font-mono">Port: 80</div>
              <div className="text-[11px] text-slate-400 mt-1">443 အစား 80 ကို သတ်မှတ်ပါ</div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-500 font-semibold mb-1">အဆင့် ၂ (TLS)</div>
              <div className="text-amber-300 font-mono">Security: none</div>
              <div className="text-[11px] text-slate-400 mt-1">TLS option ကို ပိတ်ထားပါ</div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-500 font-semibold mb-1">အဆင့် ၃ (Network)</div>
              <div className="text-slate-200 font-mono">Network: ws (WebSocket)</div>
              <div className="text-[11px] text-slate-400 mt-1">Transport ကို ws ထားပါ</div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-500 font-semibold mb-1">အဆင့် ၄ (Host)</div>
              <div className="text-slate-200 font-mono truncate">Host: your-domain.com</div>
              <div className="text-[11px] text-slate-400 mt-1">Worker domain ကို Host မှာ ထည့်ပါ</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
