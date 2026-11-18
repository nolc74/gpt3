import * as ort from 'onnxruntime-web';
import { configureOrt, loadTextToSpeech, loadVoiceStyle, writeWavFile } from './helper.js';
import mammoth from 'mammoth/mammoth.browser.js';
import { t, applyDom, setLocale, getLocale } from './i18n.js';

configureOrt(ort);

/* ================== Config ================== */

// In dev, models are served from local ./assets via the Vite middleware.
// In production builds (Vercel, GitHub Pages, etc.) we fetch directly from
// the Hugging Face CDN so the 380 MB of model assets aren't shipped with
// the deploy. Both static hosts cap files at 100 MB; the vector_estimator
// model alone is 244 MB.
const HF_CDN_BASE = 'https://huggingface.co/Supertone/supertonic-3/resolve/main';
const ASSETS_BASE = import.meta.env.PROD ? HF_CDN_BASE : 'assets';
const ONNX_BASE = `${ASSETS_BASE}/onnx`;

// Voice catalog. Names are language-neutral (read naturally in Korean,
// English, and Japanese). The underlying Supertonic model is multilingual,
// so every voice works for every language.
const VOICES = [
  { id: 'F1', label: 'Mina',  gender: 'female', style: `${ASSETS_BASE}/voice_styles/F1.json` },
  { id: 'F2', label: 'Sora',  gender: 'female', style: `${ASSETS_BASE}/voice_styles/F2.json` },
  { id: 'F3', label: 'Yuna',  gender: 'female', style: `${ASSETS_BASE}/voice_styles/F3.json` },
  { id: 'M1', label: 'Aiden', gender: 'male',   style: `${ASSETS_BASE}/voice_styles/M1.json` },
  { id: 'M2', label: 'Hiro',  gender: 'male',   style: `${ASSETS_BASE}/voice_styles/M2.json` },
  { id: 'M3', label: 'Leo',   gender: 'male',   style: `${ASSETS_BASE}/voice_styles/M3.json` }
];

const LANGS = {
  en: {
    preview: "Hi. This is a quick voice sample, so you can hear me before you generate your full audio.",
    presets: [
      "Welcome to our product demo. Today, we will explore three key features that save you hours of work each week.",
      "The early morning fog lifted slowly over the harbor, revealing fishing boats and the soft glow of sunrise on the water.",
      "Thanks for tuning in. Don't forget to like, comment, and subscribe. We will see you in the next episode."
    ]
  },
  ko: {
    preview: "안녕하세요. 이 목소리가 마음에 드시는지 짧게 미리 들려드릴게요.",
    presets: [
      "오늘은 새로 출시된 기능 세 가지를 함께 살펴보겠습니다. 끝까지 시청해 주세요.",
      "봄바람이 부는 오후, 공원 벤치에 앉아 따뜻한 햇살을 즐기는 것만큼 좋은 일은 없다.",
      "오디오북을 만들고 싶으신가요? 텍스트를 붙여넣고 음성을 선택한 다음, 생성 버튼만 누르면 됩니다."
    ]
  },
  ja: {
    preview: "こんにちは。本番の音声を作る前に、私の声を短くお試しください。",
    presets: [
      "本日は新機能を三つご紹介します。最後までお付き合いください。",
      "春の午後、公園のベンチで暖かい日差しを浴びる、そんな時間がいちばん好きです。",
      "ナレーションを自動で作りたい方は、テキストを貼り付けて声を選び、再生ボタンを押すだけです。"
    ]
  }
};

const DEFAULT_VOICE_ID = 'F1';
const DEFAULT_LANG = 'ko';
const MAX_TEXT_CHARS = 200000;

const VOICE_DESC = {
  F1: { ko: '맑고 깨끗한 여성 톤', en: 'Bright & clear female tone', ja: '明るく澄んだ女性の声' },
  F2: { ko: '차분하고 따뜻한 여성 톤', en: 'Warm & gentle female tone', ja: '落ち着いて温かい女性の声' },
  F3: { ko: '자연스럽고 친근한 여성 톤', en: 'Natural & friendly female tone', ja: '自然で親しみやすい女性の声' },
  M1: { ko: '신뢰감 있고 부드러운 남성 톤', en: 'Soft & trustworthy male tone', ja: '優しく信頼感のある男性の声' },
  M2: { ko: '지적이고 차분한 남성 톤', en: 'Calm & intellectual male tone', ja: '知的で落ち着いた男性の声' },
  M3: { ko: '에너지 넘치는 남성 톤', en: 'Energetic & bold male tone', ja: 'エネルギッシュな男性の声' }
};

/* ================== State ================== */

const state = {
  lang: DEFAULT_LANG,       // TTS source language (the text language)
  voiceId: DEFAULT_VOICE_ID,
  tts: null,
  cfgs: null,
  styleByVoice: new Map(),
  loadingStyleFor: null,
  previewCache: new Map(),
  previewAudio: new Audio(),
  currentPreviewKey: null,
  lastOutputUrl: null
};

