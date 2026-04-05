"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import { C } from "@/lib/ui";
import { useMobile } from "@/lib/useMobile";
import { Spinner } from "@/components/primitives";

type BrandScoutMode = "scout" | "pipeline";
type Provider = "chatgpt" | "claude";

interface CreatorAudienceSnapshot {
  platform: string;
  handle: string | null;
  followers: number;
  engagementRate: number | null;
  avgImpressionsPerPost: number | null;
}

interface CreatorBrandProfile {
  creatorName: string;
  creatorTier: string;
  totalFollowers: number;
  platforms: CreatorAudienceSnapshot[];
  niches: string[];
  positioning: string;
}

interface BrandScoutSource {
  url: string;
  title?: string;
  note?: string;
}

interface BrandScoutOpportunity {
  id: string;
  brand: string;
  category: string;
  whyMatch: string;
  partnershipEvidence: string;
  recommendedAngle: string;
  dealLikelihoodScore: number;
  creatorFitScore: number;
  contactMethodType: string;
  contactMethodValue: string;
  contactMethodUrl: string;
  contactValidated: boolean;
  validationNote: string;
  sources: BrandScoutSource[];
  providers: Provider[];
}

interface ScoutProviderResponse {
  provider: Provider;
  model: string;
  searched: boolean;
  results: BrandScoutOpportunity[];
  error?: string;
}

interface BrandScoutResponse {
  mode: BrandScoutMode;
  searchedAt: string;
  profile: CreatorBrandProfile;
  scout: {
    chatgpt: ScoutProviderResponse;
    claude: ScoutProviderResponse;
  };
  combinedTop: BrandScoutOpportunity[];
}

const PROVIDER_META: Record<Provider, { label: string; icon: string; color: string }> = {
  chatgpt: { label: "ChatGPT", icon: "◇", color: C.gpt },
  claude: { label: "Claude", icon: "◆", color: C.cl },
};

export function BrandScoutPanel() {
  const isMobile = useMobile();
  const [data, setData] = useState<BrandScoutResponse | null>(null);
  const [loadingMode, setLoadingMode] = useState<BrandScoutMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(mode: BrandScoutMode) {
    setLoadingMode(mode);
    setError(null);
    try {
      const result = await api<BrandScoutResponse>("/api/creator/brand-scout", {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Brand scout failed");
    } finally {
      setLoadingMode(null);
    }
  }

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 20,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textFaint, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 }}>
            Brand Search Pipeline
          </div>
          <div style={{ fontFamily: C.serif, fontSize: 18, color: C.cream, fontStyle: "italic", marginBottom: 6 }}>
            Live sponsor scouting
          </div>
          <div style={{ fontFamily: C.sans, fontSize: 12, color: C.textDim, maxWidth: 760, lineHeight: 1.5 }}>
            Searches the live web through both ChatGPT and Claude, filters for brands that fit your niche and size, and only keeps results with a public contact path that the backend can reach right now.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => run("scout")}
            disabled={loadingMode !== null}
            style={actionButton(C.gem, loadingMode !== null)}
          >
            {loadingMode === "scout" ? <><Spinner size={10} color={C.gem} /> Scouting...</> : "Scout Brands"}
          </button>
          <button
            onClick={() => run("pipeline")}
            disabled={loadingMode !== null}
            style={actionButton(C.cl, loadingMode !== null, true)}
          >
            {loadingMode === "pipeline" ? <><Spinner size={10} color="#0f1117" /> Running...</> : "Run Brand Pipeline"}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 8,
            background: `${C.reminder}14`,
            border: `1px solid ${C.reminder}30`,
            color: C.reminder,
            fontFamily: C.mono,
            fontSize: 11,
          }}
        >
          {error}
        </div>
      )}

      {data && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <Chip label={data.profile.creatorTier} color={C.text} />
            <Chip label={`${data.profile.totalFollowers.toLocaleString()} total followers`} color={C.cream} />
            {data.profile.platforms.slice(0, 4).map((platform) => (
              <Chip
                key={platform.platform}
                label={`${platform.platform}${platform.handle ? ` @${platform.handle}` : ""}`}
                color={PROVIDER_META.chatgpt.color}
              />
            ))}
          </div>

          <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim, marginTop: 10 }}>
            Last search: {new Date(data.searchedAt).toLocaleString()}
          </div>

          {data.combinedTop.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={sectionLabelStyle}>Most Likely Deals</div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 10 }}>
                {data.combinedTop.map((result) => (
                  <ResultCard key={`combined-${result.id}`} result={result} highlight />
                ))}
              </div>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: 12,
              marginTop: 18,
            }}
          >
            <ProviderColumn provider={data.scout.chatgpt} />
            <ProviderColumn provider={data.scout.claude} />
          </div>
        </>
      )}
    </div>
  );
}

