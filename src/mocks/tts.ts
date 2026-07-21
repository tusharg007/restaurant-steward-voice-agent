export interface MockAudioOutput {
  text: string;
  durationMs: number;
  mocked: true;
}

/** Mock TTS boundary: returns deterministic metadata and performs no playback. */
export function synthesize(text: string): MockAudioOutput {
  return {
    text,
    durationMs: Math.max(300, Math.round(text.length * 45)),
    mocked: true,
  };
}
