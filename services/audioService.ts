/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export class AudioService {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private dataArray: Float32Array | null = null;
  private stream: MediaStream | null = null; // Store stream for cleanup

  async init(existingStream?: MediaStream) {
    try {
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.stream = existingStream || await navigator.mediaDevices.getUserMedia({ audio: true });

      if (!this.audioContext) {
         this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      this.microphone.connect(this.analyser);
      this.dataArray = new Float32Array(this.analyser.fftSize);
      
      return true;
    } catch (err) {
      console.error("Error accessing microphone:", err);
      return false;
    }
  }

  getAudioData() {
    if (!this.analyser || !this.dataArray || !this.audioContext) return { volume: 0, pitch: 0 };
    this.analyser.getFloatTimeDomainData(this.dataArray as any);

    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i] * this.dataArray[i];
    }
    const volume = Math.sqrt(sum / this.dataArray.length);
    const pitch = this.autoCorrelate(this.dataArray, this.audioContext!.sampleRate);

    return { volume, pitch };
  }


  private autoCorrelate(buffer: Float32Array, sampleRate: number): number {
    let size = buffer.length;
    let rms = 0;

    for (let i = 0; i < size; i++) {
      const val = buffer[i];
      rms += val * val;
    }
    rms = Math.sqrt(rms / size);
    if (rms < 0.01) return -1; // Not enough signal

    let r1 = 0,
      r2 = size - 1,
      thres = 0.2;
    for (let i = 0; i < size / 2; i++) {
      if (Math.abs(buffer[i]) < thres) {
        r1 = i;
        break;
      }
    }
    for (let i = 1; i < size / 2; i++) {
      if (Math.abs(buffer[size - i]) < thres) {
        r2 = size - i;
        break;
      }
    }

    const trimmedBuffer = buffer.slice(r1, r2);
    size = trimmedBuffer.length;

    const c = new Array(size).fill(0);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size - i; j++) {
        c[i] = c[i] + trimmedBuffer[j] * trimmedBuffer[j + i];
      }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1,
      maxpos = -1;
    for (let i = d; i < size; i++) {
      if (c[i] > maxval) {
        maxval = c[i];
        maxpos = i;
      }
    }

    let T0 = maxpos;
    return sampleRate / T0;
  }

 stop() {      
  if (this.audioContext && this.audioContext.state === 'running') {
    this.audioContext.suspend();
  }
 }
}
