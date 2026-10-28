#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# คมคิด by KOMKRIT (KOMKID BY KOMKRIT) — 1-Command Google Cloud Run Deploy Script
# Usage:
#   ./deploy-cloudrun.sh [GCP_PROJECT_ID] [GCP_REGION]
# Example:
#   ./deploy-cloudrun.sh dotmini-central asia-southeast1
# ==============================================================================

PROJECT_ID="${1:-$(gcloud config get-value project 2>/dev/null || echo "")}"
REGION="${2:-asia-southeast1}"
SERVICE_NAME="komkid-aiflow"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "❌ Error: กรุณาระบุ GCP_PROJECT_ID เช่น ./deploy-cloudrun.sh my-gcp-project asia-southeast1"
  exit 1
fi

echo "🚀 Deploying '${SERVICE_NAME}' to Google Cloud Run..."
echo "   • Project : ${PROJECT_ID}"
echo "   • Region  : ${REGION}"

echo "1/2 Enabling required Google Cloud APIs (Cloud Run, Cloud Build, Artifact Registry, Vertex AI)..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  --project="${PROJECT_ID}" \
  --quiet

echo "2/2 Building container (Node 22 + FFmpeg + SQLite) & deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --platform=managed \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=2 \
  --timeout=300 \
  --max-instances=1 \
  --session-affinity \
  --set-env-vars="NODE_ENV=production,VERTEX_PROJECT_ID=${PROJECT_ID},VERTEX_LOCATION=us-central1" \
  --quiet

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.url)')"
echo ""
echo "✅ Google Cloud Run Deployment Complete!"
echo "🌐 Live URL: ${SERVICE_URL}"
