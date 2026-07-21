/** Mock STT boundary: textual demo input stands in for an audio payload. */
export function transcribe(audioInput: string): string {
  return audioInput.trim();
}
