// Generates crisp, realistic remote sensing satellite scene rasters using HTML5 Canvas
// Ensures 100% offline self-contained demo execution without external network latency

export function generateSyntheticSatelliteScene(
  type: 'coastal' | 'agricultural' | 'urban_t1' | 'urban_t2' | 'optical' | 'sar',
  width = 512,
  height = 512
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  if (type === 'coastal') {
    // Water and shoreline
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#164e63'); // Dark cyan deep water
    grad.addColorStop(0.45, '#0e7490'); // Ocean blue
    grad.addColorStop(0.52, '#d4d4d8'); // Sand beach
    grad.addColorStop(0.58, '#15803d'); // Coastal vegetation
    grad.addColorStop(1, '#166534'); // Dense forest
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // River delta inlet
    ctx.beginPath();
    ctx.moveTo(width * 0.2, 0);
    ctx.bezierCurveTo(width * 0.35, height * 0.3, width * 0.45, height * 0.5, width * 0.5, height);
    ctx.lineWidth = 36;
    ctx.strokeStyle = '#0891b2';
    ctx.stroke();

    // Urban cluster
    ctx.fillStyle = '#64748b';
    for (let i = 0; i < 30; i++) {
      const rx = width * 0.65 + (Math.sin(i * 99) * 0.5 + 0.5) * (width * 0.28);
      const ry = height * 0.6 + (Math.cos(i * 33) * 0.5 + 0.5) * (height * 0.3);
      ctx.fillRect(rx, ry, 12, 10);
    }
  } else if (type === 'agricultural') {
    // Center pivot circular fields and rectangular parcels
    ctx.fillStyle = '#14532d';
    ctx.fillRect(0, 0, width, height);

    const colors = ['#15803d', '#166534', '#ca8a04', '#854d0e', '#65a30d', '#4d7c0f'];
    // Rectangular crop fields
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        ctx.fillStyle = colors[(r * 5 + c) % colors.length];
        ctx.fillRect(c * (width / 5) + 4, r * (height / 5) + 4, width / 5 - 8, height / 5 - 8);
      }
    }

    // Circular center-pivot irrigation circles
    ctx.fillStyle = '#84cc16';
    ctx.beginPath();
    ctx.arc(width * 0.3, height * 0.35, 45, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#eab308';
    ctx.beginPath();
    ctx.arc(width * 0.7, height * 0.65, 55, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'urban_t1') {
    // Earlier Date (Time T1): Mostly green/vegetation with modest town center
    ctx.fillStyle = '#166534';
    ctx.fillRect(0, 0, width, height);

    // River
    ctx.beginPath();
    ctx.moveTo(0, height * 0.4);
    ctx.bezierCurveTo(width * 0.4, height * 0.35, width * 0.6, height * 0.5, width, height * 0.45);
    ctx.lineWidth = 28;
    ctx.strokeStyle = '#0284c7';
    ctx.stroke();

    // Small town center
    ctx.fillStyle = '#94a3b8';
    for (let i = 0; i < 25; i++) {
      const bx = width * 0.2 + (i % 5) * 22;
      const by = height * 0.6 + Math.floor(i / 5) * 20;
      ctx.fillRect(bx, by, 16, 14);
    }
  } else if (type === 'urban_t2') {
    // Later Date (Time T2): Significant urban expansion, cleared vegetation, new highways
    ctx.fillStyle = '#166534';
    ctx.fillRect(0, 0, width, height);

    // River remains
    ctx.beginPath();
    ctx.moveTo(0, height * 0.4);
    ctx.bezierCurveTo(width * 0.4, height * 0.35, width * 0.6, height * 0.5, width, height * 0.45);
    ctx.lineWidth = 28;
    ctx.strokeStyle = '#0284c7';
    ctx.stroke();

    // New highway crossing scene
    ctx.beginPath();
    ctx.moveTo(width * 0.1, 0);
    ctx.lineTo(width * 0.9, height);
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#cbd5e1';
    ctx.stroke();

    // Massive urban expansion (doubled town size + commercial zones)
    ctx.fillStyle = '#cbd5e1';
    for (let i = 0; i < 90; i++) {
      const bx = width * 0.15 + (i % 10) * 24;
      const by = height * 0.5 + Math.floor(i / 10) * 18;
      ctx.fillRect(bx, by, 18, 14);
    }
  } else if (type === 'optical') {
    // Natural color optical composite
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#15803d');
    grad.addColorStop(0.6, '#334155');
    grad.addColorStop(1, '#0369a1');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Cloud shadow
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.arc(width * 0.45, height * 0.25, 60, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'sar') {
    // SAR microwave backscatter: dark water specular reflection, bright double bounce urban
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, width, height);

    // Add SAR speckle noise
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 50;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = data[i];
      data[i + 2] = data[i];
    }
    ctx.putImageData(imgData, 0, 0);

    // Water: near black specular reflection
    ctx.fillStyle = '#050505';
    ctx.beginPath();
    ctx.arc(width * 0.75, height * 0.7, 90, 0, Math.PI * 2);
    ctx.fill();

    // Urban structures: high backscatter (bright white corner reflectors)
    ctx.fillStyle = '#f8fafc';
    for (let i = 0; i < 40; i++) {
      const x = width * 0.2 + (i % 7) * 24;
      const y = height * 0.3 + Math.floor(i / 7) * 22;
      ctx.fillRect(x, y, 14, 14);
    }
  }

  return canvas.toDataURL('image/png');
}
