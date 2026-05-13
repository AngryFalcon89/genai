# ZHCET Buddy — AI-Powered University Academic Advisor

A **Retrieval-Augmented Generation (RAG)** chatbot for ZHCET (Zakir Husain College of Engineering & Technology), AMU, that answers questions about courses, ordinances, registration rules, timetables, and academic policies.

## Architecture Highlights

| Component | Technology | Role |
|---|---|---|
| **Embeddings** | `@xenova/transformers` (BGE-base) | Free, local HNSW vector search |
| **Lexical Search** | BM25 (custom) | Keyword-level retrieval |
| **Fusion** | Reciprocal Rank Fusion (RRF) | Hybrid semantic + lexical results |
| **LLM Routing** | `llama-3.1-8b-instant` | Lightweight intent classification |
| **Tier 1 (LOGIC)** | `openai/gpt-oss-120b` | Ordinance / honours reasoning |
| **Tier 2 (GENERAL)** | `llama-3.3-70b-versatile` | General info, greetings |
| **Tier 3 (DATA)** | `qwen/qwen3-32b` | Course lists, timetable queries |
| **OCR** | `meta-llama/llama-4-scout-17b` | Registration card extraction |

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```env
   GROQ_API_KEY=your_groq_api_key
   PORT=3000
   ```

3. **Build vector index:**
   ```bash
   node index.js
   ```

4. **Start server:**
   ```bash
   npm start
   ```

## Evaluation (RAGAS)

Run the automated RAGAS evaluation pipeline against the live server:

```bash
# Full evaluation (12 questions across LOGIC, DATA, GENERAL)
python3 evaluate_rag.py

# Quick smoke-test (5 questions only)
python3 evaluate_rag.py --quick
```

**Outputs:**
- `ragas_results.json` — per-question metric scores
- `ragas_report.md`   — human-readable Markdown report

**Install Python dependencies:**
```bash
pip3 install ragas datasets langchain-groq python-dotenv --break-system-packages
```

## Diagnostic Tests

Run the JS-based diagnostic suite (requires server to be running):

```bash
node diagnose_buddy.js
```

Outputs `test_report.md` with per-case pass/fail, latency, and routing info.
