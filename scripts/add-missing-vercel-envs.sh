#!/bin/bash
# Run this from the ruhrohhalp project root to add missing Vercel env vars.
# Requires: vercel CLI authenticated (run `vercel login` first if needed)
# Usage: bash scripts/add-missing-vercel-envs.sh

set -e

echo "Adding missing Vercel environment variables..."
echo "Reading values from .env.local..."

# Source the .env.local to get values
source .env.local

# Function to add a var if it doesn't exist
add_var() {
  local name="$1"
  local value="$2"
  echo "  Adding $name..."
  echo "$value" | vercel env add "$name" production preview development --force 2>/dev/null || \
  echo "$value" | vercel env add "$name" production preview development 2>/dev/null || \
  echo "  ⚠️  Failed to add $name (may already exist)"
}

add_var "CRON_SECRET" "$CRON_SECRET"
add_var "NEXT_PUBLIC_SUPABASE_URL" "$NEXT_PUBLIC_SUPABASE_URL"
add_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$NEXT_PUBLIC_SUPABASE_ANON_KEY"
add_var "SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY"
add_var "ANTHROPIC_API_KEY" "$ANTHROPIC_API_KEY"
add_var "OPENAI_API_KEY" "$OPENAI_API_KEY"
add_var "HF_API_TOKEN" "$HF_API_TOKEN"
add_var "THREADS_APP_ID" "$THREADS_APP_ID"
# THREADS_APP_SECRET - already added via Vercel UI
# GOOGLE_CLIENT_SECRET - already added via Vercel UI
# RUHROHHALP_SECRET - already added via Vercel UI

echo ""
echo "Done! Verify at: https://vercel.com/tyoung75s-projects/ruhrohhalp/settings/environment-variables"
echo ""
echo "NOTE: You also need GROQ_API_KEY for Llama 4 Scout brand voice audit."
echo "Get one at https://console.groq.com and add it manually."
