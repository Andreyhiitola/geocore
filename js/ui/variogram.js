export function calculateVariogram(holes) {
  console.log('[VARIO] Расчёт вариограммы');
  const pts = [];
  holes.forEach(h => h.intervals.forEach(([from, to, val]) => {
    pts.push({ x: h.x, y: -(from + to) / 2 * 0.5, z: h.z, val });
  }));
  if (pts.length < 10) {
    console.warn('[VARIO] Недостаточно точек:', pts.length);
    return null;
  }

  const compute = (dir, maxD = 40, bins = 12) => {
    const step = maxD / bins;
    const bd = Array(bins).fill(0).map((_, i) => ({ dist: (i + 0.5) * step, sum: 0, cnt: 0 }));
    const norm = Math.hypot(dir.x, dir.y, dir.z);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y, dz = pts[j].z - pts[i].z;
        const proj = Math.abs(dx * dir.x + dy * dir.y + dz * dir.z) / norm;
        if (proj > maxD) continue;
        const bi = Math.min(bins - 1, Math.floor(proj / step));
        bd[bi].sum += 0.5 * (pts[i].val - pts[j].val) ** 2;
        bd[bi].cnt++;
      }
    }
    return bd.filter(b => b.cnt > 3).map(b => ({ dist: b.dist, gamma: b.sum / b.cnt }));
  };
  
  return {
    strike: compute({ x: 1, y: 0, z: 0 }),
    dip:    compute({ x: 0, y: 1, z: 0 }),
    perp:   compute({ x: 0, y: 0, z: 1 })
  };
}

export function drawVariogram(vg) {
  const canvas = document.getElementById('variogramPlot');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth || 500, H = canvas.clientHeight || 260;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  const all = [...(vg.strike || []), ...(vg.dip || []), ...(vg.perp || [])];
  if (!all.length) {
    ctx.fillStyle = '#9A9890';
    ctx.font = '12px monospace';
    ctx.fillText('Недостаточно данных', 20, 40);
    return;
  }
  
  let maxG = 0, maxD = 0;
  all.forEach(p => { maxG = Math.max(maxG, p.gamma); maxD = Math.max(maxD, p.dist); });
  maxG *= 1.1; maxD *= 1.05;

  ctx.strokeStyle = '#5C5B56';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, H - 40);
  ctx.lineTo(W - 20, H - 40);
  ctx.moveTo(40, H - 40);
  ctx.lineTo(40, 20);
  ctx.stroke();
  ctx.fillStyle = '#9A9890';
  ctx.font = '10px monospace';
  ctx.fillText('Расстояние (м)', W / 2 - 40, H - 6);

  const series = [
    { data: vg.strike, color: '#E87070', label: 'Простирание' },
    { data: vg.dip,    color: '#7ee787', label: 'Падение' },
    { data: vg.perp,   color: '#C9A84C', label: 'Поперечное' }
  ];
  
  series.forEach(({ data, color, label }, si) => {
    ctx.fillStyle = color;
    ctx.fillRect(W - 110, 20 + si * 20, 10, 10);
    ctx.fillStyle = '#9A9890';
    ctx.fillText(label, W - 97, 29 + si * 20);
    if (!data?.length) return;
    ctx.fillStyle = color;
    data.forEach(p => {
      const x = 40 + (p.dist / maxD) * (W - 60);
      const y = (H - 40) - (p.gamma / maxG) * (H - 80);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
      ctx.fill();
    });
  });
}
