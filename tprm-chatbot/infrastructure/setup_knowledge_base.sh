#!/bin/bash
# =============================================================================
# TPRM Chatbot – Bedrock Knowledge Base Setup
#
# Run ONCE after the first SAM deploy.
# Creates:
#   1. IAM role for Bedrock KB to read S3 and call Titan Embeddings
#   2. Amazon Bedrock Knowledge Base (vector store = OpenSearch Serverless,
#      embedding model = amazon.titan-embed-text-v2:0)
#   3. S3 Data Source pointing at the Documents bucket
#
# Then updates the Lambda environment variables with the new KB ID + DS ID.
# =============================================================================
set -euo pipefail

: "${AWS_REGION:?AWS_REGION must be set (e.g. us-east-1)}"
: "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID must be set}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
STACK_NAME="tprm-chatbot-${ENVIRONMENT}"

echo "============================================"
echo " TPRM Bedrock Knowledge Base Setup"
echo " Stack:   $STACK_NAME"
echo " Region:  $AWS_REGION"
echo " Env:     $ENVIRONMENT"
echo "============================================"

# ── Fetch Documents bucket name from CloudFormation ──────────────────────────
DOCUMENTS_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DocumentsBucketName'].OutputValue" \
  --output text)

echo "Documents bucket: $DOCUMENTS_BUCKET"

# ── 1. Create IAM role for Bedrock Knowledge Base ─────────────────────────────
KB_ROLE_NAME="tprm-bedrock-kb-role-${ENVIRONMENT}"
echo ""
echo "[1/4] Creating IAM role: $KB_ROLE_NAME"

TRUST_POLICY='{
  "Version":"2012-10-17",
  "Statement":[{
    "Effect":"Allow",
    "Principal":{"Service":"bedrock.amazonaws.com"},
    "Action":"sts:AssumeRole",
    "Condition":{
      "StringEquals":{"aws:SourceAccount":"'"$AWS_ACCOUNT_ID"'"},
      "ArnLike":{"aws:SourceArn":"arn:aws:bedrock:'"$AWS_REGION"':'"$AWS_ACCOUNT_ID"':knowledge-base/*"}
    }
  }]
}'

# Create role (ignore error if it already exists)
aws iam create-role \
  --role-name "$KB_ROLE_NAME" \
  --assume-role-policy-document "$TRUST_POLICY" \
  --description "Bedrock KB role for TPRM chatbot" \
  --region "$AWS_REGION" 2>/dev/null || echo "  (role already exists, continuing)"

KB_ROLE_ARN=$(aws iam get-role --role-name "$KB_ROLE_NAME" \
  --query "Role.Arn" --output text)

# Attach S3 read policy
aws iam put-role-policy \
  --role-name "$KB_ROLE_NAME" \
  --policy-name "S3ReadDocuments" \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":["s3:GetObject","s3:ListBucket"],
      "Resource":[
        "arn:aws:s3:::'"$DOCUMENTS_BUCKET"'",
        "arn:aws:s3:::'"$DOCUMENTS_BUCKET"'/*"
      ]
    }]
  }'

# Attach Bedrock model invocation policy
aws iam put-role-policy \
  --role-name "$KB_ROLE_NAME" \
  --policy-name "BedrockEmbeddings" \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":["bedrock:InvokeModel"],
      "Resource":"arn:aws:bedrock:'"$AWS_REGION"'::foundation-model/amazon.titan-embed-text-v2:0"
    }]
  }'

echo "  IAM role ARN: $KB_ROLE_ARN"
echo "  Waiting 10 seconds for IAM role to propagate..."
sleep 10

# ── 2. Create Bedrock Knowledge Base ─────────────────────────────────────────
KB_NAME="tprm-chatbot-kb-${ENVIRONMENT}"
echo ""
echo "[2/4] Creating Bedrock Knowledge Base: $KB_NAME"

KB_RESPONSE=$(aws bedrock-agent create-knowledge-base \
  --region "$AWS_REGION" \
  --name "$KB_NAME" \
  --description "TPRM chatbot knowledge base – SOC2, VAPT, policies, questionnaires" \
  --role-arn "$KB_ROLE_ARN" \
  --knowledge-base-configuration '{
    "type":"VECTOR",
    "vectorKnowledgeBaseConfiguration":{
      "embeddingModelArn":"arn:aws:bedrock:'"$AWS_REGION"'::foundation-model/amazon.titan-embed-text-v2:0"
    }
  }' \
  --storage-configuration '{
    "type":"OPENSEARCH_SERVERLESS",
    "opensearchServerlessConfiguration":{
      "collectionArn":"",
      "vectorIndexName":"tprm-kb-index",
      "fieldMapping":{
        "vectorField":"embedding",
        "textField":"text",
        "metadataField":"metadata"
      }
    }
  }' 2>/dev/null || true)

# NOTE: If OpenSearch Serverless collection needs to be created first,
# Bedrock Console is the easiest path. See note below for alternative CLI steps.