/* ================== DOM ================== */

const $ = (sel) => document.querySelector(sel);

const dom = {
  loader: $('#loader'),
  loaderText: $('#loaderText'),
  loaderPct: $('#loaderPct'),
  loaderFill: $('#loaderFill'),
  backendBadge: $('#backendBadge'),
  langTabs: $('#langTabs'),
  voiceGrid: $('#voiceGrid'),
  presets: $('#presets'),
  text: $('#text'),
  audioTitle: $('#audioTitle'),
  outputTitle: document.querySelector('#output .output-title'),
  textWrap: $('#textWrap'),
  charCount: $('#charCount'),
  fileInput: $('#fileInput'),
  fileName: $('#fileName'),
  totalStep: $('#totalStep'),
  speed: $('#speed'),
  generateBtn: $('#generateBtn'),
  generateLabel: $('#generateLabel'),
  genTimer: $('#genTimer'),
  genEstimate: $('#genEstimate'),
  errorMsg: $('#errorMsg'),
  output: $('#output'),
  audio: $('#audio'),
  statAudio: $('#statAudio'),
  statGen: $('#statGen'),
  downloadBtn: $('#downloadBtn'),
  copyLinkBtn: $('#copyLinkBtn'),
  transcript: $('#transcript'),
  localeToggle: $('#localeToggle'),
  videoFiles: $('#videoFiles'),
  videoLibraryList: $('#videoLibraryList'),
  videoStorageStatus: $('#videoStorageStatus'),
  combineVideosBtn: $('#combineVideosBtn'),
  videoCombineStatus: $('#videoCombineStatus'),
  combinedVideoResult: $('#combinedVideoResult')
};

/* ================== Init ================== */

window.addEventListener('DOMContentLoaded', () => {
  // Apply i18n to the static markup before anything else.
  applyDom();
  syncLocaleToggle(getLocale());

  renderVoices();
  renderPresets();
  wireEvents();
  initialiseVideoLibrary().catch((err) => {
    console.error(err);
    dom.videoStorageStatus.textContent = '영상 보관함을 열지 못했습니다: ' + err.message;
  });
  dom.text.value = LANGS[state.lang].presets[0];
  updateCharCount();
  updateGenerationEstimate();
  initialiseModels();

  // Set initial slider label values
  const qVal = $('#qualityVal');
  const sVal = $('#speedVal');
  if (qVal && dom.totalStep) qVal.textContent = dom.totalStep.value;
  if (sVal && dom.speed) sVal.textContent = parseFloat(dom.speed.value).toFixed(2) + 'x';

  // Re-run dynamic renders when UI locale changes.
  window.addEventListener('locale-changed', (e) => {
    syncLocaleToggle(e.detail);
    renderVoices();
    renderPresets();
    updateCharCount();
  });
});

/* ================== Rendering ================== */

function renderVoices() {
  dom.voiceGrid.innerHTML = '';
  for (const v of VOICES) {
    const chip = document.createElement('div');
    chip.className = 'voice-chip' + (v.id === state.voiceId ? ' is-active' : '');
    chip.dataset.voiceId = v.id;
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', String(v.id === state.voiceId));

    const genderLabel = t(v.gender === 'male' ? 'gender_male' : 'gender_female');
    const previewTitle = t('voice_preview_title', { name: v.label });
    const previewAria = t('voice_preview_aria', { name: v.label });
    const desc = VOICE_DESC[v.id][getLocale()] || VOICE_DESC[v.id]['en'];

    chip.innerHTML = `
      <div class="voice-info">
        <div class="voice-name-row">
          <span class="voice-name">${v.label}</span>
          <span class="voice-meta">${genderLabel}</span>
        </div>
        <span class="voice-subtext">${desc}</span>
      </div>
      <span class="voice-preview" data-action="preview" title="${previewTitle}" aria-label="${previewAria}" role="button" tabindex="0">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <polygon points="6 3 20 12 6 21 6 3"></polygon>
        </svg>
      </span>
    `;

    // Handle space/enter key selection for a11y
    chip.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setActiveVoice(v.id);
      }
    });

    dom.voiceGrid.appendChild(chip);
  }
}

function renderPresets() {
  const presets = LANGS[state.lang].presets;
  dom.presets.innerHTML = '';
  presets.forEach((text, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'preset-chip';
    chip.textContent = t('preset_label', { n: String(i + 1).padStart(2, '0') });
    chip.title = text;
    chip.addEventListener('click', () => {
      dom.text.value = text;
      updateCharCount();
      dom.text.focus();
    });
    dom.presets.appendChild(chip);
  });
}

