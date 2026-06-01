export const estimateTokens = (text: string): number => {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
};

export const clipToTokenBudget = (text: string, budget: number): string => {
  const chars = Math.max(0, budget * 4);
  if (text.length <= chars) return text;
  return `${text.slice(0, chars)}\n... [truncated for token budget]`;
};
