"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const audio = new NexusAudio();
  const visual = new NexusVisualizer($("visualizer"), $("spectrum"), audio);
  const scenes = {
    reactor: { name: "声场反应堆", subtitle: "RESONANCE CORE", number: "01", nodes: "547 个共振单元" },
    orbit: { name: "星环脉冲", subtitle: "ORBITAL PULSE", number: "02", nodes: "216 条频谱射线" },
    terrain: { name: "频谱地形", subtitle: "SPECTRAL TERRAIN", number: "03", nodes: "32 层频谱历史" }
  };
  const paletteNames = { cyan: "离子蓝", violet: "等离子紫", amber: "熔核橙" };
  const defaults = { sensitivity: 1.4, smoothing: 75, glow: 65, transparency: 20, autoRotate: !matchMedia("(prefers-reduced-motion: reduce)").matches, palette: "cyan", scene: "reactor", volume: 45 };
  const createDemoTrack = () => ({ id: "demo", name: "Neon Drift", subtitle: "NEXUS ORIGINAL · 112 BPM", duration: 128 * 60 / 112, buffer: null });
  const tracks = [createDemoTrack()];
  let activeId = "demo", toastTimer, seeking = false, hasPlayed = false, musicPosition = 0, importChain = Promise.resolve();
  const formatTime = value => { const t = Math.max(0, Math.floor(value || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const trackNow = () => tracks.find(track => track.id === activeId) || tracks[0];

  function message(text, isError = false) {
    $("status-message").textContent = text;
    if (isError) toast(text);
  }
  function toast(text) {
    clearTimeout(toastTimer); $("toast").textContent = text; $("toast").hidden = false;
    toastTimer = setTimeout(() => $("toast").hidden = true, 4300);
  }

  function fillRange(input) {
    const percent = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
    input.style.setProperty("--fill", `${percent}%`);
  }

  function saveSettings() {
    const settings = { sensitivity: visual.sensitivity, smoothing: visual.smoothing, glow: visual.glow, transparency: visual.transparency, autoRotate: visual.autoRotate, palette: visual.palette, scene: visual.scene, volume: Math.round(audio.volume * 100) };
    try { localStorage.setItem("nexus-settings-v1", JSON.stringify(settings)); } catch (_) { /* Playback also works with storage disabled. */ }
  }

  function setScene(name, save = true) {
    if (!scenes[name]) return;
    visual.scene = name;
    $("reactor-transparency-control").hidden = name !== "reactor";
    const scene = scenes[name];
    $("scene-title").textContent = scene.name; $("scene-subtitle").textContent = scene.subtitle;
    $("scene-number").textContent = scene.number; $("node-label").textContent = scene.nodes;
    document.querySelectorAll("[data-scene]").forEach(button => {
      button.classList.toggle("selected", button.dataset.scene === name);
      button.setAttribute("aria-pressed", String(button.dataset.scene === name));
    });
    if (save) saveSettings();
  }

  function setPalette(name, save = true) {
    if (!paletteNames[name]) return;
    visual.setPalette(name);
    const rgb = visual.colors.primary;
    document.documentElement.style.setProperty("--accent", `rgb(${rgb.join(",")})`);
    document.documentElement.style.setProperty("--accent-rgb", rgb.join(","));
    for (const [band, color] of [["low", visual.colors.secondary], ["mid", visual.colors.primary], ["high", visual.colors.high]]) {
      document.documentElement.style.setProperty(`--band-${band}`, `rgb(${color.join(",")})`);
    }
    $("frequency-gradient").style.background = `linear-gradient(90deg, ${visual.frequencyStops.map(stop => `rgb(${stop.rgb.join(",")}) ${stop.at * 100}%`).join(",")})`;
    $("palette-name").textContent = paletteNames[name];
    document.querySelectorAll("[data-palette]").forEach(button => {
      button.classList.toggle("selected", button.dataset.palette === name);
      button.setAttribute("aria-pressed", String(button.dataset.palette === name));
    });
    if (save) saveSettings();
  }

  function applySettings(settings) {
    for (const [name, min, max] of [["sensitivity", 0.4, 3], ["smoothing", 0, 95], ["glow", 0, 100], ["transparency", 0, 100]]) {
      const value = Number.isFinite(Number(settings[name])) ? Math.min(max, Math.max(min, Number(settings[name]))) : defaults[name];
      visual[name] = value; $(name).value = value;
      $(name + "-value").innerHTML = `${name === "sensitivity" ? value.toFixed(1) : value}<span>${name === "sensitivity" ? "×" : "%"}</span>`;
    }
    visual.autoRotate = typeof settings.autoRotate === "boolean" ? settings.autoRotate : defaults.autoRotate;
    $("auto-rotate").checked = visual.autoRotate;
    const volume = Number.isFinite(Number(settings.volume)) ? Math.max(0, Math.min(100, Number(settings.volume))) : 45;
    $("volume").value = volume; audio.setVolume(volume / 100); updateVolume();
    setScene(scenes[settings.scene] ? settings.scene : "reactor", false);
    setPalette(paletteNames[settings.palette] ? settings.palette : "cyan", false);
    document.querySelectorAll("input[type=range]").forEach(fillRange);
  }

  function renderQueue() {
    $("queue").replaceChildren(); $("library-list").replaceChildren();
    tracks.forEach((track, index) => {
      function makeButton() {
        const button = document.createElement("button");
        button.className = `queue-item${track.id === activeId ? " selected" : ""}`;
        button.setAttribute("aria-label", `播放 ${track.name}`);
        button.setAttribute("aria-current", track.id === activeId ? "true" : "false");
        const number = document.createElement("span"); number.className = "queue-track-index"; number.textContent = String(index + 1).padStart(2, "0");
        const copy = document.createElement("span"), title = document.createElement("strong"), sub = document.createElement("small");
        title.textContent = track.name; sub.textContent = `${track.id === "demo" ? "BUILT-IN DEMO" : "LOCAL AUDIO"} / ${formatTime(track.duration)}`;
        copy.append(title, sub); button.append(number, copy);
        if (track.id === activeId) { const marker = document.createElement("span"); marker.className = "queue-marker"; marker.innerHTML = icon("wave"); button.append(marker); }
        button.onclick = () => { selectTrack(track.id, true); $("library-dialog").close(); };
        return button;
      }
      for (const [container, className] of [[$("queue"), "queue-row"], [$("library-list"), "library-row"]]) {
        const row = document.createElement("div"); row.className = `${className}${track.id === activeId ? " selected" : ""}`;
        row.append(makeButton());
        const remove = document.createElement("button"); remove.className = "icon-button remove-track";
        remove.innerHTML = icon("trash"); remove.setAttribute("aria-label", `删除 ${track.name}`);
        remove.title = "从播放队列移除，不删除本地文件";
        remove.onclick = () => removeTrack(track.id);
        row.append(remove); container.append(row);
      }
    });
    if (!tracks.length) {
      for (const container of [$("queue"), $("library-list")]) {
        const empty = document.createElement("div"); empty.className = "queue-empty";
        const hint = document.createElement("p"); hint.textContent = "队列为空，导入音乐开启声场。";
        const restore = document.createElement("button"); restore.className = "restore-demo"; restore.textContent = "载入演示音轨";
        restore.onclick = () => { tracks.push(createDemoTrack()); selectTrack("demo", true); };
        empty.append(hint, restore); container.append(empty);
      }
    }
    const count = String(tracks.length).padStart(2, "0");
    $("queue-count").textContent = count; $("library-count").textContent = count;
  }

  async function removeTrack(id) {
    const index = tracks.findIndex(track => track.id === id);
    if (index < 0) return;
    const wasActive = activeId === id, wasPlaying = audio.playing, wasMusic = audio.mode !== "mic";
    tracks.splice(index, 1);
    if (wasActive) {
      musicPosition = 0;
      const replacement = tracks[Math.min(index, tracks.length - 1)];
      activeId = replacement?.id || null;
      if (wasMusic) {
        if (replacement) await selectTrack(replacement.id, wasPlaying);
        else { audio.load(null); audio.duration = 0; }
      }
    }
    renderQueue(); updateState();
    if (!tracks.length && wasMusic) message("播放队列已清空，导入音乐或载入演示音轨即可继续。");
    toast("已从播放队列移除，本地文件保留。");
  }

  async function selectTrack(id, autoplay = false, position = 0) {
    const track = tracks.find(item => item.id === id);
    if (!track) return;
    activeId = id;
    audio.load(track.id === "demo" ? audio.demoBuffer : track.buffer);
    audio.offset = position;
    musicPosition = position;
    renderQueue(); updateState();
    if (autoplay) await audio.play();
  }

  function updateState() {
    const mic = audio.mode === "mic", track = trackNow(), empty = !mic && !track;
    if (audio.playing) { hasPlayed = true; visual.isPreview = false; }
    $("play").innerHTML = icon(audio.playing ? "pause" : "play");
    $("play").setAttribute("aria-label", audio.busy ? "正在准备音频" : audio.playing ? "暂停" : "播放");
    $("play").disabled = audio.busy || empty;
    $("track-name").textContent = mic ? "麦克风实时输入" : track?.name || "播放队列为空";
    $("track-meta").textContent = mic ? "LIVE INPUT · 本地音频分析" : track?.subtitle || "导入音乐或载入演示音轨";
    $("duration").textContent = mic ? "LIVE" : empty ? "0:00" : formatTime(audio.duration);
    $("seek").disabled = mic || audio.busy || empty;
    $("previous").disabled = mic || empty; $("next").disabled = mic || empty;
    $("source-music").classList.toggle("selected", !mic); $("source-mic").classList.toggle("selected", mic);
    $("source-music").setAttribute("aria-pressed", String(!mic)); $("source-mic").setAttribute("aria-pressed", String(mic));
    $("signal-status").classList.toggle("live", audio.playing);
    $("signal-status").replaceChildren();
    $("signal-status").append(document.createElement("i"), document.createTextNode(audio.busy ? (mic ? "等待授权" : "音频准备中") : audio.playing ? (mic ? "实时输入" : "声场运行中") : empty ? "等待音频" : hasPlayed ? "已暂停" : "演示预览"));
    $("input-note").textContent = audio.busy ? (mic ? "等待浏览器麦克风权限…" : "正在准备音频…") : mic ? (audio.playing ? "麦克风已连接 · 输入声音不回放" : "麦克风已关闭 · 点击播放重新连接") : empty ? "队列为空 · 可导入音乐或载入演示音轨" : track.id === "demo" ? "内置演示音轨已就绪" : "本地音频已载入 · 不会上传";
    $("playing-eq").classList.toggle("playing", audio.playing);
    $("stage-hint").textContent = audio.playing ? "拖动旋转 · 滚轮缩放 · 在音乐中探索" : "拖动旋转 · 滚轮缩放 · 播放音乐，唤醒声场";
    updateReadings();
  }

  function updateReadings() {
    if (!seeking) { $("elapsed").textContent = formatTime(audio.position); $("seek").value = audio.mode === "mic" || !audio.duration ? 0 : audio.position / audio.duration * 1000; fillRange($("seek")); }
    const hasSignal = audio.playing && audio.level > -90;
    $("level").innerHTML = `${hasSignal ? Math.round(audio.level) : "—"}<small>dBFS</small>`;
    $("peak").innerHTML = `${audio.playing && audio.peak ? audio.peak : "—"}<small>Hz</small>`;
    $("fps").textContent = `${visual.fps} FPS`;
  }

  function updateVolume() {
    $("mute").innerHTML = icon(audio.muted || audio.volume === 0 ? "mute" : "volume");
    $("mute").setAttribute("aria-label", audio.muted ? "恢复音量" : "静音");
    $("volume-value").textContent = audio.muted ? "静音" : `${Math.round(audio.volume * 100)}%`;
    fillRange($("volume"));
  }

  async function importFiles(files) {
    const items = Array.from(files).filter(file => file.type.startsWith("audio/") || /\.(mp3|wav|flac|m4a|ogg|aac|opus|aiff|webm)$/i.test(file.name));
    if (!items.length) { toast("请选择 MP3、WAV、FLAC 等音频文件。"); return; }
    message(`正在读取 ${items.length} 个音频文件…`);
    let added = 0, failed = 0;
    for (const file of items) {
      try {
        const buffer = await audio.decode(file);
        const track = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name.replace(/\.[^.]+$/, ""), subtitle: `LOCAL AUDIO · ${file.name.split(".").pop().toUpperCase()}`, duration: buffer.duration, buffer };
        tracks.push(track); added++;
        if (added === 1) await selectTrack(track.id, true); else renderQueue();
      } catch (_) { failed++; }
    }
    const result = `${added ? `已导入 ${added} 首音乐` : "未能导入音频"}${failed ? `；${failed} 个文件无法解码，请尝试转换为 MP3 或 WAV。` : "，音频仅在本机处理。"}`;
    message(result); toast(result); $("file-input").value = "";
  }

  function enqueueImport(files) {
    const copied = Array.from(files);
    importChain = importChain.then(() => importFiles(copied)).catch(() => message("音频读取失败，请重试。", true));
  }

  function skip(direction) {
    if (audio.mode === "mic" || !tracks.length) return;
    const next = (tracks.findIndex(track => track.id === activeId) + direction + tracks.length) % tracks.length;
    selectTrack(tracks[next].id, true);
  }

  async function setSource(mode) {
    if (mode === audio.mode) return;
    if (mode === "mic") {
      musicPosition = audio.position;
      audio.load(null, "mic");
      await audio.play();
    } else if (tracks.length) await selectTrack(activeId, true, musicPosition);
    else { audio.load(null); audio.duration = 0; updateState(); message("播放队列为空，请先导入音乐。"); }
  }

  function togglePlay() { if (audio.mode !== "mic" && !tracks.length) { toast("请先导入音乐或载入演示音轨。"); return; } if (audio.playing || audio.busy) { audio.pause(); message("已暂停。按下播放，继续探索声场。"); } else audio.play(); }
  function toggleFocus(value = !document.body.classList.contains("focus")) {
    document.body.classList.toggle("focus", value); $("exit-focus").hidden = !value;
    $("focus-mode").setAttribute("aria-label", value ? "退出沉浸模式" : "进入沉浸模式");
    if (value) $("exit-focus").focus(); else $("focus-mode").focus();
  }

  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch (_) { toggleFocus(); toast("当前环境不支持全屏，已切换沉浸模式。"); }
  }

  audio.addEventListener("change", updateState);
  audio.addEventListener("message", event => message(event.detail));
  audio.addEventListener("error", event => message(event.detail, true));
  audio.addEventListener("ended", () => { if (tracks.length > 1) skip(1); else message("播放结束，点击播放可重新开始。"); });

  $("play").onclick = togglePlay;
  $("previous").onclick = () => skip(-1); $("next").onclick = () => skip(1);
  $("repeat").onclick = () => {
    audio.setLoop(!audio.loop); $("repeat").classList.toggle("active", audio.loop);
    $("repeat").setAttribute("aria-pressed", String(audio.loop));
    $("repeat").setAttribute("aria-label", audio.loop ? "关闭单曲循环" : "开启单曲循环");
    $("repeat").title = `单曲循环：${audio.loop ? "已开启" : "已关闭"}`;
    toast(audio.loop ? "单曲循环已开启" : "单曲循环已关闭，曲终自动播放下一首");
  };
  $("source-music").onclick = () => setSource("music"); $("source-mic").onclick = () => setSource("mic");
  $("seek").oninput = event => { seeking = true; fillRange(event.target); $("elapsed").textContent = formatTime(Number(event.target.value) / 1000 * audio.duration); };
  $("seek").onchange = event => { seeking = false; audio.seek(Number(event.target.value) / 1000); };
  $("seek").onblur = () => seeking = false;
  $("volume").oninput = event => { audio.setVolume(Number(event.target.value) / 100); updateVolume(); saveSettings(); };
  $("mute").onclick = () => { audio.toggleMute(); updateVolume(); };
  for (const name of ["sensitivity", "smoothing", "glow", "transparency"]) $(name).oninput = event => {
    visual[name] = Number(event.target.value); fillRange(event.target);
    $(name + "-value").innerHTML = `${name === "sensitivity" ? visual[name].toFixed(1) : visual[name]}<span>${name === "sensitivity" ? "×" : "%"}</span>`; saveSettings();
  };
  $("auto-rotate").onchange = event => { visual.autoRotate = event.target.checked; saveSettings(); };
  document.querySelectorAll("[data-scene]").forEach(button => button.onclick = () => setScene(button.dataset.scene));
  document.querySelectorAll("[data-palette]").forEach(button => button.onclick = () => setPalette(button.dataset.palette));
  $("reset-view").onclick = () => { visual.resetCamera(); toast("视角已重置"); };
  $("reset-settings").onclick = () => { applySettings(defaults); visual.resetCamera(); saveSettings(); toast("场景设置已恢复默认"); };
  $("snapshot").onclick = () => { visual.saveSnapshot(scenes[visual.scene].name); toast("场景截图已生成，请查看浏览器下载。"); };
  $("focus-mode").onclick = () => toggleFocus(); $("exit-focus").onclick = () => toggleFocus(false);
  $("fullscreen").onclick = toggleFullscreen;
  document.addEventListener("fullscreenchange", () => $("fullscreen").setAttribute("aria-label", document.fullscreenElement ? "退出全屏" : "全屏"));
  for (const id of ["import", "add-music", "library-import", "mobile-import"]) $(id).onclick = () => $("file-input").click();
  $("file-input").onchange = event => enqueueImport(event.target.files);
  $("library-open").onclick = () => $("library-dialog").showModal();
  $("mobile-library").onclick = () => $("library-dialog").showModal();
  $("shortcuts-open").onclick = () => $("shortcuts-dialog").showModal();
  $("nav-visual").onclick = () => $("visual-stage").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
  document.querySelectorAll("[data-close]").forEach(button => button.onclick = () => button.closest("dialog").close());
  document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("click", event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));

  let dragDepth = 0;
  const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes("Files");
  document.addEventListener("dragenter", event => { if (isFileDrag(event)) { event.preventDefault(); dragDepth++; $("drop-overlay").hidden = false; } });
  document.addEventListener("dragover", event => { if (isFileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } });
  document.addEventListener("dragleave", event => { if (isFileDrag(event) && --dragDepth <= 0) { dragDepth = 0; $("drop-overlay").hidden = true; } });
  document.addEventListener("drop", event => { if (event.dataTransfer?.files.length) { event.preventDefault(); dragDepth = 0; $("drop-overlay").hidden = true; enqueueImport(event.dataTransfer.files); } });
  window.addEventListener("blur", () => { dragDepth = 0; $("drop-overlay").hidden = true; });

  document.addEventListener("keydown", event => {
    if (event.code === "Escape" && document.body.classList.contains("focus")) { toggleFocus(false); return; }
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || document.querySelector("dialog[open]") || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (event.code === "Space") { if (event.target.closest("button,a")) return; event.preventDefault(); togglePlay(); }
    else if (event.code === "KeyF") toggleFullscreen();
    else if (event.code === "KeyM") $("mute").click();
    else if (event.code === "KeyR") { $("auto-rotate").checked = !$("auto-rotate").checked; $("auto-rotate").dispatchEvent(new Event("change")); toast(visual.autoRotate ? "自动环绕已开启" : "自动环绕已暂停"); }
    else if (/^Digit[123]$/.test(event.code)) setScene(Object.keys(scenes)[Number(event.code.slice(-1)) - 1]);
  });

  window.addEventListener("pagehide", () => audio.pause());
  function clock() { $("clock").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false }); }
  clock(); setInterval(clock, 1000); setInterval(updateReadings, 180);
  let settings = defaults;
  try { const saved = JSON.parse(localStorage.getItem("nexus-settings-v1") || "null"); if (saved && typeof saved === "object") settings = { ...defaults, ...saved }; } catch (_) { /* Ignore invalid saved settings. */ }
  applySettings(settings); renderQueue(); updateState();
})();