function updateCharCount() {
  const text = dom.text.value;
  const chars = text.length;
  // For Korean/Japanese (no whitespace word breaks), word counts are noisy.
  // Show only characters for those languages; words + chars for English.
  if (state.lang === 'en') {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    dom.charCount.textContent = t('char_count_en', {
      words: words.toLocaleString(),
      chars: chars.toLocaleString()
    }) + ' / 200,000';
  } else {
    dom.charCount.textContent = t('char_count_ko', { chars: chars.toLocaleString() }) + ' / 200,000';
  }
}

function setActiveLang(lang) {
  if (!LANGS[lang]) return;
  state.lang = lang;
  document.querySelectorAll('.lang-pill').forEach((tab) => {
    const isActive = tab.dataset.lang === lang;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
  renderPresets();
  updateCharCount();
  updateGenerationEstimate();
}

function setActiveVoice(voiceId) {
  if (!VOICES.find((v) => v.id === voiceId)) return;
  state.voiceId = voiceId;
  updateGenerationEstimate();
  document.querySelectorAll('.voice-chip').forEach((card) => {
    const isActive = card.dataset.voiceId === voiceId;
    card.classList.toggle('is-active', isActive);
    card.setAttribute('aria-checked', String(isActive));
  });
  ensureStyleLoaded(voiceId).catch((err) => {
    console.error(err);
    showError(t('error_voice_load', { voice: voiceId, error: err.message }));
  });
}

function syncLocaleToggle(loc) {
  dom.localeToggle.querySelectorAll('.locale-opt').forEach((b) => {
    const isActive = b.dataset.locale === loc;
    b.classList.toggle('is-active', isActive);
    b.setAttribute('aria-pressed', String(isActive));
  });
}

/* ================== Events ================== */

function wireEvents() {
  dom.langTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.lang-pill');
    if (!tab) return;
    setActiveLang(tab.dataset.lang);
  });

  dom.voiceGrid.addEventListener('click', async (e) => {
    const preview = e.target.closest('[data-action="preview"]');
    const chip = e.target.closest('.voice-chip');
    if (!chip) return;
    const voiceId = chip.dataset.voiceId;
    if (preview) {
      e.stopPropagation();
      await playPreview(voiceId);
      return;
    }
    setActiveVoice(voiceId);
  });

  dom.text.addEventListener('input', () => { updateCharCount(); updateGenerationEstimate(); });
  dom.text.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!dom.generateBtn.disabled) generateSpeech();
    }
  });

  // Range Sliders Event Listeners
  const qualityVal = $('#qualityVal');
  const speedVal = $('#speedVal');
  if (qualityVal && dom.totalStep) {
    dom.totalStep.addEventListener('input', (e) => {
      qualityVal.textContent = e.target.value;
      updateGenerationEstimate();
    });
  }
  if (speedVal && dom.speed) {
    dom.speed.addEventListener('input', (e) => {
      speedVal.textContent = parseFloat(e.target.value).toFixed(2) + 'x';
      updateGenerationEstimate();
    });
  }

  // Drag-drop file
  ['dragenter', 'dragover'].forEach((evt) =>
    dom.textWrap.addEventListener(evt, (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      dom.textWrap.classList.add('is-dragover');
    })
  );
  ['dragleave', 'dragend', 'drop'].forEach((evt) =>
    dom.textWrap.addEventListener(evt, () => dom.textWrap.classList.remove('is-dragover'))
  );
  dom.textWrap.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) await ingestFile(file);
  });

  dom.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await ingestFile(file);
    e.target.value = '';
  });

  dom.generateBtn.addEventListener('click', generateSpeech);

  dom.videoFiles.addEventListener('change', async () => {
    const files = Array.from(dom.videoFiles.files || []);
    dom.videoFiles.value = '';
    for (const file of files) {
      if (!file.type.startsWith('video/')) continue;
      try {
        await saveVideoToLibrary(file);
      } catch (err) {
        console.error(err);
        dom.videoStorageStatus.textContent = `저장 실패 (${file.name}): ${err.name === 'QuotaExceededError' ? '브라우저 저장 공간이 부족합니다.' : err.message}`;
      }
    }
    await renderVideoLibrary();
  });

  dom.combineVideosBtn.addEventListener('click', combineSelectedVideos);

  dom.downloadBtn.addEventListener('click', () => {
    if (!state.lastOutputUrl) return;
    const a = document.createElement('a');
    a.href = state.lastOutputUrl;
    a.download = `${safeFileName(dom.audioTitle?.value)}.mp3`;
    a.click();
  });

  dom.copyLinkBtn.addEventListener('click', () => {
    if (!state.lastOutputUrl) return;
    window.open(state.lastOutputUrl, '_blank', 'noopener');
  });

  // Locale toggle (KO ⇄ EN)
  dom.localeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.locale-opt');
    if (!btn) return;
    setLocale(btn.dataset.locale);
  });

  state.previewAudio.addEventListener('ended', clearPreviewIndicators);
  state.previewAudio.addEventListener('pause', clearPreviewIndicators);
}

