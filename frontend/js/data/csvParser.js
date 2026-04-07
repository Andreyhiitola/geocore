import { mulberry32 } from '../utils/helpers.js';

export function parseCSV(text) {
  console.log('[CSV] Начало парсинга, длина текста:', text.length);
  const lines = text.split('\n');
  const map = new Map();
  const header = lines[0]?.toLowerCase() || '';
  const hasHeader = isNaN(+header.split(',')[1]);
  const rng = mulberry32(42);

  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < 4) continue;
    
    const id = parts[0].trim();
    const from = +parts[1];
    const to = +parts[2];
    const val = +parts[3];
    
    if (isNaN(from) || isNaN(to) || isNaN(val)) continue;

    if (!map.has(id)) {
      map.set(id, {
        id,
        x: (rng() - 0.5) * 40,
        z: (rng() - 0.5) * 40,
        depth: 0,
        intervals: []
      });
    }
    const h = map.get(id);
    h.intervals.push([from, to, val]);
    if (to > h.depth) h.depth = to;
  }
  
  const holes = Array.from(map.values());
  console.log(`[CSV] Парсинг завершён: ${holes.length} скважин, интервалов: ${holes.reduce((s,h)=>s+h.intervals.length,0)}`);
  return holes;
}
