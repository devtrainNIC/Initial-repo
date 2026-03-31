#!/bin/bash
# =============================================================================
# TPRM Chatbot – Full deploy (infrastructure + frontend)
#
# Usage:
#   export ANTHROPIC_API_KEY="sk-ant-..."
#   export AWS_REGION="us-east-1"
#   export SAM_S3_BUCKET="my-sam-artifacts-bucket"  # must already exist
#   export ENVIRONMENT="prod"                         # dev|staging|prod  (default: prod)
#   export ALLOWED_ORIGIN="*"                         # restrict in production
#   export KNOWLEDGE_BASE_ID=""                       # leave empty on first deploy
#   export DATA_SOURCE_ID=""                          # leave empty on first deploy
#
#   ./deploy.sh
#
# After first deploy, run setup_knowledge_base.sh to create the Bedrock KB,
# then redeploy or update Lambda env vars directly.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY must be set}"
: "${AWS_REGION:?AWS_REGION must be set}"
: "${SAM_S3_BUCKET:?SAM_S3_BUCKET must be set}"

ENVIRONMENT="${ENVIRONMENT:-prod}"
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-*}"
KNOWLEDGE_BASE_ID="${KNOWLEDGE_BASE_ID:-}"
DATA_SOURCE_ID="${DATA_SOURCE_ID:-}"
STACK_NAME="tprm-chatbot-${ENVIRONMENT}"

echo "============================================"
echo " TPRM Chatbot Deploy"
echo " Stack:       $STACK_NAME"
echo " Region:      $AWS_REGION"
echo " Environment: $ENVIRONMENT"
echo " KB ID:       ${KNOWLEDGE_BASE_ID:-<not configured yet>}"
echo "============================================"

# ── Step 1: SAM build ─────────────────────────────────────────────────────────
echo ""
echo "[1/4] Running sam build..."
sam build \
  --template-file "$SCRIPT_DIR/template.yaml" \
  --build-dir     "$SCRIPT_DIR/.aws-sam/build" \
  --use-container false

# ── Step 2: SAM deploy ────────────────────────────────────────────────────────
echo ""
echo "[2/4] Deploying stack: $STACK_NAME..."
sam deploy \
  --template-file "$SCRIPT_DIR/.aws-sam/build/template.yaml" \
  --stack-name    "$STACK_NAME" \
  --region        "$AWS_REGION" \
  --s3-bucket     "$SAM_S3_BUCKET" \
  --s3-prefix     "tprm-chatbot" \
  --capabilities  CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    "Environment=$ENVIRONMENT" \
    "AnthropicApiKey=$ANTHROPIC_API_KEY" \
    "AllowedOrigin=$ALLOWED_ORIGIN" \
    "KnowledgeBaseId=$KNOWLEDGE_BASE_ID" \
    "DataSourceId=$DATA_SOURCE_ID" \
  --no-fail-on-empty-changeset

# ── Step 3: Gather outputs ────────────────────────────────────────────────────
echo ""
echo "[3/4] Fetching stack outputs..."

get_output() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text
}

CHAT_ENDPOINT=$(get_output "ChatApiEndpoint")
UPLOAD_ENDPOINT=$(get_output "UploadApiEndpoint")
DOCS_ENDPOINT=$(get_output "DocumentsApiEndpoint")
DOCUMENTS_BUCKET=$(get_output "DocumentsBucketName")
FRONTEND_BUCKET=$(get_output "FrontendBucketName")
FRONTEND_URL=$(get_output "FrontendWebsiteURL")

# Derive base URL (strip /chat from end)
API_BASE="${CHAT_ENDPOINT%/chat}"

# ── Step 4: Deploy frontend to S3 ────────────────────────────────────────────
echo ""
echo "[4/4] Deploying frontend to S3 bucket: $FRONTEND_BUCKET..."
aws s3 sync "$REPO_ROOT/frontend/" "s3://$FRONTEND_BUCKET/" \
  --delete \
  --cache-control "max-age=86400" \
  --exclude "*.DS_Store"

# index.html – no cache so config changes are picked up immediately
aws s3 cp "$REPO_ROOT/frontend/index.html" "s3://$FRONTEND_BUCKET/index.html" \
  --cache-control "no-cache"

echo ""
echo "============================================"
echo " Deploy complete!"
echo ""
echo " Frontend URL:      $FRONTEND_URL"
echo " API Base URL:      $API_BASE"
echo ""
echo " Endpoints:"
echo "   POST   $CHAT_ENDPOINT"
echo "   GET    $UPLOAD_ENDPOINT?filename=soc2.pdf&content_type=application/pdf"
echo "   GET    $DOCS_ENDPOINT"
echo "   DELETE $DOCS_ENDPOINT?key=soc2/soc2.pdf"
echo ""
echo " Documents bucket: $DOCUMENTS_BUCKET"
echo ""
if [ -z "$KNOWLEDGE_BASE_ID" ]; then
  echo " ⚠  Knowledge Base not configured yet."
  echo "    Run: ./setup_knowledge_base.sh"
  echo "    to create the Bedrock KB and enable document-grounded answers."
fi
echo ""
echo " Open $FRONTEND_URL, set API Base URL in the sidebar,"
echo " then upload your SOC2/VAPT/policy documents."
echo "============================================"
