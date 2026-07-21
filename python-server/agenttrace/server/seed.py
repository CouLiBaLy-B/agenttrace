"""Demo seed data — port of the Next.js `src/lib/seed.ts` dataset (same three
projects/runs/events), so the frontend's "Explore the live demo" and
"Reload demo projects" buttons keep working against this backend."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from . import models
from .security import generate_api_key, hash_api_key, key_prefix

CUSTOMER_SUPPORT = {
    "name": "Customer Support Agent",
    "description": (
        "Handles refund requests end-to-end: classifies intent, looks up the order, "
        "drafts a response, and processes the refund with retry on gateway timeouts."
    ),
    "runs": [
        {
            "name": "Refund — Order #4821 (success)",
            "status": "completed",
            "events": [
                {"source": "User", "target": "Orchestrator", "type": "handoff", "label": "incoming message", "offset_sec": 0, "duration_ms": 120, "payload": {"message": "Hi, I never received my order #4821 and I'd like a refund."}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "classify intent", "offset_sec": 0.2, "duration_ms": 480, "payload": {"prompt": "Classify the user intent...", "result": "refund_request", "tokens": 184}},
                {"source": "Orchestrator", "target": "lookup_order", "type": "tool_call", "label": "lookup_order(#4821)", "offset_sec": 0.7, "duration_ms": 310, "payload": {"args": {"orderId": "4821"}}},
                {"source": "lookup_order", "target": "Orchestrator", "type": "tool_result", "label": "order found", "offset_sec": 1.0, "duration_ms": 5, "payload": {"orderId": "4821", "total": 89.99, "status": "shipped", "placedAt": "2025-01-04"}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "draft response", "offset_sec": 1.1, "duration_ms": 620, "payload": {"prompt": "Draft a friendly refund response...", "result": "We're sorry your order didn't arrive...", "tokens": 212}},
                {"source": "Orchestrator", "target": "process_refund", "type": "tool_call", "label": "process_refund($89.99)", "offset_sec": 1.8, "duration_ms": 1400, "payload": {"args": {"orderId": "4821", "amount": 89.99}}},
                {"source": "process_refund", "target": "Orchestrator", "type": "tool_result", "label": "refund ok", "offset_sec": 3.2, "duration_ms": 4, "payload": {"refundId": "rf_8821", "status": "succeeded"}},
                {"source": "Orchestrator", "target": "User", "type": "final_answer", "label": "refund issued", "offset_sec": 3.3, "duration_ms": 80, "payload": {"answer": "I've processed a full refund of $89.99. It'll appear in 3–5 business days."}},
            ],
        },
        {
            "name": "Refund — Order #5102 (gateway timeout, retry succeeds)",
            "status": "completed",
            "events": [
                {"source": "User", "target": "Orchestrator", "type": "handoff", "label": "incoming message", "offset_sec": 0, "duration_ms": 110, "payload": {"message": "Order #5102 arrived broken, requesting a refund."}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "classify intent", "offset_sec": 0.2, "duration_ms": 460, "payload": {"result": "refund_request", "tokens": 176}},
                {"source": "Orchestrator", "target": "lookup_order", "type": "tool_call", "label": "lookup_order(#5102)", "offset_sec": 0.7, "duration_ms": 290, "payload": {"args": {"orderId": "5102"}}},
                {"source": "lookup_order", "target": "Orchestrator", "type": "tool_result", "label": "order found", "offset_sec": 1.0, "duration_ms": 4, "payload": {"orderId": "5102", "total": 142.5, "status": "delivered"}},
                {"source": "Orchestrator", "target": "process_refund", "type": "tool_call", "label": "process_refund (attempt 1)", "offset_sec": 1.6, "duration_ms": 3000, "payload": {"args": {"orderId": "5102", "amount": 142.5}}},
                {"source": "process_refund", "target": "Orchestrator", "type": "error", "label": "gateway timeout", "offset_sec": 4.6, "duration_ms": 2, "status": "error", "payload": {"error": "ETIMEDOUT", "message": "Payment gateway did not respond within 3000ms"}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "decide retry", "offset_sec": 4.8, "duration_ms": 380, "payload": {"result": "retry_once", "tokens": 92}},
                {"source": "Orchestrator", "target": "process_refund", "type": "tool_call", "label": "process_refund (attempt 2)", "offset_sec": 5.4, "duration_ms": 2100, "payload": {"args": {"orderId": "5102", "amount": 142.5, "retry": True}}},
                {"source": "process_refund", "target": "Orchestrator", "type": "tool_result", "label": "refund ok", "offset_sec": 7.5, "duration_ms": 5, "payload": {"refundId": "rf_5102", "status": "succeeded"}},
                {"source": "Orchestrator", "target": "User", "type": "final_answer", "label": "refund issued", "offset_sec": 7.6, "duration_ms": 90, "payload": {"answer": "Sorry about the broken item — a refund of $142.50 is on its way."}},
            ],
        },
        {
            "name": "Refund — Order #6310 (success)",
            "status": "completed",
            "events": [
                {"source": "User", "target": "Orchestrator", "type": "handoff", "label": "incoming message", "offset_sec": 0, "duration_ms": 130, "payload": {"message": "Please refund order #6310, it was the wrong size."}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "classify intent", "offset_sec": 0.2, "duration_ms": 440, "payload": {"result": "refund_request", "tokens": 168}},
                {"source": "Orchestrator", "target": "lookup_order", "type": "tool_call", "label": "lookup_order(#6310)", "offset_sec": 0.7, "duration_ms": 260, "payload": {"args": {"orderId": "6310"}}},
                {"source": "lookup_order", "target": "Orchestrator", "type": "tool_result", "label": "order found", "offset_sec": 0.95, "duration_ms": 4, "payload": {"orderId": "6310", "total": 54.0, "status": "delivered"}},
                {"source": "Orchestrator", "target": "process_refund", "type": "tool_call", "label": "process_refund($54)", "offset_sec": 1.4, "duration_ms": 980, "payload": {"args": {"orderId": "6310", "amount": 54.0}}},
                {"source": "process_refund", "target": "Orchestrator", "type": "tool_result", "label": "refund ok", "offset_sec": 2.4, "duration_ms": 4, "payload": {"refundId": "rf_6310", "status": "succeeded"}},
                {"source": "Orchestrator", "target": "User", "type": "final_answer", "label": "refund issued", "offset_sec": 2.5, "duration_ms": 70, "payload": {"answer": "A refund of $54.00 has been issued to your original payment method."}},
            ],
        },
        {
            "name": "Refund — Order #7788 (order not found)",
            "status": "failed",
            "events": [
                {"source": "User", "target": "Orchestrator", "type": "handoff", "label": "incoming message", "offset_sec": 0, "duration_ms": 100, "payload": {"message": "I want a refund for order #7788."}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "classify intent", "offset_sec": 0.2, "duration_ms": 420, "payload": {"result": "refund_request", "tokens": 160}},
                {"source": "Orchestrator", "target": "lookup_order", "type": "tool_call", "label": "lookup_order(#7788)", "offset_sec": 0.7, "duration_ms": 240, "payload": {"args": {"orderId": "7788"}}},
                {"source": "lookup_order", "target": "Orchestrator", "type": "error", "label": "order not found", "offset_sec": 1.0, "duration_ms": 3, "status": "error", "payload": {"error": "NOT_FOUND", "message": "No order with id 7788 exists for this account."}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "draft apology", "offset_sec": 1.2, "duration_ms": 510, "payload": {"result": "I couldn't find that order — could you double check the number?", "tokens": 134}},
                {"source": "Orchestrator", "target": "User", "type": "final_answer", "label": "ask for clarification", "offset_sec": 1.8, "duration_ms": 60, "payload": {"answer": "I couldn't find an order #7788 under your account. Could you double-check the number?"}},
            ],
        },
    ],
}

RESEARCH_ASSISTANT = {
    "name": "Research Assistant",
    "description": (
        "Delegates to a 'Web Search' sub-agent that runs web_search and three parallel "
        "fetch_page calls, then synthesizes a cited summary."
    ),
    "runs": [
        {
            "name": "Research — 'state of Rust web frameworks 2025'",
            "status": "completed",
            "events": [
                {"source": "User", "target": "Orchestrator", "type": "handoff", "label": "research request", "offset_sec": 0, "duration_ms": 90, "payload": {"query": "What's the state of Rust web frameworks in 2025?"}},
                {"source": "Orchestrator", "target": "Web Search", "type": "handoff", "label": "delegate to sub-agent", "offset_sec": 0.3, "duration_ms": 200, "payload": {"task": "find recent sources on Rust web frameworks"}},
                {"source": "Web Search", "target": "web_search", "type": "tool_call", "label": "web_search(query)", "offset_sec": 0.6, "duration_ms": 700, "payload": {"args": {"query": "Rust web frameworks 2025"}}},
                {"source": "web_search", "target": "Web Search", "type": "tool_result", "label": "5 results", "offset_sec": 1.3, "duration_ms": 6, "payload": {"results": ["arewewebyet.com", "blog.axo.dev", "rust-lang.org", "tokio.rs", "actix.rs"]}},
                {"source": "Web Search", "target": "fetch_page", "type": "tool_call", "label": "fetch_page #1", "offset_sec": 1.5, "duration_ms": 900, "payload": {"args": {"url": "arewewebyet.com"}}},
                {"source": "Web Search", "target": "fetch_page", "type": "tool_call", "label": "fetch_page #2", "offset_sec": 1.5, "duration_ms": 1100, "payload": {"args": {"url": "blog.axo.dev"}}},
                {"source": "Web Search", "target": "fetch_page", "type": "tool_call", "label": "fetch_page #3", "offset_sec": 1.5, "duration_ms": 850, "payload": {"args": {"url": "actix.rs"}}},
                {"source": "fetch_page", "target": "Web Search", "type": "tool_result", "label": "content #1", "offset_sec": 2.4, "duration_ms": 4, "payload": {"title": "Are We Web Yet?", "chars": 4200}},
                {"source": "fetch_page", "target": "Web Search", "type": "tool_result", "label": "content #2", "offset_sec": 2.6, "duration_ms": 4, "payload": {"title": "Axo blog: frameworks", "chars": 3100}},
                {"source": "fetch_page", "target": "Web Search", "type": "tool_result", "label": "content #3", "offset_sec": 2.4, "duration_ms": 4, "payload": {"title": "Actix web", "chars": 2800}},
                {"source": "Web Search", "target": "Orchestrator", "type": "handoff", "label": "sub-agent done", "offset_sec": 2.7, "duration_ms": 80, "payload": {"sources": 3, "notes": "Actix, Axum, and Rocket dominate; Axum gaining."}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "synthesize summary", "offset_sec": 3.0, "duration_ms": 2400, "payload": {"prompt": "Synthesize a cited summary...", "tokens": 1240, "result": "Axum, Actix-web, and Rocket remain the leading frameworks..."}},
                {"source": "Orchestrator", "target": "User", "type": "final_answer", "label": "summary with citations", "offset_sec": 5.4, "duration_ms": 120, "payload": {"answer": "Rust web frameworks in 2025 are led by Axum (ergonomic, tower-based), Actix-web (performance), and Rocket (mature). [1][2][3]"}},
            ],
        },
        {
            "name": "Research — 'best practices for RAG evaluation'",
            "status": "completed",
            "events": [
                {"source": "User", "target": "Orchestrator", "type": "handoff", "label": "research request", "offset_sec": 0, "duration_ms": 80, "payload": {"query": "What are best practices for evaluating RAG systems?"}},
                {"source": "Orchestrator", "target": "Web Search", "type": "handoff", "label": "delegate to sub-agent", "offset_sec": 0.2, "duration_ms": 180, "payload": {"task": "find RAG evaluation best practices"}},
                {"source": "Web Search", "target": "web_search", "type": "tool_call", "label": "web_search(query)", "offset_sec": 0.5, "duration_ms": 640, "payload": {"args": {"query": "RAG evaluation best practices"}}},
                {"source": "web_search", "target": "Web Search", "type": "tool_result", "label": "5 results", "offset_sec": 1.1, "duration_ms": 5, "payload": {"results": ["ragas.dev", "langchain blog", "arxiv", "trulens.org", "plyground.ai"]}},
                {"source": "Web Search", "target": "fetch_page", "type": "tool_call", "label": "fetch_page #1", "offset_sec": 1.3, "duration_ms": 820, "payload": {"args": {"url": "ragas.dev"}}},
                {"source": "Web Search", "target": "fetch_page", "type": "tool_call", "label": "fetch_page #2", "offset_sec": 1.3, "duration_ms": 760, "payload": {"args": {"url": "trulens.org"}}},
                {"source": "Web Search", "target": "fetch_page", "type": "tool_call", "label": "fetch_page #3", "offset_sec": 1.3, "duration_ms": 980, "payload": {"args": {"url": "arxiv"}}},
                {"source": "fetch_page", "target": "Web Search", "type": "tool_result", "label": "content #1", "offset_sec": 2.1, "duration_ms": 3, "payload": {"title": "Ragas metrics", "chars": 3600}},
                {"source": "fetch_page", "target": "Web Search", "type": "tool_result", "label": "content #2", "offset_sec": 2.1, "duration_ms": 3, "payload": {"title": "TruLens guide", "chars": 2900}},
                {"source": "fetch_page", "target": "Web Search", "type": "tool_result", "label": "content #3", "offset_sec": 2.3, "duration_ms": 3, "payload": {"title": "RAGAS paper", "chars": 5200}},
                {"source": "Web Search", "target": "Orchestrator", "type": "handoff", "label": "sub-agent done", "offset_sec": 2.4, "duration_ms": 70, "payload": {"sources": 3}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "synthesize summary", "offset_sec": 2.7, "duration_ms": 2100, "payload": {"tokens": 980, "result": "Use faithfulness, answer relevancy, and context precision metrics..."}},
                {"source": "Orchestrator", "target": "User", "type": "final_answer", "label": "summary", "offset_sec": 4.8, "duration_ms": 110, "payload": {"answer": "Evaluate RAG with faithfulness, answer relevancy, and context precision/recall. Tools: Ragas, TruLens. [1][2][3]"}},
            ],
        },
        {
            "name": "Research — 'compare Postgres vector DBs' (sub-agent error)",
            "status": "failed",
            "events": [
                {"source": "User", "target": "Orchestrator", "type": "handoff", "label": "research request", "offset_sec": 0, "duration_ms": 70, "payload": {"query": "Compare Postgres vector DB extensions."}},
                {"source": "Orchestrator", "target": "Web Search", "type": "handoff", "label": "delegate to sub-agent", "offset_sec": 0.2, "duration_ms": 160, "payload": {"task": "find pgvector vs alternatives"}},
                {"source": "Web Search", "target": "web_search", "type": "tool_call", "label": "web_search(query)", "offset_sec": 0.4, "duration_ms": 1200, "payload": {"args": {"query": "pgvector alternatives"}}},
                {"source": "web_search", "target": "Web Search", "type": "tool_result", "label": "3 results", "offset_sec": 1.6, "duration_ms": 5, "payload": {"results": ["pgvector", "neon", "timescale"]}},
                {"source": "Web Search", "target": "fetch_page", "type": "tool_call", "label": "fetch_page #1", "offset_sec": 1.8, "duration_ms": 4000, "payload": {"args": {"url": "neon"}}},
                {"source": "fetch_page", "target": "Web Search", "type": "error", "label": "fetch failed (429)", "offset_sec": 5.8, "duration_ms": 2, "status": "error", "payload": {"error": "HTTP 429", "message": "rate limited by source"}},
                {"source": "Web Search", "target": "Orchestrator", "type": "error", "label": "sub-agent failed", "offset_sec": 5.9, "duration_ms": 10, "status": "error", "payload": {"error": "could not gather enough sources"}},
                {"source": "Orchestrator", "target": "User", "type": "final_answer", "label": "partial answer", "offset_sec": 5.95, "duration_ms": 80, "payload": {"answer": "I ran into rate limits while researching this. pgvector remains the standard; want me to retry?"}},
            ],
        },
    ],
}

CODE_REVIEW_BOT = {
    "name": "Code Review Bot",
    "description": (
        "Triggered by a PR webhook: fetches the diff, runs LLM analysis, posts a comment, "
        "and emits a final approval status."
    ),
    "runs": [
        {
            "name": "PR #142 — feat: add retry logic to payment client",
            "status": "completed",
            "events": [
                {"source": "User", "target": "Orchestrator", "type": "handoff", "label": "PR webhook", "offset_sec": 0, "duration_ms": 60, "payload": {"pr": 142, "action": "opened", "repo": "acme/payments"}},
                {"source": "Orchestrator", "target": "fetch_diff", "type": "tool_call", "label": "fetch_diff(pr=142)", "offset_sec": 0.2, "duration_ms": 540, "payload": {"args": {"pr": 142}}},
                {"source": "fetch_diff", "target": "Orchestrator", "type": "tool_result", "label": "+218 / -64", "offset_sec": 0.75, "duration_ms": 4, "payload": {"files": 3, "additions": 218, "deletions": 64}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "analyze diff", "offset_sec": 0.9, "duration_ms": 3200, "payload": {"prompt": "Review this diff for bugs and style...", "tokens": 1840, "result": "Retry logic is sound; consider exponential backoff. Line 42 missing error log."}},
                {"source": "Orchestrator", "target": "post_comment", "type": "tool_call", "label": "post_comment(pr=142)", "offset_sec": 4.2, "duration_ms": 760, "payload": {"args": {"pr": 142, "body": "## Review\n- Consider exponential backoff\n- Add error log at L42"}}},
                {"source": "post_comment", "target": "Orchestrator", "type": "tool_result", "label": "comment posted", "offset_sec": 5.0, "duration_ms": 4, "payload": {"commentId": 9912, "url": "github.com/acme/payments/pull/142#issuecomment-9912"}},
                {"source": "Orchestrator", "target": "User", "type": "final_answer", "label": "approved with comments", "offset_sec": 5.1, "duration_ms": 70, "payload": {"answer": "Approved with comments — see review on PR #142.", "status": "approved_with_comments"}},
            ],
        },
        {
            "name": "PR #143 — chore: bump deps",
            "status": "completed",
            "events": [
                {"source": "User", "target": "Orchestrator", "type": "handoff", "label": "PR webhook", "offset_sec": 0, "duration_ms": 50, "payload": {"pr": 143, "action": "opened", "repo": "acme/payments"}},
                {"source": "Orchestrator", "target": "fetch_diff", "type": "tool_call", "label": "fetch_diff(pr=143)", "offset_sec": 0.2, "duration_ms": 380, "payload": {"args": {"pr": 143}}},
                {"source": "fetch_diff", "target": "Orchestrator", "type": "tool_result", "label": "+12 / -12", "offset_sec": 0.6, "duration_ms": 3, "payload": {"files": 1, "additions": 12, "deletions": 12}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "analyze diff", "offset_sec": 0.75, "duration_ms": 1900, "payload": {"tokens": 420, "result": "Dependency bumps only. No behavioral changes."}},
                {"source": "Orchestrator", "target": "post_comment", "type": "tool_call", "label": "post_comment(pr=143)", "offset_sec": 2.7, "duration_ms": 560, "payload": {"args": {"pr": 143, "body": "LGTM — dependency bumps only."}}},
                {"source": "post_comment", "target": "Orchestrator", "type": "tool_result", "label": "comment posted", "offset_sec": 3.3, "duration_ms": 3, "payload": {"commentId": 9918}},
                {"source": "Orchestrator", "target": "User", "type": "final_answer", "label": "approved", "offset_sec": 3.35, "duration_ms": 50, "payload": {"answer": "Approved — dependency bumps only.", "status": "approved"}},
            ],
        },
        {
            "name": "PR #144 — fix: null check in order lookup",
            "status": "completed",
            "events": [
                {"source": "User", "target": "Orchestrator", "type": "handoff", "label": "PR webhook", "offset_sec": 0, "duration_ms": 55, "payload": {"pr": 144, "action": "opened", "repo": "acme/payments"}},
                {"source": "Orchestrator", "target": "fetch_diff", "type": "tool_call", "label": "fetch_diff(pr=144)", "offset_sec": 0.2, "duration_ms": 460, "payload": {"args": {"pr": 144}}},
                {"source": "fetch_diff", "target": "Orchestrator", "type": "tool_result", "label": "+8 / -2", "offset_sec": 0.65, "duration_ms": 3, "payload": {"files": 1, "additions": 8, "deletions": 2}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "analyze diff", "offset_sec": 0.8, "duration_ms": 2600, "payload": {"tokens": 980, "result": "Null check added correctly. Suggest early return for clarity."}},
                {"source": "Orchestrator", "target": "post_comment", "type": "tool_call", "label": "post_comment(pr=144)", "offset_sec": 3.4, "duration_ms": 690, "payload": {"args": {"pr": 144, "body": "## Review\n- Null check correct\n- Consider early return"}}},
                {"source": "post_comment", "target": "Orchestrator", "type": "tool_result", "label": "comment posted", "offset_sec": 4.1, "duration_ms": 3, "payload": {"commentId": 9925}},
                {"source": "Orchestrator", "target": "User", "type": "final_answer", "label": "approved with comments", "offset_sec": 4.15, "duration_ms": 60, "payload": {"answer": "Approved with comments.", "status": "approved_with_comments"}},
            ],
        },
        {
            "name": "PR #145 — refactor: rework auth middleware",
            "status": "failed",
            "events": [
                {"source": "User", "target": "Orchestrator", "type": "handoff", "label": "PR webhook", "offset_sec": 0, "duration_ms": 60, "payload": {"pr": 145, "action": "opened", "repo": "acme/payments"}},
                {"source": "Orchestrator", "target": "fetch_diff", "type": "tool_call", "label": "fetch_diff(pr=145)", "offset_sec": 0.2, "duration_ms": 820, "payload": {"args": {"pr": 145}}},
                {"source": "fetch_diff", "target": "Orchestrator", "type": "tool_result", "label": "+640 / -512", "offset_sec": 1.0, "duration_ms": 4, "payload": {"files": 12, "additions": 640, "deletions": 512}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "analyze diff", "offset_sec": 1.2, "duration_ms": 3000, "payload": {"tokens": 4200, "result": "Large refactor. Potential regression: session invalidation removed at L210."}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "second pass (security)", "offset_sec": 4.2, "duration_ms": 280, "payload": {"tokens": 540, "result": "Confirm: session invalidation path removed — request changes."}},
                {"source": "Orchestrator", "target": "post_comment", "type": "tool_call", "label": "post_comment(pr=145)", "offset_sec": 4.5, "duration_ms": 180, "payload": {"args": {"pr": 145, "body": "## Request changes\n- Session invalidation removed at L210"}}},
                {"source": "Orchestrator", "target": "User", "type": "error", "label": "changes requested", "offset_sec": 4.7, "duration_ms": 30, "status": "error", "payload": {"error": "CHANGES_REQUESTED", "answer": "Requesting changes — session invalidation path was removed.", "status": "changes_requested"}},
            ],
        },
        {
            "name": "PR #146 — docs: update README",
            "status": "completed",
            "events": [
                {"source": "User", "target": "Orchestrator", "type": "handoff", "label": "PR webhook", "offset_sec": 0, "duration_ms": 45, "payload": {"pr": 146, "action": "opened", "repo": "acme/payments"}},
                {"source": "Orchestrator", "target": "fetch_diff", "type": "tool_call", "label": "fetch_diff(pr=146)", "offset_sec": 0.2, "duration_ms": 300, "payload": {"args": {"pr": 146}}},
                {"source": "fetch_diff", "target": "Orchestrator", "type": "tool_result", "label": "+40 / -6", "offset_sec": 0.5, "duration_ms": 3, "payload": {"files": 1, "additions": 40, "deletions": 6}},
                {"source": "Orchestrator", "target": "LLM", "type": "llm_call", "label": "analyze diff", "offset_sec": 0.6, "duration_ms": 1200, "payload": {"tokens": 320, "result": "Docs only. Clear and accurate."}},
                {"source": "Orchestrator", "target": "post_comment", "type": "tool_call", "label": "post_comment(pr=146)", "offset_sec": 1.8, "duration_ms": 420, "payload": {"args": {"pr": 146, "body": "LGTM — docs look good."}}},
                {"source": "post_comment", "target": "Orchestrator", "type": "tool_result", "label": "comment posted", "offset_sec": 2.2, "duration_ms": 3, "payload": {"commentId": 9931}},
                {"source": "Orchestrator", "target": "User", "type": "final_answer", "label": "approved", "offset_sec": 2.25, "duration_ms": 40, "payload": {"answer": "Approved — docs only.", "status": "approved"}},
            ],
        },
    ],
}

SEED_PROJECTS: list[dict[str, Any]] = [CUSTOMER_SUPPORT, RESEARCH_ASSISTANT, CODE_REVIEW_BOT]


def seed_demo_data(db: Session, user_id: str) -> None:
    """Idempotent: skip if the user already has projects."""
    existing = db.query(models.Project).filter(models.Project.user_id == user_id).count()
    if existing > 0:
        return

    now = datetime.now(timezone.utc)

    for sp in SEED_PROJECTS:
        project = models.Project(name=sp["name"], description=sp["description"], user_id=user_id)
        db.add(project)
        db.flush()

        raw_key = generate_api_key()
        db.add(
            models.ApiKey(
                project_id=project.id,
                key_hash=hash_api_key(raw_key),
                prefix=key_prefix(raw_key),
                label="Default key",
            )
        )

        for run_idx, sr in enumerate(sp["runs"]):
            started_at = now - timedelta(days=len(SEED_PROJECTS)) + timedelta(hours=run_idx * 6)
            total_s = max((e["offset_sec"] + e.get("duration_ms", 0) / 1000) for e in sr["events"])
            ended_at = started_at + timedelta(seconds=total_s)

            run = models.Run(
                project_id=project.id,
                name=sr["name"],
                status=sr["status"],
                started_at=started_at,
                ended_at=ended_at,
            )
            db.add(run)
            db.flush()

            for seq, ev in enumerate(sr["events"]):
                db.add(
                    models.Event(
                        run_id=run.id,
                        timestamp=started_at + timedelta(seconds=ev["offset_sec"]),
                        seq=seq,
                        source=ev["source"],
                        target=ev["target"],
                        type=ev["type"],
                        label=ev.get("label"),
                        payload=json.dumps(ev["payload"]),
                        duration_ms=ev.get("duration_ms"),
                        status=ev.get("status", "ok"),
                    )
                )

    db.commit()