/* ================== File ingest ================== */

async function ingestFile(file) {
  hideError();
  dom.fileName.textContent = file.name;
  dom.fileName.classList.remove('hidden');
  try {
    const text = await extractTextFromFile(file);
    if (!text.trim()) throw new Error(t('error_file_empty'));
    if (text.trim().length > MAX_TEXT_CHARS) throw new Error('파일은 최대 200,000자까지만 불러올 수 있습니다.');
    dom.text.value = text.trim();
    updateCharCount();
  } catch (err) {
    showError(err.message);
    dom.fileName.textContent = '';
    dom.fileName.classList.add('hidden');
  }
}


async function extractTextFromFile(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.txt') || file.type === 'text/plain') {
    return await file.text();
  }
  if (lower.endsWith('.docx')) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value || '';
  }
  throw new Error(t('error_file_unsupported'));
}

/* ================== Local video library ================== */
const VIDEO_DB_NAME = 'sorigyeol-video-library';
const VIDEO_STORE_NAME = 'videos';
let videoDb = null;
const videoObjectUrls = new Map();

function openVideoDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VIDEO_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VIDEO_STORE_NAME)) {
        db.createObjectStore(VIDEO_STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('브라우저 저장소를 열 수 없습니다.'));
  });
}

async function initialiseVideoLibrary() {
  videoDb = await openVideoDatabase();
  await renderVideoLibrary();
}

function videoTransaction(mode, action) {
  return new Promise((resolve, reject) => {
    const tx = videoDb.transaction(VIDEO_STORE_NAME, mode);
    const store = tx.objectStore(VIDEO_STORE_NAME);
    let request;
    try { request = action(store); } catch (err) { reject(err); return; }
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error || request?.error || new Error('영상 저장 작업에 실패했습니다.'));
    tx.onabort = () => reject(tx.error || new Error('영상 저장 작업이 취소됐습니다.'));
  });
}

async function saveVideoToLibrary(file) {
  const record = {
    name: file.name,
    type: file.type || 'video/mp4',
    size: file.size,
    addedAt: Date.now(),
    blob: file
  };
  await videoTransaction('readwrite', store => store.add(record));
  dom.videoStorageStatus.textContent = `저장 완료: ${file.name}`;
}

async function renderVideoLibrary() {
  if (!videoDb) return;
  const records = await videoTransaction('readonly', store => store.getAll()) || [];
  for (const oldUrl of videoObjectUrls.values()) URL.revokeObjectURL(oldUrl);
  videoObjectUrls.clear();
  dom.videoLibraryList.innerHTML = '';
  dom.combineVideosBtn.disabled = true;
  if (!records.length) {
    dom.videoLibraryList.textContent = '아직 저장된 영상이 없어. 위의 버튼으로 영상을 추가해 줘.';
    dom.videoStorageStatus.textContent = '저장된 영상 0개';
    return;
  }
  dom.videoStorageStatus.textContent = `저장된 영상 ${records.length}개 · 이 브라우저에 보관 중`;
  for (const record of records) {
    const card = document.createElement('article');
    card.className = 'video-library-item';
    const heading = document.createElement('div');
    heading.className = 'video-library-heading';
    const selectLabel = document.createElement('label');
    selectLabel.className = 'video-select-label';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'video-select';
    checkbox.value = String(record.id);
    checkbox.setAttribute('aria-label', record.name + ' 합성에 선택');
    selectLabel.append(checkbox, document.createTextNode(' 합성 선택'));
    const name = document.createElement('strong');
    name.textContent = record.name;
    const size = document.createElement('span');
    size.textContent = formatVideoSize(record.size);
    heading.append(name, size);

    const player = document.createElement('video');
    player.controls = true;
    player.preload = 'metadata';
    player.playsInline = true;
    player.src = URL.createObjectURL(record.blob);
    videoObjectUrls.set(record.id, player.src);

    const actions = document.createElement('div');
    actions.className = 'video-item-actions';
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'ghost-btn';
    download.textContent = '다시 다운로드';
    download.addEventListener('click', () => downloadVideoBlob(record.blob, record.name));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost-btn video-delete';
    remove.textContent = '삭제';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`"${record.name}" 영상을 보관함에서 삭제할까?`)) return;
      await videoTransaction('readwrite', store => store.delete(record.id));
      const oldUrl = videoObjectUrls.get(record.id);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      videoObjectUrls.delete(record.id);
      await renderVideoLibrary();
    });
    actions.append(download, remove);
    heading.prepend(selectLabel);
    card.append(heading, player, actions);
    dom.videoLibraryList.appendChild(card);
  }
  dom.videoLibraryList.querySelectorAll('.video-select').forEach(input => {
    input.addEventListener('change', updateCombineButton);
  });
}

