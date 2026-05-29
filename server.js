require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const EXTRACT_MODEL = process.env.ANTHROPIC_EXTRACT_MODEL || 'claude-sonnet-4-6';
const INTERPRET_MODEL = process.env.ANTHROPIC_INTERPRET_MODEL || 'claude-sonnet-4-6';

if (!API_KEY || API_KEY === 'your-api-key-here') {
  console.error('ERROR: ANTHROPIC_API_KEY is not set (required for extraction and interpretation).');
  process.exit(1);
}

app.use((req, res, next) => {
  express.json({ limit: '50mb' })(req, res, (err) => {
    if (err) {
      console.error('Body parse error:', err.message);
      return res.status(400).json({ error: 'Request too large or malformed: ' + err.message });
    }
    next();
  });
});
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

function isRateLimitError(message) {
  return /rate limit|tokens per minute|429/i.test(String(message || ''));
}

function parseRetryAfterSeconds(message) {
  const match = String(message || '').match(/retry[- ]after[^0-9]*(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : 60;
}

app.post('/api/extract', async (req, res) => {
  const { pdfBase64 } = req.body;
  if (!pdfBase64) return res.status(400).json({ error: 'No PDF data provided' });

  const prompt = `You are a precise medical data extraction assistant for VitalScan autonomic/cardiovascular reports.

Extract ALL available metrics from this PDF into the EXACT structured plain-text format below.

FLAGGING RULES — add " | FLAG" after the value if:
1. The cell/value is highlighted red or orange in the PDF, OR
2. The value falls outside the stated normal range below:
  - SNS: 0.8-4.0 | PNS: 0.8-4.0 | SNS/PNS: 0.4-2.0
  - SpO2: >=95% (flag if <95) | Autonomic Activity: 45-80 ms² (flag outside)
  - K30/15 Ratio: >1.1 (flag if <=1.1) | HR during Tilt: flag if >100 bpm
  - E/I Ratio: >1.2 | Valsalva Ratio: >1.2
  - Functional Age: flag if HIGHER than patient's chronological age
  - MSI: <1.0 | PSI: <1.0
  - EEI: 0.3-0.7 | DDI: 0.3-0.7 | DEI: 0.3-0.7
  - AI: < -0.4 (flag if > -0.4) | Stiffness Index: <8.0 m/s
  - Stroke Volume: 55-100 ml | Cardiac Output: 4.0-8.0 l/min
  - Mean Arterial Pressure: 70-110 mmHg | Blood Volume: 3-5 l
  - C1: >10.0 ml/mmHg | C2: >6.0 ml/mmHg
  - QRS: 60-120 ms | QTc: 350-460 ms | QTc Max: flag if >460 ms
  - PR int: 120-200 ms | ST seg: 80-120 ms
  - Estimated PPG Cardiac Ejection Time: 260-380 ms
  - BMI: 19-25 | ABI: 1.0-1.4 | TBI: >0.75
  - HR 30/15 Ratio: >1.1 | BP 30/15 Ratio: >1.1
  - SVT: flag if any episodes present
  - Irregular/Artifact beats: flag if >2%

OUTPUT FORMAT (follow EXACTLY — use this structure, include only sections/phases that exist in the PDF):

PATIENT
Name: [value]
Gender: [value]
Age: [value]
DOB: [value]
Weight: [value]
Height: [value]
BMI: [value]
Exam Date: [value]

AUTONOMICS //
HR
* Resting: [value] bpm
* Deep Breathing: [value] bpm [only if present]
* Valsalva: [value] bpm [only if present]
* Tilt Test: [value] bpm [flag if >100]
* Resting2: [value] bpm [only if present]
BP
* Resting Systolic: [value] mmHg
* Resting Diastolic: [value] mmHg
* Deep Breathing Systolic: [value] mmHg [only if present]
* Deep Breathing Diastolic: [value] mmHg [only if present]
* Valsalva Systolic: [value] mmHg [only if present]
* Valsalva Diastolic: [value] mmHg [only if present]
* Tilt Test Systolic: [value] mmHg
* Tilt Test Diastolic: [value] mmHg
* Resting2 Systolic: [value] mmHg [only if present]
* Resting2 Diastolic: [value] mmHg [only if present]
SNS (Norm: 0.8-4.0)
* Resting: [value]
* Deep Breathing: [value] [only if present]
* Valsalva: [value] [only if present]
* Tilt Test: [value]
* Resting2: [value] [only if present]
PNS (Norm: 0.8-4.0)
* Resting: [value]
* Deep Breathing: [value] [only if present]
* Valsalva: [value] [only if present]
* Tilt Test: [value]
* Resting2: [value] [only if present]
SpO2 (Norm: >=95%)
* Resting: [value]%
* Deep Breathing: [value]% [only if present]
* Valsalva: [value]% [only if present]
* Tilt Test: [value]%
* Resting2: [value]% [only if present]
LF/HF
* Resting: [value]
* Deep Breathing: [value] [only if present]
* Valsalva: [value] [only if present]
* Tilt Test: [value]
* Resting2: [value] [only if present]
Other Metrics
* Autonomic Activity (Norm: 45-80 ms²): [value]
* Autonomic Balance (-3 to 3): [value]
* K30/15 Ratio (Norm: >1.1): [value]
* E/I Ratio (Norm: >1.2): [value] [only if present]
* Valsalva Ratio (Norm: >1.2): [value] [only if present]
* HR 30/15 Ratio (Norm: >1.1): [value] [only if present]
* BP 30/15 Ratio (Norm: >1.1): [value] [only if present]
* Functional Age (Norm: < [patient age] yrs): [value] yrs
* MSI (Norm: <1.0): [value]
* PSI (Norm: <1.0): [value]

CARDIOVASCULAR //
* EEI (Norm: 0.3-0.7): [value]
* DDI (Norm: 0.3-0.7): [value]
* DEI (Norm: 0.3-0.7): [value]
* AI (Norm: < -0.4): [value]
* Reflection Index (Norm: 0.65-0.85): [value]
* Stiffness Index (Norm: <8.0): [value] m/s
* Stroke Volume (Norm: 55-100): [value] ml
* Cardiac Output (Norm: 4.0-8.0): [value] l/min
* Mean Arterial Pressure (Norm: 70-110): [value] mmHg
* Blood Volume (Norm: 3-5): [value] l
* C1 (Norm: >10.0): [value] ml/mmHg
* C2 (Norm: >6.0): [value] ml/mmHg
* DPTI/SPTI: [value]
* Estimated PPG Cardiac Ejection Time (Norm: 260-380): [value] ms [only if present]
* Estimated PPG Ejection Fraction (Norm: 55-70): [value]% [only if present]
* ABI Right (Norm: 1.0-1.4): [value] [only if present]
* ABI Left (Norm: 1.0-1.4): [value] [only if present]
* TBI Right (Norm: >0.75): [value] [only if present]
* TBI Left (Norm: >0.75): [value] [only if present]
* Ventricular Extrasystole (Norm: <1): [value]
* Atrial Extrasystole (Norm: <1): [value]
* Artifacts (Norm: <1): [value]
* QRS (Norm: 60-120): [value] ms
* QTc (Norm: 350-460): [value] ms
* ST seg (Norm: 80-120): [value] ms
* PR int (Norm: 120-200): [value] ms

ELECTROCARDIOGRAM //
Heart Rate
* Average Heart Rate: [value] bpm
* Fastest rate: [value] bpm [at time if available]
* Slowest rate: [value] bpm [at time if available]
* Fastest minutely rate: [value] bpm [at time if available, only if present]
* Slowest minutely rate: [value] bpm [at time if available, only if present]
Ventricular Details
* PVC - Ventricular Ectopy: [value] beats ([pct]%)
* Ventricular Couplet: [value] episodes
Supraventricular Details
* PAC - Supraventricular Ectopy: [value] beats ([pct]%)
* Supraventricular Couplet: [value] episodes
* SVT - Supraventricular: [value] [only if present]
Pause / Block
* Irregular / Artifact beat: [value] beats ([pct]%) [only if present]
HRV Analysis
* SDNN: [value] ms
* SDNN Max: [value] ms [at time if available, only if present]
* SDNN Min: [value] ms [at time if available, only if present]
QRS Analysis
* QRS: [value] ms
* QT / QTc: [value] ms / [value] ms
* QTc Max: [value] ms [at time if available, only if present]
* PR int / seg: [value] ms / [value] ms
* ST int / seg: [value] ms / [value] ms

Summary of Flagged Findings
* [Label (Norm: range)]: [value] [unit] | FLAG
[List ONLY items marked | FLAG above. One per line. No extras.]

RULES:
- Skip any line in square brackets marked "only if present" if that data does not exist in the PDF.
- Do NOT add explanations, commentary, or any text outside this structure.
- Do NOT invent or estimate values. Only extract what is visible in the PDF.`;

  try {
    console.log('[extract] Sending request to API...');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout

    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: EXTRACT_MODEL,
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
              { type: 'text', text: prompt }
            ]
          }]
        })
      });
    } finally {
      clearTimeout(timeout);
    }

    console.log('[extract] API responded with status:', response.status);
    const raw = await response.text();
    console.log('[extract] Raw response (first 300):', raw.slice(0, 300));

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      if (response.status === 429) {
        return res.status(429).json({
          error: 'API rate limit reached. Please wait about 60 seconds and try again.',
          retryAfterSeconds: 60,
        });
      }
      return res.status(500).json({ error: 'API returned non-JSON: ' + raw.slice(0, 200) });
    }

    if (response.status === 429) {
      const msg = data?.error?.message || raw.slice(0, 300);
      return res.status(429).json({
        error: msg,
        retryAfterSeconds: parseRetryAfterSeconds(msg),
      });
    }

    if (data.error) {
      const msg = typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : data.error;
      console.error('[extract] API error:', msg);
      if (response.status === 429 || isRateLimitError(msg)) {
        return res.status(429).json({
          error: msg,
          retryAfterSeconds: parseRetryAfterSeconds(msg),
        });
      }
      return res.status(500).json({ error: msg });
    }

    if (!data.content || !Array.isArray(data.content)) {
      console.error('[extract] Unexpected response shape:', JSON.stringify(data).slice(0, 300));
      return res.status(500).json({ error: 'Unexpected response from API. Check server logs.' });
    }

    const text = data.content.map(b => b.text || '').join('');
    console.log('[extract] Success, text length:', text.length);
    res.json({ result: text });

  } catch (err) {
    console.error('[extract] Caught error:', err.name, err.message);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request timed out after 2 minutes. Try a smaller PDF.' });
    }
    if (isRateLimitError(err.message)) {
      return res.status(429).json({
        error: err.message,
        retryAfterSeconds: parseRetryAfterSeconds(err.message),
      });
    }
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', async (req, res) => {
  const { system, messages, max_tokens: maxTokens } = req.body || {};
  const userText = messages?.[0]?.content;
  if (!userText || typeof userText !== 'string') {
    return res.status(400).json({ error: { message: 'No user message provided.' } });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: INTERPRET_MODEL,
          max_tokens: Number(maxTokens) || 3000,
          system: system ? String(system) : undefined,
          messages: [{ role: 'user', content: userText }],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: { message: 'API returned non-JSON: ' + raw.slice(0, 200) } });
    }

    if (response.status === 429 || isRateLimitError(data?.error?.message)) {
      const msg = data?.error?.message || 'API rate limit reached.';
      return res.status(429).json({
        error: { message: msg },
        retryAfterSeconds: parseRetryAfterSeconds(msg),
      });
    }

    if (data.error) {
      const msg = typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : data.error;
      console.error('[messages] Anthropic error:', msg);
      return res.status(500).json({ error: { message: msg } });
    }

    if (!data.content || !Array.isArray(data.content)) {
      return res.status(500).json({ error: { message: 'Unexpected response from API.' } });
    }

    const text = data.content.map(b => b.text || '').join('').trim();
    if (!text) {
      return res.status(500).json({ error: { message: 'API returned empty text.' } });
    }

    res.json({ content: [{ type: 'text', text }] });
  } catch (err) {
    console.error('[messages] Error:', err.name, err.message);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: { message: 'Interpretation request timed out after 2 minutes.' } });
    }
    if (isRateLimitError(err.message)) {
      return res.status(429).json({
        error: { message: err.message },
        retryAfterSeconds: parseRetryAfterSeconds(err.message),
      });
    }
    res.status(500).json({ error: { message: err.message } });
  }
});

app.listen(PORT, () => {
  console.log(`VitalScan Extractor running at http://localhost:${PORT}`);
  console.log(`Extraction model: ${EXTRACT_MODEL}`);
  console.log(`Interpretation model: ${INTERPRET_MODEL}`);
});
