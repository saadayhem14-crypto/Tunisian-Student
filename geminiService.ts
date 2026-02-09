import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { BotConfig, QuizQuestion } from "../types";

export interface FileData {
  inlineData: {
    data: string;
    mimeType: string;
  };
}

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  }

  async generateText(
    bot: BotConfig, 
    prompt: string, 
    fileData?: FileData
  ): Promise<string> {
    const parts: any[] = [{ text: prompt }];
    
    if (fileData) {
      parts.unshift(fileData);
    }

    const response = await this.ai.models.generateContent({
      model: bot.model,
      contents: [{ parts }],
      config: {
        systemInstruction: bot.systemInstruction,
        temperature: 0.7,
      },
    });

    return response.text || "Smahni, ma lqitich el kelmet el mnesba tawa.";
  }

  async generateQuiz(topic: string): Promise<QuizQuestion[]> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Generate a professional interactive MCQ quiz about: ${topic}. 
        Provide exactly 5 high-quality questions. 
        Each question must have 4 options. 
        Technical terms like "Logic Gates", "Pointers", "Subnetting" must remain in English. 
        The questions and explanations should be in Tunisian Arabic (Derja) with a professional tone.
        Return JSON format.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: { 
                      type: Type.ARRAY, 
                      items: { type: Type.STRING },
                      minItems: 4,
                      maxItems: 4
                    },
                    correctAnswerIndex: { type: Type.INTEGER },
                    explanation: { type: Type.STRING }
                  },
                  required: ["question", "options", "correctAnswerIndex", "explanation"]
                }
              }
            },
            required: ["questions"]
          }
        }
      });
      const data = JSON.parse(response.text);
      return data.questions;
    } catch (e) {
      console.error("Quiz generation failed", e);
      throw e;
    }
  }

  async extractSlideContent(text: string): Promise<{ title: string; points: string[] }> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Extract a short, catchy Arabic/Tunisian title and 3-4 key bullet points for a professional academic presentation slide from this content. Return JSON.
        Content: ${text.substring(0, 1000)}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              points: { 
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["title", "points"]
          }
        }
      });
      return JSON.parse(response.text);
    } catch (e) {
      return { title: "الملخص الأكاديمي", points: ["نقطة رئيسية 1", "نقطة رئيسية 2"] };
    }
  }

  async generateImage(prompt: string): Promise<string | null> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ 
            text: `STRICTLY NO TEXT. NO LETTERS. NO NUMBERS. BACKGROUND ONLY. 
            A high-quality, professional, and cinematic academic background for a university setting.
            Context: ${prompt}.
            Style: Photorealistic, modern library or workspace, Mediterranean lighting, 8k resolution, soft depth of field. 
            MANDATORY: The image must be completely empty of any text, typography, or written symbols.` 
          }],
        },
        config: {
          imageConfig: {
            aspectRatio: "16:9",
          },
        },
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
      return null;
    } catch (error) {
      console.error("Image generation failed:", error);
      return null;
    }
  }
}

export const gemini = new GeminiService();