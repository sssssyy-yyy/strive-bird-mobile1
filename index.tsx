import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// --- Configuration ---
const GRAVITY = 0.5;
const JUMP_STRENGTH = -8;
const PIPE_SPEED = 3;
const PIPE_SPAWN_RATE = 100; // Frames between pipes
const PIPE_GAP = 160;
const BIRD_SIZE = 30; // Visual size
const BIRD_HITBOX = 24; // Physical size
const PIPE_WIDTH = 60;

// --- Types ---
type GameState = 'START' | 'PLAYING' | 'GAMEOVER';

interface Pipe {
  x: number;
  topHeight: number;
  passed: boolean;
}

const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>('START');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [aiMessage, setAiMessage] = useState<string>("");
  const [isAiLoading, setIsAiLoading] = useState(false);

  // Game Refs for loop (avoid stale closures)
  const birdY = useRef(300);
  const birdVelocity = useRef(0);
  const pipes = useRef<Pipe[]>([]);
  const frameCount = useRef(0);
  const animationFrameId = useRef<number>(0);
  const scoreRef = useRef(0); // Critical: Use ref for real-time score tracking in loop

  // Load High Score
  useEffect(() => {
    const saved = localStorage.getItem('strive_bird_highscore');
    if (saved) setHighScore(parseInt(saved, 10));
  }, []);

  // --- AI Generation Logic (DeepSeek API) ---
  const generateMotivation = async (finalScore: number) => {
    setIsAiLoading(true);
    setAiMessage("");
    
    try {
      const systemPrompt = `你是一个人生导师。
请根据玩家在"奋斗小鸟"（类似Flappy Bird）游戏中的得分，生成一句简短的中文评价（30字以内）。
输出必须是纯净的JSON格式，包含一个字段 "quote"。
规则：
1. 分数 < 3：毒舌、幽默、调侃。
2. 分数 3-10：鼓励但带点严厉。
3. 分数 > 10：高度赞赏。`;

      const userMessage = `玩家得分是 ${finalScore}。请生成评价。`;

      // 使用 DeepSeek API (OpenAI 兼容接口)
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.API_KEY}`
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
          ],
          response_format: { type: "json_object" },
          temperature: 1.3, // 稍微调高温度，增加创造性和幽默感
          max_tokens: 100
        })
      });

      if (!response.ok) {
        throw new Error(`DeepSeek API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (content) {
        const json = JSON.parse(content);
        if (json.quote) {
          setAiMessage(json.quote);
        } else {
           setAiMessage("奋斗不息，飞翔不止！");
        }
      } else {
        setAiMessage("DeepSeek 似乎也在思考人生...");
      }

    } catch (error) {
      console.error("AI Error:", error);
      setAiMessage("网络有点累，但你的奋斗不能停！(请检查 API Key)");
    } finally {
      setIsAiLoading(false);
    }
  };

  // --- Game Loop ---
  const update = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Helper to trigger game over safely from within the loop
    const triggerGameOver = () => {
      setGameState('GAMEOVER');
      
      const finalScore = scoreRef.current; // Read from Ref to get the true score

      // Update high score
      setHighScore(prev => {
        const newHigh = Math.max(prev, finalScore);
        localStorage.setItem('strive_bird_highscore', newHigh.toString());
        return newHigh;
      });

      // Generate AI message
      generateMotivation(finalScore);
    };

    // 1. Physics & Logic
    if (gameState === 'PLAYING') {
      birdVelocity.current += GRAVITY;
      birdY.current += birdVelocity.current;

      // Spawn Pipes
      frameCount.current++;
      if (frameCount.current % PIPE_SPAWN_RATE === 0) {
        const minPipe = 50;
        const maxPipe = canvas.height - PIPE_GAP - minPipe - 50; // -50 for ground buffer
        const randomHeight = Math.floor(Math.random() * (maxPipe - minPipe + 1)) + minPipe;
        pipes.current.push({
          x: canvas.width,
          topHeight: randomHeight,
          passed: false
        });
      }

      // Move Pipes & Collision
      pipes.current.forEach(pipe => {
        pipe.x -= PIPE_SPEED;
      });

      // Remove off-screen pipes
      if (pipes.current.length > 0 && pipes.current[0].x < -PIPE_WIDTH) {
        pipes.current.shift();
      }

      // Collision Detection
      const birdLeft = 50; // Bird fixed X position
      const birdRight = 50 + BIRD_HITBOX;
      const birdTop = birdY.current;
      const birdBottom = birdY.current + BIRD_HITBOX;

      // Ground/Ceiling collision
      if (birdBottom >= canvas.height || birdTop <= 0) {
        triggerGameOver();
        return; // Stop this frame
      }

      // Pipe collision
      let collided = false;
      pipes.current.forEach(pipe => {
        const pipeLeft = pipe.x;
        const pipeRight = pipe.x + PIPE_WIDTH;

        // Check horizontal overlap
        if (birdRight > pipeLeft && birdLeft < pipeRight) {
          // Check vertical overlap (hit top pipe OR hit bottom pipe)
          if (birdTop < pipe.topHeight || birdBottom > pipe.topHeight + PIPE_GAP) {
            collided = true;
          }
        }

        // Score update
        if (!pipe.passed && birdLeft > pipeRight) {
          pipe.passed = true;
          scoreRef.current += 1; // Update Ref
          setScore(scoreRef.current); // Sync State for UI
        }
      });

      if (collided) {
        triggerGameOver();
        return;
      }
    }

    // 2. Render
    // Background
    ctx.fillStyle = '#70c5ce'; // Sky blue
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Clouds (Simple decor)
    ctx.fillStyle = '#ffffffaa';
    ctx.beginPath();
    ctx.arc(100, 100, 30, 0, Math.PI * 2);
    ctx.arc(140, 110, 40, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.beginPath();
    ctx.arc(300, 150, 25, 0, Math.PI * 2);
    ctx.arc(340, 160, 35, 0, Math.PI * 2);
    ctx.fill();

    // Pipes
    ctx.fillStyle = '#73bf2e'; // Pipe green
    ctx.strokeStyle = '#558c22';
    ctx.lineWidth = 2;
    pipes.current.forEach(pipe => {
      // Top Pipe
      ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.topHeight);
      ctx.strokeRect(pipe.x, 0, PIPE_WIDTH, pipe.topHeight);
      // Cap for top pipe
      ctx.fillRect(pipe.x - 2, pipe.topHeight - 20, PIPE_WIDTH + 4, 20);
      
      // Bottom Pipe
      const bottomPipeY = pipe.topHeight + PIPE_GAP;
      const bottomPipeHeight = canvas.height - bottomPipeY;
      ctx.fillRect(pipe.x, bottomPipeY, PIPE_WIDTH, bottomPipeHeight);
      ctx.strokeRect(pipe.x, bottomPipeY, PIPE_WIDTH, bottomPipeHeight);
      // Cap for bottom pipe
      ctx.fillRect(pipe.x - 2, bottomPipeY, PIPE_WIDTH + 4, 20);
    });

    // Bird
    ctx.save();
    ctx.translate(50 + BIRD_SIZE / 2, birdY.current + BIRD_SIZE / 2);
    // Rotate bird based on velocity
    const rotation = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, (birdVelocity.current * 0.1)));
    ctx.rotate(rotation);
    
    // Bird Body
    ctx.fillStyle = '#facc15'; // Yellow-400
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    // Eye
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(8, -8, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'black';
    ctx.beginPath();
    ctx.arc(10, -8, 3, 0, Math.PI * 2);
    ctx.fill();
    // Wing
    ctx.fillStyle = '#fde047'; // Lighter yellow
    ctx.beginPath();
    ctx.ellipse(-5, 5, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Beak
    ctx.fillStyle = '#f97316'; // Orange
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(20, 4);
    ctx.lineTo(8, 8);
    ctx.fill();

    ctx.restore();

    // Ground
    ctx.fillStyle = '#ded895';
    ctx.fillRect(0, canvas.height - 20, canvas.width, 20);
    ctx.fillStyle = '#73bf2e';
    ctx.fillRect(0, canvas.height - 25, canvas.width, 5);

    animationFrameId.current = requestAnimationFrame(update);
  }, [gameState]);

  const resetGame = () => {
    setGameState('START');
    setScore(0);
    scoreRef.current = 0; // Reset ref
    setAiMessage("");
    birdY.current = 300;
    birdVelocity.current = 0;
    pipes.current = [];
    frameCount.current = 0;
  };

  const startGame = () => {
    resetGame();
    setGameState('PLAYING');
  };

  const jump = useCallback((e?: React.MouseEvent | KeyboardEvent | TouchEvent) => {
    if (e && e.type === 'keydown' && (e as KeyboardEvent).code !== 'Space') return;
    if (e) e.preventDefault(); // Stop scrolling

    if (gameState === 'PLAYING') {
      birdVelocity.current = JUMP_STRENGTH;
    } else if (gameState === 'START') {
      startGame();
    } else if (gameState === 'GAMEOVER' && !isAiLoading) {
       // Optional: Allow tap to restart on gameover
       // But button is clearer
    }
  }, [gameState, isAiLoading]);

  // Handle Loop
  useEffect(() => {
    animationFrameId.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrameId.current);
  }, [update]);

  // Handle Input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') jump(e);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jump]);

  // Resize Handler
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        // Simple responsive logic: maintain height, adjust width or fill screen
        canvasRef.current.width = window.innerWidth > 480 ? 480 : window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="flex justify-center items-center h-screen bg-neutral-800" onMouseDown={() => jump()} onTouchStart={() => jump()}>
      <div className="relative shadow-2xl overflow-hidden rounded-lg w-full h-full max-w-[480px]">
        <canvas ref={canvasRef} className="block bg-sky-300 cursor-pointer w-full h-full" />

        {/* Start Screen */}
        {gameState === 'START' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 text-white pointer-events-none">
            <h1 className="text-4xl font-bold mb-4 drop-shadow-md animate-float">奋斗小鸟</h1>
            <p className="text-lg bg-white/20 px-4 py-2 rounded-full backdrop-blur-sm">点击屏幕起飞</p>
          </div>
        )}

        {/* HUD */}
        {gameState === 'PLAYING' && (
          <div className="absolute top-10 w-full text-center pointer-events-none">
            <span className="text-6xl font-black text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] stroke-black">
              {score}
            </span>
          </div>
        )}

        {/* Game Over Screen */}
        {gameState === 'GAMEOVER' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white z-10 px-6 text-center">
            <h2 className="text-3xl font-bold mb-2 text-orange-400">Game Over</h2>
            
            <div className="bg-white/10 p-6 rounded-xl backdrop-blur-md border border-white/20 w-full max-w-xs mb-6">
              <div className="flex justify-between mb-2">
                <span className="text-gray-300">本局得分</span>
                <span className="text-2xl font-bold">{score}</span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-2">
                <span className="text-yellow-400">最高分</span>
                <span className="text-xl font-bold text-yellow-400">{highScore}</span>
              </div>
            </div>

            {/* AI Message Area */}
            <div className="mb-8 min-h-[80px] flex items-center justify-center w-full">
              {isAiLoading ? (
                <div className="flex items-center gap-2 text-gray-400">
                  <div className="w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin"></div>
                  <span>DeepSeek 正在犀利点评...</span>
                </div>
              ) : (
                <p className="text-lg italic font-medium text-emerald-300 px-4">
                  {aiMessage || "奋斗不息，飞翔不止！"}
                </p>
              )}
            </div>

            <button 
              onClick={(e) => { e.stopPropagation(); resetGame(); }}
              className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-8 rounded-full text-lg transition-transform active:scale-95 shadow-lg border-b-4 border-emerald-700 cursor-pointer pointer-events-auto"
            >
              再试一次
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);