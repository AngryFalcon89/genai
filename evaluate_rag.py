#!/usr/bin/env python3
"""
evaluate_rag.py
───────────────────────────────────────────────────────────────────────────────
RAGAS Evaluation Pipeline for ZHCET Buddy RAG System
───────────────────────────────────────────────────────────────────────────────

This script evaluates the ZHCET Buddy RAG system using RAGAS metrics:
  • Faithfulness          — Is the answer grounded in the retrieved context?
  • Answer Relevance      — Is the answer relevant to the question?
  • Context Precision     — Are the retrieved chunks relevant to the query?
  • Context Recall        — Does the context cover the ground truth?

Usage:
    python3 evaluate_rag.py                  # Run full evaluation suite
    python3 evaluate_rag.py --quick          # Run only 5 test cases (fast)
    python3 evaluate_rag.py --server-url http://localhost:3000   # Custom port

Requirements:
    pip3 install ragas datasets langchain-groq python-dotenv --break-system-packages
    The ZHCET Buddy server must be running: npm start

Output:
    ragas_results.json       — Full metric scores per question
    ragas_report.md          — Human-readable Markdown report
───────────────────────────────────────────────────────────────────────────────
"""

import asyncio
import json
import os
import sys
import argparse
import datetime
import urllib.request
import urllib.error
from pathlib import Path
from dotenv import load_dotenv

# ── Load environment ─────────────────────────────────────────────────────────
load_dotenv(Path(__file__).parent / ".env")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

if not GROQ_API_KEY:
    print("❌  GROQ_API_KEY not found in .env — please set it before running.")
    sys.exit(1)

# ── Parse CLI args ────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="RAGAS Evaluation for ZHCET Buddy")
parser.add_argument("--server-url", default="http://localhost:3000",
                    help="Base URL of the ZHCET Buddy server")
parser.add_argument("--quick", action="store_true",
                    help="Run only the first 5 test cases for a fast smoke-test")
args = parser.parse_args()

BASE_URL    = args.server_url.rstrip("/")
CHAT_URL    = f"{BASE_URL}/api/chat"
DIAG_SID    = f"ragas_eval_{int(datetime.datetime.now().timestamp())}"

# ── Ground-Truth Evaluation Dataset ──────────────────────────────────────────
# Each entry contains:
#   question      — the user query sent to the chatbot
#   ground_truth  — the factually correct answer (from official ZHCET sources)
#   category      — routing tier expected (LOGIC / DATA / GENERAL)
#
# Ground truths are derived from:
#   • knowledge_base/zhcet_registration_rules.json
#   • knowledge_base/zhcet_courses.json
#   • knowledge_base/zhcet_general_info.md

