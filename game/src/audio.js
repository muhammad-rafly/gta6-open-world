// Sound, all synthesized with WebAudio: no audio files, nothing to download.
// Engine hum follows speed, sirens wail when the heat is on, and the radio plays two
// procedural stations (VELVET FM synthwave, NIGHT DRIVE slow cruise) on a lookahead
// scheduler. Everything is guarded: if audio cannot start, the game still plays silent.

function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let engineOsc = null;
  let engineGain = null;
  let engineSub = null;
  let engineSubGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = null;
  let radioOn = false;
  let radioStation = 0;
  let radioTimer = null;
  let radioStep = 0;
  let nextNoteTime = 0;

  const STATIONS = [
    { name: 'VELVET FM', bpm: 112, bass: [0, 0, 7, 0, 5, 0, 3, 10], root: 55, wave: 'sawtooth' },
    { name: 'NIGHT DRIVE', bpm: 92, bass: [0, 0, 0, 7, 0, 5, 3, 3], root: 49, wave: 'triangle' },
  ];

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      return true;
    } catch (e) {
      return false;
    }
  }

  function unlock() {
    if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function blip(freq, dur, type, vol, when) {
    if (!ctx || muted) return;
    try {
      const t = when || ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) { /* silent */ }
  }

  // Two-oscillator engine: a sawtooth through a low-pass filter plus a sub-octave
  // sine, so the engine hum has body instead of a single thin buzz. Both follow speed.
  function engine(level) {
    if (!ctx || muted) return;
    try {
      if (!engineOsc) {
        engineOsc = ctx.createOscillator();
        engineOsc.type = 'sawtooth';
        engineGain = ctx.createGain();
        engineGain.gain.value = 0;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        engineOsc.connect(filter);
        filter.connect(engineGain);
        engineGain.connect(master);
        engineOsc.start();
        engineSub = ctx.createOscillator();
        engineSub.type = 'sine';
        engineSubGain = ctx.createGain();
        engineSubGain.gain.value = 0;
        engineSub.connect(engineSubGain);
        engineSubGain.connect(master);
        engineSub.start();
      }
      const freq = 50 + level * 160;
      engineOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.05);
      engineGain.gain.setTargetAtTime(0.02 + level * 0.05, ctx.currentTime, 0.08);
      engineSub.frequency.setTargetAtTime(freq / 2, ctx.currentTime, 0.05);
      engineSubGain.gain.setTargetAtTime(0.015 + level * 0.03, ctx.currentTime, 0.08);
    } catch (e) { /* silent */ }
  }

  // The siren takes the nearest police distance: closer units wail louder, and the
  // wail fades out entirely past 700 units instead of cutting off at a hard edge.
  function siren(dist) {
    if (!ctx) return;
    const d = typeof dist === 'number' ? dist : (dist ? 0 : Infinity);
    const on = d < 700;
    const vol = on ? 0.008 + 0.022 * (1 - d / 700) : 0;
    try {
      if (on && !sirenOsc) {
        sirenOsc = ctx.createOscillator();
        sirenOsc.type = 'sine';
        sirenGain = ctx.createGain();
        sirenGain.gain.value = 0;
        sirenOsc.connect(sirenGain);
        sirenGain.connect(master);
        sirenOsc.start();
        sirenGain.gain.setTargetAtTime(muted ? 0 : vol, ctx.currentTime, 0.2);
        let up = true;
        sirenTimer = window.setInterval(() => {
          if (!sirenOsc) return;
          up = !up;
          sirenOsc.frequency.setTargetAtTime(up ? 880 : 660, ctx.currentTime, 0.15);
        }, 450);
      } else if (on && sirenOsc) {
        sirenGain.gain.setTargetAtTime(muted ? 0 : vol, ctx.currentTime, 0.2);
      } else if (!on && sirenOsc) {
        window.clearInterval(sirenTimer);
        sirenTimer = null;
        const o = sirenOsc;
        const g = sirenGain;
        sirenOsc = null;
        sirenGain = null;
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        window.setTimeout(() => { try { o.stop(); } catch (e) {} }, 400);
      }
    } catch (e) { /* silent */ }
  }

  function radioTick() {
    if (!ctx || !radioOn || muted) return;
    const st = STATIONS[radioStation];
    const stepDur = 60 / st.bpm / 2;
    while (nextNoteTime < ctx.currentTime + 0.25) {
      const deg = st.bass[radioStep % st.bass.length];
      const freq = st.root * Math.pow(2, deg / 12);
      blip(freq, stepDur * 1.8, st.wave, 0.10, nextNoteTime);
      if (radioStep % 4 === 0) blip(freq * 4, stepDur * 0.9, 'sine', 0.045, nextNoteTime);
      if (radioStep % 2 === 1) blip(6000, 0.03, 'square', 0.012, nextNoteTime);
      radioStep += 1;
      nextNoteTime += stepDur;
    }
  }

  function radio(on) {
    radioOn = on;
    if (!ensure()) return;
    if (on) {
      nextNoteTime = ctx.currentTime + 0.05;
      radioStep = 0;
      if (!radioTimer) radioTimer = window.setInterval(radioTick, 90);
    } else if (radioTimer) {
      window.clearInterval(radioTimer);
      radioTimer = null;
    }
  }

  function nextStation() {
    radioStation = (radioStation + 1) % STATIONS.length;
    radioStep = 0;
    if (ctx) nextNoteTime = ctx.currentTime + 0.05;
    return STATIONS[radioStation].name;
  }

  return {
    unlock,
    shoot() { blip(220, 0.12, 'square', 0.16); blip(90, 0.1, 'sawtooth', 0.12); },
    crash() { blip(70, 0.25, 'sawtooth', 0.2); },
    pickup() { blip(880, 0.09, 'sine', 0.14); blip(1320, 0.12, 'sine', 0.12); },
    steal() { blip(440, 0.08, 'square', 0.1); },
    punch() { blip(140, 0.08, 'sine', 0.16); },
    mission() { [523, 659, 784].forEach((f) => blip(f, 0.14, 'sine', 0.13)); },
    fail() { [330, 262, 196].forEach((f) => blip(f, 0.16, 'sine', 0.11)); },
    engine,
    siren,
    radio,
    nextStation,
    radioName() { return STATIONS[radioStation].name; },
    radioIsOn() { return radioOn; },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
  };
}
