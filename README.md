# GenAI RAG Application

This project is a Retrieval-Augmented Generation (RAG) system built with Node.js, Express, LangChain, and Google Gemini. It allows users to ask questions against a specific PDF document (university ordinance) using vector search for context retrieval.

## Features

- **PDF Ingestion**: Parses and chunks PDF documents.
- **Vector Search**: Uses Pinecone to store and retrieve vector embeddings of the document chunks.
- **AI-Powered Q&A**: Uses Google's Gemini 1.5 Flash model to generate answers based on the retrieved context.
- **Conversation Memory**: Maintains a simple session history for follow-up questions (in-memory).
- **Web Interface**: Simple frontend to interact with the chat bot.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- A [Google AI Javascript API Key](https://aistudio.google.com/)
- A [Pinecone](https://www.pinecone.io/) API Key and Index

## Installation

1.  **Clone the repository** (if applicable) or download the source code.
2.  **Install dependencies**:
    ```bash
    npm install
    ```

## Configuration

1.  Create a `.env` file in the root directory.
2.  Add your API keys to the `.env` file:
    ```env
    GEMINI_API_KEY=your_google_ai_api_key
    PINECONE_API_KEY=your_pinecone_api_key
    PINECONE_INDEX_NAME=your_index_name
    ```

## Usage

### 1. Ingest Data
Before running the server, you need to process the PDF and store the embeddings in Pinecone.

```bash
node index.js
```
*Note: Ensure `ordinance.pdf` is present in the root directory or update the path in `index.js`.*

### 2. Start the Server
Run the Express server:

```bash
npm start
```
The server will start at `http://localhost:3000`.

### 3. Use the Application
Open your browser and navigate to `http://localhost:3000`. You can now chat with the AI about the contents of the uploaded PDF.

## Project Structure

- `server.js`: Main Express server handling API requests and chat logic.
- `index.js`: Script for loading PDF, splitting text, and indexing embeddings to Pinecone.
- `public/`: Contains static frontend files (`index.html`, `style.css`, `script.js`).
- `ordinance.pdf`: The source document for the RAG system.
