import { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.json({
    name: "framework-learning",
    description: "Learn and answer questions from any framework documentation website quickly and accurately.",
    version: "1.0.0",
    author: "Yuva",
    input_schema: {
      type: "object",
      properties: {
        text: { 
          type: "string", 
          description: "Framework documentation URL (SEED_URL) or a specific question about the framework."
        }
      },
      required: ["text"]
    },
    output_schema: {
      type: "object",
      properties: {
        result: { type: "string" }
      }
    }
  });
}
