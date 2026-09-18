import { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Handle preflight OPTIONS request if necessary
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.status(200).end();
    }

    const { text } = req.body || {};

    if (!text) {
        return res.status(400).json({ error: "text is required" });
    }

    // Placeholder logic: echo the input
    // In a future update, this will integrate with the Python crawling scripts.
    res.json({
        result: `Received request to process: ${text}. (Note: Python backend integration pending)`
    });
}
