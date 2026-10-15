"use strict";

class NexusVisualizer {
  constructor(canvas, spectrum, audio) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.spectrum = spectrum;
    this.sctx = spectrum.getContext("2d");
    this.audio = audio;
    this.scene = "reactor";
    this.palette = "cyan";
    this.sensitivity = 1.4;
    this.smoothing = 75;
    this.glow = 65;
    this.transparency = 20;
    this.autoRotate = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.angle = -0.43;
    this.tilt = 0.53;
    this.zoom = 1;
    this.bands = new Float32Array(72);
    this.columns = [];
    this.history = [];
    this.lastFrame = 0;
    this.frameCount = 0;
    this.fpsAt = 0;
    this.fps = 60;
    this.isPreview = true;
    this.lastHistory = 0;
    for (let q = -13; q <= 13; q++) for (let r = -13; r <= 13; r++) {
      if (Math.abs(q + r) > 13) continue;
      const x = Math.sqrt(3) * (q + r / 2) * 0.57, z = r * 0.855;
      this.columns.push({ x, z, distance: Math.hypot(x, z), height: 0.2, seed: ((q * 37 + r * 61 + 2000) % 97) / 97 });
    }
    this.sorted = [...this.columns];
    this.particles = Array.from({ length: 68 }, (_, i) => ({ x: ((i * 719) % 997) / 997, y: ((i * 271) % 991) / 991, size: i % 3 === 0 ? 1.3 : 0.6 }));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resizeObserver.observe(spectrum);
    this.bindCamera();
    this.setPalette("cyan");
    this.resize();
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  setPalette(name) {
    this.palette = name;
    this.colors = {
      cyan: { primary: [104,229,224], secondary: [235,177,105], high: [185,143,255] },
      violet: { primary: [183,153,255], secondary: [107,223,233], high: [255,133,185] },
      amber: { primary: [255,168,104], secondary: [255,221,148], high: [230,131,232] }
    }[name];
    this.buildFrequencyColors();
  }

  color(alpha = 1, secondary = false) { return `rgba(${(secondary ? this.colors.secondary : this.colors.primary).join(",")},${alpha})`; }

  buildFrequencyColors() {
    // Use the same logarithmic frequency axis as the audio analyser.
    this.frequencyMaxHz = Math.min(20000, (this.audio.context?.sampleRate || 44100) / 2);
    const position = hz => Math.max(0, Math.min(1, Math.log(hz / 25) / Math.log(this.frequencyMaxHz / 25)));
    this.frequencyStops = [
      { at: 0, rgb: this.colors.secondary },
      { at: position(125), rgb: this.colors.secondary },
      { at: position(1000), rgb: this.colors.primary },
      { at: position(8000), rgb: this.colors.high },
      { at: 1, rgb: this.colors.high }
    ];
    this.frequencyColors = Array.from({ length: 72 }, (_, band) => {
      const t = (band + 0.5) / 72;
      const right = this.frequencyStops.findIndex(stop => stop.at >= t);
      const a = this.frequencyStops[Math.max(0, right - 1)], b = this.frequencyStops[right];
      const mix = b.at === a.at ? 0 : (t - a.at) / (b.at - a.at);
      return a.rgb.map((value, channel) => Math.round(value + (b.rgb[channel] - value) * mix));
    });
  }

  frequencyColor(band, alpha = 1) {
    return `rgba(${this.frequencyColors[Math.max(0, Math.min(71, Math.round(band)))].join(",")},${alpha})`;
  }

