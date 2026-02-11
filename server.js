import * as dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import { Pinecone } from '@pinecone-database/pinecone';
import { pipeline } from '@xenova/transformers';

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pinecone = new Pinecone();
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';

let History = [];

// Initialize embedding model (runs locally, no API key needed)
// First call will download the model (~100MB), subsequent calls use cache
let embeddingPipeline = null;

async function getEmbedding(text) {
    if (!embeddingPipeline) {
        console.log('Loading embedding model (first time may take a moment)...');
        embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2');
        console.log('Embedding model loaded.');
    }
    const output = await embeddingPipeline(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}

async function transformQuery(question) {
    const messages = [
        {
            role: 'system',
            content: `You are a query rewriting expert. Based on the provided chat history, rephrase the "Follow Up user Question" into a complete, standalone question that can be understood without the chat history. Only output the rewritten question and nothing else.`
        },
        ...History,
        { role: 'user', content: question }
    ];

    const response = await groq.chat.completions.create({
        model: MODEL,
        messages: messages,
        temperature: 0.3,
        max_tokens: 256,
    });

    return response.choices[0].message.content;
}

async function getChatResponse(question) {
    // Step 1: Rewrite the query for standalone context
    const rewrittenQuery = await transformQuery(question);

    // Step 2: Convert query into embedding vector (runs locally)
    const queryVector = await getEmbedding(rewrittenQuery);

    // Step 3: Query Pinecone for relevant context
    const searchResults = await pineconeIndex.query({
        topK: 10,
        vector: queryVector,
        includeMetadata: true,
    });

    const context = searchResults.matches
        .map(match => match.metadata.text)
        .join("\n\n---\n\n");

    // Step 4: Send to Groq with context
    History.push({ role: 'user', content: rewrittenQuery });

    const messages = [
        {
            role: 'system',
            content: `You will be given a "Student Query" and a "Context" block containing retrieved university documents (like academic policies, course prerequisites, and schedules). Your answer MUST be based only on the information within that "Context". Do not use any external knowledge. Do not make assumptions or guess if the information is not in the "Context". If the "Context" does not contain the information needed to answer the query, you must respond with: "I'm sorry, I don't have the specific information about that. I recommend contacting your academic advisor for assistance". While your information source is technical, your tone should be helpful and easy to understand, as if you are assisting a confused student. Your expertise is limited to course enrollment, prerequisites, eligibility, credit limits, and academic policies. Context: ${context}`
        },
        ...History
    ];

    const response = await groq.chat.completions.create({
        model: MODEL,
        messages: messages,
        temperature: 0.5,
        max_tokens: 2048,
    });

    const assistantMessage = response.choices[0].message.content;

    History.push({ role: 'assistant', content: assistantMessage });

    return assistantMessage;
}

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        const response = await getChatResponse(message);
        res.json({ response });
    } catch (error) {
        console.error('Error processing chat:', error);
        const errorMessage = error?.message || 'Internal server error';
        if (error?.status === 429) {
            res.status(429).json({ error: 'API quota exceeded. Please wait a moment and try again.' });
        } else if (error?.status === 400 || error?.status === 401) {
            res.status(error.status).json({ error: 'API key is invalid. Please check your GROQ_API_KEY in the .env file.' });
        } else {
            res.status(500).json({ error: errorMessage });
        }
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
