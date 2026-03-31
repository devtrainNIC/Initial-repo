"""
TPRM Chatbot – AWS Lambda Handler (RAG-enabled)

Flow:
  1. Receive user messages
  2. If a Bedrock Knowledge Base is configured, retrieve relevant document chunks
  3. Inject retrieved context into the Claude prompt
  4. Return the grounded answer with source citations
"""

import json
import os
import logging
import boto3
import anthropic
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ANTHROPIC_API_KEY   = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL_ID            = "claude-sonnet-4-6"
MAX_TOKENS          = 2048
KB_ID               = os.environ.get("KNOWLEDGE_BASE_ID", "")   # set by setup_knowledge_base.sh
NUM_KB_RESULTS      = 5                                           # chunks to retrieve per query

SYSTEM_PROMPT_BASE = """You are a TPRM (Third-Party Risk Management) security expert assistant.
Your role is to help security teams, procurement teams, and risk officers answer questions related to:

- Third-party vendor risk assessments
- Security questionnaires (SIG, CAIQ, VSA, custom questionnaires)
- Vendor due diligence processes
- ISO 27001, SOC 2, NIST CSF, CIS Controls, PCI-DSS, HIPAA, GDPR compliance
- Supply chain risk management
- Vendor onboarding and offboarding security requirements
- Continuous monitoring of third-party vendors
- Risk scoring and tiering of vendors
- Contract security clauses and SLAs
- Incident response requirements for third parties
- Data handling and privacy requirements for vendors
- Cloud security assessment (shared responsibility model)
- Penetration testing requirements for vendors
- Business continuity and disaster recovery requirements

Provide clear, concise, accurate, and actionable answers. When referencing frameworks or standards,
cite the specific control or clause where relevant. Format responses with markdown for readability."""

SYSTEM_PROMPT_WITH_CONTEXT = SYSTEM_PROMPT_BASE + """

IMPORTANT: You have been provided with excerpts from the organization's own security documents
(SOC 2 reports, VAPT findings, policies, past security questionnaires, etc.) in the
<context> block below. When answering:
1. Prioritize information from <context> over general knowledge.
2. Cite the source document for each fact you draw from context (e.g. "per your SOC 2 report…").
3. If the context does not contain enough information to answer fully, say so and supplement
   with general TPRM best practices.
4. Never fabricate specific facts (control IDs, findings, dates) that aren't in the context."""

SYSTEM_PROMPT_NO_CONTEXT = SYSTEM_PROMPT_BASE + """

Note: No internal documents are currently loaded in the knowledge base.
Answer from general TPRM and security best practices."""


# ── Bedrock retrieval ─────────────────────────────────────────────────────────

def retrieve_context(question: str) -> list:
    """Query the Bedrock Knowledge Base and return the top-N relevant chunks."""
    try:
        client = boto3.client("bedrock-agent-runtime")
        response = client.retrieve(
            knowledgeBaseId=KB_ID,
            retrievalQuery={"text": question},
            retrievalConfiguration={
                "vectorSearchConfiguration": {"numberOfResults": NUM_KB_RESULTS}
            },
        )
        results = response.get("retrievalResults", [])
        logger.info("KB retrieve: %d chunks returned for query", len(results))
        return results
    except ClientError as e:
        logger.warning("Bedrock KB retrieve failed: %s", e)
        return []


def build_context_block(results: list) -> str:
    """Format retrieved chunks into a readable <context> block for Claude."""
    if not results:
        return ""
    parts = []
    for i, r in enumerate(results, 1):
        text   = r.get("content", {}).get("text", "").strip()
        uri    = r.get("location", {}).get("s3Location", {}).get("uri", "unknown")
        score  = r.get("score", 0.0)
        fname  = uri.split("/")[-1] if "/" in uri else uri
        parts.append(
            f"[Source {i}: {fname}  |  relevance score: {score:.3f}]\n{text}"
        )
    return "<context>\n\n" + "\n\n---\n\n".join(parts) + "\n\n</context>"


