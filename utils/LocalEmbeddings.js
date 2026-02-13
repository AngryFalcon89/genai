import { pipeline } from '@xenova/transformers';

class LocalEmbeddings {
    constructor() {
        this.model = 'Xenova/all-mpnet-base-v2';
        this.pipeline = null;
    }

    async ensurePipeline() {
        if (!this.pipeline) {
            console.log('Loading embedding model...');
            this.pipeline = await pipeline('feature-extraction', this.model);
            console.log('Embedding model loaded.');
        }
    }

    async embedDocuments(documents) {
        await this.ensurePipeline();
        const embeddings = [];
        for (const doc of documents) {
            const output = await this.pipeline(doc, { pooling: 'mean', normalize: true });
            embeddings.push(Array.from(output.data));
        }
        return embeddings;
    }

    async embedQuery(text) {
        await this.ensurePipeline();
        const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    }
}


export { LocalEmbeddings };