  frequencyGradient(g, start, end, alpha = 1) {
    const gradient = g.createLinearGradient(start[0], start[1], end[0], end[1]);
    for (const stop of this.frequencyStops) gradient.addColorStop(stop.at, `rgba(${stop.rgb.join(",")},${alpha})`);
    return gradient;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    for (const canvas of [this.canvas, this.spectrum]) {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
  }

  bindCamera() {
    let drag = null;
    this.canvas.addEventListener("pointerdown", event => {
      drag = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", event => {
      if (!drag) return;
      this.angle += (event.clientX - drag.x) * 0.006;
      this.tilt = Math.max(0.25, Math.min(0.85, this.tilt + (event.clientY - drag.y) * 0.0025));
      drag = { x: event.clientX, y: event.clientY };
    });
    this.canvas.addEventListener("pointerup", () => drag = null);
    this.canvas.addEventListener("pointercancel", () => drag = null);
    this.canvas.addEventListener("lostpointercapture", () => drag = null);
    this.canvas.addEventListener("wheel", event => {
      event.preventDefault();
      this.zoom = Math.max(0.6, Math.min(1.65, this.zoom - event.deltaY * 0.0009));
    }, { passive: false });
    this.isDragging = () => !!drag;
  }

  resetCamera() { this.angle = -0.43; this.tilt = 0.53; this.zoom = 1; }

  project(x, z, y = 0) {
    const rx = x * this.cos - z * this.sin, rz = x * this.sin + z * this.cos;
    return [this.width / 2 + rx * this.scale, this.height * 0.59 + rz * this.scale * this.tilt - y * this.scale];
  }

  path(points, fill, stroke, width = 0.6) {
    const g = this.ctx;
    g.beginPath();
    points.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    if (fill) { g.closePath(); g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
  }

  ring(radius, y, stroke, width = 1, begin = 0, end = Math.PI * 2) {
    const points = [];
    const steps = Math.ceil((end - begin) * 20);
    for (let i = 0; i <= steps; i++) {
      const angle = begin + i / steps * (end - begin);
      points.push(this.project(Math.cos(angle) * radius, Math.sin(angle) * radius, y));
    }
    this.path(points, null, stroke, width);
  }

  background(time) {
    const g = this.ctx, w = this.width, h = this.height;
    g.fillStyle = "#080f17"; g.fillRect(0, 0, w, h);
    const glow = g.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.55);
    glow.addColorStop(0, this.color(0.055 + this.glow * 0.0005));
    glow.addColorStop(0.55, "#0b192252"); glow.addColorStop(1, "#080f1700");
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    g.lineWidth = 0.5; g.strokeStyle = "#19313b44";
    for (let x = 20; x < w; x += 36) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 20; y < h; y += 36) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (const p of this.particles) {
      const y = (p.y * h - time * 0.003 * p.size + h * 100) % h;
      g.fillStyle = this.color(0.12 + p.size * 0.07);
      g.fillRect(p.x * w, y, p.size, p.size);
    }
    // Fine registration marks keep the visualization grounded in an instrument panel.
    g.strokeStyle = "#41677755"; g.lineWidth = 0.7;
    for (let x = 35; x < w - 15; x += 44) {
      g.beginPath(); g.moveTo(x, h - 1); g.lineTo(x, h - (x % 2 ? 5 : 8)); g.stroke();
    }
  }

