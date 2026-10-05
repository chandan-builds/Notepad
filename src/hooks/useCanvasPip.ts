"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type EditorScrollState = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

type UseCanvasPipOptions = {
  title: string;
  content: string;
  scrollState: EditorScrollState;
};

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const EMPTY_SCROLL: EditorScrollState = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };

function wrapText(ctx: CanvasRenderingContext2D, input: string, maxWidth: number): string[] {
  const output: string[] = [];
  for (const line of input.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      output.push("");
      continue;
    }
    const words = line.split(/\s+/);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) output.push(current);
      current = word;
    }
    output.push(current);
  }
  return output;
}

function palette() {
  const dark = document.documentElement.dataset.theme === "dark";
  return dark
    ? { paper: "#241e18", ink: "#f6efe4", rule: "#e07a5f", soft: "#cbbba8" }
    : { paper: "#f4ecdc", ink: "#1c1612", rule: "#c4492c", soft: "#5e5348" };
}

function renderNoteFrame(canvas: HTMLCanvasElement, title: string, content: string, scrollState: EditorScrollState): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const colors = palette();
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = colors.rule;
  ctx.fillRect(0, 0, CANVAS_WIDTH, 10);
  ctx.fillStyle = colors.ink;
  ctx.font = "600 34px Palatino, 'Iowan Old Style', serif";
  ctx.fillText(title || "Untitled Note", 28, 64);
  ctx.strokeStyle = colors.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(28, 88);
  ctx.lineTo(CANVAS_WIDTH - 28, 88);
  ctx.stroke();
  ctx.fillStyle = colors.soft;
  ctx.font = "400 24px Palatino, 'Iowan Old Style', serif";
  const lines = wrapText(ctx, content || "Start typing…", CANVAS_WIDTH - 56);
  const lineHeight = 34;
  const contentTop = 128;
  const contentBottom = CANVAS_HEIGHT - 24;
  const visibleLineCount = Math.max(1, Math.floor((contentBottom - contentTop) / lineHeight));
  const maxStartIndex = Math.max(0, lines.length - visibleLineCount);
  const maxScrollableDistance = Math.max(0, scrollState.scrollHeight - scrollState.clientHeight);
  const scrollRatio = maxScrollableDistance === 0 ? 0 : scrollState.scrollTop / maxScrollableDistance;
  const startLineIndex = Math.min(maxStartIndex, Math.floor(scrollRatio * maxStartIndex));
  let y = contentTop;
  for (const line of lines.slice(startLineIndex, startLineIndex + visibleLineCount)) {
    if (y >= contentBottom) break;
    ctx.fillText(line, 28, y);
    y += lineHeight;
  }
}

export function useCanvasPip({ title, content, scrollState }: UseCanvasPipOptions) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPipOpen, setIsPipOpen] = useState(false);

  const isSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    return Boolean(document.pictureInPictureEnabled && HTMLCanvasElement.prototype.captureStream);
  }, []);

  const stopStream = useCallback(() => {
    const video = videoRef.current;
    const stream = video?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    setIsPipOpen(false);
  }, []);

  const ensureNodes = useCallback(() => {
    if (!canvasRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      canvasRef.current = canvas;
    }
    if (!videoRef.current) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.style.position = "fixed";
      video.style.width = "1px";
      video.style.height = "1px";
      video.style.opacity = "0";
      video.style.pointerEvents = "none";
      document.body.appendChild(video);
      videoRef.current = video;
      video.addEventListener("leavepictureinpicture", () => stopStream());
    }
  }, [stopStream]);

  const openPip = useCallback(async () => {
    if (!isSupported) return;
    try {
      ensureNodes();
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      renderNoteFrame(canvas, title, content, scrollState);
      video.srcObject = canvas.captureStream(12);
      await video.play();
      if (document.pictureInPictureElement !== video) await video.requestPictureInPicture();
      setIsPipOpen(true);
    } catch {
      stopStream();
    }
  }, [content, ensureNodes, isSupported, scrollState, stopStream, title]);

  useEffect(() => {
    if (!isPipOpen || !canvasRef.current) return;
    renderNoteFrame(canvasRef.current, title, content, scrollState);
  }, [content, isPipOpen, scrollState, title]);

  useEffect(() => {
    return () => {
      videoRef.current?.parentNode?.removeChild(videoRef.current);
      stopStream();
    };
  }, [stopStream]);

  return { isSupported, isPipOpen, openPip };
}

export { EMPTY_SCROLL };
