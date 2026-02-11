# 🎓 University GenAI Assistant

A Retrieval-Augmented Generation (RAG) chatbot that answers questions about university policies, academic ordinances, and regulations by searching through PDF documents using AI.

![University Assistant Chat Interface](/Users/ahmadbilalzaidi/.gemini/antigravity/brain/000dbe2a-b961-4d7f-9a77-89176fc39e0e/assistant_professor_workload_1770789332762.png)

## ✨ Features

- **PDF-Powered Q&A** — Ask questions and get answers sourced directly from university documents
- **Conversational Memory** — Supports follow-up questions with chat history context
- **Vector Search** — Uses Pinecone to find the most relevant document sections
- **Local Embeddings** — Runs embedding model locally (no external API needed)
- **Markdown Rendering** — AI responses are formatted with headers, lists, and code blocks
- **Modern Web UI** — Clean, responsive chat interface

## 🛠️ Tech Stack

### 🧠 LLM (Chat)
| | |
|---|---|
| **Provider** | [Groq](https://groq.com) |
| **Model** | `llama-3.3-70b-versatile` (Meta's Llama 3.3, 70 billion parameters) |
| **Context Window** | 128K tokens |
| **Cost** | Free tier — 30 req/min, 14,400 req/day |
| **SDK** | `groq-sdk` (npm) |

### 📐 Embeddings (Vector Search)
| | |
|---|---|
| **Provider** | Local — runs on your machine, no API needed |
| **Model** | `all-mpnet-base-v2` via [@xenova/transformers](https://github.com/xenova/transformers.js) |
| **Dimensions** | 768 |
| **Cost** | Completely free (runs locally) |

### 🗄️ Vector Database
| | |
|---|---|
| **Provider** | [Pinecone](https://pinecone.io) |
| **Index** | `virtual-assistant` |
| **Records** | 1,081 chunks from `ordinance.pdf` |
| **Cost** | Free Starter plan |

### 🌐 Frontend & Backend
| | |
|---|---|
| **Server** | Express.js (Node.js) |
| **Frontend** | Vanilla HTML, CSS, JavaScript |
| **Markdown** | `marked` library (CDN) |
| **PDF Parsing** | LangChain `PDFLoader` + `RecursiveCharacterTextSplitter` |

## 📁 Project Structure

```
GenAI/
├── server.js          # Express server with RAG pipeline
├── index.js           # PDF ingestion and Pinecone indexing script
├── ordinance.pdf      # Source PDF document
├── package.json
├── .env               # API keys (not committed)
└── public/
    ├── index.html     # Chat UI
    ├── style.css      # Styling
    └── script.js      # Frontend logic
```

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A free [Groq API Key](https://console.groq.com/keys) (no credit card needed)
- A free [Pinecone API Key](https://app.pinecone.io/) and Index

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_groq_api_key
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_ENVIRONMENT=us-east-1
PINECONE_INDEX_NAME=your_index_name
```

### 3. Index the PDF

This processes the PDF, generates embeddings locally, and stores them in Pinecone. Only needed once (or when the PDF changes).

```bash
node index.js
```

> **Note:** The first run downloads the embedding model (~100MB). Subsequent runs use the cached model. Indexing ~1000 chunks takes about 10 minutes.

### 4. Start the Server

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser and start chatting!

## 🔄 How It Works (RAG Pipeline)

```
User Question
     │
     ▼
┌─────────────────┐
│  Query Rewrite   │ ← Groq rewrites follow-ups into standalone questions
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Local Embedding │ ← all-mpnet-base-v2 converts text → 768-dim vector
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Pinecone Search │ ← Finds top 10 most relevant PDF chunks
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Groq (Llama 3.3)│ ← Generates answer using retrieved context only
└────────┬────────┘
         │
         ▼
   AI Response
```

## 📝 Notes

- **Free tier limits**: Groq provides 30 requests/minute and 14,400 requests/day on the free plan
- **No Google dependency**: The app originally used Google Gemini but was migrated to Groq + local embeddings to avoid regional API restrictions
- **In-memory history**: Chat history is stored in memory and resets when the server restarts
- **First request delay**: The first chat request after server start may take a few extra seconds as the embedding model loads into memory

## 📄 License

ISC