function updateCombineButton() {
  const count = dom.videoLibraryList.querySelectorAll('.video-select:checked').length;
  dom.combineVideosBtn.disabled = count < 2;
  dom.combineVideosBtn.textContent = count >= 2 ? `선택한 영상 ${count}개 합치기` : '영상 2개 이상 선택하기';
}

function downloadVideoBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(name);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function combineSelectedVideos() {
  const ids = Array.from(dom.videoLibraryList.querySelectorAll('.video-select:checked')).map(input => Number(input.value));
  if (ids.length < 2) return;
  dom.combineVideosBtn.disabled = true;
  dom.videoCombineStatus.textContent = '선택한 영상을 준비하고 있어…';
  dom.combinedVideoResult.classList.add('hidden');
  let audioContext;
  let recorder;
  let combinedUrl = null;
  try {
    const records = (await videoTransaction('readonly', store => store.getAll())) || [];
    const selected = ids.map(id => records.find(item => item.id === id)).filter(Boolean);
    if (selected.length < 2) throw new Error('합칠 영상을 두 개 이상 찾지 못했어.');
    const firstVideo = document.createElement('video');
    firstVideo.muted = true;
    firstVideo.playsInline = true;
    firstVideo.preload = 'auto';
    const firstUrl = URL.createObjectURL(selected[0].blob);
    firstVideo.src = firstUrl;
    try {
      await waitForVideoMetadata(firstVideo);
    } finally {
      URL.revokeObjectURL(firstUrl);
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(firstVideo.videoWidth || 1280, 1920);
    canvas.height = Math.round(canvas.width * (firstVideo.videoHeight || 720) / (firstVideo.videoWidth || 1280));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('영상 합성용 캔버스를 만들 수 없어.');
    const canvasStream = canvas.captureStream(30);
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioDestination = audioContext.createMediaStreamDestination();
    const outputStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
    const mimeCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = mimeCandidates.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('이 브라우저는 영상 합성을 지원하지 않아. Chrome 또는 Edge 최신 버전을 사용해 줘.');
    const chunks = [];
    recorder = new MediaRecorder(outputStream, { mimeType });
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = () => reject(recorder.error || new Error('영상 녹화 중 오류가 발생했어.'));
    });
    await audioContext.resume();
    recorder.start(1000);

    for (let index = 0; index < selected.length; index++) {
      dom.videoCombineStatus.textContent = `영상 합치는 중… ${index + 1}/${selected.length} · ${selected[index].name}`;
      const video = document.createElement('video');
      video.playsInline = true;
      video.preload = 'auto';
      video.src = URL.createObjectURL(selected[index].blob);
      const videoUrl = video.src;
      try {
        await waitForVideoMetadata(video);
        const source = audioContext.createMediaElementSource(video);
        source.connect(audioDestination);
        await new Promise((resolve, reject) => {
          video.onended = resolve;
          video.onerror = () => reject(new Error(selected[index].name + ' 파일을 재생할 수 없어.'));
          video.currentTime = 0;
          video.play().then(() => {}).catch(reject);
          const draw = () => {
            if (!video.paused && !video.ended) {
              context.fillStyle = '#000';
              context.fillRect(0, 0, canvas.width, canvas.height);
              const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
              const width = video.videoWidth * scale;
              const height = video.videoHeight * scale;
              context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
              requestAnimationFrame(draw);
            }
          };
          requestAnimationFrame(draw);
        });
      } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(videoUrl);
      }
    }
    recorder.stop();
    await stopped;
    canvasStream.getTracks().forEach(track => track.stop());
    outputStream.getTracks().forEach(track => track.stop());
    const blob = new Blob(chunks, { type: mimeType });
    if (!blob.size) throw new Error('합성 결과가 비어 있어. 다시 시도해 줘.');
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `소리결_합성영상_${date}.webm`;
    await videoTransaction('readwrite', store => store.add({ name, type: mimeType, size: blob.size, addedAt: Date.now(), blob }));
    await renderVideoLibrary();
    combinedUrl = URL.createObjectURL(blob);
    const preview = document.createElement('video');
    preview.controls = true;
    preview.playsInline = true;
    preview.src = combinedUrl;
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'ghost-btn';
    download.textContent = '합성 영상 다운로드';
    download.addEventListener('click', () => downloadVideoBlob(blob, name));
    dom.combinedVideoResult.replaceChildren(preview, download);
    dom.combinedVideoResult.classList.remove('hidden');
    dom.videoCombineStatus.textContent = `합성 완료! ${selected.length}개 영상을 하나로 합쳐 보관함에 저장했어.`;
  } catch (err) {
    console.error(err);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    dom.videoCombineStatus.textContent = '합성 실패: ' + (err.message || '알 수 없는 오류');
  } finally {
    if (audioContext) await audioContext.close().catch(() => {});
    dom.combineVideosBtn.disabled = false;
    updateCombineButton();
    if (combinedUrl) { /* preview keeps this URL until the next result is rendered */ }
  }
}