  reactor(time, dt) {
    const g = this.ctx;
    this.cos = Math.cos(this.angle); this.sin = Math.sin(this.angle);
    this.scale = Math.min(this.width / 37, (this.height - 65) / 26) * this.zoom;
    const base = [];
    for (let i = 0; i <= 100; i++) base.push(this.project(Math.cos(i / 100 * Math.PI * 2) * 14.45, Math.sin(i / 100 * Math.PI * 2) * 14.45));
    this.path(base, "#0b1a23", this.color(0.22));
    for (let i = -12; i <= 12; i += 3) {
      const extent = Math.sqrt(14 * 14 - i * i);
      this.path([this.project(i, -extent), this.project(i, extent)], null, this.color(0.045));
      this.path([this.project(-extent, i), this.project(extent, i)], null, this.color(0.045));
    }
    this.ring(14.6, -0.5, "#031017", this.scale * 0.7);
    this.ring(14.6, -0.45, this.color(0.28), 0.9);
    this.ring(14.6, 0, this.color(0.4), 1.1);
    this.ring(15.15, 0, this.color(0.12), 0.7);
    this.ring(16.1, -0.12, this.color(0.1), 0.6);
    for (let i = 0; i < 90; i++) {
      const angle = i * Math.PI * 2 / 90;
      const outer = i % 5 === 0 ? 15.75 : 15.42;
      this.path([this.project(Math.cos(angle) * 15.2, Math.sin(angle) * 15.2), this.project(Math.cos(angle) * outer, Math.sin(angle) * outer)], null, this.color(i % 5 === 0 ? 0.5 : 0.2), i % 5 === 0 ? 1 : 0.6);
    }
    g.shadowColor = this.color(0.9); g.shadowBlur = this.glow * 0.18;
    this.ring(15.5, 0.02, this.color(0.8), 1.7, time * 0.00013, time * 0.00013 + 0.42);
    this.ring(15.5, 0.02, this.color(0.6, true), 1.7, time * 0.00013 + Math.PI, time * 0.00013 + Math.PI + 0.2);
    g.shadowBlur = 0;
    this.sorted.sort((a, b) => (a.x * this.sin + a.z * this.cos) - (b.x * this.sin + b.z * this.cos));
    const blend = 1 - Math.pow(0.12 + this.smoothing * 0.0087, dt);
    const offsets = Array.from({ length: 6 }, (_, i) => [Math.cos(Math.PI / 6 + i * Math.PI / 3) * 0.46, Math.sin(Math.PI / 6 + i * Math.PI / 3) * 0.46]);
    for (const column of this.sorted) {
      const band = Math.min(71, Math.floor(column.distance / 13.1 * 65 + column.seed * 5));
      const amp = Math.min(1.5, this.bands[band] * this.sensitivity);
      const ripple = this.isPreview ? 0.13 + 0.1 * Math.sin(column.distance * 0.65 - time * 0.0015) + column.seed * 0.07 : 0;
      const target = 0.2 + (amp ** 1.9 * 5.5 + ripple * 5);
      column.height += (target - column.height) * blend;
      const top = offsets.map(([x, z]) => this.project(column.x + x, column.z + z, column.height));
      const bottom = offsets.map(([x, z]) => this.project(column.x + x, column.z + z));
      const rgb = this.frequencyColors[band];
      const opacity = 1 - this.transparency / 100;
      const edgeAlpha = 0.22 + opacity * (0.2 + this.glow * 0.003);
      for (let side = 0; side < 6; side++) {
        const next = (side + 1) % 6;
        if (bottom[side][0] > bottom[next][0]) continue;
        const brightness = side % 2 === 0 ? 0.14 : 0.085;
        const face = rgb.map(value => Math.round(8 + value * (brightness + Math.min(amp, 1) * 0.035))).join(",");
        this.path([top[side], bottom[side], bottom[next], top[next]], `rgba(${face},${opacity})`, `rgba(${rgb.join(",")},${edgeAlpha * 0.6})`, 0.55);
      }
      const cap = rgb.map(value => Math.round(10 + value * (0.28 + this.glow * 0.0018 + Math.min(amp, 1) * 0.18))).join(",");
      this.path([...top, top[0]], `rgba(${cap},${opacity})`, `rgba(${rgb.join(",")},${edgeAlpha + Math.min(amp, 1) * 0.12})`, 0.65);
      const center = this.project(column.x, column.z, column.height + 0.015);
      g.fillStyle = "#c5fbec"; g.globalAlpha = (0.18 + amp * 0.2) * (0.3 + opacity * 0.7);
      g.fillRect(center[0] - 0.6, center[1] - 0.6, 1.2, 1.2); g.globalAlpha = 1;
    }
    // The front segment overlays the array and gives the platform a defined lip.
    this.ring(14.7, -0.12, this.color(0.32), 1.2, -this.angle, Math.PI - this.angle);
  }

