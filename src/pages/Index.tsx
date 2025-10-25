import { useState } from "react";
import { Mail, Loader2, Copy, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const Index = () => {
  const [url, setUrl] = useState("");
  const [emails, setEmails] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const extractEmails = async () => {
    if (!url.trim()) {
      toast({
        title: "URL Required",
        description: "Please enter a website URL to extract emails from.",
        variant: "destructive",
      });
      return;
    }

    // Validate URL format
    try {
      new URL(url.startsWith("http") ? url : `https://${url}`);
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid website URL.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setEmails([]);

    try {
      const fullUrl = url.startsWith("http") ? url : `https://${url}`;
      const response = await fetch(fullUrl, {
        mode: "cors",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch website content");
      }

      const html = await response.text();
      const emailMatches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g);

      if (emailMatches && emailMatches.length > 0) {
        // Remove duplicates
        const uniqueEmails = Array.from(new Set(emailMatches));
        setEmails(uniqueEmails);
        toast({
          title: "Success!",
          description: `Found ${uniqueEmails.length} email address${uniqueEmails.length > 1 ? "es" : ""}.`,
        });
      } else {
        setEmails([]);
        toast({
          title: "No Emails Found",
          description: "No email addresses found on this page.",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Unable to fetch content. The website may block CORS requests.",
        variant: "destructive",
      });
      setEmails([]);
    } finally {
      setLoading(false);
    }
  };

  const copyAllEmails = () => {
    if (emails.length === 0) return;

    const emailText = emails.join("\n");
    navigator.clipboard.writeText(emailText);
    toast({
      title: "Copied!",
      description: `${emails.length} email${emails.length > 1 ? "s" : ""} copied to clipboard.`,
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      extractEmails();
    }
  };

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        {/* Header Section */}
        <header className="text-center mb-12">
          <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6">
            Email Extractor From Website
          </h1>
          <p className="text-lg md:text-xl text-foreground/90 max-w-3xl mx-auto leading-relaxed">
            Extract all email addresses from any website in seconds — fast, free, and effortless.
          </p>
        </header>

        {/* Input Section */}
        <section className="mb-8 space-y-6">
          <Input
            type="text"
            placeholder="Enter website URL..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyPress={handleKeyPress}
            className="w-full h-14 px-6 text-lg bg-[hsl(var(--input-bg))] text-[hsl(var(--input-text))] border-none rounded-2xl shadow-md focus-visible:ring-2 focus-visible:ring-primary placeholder:text-muted-foreground"
          />

          <div className="flex justify-center">
            <Button
              onClick={extractEmails}
              disabled={loading}
              className="h-14 px-8 text-lg font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl shadow-lg transition-all duration-200 hover:shadow-xl"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Extracting...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-5 w-5" />
                  Extract Emails
                </>
              )}
            </Button>
          </div>
        </section>

        {/* Results Section */}
        {emails.length > 0 && (
          <section className="bg-card rounded-2xl shadow-2xl p-8 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-card-foreground">
                Found {emails.length} Email{emails.length > 1 ? "s" : ""}
              </h2>
              <Button
                onClick={copyAllEmails}
                variant="outline"
                className="flex items-center gap-2 border-2 hover:bg-primary hover:text-primary-foreground hover:border-primary"
              >
                <Copy className="h-4 w-4" />
                Copy All
              </Button>
            </div>
            <div className="max-h-96 overflow-y-auto space-y-2 bg-muted/30 rounded-xl p-4">
              {emails.map((email, index) => (
                <div
                  key={index}
                  className="p-3 bg-card rounded-lg border border-border hover:border-primary transition-colors"
                >
                  <code className="text-sm text-card-foreground font-mono">{email}</code>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Warning Notice */}
        <footer className="flex items-start gap-3 text-foreground/80 bg-foreground/5 rounded-xl p-4 max-w-2xl mx-auto">
          <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm leading-relaxed">
            <strong>Note:</strong> Some websites may block content fetching due to CORS restrictions. 
            This tool works best with websites that allow cross-origin requests.
          </p>
        </footer>
      </div>
    </main>
  );
};

export default Index;
