// The spelling-independent form of a product name, used to match names that differ only
// in accents, case, inch marks or spacing. Digits, dots, hyphens and slashes are kept:
// model numbers are what tell products apart ("S23" vs "S24", "12.9" vs "11").
export function normalizeProductName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // accents: "Câmera" -> "Camera"
    .toLowerCase()
    .replace(/''|"/g, '') // inch marks: 12.9'' = 12.9" = 12.9
    .replace(/\s+/g, ' ')
    .trim();
}