function ProviderColumn({ provider }: { provider: ScoutProviderResponse }) {
  const meta = PROVIDER_META[provider.provider];
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${provider.error ? `${C.reminder}30` : `${meta.color}25`}`,
        borderRadius: 8,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: meta.color, fontSize: 14 }}>{meta.icon}</span>
          <div>
            <div style={{ fontFamily: C.sans, fontSize: 13, color: C.cream, fontWeight: 600 }}>
              {meta.label}
            </div>
            <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint }}>{provider.model}</div>
          </div>
        </div>
        <div style={{ ...pillStyle(provider.error ? C.reminder : meta.color), whiteSpace: "nowrap" }}>
          {provider.error ? "Provider error" : provider.searched ? "Live web" : "No search"}
        </div>
      </div>

      {provider.error ? (
        <div style={{ fontFamily: C.mono, fontSize: 10, color: C.reminder }}>{provider.error}</div>
      ) : provider.results.length === 0 ? (
        <div style={{ fontFamily: C.sans, fontSize: 12, color: C.textDim }}>
          No validated brand matches returned.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {provider.results.map((result) => (
            <ResultCard key={result.id} result={result} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({ result, highlight = false }: { result: BrandScoutOpportunity; highlight?: boolean }) {
  return (
    <div
      style={{
        background: highlight ? `${C.cardHov}` : C.card,
        border: `1px solid ${highlight ? `${C.gold}35` : C.border}`,
        borderRadius: 8,
        padding: "12px 14px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
        <div>
          <div style={{ fontFamily: C.sans, fontSize: 14, color: C.cream, fontWeight: 600, marginBottom: 2 }}>
            {result.brand}
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, textTransform: "uppercase" }}>
            {result.category}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <div style={pillStyle(C.gpt)}>deal {Math.round(result.dealLikelihoodScore)}</div>
          <div style={pillStyle(C.cl)}>fit {Math.round(result.creatorFitScore)}</div>
        </div>
      </div>

      <div style={bodyTextStyle}>{result.whyMatch}</div>

      <div style={{ marginTop: 10 }}>
        <div style={subLabelStyle}>Why it feels real</div>
        <div style={bodyTextStyle}>{result.partnershipEvidence}</div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={subLabelStyle}>Best angle</div>
        <div style={bodyTextStyle}>{result.recommendedAngle}</div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={subLabelStyle}>Validated contact path</div>
        <div style={{ fontFamily: C.sans, fontSize: 12, color: C.text, lineHeight: 1.5 }}>
          <strong>{result.contactMethodType}:</strong>{" "}
          <a
            href={result.contactMethodUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: C.cl, textDecoration: "none" }}
          >
            {result.contactMethodValue}
          </a>
        </div>
        <div style={{ fontFamily: C.mono, fontSize: 9, color: result.contactValidated ? C.gpt : C.reminder, marginTop: 4 }}>
          {result.validationNote}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={subLabelStyle}>Sources</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {result.sources.slice(0, 3).map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              style={{ color: C.note, fontFamily: C.sans, fontSize: 11, textDecoration: "none", lineHeight: 1.4 }}
            >
              {source.title ?? source.url}
            </a>
          ))}
        </div>
      </div>

      {result.providers.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {result.providers.map((provider) => (
            <Chip key={`${result.id}-${provider}`} label={PROVIDER_META[provider].label} color={PROVIDER_META[provider].color} />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return <div style={pillStyle(color)}>{label}</div>;
}

function actionButton(color: string, disabled: boolean, solid = false) {
  return {
    background: solid ? color : "transparent",
    border: solid ? "none" : `1px solid ${color}45`,
    color: solid ? "#0f1117" : color,
    padding: "8px 14px",
    borderRadius: 6,
    fontFamily: C.mono,
    fontSize: 10,
    fontWeight: 600,
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.6 : 1,
    display: "flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap" as const,
  };
}

function pillStyle(color: string) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 8px",
    borderRadius: 999,
    border: `1px solid ${color}33`,
    background: `${color}12`,
    color,
    fontFamily: C.mono,
    fontSize: 9,
    textTransform: "uppercase" as const,
  };
}

const sectionLabelStyle = {
  fontFamily: C.mono,
  fontSize: 10,
  color: C.textFaint,
  textTransform: "uppercase" as const,
  letterSpacing: 1.2,
  marginBottom: 8,
};

const subLabelStyle = {
  fontFamily: C.mono,
  fontSize: 9,
  color: C.textFaint,
  textTransform: "uppercase" as const,
  marginBottom: 4,
};

const bodyTextStyle = {
  fontFamily: C.sans,
  fontSize: 12,
  color: C.textDim,
  lineHeight: 1.5,
};
