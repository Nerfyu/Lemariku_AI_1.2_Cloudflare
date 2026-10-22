import { useState, useCallback } from 'react';
import { RefreshCw, ArrowLeft, CheckCircle2 } from 'lucide-react';

interface Props {
  onBack: () => void;
}

interface Item {
  id: string;
  emoji: string;
  label: string;
  x: number; // percent
  y: number; // percent
  rotation: number;
  scale: number;
}

interface Objective {
  targetLabel: string;
  instruction: string;
}

const ITEM_POOL: Array<{ emoji: string; label: string }> = [
  { emoji: '👕', label: 'baju' },
  { emoji: '👖', label: 'celana' },
  { emoji: '👟', label: 'sepatu' },
  { emoji: '🧦', label: 'kaos kaki' },
  { emoji: '🧤', label: 'sarung tangan' },
  { emoji: '🎒', label: 'tas' },
  { emoji: '📚', label: 'buku' },
  { emoji: '🎮', label: 'gamepad' },
  { emoji: '🕶️', label: 'kacamata' },
  { emoji: '🧢', label: 'topi' },
  { emoji: '🧸', label: 'boneka' },
  { emoji: '☂️', label: 'payung' },
  { emoji: '📱', label: 'ponsel' },
  { emoji: '🔑', label: 'kunci' },
  { emoji: '🧴', label: 'losion' },
];

const OBJECTIVES: Record<string, string> = {
  baju: 'Tolong ambilkan baju dari lantai! 👕',
  celana: 'Lemari nyuruh kamu ambil celana! 👖',
  sepatu: 'Cari sepatu yang nyasar di lantai! 👟',
  'kaos kaki': 'Di mana kaos kaki-ku? Temukan! 🧦',
  'sarung tangan': 'Ambilkan sarung tangan dong! 🧤',
  tas: 'Mana tasnya? Temukan! 🎒',
  buku: 'Lemari butuh buku itu, ambil! 📚',
  gamepad: 'Cari gamepad yang entah ke mana! 🎮',
  kacamata: 'Temukan kacamata di lantai! 🕶️',
  topi: 'Tolong ambil topi itu! 🧢',
  boneka: 'Lemari kangen boneka itu, cari! 🧸',
  payung: 'Kayaknya mau hujan, ambil payung! ☂️',
  ponsel: 'Ponseel! Di mana ponselku?! 📱',
  kunci: 'Ini darurat, ambil kuncinya! 🔑',
  losion: 'Kulit lemari kering, ambil losion! 🧴',
};

function buildScene(): { items: Item[]; objective: Objective } {
  const shuffled = [...ITEM_POOL].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 10);
  const targetIdx = Math.floor(Math.random() * selected.length);
  const target = selected[targetIdx];

  const items: Item[] = selected.map((item, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    return {
      id: crypto.randomUUID(),
      emoji: item.emoji,
      label: item.label,
      x: 8 + col * 18 + (Math.random() * 6 - 3),
      y: 20 + row * 38 + (Math.random() * 8 - 4),
      rotation: Math.random() * 40 - 20,
      scale: 0.9 + Math.random() * 0.3,
    };
  });

  return {
    items,
    objective: {
      targetLabel: target.label,
      instruction: OBJECTIVES[target.label] ?? `Cari ${target.label}!`,
    },
  };
}

type GameState = 'playing' | 'wrong' | 'won';

