// Demo seed data for AgentTrace
import { db } from "@/lib/db"
import { generateApiKey, hashApiKey, keyPrefix } from "@/lib/keys"

interface SeedEvent {
  source: string
  target: string
  type: "llm_call" | "tool_call" | "tool_result" | "handoff" | "error" | "final_answer"
  label?: string
  payload: any
  durationMs?: number
  status?: "ok" | "error" | "pending"
  // relative seconds from run start
  offsetSec: number
}

interface SeedRun {
  name: string
  status: "completed" | "failed"
  durationLabel: string
  events: SeedEvent[]
}

interface SeedProject {
  name: string
  description: string
  runs: SeedRun[]
}

// ---------------------------------------------------------------------------
// Project 1: Customer Support Agent
// ---------------------------------------------------------------------------
const customerSupport: SeedProject = {
  name: "Customer Support Agent",
  description:
    "Handles refund requests end-to-end: classifies intent, looks up the order, drafts a response, and processes the refund with retry on gateway timeouts.",
  runs: [
    {
      name: "Refund — Order #4821 (success)",
      status: "completed",
      durationLabel: "4.2s",
      events: [
        { source: "User", target: "Orchestrator", type: "handoff", label: "incoming message", offsetSec: 0, durationMs: 120, payload: { message: "Hi, I never received my order #4821 and I'd like a refund." } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "classify intent", offsetSec: 0.2, durationMs: 480, payload: { prompt: "Classify the user intent...", result: "refund_request", prompt_tokens: 73, completion_tokens: 111, total_tokens: 184 } },
        { source: "Orchestrator", target: "lookup_order", type: "tool_call", label: "lookup_order(#4821)", offsetSec: 0.7, durationMs: 310, payload: { args: { orderId: "4821" } } },
        { source: "lookup_order", target: "Orchestrator", type: "tool_result", label: "order found", offsetSec: 1.0, durationMs: 5, payload: { orderId: "4821", total: 89.99, status: "shipped", placedAt: "2025-01-04" } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "draft response", offsetSec: 1.1, durationMs: 620, payload: { prompt: "Draft a friendly refund response...", result: "We're sorry your order didn't arrive...", prompt_tokens: 84, completion_tokens: 128, total_tokens: 212 } },
        { source: "Orchestrator", target: "process_refund", type: "tool_call", label: "process_refund($89.99)", offsetSec: 1.8, durationMs: 1400, payload: { args: { orderId: "4821", amount: 89.99 } } },
        { source: "process_refund", target: "Orchestrator", type: "tool_result", label: "refund ok", offsetSec: 3.2, durationMs: 4, payload: { refundId: "rf_8821", status: "succeeded" } },
        { source: "Orchestrator", target: "User", type: "final_answer", label: "refund issued", offsetSec: 3.3, durationMs: 80, payload: { answer: "I've processed a full refund of $89.99. It'll appear in 3–5 business days." } },
      ],
    },
    {
      name: "Refund — Order #5102 (gateway timeout, retry succeeds)",
      status: "completed",
      durationLabel: "9.8s",
      events: [
        { source: "User", target: "Orchestrator", type: "handoff", label: "incoming message", offsetSec: 0, durationMs: 110, payload: { message: "Order #5102 arrived broken, requesting a refund." } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "classify intent", offsetSec: 0.2, durationMs: 460, payload: { result: "refund_request", prompt_tokens: 70, completion_tokens: 106, total_tokens: 176 } },
        { source: "Orchestrator", target: "lookup_order", type: "tool_call", label: "lookup_order(#5102)", offsetSec: 0.7, durationMs: 290, payload: { args: { orderId: "5102" } } },
        { source: "lookup_order", target: "Orchestrator", type: "tool_result", label: "order found", offsetSec: 1.0, durationMs: 4, payload: { orderId: "5102", total: 142.5, status: "delivered" } },
        { source: "Orchestrator", target: "process_refund", type: "tool_call", label: "process_refund (attempt 1)", offsetSec: 1.6, durationMs: 3000, payload: { args: { orderId: "5102", amount: 142.5 } } },
        { source: "process_refund", target: "Orchestrator", type: "error", label: "gateway timeout", offsetSec: 4.6, durationMs: 2, status: "error", payload: { error: "ETIMEDOUT", message: "Payment gateway did not respond within 3000ms" } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "decide retry", offsetSec: 4.8, durationMs: 380, payload: { result: "retry_once", prompt_tokens: 36, completion_tokens: 56, total_tokens: 92 } },
        { source: "Orchestrator", target: "process_refund", type: "tool_call", label: "process_refund (attempt 2)", offsetSec: 5.4, durationMs: 2100, payload: { args: { orderId: "5102", amount: 142.5, retry: true } } },
        { source: "process_refund", target: "Orchestrator", type: "tool_result", label: "refund ok", offsetSec: 7.5, durationMs: 5, payload: { refundId: "rf_5102", status: "succeeded" } },
        { source: "Orchestrator", target: "User", type: "final_answer", label: "refund issued", offsetSec: 7.6, durationMs: 90, payload: { answer: "Sorry about the broken item — a refund of $142.50 is on its way." } },
      ],
    },
    {
      name: "Refund — Order #6310 (success)",
      status: "completed",
      durationLabel: "3.6s",
      events: [
        { source: "User", target: "Orchestrator", type: "handoff", label: "incoming message", offsetSec: 0, durationMs: 130, payload: { message: "Please refund order #6310, it was the wrong size." } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "classify intent", offsetSec: 0.2, durationMs: 440, payload: { result: "refund_request", prompt_tokens: 67, completion_tokens: 101, total_tokens: 168 } },
        { source: "Orchestrator", target: "lookup_order", type: "tool_call", label: "lookup_order(#6310)", offsetSec: 0.7, durationMs: 260, payload: { args: { orderId: "6310" } } },
        { source: "lookup_order", target: "Orchestrator", type: "tool_result", label: "order found", offsetSec: 0.95, durationMs: 4, payload: { orderId: "6310", total: 54.0, status: "delivered" } },
        { source: "Orchestrator", target: "process_refund", type: "tool_call", label: "process_refund($54)", offsetSec: 1.4, durationMs: 980, payload: { args: { orderId: "6310", amount: 54.0 } } },
        { source: "process_refund", target: "Orchestrator", type: "tool_result", label: "refund ok", offsetSec: 2.4, durationMs: 4, payload: { refundId: "rf_6310", status: "succeeded" } },
        { source: "Orchestrator", target: "User", type: "final_answer", label: "refund issued", offsetSec: 2.5, durationMs: 70, payload: { answer: "A refund of $54.00 has been issued to your original payment method." } },
      ],
    },
    {
      name: "Refund — Order #7788 (order not found)",
      status: "failed",
      durationLabel: "2.1s",
      events: [
        { source: "User", target: "Orchestrator", type: "handoff", label: "incoming message", offsetSec: 0, durationMs: 100, payload: { message: "I want a refund for order #7788." } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "classify intent", offsetSec: 0.2, durationMs: 420, payload: { result: "refund_request", prompt_tokens: 64, completion_tokens: 96, total_tokens: 160 } },
        { source: "Orchestrator", target: "lookup_order", type: "tool_call", label: "lookup_order(#7788)", offsetSec: 0.7, durationMs: 240, payload: { args: { orderId: "7788" } } },
        { source: "lookup_order", target: "Orchestrator", type: "error", label: "order not found", offsetSec: 1.0, durationMs: 3, status: "error", payload: { error: "NOT_FOUND", message: "No order with id 7788 exists for this account." } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "draft apology", offsetSec: 1.2, durationMs: 510, payload: { result: "I couldn't find that order — could you double check the number?", prompt_tokens: 53, completion_tokens: 81, total_tokens: 134 } },
        { source: "Orchestrator", target: "User", type: "final_answer", label: "ask for clarification", offsetSec: 1.8, durationMs: 60, payload: { answer: "I couldn't find an order #7788 under your account. Could you double-check the number?" } },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Project 2: Research Assistant (delegates to Web Search sub-agent)
// ---------------------------------------------------------------------------
const researchAssistant: SeedProject = {
  name: "Research Assistant",
  description:
    "Delegates to a 'Web Search' sub-agent that runs web_search and three parallel fetch_page calls, then synthesizes a cited summary.",
  runs: [
    {
      name: "Research — 'state of Rust web frameworks 2025'",
      status: "completed",
      durationLabel: "8.4s",
      events: [
        { source: "User", target: "Orchestrator", type: "handoff", label: "research request", offsetSec: 0, durationMs: 90, payload: { query: "What's the state of Rust web frameworks in 2025?" } },
        { source: "Orchestrator", target: "Web Search", type: "handoff", label: "delegate to sub-agent", offsetSec: 0.3, durationMs: 200, payload: { task: "find recent sources on Rust web frameworks" } },
        { source: "Web Search", target: "web_search", type: "tool_call", label: "web_search(query)", offsetSec: 0.6, durationMs: 700, payload: { args: { query: "Rust web frameworks 2025" } } },
        { source: "web_search", target: "Web Search", type: "tool_result", label: "5 results", offsetSec: 1.3, durationMs: 6, payload: { results: ["arewewebyet.com", "blog.axo.dev", "rust-lang.org", "tokio.rs", "actix.rs"] } },
        { source: "Web Search", target: "fetch_page", type: "tool_call", label: "fetch_page #1", offsetSec: 1.5, durationMs: 900, payload: { args: { url: "arewewebyet.com" } } },
        { source: "Web Search", target: "fetch_page", type: "tool_call", label: "fetch_page #2", offsetSec: 1.5, durationMs: 1100, payload: { args: { url: "blog.axo.dev" } } },
        { source: "Web Search", target: "fetch_page", type: "tool_call", label: "fetch_page #3", offsetSec: 1.5, durationMs: 850, payload: { args: { url: "actix.rs" } } },
        { source: "fetch_page", target: "Web Search", type: "tool_result", label: "content #1", offsetSec: 2.4, durationMs: 4, payload: { title: "Are We Web Yet?", chars: 4200 } },
        { source: "fetch_page", target: "Web Search", type: "tool_result", label: "content #2", offsetSec: 2.6, durationMs: 4, payload: { title: "Axo blog: frameworks", chars: 3100 } },
        { source: "fetch_page", target: "Web Search", type: "tool_result", label: "content #3", offsetSec: 2.4, durationMs: 4, payload: { title: "Actix web", chars: 2800 } },
        { source: "Web Search", target: "Orchestrator", type: "handoff", label: "sub-agent done", offsetSec: 2.7, durationMs: 80, payload: { sources: 3, notes: "Actix, Axum, and Rocket dominate; Axum gaining." } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "synthesize summary", offsetSec: 3.0, durationMs: 2400, payload: { prompt: "Synthesize a cited summary...", prompt_tokens: 496, completion_tokens: 744, total_tokens: 1240, result: "Axum, Actix-web, and Rocket remain the leading frameworks..." } },
        { source: "Orchestrator", target: "User", type: "final_answer", label: "summary with citations", offsetSec: 5.4, durationMs: 120, payload: { answer: "Rust web frameworks in 2025 are led by Axum (ergonomic, tower-based), Actix-web (performance), and Rocket (mature). [1][2][3]" } },
      ],
    },
    {
      name: "Research — 'best practices for RAG evaluation'",
      status: "completed",
      durationLabel: "7.1s",
      events: [
        { source: "User", target: "Orchestrator", type: "handoff", label: "research request", offsetSec: 0, durationMs: 80, payload: { query: "What are best practices for evaluating RAG systems?" } },
        { source: "Orchestrator", target: "Web Search", type: "handoff", label: "delegate to sub-agent", offsetSec: 0.2, durationMs: 180, payload: { task: "find RAG evaluation best practices" } },
        { source: "Web Search", target: "web_search", type: "tool_call", label: "web_search(query)", offsetSec: 0.5, durationMs: 640, payload: { args: { query: "RAG evaluation best practices" } } },
        { source: "web_search", target: "Web Search", type: "tool_result", label: "5 results", offsetSec: 1.1, durationMs: 5, payload: { results: ["ragas.dev", "langchain blog", "arxiv", "trulens.org", "plyground.ai"] } },
        { source: "Web Search", target: "fetch_page", type: "tool_call", label: "fetch_page #1", offsetSec: 1.3, durationMs: 820, payload: { args: { url: "ragas.dev" } } },
        { source: "Web Search", target: "fetch_page", type: "tool_call", label: "fetch_page #2", offsetSec: 1.3, durationMs: 760, payload: { args: { url: "trulens.org" } } },
        { source: "Web Search", target: "fetch_page", type: "tool_call", label: "fetch_page #3", offsetSec: 1.3, durationMs: 980, payload: { args: { url: "arxiv" } } },
        { source: "fetch_page", target: "Web Search", type: "tool_result", label: "content #1", offsetSec: 2.1, durationMs: 3, payload: { title: "Ragas metrics", chars: 3600 } },
        { source: "fetch_page", target: "Web Search", type: "tool_result", label: "content #2", offsetSec: 2.1, durationMs: 3, payload: { title: "TruLens guide", chars: 2900 } },
        { source: "fetch_page", target: "Web Search", type: "tool_result", label: "content #3", offsetSec: 2.3, durationMs: 3, payload: { title: "RAGAS paper", chars: 5200 } },
        { source: "Web Search", target: "Orchestrator", type: "handoff", label: "sub-agent done", offsetSec: 2.4, durationMs: 70, payload: { sources: 3 } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "synthesize summary", offsetSec: 2.7, durationMs: 2100, payload: { prompt_tokens: 392, completion_tokens: 588, total_tokens: 980, result: "Use faithfulness, answer relevancy, and context precision metrics..." } },
        { source: "Orchestrator", target: "User", type: "final_answer", label: "summary", offsetSec: 4.8, durationMs: 110, payload: { answer: "Evaluate RAG with faithfulness, answer relevancy, and context precision/recall. Tools: Ragas, TruLens. [1][2][3]" } },
      ],
    },
    {
      name: "Research — 'compare Postgres vector DBs' (sub-agent error)",
      status: "failed",
      durationLabel: "5.9s",
      events: [
        { source: "User", target: "Orchestrator", type: "handoff", label: "research request", offsetSec: 0, durationMs: 70, payload: { query: "Compare Postgres vector DB extensions." } },
        { source: "Orchestrator", target: "Web Search", type: "handoff", label: "delegate to sub-agent", offsetSec: 0.2, durationMs: 160, payload: { task: "find pgvector vs alternatives" } },
        { source: "Web Search", target: "web_search", type: "tool_call", label: "web_search(query)", offsetSec: 0.4, durationMs: 1200, payload: { args: { query: "pgvector alternatives" } } },
        { source: "web_search", target: "Web Search", type: "tool_result", label: "3 results", offsetSec: 1.6, durationMs: 5, payload: { results: ["pgvector", "neon", "timescale"] } },
        { source: "Web Search", target: "fetch_page", type: "tool_call", label: "fetch_page #1", offsetSec: 1.8, durationMs: 4000, payload: { args: { url: "neon" } } },
        { source: "fetch_page", target: "Web Search", type: "error", label: "fetch failed (429)", offsetSec: 5.8, durationMs: 2, status: "error", payload: { error: "HTTP 429", message: "rate limited by source" } },
        { source: "Web Search", target: "Orchestrator", type: "error", label: "sub-agent failed", offsetSec: 5.9, durationMs: 10, status: "error", payload: { error: "could not gather enough sources" } },
        { source: "Orchestrator", target: "User", type: "final_answer", label: "partial answer", offsetSec: 5.95, durationMs: 80, payload: { answer: "I ran into rate limits while researching this. pgvector remains the standard; want me to retry?" } },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Project 3: Code Review Bot (triggered by PR webhook)
// ---------------------------------------------------------------------------
const codeReviewBot: SeedProject = {
  name: "Code Review Bot",
  description:
    "Triggered by a PR webhook: fetches the diff, runs LLM analysis, posts a comment, and emits a final approval status.",
  runs: [
    {
      name: "PR #142 — feat: add retry logic to payment client",
      status: "completed",
      durationLabel: "6.3s",
      events: [
        { source: "User", target: "Orchestrator", type: "handoff", label: "PR webhook", offsetSec: 0, durationMs: 60, payload: { pr: 142, action: "opened", repo: "acme/payments" } },
        { source: "Orchestrator", target: "fetch_diff", type: "tool_call", label: "fetch_diff(pr=142)", offsetSec: 0.2, durationMs: 540, payload: { args: { pr: 142 } } },
        { source: "fetch_diff", target: "Orchestrator", type: "tool_result", label: "+218 / -64", offsetSec: 0.75, durationMs: 4, payload: { files: 3, additions: 218, deletions: 64 } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "analyze diff", offsetSec: 0.9, durationMs: 3200, payload: { prompt: "Review this diff for bugs and style...", prompt_tokens: 736, completion_tokens: 1104, total_tokens: 1840, result: "Retry logic is sound; consider exponential backoff. Line 42 missing error log." } },
        { source: "Orchestrator", target: "post_comment", type: "tool_call", label: "post_comment(pr=142)", offsetSec: 4.2, durationMs: 760, payload: { args: { pr: 142, body: "## Review\n- Consider exponential backoff\n- Add error log at L42" } } },
        { source: "post_comment", target: "Orchestrator", type: "tool_result", label: "comment posted", offsetSec: 5.0, durationMs: 4, payload: { commentId: 9912, url: "github.com/acme/payments/pull/142#issuecomment-9912" } },
        { source: "Orchestrator", target: "User", type: "final_answer", label: "approved with comments", offsetSec: 5.1, durationMs: 70, payload: { answer: "Approved with comments — see review on PR #142.", status: "approved_with_comments" } },
      ],
    },
    {
      name: "PR #143 — chore: bump deps",
      status: "completed",
      durationLabel: "3.9s",
      events: [
        { source: "User", target: "Orchestrator", type: "handoff", label: "PR webhook", offsetSec: 0, durationMs: 50, payload: { pr: 143, action: "opened", repo: "acme/payments" } },
        { source: "Orchestrator", target: "fetch_diff", type: "tool_call", label: "fetch_diff(pr=143)", offsetSec: 0.2, durationMs: 380, payload: { args: { pr: 143 } } },
        { source: "fetch_diff", target: "Orchestrator", type: "tool_result", label: "+12 / -12", offsetSec: 0.6, durationMs: 3, payload: { files: 1, additions: 12, deletions: 12 } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "analyze diff", offsetSec: 0.75, durationMs: 1900, payload: { prompt_tokens: 168, completion_tokens: 252, total_tokens: 420, result: "Dependency bumps only. No behavioral changes." } },
        { source: "Orchestrator", target: "post_comment", type: "tool_call", label: "post_comment(pr=143)", offsetSec: 2.7, durationMs: 560, payload: { args: { pr: 143, body: "LGTM — dependency bumps only." } } },
        { source: "post_comment", target: "Orchestrator", type: "tool_result", label: "comment posted", offsetSec: 3.3, durationMs: 3, payload: { commentId: 9918 } },
        { source: "Orchestrator", target: "User", type: "final_answer", label: "approved", offsetSec: 3.35, durationMs: 50, payload: { answer: "Approved — dependency bumps only.", status: "approved" } },
      ],
    },
    {
      name: "PR #144 — fix: null check in order lookup",
      status: "completed",
      durationLabel: "5.1s",
      events: [
        { source: "User", target: "Orchestrator", type: "handoff", label: "PR webhook", offsetSec: 0, durationMs: 55, payload: { pr: 144, action: "opened", repo: "acme/payments" } },
        { source: "Orchestrator", target: "fetch_diff", type: "tool_call", label: "fetch_diff(pr=144)", offsetSec: 0.2, durationMs: 460, payload: { args: { pr: 144 } } },
        { source: "fetch_diff", target: "Orchestrator", type: "tool_result", label: "+8 / -2", offsetSec: 0.65, durationMs: 3, payload: { files: 1, additions: 8, deletions: 2 } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "analyze diff", offsetSec: 0.8, durationMs: 2600, payload: { prompt_tokens: 392, completion_tokens: 588, total_tokens: 980, result: "Null check added correctly. Suggest early return for clarity." } },
        { source: "Orchestrator", target: "post_comment", type: "tool_call", label: "post_comment(pr=144)", offsetSec: 3.4, durationMs: 690, payload: { args: { pr: 144, body: "## Review\n- Null check correct\n- Consider early return" } } },
        { source: "post_comment", target: "Orchestrator", type: "tool_result", label: "comment posted", offsetSec: 4.1, durationMs: 3, payload: { commentId: 9925 } },
        { source: "Orchestrator", target: "User", type: "final_answer", label: "approved with comments", offsetSec: 4.15, durationMs: 60, payload: { answer: "Approved with comments.", status: "approved_with_comments" } },
      ],
    },
    {
      name: "PR #145 — refactor: rework auth middleware",
      status: "failed",
      durationLabel: "4.7s",
      events: [
        { source: "User", target: "Orchestrator", type: "handoff", label: "PR webhook", offsetSec: 0, durationMs: 60, payload: { pr: 145, action: "opened", repo: "acme/payments" } },
        { source: "Orchestrator", target: "fetch_diff", type: "tool_call", label: "fetch_diff(pr=145)", offsetSec: 0.2, durationMs: 820, payload: { args: { pr: 145 } } },
        { source: "fetch_diff", target: "Orchestrator", type: "tool_result", label: "+640 / -512", offsetSec: 1.0, durationMs: 4, payload: { files: 12, additions: 640, deletions: 512 } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "analyze diff", offsetSec: 1.2, durationMs: 3000, payload: { prompt_tokens: 1680, completion_tokens: 2520, total_tokens: 4200, result: "Large refactor. Potential regression: session invalidation removed at L210." } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "second pass (security)", offsetSec: 4.2, durationMs: 280, payload: { prompt_tokens: 216, completion_tokens: 324, total_tokens: 540, result: "Confirm: session invalidation path removed — request changes." } },
        { source: "Orchestrator", target: "post_comment", type: "tool_call", label: "post_comment(pr=145)", offsetSec: 4.5, durationMs: 180, payload: { args: { pr: 145, body: "## Request changes\n- Session invalidation removed at L210" } } },
        { source: "Orchestrator", target: "User", type: "error", label: "changes requested", offsetSec: 4.7, durationMs: 30, status: "error", payload: { error: "CHANGES_REQUESTED", answer: "Requesting changes — session invalidation path was removed.", status: "changes_requested" } },
      ],
    },
    {
      name: "PR #146 — docs: update README",
      status: "completed",
      durationLabel: "2.8s",
      events: [
        { source: "User", target: "Orchestrator", type: "handoff", label: "PR webhook", offsetSec: 0, durationMs: 45, payload: { pr: 146, action: "opened", repo: "acme/payments" } },
        { source: "Orchestrator", target: "fetch_diff", type: "tool_call", label: "fetch_diff(pr=146)", offsetSec: 0.2, durationMs: 300, payload: { args: { pr: 146 } } },
        { source: "fetch_diff", target: "Orchestrator", type: "tool_result", label: "+40 / -6", offsetSec: 0.5, durationMs: 3, payload: { files: 1, additions: 40, deletions: 6 } },
        { source: "Orchestrator", target: "LLM", type: "llm_call", label: "analyze diff", offsetSec: 0.6, durationMs: 1200, payload: { prompt_tokens: 128, completion_tokens: 192, total_tokens: 320, result: "Docs only. Clear and accurate." } },
        { source: "Orchestrator", target: "post_comment", type: "tool_call", label: "post_comment(pr=146)", offsetSec: 1.8, durationMs: 420, payload: { args: { pr: 146, body: "LGTM — docs look good." } } },
        { source: "post_comment", target: "Orchestrator", type: "tool_result", label: "comment posted", offsetSec: 2.2, durationMs: 3, payload: { commentId: 9931 } },
        { source: "Orchestrator", target: "User", type: "final_answer", label: "approved", offsetSec: 2.25, durationMs: 40, payload: { answer: "Approved — docs only.", status: "approved" } },
      ],
    },
  ],
}

const SEED_PROJECTS: SeedProject[] = [customerSupport, researchAssistant, codeReviewBot]

export async function seedDemoData(userId: string) {
  // Idempotent: skip if user already has projects
  const existing = await db.project.count({ where: { userId } })
  if (existing > 0) return

  const now = Date.now()

  for (const sp of SEED_PROJECTS) {
    const project = await db.project.create({
      data: {
        name: sp.name,
        description: sp.description,
        userId,
      },
    })

    // Create an API key for the project
    const rawKey = generateApiKey()
    await db.apiKey.create({
      data: {
        projectId: project.id,
        keyHash: hashApiKey(rawKey),
        prefix: keyPrefix(rawKey),
        label: "Default key",
      },
    })

    for (const [runIdx, sr] of sp.runs.entries()) {
      const startedAt = new Date(now - (SEED_PROJECTS.length * 24 * 60 * 60 * 1000) + (runIdx * 6 * 60 * 60 * 1000))
      const totalMs = sr.events.reduce((acc, e) => Math.max(acc, (e.offsetSec + (e.durationMs || 0) / 1000) * 1000), 0)
      const endedAt = new Date(startedAt.getTime() + totalMs)
      const run = await db.run.create({
        data: {
          projectId: project.id,
          name: sr.name,
          status: sr.status,
          startedAt,
          endedAt: sr.status === "completed" || sr.status === "failed" ? endedAt : null,
        },
      })

      let seq = 0
      for (const ev of sr.events) {
        const ts = new Date(startedAt.getTime() + ev.offsetSec * 1000)
        await db.event.create({
          data: {
            runId: run.id,
            timestamp: ts,
            seq: seq++,
            source: ev.source,
            target: ev.target,
            type: ev.type,
            label: ev.label || null,
            payload: JSON.stringify(ev.payload),
            durationMs: ev.durationMs ?? null,
            status: ev.status || "ok",
          },
        })
      }
    }
  }
}

// Get the raw demo API key for a project (for the integration snippet).
// Returns null if not found. We don't store the raw key after seeding, so
// integration snippets show a placeholder unless the user regenerates.
export async function getDemoKeyHint(projectId: string) {
  const key = await db.apiKey.findFirst({ where: { projectId } })
  return key?.prefix ?? null
}
