"""
TPRM Chatbot – Document Management Lambda

Endpoints (all require ?path=... or body fields):
  GET  /upload-url   ?filename=soc2.pdf&content_type=application/pdf
                     → returns a presigned POST URL for direct browser-to-S3 upload
  GET  /documents    → lists all uploaded documents with metadata
  DELETE /documents  ?key=soc2.pdf → deletes a document from S3

Supported file types (Bedrock KB ingests all of these):
  .pdf  .docx  .doc  .txt  .csv  .html  .md
"""

import json
import os
import logging
import urllib.parse
import boto3
from botocore.exceptions import ClientError
from datetime import datetime, timezone

logger = logging.getLogger()
logger.setLevel(logging.INFO)

DOCUMENTS_BUCKET = os.environ.get("DOCUMENTS_BUCKET", "")
ALLOWED_ORIGIN   = os.environ.get("ALLOWED_ORIGIN", "*")
MAX_UPLOAD_BYTES = 50 * 1024 * 1024   # 50 MB per file

ALLOWED_EXTENSIONS = {
    ".pdf":  "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc":  "application/msword",
    ".txt":  "text/plain",
    ".csv":  "text/csv",
    ".html": "text/html",
    ".htm":  "text/html",
    ".md":   "text/markdown",
}

FOLDER_MAP = {
    "soc": "soc2/",
    "soc2": "soc2/",
    "vapt": "vapt/",
    "pentest": "vapt/",
    "policy": "policies/",
    "policies": "policies/",
    "questionnaire": "questionnaires/",
    "q&a": "questionnaires/",
    "qa": "questionnaires/",
    "iso": "compliance/",
    "nist": "compliance/",
    "gdpr": "compliance/",
    "hipaa": "compliance/",
}


def cors_headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key",
        "Access-Control-Allow-Methods": "OPTIONS,GET,DELETE",
    }


def respond(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": cors_headers(), "body": json.dumps(body)}


def get_folder_prefix(filename: str) -> str:
    """Auto-categorize file into a folder based on its name."""
    lower = filename.lower()
    for keyword, folder in FOLDER_MAP.items():
        if keyword in lower:
            return folder
    return "other/"


def get_extension(filename: str) -> str:
    parts = filename.rsplit(".", 1)
    return ("." + parts[1].lower()) if len(parts) == 2 else ""


# ── Handler ───────────────────────────────────────────────────────────────────

def lambda_handler(event: dict, context) -> dict:
    method = event.get("httpMethod", "GET")

    if method == "OPTIONS":
        return respond(200, {"message": "OK"})

    path = event.get("path", "")

    if method == "GET" and path.endswith("/upload-url"):
        return handle_get_upload_url(event)

    if method == "GET" and path.endswith("/documents"):
        return handle_list_documents(event)

    if method == "DELETE" and path.endswith("/documents"):
        return handle_delete_document(event)

    return respond(404, {"error": "Not found"})


# ── GET /upload-url ───────────────────────────────────────────────────────────

def handle_get_upload_url(event: dict) -> dict:
    params   = event.get("queryStringParameters") or {}
    filename = params.get("filename", "").strip()
    ctype    = params.get("content_type", "").strip()

    if not filename:
        return respond(400, {"error": "'filename' query parameter is required"})

    ext = get_extension(filename)
    if ext not in ALLOWED_EXTENSIONS:
        return respond(400, {
            "error": f"File type '{ext}' not supported. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        })

    # Use content_type from query or infer from extension
    if not ctype:
        ctype = ALLOWED_EXTENSIONS[ext]

    # Build S3 key: auto-categorised folder + sanitised filename
    safe_name = "".join(c for c in filename if c.isalnum() or c in "._- ")
    folder    = get_folder_prefix(safe_name)
    s3_key    = f"{folder}{safe_name}"

    try:
        s3 = boto3.client("s3")
        presigned = s3.generate_presigned_post(
            Bucket=DOCUMENTS_BUCKET,
            Key=s3_key,
            Fields={"Content-Type": ctype},
            Conditions=[
                {"Content-Type": ctype},
                ["content-length-range", 1, MAX_UPLOAD_BYTES],
            ],
            ExpiresIn=300,   # 5 minutes
        )
        logger.info("Generated presigned URL for s3://%s/%s", DOCUMENTS_BUCKET, s3_key)
        return respond(200, {
            "url":    presigned["url"],
            "fields": presigned["fields"],
            "key":    s3_key,
            "folder": folder,
        })
    except ClientError as e:
        logger.error("Failed to generate presigned URL: %s", e)
        return respond(500, {"error": "Failed to generate upload URL"})


# ── GET /documents ────────────────────────────────────────────────────────────

def handle_list_documents(event: dict) -> dict:
    try:
        s3  = boto3.client("s3")
        paginator = s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=DOCUMENTS_BUCKET)

        documents = []
        for page in pages:
            for obj in page.get("Contents", []):
                key = obj["Key"]
                # Skip zero-byte "folder" markers
                if key.endswith("/"):
                    continue
                ext = get_extension(key.split("/")[-1])
                documents.append({
                    "key":           key,
                    "filename":      key.split("/")[-1],
                    "folder":        key.split("/")[0] if "/" in key else "other",
                    "size_bytes":    obj["Size"],
                    "size_human":    _human_size(obj["Size"]),
                    "last_modified": obj["LastModified"].astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                    "extension":     ext,
                })

        documents.sort(key=lambda d: d["last_modified"], reverse=True)
        logger.info("Listed %d documents in bucket", len(documents))
        return respond(200, {"documents": documents, "count": len(documents)})

    except ClientError as e:
        logger.error("Failed to list documents: %s", e)
        return respond(500, {"error": "Failed to list documents"})


# ── DELETE /documents ─────────────────────────────────────────────────────────

def handle_delete_document(event: dict) -> dict:
    params = event.get("queryStringParameters") or {}
    key    = params.get("key", "").strip()

    if not key:
        return respond(400, {"error": "'key' query parameter is required"})

    # Prevent path traversal
    if ".." in key or key.startswith("/"):
        return respond(400, {"error": "Invalid key"})

    try:
        s3 = boto3.client("s3")
        s3.delete_object(Bucket=DOCUMENTS_BUCKET, Key=key)
        logger.info("Deleted document: s3://%s/%s", DOCUMENTS_BUCKET, key)
        return respond(200, {"message": f"Deleted: {key}"})
    except ClientError as e:
        logger.error("Failed to delete document %s: %s", key, e)
        return respond(500, {"error": "Failed to delete document"})


# ── Utils ─────────────────────────────────────────────────────────────────────

def _human_size(num_bytes: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num_bytes < 1024:
            return f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024
    return f"{num_bytes:.1f} TB"