function waitForVideoMetadata(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1 && video.videoWidth) return resolve();
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('영상 파일을 읽지 못했어. 지원되는 영상인지 확인해 줘.'));
    video.load();
  });
}

function formatVideoSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

/* ================== Model loading ================== */

async function initialiseModels() {
  try {
    setLoader(t('loader_initial'), 0);

    let backendUsed = 'wasm';
    const loadOpts = (provider) => ({
      executionProviders: [provider],
      graphOptimizationLevel: 'all'
    });

    const onProgress = (modelName, current, total) => {
      const pct = Math.round((current / total) * 80);
      setLoader(t('loader_model_progress', { model: modelName.toLowerCase() }), pct);
    };

    try {
      const result = await loadTextToSpeech(ONNX_BASE, loadOpts('webgpu'), onProgress);
      state.tts = result.textToSpeech;
      state.cfgs = result.cfgs;
      backendUsed = 'webgpu';
    } catch (webgpuErr) {
      console.log('WebGPU unavailable, falling back to WASM.', webgpuErr);
      const result = await loadTextToSpeech(ONNX_BASE, loadOpts('wasm'), onProgress);
      state.tts = result.textToSpeech;
      state.cfgs = result.cfgs;
    }

    setBackendBadge(backendUsed);

    setLoader(t('loader_voice'), 92);
    await ensureStyleLoaded(state.voiceId);

    setLoader(t('loader_ready'), 100);
    setTimeout(() => dom.loader.classList.add('is-done'), 350);
    dom.generateBtn.disabled = false;
  } catch (err) {
    console.error(err);
    setLoader(t('loader_error', { error: err.message }), 0);
    dom.loader.style.color = 'var(--danger)';
  }
}

async function ensureStyleLoaded(voiceId) {
  if (state.styleByVoice.has(voiceId)) return state.styleByVoice.get(voiceId);
  if (state.loadingStyleFor === voiceId) {
    return await new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (state.styleByVoice.has(voiceId)) {
          clearInterval(timer);
          resolve(state.styleByVoice.get(voiceId));
        }
      }, 50);
      setTimeout(() => { clearInterval(timer); reject(new Error('Voice load timed out.')); }, 30000);
    });
  }
  state.loadingStyleFor = voiceId;
  const voice = VOICES.find((v) => v.id === voiceId);
  if (!voice) throw new Error(`Unknown voice: ${voiceId}`);
  const style = await loadVoiceStyle([voice.style], false);
  state.styleByVoice.set(voiceId, style);
  state.loadingStyleFor = null;
  return style;
}

/* ================== Preview ================== */

async function playPreview(voiceId) {
  const key = `${voiceId}::${state.lang}`;
  if (state.currentPreviewKey === key && !state.previewAudio.paused) {
    state.previewAudio.pause();
    state.previewAudio.currentTime = 0;
    clearPreviewIndicators();
    return;
  }
  if (!state.tts) {
    showError(t('error_model_loading'));
    return;
  }
  hideError();
  const btn = previewButtonFor(voiceId);

  try {
    if (state.previewCache.has(key)) {
      playPreviewUrl(state.previewCache.get(key), voiceId, key);
      return;
    }
    if (btn) btn.classList.add('is-loading');
    const style = await ensureStyleLoaded(voiceId);
    const { wav, duration } = await state.tts.call(
      LANGS[state.lang].preview,
      state.lang,
      style,
      6,
      1.05,
      0.2
    );
    const wavLen = Math.floor(state.tts.sampleRate * duration[0]);
    const wavOut = wav.slice(0, wavLen);
    const buf = writeWavFile(wavOut, state.tts.sampleRate);
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    state.previewCache.set(key, url);
    playPreviewUrl(url, voiceId, key);
  } catch (err) {
    console.error(err);
    showError(t('error_preview', { error: err.message }));
  } finally {
    if (btn) btn.classList.remove('is-loading');
  }
}

function playPreviewUrl(url, voiceId, key) {
  clearPreviewIndicators();
  state.previewAudio.src = url;
  state.currentPreviewKey = key;
  const btn = previewButtonFor(voiceId);
  if (btn) btn.classList.add('is-playing');
  state.previewAudio.play().catch((err) => {
    console.error(err);
    clearPreviewIndicators();
  });
}

function previewButtonFor(voiceId) {
  const chip = dom.voiceGrid.querySelector(`.voice-chip[data-voice-id="${voiceId}"]`);
  return chip ? chip.querySelector('[data-action="preview"]') : null;
}

function clearPreviewIndicators() {
  document
    .querySelectorAll('.voice-preview.is-playing, .voice-preview.is-loading')
    .forEach((b) => b.classList.remove('is-playing', 'is-loading'));
  state.currentPreviewKey = null;
}


