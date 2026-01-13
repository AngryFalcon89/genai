import * as dotenv from 'dotenv';
dotenv.config();
import readlineSync from 'readline-sync';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { Pinecone } from '@pinecone-database/pinecone';

const pinecone = new Pinecone();
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({});
const History = []

async function transformQuery(question){
    History.push({
        role:'user',
        parts:[{text:question}]
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

async function chatting(question){
    //convert query into vector
    const queries = await transformQuery(question);
    const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GEMINI_API_KEY,
    model: 'text-embedding-004',
    });
 
    const queryVector = await embeddings.embedQuery(queries); 

    //make connection to pinecone and query
    const pinecone = new Pinecone();
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME);

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
        role:'user',
        parts:[{text:queries}]
    })  
    const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: History,
        config: {
            systemInstruction: `You will be given a "Student Query" and a "Context" block containing retrieved university documents (like academic policies, course prerequisites, and schedules). Your answer MUST be based only on the information within that "Context". Do not use any external knowledge. Do not make assumptions or guess if the information is not in the "Context". If the "Context" does not contain the information needed to answer the query, you must respond with: "I'm sorry, I don't have the specific information about that. I recommend contacting your academic advisor for assistance". While your information source is technical, your tone should be helpful and easy to understand, as if you are assisting a confused student. Your expertise is limited to course enrollment, prerequisites, eligibility, credit limits, and academic policies. Context: ${context}`,
        },
    });


    History.push({
        role:'model',
        parts:[{text:response.text}]
    })

    console.log("\n");
    console.log(response.text);
}
 
async function main(){
   const userProblem = readlineSync.question("Ask me anything--> ");
   await chatting(userProblem);
   main();
}


main();