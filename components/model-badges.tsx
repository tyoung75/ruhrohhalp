import { MODELS, PROVIDERS } from "@/lib/ai/registry";
import { C } from "@/lib/ui";

export function ModelBadge({ modelId }: { modelId: string }) {
  const model = MODELS[modelId];
  if (!model) return null;
  const provider = PROVIDERS[model.provider];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        fontFamily: C.mono,
        letterSpacing: 0.3,
        padding: "1px 8px",
        borderRadius: 4,
        background: `${provider.color}14`,
        color: provider.color,
        border: `1px solid ${provider.color}30`,
      }}
    >
      {provider.icon} {model.label}
    </span>
  );
}
