// components/team/TeamChat.tsx
// Real-time team chat component

'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Send, MessageCircle, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useTeamChatFull } from '@/hooks/useTeamChat';
import type { TeamMessage } from '@/types';

interface TeamChatProps {
  teamId: string;
  currentUserId?: string;
}

export function TeamChat({ teamId, currentUserId }: TeamChatProps) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    messages,
    isLoading,
    error,
    sendMessage,
    isSending,
    isConnected,
    connectionError,
    reconnect,
  } = useTeamChatFull(teamId);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = inputValue.trim();
    if (!message || isSending) return;

    setInputValue('');
    try {
      await sendMessage(message);
    } catch (err) {
      // Error is handled in the hook
      setInputValue(message); // Restore on error
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Group messages by date
  const groupedMessages: { date: string; messages: TeamMessage[] }[] = [];
  let currentDate = '';
  for (const msg of messages) {
    const msgDate = formatDate(msg.created_at);
    if (msgDate !== currentDate) {
      currentDate = msgDate;
      groupedMessages.push({ date: msgDate, messages: [msg] });
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg);
    }
  }

  return (
    <div className="flex flex-col h-[400px] bg-gray-900/50 rounded-xl border border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <MessageCircle size={18} className="text-purple-400" />
          <span className="font-medium text-white">Team Chat</span>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <div className="flex items-center gap-1 text-xs text-green-400">
              <Wifi size={12} />
              Live
            </div>
          ) : connectionError ? (
            <button
              onClick={reconnect}
              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
            >
              <WifiOff size={12} />
              Reconnect
            </button>
          ) : (
            <div className="flex items-center gap-1 text-xs text-yellow-400">
              <Loader2 size={12} className="animate-spin" />
              Connecting...
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin text-purple-500" size={24} />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-400 text-sm">
            Failed to load messages
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm">
            <MessageCircle size={32} className="mb-2 opacity-50" />
            <p>No messages yet</p>
            <p className="text-xs">Start the conversation!</p>
          </div>
        ) : (
          <>
            {groupedMessages.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-gray-800" />
                  <span className="text-xs text-gray-500">{group.date}</span>
                  <div className="flex-1 h-px bg-gray-800" />
                </div>

                {/* Messages for this date */}
                <div className="space-y-2">
                  {group.messages.map((msg) => {
                    const isOwn = msg.user_id === currentUserId;
                    return (
                      <div
                        key={msg.id}
                        className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}
                      >
                        {/* Avatar */}
                        {!isOwn && (
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-700 flex-shrink-0">
                            {msg.avatar_url ? (
                              <Image
                                src={msg.avatar_url}
                                alt={msg.username}
                                width={32}
                                height={32}
                                className="object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm font-bold">
                                {msg.username[0]?.toUpperCase()}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Message bubble */}
                        <div
                          className={`max-w-[70%] ${
                            isOwn
                              ? 'bg-purple-600 text-white rounded-2xl rounded-tr-md'
                              : 'bg-gray-800 text-white rounded-2xl rounded-tl-md'
                          } px-3 py-2`}
                        >
                          {!isOwn && (
                            <div className="text-xs text-purple-400 font-medium mb-0.5">
                              {msg.username}
                            </div>
                          )}
                          <p className="text-sm break-words">{msg.message}</p>
                          <div
                            className={`text-[10px] mt-0.5 ${
                              isOwn ? 'text-purple-200' : 'text-gray-500'
                            }`}
                          >
                            {formatTime(msg.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type a message..."
            maxLength={500}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-full px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isSending}
            className="w-10 h-10 flex items-center justify-center bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-full transition-colors"
          >
            {isSending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
        <div className="text-right text-xs text-gray-500 mt-1">
          {inputValue.length}/500
        </div>
      </form>
    </div>
  );
}
