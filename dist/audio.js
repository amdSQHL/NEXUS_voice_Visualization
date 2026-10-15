/* NEXUS audio engine. All synthesis, decoding and analysis happen on this device. */
"use strict";

class NexusAudio extends EventTarget {
  constructor() {
    super();
    this.context = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this.buffer = null;
    this.demoBuffer = null;
    this.demoPromise = null;
    this.mode = "music";
    this.playing = false;
    this.busy = false;
    this.loop = true;
    this.volume = 0.45;
    this.muted = false;
    this.offset = 0;
    this.startedAt = 0;
    this.generation = 0;
    this.duration = 128 * 60 / 112;
    this.bands = new Float32Array(72);
    this.waveform = new Float32Array(1024);
    this.level = -Infinity;
    this.peak = 0;
  }

  notify(type = "change", detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async init() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持音频分析，请使用新版 Chrome 或 Edge。");
      this.context = new AudioContextClass();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.65;
      this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeData = new Float32Array(this.analyser.fftSize);
      this.master = this.context.createGain();
      this.analyser.connect(this.master);
      this.master.connect(this.context.destination);
      this.applyVolume();
    }
    if (this.context.state === "suspended") await this.context.resume();
  }

  applyVolume() {
    if (this.master) this.master.gain.setTargetAtTime(this.muted || this.mode === "mic" ? 0 : this.volume, this.context.currentTime, 0.025);
  }

  setVolume(value) { this.volume = value; this.muted = false; this.applyVolume(); }
  toggleMute() { this.muted = !this.muted; this.applyVolume(); return this.muted; }

  get position() {
    if (!this.playing || !this.context) return this.offset;
    const t = this.offset + this.context.currentTime - this.startedAt;
    return this.mode === "mic" ? t : (this.loop ? t % this.duration : Math.min(t, this.duration));
  }

  disconnectSource() {
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop?.(); } catch (_) { /* A source can already have ended. */ }
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) { this.stream.getTracks().forEach(track => track.stop()); this.stream = null; }
  }

  pause() {
    this.offset = this.position;
    this.generation++;
    this.disconnectSource();
    this.playing = false;
    this.busy = false;
    this.notify();
  }

  load(buffer, mode = "music") {
    this.pause();
    this.buffer = buffer;
    this.mode = mode;
    this.duration = buffer?.duration || 128 * 60 / 112;
    this.offset = 0;
    this.applyVolume();
    this.notify();
  }

  async play() {
    if (this.playing || this.busy) return;
    const token = ++this.generation;
    this.busy = true;
    this.notify();
    try {
      await this.init();
      if (token !== this.generation) return;
      if (this.mode === "mic") {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("此浏览器无法使用麦克风，请尝试 Chrome / Edge，或使用本地启动服务。");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        if (token !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
        this.stream = stream;
        this.source = this.context.createMediaStreamSource(stream);
        stream.getAudioTracks()[0]?.addEventListener("ended", () => {
          if (this.stream === stream) { this.pause(); this.notify("error", "麦克风连接已结束，可重新开启或切换音乐文件。"); }
        });
      } else {
        if (!this.buffer) {
          this.notify("message", "正在合成内置电子乐，首次播放需要片刻…");
          const demo = await this.getDemo();
          if (token !== this.generation) return;
          this.buffer = demo;
        }
        if (token !== this.generation) return;
        this.duration = this.buffer.duration;
        if (this.offset >= this.duration - 0.01) this.offset = 0;
        this.source = this.context.createBufferSource();
        this.source.buffer = this.buffer;
        this.source.loop = this.loop;
        this.source.onended = () => {
          if (token !== this.generation) return;
          this.disconnectSource();
          this.offset = 0;
          this.playing = false;
          this.notify();
          this.notify("ended");
        };
      }
      this.applyVolume();
      this.source.connect(this.analyser);
      this.startedAt = this.context.currentTime;
      if (this.mode !== "mic") this.source.start(0, this.offset);
      this.playing = true;
      this.notify("message", this.mode === "mic" ? "正在监听麦克风；为避免啸叫，不回放输入声音。" : "声场已连接。拖动场景，探索你的声音。");
    } catch (error) {
      if (token !== this.generation) return;
      this.disconnectSource();
      this.playing = false;
      const denied = error.name === "NotAllowedError";
      const missing = error.name === "NotFoundError";
      this.notify("error", denied ? "麦克风权限未开启，请在浏览器设置中允许，或切回音乐文件。" : missing ? "未找到可用麦克风，请连接设备或切回音乐文件。" : error.message || "音频启动失败，请尝试其他文件。");
    } finally {
      if (token === this.generation) { this.busy = false; this.notify(); }
    }
  }

  async seek(fraction) {
    if (this.mode === "mic") return;
    const wasPlaying = this.playing;
    this.pause();
    this.offset = Math.min(Math.max(fraction, 0), 1) * this.duration;
    this.notify();
    if (wasPlaying) await this.play();
  }

  setLoop(value) {
    const position = this.position;
    this.loop = value;
    this.offset = position;
    if (this.playing) this.startedAt = this.context.currentTime;
    if (this.source && this.mode !== "mic") this.source.loop = value;
  }

  async decode(file) {
    await this.init();
    return this.context.decodeAudioData(await file.arrayBuffer());
  }

  sample() {
    if (!this.analyser || !this.playing) {
      this.bands.fill(0); this.waveform.fill(0); this.level = -Infinity; this.peak = 0;
      return this.bands;
    }
    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getFloatTimeDomainData(this.timeData);
    const hzPerBin = this.context.sampleRate / this.analyser.fftSize;
    const maxHz = Math.min(20000, this.context.sampleRate / 2);
    for (let band = 0; band < this.bands.length; band++) {
      const startHz = 25 * Math.pow(maxHz / 25, band / this.bands.length);
      const endHz = 25 * Math.pow(maxHz / 25, (band + 1) / this.bands.length);
      const lo = Math.max(1, Math.floor(startHz / hzPerBin));
      const hi = Math.min(this.frequencyData.length - 1, Math.max(lo, Math.ceil(endHz / hzPerBin)));
      let value = 0;
      for (let i = lo; i <= hi; i++) value += this.frequencyData[i];
      this.bands[band] = value / ((hi - lo + 1) * 255);
    }
    let sum = 0, peakValue = 0, peakBin = 0;
    for (let i = 0; i < this.timeData.length; i++) sum += this.timeData[i] ** 2;
    for (let i = 1; i < this.frequencyData.length; i++) if (this.frequencyData[i] > peakValue) { peakValue = this.frequencyData[i]; peakBin = i; }
    for (let i = 0; i < this.waveform.length; i++) this.waveform[i] = this.timeData[i * 4];
    this.level = 20 * Math.log10(Math.max(1e-6, Math.sqrt(sum / this.timeData.length)));
    this.peak = peakValue > 4 ? Math.round(peakBin * hzPerBin) : 0;
    return this.bands;
  }

  getDemo() {
    if (this.demoBuffer) return Promise.resolve(this.demoBuffer);
    if (!this.demoPromise) this.demoPromise = this.synthesizeDemo().then(buffer => this.demoBuffer = buffer).catch(error => { this.demoPromise = null; throw error; });
    return this.demoPromise;
  }

  async synthesizeDemo() {
    // An original 32-bar electronic loop, rendered locally without remote assets.
    const rate = 22050, beat = 60 / 112, duration = 128 * beat;
    const buffer = this.context.createBuffer(2, Math.ceil(duration * rate), rate);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    const tau = Math.PI * 2;
    const frequency = note => 440 * Math.pow(2, (note - 69) / 12);
    let noiseState = 70421;
    const noise = () => { noiseState = (Math.imul(1664525, noiseState) + 1013904223) | 0; return noiseState / 2147483648; };
    function add(time, length, sample, pan = 0) {
      const start = Math.round(time * rate), count = Math.ceil(length * rate);
      const l = Math.sqrt((1 - pan) * 0.5), r = Math.sqrt((1 + pan) * 0.5);
      for (let i = 0; i < count; i++) {
        const index = (start + i) % left.length;
        const v = sample(i / rate, i / count);
        left[index] += v * l; right[index] += v * r;
      }
    }
    const chords = [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64, 67], [43, 50, 55, 59, 62]];
    for (let bar = 0; bar < 32; bar++) {
      const chord = chords[Math.floor(bar / 2) % chords.length];
      const time = bar * 4 * beat;
      const intro = bar < 2 ? 0.5 : 1;
      for (let b = 0; b < 4; b++) {
        add(time + b * beat, 0.34, t => 0.56 * Math.sin(tau * (45 * t + 2.8 * (1 - Math.exp(-t * 40)))) * Math.exp(-t * 15) * Math.min(1, t * 700) * intro);
        if (b % 2 === 1) add(time + b * beat, 0.18, t => (noise() * 0.13 + Math.sin(tau * 184 * t) * 0.07) * Math.exp(-t * 28) * Math.min(1, t * 1300));
        for (let off = 0; off < 2; off++) {
          let lastNoise = 0;
          add(time + (b + off / 2) * beat, off ? 0.12 : 0.055, t => {
            const n = noise(), high = n - lastNoise; lastNoise = n;
            return high * (off ? 0.052 : 0.031) * Math.exp(-t * (off ? 32 : 80));
          }, off ? 0.38 : -0.28);
        }
      }
      for (let step = 0; step < 8; step++) {
        const f = frequency(chord[0] + (step === 7 ? 12 : 0));
        add(time + step * beat / 2, beat * 0.44, t => {
          const env = Math.min(1, t * 110) * Math.exp(-t * 13);
          return (Math.sin(tau * f * t) * 0.24 + Math.sin(tau * f * 2 * t) * 0.035) * env * intro;
        });
      }
      for (let step = 0; step < 16; step++) {
        const f = frequency(chord[1 + [0, 2, 1, 3, 2, 1, 3, 1][step % 8]] + 24);
        const when = time + step * beat / 4;
        const tone = t => (Math.sin(tau * f * t) + 0.24 * Math.sin(tau * f * 2 * t)) * Math.min(1, t * 180) * Math.exp(-t * 18);
        const pan = Math.sin(step * 1.4) * 0.55;
        add(when, 0.4, t => tone(t) * 0.055, pan);
        add(when + beat * 0.75, 0.4, t => tone(t) * 0.018, -pan);
      }
      for (let voice = 1; voice < 5; voice++) {
        const f = frequency(chord[voice] + 12);
        add(time, beat * 4, (t, phase) => {
          const env = Math.sin(Math.PI * phase) ** 2;
          const duck = 0.4 + 0.6 * Math.min(1, (t % beat) / 0.2);
          return (Math.sin(tau * f * t) + Math.sin(tau * f * 1.002 * t) * 0.35) * 0.022 * env * duck;
        }, (voice - 2.5) * 0.42);
      }
      if (bar % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    for (let i = 0; i < left.length; i++) {
      const fade = Math.min(1, i / 1000, (left.length - i) / 1800);
      left[i] = Math.tanh(left[i] * 1.35) * 0.88 * fade;
      right[i] = Math.tanh(right[i] * 1.35) * 0.88 * fade;
    }
    return buffer;
  }
}
window.NexusAudio = NexusAudio;