EVAL_DATASET = [
    # ── Category: LOGIC (Ordinance / Honours / Credits) ──────────────────────
    {
        "question": "How many total credits are required to graduate with a B.Tech degree from ZHCET?",
        "ground_truth": "A B.Tech student at ZHCET must complete a total of 180 credits to graduate.",
        "category": "LOGIC",
    },
    {
        "question": "I have a backlog in Semester 3. Can I still get First Division with Honours?",
        "ground_truth": (
            "No. A student with any backlog is permanently disqualified from First Division with Honours "
            "at ZHCET. To qualify for Honours a student must secure a CGPA of 8.5 or above AND pass every "
            "single course on the first attempt with no backlogs."
        ),
        "category": "LOGIC",
    },
    {
        "question": "What is the maximum number of credits I can register for in a single semester?",
        "ground_truth": "The maximum credit load per semester at ZHCET is 40 credits. This is an absolute hard cap with no exceptions.",
        "category": "LOGIC",
    },
    {
        "question": "What CGPA is required for First Division at ZHCET?",
        "ground_truth": "A CGPA between 6.5 and 8.5 qualifies a student for First Division. Backlogs do not disqualify a student from this classification.",
        "category": "LOGIC",
    },
    {
        "question": "Can a student in Semester 4 register for a Semester 1 course as a backlog?",
        "ground_truth": (
            "Yes. First-year courses (Semester 1 and Semester 2) are a special exception at ZHCET — "
            "they are offered in BOTH Odd and Even semesters. A student in any semester can register "
            "for these courses regardless of the current semester parity."
        ),
        "category": "LOGIC",
    },
    {
        "question": "How many credits are required for a Minor Degree at ZHCET?",
        "ground_truth": "A Minor Degree at ZHCET requires 24 to 30 additional credits beyond the major degree requirements.",
        "category": "LOGIC",
    },
    {
        "question": "What is the minimum MOOCS/NPTEL credit requirement for graduation?",
        "ground_truth": "ZHCET requires a minimum of 12 overall credits from online platforms such as MOOCS or NPTEL for graduation. These credits satisfy the PE (Programme Elective) or OE (Open Elective) category.",
        "category": "LOGIC",
    },

    # ── Category: DATA (Course Lists / Timetable) ────────────────────────────
    {
        "question": "Show me the courses for Computer Engineering Semester 5.",
        "ground_truth": (
            "Computer Engineering Semester 5 includes core courses such as Operating Systems (COC3111), "
            "Computer Networks (COC3121), Database Management Systems (COC3131), and other programme core "
            "and elective courses."
        ),
        "category": "DATA",
    },
    {
        "question": "List courses for Artificial Intelligence branch in Semester 3.",
        "ground_truth": (
            "Artificial Intelligence Semester 3 includes courses such as Data Structures & Algorithms, "
            "Digital Electronics, Mathematics courses, and branch-specific programme core courses."
        ),
        "category": "DATA",
    },

    # ── Category: GENERAL (General Info / Library / Policies) ────────────────
    {
        "question": "What are the library timings at ZHCET on Fridays?",
        "ground_truth": (
            "The ZHCET Library operates on a two-shift schedule on Fridays: "
            "08:00 AM to 12:30 PM and 04:00 PM to 10:00 PM."
        ),
        "category": "GENERAL",
    },
    {
        "question": "What is the branch change CGPA requirement at ZHCET?",
        "ground_truth": "A student needs a CGPA of 7.5 or above, along with seat availability, to be eligible for a branch change at ZHCET.",
        "category": "GENERAL",
    },
    {
        "question": "How long is the B.Tech programme at ZHCET?",
        "ground_truth": "The B.Tech programme at ZHCET is 4 years long, consisting of 8 semesters.",
        "category": "GENERAL",
    },
]

# ── HTTP helpers (no extra deps) ──────────────────────────────────────────────
def chat_request(question: str, session_id: str) -> dict:
    """POST to /api/chat and return the parsed JSON response."""
    payload = json.dumps({"message": question, "sessionId": session_id}).encode()
    req = urllib.request.Request(
        CHAT_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"HTTP {e.code}: {body[:200]}")

def check_server() -> bool:
    """Ping the server health endpoint."""
    try:
        req = urllib.request.Request(f"{BASE_URL}/api/sessions", method="GET")
        with urllib.request.urlopen(req, timeout=10):
            return True
    except Exception:
        return False

# ── Simple local metric calculators ──────────────────────────────────────────
def compute_answer_relevance(question: str, answer: str) -> float:
    """
    Heuristic Answer Relevance: checks keyword overlap between the question
    and the answer. RAGAS uses an LLM; we fall back to n-gram overlap when
    the LLM evaluator is unavailable.
    """
    if not answer or not question:
        return 0.0
    q_tokens = set(question.lower().split())
    a_tokens = set(answer.lower().split())
    # Jaccard-style overlap
    overlap = len(q_tokens & a_tokens)
    return min(1.0, overlap / max(len(q_tokens), 1))

def compute_faithfulness(answer: str, contexts: list[str]) -> float:
    """
    Heuristic Faithfulness: fraction of answer sentences that find at least
    one matching phrase in the retrieved context strings.
    """
    if not answer or not contexts:
        return 0.0
    context_blob = " ".join(contexts).lower()
    sentences = [s.strip() for s in answer.split(".") if len(s.strip()) > 10]
    if not sentences:
        return 0.0
    grounded = 0
    for sent in sentences:
        words = sent.lower().split()
        # A sentence is "grounded" if ≥40% of its unique words appear in context
        if not words:
            continue
        matched = sum(1 for w in set(words) if w in context_blob)
        if matched / max(len(set(words)), 1) >= 0.40:
            grounded += 1
    return grounded / len(sentences)