def extract_sources(results: list) -> list:
    """Return unique source filenames for the UI to display as citations."""
    seen, sources = set(), []
    for r in results:
        uri = r.get("location", {}).get("s3Location", {}).get("uri", "")
        fname = uri.split("/")[-1] if "/" in uri else uri
        if fname and fname not in seen:
            seen.add(fname)
            sources.append({"filename": fname, "score": round(r.get("score", 0.0), 3)})
    return sources


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def build_response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": os.environ.get("ALLOWED_ORIGIN", "*"),
            "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key",
            "Access-Control-Allow-Methods": "OPTIONS,POST",
        },
        "body": json.dumps(body),
    }


# ── Handler ───────────────────────────────────────────────────────────────────

def lambda_handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return build_response(200, {"message": "OK"})

    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        return build_response(400, {"error": "Invalid JSON in request body"})

    messages = body.get("messages", [])
    if not messages:
        return build_response(400, {"error": "'messages' is required and must not be empty"})

    for msg in messages:
        if not isinstance(msg, dict) or "role" not in msg or "content" not in msg:
            return build_response(400, {"error": "Each message needs 'role' and 'content'"})
        if msg["role"] not in ("user", "assistant"):
            return build_response(400, {"error": "role must be 'user' or 'assistant'"})

    if not ANTHROPIC_API_KEY:
        logger.error("ANTHROPIC_API_KEY not set")
        return build_response(500, {"error": "Server configuration error: missing API key"})

    # ── RAG retrieval ──────────────────────────────────────────────────────────
    kb_sources    = []
    context_block = ""
    kb_enabled    = bool(KB_ID)

    if kb_enabled:
        # Use the latest user message as the retrieval query
        latest_user_text = next(
            (m["content"] for m in reversed(messages) if m["role"] == "user"), ""
        )
        if latest_user_text:
            results       = retrieve_context(latest_user_text)
            context_block = build_context_block(results)
            kb_sources    = extract_sources(results)

    # ── Build Claude messages ──────────────────────────────────────────────────
    # Inject context as a system-level note prepended to the first user message
    if context_block:
        claude_messages = list(messages)
        # Prepend context to the last user message
        for i in range(len(claude_messages) - 1, -1, -1):
            if claude_messages[i]["role"] == "user":
                original = claude_messages[i]["content"]
                claude_messages[i] = {
                    "role": "user",
                    "content": f"{context_block}\n\nQuestion: {original}",
                }
                break
        system_prompt = SYSTEM_PROMPT_WITH_CONTEXT
    else:
        claude_messages = messages
        system_prompt   = SYSTEM_PROMPT_NO_CONTEXT if kb_enabled else SYSTEM_PROMPT_BASE

    # ── Call Claude ────────────────────────────────────────────────────────────
    try:
        client   = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model=MODEL_ID,
            max_tokens=MAX_TOKENS,
            system=system_prompt,
            messages=claude_messages,
        )
        answer = response.content[0].text
        logger.info(
            "Claude response generated | kb_enabled=%s | sources=%d | in=%d out=%d",
            kb_enabled, len(kb_sources),
            response.usage.input_tokens, response.usage.output_tokens,
        )
        return build_response(200, {
            "role":       "assistant",
            "content":    answer,
            "sources":    kb_sources,   # citations displayed in the UI
            "kb_enabled": kb_enabled,
            "usage": {
                "input_tokens":  response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
            },
        })

    except anthropic.AuthenticationError:
        return build_response(401, {"error": "Invalid Anthropic API key"})
    except anthropic.RateLimitError:
        return build_response(429, {"error": "Rate limit exceeded. Please retry shortly."})
    except anthropic.APIStatusError as e:
        logger.error("Anthropic API error: %s", str(e))
        return build_response(502, {"error": f"Upstream API error: {e.message}"})
    except Exception as e:
        logger.exception("Unexpected error: %s", str(e))
        return build_response(500, {"error": "Internal server error"})
