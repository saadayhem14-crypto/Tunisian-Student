export enum BotRole {
  CODING = 'CODING',
  RESUME = 'RESUME',
  PRESENTATION = 'PRESENTATION',
  ORGANIZER = 'ORGANIZER',
  QUIZZ = 'QUIZZ',
  EXERCICES = 'EXERCICES'
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
}

export interface QuizSession {
  questions: QuizQuestion[];
  currentIndex: number;
  userAnswers: number[];
  score: number;
  isComplete: boolean;
  topic: string;
}

export interface VisualAidData {
  title: string;
  points: string[];
  imageUrl: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  imageUrl?: string;
  isImage?: boolean;
  generatedImageUrl?: string;
  visualAid?: VisualAidData;
  isQuizTrigger?: boolean; // New field to identify quiz generation response
}

export interface BotConfig {
  id: BotRole;
  name: string;
  description: string;
  icon: string;
  systemInstruction: string;
  color: string;
  model: string;
}