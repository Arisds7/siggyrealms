"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface UseBackgroundMusicOptions {
  src: string;
  volume?: number;  // 0.0 – 1.0, default 0.4
  loop?: boolean;   // default true
  isMuted?: boolean; // optional control, default false
}

/**
 * useBackgroundMusic
 *
 * Mengelola musik latar yang looping otomatis di halaman game dengan dukungan
 * CROSSFADE halus saat properti `src` berubah (misal dari Siang ke Malam).
 */
export function useBackgroundMusic({
  src,
  volume: initialVolume = 0.4,
  loop = true,
}: UseBackgroundMusicOptions) {
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolumeState] = useState(initialVolume);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const userInteractedRef = useRef(false);

  // Simpan nilai state terbaru ke ref agar event listener interaksi selalu membaca yang terbaru
  const targetVolumeRef = useRef(isMuted ? 0 : volume);
  useEffect(() => {
    targetVolumeRef.current = isMuted ? 0 : volume;
    if (audioRef.current) {
      audioRef.current.volume = targetVolumeRef.current;
    }
  }, [isMuted, volume]);

  // ── Fungsi Play dengan Autoplay Fallback ──────────────────────────────────
  const playAudio = useCallback((audio: HTMLAudioElement) => {
    audio
      .play()
      .then(() => {
        userInteractedRef.current = true;
      })
      .catch(() => {
        // Autoplay diblokir browser, tunggu interaksi pertama
        const handleInteraction = () => {
          if (userInteractedRef.current) return;
          audio
            .play()
            .then(() => {
              userInteractedRef.current = true;
              window.removeEventListener("click", handleInteraction);
              window.removeEventListener("keydown", handleInteraction);
              window.removeEventListener("touchstart", handleInteraction);
            })
            .catch(() => {});
        };
        window.addEventListener("click", handleInteraction);
        window.addEventListener("keydown", handleInteraction);
        window.addEventListener("touchstart", handleInteraction);
      });
  }, []);

  // ── Efek Pergantian Lagu dengan Crossfade ──────────────────────────────────
  useEffect(() => {
    const fadeDurationMs = 1500; // Durasi transisi halus (1.5 detik)
    const fadeSteps = 30;
    const stepInterval = fadeDurationMs / fadeSteps;

    // Bersihkan interval transisi sebelumnya jika ada perubahan cepat
    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
    }

    const oldAudio = audioRef.current;
    const currentTargetVol = targetVolumeRef.current;

    // Buat element audio baru
    const newAudio = new Audio(src);
    newAudio.loop = loop;
    newAudio.preload = "auto";
    newAudio.muted = isMuted;

    if (oldAudio) {
      // Jika ada lagu lama, jalankan transisi silang (Crossfade)
      newAudio.volume = 0;
      audioRef.current = newAudio;

      // Mulai mainkan audio baru
      playAudio(newAudio);

      let step = 0;
      const oldStartVol = oldAudio.volume;

      fadeIntervalRef.current = setInterval(() => {
        step++;
        const progress = step / fadeSteps;

        // Kurangi volume lagu lama, naikkan volume lagu baru
        if (oldAudio) {
          oldAudio.volume = Math.max(0, oldStartVol * (1 - progress));
        }
        newAudio.volume = Math.min(currentTargetVol, currentTargetVol * progress);

        if (step >= fadeSteps) {
          if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);
          if (oldAudio) {
            oldAudio.pause();
            oldAudio.src = ""; // Release memory
          }
          newAudio.volume = currentTargetVol;
        }
      }, stepInterval);
    } else {
      // Pemutaran pertama kali (tanpa lagu lama)
      newAudio.volume = currentTargetVol;
      audioRef.current = newAudio;
      playAudio(newAudio);
    }

    // ── Cleanup saat component did-unmount ───────────────────────────────────
    return () => {
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
      }
      // Hentikan audio baru jika ditinggalkan
      newAudio.pause();
      newAudio.src = "";
      if (audioRef.current === newAudio) {
        audioRef.current = null;
      }
    };
  }, [src, loop, playAudio, isMuted]);

  // ── Kontrol Mute & Volume ──────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (audioRef.current) {
        audioRef.current.muted = next;
      }
      return next;
    });
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  }, []);

  return { isMuted, toggleMute, volume, setVolume };
}
