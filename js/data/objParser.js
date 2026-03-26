export function parseOBJ(text) {
  console.log('[OBJ] Начало парсинга');
  const vertices = [], faces = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/).map(Number);
      vertices.push([x, y, z]);
    } else if (line.startsWith('f ')) {
      const parts = line.slice(2).split(/\s+/);
      const idx = parts.map(p => parseInt(p.split('/')[0]) - 1).filter(n => !isNaN(n));
      if (idx.length >= 3) {
        for (let i = 0; i < idx.length - 2; i++) {
          faces.push({ v: [idx[0], idx[i + 1], idx[i + 2]] });
        }
      }
    }
  }
  console.log(`[OBJ] Парсинг завершён: ${vertices.length} вершин, ${faces.length} граней`);
  return { vertices, faces };
}