export default function Minigame({ onBack }: Props) {
  const [scene, setScene] = useState(() => buildScene());
  const [gameState, setGameState] = useState<GameState>('playing');
  const [wrongId, setWrongId] = useState<string | null>(null);
  const [foundId, setFoundId] = useState<string | null>(null);

  const restart = useCallback(() => {
    setScene(buildScene());
    setGameState('playing');
    setWrongId(null);
    setFoundId(null);
  }, []);

  function handleItemClick(item: Item) {
    if (gameState === 'won') return;
    if (item.label === scene.objective.targetLabel) {
      setFoundId(item.id);
      setGameState('won');
    } else {
      setWrongId(item.id);
      setGameState('wrong');
      setTimeout(() => {
        setWrongId(null);
        setGameState('playing');
      }, 600);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#1A0A00] overflow-hidden">
      {/* Wooden floor texture via CSS gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            repeating-linear-gradient(
              90deg,
              rgba(120,60,10,0.12) 0px,
              rgba(120,60,10,0.06) 60px,
              rgba(160,90,20,0.10) 120px,
              rgba(100,50,5,0.14) 180px
            ),
            linear-gradient(180deg, #2C1810 0%, #3D2214 40%, #4A2A18 100%)
          `,
        }}
      />
      {/* Floor planks horizontal lines */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `repeating-linear-gradient(
          0deg,
          transparent,
          transparent 79px,
          rgba(0,0,0,0.18) 80px
        )`,
      }} />

      {/* Header bar */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-4 pb-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-amber-200/80 hover:text-amber-100 transition-colors bg-black/30 hover:bg-black/50 rounded-xl px-3 py-2"
        >
          <ArrowLeft size={15} />
          Kembali
        </button>
        <button
          onClick={restart}
          className="flex items-center gap-1.5 text-sm text-amber-200/80 hover:text-amber-100 transition-colors bg-black/30 hover:bg-black/50 rounded-xl px-3 py-2"
        >
          <RefreshCw size={14} />
          Acak
        </button>
      </div>

      {/* Objective card */}
      <div className="relative z-10 mx-4 mb-2">
        <div className="bg-black/50 backdrop-blur-sm border border-amber-700/30 rounded-2xl px-5 py-3 text-center">
          <p className="text-xs text-amber-300/60 mb-1 font-medium uppercase tracking-widest">Perintah Lemari</p>
          <p className="text-base font-bold text-amber-100">{scene.objective.instruction}</p>
          {gameState === 'wrong' && (
            <p className="text-xs text-red-400 mt-1 animate-fadeInUp">Bukan itu! Cari lagi! ❌</p>
          )}
        </div>
      </div>

      {/* Game area — items scattered on floor */}
      <div className="relative z-10 flex-1 mx-4 mb-4">
        <div className="relative w-full h-full">
          {scene.items.map((item) => {
            const isFound = item.id === foundId;
            const isWrong = item.id === wrongId;

            return (
              <button
                key={item.id}
                onClick={() => handleItemClick(item)}
                disabled={gameState === 'won'}
                className="absolute select-none transition-transform duration-150 hover:scale-125 active:scale-110 focus:outline-none"
                style={{
                  left: `${item.x}%`,
                  top: `${item.y}%`,
                  transform: `rotate(${item.rotation}deg) scale(${item.scale}) ${isFound ? 'scale(1.4)' : ''} ${isWrong ? 'scale(0.8)' : ''}`,
                  fontSize: '2.6rem',
                  filter: isFound
                    ? 'drop-shadow(0 0 12px rgba(74,222,128,0.8))'
                    : isWrong
                    ? 'drop-shadow(0 0 8px rgba(248,113,113,0.8))'
                    : 'drop-shadow(2px 3px 4px rgba(0,0,0,0.5))',
                  transition: 'filter 0.15s, transform 0.15s',
                }}
                title={gameState === 'won' ? item.label : ''}
              >
                {item.emoji}
                {isFound && (
                  <span className="absolute -top-2 -right-2 text-base">✅</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Win overlay */}
      {gameState === 'won' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center px-6 animate-fadeInUp">
          <div className="bg-[#0D2010]/95 border border-green-600/50 rounded-2xl px-8 py-8 text-center shadow-2xl max-w-xs w-full">
            <CheckCircle2 size={40} className="text-green-400 mx-auto mb-3" />
            <p className="text-xl font-bold text-white mb-1">Berhasil! 🎉</p>
            <p className="text-sm text-green-300/80 mb-5">
              Gokil... Kamu nemu {scene.objective.targetLabel}-nya!<br />Lemari bangga sama kamu 🚪
            </p>
            <div className="flex gap-3">
              <button
                onClick={onBack}
                className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-sm text-white font-medium transition-all"
              >
                Kembali
              </button>
              <button
                onClick={restart}
                className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-sm text-white font-bold transition-all"
              >
                Ulangi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
