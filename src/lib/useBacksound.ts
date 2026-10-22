// Nerfyu
// Backsound
import { useCallback, useEffect, useRef, useState } from 'react';

export const BACKSOUND_SRC = `${import.meta.env.BASE_URL ?? '/'}audio/backsound.mp3`;
const VOLUME = 0.35; // 0 sampai 1
const STORAGE_KEY = 'lemariku_backsound_muted';

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* penyimpanan tidak tersedia, abaikan */
  }
}

// paused = true saat musik harus berhenti sementara (misalnya sedang panggilan suara).
export function useBacksound(paused: boolean) {
  const [muted, setMuted] = useState<boolean>(readMuted);
  const [failed, setFailed] = useState(false);

  const mutedRef = useRef(muted);
  const pausedRef = useRef(paused);
  const failedRef = useRef(false);
  const startingRef = useRef(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Menyesuaikan volume dengan keadaan sekarang (mute, dijeda, tab tersembunyi) secara halus.
  const applyVolume = useCallback(() => {
    const ctx = ctxRef.current;
    const gain = gainRef.current;
    if (!ctx || !gain) return;

    const isSilent = () => mutedRef.current || pausedRef.current || document.hidden;
    const silent = isSilent();

    if (!silent && ctx.state === 'suspended') ctx.resume().catch(() => {});
    gain.gain.setTargetAtTime(silent ? 0 : VOLUME, ctx.currentTime, 0.15);

    // Setelah fade-out selesai, hentikan mesin audio sepenuhnya supaya hemat baterai.
    if (silent) {
      window.setTimeout(() => {
        if (ctxRef.current === ctx && isSilent() && ctx.state === 'running') {
          ctx.suspend().catch(() => {});
        }
      }, 800);
    }
  }, []);

  // Memuat file dan memutarnya berulang. Dipanggil dari sentuhan pengguna (syarat browser).
  const start = useCallback(async () => {
    if (ctxRef.current || startingRef.current) {
      applyVolume();
      return;
    }
    if (mutedRef.current || failedRef.current) return;

    startingRef.current = true;
    let ctx: AudioContext | null = null;
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new AC() as AudioContext;
      ctxRef.current = ctx;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      gainRef.current = gain;

      const res = await fetch(BACKSOUND_SRC);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      if (ctxRef.current !== ctx) return; // sudah dibersihkan selama memuat

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true; // hanya looping, tidak ada tombol putar/berhenti/lewati
      source.connect(gain);
      source.start(0);
      sourceRef.current = source;

      applyVolume();
    } catch (err) {
      console.warn('[backsound] gagal memuat', BACKSOUND_SRC, err);
      failedRef.current = true;
      setFailed(true);
      ctx?.close().catch(() => {});
      if (ctxRef.current === ctx) {
        ctxRef.current = null;
        gainRef.current = null;
      }
    } finally {
      startingRef.current = false;
    }
  }, [applyVolume]);

  const toggle = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    writeMuted(next);

    if (next) {
      applyVolume();
    } else {
      // Unmute = kesempatan mencoba memuat ulang jika sebelumnya gagal
      failedRef.current = false;
      setFailed(false);
      void start();
    }
  }, [applyVolume, start]);

  // Browser baru mengizinkan suara setelah pengguna menyentuh layar. Sentuhan pertama memulai musik;
  // sentuhan berikutnya hanya memastikan musik tidak terhenti oleh browser.
  useEffect(() => {
    const onGesture = () => {
      void start();
    };
    const onVisibility = () => applyVolume();

    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      document.removeEventListener('visibilitychange', onVisibility);
      try {
        sourceRef.current?.stop();
      } catch {
        /* sudah berhenti */
      }
      sourceRef.current = null;
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      gainRef.current = null;
      startingRef.current = false;
    };
  }, [start, applyVolume]);

  useEffect(() => {
    pausedRef.current = paused;
    applyVolume();
  }, [paused, applyVolume]);

  return { muted, toggle, failed };
}