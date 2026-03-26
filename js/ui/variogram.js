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
  return {
    strike: compute({ x: 1, y: 0, z: 0 }),
    dip: compute({ x: 0, y: 1, z: 0 }),
    perp: compute({ x: 0, y: 0, z: 1 })
  };
}

// Сферическая модель вариограммы
function sphericalModel(h, nugget, sill, range_) {
  let gamma;
  if (h <= range_) {
    gamma = nugget + sill * (1.5 * h / range_ - 0.5 * Math.pow(h / range_, 3));
  } else {
    gamma = nugget + sill;
  }
  return gamma;
}

// Автоматический подбор параметров (упрощённый)
function fitVariogram(distances, gammas) {
  if (distances.length < 4) return null;
  
  // Находим последнюю точку для приблизительного силла
  const lastGamma = gammas[gammas.length - 1];
  const lastDist = distances[distances.length - 1];
  
  // Приблизительные значения
  let nugget = gammas[0] || 0.1;
  let sill = Math.max(lastGamma - nugget, 0.5);
  let range_ = lastDist * 0.7;
  
  // Простая оптимизация (поиск лучшего range)
  let bestR2 = -Infinity;
  let bestParams = { nugget, sill, range_ };
  
  for (let r = range_ * 0.5; r <= range_ * 1.5; r += range_ * 0.1) {
    let ssRes = 0;
    let ssTot = 0;
    const meanGamma = gammas.reduce((a, b) => a + b, 0) / gammas.length;
    
    for (let i = 0; i < distances.length; i++) {
      const pred = sphericalModel(distances[i], nugget, sill, r);
      ssRes += Math.pow(gammas[i] - pred, 2);
      ssTot += Math.pow(gammas[i] - meanGamma, 2);
    }
    const r2 = 1 - ssRes / ssTot;
    if (r2 > bestR2) {
      bestR2 = r2;
      bestParams = { nugget, sill, range_: r };
    }
  }
  
  return {
    nugget: bestParams.nugget,
    sill: bestParams.sill,
    range: bestParams.range_,
    r2: bestR2
  };
}

export function drawVariogram(vg, targetId = 'variogramPlotLarge') {
  const canvas = document.getElementById(targetId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);
  
  const all = [...(vg.strike || []), ...(vg.dip || []), ...(vg.perp || [])];
  if (!all.length) {
    ctx.fillStyle = '#9A9890';
    ctx.font = '18px monospace';
    ctx.fillText('Недостаточно данных', W/2-120, H/2);
    return;
  }
  
  let maxG = 0, maxD = 0;
  all.forEach(p => { maxG = Math.max(maxG, p.gamma); maxD = Math.max(maxD, p.dist); });
  maxG *= 1.15;
  maxD *= 1.1;
  
  const left = 70, right = 40, top = 45, bottom = 60;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  
  ctx.fillStyle = '#0a121c';
  ctx.fillRect(0, 0, W, H);
  
  // Сетка
  ctx.strokeStyle = '#2a3a4a';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = left + (i / 5) * plotW;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + plotH); ctx.stroke();
    const y = top + (i / 5) * plotH;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + plotW, y); ctx.stroke();
  }
  
  // Оси
  ctx.strokeStyle = '#c9a84c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, top + plotH);
  ctx.lineTo(left + plotW, top + plotH);
  ctx.moveTo(left, top);
  ctx.lineTo(left, top + plotH);
  ctx.stroke();
  
  // Подписи
  ctx.fillStyle = '#9A9890';
  ctx.font = '12px monospace';
  ctx.fillText('Расстояние (м)', left + plotW / 2 - 50, top + plotH + 30);
  ctx.save();
  ctx.translate(25, top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('γ(h)', -20, 0);
  ctx.restore();
  
  // Легенда и точки
  const colors = { strike: '#E87070', dip: '#7ee787', perp: '#C9A84C' };
  const labels = { strike: 'Простирание', dip: 'Падение', perp: 'Поперечное' };
  
  let legendY = top + 10;
  let fittedParams = {};
  
  for (const [key, data] of Object.entries(vg)) {
    if (!data?.length) continue;
    
    // Подбираем модель
    const distances = data.map(p => p.dist);
    const gammas = data.map(p => p.gamma);
    const fit = fitVariogram(distances, gammas);
    if (fit) fittedParams[key] = fit;
    
    // Рисуем точки
    data.forEach(p => {
      const x = left + (p.dist / maxD) * plotW;
      const y = top + plotH - (p.gamma / maxG) * plotH;
      ctx.fillStyle = colors[key];
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, 2 * Math.PI);
      ctx.fill();
    });
    
    // Рисуем подобранную модель
    if (fit && distances.length > 0) {
      ctx.beginPath();
      let first = true;
      for (let d = 0; d <= maxD; d += maxD / 50) {
        const gamma = sphericalModel(d, fit.nugget, fit.sill, fit.range);
        if (gamma <= maxG) {
          const x = left + (d / maxD) * plotW;
          const y = top + plotH - (gamma / maxG) * plotH;
          if (first) { ctx.moveTo(x, y); first = false; }
          else ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = colors[key];
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    
    // Легенда
    ctx.fillStyle = colors[key];
    ctx.fillRect(left + plotW - 140, legendY, 12, 12);
    ctx.fillStyle = '#9A9890';
    ctx.font = '10px monospace';
    ctx.fillText(labels[key], left + plotW - 122, legendY + 10);
    if (fit) {
      ctx.fillStyle = '#7ee787';
      ctx.font = '9px monospace';
      ctx.fillText(`R²=${fit.r2.toFixed(2)}`, left + plotW - 122, legendY + 22);
      legendY += 28;
    } else {
      legendY += 22;
    }
  }
  
  // Линия силла
  const allGammas = all.map(p => p.gamma);
  const sill = allGammas.reduce((a, b) => a + b, 0) / allGammas.length;
  const sillY = top + plotH - (sill / maxG) * plotH;
  ctx.strokeStyle = 'rgba(201,168,76,0.6)';
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(left, sillY);
  ctx.lineTo(left + plotW, sillY);
  ctx.stroke();
  ctx.setLineDash([]);
  
  ctx.fillStyle = '#C9A84C';
  ctx.font = '10px monospace';
  ctx.fillText(`sill ≈ ${sill.toFixed(2)}`, left + plotW - 90, sillY - 6);
  ctx.fillStyle = '#9A9890';
  ctx.fillText(`${maxD.toFixed(0)} м`, left + plotW - 40, top + plotH + 22);
  
  // Возвращаем параметры для отображения в статистике
  return fittedParams;
}
