#!/bin/bash
# Tear down the TPRM Chatbot stack and empty the S3 bucket first
set -euo pipefail

: "${AWS_REGION:?AWS_REGION must be set}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
STACK_NAME="tprm-chatbot-${ENVIRONMENT}"

echo "WARNING: This will delete stack '$STACK_NAME' and all its resources."
read -r -p "Type the stack name to confirm: " CONFIRM

if [ "$CONFIRM" != "$STACK_NAME" ]; then
  echo "Aborted."
  exit 1
fi

# Empty the S3 bucket before deletion (CloudFormation can't delete non-empty buckets)
FRONTEND_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text 2>/dev/null || echo "")

if [ -n "$FRONTEND_BUCKET" ]; then
  echo "Emptying S3 bucket: $FRONTEND_BUCKET"
  aws s3 rm "s3://$FRONTEND_BUCKET" --recursive
fi

echo "Deleting stack: $STACK_NAME"
aws cloudformation delete-stack \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION"

aws cloudformation wait stack-delete-complete \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION"

echo "Stack deleted."
