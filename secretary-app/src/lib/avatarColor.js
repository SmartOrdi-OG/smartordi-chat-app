// Mirrors colorForName() -- a stable hash-based color pick, same palette.
const AVATAR_COLORS = ['#0E5E56', '#7c3aed', '#f59e0b', '#ec4899', '#0d9488', '#16a34a', '#dc2626', '#0891b2'];

export function colorForName(name) {
  const str = name || '';
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
