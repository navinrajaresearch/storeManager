import { useState } from "react";
import { Store, ExternalLink, ChevronRight, Eye, EyeOff } from "lucide-react";
import { saveCredentials } from "../lib/auth";

interface Props {
  onDone: () => void;
}

const STEPS = [
  { n: 1, text: "Go to Google Cloud Console", href: "https://console.cloud.google.com" },
  { n: 2, text: 'Create a project (e.g. "Store Manager")' },
  { n: 3, text: "APIs & Services → Enable APIs → enable Google Drive API" },
  { n: 4, text: "APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID" },
  { n: 5, text: 'Application type: Desktop app — give it any name' },
  { n: 6, text: "OAuth consent screen → Test users → Add Users → add every Gmail that needs access (up to 100)" },
  { n: 7, text: "Copy the Client ID and Client Secret below" },
];

export function SetupScreen({ onDone }: Props) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave =
    clientId.trim().length > 10 &&
    clientSecret.trim().length > 4 &&
    !clientId.includes("PLACEHOLDER");

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await saveCredentials(clientId.trim(), clientSecret.trim());
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-screen bg-gradient-to-br from-amber-50 via-orange-50/40 to-sky-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl border border-amber-100 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-400 to-amber-500 px-8 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
            <Store className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">One-time setup</h1>
            <p className="text-white/80 text-xs">Connect Store Manager to Google Drive</p>
          </div>
        </div>

        <div className="px-8 py-6 flex flex-col gap-5">
          {/* Steps */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              How to get your credentials
            </p>
            <ol className="flex flex-col gap-2">
              {STEPS.map((s) => (
                <li key={s.n} className="flex items-start gap-2.5 text-xs text-gray-600">
                  <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-700 font-bold text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">
                    {s.n}
                  </span>
                  {s.href ? (
                    <span className="flex items-center gap-1">
                      {s.text}
                      <a
                        href={s.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-sky-500 hover:text-sky-700 font-medium"
                        onClick={(e) => {
                          e.preventDefault();
                          // open via Tauri shell
                          import("@tauri-apps/plugin-opener").then((m) =>
                            m.openUrl(s.href!)
                          ).catch(() => window.open(s.href, "_blank"));
                        }}
                      >
                        open <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </span>
                  ) : (
                    <span>{s.text}</span>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-100" />

          {/* Inputs */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                Client ID
                <ChevronRight className="w-3 h-3 text-gray-400" />
                <span className="font-normal text-gray-400">ends with .apps.googleusercontent.com</span>
              </label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="123456789-abc...xyz.apps.googleusercontent.com"
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-transparent text-gray-800 placeholder-gray-300 font-mono"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Client Secret</label>
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="GOCSPX-..."
                  className="w-full px-3 py-2 pr-9 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-transparent text-gray-800 placeholder-gray-300 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-orange-400 to-amber-500 text-white text-sm font-semibold shadow-md shadow-orange-200 hover:from-orange-500 hover:to-amber-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save & Continue"}
          </button>

          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex flex-col gap-1">
            <p className="text-[11px] font-semibold text-amber-700">Getting "access_denied" error?</p>
            <p className="text-[10px] text-amber-600 leading-relaxed">
              Your app is in testing mode. Go to <strong>OAuth consent screen → Test users</strong> and add the Gmail address you want to sign in with. Each person who uses this app needs to be added there.
            </p>
          </div>
          <p className="text-[10px] text-gray-400 text-center leading-relaxed">
            Credentials are stored locally on your device only —
            they identify your app to Google, not your personal account.
          </p>
        </div>
      </div>
    </div>
  );
}