/* ================== Generation time estimate ================== */
function updateGenerationEstimate() {
  if (!dom.genEstimate) return;
  const chars = (dom.text?.value || '').trim().length;
  if (!chars) {
    dom.genEstimate.textContent = '예상 생성 시간: 글을 입력하면 계산됩니다.';
    return;
  }

  const steps = clampInt(dom.totalStep?.value, 4, 16, 8);
  const speed = clampFloat(dom.speed?.value, 0.7, 1.8, 1.05);
  const key = `supertonic-estimate-v2-${state.lang}-${state.voiceId}-${steps}-${speed.toFixed(2)}`;

  // Ignore old calibration data: previous versions could store failed/abnormally long runs.
  let secondsPerChar = 0.035 * (steps / 8) / speed;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved && saved.samples >= 1 &&
        Number.isFinite(saved.secondsPerChar) &&
        saved.secondsPerChar >= 0.005 &&
        saved.secondsPerChar <= 0.15) {
      secondsPerChar = saved.secondsPerChar;
    }
  } catch (_) {}

  const estimate = Math.max(1, chars * secondsPerChar);
  const low = Math.max(1, Math.floor(estimate * 0.75));
  const high = Math.max(low + 1, Math.ceil(estimate * 1.35));
  dom.genEstimate.textContent = `예상 생성 시간: 약 ${low.toLocaleString()}~${high.toLocaleString()}초 (대략적인 참고값이며 기기 성능에 따라 달라져요)`;
}

function saveGenerationEstimate(elapsedSeconds, charCount) {
  if (!charCount || elapsedSeconds <= 0) return;
  const steps = clampInt(dom.totalStep?.value, 4, 16, 8);
  const speed = clampFloat(dom.speed?.value, 0.7, 1.8, 1.05);
  const measured = elapsedSeconds / charCount;

  // Do not learn from abnormal runs; they would corrupt every later estimate.
  if (!Number.isFinite(measured) || measured < 0.005 || measured > 0.15) return;

  const key = `supertonic-estimate-v2-${state.lang}-${state.voiceId}-${steps}-${speed.toFixed(2)}`;
  try {
    const old = JSON.parse(localStorage.getItem(key) || 'null');
    const samples = (old?.samples || 0) + 1;
    const average = old?.secondsPerChar
      ? old.secondsPerChar * 0.65 + measured * 0.35
      : measured;
    localStorage.setItem(key, JSON.stringify({ samples, secondsPerChar: average }));
  } catch (_) {}
}

/* ================== MP3 encoding ================== */
let lameJsPromise = null;
async function loadLameJs() {
  if (window.lamejs) return window.lamejs;
  if (!lameJsPromise) {
    lameJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
      script.onload = () => window.lamejs ? resolve(window.lamejs) : reject(new Error('MP3 인코더를 불러오지 못했습니다.'));
      script.onerror = () => reject(new Error('MP3 인코더 다운로드에 실패했습니다. 인터넷 연결을 확인해 주세요.'));
      document.head.appendChild(script);
    });
  }
  return lameJsPromise;
}

function appendMp3Samples(encoder, samples, mp3Chunks) {
  const chunkSize = 1152;
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    const length = Math.min(chunkSize, samples.length - offset);
    const pcm = new Int16Array(length);
    for (let i = 0; i < length; i++) {
      const value = Math.max(-1, Math.min(1, samples[offset + i]));
      pcm[i] = value < 0 ? value * 32768 : value * 32767;
    }
    const encoded = encoder.encodeBuffer(pcm);
    if (encoded.length) mp3Chunks.push(new Uint8Array(encoded));
  }
}

/* ================== Main synthesis ================== */

function splitVoiceSegments(text, defaultVoiceId) {
  const segments = [];
  let activeVoiceId = defaultVoiceId;
  let buffer = '';

  const flush = () => {
    const value = buffer;
    buffer = '';
    if (!value.trim()) return;

    const previous = segments[segments.length - 1];
    if (previous && previous.voiceId === activeVoiceId) {
      previous.text += value;
    } else {
      segments.push({ voiceId: activeVoiceId, text: value });
    }
  };

  // ® ... © selects the female F1 voice.
  // × ... ÷ selects the male Leo (M3) voice.
  // Text outside either marked section keeps the user's default voice.
  for (const char of text) {
    if (char === '®') {
      flush();
      activeVoiceId = 'F1';
    } else if (char === '×') {
      flush();
      activeVoiceId = 'M3';
    } else if (char === '©' || char === '÷') {
      flush();
      activeVoiceId = defaultVoiceId;
    } else {
      buffer += char;
    }
  }

  flush();
  return segments;
}

