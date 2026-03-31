"""
TPRM Chatbot - AWS Lambda Handler
Answers Third-Party Risk Management (TPRM) and security assessment questions
using Claude claude-sonnet-4-6 via the Anthropic API.
"""

import json
import os
import logging
import anthropic

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL_ID = "claude-sonnet-4-6"
MAX_TOKENS = 1024

SYSTEM_PROMPT = """You are a TPRM (Third-Party Risk Management) security expert assistant.
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
cite the specific control or clause where relevant. Format responses with markdown for readability.
If a question is outside TPRM/security scope, politely redirect the user to appropriate resources."""


def build_response(status_code: int, body: dict, origin: str = "*") -> dict:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key",
            "Access-Control-Allow-Methods": "OPTIONS,POST",
        },
        "body": json.dumps(body),
    }


def lambda_handler(event: dict, context) -> dict:
    # Handle CORS preflight
    if event.get("httpMethod") == "OPTIONS":
        return build_response(200, {"message": "OK"})

    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        return build_response(400, {"error": "Invalid JSON in request body"})

    messages = body.get("messages", [])
    if not messages:
        return build_response(400, {"error": "messages field is required and must not be empty"})

    # Validate message structure
    for msg in messages:
        if not isinstance(msg, dict) or "role" not in msg or "content" not in msg:
            return build_response(400, {"error": "Each message must have 'role' and 'content' fields"})
        if msg["role"] not in ("user", "assistant"):
            return build_response(400, {"error": "Message role must be 'user' or 'assistant'"})

    if not ANTHROPIC_API_KEY:
        logger.error("ANTHROPIC_API_KEY environment variable not set")
        return build_response(500, {"error": "Server configuration error: missing API key"})

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model=MODEL_ID,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=messages,
        )

        answer = response.content[0].text
        logger.info("Successfully generated response, input_tokens=%d output_tokens=%d",
                    response.usage.input_tokens, response.usage.output_tokens)

        return build_response(200, {
            "role": "assistant",
            "content": answer,
            "usage": {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
            },
        })

    except anthropic.AuthenticationError:
        logger.error("Anthropic authentication error")
        return build_response(401, {"error": "Invalid API key"})
    except anthropic.RateLimitError:
        logger.warning("Anthropic rate limit hit")
        return build_response(429, {"error": "Rate limit exceeded. Please try again shortly."})
    except anthropic.APIStatusError as e:
        logger.error("Anthropic API error: %s", str(e))
        return build_response(502, {"error": f"Upstream API error: {e.message}"})
    except Exception as e:
        logger.exception("Unexpected error: %s", str(e))
        return build_response(500, {"error": "Internal server error"})
