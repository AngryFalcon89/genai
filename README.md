
# AI-Powered University Chatbot

This is a Retrieval-Augmented Generation (RAG) chatbot that answers questions about university courses, ordinances, and policies using a **Markdown-based** knowledge base.

## Features
- **Local Vectors:** Uses `@xenova/transformers` for free, local embeddings.
- **Markdown Indexing:** Reads `document.md` to build the knowledge base.
- **Groq LLM:** Uses Llama 3 via Groq for fast, intelligent responses.
- **Clean Interface:** Provides a simple chat UI.

## Setup

1.  **Clone the Repository** and install dependencies:
    ```bash
    npm install
    ```

2.  **Configure Environment Variables**:
    Create a `.env` file and add your Groq API key:
    ```env
    GROQ_API_KEY=your_api_key_here
    ```

3.  **Build the Index**:
    This process reads `document.md` and creates the vector database.
    ```bash
    node index.js
    ```

4.  **Start the Server**:
    Run the application and open `http://localhost:3000`.
    ```bash
    npm start
    ```

5.  **Use It**:
    Open your browser and start asking questions!

## Updating Knowledge
To add or modify information, imply edit `document.md` and re-run:
```bash
node index.js
```
Then restart the server.
