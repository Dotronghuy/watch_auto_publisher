import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const test = async () => {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { responseMimeType: 'application/json' } });
    
    const imageUrl = 'https://picsum.photos/200';
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();
    const b64 = Buffer.from(buffer).toString('base64');
    
    const prompt1 = 'Trả về JSON: { "candidates": ["a"], "message": "b" }';
    const imagePart1 = { inlineData: { data: b64, mimeType: 'image/jpeg' } };
    
    console.log("Calling Gemini...");
    const result1 = await model.generateContent([prompt1, imagePart1]);
    console.log('SUCCESS:', result1.response.text());
  } catch(e) {
    console.log('ERROR:', e.message, e.stack);
  }
};
test();
