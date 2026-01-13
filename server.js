import * as dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenAI } from "@google/genai";

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pinecone = new Pinecone();
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);

const ai = new GoogleGenAI({});
// Note: In a real server, history should be managed per session/user. 
// For this simple implementation, we'll keep a global history or reset it per request if needed.
// However, to keep it simple and consistent with the CLI version, we'll use a simple in-memory history.
// Ideally, the frontend should send the history or a session ID.
// For now, let's just keep it simple.
let History = [];

async function transformQuery(question) {
    History.push({
        role: 'user',
        parts: [{ text: question }]
    })
    const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: History,
        config: {
            systemInstruction: `You are a query rewriting expert. Based on the provided chat history, rephrase the "Follow Up user Question" into a complete, standalone question that can be understood without the chat history.
        Only output the rewritten question and nothing else.
        `,
        },
    });
    History.pop()
    return response.text
}

async function getChatResponse(question) {
    //convert query into vector
    const queries = await transformQuery(question);
    const embeddings = new GoogleGenerativeAIEmbeddings({
        apiKey: process.env.GEMINI_API_KEY,
        model: 'text-embedding-004',
    });

    const queryVector = await embeddings.embedQuery(queries);

    //make connection to pinecone and query
    // const pinecone = new Pinecone(); // Already initialized globally
    // const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);

    const searchResults = await pineconeIndex.query({
        topK: 10,
        vector: queryVector,
        includeMetadata: true,
    });

    //prepare context from the search results
    const context = searchResults.matches
        .map(match => match.metadata.text)
        .join("\n\n---\n\n");

    //prepare conversation history
    History.push({
        role: 'user',
        parts: [{ text: queries }]
    })
    const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: History,
        config: {
            systemInstruction: `You will be given a "Student Query" and a "Context" block containing retrieved university documents (like academic policies, course prerequisites, and schedules). Your answer MUST be based only on the information within that "Context". Do not use any external knowledge. Do not make assumptions or guess if the information is not in the "Context". If the "Context" does not contain the information needed to answer the query, you must respond with: "I'm sorry, I don't have the specific information about that. I recommend contacting your academic advisor for assistance". While your information source is technical, your tone should be helpful and easy to understand, as if you are assisting a confused student. Your expertise is limited to course enrollment, prerequisites, eligibility, credit limits, and academic policies. Context: ${context}`,
        },
    });


    History.push({
        role: 'model',
        parts: [{ text: response.text }]
    })

    return response.text;
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
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
