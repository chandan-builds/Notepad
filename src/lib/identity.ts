const COLORS = [
  { color: "#c4492c", light: "#c4492c33" },
  { color: "#1f6b4a", light: "#1f6b4a33" },
  { color: "#1d4e89", light: "#1d4e8933" },
  { color: "#8a5a12", light: "#8a5a1233" },
  { color: "#6d3b74", light: "#6d3b7433" },
  { color: "#0f5f63", light: "#0f5f6333" },
  { color: "#9c3b55", light: "#9c3b5533" },
  { color: "#3e4c28", light: "#3e4c2833" },
];

const NAMES = ["Ink", "Ash", "Fern", "Clay", "Moss", "Reed", "Wren", "Sage", "Flint", "Brook"];

export type LocalIdentity = {
  name: string;
  color: string;
  colorLight: string;
};

export function randomIdentity(): LocalIdentity {
  const index = crypto.getRandomValues(new Uint8Array(1))[0] % COLORS.length;
  const color = COLORS[index];
  const name = NAMES[crypto.getRandomValues(new Uint8Array(1))[0] % NAMES.length];
  return { name, color: color.color, colorLight: color.light };
}
