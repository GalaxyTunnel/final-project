import React, { useState } from 'react';
import { Copy, Check, Download, FileCode, Terminal, Layers } from 'lucide-react';
import { DEFAULT_WORKER_CODE, DEFAULT_WRANGLER_CODE, DEFAULT_PAGES_ADAPTER } from '../constants';

export const CodeExporter: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'worker' | 'wrangler' | 'pages' | 'deploy'>('worker');
  const [copied, setCopied] = useState(false);

  const getActiveContent = () => {
    switch (activeTab) {
      case 'worker':
        return { filename: 'worker.js', content: DEFAULT_WORKER_CODE };
      case 'wrangler':
        return { filename: 'wrangler.toml', content: DEFAULT_WRANGLER_CODE };
      case 'pages':
        return { filename: 'functions/[[path]].js', content: DEFAULT_PAGES_ADAPTER };
      default:
        return { filename: 'worker.js', content: DEFAULT_WORKER_CODE };
    }
  };

  const handleCopy = () => {
    const { content } = getActiveContent();
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const { filename, content } = getActiveContent();
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.split('/').pop() || 'download.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <FileCode className="w-5 h-5 text-sky-400" />
            Upgraded Source Files & Deployment Guides
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            နှစ်ခုပေါင်းထားသော Unified Code ဖြစ်ပြီး Port 80, 443, ProxyIP နှင့် DoH အပြည့်အစုံ ပါဝင်သည်
          </p>
        </div>

        {activeTab !== 'deploy' && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy Code'}
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download File
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 mt-4 overflow-x-auto">
        <button
          onClick={() => setActiveTab('worker')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'worker'
              ? 'border-sky-500 text-sky-400 bg-sky-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          worker.js (Unified Engine)
        </button>
        <button
          onClick={() => setActiveTab('wrangler')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'wrangler'
              ? 'border-sky-500 text-sky-400 bg-sky-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          wrangler.toml (Config)
        </button>
        <button
          onClick={() => setActiveTab('pages')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'pages'
              ? 'border-sky-500 text-sky-400 bg-sky-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          functions/[[path]].js (Pages Adapter)
        </button>
        <button
          onClick={() => setActiveTab('deploy')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition cursor-pointer whitespace-nowrap ${
            activeTab === 'deploy'
              ? 'border-sky-500 text-sky-400 bg-sky-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Deployment Guide (မြန်မာလို ညွှန်ကြားချက်)
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab !== 'deploy' ? (
        <div className="mt-4">
          <pre className="bg-slate-950 p-4 rounded-lg border border-slate-800/80 text-xs font-mono text-slate-300 overflow-x-auto max-h-[460px] select-all leading-relaxed">
            {getActiveContent().content}
          </pre>
        </div>
      ) : (
        <div className="mt-5 space-y-4 text-xs text-slate-300 leading-relaxed">
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
            <h3 className="font-semibold text-sky-400 text-sm mb-2 flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              နည်းလမ်း ၁: Cloudflare Dashboard တွင် တိုက်ရိုက်တင်နည်း (အလွယ်ဆုံး)
            </h3>
            <ol className="list-decimal list-inside space-y-2 text-slate-300">
              <li>Cloudflare Dashboard သို့ ဝင်ရောက်ပြီး <strong>Workers & Pages</strong> သို့ သွားပါ။</li>
              <li><strong>Create application</strong> နှိပ်ပြီး <strong>Create Worker</strong> ကို ရွေးချယ်ပါ။</li>
              <li>Worker အမည် (ဥပမာ <code>vless-relay</code>) ပေးပြီး <strong>Deploy</strong> နှိပ်ပါ။</li>
              <li>ပြီးလျှင် <strong>Edit code</strong> ကိုနှိပ်ပြီး ယခု <code>worker.js</code> ထဲမှ code အားလုံးကို အစားထိုး paste လုပ်ကာ <strong>Deploy</strong> နှိပ်ပါ။</li>
              <li><strong>Settings &gt; Variables</strong> သို့ သွားပြီး <code>UUID</code> ကို Environment Variable သို့မဟုတ် Secret အဖြစ် ထည့်ပေးပါ (ဥပမာ <code>d342d11e-d424-4583-b36e-524ab1f0afa4</code>)။</li>
            </ol>
          </div>

          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
            <h3 className="font-semibold text-emerald-400 text-sm mb-2 flex items-center gap-2">
              <Layers className="w-4 h-4" />
              နည်းလမ်း ၂: Wrangler CLI ဖြင့် Command Line မှ တင်နည်း
            </h3>
            <pre className="bg-slate-900 p-3 rounded text-slate-200 font-mono text-xs overflow-x-auto mb-2">
{`# 1. Login to Cloudflare
npx wrangler login

# 2. Put your secret UUID
npx wrangler secret put UUID

# 3. Deploy to Cloudflare Edge
npx wrangler deploy`}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
