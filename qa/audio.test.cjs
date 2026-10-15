const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function setup(getUserMedia = async () => ({ getTracks: () => [], getAudioTracks: () => [] })) {
  function node() { return { connect() {}, disconnect() {}, stop() { this.stopped = true; }, start(_when, offset) { this.startOffset = offset; } }; }
  class Context {
    constructor() { this.currentTime = 0; this.state = 'running'; this.sampleRate = 44100; this.destination = {}; }
    createAnalyser() { return { ...node(), frequencyBinCount: 2048, fftSize: 4096, getByteFrequencyData(array) { array.fill(0); array[41] = 220; }, getFloatTimeDomainData(array) { array.fill(0.2); } }; }
    createGain() { return { ...node(), gain: { setTargetAtTime(value) { this.value = value; } } }; }
    createBufferSource() { return node(); }
    createMediaStreamSource() { return node(); }
    async resume() { this.state = 'running'; }
  }
  const sandbox = { window: { AudioContext: Context }, navigator: { mediaDevices: { getUserMedia } }, EventTarget, CustomEvent, Float32Array, Uint8Array, Math, Promise, setTimeout };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/audio.js'), 'utf8'), sandbox);
  const engine = new sandbox.window.NexusAudio();
  return engine;
}

test('pause preserves position and resume starts at that position', async () => {
  const audio = setup(); audio.load({ duration: 30 }); await audio.play();
  const oldSource = audio.source; audio.context.currentTime = 6.5; audio.pause();
  assert.equal(audio.offset, 6.5); assert.equal(oldSource.stopped, true); assert.equal(audio.playing, false);
  await audio.play(); assert.equal(audio.source.startOffset, 6.5);
});

test('late demo synthesis cannot overwrite a newly selected track', async () => {
  const audio = setup(), pending = deferred(); audio.getDemo = () => pending.promise;
  const starting = audio.play(); await Promise.resolve(); await Promise.resolve();
  const selected = { duration: 45 }; audio.load(selected); await audio.play();
  pending.resolve({ duration: 68 }); await starting;
  assert.equal(audio.buffer, selected); assert.equal(audio.duration, 45); assert.equal(audio.playing, true);
});

test('cancelling microphone activation closes a late permission stream', async () => {
  const pending = deferred(); let stopped = 0;
  const audio = setup(() => pending.promise); audio.load(null, 'mic');
  const activation = audio.play(); await Promise.resolve(); await Promise.resolve(); audio.pause();
  pending.resolve({ getTracks: () => [{ stop() { stopped++; } }], getAudioTracks: () => [] });
  await activation; assert.equal(stopped, 1); assert.equal(audio.playing, false); assert.equal(audio.stream, null);
});

test('microphone is analysed without routing sound to speakers', async () => {
  let stopped = false;
  const audio = setup(async () => ({ getTracks: () => [{ stop() { stopped = true; } }], getAudioTracks: () => [] }));
  audio.load(null, 'mic'); await audio.play(); audio.setVolume(0.9);
  assert.equal(audio.master.gain.value, 0); assert.equal(audio.playing, true);
  audio.pause(); assert.equal(stopped, true);
});

test('turning off loop after a full repeat keeps the current position', async () => {
  const audio = setup(); audio.load({ duration: 10 }); await audio.play(); audio.context.currentTime = 23;
  assert.equal(audio.position, 3); audio.setLoop(false); assert.equal(audio.position, 3);
  audio.context.currentTime = 25; assert.equal(audio.position, 5);
});

test('seeking preserves playback state and uses the chosen offset', async () => {
  const audio = setup(); audio.load({ duration: 20 }); await audio.seek(0.5);
  assert.equal(audio.playing, false); assert.equal(audio.offset, 10);
  await audio.play(); await audio.seek(0.75);
  assert.equal(audio.playing, true); assert.equal(audio.source.startOffset, 15);
});

test('frequency and RMS readings come from analyser samples', async () => {
  const audio = setup(); audio.load({ duration: 10 }); await audio.play();
  assert.ok(Math.max(...audio.sample()) > 0);
  assert.ok(Math.abs(audio.level - (-13.9794)) < 0.001); assert.equal(audio.peak, 441);
  audio.pause(); assert.equal(Math.max(...audio.sample()), 0); assert.equal(audio.level, -Infinity);
});