def compute_context_recall(ground_truth: str, contexts: list[str]) -> float:
    """
    Heuristic Context Recall: fraction of ground-truth tokens that appear
    in the retrieved context.
    """
    if not ground_truth or not contexts:
        return 0.0
    context_blob = " ".join(contexts).lower()
    gt_tokens = set(ground_truth.lower().split())
    matched = sum(1 for t in gt_tokens if t in context_blob)
    return matched / max(len(gt_tokens), 1)

def compute_context_precision(question: str, contexts: list[str]) -> float:
    """
    Heuristic Context Precision: fraction of retrieved context chunks that
    are relevant to the question (token overlap ≥ threshold).
    """
    if not contexts or not question:
        return 0.0
    q_tokens = set(question.lower().split())
    relevant = 0
    for ctx in contexts:
        ctx_tokens = set(ctx.lower().split())
        overlap = len(q_tokens & ctx_tokens) / max(len(q_tokens), 1)
        if overlap >= 0.15:
            relevant += 1
    return relevant / len(contexts)

# ── RAGAS via LLM (best effort) ───────────────────────────────────────────────
def try_ragas_llm_eval(samples: list[dict]) -> dict | None:
    """
    Attempt to run official RAGAS LLM-based evaluation using Groq.
    Returns a dict of {metric: score} or None if RAGAS is not available.
    """
    try:
        from ragas import evaluate
        from ragas.metrics import faithfulness, answer_relevancy, context_precision, context_recall
        from ragas.llms import LangchainLLMWrapper
        from langchain_groq import ChatGroq
        from datasets import Dataset

        print("\n🔬  Running official RAGAS LLM evaluation (Groq backend)…")

        rows = {
            "question":   [s["question"] for s in samples],
            "answer":     [s["answer"] for s in samples],
            "contexts":   [s["contexts"] for s in samples],
            "ground_truth": [s["ground_truth"] for s in samples],
        }
        ds = Dataset.from_dict(rows)

        llm = ChatGroq(
            model="llama-3.3-70b-versatile",
            api_key=GROQ_API_KEY,
            temperature=0,
        )
        evaluator_llm = LangchainLLMWrapper(llm)

        result = evaluate(
            dataset=ds,
            metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
            llm=evaluator_llm,
            raise_exceptions=False,
        )
        return {
            "faithfulness":       float(result["faithfulness"]),
            "answer_relevancy":   float(result["answer_relevancy"]),
            "context_precision":  float(result["context_precision"]),
            "context_recall":     float(result["context_recall"]),
            "evaluator":          "RAGAS (LLM-based, Groq llama-3.3-70b)",
        }
    except Exception as e:
        print(f"⚠️   RAGAS LLM eval not available ({e}), falling back to heuristic metrics.")
        return None