async function generateSpeech() {
  hideError();
  const text = dom.text.value.trim();
  if (!text) {
    showError(t('error_no_text'));
    dom.text.focus();
    return;
  }
  if (text.length > MAX_TEXT_CHARS) {
    showError('최대 200,000자까지 변환할 수 있습니다. 글자 수를 줄여 주세요.');
    return;
  }
  if (!state.tts) {
    showError(t('error_model_loading'));
    return;
  }
  if (!state.previewAudio.paused) state.previewAudio.pause();

  const totalStep = clampInt(dom.totalStep.value, 4, 16, 8);
  const speed = clampFloat(dom.speed.value, 0.7, 1.8, 1.05);
  const segments = splitVoiceSegments(text, state.voiceId);

  dom.generateBtn.disabled = true;
  dom.generateBtn.classList.add('is-busy');
  dom.generateLabel.textContent = t('btn_generating');

  const start = performance.now();
  dom.genTimer.hidden = false;
  dom.genTimer.textContent = '생성 시간: 0.0초';
  const timerId = window.setInterval(() => {
    dom.genTimer.textContent = `생성 시간: ${((performance.now() - start) / 1000).toFixed(1)}초`;
  }, 100);

  try {
    dom.generateLabel.textContent = 'MP3 인코더 준비 중…';
    const lamejs = await loadLameJs();
    const encoder = new lamejs.Mp3Encoder(1, state.tts.sampleRate, 128);
    const mp3Chunks = [];
    let totalDuration = 0;

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const segment = segments[segmentIndex];
      const style = await ensureStyleLoaded(segment.voiceId);

      // Keep a short natural pause when the voice changes.
      if (segmentIndex > 0) {
        appendMp3Samples(
          encoder,
          new Float32Array(Math.floor(state.tts.sampleRate * 0.25)),
          mp3Chunks
        );
        totalDuration += 0.25;
      }

      const result = await state.tts.call(
        segment.text,
        state.lang,
        style,
        totalStep,
        speed,
        0.3,
        (step, total) => {
          dom.generateLabel.textContent =
            `음성 생성 중… ${segmentIndex + 1}/${segments.length} 구간`;
        },
        (audioPart, chunkIndex, chunkTotal) => {
          appendMp3Samples(encoder, audioPart, mp3Chunks);
          if (chunkIndex && chunkTotal) {
            dom.generateLabel.textContent =
              `음성 생성 중… ${segmentIndex + 1}/${segments.length} 구간 · ${chunkIndex.toLocaleString()}/${chunkTotal.toLocaleString()} 문장`;
          }
        }
      );
      totalDuration += result.duration[0];
    }

    const finalChunk = encoder.flush();
    if (finalChunk.length) mp3Chunks.push(new Uint8Array(finalChunk));
    dom.generateLabel.textContent = 'MP3 파일 마무리 중…';
    const blob = new Blob(mp3Chunks, { type: 'audio/mpeg' });

    if (state.lastOutputUrl) URL.revokeObjectURL(state.lastOutputUrl);
    state.lastOutputUrl = URL.createObjectURL(blob);

    dom.audio.src = state.lastOutputUrl;
    if (dom.outputTitle) dom.outputTitle.textContent = dom.audioTitle?.value.trim() || '결과';
    dom.transcript.textContent = text;
    saveGenerationEstimate((performance.now() - start) / 1000, text.length);
    updateGenerationEstimate();
    dom.statAudio.textContent = t('output_audio_stat', { seconds: totalDuration.toFixed(2) });
    dom.statGen.textContent = t('output_gen_stat', {
      seconds: ((performance.now() - start) / 1000).toFixed(2)
    });
    dom.output.classList.remove('hidden');
    dom.output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    dom.audio.play().catch(() => {/* autoplay blocked is fine */});
  } catch (err) {
    console.error(err);
    showError(t('error_generation', { error: err.message }));
  } finally {
    window.clearInterval(timerId);
    dom.genTimer.textContent = `총 생성 시간: ${((performance.now() - start) / 1000).toFixed(2)}초`;
    dom.generateBtn.disabled = false;
    dom.generateBtn.classList.remove('is-busy');
    dom.generateLabel.textContent = t('btn_speak');
  }
}

/* ================== Helpers ================== */

function setLoader(text, percent) {
  dom.loader.classList.remove('is-done');
  dom.loaderText.textContent = text;
  dom.loaderPct.textContent = `${Math.round(percent)}%`;
  dom.loaderFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function setBackendBadge(provider) {
  dom.backendBadge.textContent = provider === 'webgpu' ? 'webgpu' : 'wasm';
  // Stop overriding via i18n once we have a real backend value.
  delete dom.backendBadge.dataset.i18n;
  dom.backendBadge.classList.add('is-ready');
}

function showError(msg) {
  dom.errorMsg.innerHTML = msg ? `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <span>${msg}</span>
  ` : '';
}
function hideError() {
  dom.errorMsg.innerHTML = '';
}

function safeFileName(value) {
  const cleaned = String(value || '').trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
  return cleaned || 'sorigyeol-audio';
}
function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function clampFloat(raw, min, max, fallback) {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
