"""
TPRM Chatbot – Bedrock Knowledge Base Ingestion Trigger Lambda

Triggered by S3 ObjectCreated and ObjectRemoved events on the Documents bucket.
Starts a Bedrock Knowledge Base ingestion job to re-index the updated content.

Why a separate Lambda?
  Ingestion jobs can take minutes; keeping this separate from the chat Lambda
  ensures users still get fast chat responses while the KB is being updated.
"""

import json
import os
import logging
import boto3
import uuid
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

KB_ID          = os.environ.get("KNOWLEDGE_BASE_ID", "")
DATA_SOURCE_ID = os.environ.get("DATA_SOURCE_ID", "")


def lambda_handler(event: dict, context) -> dict:
    if not KB_ID or not DATA_SOURCE_ID:
        logger.warning(
            "KNOWLEDGE_BASE_ID or DATA_SOURCE_ID not set – skipping ingestion. "
            "Run setup_knowledge_base.sh to configure."
        )
        return {"statusCode": 200, "body": "KB not configured, skipping."}

    # Log which objects triggered this
    for record in event.get("Records", []):
        bucket = record.get("s3", {}).get("bucket", {}).get("name", "?")
        key    = record.get("s3", {}).get("object", {}).get("key", "?")
        ev     = record.get("eventName", "?")
        logger.info("S3 event: %s  s3://%s/%s", ev, bucket, key)

    # Start (or re-use) an ingestion job – Bedrock only allows one running job
    # at a time per data source, so we catch the conflict and log it.
    try:
        client = boto3.client("bedrock-agent")
        response = client.start_ingestion_job(
            knowledgeBaseId=KB_ID,
            dataSourceId=DATA_SOURCE_ID,
            clientToken=str(uuid.uuid4()),   # idempotency key
            description="Auto-triggered by S3 document upload/delete",
        )
        job = response.get("ingestionJob", {})
        logger.info(
            "Ingestion job started: id=%s status=%s",
            job.get("ingestionJobId"), job.get("status"),
        )
        return {
            "statusCode": 200,
            "body": json.dumps({
                "jobId":  job.get("ingestionJobId"),
                "status": job.get("status"),
            }),
        }
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code == "ConflictException":
            # Another ingestion job is already running; it will pick up the new file
            logger.info("Ingestion job already running – will pick up latest changes.")
            return {"statusCode": 200, "body": "Ingestion already running."}
        logger.error("Failed to start ingestion job: %s", e)
        raise
