export function calculateVariogram(holes) {
  const pts = [];
  holes.forEach(h => h.intervals.forEach(([from, to, val]) => {
    pts.push({ x: h.x, y: -(from + to) / 2 * 0.5, z: h.z, val });
  }));
  if (pts.length < 10) return null;
  const compute = (dir, maxD = 40, bins = 12) => {
    const step = maxD / bins;
    const bd = Array(bins).fill().map((_, i) => ({ dist: (i + 0.5) * step, sum: 0, cnt: 0 }));
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
  return { strike: compute({ x: 1, y: 0, z: 0 }), dip: compute({ x: 0, y: 1, z: 0 }), perp: compute({ x: 0, y: 0, z: 1 }) };
}

export function drawVariogram(vg, targetId = 'variogramPlotLarge') {
  const canvas = document.getElementById(targetId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);
  const all = [...(vg.strike || []), ...(vg.dip || []), ...(vg.perp || [])];
  if (!all.length) { ctx.fillStyle = '#9A9890'; ctx.font = '18px monospace'; ctx.fillText('Недостаточно данных', W/2-100, H/2); return; }
  let maxG = 0, maxD = 0;
  all.forEach(p => { maxG = Math.max(maxG, p.gamma); maxD = Math.max(maxD, p.dist); });
  maxG *= 1.15; maxD *= 1.1;
  const left = 70, right = 40, top = 45, bottom = 60, plotW = W - left - right, plotH = H - top - bottom;
  ctx.fillStyle = '#0a121c'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#2a3a4a'; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = left + (i / 5) * plotW; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + plotH); ctx.stroke();
    const y = top + (i / 5) * plotH; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + plotW, y); ctx.stroke();
  }
  ctx.strokeStyle = '#c9a84c'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(left, top + plotH); ctx.lineTo(left + plotW, top + plotH); ctx.moveTo(left, top); ctx.lineTo(left, top + plotH); ctx.stroke();
  ctx.fillStyle = '#9A9890'; ctx.font = '12px monospace';
  ctx.fillText('Расстояние (м)', left + plotW / 2 - 50, top + plotH + 30);
  ctx.save(); ctx.translate(25, top + plotH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('γ(h)', -20, 0); ctx.restore();
  const colors = { strike: '#E87070', dip: '#7ee787', perp: '#C9A84C' };
  const drawPoints = (data, color) => { if (!data) return; data.forEach(p => { const x = left + (p.dist / maxD) * plotW; const y = top + plotH - (p.gamma / maxG) * plotH; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 5, 0, 2*Math.PI); ctx.fill(); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, 2, 0, 2*Math.PI); ctx.fill(); }); };
  drawPoints(vg.strike, colors.strike); drawPoints(vg.dip, colors.dip); drawPoints(vg.perp, colors.perp);
  const sill = all.reduce((s, p) => s + p.gamma, 0) / all.length;
  const sillY = top + plotH - (sill / maxG) * plotH;
  ctx.strokeStyle = 'rgba(201,168,76,0.7)'; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(left, sillY); ctx.lineTo(left + plotW, sillY); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#C9A84C'; ctx.font = '10px monospace'; ctx.fillText(`sill=${sill.toFixed(2)}`, left + plotW - 90, sillY - 6);
  ctx.fillStyle = '#9A9890'; ctx.fillText(`${maxD.toFixed(0)}м`, left + plotW - 40, top + plotH + 22);
}
