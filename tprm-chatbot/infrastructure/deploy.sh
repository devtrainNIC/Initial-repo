#!/bin/bash
# Deploy TPRM Chatbot infrastructure using AWS SAM
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Required environment variables ────────────────────────────────────────────
: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY must be set}"
: "${AWS_REGION:?AWS_REGION must be set (e.g. us-east-1)}"
: "${SAM_S3_BUCKET:?SAM_S3_BUCKET must be set (S3 bucket for SAM artifacts)}"

ENVIRONMENT="${ENVIRONMENT:-prod}"
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-*}"
STACK_NAME="tprm-chatbot-${ENVIRONMENT}"

echo "============================================"
echo " TPRM Chatbot Deploy"
echo " Stack:       $STACK_NAME"
echo " Region:      $AWS_REGION"
echo " Environment: $ENVIRONMENT"
echo "============================================"
echo ""

# ── Step 1: Build Lambda deployment package ────────────────────────────────────
echo "[1/4] Building Lambda package..."
bash "$REPO_ROOT/backend/build_layer.sh"

# ── Step 2: SAM build ─────────────────────────────────────────────────────────
echo "[2/4] Running sam build..."
sam build \
  --template-file "$SCRIPT_DIR/template.yaml" \
  --build-dir "$SCRIPT_DIR/.aws-sam/build"

# ── Step 3: SAM deploy ────────────────────────────────────────────────────────
echo "[3/4] Deploying stack: $STACK_NAME..."
sam deploy \
  --template-file "$SCRIPT_DIR/.aws-sam/build/template.yaml" \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --s3-bucket "$SAM_S3_BUCKET" \
  --s3-prefix "tprm-chatbot" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "Environment=$ENVIRONMENT" \
    "AnthropicApiKey=$ANTHROPIC_API_KEY" \
    "AllowedOrigin=$ALLOWED_ORIGIN" \
  --no-fail-on-empty-changeset

# ── Step 4: Get outputs & deploy frontend ────────────────────────────────────
echo "[4/4] Deploying frontend to S3..."

API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text)

FRONTEND_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text)

FRONTEND_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendWebsiteURL'].OutputValue" \
  --output text)

# Sync frontend files to S3
aws s3 sync "$REPO_ROOT/frontend/" "s3://$FRONTEND_BUCKET/" \
  --delete \
  --cache-control "max-age=86400" \
  --exclude "*.DS_Store"

# index.html should not be cached aggressively
aws s3 cp "$REPO_ROOT/frontend/index.html" "s3://$FRONTEND_BUCKET/index.html" \
  --cache-control "no-cache"

echo ""
echo "============================================"
echo " Deployment complete!"
echo ""
echo " API Endpoint:   $API_ENDPOINT"
echo " Frontend URL:   $FRONTEND_URL"
echo ""
echo " Next: Open the frontend URL and set the"
echo "       API Endpoint in the sidebar config."
echo "============================================"