# Try to get KB ID from a pre-existing KB with this name if creation failed
KB_ID=$(aws bedrock-agent list-knowledge-bases --region "$AWS_REGION" \
  --query "knowledgeBaseSummaries[?name=='$KB_NAME'].knowledgeBaseId" \
  --output text | head -1)

if [ -z "$KB_ID" ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  MANUAL STEP REQUIRED                                        ║"
  echo "║                                                              ║"
  echo "║  Bedrock Knowledge Base with OpenSearch Serverless requires  ║"
  echo "║  an OSS collection. The easiest path:                        ║"
  echo "║                                                              ║"
  echo "║  1. Open AWS Console → Amazon Bedrock → Knowledge bases      ║"
  echo "║  2. Click 'Create knowledge base'                            ║"
  echo "║  3. Name: tprm-chatbot-kb-${ENVIRONMENT}                         ║"
  echo "║  4. IAM role: $KB_ROLE_NAME"
  echo "║  5. Embedding: Titan Text Embeddings v2                      ║"
  echo "║  6. Vector store: Amazon OpenSearch Serverless (new)         ║"
  echo "║  7. Data source: S3 bucket = $DOCUMENTS_BUCKET"
  echo "║  8. Copy the Knowledge Base ID and Data Source ID below:     ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  read -r -p "Enter Knowledge Base ID: " KB_ID
  read -r -p "Enter Data Source ID:    " DS_ID
else
  echo "  Knowledge Base ID: $KB_ID"

  # ── 3. Create S3 Data Source ───────────────────────────────────────────────
  DS_NAME="tprm-s3-docs-${ENVIRONMENT}"
  echo ""
  echo "[3/4] Creating S3 Data Source: $DS_NAME"

  DS_RESPONSE=$(aws bedrock-agent create-data-source \
    --region "$AWS_REGION" \
    --knowledge-base-id "$KB_ID" \
    --name "$DS_NAME" \
    --description "Documents bucket: SOC2, VAPT, policies, questionnaires" \
    --data-source-configuration '{
      "type":"S3",
      "s3Configuration":{
        "bucketArn":"arn:aws:s3:::'"$DOCUMENTS_BUCKET"'",
        "inclusionPrefixes":["soc2/","vapt/","policies/","questionnaires/","compliance/","other/"]
      }
    }' \
    --vector-ingestion-configuration '{
      "chunkingConfiguration":{
        "chunkingStrategy":"HIERARCHICAL",
        "hierarchicalChunkingConfiguration":{
          "levelConfigurations":[
            {"maxTokens":1500},
            {"maxTokens":300}
          ],
          "overlapTokens":60
        }
      }
    }')

  DS_ID=$(echo "$DS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['dataSource']['dataSourceId'])")
  echo "  Data Source ID: $DS_ID"
fi

# ── 4. Update Lambda environment variables ────────────────────────────────────
echo ""
echo "[4/4] Updating Lambda environment variables with KB ID and DS ID..."

CHAT_FUNCTION="tprm-chatbot-chat-${ENVIRONMENT}"
INGEST_FUNCTION="tprm-chatbot-ingest-${ENVIRONMENT}"

update_lambda_env() {
  local fn="$1"
  local current
  current=$(aws lambda get-function-configuration \
    --function-name "$fn" --region "$AWS_REGION" \
    --query "Environment.Variables" --output json)

  # Merge new values into existing env
  local updated
  updated=$(echo "$current" | python3 -c "
import sys, json
env = json.load(sys.stdin)
env['KNOWLEDGE_BASE_ID'] = '$KB_ID'
env['DATA_SOURCE_ID']    = '$DS_ID'
print(json.dumps({'Variables': env}))
")
  aws lambda update-function-configuration \
    --function-name "$fn" \
    --region "$AWS_REGION" \
    --environment "$updated" > /dev/null
  echo "  Updated: $fn"
}

update_lambda_env "$CHAT_FUNCTION"
update_lambda_env "$INGEST_FUNCTION"

# ── 5. Run first ingestion (if bucket already has docs) ───────────────────────
echo ""
echo "Triggering initial ingestion job..."
aws bedrock-agent start-ingestion-job \
  --region "$AWS_REGION" \
  --knowledge-base-id "$KB_ID" \
  --data-source-id "$DS_ID" \
  --description "Initial sync" > /dev/null || echo "  (no docs yet or job already running)"

echo ""
echo "============================================"
echo " Knowledge Base setup complete!"
echo ""
echo " KB ID:        $KB_ID"
echo " Data Source:  $DS_ID"
echo " Docs bucket:  $DOCUMENTS_BUCKET"
echo ""
echo " Next steps:"
echo "  1. Upload your SOC2/VAPT/policy docs via the chatbot UI"
echo "     or: aws s3 cp your-doc.pdf s3://$DOCUMENTS_BUCKET/soc2/"
echo "  2. Ingestion runs automatically on every upload (~1-5 min)"
echo "  3. Open the frontend and start asking questions!"
echo "============================================"
