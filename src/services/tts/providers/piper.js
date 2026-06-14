/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Piper TTS provider — offline, high-quality, local binary.
 *
 * Requires the user to install:
 *   1. Piper binary:  https://github.com/rhasspy/piper/releases
 *      (apt: piper-tts, or download release)
 *   2. A .onnx voice model:
 *      https://github.com/rhasspy/piper/blob/master/VOICES.md
 *      Example: huggingface.co/rhasspy/piper-voices  (en_US-amy-medium.onnx)
 *
 *   Config:
 *     config.tts.piper = {
 *       binPath:   'piper',         // path to binary; 'piper' if on PATH
 *       modelPath: '~/.local/share/piper/en_US-amy-medium.onnx',
 *     }
 *
 * Output: Piper writes WAV by default; we pipe through ffmpeg to MP3
 * so the rest of the pipeline (audio messages) gets MP3 like other
 * providers. ffmpeg is already a project dependency for sticker/video work.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ffmpeg = require('fluent-ffmpeg');
const { config } = require('../../../lib/configLoader');

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

async function piperToWav(text, binPath, modelPath, wavPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(binPath, ['--model', modelPath, '--output_file', wavPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`piper exited ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(wavPath);
      }
    });

    proc.stdin.write(text);
    proc.stdin.end();

    // Safety timeout
    setTimeout(() => proc.kill(), 60_000).unref();
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
  const cfg = config.tts?.piper || {};
  const binPath = expandHome(cfg.binPath) || 'piper';
  const modelPath = expandHome(cfg.modelPath);
  if (!modelPath) throw new Error('config.tts.piper.modelPath is not set');
  if (!fs.existsSync(modelPath)) throw new Error(`Piper model not found: ${modelPath}`);

  const tmpDir = path.join(os.tmpdir(), 'echofox-piper');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const stem = path.join(tmpDir, `piper-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const wavPath = stem + '.wav';
  const mp3Path = stem + '.mp3';

  try {
    await piperToWav(text, binPath, modelPath, wavPath);
    await wavToMp3(wavPath, mp3Path);
    return fs.readFileSync(mp3Path);
  } finally {
    try {
      fs.rmSync(wavPath, { force: true });
    } catch {}
    try {
      fs.rmSync(mp3Path, { force: true });
    } catch {}
  }
}

module.exports = { synthesize };