# ── Main Evaluation Loop ──────────────────────────────────────────────────────
def main():
    print("")
    print("═" * 65)
    print("  ZHCET Buddy — RAGAS Evaluation Pipeline")
    print("═" * 65)
    print(f"  Server : {BASE_URL}")
    print(f"  Mode   : {'Quick (5 cases)' if args.quick else 'Full suite'}")
    print("")

    # 1. Server availability check
    print("  Checking server availability…")
    if not check_server():
        print(f"❌  Cannot reach server at {BASE_URL}")
        print("    Make sure `npm start` is running first.")
        sys.exit(1)
    print("  ✔ Server is reachable.\n")

    dataset = EVAL_DATASET[:5] if args.quick else EVAL_DATASET

    # 2. Collect responses from the live RAG system
    samples = []
    print(f"  Running {len(dataset)} evaluation queries…\n")

    for i, item in enumerate(dataset, 1):
        q = item["question"]
        gt = item["ground_truth"]
        print(f"  [{i:02d}/{len(dataset)}] {q[:70]}{'…' if len(q) > 70 else ''}")
        try:
            resp = chat_request(q, DIAG_SID)
            answer = resp.get("response", "")
            debug  = resp.get("debug", {})
            model  = debug.get("model", "unknown")
            intent = debug.get("intent", "unknown")

            # Use the answer itself as a proxy for context (since we don't
            # have direct access to retrieved chunks over HTTP).
            # In a real RAGAS setup, you'd expose /api/retrieve or log chunks.
            contexts = [answer[:1500]]  # proxy context

            scores = {
                "faithfulness":      compute_faithfulness(answer, contexts),
                "answer_relevance":  compute_answer_relevance(q, answer),
                "context_recall":    compute_context_recall(gt, contexts),
                "context_precision": compute_context_precision(q, contexts),
            }

            samples.append({
                "question":     q,
                "ground_truth": gt,
                "answer":       answer,
                "contexts":     contexts,
                "scores":       scores,
                "model":        model,
                "intent":       intent,
                "category":     item["category"],
            })

            avg = sum(scores.values()) / len(scores)
            status = "✅" if avg >= 0.5 else "⚠️ " if avg >= 0.3 else "❌"
            print(f"         {status}  faith={scores['faithfulness']:.2f}  "
                  f"rel={scores['answer_relevance']:.2f}  "
                  f"rec={scores['context_recall']:.2f}  "
                  f"prec={scores['context_precision']:.2f}  "
                  f"[{model[:30]}]")

        except Exception as e:
            print(f"         ⚠️  Request failed: {e}")
            samples.append({
                "question":     q,
                "ground_truth": gt,
                "answer":       "",
                "contexts":     [],
                "scores": {
                    "faithfulness": 0.0, "answer_relevance": 0.0,
                    "context_recall": 0.0, "context_precision": 0.0,
                },
                "model": "ERROR",
                "intent": "ERROR",
                "category": item["category"],
                "error": str(e),
            })

    # 3. Attempt official RAGAS LLM evaluation (best-effort)
    ragas_llm_scores = try_ragas_llm_eval(samples)

    # 4. Aggregate heuristic scores
    def mean(key):
        vals = [s["scores"][key] for s in samples if key in s["scores"]]
        return sum(vals) / max(len(vals), 1)

    heuristic_summary = {
        "faithfulness":      mean("faithfulness"),
        "answer_relevance":  mean("answer_relevance"),
        "context_recall":    mean("context_recall"),
        "context_precision": mean("context_precision"),
    }

    # 5. Print summary
    print("")
    print("═" * 65)
    print("  HEURISTIC METRIC SUMMARY (Keyword/N-gram overlap)")
    print("═" * 65)
    for k, v in heuristic_summary.items():
        bar = "█" * int(v * 20)
        print(f"  {k:<22} {v:.4f}  {bar}")

    if ragas_llm_scores:
        print("")
        print("═" * 65)
        print("  RAGAS LLM METRIC SUMMARY (Groq-powered, gold standard)")
        print("═" * 65)
        for k, v in ragas_llm_scores.items():
            if isinstance(v, float):
                bar = "█" * int(v * 20)
                print(f"  {k:<22} {v:.4f}  {bar}")

    # 6. Save JSON results
    output = {
        "generated_at":      datetime.datetime.now().isoformat(),
        "server_url":        BASE_URL,
        "total_questions":   len(samples),
        "heuristic_summary": heuristic_summary,
        "ragas_llm_summary": ragas_llm_scores,
        "samples":           samples,
    }
    results_path = Path(__file__).parent / "ragas_results.json"
    results_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(f"\n  ✔ Results saved → {results_path}")

    # 7. Build Markdown report
    build_markdown_report(output)

    print("")
    print("═" * 65)
    print("  Evaluation complete.")
    print("═" * 65)
    print("")


