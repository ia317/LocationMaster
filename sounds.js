'use strict';

class SoundManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.delayNode = null;
    this.musicMuted = localStorage.getItem('lm_music') === 'off';
    this.sfxMuted = localStorage.getItem('lm_sfx') === 'off';
    this._musicPlaying = false;
    this._musicTimer = null;
    this._musicNodes = [];
  }

  // ── Init (lazy, requires user gesture) ────────────────────
  _init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;
    this.masterGain.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicMuted ? 0 : 0.4;
    this.musicGain.connect(this.masterGain);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxMuted ? 0 : 1;
    this.sfxGain.connect(this.masterGain);

    // Feedback delay as soft reverb tail
    this.delayNode   = this.ctx.createDelay(1.0);
    this.delayFeed   = this.ctx.createGain();
    this.delayFilter = this.ctx.createBiquadFilter();

    this.delayNode.delayTime.value  = 0.22;
    this.delayFeed.gain.value       = 0.28;
    this.delayFilter.type           = 'lowpass';
    this.delayFilter.frequency.value = 1800;

    this.delayNode.connect(this.delayFilter);
    this.delayFilter.connect(this.delayFeed);
    this.delayFeed.connect(this.delayNode);
    this.delayNode.connect(this.sfxGain);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ── Toggles ───────────────────────────────────────────────
  toggleMusic() {
    this.musicMuted = !this.musicMuted;
    localStorage.setItem('lm_music', this.musicMuted ? 'off' : 'on');
    if (this.musicGain) {
      this.musicGain.gain.setTargetAtTime(
        this.musicMuted ? 0 : 0.4, this.ctx.currentTime, 0.4
      );
    }
    return this.musicMuted;
  }

  toggleSfx() {
    this.sfxMuted = !this.sfxMuted;
    localStorage.setItem('lm_sfx', this.sfxMuted ? 'off' : 'on');
    if (this.sfxGain) {
      this.sfxGain.gain.setTargetAtTime(
        this.sfxMuted ? 0 : 1, this.ctx.currentTime, 0.1
      );
    }
    return this.sfxMuted;
  }

  // ── Low-level note helper ─────────────────────────────────
  _note(freq, start, dur, type = 'sine', vol = 0.3, dest = null) {
    if (!this.ctx) return null;
    const t  = this.ctx.currentTime + start;
    const tgt = dest || this.sfxGain;

    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);

    const attack = Math.min(0.025, dur * 0.1);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(gain);
    gain.connect(tgt);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return osc;
  }

  // ── SFX ──────────────────────────────────────────────────

  // Bright ascending arpeggio: C5 E5 G5 C6
  correct() {
    this._init(); this.resume();
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this._note(f, i * 0.075, 0.38, 'sine', 0.28);
    });
    this._note(1046.5, 0.22, 0.7, 'sine', 0.1, this.delayNode);
  }

  // Descending error buzz
  wrong() {
    this._init(); this.resume();
    this._note(320, 0,    0.10, 'square', 0.18);
    this._note(280, 0.10, 0.10, 'square', 0.16);
    this._note(240, 0.20, 0.22, 'square', 0.13);
  }

  // Dramatic downward sweep
  eliminated() {
    this._init(); this.resume();
    const t   = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 1.3);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    gain.connect(this.delayNode);
    osc.start(t);
    osc.stop(t + 1.5);
  }

  // Sad descending four-note phrase
  gameOver() {
    this._init(); this.resume();
    [392, 370, 330, 294].forEach((f, i) => {
      this._note(f,     i * 0.32, 0.55, 'sine', 0.24);
      this._note(f / 2, i * 0.32, 0.55, 'sine', 0.10);
    });
    this._note(196, 1.28, 1.8, 'sine', 0.28, this.delayNode);
  }

  // Triumphant fanfare
  perfect() {
    this._init(); this.resume();
    const seq = [
      [523.25, 0,    0.13],
      [523.25, 0.15, 0.13],
      [523.25, 0.30, 0.13],
      [783.99, 0.43, 0.52],
      [698.46, 0.95, 0.13],
      [739.99, 1.08, 0.13],
      [783.99, 1.21, 0.13],
      [1046.5, 1.34, 1.10],
    ];
    seq.forEach(([f, s, d]) => {
      this._note(f,      s, d, 'sine', 0.30);
      this._note(f * 1.25, s, d, 'sine', 0.10); // harmony
    });
    this._note(1046.5, 1.34, 1.5, 'sine', 0.15, this.delayNode);
  }

  // Subtle "whoosh" tick for new question
  newQuestion() {
    this._init(); this.resume();
    this._note(880, 0, 0.12, 'sine', 0.08);
  }

  // ── Background Music ──────────────────────────────────────
  // Ambient A-minor loop: pads + bass + pentatonic melody
  startMusic() {
    this._init();
    if (this._musicPlaying) return;
    this._musicPlaying = true;
    this._loop();
  }

  stopMusic() {
    this._musicPlaying = false;
    if (this._musicTimer) clearTimeout(this._musicTimer);
    this._musicNodes.forEach(n => { try { n.stop(); } catch (e) {} });
    this._musicNodes = [];
  }

  _loop() {
    if (!this._musicPlaying || !this.ctx) return;

    const BPM  = 70;
    const beat = 60 / BPM;          // seconds per beat
    const bpc  = 8;                  // beats per chord
    const chordDur = bpc * beat;

    // Am – F – C – G
    const chords = [
      { root: 110.00, tones: [220.00, 261.63, 329.63] },
      { root: 87.31,  tones: [174.61, 220.00, 261.63] },
      { root: 130.81, tones: [261.63, 329.63, 392.00] },
      { root: 98.00,  tones: [196.00, 246.94, 293.66] },
    ];

    const loopDur = chords.length * chordDur;
    const now = this.ctx.currentTime + 0.05;

    // Pads
    chords.forEach((chord, ci) => {
      const t = now + ci * chordDur;

      // Chord tones (with slight detuning for chorus)
      chord.tones.forEach((freq, ni) => {
        const osc  = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = (ni - 1) * 5;

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.055, t + 1.0);
        gain.gain.setValueAtTime(0.055, t + chordDur - 0.8);
        gain.gain.linearRampToValueAtTime(0, t + chordDur);

        osc.connect(gain);
        gain.connect(this.musicGain);
        osc.start(t);
        osc.stop(t + chordDur + 0.1);
        this._musicNodes.push(osc);
      });

      // Bass
      const bass  = this.ctx.createOscillator();
      const bassG = this.ctx.createGain();
      bass.type = 'sine';
      bass.frequency.value = chord.root;
      bassG.gain.setValueAtTime(0, t);
      bassG.gain.linearRampToValueAtTime(0.15, t + 0.12);
      bassG.gain.setValueAtTime(0.15, t + chordDur - 0.3);
      bassG.gain.linearRampToValueAtTime(0, t + chordDur);
      bass.connect(bassG);
      bassG.connect(this.musicGain);
      bass.start(t);
      bass.stop(t + chordDur + 0.1);
      this._musicNodes.push(bass);
    });

    // Melody — A minor pentatonic (A4 C5 D5 E5 G5)
    const penta = [440, 523.25, 587.33, 659.25, 784.0];
    // [degree, beat_start, beat_dur]
    const melody = [
      [0,0,1],[2,1,0.5],[3,1.5,0.5],[2,2,1.5],
      [1,4,1],[0,5,0.5],[1,5.5,2.5],
      [3,8,1],[2,9,0.5],[1,9.5,0.5],[0,10,1.5],
      [2,12,1],[3,13,1],[4,14,1],[3,15,1],
      [4,16,0.5],[3,16.5,0.5],[2,17,1],[1,18,1],[0,19,1],
      [1,20,1],[2,21,0.5],[3,21.5,0.5],[4,22,1.5],
      [3,24,0.5],[2,24.5,0.5],[1,25,1],[0,26,1.5],
      [2,28,1],[1,29,1],[0,30,2],
    ];

    melody.forEach(([deg, bs, bd]) => {
      const t    = now + bs * beat;
      const dur  = bd * beat;
      const freq = penta[deg];

      const osc  = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.065, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(gain);
      gain.connect(this.musicGain);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      this._musicNodes.push(osc);
    });

    // Schedule next loop iteration
    this._musicTimer = setTimeout(() => {
      if (this._musicPlaying) {
        this._musicNodes = [];
        this._loop();
      }
    }, loopDur * 1000 - 200); // overlap slightly to avoid gap
  }
}

const sounds = new SoundManager();
