import { GoogleGenAI } from "@google/genai";

let _client: GoogleGenAI | null = null;

/** Returns a GoogleGenAI client if GEMINI_API_KEY is configured, null otherwise. */
export function getGeminiClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!_client) _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _client;
}

export const GEMINI_MODEL = "gemini-2.0-flash";