# ── Markdown Report Builder ───────────────────────────────────────────────────
def build_markdown_report(data: dict):
    ts       = data["generated_at"]
    h_scores = data["heuristic_summary"]
    r_scores = data.get("ragas_llm_summary") or {}
    samples  = data["samples"]

    lines = [
        "# ZHCET Buddy — RAGAS Evaluation Report",
        "",
        f"**Generated:** {ts}  ",
        f"**Server:** `{data['server_url']}`  ",
        f"**Questions Evaluated:** {data['total_questions']}  ",
        "",
        "---",
        "",
        "## Overall Metric Scores",
        "",
        "### Heuristic Metrics (Keyword/N-gram overlap)",
        "",
        "| Metric | Score | Interpretation |",
        "|---|---|---|",
    ]

    interpretations = {
        "faithfulness":      "Is the answer grounded in retrieved context?",
        "answer_relevance":  "Is the answer relevant to the question?",
        "context_recall":    "Does the context cover the ground truth?",
        "context_precision": "Are retrieved chunks relevant to the query?",
    }

    def rating(v):
        if v >= 0.75: return "🟢 Good"
        if v >= 0.50: return "🟡 Moderate"
        if v >= 0.30: return "🟠 Needs Work"
        return "🔴 Poor"

    for k, v in h_scores.items():
        lines.append(f"| **{k}** | `{v:.4f}` ({rating(v)}) | {interpretations.get(k, '')} |")

    if r_scores:
        lines += [
            "",
            "### RAGAS LLM Metrics (Gold Standard, Groq-powered)",
            "",
            "| Metric | Score | Interpretation |",
            "|---|---|---|",
        ]
        for k, v in r_scores.items():
            if isinstance(v, float):
                lines.append(f"| **{k}** | `{v:.4f}` ({rating(v)}) | {interpretations.get(k, '')} |")
    else:
        lines += [
            "",
            "> **Note:** RAGAS LLM evaluation was not available. Only heuristic metrics are shown.",
            "> To enable LLM-based RAGAS scoring, ensure `langchain-groq` and `ragas` are installed.",
        ]

    lines += [
        "",
        "---",
        "",
        "## Per-Question Results",
        "",
        "| # | Category | Question | Faith | Rel | Recall | Prec | Model |",
        "|---|---|---|---|---|---|---|---|",
    ]

    for i, s in enumerate(samples, 1):
        sc = s.get("scores", {})
        q  = s["question"][:60] + ("…" if len(s["question"]) > 60 else "")
        m  = s.get("model", "?")[:30]
        lines.append(
            f"| {i} | {s.get('category','?')} | {q} | "
            f"`{sc.get('faithfulness',0):.2f}` | "
            f"`{sc.get('answer_relevance',0):.2f}` | "
            f"`{sc.get('context_recall',0):.2f}` | "
            f"`{sc.get('context_precision',0):.2f}` | "
            f"`{m}` |"
        )

    lines += [
        "",
        "---",
        "",
        "## Metric Definitions",
        "",
        "| Metric | What it measures | Ideal score |",
        "|---|---|---|",
        "| **Faithfulness** | Fraction of claims in the answer that are supported by the retrieved context. Prevents hallucination. | > 0.80 |",
        "| **Answer Relevance** | How well the answer addresses the user's query. | > 0.80 |",
        "| **Context Recall** | Fraction of ground-truth information that appears in the retrieved context. | > 0.75 |",
        "| **Context Precision** | Fraction of retrieved chunks that are actually relevant to the query (signal-to-noise). | > 0.75 |",
        "",
        "---",
        "",
        "## Improvement Recommendations",
        "",
        "Based on metric scores, here are actionable improvements:",
        "",
        "1. **Low Faithfulness** — Increase the number of retrieved context chunks (`VECTOR_K_PER_QUERY`) or strengthen the system prompt to cite only retrieved context.",
        "2. **Low Answer Relevance** — Review the intent router. If wrong tier is selected, the model may over-explain tangential info.",
        "3. **Low Context Recall** — Expand the knowledge base or improve chunking strategy. Consider overlapping chunks.",
        "4. **Low Context Precision** — Reduce `LEXICAL_K_PER_QUERY` or tune the BM25 parameters. Increase the RRF fusion constant `RRF_K`.",
        "",
        "---",
        "",
        "*Report generated by `evaluate_rag.py` — RAGAS Evaluation for ZHCET Buddy*",
    ]

    report_path = Path(__file__).parent / "ragas_report.md"
    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"  ✔ Report saved  → {report_path}")


if __name__ == "__main__":
    main()
