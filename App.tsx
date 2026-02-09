import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BotRole, Message, BotConfig, VisualAidData, QuizQuestion, QuizSession } from './types';
import { BOTS } from './constants';
import { gemini, FileData } from './services/geminiService';

const App: React.FC = () => {
  const [activeBot, setActiveBot] = useState<BotConfig>(BOTS[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [generatingImageId, setGeneratingImageId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{file: File, base64: string, mimeType: string} | null>(null);
  
  // Quiz State
  const [quizSession, setQuizSession] = useState<QuizSession | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, generatingImageId, quizSession]);

  useEffect(() => {
    if (showConfetti) {
      const timer = setTimeout(() => setShowConfetti(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [showConfetti]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleStartQuiz = async (topic: string) => {
    setIsLoading(true);
    try {
      const questions = await gemini.generateQuiz(topic);
      setQuizSession({
        questions,
        currentIndex: 0,
        userAnswers: [],
        score: 0,
        isComplete: false,
        topic
      });
    } catch (error) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        content: "Smahni, ma najamtich naamel l-quiz tawa. Jarreb marra okhra.",
        timestamp: Date.now()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuizAnswer = (index: number) => {
    if (showFeedback || !quizSession) return;
    
    setSelectedOption(index);
    setShowFeedback(true);
    
    const isCorrect = index === quizSession.questions[quizSession.currentIndex].correctAnswerIndex;
    
    setTimeout(() => {
      setQuizSession(prev => {
        if (!prev) return null;
        const isLast = prev.currentIndex === prev.questions.length - 1;
        const newScore = isCorrect ? prev.score + 1 : prev.score;
        
        if (isLast) {
          const finalScorePercent = (newScore / prev.questions.length) * 100;
          if (finalScorePercent >= 80) setShowConfetti(true);
          return {
            ...prev,
            score: newScore,
            userAnswers: [...prev.userAnswers, index],
            isComplete: true
          };
        }
        
        return {
          ...prev,
          currentIndex: prev.currentIndex + 1,
          score: newScore,
          userAnswers: [...prev.userAnswers, index]
        };
      });
      setSelectedOption(null);
      setShowFeedback(false);
    }, 1800); // Slightly faster feedback loop for professional feel
  };

  const handleGenerateVisual = async (msgId: string, contextText: string) => {
    if (generatingImageId) return;
    setGeneratingImageId(msgId);
    
    try {
      const content = await gemini.extractSlideContent(contextText);
      const prompt = `A professional workspace or university library scene, background for a presentation about ${content.title}. NO TEXT.`;
      const imageUrl = await gemini.generateImage(prompt);
      
      if (imageUrl) {
        const visualAid: VisualAidData = {
          title: content.title,
          points: content.points,
          imageUrl: imageUrl
        };
        
        setMessages(prev => prev.map(m => 
          m.id === msgId ? { ...m, visualAid } : m
        ));
      }
    } catch (error) {
      console.error("Failed to generate visual aid:", error);
    } finally {
      setGeneratingImageId(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      setSelectedFile({
        file,
        base64,
        mimeType: file.type
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSend = async () => {
    if ((!inputText.trim() && !selectedFile) || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputText || (selectedFile ? `Fichier attaché: ${selectedFile.file.name}` : ''),
      timestamp: Date.now(),
      imageUrl: selectedFile?.mimeType.startsWith('image/') ? `data:${selectedFile.mimeType};base64,${selectedFile.base64}` : undefined,
      isImage: selectedFile?.mimeType.startsWith('image/'),
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = inputText;
    const currentFile = selectedFile;
    
    setInputText('');
    setSelectedFile(null);
    setIsLoading(true);

    try {
      let fileData: FileData | undefined = undefined;
      if (currentFile) {
        fileData = {
          inlineData: {
            data: currentFile.base64,
            mimeType: currentFile.mimeType
          }
        };
      }

      // Quiz bot trigger
      if (activeBot.id === BotRole.QUIZZ && (currentInput.toLowerCase().includes('quiz') || currentInput.toLowerCase().includes('كويز') || currentInput.toLowerCase().includes('تست'))) {
        await handleStartQuiz(currentInput);
        return;
      }

      const response = await gemini.generateText(activeBot, currentInput || "Analyze input.", fileData);
      
      const modelMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        content: response,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, modelMessage]);

      const lowerInput = currentInput.toLowerCase();
      const needsVisual = ['صورة', 'وريني', 'شيمة', 'visuel', 'image', 'تصويرة', 'diagramme', 'visualise'].some(kw => lowerInput.includes(kw));
      
      if (needsVisual) {
        handleGenerateVisual(modelMessage.id, response);
      }

    } catch (error) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'model',
        content: "فما مشكلة تقنية صغيرة. عاود جرب مرة أخرى يا بطل.",
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const CircularScore = ({ score, total }: { score: number, total: number }) => {
    const percentage = (score / total) * 100;
    const strokeDashoffset = 251.2 - (251.2 * percentage) / 100;
    return (
      <div className="relative w-40 h-40 mx-auto">
        <svg className="w-full h-full transform -rotate-90">
          <circle cx="80" cy="80" r="60" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-white/5" />
          <circle 
            cx="80" 
            cy="80" 
            r="60" 
            stroke="currentColor" 
            strokeWidth="12" 
            fill="transparent" 
            strokeDasharray="377" 
            strokeDashoffset={377 - (377 * percentage) / 100} 
            strokeLinecap="round" 
            className={`${percentage >= 80 ? 'text-emerald-500' : percentage >= 50 ? 'text-amber-500' : 'text-rose-500'} transition-all duration-1000 ease-out`} 
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-black text-white">{score}/{total}</span>
          <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mt-1">Note Finale</span>
        </div>
      </div>
    );
  };

  const getFeedbackMessage = (score: number, total: number) => {
    const p = (score / total) * 100;
    if (p === 100) return "يا بطل! جِبتهم الكل صحيحة. إنت مَلِك الـ " + quizSession?.topic + "!";
    if (p >= 80) return "برافو! خدمة ممتازة، بقاتلك تفتوفة صغيرة وتولي طَيّارة.";
    if (p >= 50) return "موش خايب، أما تنجم تعمل ما خير. عاود راجع الدروس شوية.";
    return "لازمك تزيد تخدم يا باهي. مايسالش، كلنا نتعلمو. عاود جرب!";
  };

  return (
    <div className="flex h-screen overflow-hidden text-slate-100 selection:bg-indigo-500/30">
      {/* Confetti Effect */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-[100] flex items-center justify-center overflow-hidden">
          {[...Array(60)].map((_, i) => (
            <div 
              key={i} 
              className="absolute w-2.5 h-2.5 rounded-sm animate-bounce"
              style={{
                left: `${Math.random() * 100}%`,
                top: `-20px`,
                backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#3b82f6'][Math.floor(Math.random() * 6)],
                animation: `fall ${2 + Math.random() * 3}s linear infinite`,
                animationDelay: `${Math.random() * 2}s`
              }}
            />
          ))}
          <style>{`
            @keyframes fall {
              to { transform: translateY(100vh) rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {/* Sidebar */}
      <aside className="hidden lg:flex w-72 flex-col glass-panel border-r border-white/10 z-30">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-xl shadow-indigo-600/30">
               <span className="font-black text-xl">S</span>
            </div>
            <h1 className="text-lg font-black tracking-tight text-white">
              Super<span className="text-indigo-400">Student</span>
            </h1>
          </div>
          <p className="text-[9px] font-bold text-white/40 uppercase tracking-widest ml-1">TunisIA Hub Core</p>
        </div>

        <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto">
          {BOTS.map((bot) => (
            <button
              key={bot.id}
              onClick={() => {
                setActiveBot(bot);
                setMessages([]);
                setQuizSession(null);
                setSelectedFile(null);
              }}
              className={`w-full flex items-center gap-3.5 p-3.5 rounded-2xl transition-all ${
                activeBot.id === bot.id 
                  ? `${bot.color} text-white shadow-lg shadow-indigo-600/20 scale-[1.02]` 
                  : 'hover:bg-white/10 text-white/60 hover:text-white'
              }`}
            >
              <span className="text-xl">{bot.icon}</span>
              <div className="flex flex-col text-left overflow-hidden">
                <span className="font-bold text-sm tracking-tight truncate">{bot.name}</span>
                <span className={`text-[10px] truncate ${activeBot.id === bot.id ? 'opacity-80' : 'opacity-40'}`}>
                  {bot.description}
                </span>
              </div>
            </button>
          ))}
        </nav>
        
        <div className="p-6 mt-auto">
          <div className="p-4 bg-white/5 rounded-2xl border border-white/10 backdrop-blur-md">
             <div className="flex items-center justify-between mb-2">
               <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">Status</p>
               <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
             </div>
             <p className="text-xs font-bold text-white/80">Operazione: SuperStudent</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative z-20 overflow-hidden">
        <header className="h-16 flex items-center justify-between px-6 glass-panel border-b border-white/10 z-20">
          <div className="flex items-center gap-4">
             <div className={`p-2 rounded-xl ${activeBot.color} text-white shadow-lg`}>
               <span className="text-lg">{activeBot.icon}</span>
             </div>
             <div>
               <h2 className="text-sm font-black text-white tracking-tight uppercase">{activeBot.name}</h2>
               <p className="text-[9px] font-bold text-white/40 uppercase">{quizSession ? 'Interactive Quiz Active' : `Mode: ${activeBot.name}`}</p>
             </div>
          </div>
          
          {quizSession && !quizSession.isComplete && (
            <div className="flex flex-col items-end gap-1.5">
               <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Question {quizSession.currentIndex + 1} de {quizSession.questions.length}</span>
               <div className="h-1.5 w-32 md:w-48 bg-white/10 rounded-full overflow-hidden border border-white/5">
                  <div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400 transition-all duration-700 ease-in-out" 
                    style={{ width: `${((quizSession.currentIndex + 1) / quizSession.questions.length) * 100}%` }}
                  />
               </div>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 relative">
          {quizSession ? (
            <div className="max-w-4xl mx-auto h-full flex flex-col justify-start animate-in fade-in zoom-in-95 duration-500 pb-20">
              {quizSession.isComplete ? (
                /* QUIZ DASHBOARD RESULTS */
                <div className="space-y-10 py-6">
                  <div className="glass-card-hero p-10 md:p-14 rounded-[3rem] text-center border-white/20 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent"></div>
                    <h2 className="text-xs font-black text-indigo-400 uppercase tracking-[0.4em] mb-10">Résumé de la Performance</h2>
                    
                    <CircularScore score={quizSession.score} total={quizSession.questions.length} />
                    
                    <div dir="rtl" className="mt-10 font-cairo">
                      <p className="text-2xl md:text-3xl font-black text-white leading-tight mb-6 px-4">
                        {getFeedbackMessage(quizSession.score, quizSession.questions.length)}
                      </p>
                      
                      <div className="flex flex-col md:flex-row items-center justify-center gap-4">
                        <button 
                          onClick={() => setQuizSession(null)}
                          className="w-full md:w-auto px-10 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all shadow-[0_15px_30px_rgba(79,70,229,0.3)] hover:scale-[1.02] active:scale-95"
                        >
                          Nouvelle Session
                        </button>
                        <button 
                          onClick={() => {
                            const resultsElement = document.getElementById('quiz-review-section');
                            resultsElement?.scrollIntoView({ behavior: 'smooth' });
                          }}
                          className="w-full md:w-auto px-10 py-4 bg-white/10 hover:bg-white/15 text-white border border-white/10 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all"
                        >
                          Review Answers
                        </button>
                      </div>
                    </div>
                  </div>

                  <div id="quiz-review-section" className="space-y-6">
                    <div className="flex items-center gap-4 px-2">
                       <div className="h-[1px] flex-1 bg-white/10"></div>
                       <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em] whitespace-nowrap">Detailed Review</h3>
                       <div className="h-[1px] flex-1 bg-white/10"></div>
                    </div>
                    
                    {quizSession.questions.map((q, idx) => (
                      <div key={idx} dir="rtl" className="glass-card p-8 rounded-[2rem] border-white/10 font-cairo shadow-lg group hover:border-indigo-500/30 transition-all">
                        <div className="flex items-center justify-between mb-5">
                           <div className="flex items-center gap-3">
                             <span className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-xs font-black text-white/40 border border-white/5">{idx + 1}</span>
                             <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Question</span>
                           </div>
                           <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${quizSession.userAnswers[idx] === q.correctAnswerIndex ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                              {quizSession.userAnswers[idx] === q.correctAnswerIndex ? 'Correct' : 'Incorrect'}
                           </span>
                        </div>
                        
                        <h4 className="text-xl font-bold text-white mb-6 leading-relaxed">{q.question}</h4>
                        
                        <div className="grid gap-3">
                           <div className={`p-4 rounded-2xl border ${quizSession.userAnswers[idx] === q.correctAnswerIndex ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-rose-500/5 border-rose-500/20'}`}>
                              <p className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-50">Ta Réponse:</p>
                              <p className="text-sm font-bold">{q.options[quizSession.userAnswers[idx]]}</p>
                           </div>
                           
                           {quizSession.userAnswers[idx] !== q.correctAnswerIndex && (
                             <div className="p-4 rounded-2xl border bg-indigo-500/5 border-indigo-500/20">
                                <p className="text-[10px] font-black uppercase tracking-widest mb-1 text-indigo-400">Réponse Correcte:</p>
                                <p className="text-sm font-bold text-indigo-100">{q.options[q.correctAnswerIndex]}</p>
                             </div>
                           )}
                        </div>

                        <div className="mt-6 pt-5 border-t border-white/5">
                           <p className="text-xs text-white/40 font-black uppercase tracking-widest mb-2">Explication:</p>
                           <p className="text-sm text-white/70 leading-relaxed italic">{q.explanation}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* INTERACTIVE QUESTION CARD */
                <div className="h-full flex items-center justify-center py-10">
                  <div key={quizSession.currentIndex} className="w-full max-w-2xl glass-card-hero p-10 md:p-14 rounded-[3rem] border-white/20 shadow-2xl relative overflow-hidden animate-in fade-in slide-in-from-bottom-6 duration-500">
                    <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none font-black text-[12rem] leading-none text-white select-none italic"> {quizSession.currentIndex + 1} </div>
                    
                    <div dir="rtl" className="font-cairo relative z-10">
                      <div className="mb-10">
                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.4em] block mb-4">Challenge Actif</span>
                        <h3 className="text-2xl md:text-3xl font-black text-white leading-snug drop-shadow-xl">
                          {quizSession.questions[quizSession.currentIndex].question}
                        </h3>
                      </div>
                      
                      <div className="grid gap-4">
                        {quizSession.questions[quizSession.currentIndex].options.map((option, idx) => {
                          const isSelected = selectedOption === idx;
                          const isCorrect = idx === quizSession.questions[quizSession.currentIndex].correctAnswerIndex;
                          
                          let btnClass = "w-full text-right p-5 md:p-6 rounded-2xl border transition-all font-bold text-lg flex items-center gap-5 ";
                          
                          if (showFeedback) {
                            if (isCorrect) btnClass += "bg-emerald-500/20 border-emerald-500 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)] scale-[1.02] ";
                            else if (isSelected) btnClass += "bg-rose-500/20 border-rose-500 text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.3)] ";
                            else btnClass += "opacity-30 border-transparent text-white/20 ";
                          } else {
                            btnClass += "bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-indigo-500/50 hover:scale-[1.02] hover:shadow-xl active:scale-95 ";
                          }

                          return (
                            <button
                              key={idx}
                              disabled={showFeedback}
                              onClick={() => handleQuizAnswer(idx)}
                              className={btnClass}
                            >
                               <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-black border transition-colors ${showFeedback && isCorrect ? 'bg-emerald-500/20 border-emerald-500' : 'bg-white/5 border-white/10'}`}>
                                 {String.fromCharCode(65 + idx)}
                               </span>
                               <span className="flex-1 drop-shadow-md">{option}</span>
                               {showFeedback && isCorrect && (
                                 <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
                               )}
                               {showFeedback && isSelected && !isCorrect && (
                                 <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-rose-500"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                               )}
                            </button>
                          );
                        })}
                      </div>

                      {showFeedback && (
                        <div className="mt-10 p-7 bg-white/5 backdrop-blur-3xl rounded-3xl border border-white/10 animate-in slide-in-from-top-4 duration-500">
                           <div className="flex items-center gap-3 mb-3">
                              <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></div>
                              <p className="text-indigo-400 font-black uppercase text-[10px] tracking-[0.3em]">Analyse & Explication</p>
                           </div>
                           <p className="text-white/80 leading-relaxed text-base italic font-medium">
                             {quizSession.questions[quizSession.currentIndex].explanation}
                           </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* CHAT MODE */
            <div className="max-w-4xl mx-auto space-y-6 relative z-10 pb-20">
              {messages.length === 0 && (
                <div className="h-full flex items-center justify-center animate-in fade-in duration-1000 mt-16 md:mt-24">
                  <div className="glass-card-hero w-full max-w-2xl p-10 md:p-14 rounded-[3rem] border-white/20 text-center relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none font-black text-9xl text-white select-none"> تونس </div>
                    <div className={`w-24 h-24 mx-auto rounded-[2rem] ${activeBot.color} flex items-center justify-center text-4xl shadow-2xl text-white mb-10 animate-float border border-white/10`}>
                      {activeBot.icon}
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black text-white mb-6 tracking-tighter">
                      Super <span className="text-indigo-400">Student</span>
                    </h1>
                    <div dir="rtl" className="font-arabic space-y-6">
                      <h2 className="text-2xl md:text-3xl font-bold text-white leading-tight">
                        مرحباً بيك! أنا الـ Super Student متاعك.
                      </h2>
                      <p className="text-lg text-white/70 leading-relaxed max-w-lg mx-auto">
                        باش نعاونك بالـ <span className={`px-2 py-0.5 rounded-lg ${activeBot.color} text-white font-black`}>{activeBot.name}</span> متاعي. قلي شنوة محضر اليوم؟
                      </p>
                      <div className="pt-6 flex flex-col items-center gap-3">
                         <div className="flex gap-1.5">
                            {[...Array(3)].map((_, i) => <div key={i} className="w-1 h-1 bg-indigo-500 rounded-full animate-pulse" style={{animationDelay: `${i*0.2}s`}}></div>)}
                         </div>
                         <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.4em]">Prêt pour l'action</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div 
                    dir="auto"
                    className={`max-w-[90%] md:max-w-[85%] animate-in slide-in-from-bottom-4 ${msg.role === 'user' 
                    ? 'glass-card-dark rounded-3xl rounded-tr-none px-6 py-4 shadow-2xl border-indigo-500/20' 
                    : 'glass-card text-slate-900 rounded-3xl rounded-tl-none px-6 py-5 shadow-2xl border-white/50'}`}
                  >
                    {msg.isImage && msg.imageUrl && (
                      <div className="rounded-2xl overflow-hidden mb-4 border border-black/5 shadow-md">
                        <img src={msg.imageUrl} className="w-full max-h-80 object-cover" />
                      </div>
                    )}
                    
                    <div className="prose prose-sm max-w-none text-inherit font-cairo leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>

                    {msg.visualAid && (
                      <div className="mt-6 border-t border-black/5 pt-5">
                        <div className="flex items-center justify-between mb-4">
                           <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.3em]">Slide Présentation</span>
                           <div className="flex gap-1">
                              <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></div>
                              <div className="w-1.5 h-1.5 bg-indigo-200 rounded-full"></div>
                           </div>
                        </div>
                        <div className="relative aspect-video rounded-[2rem] overflow-hidden shadow-2xl group ring-1 ring-black/10 transition-transform hover:scale-[1.01]">
                          <img src={msg.visualAid.imageUrl} className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" alt="Background" />
                          <div className="absolute inset-0 flex items-center justify-center p-6 md:p-10 bg-black/30 backdrop-blur-[2px]">
                            <div dir="rtl" className="w-full max-w-xl bg-white/10 backdrop-blur-2xl border border-white/20 rounded-[2rem] p-6 md:p-8 shadow-2xl font-cairo text-right ring-1 ring-white/20 transform translate-y-2">
                              <h3 className="text-2xl md:text-3xl font-black text-white mb-6 border-b-2 border-indigo-500/50 pb-4 leading-tight">{msg.visualAid.title}</h3>
                              <ul className="space-y-4">
                                {msg.visualAid.points.map((point, idx) => (
                                  <li key={idx} className="flex items-start gap-4 text-base font-bold text-white/95 leading-relaxed">
                                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 mt-2.5 shrink-0 shadow-[0_0_15px_rgba(129,140,248,0.8)]"></span>
                                    <span className="drop-shadow-lg">{point}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {msg.role === 'model' && (
                      <div className="mt-5 pt-4 border-t border-black/5 flex flex-wrap items-center gap-5">
                        <button onClick={() => copyToClipboard(msg.content)} className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-indigo-600 uppercase tracking-widest transition-colors group">
                           <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opacity-40 group-hover:opacity-100"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                           Copy
                        </button>
                        <button onClick={() => handleGenerateVisual(msg.id, msg.content)} disabled={generatingImageId === msg.id} className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all ${generatingImageId === msg.id ? 'text-indigo-400 animate-pulse' : 'text-indigo-600 hover:text-indigo-800'}`}>
                           <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                           {generatingImageId === msg.id ? 'Génération...' : 'Visual Aid'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {isLoading && (
                <div className="flex justify-start animate-in fade-in duration-300">
                  <div className="glass-card text-slate-900 px-6 py-4 rounded-3xl flex items-center gap-4 shadow-xl border-white/50">
                    <div className="flex gap-1.5">
                      <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce shadow-[0_0_8px_rgba(79,70,229,0.5)]"></div>
                      <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.1s] shadow-[0_0_8px_rgba(79,70,229,0.5)]"></div>
                      <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.2s] shadow-[0_0_8px_rgba(79,70,229,0.5)]"></div>
                    </div>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Super Student is thinking...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* INPUT BAR */}
        <div className="p-4 md:p-8 glass-panel border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.2)] backdrop-blur-3xl relative z-30">
          <div className="max-w-4xl mx-auto">
            {selectedFile && (
              <div className="mb-4 flex items-center gap-4 p-3 bg-white/10 border border-white/10 rounded-2xl animate-in slide-in-from-bottom-4">
                 <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center border border-indigo-500/30">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                 </div>
                 <div className="flex-1 overflow-hidden">
                   <p className="text-xs font-bold text-white/90 truncate">{selectedFile.file.name}</p>
                   <p className="text-[9px] font-black text-white/30 uppercase tracking-widest">{Math.round(selectedFile.file.size / 1024)} KB</p>
                 </div>
                 <button onClick={() => setSelectedFile(null)} className="p-2 text-white/40 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all">
                   <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                 </button>
              </div>
            )}
            
            <div className="relative flex items-end gap-3 md:gap-4 bg-white/5 p-2 rounded-[2rem] border border-white/10 shadow-2xl backdrop-blur-md">
               <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={!!quizSession && !quizSession.isComplete}
                className="p-4 text-white/40 hover:text-white hover:bg-white/5 rounded-[1.5rem] transition-all disabled:opacity-20 flex-shrink-0"
                title="Attacher un fichier"
               >
                 <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
               </button>
               
               <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
               
               <textarea
                dir="auto"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={!!quizSession && !quizSession.isComplete}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={quizSession ? "Interagissez avec le quiz..." : `قلي شنوة تحب يا بطل (${activeBot.name})...`}
                className="flex-1 bg-transparent py-4 px-2 rounded-2xl text-sm md:text-base text-white placeholder:text-white/20 focus:outline-none resize-none max-h-48 disabled:opacity-20 font-medium"
                rows={1}
              />
              
              <button
                onClick={handleSend}
                disabled={((!inputText.trim() && !selectedFile) || isLoading) || (!!quizSession && !quizSession.isComplete)}
                className={`p-4 rounded-[1.5rem] transition-all flex-shrink-0 shadow-xl group ${
                  (inputText.trim() || selectedFile) && !isLoading 
                  ? `${activeBot.color} text-white ring-2 ring-white/10 hover:scale-[1.05] active:scale-95` 
                  : 'bg-white/5 text-white/10'
                } disabled:opacity-10`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              </button>
            </div>
            
            <div className="mt-3 flex items-center justify-center gap-6 px-4">
               <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] hidden md:block">Plateforme Propulsée par Gemini 3 Pro</p>
               <div className="h-[1px] flex-1 bg-white/5 hidden md:block"></div>
               <div className="flex gap-4">
                  <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest cursor-help hover:text-indigo-300 transition-colors">Documentation</span>
                  <span className="text-[9px] font-black text-white/20 uppercase tracking-widest cursor-help hover:text-white/40 transition-colors">Support</span>
               </div>
            </div>
          </div>
        </div>
      </main>

      {/* MOBILE NAV BAR */}
     <div className="lg:hidden sticky bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 glass-panel border border-white/10 p-2.5 rounded-[2.5rem] shadow-2xl z-50 mb-4 w-[95%] mx-auto" >
        {BOTS.map(bot => (
          <button
            key={bot.id}
            onClick={() => {
              setActiveBot(bot);
              setMessages([]);
              setQuizSession(null);
            }}
            className={`w-12 h-12 flex items-center justify-center rounded-full text-xl transition-all relative group ${
              activeBot.id === bot.id ? `${bot.color} text-white scale-110 shadow-2xl` : 'text-white/30 hover:bg-white/5 hover:text-white/60'
            }`}
          >
            {bot.icon}
            {activeBot.id === bot.id && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full border-2 border-indigo-600 animate-pulse"></span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default App;
