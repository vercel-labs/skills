import { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { text } = req.body || {};

    if (!text) {
        return res.status(400).json({ error: "text is required" });
    }

    // Placeholder logic: echo the input
    // In a future update, this will integrate with the Python crawling scripts.
    const result = `Processed: ${text}`;

    return res.json({ result });
}
