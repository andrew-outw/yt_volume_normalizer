class Biquad {
  constructor(b0, b1, b2, a1, a2) {
    this.b0 = b0; this.b1 = b1; this.b2 = b2;
    this.a1 = a1; this.a2 = a2;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
  process(x) {
    const y = this.b0*x + this.b1*this.x1 + this.b2*this.x2
            - this.a1*this.y1 - this.a2*this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

function makeKWeightFilters(fs) {
  // ITU-R BS.1770 K-weighting, recalculated for the actual sample rate.
  const f0a = 1681.974450955533;
  const qa = 0.7071752369554196;
  const K1 = Math.tan(Math.PI * f0a / fs);
  const Vh = Math.pow(10, 3.999843853973347 / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K1/qa + K1*K1;

  const pre = new Biquad(
    (Vh + Vb*K1/qa + K1*K1)/a0,
    2*(K1*K1 - Vh)/a0,
    (Vh - Vb*K1/qa + K1*K1)/a0,
    2*(K1*K1 - 1)/a0,
    (1 - K1/qa + K1*K1)/a0
  );

  const f0b = 38.13547087602444;
  const qb = 0.5003270373238773;
  const K2 = Math.tan(Math.PI * f0b / fs);
  const a02 = 1 + K2/qb + K2*K2;

  const rlb = new Biquad(
    1/a02,
    -2/a02,
    1/a02,
    2*(K2*K2 - 1)/a02,
    (1 - K2/qb + K2*K2)/a02
  );

  return [pre, rlb];
}

class LoudnessMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fs = sampleRate;
    this.blockSize = Math.max(1, Math.round(this.fs * 0.4));
    this.hopSize = Math.max(1, Math.round(this.fs * 0.1));
    this.ringL = new Float64Array(this.blockSize);
    this.ringR = new Float64Array(this.blockSize);
    this.ringIndex = 0;
    this.filled = 0;
    this.hop = 0;
    this.sumL = 0;
    this.sumR = 0;
    this.blocks = [];
    this.preL = makeKWeightFilters(this.fs);
    this.preR = makeKWeightFilters(this.fs);
  }

  addBlock() {
    if (this.filled < this.blockSize) return;

    const pL = this.sumL / this.blockSize;
    const pR = this.sumR / this.blockSize;
    const p = (pL + pR) / 2;

    if (p > 0) {
      this.blocks.push(p);
      // Keep a bounded history for a long-running YouTube tab.
      if (this.blocks.length > 9000) this.blocks.shift();
    }
  }

  integratedLUFS() {
    if (!this.blocks.length) return -Infinity;

    // BS.1770 absolute gate: -70 LUFS.
    const absPower = Math.pow(10, (-70 + 0.691) / 10);
    const absPassed = this.blocks.filter(p => p >= absPower);
    if (!absPassed.length) return -Infinity;

    const meanAbs = absPassed.reduce((a,b) => a+b, 0) / absPassed.length;
    const ungatedLUFS = -0.691 + 10 * Math.log10(meanAbs);

    // Relative gate: 10 LU below the ungated average.
    const relGate = Math.pow(10, ((ungatedLUFS - 10) + 0.691) / 10);
    const gated = absPassed.filter(p => p >= relGate);

    if (!gated.length) return ungatedLUFS;

    const mean = gated.reduce((a,b) => a+b, 0) / gated.length;
    return -0.691 + 10 * Math.log10(mean);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input.length) return true;

    const L = input[0];
    const R = input[1] || input[0];

    // Pass audio through unchanged. Gain/compression/limiting happen downstream.
    for (let ch = 0; ch < output.length; ch++) {
      const src = input[Math.min(ch, input.length - 1)] || input[0];
      output[ch].set(src);
    }

    for (let i = 0; i < L.length; i++) {
      const l1 = this.preL[0].process(L[i]);
      const lk = this.preL[1].process(l1);

      const r1 = this.preR[0].process(R[i]);
      const rk = this.preR[1].process(r1);

      const pL = lk * lk;
      const pR = rk * rk;

      const oldL = this.ringL[this.ringIndex];
      const oldR = this.ringR[this.ringIndex];

      this.ringL[this.ringIndex] = pL;
      this.ringR[this.ringIndex] = pR;

      this.sumL += pL - oldL;
      this.sumR += pR - oldR;

      this.ringIndex = (this.ringIndex + 1) % this.blockSize;
      this.filled++;

      if (this.filled >= this.blockSize) {
        this.hop++;
        if (this.hop >= this.hopSize) {
          this.hop = 0;
          this.addBlock();
          const lufs = this.integratedLUFS();
          this.port.postMessage({
            type: "loudness",
            integratedLUFS: lufs,
            blocks: this.blocks.length
          });
        }
      }
    }

    return true;
  }
}

registerProcessor("ytvn-loudness-meter", LoudnessMeterProcessor);