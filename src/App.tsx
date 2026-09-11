import React, { useState } from 'react';
import { 
  Zap, 
  ShieldCheck, 
  FileCode, 
  Radio, 
  Network, 
  Cpu, 
  Layers, 
  Activity, 
  CheckCircle2,
  ExternalLink
} from 'lucide-react';
import { ConfigGenerator } from './components/ConfigGenerator';
import { CodeExporter } from './components/CodeExporter';
import { Port80Guide } from './components/Port80Guide';

export default function App() {
  const [activeTab, setActiveTab] = useState<'generator' | 'code' | 'port80'>('generator');

  // Shared state for the configuration generator
  const [domain, setDomain] = useState('my-vless-node.workers.dev');
  const [uuid, setUuid] = useState('d342d11e-d424-4583-b36e-524ab1f0afa4');
  const [trojanPass, setTrojanPass] = useState('d342d11e-d424-4583-b36e-524ab1f0afa4');
  const [wsPath, setWsPath] = useState('/vless');
  const [cleanIp, setCleanIp] = useState('104.16.1.1');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500 selection:text-white">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-sky-600 to-cyan-400 flex items-center justify-center text-white font-bold shadow-md shadow-sky-500/20">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center gap-2">
                VLESS &amp; Trojan Relay Hub
                <span className="hidden sm:inline-block bg-sky-500/10 text-sky-400 border border-sky-500/30 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                  v3.0 Unified
                </span>
              </h1>
              <p className="text-[11px] text-slate-400">
                Port 80 (No-TLS) &amp; Port 443 (TLS) • ProxyIP Fallback • Multi-DoH Race
              </p>
            </div>
          </div>

          {/* Badges */}
          <div className="hidden lg:flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">
              <Network className="w-3 h-3" /> Port 80 Ready
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
              <ShieldCheck className="w-3 h-3" /> Dual Protocol
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/30">
              <Cpu className="w-3 h-3" /> ProxyIP Recovery
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Navigation Tabs */}
        <div className="flex bg-slate-900/90 p-1.5 rounded-xl border border-slate-800/80 w-full sm:w-fit gap-1 shadow-md">
          <button
            onClick={() => setActiveTab('generator')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition cursor-pointer flex-1 sm:flex-initial justify-center ${
              activeTab === 'generator'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Radio className="w-4 h-4" />
            Config &amp; Link Generator
          </button>
          <button
            onClick={() => setActiveTab('port80')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition cursor-pointer flex-1 sm:flex-initial justify-center ${
              activeTab === 'port80'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Network className="w-4 h-4" />
            Port 80 Speed Guide
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition cursor-pointer flex-1 sm:flex-initial justify-center ${
              activeTab === 'code'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <FileCode className="w-4 h-4" />
            Worker Files &amp; Deploy
          </button>
        </div>

        {/* Tab Views */}
        {activeTab === 'generator' && (
          <ConfigGenerator
            domain={domain}
            setDomain={setDomain}
            uuid={uuid}
            setUuid={setUuid}
            trojanPass={trojanPass}
            setTrojanPass={setTrojanPass}
            wsPath={wsPath}
            setWsPath={setWsPath}
            cleanIp={cleanIp}
            setCleanIp={setCleanIp}
          />
        )}

        {activeTab === 'port80' && <Port80Guide />}

        {activeTab === 'code' && <CodeExporter />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        <p>VLESS &amp; Trojan WebSocket Engine • Cloudflare Workers &amp; Pages Compatible</p>
      </footer>
    </div>
  );
}
