import React, { useState, useRef } from "react";
import { Mail, Loader2, Copy, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

/**
 * Recursive website crawler + aggressive email extractor (frontend-only).
 * - Uses free proxy services to avoid CORS (no server required).
 * - Crawls same-origin internal links only.
 * - Detects hidden/obfuscated emails (attributes, onclicks, base64, [at]/(dot), etc.)
 * - Shows visual progress bar with dynamic percentage.
 */

const proxies = [
  (url: string) =>
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) =>
    `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
  (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

const defaultConfig = {
  maxDepth: 3,
  maxPages: 150,
  concurrency: 3,
  delayMs: 400,
};

/* ---------- Utility Helpers ---------- */

// decode HTML entities
const decodeHtmlEntities = (str: string) => {
  try {
    const txt = new DOMParser().parseFromString(str, "text/html");
    return txt.documentElement.textContent || str;
  } catch {
    return str;
  }
};

// try base64 decode
const tryBase64Decode = (s: string) => {
  try {
    const clean = s.replace(/\s+/g, "");
    if (/^[A-Za-z0-9+/=]+$/.test(clean) && clean.length % 4 === 0) {
      const decoded = atob(clean);
      if (/@/.test(decoded)) return decoded;
    }
  } catch {}
  return null;
};

// normalize obfuscations like [at], (dot), etc.
const normalizeObfuscation = (t: string) => {
  let out = t;
  out = out.replace(/\[at\]|\(at\)|\s+at\s+| at /gi, "@");
  out = out.replace(/\[dot\]|\(dot\)|\s+dot\s+| dot /gi, ".");
  out = out.replace(/&nbsp;/gi, " ");
  try {
    out = decodeURIComponent(out);
  } catch {}
  out = decodeHtmlEntities(out);
  return out;
};

// deobfuscate JS string concatenation
const deobfuscateConcat = (s: string) => {
  const parts: string[] = [];
  const regex = /(['"])(.*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(s))) parts.push(m[2]);
  if (parts.length >= 2) return parts.join("");
  return s;
};

/* ---------- Aggressive Email Extractor ---------- */
const extractEmailsFromHtml = (html: string, baseUrl?: string) => {
  const found = new Set<string>();

  // 1) quick raw regex on HTML
  const quickRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-z]{2,}/gi;
  (html.match(quickRegex) || []).forEach((m) => found.add(m.toLowerCase()));

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // text nodes
    const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = (node.textContent || "").trim();
      if (text) {
        const norm = normalizeObfuscation(text);
        const deconcat = deobfuscateConcat(text);
        const base64s = text.match(/([A-Za-z0-9+/=]{20,})/g) || [];

        (norm.match(quickRegex) || []).forEach((e) =>
          found.add(e.toLowerCase())
        );
        if (deconcat !== text)
          (deconcat.match(quickRegex) || []).forEach((e) =>
            found.add(e.toLowerCase())
          );

        base64s.forEach((b64) => {
          const dec = tryBase64Decode(b64);
          if (dec)
            (dec.match(quickRegex) || []).forEach((e) =>
              found.add(e.toLowerCase())
            );
        });
      }
      node = walker.nextNode();
    }

    // attributes (href, data-*, onclick, etc.)
    const all = Array.from(doc.querySelectorAll("*"));
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const val = attr.value || "";

        if (!val) continue;

        // mailto:
        if (name === "href" && val.toLowerCase().startsWith("mailto:")) {
          const email = val.replace(/^mailto:/i, "").split("?")[0];
          found.add(email.toLowerCase());
          continue;
        }

        const norm = normalizeObfuscation(val);
        const deconcat = deobfuscateConcat(val);

        (norm.match(quickRegex) || []).forEach((e) =>
          found.add(e.toLowerCase())
        );
        if (deconcat !== val)
          (deconcat.match(quickRegex) || []).forEach((e) =>
            found.add(e.toLowerCase())
          );

        const base64s = val.match(/([A-Za-z0-9+/=]{20,})/g) || [];
        base64s.forEach((b64) => {
          const dec = tryBase64Decode(b64);
          if (dec)
            (dec.match(quickRegex) || []).forEach((e) =>
              found.add(e.toLowerCase())
            );
        });
      }
    }

    // inline scripts
    doc.querySelectorAll("script").forEach((s) => {
      const t = s.textContent || "";
      const norm = normalizeObfuscation(t);
      (norm.match(quickRegex) || []).forEach((e) => found.add(e.toLowerCase()));
      const deconcat = deobfuscateConcat(t);
      if (deconcat !== t)
        (deconcat.match(quickRegex) || []).forEach((e) =>
          found.add(e.toLowerCase())
        );
    });
  } catch {
    // ignore DOM errors
  }

  return Array.from(found);
};

/* ---------- Crawler ---------- */
const Index: React.FC = () => {
  const [url, setUrl] = useState("");
  const [emails, setEmails] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progressPct, setProgressPct] = useState<number>(0); // percent 0..100
  const [maxPages, setMaxPages] = useState<number>(defaultConfig.maxPages);
  const [maxDepth, setMaxDepth] = useState<number>(defaultConfig.maxDepth);
  const toast = useToast();
  const abortRef = useRef({ abort: false });

  const pushLog = (line: string) => {
    setLogs((p) => [line, ...p].slice(0, 200)); // keep last 200 logs
  };

  const fetchWithProxy = async (targetUrl: string) => {
    for (const makeProxyUrl of proxies) {
      const fetchUrl = makeProxyUrl(targetUrl);
      try {
        const res = await fetch(fetchUrl);
        if (res.ok) return await res.text();
        pushLog(`Proxy returned ${res.status} for: ${fetchUrl}`);
      } catch {
        pushLog(`Proxy failed: ${fetchUrl}`);
      }
    }
    throw new Error("All proxies failed or blocked");
  };

  const extractLinksFromHtml = (html: string, baseUrl: string) => {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const anchors = Array.from(doc.querySelectorAll("a[href]"));
      const urls: string[] = [];
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        if (
          !href ||
          href.startsWith("mailto:") ||
          href.startsWith("javascript:")
        )
          continue;
        try {
          const resolved = new URL(href, baseUrl).toString();
          urls.push(resolved);
        } catch {}
      }
      return urls;
    } catch {
      return [];
    }
  };

  const sameHost = (u1: string, u2: string) => {
    try {
      return new URL(u1).hostname === new URL(u2).hostname;
    } catch {
      return false;
    }
  };

  const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

  const crawlSite = async (startUrl: string, cfg = defaultConfig) => {
    const startFull = startUrl.startsWith("http")
      ? startUrl
      : `https://${startUrl}`;
    const toVisitQueue: Array<{ url: string; depth: number }> = [
      { url: startFull, depth: 0 },
    ];
    const visited = new Set<string>();
    const foundEmailsSet = new Set<string>();
    abortRef.current.abort = false;

    setProgressPct(0);
    pushLog(
      `Starting crawl ${startFull} (maxDepth=${cfg.maxDepth}, maxPages=${cfg.maxPages})`
    );

    while (toVisitQueue.length > 0 && visited.size < cfg.maxPages) {
      if (abortRef.current.abort) {
        pushLog("Crawl aborted by user");
        break;
      }

      // take up to concurrency items
      const batch = toVisitQueue.splice(0, cfg.concurrency);

      await Promise.all(
        batch.map(async (item) => {
          const { url: currUrl, depth } = item;
          if (visited.has(currUrl)) return;
          if (visited.size >= cfg.maxPages) return;

          // only same-host links as start
          if (!sameHost(startFull, currUrl)) {
            pushLog(`Skipping external link: ${currUrl}`);
            visited.add(currUrl); // mark as visited so we don't re-add
            // update progress percent
            const pct = Math.min((visited.size / cfg.maxPages) * 100, 100);
            setProgressPct(pct);
            return;
          }

          try {
            pushLog(
              `Fetching (${visited.size + 1}) ${currUrl} (depth ${depth})`
            );
            const html = await fetchWithProxy(currUrl);

            // extract emails (aggressive)
            const emailsOnPage = extractEmailsFromHtml(html, currUrl);
            emailsOnPage.forEach((e) => foundEmailsSet.add(e));

            // extract links and queue
            if (depth < cfg.maxDepth) {
              const links = extractLinksFromHtml(html, currUrl);
              for (const l of links) {
                if (visited.has(l)) continue;
                // only same host
                if (!sameHost(startFull, l)) continue;
                const norm = l.split("#")[0];
                if (
                  !visited.has(norm) &&
                  !toVisitQueue.some((q) => q.url === norm)
                ) {
                  toVisitQueue.push({ url: norm, depth: depth + 1 });
                }
              }
            }

            visited.add(currUrl);
            // update progress percent
            const pct = Math.min((visited.size / cfg.maxPages) * 100, 100);
            setProgressPct(pct);
          } catch (err: any) {
            pushLog(`Failed: ${currUrl} → ${(err as Error).message}`);
            visited.add(currUrl);
            const pctErr = Math.min((visited.size / cfg.maxPages) * 100, 100);
            setProgressPct(pctErr);
          }
        })
      );

      // polite delay between batches
      await delay(cfg.delayMs);
    }

    pushLog(
      `Done. Visited ${visited.size} pages. Found ${foundEmailsSet.size} emails.`
    );
    // final set to array
    return Array.from(foundEmailsSet);
  };

  const handleStart = async () => {
    if (!url.trim()) {
      toast.toast({
        title: "URL required",
        description: "Enter a URL.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setEmails([]);
    setLogs([]);
    setProgressPct(0);
    abortRef.current.abort = false;

    try {
      const found = await crawlSite(url, {
        maxDepth,
        maxPages,
        concurrency: defaultConfig.concurrency,
        delayMs: defaultConfig.delayMs,
      });
      setEmails(found);
      toast.toast({
        title: "Completed",
        description: `Found ${found.length} emails.`,
      });
    } catch (err: any) {
      toast.toast({
        title: "Error",
        description: err?.message || "Crawl failed",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      // set 100% if not already
      setProgressPct((p) => (p < 100 ? 100 : p));
    }
  };

  const handleAbort = () => {
    abortRef.current.abort = true;
    pushLog("Abort requested by user.");
    setLoading(false);
  };

  const copyAllEmails = () => {
    if (emails.length === 0) return;
    navigator.clipboard.writeText(emails.join("\n"));
    toast.toast({
      title: "Copied!",
      description: `${emails.length} email${
        emails.length > 1 ? "s" : ""
      } copied.`,
    });
  };

  return (
    <main className="min-h-screen bg-[#f6a700] flex items-center justify-center p-4">
      <div className="w-full max-w-5xl">
        <header className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-[#1a1a1a] mb-3">
            Email Crawler — Advanced Extraction
          </h1>
          <p className="text-base text-[#333333] max-w-3xl mx-auto leading-relaxed">
            Extract hidden & obfuscated emails from any website. Uses public
            proxies to bypass CORS.
          </p>
        </header>

        <section className="mb-6 space-y-4">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter website URL (e.g., example.com)"
            className="h-12 bg-[#fefcf7] text-[#333333] rounded-xl shadow"
          />

          <div className="flex gap-3 items-center">
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={5}
                value={maxDepth}
                onChange={(e) => setMaxDepth(Number(e.target.value))}
                className="w-20 h-10 px-3 rounded-lg"
              />
              <label className="self-center text-sm">depth</label>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                min={10}
                max={1000}
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
                className="w-28 h-10 px-3 rounded-lg"
              />
              <label className="self-center text-sm">max pages</label>
            </div>

            <div className="ml-auto flex gap-2">
              {loading ? (
                <Button
                  onClick={handleAbort}
                  className="bg-[#e11d48] hover:bg-[#be123c]"
                >
                  Abort
                </Button>
              ) : (
                <Button
                  onClick={handleStart}
                  className="bg-[#0f172a] hover:bg-[#1e293b] text-white"
                >
                  {loading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Mail className="mr-2" />
                  )}
                  Start Crawl
                </Button>
              )}
              <Button onClick={copyAllEmails} disabled={emails.length === 0}>
                <Copy className="mr-2" />
                Copy All
              </Button>
            </div>
          </div>

          {/* Progress Bar + Always-Visible Percentage */}
          <div className="relative w-full bg-[#fefcf7] rounded-full h-5 mt-4 shadow-inner overflow-hidden">
            {/* Progress Fill */}
            <div
              className="h-5 bg-[#00030a] rounded-full transition-all duration-500 ease-in-out"
              style={{ width: `${progressPct}%` }}
            />

            {/* Percentage Text - always visible */}
            <div
              className="absolute inset-0 flex items-center justify-center text-sm font-semibold z-10"
              style={{
                color: "#ffffff",
                textShadow: "0 0 3px #000, 0 0 3px #000",
              }}
            >
              {progressPct.toFixed(0)}%
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-2xl p-4 shadow max-h-[40rem] overflow-auto">
            <h3 className="font-semibold mb-2">
              Found Emails ({emails.length})
            </h3>
            {emails.length === 0 ? (
              <div className="text-sm text-[#555]">
                No emails yet — start a crawl.
              </div>
            ) : (
              <div className="space-y-2">
                {emails.map((e) => (
                  <div
                    key={e}
                    className="p-2 bg-[#f8fafc] rounded border border-gray-200"
                  >
                    <code className="text-sm font-mono text-[#111]">{e}</code>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl p-4 shadow max-h-[40rem] overflow-auto">
            <h3 className="font-semibold mb-2">Logs</h3>
            <div className="text-xs text-[#333] space-y-2">
              {logs.length === 0 ? (
                <div className="text-sm text-[#666]">
                  Logs will appear here...
                </div>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className="text-xs text-[#111]">
                    {l}
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 text-xs text-[#666]">
              <AlertCircle className="inline-block mr-2" />
              Note: Some sites hide emails behind JavaScript or block proxies.
              Try smaller limits if many errors appear.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export default Index;
