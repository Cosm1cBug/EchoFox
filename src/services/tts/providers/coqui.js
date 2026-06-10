/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Coqui TTS provider — offline, best-in-class quality, requires Python.
 *
 * Requires the user to install:
 *   1. Python 3.9+ + pip
 *   2. `pip install TTS` (note: heavy install — ~2GB with torch)
 *   3. First run downloads the model file (~100-500MB depending on model)
 *
 *   Config:
 *     config.tts.coqui = {
 *       pythonBin: 'python3',                                  // or path
 *       model:     'tts_models/en/ljspeech/tacotron2-DDC',     // any TTS-supported model
 *     }
 *
 * We invoke via:
 *   `python3 -m TTS.bin.synthesize --text "..." --model_name "..." --out_path out.wav`
 *
 * Then convert WAV → MP3 via ffmpeg (same as Piper).
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ffmpeg = require('fluent-ffmpeg');
const { config } = require('../../../lib/configLoader');

async function coquiToWav(text, pythonBin, model, wavPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin, [
      '-m', 'TTS.bin.synthesize',
      '--text', text,
      '--model_name', model,
      '--out_path', wavPath,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`coqui TTS exited ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(wavPath);
      }
    });

    // First-run Coqui downloads the model; allow extra time
    setTimeout(() => proc.kill(), 5 * 60_000).unref();
  });
}

function wavToMp3(wavPath, mp3Path) {
  return new Promise((resolve, reject) => {
    ffmpeg(wavPath)
      .audioCodec('libmp3lame')
      .audioBitrate('48k')
      .on('end', () => resolve(mp3Path))
      .on('error', reject)
      .save(mp3Path);
  });
}

async function synthesize(text, _opts = {}) {
  const cfg = config.tts?.coqui || {};
  const pythonBin = cfg.pythonBin || 'python3';
  const model = cfg.model || 'tts_models/en/ljspeech/tacotron2-DDC';

  const tmpDir = path.join(os.tmpdir(), 'echofox-coqui');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const stem = path.join(tmpDir, `coqui-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const wavPath = stem + '.wav';
  const mp3Path = stem + '.mp3';

  try {
    await coquiToWav(text, pythonBin, model, wavPath);
    await wavToMp3(wavPath, mp3Path);
    return fs.readFileSync(mp3Path);
  } finally {
    try { fs.rmSync(wavPath, { force: true }); } catch {}
    try { fs.rmSync(mp3Path, { force: true }); } catch {}
  }
}

module.exports = { synthesize };