# TPRM Security Chatbot

A chatbot for answering Third-Party Risk Management (TPRM) and vendor security questions, powered by Claude claude-sonnet-4-6.

## Architecture

```
Browser (S3 Static)  →  API Gateway (HTTP API)  →  Lambda (Python)  →  Claude API
```

| Layer | Service | Notes |
|---|---|---|
| Frontend | S3 Static Website | HTML/CSS/JS, no build step |
| API | API Gateway HTTP API | CORS-enabled, single `/chat` endpoint |
| Compute | AWS Lambda (Python 3.12) | Stateless, 60s timeout |
| AI Model | Anthropic Claude claude-sonnet-4-6 | TPRM system prompt |

## Directory Structure

```
tprm-chatbot/
├── backend/
│   ├── lambda_function.py   # Lambda handler + Claude API integration
│   ├── requirements.txt     # anthropic SDK
│   └── build_layer.sh       # Package Lambda + deps into a zip
├── frontend/
│   ├── index.html           # Chat UI
│   ├── styles.css           # Dark theme styling
│   └── app.js               # Chat logic + markdown renderer
└── infrastructure/
    ├── template.yaml        # AWS SAM template
    ├── deploy.sh            # One-command deploy
    └── destroy.sh           # Teardown script
```

## Prerequisites

- AWS CLI configured (`aws configure`)
- AWS SAM CLI installed (`pip install aws-sam-cli`)
- Python 3.12+
- An Anthropic API key

## Deployment

### 1. Set environment variables

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export AWS_REGION="us-east-1"
export SAM_S3_BUCKET="my-sam-artifacts-bucket"   # must already exist
export ENVIRONMENT="prod"                          # dev | staging | prod
export ALLOWED_ORIGIN="*"                          # restrict in production
```

### 2. Deploy

```bash
cd tprm-chatbot/infrastructure
chmod +x deploy.sh destroy.sh
./deploy.sh
```

The script will:
1. Build the Lambda deployment package
2. Run `sam build` and `sam deploy`
3. Sync frontend files to S3
4. Print the API endpoint and frontend URL

### 3. Configure the frontend

Open the Frontend URL in a browser. In the left sidebar, enter the **API Endpoint** printed by the deploy script and click **Save**.

## API

### `POST /chat`

**Request body**
```json
{
  "messages": [
    { "role": "user", "content": "What are the key components of a TPRM program?" }
  ]
}
```

Multi-turn: include the full conversation history in `messages`.

**Response (200)**
```json
{
  "role": "assistant",
  "content": "A TPRM program typically consists of...",
  "usage": {
    "input_tokens": 120,
    "output_tokens": 310
  }
}
```

**Error responses**

| Status | Meaning |
|---|---|
| 400 | Bad request (missing/invalid fields) |
| 401 | Invalid Anthropic API key |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
| 502 | Upstream Anthropic API error |

## TPRM Topics Covered

- Vendor risk assessment processes and questionnaires (SIG, CAIQ, VSA)
- Vendor risk tiering and classification
- Compliance frameworks: ISO 27001, SOC 2, NIST CSF, CIS Controls, PCI-DSS, HIPAA, GDPR
- Supply chain and fourth-party risk
- Cloud vendor security (shared responsibility model)
- Contract security clauses and SLA requirements
- Continuous monitoring and ongoing due diligence
- Incident response requirements for third parties
- Data handling and privacy requirements

## Local Development

Run the Lambda handler locally with SAM:

```bash
cd infrastructure
sam local start-api --template template.yaml \
  --env-vars <(echo '{"TPRMChatbotFunction":{"ANTHROPIC_API_KEY":"sk-ant-..."}}')
```

Then open `frontend/index.html` in a browser and set the API endpoint to `http://localhost:3000/chat`.

## Security Notes

- The `ANTHROPIC_API_KEY` is stored as a Lambda environment variable. For production, use **AWS Secrets Manager** or **SSM Parameter Store** and fetch it at runtime.
- Restrict `AllowedOrigin` to your CloudFront or S3 website URL instead of `*`.
- Consider adding API Gateway throttling and AWS WAF for public-facing deployments.
- Enable AWS CloudTrail and Lambda logging for audit purposes.
