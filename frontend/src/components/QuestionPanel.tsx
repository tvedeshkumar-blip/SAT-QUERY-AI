import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Sparkles, 
  Loader2, 
  RotateCcw, 
  Bot, 
  User, 
  Wifi, 
  WifiOff, 
  AlertCircle, 
  Cpu, 
  CheckCircle2, 
  Database,
  HelpCircle,
  Play
} from 'lucide-react';
import { AnalysisMode, AnalysisResponse, ChatMessage } from '../types';
import { sendChatMessage, checkChatHealth } from '../services/api';
import { extractStructuredEvidence } from '../utils/evidenceExtractor';

interface QuestionPanelProps {
  query: string;
  setQuery: (q: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  mode: AnalysisMode;
  presetQueries: string[];
  analysisResponse?: AnalysisResponse | null;
}

export const QuestionPanel: React.FC<QuestionPanelProps> = ({
  query,
  setQuery,
  onSubmit,
  isLoading,
  mode,
  presetQueries,
  analysisResponse = null,
}) => {
  // Conversation session state
  const [conversationId, setConversationId] = useState<string>(() => `conv_${Date.now().toString(36)}`);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [serverHealth, setServerHealth] = useState<{
    status: 'online' | 'offline';
    available: boolean;
    provider: string;
    base_url: string;
    configured_model: string;
  }>({
    status: 'offline',
    available: false,
    provider: 'LM Studio',
    base_url: 'http://127.0.0.1:1234/v1',
    configured_model: 'unavailable',
  });
  const [isCheckingHealth, setIsCheckingHealth] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Poll chat health on mount and every 30 seconds
  const verifyHealth = async () => {
    setIsCheckingHealth(true);
    try {
      const h = await checkChatHealth();
      setServerHealth(h);
    } catch {
      setServerHealth({
        status: 'offline',
        available: false,
        provider: 'LM Studio',
        base_url: 'http://127.0.0.1:1234/v1',
        configured_model: 'unavailable',
      });
    } finally {
      setIsCheckingHealth(false);
    }
  };

  useEffect(() => {
    verifyHealth();
    const interval = setInterval(verifyHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll chat feed to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  // Derived structured evidence from the latest analysis response
  const activeEvidence = extractStructuredEvidence(analysisResponse);

  // Reset conversation handler
  const handleResetChat = () => {
    setConversationId(`conv_${Date.now().toString(36)}`);
    setMessages([]);
    setChatInput('');
  };

  // Submit a chat message to the local LM Studio endpoint
  const handleSendChatMessage = async (textToSend?: string) => {
    const text = (textToSend || chatInput).trim();
    if (!text || isGenerating) return;

    const userTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: userTimestamp,
      status: 'success',
    };

    const updatedHistory = [...messages, userMsg];
    setMessages(updatedHistory);
    setChatInput('');
    setIsGenerating(true);

    try {
      // Build history payload for backend
      const historyPayload = updatedHistory
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await sendChatMessage({
        message: text,
        conversation_id: conversationId,
        history: historyPayload,
        evidence: activeEvidence || undefined,
      });

      const assistantTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (res.status === 'unavailable') {
        setServerHealth((prev) => ({ ...prev, status: 'offline', available: false }));
        setMessages((prev) => [
          ...prev,
          {
            id: `ast_${Date.now()}`,
            role: 'assistant',
            content: res.response || 'SatQuery AI local LLM is offline. Start LM Studio to enable conversational analysis.',
            timestamp: assistantTimestamp,
            status: 'unavailable',
            provider: 'LM Studio',
            model: res.model || 'unavailable',
            error: res.error,
          },
        ]);
      } else {
        setServerHealth((prev) => ({ ...prev, status: 'online', available: true }));
        setMessages((prev) => [
          ...prev,
          {
            id: `ast_${Date.now()}`,
            role: 'assistant',
            content: res.response,
            timestamp: assistantTimestamp,
            status: 'success',
            provider: res.provider || 'LM Studio',
            model: res.model,
          },
        ]);
      }
    } catch (err: any) {
      const assistantTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMessages((prev) => [
        ...prev,
        {
          id: `ast_${Date.now()}`,
          role: 'assistant',
          content: 'SatQuery AI local LLM is offline. Start LM Studio to enable conversational analysis.',
          timestamp: assistantTimestamp,
          status: 'unavailable',
          provider: 'LM Studio',
          model: 'unavailable',
          error: err.message,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChatMessage();
    }
  };

  // Quick preset click handler
  const handleSelectPreset = (pq: string) => {
    setChatInput(pq);
    setQuery(pq);
  };

  return (
    <div className="glass-panel rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl flex flex-col h-full overflow-hidden">
      
      {/* 1. Header Bar: Provider Identification & Provenance */}
      <div className="px-5 py-3.5 border-b border-slate-800/80 bg-slate-950/50 flex flex-wrap items-center justify-between gap-3">
        
        {/* Active Provider Badge */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-cyan-950 border border-cyan-800 flex items-center justify-center">
            <Bot className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-100 font-mono tracking-wide">
                SatQuery AI • Local LLM • LM Studio
              </span>
              <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                serverHealth.status === 'online'
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                  : 'bg-amber-950/80 text-amber-300 border-amber-800'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  serverHealth.status === 'online' ? 'bg-emerald-400' : 'bg-amber-400'
                }`} />
                {serverHealth.status === 'online' ? 'LM Studio Online' : 'LM Studio Offline'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">
              Dedicated Local Subsystem • Zero Cloud Dependencies
            </p>
          </div>
        </div>

        {/* Action Controls: New Chat & Health Check */}
        <div className="flex items-center gap-2">
          {activeEvidence && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono text-cyan-300 bg-cyan-950/50 px-2 py-1 rounded-md border border-cyan-900">
              <Database className="w-3 h-3 text-cyan-400" />
              Evidence Attached: {analysisResponse?.actual_model_used || analysisResponse?.task}
            </span>
          )}

          <button
            onClick={verifyHealth}
            disabled={isCheckingHealth}
            title="Probe LM Studio connectivity"
            className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 border border-slate-800 transition-all text-xs"
          >
            {serverHealth.status === 'online' ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            )}
          </button>

          <button
            onClick={handleResetChat}
            title="Start New Conversation"
            className="inline-flex items-center gap-1 text-xs font-mono px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 transition-all"
          >
            <RotateCcw className="w-3 h-3 text-cyan-400" />
            New Chat
          </button>
        </div>

      </div>

      {/* 2. Conversation Feed Area */}
      <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[420px] min-h-[300px] scrollbar-thin scrollbar-thumb-slate-800">
        
        {/* Welcome Hero when no messages */}
        {messages.length === 0 && (
          <div className="p-5 rounded-xl bg-slate-950/40 border border-slate-800/80 space-y-3">
            <div className="flex items-center gap-2 text-cyan-300 font-mono text-xs font-bold uppercase tracking-wider">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              Natural-Language Satellite Analysis Assistant
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-sans">
              Welcome to <span className="text-cyan-300 font-semibold font-mono">SatQuery AI</span>. Ask questions about the current imagery, request feature localization, analyze bi-temporal changes, or explore spectral characteristics. Powered directly by your local LLM in LM Studio.
            </p>

            {/* Offline Alert Box if LM Studio is offline */}
            {serverHealth.status === 'offline' && (
              <div className="p-3.5 rounded-lg bg-amber-950/30 border border-amber-800/70 space-y-1.5 text-xs text-amber-200">
                <div className="flex items-center gap-2 font-bold font-mono text-amber-300">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  SatQuery AI local LLM is offline. Start LM Studio to enable conversational analysis.
                </div>
                <p className="text-[11px] text-amber-300/80 leading-relaxed">
                  Start LM Studio, load a local model, and ensure the local server is listening at <code className="bg-amber-950 px-1 py-0.5 rounded text-amber-200 font-mono">{serverHealth.base_url}</code>.
                </p>
              </div>
            )}

            {/* Evidence attachment notice */}
            {activeEvidence ? (
              <div className="p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-900/60 flex items-center gap-2 text-xs font-mono text-cyan-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                Active perception evidence from '{analysisResponse?.actual_model_used}' will be passed into the chat for grounded reasoning.
              </div>
            ) : (
              <div className="text-[11px] font-mono text-slate-500">
                Tip: Run the perception pipeline below or load a demo to attach empirical raster evidence to your conversation.
              </div>
            )}
          </div>
        )}

        {/* Render Conversation Turns */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} space-y-1`}
          >
            {/* Sender & Timestamp Header */}
            <div className="flex items-center gap-2 px-1 text-[10px] font-mono text-slate-400">
              {msg.role === 'user' ? (
                <>
                  <span>You</span>
                  <span>•</span>
                  <span>{msg.timestamp}</span>
                  <User className="w-3 h-3 text-cyan-400" />
                </>
              ) : (
                <>
                  <Bot className="w-3 h-3 text-cyan-400" />
                  <span className="font-bold text-cyan-300">SatQuery AI</span>
                  {msg.model && (
                    <span className="px-1.5 py-0.2 rounded bg-slate-900 text-slate-400 border border-slate-800 text-[9px]">
                      {msg.model}
                    </span>
                  )}
                  <span>•</span>
                  <span>{msg.timestamp}</span>
                </>
              )}
            </div>

            {/* Message Bubble */}
            <div
              className={`max-w-[88%] rounded-xl p-3.5 text-xs font-sans leading-relaxed shadow-md ${
                msg.role === 'user'
                  ? 'bg-cyan-950/80 border border-cyan-800/80 text-slate-100 rounded-tr-none'
                  : msg.status === 'unavailable'
                  ? 'bg-amber-950/40 border border-amber-800/80 text-amber-200 rounded-tl-none'
                  : 'bg-slate-950/80 border border-slate-800 text-slate-100 rounded-tl-none'
              }`}
            >
              {msg.status === 'unavailable' ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-bold font-mono text-amber-300">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    SatQuery AI local LLM is offline. Start LM Studio to enable conversational analysis.
                  </div>
                  <p className="text-[11px] text-amber-200/90">{msg.content}</p>
                  <p className="text-[10px] font-mono text-amber-400/70 pt-1 border-t border-amber-900/50">
                    Endpoint: {serverHealth.base_url} • Status: Connection Refused / Offline
                  </p>
                </div>
              ) : (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              )}
            </div>
          </div>
        ))}

        {/* Generating Indicator */}
        {isGenerating && (
          <div className="flex flex-col items-start space-y-1">
            <div className="flex items-center gap-2 px-1 text-[10px] font-mono text-slate-400">
              <Bot className="w-3 h-3 text-cyan-400" />
              <span className="font-bold text-cyan-300">SatQuery AI</span>
              <span>•</span>
              <span className="text-teal-400">Synthesizing...</span>
            </div>
            <div className="rounded-xl rounded-tl-none p-3.5 bg-slate-950/80 border border-slate-800 text-xs text-slate-300 flex items-center gap-2 shadow-md">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
              <span>SatQuery AI is synthesizing satellite analysis via LM Studio...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 3. Preset Suggested Queries */}
      {presetQueries.length > 0 && (
        <div className="px-4 py-2 border-t border-slate-800/60 bg-slate-950/30">
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 mb-1.5">
            <HelpCircle className="w-3 h-3 text-cyan-400" />
            <span>Suggested RS Queries:</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {presetQueries.slice(0, 3).map((pq, idx) => (
              <button
                key={idx}
                onClick={() => handleSelectPreset(pq)}
                className="text-[11px] bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 px-2.5 py-1 rounded-md border border-slate-800 hover:border-cyan-500/40 transition-all text-left truncate max-w-[260px]"
              >
                "{pq}"
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 4. Input Box & Dual Action Bar */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-950/60 space-y-3">
        
        <div className="relative">
          <textarea
            value={chatInput}
            onChange={(e) => {
              setChatInput(e.target.value);
              setQuery(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask SatQuery AI a question (e.g. 'Explain the change metrics', 'Where are the ships located?', 'Check water body coverage')..."
            rows={2}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/40 resize-none font-sans"
          />
        </div>

        {/* Dual Actions: Send to Chatbot & Execute Full Pipeline */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          
          <div className="text-[10px] font-mono text-slate-400">
            Press <kbd className="px-1 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">Enter</kbd> to chat with LM Studio
          </div>

          <div className="flex items-center gap-2">
            {/* Execute Full Pipeline Analysis Button (triggers backend /analyze) */}
            <button
              onClick={onSubmit}
              disabled={isLoading || (!query.trim() && !chatInput.trim())}
              title="Execute full perception pipeline (BIT-CD / OWL-ViT / Spectrals)"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold font-mono bg-slate-900 hover:bg-slate-800 text-teal-300 border border-teal-800/70 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-teal-400" />
                  Running Pipeline...
                </>
              ) : (
                <>
                  <Cpu className="w-3 h-3 text-teal-400" />
                  Execute Pipeline
                </>
              )}
            </button>

            {/* Send to Chatbot Button (triggers backend /chat) */}
            <button
              onClick={() => handleSendChatMessage()}
              disabled={!chatInput.trim() || isGenerating}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold font-mono bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 shadow-md shadow-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Send to Chatbot
                </>
              )}
            </button>
          </div>

        </div>

      </div>

    </div>
  );
};