  orbit(time) {
    const g = this.ctx, cx = this.width / 2, cy = this.height * 0.54;
    const radius = Math.min(this.width * 0.27, this.height * 0.29) * this.zoom;
    const energy = this.bands.reduce((a, b) => a + b, 0) / 72;
    g.save(); g.translate(cx, cy); g.rotate(this.angle * 0.3);
    const gradient = g.createRadialGradient(0, 0, radius * 0.15, 0, 0, radius * 1.7);
    gradient.addColorStop(0, this.color(0.1 + energy * 0.18)); gradient.addColorStop(0.5, this.color(0.015)); gradient.addColorStop(1, this.color(0));
    g.fillStyle = gradient; g.fillRect(-this.width, -this.height, this.width * 2, this.height * 2);
    for (let ring = 0; ring < 4; ring++) {
      g.beginPath(); g.ellipse(0, 0, radius * (1.05 + ring * 0.19), radius * (0.45 + ring * 0.04), ring * 0.8 + this.angle, 0, Math.PI * 2);
      g.strokeStyle = this.color(0.12 + ring * 0.025); g.lineWidth = 0.7; g.stroke();
    }
    for (let i = 0; i < 216; i++) {
      const angle = i / 216 * Math.PI * 2;
      const bandIndex = Math.min(71, Math.floor((i % 108) / 108 * 72));
      const band = this.bands[bandIndex];
      const amp = this.isPreview ? 0.13 + 0.09 * Math.sin(i * 0.19 + time * 0.0016) : band * this.sensitivity;
      const inner = radius * 0.8, outer = radius * (0.85 + amp * 0.5);
      g.beginPath(); g.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner); g.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      g.strokeStyle = this.frequencyColor(bandIndex, Math.min(1, 0.3 + amp * 0.55)); g.lineWidth = Math.max(1, radius * 0.012); g.stroke();
    }
    g.shadowColor = this.color(0.65); g.shadowBlur = this.glow * 0.22;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let i = 0; i <= 256; i++) {
        const angle = i / 256 * Math.PI * 2;
        const v = this.audio.playing ? this.audio.waveform[(i * 4) % 1024] * this.sensitivity : Math.sin(angle * 6 + time * 0.002) * (this.isPreview ? 0.07 : 0);
        const r = radius * (0.53 + k * 0.045 + v * 0.22);
        const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = this.color(k === 1 ? 0.75 : 0.25, k === 2); g.lineWidth = k === 1 ? 1.1 : 0.6; g.stroke();
    }
    g.shadowBlur = 0;
    g.fillStyle = this.color(0.8); g.textAlign = "center"; g.font = "10px Consolas, monospace";
    g.fillText("N E X U S", 0, -2);
    g.fillStyle = "#607e8d"; g.font = "7px Consolas, monospace"; g.fillText(this.audio.playing ? "PULSE CONNECTED" : "ORBITAL SYSTEM", 0, 15);
    for (let i = 0; i < 6; i++) {
      const angle = time * 0.00025 + i * 1.047;
      g.fillStyle = this.color(0.8, i === 2); g.beginPath();
      g.arc(Math.cos(angle) * radius * 1.3, Math.sin(angle) * radius * 0.55, i % 2 ? 1.6 : 2.5, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  terrain(time) {
    const g = this.ctx;
    this.cos = Math.cos(this.angle * 0.45); this.sin = Math.sin(this.angle * 0.45);
    this.scale = Math.min(this.width / 37, (this.height - 70) / 23) * this.zoom;
    if (time - this.lastHistory > 45) {
      this.history.unshift(Float32Array.from(this.bands));
      if (this.history.length > 32) this.history.pop();
      this.lastHistory = time;
    }
    this.path([this.project(-15, -12), this.project(15, -12), this.project(15, 12), this.project(-15, 12), this.project(-15, -12)], "#0b1922", this.color(0.15));
    g.shadowColor = this.color(0.5); g.shadowBlur = this.glow * 0.035;
    for (let row = 0; row < 32; row++) {
      const points = [], data = this.history[31 - row] || this.bands;
      for (let col = 0; col < 60; col++) {
        const sample = data[Math.floor(col / 60 * 72)];
        const v = this.isPreview ? 0.13 + (Math.sin(col * 0.23 + row * 0.27 - time * 0.0009) + Math.cos(col * 0.38 - row * 0.15)) * 0.08 : sample * this.sensitivity;
        points.push(this.project((col / 59 - 0.5) * 29, (row / 31 - 0.5) * 22, Math.max(0, v) ** 1.5 * 7));
      }
      const start = this.project(-14.5, (row / 31 - 0.5) * 22);
      const end = this.project(14.5, (row / 31 - 0.5) * 22);
      this.path([start, ...points, end], "#0a1721", null);
      const alpha = 0.16 + row / 31 * 0.63, lineWidth = row === 31 ? 1.2 : 0.7;
      if (Math.abs(end[0] - start[0]) > 1) {
        // Height changes only screen Y; horizontal color stops keep each frequency's hue stable.
        const gradient = this.frequencyGradient(g, [start[0], 0], [end[0], 0], alpha);
        this.path(points, null, gradient, lineWidth);
      } else {
        for (let col = 0; col < points.length - 1; col++) {
          this.path([points[col], points[col + 1]], null, this.frequencyColor((col + 0.5) / 60 * 72, alpha), lineWidth);
        }
      }
      if (row % 3 === 0) for (let col = 0; col < 60; col += 4) {
        g.fillStyle = this.frequencyColor(Math.floor(col / 60 * 72), 0.5); g.fillRect(points[col][0], points[col][1], 1, 1);
      }
    }
    g.shadowBlur = 0;
  }

  drawSpectrum() {
    const g = this.sctx, w = this.spectrum.clientWidth, h = this.spectrum.clientHeight;
    g.clearRect(0, 0, w, h);
    const count = 44, step = w / count;
    for (let i = 0; i < count; i++) {
      const band = Math.floor(i / (count - 1) * 71);
      const value = this.bands[band];
      const height = Math.max(2, Math.min(1, value * this.sensitivity) * (h - 2));
      g.fillStyle = this.frequencyColor(band, this.audio.playing ? Math.min(1, 0.35 + value * 0.6) : 0.22);
      g.fillRect(i * step, h - height, Math.max(1, step - 2), height);
    }
  }

  tick(time) {
    if (time - this.lastFrame < 15.8) { requestAnimationFrame(this.tick); return; }
    const dt = Math.min(3, (time - this.lastFrame) / 16.667 || 1);
    this.lastFrame = time;
    if (!document.hidden) {
      const bands = this.audio.sample();
      if (Math.min(20000, (this.audio.context?.sampleRate || 44100) / 2) !== this.frequencyMaxHz) this.buildFrequencyColors();
      const blend = 1 - Math.pow(0.3 + this.smoothing * 0.006, dt);
      for (let i = 0; i < 72; i++) this.bands[i] += (bands[i] - this.bands[i]) * blend;
      if (this.autoRotate && !this.isDragging()) this.angle += dt * 0.0011;
      this.background(time);
      if (this.scene === "reactor") this.reactor(time, dt);
      else if (this.scene === "orbit") this.orbit(time);
      else this.terrain(time);
      this.drawSpectrum();
      this.frameCount++;
      if (time - this.fpsAt >= 1000) { this.fps = Math.round(this.frameCount * 1000 / (time - this.fpsAt)); this.frameCount = 0; this.fpsAt = time; }
    }
    requestAnimationFrame(this.tick);
  }

  saveSnapshot(title) {
    const output = document.createElement("canvas");
    output.width = this.canvas.width; output.height = this.canvas.height;
    const g = output.getContext("2d"); g.drawImage(this.canvas, 0, 0);
    const dpr = this.canvas.width / this.width;
    g.scale(dpr, dpr);
    g.fillStyle = "#b6e4e5"; g.font = "14px Segoe UI, sans-serif"; g.fillText(`NEXUS / ${title}`, 24, 34);
    g.fillStyle = "#6a9aa8"; g.font = "9px Consolas, monospace"; g.fillText("SOUND INTO MATTER", 24, this.height - 23);
    output.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `NEXUS-${this.scene}-${Date.now()}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  }
}
window.NexusVisualizer = NexusVisualizer;
