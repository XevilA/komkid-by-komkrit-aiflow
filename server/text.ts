// Shared text helpers.

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** Removes emoji and decorative pictographs. The brand voice is formal: none are ever published. */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?])/g, '$1');
}
