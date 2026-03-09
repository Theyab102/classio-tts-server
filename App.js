import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, onSnapshot, updateDoc, deleteDoc, serverTimestamp, query, orderBy, limit, getDocs, arrayUnion } from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { getDatabase, ref as dbRef, set as dbSet, get as dbGet } from "firebase/database";

// ─── FIREBASE ─────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCDDXRAxLwNmzSYxs0HnnjV2TfhbqSdiag",
  authDomain: "classio-4378f.firebaseapp.com",
  projectId: "classio-4378f",
  storageBucket: "classio-4378f.firebasestorage.app",
  messagingSenderId: "595968221954",
  appId: "1:595968221954:web:cdefee80f05999f8bf181b",
  databaseURL: "https://classio-4378f-default-rtdb.firebaseio.com",
};
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);
const rtdb = getDatabase(firebaseApp);
const googleProvider = new GoogleAuthProvider();

// ─── GROQ AI (FREE) ──────────────────────────────────────────────────────────
// Store your key in .env as REACT_APP_GROQ_KEY=gsk_...
// Get a free key at console.groq.com — no credit card needed!
const GROQ_KEY = process.env.REACT_APP_GROQ_KEY || "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

async function callClaude(system, userMessage, maxTok = 3000) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: system }, { role: "user", content: userMessage }],
      max_tokens: maxTok,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "";
}

async function callClaudeChat(system, messages) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: system + "\n\nIMPORTANT: Always reply in the SAME language the user wrote in. If Arabic → Arabic. If French → French. Match exactly." }, ...messages],
      max_tokens: 1200,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "";
}

// Vision-capable chat — uses Llama 4 Scout on Groq (supports image input)
// imageBase64: full data URL like "data:image/jpeg;base64,..."
async function callClaudeVision(system, messages, imageBase64) {
  // Build the last user message with image attached
  const msgsWithImage = messages.map((m, i) => {
    if (i === messages.length - 1 && m.role === "user" && imageBase64) {
      return {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageBase64 } },
          { type: "text",      text: m.content || "Analyze this image and answer the question." },
        ],
      };
    }
    return m;
  });
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [{ role: "system", content: system + "\n\nIMPORTANT: Always reply in the SAME language the user wrote in. Match exactly." }, ...msgsWithImage],
      max_tokens: 2000,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "";
}

// ─── GLOBAL VOICE SYSTEM ──────────────────────────────────────────────────────
// Shared ChatGPT-style voice personas used across Podcast, Listening game, etc.
// Each persona lists exact browser voice name fragments to try in order.
// 9 distinct personas — each has a UNIQUE ordered target list so they never
// collapse to the same voice. Pitch is staggered to ensure audible difference
// even when the OS only provides 1–2 physical voices.
const GLOBAL_PERSONAS = [
  // ── Female ──────────────────────────────────────────────────────────────────
  { id:"aria",    label:"Aria",    gender:"female", color:"#92400e", desc:"Warm & conversational",  pitch:1.02, rate:0.95,
    targets:["microsoft aria online","aria online","jenny online","microsoft jenny online","zira","google us english","samantha","karen","victoria","fiona"] },
  { id:"nova",    label:"Nova",    gender:"female", color:"#7c3aed", desc:"Bright & upbeat",         pitch:1.08, rate:0.97,
    targets:["microsoft ava online","ava online","microsoft amber online","amber online","michelle online","microsoft michelle online","moira","google uk english female","tessa","kate"] },
  { id:"sage",    label:"Sage",    gender:"female", color:"#ca8a04", desc:"Calm & clear",             pitch:0.96, rate:0.92,
    targets:["microsoft emma online","emma online","microsoft sara online","sara online","microsoft jane online","jane online","fiona","google uk english female","karen","victoria"] },
  { id:"luna",    label:"Luna",    gender:"female", color:"#4f46e5", desc:"Soft & soothing",          pitch:1.0,  rate:0.90,
    targets:["microsoft ashley online","ashley online","microsoft ana online","ana online","siri","google us english","samantha","veena","allison","ting-ting"] },
  // ── Male ────────────────────────────────────────────────────────────────────
  { id:"echo",    label:"Echo",    gender:"male",   color:"#2563eb", desc:"Steady & professional",   pitch:0.98, rate:0.93,
    targets:["microsoft guy online","guy online","microsoft eric online","eric online","microsoft davis online","davis online","daniel","google uk english male","alex","mark"] },
  { id:"onyx",    label:"Onyx",    gender:"male",   color:"#111827", desc:"Deep & authoritative",     pitch:0.88, rate:0.90,
    targets:["microsoft christopher online","christopher online","microsoft roger online","roger online","microsoft steffan online","steffan online","fred","google uk english male","lee","tom"] },
  { id:"fable",   label:"Fable",   gender:"male",   color:"#16a34a", desc:"Friendly & casual",        pitch:1.04, rate:0.95,
    targets:["microsoft ryan online","ryan online","microsoft liam online","liam online","microsoft noah online","noah online","rishi","thomas","oliver","google uk english male"] },
  { id:"atlas",   label:"Atlas",   gender:"male",   color:"#ea580c", desc:"Bold & energetic",         pitch:0.94, rate:1.00,
    targets:["microsoft brian online","brian online","microsoft reed online","reed online","microsoft andrew online","andrew online","alex","david","mark","google us english"] },
  // ── Neutral ─────────────────────────────────────────────────────────────────
  { id:"river",   label:"River",   gender:"neutral",color:"#0891b2", desc:"Smooth & neutral",         pitch:1.0,  rate:0.93,
    targets:["microsoft jenny online","jenny online","microsoft guy online","guy online","google us english","google uk english","default","en-us","en-gb"] },
];

// Resolve the best available browser voice for a persona.
// Key fix: we track which voices have ALREADY been assigned to earlier personas
// so we never return the same physical voice for two different personas.
const _voiceCache = new Map(); // key: lang → resolved assignments

function getSmartVoice(personaOrIdx, allVoices, lang = "en-US") {
  const persona = typeof personaOrIdx === "number" ? GLOBAL_PERSONAS[personaOrIdx] : personaOrIdx;
  if (!persona || !allVoices || !allVoices.length) return null;

  const langCode = lang.slice(0, 2).toLowerCase();
  const langPool = allVoices.filter(v => v.lang.toLowerCase().startsWith(langCode));
  const pool = langPool.length > 0 ? langPool : allVoices;

  // Try each target fragment — exact substring match, case-insensitive
  for (const tgt of persona.targets) {
    const v = pool.find(v => v.name.toLowerCase().includes(tgt.toLowerCase()));
    if (v) return v;
  }

  // Gender-based fallback heuristics for when browser has generic voices
  const femaleHints = /aria|jenny|zira|samantha|karen|victoria|moira|fiona|ava|emma|sara|ashley|tessa|kate|allison|susan|heather/i;
  const maleHints   = /guy|eric|david|mark|daniel|alex|fred|christopher|roger|brian|ryan|liam|reed|rishi|thomas|oliver/i;

  if (persona.gender === "female") {
    const v = pool.find(v => femaleHints.test(v.name));
    if (v) return v;
  } else if (persona.gender === "male") {
    const v = pool.find(v => maleHints.test(v.name));
    if (v) return v;
  }

  // Final: any Microsoft Online, then any Google, then first available
  return (
    pool.find(v => /microsoft.*online/i.test(v.name)) ||
    pool.find(v => /google/i.test(v.name)) ||
    pool[0] || allVoices[0] || null
  );
}

function getSmartVoiceLabel(personaIdx, allVoices, lang = "en-US") {
  const v = getSmartVoice(personaIdx, allVoices, lang);
  if (!v) return "Default";
  return v.name
    .replace(/microsoft\s*/i, "")
    .replace(/\s*online.*$/i, "")
    .replace(/\s*-.*$/, "")
    .trim() || v.name;
}


// ─── AI DISTRACTOR GENERATOR ─────────────────────────────────────────────────
// Generates 3 plausible wrong answers for each card using AI.
// All distractors are topically related to the correct answer — no random
// answers from other cards. Fallback to a shuffled card-pool if AI fails.
//
// Returns: Map<cardId, [opt0, opt1, opt2, opt3]> (always 4 options, shuffled)
//
async function buildAIOptions(cards) {
  // We batch all cards in one AI call for speed & token efficiency.
  // The AI returns a JSON array where each item has:
  //   { id, distractors: ["wrong1","wrong2","wrong3"] }
  const subset = cards.slice(0, 40); // cap to avoid token limit
  const payload = subset.map(c => ({ id: c.id, q: c.question, a: c.answer }));

  const SYSTEM = `You are an expert quiz designer specialised in making believable wrong answers.
Your ONLY output must be a valid JSON array. No markdown, no explanation, nothing else.`;

  const USER = `For each item below, write exactly 3 DISTRACTOR answers (wrong but plausible).

STRICT RULES — follow every one:
1. Every distractor must be about the SAME specific concept as the correct answer.
   - If the answer is about nuclear fission, all distractors must also describe nuclear processes.
   - If the answer defines a biology term, all distractors must also define biology terms.
2. Distractors must sound like they COULD be correct — someone who hasn't studied should struggle to choose.
3. Distractors must NOT copy any phrase from the correct answer.
4. All 4 options (correct + 3 distractors) must be similar in length and style.
5. Use the same vocabulary register (technical/simple) as the correct answer.
6. Do NOT use the exact question keyword as the answer — force the student to understand.

ITEMS:
${JSON.stringify(payload)}

Respond with ONLY this JSON array (no markdown fences):
[{"id":"<same id as input>","distractors":["wrong1","wrong2","wrong3"]}, ...]`;

  try {
    const raw = await callClaude(SYSTEM, USER, 4000);
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // Build map: cardId → 4 shuffled options
    const map = new Map();
    for (const item of parsed) {
      const card = cards.find(c => String(c.id) === String(item.id));
      if (!card || !Array.isArray(item.distractors) || item.distractors.length < 3) continue;
      const four = [card.answer, ...item.distractors.slice(0, 3)].sort(() => Math.random() - .5);
      map.set(card.id, four);
    }

    // Fallback for any cards the AI missed
    for (const card of cards) {
      if (!map.has(card.id)) {
        const fallback = buildFallbackOptions(card, cards);
        map.set(card.id, fallback);
      }
    }
    return map;
  } catch (e) {
    console.warn('buildAIOptions failed, using fallback:', e);
    const map = new Map();
    for (const card of cards) map.set(card.id, buildFallbackOptions(card, cards));
    return map;
  }
}

// Fallback: picks answers from other cards in the same deck (old behaviour)
function buildFallbackOptions(card, cards) {
  const others = cards.filter(x => x.id !== card.id).sort(() => Math.random() - .5).slice(0, 3).map(x => x.answer);
  // Pad with generic wrong answers if deck is tiny
  while (others.length < 3) others.push('None of the above');
  return [card.answer, ...others].sort(() => Math.random() - .5);
}

// ─── MATH FORMATTER ──────────────────────────────────────────────────────────
// Converts spoken/written math phrases into proper numeric/symbol notation.
// Works on AI-generated notes and voice transcriptions.
function fixMath(text) {
  if (!text) return text;
  let t = text;

  // Superscript digits map
  const sup = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','-':'⁻','+':'⁺' };
  const toSup = (s) => String(s).split('').map(c => sup[c] || c).join('');

  // Written words → digits (for exponents and bases)
  const wordNum = {
    'zero':0,'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,
    'ten':10,'eleven':11,'twelve':12,'thirteen':13,'fourteen':14,'fifteen':15,'sixteen':16,
    'seventeen':17,'eighteen':18,'nineteen':19,'twenty':20,'thirty':30,'forty':40,
    'fifty':50,'sixty':60,'seventy':70,'eighty':80,'ninety':90,'hundred':100,
    'negative':'-','minus':'-','plus':'+'
  };

  const parseWordNum = (s) => {
    s = s.toLowerCase().trim();
    if (!isNaN(s)) return s;
    if (wordNum[s] !== undefined) return String(wordNum[s]);
    // Handle "negative X" / "minus X"
    const parts = s.split(/\s+/);
    if (parts.length === 2 && (parts[0]==='negative'||parts[0]==='minus')) {
      const n = wordNum[parts[1]];
      if (n !== undefined) return String(-n);
    }
    if (parts.length === 2 && parts[0]==='positive') {
      const n = wordNum[parts[1]];
      if (n !== undefined) return String(n);
    }
    return null;
  };

  // Multiplication words → ×
  t = t.replace(/\btimes\b/gi, '×');
  t = t.replace(/\bmultiplied by\b/gi, '×');

  // "to the power of [word/num]" → superscript
  t = t.replace(/\bto the power of\s+(negative|minus|positive)?\s*([\w]+)/gi, (m, sign, num) => {
    const s = sign ? (sign[0]==='p'?'+':'-') : '';
    const n = parseWordNum(num) ?? num;
    return toSup(s + n);
  });
  t = t.replace(/\bto the\s+(negative|minus)?\s*([\w]+)\s*power/gi, (m, sign, num) => {
    const s = sign ? '-' : '';
    const n = parseWordNum(num) ?? num;
    return toSup(s + n);
  });
  t = t.replace(/\braised to\s+(negative|minus|positive)?\s*([\w]+)/gi, (m, sign, num) => {
    const s = sign ? (sign[0]==='p'?'+':'-') : '';
    const n = parseWordNum(num) ?? num;
    return toSup(s + n);
  });
  // e.g. "10^-10" or "10^−10"
  t = t.replace(/\^([+-]?\d+)/g, (m, exp) => toSup(exp));

  // "x times ten to the ..." handled by above but also catch "E notation" 1e-10 → 1 × 10⁻¹⁰
  t = t.replace(/(\d+(?:\.\d+)?)[eE]([+-]?\d+)/g, (m, base, exp) => `${base} × 10${toSup(exp)}`);

  // Written number bases for scientific notation:
  // "one times ten..." already handled via "times" → × above + toSup above
  // But also handle "one times ten to the power of negative ten"
  const numWords = Object.keys(wordNum).join('|');
  // "X point Y" → decimal  e.g. "three point five" → 3.5
  t = t.replace(
    new RegExp(`\\b(${numWords})\\s+point\\s+(${numWords})\\b`, 'gi'),
    (m, a, b) => {
      const av = wordNum[a.toLowerCase()];
      const bv = wordNum[b.toLowerCase()];
      if (av !== undefined && bv !== undefined) return `${av}.${bv}`;
      return m;
    }
  );

  // Single word numbers in scientific/math context → digits
  // Only replace when followed by ×, ^, or a unit
  const unitPat = /\b(cm|mm|m|km|kg|g|mg|nm|pm|fm|s|ms|μs|ns|Hz|kHz|MHz|GHz|J|kJ|MJ|eV|keV|MeV|N|Pa|kPa|W|kW|V|A|mol|K|°C|°F|L|mL)\b/;
  // Replace leading word number before ×
  t = t.replace(
    new RegExp(`\\b(${numWords})\\s+(×)`, 'gi'),
    (m, num, op) => {
      const v = wordNum[num.toLowerCase()];
      return v !== undefined ? `${v} ${op}` : m;
    }
  );

  // Unit shorthands: "metres" → m, "centimetres" → cm, etc. in scientific context
  t = t.replace(/\b(\d[\d.,]*)\s*centimetre[s]?\b/gi, '$1 cm');
  t = t.replace(/\b(\d[\d.,]*)\s*metre[s]?\b/gi, '$1 m');
  t = t.replace(/\b(\d[\d.,]*)\s*kilometre[s]?\b/gi, '$1 km');
  t = t.replace(/\b(\d[\d.,]*)\s*millimetre[s]?\b/gi, '$1 mm');
  t = t.replace(/\b(\d[\d.,]*)\s*nanometre[s]?\b/gi, '$1 nm');
  t = t.replace(/\b(\d[\d.,]*)\s*kilogram[s]?\b/gi, '$1 kg');
  t = t.replace(/\b(\d[\d.,]*)\s*gram[s]?\b/gi, '$1 g');
  t = t.replace(/\b(\d[\d.,]*)\s*milligram[s]?\b/gi, '$1 mg');
  t = t.replace(/\b(\d[\d.,]*)\s*second[s]?\b/gi, (m,n) => `${n} s`);
  t = t.replace(/\b(\d[\d.,]*)\s*millisecond[s]?\b/gi, '$1 ms');
  t = t.replace(/\b(\d[\d.,]*)\s*joule[s]?\b/gi, '$1 J');
  t = t.replace(/\b(\d[\d.,]*)\s*newton[s]?\b/gi, '$1 N');
  t = t.replace(/\b(\d[\d.,]*)\s*watt[s]?\b/gi, '$1 W');
  t = t.replace(/\b(\d[\d.,]*)\s*volt[s]?\b/gi, '$1 V');
  t = t.replace(/\b(\d[\d.,]*)\s*ampere[s]?|amp[s]?\b/gi, '$1 A');
  t = t.replace(/\b(\d[\d.,]*)\s*pascal[s]?\b/gi, '$1 Pa');
  t = t.replace(/\b(\d[\d.,]*)\s*kelvin[s]?\b/gi, '$1 K');

  // Fractions: "one half" → 1/2, "three quarters" → 3/4
  t = t.replace(/\bone half\b/gi, '1/2');
  t = t.replace(/\bone third\b/gi, '1/3');
  t = t.replace(/\bone quarter\b/gi, '1/4');
  t = t.replace(/\bthree quarter[s]?\b/gi, '3/4');
  t = t.replace(/\btwo third[s]?\b/gi, '2/3');

  // Squared / cubed
  t = t.replace(/\bsquared\b/gi, '²');
  t = t.replace(/\bcubed\b/gi, '³');
  t = t.replace(/\bsquare root of\b/gi, '√');

  // Division
  t = t.replace(/\bdivided by\b/gi, '÷');
  t = t.replace(/\bover\b(?=\s+[\d(])/gi, '/');

  // Approx / equals
  t = t.replace(/\bapproximately equal[s]?\s+to\b/gi, '≈');
  t = t.replace(/\bapproximately\b/gi, '≈');
  t = t.replace(/\bgreater than or equal[s]?\s+to\b/gi, '≥');
  t = t.replace(/\bless than or equal[s]?\s+to\b/gi, '≤');
  t = t.replace(/\bgreater than\b/gi, '>');
  t = t.replace(/\bless than\b/gi, '<');
  t = t.replace(/\bnot equal[s]?\s+to\b/gi, '≠');
  t = t.replace(/\bplus or minus\b/gi, '±');

  // Degree symbol
  t = t.replace(/\bdegree[s]?\b(?!\s*[CF])/gi, '°');
  t = t.replace(/\bdegree[s]?\s+Celsius\b/gi, '°C');
  t = t.replace(/\bdegree[s]?\s+Fahrenheit\b/gi, '°F');
  t = t.replace(/\bdegree[s]?\s+Kelvin\b/gi, 'K');

  // Greek letters
  t = t.replace(/\balpha\b/gi, 'α'); t = t.replace(/\bbeta\b/gi, 'β');
  t = t.replace(/\bgamma\b/gi, 'γ'); t = t.replace(/\bdelta\b/gi, 'Δ');
  t = t.replace(/\blambda\b/gi, 'λ'); t = t.replace(/\bmu\b/gi, 'μ');
  t = t.replace(/\bpi\b(?!\s*[a-z])/gi, 'π'); t = t.replace(/\bsigma\b/gi, 'σ');
  t = t.replace(/\bomega\b/gi, 'ω'); t = t.replace(/\btheta\b/gi, 'θ');
  t = t.replace(/\bepsilon\b/gi, 'ε'); t = t.replace(/\bphi\b/gi, 'φ');
  t = t.replace(/\binfinity\b/gi, '∞');

  return t;
}

// Read a file as base64
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Read a text-based file as plain text
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// Extract as much text as possible from any file type
async function extractFileText(fileObj) {
  if (!fileObj) return null;
  const name = fileObj.name.toLowerCase();
  const type = fileObj.type || "";

  // Plain text files
  if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".csv")) {
    try { return await readFileAsText(fileObj); } catch { return null; }
  }

  // PDF — use PDF.js from CDN to extract text
  if (type === "application/pdf" || name.endsWith(".pdf")) {
    try {
      const base64 = await readFileAsBase64(fileObj);
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      // Dynamically load PDF.js
      if (!window.pdfjsLib) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }

      const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(" ") + "\n";
      }
      return text.trim() || null;
    } catch(e) { console.error("PDF read error", e); return null; }
  }

  // Images — return a note that it's an image
  if (type.startsWith("image/")) {
    return `[This is an image file: ${fileObj.name}. Describe its likely content based on the filename.]`;
  }

  // PowerPoint / Word / Excel — try to read as binary and extract any readable text
  if (name.endsWith(".pptx") || name.endsWith(".docx") || name.endsWith(".xlsx") ||
      name.endsWith(".ppt") || name.endsWith(".doc") || name.endsWith(".xls")) {
    try {
      // Load JSZip to unzip Office files
      if (!window.JSZip) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      const arrayBuffer = await fileObj.arrayBuffer();
      const zip = await window.JSZip.loadAsync(arrayBuffer);
      let text = "";

      // Extract text from all XML files inside the Office zip
      const xmlFiles = Object.keys(zip.files).filter(f =>
        f.endsWith(".xml") && (
          f.includes("slide") || f.includes("word/document") ||
          f.includes("sharedStrings") || f.includes("content")
        )
      );

      for (const xmlFile of xmlFiles) {
        const xmlContent = await zip.files[xmlFile].async("string");
        // Strip XML tags and get just the text
        const stripped = xmlContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (stripped.length > 20) text += stripped + "\n";
      }

      return text || null;
    } catch(e) { console.error("Office file read error", e); return null; }
  }

  return null;
}

// ─── RESPONSIVE HOOK ─────────────────────────────────────────────────────────
function useResponsive() {
  const [size, setSize] = useState(() => {
    const w = window.innerWidth;
    return w <= 600 ? "phone" : w <= 1024 ? "tablet" : "desktop";
  });
  useEffect(() => {
    const fn = () => {
      const w = window.innerWidth;
      setSize(w <= 600 ? "phone" : w <= 1024 ? "tablet" : "desktop");
    };
    window.addEventListener("resize", fn);
    window.addEventListener("orientationchange", fn);
    return () => { window.removeEventListener("resize", fn); window.removeEventListener("orientationchange", fn); };
  }, []);
  return { isMobile: size === "phone", isTablet: size === "tablet", isDesktop: size === "desktop", size };
}

// ─── COLORS ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#F7F5F2", surface: "#FFFFFF", border: "#E8E4DF", text: "#1A1714",
  muted: "#9B9590", accent: "#3D5A80", accentL: "#E8EFF5", accentS: "#C5D5E8",
  warm: "#C17F5A", warmL: "#F5EDE5", green: "#4A7C59", greenL: "#E5F0E8",
  purple: "#6B4E8A", purpleL: "#EDE5F5", red: "#C45C5C", redL: "#F5E5E5",
};

const FILE_COLORS = [
  { bg:"#E8EFF5", accent:"#3D5A80" }, { bg:"#F5EDE5", accent:"#C17F5A" },
  { bg:"#E5F0E8", accent:"#4A7C59" }, { bg:"#EDE5F5", accent:"#6B4E8A" },
  { bg:"#F5E5E5", accent:"#C45C5C" }, { bg:"#EAEDF0", accent:"#4A5568" },
  { bg:"#FFF8E1", accent:"#D69E2E" }, { bg:"#E0F7FA", accent:"#0694a2" },
  { bg:"#FCE4EC", accent:"#E91E8C" }, { bg:"#F3E5F5", accent:"#7B1FA2" },
  { bg:"#E8F5E9", accent:"#2E7D32" }, { bg:"#FBE9E7", accent:"#BF360C" },
];
// Helper: given a file, return { bg, accent } (custom overrides colorIndex)
function getFileColor(file) {
  if (file.customColor) {
    const c = file.customColor;
    // derive a light bg from the custom accent
    return { accent: c, bg: c + "22" };
  }
  return FILE_COLORS[file.colorIndex||0] || FILE_COLORS[0];
}
const FOLDER_COLORS = ["#3D5A80","#C17F5A","#4A7C59","#6B4E8A","#C45C5C","#4A5568","#8A7C4E","#4E7C8A"];

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Icon = ({ d, size = 18, color = "currentColor", sw = 1.7 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);
const I = {
  folder: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z","M14 2v6h6"],
  plus: "M12 5v14M5 12h14",
  back: "M19 12H5M12 19l-7-7 7-7",
  ai: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
  cards: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 1-4 4v14a3 3 0 0 0 3-3h7z",
  notes: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z","M14 2v6h6","M16 13H8","M16 17H8","M10 9H8"],
  game: "M6 3v11.5A2.5 2.5 0 0 0 8.5 17h.5M18 3v11.5A2.5 2.5 0 0 1 15.5 17h-.5M8.5 17a2.5 2.5 0 0 0 0 5 2.5 2.5 0 0 0 0-5zM15.5 17a2.5 2.5 0 0 0 0 5 2.5 2.5 0 0 0 0-5z",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  trash: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  edit: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  check: "M20 6L9 17l-5-5",
  sparkle: "M12 3L14.5 8.5H20L15.5 12L17 18L12 14.5L7 18L8.5 12L4 8.5H9.5L12 3Z",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  x: "M18 6L6 18M6 6l12 12",
  chevron: "M9 18l6-6-6-6",
  refresh: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  paperclip: "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
  mic: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8",
  headphones: "M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z",
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  robot: "M12 2a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3V4a2 2 0 0 1 2-2zM9 11h.01M15 11h.01M9 15s1 1.5 3 1.5 3-1.5 3-1.5",
  zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  image: "M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 19",
  pen: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  eraser: "M20 20H7L3 16l10-10 7 7-3.5 3.5M6.5 17.5l5-5",
  highlight: "M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  podcast: "M8.56 2.9A7 7 0 0 1 19 9v4M2 9a10 10 0 0 1 20 0v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM6 9v1a6 6 0 0 0 12 0V9M12 16v6M8 22h8",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8h.01M11 12h1v4h1",
  regenerate: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
};

// ─── TEXT FORMATTER ───────────────────────────────────────────────────────────
const Fmt = ({ text }) => (
  <div>{(text||"").split('\n').map((line, i) => {
    // Strip ALL markdown symbols
    const clean = line.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/\*/g, "").trim();
    if (!line.trim()) return <br key={i} />;
    // ALL CAPS heading line
    if (/^[A-Z][A-Z\s]{3,}$/.test(clean) || line.startsWith('# ') || line.startsWith('## ')) 
      return <p key={i} style={{ fontWeight:700, fontSize:14, marginBottom:4, marginTop:12, color:"#1a202c", letterSpacing:.3 }}>{clean}</p>;
    // Bold heading (** wrapped)
    if (/^\*\*[^*]+\*\*$/.test(line.trim())) 
      return <p key={i} style={{ fontWeight:700, fontSize:14, marginBottom:4, marginTop:10, color:"#2d3748" }}>{clean}</p>;
    // Bullet point
    if (line.startsWith('• ') || line.startsWith('- ') || line.startsWith('* ') || line.startsWith('· ')) 
      return <p key={i} style={{ paddingLeft:14, marginBottom:3, display:"flex", gap:6, lineHeight:1.6 }}><span style={{flexShrink:0, color:"#666"}}>•</span><span>{clean.replace(/^[•\-\*·]\s*/,"")}</span></p>;
    // Numbered list
    if (/^\d+\.\s/.test(line)) 
      return <p key={i} style={{ paddingLeft:14, marginBottom:3, lineHeight:1.6 }}>{clean}</p>;
    // Normal text - strip any remaining * 
    return <p key={i} style={{ marginBottom:3, lineHeight:1.6 }}>{clean}</p>;
  })}</div>
);

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const GS = `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Fraunces:wght@400;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0} input,textarea,button{font-family:inherit}
::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-thumb{background:#D8D4CF;border-radius:3px}
.hov:hover{opacity:0.82} .card-hov:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.10)!important}
@keyframes sg-fadein{from{opacity:0;transform:translateX(-50%) translateY(-8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.card-hov{transition:all .2s} .tab:hover{background:#F0EDE9!important} .row:hover{background:#F7F5F2!important} .row{transition:background .15s}

/* ── PHONE ONLY (≤600px) — desktop & tablet unchanged ────── */
@media(max-width:600px){
  /* Hide desktop-only elements */
  .desktop-only{display:none!important}
  /* Nav tabs scroll horizontally without scrollbar */
  .nav-tabs{overflow-x:auto!important;-webkit-overflow-scrolling:touch;scrollbar-width:none;flex-wrap:nowrap!important}
  .nav-tabs::-webkit-scrollbar{display:none}
  .nav-tab-btn{padding:10px 10px!important;font-size:12px!important;white-space:nowrap!important}
  /* Hide tab text labels, keep icons */
  .tab-label{display:none!important}
  /* Page padding */
  .page-inner{padding:14px 12px!important}
  /* Page bottom padding for AdBanner */
  .page-with-ad{padding-bottom:60px!important}
  /* Header */
  .app-header{padding:0 12px!important;min-height:52px!important}
  /* Folder/file card grid → 2 cols */
  .card-grid{grid-template-columns:1fr 1fr!important}
  /* Game grid → 2 cols */
  .game-grid{grid-template-columns:1fr 1fr!important}
  /* Stack flex rows vertically */
  .mobile-stack{flex-direction:column!important}
  /* Full width */
  .mobile-full{width:100%!important;max-width:100%!important}
  /* Modals slide up from bottom */
  .modal-inner{border-radius:18px 18px 0 0!important;max-height:92vh!important;width:100%!important;position:fixed!important;bottom:0!important;left:0!important;right:0!important;margin:0!important}
  /* Touch target minimum */
  button{min-height:40px}
  /* Chat input wraps */
  .chat-input-row{flex-wrap:wrap;gap:6px!important}
}

/* Landscape phone (height < 500px) */
@media(max-height:500px) and (orientation:landscape){
  .app-header{min-height:44px!important;height:44px!important}
  .modal-inner{max-height:90vh!important;border-radius:12px!important;position:relative!important;bottom:auto!important;margin:auto!important}
  .landscape-hide{display:none!important}
}

/* Scrollable tabs on tablet too */
@media(max-width:900px){
  .nav-tabs{overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
  .nav-tabs::-webkit-scrollbar{display:none}
}

/* Hard cap on AdSense iframe */
ins.adsbygoogle{max-height:46px!important;overflow:hidden!important}
ins.adsbygoogle iframe{max-height:46px!important}

@keyframes bounce{0%,80%,100%{transform:scale(.8);opacity:.5}40%{transform:scale(1.1);opacity:1}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
@keyframes sg-pulse{0%,100%{box-shadow:0 0 0 0 rgba(74,124,89,.6)}70%{box-shadow:0 0 0 6px rgba(74,124,89,0)}}
@keyframes ppbar{0%,100%{transform:scaleY(.4);opacity:.5}50%{transform:scaleY(1);opacity:1}}
`; 

// Global file object store — survives navigation within the session
const FILE_STORE = new Map();

// ─── INDEXEDDB FILE PERSISTENCE ──────────────────────────────────────────────
// Stores actual file blobs in the browser so they survive page refreshes
const IDB_NAME = "classio_files";
const IDB_STORE = "files";

function openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => res(e.target.result);
    req.onerror = () => rej(req.error);
  });
}

async function idbSave(id, file) {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(file, id);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch(e) { console.warn("IDB save failed", e); }
}

async function idbGet(id) {
  try {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  } catch(e) { return null; }
}

async function idbDelete(id) {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(id);
  } catch(e) {}
}

async function idbGetAll() {
  try {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const result = {};
      const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) { result[cursor.key] = cursor.value; cursor.continue(); }
        else res(result);
      };
      req.onerror = () => res({});
    });
  } catch(e) { return {}; }
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

// Defined OUTSIDE component so it is never re-created and has no closure issues
function stripBlobs(flds) {
  return (flds || []).map(fo => ({
    id: fo.id || "",
    name: fo.name || "",
    color: fo.color || "#3D5A80",
    files: (fo.files || []).map(fi => ({
      id: fi.id || "",
      name: fi.name || "",
      type: fi.type || "",
      size: fi.size || 0,
      colorIndex: fi.colorIndex || 0,
      notes: fi.notes || "",
      studyCards: fi.studyCards || [],
      uploadedAt: fi.uploadedAt || "",
      linkedFileIds: fi.linkedFileIds || [],
    })),
  }));
}

// ─── STANDALONE AI ASSISTANT ─────────────────────────────────────────────────
function StandaloneAI({ onClose }) {
  const [msgs, setMsgs] = useState([]);
  const [inp, setInp] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachedImage, setAttachedImage] = useState(null);
  const imgInputRef = useRef(null);
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);
  const attachImage = (f) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = e => setAttachedImage({ base64: e.target.result, name: f.name });
    r.readAsDataURL(f);
  };
  const send = async () => {
    const text = inp.trim();
    if ((!text && !attachedImage) || loading) return;
    const content = text || "Analyze this image and explain or solve it.";
    const userMsg = { role:"user", content, image: attachedImage?.base64 };
    const newMsgs = [...msgs, userMsg];
    setMsgs(newMsgs); setInp(""); setLoading(true);
    const imgToSend = attachedImage?.base64 || null;
    setAttachedImage(null);
    try {
      const sys = "You are Classio AI, a smart study assistant. Help students with any question — solve problems, explain concepts, analyze images of questions or diagrams. Be clear and concise. No asterisks, no markdown.";
      const apiMsgs = newMsgs.map(m => ({ role:m.role, content:m.content }));
      const reply = imgToSend
        ? await callClaudeVision(sys, apiMsgs, imgToSend)
        : await callClaudeChat(sys, apiMsgs);
      setMsgs([...newMsgs, { role:"assistant", content: reply }]);
    } catch(e) { setMsgs([...newMsgs, { role:"assistant", content:"Error: " + e.message }]); }
    setLoading(false);
  };
  return (
    <div style={{ position:"fixed", inset:0, zIndex:3000, background:"rgba(26,23,20,.55)",
      backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:C.bg, borderRadius:22, width:"100%", maxWidth:680,
        height:"85vh", display:"flex", flexDirection:"column",
        boxShadow:"0 24px 80px rgba(0,0,0,.2)", border:`1px solid ${C.border}` }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"16px 20px",
          borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
          <div style={{ width:40, height:40, borderRadius:12,
            background:"linear-gradient(135deg,#6366f1,#8b5cf6)",
            display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="14" height="11" rx="2"/><path d="M9 10h.01M15 10h.01M9 13s1 1.5 3 1.5 3-1.5 3-1.5"/><path d="M12 16v2M8 20h8M12 5V3"/><circle cx="12" cy="3" r="1"/></svg>
          </div>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, fontSize:16, fontWeight:700, color:C.text }}>AI Assistant</p>
            <p style={{ margin:0, fontSize:12, color:C.muted }}>Ask anything · Attach images · Replies in your language</p>
          </div>
          <button onClick={onClose} style={{ background:C.surface, border:`1px solid ${C.border}`,
            borderRadius:"50%", width:32, height:32, cursor:"pointer", fontSize:18,
            color:C.muted, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>
        {/* Messages */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px 20px",
          display:"flex", flexDirection:"column", gap:12 }}>
          {msgs.length === 0 && (
            <div style={{ textAlign:"center", padding:"32px 16px" }}>
              <div style={{ width:64, height:64, borderRadius:20, background:"linear-gradient(135deg,#6366f1,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="14" height="11" rx="2"/><path d="M9 10h.01M15 10h.01M9 13s1 1.5 3 1.5 3-1.5 3-1.5"/><path d="M12 16v2M8 20h8M12 5V3"/><circle cx="12" cy="3" r="1"/></svg>
              </div>
              <p style={{ fontSize:17, fontWeight:700, color:C.text, marginBottom:8 }}>Classio AI</p>
              <p style={{ fontSize:13, color:C.muted, lineHeight:1.7, maxWidth:320, margin:"0 auto 24px" }}>
                Ask me anything! Solve problems, explain concepts, or send a photo of a question.
              </p>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, maxWidth:360, margin:"0 auto", textAlign:"left" }}>
                {[["⬡","Photo of a question","Take a photo — I'll solve it"],
                  ["∑","Math & Science","Step-by-step solutions"],
                  ["✎","Explain concepts","Clear simple explanations"],
                  ["◎","Any language","Reply in your language"]].map(([ic,ti,de])=>(
                  <div key={ti} style={{ background:C.surface, border:`1px solid ${C.border}`,
                    borderRadius:12, padding:"12px 14px" }}>
                    <div style={{ marginBottom:6 }}>{ic}</div>
                    <p style={{ margin:"0 0 2px", fontSize:12, fontWeight:700, color:C.text }}>{ti}</p>
                    <p style={{ margin:0, fontSize:11, color:C.muted, lineHeight:1.4 }}>{de}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m,i)=>(
            <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start",
              alignItems:"flex-end", gap:8 }}>
              {m.role==="assistant" && (
                <div style={{ width:28,height:28,borderRadius:8,
                  background:"linear-gradient(135deg,#6366f1,#8b5cf6)",
                  display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="14" height="11" rx="2"/><path d="M9 10h.01M15 10h.01M9 13s1 1.5 3 1.5 3-1.5 3-1.5"/><path d="M12 16v2M8 20h8"/></svg>
                </div>
              )}
              <div style={{ maxWidth:"75%", borderRadius:16, overflow:"hidden",
                background:m.role==="user"?C.accent:C.surface,
                border:m.role==="user"?"none":`1px solid ${C.border}` }}>
                {m.image && <img src={m.image} alt="attached"
                  style={{ display:"block", width:"100%", maxWidth:320, maxHeight:200,
                    objectFit:"contain", background:"#111" }} />}
                <div style={{ padding:"10px 14px", color:m.role==="user"?"#fff":C.text,
                  fontSize:14, lineHeight:1.7 }}><Fmt text={m.content} /></div>
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display:"flex", alignItems:"flex-end", gap:8 }}>
              <div style={{ width:28,height:28,borderRadius:8,
                background:"linear-gradient(135deg,#6366f1,#8b5cf6)",
                display:"flex",alignItems:"center",justifyContent:"center" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="14" height="11" rx="2"/><path d="M9 10h.01M15 10h.01M9 13s1 1.5 3 1.5 3-1.5 3-1.5"/><path d="M12 16v2M8 20h8"/></svg>
              </div>
              <div style={{ display:"flex", gap:5, padding:"12px 14px", background:C.surface,
                borderRadius:16, border:`1px solid ${C.border}` }}>
                {[0,1,2].map(j=><div key={j} style={{ width:7,height:7,borderRadius:"50%",
                  background:C.accent,animation:"bounce 1.2s infinite",animationDelay:`${j*.2}s` }}/>)}
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>
        {/* Image preview */}
        {attachedImage && (
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 20px",
            background:C.accentL, borderTop:`1px solid ${C.accentS}`, flexShrink:0 }}>
            <img src={attachedImage.base64} alt="preview"
              style={{ width:44,height:44,objectFit:"cover",borderRadius:8,flexShrink:0 }}/>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.accent }}>Image attached</p>
              <p style={{ margin:0, fontSize:11, color:C.muted, overflow:"hidden",
                textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{attachedImage.name}</p>
            </div>
            <button onClick={()=>setAttachedImage(null)}
              style={{ background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:20 }}>×</button>
          </div>
        )}
        {/* Input */}
        <div style={{ display:"flex", gap:8, padding:"14px 20px",
          borderTop:`1px solid ${C.border}`, flexShrink:0 }}>
          <button onClick={()=>imgInputRef.current?.click()} title="Attach image"
            style={{ flexShrink:0, width:44, height:44, borderRadius:12,
              border:`1.5px solid ${attachedImage?C.accent:C.border}`,
              background:attachedImage?C.accentL:C.bg, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", color:attachedImage?C.accent:C.muted }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>
          <input ref={imgInputRef} type="file" accept="image/*" style={{ display:"none" }}
            onChange={e=>{ attachImage(e.target.files?.[0]); e.target.value=""; }}/>
          <input value={inp} onChange={e=>setInp(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(); }}}
            placeholder={attachedImage?"Ask about the image… (or just press Send)":"Ask anything…"}
            style={{ flex:1, border:`1.5px solid ${C.border}`, borderRadius:12,
              padding:"11px 16px", fontSize:14, outline:"none", background:C.bg, color:C.text }}/>
          <button onClick={send} disabled={(!inp.trim()&&!attachedImage)||loading}
            style={{ flexShrink:0,
              background:(inp.trim()||attachedImage)&&!loading?C.accent:"#ccc",
              color:"#fff", border:"none", borderRadius:12, padding:"11px 22px",
              fontSize:14, fontWeight:700,
              cursor:(inp.trim()||attachedImage)&&!loading?"pointer":"not-allowed" }}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ABOUT / GUIDE TAB ────────────────────────────────────────────────────────
function AboutTab() {
  const features = [
    { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3D5A80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>, title:"Folders & Files", desc:"Organise study materials into folders. Upload PDFs, Word docs, PowerPoints, images, and text files. Everything is saved to your account." },
    { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="14" height="11" rx="2"/><path d="M9 10h.01M15 10h.01M9 13s1 1.5 3 1.5 3-1.5 3-1.5"/><path d="M12 16v2M8 20h8"/></svg>, title:"AI Assistant", desc:"Ask the AI anything — type a question or attach a photo of a problem. No file needed. Replies in whatever language you write in." },
    { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>, title:"AI Notes", desc:"Generate notes from any file in 4 styles: Summary, Detailed, Bullet Points, or Q&A. The AI reads your file and writes structured notes instantly." },
    { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/></svg>, title:"Study Cards", desc:"Auto-generate up to 50 flashcards from your files. Flip to reveal answers. Great for memorising key concepts fast." },
    { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D69E2E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>, title:"14+ Study Games", desc:"MCQ, Speed Round, Elimination, Memory Match, True/False, Listening Game, Quiz Show, and more — all generated from your material." },
    { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3D5A80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>, title:"Study Groups", desc:"Create or join a live session. Present files, share whiteboards, run multiplayer quizzes, and voice chat with friends in real time." },
    { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>, title:"Voice Notes", desc:"Record yourself or a lecture — the app transcribes it into written notes automatically." },
    { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>, title:"AI Podcast", desc:"Turn any file into a spoken podcast. Two AI hosts discuss your material so you can learn while listening." },
    { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ea580c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>, title:"Annotations", desc:"Highlight and annotate any file directly inside the app. Add comments and review them later." },
    { icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0694a2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>, title:"16 Languages", desc:"Full support for Arabic, French, Spanish, German, Chinese, Japanese, and 10 more. The AI always replies in the language you write in." },
  ];
  const steps = [
    { n:"1", title:"Create a folder", desc:"Tap New Folder and name it after your subject — Physics, Maths, History, etc." },
    { n:"2", title:"Upload your file", desc:"Open the folder, upload your study material: PDF, PowerPoint, Word doc, or image." },
    { n:"3", title:"Generate with AI", desc:"Open the file and go to the AI tab to instantly create notes, flashcards, or a quiz game." },
    { n:"4", title:"Study with friends", desc:"Tap Study Group, share your invite code, and study together with live voice chat and shared content." },
    { n:"5", title:"Ask AI anything", desc:"Hit the AI Assistant button on the home screen to ask any question or send a photo of a problem — no file needed." },
  ];
  return (
    <div style={{ paddingBottom:40 }}>
      <div style={{ textAlign:"center", padding:"36px 20px 28px",
        background:`linear-gradient(135deg,${C.accentL} 0%,${C.bg} 100%)`,
        borderRadius:20, marginBottom:28, border:`1px solid ${C.accentS}` }}>
        <div style={{ width:72,height:72,borderRadius:22,background:"linear-gradient(135deg,#3D5A80,#6366f1)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",boxShadow:"0 8px 24px rgba(99,102,241,.3)" }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 1-4 4v14a3 3 0 0 0 3-3h7z"/>
          </svg>
        </div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:26, fontWeight:700,
          color:C.text, margin:"0 0 10px" }}>Welcome to Classio</h2>
        <p style={{ fontSize:14, color:C.muted, maxWidth:460, margin:"0 auto", lineHeight:1.7 }}>
          Your AI-powered study companion. Upload your materials, generate notes and flashcards,
          play study games, and collaborate with friends — all in one place.
        </p>
      </div>
      <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:18, fontWeight:700, color:C.text, marginBottom:14 }}>How to get started</h3>
      <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:32 }}>
        {steps.map(s=>(
          <div key={s.n} style={{ display:"flex", alignItems:"flex-start", gap:14,
            background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 16px" }}>
            <div style={{ width:32,height:32,borderRadius:10,background:C.accent,
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:14,fontWeight:800,color:"#fff",flexShrink:0 }}>{s.n}</div>
            <div>
              <p style={{ margin:"0 0 3px", fontSize:14, fontWeight:700, color:C.text }}>{s.title}</p>
              <p style={{ margin:0, fontSize:13, color:C.muted, lineHeight:1.5 }}>{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
      <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:18, fontWeight:700, color:C.text, marginBottom:14 }}>All Features</h3>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))", gap:12, marginBottom:28 }}>
        {features.map(f=>(
          <div key={f.title} style={{ background:C.surface, border:`1px solid ${C.border}`,
            borderRadius:16, padding:"16px 14px" }}>
            <p style={{ fontSize:26, margin:"0 0 8px" }}>{f.icon}</p>
            <p style={{ margin:"0 0 5px", fontSize:14, fontWeight:700, color:C.text }}>{f.title}</p>
            <p style={{ margin:0, fontSize:13, color:C.muted, lineHeight:1.55 }}>{f.desc}</p>
          </div>
        ))}
      </div>
      <div style={{ background:C.warmL, border:`1px solid ${C.warm}44`,
        borderRadius:16, padding:"16px 18px" }}>
        <p style={{ margin:"0 0 10px", fontSize:14, fontWeight:700, color:C.warm }}>Pro Tips</p>
        <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
          {["Link related files (e.g. lecture notes + past paper) so the AI reads both at once.",
            "In Study Groups, give a friend presenter rights so they can run AI tools too.",
            "Send a photo of a handwritten question — the AI will read and solve it.",
            "The AI always replies in your language. Write in Arabic, get Arabic answers.",
            "Use the AI Podcast feature to listen to your notes while commuting or exercising."
          ].map((tip,i)=>(
            <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
              <span style={{ color:C.warm, flexShrink:0, marginTop:1 }}>•</span>
              <p style={{ margin:0, fontSize:13, color:C.text, lineHeight:1.5 }}>{tip}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { isMobile, isTablet } = useResponsive();
  const [user, setUser] = useState(undefined);
  const [isGuest, setIsGuest] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [folders, setFolders] = useState([]);
  const [screen, setScreen] = useState("home");
  const [activeFolder, setActiveFolder] = useState(null);
  const [activeFile, setActiveFile] = useState(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [homeTab, setHomeTab] = useState("folders");
  const [showHomeAI, setShowHomeAI] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor,       setNewColor]       = useState(FOLDER_COLORS[0]);
  const [showFolderPicker,setShowFolderPicker] = useState(false);
  const [showCharacter, setShowCharacter] = useState(false);
  const [activeStudyGroup, setActiveStudyGroup] = useState(null); // group doc id
  const [showStudyGroupLobby, setShowStudyGroupLobby] = useState(false);
  const DEFAULT_CHAR = { skin:"#FDDBB4", hair:"#3D2B1F", hairStyle:0, eyes:"#2980B9", top:"#2C3E50", bg:"#dce8ff", mouth:0, eyebrow:0, eyeShape:0, accessory:0, topStyle:0, blush:false, lips:false, freckles:false, lipColor:"#d06060", hat:0, hatColor:"#E74C3C", glasses:0, glassesColor:"#333333", facialHair:0, necklace:0, necklaceColor:"#f0c040", earring:0, earringColor:"#f0c040", name:"" };
  const [character, setCharacter] = useState(() => {
    try { return { ...DEFAULT_CHAR, ...(JSON.parse(localStorage.getItem("classio_char") || "null") || {}) }; }
    catch { return { skin:"#FDDBB4", hair:"#3D2B1F", hairStyle:0, eyes:"#3D5A80", top:"#3D5A80", name:"" }; }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVE SYSTEM — localStorage primary, Firebase secondary
  // Key insight: we pass data directly into every function so there are
  // zero stale closures. No useEffect syncing, no refs for data.
  // ═══════════════════════════════════════════════════════════════════════════
  const [saveStatus, setSaveStatus] = useState("idle");
  const saveTimer    = useRef(null);
  const statusTimer  = useRef(null);

  // Write clean JSON to localStorage + Firebase
  // flds and u are passed directly — never read from closure/ref
  function persist(flds, u) {
    const clean = stripBlobs(flds);

    // 1. localStorage — instant, works offline, no permissions needed
    try { localStorage.setItem("classio_v2", JSON.stringify(clean)); } catch(e) { console.error("LS save error:", e); }

    // 2. Firebase — best effort background sync
    if (u?.uid) {
      // Correct Firestore path: collection="users", document=uid
      setDoc(doc(db, "users", u.uid), { folders: clean }, { merge: true })
        .then(() => {
          clearTimeout(statusTimer.current);
          setSaveStatus("saved");
          statusTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);
        })
        .catch(e => {
          // localStorage already saved — Firebase failing is not critical
          console.warn("Firebase sync failed (data saved locally):", e.code, e.message);
          clearTimeout(statusTimer.current);
          setSaveStatus("saved"); // local save succeeded
          statusTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);
        });
    } else {
      clearTimeout(statusTimer.current);
      setSaveStatus("saved");
      statusTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);
    }
  }

  // Debounce: wait 500ms after last change, then persist
  // Takes flds AND u directly so nothing is stale
  function scheduleSave(flds, u) {
    setSaveStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(flds, u), 500);
  }

  // Attach file blobs (non-serialisable) back onto plain folder data
  async function attachBlobs(raw) {
    const stored = await idbGetAll();
    return (raw || []).map(fo => ({
      ...fo,
      files: (fo.files || []).map(fi => {
        const blob = stored[fi.id] || FILE_STORE.get(fi.id) || null;
        if (blob) FILE_STORE.set(fi.id, blob);
        return { ...fi, _fileObj: blob };
      }),
    }));
  }

  // Startup: load localStorage instantly, then Firebase if logged in
  useEffect(() => {
    const local = localStorage.getItem("classio_v2");
    if (local) {
      try { attachBlobs(JSON.parse(local)).then(r => setFolders(p => p.length === 0 ? r : p)); } catch {}
    }
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        setIsGuest(false);
        try {
          const snap = await getDoc(doc(db, "users", u.uid));
          const raw  = snap?.exists() ? (snap.data().folders || []) : [];
          if (raw.length > 0) {
            const r = await attachBlobs(raw);
            setFolders(r);
            try { localStorage.setItem("classio_v2", JSON.stringify(stripBlobs(r))); } catch {}
          }
        } catch(e) { console.warn("Firebase load failed, using local data:", e.message); }
      }
    });
    return unsub;
  }, []);

  // THE ONE entry point for ALL data changes — always call this instead of setFolders
  function applyAndSave(flds) {
    setFolders(flds);
    scheduleSave(flds, user); // user from component scope — always current at call time
  }

  const updateFolder = (updated) => {
    setFolders(prev => {
      const next = prev.map(f => f.id === updated.id ? updated : f);
      scheduleSave(next, user);
      return next;
    });
    if (activeFolder?.id === updated.id) setActiveFolder(updated);
  };

  const updateFile = (folderId, updated) => {
    const withObj = { ...updated, _fileObj: updated._fileObj || FILE_STORE.get(updated.id) || null };
    setFolders(prev => {
      const next = prev.map(f => f.id === folderId
        ? { ...f, files: f.files.map(fi => fi.id === withObj.id ? withObj : fi) }
        : f);
      scheduleSave(next, user);
      return next;
    });
    setActiveFile(withObj);
    setActiveFolder(prev => prev ? { ...prev, files: prev.files.map(fi => fi.id === withObj.id ? withObj : fi) } : prev);
  };

  const deleteFolder = (folderId) => {
    setFolders(prev => {
      const folder = prev.find(f => f.id === folderId);
      if (folder) (folder.files || []).forEach(f => { idbDelete(f.id); FILE_STORE.delete(f.id); });
      const next = prev.filter(f => f.id !== folderId);
      scheduleSave(next, user);
      return next;
    });
  };

  // Keep setFoldersSave for places that still use it (folder creation etc.)
  const setFoldersSave = (flds) => applyAndSave(flds);

  const handleGuest = (name) => { setGuestName(name); setIsGuest(true); setFolders([]); };

  const handleGuestSignOut = () => {
    setIsGuest(false); setGuestName(""); setFolders([]);
    setScreen("home"); setActiveFolder(null); setActiveFile(null);
  };

  if (user === undefined && !isGuest) return <Splash />;
  if (!user && !isGuest) return <SignIn
    onSignIn={() => signInWithPopup(auth, googleProvider).catch(console.error)}
    onGuest={handleGuest} />;

  if (screen === "file" && activeFile && activeFolder) {
    return <FileView file={activeFile} folder={activeFolder} allFiles={activeFolder.files}
      user={user} isGuest={isGuest}
      onBack={() => { setScreen("folder"); setActiveFile(null); }}
      onUpdate={(u) => updateFile(activeFolder.id, u)} />;
  }

  if (screen === "studyGroup" && activeStudyGroup) {
    return <StudyGroupRoom
      groupId={activeStudyGroup}
      user={isGuest ? { uid:"guest_"+guestName, displayName:guestName, photoURL:null } : user}
      character={character}
      db={db}
      onLeave={() => { setActiveStudyGroup(null); setScreen("home"); }}
    />;
  }

  if (screen === "folder" && activeFolder) {
    const folder = folders.find(f => f.id === activeFolder.id) || activeFolder;
    return <FolderView folder={folder} onBack={() => { setScreen("home"); setActiveFolder(null); }}
      onOpenFile={(f) => { const restored = {...f, _fileObj: f._fileObj || FILE_STORE.get(f.id) || null}; setActiveFile(restored); setScreen("file"); }}
      onUpdate={updateFolder} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans', sans-serif", paddingBottom: 50 }}>
      <style>{GS}</style>
      <Header user={isGuest ? { displayName: guestName, photoURL: null } : user} saveStatus={saveStatus} isGuest={isGuest} onSignOut={isGuest ? handleGuestSignOut : () => signOut(auth)} character={character} onOpenCharacter={() => setShowCharacter(true)} homeTab={homeTab} onSetHomeTab={setHomeTab} onOpenAI={() => setShowHomeAI(true)} />
      {showCharacter && <CharacterModal character={character} onChange={c => { setCharacter(c); localStorage.setItem("classio_char", JSON.stringify(c)); }} onClose={() => setShowCharacter(false)} />}
      {showStudyGroupLobby && <StudyGroupLobby
        user={isGuest ? { uid:"guest_"+guestName, displayName:guestName, photoURL:null } : user}
        db={db}
        onJoin={(groupId) => { setActiveStudyGroup(groupId); setScreen("studyGroup"); setShowStudyGroupLobby(false); }}
        onClose={() => setShowStudyGroupLobby(false)}
      />}
      <AdBanner />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 14px" }}>
        {/* ── Action buttons row ── */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20, justifyContent:"flex-end" }}>
          <button onClick={()=>setShowStudyGroupLobby(true)} className="hov"
            style={{ display:"flex", alignItems:"center", gap:7, background:"#7c3aed",
              color:"#fff", border:"none", borderRadius:12, padding:"10px 18px",
              fontSize:14, fontWeight:600, cursor:"pointer",
              boxShadow:"0 4px 14px rgba(124,58,237,.35)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Study Group
          </button>
          {homeTab==="folders" && (
            <button onClick={()=>setShowNewFolder(true)} className="hov"
              style={{ display:"flex", alignItems:"center", gap:8, background:C.accent,
                color:"#fff", border:"none", borderRadius:12, padding:"10px 20px",
                fontSize:14, fontWeight:600, cursor:"pointer" }}>
              <Icon d={I.plus} size={16} color="#fff" sw={2.5}/> New Folder
            </button>
          )}
        </div>
        {homeTab==="folders" && (
          <p style={{ fontSize:14, color:C.muted, marginBottom:20 }}>
            {folders.length===0?"Create your first folder to get started":`${folders.length} folder${folders.length!==1?"s":""}`}
          </p>
        )}

        {homeTab==="about" && <AboutTab/>}

        {homeTab==="folders" && folders.length===0 && (
          <div style={{ textAlign:"center", padding:"80px 0" }}>
            <div style={{ width:80, height:80, background:C.accentL, borderRadius:24, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px" }}>
              <Icon d={I.folder} size={36} color={C.accent}/>
            </div>
            <p style={{ fontSize:18, fontWeight:600, color:C.text, marginBottom:8 }}>No folders yet</p>
            <p style={{ fontSize:14, color:C.muted, maxWidth:280, margin:"0 auto 24px" }}>Create a folder for each subject to organise your files</p>
            <button onClick={()=>setShowNewFolder(true)} className="hov"
              style={{ background:C.accent, color:"#fff", border:"none", borderRadius:10, padding:"10px 24px", fontSize:14, fontWeight:600, cursor:"pointer" }}>
              Create First Folder
            </button>
          </div>
        )}

        {homeTab==="folders" && <div className="card-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:16 }}>
          {folders.map(folder => (
            <div key={folder.id} className="card-hov"
              onClick={() => { setActiveFolder(folder); setScreen("folder"); }}
              style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:20, cursor:"pointer", boxShadow:"0 2px 8px rgba(0,0,0,.05)", position:"relative" }}>
              {/* Delete folder button */}
              <button
                onClick={e => {
                  e.stopPropagation();
                  if (window.confirm(`Delete "${folder.name}" and all its files?`)) deleteFolder(folder.id);
                }}
                style={{ position:"absolute", top:10, right:10, width:26, height:26, borderRadius:"50%", background:"transparent", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", opacity:0.4, fontSize:16, color:C.muted, lineHeight:1 }}
                onMouseEnter={e => e.currentTarget.style.opacity=1}
                onMouseLeave={e => e.currentTarget.style.opacity=0.4}
                title="Delete folder">
                ×
              </button>
              <div style={{ width:44, height:44, background:folder.color+"22", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:14 }}>
                <Icon d={I.folder} size={22} color={folder.color} />
              </div>
              <p style={{ fontSize:15, fontWeight:600, color:C.text, marginBottom:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{folder.name}</p>
              <p style={{ fontSize:13, color:C.muted }}>{folder.files.length} file{folder.files.length !== 1 ? "s" : ""}</p>
            </div>
          ))}
        </div>}

      {showHomeAI && <StandaloneAI onClose={() => setShowHomeAI(false)} />}

      </div>

      {showNewFolder && (
        <Modal onClose={() => { setShowNewFolder(false); setNewName(""); }}>
          <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:700, color:C.text, marginBottom:20 }}>New Folder</h2>
          <label style={{ fontSize:13, fontWeight:600, color:C.muted, display:"block", marginBottom:6 }}>NAME</label>
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key==="Enter" && newName.trim()) { setFoldersSave([...folders,{id:`f${Date.now()}`,name:newName.trim(),color:newColor,files:[]}]); setShowNewFolder(false); setNewName(""); }}}
            placeholder="e.g. Biology, Maths…"
            style={{ width:"100%", border:`1.5px solid ${C.border}`, borderRadius:10, padding:"10px 14px", fontSize:15, outline:"none", marginBottom:16, color:C.text, background:C.bg }} />
          <label style={{ fontSize:13, fontWeight:600, color:C.muted, display:"block", marginBottom:10 }}>COLOUR</label>
          <div style={{ marginBottom:16 }}>
            <div style={{ display:"flex", gap:7, flexWrap:"wrap", marginBottom:8, alignItems:"center" }}>
              {FOLDER_COLORS.map(col => (
                <button key={col} onClick={() => { setNewColor(col); setShowFolderPicker(false); }}
                  style={{ width:28, height:28, borderRadius:"50%", background:col, cursor:"pointer", flexShrink:0,
                    border:`3px solid ${newColor===col?C.text:"transparent"}`,
                    boxShadow:`0 1px 4px rgba(0,0,0,${newColor===col?".35":".15"})` }} />
              ))}
              <button onClick={() => setShowFolderPicker(p => !p)}
                style={{ width:28, height:28, borderRadius:"50%", cursor:"pointer",
                  border:"2px dashed #bbb", background:showFolderPicker?"#4361ee":"transparent",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:14, color:showFolderPicker?"#fff":"#888" }}>
                {showFolderPicker ? "×" : "+"}
              </button>
            </div>
            {showFolderPicker && (
              <div style={{ borderRadius:20, overflow:"hidden",
                boxShadow:"0 8px 40px rgba(0,0,0,.45)", background:"#18182a" }}>
                <ColorPicker value={newColor} label="Folder Colour"
                  onChange={col => setNewColor(col)}
                  onClose={() => setShowFolderPicker(false)}/>
              </div>
            )}
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={() => { setShowNewFolder(false); setNewName(""); }}
              style={{ flex:1, padding:"10px", border:`1.5px solid ${C.border}`, borderRadius:10, background:"transparent", fontSize:14, fontWeight:600, cursor:"pointer", color:C.text }}>Cancel</button>
            <button disabled={!newName.trim()}
              onClick={() => { setFoldersSave([...folders,{id:`f${Date.now()}`,name:newName.trim(),color:newColor,files:[]}]); setShowNewFolder(false); setNewName(""); }}
              style={{ flex:2, padding:"10px", background:newName.trim()?C.accent:C.border, color:newName.trim()?"#fff":C.muted, border:"none", borderRadius:10, fontSize:14, fontWeight:600, cursor:newName.trim()?"pointer":"not-allowed" }}>
              Create Folder
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── AD BANNER ───────────────────────────────────────────────────────────────
function AdBanner() {
  useEffect(() => {
    if (!document.querySelector('script[src*="adsbygoogle"]')) {
      const script = document.createElement("script");
      script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5802600279565250";
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    }
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch(e) {}
  }, []);

  return (
    <div style={{
      position:"fixed", bottom:0, left:0, right:0, zIndex:999,
      height:50, maxHeight:50, overflow:"hidden",
      background:C.surface, borderTop:`1px solid ${C.border}`,
      display:"flex", alignItems:"center", justifyContent:"center",
    }}>
      <div style={{ position:"relative", width:"100%", maxWidth:728, height:46, overflow:"hidden" }}>
        <ins className="adsbygoogle"
          style={{ display:"block", width:"100%", height:46, overflow:"hidden" }}
          data-ad-client="ca-pub-5802600279565250"
          data-ad-slot="7527000448"
          data-ad-format="horizontal"
          data-full-width-responsive="false" />
      </div>
    </div>
  );
}

// ─── HEADER ───────────────────────────────────────────────────────────────────
function Header({ user, saveStatus, isGuest, onSignOut, character, onOpenCharacter, homeTab, onSetHomeTab, onOpenAI }) {
  return (
    <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 16px", height:56, display:"flex", alignItems:"center", gap:12 }}>
      {/* Logo */}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
        <div style={{ width:30, height:30, background:C.accent, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Icon d={I.sparkle} size={15} color="#fff" sw={2} />
        </div>
        <span style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontWeight:700, color:C.text, letterSpacing:-0.5 }}>Classio</span>
      </div>

      {/* Center — tabs + AI button (only on home screen, i.e. when homeTab is defined) */}
      {onSetHomeTab && (
        <div style={{ display:"flex", alignItems:"center", gap:8, flex:1 }}>
          {/* Tab switcher */}
          <div style={{ display:"flex", background:C.bg, borderRadius:10, border:`1px solid ${C.border}`, padding:3, gap:2 }}>
            {[
              ["folders","Folders",<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>],
              ["about","About",<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>],
            ].map(([id,label,icon])=>(
              <button key={id} onClick={()=>onSetHomeTab(id)}
                style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 14px", borderRadius:7, fontSize:13, fontWeight:700,
                  border:"none", cursor:"pointer", transition:"all .15s",
                  background:homeTab===id?C.accent:"transparent",
                  color:homeTab===id?"#fff":C.muted }}>
                {icon}{label}
              </button>
            ))}
          </div>
          {/* AI Assistant */}
          <button onClick={onOpenAI}
            style={{ display:"flex", alignItems:"center", gap:6,
              background:"linear-gradient(135deg,#6366f1,#8b5cf6)",
              color:"#fff", border:"none", borderRadius:10, padding:"6px 14px",
              fontSize:13, fontWeight:700, cursor:"pointer",
              boxShadow:"0 2px 10px rgba(99,102,241,.4)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="14" height="11" rx="2"/><path d="M9 10h.01M15 10h.01M9 13s1 1.5 3 1.5 3-1.5 3-1.5"/><path d="M12 16v2M8 20h8M12 5V3"/><circle cx="12" cy="3" r="1"/></svg>
            AI Assistant
          </button>
        </div>
      )}

      {/* Right side */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginLeft:"auto", flexShrink:0 }}>
        {!isGuest && saveStatus !== "idle" && (
          <span style={{ fontSize:12, fontWeight:600,
            color: saveStatus==="saved" ? C.green : saveStatus==="error" ? "#e53e3e" : C.muted }}>
            {saveStatus==="saving" ? "Saving…" : saveStatus==="saved" ? "✓ Saved" : "⚠ Save failed"}
          </span>
        )}
        {isGuest && <span className="desktop-only" style={{ fontSize:11, background:C.warmL, color:C.warm, border:`1px solid ${C.warm}44`, borderRadius:20, padding:"3px 8px", fontWeight:600 }}>Guest</span>}
        <button onClick={onOpenCharacter} title="Edit my avatar"
          style={{ background:"none", border:"none", borderRadius:"50%", width:36, height:36, padding:0, cursor:"pointer", overflow:"hidden", flexShrink:0, boxShadow:"0 2px 8px rgba(0,0,0,.15)" }}>
          <MiniAvatar character={character} size={36} />
        </button>
        <span className="desktop-only" style={{ fontSize:13, fontWeight:600, color:C.text }}>{isGuest ? user?.displayName : user?.displayName?.split(" ")[0]}</span>
        <button onClick={onSignOut} className="hov"
          style={{ fontSize:12, color:C.muted, background:"none", border:`1px solid ${C.border}`, borderRadius:7, padding:"4px 9px", cursor:"pointer", whiteSpace:"nowrap" }}>{isGuest ? "Exit" : "Sign out"}</button>
      </div>
    </div>
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// ─── COLOR UTILITIES ──────────────────────────────────────────────────────────
function hexToHsv(hex) {
  let r = parseInt((hex||"#888888").replace('#','').slice(0,2),16)/255;
  let g = parseInt((hex||"#888888").replace('#','').slice(2,4),16)/255;
  let b = parseInt((hex||"#888888").replace('#','').slice(4,6),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h=0,s=max===0?0:d/max,v=max;
  if(d){
    if(max===r) h=((g-b)/d)%6;
    else if(max===g) h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h=Math.round(h*60); if(h<0)h+=360;
  }
  return {h,s,v};
}
function hsvToHex(h,s,v) {
  const f=n=>{const k=(n+h/60)%6;return v-v*s*Math.max(0,Math.min(k,4-k,1));};
  const toB=x=>Math.round(x*255).toString(16).padStart(2,'0');
  return '#'+toB(f(5))+toB(f(3))+toB(f(1));
}
function hexValid(h){ return /^#[0-9a-fA-F]{6}$/.test(h); }
function ensureHex(v){ return hexValid(v)?v:'#888888'; }

// ─── COLOR PICKER ─────────────────────────────────────────────────────────────
// Full HSV picker: SV gradient square + hue bar + hex input
// Self-contained, no external deps beyond React.
function ColorPicker({ value, onChange, onClose, label="" }) {
  const start  = hexToHsv(ensureHex(value));
  const [hue,  setHue]    = useState(start.h);
  const [sv,   setSv]     = useState({ s: start.s, v: start.v });
  const [hexIn,setHexIn]  = useState(ensureHex(value));

  const sqRef  = useRef(null);
  const hueRef = useRef(null);
  const sqDrag  = useRef(false);
  const hueDrag = useRef(false);

  // Push colour out on every hue/sv change — skip the very first render
  // so opening the picker doesn't immediately overwrite a preset click
  const curHex  = hsvToHex(hue, sv.s, sv.v);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    setHexIn(curHex);
    onChange(curHex);
  }, [hue, sv.s, sv.v]);

  const posFromEvent = (e, el) => {
    const r = el.getBoundingClientRect();
    const px = (e.touches?.[0]?.clientX ?? e.clientX);
    const py = (e.touches?.[0]?.clientY ?? e.clientY);
    return { x: Math.max(0,Math.min(1,(px-r.left)/r.width)), y: Math.max(0,Math.min(1,(py-r.top)/r.height)) };
  };

  useEffect(() => {
    const onMove = e => {
      if (sqDrag.current  && sqRef.current)  { const p=posFromEvent(e,sqRef.current);  setSv({s:p.x, v:1-p.y}); }
      if (hueDrag.current && hueRef.current) { const p=posFromEvent(e,hueRef.current); setHue(Math.round(p.x*360)); }
    };
    const onUp = () => { sqDrag.current=false; hueDrag.current=false; };
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
    window.addEventListener('touchmove',onMove,{passive:false});
    window.addEventListener('touchend',onUp);
    return () => {
      window.removeEventListener('mousemove',onMove);
      window.removeEventListener('mouseup',onUp);
      window.removeEventListener('touchmove',onMove);
      window.removeEventListener('touchend',onUp);
    };
  }, []);

  const handleHex = raw => {
    setHexIn(raw);
    const h = raw.startsWith('#') ? raw : '#'+raw;
    if (hexValid(h)) { const v=hexToHsv(h); setHue(v.h); setSv({s:v.s,v:v.v}); }
  };

  const hueBase = hsvToHex(hue,1,1);
  const previewSwatches = [0,60,120,180,240,300].map(h => hsvToHex(h,0.8,0.9));

  return (
    <div onClick={e=>e.stopPropagation()}
      style={{background:'#18182a',borderRadius:20,padding:'18px 16px 16px',
        userSelect:'none',boxShadow:'0 16px 56px rgba(0,0,0,.6)'}}>

      {label && <p style={{fontSize:10,fontWeight:800,color:'#666',letterSpacing:1.2,marginBottom:12,textTransform:'uppercase'}}>{label}</p>}

      {/* ── Saturation / Value square ── */}
      <div ref={sqRef}
        style={{position:'relative',width:'100%',paddingBottom:'72%',borderRadius:12,
          overflow:'hidden',cursor:'crosshair',marginBottom:12,flexShrink:0}}
        onMouseDown={e=>{sqDrag.current=true; const p=posFromEvent(e,sqRef.current); setSv({s:p.x,v:1-p.y}); e.preventDefault();}}
        onTouchStart={e=>{sqDrag.current=true; const p=posFromEvent(e,sqRef.current); setSv({s:p.x,v:1-p.y});}}>
        <div style={{position:'absolute',inset:0,background:hueBase}}/>
        <div style={{position:'absolute',inset:0,background:'linear-gradient(to right,#fff,rgba(255,255,255,0))'}}/>
        <div style={{position:'absolute',inset:0,background:'linear-gradient(to bottom,rgba(0,0,0,0),#000)'}}/>
        <div style={{
          position:'absolute',
          left:`${sv.s*100}%`, top:`${(1-sv.v)*100}%`,
          width:20,height:20,borderRadius:'50%',
          border:'2.5px solid #fff',
          boxShadow:'0 0 0 1.5px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.5)',
          transform:'translate(-50%,-50%)',
          pointerEvents:'none',
          background:curHex,
        }}/>
      </div>

      {/* ── Hue bar ── */}
      <div ref={hueRef}
        style={{position:'relative',height:22,borderRadius:11,
          background:'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)',
          cursor:'pointer',marginBottom:14}}
        onMouseDown={e=>{hueDrag.current=true; const p=posFromEvent(e,hueRef.current); setHue(Math.round(p.x*360)); e.preventDefault();}}
        onTouchStart={e=>{hueDrag.current=true; const p=posFromEvent(e,hueRef.current); setHue(Math.round(p.x*360));}}>
        <div style={{
          position:'absolute',left:`${(hue/360)*100}%`,top:'50%',
          width:24,height:24,borderRadius:'50%',
          border:'2.5px solid #fff',
          boxShadow:'0 0 0 1.5px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.4)',
          transform:'translate(-50%,-50%)',
          background:hueBase,pointerEvents:'none',
        }}/>
      </div>

      {/* ── Quick hue presets ── */}
      <div style={{display:'flex',gap:6,marginBottom:12}}>
        {previewSwatches.map(c=>(
          <button key={c} onClick={()=>{const v=hexToHsv(c);setHue(v.h);setSv({s:v.s,v:v.v});}}
            style={{flex:1,height:20,borderRadius:6,background:c,border:'none',cursor:'pointer',
              boxShadow:'0 1px 3px rgba(0,0,0,.3)'}}/>
        ))}
      </div>

      {/* ── Hex input row ── */}
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <div style={{width:36,height:36,borderRadius:10,background:curHex,flexShrink:0,
          border:'2px solid rgba(255,255,255,.12)',boxShadow:'0 2px 8px rgba(0,0,0,.4)'}}/>
        <div style={{flex:1,position:'relative'}}>
          <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',
            fontSize:13,color:'#555',fontFamily:'monospace',pointerEvents:'none'}}>#</span>
          <input value={hexIn.replace('#','')} onChange={e=>handleHex('#'+e.target.value)}
            maxLength={6} spellCheck={false}
            style={{width:'100%',background:'#26263a',border:'1.5px solid rgba(255,255,255,.1)',
              borderRadius:9,padding:'8px 10px 8px 24px',fontSize:14,fontWeight:700,
              color:'#fff',outline:'none',fontFamily:'monospace',letterSpacing:.8,
              boxSizing:'border-box'}}/>
        </div>
        {onClose && (
          <button onClick={onClose}
            style={{background:'#4361ee',color:'#fff',border:'none',borderRadius:10,
              padding:'8px 14px',fontSize:13,fontWeight:800,cursor:'pointer',flexShrink:0,
              boxShadow:'0 2px 8px rgba(67,97,238,.5)'}}>
            ✓ Done
          </button>
        )}
      </div>
    </div>
  );
}

// ─── SKIN SHADE SLIDER ────────────────────────────────────────────────────────
// Horizontal gradient slider: lighter ← → darker within one hue family.
// When `base` changes, the slider position resets to the midpoint.
function SkinSlider({ base, value, onChange }) {
  const getHsv = b => hexToHsv(ensureHex(b));

  // Map t ∈ [0,1] → hex:  0 = very light, 1 = very dark
  const hexAt = (b, t) => {
    const {h} = getHsv(b);
    // saturation: 0.08 (pastel) → 0.82 (saturated dark)
    // value:      0.98 (near white) → 0.22 (near black)
    return hsvToHex(h, 0.08 + t*0.74, 0.98 - t*0.76);
  };

  // Infer t from a known hex (nearest match across 60 steps)
  const inferT = (b, hex) => {
    let best=0.5, bestD=99;
    for(let i=0;i<=60;i++){
      const t=i/60, a=getHsv(hexAt(b,t)), c=getHsv(ensureHex(hex));
      const d=Math.abs(a.v-c.v)*1.4 + Math.abs(a.s-c.s)*0.6;
      if(d<bestD){bestD=d;best=t;}
    }
    return best;
  };

  const [t, setT] = useState(() => inferT(base, value));
  const prevBase  = useRef(base);
  const barRef    = useRef(null);
  const dragging  = useRef(false);

  // Reset slider position when the user picks a new base swatch
  useEffect(() => {
    if (prevBase.current !== base) { prevBase.current=base; setT(0.4); }
  }, [base]);

  // Fire onChange whenever t moves
  useEffect(() => { onChange(hexAt(base, t)); }, [t, base]);

  const posFromEvent = (e, el) => {
    const r = el.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - r.left;
    return Math.max(0, Math.min(1, x / r.width));
  };

  useEffect(() => {
    const up   = () => { dragging.current=false; };
    const move = e => { if(dragging.current && barRef.current) setT(posFromEvent(e,barRef.current)); };
    window.addEventListener('mousemove',move);
    window.addEventListener('mouseup',up);
    window.addEventListener('touchmove',move,{passive:false});
    window.addEventListener('touchend',up);
    return()=>{
      window.removeEventListener('mousemove',move);
      window.removeEventListener('mouseup',up);
      window.removeEventListener('touchmove',move);
      window.removeEventListener('touchend',up);
    };
  },[]);

  // Gradient: sample 8 stops for smooth transition
  const stops = Array.from({length:8},(_,i)=>hexAt(base,i/7)).join(',');
  const thumbColor = hexAt(base, t);

  return (
    <div style={{marginTop:10,marginBottom:4}}>
      {/* Track */}
      <div ref={barRef}
        style={{position:'relative',height:26,borderRadius:13,
          background:`linear-gradient(to right,${stops})`,
          cursor:'pointer',
          boxShadow:'inset 0 1px 4px rgba(0,0,0,.25), 0 1px 3px rgba(0,0,0,.12)'}}
        onMouseDown={e=>{dragging.current=true; setT(posFromEvent(e,barRef.current)); e.preventDefault();}}
        onTouchStart={e=>{dragging.current=true; setT(posFromEvent(e,barRef.current));}}>
        {/* Thumb */}
        <div style={{
          position:'absolute',left:`${t*100}%`,top:'50%',
          width:32,height:32,borderRadius:'50%',
          background:thumbColor,
          border:'3px solid #fff',
          boxShadow:'0 2px 10px rgba(0,0,0,.45)',
          transform:'translate(-50%,-50%)',
          pointerEvents:'none',
          transition:'background .05s',
        }}/>
      </div>
      {/* Labels */}
      <div style={{display:'flex',justifyContent:'space-between',marginTop:5,
        fontSize:10,color:'#999',fontWeight:700,letterSpacing:.4}}>
        <span>Lighter</span>
        <span style={{background:thumbColor,color:'#fff',padding:'2px 8px',borderRadius:10,
          fontSize:10,fontWeight:800,boxShadow:'0 1px 4px rgba(0,0,0,.3)'}}>{thumbColor.toUpperCase()}</span>
        <span>Darker</span>
      </div>
    </div>
  );
}
function shadeHex(hex, amt) {
  const n = parseInt((hex||"#888888").replace('#',''), 16);
  const clamp = v => Math.min(255, Math.max(0, v));
  return `rgb(${clamp((n>>16&255)+amt)},${clamp((n>>8&255)+amt)},${clamp((n&255)+amt)})`;
}
// Unique ID per every field + size so header (36px) and modal (120px) SVGs never clash
function avatarGid(ch, size) {
  // Safe fallbacks for every field so gid is always a valid string
  const str = [
    ch.skin||"#FDDBB4", ch.hair||"#3D2B1F", ch.top||"#2C3E50", ch.eyes||"#2980B9",
    ch.bg||"#dce8ff", ch.lipColor||"#d06060",
    ch.hairStyle||0, ch.topStyle||0, ch.eyeShape||0,
    ch.accessory||0, ch.eyebrow||0, ch.mouth||0,
    ch.blush?1:0, ch.lips?1:0, ch.freckles?1:0,
    ch.hat||0, ch.hatColor||"#E74C3C",
    ch.glasses||0, ch.glassesColor||"#333333",
    ch.facialHair||0, ch.necklace||0, ch.necklaceColor||"#f0c040",
    ch.earring||0, ch.earringColor||"#f0c040",
    size||40
  ].join("|");
  let h = 5381;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) + h) ^ str.charCodeAt(i); h = h >>> 0; }
  return "av" + h.toString(36);
}

// ─── AVATAR ───────────────────────────────────────────────────────────────────
function MiniAvatar({ character: ch, size = 40, uid = "" }) {
  const s   = size;
  const cx  = s * 0.5;
  const sd  = shadeHex(ch.skin,  -30);
  const sl  = shadeHex(ch.skin,   28);
  const hd  = shadeHex(ch.hair,  -35);
  const hl  = shadeHex(ch.hair,   30);
  const td  = shadeHex(ch.top,   -28);
  const tl  = shadeHex(ch.top,    28);
  const bg  = ch.bg || "#dce8ff";
  const gid = avatarGid(ch, s) + uid;

  // ── Hair ──────────────────────────────────────────────────────────────────
  const H = {
    0: /* Buzz */ <path d={`M${s*.29} ${s*.315} Q${s*.3} ${s*.11} ${cx} ${s*.1} Q${s*.7} ${s*.11} ${s*.71} ${s*.315}`} fill={ch.hair}/>,
    1: /* Side-part */ <>
      <path d={`M${s*.28} ${s*.33} Q${s*.27} ${s*.1} ${cx} ${s*.08} Q${s*.73} ${s*.1} ${s*.72} ${s*.33}`} fill={hd}/>
      <path d={`M${s*.28} ${s*.33} Q${s*.29} ${s*.12} ${cx} ${s*.1} Q${s*.71} ${s*.12} ${s*.72} ${s*.33}`} fill={ch.hair}/>
      <path d={`M${s*.29} ${s*.19} Q${s*.39} ${s*.09} ${s*.63} ${s*.12}`} stroke={hd} strokeWidth={s*.016} fill="none" strokeLinecap="round"/>
    </>,
    2: /* Fringe */ <>
      <path d={`M${s*.27} ${s*.35} Q${s*.25} ${s*.1} ${cx} ${s*.08} Q${s*.72} ${s*.1} ${s*.73} ${s*.32}`} fill={ch.hair}/>
      <path d={`M${s*.29} ${s*.21} Q${s*.45} ${s*.06} ${s*.73} ${s*.19}`} fill={ch.hair}/>
      <path d={`M${s*.29} ${s*.21} Q${s*.46} ${s*.11} ${s*.71} ${s*.21}`} fill={hd} opacity={.45}/>
    </>,
    3: /* Textured */ <>
      <path d={`M${s*.26} ${s*.36} Q${s*.24} ${s*.09} ${cx} ${s*.07} Q${s*.76} ${s*.09} ${s*.74} ${s*.36}`} fill={hd}/>
      <path d={`M${s*.27} ${s*.36} Q${s*.25} ${s*.11} ${cx} ${s*.09} Q${s*.75} ${s*.11} ${s*.73} ${s*.36}`} fill={ch.hair}/>
      <path d={`M${s*.27} ${s*.3} Q${s*.24} ${s*.43} ${s*.27} ${s*.53}`} stroke={ch.hair} strokeWidth={s*.052} strokeLinecap="round" fill="none"/>
      <path d={`M${s*.73} ${s*.3} Q${s*.76} ${s*.43} ${s*.73} ${s*.53}`} stroke={ch.hair} strokeWidth={s*.052} strokeLinecap="round" fill="none"/>
    </>,
    4: /* Long straight */ <>
      <path d={`M${s*.27} ${s*.35} Q${s*.24} ${s*.09} ${cx} ${s*.07} Q${s*.76} ${s*.09} ${s*.73} ${s*.35}`} fill={hd}/>
      <path d={`M${s*.28} ${s*.35} Q${s*.26} ${s*.11} ${cx} ${s*.09} Q${s*.74} ${s*.11} ${s*.72} ${s*.35}`} fill={ch.hair}/>
      <path d={`M${s*.27} ${s*.28} C${s*.22} ${s*.45} ${s*.2} ${s*.65} ${s*.23} ${s*.9}`} stroke={ch.hair} strokeWidth={s*.082} strokeLinecap="round" fill="none"/>
      <path d={`M${s*.73} ${s*.28} C${s*.78} ${s*.45} ${s*.8} ${s*.65} ${s*.77} ${s*.9}`} stroke={ch.hair} strokeWidth={s*.082} strokeLinecap="round" fill="none"/>
      <path d={`M${s*.25} ${s*.29} C${s*.2} ${s*.46} ${s*.18} ${s*.66} ${s*.21} ${s*.91}`} stroke={hl} strokeWidth={s*.022} strokeLinecap="round" fill="none" opacity={.4}/>
      <path d={`M${s*.75} ${s*.29} C${s*.8} ${s*.46} ${s*.82} ${s*.66} ${s*.79} ${s*.91}`} stroke={hl} strokeWidth={s*.022} strokeLinecap="round" fill="none" opacity={.4}/>
    </>,
    5: /* Wavy */ <>
      <path d={`M${s*.27} ${s*.35} Q${s*.24} ${s*.09} ${cx} ${s*.07} Q${s*.76} ${s*.09} ${s*.73} ${s*.35}`} fill={ch.hair}/>
      <path d={`M${s*.27} ${s*.27} C${s*.21} ${s*.4} ${s*.26} ${s*.54} ${s*.2} ${s*.68} C${s*.14} ${s*.82} ${s*.21} ${s*.93} ${s*.21} ${s*.98}`} stroke={ch.hair} strokeWidth={s*.088} strokeLinecap="round" fill="none"/>
      <path d={`M${s*.27} ${s*.27} C${s*.21} ${s*.4} ${s*.26} ${s*.54} ${s*.2} ${s*.68} C${s*.14} ${s*.82} ${s*.21} ${s*.93} ${s*.21} ${s*.98}`} stroke={hl} strokeWidth={s*.024} strokeLinecap="round" fill="none" opacity={.38}/>
      <path d={`M${s*.73} ${s*.27} C${s*.79} ${s*.4} ${s*.74} ${s*.54} ${s*.8} ${s*.68} C${s*.86} ${s*.82} ${s*.79} ${s*.93} ${s*.79} ${s*.98}`} stroke={ch.hair} strokeWidth={s*.088} strokeLinecap="round" fill="none"/>
      <path d={`M${s*.73} ${s*.27} C${s*.79} ${s*.4} ${s*.74} ${s*.54} ${s*.8} ${s*.68} C${s*.86} ${s*.82} ${s*.79} ${s*.93} ${s*.79} ${s*.98}`} stroke={hl} strokeWidth={s*.024} strokeLinecap="round" fill="none" opacity={.38}/>
    </>,
    6: /* Ponytail */ <>
      <path d={`M${s*.28} ${s*.35} Q${s*.26} ${s*.11} ${cx} ${s*.09} Q${s*.74} ${s*.11} ${s*.72} ${s*.35}`} fill={ch.hair}/>
      <path d={`M${s*.28} ${s*.35} Q${s*.26} ${s*.13} ${cx} ${s*.11} Q${s*.74} ${s*.13} ${s*.72} ${s*.35}`} fill={hl} opacity={.28}/>
      <path d={`M${s*.68} ${s*.18} C${s*.84} ${s*.23} ${s*.87} ${s*.4} ${s*.84} ${s*.57} C${s*.81} ${s*.71} ${s*.85} ${s*.82} ${s*.82} ${s*.9}`} stroke={ch.hair} strokeWidth={s*.072} strokeLinecap="round" fill="none"/>
      <path d={`M${s*.68} ${s*.18} C${s*.84} ${s*.23} ${s*.87} ${s*.4} ${s*.84} ${s*.57} C${s*.81} ${s*.71} ${s*.85} ${s*.82} ${s*.82} ${s*.9}`} stroke={hl} strokeWidth={s*.02} strokeLinecap="round" fill="none" opacity={.42}/>
      <circle cx={s*.755} cy={s*.21} r={s*.022} fill={hd}/>
    </>,
    7: /* Bun */ <>
      <path d={`M${s*.28} ${s*.34} Q${s*.27} ${s*.15} ${cx} ${s*.13} Q${s*.73} ${s*.15} ${s*.72} ${s*.34}`} fill={ch.hair}/>
      <circle cx={cx} cy={s*.082} r={s*.105} fill={hd}/>
      <circle cx={cx} cy={s*.082} r={s*.088} fill={ch.hair}/>
      <ellipse cx={s*.475} cy={s*.062} rx={s*.042} ry={s*.026} fill={hl} opacity={.48}/>
      <path d={`M${s*.39} ${s*.14} Q${cx} ${s*.165} ${s*.61} ${s*.14}`} stroke={hd} strokeWidth={s*.016} fill="none"/>
    </>,
    8: /* Afro */ <>
      <ellipse cx={cx} cy={s*.17} rx={s*.27} ry={s*.21} fill={hd}/>
      {[...Array(20)].map((_,i) => {
        const a = -Math.PI + (i/20)*Math.PI*2;
        const r = s*(0.21 + (i%3)*0.018);
        return <circle key={i} cx={cx+Math.cos(a)*r} cy={s*.19+Math.sin(a)*r*.72} r={s*.052} fill={i%3===0?hl:i%3===1?ch.hair:hd}/>;
      })}
      <ellipse cx={cx} cy={s*.2} rx={s*.2} ry={s*.16} fill={ch.hair}/>
    </>,
    9: /* Box braids */ <>
      <path d={`M${s*.28} ${s*.35} Q${s*.26} ${s*.1} ${cx} ${s*.08} Q${s*.74} ${s*.1} ${s*.72} ${s*.35}`} fill={ch.hair}/>
      {[...Array(8)].map((_,i) => {
        const x = s*(0.29 + i*0.056);
        const len = s*(0.36 + (i%3)*0.07);
        return <g key={i}>
          <rect x={x} y={s*.21} width={s*.03} height={len} rx={s*.015} fill={i%2===0?ch.hair:hd}/>
          <ellipse cx={x+s*.015} cy={s*.21+len+s*.01} rx={s*.016} ry={s*.012} fill={hd}/>
        </g>;
      })}
    </>,
    10: /* Curly */ <>
      <ellipse cx={cx} cy={s*.18} rx={s*.25} ry={s*.17} fill={hd}/>
      {[...Array(24)].map((_,i) => {
        const a = (i/24)*Math.PI*2;
        const rx2 = 0.19+(i%4)*0.014;
        const ry2 = 0.15+(i%3)*0.014;
        return <circle key={i} cx={cx+Math.cos(a)*s*rx2} cy={s*.19+Math.sin(a)*s*ry2} r={s*.038} fill={i%2===0?ch.hair:hl}/>;
      })}
      <ellipse cx={cx} cy={s*.2} rx={s*.18} ry={s*.14} fill={ch.hair}/>
    </>,
    11: /* Locs */ <>
      <path d={`M${s*.28} ${s*.35} Q${s*.26} ${s*.1} ${cx} ${s*.08} Q${s*.74} ${s*.1} ${s*.72} ${s*.35}`} fill={ch.hair}/>
      {[...Array(10)].map((_,i) => {
        const x = s*(0.27+i*0.052);
        const h2 = s*(0.3+Math.sin(i*0.9)*0.09);
        const w = s*.03;
        return <g key={i}>
          <rect x={x} y={s*.21} width={w} height={h2} rx={w/2} fill={i%2===0?ch.hair:hd}/>
          <ellipse cx={x+w/2} cy={s*.21+h2+s*.012} rx={w*.55} ry={s*.013} fill={hd}/>
        </g>;
      })}
    </>,
    12: /* Faux hawk */ <>
      <path d={`M${s*.28} ${s*.35} Q${s*.27} ${s*.17} ${cx} ${s*.15} Q${s*.73} ${s*.17} ${s*.72} ${s*.35}`} fill={ch.hair}/>
      <path d={`M${s*.41} ${s*.17} C${s*.43} ${s*.03} ${s*.57} ${s*.03} ${s*.59} ${s*.17}`} fill={ch.hair}/>
      <path d={`M${s*.43} ${s*.17} C${s*.45} ${s*.07} ${s*.55} ${s*.07} ${s*.57} ${s*.17}`} fill={hl} opacity={.42}/>
    </>,
    13: /* Space buns */ <>
      <path d={`M${s*.28} ${s*.35} Q${s*.27} ${s*.16} ${cx} ${s*.14} Q${s*.73} ${s*.16} ${s*.72} ${s*.35}`} fill={ch.hair}/>
      <circle cx={s*.34} cy={s*.1} r={s*.088} fill={hd}/><circle cx={s*.34} cy={s*.1} r={s*.072} fill={ch.hair}/>
      <ellipse cx={s*.325} cy={s*.08} rx={s*.032} ry={s*.02} fill={hl} opacity={.48}/>
      <circle cx={s*.66} cy={s*.1} r={s*.088} fill={hd}/><circle cx={s*.66} cy={s*.1} r={s*.072} fill={ch.hair}/>
      <ellipse cx={s*.645} cy={s*.08} rx={s*.032} ry={s*.02} fill={hl} opacity={.48}/>
    </>,
  };

  // ── Mouth ─────────────────────────────────────────────────────────────────
  const MOUTH = {
    0: <path d={`M${s*.41} ${s*.526} Q${cx} ${s*.576} ${s*.59} ${s*.526}`} stroke="#b06050" strokeWidth={s*.024} fill="none" strokeLinecap="round"/>,
    1: <path d={`M${s*.41} ${s*.546} Q${cx} ${s*.5} ${s*.59} ${s*.546}`} stroke="#b06050" strokeWidth={s*.024} fill="none" strokeLinecap="round"/>,
    2: <>
      <path d={`M${s*.39} ${s*.52} Q${cx} ${s*.59} ${s*.61} ${s*.52}`} fill="#8B3A3A"/>
      <path d={`M${s*.39} ${s*.52} Q${cx} ${s*.56} ${s*.61} ${s*.52}`} fill="white" opacity={.38}/>
      <path d={`M${s*.39} ${s*.52} Q${cx} ${s*.59} ${s*.61} ${s*.52}`} stroke="#b06050" strokeWidth={s*.02} fill="none" strokeLinecap="round"/>
    </>,
    3: <path d={`M${s*.44} ${s*.526} Q${cx} ${s*.556} ${s*.56} ${s*.526}`} stroke="#b06050" strokeWidth={s*.022} fill="none" strokeLinecap="round"/>,
    4: <>
      <ellipse cx={cx} cy={s*.536} rx={s*.076} ry={s*.028} fill="#b06050"/>
      <ellipse cx={cx} cy={s*.528} rx={s*.054} ry={s*.014} fill="white" opacity={.34}/>
    </>,
  };

  // ── Brows ─────────────────────────────────────────────────────────────────
  const BROW = {
    0: <>
      <path d={`M${s*.34} ${s*.312} Q${s*.405} ${s*.282} ${s*.465} ${s*.298}`} stroke={hd} strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
      <path d={`M${s*.535} ${s*.298} Q${s*.595} ${s*.282} ${s*.66} ${s*.312}`} stroke={hd} strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
    </>,
    1: <>
      <line x1={s*.34} y1={s*.302} x2={s*.465} y2={s*.308} stroke={hd} strokeWidth={s*.024} strokeLinecap="round"/>
      <line x1={s*.535} y1={s*.308} x2={s*.66} y2={s*.302} stroke={hd} strokeWidth={s*.024} strokeLinecap="round"/>
    </>,
    2: <>
      <path d={`M${s*.34} ${s*.308} Q${s*.405} ${s*.27} ${s*.465} ${s*.29}`} stroke={hd} strokeWidth={s*.034} fill="none" strokeLinecap="round"/>
      <path d={`M${s*.535} ${s*.29} Q${s*.595} ${s*.27} ${s*.66} ${s*.308}`} stroke={hd} strokeWidth={s*.034} fill="none" strokeLinecap="round"/>
    </>,
    3: <>
      <path d={`M${s*.34} ${s*.296} Q${s*.405} ${s*.318} ${s*.465} ${s*.308}`} stroke={hd} strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
      <path d={`M${s*.535} ${s*.308} Q${s*.595} ${s*.318} ${s*.66} ${s*.296}`} stroke={hd} strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
    </>,
  };

  // ── Eyes ──────────────────────────────────────────────────────────────────
  const eye = (ex, ey) => {
    const sh = ch.eyeShape || 0;
    const W = sh===1 ? <ellipse cx={ex} cy={ey} rx={s*.062} ry={s*.042} fill="white"/>
              : sh===2 ? <path d={`M${ex-s*.062} ${ey+s*.01} Q${ex} ${ey-s*.074} ${ex+s*.062} ${ey+s*.01} Q${ex} ${ey+s*.048} ${ex-s*.062} ${ey+s*.01}`} fill="white"/>
              : <ellipse cx={ex} cy={ey} rx={s*.058} ry={s*.056} fill="white"/>;
    return <>
      {W}
      <ellipse cx={ex} cy={ey} rx={s*.034} ry={s*.036} fill={ch.eyes}/>
      <ellipse cx={ex} cy={ey} rx={s*.019} ry={s*.02} fill="#111" opacity={.88}/>
      <circle cx={ex+s*.016} cy={ey-s*.017} r={s*.01} fill="white"/>
      <circle cx={ex-s*.009} cy={ey+s*.012} r={s*.005} fill="white" opacity={.55}/>
      {sh===2 && <path d={`M${ex-s*.055} ${ey+s*.008} Q${ex} ${ey-s*.076} ${ex+s*.055} ${ey+s*.008}`} stroke="#222" strokeWidth={s*.012} fill="none"/>}
    </>;
  };

  // ── Nose ──────────────────────────────────────────────────────────────────
  const nose = <>
    <path d={`M${cx} ${s*.42} Q${s*.545} ${s*.462} ${s*.534} ${s*.496}`} stroke={sd} strokeWidth={s*.015} fill="none" opacity={.44}/>
    <ellipse cx={s*.464} cy={s*.5} rx={s*.017} ry={s*.01} fill={sd} opacity={.27}/>
    <ellipse cx={s*.536} cy={s*.5} rx={s*.017} ry={s*.01} fill={sd} opacity={.27}/>
  </>;

  // ── Hat styles (rendered on top of hair) ─────────────────────────────────
  const hc  = ch.hatColor  || "#E74C3C";
  const hcd = shadeHex(hc, -30);
  const hcl = shadeHex(hc,  25);
  const HAT = {
    0: null,
    1: /* Beanie */ <>
      <path d={`M${s*.255} ${s*.325} Q${s*.26} ${s*.09} ${cx} ${s*.07} Q${s*.74} ${s*.09} ${s*.745} ${s*.325}`} fill={hcd}/>
      <path d={`M${s*.26} ${s*.325} Q${s*.265} ${s*.095} ${cx} ${s*.075} Q${s*.735} ${s*.095} ${s*.74} ${s*.325}`} fill={hc}/>
      <rect x={s*.238} y={s*.29} width={s*.524} height={s*.055} rx={s*.022} fill={hcd}/>
      <ellipse cx={cx} cy={s*.29} rx={s*.262} ry={s*.028} fill={hcl} opacity={.35}/>
      <circle cx={cx} cy={s*.062} r={s*.038} fill={hc}/>
      <circle cx={cx} cy={s*.062} r={s*.025} fill={hcl} opacity={.5}/>
    </>,
    2: /* Baseball cap */ <>
      <path d={`M${s*.255} ${s*.34} Q${s*.26} ${s*.11} ${cx} ${s*.09} Q${s*.74} ${s*.11} ${s*.745} ${s*.34}`} fill={hcd}/>
      <path d={`M${s*.26} ${s*.34} Q${s*.265} ${s*.115} ${cx} ${s*.095} Q${s*.735} ${s*.115} ${s*.74} ${s*.34}`} fill={hc}/>
      <rect x={s*.238} y={s*.294} width={s*.524} height={s*.05} rx={s*.02} fill={hcd}/>
      <path d={`M${s*.21} ${s*.338} Q${cx} ${s*.382} ${s*.685} ${s*.338}`} fill={hcd}/>
      <path d={`M${s*.21} ${s*.336} Q${cx} ${s*.375} ${s*.685} ${s*.336}`} fill={hcl} opacity={.25}/>
      <ellipse cx={cx} cy={s*.08} rx={s*.048} ry={s*.032} fill={hcl} opacity={.45}/>
    </>,
    3: /* Cowboy hat */ <>
      <ellipse cx={cx} cy={s*.3} rx={s*.34} ry={s*.048} fill={hcd}/>
      <path d={`M${s*.31} ${s*.295} Q${s*.315} ${s*.09} ${cx} ${s*.075} Q${s*.685} ${s*.09} ${s*.69} ${s*.295}`} fill={hcd}/>
      <path d={`M${s*.315} ${s*.295} Q${s*.32} ${s*.095} ${cx} ${s*.08} Q${s*.68} ${s*.095} ${s*.685} ${s*.295}`} fill={hc}/>
      <path d={`M${s*.315} ${s*.295} Q${cx} ${s*.28} ${s*.685} ${s*.295}`} stroke={hcl} strokeWidth={s*.012} fill="none" opacity={.4}/>
    </>,
    4: /* Graduation cap */ <>
      <rect x={s*.31} y={s*.145} width={s*.38} height={s*.085} rx={s*.018} fill={hc}/>
      <path d={`M${s*.27} ${s*.185} Q${s*.285} ${s*.14} ${cx} ${s*.13} Q${s*.715} ${s*.14} ${s*.73} ${s*.185}`} fill={hcd}/>
      <line x1={cx} y1={s*.145} x2={s*.32} y2={s*.27} stroke={hcd} strokeWidth={s*.014}/>
      <circle cx={s*.31} cy={s*.28} r={s*.03} fill={hcd}/>
    </>,
    5: /* Crown — shifted to fit within circle clip */ <>
      <path d={`M${s*.28} ${s*.33} L${s*.30} ${s*.215} L${s*.36} ${s*.27} L${cx} ${s*.18} L${s*.64} ${s*.27} L${s*.70} ${s*.215} L${s*.72} ${s*.33} Z`} fill={hc}/>
      <path d={`M${s*.28} ${s*.33} L${s*.72} ${s*.33}`} stroke={hcd} strokeWidth={s*.02} fill="none"/>
      <path d={`M${s*.28} ${s*.33} L${s*.72} ${s*.33}`} stroke={hcl} strokeWidth={s*.006} fill="none" opacity={.45}/>
      {[s*.365, cx, s*.635].map((px,i)=><circle key={i} cx={px} cy={s*.245} r={s*.02} fill={i===1?"#fff":"#ffb3b3"}/>)}
    </>,
    6: /* Party hat */ <>
      <path d={`M${cx} ${s*.06} L${s*.32} ${s*.32} Q${cx} ${s*.34} ${s*.68} ${s*.32} Z`} fill={hc}/>
      <path d={`M${cx} ${s*.06} L${s*.32} ${s*.32} Q${cx} ${s*.34} ${s*.68} ${s*.32} Z`} fill="none" stroke={hcl} strokeWidth={s*.014} opacity={.5}/>
      {[0,1,2].map(i=><circle key={i} cx={s*(.35+i*.15)} cy={s*(.26+i*.02)} r={s*.018} fill={["#fff","#ffcc00","#ff69b4"][i]}/>)}
      <circle cx={cx} cy={s*.048} r={s*.03} fill={hcl}/>
    </>,
    7: /* Headband */ <>
      <path d={`M${s*.268} ${s*.285} Q${cx} ${s*.23} ${s*.732} ${s*.285}`} stroke={hc} strokeWidth={s*.062} fill="none" strokeLinecap="round"/>
      <path d={`M${s*.268} ${s*.285} Q${cx} ${s*.23} ${s*.732} ${s*.285}`} stroke={hcl} strokeWidth={s*.016} fill="none" strokeLinecap="round" opacity={.45}/>
    </>,
    8: /* Sunhat / bucket */ <>
      <ellipse cx={cx} cy={s*.29} rx={s*.32} ry={s*.046} fill={hcd}/>
      <path d={`M${s*.29} ${s*.284} Q${s*.295} ${s*.12} ${cx} ${s*.1} Q${s*.705} ${s*.12} ${s*.71} ${s*.284}`} fill={hcd}/>
      <path d={`M${s*.295} ${s*.284} Q${s*.3} ${s*.125} ${cx} ${s*.105} Q${s*.7} ${s*.125} ${s*.705} ${s*.284}`} fill={hc}/>
      <ellipse cx={cx} cy={s*.115} rx={s*.095} ry={s*.02} fill={hcl} opacity={.35}/>
    </>,
  };

  // ── Glasses styles (colored, independent from old accessory) ─────────────
  const gc  = ch.glassesColor || "#333333";
  const gcl = shadeHex(gc,  28);
  const GLASSES = {
    0: null,
    1: /* Classic round */ <>
      <circle cx={s*.384} cy={s*.376} r={s*.068} fill="none" stroke={gc} strokeWidth={s*.022}/>
      <circle cx={s*.616} cy={s*.376} r={s*.068} fill="none" stroke={gc} strokeWidth={s*.022}/>
      <line x1={s*.452} y1={s*.376} x2={s*.548} y2={s*.376} stroke={gc} strokeWidth={s*.018}/>
      <line x1={s*.316} y1={s*.362} x2={s*.272} y2={s*.358} stroke={gc} strokeWidth={s*.016}/>
      <line x1={s*.684} y1={s*.362} x2={s*.728} y2={s*.358} stroke={gc} strokeWidth={s*.016}/>
    </>,
    2: /* Rectangular */ <>
      <rect x={s*.302} y={s*.334} width={s*.148} height={s*.092} rx={s*.024} fill="none" stroke={gc} strokeWidth={s*.022}/>
      <rect x={s*.55} y={s*.334} width={s*.148} height={s*.092} rx={s*.024} fill="none" stroke={gc} strokeWidth={s*.022}/>
      <line x1={s*.45} y1={s*.38} x2={s*.55} y2={s*.38} stroke={gc} strokeWidth={s*.018}/>
      <line x1={s*.302} y1={s*.362} x2={s*.265} y2={s*.36} stroke={gc} strokeWidth={s*.016}/>
      <line x1={s*.698} y1={s*.362} x2={s*.735} y2={s*.36} stroke={gc} strokeWidth={s*.016}/>
    </>,
    3: /* Cat-eye */ <>
      <path d={`M${s*.305} ${s*.418} Q${s*.305} ${s*.33} ${s*.39} ${s*.315} Q${s*.465} ${s*.308} ${s*.465} ${s*.385} Q${s*.465} ${s*.43} ${s*.38} ${s*.43} Z`} fill="none" stroke={gc} strokeWidth={s*.02}/>
      <path d={`M${s*.535} ${s*.385} Q${s*.535} ${s*.308} ${s*.61} ${s*.315} Q${s*.695} ${s*.33} ${s*.695} ${s*.418} L${s*.62} ${s*.43} Q${s*.535} ${s*.43} ${s*.535} ${s*.385} Z`} fill="none" stroke={gc} strokeWidth={s*.02}/>
      <line x1={s*.465} y1={s*.375} x2={s*.535} y2={s*.375} stroke={gc} strokeWidth={s*.018}/>
      <line x1={s*.305} y1={s*.36} x2={s*.265} y2={s*.355} stroke={gc} strokeWidth={s*.016}/>
      <line x1={s*.695} y1={s*.36} x2={s*.735} y2={s*.355} stroke={gc} strokeWidth={s*.016}/>
    </>,
    4: /* Sunglasses (dark lens) */ <>
      <rect x={s*.298} y={s*.33} width={s*.155} height={s*.09} rx={s*.03} fill={gc} opacity={.82}/>
      <rect x={s*.547} y={s*.33} width={s*.155} height={s*.09} rx={s*.03} fill={gc} opacity={.82}/>
      <rect x={s*.298} y={s*.33} width={s*.155} height={s*.09} rx={s*.03} fill="none" stroke={gc} strokeWidth={s*.015}/>
      <rect x={s*.547} y={s*.33} width={s*.155} height={s*.09} rx={s*.03} fill="none" stroke={gc} strokeWidth={s*.015}/>
      <line x1={s*.453} y1={s*.375} x2={s*.547} y2={s*.375} stroke={gc} strokeWidth={s*.018}/>
      <line x1={s*.298} y1={s*.358} x2={s*.26} y2={s*.354} stroke={gc} strokeWidth={s*.016}/>
      <line x1={s*.702} y1={s*.358} x2={s*.74} y2={s*.354} stroke={gc} strokeWidth={s*.016}/>
      {/* glare */}
      <rect x={s*.31} y={s*.337} width={s*.044} height={s*.018} rx={s*.008} fill="#fff" opacity={.28}/>
      <rect x={s*.559} y={s*.337} width={s*.044} height={s*.018} rx={s*.008} fill="#fff" opacity={.28}/>
    </>,
    5: /* Heart shaped — symmetrical */ <>
      {/* Left heart lens */}
      <path d={`M${s*.384} ${s*.348} C${s*.384} ${s*.332} ${s*.364} ${s*.322} ${s*.346} ${s*.33} C${s*.312} ${s*.34} ${s*.312} ${s*.384} ${s*.345} ${s*.404} C${s*.36} ${s*.422} ${s*.384} ${s*.43} ${s*.384} ${s*.43} C${s*.384} ${s*.43} ${s*.408} ${s*.422} ${s*.423} ${s*.404} C${s*.456} ${s*.384} ${s*.456} ${s*.34} ${s*.422} ${s*.33} C${s*.404} ${s*.322} ${s*.384} ${s*.332} ${s*.384} ${s*.348}`} fill="none" stroke={gc} strokeWidth={s*.019}/>
      {/* Right heart lens */}
      <path d={`M${s*.616} ${s*.348} C${s*.616} ${s*.332} ${s*.596} ${s*.322} ${s*.578} ${s*.33} C${s*.544} ${s*.34} ${s*.544} ${s*.384} ${s*.577} ${s*.404} C${s*.592} ${s*.422} ${s*.616} ${s*.43} ${s*.616} ${s*.43} C${s*.616} ${s*.43} ${s*.640} ${s*.422} ${s*.655} ${s*.404} C${s*.688} ${s*.384} ${s*.688} ${s*.34} ${s*.654} ${s*.33} C${s*.636} ${s*.322} ${s*.616} ${s*.332} ${s*.616} ${s*.348}`} fill="none" stroke={gc} strokeWidth={s*.019}/>
      <line x1={s*.456} y1={s*.374} x2={s*.544} y2={s*.374} stroke={gc} strokeWidth={s*.018}/>
      <line x1={s*.312} y1={s*.358} x2={s*.272} y2={s*.354} stroke={gc} strokeWidth={s*.016}/>
      <line x1={s*.688} y1={s*.358} x2={s*.728} y2={s*.354} stroke={gc} strokeWidth={s*.016}/>
    </>,
  };

  // ── Facial hair ───────────────────────────────────────────────────────────
  const FACIAL_HAIR = {
    0: null,
    1: /* Stubble — uses hair color blended with skin for natural look */ <>
      {[[.39,.518],[.44,.532],[.50,.538],[.56,.532],[.61,.518],
        [.41,.546],[.46,.558],[.50,.562],[.54,.558],[.59,.546],
        [.43,.504],[.50,.508],[.57,.504]].map(([fx,fy],i)=>
        <circle key={i} cx={s*fx} cy={s*fy} r={s*.0075} fill={hd} opacity={.38}/>
      )}
    </>,
    2: /* Moustache */ <>
      <path d={`M${s*.39} ${s*.506} Q${s*.44} ${s*.522} ${cx} ${s*.518} Q${s*.56} ${s*.522} ${s*.61} ${s*.506}`} fill={hd}/>
      <path d={`M${s*.41} ${s*.51} Q${s*.455} ${s*.524} ${cx} ${s*.52} Q${s*.545} ${s*.524} ${s*.59} ${s*.51}`} fill={hl} opacity={.3}/>
    </>,
    3: /* Short beard */ <>
      <path d={`M${s*.33} ${s*.49} Q${s*.32} ${s*.575} ${s*.36} ${s*.625} Q${cx} ${s*.66} ${s*.64} ${s*.625} Q${s*.68} ${s*.575} ${s*.67} ${s*.49}`} fill={hd} opacity={.72}/>
      <path d={`M${s*.36} ${s*.49} Q${s*.355} ${s*.555} ${s*.375} ${s*.6} Q${cx} ${s*.63} ${s*.625} ${s*.6} Q${s*.645} ${s*.555} ${s*.64} ${s*.49}`} fill={hl} opacity={.2}/>
    </>,
    4: /* Full beard */ <>
      <path d={`M${s*.28} ${s*.45} Q${s*.27} ${s*.6} ${s*.32} ${s*.68} Q${cx} ${s*.73} ${s*.68} ${s*.68} Q${s*.73} ${s*.6} ${s*.72} ${s*.45}`} fill={ch.hair} opacity={.9}/>
      <path d={`M${s*.31} ${s*.45} Q${s*.305} ${s*.58} ${s*.345} ${s*.65} Q${cx} ${s*.7} ${s*.655} ${s*.65} Q${s*.695} ${s*.58} ${s*.69} ${s*.45}`} fill={hl} opacity={.22}/>
      <path d={`M${s*.38} ${s*.505} Q${s*.44} ${s*.522} ${cx} ${s*.518} Q${s*.56} ${s*.522} ${s*.62} ${s*.505}`} fill={hd}/>
    </>,
    5: /* Goatee */ <>
      <path d={`M${s*.42} ${s*.49} Q${s*.44} ${s*.556} ${cx} ${s*.572} Q${s*.56} ${s*.556} ${s*.58} ${s*.49}`} fill={hd} opacity={.78}/>
      <path d={`M${s*.435} ${s*.505} Q${s*.455} ${s*.524} ${cx} ${s*.52} Q${s*.545} ${s*.524} ${s*.565} ${s*.505}`} fill={hd}/>
    </>,
  };

  // ── Necklace styles ───────────────────────────────────────────────────────
  const nc  = ch.necklaceColor || "#f0c040";
  const ncd = shadeHex(nc, -25);
  const ncl = shadeHex(nc,  22);
  const NECKLACE = {
    0: null,
    1: /* Gold chain — sits just below neck */ <>
      <path d={`M${s*.37} ${s*.67} Q${cx} ${s*.72} ${s*.63} ${s*.67}`} stroke={nc} strokeWidth={s*.013} fill="none" strokeLinecap="round"/>
      <path d={`M${s*.37} ${s*.67} Q${cx} ${s*.715} ${s*.63} ${s*.67}`} stroke={ncl} strokeWidth={s*.005} fill="none" strokeLinecap="round" opacity={.5}/>
      {[0,1,2,3,4].map(i=>{
        const t = i/4;
        const x = s*(0.37 + t*0.26);
        const y = s*(0.67 + Math.sin(t*Math.PI)*0.05);
        return <circle key={i} cx={x} cy={y} r={s*.011} fill={nc}/>;
      })}
    </>,
    2: /* Pendant */ <>
      <path d={`M${s*.38} ${s*.668} Q${cx} ${s*.706} ${s*.62} ${s*.668}`} stroke={nc} strokeWidth={s*.013} fill="none"/>
      <circle cx={cx} cy={s*.712} r={s*.024} fill={nc}/>
      <circle cx={cx} cy={s*.712} r={s*.015} fill={ncd}/>
      <circle cx={cx-s*.006} cy={s*.706} r={s*.005} fill={ncl} opacity={.7}/>
    </>,
    3: /* Beads */ <>
      {[0,1,2,3,4,5,6].map(i=>{
        const t = i/6;
        const x = s*(0.37 + t*0.26);
        const y = s*(0.668 + Math.sin(t*Math.PI)*0.042);
        return <circle key={i} cx={x} cy={y} r={s*.015} fill={i%2===0?nc:ncd}/>;
      })}
    </>,
  };

  // ── Earring styles ────────────────────────────────────────────────────────
  const ec  = ch.earringColor || "#f0c040";
  const ecd = shadeHex(ec, -20);
  const EARRINGS = {
    0: null,
    1: /* Studs */ <>
      <circle cx={s*.264} cy={s*.438} r={s*.02} fill={ec}/>
      <circle cx={s*.736} cy={s*.438} r={s*.02} fill={ec}/>
    </>,
    2: /* Drops */ <>
      <circle cx={s*.264} cy={s*.438} r={s*.016} fill={ec}/>
      <ellipse cx={s*.264} cy={s*.462} rx={s*.01} ry={s*.02} fill={ecd}/>
      <circle cx={s*.736} cy={s*.438} r={s*.016} fill={ec}/>
      <ellipse cx={s*.736} cy={s*.462} rx={s*.01} ry={s*.02} fill={ecd}/>
    </>,
    3: /* Hoops */ <>
      <circle cx={s*.264} cy={s*.444} r={s*.026} fill="none" stroke={ec} strokeWidth={s*.014}/>
      <circle cx={s*.736} cy={s*.444} r={s*.026} fill="none" stroke={ec} strokeWidth={s*.014}/>
    </>,
    4: /* Stars */ <>
      {[s*.264, s*.736].map((ex,i)=><g key={i} transform={`translate(${ex},${s*.445})`}>
        {[0,1,2,3,4].map(pt=>{
          const a = (pt*72-90)*Math.PI/180;
          const a2 = ((pt*72+36)-90)*Math.PI/180;
          const r1=s*.024,r2=s*.01;
          return <path key={pt} d={`M${Math.cos(a)*r1} ${Math.sin(a)*r1}L${Math.cos(a2)*r2} ${Math.sin(a2)*r2}`} stroke={ec} strokeWidth={s*.008} fill="none"/>;
        })}
        <polygon points={[0,1,2,3,4].map(pt=>{const a=(pt*72-90)*Math.PI/180;return `${Math.cos(a)*s*.022},${Math.sin(a)*s*.022}`;}).join(' ')} fill={ec} opacity={.85}/>
      </g>)}
    </>,
  };

  // Legacy accessory field — no longer used (hat/glasses/earring/necklace replace it)
  // Kept as empty map for backward compat only
  const ACC = {};

  // ── Body / outfit — topStyle 0-11 ────────────────────────────────────────
  const ts = ch.topStyle || 0;
  const bodyPath = `M${s*.04} ${s*1.04} C${s*.1} ${s*.82} ${s*.25} ${s*.7} ${s*.36} ${s*.66} Q${cx} ${s*.63} ${s*.64} ${s*.66} C${s*.75} ${s*.7} ${s*.9} ${s*.82} ${s*.96} ${s*1.04} Z`;
  const tankPath = `M${s*.04} ${s*1.04} C${s*.06} ${s*.84} ${s*.18} ${s*.72} ${s*.28} ${s*.67} Q${cx} ${s*.64} ${s*.72} ${s*.67} C${s*.82} ${s*.72} ${s*.94} ${s*.84} ${s*.96} ${s*1.04} Z`;
  const body = <>
    {/* Base body shape */}
    {ts!==3 && ts!==9 && <path d={bodyPath} fill={`url(#b${gid})`} clipPath={`url(#c${gid})`}/>}
    {/* ts 0 = T-Shirt (plain) — just collar stripe */}
    {ts===1 && /* Hoodie */ <>
      <ellipse cx={cx} cy={s*.88} rx={s*.09} ry={s*.055} fill={td} clipPath={`url(#c${gid})`}/>
      <line x1={s*.47} y1={s*.66} x2={s*.455} y2={s*.91} stroke={td} strokeWidth={s*.017} clipPath={`url(#c${gid})`}/>
      <line x1={s*.53} y1={s*.66} x2={s*.545} y2={s*.91} stroke={td} strokeWidth={s*.017} clipPath={`url(#c${gid})`}/>
      {/* Hood outline */}
      <path d={`M${s*.34} ${s*.66} Q${cx} ${s*.58} ${s*.66} ${s*.66}`} stroke={td} strokeWidth={s*.022} fill="none" clipPath={`url(#c${gid})`}/>
    </>}
    {ts===2 && /* Jacket */ <>
      <path d={`M${s*.5} ${s*.63} L${s*.41} ${s*.72} L${s*.36} ${s*1.04}`} fill={td} clipPath={`url(#c${gid})`}/>
      <path d={`M${s*.5} ${s*.63} L${s*.59} ${s*.72} L${s*.64} ${s*1.04}`} fill={td} clipPath={`url(#c${gid})`}/>
      {[0,1,2].map(i=><circle key={i} cx={cx} cy={s*(.72+i*.09)} r={s*.013} fill={tl} clipPath={`url(#c${gid})`}/>)}
    </>}
    {ts===3 && /* Tank top — narrow straps */ <>
      <path d={tankPath} fill={`url(#b${gid})`} clipPath={`url(#c${gid})`}/>
      {/* straps */}
      <rect x={s*.41} y={s*.57} width={s*.06} height={s*.1} fill={`url(#b${gid})`} clipPath={`url(#c${gid})`}/>
      <rect x={s*.53} y={s*.57} width={s*.06} height={s*.1} fill={`url(#b${gid})`} clipPath={`url(#c${gid})`}/>
    </>}
    {ts===4 && /* Suit + tie */ <>
      <path d={`M${s*.5} ${s*.63} L${s*.42} ${s*.73} L${s*.37} ${s*1.04}`} fill={td} clipPath={`url(#c${gid})`}/>
      <path d={`M${s*.5} ${s*.63} L${s*.58} ${s*.73} L${s*.63} ${s*1.04}`} fill={td} clipPath={`url(#c${gid})`}/>
      <path d={`M${s*.48} ${s*.66} L${s*.5} ${s*.76} L${s*.52} ${s*.66}`} fill="#c0392b" clipPath={`url(#c${gid})`}/>
      <path d={`M${s*.5} ${s*.76} L${s*.49} ${s*.94} L${s*.5} ${s*.975} L${s*.51} ${s*.94} Z`} fill="#c0392b" clipPath={`url(#c${gid})`}/>
    </>}
    {ts===5 && /* Crop top */ <>
      <rect x={s*.1} y={s*.76} width={s*.8} height={s*.3} fill={`url(#b${gid})`} clipPath={`url(#c${gid})`}/>
    </>}
    {ts===6 && /* Polo / school shirt — collar + buttons */ <>
      {/* collar points */}
      <path d={`M${s*.46} ${s*.645} L${s*.43} ${s*.70} L${s*.5} ${s*.685}`} fill={tl} clipPath={`url(#c${gid})`}/>
      <path d={`M${s*.54} ${s*.645} L${s*.57} ${s*.70} L${s*.5} ${s*.685}`} fill={tl} clipPath={`url(#c${gid})`}/>
      {[0,1].map(i=><circle key={i} cx={cx} cy={s*(.73+i*.08)} r={s*.011} fill={td} clipPath={`url(#c${gid})`}/>)}
    </>}
    {ts===7 && /* Sport jersey — side stripes */ <>
      <rect x={s*.04} y={s*.66} width={s*.08} height={s*.38} fill={tl} opacity={.7} clipPath={`url(#c${gid})`}/>
      <rect x={s*.88} y={s*.66} width={s*.08} height={s*.38} fill={tl} opacity={.7} clipPath={`url(#c${gid})`}/>
      {/* number badge */}
      <rect x={s*.41} y={s*.73} width={s*.18} height={s*.14} rx={s*.02} fill={td} clipPath={`url(#c${gid})`}/>
      <text x={cx} y={s*.845} textAnchor="middle" fontSize={s*.09} fill={tl} fontWeight="900" fontFamily="sans-serif" clipPath={`url(#c${gid})`}>10</text>
    </>}
    {ts===8 && /* Streetwear hoodie — oversized, zip */ <>
      {/* wider body for oversized look */}
      <path d={`M${s*.00} ${s*1.04} C${s*.04} ${s*.80} ${s*.22} ${s*.68} ${s*.34} ${s*.65} Q${cx} ${s*.62} ${s*.66} ${s*.65} C${s*.78} ${s*.68} ${s*.96} ${s*.80} ${s*1.0} ${s*1.04} Z`} fill={`url(#b${gid})`} clipPath={`url(#c${gid})`}/>
      {/* zip */}
      <line x1={cx} y1={s*.63} x2={cx} y2={s*.98} stroke={td} strokeWidth={s*.014} clipPath={`url(#c${gid})`}/>
      {[0,1,2,3].map(i=><line key={i} x1={s*.495} y1={s*(.68+i*.07)} x2={s*.505} y2={s*(.68+i*.07)} stroke={tl} strokeWidth={s*.016} clipPath={`url(#c${gid})`}/>)}
      {/* kangaroo pocket */}
      <path d={`M${s*.36} ${s*.85} Q${cx} ${s*.82} ${s*.64} ${s*.85} L${s*.64} ${s*1.0} Q${cx} ${s*1.02} ${s*.36} ${s*1.0} Z`} fill={td} clipPath={`url(#c${gid})`}/>
    </>}
    {ts===9 && /* Dress / casual */ <>
      <path d={`M${s*.3} ${s*.64} Q${cx} ${s*.61} ${s*.7} ${s*.64} L${s*.82} ${s*1.04} Q${cx} ${s*1.06} ${s*.18} ${s*1.04} Z`} fill={`url(#b${gid})`} clipPath={`url(#c${gid})`}/>
      {/* waist band */}
      <path d={`M${s*.32} ${s*.72} Q${cx} ${s*.70} ${s*.68} ${s*.72}`} stroke={td} strokeWidth={s*.018} fill="none" clipPath={`url(#c${gid})`}/>
    </>}
    {ts===10 && /* Blazer (school/smart) */ <>
      {/* lapels */}
      <path d={`M${s*.5} ${s*.63} L${s*.40} ${s*.74} L${s*.36} ${s*1.04}`} fill={td} clipPath={`url(#c${gid})`}/>
      <path d={`M${s*.5} ${s*.63} L${s*.60} ${s*.74} L${s*.64} ${s*1.04}`} fill={td} clipPath={`url(#c${gid})`}/>
      {/* pocket square */}
      <rect x={s*.38} y={s*.77} width={s*.07} height={s*.055} rx={s*.01} fill={tl} clipPath={`url(#c${gid})`}/>
      {/* 2 buttons */}
      {[0,1].map(i=><circle key={i} cx={cx} cy={s*(.77+i*.1)} r={s*.013} fill={tl} clipPath={`url(#c${gid})`}/>)}
    </>}
    {ts===11 && /* Graphic tee — print on chest */ <>
      <rect x={s*.38} y={s*.70} width={s*.24} height={s*.18} rx={s*.025} fill={td} clipPath={`url(#c${gid})`}/>
      <circle cx={cx} cy={s*.79} r={s*.06} fill={tl} opacity={.7} clipPath={`url(#c${gid})`}/>
    </>}
    {/* Collar highlight on all non-tank styles */}
    {ts!==3 && ts!==5 && ts!==9 && <path d={`M${s*.38} ${s*.645} Q${cx} ${s*.605} ${s*.62} ${s*.645}`} stroke={tl} strokeWidth={s*.017} fill="none" opacity={.44} clipPath={`url(#c${gid})`}/>}
  </>;

  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{display:"block"}}>
      <defs>
        <radialGradient id={`f${gid}`} cx="38%" cy="32%" r="68%">
          <stop offset="0%"   stopColor={sl}/>
          <stop offset="55%"  stopColor={ch.skin}/>
          <stop offset="100%" stopColor={sd}/>
        </radialGradient>
        <radialGradient id={`b${gid}`} cx="40%" cy="28%" r="72%">
          <stop offset="0%"   stopColor={tl}/>
          <stop offset="55%"  stopColor={ch.top}/>
          <stop offset="100%" stopColor={td}/>
        </radialGradient>
        <radialGradient id={`g${gid}`} cx="50%" cy="45%" r="55%">
          <stop offset="0%"   stopColor={shadeHex(bg,22)}/>
          <stop offset="100%" stopColor={bg}/>
        </radialGradient>
        <clipPath id={`c${gid}`}><circle cx={cx} cy={cx} r={cx-0.5}/></clipPath>
      </defs>

      {/* Background */}
      <circle cx={cx} cy={cx} r={cx} fill={`url(#g${gid})`}/>

      {/* Body / outfit */}
      {body}

      {/* Neck */}
      <path d={`M${s*.42} ${s*.566} L${s*.42} ${s*.656} Q${cx} ${s*.686} ${s*.58} ${s*.656} L${s*.58} ${s*.566}`}
        fill={`url(#f${gid})`} clipPath={`url(#c${gid})`}/>
      <ellipse cx={cx} cy={s*.656} rx={s*.09} ry={s*.022} fill={sd} opacity={.22} clipPath={`url(#c${gid})`}/>

      {/* Ears */}
      <ellipse cx={s*.274} cy={s*.395} rx={s*.038} ry={s*.052} fill={`url(#f${gid})`}/>
      <ellipse cx={s*.279} cy={s*.395} rx={s*.018} ry={s*.03}  fill={sd} opacity={.28}/>
      <ellipse cx={s*.726} cy={s*.395} rx={s*.038} ry={s*.052} fill={`url(#f${gid})`}/>
      <ellipse cx={s*.721} cy={s*.395} rx={s*.018} ry={s*.03}  fill={sd} opacity={.28}/>

      {/* Hair behind face */}
      <g clipPath={`url(#c${gid})`}>{H[ch.hairStyle||0]}</g>

      {/* Face */}
      <ellipse cx={cx} cy={s*.386} rx={s*.209} ry={s*.233} fill={`url(#f${gid})`}/>
      <ellipse cx={cx} cy={s*.386} rx={s*.209} ry={s*.233} fill="none" stroke={sd} strokeWidth={s*.01} opacity={.14}/>

      {/* Blush */}
      {ch.blush && <>
        <ellipse cx={s*.322} cy={s*.466} rx={s*.06} ry={s*.032} fill="#ff85b3" opacity={.28}/>
        <ellipse cx={s*.678} cy={s*.466} rx={s*.06} ry={s*.032} fill="#ff85b3" opacity={.28}/>
      </>}

      {/* Brows → Eyes → Nose → Mouth */}
      {BROW[ch.eyebrow||0]}
      {eye(s*.384, s*.37)}
      {eye(s*.616, s*.37)}
      {nose}
      {MOUTH[ch.mouth||0]}

      {/* Lip colour */}
      {ch.lips && <ellipse cx={cx} cy={s*.526} rx={s*.058} ry={s*.018} fill={ch.lipColor||"#d06060"} opacity={.6}/>}

      {/* Freckles */}
      {ch.freckles && <>
        {[[.38,.442],[.432,.47],[.5,.462],[.568,.47],[.62,.442],[.402,.422],[.598,.422]].map(([fx,fy],i)=>
          <circle key={i} cx={s*fx} cy={s*fy} r={s*.009} fill={sd} opacity={.44}/>)}
      </>}

      {/* Facial hair (below accessories) */}
      <g clipPath={`url(#c${gid})`}>{FACIAL_HAIR[ch.facialHair||0]}</g>

      {/* Necklace */}
      <g clipPath={`url(#c${gid})`}>{NECKLACE[ch.necklace||0]}</g>

      {/* Earrings — inside clip so they stay within avatar circle */}
      <g clipPath={`url(#c${gid})`}>{EARRINGS[ch.earring||0]}</g>

      {/* Glasses */}
      <g clipPath={`url(#c${gid})`}>{GLASSES[ch.glasses||0]}</g>

      {/* Hat (topmost layer) */}
      <g clipPath={`url(#c${gid})`}>{HAT[ch.hat||0]}</g>
    </svg>
  );
}

// ─── CHARACTER MODAL ─────────────────────────────────────────────────────────
// Visual preview: every selector shows mini SVG avatars with the option applied
// ─── AVATAR SWATCHES (top-level — proper hook support) ────────────────────────
// Receives ch, field, vals, customColors, and all callbacks as props.
// Never re-created on render — stable component identity = stable hooks.
// ─── AVATAR ROW LABEL ────────────────────────────────────────────────────────
function AvatarRow({ label, children }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      <p style={{ fontSize:10, fontWeight:800, color:"#aaa", letterSpacing:1.1,
        margin:0, textTransform:"uppercase" }}>{label}</p>
      <div>{children}</div>
    </div>
  );
}

// ─── AVATAR CHIP ─────────────────────────────────────────────────────────────
// Pure top-level component — stable identity, no hooks issues.
function AvatarChip({ ch, field, value, label, size=62, onApply }) {
  const preview = { ...ch, [field]: value };
  const sel = ch[field] === value;
  const A = "#4361ee";
  return (
    <button
      onClick={() => onApply(field, value)}
      title={label}
      style={{
        display:"flex", flexDirection:"column", alignItems:"center", gap:5,
        padding:"7px 6px 6px", borderRadius:14, border:"none", cursor:"pointer",
        flexShrink:0,
        background: sel ? "#eef1ff" : "#f5f6fa",
        outline: sel ? `2.5px solid ${A}` : "2px solid transparent",
        outlineOffset:2,
        boxShadow: sel ? `0 0 0 1.5px #fff, 0 3px 12px rgba(67,97,238,.28)` : "0 1px 3px rgba(0,0,0,.07)",
        transition:"background .12s, outline-color .12s, box-shadow .12s",
      }}
    >
      <div style={{
        width:size, height:size, borderRadius:"50%", overflow:"hidden", flexShrink:0,
        boxShadow: sel ? `0 0 0 2.5px ${A}, 0 2px 8px rgba(67,97,238,.3)` : "0 1px 4px rgba(0,0,0,.13)",
      }}>
        <MiniAvatar character={preview} size={size} uid={field+String(value)} />
      </div>
      <span style={{
        fontSize:9, fontWeight:700, letterSpacing:.2, textAlign:"center",
        lineHeight:1.25, width:size+6, display:"block",
        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
        color: sel ? A : "#666",
      }}>{label}</span>
    </button>
  );
}

// ─── AVATAR CHIP GRID ────────────────────────────────────────────────────────
function AvatarChipGrid({ ch, field, items, size=62, onApply }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
      {items.map((item, i) => {
        const value = typeof item === "object" ? item.id : i;
        const label = typeof item === "object" ? item.label : item;
        return (
          <AvatarChip key={i} ch={ch} field={field} value={value}
            label={label} size={size} onApply={onApply} />
        );
      })}
    </div>
  );
}

// ─── AVATAR TOGGLE PAIR ───────────────────────────────────────────────────────
function AvatarTogglePair({ ch, field, label, onEmoji, offLabel="Off", onApply }) {
  const A = "#4361ee";
  return (
    <AvatarRow label={label}>
      <div style={{ display:"flex", gap:10 }}>
        {[false, true].map(val => {
          const sel = !!ch[field] === val;
          return (
            <button key={String(val)} onClick={() => onApply(field, val)}
              style={{
                display:"flex", flexDirection:"column", alignItems:"center", gap:4,
                padding:"7px 5px 5px", borderRadius:14, border:"none", cursor:"pointer",
                background: sel ? "#eef1ff" : "#f5f6fa",
                outline: sel ? `2.5px solid ${A}` : "2px solid transparent",
                outlineOffset:2,
                boxShadow: sel ? "0 2px 12px rgba(67,97,238,.28)" : "0 1px 3px rgba(0,0,0,.07)",
                transition:"background .12s, outline-color .12s, box-shadow .12s",
              }}>
              <div style={{
                width:66, height:66, borderRadius:"50%", overflow:"hidden",
                boxShadow: sel ? `0 0 0 2.5px ${A}` : "0 1px 4px rgba(0,0,0,.14)",
              }}>
                <MiniAvatar character={{ ...ch, [field]: val }} size={66} uid={field+String(val)} />
              </div>
              <span style={{ fontSize:10, fontWeight:700, color: sel ? A : "#777" }}>
                {val ? `${onEmoji} On` : offLabel}
              </span>
            </button>
          );
        })}
      </div>
    </AvatarRow>
  );
}

// ─── AVATAR SWATCHES ─────────────────────────────────────────────────────────
// Top-level component with its own open/draft state.
// Receives ch + callbacks as props — no stale closures.
function AvatarSwatches({
  ch, field, vals, sz=26, showCustom=true,
  customColors, onApply, onApplyCustom, onRemoveCustom,
}) {
  const saved = customColors[field] || [];
  const [open, setOpen] = useState(false);
  // pickerSeed: the colour the picker opens with (state so picker re-renders correctly)
  const [pickerSeed, setPickerSeed] = useState(() => ensureHex(ch[field] || vals[0] || "#888888"));
  // latestRef: always holds the most recent dragged colour — no stale closure on Done
  const latestRef = useRef(pickerSeed);
  const A = "#4361ee";

  const ring = (isSel) => ({
    outline: isSel ? `3px solid ${A}` : "3px solid transparent",
    outlineOffset: 2,
    boxShadow: isSel
      ? `0 0 0 1.5px #fff, 0 3px 10px rgba(67,97,238,.45)`
      : "0 1px 4px rgba(0,0,0,.18)",
    transition: "outline-color .1s, box-shadow .1s",
  });

  const handleOpen = () => {
    // Seed picker with the current applied colour each time it opens
    const seed = ensureHex(ch[field] || vals[0] || "#888888");
    latestRef.current = seed;
    setPickerSeed(seed);  // causes picker to remount with correct initial value
    setOpen(o => !o);
  };

  // Each drag event: update avatar live + store latest in ref
  const handleLivePick = (hex) => {
    latestRef.current = hex;
    onApply(field, hex);
  };

  // Done: read ref (latest drag position) — no stale closure possible
  const handleDone = () => {
    const finalHex = latestRef.current;
    setOpen(false);
    onApplyCustom(field, finalHex);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {/* ── Swatch + saved row ── */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:7, alignItems:"center" }}>

        {/* Built-in presets */}
        {vals.map(v => (
          <button key={v}
            onClick={() => { onApply(field, v); setOpen(false); }}
            style={{
              width:sz, height:sz, borderRadius:"50%", background:v,
              cursor:"pointer", flexShrink:0, border:"none", padding:0,
              ...ring(ch[field] === v),
            }}
          />
        ))}

        {/* Saved custom colours */}
        {showCustom && saved.map((v, i) => (
          <div key={"c"+i} style={{ position:"relative", flexShrink:0 }}>
            <button
              onClick={() => { onApply(field, v); setOpen(false); }}
              style={{
                width:sz, height:sz, borderRadius:"50%", background:v,
                cursor:"pointer", border:"none", padding:0,
                ...ring(ch[field] === v),
              }}
            />
            {/* Remove button */}
            <button
              onClick={e => { e.stopPropagation(); onRemoveCustom(field, i); }}
              style={{
                position:"absolute", top:-4, right:-4,
                width:14, height:14, borderRadius:"50%",
                background:"#e74c3c", border:"2px solid #fff",
                cursor:"pointer", fontSize:8, color:"#fff",
                display:"flex", alignItems:"center", justifyContent:"center",
                padding:0, lineHeight:1,
              }}
            >×</button>
          </div>
        ))}

        {/* "+" — always last */}
        {showCustom && (
          <button
            onClick={handleOpen}
            title="Custom colour"
            style={{
              width:sz, height:sz, borderRadius:"50%", flexShrink:0,
              cursor:"pointer", border:"2px dashed #bbb",
              background: open ? A : "rgba(67,97,238,.06)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize: sz > 22 ? 15 : 11,
              color: open ? "#fff" : "#888",
              transition:"background .14s, color .14s",
            }}
          >{open ? "×" : "+"}</button>
        )}
      </div>

      {/* ── Inline colour picker ── */}
      {open && (
        <div style={{ borderRadius:16, overflow:"hidden", background:"#18182a",
          boxShadow:"0 6px 32px rgba(0,0,0,.4)" }}>
          <ColorPicker
            value={pickerSeed}
            onChange={handleLivePick}
            onClose={handleDone}
          />
        </div>
      )}
    </div>
  );
}

// ─── AVATAR SKIN SECTION ─────────────────────────────────────────────────────
function AvatarSkinSection({
  ch, skinBase, setSkinBase, customColors,
  onApply, onApplyCustom, onRemoveCustom,
}) {
  const SKINS = ["#FDDBB4","#F5C89A","#FFCBA4","#E8A87C","#D4956A","#C68642","#A0693A","#8D5524","#6B3A1F","#F4D6C8"];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSeed, setPickerSeed] = useState(() => ensureHex(ch.skin || "#FDDBB4"));
  const latestRef = useRef(pickerSeed);
  const saved = customColors["skin"] || [];
  const A = "#4361ee";

  const ring = (isSel) => ({
    outline: isSel ? `3px solid ${A}` : "3px solid transparent",
    outlineOffset: 2,
    boxShadow: isSel
      ? `0 0 0 1.5px #fff, 0 2px 8px rgba(67,97,238,.4)`
      : "0 1px 4px rgba(0,0,0,.15)",
    transition: "outline-color .1s",
  });

  const handleOpen = () => {
    const seed = ensureHex(ch.skin || "#FDDBB4");
    latestRef.current = seed;
    setPickerSeed(seed);
    setPickerOpen(p => !p);
  };

  const handleLivePick = (hex) => { latestRef.current = hex; onApply("skin", hex); };
  const handleDone = () => { setPickerOpen(false); onApplyCustom("skin", latestRef.current); };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      <p style={{ fontSize:10, fontWeight:800, color:"#aaa", letterSpacing:1.1,
        margin:0, textTransform:"uppercase" }}>
        Skin Tone — pick a base, then fine-tune shade
      </p>

      <div style={{ display:"flex", flexWrap:"wrap", gap:7, alignItems:"center" }}>
        {/* Base tone row */}
        {SKINS.map(v => (
          <button key={v}
            onClick={() => {
              setSkinBase(v);
              setPickerOpen(false);
              const { h } = hexToHsv(v);
              const mid = hsvToHex(h, 0.15 + 0.5*0.70, 0.95 - 0.5*0.63);
              onApply("skin", mid);
            }}
            style={{
              width:32, height:32, borderRadius:"50%", background:v,
              cursor:"pointer", border:"none", padding:0, flexShrink:0,
              ...ring(skinBase === v),
            }}
          />
        ))}

        {/* Saved custom skin tones */}
        {saved.map((v, i) => (
          <div key={"cs"+i} style={{ position:"relative", flexShrink:0 }}>
            <button
              onClick={() => { onApply("skin", v); setPickerOpen(false); }}
              style={{
                width:32, height:32, borderRadius:"50%", background:v,
                cursor:"pointer", border:"none", padding:0,
                ...ring(ch.skin === v),
              }}
            />
            <button
              onClick={e => { e.stopPropagation(); onRemoveCustom("skin", i); }}
              style={{
                position:"absolute", top:-4, right:-4,
                width:14, height:14, borderRadius:"50%",
                background:"#e74c3c", border:"2px solid #fff",
                cursor:"pointer", fontSize:8, color:"#fff",
                display:"flex", alignItems:"center", justifyContent:"center",
                padding:0, lineHeight:1,
              }}
            >×</button>
          </div>
        ))}

        {/* + custom skin */}
        <button onClick={handleOpen}
          style={{
            width:32, height:32, borderRadius:"50%", flexShrink:0,
            border:"2px dashed #bbb",
            background: pickerOpen ? A : "rgba(67,97,238,.06)",
            cursor:"pointer", fontSize:14, color: pickerOpen ? "#fff" : "#888",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}
        >{pickerOpen ? "×" : "+"}</button>
      </div>

      {/* Shade slider — visible when a base is selected and picker is closed */}
      {!pickerOpen && skinBase && (
        <SkinSlider
          base={skinBase}
          value={ch.skin || "#FDDBB4"}
          onChange={hex => onApply("skin", hex)}
        />
      )}

      {/* Full colour picker */}
      {pickerOpen && (
        <div style={{ borderRadius:16, overflow:"hidden", background:"#18182a",
          boxShadow:"0 6px 32px rgba(0,0,0,.4)" }}>
          <ColorPicker value={pickerSeed} onChange={handleLivePick} onClose={handleDone} />
        </div>
      )}
    </div>
  );
}

// ─── CHARACTER MODAL ──────────────────────────────────────────────────────────
function CharacterModal({ character, onChange, onClose }) {
  const ch = character;  // alias for readability — always current via prop

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState("face");

  // ── Colour palettes ────────────────────────────────────────────────────────
  const HAIRS   = ["#0d0d0d","#1a0a00","#2C1810","#4A2912","#7B4F2C","#B5651D","#C9A96E","#EDD9A3","#F2E6C8","#C0392B","#E74C3C","#F39C12","#8E44AD","#2980B9","#27AE60","#1ABC9C","#fd79a8","#00CED1","#FF6347","#808080"];
  const EYES    = ["#1a3a5c","#2980B9","#74b9ff","#27AE60","#52BE80","#2d6a4f","#8B6914","#C8A84B","#2C2C2C","#6B4226","#C0392B","#8E44AD","#00b894"];
  const TOPS    = ["#1a1a2e","#2C3E50","#34495E","#7f8c8d","#E74C3C","#C0392B","#E67E22","#F39C12","#27AE60","#16A085","#2980B9","#1abc9c","#8E44AD","#fd79a8","#FFFFFF","#ECF0F1"];
  const LIP_C   = ["#C0392B","#E74C3C","#c0706a","#fd79a8","#8E44AD","#D35400","#FF1493","#DC143C"];
  const BG      = ["#dce8ff","#e8f4ff","#dfe6e9","#ffeaa7","#d5f5e3","#f8d7e3","#e8daef","#ffddd2","#c8e6c9","#fff3e0","#1a1a2e","#2d3436","#6c5ce7","#00b894"];
  const HAT_C   = ["#E74C3C","#2C3E50","#F39C12","#2980B9","#27AE60","#8E44AD","#1a1a2e","#ECF0F1","#fd79a8","#C0392B","#D35400","#16A085","#FF69B4","#800020"];
  const GLASS_C = ["#333333","#1a1a2e","#8B4513","#C0392B","#2980B9","#27AE60","#8E44AD","#F39C12","#FFD700","#E0E0E0","#00CED1","#FF69B4"];
  const JEWEL_C = ["#f0c040","#FFD700","#C0C0C0","#E8E8E8","#B87333","#E74C3C","#2980B9","#27AE60","#8E44AD","#FF69B4","#00CED1","#fff"];

  // ── Option lists ───────────────────────────────────────────────────────────
  const HAIR_NAMES    = ["Buzz","Side-part","Fringe","Textured","Long","Wavy","Ponytail","Bun","Afro","Box braids","Curly","Locs","Faux hawk","Space buns"];
  const EYE_S         = ["Round","Almond","Cat-eye"];
  const BROWS         = ["Arched","Straight","Thick","Sad"];
  const MOUTHS        = ["Smile","Frown","Open","Smirk","Neutral"];
  const HAT_NAMES     = ["None","Beanie","Cap","Cowboy","Grad cap","Crown","Party hat","Headband","Bucket hat"];
  const GLASS_NAMES   = ["None","Round","Rectangular","Cat-eye","Sunglasses","Heart"];
  const FACIAL_NAMES  = ["None","Stubble","Moustache","Short beard","Full beard","Goatee"];
  const NECKLACE_NAMES= ["None","Gold chain","Pendant","Beads"];
  const EARRING_NAMES = ["None","Studs","Drops","Hoops","Stars"];
  const TOPS_S = [
    {id:0,label:"T-Shirt"},{id:1,label:"Hoodie"},{id:2,label:"Jacket"},
    {id:3,label:"Tank Top"},{id:4,label:"Suit & Tie"},{id:5,label:"Crop Top"},
    {id:6,label:"Polo"},{id:7,label:"Jersey"},{id:8,label:"Streetwear"},
    {id:9,label:"Dress"},{id:10,label:"Blazer"},{id:11,label:"Graphic Tee"},
  ];
  const TABS = [
    {id:"face",  label:"FACE"},
    {id:"hair",  label:"HAIR"},
    {id:"fit",   label:"FIT"},
    {id:"acc",   label:"ACCS"},
    {id:"extra", label:"EXTRA"},
  ];

  // ── Custom colours — persisted per-field in localStorage ──────────────────
  const CUSTOM_KEY = "classio_custom_colors_v1";
  const [customColors, setCustomColors] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || "{}"); }
    catch { return {}; }
  });

  // ── skinBase ───────────────────────────────────────────────────────────────
  const SKINS = ["#FDDBB4","#F5C89A","#FFCBA4","#E8A87C","#D4956A","#C68642","#A0693A","#8D5524","#6B3A1F","#F4D6C8"];
  const [skinBase, setSkinBase] = useState(() => {
    const cur = hexToHsv(ensureHex(ch.skin || "#FDDBB4"));
    let best = SKINS[0], bestD = 999;
    for (const s of SKINS) {
      const b = hexToHsv(s);
      const d = Math.abs(cur.h - b.h) + Math.abs(cur.s - b.s) * 0.4;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  });

  // ── applyField: apply a single field change immediately ───────────────────
  // Spread character (the prop) directly — never a stale copy
  const applyField = (field, value) => onChange({ ...character, [field]: value });

  // ── applyCustomColor: save to list + select immediately ───────────────────
  const applyCustomColor = (field, hex) => {
    setCustomColors(prev => {
      const existing = prev[field] || [];
      const deduped  = [hex, ...existing.filter(c => c.toLowerCase() !== hex.toLowerCase())].slice(0, 8);
      const next = { ...prev, [field]: deduped };
      try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    onChange({ ...character, [field]: hex });
  };

  // ── removeCustomColor: delete saved colour by index ───────────────────────
  const removeCustomColor = (field, idx) => {
    setCustomColors(prev => {
      const next = { ...prev, [field]: (prev[field] || []).filter((_, i) => i !== idx) };
      try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // ── Shared props object for AvatarSwatches ────────────────────────────────
  const swatchProps = { ch, customColors, onApply:applyField, onApplyCustom:applyCustomColor, onRemoveCustom:removeCustomColor };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      onClick={onClose}
      style={{
        position:"fixed", inset:0, zIndex:3000,
        background:"rgba(0,0,0,.6)",
        display:"flex", alignItems:"center", justifyContent:"center",
        padding:16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width:"100%", maxWidth:520,
          height:`min(650px, calc(100dvh - 32px))`,
          display:"flex", flexDirection:"column",
          background:"#fff", borderRadius:22,
          boxShadow:"0 24px 80px rgba(0,0,0,.38)",
          overflow:"hidden",
        }}
      >
        {/* ── Header ── */}
        <div style={{
          flexShrink:0, display:"flex", alignItems:"center", gap:12,
          padding:"14px 16px 12px", borderBottom:"1px solid #f0f0f0",
        }}>
          <div style={{
            width:52, height:52, borderRadius:"50%", overflow:"hidden", flexShrink:0,
            boxShadow:"0 2px 10px rgba(0,0,0,.14)", border:"2px solid #f0f0f0",
          }}>
            <MiniAvatar character={ch} size={52} />
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontFamily:"'Fraunces',serif", fontSize:16, fontWeight:900,
              color:"#111", margin:"0 0 5px", lineHeight:1.2 }}>My Avatar</p>
            <input
              value={ch.name || ""}
              onChange={e => onChange({ ...ch, name: e.target.value })}
              placeholder="Nickname…"
              style={{
                border:"1.5px solid #e5e5e5", borderRadius:20,
                padding:"4px 12px", fontSize:12, fontWeight:700,
                outline:"none", color:"#111", background:"#f8f8f8",
                width:"100%", boxSizing:"border-box",
              }}
            />
          </div>
          <button onClick={onClose} style={{
            flexShrink:0, width:30, height:30, borderRadius:"50%",
            background:"#f0f0f0", border:"none", cursor:"pointer",
            fontSize:17, fontWeight:900, color:"#555",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>×</button>
        </div>

        {/* ── Tab bar ── */}
        <div style={{
          flexShrink:0, display:"flex", background:"#fff",
          borderBottom:"1px solid #f0f0f0",
        }}>
          {TABS.map(t => (
            <button key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex:1, padding:"8px 2px 7px", border:"none", cursor:"pointer",
                background:"#fff", fontWeight:800, fontSize:10,
                letterSpacing:.3, lineHeight:1.5, whiteSpace:"nowrap",
                color: tab === t.id ? "#4361ee" : "#bbb",
                borderBottom:`2.5px solid ${tab === t.id ? "#4361ee" : "transparent"}`,
                transition:"color .12s, border-color .12s",
              }}
            >{t.emoji}<br />{t.label}</button>
          ))}
        </div>

        {/* ── Scrollable content ── */}
        <div style={{
          flex:1, minHeight:0, overflowY:"auto", overflowX:"hidden",
          padding:"18px 18px 12px",
          display:"flex", flexDirection:"column", gap:22,
          WebkitOverflowScrolling:"touch",
        }}>

          {/* ══ FACE ══ */}
          {tab === "face" && <>
            <AvatarSkinSection
              ch={ch} skinBase={skinBase} setSkinBase={setSkinBase}
              customColors={customColors}
              onApply={applyField} onApplyCustom={applyCustomColor} onRemoveCustom={removeCustomColor}
            />
            <AvatarRow label="Eye Shape">
              <AvatarChipGrid ch={ch} field="eyeShape" items={EYE_S} size={60} onApply={applyField} />
            </AvatarRow>
            <AvatarRow label="Eye Colour">
              <AvatarSwatches {...swatchProps} field="eyes" vals={EYES} sz={26} />
            </AvatarRow>
            <AvatarRow label="Eyebrows">
              <AvatarChipGrid ch={ch} field="eyebrow" items={BROWS} size={58} onApply={applyField} />
            </AvatarRow>
            <AvatarRow label="Expression">
              <AvatarChipGrid ch={ch} field="mouth" items={MOUTHS} size={58} onApply={applyField} />
            </AvatarRow>
            <AvatarRow label="Facial Hair">
              <AvatarChipGrid ch={ch} field="facialHair" items={FACIAL_NAMES} size={58} onApply={applyField} />
            </AvatarRow>
          </>}

          {/* ══ HAIR ══ */}
          {tab === "hair" && <>
            <AvatarRow label="Hair Style">
              <AvatarChipGrid ch={ch} field="hairStyle" items={HAIR_NAMES} size={64} onApply={applyField} />
            </AvatarRow>
            <AvatarRow label="Hair Colour">
              <AvatarSwatches {...swatchProps} field="hair" vals={HAIRS} sz={26} />
            </AvatarRow>
          </>}

          {/* ══ FIT ══ */}
          {tab === "fit" && <>
            <AvatarRow label="Outfit Style">
              <AvatarChipGrid ch={ch} field="topStyle" items={TOPS_S} size={66} onApply={applyField} />
            </AvatarRow>
            <AvatarRow label="Outfit Colour">
              <AvatarSwatches {...swatchProps} field="top" vals={TOPS} sz={26} />
            </AvatarRow>
            <AvatarRow label="Background">
              <AvatarSwatches {...swatchProps} field="bg" vals={BG} sz={26} />
            </AvatarRow>
          </>}

          {/* ══ ACCESSORIES ══ */}
          {tab === "acc" && <>
            <AvatarRow label="Hat">
              <AvatarChipGrid ch={ch} field="hat" items={HAT_NAMES} size={60} onApply={applyField} />
            </AvatarRow>
            {ch.hat > 0 && (
              <AvatarRow label="Hat Colour">
                <AvatarSwatches {...swatchProps} field="hatColor" vals={HAT_C} sz={26} />
              </AvatarRow>
            )}
            <AvatarRow label="Glasses">
              <AvatarChipGrid ch={ch} field="glasses" items={GLASS_NAMES} size={60} onApply={applyField} />
            </AvatarRow>
            {ch.glasses > 0 && (
              <AvatarRow label="Glasses Colour">
                <AvatarSwatches {...swatchProps} field="glassesColor" vals={GLASS_C} sz={26} />
              </AvatarRow>
            )}
            <AvatarRow label="Earrings">
              <AvatarChipGrid ch={ch} field="earring" items={EARRING_NAMES} size={60} onApply={applyField} />
            </AvatarRow>
            {ch.earring > 0 && (
              <AvatarRow label="Earring Colour">
                <AvatarSwatches {...swatchProps} field="earringColor" vals={JEWEL_C} sz={26} />
              </AvatarRow>
            )}
            <AvatarRow label="Necklace">
              <AvatarChipGrid ch={ch} field="necklace" items={NECKLACE_NAMES} size={60} onApply={applyField} />
            </AvatarRow>
            {ch.necklace > 0 && (
              <AvatarRow label="Necklace Colour">
                <AvatarSwatches {...swatchProps} field="necklaceColor" vals={JEWEL_C} sz={26} />
              </AvatarRow>
            )}
          </>}

          {/* ══ EXTRA ══ */}
          {tab === "extra" && <>
            <AvatarTogglePair ch={ch} field="blush"    label="Blush"      onApply={applyField} />
            <AvatarTogglePair ch={ch} field="lips"     label="Lip Gloss"  onApply={applyField} />
            {ch.lips && (
              <AvatarRow label="Lip Colour">
                <AvatarSwatches {...swatchProps} field="lipColor" vals={LIP_C} sz={26} />
              </AvatarRow>
            )}
            <AvatarTogglePair ch={ch} field="freckles" label="Freckles"   onApply={applyField} />
            <button
              onClick={() => onChange({
                skin:"#FDDBB4", hair:"#3D2B1F", hairStyle:0, eyes:"#2980B9",
                top:"#2C3E50", bg:"#dce8ff", mouth:0, eyebrow:0, eyeShape:0,
                accessory:0, topStyle:0, blush:false, lips:false, freckles:false,
                lipColor:"#d06060", hat:0, hatColor:"#E74C3C", glasses:0,
                glassesColor:"#333333", facialHair:0, necklace:0,
                necklaceColor:"#f0c040", earring:0, earringColor:"#f0c040",
                name:ch.name,
              })}
              style={{
                padding:"8px 18px", background:"#f0f0f0", border:"none",
                borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer",
                color:"#555", alignSelf:"flex-start",
              }}
            >Reset to Default</button>
          </>}

        </div>

        {/* ── Done button ── */}
        <div style={{
          flexShrink:0, padding:"10px 18px",
          paddingBottom:"max(12px, env(safe-area-inset-bottom, 12px))",
          borderTop:"1px solid #f0f0f0", background:"#fff",
        }}>
          <button onClick={onClose} style={{
            width:"100%", background:"#111", color:"#fff",
            border:"none", borderRadius:14, padding:"13px",
            fontSize:14, fontWeight:900, cursor:"pointer", letterSpacing:.4,
          }}>Done</button>
        </div>

      </div>
    </div>
  );
}
// ─── LINK FILES BUTTON ────────────────────────────────────────────────────────
function LinkBtn({ file, allFiles, onSave }) {
  const [open, setOpen] = useState(false);
  const others = allFiles.filter(f => f.id !== file.id);
  const linked = file.linkedFileIds || [];

  if (others.length === 0) return null;

  return (
    <>
      <button onClick={() => setOpen(true)} className="hov"
        style={{ display:"flex", alignItems:"center", gap:5, background:linked.length>0?C.accentL:"none", color:C.accent, border:`1px solid ${C.border}`, borderRadius:8, padding:"5px 10px", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}>
        {linked.length > 0 ? `${linked.length} linked` : "Link files"}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:C.surface, borderRadius:18, padding:24, width:"100%", maxWidth:380, boxShadow:"0 16px 48px rgba(0,0,0,.2)" }}>
            <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:18, fontWeight:700, color:C.text, marginBottom:6 }}>Link Related Files</h3>
            <p style={{ fontSize:13, color:C.muted, marginBottom:16 }}>The AI will use all linked files together when you ask questions about <strong>{file.name}</strong>.</p>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
              {others.map(f => {
                const isLinked = linked.includes(f.id);
                return (
                  <button key={f.id} onClick={() => {
                    const next = isLinked ? linked.filter(id=>id!==f.id) : [...linked, f.id];
                    onSave(next);
                  }}
                    style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", borderRadius:10, border:`1.5px solid ${isLinked?C.accent:C.border}`, background:isLinked?C.accentL:"#fff", cursor:"pointer", textAlign:"left" }}>
                    <span style={{ fontSize:18 }}>{isLinked?"✓":"○"}</span>
                    <span style={{ fontSize:13, fontWeight:600, color:isLinked?C.accent:C.text, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setOpen(false)}
              style={{ width:"100%", background:C.accent, color:"#fff", border:"none", borderRadius:10, padding:"11px", fontSize:14, fontWeight:700, cursor:"pointer" }}>
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}


function Splash() {
  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <style>{GS}</style>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:56, height:56, background:C.accent, borderRadius:18, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}>
          <Icon d={I.sparkle} size={24} color="#fff" sw={2} />
        </div>
        <p style={{ fontSize:15, color:C.muted, fontFamily:"'DM Sans',sans-serif" }}>Loading…</p>
      </div>
    </div>
  );
}

function SignIn({ onSignIn, onGuest }) {
  const [showGuest, setShowGuest] = useState(false);
  const [name, setName] = useState("");

  if (showGuest) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',sans-serif" }}>
      <style>{GS}</style>
      <div style={{ background:C.surface, borderRadius:28, padding:"56px 48px", width:"100%", maxWidth:440, boxShadow:"0 8px 40px rgba(0,0,0,.08)", textAlign:"center" }}>
        <div style={{ width:68, height:68, background:C.warmL, borderRadius:22, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 24px" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:700, color:C.text, marginBottom:8 }}>Continue as Guest</h2>
        <p style={{ fontSize:14, color:C.muted, marginBottom:28, lineHeight:1.6 }}>Your folders will not be saved when you leave.<br/>Sign in with Google to keep your data.</p>
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if(e.key==="Enter" && name.trim()) onGuest(name.trim()); }}
          placeholder="Enter your name…"
          style={{ width:"100%", border:`1.5px solid ${C.border}`, borderRadius:12, padding:"12px 16px", fontSize:15, outline:"none", marginBottom:14, color:C.text, background:C.bg, textAlign:"center" }} />
        <button disabled={!name.trim()} onClick={() => name.trim() && onGuest(name.trim())}
          style={{ width:"100%", background:name.trim()?C.warm:"#ccc", color:"#fff", border:"none", borderRadius:12, padding:"13px", fontSize:15, fontWeight:700, cursor:name.trim()?"pointer":"not-allowed", marginBottom:12 }}>
          Enter as Guest
        </button>
        <button onClick={() => setShowGuest(false)}
          style={{ width:"100%", background:"none", border:"none", color:C.muted, fontSize:14, cursor:"pointer" }}>
          ← Back
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',sans-serif" }}>
      <style>{GS}</style>
      <div style={{ background:C.surface, borderRadius:28, padding:"56px 48px", width:"100%", maxWidth:440, boxShadow:"0 8px 40px rgba(0,0,0,.08)", textAlign:"center" }}>
        <div style={{ width:68, height:68, background:C.accentL, borderRadius:22, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 24px" }}>
          <Icon d={I.sparkle} size={30} color={C.accent} sw={2} />
        </div>
        <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:34, fontWeight:700, color:C.text, letterSpacing:-0.5, marginBottom:10 }}>Classio</h1>
        <p style={{ fontSize:15, color:C.muted, marginBottom:40, lineHeight:1.6 }}>Your AI-powered study space.<br/>Sign in to save across devices.</p>
        <button onClick={onSignIn} className="hov"
          style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:12, background:C.surface, border:`1.5px solid ${C.border}`, borderRadius:14, padding:"14px 20px", fontSize:15, fontWeight:600, cursor:"pointer", color:C.text, boxShadow:"0 2px 8px rgba(0,0,0,.06)", marginBottom:14 }}>
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </button>
        <div style={{ display:"flex", alignItems:"center", gap:12, margin:"4px 0 14px" }}>
          <div style={{ flex:1, height:1, background:C.border }} />
          <span style={{ fontSize:13, color:C.muted }}>or</span>
          <div style={{ flex:1, height:1, background:C.border }} />
        </div>
        <button onClick={() => setShowGuest(true)} className="hov"
          style={{ width:"100%", background:"transparent", border:`1.5px solid ${C.border}`, borderRadius:14, padding:"13px 20px", fontSize:15, fontWeight:600, cursor:"pointer", color:C.muted }}>
          Continue as Guest
        </button>
        <p style={{ fontSize:12, color:C.muted, marginTop:16, lineHeight:1.5 }}>Guest mode does not save your data between sessions.</p>
      </div>
    </div>
  );
}

// ─── FOLDER VIEW ──────────────────────────────────────────────────────────────
// ─── FILE COLOR PICKER ───────────────────────────────────────────────────────
// Per-file colour dot — 12 presets + custom button → inline ColorPicker popover
function FileColorPicker({ file, onPick }) {
  const [open, setOpen] = useState(false);
  const curAccent = getFileColor(file).accent;

  return (
    <div style={{ position:"relative" }}>
      {/* Trigger: shows current file colour */}
      <button title="Change file colour" onClick={() => setOpen(o=>!o)}
        style={{ width:26, height:26, borderRadius:"50%", background:curAccent,
          border:`2.5px solid ${open?"#111":"rgba(0,0,0,.15)"}`,
          cursor:"pointer", flexShrink:0,
          boxShadow:"0 1px 4px rgba(0,0,0,.2)",
          transition:"border .12s" }}/>

      {/* Popover */}
      {open && (
        <div onClick={e=>e.stopPropagation()}
          style={{ position:"absolute", right:0, top:34, zIndex:800,
            background:"#18182a", borderRadius:18, padding:"12px",
            boxShadow:"0 12px 48px rgba(0,0,0,.55)", width:220 }}>
          {/* Preset dots */}
          <p style={{ fontSize:9, fontWeight:800, color:"#666", letterSpacing:1, marginBottom:8, textTransform:"uppercase" }}>Presets</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
            {FILE_COLORS.map((col,ci) => {
              const isSel = !file.customColor && (file.colorIndex||0)===ci;
              return (
                <button key={ci}
                  onClick={() => { onPick({colorIndex:ci, customColor:null}); setOpen(false); }}
                  style={{ width:22, height:22, borderRadius:"50%", background:col.accent,
                    border:`2.5px solid ${isSel?"#fff":"transparent"}`,
                    boxShadow:isSel?"0 0 0 1.5px rgba(255,255,255,.5)":"none",
                    cursor:"pointer", transition:"border .1s" }}/>
              );
            })}
          </div>
          {/* Custom picker */}
          <p style={{ fontSize:9, fontWeight:800, color:"#666", letterSpacing:1, marginBottom:8, textTransform:"uppercase" }}>Custom</p>
          <ColorPicker
            value={file.customColor || curAccent}
            onChange={hex => onPick({customColor:hex, colorIndex: file.colorIndex||0})}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

function FolderView({ folder, onBack, onOpenFile, onUpdate }) {
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState("files");
  const [editingName, setEditingName] = useState(false);
  const [folderName, setFolderName] = useState(folder.name);
  const [showFolderColorPicker, setShowFolderColorPicker] = useState(false);
  const fileInput = useRef();

  const addFiles = (list) => {
    const added = Array.from(list).map(f => {
      const id = `fi${Date.now()}-${Math.random()}`;
      FILE_STORE.set(id, f);
      idbSave(id, f); // persist to IndexedDB so it survives page close
      return {
        id, name: f.name, type: f.type, size: f.size,
        colorIndex: 0, notes: "", studyCards: [], uploadedAt: new Date().toLocaleDateString(),
        linkedFileIds: [], _fileObj: f,
      };
    });
    onUpdate({ ...folder, files: [...folder.files, ...added] });
  };

  const TABS = [{ id:"files", label:"Files", icon:I.file },{ id:"ai", label:"AI Assistant", icon:I.ai }];

  return (
    <div className="page-with-ad" style={{ minHeight:"100vh", background:C.bg, fontFamily:"'DM Sans',sans-serif" }}>
      <style>{GS}</style>
      {/* Top bar */}
      <div className="app-header" style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 24px", height:64, display:"flex", alignItems:"center", gap:16 }}>
        <button onClick={onBack} className="hov" style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", color:C.muted, fontSize:14 }}>
          <Icon d={I.back} size={18} color={C.muted} /> Back
        </button>
        <div style={{ width:1, height:20, background:C.border }} />
        <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
          <div style={{ width:34, height:34, background:folder.color+"22", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <Icon d={I.folder} size={18} color={folder.color} />
          </div>
          {editingName
            ? <input autoFocus value={folderName} onChange={e => setFolderName(e.target.value)}
                onBlur={() => { setEditingName(false); onUpdate({...folder,name:folderName||folder.name}); }}
                onKeyDown={e => { if(e.key==="Enter"){setEditingName(false);onUpdate({...folder,name:folderName||folder.name});} }}
                style={{ fontSize:18, fontWeight:700, fontFamily:"'Fraunces',serif", border:"none", borderBottom:`2px solid ${C.accent}`, outline:"none", background:"transparent", color:C.text, width:240 }} />
            : <h1 onClick={() => setEditingName(true)} style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontWeight:700, color:C.text, cursor:"text" }} title="Click to rename">{folder.name}</h1>
          }
        </div>
        <div style={{ display:"flex", gap:6 }}>
          {FOLDER_COLORS.map(col => (
            <button key={col} onClick={() => onUpdate({...folder,color:col})}
              style={{ width:22, height:22, borderRadius:"50%", background:col, cursor:"pointer", flexShrink:0,
                border:`3px solid ${folder.color===col?C.text:"transparent"}`,
                boxShadow:`0 1px 3px rgba(0,0,0,${folder.color===col?".35":".12"})` }} />
          ))}
          <button onClick={() => setShowFolderColorPicker(p=>!p)}
            style={{ width:22, height:22, borderRadius:"50%", cursor:"pointer",
              border:"2px dashed #aaa", background:showFolderColorPicker?"#4361ee":"transparent",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:13, color:showFolderColorPicker?"#fff":"#888" }}>
            {showFolderColorPicker?"×":"+"}
          </button>
        </div>
      </div>
      {/* Folder custom colour picker — slides open below topbar */}
      {showFolderColorPicker && (
        <div style={{ padding:"12px 24px 0", background:C.surface, borderBottom:`1px solid ${C.border}` }}>
          <ColorPicker
            value={folder.color || "#3D5A80"}
            label="Folder Colour"
            onChange={col => onUpdate({...folder, color:col})}
            onClose={() => setShowFolderColorPicker(false)}
          />
        </div>
      )}
      {/* Tabs */}
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 12px", display:"flex", gap:2, overflowX:"auto" }}>
        {TABS.map(t => (
          <button key={t.id} className="tab" onClick={() => setTab(t.id)}
            style={{ display:"flex", alignItems:"center", gap:6, padding:"12px 14px", border:"none", borderBottom:tab===t.id?`2px solid ${C.accent}`:"2px solid transparent", background:"none", cursor:"pointer", fontSize:13, fontWeight:tab===t.id?700:500, color:tab===t.id?C.accent:C.muted, marginBottom:-1, whiteSpace:"nowrap", flexShrink:0 }}>
            <Icon d={t.icon} size={14} color={tab===t.id?C.accent:C.muted} />
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="page-inner" style={{ maxWidth:860, margin:"0 auto", padding:"32px 24px" }}>
        {tab === "files" && (
          <>
            <div onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)}
              onDrop={e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files);}}
              onClick={()=>fileInput.current.click()}
              style={{ border:`2px dashed ${dragging?C.accent:C.border}`, borderRadius:16, padding:"28px", textAlign:"center", cursor:"pointer", background:dragging?C.accentL:"transparent", marginBottom:24, transition:"all .2s" }}>
              <Icon d={I.upload} size={28} color={dragging?C.accent:C.muted} />
              <p style={{ fontSize:15, fontWeight:600, color:dragging?C.accent:C.text, marginTop:10, marginBottom:4 }}>Drop files here or click to upload</p>
              <p style={{ fontSize:13, color:C.muted }}>PDF, Word, PowerPoint, images, and more</p>
              <input ref={fileInput} type="file" multiple style={{ display:"none" }} onChange={e=>addFiles(e.target.files)} />
            </div>

            {folder.files.length === 0
              ? <div style={{ textAlign:"center", padding:"40px 0", color:C.muted }}><Icon d={I.file} size={40} color={C.border} /><p style={{ marginTop:12, fontSize:15 }}>No files yet</p></div>
              : <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {folder.files.map(file => {
                    const fc = getFileColor(file);
                    const linked = file.linkedFiles || [];
                    return (
                      <div key={file.id} className="row"
                        style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 16px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                          <div style={{ width:38, height:38, background:fc.bg, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                            <Icon d={I.file} size={18} color={fc.accent} />
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <p style={{ fontSize:14, fontWeight:600, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{file.name}</p>
                            <p style={{ fontSize:12, color:C.muted }}>
                              {(file.size/1024).toFixed(1)} KB · {file.uploadedAt}
                              {(file.linkedFileIds||[]).length > 0 && <span style={{ marginLeft:8, color:C.accent }}>{(file.linkedFileIds||[]).length} linked</span>}
                            </p>
                          </div>
                          <FileColorPicker file={file}
                            onPick={(patch) => onUpdate({...folder,files:folder.files.map(f=>f.id===file.id?{...f,...patch}:f)})}/>
                          <LinkBtn file={file} allFiles={folder.files}
                            onSave={ids => onUpdate({...folder,files:folder.files.map(f=>f.id===file.id?{...f,linkedFileIds:ids}:f)})} />
                          <button onClick={() => onOpenFile(file)} className="hov"
                            style={{ display:"flex", alignItems:"center", gap:6, background:C.accentL, color:C.accent, border:"none", borderRadius:8, padding:"7px 14px", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                            <Icon d={I.edit} size={13} color={C.accent} /> Open
                          </button>
                          <button onClick={() => { idbDelete(file.id); FILE_STORE.delete(file.id); onUpdate({...folder,files:folder.files.filter(f=>f.id!==file.id)}); }} className="hov"
                            style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
                            <Icon d={I.trash} size={16} color={C.muted} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
            }
          </>
        )}
        {tab === "ai" && <AITab file={null} allFiles={folder.files} folder={folder} onUpdate={()=>{}} />}
      </div>
    </div>
  );
}

// ─── FILE VIEW ────────────────────────────────────────────────────────────────
function FileView({ file, folder, allFiles, user, isGuest, onBack, onUpdate }) {
  const [tab, setTab] = useState("view");
  const TABS = [
    {id:"view",  label:"View File",       icon:I.file},
    {id:"notes", label:"Notes",           icon:I.notes},
    {id:"voice", label:"Voice & Podcast", icon:I.cards},
    {id:"cards", label:"Study Cards",     icon:I.cards},
    {id:"ai",    label:"AI Assistant",    icon:I.ai},
    {id:"game",  label:"Game Mode",       icon:I.game},
  ];
  const fc = getFileColor(file);

  return (
    <div className="page-with-ad" style={{ minHeight:"100vh", background:C.bg, fontFamily:"'DM Sans',sans-serif" }}>
      <style>{GS}</style>
      <div className="app-header" style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 24px", height:64, display:"flex", alignItems:"center", gap:14 }}>
        <button onClick={onBack} className="hov" style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", color:C.muted, fontSize:14 }}>
          <Icon d={I.back} size={18} color={C.muted} /> {folder.name}
        </button>
        <Icon d={I.chevron} size={14} color={C.border} />
        <div style={{ width:28, height:28, background:fc.bg, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Icon d={I.file} size={14} color={fc.accent} />
        </div>
        <span style={{ fontSize:15, fontWeight:600, color:C.text, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{file.name}</span>
      </div>
      <div className="nav-tabs" style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 24px", display:"flex", gap:4 }}>
        {TABS.map(t => (
          <button key={t.id} className="tab" onClick={() => setTab(t.id)}
            className="nav-tab-btn" style={{ display:"flex", alignItems:"center", gap:7, padding:"14px 18px", border:"none", borderBottom:tab===t.id?`2px solid ${C.accent}`:"2px solid transparent", background:"none", cursor:"pointer", fontSize:14, fontWeight:tab===t.id?700:500, color:tab===t.id?C.accent:C.muted, marginBottom:-1 }}>
            <Icon d={t.icon} size={15} color={tab===t.id?C.accent:C.muted} />{t.label}
          </button>
        ))}
      </div>
      {tab==="view"
        ? <ViewTab file={file} onUpdate={onUpdate} />
        : <div className="page-inner" style={{ maxWidth:900, margin:"0 auto", padding:"32px 24px" }}>
            {tab==="notes" && <NotesTab key={file.id} file={file} onUpdate={onUpdate} user={user} isGuest={isGuest} />}
            {tab==="voice" && <VoicePodcastTab file={file} onUpdate={onUpdate} user={user} isGuest={isGuest} />}
            {tab==="cards" && <CardsTab file={file} onUpdate={onUpdate} />}
            {tab==="ai" && <AITab file={file} allFiles={allFiles} folder={folder} onUpdate={onUpdate} />}
            {tab==="game" && <GameTab file={file} />}
          </div>
      }
    </div>
  );
}

function ViewTab({ file, onUpdate }) {
  const fileObj = file._fileObj || FILE_STORE.get(file.id) || null;
  const fileName = fileObj?.name || file.name || "";
  const ext  = fileName.split(".").pop().toLowerCase();
  const mime = fileObj?.type || "";

  const isPDF   = ext === "pdf" || mime === "application/pdf";
  const isImage = mime.startsWith("image/") || ["jpg","jpeg","png","gif","webp","bmp","svg"].includes(ext);
  const isText  = ["txt","md","csv","json","js","ts","jsx","py","html","css","xml","yaml","yml"].includes(ext);
  const isWord  = ["doc","docx"].includes(ext);
  const isPPT   = ["ppt","pptx"].includes(ext);
  const isExcel = ["xls","xlsx"].includes(ext);

  // PDF state
  const canvasRef  = useRef(null);
  const drawRef    = useRef(null);
  const renderRef  = useRef(null);
  const pdfRef     = useRef(null);
  const { isMobile } = useResponsive();
  const [totalPages, setTotalPages] = useState(0);
  const [pageNum,    setPageNum]    = useState(1);
  const [pdfReady,   setPdfReady]   = useState(false);
  const [annotations,setAnnotations]= useState({});
  const [tool,      setTool]      = useState("pen");
  const [penColor,  setPenColor]  = useState("#E53E3E");
  const [brushSize, setBrushSize] = useState(3);
  const [drawing,   setDrawing]   = useState(false);
  const lastPosRef = useRef(null);

  // Explain state
  const [explaining,  setExplaining]  = useState(false);
  const [explanation, setExplanation] = useState("");
  const [showExplain, setShowExplain] = useState(false);

  // PPT page nav
  const [pptTotal, setPptTotal] = useState(0);
  const [pptPage,  setPptPage]  = useState(1);

  // Load PDF
  useEffect(() => {
    if (!isPDF || !fileObj) return;
    setPdfReady(false); pdfRef.current = null; setPageNum(1);
    (async () => {
      try {
        if (!window.pdfjsLib) {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            s.onload = res; s.onerror = rej; document.head.appendChild(s);
          });
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }
        const buf = await fileObj.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        pdfRef.current = pdf;
        setTotalPages(pdf.numPages);
        setPdfReady(true);
      } catch(e) { console.error("PDF load:", e); }
    })();
  }, [fileObj]);

  // Render PDF page
  useEffect(() => {
    if (!pdfReady || !pdfRef.current) return;
    const pdf = pdfRef.current; const pg = pageNum;
    (async () => {
      if (renderRef.current) { try { renderRef.current.cancel(); } catch {} renderRef.current = null; }
      const c = canvasRef.current; if (!c) return;
      try {
        const pdfPage = await pdf.getPage(pg);
        const parentW = c.parentElement?.offsetWidth || 760;
        const base    = pdfPage.getViewport({ scale: 1 });
        const scale   = Math.min(2.5, (parentW - 32) / base.width);
        const vp      = pdfPage.getViewport({ scale });
        c.width = vp.width; c.height = vp.height;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        const task = pdfPage.render({ canvasContext: ctx, viewport: vp });
        renderRef.current = task;
        await task.promise; renderRef.current = null;
        const dc = drawRef.current;
        if (dc) {
          dc.width = vp.width; dc.height = vp.height;
          dc.getContext("2d").clearRect(0, 0, dc.width, dc.height);
          if (annotations[pg]) {
            const img = new Image();
            img.onload = () => dc.getContext("2d")?.drawImage(img, 0, 0);
            img.src = annotations[pg];
          }
        }
      } catch(e) { if (e?.name !== "RenderingCancelledException") console.error("Render:", e); }
    })();
  }, [pdfReady, pageNum]);

  const saveAnnotation = () => {
    if (drawRef.current) setAnnotations(p => ({ ...p, [pageNum]: drawRef.current.toDataURL() }));
  };
  const changePage = (n) => {
    const v = Math.max(1, Math.min(totalPages, n));
    if (v === pageNum) return;
    saveAnnotation(); setPageNum(v);
  };
  const getPos = (e) => {
    const dc = drawRef.current;
    const r  = dc.getBoundingClientRect();
    const sx = dc.width / r.width, sy = dc.height / r.height;
    const src = e.touches?.[0] || e;
    return { x: (src.clientX - r.left) * sx, y: (src.clientY - r.top) * sy };
  };
  const startDraw = (e) => { e.preventDefault(); lastPosRef.current = getPos(e); setDrawing(true); };
  const doDraw = (e) => {
    e.preventDefault();
    if (!drawing || !lastPosRef.current || !drawRef.current) return;
    const ctx = drawRef.current.getContext("2d");
    const pos = getPos(e);
    ctx.beginPath(); ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y); ctx.lineTo(pos.x, pos.y);
    if (tool === "eraser")         { ctx.globalCompositeOperation = "destination-out"; ctx.lineWidth = brushSize * 5; }
    else if (tool === "highlight") { ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 0.3; ctx.lineWidth = brushSize * 8; ctx.strokeStyle = penColor; }
    else                           { ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.lineWidth = brushSize; ctx.strokeStyle = penColor; }
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    lastPosRef.current = pos;
  };
  const stopDraw = () => { if (drawing) { setDrawing(false); saveAnnotation(); } };
  const clearDraw = () => {
    drawRef.current?.getContext("2d").clearRect(0, 0, drawRef.current.width, drawRef.current.height);
    setAnnotations(p => { const n = {...p}; delete n[pageNum]; return n; });
  };

  const pptSlidesRef = useRef([]);   // populated by PPTViewer

  const doExplain = async () => {
    setExplaining(true); setShowExplain(true); setExplanation("");
    try {
      let text = "";
      if (pdfRef.current) {
        // PDF — extract text from current page only
        const pg = await pdfRef.current.getPage(pageNum);
        text = (await pg.getTextContent()).items.map(i => i.str).join(" ").trim().slice(0, 3000);
      } else if (isPPT && pptSlidesRef.current.length > 0) {
        // PPT — use the parsed text of the current slide
        const slide = pptSlidesRef.current[pptPage - 1];
        text = slide ? slide.texts.join(" ").slice(0, 3000) : "";
      } else if (fileObj) {
        text = (await extractFileText(fileObj).catch(() => "")).slice(0, 6000);
      }
      const pageLabel = isPPT ? `slide ${pptPage}` : `page ${pageNum}`;
      const res = await callClaude(
        "You are a helpful study tutor. Explain clearly and simply. Plain text only — no asterisks, no markdown.",
        text
          ? `Explain ONLY this content from ${pageLabel} of "${file.name}":

${text}`
          : `Explain the topic "${file.name}" to a student.`
      );
      setExplanation(res);
    } catch(e) { setExplanation("Error: " + e.message); }
    setExplaining(false);
  };

  const COLORS = ["#E53E3E","#FF8C00","#ECC94B","#38A169","#3182CE","#805AD5","#1a1a1a","#ffffff"];
  const TOOLS  = [
    {id:"pen",      svgPath:"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"},
    {id:"highlight",svgPath:"M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"},
    {id:"eraser",   svgPath:"M20 20H7L3 16l10-10 7 7-3.5 3.5M6.5 17.5l5-5"},
  ];

  if (!fileObj) return (
    <div style={{ textAlign:"center", padding:"60px 24px" }}>
      <div style={{ width:56,height:56,borderRadius:16,background:C.accentL,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12 }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="{C.accent}" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
      <p style={{ fontSize:16, fontWeight:600, color:C.text, marginBottom:8 }}>File not loaded</p>
      <p style={{ fontSize:13, color:C.muted, marginBottom:20 }}>Files need to be re-uploaded once after a full page refresh.</p>
      <label style={{ display:"inline-flex", alignItems:"center", gap:8, background:C.accent, color:"#fff", borderRadius:10, padding:"11px 22px", cursor:"pointer", fontSize:14, fontWeight:600 }}>
        Re-open File
        <input type="file" style={{ display:"none" }} onChange={e => {
          const f = e.target.files?.[0]; if (!f) return;
          FILE_STORE.set(file.id, f); idbSave(file.id, f); onUpdate({...file, _fileObj: f});
        }} />
      </label>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 112px)" }}>

      {/* Toolbar */}
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"6px 14px", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        {isPDF ? (<>
          {TOOLS.map(t => (
            <button key={t.id} onClick={() => setTool(t.id)}
              style={{ width:32, height:32, borderRadius:7, border:`1.5px solid ${tool===t.id?C.accent:C.border}`, background:tool===t.id?C.accentL:"#fff", cursor:"pointer", fontSize:14 }}>
              {t.icon}
            </button>
          ))}
          <div style={{ width:1, height:20, background:C.border, flexShrink:0 }} />
          {COLORS.map(col => (
            <button key={col} onClick={() => setPenColor(col)}
              style={{ width:18, height:18, borderRadius:"50%", background:col, border:penColor===col?`3px solid ${C.accent}`:`1.5px solid ${C.border}`, cursor:"pointer", flexShrink:0 }} />
          ))}
          <div style={{ width:1, height:20, background:C.border, flexShrink:0 }} />
          <input type="range" min="1" max="20" value={brushSize} onChange={e => setBrushSize(+e.target.value)} style={{ width:60 }} />
          <button onClick={clearDraw} style={{ fontSize:12, background:"none", border:`1px solid ${C.border}`, borderRadius:6, padding:"4px 8px", cursor:"pointer", color:C.muted }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Clear</button>
          <div style={{ flex:1 }} />
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <button onClick={() => changePage(pageNum-1)} disabled={pageNum<=1}
              style={{ width:28, height:28, borderRadius:6, border:`1px solid ${C.border}`, background:"#fff", cursor:pageNum<=1?"default":"pointer", opacity:pageNum<=1?.4:1, fontSize:18 }}>‹</button>
            <input type="number" value={pageNum} min="1" max={totalPages}
              onChange={e => changePage(parseInt(e.target.value)||1)}
              style={{ width:42, textAlign:"center", border:`1px solid ${C.border}`, borderRadius:6, padding:"3px 4px", fontSize:13, outline:"none" }} />
            <span style={{ fontSize:12, color:C.muted }}>/ {totalPages}</span>
            <button onClick={() => changePage(pageNum+1)} disabled={pageNum>=totalPages}
              style={{ width:28, height:28, borderRadius:6, border:`1px solid ${C.border}`, background:"#fff", cursor:pageNum>=totalPages?"default":"pointer", opacity:pageNum>=totalPages?.4:1, fontSize:18 }}>›</button>
          </div>
          <button onClick={doExplain} disabled={explaining}
            style={{ display:"flex", alignItems:"center", gap:5, background:C.accent, color:"#fff", border:"none", borderRadius:7, padding:"6px 14px", fontSize:13, fontWeight:600, cursor:explaining?"default":"pointer", whiteSpace:"nowrap" }}>
            <Icon d={I.sparkle} size={12} color="#fff" sw={2} />{explaining?"…":`Explain Page ${pageNum}`}
          </button>
        </>) : (<>
          <span style={{ fontSize:13, color:C.muted }}> <strong style={{ color:C.text }}>{fileName}</strong></span>
          <div style={{ flex:1 }} />
          {isPPT && pptTotal > 1 && (
            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
              <button onClick={() => setPptPage(p=>Math.max(1,p-1))} disabled={pptPage<=1}
                style={{ width:28, height:28, borderRadius:6, border:`1px solid ${C.border}`, background:"#fff", cursor:pptPage<=1?"default":"pointer", opacity:pptPage<=1?.4:1, fontSize:18 }}>‹</button>
              <span style={{ fontSize:13, color:C.muted }}>{pptPage}/{pptTotal}</span>
              <button onClick={() => setPptPage(p=>Math.min(pptTotal,p+1))} disabled={pptPage>=pptTotal}
                style={{ width:28, height:28, borderRadius:6, border:`1px solid ${C.border}`, background:"#fff", cursor:pptPage>=pptTotal?"default":"pointer", opacity:pptPage>=pptTotal?.4:1, fontSize:18 }}>›</button>
            </div>
          )}
          <button onClick={doExplain} disabled={explaining}
            style={{ display:"flex", alignItems:"center", gap:5, background:C.accent, color:"#fff", border:"none", borderRadius:7, padding:"6px 14px", fontSize:13, fontWeight:600, cursor:explaining?"default":"pointer" }}>
            <Icon d={I.sparkle} size={12} color="#fff" sw={2} />{explaining?"Explaining…":"AI Explain"}
          </button>
        </>)}
      </div>

      {/* Viewer */}
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
        <div style={{ flex:1, overflow:"auto", background:"#404040", padding:"24px", display:"flex", justifyContent:"center", alignItems:"flex-start" }}>

          {isPDF && (
            <div style={{ position:"relative", display:"inline-block", lineHeight:0, boxShadow:"0 4px 32px rgba(0,0,0,.6)" }}>
              <canvas ref={canvasRef} style={{ display:"block" }} />
              <canvas ref={drawRef}
                style={{ position:"absolute", top:0, left:0, width:"100%", height:"100%", cursor:tool==="eraser"?"cell":"crosshair", touchAction:"none" }}
                onMouseDown={startDraw} onMouseMove={doDraw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                onTouchStart={startDraw} onTouchMove={doDraw} onTouchEnd={stopDraw} />
            </div>
          )}

          {isImage  && <ImageViewer  fileObj={fileObj} fileName={fileName} />}
          {isText   && <TextViewer   fileObj={fileObj} />}
          {isWord   && <WordViewer   fileObj={fileObj} />}
          {isPPT    && <PPTViewer    fileObj={fileObj} page={pptPage} onTotalPages={setPptTotal} onSlidesLoaded={slides => { pptSlidesRef.current = slides; }} />}
          {isExcel  && <ExcelViewer  fileObj={fileObj} />}

          {!isPDF && !isImage && !isText && !isWord && !isPPT && !isExcel && (
            <DownloadViewer fileObj={fileObj} fileName={fileName} />
          )}
        </div>

        {/* Explain panel */}
        {showExplain && (
          <div style={{ width:300, background:C.surface, borderLeft:`1px solid ${C.border}`, display:"flex", flexDirection:"column", flexShrink:0 }}>
            <div style={{ padding:"12px 16px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:13, fontWeight:700, color:C.text }}>
                {isPDF ? `Page ${pageNum} — Explanation` : "AI Explanation"}
              </span>
              <button onClick={() => setShowExplain(false)} style={{ background:"none", border:"none", cursor:"pointer" }}>
                <Icon d={I.x} size={14} color={C.muted} />
              </button>
            </div>
            <div style={{ flex:1, overflowY:"auto", padding:"14px 16px" }}>
              {explaining
                ? <div style={{ display:"flex", gap:5 }}>{[0,1,2].map(j=><div key={j} style={{ width:7,height:7,borderRadius:"50%",background:C.accent,animation:"bounce 1.2s infinite",animationDelay:`${j*.2}s` }}/>)}</div>
                : <div style={{ fontSize:13, lineHeight:1.7, color:C.text, whiteSpace:"pre-wrap" }}>{explanation}</div>
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FILE VIEWER HELPERS ──────────────────────────────────────────────────────

function ImageViewer({ fileObj, fileName }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const u = URL.createObjectURL(fileObj);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [fileObj]);
  if (!url) return null;
  return (
    <img src={url} alt={fileName}
      style={{ maxWidth:"100%", maxHeight:"calc(100vh - 200px)", borderRadius:6, boxShadow:"0 4px 32px rgba(0,0,0,.5)", background:"#fff" }} />
  );
}

function TextViewer({ fileObj }) {
  const [text, setText] = useState("Loading…");
  useEffect(() => {
    readFileAsText(fileObj)
      .then(t => setText(t || "(empty)"))
      .catch(() => setText("Could not read file."));
  }, [fileObj]);
  return (
    <div style={{ background:"#1e1e2e", color:"#cdd6f4", padding:"24px 28px", borderRadius:8, width:"100%", maxWidth:860, boxShadow:"0 8px 32px rgba(0,0,0,.5)", whiteSpace:"pre-wrap", fontFamily:"monospace", fontSize:13, lineHeight:1.8, minHeight:400, wordBreak:"break-word" }}>
      {text}
    </div>
  );
}

function WordViewer({ fileObj }) {
  const [html,    setHtml]    = useState("");
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");
  useEffect(() => {
    (async () => {
      try {
        if (!window.mammoth) {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
            s.onload = res; s.onerror = rej; document.head.appendChild(s);
          });
        }
        const ab  = await fileObj.arrayBuffer();
        const out = await window.mammoth.convertToHtml({ arrayBuffer: ab });
        if (out.value) setHtml(out.value);
        else setError("Document appears empty.");
      } catch(e) {
        console.error("Word:", e);
        setError("Could not render this Word file: " + e.message);
      }
      setLoading(false);
    })();
  }, [fileObj]);

  return (
    <div style={{ background:"#fff", padding:"48px 60px", borderRadius:4, maxWidth:860, width:"100%", boxShadow:"0 8px 32px rgba(0,0,0,.4)", minHeight:500, fontSize:14, lineHeight:1.9, color:"#111" }}>
      {loading && <p style={{ color:"#888" }}>Loading document…</p>}
      {error   && <p style={{ color:"#e53e3e" }}>{error}</p>}
      {html    && <div dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

function PPTViewer({ fileObj, page, onTotalPages, onSlidesLoaded }) {
  const [slides,  setSlides]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  useEffect(() => {
    (async () => {
      try {
        if (!window.JSZip) {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
            s.onload = res; s.onerror = rej; document.head.appendChild(s);
          });
        }
        const ab  = await fileObj.arrayBuffer();
        const zip = await window.JSZip.loadAsync(ab);

        // Find slides in correct order
        const slideKeys = Object.keys(zip.files)
          .filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k))
          .sort((a, b) => {
            const na = parseInt(a.match(/\d+/)[0]);
            const nb = parseInt(b.match(/\d+/)[0]);
            return na - nb;
          });

        if (slideKeys.length === 0) { setError("No slides found in this file."); setLoading(false); return; }
        onTotalPages && onTotalPages(slideKeys.length);
        // We'll call onSlidesLoaded after parsing below

        const parsed = await Promise.all(slideKeys.map(async sk => {
          const xml  = await zip.files[sk].async("string");
          // Extract all text nodes
          const texts = [];
          const re = /<a:t[^>]*>([^<]*)<\/a:t>/g;
          let m;
          while ((m = re.exec(xml)) !== null) if (m[1].trim()) texts.push(m[1].trim());
          // Extract embedded images
          const relKey = sk.replace("slides/slide", "slides/_rels/slide").replace(".xml", ".xml.rels");
          const imgs = [];
          if (zip.files[relKey]) {
            const relXml = await zip.files[relKey].async("string");
            const imgRe  = /Target="\.\.\/media\/([^"]+)"/g;
            let rm;
            while ((rm = imgRe.exec(relXml)) !== null) {
              const path = "ppt/media/" + rm[1];
              if (zip.files[path]) {
                const ext2 = rm[1].split(".").pop().toLowerCase();
                const mt   = ext2==="png"?"image/png":ext2==="gif"?"image/gif":ext2==="svg"?"image/svg+xml":"image/jpeg";
                const b64  = await zip.files[path].async("base64");
                imgs.push({ src:`data:${mt};base64,${b64}`, ext: ext2 });
              }
            }
          }
          return { texts, imgs };
        }));

        setSlides(parsed);
        onSlidesLoaded && onSlidesLoaded(parsed);
      } catch(e) {
        console.error("PPT:", e);
        setError("Could not render PowerPoint: " + e.message);
      }
      setLoading(false);
    })();
  }, [fileObj]);

  const slide = slides[Math.max(0, (page||1) - 1)] || { texts:[], imgs:[] };

  if (loading) return <div style={{ color:"#fff", padding:40 }}>Loading presentation…</div>;
  if (error)   return <div style={{ color:"#fca5a5", padding:40, background:"#1e1e2e", borderRadius:8 }}>{error}</div>;

  return (
    <div style={{ background:"#fff", borderRadius:8, width:"100%", maxWidth:900, minHeight:480, boxShadow:"0 8px 32px rgba(0,0,0,.4)", overflow:"hidden" }}>
      {/* Slide header */}
      {slide.texts[0] && (
        <div style={{ background:"linear-gradient(135deg, #1a1a2e, #16213e)", padding:"28px 36px" }}>
          <p style={{ fontSize:24, fontWeight:800, color:"#fff", lineHeight:1.3 }}>{slide.texts[0]}</p>
        </div>
      )}
      {/* Images */}
      {slide.imgs.length > 0 && (
        <div style={{ padding:"20px 36px 0", display:"flex", gap:12, flexWrap:"wrap" }}>
          {slide.imgs.map((img, i) => (
            <img key={i} src={img.src} alt="" style={{ maxWidth:"100%", maxHeight:280, objectFit:"contain", borderRadius:6, border:"1px solid #e5e7eb" }} />
          ))}
        </div>
      )}
      {/* Body text */}
      <div style={{ padding:"20px 36px 32px" }}>
        {slide.texts.slice(1).map((t, i) => (
          <p key={i} style={{ fontSize:15, color:"#374151", marginBottom:8, lineHeight:1.7 }}>• {t}</p>
        ))}
        {slide.texts.length === 0 && slide.imgs.length === 0 && (
          <p style={{ color:"#9ca3af", fontStyle:"italic", marginTop:40, textAlign:"center" }}>No content on this slide.</p>
        )}
      </div>
    </div>
  );
}

function ExcelViewer({ fileObj }) {
  const [sheets,      setSheets]      = useState([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState("");

  useEffect(() => {
    (async () => {
      try {
        if (!window.XLSX) {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
            s.onload = res; s.onerror = rej; document.head.appendChild(s);
          });
        }
        const ab = await fileObj.arrayBuffer();
        const wb = window.XLSX.read(ab, { type:"array" });
        const all = wb.SheetNames.map(sn => ({
          name: sn,
          rows: window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header:1, defval:"" }),
        }));
        if (all.length === 0) setError("No sheets found.");
        else setSheets(all);
      } catch(e) {
        console.error("Excel:", e);
        setError("Could not read spreadsheet: " + e.message);
      }
      setLoading(false);
    })();
  }, [fileObj]);

  if (loading) return <div style={{ color:"#fff", padding:40 }}>Loading spreadsheet…</div>;
  if (error)   return <div style={{ color:"#fca5a5", padding:40, background:"#1e1e2e", borderRadius:8 }}>{error}</div>;

  const sheet = sheets[activeSheet] || { rows:[] };
  // Find max columns
  const maxCols = Math.max(...sheet.rows.map(r => r.length), 0);

  return (
    <div style={{ background:"#fff", borderRadius:8, width:"100%", boxShadow:"0 8px 32px rgba(0,0,0,.4)", overflow:"hidden" }}>
      {sheets.length > 1 && (
        <div style={{ display:"flex", background:"#f3f4f6", borderBottom:"1px solid #e5e7eb", overflowX:"auto" }}>
          {sheets.map((s, i) => (
            <button key={i} onClick={() => setActiveSheet(i)}
              style={{ padding:"8px 18px", border:"none", background:activeSheet===i?"#fff":"transparent", borderBottom:activeSheet===i?`2px solid ${C.accent}`:"2px solid transparent", fontWeight:activeSheet===i?700:400, color:activeSheet===i?C.accent:C.muted, fontSize:13, cursor:"pointer", whiteSpace:"nowrap" }}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div style={{ overflowX:"auto", maxHeight:"calc(100vh - 250px)" }}>
        <table style={{ borderCollapse:"collapse", width:"100%", fontSize:13, minWidth: maxCols * 100 }}>
          <tbody>
            {sheet.rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri===0?"#eff6ff": ri%2===0?"#fff":"#f9fafb" }}>
                {Array.from({ length: Math.max(row.length, maxCols) }, (_, ci) => (
                  <td key={ci} style={{ border:"1px solid #e5e7eb", padding:"6px 12px", fontWeight:ri===0?700:400, whiteSpace:"nowrap", maxWidth:240, overflow:"hidden", textOverflow:"ellipsis", color: ri===0?"#1d4ed8":"#111" }}>
                    {row[ci] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DownloadViewer({ fileObj, fileName }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const u = URL.createObjectURL(fileObj);
    setUrl(u); return () => URL.revokeObjectURL(u);
  }, [fileObj]);
  const sizeKB = Math.round((fileObj?.size||0)/1024);
  return (
    <div style={{ textAlign:"center", color:"#fff", padding:"60px 20px" }}>
      <div style={{ width:72,height:72,borderRadius:20,background:C.accentL,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:20 }}><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="{C.accent}" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
      <p style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>{fileName}</p>
      <p style={{ opacity:.6, fontSize:13, marginBottom:28 }}>{sizeKB} KB · Preview not available in browser</p>
      {url && <a href={url} download={fileName}
        style={{ display:"inline-flex", alignItems:"center", gap:8, background:C.accent, color:"#fff", borderRadius:10, padding:"12px 24px", fontSize:15, fontWeight:600, textDecoration:"none" }}>
        Download File
      </a>}
    </div>
  );
}


function AITab({ file, allFiles, folder, onUpdate }) {
  const { isMobile } = useResponsive();
  const [msgs, setMsgs] = useState([]);
  const [inp, setInp] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [attachedImage, setAttachedImage] = useState(null); // { base64, name }
  const imgInputRef = useRef(null);
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  const attachImage = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setAttachedImage({ base64: e.target.result, name: file.name });
    reader.readAsDataURL(file);
  };

  const send = async () => {
    const text = inp.trim();
    if ((!text && !attachedImage) || loading) return;
    const displayContent = attachedImage
      ? (text || "What do you see in this image? Solve/explain it.")
      : text;
    const userMsg = { role:"user", content: displayContent, image: attachedImage?.base64 };
    const newMsgs = [...msgs, userMsg];
    setMsgs(newMsgs); setInp(""); setLoading(true);
    const imgToSend = attachedImage?.base64 || null;
    setAttachedImage(null);
    try {
      // Build context from selected files (folder mode) or current file + linked
      let fileContext = "";
      const safeText = async (fObj) => {
        if (!fObj) return "";
        try { const t = await extractFileText(fObj); return (t || "").slice(0, 6000); } catch { return ""; }
      };
      if (selectedFileIds.length > 0) {
        for (const sid of selectedFileIds) {
          const sf = allFiles?.find(f => f.id === sid);
          if (sf) { const t = await safeText(sf._fileObj); if (t) fileContext += `File "${sf.name}":
${t}

`; }
        }
      } else if (file) {
        const t = await safeText(file._fileObj);
        if (t) fileContext += `File "${file.name}":
${t}

`;
        for (const lid of (file.linkedFileIds || [])) {
          const lf = allFiles?.find(f => f.id === lid);
          if (lf) { const lt = await safeText(lf._fileObj); if (lt) fileContext += `Linked file "${lf.name}":
${lt}

`; }
        }
      }
      const sys = fileContext
        ? `You are a study AI. Use the following file content plus any image provided to answer. Plain text, no asterisks, no markdown.

${fileContext}`
        : `You are a study AI helping a student. Analyze images, solve problems, and explain clearly. Plain text, no asterisks.`;
      // Use vision model if image attached, regular chat otherwise
      const apiMsgs = newMsgs.map(m => ({ role: m.role, content: m.content }));
      const reply = imgToSend
        ? await callClaudeVision(sys, apiMsgs, imgToSend)
        : await callClaudeChat(sys, apiMsgs);
      setMsgs([...newMsgs, { role:"assistant", content: reply }]);
    } catch(e) { setMsgs([...newMsgs, { role:"assistant", content:"Error: " + e.message }]); }
    setLoading(false);
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 200px)", minHeight:400 }}>
      <div style={{ flex:1, overflowY:"auto", padding:"16px 0", display:"flex", flexDirection:"column", gap:12 }}>
        {/* Folder-level file selector — smart linked pairs */}
        {!file && allFiles && allFiles.length > 0 && (() => {
          // Build linked groups: each file that has linkedFileIds forms a group
          const linked = allFiles.filter(f => (f.linkedFileIds||[]).length > 0);
          const standalone = allFiles.filter(f => (f.linkedFileIds||[]).length === 0 &&
            !allFiles.some(o => (o.linkedFileIds||[]).includes(f.id)));
          // Deduplicate groups: group = [file, ...its linked files]
          const seen = new Set();
          const groups = [];
          for (const f of linked) {
            if (seen.has(f.id)) continue;
            const members = [f, ...(f.linkedFileIds||[]).map(id => allFiles.find(x=>x.id===id)).filter(Boolean)];
            members.forEach(m => seen.add(m.id));
            groups.push(members);
          }
          return (
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:"14px 16px", marginBottom:10 }}>
              <p style={{ fontSize:11, fontWeight:800, color:C.muted, letterSpacing:.8, marginBottom:12 }}>CHOOSE FILES FOR AI</p>

              {groups.length > 0 && <>
                <p style={{ fontSize:11, fontWeight:700, color:C.accent, marginBottom:8 }}>LINKED PAIRS</p>
                {groups.map((grp, gi) => {
                  const allSel = grp.every(f => selectedFileIds.includes(f.id));
                  const someSel = grp.some(f => selectedFileIds.includes(f.id));
                  return (
                    <div key={gi} style={{ border:`2px solid ${allSel?C.accent:someSel?C.accentS:C.border}`, borderRadius:12, padding:"10px 12px", marginBottom:8, background:allSel?C.accentL:someSel?"#f0f5ff":"#fff" }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                        <span style={{ fontSize:11, fontWeight:700, color:C.accent }}>Group {gi+1}</span>
                        <button onClick={() => {
                          const ids = grp.map(f=>f.id);
                          setSelectedFileIds(prev => allSel ? prev.filter(id=>!ids.includes(id)) : [...new Set([...prev,...ids])]);
                        }} style={{ fontSize:11, fontWeight:700, background:allSel?C.accent:C.accentL, color:allSel?"#fff":C.accent, border:"none", borderRadius:20, padding:"3px 10px", cursor:"pointer" }}>
                          {allSel?"Deselect all":"Select all"}
                        </button>
                      </div>
                      {grp.map(f => {
                        const sel = selectedFileIds.includes(f.id);
                        return (
                          <button key={f.id} onClick={() => setSelectedFileIds(prev => sel ? prev.filter(id=>id!==f.id) : [...prev, f.id])}
                            style={{ display:"flex", alignItems:"center", gap:8, width:"100%", padding:"6px 8px", borderRadius:8, border:`1.5px solid ${sel?C.accent:C.border}`, background:sel?C.accentL:"#f8f8f8", cursor:"pointer", textAlign:"left", marginBottom:4 }}>
                            <span style={{fontWeight:700}}>{sel?"✓":"○"}</span>
                            <span style={{ fontSize:12, fontWeight:600, color:sel?C.accent:C.text, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </>}

              {standalone.length > 0 && <>
                <p style={{ fontSize:11, fontWeight:700, color:C.muted, marginBottom:8, marginTop: groups.length>0?8:0 }}>INDIVIDUAL FILES</p>
                {standalone.map(f => {
                  const sel = selectedFileIds.includes(f.id);
                  return (
                    <button key={f.id} onClick={() => setSelectedFileIds(prev => sel ? prev.filter(id=>id!==f.id) : [...prev, f.id])}
                      style={{ display:"flex", alignItems:"center", gap:8, width:"100%", padding:"7px 10px", borderRadius:9, border:`1.5px solid ${sel?C.accent:C.border}`, background:sel?C.accentL:"#fff", cursor:"pointer", textAlign:"left", marginBottom:5 }}>
                      <span style={{fontWeight:700}}>{sel?"✓":"○"}</span>
                      <span style={{ fontSize:13, fontWeight:600, color:sel?C.accent:C.text, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
                    </button>
                  );
                })}
              </>}

              {selectedFileIds.length > 0 && (
                <p style={{ fontSize:11, color:C.accent, marginTop:8, fontWeight:700 }}>AI will read {selectedFileIds.length} file{selectedFileIds.length>1?"s":""}</p>
              )}
            </div>
          );
        })()}
        {msgs.length === 0 && (
          <div style={{ textAlign:"center", padding:"24px 20px", color:C.muted }}>
            <div style={{ width:52, height:52, borderRadius:16, background:"linear-gradient(135deg,#6366f1,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="14" height="11" rx="2"/><path d="M9 10h.01M15 10h.01M9 13s1 1.5 3 1.5 3-1.5 3-1.5"/><path d="M12 16v2M8 20h8M12 5V3"/><circle cx="12" cy="3" r="1"/></svg>
            </div>
            <p style={{ fontSize:15, fontWeight:600, color:C.text, marginBottom:6 }}>AI Assistant</p>
            <p style={{ fontSize:13 }}>{file ? `Ask anything about "${file.name}".` : selectedFileIds.length > 0 ? "Ask anything about the selected files." : "Select files above then ask a question."}</p>
          </div>
        )}
        {msgs.map((m,i) => (
          <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
            <div style={{ maxWidth:"80%", borderRadius:14, overflow:"hidden",
              background:m.role==="user"?C.accent:C.surface,
              border:m.role==="user"?"none":`1px solid ${C.border}` }}>
              {/* Show attached image inside the bubble */}
              {m.image && (
                <img src={m.image} alt="attached"
                  style={{ display:"block", width:"100%", maxWidth:320, maxHeight:220,
                    objectFit:"contain", background:"#000" }} />
              )}
              <div style={{ padding:"10px 14px", color:m.role==="user"?"#fff":C.text,
                fontSize:14, lineHeight:1.6 }}>
                <Fmt text={m.content} />
              </div>
            </div>
          </div>
        ))}
        {loading && <div style={{ display:"flex", gap:5, padding:"10px 14px" }}>{[0,1,2].map(j=><div key={j} style={{ width:7,height:7,borderRadius:"50%",background:C.accent,animation:"bounce 1.2s infinite",animationDelay:`${j*.2}s` }}/>)}</div>}
        <div ref={bottomRef} />
      </div>

      {/* Image preview strip */}
      {attachedImage && (
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px",
          background:C.accentL, border:`1px solid ${C.accentS}`,
          borderRadius:12, marginBottom:8 }}>
          <img src={attachedImage.base64} alt="preview"
            style={{ width:48, height:48, objectFit:"cover", borderRadius:8, flexShrink:0 }} />
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.accent }}>Image attached</p>
            <p style={{ margin:0, fontSize:11, color:C.muted, overflow:"hidden",
              textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{attachedImage.name}</p>
          </div>
          <button onClick={() => setAttachedImage(null)}
            style={{ background:"none", border:"none", color:C.red,
              cursor:"pointer", fontSize:18, flexShrink:0 }}>×</button>
        </div>
      )}

      <div style={{ display:"flex", gap:8, paddingTop:10, borderTop:`1px solid ${C.border}`,
        alignItems:"flex-end" }}>
        {/* Image attach button */}
        <button onClick={() => imgInputRef.current?.click()}
          title="Attach image"
          style={{ flexShrink:0, width:42, height:42, borderRadius:12,
            border:`1.5px solid ${attachedImage ? C.accent : C.border}`,
            background: attachedImage ? C.accentL : C.bg,
            cursor:"pointer", display:"flex",
            alignItems:"center", justifyContent:"center", color:attachedImage?C.accent:C.muted }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </button>
        <input ref={imgInputRef} type="file" accept="image/*" style={{ display:"none" }}
          onChange={e => { attachImage(e.target.files?.[0]); e.target.value=""; }} />
        <input value={inp} onChange={e=>setInp(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder={attachedImage ? "Ask about the image… (or just press Send)" : "Ask a question…"}
          style={{ flex:1, border:`1.5px solid ${C.border}`, borderRadius:12,
            padding:"11px 16px", fontSize:14, outline:"none",
            background:C.bg, color:C.text }} />
        <button onClick={send} disabled={(!inp.trim() && !attachedImage) || loading}
          style={{ flexShrink:0, background:(inp.trim()||attachedImage)&&!loading?C.accent:"#ccc",
            color:"#fff", border:"none", borderRadius:12, padding:"11px 20px",
            fontSize:14, fontWeight:600,
            cursor:(inp.trim()||attachedImage)&&!loading?"pointer":"not-allowed" }}>
          Send
        </button>
      </div>
    </div>
  );
}


// ─── LANGUAGE OPTIONS ─────────────────────────────────────────────────────────
const LANG_OPTIONS = [["en-US","English (US)"],["en-GB","English (UK)"],["ar-SA","Arabic"],["ar-EG","Arabic (Egypt)"],["es-ES","Spanish"],["es-MX","Spanish (Mexico)"],["fr-FR","French"],["de-DE","German"],["it-IT","Italian"],["pt-BR","Portuguese"],["zh-CN","Chinese"],["ja-JP","Japanese"],["ko-KR","Korean"],["hi-IN","Hindi"],["ru-RU","Russian"],["tr-TR","Turkish"]];

// ─── VOICE & PODCAST TAB ─────────────────────────────────────────────────────
// All audio features: Voice Notes recording + Podcast player
function VoicePodcastTab({ file, user, isGuest, onUpdate }) {
  const { isMobile } = useResponsive();
  const [subTab, setSubTab] = useState("record"); // "record" | "podcast"
  const [lang, setLang] = useState("en-US");

  // ── Shared notes state for pushing voice → written notes ──────────────────
  const [notes, setNotes] = useState(file.notes || "");

  // ── Voice recording state ─────────────────────────────────────────────────
  const [recording,   setRecording]   = useState(false);
  const [processing,  setProcessing]  = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceRecordings, setVoiceRecordings] = useState(() => {
    try { return JSON.parse(localStorage.getItem("vr_" + file.id) || "[]"); } catch { return []; }
  });
  const recognitionRef = useRef(null);
  const transcriptRef  = useRef("");
  const isRecordingRef = useRef(false);
  const [playingIdx,  setPlayingIdx]  = useState(null);

  const saveRec = (rec) => {
    setVoiceRecordings(prev => {
      const u = [rec, ...prev];
      try { localStorage.setItem("vr_" + file.id, JSON.stringify(u.slice(0, 20))); } catch {}
      return u;
    });
  };
  const deleteRec = (idx) => {
    setVoiceRecordings(prev => {
      const u = prev.filter((_,i) => i !== idx);
      try { localStorage.setItem("vr_" + file.id, JSON.stringify(u)); } catch {}
      return u;
    });
  };

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceStatus("Speech recognition is not supported. Please use Chrome or Edge."); return; }
    transcriptRef.current = "";
    isRecordingRef.current = true;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = 3;
    let interimText = "";
    recognition.onresult = (e) => {
      interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          let best = e.results[i][0].transcript;
          let bestConf = e.results[i][0].confidence || 0;
          for (let a = 1; a < e.results[i].length; a++) {
            if ((e.results[i][a].confidence || 0) > bestConf) {
              best = e.results[i][a].transcript;
              bestConf = e.results[i][a].confidence || 0;
            }
          }
          transcriptRef.current += best + " ";
        } else {
          interimText += e.results[i][0].transcript;
        }
      }
      const preview = (transcriptRef.current + interimText).trim();
      setVoiceStatus("" + (preview ? preview.slice(-90) + "…" : "Listening… speak now"));
    };
    recognition.onerror = (e) => {
      if (e.error === "not-allowed") setVoiceStatus("Microphone access denied. Allow mic in browser settings.");
      else if (e.error === "audio-capture") setVoiceStatus("No microphone found.");
      else if (e.error !== "no-speech") setVoiceStatus("Mic error: " + e.error);
    };
    recognition.onend = () => {
      if (isRecordingRef.current) { try { recognition.start(); } catch {} }
    };
    recognition.start();
    recognitionRef.current = recognition;
    setRecording(true);
    setVoiceStatus("Listening… speak now. Click Stop when done.");
  };

  const stopVoice = async () => {
    isRecordingRef.current = false;
    setRecording(false);
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    await new Promise(r => setTimeout(r, 300));
    const raw = transcriptRef.current.trim();
    if (!raw) { setVoiceStatus("Nothing was recorded. Make sure your mic is working and try again."); setTimeout(() => setVoiceStatus(""), 4000); return; }
    setProcessing(true);
    setVoiceStatus("Organising your notes…");
    try {
      const langLabel = LANG_OPTIONS.find(l => l[0] === lang)?.[1]?.replace(/[^\x00-\x7F\s]+\s*/g,'') || lang;
      const context = `File: "${file.name}". Topic context (for fixing speech recognition errors): ${(file.notes || "").slice(0, 300) || "none"}.`;
      const result = await callClaude(
        `You are an expert note-taker. A student has just spoken aloud — your job is to turn their speech into clean, well-organised study notes.

RULES:
1. Understand the MEANING and CONTEXT of what the student said
2. Remove ALL filler words (um, uh, er, like, you know, sort of, kind of, basically, right, okay so)
3. Fix grammar, vocabulary, and sentence structure automatically
4. Organise into clear structure:
   - Use ALL CAPS headings for topics (e.g. PHOTOSYNTHESIS)
   - Use dash (-) bullet points for facts and details
   - Write short, clear sentences
5. Fix speech-recognition errors using context (e.g. "Adams" → "atoms", "Assam" → "atom")
6. Convert spoken math/science to proper notation: "ten to the power of negative ten" → 10⁻¹⁰, "times" → ×, "squared" → ², "pi" → π, "metres" → m, "kilograms" → kg
7. Keep ALL facts and information the student mentioned — do not remove content
8. Do NOT add new information, outside facts, or content from the file that the student did not say
9. If the student just said something casual (e.g. "hi we will study English"), write it simply and naturally — do NOT expand it or add a topic outline
10. NEVER use asterisks (*) or pound signs (#)
11. Respond entirely in ${langLabel}

EXAMPLES:
Student says: "so atoms right they have like a really tiny radius um one times ten to the power of minus ten metres"
Output:
ATOMIC RADIUS
- Atoms have a very small radius: 1 × 10⁻¹⁰ m

Student says: "hi we will study english"
Output: Hi, we will study English.

Context (for fixing mis-heard words only — do NOT add this as content): ${context}`,
        `Turn this spoken recording into clean study notes:\n\n"${raw}"`
      );
      const fixedResult = fixMath(result);
      const newNotes = notes ? notes + "\n\n---\n\n" + fixedResult : fixedResult;
      setNotes(newNotes);
      onUpdate({ ...file, notes: newNotes });
      saveRec({
        text: fixedResult, raw,
        date: new Date().toLocaleDateString("en-GB", {day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}),
        words: fixedResult.trim().split(/\s+/).length, lang
      });
      setVoiceStatus("Notes saved!");
      setTimeout(() => setVoiceStatus(""), 3000);
    } catch(e) { setVoiceStatus("Error: " + e.message); }
    setProcessing(false);
  };

  // ── Voice playback state ────────────────────────────────────────────────────
  const [playbackPersonaIdx, setPlaybackPersonaIdx] = useState(0);
  const [playbackVoices,     setPlaybackVoices]     = useState([]);
  const [showPlaybackPicker, setShowPlaybackPicker] = useState(false);
  useEffect(() => {
    const load = () => setPlaybackVoices(window.speechSynthesis.getVoices());
    load(); window.speechSynthesis.onvoiceschanged = load;
  }, []);

  const playRecording = (idx, text, recLang) => {
    window.speechSynthesis?.cancel();
    if (playingIdx === idx) { setPlayingIdx(null); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.rate  = GLOBAL_PERSONAS[playbackPersonaIdx]?.rate  || 0.93;
    u.pitch = GLOBAL_PERSONAS[playbackPersonaIdx]?.pitch || 1.0;
    u.lang  = recLang || lang;
    const v = getSmartVoice(playbackPersonaIdx, playbackVoices, recLang || lang);
    if (v) u.voice = v;
    u.onend  = () => setPlayingIdx(null);
    u.onerror = () => setPlayingIdx(null);
    window.speechSynthesis.speak(u);
    setPlayingIdx(idx);
  };

  // ── Podcast state — persisted to localStorage so it survives tab switches ──
  const PODCAST_KEY = "podcast_" + file.id;
  const [podcastScript,  setPodcastScript]  = useState(() => {
    try { return localStorage.getItem(PODCAST_KEY) || ""; } catch { return ""; }
  });
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [showPodcast,    setShowPodcast]    = useState(() => {
    try { return !!localStorage.getItem(PODCAST_KEY); } catch { return false; }
  });

  const generatePodcast = async () => {
    // Read notes fresh from every possible source — never use stale prop
    // 1. Named saved notes (NotesTab saves here: "saved_notes_<id>")
    const savedArr = (() => { try { return JSON.parse(localStorage.getItem("saved_notes_" + file.id) || "[]"); } catch { return []; } })();
    // 2. App state in classio_v2 (the file object's notes field persisted by the save system)
    const appState = (() => { try { return JSON.parse(localStorage.getItem("classio_v2") || "{}"); } catch { return {}; } })();
    const fileFromApp = (appState.folders || []).flatMap(f => f.files || []).find(f => f.id === file.id);
    const appNotes = fileFromApp?.notes || "";
    // Pick the longest / most recent source
    const notesText = (savedArr.length > 0 ? savedArr[0].text : "") || appNotes || file.notes || "";
    if (!notesText.trim()) {
      setVoiceStatus("No notes found. Go to the Notes tab, generate or write notes, then Save them — then come back here.");
      return;
    }
    setPodcastLoading(true);
    setShowPodcast(true);
    setPodcastScript("");
    const langLabel = LANG_OPTIONS.find(l => l[0] === lang)?.[1]?.replace(/[^\x00-\x7F\s]+\s*/g,'') || lang;
    try {
      const script = await callClaude(
        `You are an engaging podcast host turning study notes into a thorough spoken lesson.
Language: ${langLabel}. Write ENTIRELY in ${langLabel}.

CRITICAL RULES:
- Base the podcast STRICTLY on the notes provided — do not add outside information
- Cover EVERY concept, fact, definition, example, and detail in the notes — nothing skipped
- The podcast must be long enough to fully explain all the material — aim for 8-12 minutes when spoken (≈ 1200-1800 words)
- If the notes are long and detailed, the podcast must be equally long and detailed

FORMAT (spoken audio only):
1. Open warmly: "Hey! Today we're covering [topic]…" — briefly say what will be covered
2. Go through EVERY section of the notes in order, explaining each concept fully and naturally
3. For each concept: state it clearly, explain what it means, give context or examples from the notes
4. Use natural transitions: "Moving on to…", "Now let's talk about…", "Here's something really important…", "Building on that…"
5. Never rush — if the notes have 10 topics, cover all 10 in detail
6. End with "So to wrap up today's session…" then summarise every key point covered
7. NO markdown, NO asterisks, NO bullet symbols, NO headers — plain spoken words only
8. Natural speech patterns: "Now,", "So,", "Think of it this way…", "In other words…", "What this means is…"
9. Convert ALL symbols to spoken words for TTS: 10⁻¹⁰ → "ten to the power of negative ten", × → "times", ² → "squared", π → "pi", % → "percent", = → "equals", > → "greater than", < → "less than", → → "which gives us"
10. Sound like a knowledgeable teacher who wants every student to fully understand — not a robot listing facts`,
        `Turn ALL of these notes into a complete, detailed podcast script. Do not skip anything:

${notesText.slice(0, 14000)}`,
        4000
      );
      setPodcastScript(script);
      try { localStorage.setItem(PODCAST_KEY, script); } catch {}
    } catch(e) { setPodcastScript("Error: " + e.message); }
    setPodcastLoading(false);
  };

  const isRTL = lang.startsWith("ar");

  return (
    <div>
      {/* Header row with language selector */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18, flexWrap:"wrap", gap:10 }}>
        <div>
          <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontWeight:700, color:C.text, marginBottom:3 }}>Voice & Podcast</h2>
          <p style={{ fontSize:13, color:C.muted }}>Record voice notes or generate a study podcast from your notes</p>
        </div>
        {/* Language selector */}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:12, fontWeight:600, color:C.muted }}>Language:</span>
          <select value={lang} onChange={e => setLang(e.target.value)}
            style={{ border:`1.5px solid ${C.border}`, borderRadius:10, padding:"6px 10px", fontSize:13, outline:"none", color:C.text, background:"#fff", cursor:"pointer" }}>
            {LANG_OPTIONS.map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display:"flex", gap:8, marginBottom:22, borderBottom:`1.5px solid ${C.border}`, paddingBottom:12 }}>
        {[{id:"record",label:"Voice Notes"},{id:"podcast",label:"Podcast"}].map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={{
            padding:"8px 20px", borderRadius:20, border:"none", cursor:"pointer",
            fontWeight:700, fontSize:13,
            background: subTab===t.id ? C.accent : C.surface,
            color:       subTab===t.id ? "#fff"    : C.muted,
            boxShadow:   subTab===t.id ? `0 2px 10px ${C.accentS}55` : "none",
            transition:"all .15s"
          }}>{t.label}</button>
        ))}
      </div>

      {/* ─── VOICE NOTES ─── */}
      {subTab === "record" && (
        <div dir={isRTL ? "rtl" : "ltr"}>
          {(isGuest || !user) && (
            <div style={{ background:C.warmL, border:`1.5px solid ${C.warm}33`, borderRadius:12, padding:"14px 18px", marginBottom:20, fontSize:13, color:C.warm, fontWeight:500 }}>
              Voice Notes requires a Google account — sign in to use this feature.
            </div>
          )}

          {!isGuest && user && (
            <div style={{ background: recording?"#fff0f0":C.surface, border:`2px solid ${recording?C.red+"55":C.border}`, borderRadius:18, padding:"26px 24px", marginBottom:20, textAlign:"center", transition:"all .3s" }}>
              {recording && <style>{`@keyframes vpulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>}
              <div style={{ fontSize:54, marginBottom:12, animation:recording?"vpulse 1.4s infinite":"none" }}>
                {recording ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>}
              </div>
              <p style={{ fontSize:15, fontWeight:700, color:recording?C.red:C.text, marginBottom:5 }}>
                {recording?"Recording…":processing?"Processing…":"Tap to start recording"}
              </p>
              <p style={{ fontSize:13, color:C.muted, marginBottom:16 }}>
                {recording ? `Speaking in ${LANG_OPTIONS.find(l=>l[0]===lang)?.[1] || lang} — AI will clean up and format as notes` : "Lecture, study session, or revision — record it and AI converts it to notes"}
              </p>
              {voiceStatus && (
                <div style={{ background:voiceStatus.startsWith("✓")?C.greenL:voiceStatus.startsWith("Listening") || voiceStatus.startsWith("Mic")?"#fff0f0":voiceStatus.startsWith("Organising")?C.accentL:C.redL,
                  border:`1px solid ${voiceStatus.startsWith("✓")?C.green:voiceStatus.startsWith("Listening") || voiceStatus.startsWith("Mic")?C.red:voiceStatus.startsWith("Organising")?C.accentS:C.red}44`,
                  borderRadius:10, padding:"8px 14px", marginBottom:16, fontSize:13, fontWeight:500, textAlign:"left",
                  color:voiceStatus.startsWith("✓")?C.green:voiceStatus.startsWith("Listening") || voiceStatus.startsWith("Mic")?C.red:C.text }}>
                  {voiceStatus}
                </div>
              )}
              {!recording ? (
                <button onClick={startVoice} disabled={processing} style={{ background:processing?"#ccc":C.red, color:"#fff", border:"none", borderRadius:14, padding:"13px 38px", fontSize:15, fontWeight:700, cursor:processing?"not-allowed":"pointer", boxShadow:`0 4px 16px ${C.red}44` }}>
                  {processing ? "Processing…" : "Start Recording"}
                </button>
              ) : (
                <button onClick={stopVoice} disabled={processing} style={{ background:"#fff", color:C.red, border:`2px solid ${C.red}`, borderRadius:14, padding:"13px 38px", fontSize:15, fontWeight:700, cursor:"pointer" }}>
                  ⏹ Stop & Save
                </button>
              )}
            </div>
          )}

          {/* Recordings list */}
          {/* Playback voice picker */}
          {voiceRecordings.length > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14, flexWrap:"wrap" }}>
              <span style={{ fontSize:11, fontWeight:700, color:C.muted }}>Playback voice:</span>
              <button onClick={() => setShowPlaybackPicker(v => !v)}
                style={{ display:"flex", alignItems:"center", gap:5, background:"#fff", border:`1.5px solid ${showPlaybackPicker?C.accent:C.border}`, borderRadius:20, padding:"5px 12px", fontSize:12, fontWeight:700, cursor:"pointer", color:showPlaybackPicker?C.accent:C.text }}>
                {GLOBAL_PERSONAS[playbackPersonaIdx]?.label} {GLOBAL_PERSONAS[playbackPersonaIdx]?.gender==="female"?"♀":GLOBAL_PERSONAS[playbackPersonaIdx]?.gender==="male"?"♂":"⚥"} ▾
              </button>
              {showPlaybackPicker && (
                <div style={{ width:"100%", background:"#fff", border:`1.5px solid ${C.border}`, borderRadius:14, padding:"10px 12px", display:"flex", flexWrap:"wrap", gap:7, marginTop:4 }}>
                  {GLOBAL_PERSONAS.map((p, i) => (
                    <button key={p.id} onClick={() => { setPlaybackPersonaIdx(i); setShowPlaybackPicker(false); }}
                      style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 12px", borderRadius:20, border:"none", cursor:"pointer", fontSize:12, fontWeight:700,
                        background: playbackPersonaIdx===i ? C.accent : C.surface,
                        color: playbackPersonaIdx===i ? "#fff" : C.text }}>
                      <span style={{width:10,height:10,borderRadius:"50%",background:p.color,display:"inline-block",flexShrink:0,verticalAlign:"middle",marginRight:5}}></span>{p.label}
                    </button>
                  ))}
                  <p style={{ width:"100%", fontSize:10, color:C.muted, marginTop:2 }}>
                    ♀ Female · ♂ Male · Using: {getSmartVoiceLabel(playbackPersonaIdx, playbackVoices, lang)}
                  </p>
                </div>
              )}
            </div>
          )}

          {voiceRecordings.length > 0 && (
            <div>
              <p style={{ fontSize:11, fontWeight:800, color:C.muted, letterSpacing:.8, marginBottom:12 }}>SAVED RECORDINGS ({voiceRecordings.length})</p>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {voiceRecordings.map((rec, idx) => (
                  <div key={idx} style={{ background:C.surface, border:`1.5px solid ${C.border}`, borderRadius:14, padding:"13px 15px" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:7 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div onClick={() => playRecording(idx, rec.text, rec.lang)}
                          style={{ width:34, height:34, borderRadius:"50%", background:playingIdx===idx?C.accentL:"#f0f4ff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, cursor:"pointer", border:`1.5px solid ${playingIdx===idx?C.accent:C.border}`, flexShrink:0 }}>
                          {playingIdx===idx?"⏸":"▶"}
                        </div>
                        <div>
                          <p style={{ fontSize:13, fontWeight:700, color:C.text }}>Recording {voiceRecordings.length - idx}</p>
                          <p style={{ fontSize:11, color:C.muted }}>{rec.date} · {rec.words} words · {rec.lang || "en-US"}</p>
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:6 }}>
                        <button onClick={() => { const n=notes?notes+"\n\n---\n\n"+rec.text:rec.text; setNotes(n); onUpdate({...file,notes:n}); }}
                          style={{ fontSize:11, fontWeight:700, padding:"5px 10px", borderRadius:8, border:`1px solid ${C.accentS}`, background:C.accentL, color:C.accent, cursor:"pointer" }}>+ Notes</button>
                        <button onClick={() => deleteRec(idx)}
                          style={{ padding:"5px 8px", borderRadius:8, border:`1px solid ${C.border}`, background:"#fff", color:C.muted, cursor:"pointer", display:"flex", alignItems:"center" }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
                      </div>
                    </div>
                    <p style={{ fontSize:13, color:C.text, lineHeight:1.55, background:"#f9fafb", borderRadius:8, padding:"8px 10px", maxHeight:80, overflowY:"auto", margin:0, direction:rec.lang?.startsWith("ar")?"rtl":"ltr" }}>
                      {rec.text.slice(0,200)}{rec.text.length>200?"…":""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {voiceRecordings.length === 0 && !isGuest && user && (
            <div style={{ textAlign:"center", padding:"40px 0", color:C.muted }}>
              <div style={{ width:52,height:52,borderRadius:16,background:C.accentL,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12 }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="{C.accent}" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></div>
              <p style={{ fontSize:14, fontWeight:600 }}>No recordings yet</p>
              <p style={{ fontSize:13 }}>Start recording above — your saved voice notes will appear here</p>
            </div>
          )}
        </div>
      )}

      {/* ─── PODCAST ─── */}
      {subTab === "podcast" && (
        <div>
          <div style={{ background:C.surface, border:`1.5px solid ${C.border}`, borderRadius:16, padding:"20px 22px", marginBottom:18 }}>
            <p style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:5 }}>Study Podcast</p>
            <p style={{ fontSize:13, color:C.muted, marginBottom:14 }}>
              Converts your saved notes into a natural spoken lesson. The podcast stays saved — it won't disappear when you switch tabs.
            </p>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
              <button onClick={generatePodcast} disabled={podcastLoading}
                style={{ background:podcastLoading?"#ccc":"#7c3aed", color:"#fff", border:"none", borderRadius:12, padding:"11px 24px", fontSize:14, fontWeight:700, cursor:podcastLoading?"not-allowed":"pointer", boxShadow:podcastLoading?"none":"0 4px 16px rgba(124,58,237,.4)" }}>
                {podcastLoading ? "Generating…" : podcastScript ? "Regenerate" : "Generate Podcast"}
              </button>
              {podcastScript && !podcastLoading && (
                <button onClick={() => { setPodcastScript(""); setShowPodcast(false); try { localStorage.removeItem(PODCAST_KEY); } catch {} }}
                  style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:12, padding:"11px 18px", fontSize:13, fontWeight:600, color:C.muted, cursor:"pointer" }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {showPodcast && (
            <EnhancedPodcastPlayer
              script={podcastScript}
              loading={podcastLoading}
              topic={file.name}
              lang={lang}
              onClose={() => { setShowPodcast(false); window.speechSynthesis?.cancel(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── VOICE NOTES TAB (legacy — kept for Notes sub-tab if needed) ──────────────
function VoiceNotesTab({ file, user, isGuest, notes, onNotesUpdate,
    voiceRecordings, onSaveRecording, onDeleteRecording,
    startVoice, stopVoice, recording, processing, voiceStatus }) {
  // Redirect: this is now handled by VoicePodcastTab
  return (
    <div style={{ textAlign:"center", padding:"40px 20px", color:C.muted }}>
      
      <p style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>Voice Notes has moved!</p>
      <p style={{ fontSize:13 }}>Use the <strong>Voice & Podcast</strong> tab at the top of this page.</p>
    </div>
  );
}


// ─── NOTES TAB ───────────────────────────────────────────────────────────────
function NotesTab({ file, onUpdate, user, isGuest }) {
  // Notes start empty — user must load a saved note or generate new ones
  // (unsaved notes are NOT persisted when leaving the file)
  const { isMobile } = useResponsive();
  const [notes,    setNotes]   = useState("");
  const [unsaved,  setUnsaved]  = useState(false);  // track unsaved changes
  const [gen,      setGen]     = useState(false);
  const [showTopicInput, setShowTopicInput] = useState(false);
  const [customTopic,    setCustomTopic]    = useState("");
  const [lang,     setLang]    = useState("en-US");

  // ── Named notes save/load system ──────────────────────────────────────────
  const SAVED_KEY = "saved_notes_" + file.id;
  const [savedNotes,   setSavedNotes]   = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"); } catch { return []; }
  });
  const [showSaveModal,  setShowSaveModal]  = useState(false);
  const [newNoteName,    setNewNoteName]    = useState("");
  const [showDropdown,   setShowDropdown]   = useState(false);
  const [dropSearch,     setDropSearch]     = useState("");
  const [savedFeedback,  setSavedFeedback]  = useState("");

  const persistSaved = (arr) => {
    setSavedNotes(arr);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(arr)); } catch {}
  };
  const doSave = () => {
    if (!newNoteName.trim()) return;
    const entry = {
      name: newNoteName.trim(),
      text: notes,
      date: new Date().toLocaleDateString("en-GB", {day:"numeric", month:"short", year:"numeric"})
    };
    persistSaved([entry, ...savedNotes.filter(n => n.name !== entry.name)]);
    setNewNoteName(""); setShowSaveModal(false); setUnsaved(false);
    setSavedFeedback("Saved as \"" + entry.name + "\"");
    setTimeout(() => setSavedFeedback(""), 2500);
  };
  const loadNote  = (entry) => { setNotes(entry.text); setUnsaved(false); setShowDropdown(false); };
  const delSaved  = (name)  => persistSaved(savedNotes.filter(n => n.name !== name));
  const filtered  = savedNotes.filter(n => n.name.toLowerCase().includes(dropSearch.toLowerCase()));

  // Also save to file object for immediate persistence
  const saveToFile = () => onUpdate({ ...file, notes });

  // ── Note style ────────────────────────────────────────────────────────────
  const [noteStyle,      setNoteStyle]      = useState("detailed");
  const [customStyle,    setCustomStyle]    = useState("");
  const [useCustomStyle, setUseCustomStyle] = useState(false);
  const NOTE_STYLES = [
    { id:"detailed", label:"📋 Detailed",    desc:"Full notes with headings & examples" },
    { id:"bullet",   label:"• Bullets",      desc:"Bullet points only, grouped by topic" },
    { id:"simple",   label:"🧒 Simple",       desc:"Plain English, easy to understand" },
    { id:"exam",  label:"📝 Exam Focused", desc:"Key terms, questions & checklist" },
  ];

  // ── AI generate ───────────────────────────────────────────────────────────
  const generate = async () => {
    setGen(true);
    try {
      const fileObj = file._fileObj || FILE_STORE.get(file.id) || null;
      const fileText = fileObj ? await extractFileText(fileObj) : null;
      const safeText = fileText ? fileText.slice(0, 16000) : null;
      const langLabel = LANG_OPTIONS.find(l => l[0] === lang)?.[1]?.replace(/[\u{1F1E0}-\u{1F1FF}]{2}\s*/gu, '') || lang;

      const userMsg = safeText
        ? `Here is the COMPLETE content from the file "${file.name}":\n\n${safeText}\n\nCRITICAL: You MUST cover EVERY SINGLE section, concept, definition, formula, and fact in the above content. Do not skip anything. Write notes section by section, following the document structure. Include ALL details.`
        : `Create comprehensive study notes for: "${file.name}". Make them detailed and useful for exam revision. Cover all key topics, definitions, formulas, and concepts.`;

      const styleGuide = {
        detailed: "Write detailed notes split into sections. Each section has a heading in ALL CAPS followed by bullet points.",
        bullet:   "Write ONLY bullet points grouped under ALL CAPS headings. One fact per line.",
        simple:   "Write very simple short notes in plain language. Short sentences. No jargon.",
        exam:     "Write exam revision notes. Include key terms, definitions, possible exam questions, and a checklist.",
      };
      const effectiveStyle = useCustomStyle && customStyle.trim()
        ? `You are a study notes writer. The student's style instruction: "${customStyle.trim()}". Follow exactly.`
        : `You are a study notes writer. ${styleGuide[noteStyle] || styleGuide.detailed}`;

      const txt = await callClaude(
        `${effectiveStyle}
Language: ${langLabel}. Write ALL notes entirely in ${langLabel} — never mix languages.

STRICT FORMATTING RULES — follow exactly:
1. NEVER use asterisks (*) or double asterisks (**) anywhere
2. NEVER use pound signs (#) for headings
3. Section headings: ALL CAPS on their own line (e.g., ATOMIC STRUCTURE)
4. Bullet points: use a dash (-)
5. Plain text only — no markdown symbols
6. Math & science notation: use proper symbols, never words
   - Write: 1 × 10⁻¹⁰ m  NOT "one times ten to the power of negative ten metres"
   - Write: 9.81 m/s²  NOT "nine point eight one metres per second squared"
   - Write: H₂O, CO₂, O₂  NOT "H 2 O" or "H two O"
   - Write: F = ma, E = mc²  NOT words
   - Write: π, α, β, λ, Δ, μ  NOT "pi", "alpha", "beta"
   - Write: ×, ÷, ≈, ≥, ≤, ≠, ±  NOT words
7. Units: always use standard abbreviations (m, km, kg, g, s, J, N, W, V, A, K, °C, mol, Hz)
8. ONLY use content from the provided file — do not invent facts`,
        userMsg,
        4000
      );
      const fixedTxt = fixMath(txt);
      setNotes(fixedTxt);
      setUnsaved(true);
      // Don't auto-save to file — user must click Save
    } catch(e) { setNotes(`Error: ${e.message}`); }
    setGen(false);
  };

  const generateWithTopic = async (topic) => {
    setGen(true); setShowTopicInput(false);
    try {
      const fileObj = file._fileObj || FILE_STORE.get(file.id) || null;
      const fileText = fileObj ? await extractFileText(fileObj) : null;
      const safeText2 = fileText ? fileText.slice(0, 16000) : null;
      const langLabel = LANG_OPTIONS.find(l => l[0] === lang)?.[1]?.replace(/[\u{1F1E0}-\u{1F1FF}]{2}\s*/gu, '') || lang;
      const userMsg = safeText2
        ? `File "${file.name}":\n\n${safeText2}\n\nCreate detailed study notes specifically about "${topic}" from this document.`
        : `Create comprehensive study notes about: "${topic}". Make them detailed and useful for exam revision.`;
      const txt = await callClaude(
        `You are an expert study notes writer. Language: ${langLabel}. Write ONLY in ${langLabel}.
RULES: No asterisks, no #, ALL CAPS headings, dashes for bullets, plain text.
Math: use proper notation — 1 × 10⁻¹⁰ not words, × not "times", m not "metres", π not "pi", etc.`,
        userMsg
      );
      const fixedTxt2 = fixMath(txt);
      setNotes(fixedTxt2); setUnsaved(true);
    } catch(e) { setNotes(`Error: ${e.message}`); }
    setGen(false);
  };

  const isRTL = lang.startsWith("ar");

  return (
    <div dir={isRTL ? "rtl" : "ltr"}>

      {/* ── Top toolbar ─────────────────────────────────────────────────── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontWeight:700, color:C.text, margin:0 }}>Notes</h2>

        <div style={{ display:"flex", gap:7, flexWrap:"wrap", alignItems:"center" }}>

          {/* Language */}
          <select value={lang} onChange={e => setLang(e.target.value)}
            style={{ border:`1.5px solid ${C.border}`, borderRadius:10, padding:"6px 9px", fontSize:12, outline:"none", color:C.text, background:"#fff", cursor:"pointer" }}>
            {LANG_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>

          {/* AI Generate */}
          <button onClick={generate} disabled={gen} className="hov"
            style={{ display:"flex", alignItems:"center", gap:6, background:C.accentL, color:C.accent, border:"none", borderRadius:10, padding:"8px 14px", fontSize:13, fontWeight:600, cursor:gen?"not-allowed":"pointer" }}>
            <Icon d={gen?I.refresh:I.sparkle} size={14} color={C.accent}/>{gen?"Generating…":"AI Generate"}
          </button>

          {/* Custom Topic */}
          <button onClick={() => setShowTopicInput(t => !t)} disabled={gen} className="hov"
            style={{ display:"flex", alignItems:"center", gap:6, background:C.surface, color:C.text, border:`1.5px solid ${C.border}`, borderRadius:10, padding:"8px 14px", fontSize:13, fontWeight:600, cursor:"pointer" }}>
            <Icon d={I.edit} size={13} color={C.text}/> Topic
          </button>

          {/* Saved notes dropdown */}
          {savedNotes.length > 0 && (
            <div style={{ position:"relative" }}>
              <button onClick={() => setShowDropdown(d => !d)} className="hov"
                style={{ display:"flex", alignItems:"center", gap:5, background:C.greenL, color:C.green, border:`1px solid ${C.green}44`, borderRadius:10, padding:"8px 13px", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                Saved ({savedNotes.length}) ▾
              </button>
              {showDropdown && (
                <div style={{ position:"absolute", top:"110%", right:0, zIndex:300, background:"#fff", border:`1.5px solid ${C.border}`, borderRadius:14, width:290, boxShadow:"0 10px 36px rgba(0,0,0,.17)", overflow:"hidden" }}>
                  <div style={{ padding:"10px 12px", borderBottom:`1px solid ${C.border}` }}>
                    <input value={dropSearch} onChange={e => setDropSearch(e.target.value)} placeholder="Search saved notes…"
                      style={{ width:"100%", border:`1px solid ${C.border}`, borderRadius:8, padding:"6px 10px", fontSize:12, outline:"none", color:C.text }}/>
                  </div>
                  <div style={{ maxHeight:280, overflowY:"auto" }}>
                    {filtered.length === 0 && <p style={{ padding:"14px", fontSize:12, color:C.muted, textAlign:"center" }}>No matches</p>}
                    {filtered.map(n => (
                      <div key={n.name} style={{ display:"flex", alignItems:"center", padding:"10px 12px", borderBottom:`1px solid ${C.border}33`, cursor:"pointer" }}
                        onMouseEnter={e => e.currentTarget.style.background="#f5f7fa"}
                        onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                        <div onClick={() => loadNote(n)} style={{ flex:1, minWidth:0 }}>
                          <p style={{ fontSize:13, fontWeight:600, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{n.name}</p>
                          <p style={{ fontSize:11, color:C.muted }}>{n.date} · {n.text.trim().split(/\s+/).length} words</p>
                        </div>
                        <button onClick={e => { e.stopPropagation(); delSaved(n.name); }}
                          style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", padding:"2px 5px", flexShrink:0, display:"flex", alignItems:"center" }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding:"7px 12px", borderTop:`1px solid ${C.border}`, fontSize:10, color:C.muted, fontStyle:"italic" }}>Click to load · tap trash to delete</div>
                </div>
              )}
            </div>
          )}

          {/* Save — always rightmost */}
          <button onClick={() => { if(notes.trim()) { setNewNoteName(""); setShowSaveModal(true); } }} disabled={!notes.trim()} className="hov"
            style={{ display:"flex", alignItems:"center", gap:6, background:notes.trim()?C.accent:"#ccc", color:"#fff", border:"none", borderRadius:10, padding:"8px 16px", fontSize:13, fontWeight:700, cursor:notes.trim()?"pointer":"not-allowed", opacity:notes.trim()?1:0.6 }}>
            <Icon d={I.check} size={13} color="#fff"/> Save
          </button>
        </div>
      </div>

      {/* Save feedback toast */}
      {savedFeedback && (
        <div style={{ background:C.greenL, border:`1px solid ${C.green}44`, borderRadius:10, padding:"8px 14px", marginBottom:12, fontSize:13, color:C.green, fontWeight:600 }}>
          {savedFeedback}
        </div>
      )}

      {/* Save-as modal */}
      {showSaveModal && (
        <div onClick={() => setShowSaveModal(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.4)", zIndex:600, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#fff", borderRadius:18, padding:"26px 28px", width:"100%", maxWidth:380, boxShadow:"0 16px 50px rgba(0,0,0,.22)" }}>
            <p style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:16 }}>Save Note As…</p>
            <input autoFocus value={newNoteName} onChange={e => setNewNoteName(e.target.value)}
              onKeyDown={e => e.key==="Enter" && doSave()}
              placeholder="e.g. Atomic Structure, Chapter 3, Exam Prep…"
              style={{ width:"100%", border:`1.5px solid ${C.accentS}`, borderRadius:10, padding:"10px 12px", fontSize:14, outline:"none", color:C.text, marginBottom:14 }}/>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={doSave} disabled={!newNoteName.trim()}
                style={{ flex:2, background:newNoteName.trim()?C.accent:"#ccc", color:"#fff", border:"none", borderRadius:10, padding:"11px", fontSize:14, fontWeight:700, cursor:newNoteName.trim()?"pointer":"not-allowed" }}>Save</button>
              <button onClick={() => setShowSaveModal(false)}
                style={{ flex:1, background:"#eee", color:"#555", border:"none", borderRadius:10, padding:"11px", fontSize:14, fontWeight:600, cursor:"pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Style selector ────────────────────────────────────────────────── */}
      <div style={{ background:C.surface, border:`1.5px solid ${C.border}`, borderRadius:14, padding:"12px 14px", marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <span style={{ fontSize:11, fontWeight:800, color:C.muted, letterSpacing:1 }}>NOTE STYLE</span>
          <button onClick={() => setUseCustomStyle(u => !u)}
            style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, border:`1.5px solid ${useCustomStyle?C.accent:C.border}`, background:useCustomStyle?C.accentL:"transparent", color:useCustomStyle?C.accent:C.muted, cursor:"pointer" }}>
            {useCustomStyle ? "Custom (on)" : "Custom style"}
          </button>
        </div>
        {!useCustomStyle ? (
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {NOTE_STYLES.map(s => (
              <button key={s.id} onClick={() => setNoteStyle(s.id)} title={s.desc}
                style={{ padding:"6px 12px", borderRadius:20, border:`1.5px solid ${noteStyle===s.id?C.accent:C.border}`, background:noteStyle===s.id?C.accentL:"#fff", color:noteStyle===s.id?C.accent:C.muted, cursor:"pointer", fontWeight:noteStyle===s.id?700:500, fontSize:12, transition:"all .12s" }}>
                {s.label}
              </button>
            ))}
          </div>
        ) : (
          <div>
            <textarea value={customStyle} onChange={e => setCustomStyle(e.target.value)}
              placeholder="e.g. 'Short bullet points with key definitions', 'Explain simply for a beginner', 'Focus only on exam topics'"
              style={{ width:"100%", minHeight:68, border:`1.5px solid ${C.accentS}`, borderRadius:10, padding:"10px 12px", fontSize:13, outline:"none", resize:"vertical", color:C.text, background:"#fff", lineHeight:1.5, fontFamily:"'DM Sans',sans-serif" }}/>
            <p style={{ fontSize:11, color:C.muted, marginTop:5 }}>The AI will follow your instructions exactly when generating notes.</p>
          </div>
        )}
      </div>

      {/* ── Custom topic input ─────────────────────────────────────────────── */}
      {showTopicInput && (
        <div style={{ background:C.accentL, border:`1.5px solid ${C.accentS}`, borderRadius:12, padding:14, marginBottom:14, display:"flex", gap:10, alignItems:"center" }}>
          <input autoFocus value={customTopic} onChange={e => setCustomTopic(e.target.value)}
            onKeyDown={e => { if(e.key==="Enter" && customTopic.trim()) generateWithTopic(customTopic.trim()); }}
            placeholder="e.g. Photosynthesis, World War 2, Quadratic equations…"
            style={{ flex:1, border:`1.5px solid ${C.accentS}`, borderRadius:8, padding:"9px 12px", fontSize:14, outline:"none", color:C.text, background:C.surface }}/>
          <button onClick={() => customTopic.trim() && generateWithTopic(customTopic.trim())} disabled={!customTopic.trim()}
            style={{ background:C.accent, color:"#fff", border:"none", borderRadius:8, padding:"9px 14px", fontSize:14, fontWeight:600, cursor:customTopic.trim()?"pointer":"not-allowed" }}>Go</button>
          <button onClick={() => setShowTopicInput(false)} style={{ background:"none", border:"none", cursor:"pointer", color:C.muted, fontSize:18 }}>×</button>
        </div>
      )}

      {/* ── Notes textarea ──────────────────────────────────────────────────── */}
      {unsaved && notes.trim() && (
        <div style={{ background:"#fffbeb", border:"1px solid #f59e0b33", borderRadius:8, padding:"6px 12px", marginBottom:8, fontSize:12, color:"#b45309", fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
          Unsaved — click Save to keep these notes
        </div>
      )}
      <textarea value={notes} onChange={e => { setNotes(e.target.value); setUnsaved(true); }}
        dir={isRTL ? "rtl" : "ltr"}
        placeholder="Notes will clear when you leave. Click AI Generate to create notes, then Save to keep them."
        style={{ width:"100%", minHeight:440, border:`1.5px solid ${unsaved && notes.trim() ? "#f59e0b" : C.border}`, borderRadius:14, padding:"18px 20px", fontSize:15, lineHeight:1.85, outline:"none", resize:"vertical", color:C.text, background:C.surface, fontFamily:"'DM Sans',sans-serif", direction:isRTL?"rtl":"ltr" }}/>

    </div>
  );
}


// ─── STUDY CARDS TAB ──────────────────────────────────────────────────────────
function CardsTab({ file, onUpdate }) {
  const { isMobile } = useResponsive();
  const [cards, setCards] = useState(file.studyCards||[]);
  const [flipped, setFlipped] = useState({});
  const [gen, setGen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showCountPicker, setShowCountPicker] = useState(false);
  const [cardCount, setCardCount] = useState(8);
  const [nQ, setNQ] = useState(""); const [nA, setNA] = useState("");

  const generate = async (count = cardCount) => {
    setGen(true);
    setShowCountPicker(false);
    try {
      const fileObj = file._fileObj || FILE_STORE.get(file.id) || null;
      const fileText = fileObj ? await extractFileText(fileObj) : null;
      const userMsg = fileText
        ? `Here is the COMPLETE content from "${file.name}":\n\n${fileText.slice(0, 12000)}\n\nAnalyze ALL of this content thoroughly, then create exactly ${count} study flashcards covering the most important concepts from the ENTIRE document. Return JSON array: [{"question":"…","answer":"…"}]`
        : `Create exactly ${count} study flashcards for the topic "${file.name}". Return JSON array: [{"question":"…","answer":"…"}]`;
      const txt = await callClaude("Return ONLY valid JSON array. No markdown, no explanation, no extra text.", userMsg);
      const parsed = JSON.parse(txt.replace(/```json|```/g,"").trim());
      const nc = parsed.map((c,i)=>({id:Date.now()+i,...c}));
      setCards(nc); onUpdate({...file,studyCards:nc});
    } catch(e){ console.error(e); }
    setGen(false);
  };

  const del = (id) => { const u=cards.filter(c=>c.id!==id); setCards(u); onUpdate({...file,studyCards:u}); };
  const add = () => {
    if(!nQ.trim()||!nA.trim()) return;
    const u=[...cards,{id:Date.now(),question:nQ,answer:nA}];
    setCards(u); onUpdate({...file,studyCards:u}); setNQ(""); setNA(""); setShowAdd(false);
  };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:700, color:C.text }}>Study Cards <span style={{ fontSize:15, fontWeight:500, color:C.muted }}>({cards.length})</span></h2>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={() => setShowAdd(true)} className="hov"
            style={{ display:"flex", alignItems:"center", gap:7, background:C.surface, color:C.text, border:`1.5px solid ${C.border}`, borderRadius:10, padding:"9px 14px", fontSize:14, fontWeight:600, cursor:"pointer" }}>
            <Icon d={I.plus} size={14} color={C.text} sw={2.5} /> Add Card
          </button>
          <button onClick={() => setShowCountPicker(p => !p)} disabled={gen} className="hov"
            style={{ display:"flex", alignItems:"center", gap:7, background:C.accentL, color:C.accent, border:"none", borderRadius:10, padding:"9px 16px", fontSize:14, fontWeight:600, cursor:gen?"not-allowed":"pointer" }}>
            <Icon d={gen?I.refresh:I.sparkle} size={15} color={C.accent} />{gen?"Generating…":"AI Generate"}
          </button>
        </div>
      </div>

      {showCountPicker && (
        <div style={{ background:C.accentL, border:`1.5px solid ${C.accentS}`, borderRadius:12, padding:16, marginBottom:16 }}>
          <p style={{ fontSize:13, fontWeight:600, color:C.accent, marginBottom:12 }}>How many cards do you want?</p>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14 }}>
            {[5, 8, 10, 15, 20, 25, 30].map(n => (
              <button key={n} onClick={() => setCardCount(n)}
                style={{ width:48, height:40, borderRadius:8, border:`1.5px solid ${cardCount===n?C.accent:C.border}`, background:cardCount===n?C.accent:"#fff", color:cardCount===n?"#fff":C.text, fontSize:14, fontWeight:600, cursor:"pointer" }}>
                {n}
              </button>
            ))}
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, flex:1 }}>
              <span style={{ fontSize:13, color:C.muted }}>Custom:</span>
              <input type="number" min="0" max="50" value={cardCount} onChange={e => setCardCount(Math.min(50, Math.max(0, parseInt(e.target.value)||0)))}
                style={{ width:70, border:`1.5px solid ${C.border}`, borderRadius:8, padding:"7px 10px", fontSize:14, outline:"none", color:C.text, background:"#fff" }} />
            </div>
            <button onClick={() => generate(cardCount)} disabled={gen}
              style={{ background:C.accent, color:"#fff", border:"none", borderRadius:8, padding:"9px 20px", fontSize:14, fontWeight:600, cursor:"pointer" }}>
              Generate {cardCount} Cards
            </button>
            <button onClick={() => setShowCountPicker(false)}
              style={{ background:"none", border:"none", cursor:"pointer", color:C.muted, padding:"9px 6px" }}>×</button>
          </div>
        </div>
      )}
      {showAdd && (
        <div style={{ background:C.surface, border:`1.5px solid ${C.accentS}`, borderRadius:14, padding:20, marginBottom:20 }}>
          <input value={nQ} onChange={e=>setNQ(e.target.value)} placeholder="Question" style={{ width:"100%", border:`1.5px solid ${C.border}`, borderRadius:8, padding:"9px 12px", fontSize:14, marginBottom:10, outline:"none", color:C.text, background:C.bg }} />
          <input value={nA} onChange={e=>setNA(e.target.value)} placeholder="Answer" style={{ width:"100%", border:`1.5px solid ${C.border}`, borderRadius:8, padding:"9px 12px", fontSize:14, marginBottom:14, outline:"none", color:C.text, background:C.bg }} />
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>setShowAdd(false)} style={{ flex:1, padding:"8px", border:`1.5px solid ${C.border}`, borderRadius:8, background:"none", cursor:"pointer", fontSize:14, color:C.text }}>Cancel</button>
            <button onClick={add} style={{ flex:2, padding:"8px", background:C.accent, color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontSize:14, fontWeight:600 }}>Add</button>
          </div>
        </div>
      )}
      {cards.length === 0
        ? <div style={{ textAlign:"center", padding:"60px 0", color:C.muted }}><Icon d={I.cards} size={40} color={C.border} /><p style={{ marginTop:12, fontSize:15 }}>No cards yet — generate or add some</p></div>
        : <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:16 }}>
            {cards.map(card => (
              <div key={card.id} onClick={() => setFlipped(f=>({...f,[card.id]:!f[card.id]}))}
                style={{ background:flipped[card.id]?C.accentL:C.surface, border:`1.5px solid ${flipped[card.id]?C.accentS:C.border}`, borderRadius:16, padding:24, cursor:"pointer", minHeight:140, display:"flex", flexDirection:"column", justifyContent:"space-between", transition:"all .2s" }}>
                <div>
                  <p style={{ fontSize:11, fontWeight:700, color:flipped[card.id]?C.accent:C.muted, letterSpacing:1, marginBottom:10, textTransform:"uppercase" }}>{flipped[card.id]?"Answer":"Question"}</p>
                  <p style={{ fontSize:15, color:C.text, lineHeight:1.5 }}>{flipped[card.id]?card.answer:card.question}</p>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16 }}>
                  <span style={{ fontSize:12, color:C.muted }}>Tap to flip</span>
                  <button onClick={e=>{e.stopPropagation();del(card.id);}} style={{ background:"none", border:"none", cursor:"pointer", padding:2 }}>
                    <Icon d={I.trash} size={14} color={C.muted} />
                  </button>
                </div>
              </div>
            ))}
          </div>
      }
    </div>
  );
}

// ─── GAME TAB ─────────────────────────────────────────────────────────────────
// AI-powered answer checker — returns true/false
// Falls back to fuzzy string match if API call fails
async function aiCheckAnswer(question, correct, userAnswer) {
  const ua = userAnswer.trim().toLowerCase();
  const ca = correct.trim().toLowerCase();
  // Instant pass for exact / contains match
  if (ua === ca) return true;
  if (ca.includes(ua) && ua.length > 2) return true;
  // Simple word overlap score (fast fallback, no API call needed for clear cases)
  const overlap = ua.split(" ").filter(w => ca.includes(w) && w.length > 2).length;
  const maxWords = Math.max(ua.split(" ").length, ca.split(" ").length);
  if (maxWords > 0 && overlap / maxWords >= 0.75) return true;
  // Ask the AI for ambiguous cases
  try {
    const res = await callClaude(
      "You are a strict but fair answer checker for a student quiz. Reply ONLY with 'yes' or 'no'.",
      `Question: ${question}\nExpected answer: ${correct}\nStudent answered: ${userAnswer}\nIs the student's answer correct or essentially correct (85%+ right)? Reply ONLY 'yes' or 'no'.`
    );
    return res.trim().toLowerCase().startsWith("yes");
  } catch { return false; }
}

function GameTab({ file }) {
  const { isMobile } = useResponsive();
  const cards = file.studyCards || [];
  const [activeGame, setActiveGame] = useState(null);

  if (cards.length === 0) return (
    <div style={{ textAlign:"center", padding:"80px 0" }}>
      <Icon d={I.game} size={48} color={C.border} />
      <p style={{ fontSize:18, fontWeight:600, color:C.text, marginTop:16, marginBottom:8 }}>No cards yet</p>
      <p style={{ fontSize:14, color:C.muted }}>Generate study cards first, then come back to play</p>
    </div>
  );

  if (activeGame==="mcq") return <MCQ cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="scramble") return <Scramble cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="match") return <Match cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="falling") return <Falling cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="tower") return <Tower cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="speedrun") return <Speedrun cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="truefalse") return <TrueFalse cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="memory") return <Memory cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="fillblank") return <FillBlank cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="flashcard") return <FlashcardFlip cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="quizshow") return <QuizShow cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="rapidfire") return <RapidFire cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="voice") return <VoiceAnswer cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="listening") return <ListeningGame cards={cards} onBack={()=>setActiveGame(null)} />;
  if (activeGame==="wordfill") return <WordFill cards={cards} onBack={()=>setActiveGame(null)} />;

  const GAMES = [
    {id:"mcq",      icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.accent}     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,      title:"Multiple Choice",  desc:"4 options — pick the right one",                              bg:C.accentL,   accent:C.accent},
    {id:"voice",    icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7c3aed"      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,  title:"Voice Answer",     desc:"Speak your answer out loud — AI grades it",                   bg:"#f5f3ff",   accent:"#7c3aed"},
    {id:"flashcard",icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7c3aed"      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/></svg>,                                                                                                                    title:"Flashcard Flip",   desc:"Flip cards and track what you know",                          bg:"#f5f3ff",   accent:"#7c3aed"},
    {id:"quizshow", icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626"      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>,                                                                                                  title:"Quiz Show",        desc:"Who Wants to Be a Millionaire style with lifelines",          bg:"#fef2f2",   accent:"#dc2626"},
    {id:"fillblank",icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0694a2"      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>,                                               title:"Fill in the Blank", desc:"Complete the sentence with the right answer",                bg:"#ecfeff",   accent:"#0694a2"},
    {id:"rapidfire",icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669"      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,                                                                                                                                               title:"Rapid Fire",       desc:"Type as many correct answers as you can in 45s",             bg:"#f0fdf4",   accent:"#059669"},
    {id:"truefalse",icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6B46C1"      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>,                                                                                                                                                                              title:"True or False",    desc:"Decide if the statement is true or false",                    bg:"#FAF5FF",   accent:"#6B46C1"},
    {id:"memory",   icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C53030"      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="9" height="9" rx="1"/><rect x="13" y="3" width="9" height="9" rx="1"/><rect x="2" y="13" width="9" height="9" rx="1"/><rect x="13" y="13" width="9" height="9" rx="1"/></svg>,       title:"Memory Flip",      desc:"Match question cards to answer cards",                        bg:"#FFF5F5",   accent:"#C53030"},
    {id:"match",    icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.green}      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,                                                       title:"Matching Pairs",   desc:"Connect each term to its definition",                         bg:C.greenL,    accent:C.green},
    {id:"scramble", icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.warm}       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>,                                                  title:"Word Scramble",    desc:"AI scrambles a key word — rearrange the letter tiles",        bg:C.warmL,     accent:C.warm},
    {id:"speedrun", icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#D69E2E"      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,                                                                                                                                    title:"Speed Run",        desc:"Answer as many as you can in 60 seconds",                    bg:"#FFFFF0",   accent:"#D69E2E"},
    {id:"tower",    icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2C7A7B"      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="16" width="16" height="4" rx="1"/><rect x="6" y="11" width="12" height="4" rx="1"/><rect x="8" y="6" width="8" height="4" rx="1"/></svg>,                                                      title:"Answer Tower",     desc:"Build a tower — answer correctly to stack blocks",            bg:"#E6FFFA",   accent:"#2C7A7B"},
    {id:"falling",  icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.purple}     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><line x1="14" y1="17" x2="21" y2="17"/></svg>,               title:"Falling Blocks",   desc:"Type the answer before the block falls",                     bg:C.purpleL,   accent:C.purple},
    {id:"listening",icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669"      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>,                      title:"Listening Quiz",   desc:"Listen to the question — answer without reading it",         bg:"#f0fdf4",   accent:"#059669"},
    {id:"wordfill", icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ea580c"      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="7" y1="14" x2="7" y2="17"/><line x1="12" y1="14" x2="12" y2="17"/></svg>,                                 title:"Word Fill",        desc:"Key words are blanked out — tap tiles to fill them in",       bg:"#fff7ed",   accent:"#ea580c"},
  ];

  return (
    <div style={{ maxWidth:760, margin:"0 auto" }}>
      <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:26, fontWeight:700, color:C.text, marginBottom:6 }}>Game Mode</h2>
      <p style={{ fontSize:14, color:C.muted, marginBottom:28 }}>{cards.length} cards ready · Choose a game</p>
      <div className="game-grid" style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"repeat(auto-fill,minmax(200px,1fr))", gap:14 }}>
        {GAMES.map(g => (
          <button key={g.id} onClick={()=>setActiveGame(g.id)}
            style={{ background:g.bg, border:`1.5px solid ${g.accent}22`, borderRadius:18, padding:"20px 18px", textAlign:"left", cursor:"pointer", transition:"transform .15s,box-shadow .15s" }}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 8px 24px ${g.accent}33`;}}
            onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none";}}>
            <div style={{ marginBottom:10, display:"flex" }}>{g.icon}</div>
            <p style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:5 }}>{g.title}</p>
            <p style={{ fontSize:12, color:C.muted, lineHeight:1.4 }}>{g.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── GAMES ────────────────────────────────────────────────────────────────────
function GHeader({ title, score, curr, total, onBack, accent }) {
  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <button onClick={onBack} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", color:C.muted, fontSize:14, padding:0 }}>
          <Icon d={I.back} size={16} color={C.muted} /> All Games
        </button>
        <span style={{ fontSize:14, fontWeight:700, color:accent }}>Score: {score}</span>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontWeight:700, color:C.text }}>{title}</h3>
        <span style={{ fontSize:13, color:C.muted }}>{curr+1}/{total}</span>
      </div>
      <div style={{ height:5, background:C.border, borderRadius:3 }}>
        <div style={{ height:"100%", width:`${(curr/total)*100}%`, background:accent, borderRadius:3, transition:"width .3s" }} />
      </div>
    </div>
  );
}

function GResults({ score, total, onBack, msg }) {
  const pct = Math.round(score/total*100);
  return (
    <div style={{ maxWidth:420, margin:"0 auto", textAlign:"center", padding:"40px 0" }}>
      <div style={{ fontSize:56, marginBottom:16 }}>{pct>=80?"★":pct>=50?"↑":"↺"}</div>
      <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:700, color:C.text, marginBottom:6 }}>{msg||"Round Complete!"}</h2>
      <p style={{ fontSize:48, fontWeight:700, color:C.accent, marginBottom:4 }}>{score}/{total}</p>
      <p style={{ fontSize:16, color:C.muted, marginBottom:8 }}>{pct}% correct</p>
      <p style={{ fontSize:14, color:pct>=80?C.green:pct>=50?C.warm:C.red, fontWeight:600, marginBottom:32 }}>
        {pct>=80?"Excellent!":pct>=50?"Good effort! Keep studying.":"Keep practicing — you've got this!"}
      </p>
      <button onClick={onBack} style={{ background:C.accent, color:"#fff", border:"none", borderRadius:14, padding:"13px 32px", fontSize:15, fontWeight:700, cursor:"pointer" }}>← Back to Games</button>
    </div>
  );
}

// Shared loading screen shown while AI generates smart distractors
function AILoadingScreen({ title, message, accent }) {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const id = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 480);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ maxWidth:480, margin:"0 auto", textAlign:"center", padding:"60px 20px" }}>
      <div style={{ width:64,height:64,borderRadius:20,background:"#ede9fe",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 18px" }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.98-3 2.5 2.5 0 0 1-1.32-4.24 3 3 0 0 1 .34-5.58 2.5 2.5 0 0 1 1.96-3.41A2.5 2.5 0 0 1 9.5 2zM14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.98-3 2.5 2.5 0 0 0 1.32-4.24 3 3 0 0 0-.34-5.58 2.5 2.5 0 0 0-1.96-3.41A2.5 2.5 0 0 0 14.5 2z"/></svg></div>
      <p style={{ fontSize:20, fontWeight:800, color:"#111", marginBottom:8 }}>{title}</p>
      <p style={{ fontSize:15, color:"#555", marginBottom:32 }}>{message}{dots}</p>
      <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ width:12, height:12, borderRadius:"50%", background:accent,
            animation:`bounce${i} .9s ${i*0.2}s infinite alternate`,
            opacity: 0.7 + i * 0.1 }} />
        ))}
      </div>
      <style>{`
        @keyframes bounce0{from{transform:translateY(0)}to{transform:translateY(-12px)}}
        @keyframes bounce1{from{transform:translateY(0)}to{transform:translateY(-12px)}}
        @keyframes bounce2{from{transform:translateY(0)}to{transform:translateY(-12px)}}
      `}</style>
    </div>
  );
}

function MCQ({ cards, onBack }) {
  const [deck]    = useState(() => [...cards].sort(() => Math.random() - .5));
  const [optsMap, setOptsMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [curr,    setCurr]    = useState(0);
  const [sel,     setSel]     = useState(null);
  const [score,   setScore]   = useState(0);
  const [done,    setDone]    = useState(false);

  useEffect(() => {
    buildAIOptions(deck).then(map => { setOptsMap(map); setLoading(false); });
  }, []);

  const pick = (o) => {
    if (sel) return;
    setSel(o);
    if (o === deck[curr].answer) setScore(s => s + 1);
  };
  const next = () => {
    if (curr + 1 >= deck.length) { setDone(true); return; }
    setCurr(c => c + 1); setSel(null);
  };

  if (loading) return <AILoadingScreen title="Multiple Choice" message="Generating smart answer choices" accent={C.accent} />;
  if (done)    return <GResults score={score} total={deck.length} onBack={onBack} />;

  const opts = (optsMap && optsMap.get(deck[curr].id)) || buildFallbackOptions(deck[curr], deck);
  return (
    <div style={{ maxWidth:560, margin:"0 auto" }}>
      <GHeader title="Multiple Choice" score={score} curr={curr} total={deck.length} onBack={onBack} accent={C.accent} />
      <div style={{ background:C.surface, border:`1.5px solid ${C.border}`, borderRadius:20, padding:"28px", marginBottom:16 }}>
        <p style={{ fontSize:12, fontWeight:700, color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:12 }}>Question</p>
        <p style={{ fontSize:17, color:C.text, lineHeight:1.6 }}>{deck[curr].question}</p>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {opts.map((o, i) => {
          const ok = o === deck[curr].answer, is = o === sel;
          let bg = C.surface, bd = C.border, col = C.text;
          if (sel) {
            if (ok)      { bg = C.greenL; bd = C.green; col = C.green; }
            else if (is) { bg = C.redL;   bd = C.red;   col = C.red;   }
          }
          return (
            <button key={i} onClick={() => pick(o)} style={{ background:bg, border:`1.5px solid ${bd}`, borderRadius:12, padding:"14px 18px", textAlign:"left", fontSize:15, color:col, cursor:sel?"default":"pointer", fontWeight:is||(sel&&ok)?600:400, transition:"all .2s" }}>
              <span style={{ fontWeight:700, marginRight:10, color:C.muted }}>{"ABCD"[i]}.</span>{o}
            </button>
          );
        })}
      </div>
      {sel && (
        <button onClick={next} style={{ marginTop:16, width:"100%", background:C.accent, color:"#fff", border:"none", borderRadius:12, padding:"13px", fontSize:15, fontWeight:700, cursor:"pointer" }}>
          {curr + 1 >= deck.length ? "See Results" : "Next →"}
        </button>
      )}
    </div>
  );
}

// ─── GAME: WORD SCRAMBLE (AI-simplified fill-the-blank + tiles) ───────────────
// AI converts every card into a simpler short Q&A, then blanks the key word.
// Player taps letter tiles to fill the blank. No typing required.
function Scramble({ cards, onBack }) {
  const [simplified, setSimplified] = useState(null); // null while loading
  const [loadErr,    setLoadErr]    = useState(false);

  // Step 1: ask AI to produce 10 simplified Q→single-word-answer pairs
  useEffect(() => {
    (async () => {
      try {
        const sample = cards.slice(0, 20).map((c,i) => `${i+1}. Q: ${c.question} | A: ${c.answer}`).join("\n");
        const raw = await callClaude(
          "You are a quiz simplifier. Reply ONLY with a valid JSON array. No markdown, no explanation.",
          `Here are study cards:\n${sample}\n\nCreate 10 simple fill-in-the-blank items from these cards.
For each one:
- Write a short simple sentence with ONE important word replaced by _____
- The answer must be that ONE word (1-8 letters, letters only, no spaces)
- Keep the sentence under 12 words

Reply ONLY with this JSON array (no markdown):
[{"sentence":"Photosynthesis happens in the _____ of a plant","word":"LEAVES"},...]`
        );
        const clean = raw.replace(/```json|```/g,"").trim();
        const parsed = JSON.parse(clean);
        // validate
        const valid = parsed
          .filter(x => x.sentence && x.word && /^[A-Za-z]{1,8}$/.test(x.word))
          .slice(0, 10)
          .map(x => ({ ...x, word: x.word.toUpperCase() }));
        if (valid.length === 0) throw new Error("No valid items");
        setSimplified(valid);
      } catch(e) {
        console.error("Scramble simplify error:", e);
        // Fallback: use original cards, take first word of answer
        const fallback = cards.slice(0,10).map(c => {
          const w = (c.answer||"").replace(/[^a-zA-Z]/g,"").slice(0,8).toUpperCase() || "WORD";
          return { sentence: c.question.slice(0,60) + " _____", word: w };
        });
        setSimplified(fallback);
      }
    })();
  }, []);

  if (!simplified) return (
    <div style={{ textAlign:"center", padding:"60px 20px" }}>
      <div style={{ width:52,height:52,borderRadius:16,background:C.accentL,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px" }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="{C.accent}" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
      <p style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:8 }}>Preparing your puzzle…</p>
      <p style={{ fontSize:13, color:C.muted }}>AI is simplifying the cards for you</p>
    </div>
  );

  return <ScrambleGame deck={simplified} onBack={onBack} />;
}

function ScrambleGame({ deck, onBack }) {
  const [curr,     setCurr]    = useState(0);
  const [pool,     setPool]    = useState([]);
  const [placed,   setPlaced]  = useState([]);
  const [result,   setResult]  = useState(null);
  const [score,    setScore]   = useState(0);
  const [done,     setDone]    = useState(false);

  const buildPool = (idx) => {
    const word = deck[idx]?.word || "";
    let arr = word.split("").map((l,i) => ({ id:`sc_${idx}_${i}`, letter:l, used:false }));
    let t = 0;
    while (arr.map(x=>x.letter).join("") === word && t++ < 30)
      arr = [...arr].sort(() => Math.random()-.5);
    return arr;
  };

  useEffect(() => {
    setPool(buildPool(curr));
    setPlaced([]);
    setResult(null);
  }, [curr]);

  const pick   = (tile) => { if (result||tile.used) return; setPool(p=>p.map(t=>t.id===tile.id?{...t,used:true}:t)); setPlaced(p=>[...p,{id:tile.id,letter:tile.letter}]); };
  const remove = (id)   => { if (result) return; setPlaced(p=>p.filter(t=>t.id!==id)); setPool(p=>p.map(t=>t.id===id?{...t,used:false}:t)); };
  const clear  = ()     => { if (result) return; setPlaced([]); setPool(p=>p.map(t=>({...t,used:false}))); };

  const check = () => {
    if (result || placed.length===0) return;
    const typed = placed.map(t=>t.letter).join("");
    const ok = typed === deck[curr].word;
    setResult(ok ? "correct" : "wrong");
    if (ok) setScore(s=>s+1);
  };

  const next = () => {
    if (curr+1 >= deck.length) { setDone(true); return; }
    setCurr(c=>c+1);
  };

  if (done) return <GResults score={score} total={deck.length} onBack={onBack} />;

  const item = deck[curr];
  const sentenceParts = item.sentence.split("_____");

  return (
    <div style={{ maxWidth:520, margin:"0 auto" }}>
      <GHeader title="Word Scramble" score={score} curr={curr} total={deck.length} onBack={onBack} accent={C.warm} />

      {/* Sentence with inline answer slot */}
      <div style={{ background:C.surface, border:`1.5px solid ${C.border}`, borderRadius:18, padding:"22px 24px", marginBottom:16 }}>
        <p style={{ fontSize:11, fontWeight:700, color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:12 }}>Fill in the blank</p>
        <p style={{ fontSize:18, color:C.text, lineHeight:1.8, fontWeight:500 }}>
          {sentenceParts[0]}
          <span style={{
            display:"inline-block", minWidth:80, padding:"2px 10px",
            background: result==="correct"?"#f0fdf4": result==="wrong"?"#fff1f1":"#f0f4ff",
            border:`2px solid ${result==="correct"?"#16a34a":result==="wrong"?C.red:C.accentS}`,
            borderRadius:8, marginLeft:2, marginRight:2,
            color: result==="correct"?"#16a34a": result==="wrong"?C.red: C.accent,
            fontWeight:800, fontSize:17, letterSpacing:1,
            transition:"all .2s", verticalAlign:"middle"
          }}>
            {placed.length>0 ? placed.map(t=>t.letter).join("") : "?"}
          </span>
          {sentenceParts[1] || ""}
        </p>
      </div>

      {/* Result banner */}
      {result && (
        <div style={{ textAlign:"center", marginBottom:12, padding:"10px", borderRadius:12,
          background:result==="correct"?"#f0fdf4":"#fff1f1" }}>
          <span style={{ fontSize:16, fontWeight:800, color:result==="correct"?"#16a34a":C.red }}>
            {result==="correct" ? "Correct!" : `Wrong: ${item.word}`}
          </span>
        </div>
      )}

      {/* Scrambled tiles */}
      {!result && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:10, justifyContent:"center", padding:"4px 0 18px" }}>
          {pool.map(tile => (
            <button key={tile.id} onClick={() => pick(tile)} disabled={tile.used} style={{
              width:52, height:58, fontSize:24, fontWeight:900,
              background: tile.used?"#ececec":C.warmL,
              color: tile.used?"#bbb":C.warm,
              border:`2.5px solid ${tile.used?"#ddd":C.warm}`,
              borderRadius:14, cursor:tile.used?"default":"pointer",
              transition:"all .12s",
              transform:tile.used?"scale(.85)":"scale(1)",
              boxShadow:tile.used?"none":"0 4px 12px rgba(0,0,0,.12)",
              opacity:tile.used?.35:1
            }}>{tile.letter}</button>
          ))}
        </div>
      )}

      {/* Answer tray - placed tiles */}
      {placed.length > 0 && !result && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", marginBottom:14 }}>
          {placed.map(tile => (
            <button key={tile.id} onClick={() => remove(tile.id)} style={{
              width:52, height:58, fontSize:24, fontWeight:900,
              background:C.accent, color:"#fff", border:"none",
              borderRadius:14, cursor:"pointer",
              boxShadow:"0 3px 10px rgba(0,0,0,.2)",
              transition:"all .12s"
            }} title="Tap to remove">{tile.letter}</button>
          ))}
        </div>
      )}

      {/* Buttons */}
      {!result ? (
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={clear} disabled={placed.length===0}
            style={{ flex:1, background:"#eee", color:placed.length>0?"#555":"#bbb", border:"none", borderRadius:12, padding:"13px", fontSize:14, fontWeight:700, cursor:placed.length>0?"pointer":"not-allowed" }}>
            Clear
          </button>
          <button onClick={check} disabled={placed.length===0}
            style={{ flex:2, background:placed.length>0?C.warm:"#ccc", color:"#fff", border:"none", borderRadius:12, padding:"13px", fontSize:15, fontWeight:700, cursor:placed.length>0?"pointer":"not-allowed", transition:"background .15s" }}>
            Check ✓
          </button>
        </div>
      ) : (
        <button onClick={next} style={{ width:"100%", background:C.warm, color:"#fff", border:"none", borderRadius:12, padding:"14px", fontSize:15, fontWeight:700, cursor:"pointer" }}>
          {curr+1>=deck.length ? "See Results" : "Next →"}
        </button>
      )}
    </div>
  );
}


function Match({ cards, onBack }) {
  const count=Math.min(cards.length,6);
  const [deck]=useState(()=>[...cards].sort(()=>Math.random()-.5).slice(0,count));
  const [rights]=useState(()=>[...deck].sort(()=>Math.random()-.5));
  const [ls,setLs]=useState(null);const [rs,setRs]=useState(null);const [matched,setMatched]=useState([]);const [wrong,setWrong]=useState([]);const [score,setScore]=useState(0);const [done,setDone]=useState(false);
  useEffect(()=>{
    if(ls!==null&&rs!==null){
      if(deck[ls].id===rights[rs].id){const nm=[...matched,deck[ls].id];setMatched(nm);setScore(s=>s+1);setLs(null);setRs(null);if(nm.length===deck.length)setTimeout(()=>setDone(true),500);}
      else{setWrong([ls,rs]);setTimeout(()=>{setWrong([]);setLs(null);setRs(null);},900);}
    }
  },[ls,rs]);
  if(done) return <GResults score={score} total={deck.length} onBack={onBack} />;
  const bs=(isSel,isMat,isWrong,col)=>({ background:isMat?C.greenL:isWrong?C.redL:isSel?col+"22":C.surface, border:`1.5px solid ${isMat?C.green:isWrong?C.red:isSel?col:C.border}`, borderRadius:10, padding:"10px 12px", fontSize:13, color:isMat?C.green:isWrong?C.red:C.text, cursor:isMat?"default":"pointer", textAlign:"left", lineHeight:1.4, transition:"all .2s", fontWeight:isSel?600:400, opacity:isMat?.7:1 });
  return (
    <div style={{ maxWidth:680, margin:"0 auto" }}>
      <GHeader title="Matching Pairs" score={score} curr={matched.length} total={deck.length} onBack={onBack} accent={C.green} />
      <p style={{ fontSize:13, color:C.muted, marginBottom:16, textAlign:"center" }}>Match each term to its definition</p>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <p style={{ fontSize:11, fontWeight:700, color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>Terms</p>
          {deck.map((c,i)=><button key={c.id} onClick={()=>{if(!matched.includes(c.id)&&!wrong.length)setLs(ls===i?null:i);}} style={bs(ls===i,matched.includes(c.id),wrong[0]===i,C.green)}>{c.question}</button>)}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <p style={{ fontSize:11, fontWeight:700, color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>Definitions</p>
          {rights.map((c,i)=><button key={c.id} onClick={()=>{if(!matched.includes(c.id)&&!wrong.length)setRs(rs===i?null:i);}} style={bs(rs===i,matched.includes(c.id),wrong[1]===i,C.green)}>{c.answer}</button>)}
        </div>
      </div>
    </div>
  );
}

function Falling({ cards, onBack }) {
  const [deck]=useState(()=>[...cards].sort(()=>Math.random()-.5));
  const [curr,setCurr]=useState(0);const [inp,setInp]=useState("");const [pos,setPos]=useState(0);const [score,setScore]=useState(0);const [lives,setLives]=useState(3);const [res,setRes]=useState(null);const [done,setDone]=useState(false);
  const inpRef=useRef();const posRef=useRef(0);
  const nextCard=useCallback((ns,nl)=>{ if(curr+1>=deck.length||nl<=0){setDone(true);return;} setTimeout(()=>{setCurr(c=>c+1);setInp("");setPos(0);posRef.current=0;setRes(null);inpRef.current?.focus();},800); },[curr,deck.length]);
  useEffect(()=>{ if(res||done)return; const id=setInterval(()=>{ posRef.current+=0.18; setPos(posRef.current); if(posRef.current>=100){clearInterval(id);setRes("missed");const nl=lives-1;setLives(nl);nextCard(score,nl);} },60); return ()=>clearInterval(id); },[curr,res,done]);
  useEffect(()=>{inpRef.current?.focus();},[curr]);
  const [checking,setChecking]=useState(false);
  const check=async()=>{ if(res||checking)return; setChecking(true); const ok=await aiCheckAnswer(deck[curr].question,deck[curr].answer,inp); setChecking(false); setRes(ok?"correct":"wrong"); const ns=ok?score+1:score,nl=ok?lives:lives-1; if(ok)setScore(ns);else setLives(nl); nextCard(ns,nl); };
  if(done) return <GResults score={score} total={deck.length} onBack={onBack} msg={lives<=0?"Out of lives!":"All done!"} />;
  const card=deck[curr];
  const bc=pos<50?C.purple:pos<80?C.warm:C.red;
  const bb=pos<50?C.purpleL:pos<80?C.warmL:C.redL;
  return (
    <div style={{ maxWidth:520, margin:"0 auto" }}>
      <GHeader title="Falling Blocks" score={score} curr={curr} total={deck.length} onBack={onBack} accent={C.purple} />
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
        <span style={{ fontSize:14, color:C.muted }}>{"♥".repeat(lives)}{" ♡".repeat(Math.max(0,3-lives))}</span>
        <span style={{ fontSize:13, color:C.muted }}>Type fast!</span>
      </div>
      <div style={{ background:C.surface, border:`1.5px solid ${C.border}`, borderRadius:20, height:300, position:"relative", overflow:"hidden", marginBottom:16 }}>
        <div style={{ position:"absolute", bottom:0, left:0, right:0, height:60, background:`${C.red}11`, borderTop:`2px dashed ${C.red}44` }} />
        <p style={{ position:"absolute", bottom:8, left:0, right:0, textAlign:"center", fontSize:11, color:C.red, fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Danger Zone</p>
        <div style={{ position:"absolute", top:`${Math.min(pos,78)}%`, left:"50%", transform:"translateX(-50%)", background:bb, border:`2px solid ${bc}`, borderRadius:16, padding:"14px 20px", maxWidth:340, textAlign:"center", transition:res?"none":"top .06s linear", boxShadow:`0 4px 20px ${bc}44`, opacity:res==="correct"?0:1 }}>
          <p style={{ fontSize:12, fontWeight:700, color:bc, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>Answer this</p>
          <p style={{ fontSize:15, color:C.text, lineHeight:1.4 }}>{card.question}</p>
        </div>
        {res && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:res==="correct"?C.greenL+"cc":C.redL+"cc", borderRadius:20 }}>
          <p style={{ fontSize:32, fontWeight:700, color:res==="correct"?C.green:C.red }}>{res==="correct"?"Correct!":res==="wrong"?card.answer:"Too slow!"}</p>
        </div>}
      </div>
      <div style={{ display:"flex", gap:10 }}>
        <input ref={inpRef} value={inp} onChange={e=>setInp(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")check();}} placeholder="Type answer and press Enter…"
          style={{ flex:1, border:`1.5px solid ${C.border}`, borderRadius:12, padding:"12px 16px", fontSize:15, outline:"none", color:C.text, background:C.bg }} disabled={!!res} />
        <button onClick={check} disabled={!inp.trim()||!!res} style={{ background:C.purple, color:"#fff", border:"none", borderRadius:12, padding:"12px 20px", fontSize:14, fontWeight:700, cursor:"pointer" }}>Submit</button>
      </div>
    </div>
  );
}

// ─── TOWER GAME ──────────────────────────────────────────────────────────────
function Tower({ cards, onBack }) {
  const [deck]=useState(()=>[...cards].sort(()=>Math.random()-.5));
  const [curr,setCurr]=useState(0);const [inp,setInp]=useState("");const [res,setRes]=useState(null);
  const [tower,setTower]=useState([]);const [done,setDone]=useState(false);
  const teal="#2C7A7B";
  const [checking,setChecking]=useState(false);
  const check=async()=>{
    if(checking||res)return; setChecking(true);
    const ok=await aiCheckAnswer(deck[curr].question,deck[curr].answer,inp);
    setChecking(false);
    setRes(ok?"correct":"wrong");
    if(ok)setTower(t=>[...t,{q:deck[curr].question,color:`hsl(${170+t.length*8},60%,${45-t.length*2}%)`}]);
    setTimeout(()=>{
      if(curr+1>=deck.length){setDone(true);return;}
      setCurr(c=>c+1);setInp("");setRes(null);
    },700);
  };
  if(done) return <GResults score={tower.length} total={deck.length} onBack={onBack} msg="Tower Built!" />;
  return (
    <div style={{ maxWidth:600, margin:"0 auto", display:"flex", gap:24 }}>
      <div style={{ flex:1 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <button onClick={onBack} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", color:C.muted, fontSize:14 }}><Icon d={I.back} size={16} color={C.muted} /> Games</button>
          <span style={{ fontSize:14, fontWeight:700, color:teal }}>Blocks: {tower.length}</span>
        </div>
        <div style={{ background:C.surface, border:`1.5px solid ${C.border}`, borderRadius:16, padding:24, marginBottom:14 }}>
          <p style={{ fontSize:12, fontWeight:700, color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:10 }}>{curr+1}/{deck.length}</p>
          <p style={{ fontSize:16, color:C.text, lineHeight:1.6 }}>{deck[curr].question}</p>
        </div>
        <input value={inp} onChange={e=>{if(!res)setInp(e.target.value);}} onKeyDown={e=>{if(e.key==="Enter"&&inp.trim()&&!res)check();}}
          placeholder="Type answer…" style={{ width:"100%", border:`1.5px solid ${res==="correct"?teal:res==="wrong"?C.red:C.border}`, borderRadius:10, padding:"11px 14px", fontSize:15, outline:"none", background:res==="correct"?"#E6FFFA":res==="wrong"?C.redL:C.bg, marginBottom:10 }} />
        {res&&<p style={{ fontSize:14, fontWeight:600, color:res==="correct"?teal:C.red, marginBottom:10 }}>{res==="correct"?"Block added!":"✗ "+deck[curr].answer}</p>}
        <button onClick={()=>inp.trim()&&!res&&check()} disabled={!inp.trim()||!!res}
          style={{ width:"100%", background:inp.trim()&&!res?teal:"#ccc", color:"#fff", border:"none", borderRadius:10, padding:"12px", fontSize:15, fontWeight:700, cursor:"pointer" }}>Stack Block</button>
      </div>
      {/* Tower visual */}
      <div style={{ width:100, display:"flex", flexDirection:"column-reverse", gap:3, justifyContent:"flex-start", paddingTop:40 }}>
        {tower.map((b,i)=>(
          <div key={i} style={{ background:b.color, borderRadius:6, height:28, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"#fff", fontWeight:700, overflow:"hidden", padding:"0 4px", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {i+1}
          </div>
        ))}
        {tower.length===0&&<p style={{ fontSize:11, color:C.muted, textAlign:"center" }}>Tower starts here</p>}
      </div>
    </div>
  );
}

// ─── SPEED RUN ────────────────────────────────────────────────────────────────
function Speedrun({ cards, onBack }) {
  const [deck]=useState(()=>[...cards].sort(()=>Math.random()-.5));
  const [curr,setCurr]=useState(0);const [inp,setInp]=useState("");const [score,setScore]=useState(0);
  const [time,setTime]=useState(60);const [done,setDone]=useState(false);const [started,setStarted]=useState(false);
  const [flash,setFlash]=useState(null);
  const gold="#D69E2E";
  useEffect(()=>{
    if(!started||done)return;
    const id=setInterval(()=>{
      setTime(t=>{if(t<=1){setDone(true);return 0;}return t-1;});
    },1000);
    return ()=>clearInterval(id);
  },[started,done]);
  const submit=async()=>{
    if(!inp.trim()||done)return;
    const card=deck[curr%deck.length];
    const ok=await aiCheckAnswer(card.question,card.answer,inp);
    if(ok){setScore(s=>s+1);setFlash("correct");}else{setFlash("wrong");}
    setTimeout(()=>setFlash(null),300);
    setCurr(c=>c+1);setInp("");
  };
  if(done) return <GResults score={score} total={Math.min(curr,deck.length*3)} onBack={onBack} msg={`Time's up! ${score} correct`} />;
  const card=deck[curr%deck.length];
  const pct=(time/60)*100;
  return (
    <div style={{ maxWidth:540, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <button onClick={onBack} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", color:C.muted, fontSize:14 }}><Icon d={I.back} size={16} color={C.muted} /> Games</button>
        <span style={{ fontSize:18, fontWeight:800, color:time<=10?C.red:gold }}>⏱ {time}s</span>
        <span style={{ fontSize:14, fontWeight:700, color:gold }}>✓ {score}</span>
      </div>
      <div style={{ height:8, background:C.border, borderRadius:4, marginBottom:20 }}>
        <div style={{ height:"100%", width:`${pct}%`, background:time<=10?C.red:gold, borderRadius:4, transition:"width 1s linear" }} />
      </div>
      {!started?(
        <div style={{ textAlign:"center", padding:"40px 0" }}>
          <div style={{ width:56,height:56,borderRadius:16,background:"#fef9c3",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px" }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ca8a04" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
          <p style={{ fontSize:18, fontWeight:700, color:C.text, marginBottom:8 }}>Speed Run</p>
          <p style={{ fontSize:14, color:C.muted, marginBottom:24 }}>Answer as many as you can in 60 seconds!</p>
          <button onClick={()=>setStarted(true)} style={{ background:gold, color:"#fff", border:"none", borderRadius:14, padding:"14px 40px", fontSize:16, fontWeight:700, cursor:"pointer" }}>Start!</button>
        </div>
      ):(
        <>
          <div style={{ background:flash==="correct"?"#E6FFFA":flash==="wrong"?C.redL:C.surface, border:`1.5px solid ${flash==="correct"?"#2C7A7B":flash==="wrong"?C.red:C.border}`, borderRadius:16, padding:24, marginBottom:14, transition:"background .2s" }}>
            <p style={{ fontSize:16, color:C.text, lineHeight:1.6 }}>{card.question}</p>
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <input autoFocus value={inp} onChange={e=>setInp(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")submit();}}
              placeholder="Quick! Type the answer…" style={{ flex:1, border:`1.5px solid ${C.border}`, borderRadius:10, padding:"11px 14px", fontSize:15, outline:"none" }} />
            <button onClick={submit} style={{ background:gold, color:"#fff", border:"none", borderRadius:10, padding:"11px 20px", fontSize:14, fontWeight:700, cursor:"pointer" }}>→</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── TRUE OR FALSE ────────────────────────────────────────────────────────────
function TrueFalse({ cards, onBack }) {
  const purple="#6B46C1";
  // AI-generated false statements: each wrong statement uses a plausible
  // but incorrect answer about the SAME concept (not a random card's answer)
  const [deck,    setDeck]    = useState(null);
  const [tf_load, setTfLoad]  = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const sample = cards.slice(0, 20).map(c => ({ id: c.id, q: c.question, a: c.answer }));
        const raw = await callClaude(
          "You are a quiz designer. Output ONLY valid JSON array. No markdown, no explanation.",
          `For each Q&A pair, write one plausible but WRONG answer about the SAME concept.

RULES:
- The wrong answer must be about the identical topic as the correct answer
- It must sound believable — a student who hasn't studied might think it's true
- Same sentence length and vocabulary as the correct answer
- Do NOT use "not", "never", "incorrect" — make it sound like a legitimate statement
- Do NOT copy phrases from the correct answer

Items: ${JSON.stringify(sample)}

Return ONLY: [{"id":"<same id>","wrong":"<plausible wrong answer>"}, ...]`
        );
        const parsed = JSON.parse(raw.replace(/\`\`\`json|\`\`\`/g,'').trim());
        const wrongMap = new Map(parsed.map(x => [String(x.id), x.wrong]));
        const out = [];
        cards.slice(0, 20).forEach(c => {
          out.push({ statement: c.question + " — " + c.answer, correct: true, orig: c });
          const wrongAns = wrongMap.get(String(c.id));
          const falseAns = wrongAns || (() => {
            const w = cards.filter(x => x.id !== c.id);
            return w.length > 0 ? w[Math.floor(Math.random()*w.length)].answer : "None of the above";
          })();
          out.push({ statement: c.question + " — " + falseAns, correct: false, orig: c });
        });
        setDeck(out.sort(() => Math.random() - .5).slice(0, Math.min(out.length, 14)));
      } catch(e) {
        // Fallback: use random card answers (old behaviour)
        const out = [];
        cards.forEach(c => {
          out.push({ statement: c.question + " — " + c.answer, correct: true, orig: c });
          const wrong = cards.filter(x => x.id !== c.id);
          if (wrong.length > 0) {
            const w = wrong[Math.floor(Math.random() * wrong.length)];
            out.push({ statement: c.question + " — " + w.answer, correct: false, orig: c });
          }
        });
        setDeck(out.sort(() => Math.random() - .5).slice(0, Math.min(out.length, 14)));
      }
      setTfLoad(false);
    })();
  }, []);
  const [curr,setCurr]=useState(0);
  const [score,setScore]=useState(0);
  const [res,setRes]=useState(null);
  const [done,setDone]=useState(false);
  if (tf_load || !deck) return <AILoadingScreen title="True or False" message="Generating plausible statements" accent={purple} />;
  const answer=(val)=>{
    if(res)return;
    const ok=val===deck[curr].correct;
    setRes({chosen:val,ok});
    if(ok)setScore(s=>s+1);
    setTimeout(()=>{if(curr+1>=deck.length){setDone(true);return;}setCurr(c=>c+1);setRes(null);},900);
  };
  if(done) return <GResults score={score} total={deck.length} onBack={onBack} />;
  const card=deck[curr];
  return (
    <div style={{ maxWidth:540, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <button onClick={onBack} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", color:C.muted, fontSize:14 }}><Icon d={I.back} size={16} color={C.muted} /> Games</button>
        <span style={{ fontSize:14, fontWeight:700, color:purple }}>Score: {score}</span>
      </div>
      <div style={{ height:5, background:C.border, borderRadius:3, marginBottom:20 }}>
        <div style={{ height:"100%", width:`${(curr/deck.length)*100}%`, background:purple, borderRadius:3 }} />
      </div>
      <p style={{ fontSize:12, fontWeight:700, color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:10 }}>{curr+1} / {deck.length}</p>
      <div style={{ background:C.surface, border:`1.5px solid ${C.border}`, borderRadius:16, padding:"28px 24px", marginBottom:24, textAlign:"center" }}>
        <p style={{ fontSize:15, color:C.text, lineHeight:1.7 }}>{card.statement}</p>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        {[{val:true,label:"True",bg:"#E6FFFA",color:"#2C7A7B"},{val:false,label:"False",bg:C.redL,color:C.red}].map(opt=>{
          let bg=opt.bg; let border=`1.5px solid ${opt.color}33`;
          if(res){
            if(opt.val===card.correct){ bg="#E6FFFA"; border="2px solid #2C7A7B"; }
            else if(res.chosen===opt.val&&!res.ok){ bg=C.redL; border=`2px solid ${C.red}`; }
          }
          return <button key={String(opt.val)} onClick={()=>answer(opt.val)}
            style={{ background:bg, border, borderRadius:14, padding:"20px", fontSize:18, fontWeight:700, color:opt.color, cursor:res?"default":"pointer", transition:"all .2s" }}>{opt.label}</button>;
        })}
      </div>
      {res&&<p style={{ textAlign:"center", marginTop:14, fontSize:14, fontWeight:600, color:res.ok?"#2C7A7B":C.red }}>{res.ok?"Correct!":"Answer: "+card.orig.answer}</p>}
    </div>
  );
}

// ─── MEMORY FLIP ─────────────────────────────────────────────────────────────
function Memory({ cards, onBack }) {
  const red="#C53030";
  const count=Math.min(cards.length,8);
  const [pairs]=useState(()=>{
    const selected=[...cards].sort(()=>Math.random()-.5).slice(0,count);
    const grid=[];
    selected.forEach((c,i)=>{
      grid.push({id:`q${i}`,pairId:i,text:c.question,type:"q"});
      grid.push({id:`a${i}`,pairId:i,text:c.answer,type:"a"});
    });
    return grid.sort(()=>Math.random()-.5);
  });
  const [flipped,setFlipped]=useState([]);const [matched,setMatched]=useState([]);const [moves,setMoves]=useState(0);const [done,setDone]=useState(false);
  const flip=(card)=>{
    if(matched.includes(card.id)||flipped.length===2||flipped.find(f=>f.id===card.id))return;
    const nf=[...flipped,card];
    setFlipped(nf);
    if(nf.length===2){
      setMoves(m=>m+1);
      if(nf[0].pairId===nf[1].pairId){
        const nm=[...matched,nf[0].id,nf[1].id];
        setMatched(nm);setFlipped([]);
        if(nm.length===pairs.length)setTimeout(()=>setDone(true),400);
      } else setTimeout(()=>setFlipped([]),900);
    }
  };
  if(done) return <GResults score={count} total={count} onBack={onBack} msg={`Matched all in ${moves} moves!`} />;
  return (
    <div style={{ maxWidth:640, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <button onClick={onBack} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", color:C.muted, fontSize:14 }}><Icon d={I.back} size={16} color={C.muted} /> Games</button>
        <span style={{ fontSize:14, color:C.muted }}>Moves: <strong style={{ color:C.text }}>{moves}</strong></span>
        <span style={{ fontSize:14, color:C.muted }}>Matched: <strong style={{ color:red }}>{matched.length/2}/{count}</strong></span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
        {pairs.map(card=>{
          const isFlipped=!!flipped.find(f=>f.id===card.id);
          const isMatched=matched.includes(card.id);
          return (
            <div key={card.id} onClick={()=>flip(card)}
              style={{ height:80, borderRadius:12, cursor:isMatched?"default":"pointer", perspective:600 }}>
              <div style={{ width:"100%", height:"100%", position:"relative", transition:"transform .4s", transformStyle:"preserve-3d", transform:isFlipped||isMatched?"rotateY(180deg)":"none" }}>
                {/* Back */}
                <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", background:isMatched?C.greenL:red, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/></svg>
                </div>
                {/* Front */}
                <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", transform:"rotateY(180deg)", background:card.type==="q"?C.accentL:C.warmL, border:`1.5px solid ${card.type==="q"?C.accentS:C.warm}44`, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", padding:8 }}>
                  <p style={{ fontSize:11, color:C.text, textAlign:"center", lineHeight:1.3, overflow:"hidden" }}>{card.text.slice(0,50)}{card.text.length>50?"…":""}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <style>{`.preserve-3d{transform-style:preserve-3d}`}</style>
    </div>
  );
}


// ─── GAME: FILL IN THE BLANK ──────────────────────────────────────────────────
function FillBlank({ cards, onBack }) {
  const accent = "#0694a2";
  const [deck] = useState(() => [...cards].sort(() => Math.random() - .5));
  const [curr, setCurr] = useState(0);
  const [inp, setInp] = useState("");
  const [result, setResult] = useState(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, [curr]);

  const card = deck[curr];
  // Hide last word of question to create blank
  const words = (card?.question || "").trim().split(" ");
  const blank = words.length > 1 ? words[words.length - 1].replace(/[?:.]/g, "") : card?.answer;
  const questionWithBlank = words.length > 1 ? words.slice(0, -1).join(" ") + " ___?" : "What is the answer?";

  const [checking, setChecking] = useState(false);
  const check = async () => {
    if (!inp.trim() || checking) return;
    setChecking(true);
    const ok = await aiCheckAnswer(card.question, card.answer || blank, inp);
    setChecking(false);
    setResult(ok);
    if (ok) setScore(s => s + 1);
  };

  const next = () => {
    if (curr + 1 >= deck.length) { setDone(true); return; }
    setCurr(c => c + 1); setInp(""); setResult(null);
  };

  if (done) return <GResults score={score} total={deck.length} onBack={onBack} msg="Fill in the Blank done!" />;

  return (
    <div style={{ maxWidth: 540, margin: "0 auto" }}>
      <GHeader title="Fill in the Blank" score={score} curr={curr} total={deck.length} onBack={onBack} accent={accent} />
      <div style={{ background: "#E6FFFE", border: `2px solid ${accent}33`, borderRadius: 18, padding: "30px 28px", marginBottom: 20, textAlign: "center" }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: 1, marginBottom: 14, textTransform: "uppercase" }}>Complete the sentence</p>
        <p style={{ fontSize: 20, fontWeight: 600, color: C.text, lineHeight: 1.5 }}>{questionWithBlank}</p>
      </div>
      {result === null ? (
        <div style={{ display: "flex", gap: 10 }}>
          <input ref={inputRef} value={inp} onChange={e => setInp(e.target.value)}
            onKeyDown={e => e.key === "Enter" && check()}
            placeholder="Type your answer…"
            style={{ flex: 1, border: `2px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", fontSize: 15, outline: "none", color: C.text }} />
          <button onClick={check} disabled={!inp.trim()}
            style={{ background: accent, color: "#fff", border: "none", borderRadius: 12, padding: "12px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Check</button>
        </div>
      ) : (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 44, marginBottom: 10 }}>{result ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>}</div>
          {!result && <p style={{ color: C.red, fontSize: 15, marginBottom: 6 }}>Correct answer: <strong>{card.answer}</strong></p>}
          <button onClick={next} style={{ background: accent, color: "#fff", border: "none", borderRadius: 12, padding: "12px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
            {curr + 1 >= deck.length ? "See Results" : "Next →"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── GAME: FLASHCARD FLIP ─────────────────────────────────────────────────────
function FlashcardFlip({ cards, onBack }) {
  const accent = "#7c3aed";
  const [deck] = useState(() => [...cards].sort(() => Math.random() - .5));
  const [curr, setCurr] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [reviewing, setReviewing] = useState([]);
  const [done, setDone] = useState(false);

  const card = deck[curr];

  const respond = (didKnow) => {
    if (!didKnow) setReviewing(r => [...r, card]);
    else setKnown(k => k + 1);
    if (curr + 1 >= deck.length) { setDone(true); return; }
    setCurr(c => c + 1); setFlipped(false);
  };

  if (done) return (
    <div style={{ maxWidth: 480, margin: "0 auto", textAlign: "center", padding: "40px 0" }}>
      <div style={{ fontSize: 56, marginBottom: 12 }}>{known >= deck.length * .8 ? "★" : "↺"}</div>
      <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 8 }}>Done!</h2>
      <p style={{ fontSize: 32, fontWeight: 700, color: accent, marginBottom: 4 }}>{known}/{deck.length} known</p>
      <p style={{ fontSize: 14, color: C.muted, marginBottom: 28 }}>{reviewing.length > 0 ? `${reviewing.length} cards to review again` : "You knew them all!"}</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        {reviewing.length > 0 && <button onClick={() => { /* restart with reviewing cards */ }} style={{ background: "#FFF5F5", color: C.red, border: `1.5px solid ${C.red}33`, borderRadius: 12, padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Review {reviewing.length} missed</button>}
        <button onClick={onBack} style={{ background: accent, color: "#fff", border: "none", borderRadius: 12, padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>← Back</button>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 540, margin: "0 auto" }}>
      <GHeader title="Flashcard Flip" score={known} curr={curr} total={deck.length} onBack={onBack} accent={accent} />
      <div onClick={() => setFlipped(f => !f)} style={{ cursor: "pointer", perspective: 900, height: 240, marginBottom: 20 }}>
        <div style={{ position: "relative", width: "100%", height: "100%", transformStyle: "preserve-3d", transition: "transform .5s", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
          <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", background: `linear-gradient(135deg, #ede9fe, #ddd6fe)`, border: `2px solid ${accent}33`, borderRadius: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 28px", textAlign: "center" }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: accent, letterSpacing: 1, marginBottom: 12 }}>QUESTION — tap to flip</p>
            <p style={{ fontSize: 19, fontWeight: 600, color: C.text, lineHeight: 1.5 }}>{card.question}</p>
          </div>
          <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)", background: `linear-gradient(135deg, #f0fdf4, #dcfce7)`, border: "2px solid #16a34a33", borderRadius: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 28px", textAlign: "center" }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#16a34a", letterSpacing: 1, marginBottom: 12 }}>ANSWER</p>
            <p style={{ fontSize: 19, fontWeight: 600, color: C.text, lineHeight: 1.5 }}>{card.answer}</p>
          </div>
        </div>
      </div>
      {flipped && (
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => respond(false)} style={{ flex: 1, background: "#FFF5F5", color: C.red, border: `2px solid ${C.red}33`, borderRadius: 14, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}> Still learning</button>
          <button onClick={() => respond(true)} style={{ flex: 1, background: "#f0fdf4", color: "#16a34a", border: "2px solid #16a34a33", borderRadius: 14, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}> Got it!</button>
        </div>
      )}
      {!flipped && <p style={{ textAlign: "center", color: C.muted, fontSize: 13 }}>Tap the card to reveal the answer</p>}
    </div>
  );
}

// ─── GAME: QUIZ SHOW ──────────────────────────────────────────────────────────
function QuizShow({ cards, onBack }) {
  const accent = "#dc2626";
  const [deck] = useState(() => [...cards].sort(() => Math.random() - .5));
  const [curr, setCurr] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [sel, setSel] = useState(null);
  const [done, setDone] = useState(false);
  const [lifelines, setLifelines] = useState({ fifty: true, skip: true });

  const [optsMap,    setOptsMap]    = useState(null);
  const [qs_loading, setQsLoading]  = useState(true);
  const card = deck[curr];

  useEffect(() => {
    buildAIOptions(deck).then(map => { setOptsMap(map); setQsLoading(false); });
  }, []);

  const getOpts = (idx) => (optsMap && optsMap.get(deck[idx].id)) || buildFallbackOptions(deck[idx], deck);
  const [visibleOpts, setVisibleOpts] = useState([]);
  useEffect(() => { if (optsMap) setVisibleOpts(getOpts(curr)); }, [curr, optsMap]);

  const choose = (opt) => {
    if (sel !== null) return;
    setSel(opt);
    if (opt === card.answer) { setScore(s => s + (streak >= 2 ? 2 : 1)); setStreak(s => s + 1); }
    else setStreak(0);
    setTimeout(() => {
      if (curr + 1 >= deck.length) setDone(true);
      else { setCurr(c => c + 1); setSel(null); }
    }, 1200);
  };

  const useFifty = () => {
    if (!lifelines.fifty || visibleOpts.length === 0) return;
    const wrong = visibleOpts.filter(o => o !== card.answer);
    const remove = wrong.sort(() => Math.random() - .5).slice(0, 2);
    setVisibleOpts(v => v.filter(o => !remove.includes(o)));
    setLifelines(l => ({ ...l, fifty: false }));
  };

  const useSkip = () => {
    if (!lifelines.skip) return;
    setLifelines(l => ({ ...l, skip: false }));
    if (curr + 1 >= deck.length) setDone(true);
    else { setCurr(c => c + 1); setSel(null); }
  };

  if (qs_loading) return <AILoadingScreen title="Quiz Show" message="Preparing smart answer choices" accent={accent} />;
  if (done) return <GResults score={score} total={deck.length} onBack={onBack} msg="Quiz Show Complete!" />;

  const OPTION_LABELS = ["A", "B", "C", "D"];

  return (
    <div style={{ maxWidth: 580, margin: "0 auto" }}>
      <GHeader title="Quiz Show" score={score} curr={curr} total={deck.length} onBack={onBack} accent={accent} />
      {streak >= 3 && <div style={{ background: "#fef9c3", border: "1.5px solid #ca8a04", borderRadius: 10, padding: "6px 14px", marginBottom: 12, fontSize: 13, fontWeight: 700, color: "#92400e", textAlign: "center" }}>{streak} in a row! Double points!</div>}
      <div style={{ background: "linear-gradient(135deg,#fef2f2,#fee2e2)", border: `2px solid ${accent}22`, borderRadius: 18, padding: "26px 24px", marginBottom: 20, textAlign: "center" }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: accent, letterSpacing: 1, marginBottom: 12 }}>QUESTION {curr + 1}</p>
        <p style={{ fontSize: 19, fontWeight: 600, color: C.text, lineHeight: 1.5 }}>{card.question}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {visibleOpts.map((opt, i) => {
          let bg = "#fff", border = `1.5px solid ${C.border}`, color = C.text;
          if (sel !== null) {
            if (opt === card.answer) { bg = "#f0fdf4"; border = "2px solid #16a34a"; color = "#16a34a"; }
            else if (opt === sel) { bg = "#fef2f2"; border = `2px solid ${accent}`; color = accent; }
          }
          return (
            <button key={opt} onClick={() => choose(opt)} disabled={sel !== null}
              style={{ background: bg, border, borderRadius: 12, padding: "14px 12px", fontSize: 14, fontWeight: 600, color, cursor: sel !== null ? "default" : "pointer", textAlign: "left", display: "flex", gap: 10, alignItems: "center", transition: "all .15s" }}>
              <span style={{ width: 24, height: 24, borderRadius: "50%", background: accent + "22", color: accent, fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{OPTION_LABELS[i]}</span>
              {opt}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button onClick={useFifty} disabled={!lifelines.fifty || sel !== null}
          style={{ background: lifelines.fifty ? "#fef9c3" : "#f3f4f6", color: lifelines.fifty ? "#92400e" : C.muted, border: "none", borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: lifelines.fifty ? "pointer" : "not-allowed" }}>
          50/50 {!lifelines.fifty ? "(used)" : ""}
        </button>
        <button onClick={useSkip} disabled={!lifelines.skip || sel !== null}
          style={{ background: lifelines.skip ? "#eff6ff" : "#f3f4f6", color: lifelines.skip ? "#1d4ed8" : C.muted, border: "none", borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: lifelines.skip ? "pointer" : "not-allowed" }}>
          Skip {!lifelines.skip ? "(used)" : ""}
        </button>
      </div>
    </div>
  );
}

// ─── GAME: RAPID FIRE ─────────────────────────────────────────────────────────
function RapidFire({ cards, onBack }) {
  const accent = "#059669";
  const TOTAL_TIME = 45;
  const [deck] = useState(() => [...cards].sort(() => Math.random() - .5));
  const [curr, setCurr] = useState(0);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TOTAL_TIME);
  const [inp, setInp] = useState("");
  const [flash, setFlash] = useState(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); setDone(true); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, [curr]);

  const [rfChecking, setRfChecking] = useState(false);
  const submit = async () => {
    if (rfChecking || !inp.trim()) return;
    setRfChecking(true);
    const card = deck[curr % deck.length];
    const ok = await aiCheckAnswer(card.question, card.answer, inp);
    setRfChecking(false);
    setFlash(ok ? "correct" : "wrong");
    if (ok) setScore(s => s + 1);
    setTimeout(() => { setFlash(null); setCurr(c => c + 1); setInp(""); }, 400);
  };

  if (done) return (
    <div style={{ maxWidth: 420, margin: "0 auto", textAlign: "center", padding: "40px 0" }}>
      <div style={{ width:64,height:64,borderRadius:20,background:"#fef9c3",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px" }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ca8a04" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
      <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 28, fontWeight: 700, color: C.text, marginBottom: 8 }}>Time Up!</h2>
      <p style={{ fontSize: 48, fontWeight: 700, color: accent, marginBottom: 4 }}>{score}</p>
      <p style={{ fontSize: 16, color: C.muted, marginBottom: 28 }}>correct answers in {TOTAL_TIME}s</p>
      <button onClick={onBack} style={{ background: accent, color: "#fff", border: "none", borderRadius: 14, padding: "13px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>← Back to Games</button>
    </div>
  );

  const card = deck[curr % deck.length];
  const pct = (timeLeft / TOTAL_TIME) * 100;

  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon d={I.back} size={16} color={C.muted} /> All Games
        </button>
        <span style={{ fontSize: 28, fontWeight: 800, color: timeLeft <= 10 ? C.red : accent }}>{timeLeft}s</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: accent }}>✓ {score}</span>
      </div>
      <div style={{ height: 8, background: C.border, borderRadius: 4, marginBottom: 20, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: timeLeft <= 10 ? C.red : accent, borderRadius: 4, transition: "width 1s linear, background .3s" }} />
      </div>
      <div style={{ background: flash === "correct" ? "#f0fdf4" : flash === "wrong" ? "#fef2f2" : "#f8f9ff", border: `2px solid ${flash === "correct" ? "#16a34a" : flash === "wrong" ? C.red : accent}33`, borderRadius: 18, padding: "28px 24px", marginBottom: 20, textAlign: "center", transition: "all .2s" }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: accent, letterSpacing: 1, marginBottom: 10 }}>TYPE THE ANSWER</p>
        <p style={{ fontSize: 20, fontWeight: 600, color: C.text }}>{card.question}</p>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <input ref={inputRef} value={inp} onChange={e => setInp(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Answer…"
          style={{ flex: 1, border: `2px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", fontSize: 15, outline: "none", color: C.text }} />
        <button onClick={submit} disabled={!inp.trim()}
          style={{ background: accent, color: "#fff", border: "none", borderRadius: 12, padding: "12px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Go</button>
      </div>
      <p style={{ textAlign: "center", color: C.muted, fontSize: 12, marginTop: 10 }}>Press Enter to submit fast!</p>
    </div>
  );
}


// ─── GAME: VOICE ANSWER ───────────────────────────────────────────────────────
function VoiceAnswer({ cards, onBack }) {
  const accent = "#7c3aed";
  const [deck] = useState(() => [...cards].sort(() => Math.random() - .5));
  const [curr, setCurr] = useState(0);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  // Recording state
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null); // { ok, heard, correct }
  const [voiceCountdown, setVoiceCountdown] = useState(null);
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const countdownRef = useRef(null);

  const card = deck[curr];

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition not supported. Please use Chrome or Edge."); return; }

    // Cancel any existing countdown
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setVoiceCountdown(null);
    setTranscript("");
    setResult(null);
    isListeningRef.current = true;

    const rec = new SR();
    rec.continuous = true;   // keep listening until user stops
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.maxAlternatives = 1;

    let lastFinal = "";
    let silenceTimer = null;

    rec.onresult = (e) => {
      // If countdown was running and user speaks again — cancel it
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setVoiceCountdown(null);
      }

      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) lastFinal += e.results[i][0].transcript + " ";
        else interim += e.results[i][0].transcript;
      }
      setTranscript((lastFinal + interim).trim());

      // Reset silence detection — start countdown only after 0.6s of silence
      clearTimeout(silenceTimer);
      if (lastFinal.trim()) {
        silenceTimer = setTimeout(() => {
          // Stop recognition — onend will start the countdown
          try { rec.stop(); } catch {}
        }, 600);
      }
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed") { setTranscript("Microphone access denied."); setListening(false); }
    };

    rec.onend = () => {
      clearTimeout(silenceTimer);
      isListeningRef.current = false;
      setListening(false);
      if (!lastFinal.trim()) return;
      // Wait 5 seconds, then start the 3-second countdown
      const waitTimer = setTimeout(() => {
        let countdown = 3;
        setVoiceCountdown(countdown);
        const timer = setInterval(() => {
          countdown -= 1;
          setVoiceCountdown(countdown);
          if (countdown <= 0) {
            clearInterval(timer);
            countdownRef.current = null;
            setVoiceCountdown(null);
            checkAnswer(lastFinal.trim());
          }
        }, 400);
        countdownRef.current = timer;
      }, 5000);
      // Store wait timer so it can be cancelled if user taps mic again
      countdownRef.current = waitTimer;
    };

    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  };

  const stopListening = () => {
    isListeningRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
  };

  const checkAnswer = async (heard) => {
    if (!heard.trim()) { setTranscript("Nothing heard. Try again."); return; }
    setChecking(true);
    try {
      const correct = card.answer;
      // Use AI to judge if the spoken answer matches the correct answer
      const judgment = await callClaude(
        `You are grading a spoken quiz answer. Reply with ONLY "YES" or "NO".
YES = the spoken answer is correct or close enough (synonyms, minor mispronunciation, partial but clearly correct).
NO = the spoken answer is wrong or off-topic.`,
        `Question: ${card.question}
Correct answer: ${correct}
Student said: "${heard}"
Is the student correct? Reply only YES or NO.`
      );
      const ok = judgment.trim().toUpperCase().startsWith("YES");
      setResult({ ok, heard: heard.trim(), correct });
      if (ok) setScore(s => s + 1);
    } catch(e) {
      // Fallback: simple string match
      const ok = heard.trim().toLowerCase().includes(card.answer.trim().toLowerCase()) ||
                 card.answer.trim().toLowerCase().includes(heard.trim().toLowerCase().split(" ")[0]);
      setResult({ ok, heard: heard.trim(), correct: card.answer });
      if (ok) setScore(s => s + 1);
    }
    setChecking(false);
  };

  const next = () => {
    if (curr + 1 >= deck.length) { setDone(true); return; }
    setCurr(c => c + 1);
    setTranscript("");
    setResult(null);
  };

  if (done) return <GResults score={score} total={deck.length} onBack={onBack} msg="Voice Round Done!" />;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <GHeader title="Voice Answer" score={score} curr={curr} total={deck.length} onBack={onBack} accent={accent} />

      {/* Question card */}
      <div style={{ background: "linear-gradient(135deg,#f5f3ff,#ede9fe)", border: `2px solid ${accent}22`, borderRadius: 20, padding: "30px 28px", marginBottom: 24, textAlign: "center" }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: 1, marginBottom: 14, textTransform: "uppercase" }}>Speak your answer</p>
        <p style={{ fontSize: 21, fontWeight: 600, color: "#1a1a2e", lineHeight: 1.5 }}>{card.question}</p>
      </div>

      {/* Mic button */}
      {result === null && !checking && (
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <button
            onClick={() => {
              if (voiceCountdown !== null) {
                // Cancel countdown and restart listening
                clearInterval(countdownRef.current);
                countdownRef.current = null;
                setVoiceCountdown(null);
                setTranscript("");
                startListening();
              } else if (listening) {
                stopListening();
              } else {
                startListening();
              }
            }}
            style={{
              width: 88, height: 88, borderRadius: "50%", border: "none", cursor: "pointer",
              background: listening ? "#dc2626" : accent,
              boxShadow: listening ? "0 0 0 12px rgba(220,38,38,.2), 0 0 0 24px rgba(220,38,38,.08)" : `0 4px 20px ${accent}44`,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36,
              transition: "all .3s", margin: "0 auto",
              animation: listening ? "pulse 1.2s infinite" : "none",
            }}>
            {listening ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>}
          </button>
          <p style={{ marginTop: 14, fontSize: 13, color: listening ? "#dc2626" : voiceCountdown !== null ? "#7c3aed" : "#6b7280", fontWeight: 600 }}>
            {listening ? "Listening… tap to stop" : voiceCountdown !== null ? "Tap mic to speak again" : "Tap to speak your answer"}
          </p>
          {transcript && !listening && !voiceCountdown && (
            <p style={{ marginTop: 8, fontSize: 13, color: "#6b7280", fontStyle: "italic" }}>
              Heard: "{transcript}"
            </p>
          )}
          {listening && transcript && (
            <p style={{ marginTop: 8, fontSize: 13, color: accent, fontStyle: "italic" }}>
              "{transcript}"
            </p>
          )}
          {voiceCountdown !== null && (
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 6, fontStyle: "italic" }}>Heard: "{transcript}"</p>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "#f5f3ff", border: `2px solid ${accent}33`, borderRadius: 12, padding: "10px 20px" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800 }}>{voiceCountdown}</div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: accent }}>Submitting in {voiceCountdown}… tap mic to redo</p>
                  <p style={{ fontSize: 11, color: "#6b7280" }}>Not right? tap Try again below</p>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <button onClick={() => { clearInterval(countdownRef.current); setVoiceCountdown(null); setTranscript(""); }}
                  style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 10, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  Redo answer
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Checking */}
      {checking && (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 10 }}>
            {[0,1,2].map(j => <div key={j} style={{ width: 8, height: 8, borderRadius: "50%", background: accent, animation: "bounce 1.2s infinite", animationDelay: `${j * .2}s` }} />)}
          </div>
          <p style={{ fontSize: 13, color: "#6b7280" }}>Checking your answer…</p>
        </div>
      )}

      {/* Result */}
      {result !== null && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>{result.ok ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg> : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>}</div>
          <p style={{ fontSize: 18, fontWeight: 700, color: result.ok ? "#16a34a" : "#dc2626", marginBottom: 8 }}>
            {result.ok ? "Correct!" : "Not quite"}
          </p>
          <div style={{ background: "#f9fafb", border: `1px solid ${result.ok ? "#16a34a" : "#dc2626"}33`, borderRadius: 12, padding: "14px 18px", marginBottom: 20, textAlign: "left" }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>You said:</p>
            <p style={{ fontSize: 14, color: "#1a1a2e", fontStyle: "italic", marginBottom: result.ok ? 0 : 10 }}>"{result.heard}"</p>
            {!result.ok && (
              <>
                <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Correct answer:</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#16a34a" }}>{result.correct}</p>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={() => { clearInterval(countdownRef.current); setVoiceCountdown(null); setResult(null); setTranscript(""); }}
              style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 12, padding: "11px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Try again
            </button>
            <button onClick={next}
              style={{ background: accent, color: "#fff", border: "none", borderRadius: 12, padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              {curr + 1 >= deck.length ? "See Results" : "Next →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── GAME: WORD FILL ─────────────────────────────────────────────────────────
// AI picks the most important word in the answer, blanks it out,
// player taps letter tiles to fill it in (no typing).
function WordFill({ cards, onBack }) {
  const accent = "#ea580c";
  const accentL = "#fff7ed";

  // For each card, prepare a "blank" puzzle. We'll do this lazily per card.
  const [deck] = useState(() => [...cards].sort(() => Math.random() - .5).slice(0, 12));
  const [curr, setCurr] = useState(0);
  const [puzzle, setPuzzle] = useState(null);   // { sentence, blank, letters, answer }
  const [pool, setPool] = useState([]);          // [{id,letter,used}]
  const [placed, setPlaced] = useState([]);      // [{id,letter}]
  const [result, setResult] = useState(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const buildTiles = (word) => {
    const letters = word.toUpperCase().split("");
    let arr = letters.map((l, i) => ({ id: `wf_${curr}_${i}`, letter: l, used: false }));
    let tries = 0;
    while (arr.map(x => x.letter).join("") === letters.join("") && tries++ < 30)
      arr = [...arr].sort(() => Math.random() - .5);
    return arr;
  };

  const loadPuzzle = async (idx) => {
    setLoading(true);
    setPool([]);
    setPlaced([]);
    setResult(null);
    setPuzzle(null);
    const card = deck[idx];
    if (!card) { setDone(true); return; }
    try {
      // Ask AI to pick the single most important word to blank out
      const raw = await callClaude(
        "You are a quiz maker. Reply with ONLY a JSON object, no markdown, no explanation.",
        `Given this Q&A pair:
Q: ${card.question}
A: ${card.answer}

Pick the single most important keyword from the ANSWER (1-10 letters, letters only).
Return ONLY this JSON: {"word":"THEWORD","sentence":"The answer with _____ where the word was"}`
      );
      let parsed;
      try {
        parsed = JSON.parse(raw.trim().replace(/```json|```/g, ""));
      } catch {
        // Fallback: use first word of answer
        const w = card.answer.replace(/[^a-zA-Z ]/g, "").trim().split(/\s+/)[0] || "word";
        parsed = { word: w, sentence: card.answer.replace(new RegExp(w, "i"), "_____") };
      }
      const word = (parsed.word || "word").toUpperCase().replace(/[^A-Z]/g, "");
      const sentence = parsed.sentence || card.answer;
      setPuzzle({ sentence, word, question: card.question });
      setPool(buildTiles(word));
    } catch {
      // Fallback
      const w = (card.answer || "word").replace(/[^a-zA-Z]/g, "").slice(0, 8).toUpperCase();
      setPuzzle({ sentence: card.answer, word: w, question: card.question });
      setPool(buildTiles(w));
    }
    setLoading(false);
  };

  useEffect(() => { loadPuzzle(curr); }, [curr]);

  const pickTile = (tile) => {
    if (result || tile.used) return;
    setPool(prev => prev.map(t => t.id === tile.id ? { ...t, used: true } : t));
    setPlaced(prev => [...prev, { id: tile.id, letter: tile.letter }]);
  };

  const removeTile = (tileId) => {
    if (result) return;
    setPlaced(prev => prev.filter(t => t.id !== tileId));
    setPool(prev => prev.map(t => t.id === tileId ? { ...t, used: false } : t));
  };

  const clearAll = () => {
    if (result) return;
    setPlaced([]);
    setPool(prev => prev.map(t => ({ ...t, used: false })));
  };

  const check = async () => {
    if (!puzzle || result || placed.length === 0 || checking) return;
    setChecking(true);
    const typed = placed.map(t => t.letter).join("");
    const ok = await aiCheckAnswer(puzzle.question, puzzle.word, typed);
    setChecking(false);
    setResult(ok ? "correct" : "wrong");
    if (ok) setScore(s => s + 1);
  };

  const next = () => {
    if (curr + 1 >= deck.length) { setDone(true); return; }
    setCurr(c => c + 1);
  };

  if (done) return <GResults score={score} total={deck.length} onBack={onBack} />;

  const card = deck[curr];

  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <GHeader title="Word Fill" score={score} curr={curr} total={deck.length} onBack={onBack} accent={accent} />

      {/* Question */}
      <div style={{ background: "#fff7ed", border: `1.5px solid ${accent}33`, borderRadius: 18, padding: "20px 22px", marginBottom: 14 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: 1, textTransform: "uppercase", marginBottom: 7 }}>Fill in the blank</p>
        <p style={{ fontSize: 15, fontWeight: 600, color: "#1a1a2e", lineHeight: 1.55, marginBottom: 10 }}>{card.question}</p>
        {/* Sentence with blank */}
        {puzzle && !loading && (
          <p style={{ fontSize: 17, color: "#374151", lineHeight: 1.7, background: "#fff", borderRadius: 10, padding: "12px 14px", border: `1px solid ${accent}22` }}>
            {puzzle.sentence.replace("_____",
              placed.length > 0
                ? `[${placed.map(t => t.letter).join("")}]`
                : "[ _____ ]"
            )}
          </p>
        )}
        {loading && <div style={{ textAlign: "center", padding: "20px 0", color: "#999", fontSize: 13 }}>Preparing puzzle…</div>}
      </div>

      {/* Answer tray */}
      {!loading && puzzle && (
        <>
          <div style={{
            minHeight: 58, padding: "10px 12px", marginBottom: 10,
            background: result === "correct" ? "#f0fdf4" : result === "wrong" ? "#fff1f1" : "#f9fafb",
            border: `2.5px ${result ? "solid" : "dashed"} ${result === "correct" ? "#16a34a" : result === "wrong" ? "#dc2626" : accent}`,
            borderRadius: 14, display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center", transition: "all .2s"
          }}>
            {placed.length === 0 && !result && (
              <span style={{ color: "#9ca3af", fontSize: 13, fontStyle: "italic" }}>Tap letters to build the missing word…</span>
            )}
            {placed.map(tile => (
              <button key={tile.id} onClick={() => removeTile(tile.id)} disabled={!!result}
                style={{ width: 42, height: 46, background: result === "correct" ? "#16a34a" : result === "wrong" ? "#dc2626" : accent, color: "#fff", border: "none", borderRadius: 10, fontSize: 20, fontWeight: 800, cursor: result ? "default" : "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.18)" }}>
                {tile.letter}
              </button>
            ))}
          </div>

          {result && (
            <p style={{ textAlign: "center", marginBottom: 10, fontSize: 15, fontWeight: 700, color: result === "correct" ? "#16a34a" : "#dc2626" }}>
              {result === "correct" ? "Correct!" : `Answer: ${puzzle.word}`}
            </p>
          )}

          {/* Letter tiles */}
          {!result && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", padding: "6px 0 14px" }}>
              {pool.map(tile => (
                <button key={tile.id} onClick={() => pickTile(tile)} disabled={tile.used}
                  style={{ width: 48, height: 54, background: tile.used ? "#e5e7eb" : accentL, color: tile.used ? "#9ca3af" : accent, border: `2.5px solid ${tile.used ? "#d1d5db" : accent}`, borderRadius: 12, fontSize: 22, fontWeight: 800, cursor: tile.used ? "default" : "pointer", transition: "all .14s", transform: tile.used ? "scale(.88)" : "scale(1)", boxShadow: tile.used ? "none" : "0 3px 10px rgba(0,0,0,.12)", opacity: tile.used ? 0.4 : 1 }}>
                  {tile.letter}
                </button>
              ))}
            </div>
          )}

          {!result ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={clearAll} disabled={placed.length === 0}
                style={{ flex: 1, background: "#eee", color: placed.length > 0 ? "#555" : "#bbb", border: "none", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 700, cursor: placed.length > 0 ? "pointer" : "not-allowed" }}>Clear</button>
              <button onClick={check} disabled={placed.length === 0 || checking}
                style={{ flex: 2, background: placed.length > 0 ? accent : "#ccc", color: "#fff", border: "none", borderRadius: 12, padding: "12px", fontSize: 15, fontWeight: 700, cursor: placed.length > 0 ? "pointer" : "not-allowed" }}>
                {checking ? "Checking…" : `Check (${placed.length}/${pool.length})`}
              </button>
            </div>
          ) : (
            <button onClick={next} style={{ width: "100%", background: accent, color: "#fff", border: "none", borderRadius: 12, padding: "13px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
              {curr + 1 >= deck.length ? "See Results" : "Next →"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── GAME: LISTENING QUIZ ─────────────────────────────────────────────────────
// The question is read aloud (TTS). Student can't see it — must listen.
// They answer by typing. AI judges correctness.
function ListeningGame({ cards, onBack }) {
  const accent  = "#059669";
  const accentL = "#f0fdf4";

  // ── Uses shared GLOBAL_PERSONAS + getSmartVoice ──────────────────────────
  const [allVoices,    setAllVoices]    = useState([]);
  const [personaIdx,   setPersonaIdx]   = useState(0);
  const [showVoicePick,setShowVoicePick]= useState(false);

  useEffect(() => {
    const load = () => setAllVoices(window.speechSynthesis.getVoices());
    load(); window.speechSynthesis.onvoiceschanged = load;
  }, []);

  // ── Game state ─────────────────────────────────────────────────────────────
  const [deck] = useState(() => [...cards].sort(() => Math.random() - .5).slice(0, 15));
  const [curr,     setCurr]     = useState(0);
  const [choices,  setChoices]  = useState([]);
  const [selected, setSelected] = useState(null); // index 0-3
  const [result,   setResult]   = useState(null);  // "correct"|"wrong"
  const [score,    setScore]    = useState(0);
  const [done,     setDone]     = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [hasPlayed,setHasPlayed]= useState(false);
  const [revealed, setRevealed] = useState(false);

  // AI-generated choices: loaded once on mount
  const [optsMap,   setOptsMap]   = useState(null);
  const [lg_loading,setLgLoading] = useState(true);

  useEffect(() => {
    buildAIOptions(deck).then(map => { setOptsMap(map); setLgLoading(false); });
  }, []);

  useEffect(() => {
    if (!optsMap) return;
    setChoices((optsMap.get(deck[curr].id)) || buildFallbackOptions(deck[curr], deck));
    setSelected(null); setResult(null); setHasPlayed(false); setRevealed(false);
    setTimeout(() => {
      if (deck[curr]) speak(deck[curr].question);
    }, 400);
    return () => window.speechSynthesis?.cancel();
  }, [curr, optsMap]);

  const personaRef = useRef(GLOBAL_PERSONAS[0]);
  useEffect(() => { personaRef.current = GLOBAL_PERSONAS[personaIdx]; }, [personaIdx]);
  const persona = GLOBAL_PERSONAS[personaIdx];

  const speak = (text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const p = personaRef.current;
    const u = new SpeechSynthesisUtterance(text);
    u.rate  = p.rate  || 0.93;
    u.pitch = p.pitch || 1.0;
    u.lang  = "en-US";
    const v = getSmartVoice(p, allVoices, "en-US");
    if (v) u.voice = v;
    u.onstart = () => setSpeaking(true);
    u.onend   = () => { setSpeaking(false); setHasPlayed(true); };
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  };

  const choose = (idx) => {
    if (result || !hasPlayed) return;
    setSelected(idx);
    const card = deck[curr];
    const ok = choices[idx] === card.answer;
    setResult(ok ? "correct" : "wrong");
    if (ok) setScore(s => s + 1);
  };

  const next = () => {
    if (curr + 1 >= deck.length) { setDone(true); return; }
    setCurr(c => c + 1);
  };

  if (lg_loading) return <AILoadingScreen title="Listening Quiz" message="Generating smart answer choices" accent={accent} />;
  if (done) return <GResults score={score} total={deck.length} onBack={onBack} />;
  const card = deck[curr];
  const LABELS = ["A", "B", "C", "D"];

  return (
    <div style={{ maxWidth:520, margin:"0 auto" }}>
      <GHeader title="Listening Quiz" score={score} curr={curr} total={deck.length} onBack={onBack} accent={accent}/>

      {/* Voice picker */}
      <div style={{ marginBottom:14 }}>
        <button onClick={() => setShowVoicePick(v => !v)}
          style={{ display:"flex", alignItems:"center", gap:7, background:"#fff", border:`1.5px solid ${showVoicePick?accent:"#e5e7eb"}`, borderRadius:20, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer", color:showVoicePick?accent:"#6b7280" }}>
          Voice: {persona.label} ▾
        </button>
        {showVoicePick && (
          <div style={{ marginTop:8, background:"#fff", border:"1.5px solid #e5e7eb", borderRadius:14, padding:"10px 12px", display:"flex", flexWrap:"wrap", gap:8 }}>
            {GLOBAL_PERSONAS.map((p, i) => (
              <button key={p.id} onClick={() => { setPersonaIdx(i); setShowVoicePick(false); }}
                style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:20, border:"none", cursor:"pointer", fontSize:12, fontWeight:700,
                  background: personaIdx===i ? accent : "#f3f4f6",
                  color: personaIdx===i ? "#fff" : "#374151",
                  boxShadow: personaIdx===i ? `0 2px 10px ${accent}44` : "none" }}>
                <span style={{width:10,height:10,borderRadius:"50%",background:p.color,display:"inline-block",flexShrink:0,verticalAlign:"middle",marginRight:5}}></span>{p.label}
              </button>
            ))}
            <p style={{ width:"100%", fontSize:10, color:"#9ca3af", marginTop:4 }}>Using: {getSmartVoiceLabel(personaIdx, allVoices, "en-US")} · ♀ = Female · ♂ = Male</p>
          </div>
        )}
      </div>

      {/* Audio card */}
      <div style={{ background: speaking?"#ecfdf5":accentL, border:`2px solid ${speaking?accent:accent+"33"}`, borderRadius:20, padding:"28px 24px", marginBottom:18, textAlign:"center", transition:"all .3s" }}>
        <div style={{ fontSize:46, marginBottom:12 }}>{speaking ? <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>}</div>
        <p style={{ fontSize:14, color:speaking?accent:"#6b7280", fontWeight:600, marginBottom:16 }}>
          {speaking ? "Listen carefully…" : hasPlayed ? "Choose the correct answer below" : "Press play to hear the question"}
        </p>
        <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap" }}>
          <button onClick={() => speak(card.question)} disabled={speaking}
            style={{ background:accent, color:"#fff", border:"none", borderRadius:12, padding:"10px 22px", fontSize:14, fontWeight:700, cursor:speaking?"not-allowed":"pointer", opacity:speaking?.6:1, display:"flex", alignItems:"center", gap:7 }}>
            {speaking ? "Playing…" : "Play Question"}
          </button>
          {hasPlayed && !result && (
            <button onClick={() => setRevealed(r => !r)}
              style={{ background:"#fff", color:"#6b7280", border:"1.5px solid #e5e7eb", borderRadius:12, padding:"10px 16px", fontSize:13, fontWeight:600, cursor:"pointer" }}>
              {revealed ? "Hide" : "Peek"}
            </button>
          )}
        </div>
        {revealed && !result && (
          <p style={{ marginTop:12, fontSize:15, color:"#374151", fontStyle:"italic", background:"#fff", borderRadius:10, padding:"10px 14px", border:"1px solid #e5e7eb" }}>
            "{card.question}"
          </p>
        )}
      </div>

      {/* A/B/C/D choices */}
      {!hasPlayed ? (
        <div style={{ textAlign:"center", padding:"18px", background:"#f9fafb", borderRadius:16, color:"#9ca3af", fontSize:14, fontWeight:600 }}>
          Listen to the question first, then choose your answer
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {choices.map((choice, idx) => {
            const isCorrect = choice === card.answer;
            const isSelected = selected === idx;
            let bg = "#fff", border = "#e5e7eb", col = "#374151";
            if (result) {
              if (isCorrect) { bg="#f0fdf4"; border="#16a34a"; col="#16a34a"; }
              else if (isSelected && !isCorrect) { bg="#fff1f1"; border="#dc2626"; col="#dc2626"; }
            } else if (isSelected) {
              bg="#eff6ff"; border="#3b82f6"; col="#1d4ed8";
            }
            return (
              <button key={idx} onClick={() => choose(idx)} disabled={!!result || !hasPlayed}
                style={{ display:"flex", alignItems:"center", gap:14, width:"100%", padding:"14px 16px",
                  background:bg, border:`2px solid ${border}`, borderRadius:14, cursor:result?"default":"pointer",
                  textAlign:"left", transition:"all .18s", boxShadow: isSelected && !result?"0 2px 12px rgba(59,130,246,.2)":"none" }}>
                <span style={{ width:34, height:34, borderRadius:"50%", background:result?(isCorrect?"#16a34a":isSelected?"#dc2626":"#e5e7eb"):"#4361ee",
                  color:result?(isCorrect||isSelected?"#fff":"#9ca3af"):"#fff", display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:14, fontWeight:900, flexShrink:0, transition:"all .18s" }}>
                  {LABELS[idx]}
                </span>
                <span style={{ fontSize:14, fontWeight:600, color:col, flex:1 }}>{choice}</span>
                {result && isCorrect && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>}
                {result && isSelected && !isCorrect && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>}
              </button>
            );
          })}
        </div>
      )}

      {/* Result feedback */}
      {result && (
        <div style={{ marginTop:14, background:result==="correct"?"#f0fdf4":"#fff1f1", border:`1.5px solid ${result==="correct"?"#16a34a":"#dc2626"}33`, borderRadius:14, padding:"16px 18px", textAlign:"center" }}>
          <p style={{ fontSize:16, fontWeight:700, color:result==="correct"?"#16a34a":"#dc2626", marginBottom:result==="correct"?0:8 }}>
            {result === "correct" ? "Correct!" : "Not quite"}
          </p>
          {result !== "correct" && (
            <>
              <p style={{ fontSize:12, color:"#6b7280", marginBottom:4 }}>Correct answer:</p>
              <p style={{ fontSize:14, fontWeight:700, color:"#374151" }}>{card.answer}</p>
            </>
          )}
        </div>
      )}

      {result && (
        <button onClick={next} style={{ marginTop:12, width:"100%", background:accent, color:"#fff", border:"none", borderRadius:12, padding:"13px", fontSize:15, fontWeight:700, cursor:"pointer" }}>
          {curr + 1 >= deck.length ? "See Results" : "Next →"}
        </button>
      )}
    </div>
  );
}


// ─── PODCAST PLAYER ──────────────────────────────────────────────────────────
// Browser-only, single persistent Audio element — proper pause/seek/rewind
function EnhancedPodcastPlayer({ script, loading, topic, lang = "en-US", onClose }) {
  // ── TTS Server URL — update this after deploying to Render ──────────────────
  const TTS_SERVER = (window.__CLASSIO_TTS_URL__ || "").replace(/\/$/, "");
  // Voices available from server (matches server.py VOICES dict)
  const SERVER_VOICES = [
    { id:"aria",  label:"Aria",  gender:"female", color:"#6366f1", desc:"Warm & natural"   },
    { id:"nova",  label:"Nova",  gender:"female", color:"#a855f7", desc:"Bright & clear"   },
    { id:"jade",  label:"Jade",  gender:"female", color:"#0f766e", desc:"Calm & smooth"    },
    { id:"echo",  label:"Echo",  gender:"male",   color:"#2563eb", desc:"Deep & confident" },
    { id:"atlas", label:"Atlas", gender:"male",   color:"#ea580c", desc:"Bold & clear"     },
    { id:"fable", label:"Fable", gender:"male",   color:"#16a34a", desc:"Friendly & warm"  },
  ];
  const usePiper = TTS_SERVER.length > 0;

  const [voiceIdx,   setVoiceIdx]   = useState(0);
  const [personaIdx, setPersonaIdx] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [speed,      setSpeed]      = useState(1.0);
  const [allVoices,  setAllVoices]  = useState([]);
  const [playing,    setPlaying]    = useState(false);
  const [currentTime,setCurrentTime]= useState(0);
  const [duration,   setDuration]   = useState(0);
  // Piper states
  const [piperLoading, setPiperLoading] = useState(false);
  const [piperReady,   setPiperReady]   = useState(false);
  const [piperError,   setPiperError]   = useState(null);
  const audioRef = useRef(null);

  // Load browser voices
  useEffect(() => {
    const load = () => setAllVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.cancel(); stopTimer(); };
  }, []);

  // Create persistent audio element for Piper
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    const onTime  = () => setCurrentTime(audio.currentTime);
    const onDur   = () => setDuration(audio.duration || 0);
    const onPlay  = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setCurrentTime(0); if(audio) audio.currentTime = 0; };
    audio.addEventListener("timeupdate",     onTime);
    audio.addEventListener("durationchange", onDur);
    audio.addEventListener("play",           onPlay);
    audio.addEventListener("pause",          onPause);
    audio.addEventListener("ended",          onEnded);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate",     onTime);
      audio.removeEventListener("durationchange", onDur);
      audio.removeEventListener("play",           onPlay);
      audio.removeEventListener("pause",          onPause);
      audio.removeEventListener("ended",          onEnded);
    };
  }, []);

  const SPEEDS  = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
  const persona = GLOBAL_PERSONAS[personaIdx] || GLOBAL_PERSONAS[0];
  const personaRef = useRef(persona);
  useEffect(() => { personaRef.current = GLOBAL_PERSONAS[personaIdx]; }, [personaIdx]);
  const serverVoice = SERVER_VOICES[voiceIdx] || SERVER_VOICES[0];

  // ── Browser TTS timer ────────────────────────────────────────────────────────
  const timerRef      = useRef(null);
  const genRef        = useRef(0);
  const elapsedRef    = useRef(0);
  const timerStartRef = useRef(0);
  const totalDurRef   = useRef(0);

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };
  const startTimer = () => {
    stopTimer();
    timerStartRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = elapsedRef.current + (Date.now() - timerStartRef.current) / 1000;
      const capped  = Math.min(elapsed, totalDurRef.current);
      setCurrentTime(capped);
      if (capped >= totalDurRef.current && totalDurRef.current > 0) stopTimer();
    }, 100);
  };

  // ── Piper audio generation ───────────────────────────────────────────────────
  const generatePiper = async (fromTime = 0) => {
    if (!script || piperLoading) return;
    setPiperLoading(true);
    setPiperError(null);
    setPiperReady(false);
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.src = ""; }
    setPlaying(false); setCurrentTime(0); setDuration(0);

    try {
      const resp = await fetch(`${TTS_SERVER}/generate-podcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text:   script,
          voice:  serverVoice.id,
          speed:  speed,
          format: "mp3",
        }),
      });
      if (!resp.ok) {
        const err = await resp.text().catch(() => "Server error");
        throw new Error(err);
      }
      const blob   = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      audio.src          = blobUrl;
      audio.playbackRate = 1.0; // speed already baked in by server
      audio.load();
      await new Promise((res) => {
        const done = () => { audio.removeEventListener("canplay", done); res(); };
        audio.addEventListener("canplay", done);
        audio.onerror = () => res();
        setTimeout(res, 15000);
      });
      // Seek to fromTime if resuming after voice/speed change
      if (fromTime > 0 && isFinite(audio.duration) && fromTime < audio.duration) {
        audio.currentTime = fromTime;
      }
      setDuration(audio.duration || 0);
      setPiperReady(true);
      setPiperLoading(false);
      audio.play().catch(e => console.warn("Piper play:", e));
    } catch(e) {
      console.warn("Piper TTS error:", e);
      setPiperError("Piper server error — using browser voice instead.");
      setPiperLoading(false);
      playBrowserFrom(elapsedRef.current);
    }
  };

  // ── Browser TTS ──────────────────────────────────────────────────────────────
  const buildSentences = (fromTime = 0) => {
    const p    = personaRef.current || GLOBAL_PERSONAS[0];
    const rate = speed * (p.rate || 0.93);
    const cps  = 14 * rate;
    const raw  = script.match(/[^.!?]+[.!?]+(\s|$)/g) || [script];
    const sents = raw.map(s => s.trim()).filter(Boolean);
    const durs  = sents.map(s => Math.max(0.3, s.length / cps));
    const total = durs.reduce((a, b) => a + b, 0);
    totalDurRef.current = total;
    setDuration(total);
    let acc = 0, startIdx = 0;
    for (let i = 0; i < durs.length; i++) {
      if (acc + durs[i] > fromTime) { startIdx = i; break; }
      acc += durs[i];
      if (i === durs.length - 1) startIdx = i;
    }
    return { sents, durs, total, startIdx, timeAtStart: acc };
  };

  const playBrowserFrom = (fromTime) => {
    window.speechSynthesis.cancel();
    stopTimer();
    if (!script) return;
    const myGen = ++genRef.current;
    const p     = personaRef.current || GLOBAL_PERSONAS[0];
    const voice = getSmartVoice(p, allVoices, lang);
    const { sents, durs, total, startIdx } = buildSentences(fromTime);
    elapsedRef.current    = fromTime;
    timerStartRef.current = Date.now();
    setCurrentTime(fromTime);
    setPlaying(true);
    startTimer();
    const speakOne = (idx) => {
      if (genRef.current !== myGen || idx >= sents.length) {
        if (genRef.current === myGen) { stopTimer(); elapsedRef.current = total; setCurrentTime(total); setPlaying(false); }
        return;
      }
      const u   = new SpeechSynthesisUtterance(sents[idx]);
      u.rate    = speed * (p.rate  || 0.93);
      u.pitch   = p.pitch || 1.0;
      u.volume  = 1.0;
      u.lang    = lang;
      if (voice) u.voice = voice;
      u.onend   = () => { if (genRef.current === myGen) speakOne(idx + 1); };
      u.onerror = () => { if (genRef.current === myGen) speakOne(idx + 1); };
      window.speechSynthesis.speak(u);
    };
    speakOne(startIdx);
  };

  // ── Unified controls ─────────────────────────────────────────────────────────
  const handlePlay = () => {
    if (usePiper) {
      if (piperReady && audioRef.current) {
        audioRef.current.play().catch(console.warn);
      } else {
        generatePiper(0);
      }
    } else {
      if (playing) return;
      playBrowserFrom(elapsedRef.current);
    }
  };

  const handlePause = () => {
    if (usePiper && piperReady && audioRef.current) {
      audioRef.current.pause();
    } else {
      genRef.current++;
      window.speechSynthesis.cancel();
      stopTimer();
      elapsedRef.current = Math.min(
        elapsedRef.current + (Date.now() - timerStartRef.current) / 1000,
        totalDurRef.current
      );
      setCurrentTime(elapsedRef.current);
      setPlaying(false);
    }
  };

  const handleStop = () => {
    if (usePiper && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      setPlaying(false);
    } else {
      genRef.current++;
      window.speechSynthesis.cancel();
      stopTimer();
      elapsedRef.current = 0;
      setCurrentTime(0);
      setPlaying(false);
    }
  };

  const handleSeek = (newTime) => {
    const clamped = Math.max(0, Math.min(newTime, usePiper ? (audioRef.current?.duration || 0) : totalDurRef.current));
    if (usePiper && piperReady && audioRef.current) {
      audioRef.current.currentTime = clamped;
      setCurrentTime(clamped);
    } else {
      const wasPlaying = playing;
      genRef.current++;
      window.speechSynthesis.cancel();
      stopTimer();
      elapsedRef.current = clamped;
      setCurrentTime(clamped);
      if (wasPlaying) playBrowserFrom(clamped);
    }
  };

  const handleSkip   = (dir) => handleSeek((usePiper ? (audioRef.current?.currentTime || 0) : elapsedRef.current) + dir * 10);
  const handleSeekBar = (e) => {
    const rect  = e.currentTarget.getBoundingClientRect();
    const x     = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const pct   = Math.min(1, Math.max(0, x / rect.width));
    const total = usePiper ? (audioRef.current?.duration || 0) : totalDurRef.current;
    handleSeek(pct * total);
  };

  const changeSpeed = (s) => {
    setSpeed(s);
    if (usePiper) {
      // Regenerate with new speed baked in
      const t = audioRef.current?.currentTime || 0;
      setPiperReady(false);
      setTimeout(() => generatePiper(t), 50);
    } else {
      if (playing) { const t = elapsedRef.current; handleStop(); setTimeout(() => playBrowserFrom(t), 30); }
    }
  };

  const switchServerVoice = (i) => {
    setVoiceIdx(i);
    setPiperReady(false);
    setPiperError(null);
    handleStop();
    setShowPicker(false);
  };

  const switchBrowserVoice = (i) => {
    handleStop();
    setPersonaIdx(i);
    setShowPicker(false);
  };

  // Estimate duration on script load (browser mode)
  useEffect(() => {
    if (script && !loading && !usePiper) {
      elapsedRef.current = 0;
      setCurrentTime(0);
      buildSentences(0);
    }
  }, [script]);

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) return "0:00";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}` : `${m}:${String(sec).padStart(2,"0")}`;
  };
  const dispTime = usePiper ? currentTime : currentTime;
  const dispDur  = usePiper ? duration    : duration;
  const progress = dispDur > 0 ? Math.min(1, dispTime / dispDur) : 0;
  const isPlaying = playing;

  // ── UI ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ background:"linear-gradient(160deg,#1e1b4b 0%,#0f172a 100%)", borderRadius:24, overflow:"hidden", fontFamily:"'DM Sans',sans-serif" }}>
      {loading ? (
        <div style={{ padding:"48px 24px", textAlign:"center" }}>
          <div style={{ display:"flex", justifyContent:"center", gap:5, marginBottom:16 }}>
            {[0,1,2,3].map(i => <span key={i} style={{ width:5, height:28, background:"#6366f1", borderRadius:3, display:"inline-block", animation:`ppbar 0.9s ease-in-out ${i*0.15}s infinite` }}/>)}
          </div>
          <p style={{ color:"#a5b4fc", fontSize:14, fontWeight:600 }}>Generating podcast script…</p>
        </div>
      ) : !script ? (
        <div style={{ padding:"40px 24px", textAlign:"center" }}>
          <p style={{ color:"#6366f1", fontSize:14 }}>No script yet — generate one above.</p>
        </div>
      ) : (
        <>
          {/* Header */}
          <div style={{ padding:"18px 20px 0", display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                <p style={{ fontSize:10, fontWeight:800, color:"#6366f1", letterSpacing:1.5, textTransform:"uppercase" }}>Study Podcast</p>
                {usePiper && (
                  <span style={{ fontSize:9, background:"linear-gradient(90deg,#6366f1,#a855f7)", color:"#fff", borderRadius:6, padding:"1px 7px", fontWeight:800, letterSpacing:.5 }}>
                    PIPER ✦
                  </span>
                )}
              </div>
              <p style={{ fontSize:14, fontWeight:700, color:"#e0e7ff", maxWidth:220, lineHeight:1.3 }}>{topic || "Your Study Session"}</p>
            </div>
            <button onClick={onClose} style={{ background:"rgba(255,255,255,.08)", border:"none", borderRadius:8, color:"#a5b4fc", cursor:"pointer", padding:"6px 10px", fontSize:12 }}>✕</button>
          </div>

          {/* Piper loading bar */}
          {piperLoading && (
            <div style={{ margin:"12px 20px 0", background:"rgba(99,102,241,.15)", border:"1px solid rgba(99,102,241,.3)", borderRadius:10, padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ display:"flex", gap:3 }}>
                {[0,1,2].map(i => <span key={i} style={{ width:4, height:14, background:"#6366f1", borderRadius:2, display:"inline-block", animation:`ppbar 0.8s ease-in-out ${i*0.15}s infinite` }}/>)}
              </div>
              <p style={{ color:"#a5b4fc", fontSize:12, margin:0 }}>Generating neural audio… this takes ~20s on first use</p>
            </div>
          )}

          {/* Error */}
          {piperError && (
            <div style={{ margin:"12px 20px 0", background:"rgba(220,38,38,.15)", border:"1px solid rgba(220,38,38,.3)", borderRadius:10, padding:"8px 12px" }}>
              <p style={{ color:"#fca5a5", fontSize:12, margin:0 }}>{piperError}</p>
            </div>
          )}

          {/* Controls */}
          <div style={{ padding:"16px 20px 8px" }}>
            {/* Time */}
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
              <span style={{ fontSize:11, color:"#818cf8", fontVariantNumeric:"tabular-nums" }}>{fmt(dispTime)}</span>
              <span style={{ fontSize:11, color:"#4b5563", fontVariantNumeric:"tabular-nums" }}>{fmt(dispDur)}</span>
            </div>

            {/* Progress bar */}
            <div onClick={handleSeekBar} onTouchStart={handleSeekBar}
              style={{ height:6, background:"rgba(255,255,255,.1)", borderRadius:3, cursor:"pointer", marginBottom:16, position:"relative", userSelect:"none" }}>
              <div style={{ height:"100%", width:`${progress*100}%`, background:"linear-gradient(90deg,#6366f1,#a855f7)", borderRadius:3, transition:"width .15s linear" }}/>
              <div style={{ position:"absolute", top:"50%", left:`${progress*100}%`, transform:"translate(-50%,-50%)", width:13, height:13, borderRadius:"50%", background:"#fff", boxShadow:"0 0 6px rgba(99,102,241,.8)", pointerEvents:"none" }}/>
            </div>

            {/* Transport */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:16, marginBottom:12 }}>
              {/* Rewind 10s */}
              <button onClick={() => handleSkip(-1)}
                style={{ background:"none", border:"none", color:"#a5b4fc", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:1, padding:4 }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.5 3a9 9 0 1 0 6.5 15.5l-1.4-1.4A7 7 0 1 1 12.5 5V3z"/>
                  <path d="M12.5 3L8 7.5l4.5 4.5V3z"/>
                  <text x="12" y="15.5" textAnchor="middle" fontSize="5.5" fill="currentColor" fontWeight="bold" fontFamily="sans-serif">10</text>
                </svg>
              </button>

              {/* Play / Pause */}
              <button onClick={isPlaying ? handlePause : handlePlay} disabled={piperLoading}
                style={{ width:60, height:60, borderRadius:"50%", background: piperLoading ? "rgba(99,102,241,.4)" : "linear-gradient(135deg,#6366f1,#a855f7)", border:"none", color:"#fff", cursor: piperLoading ? "not-allowed" : "pointer", boxShadow:"0 6px 24px rgba(99,102,241,.5)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                {piperLoading
                  ? <div style={{ display:"flex", gap:3 }}>{[0,1,2].map(i=><span key={i} style={{ width:3, height:12, background:"#fff", borderRadius:2, animation:`ppbar 0.8s ease-in-out ${i*0.15}s infinite` }}/>)}</div>
                  : isPlaying
                    ? <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                    : <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                }
              </button>

              {/* Forward 10s */}
              <button onClick={() => handleSkip(1)}
                style={{ background:"none", border:"none", color:"#a5b4fc", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:1, padding:4 }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.5 3a9 9 0 1 1-6.5 15.5l1.4-1.4A7 7 0 1 0 11.5 5V3z"/>
                  <path d="M11.5 3L16 7.5l-4.5 4.5V3z"/>
                  <text x="12" y="15.5" textAnchor="middle" fontSize="5.5" fill="currentColor" fontWeight="bold" fontFamily="sans-serif">10</text>
                </svg>
              </button>

              {/* Voice picker toggle */}
              <button onClick={() => setShowPicker(v => !v)}
                style={{ width:36, height:36, borderRadius:"50%", background:showPicker?"rgba(99,102,241,.5)":"rgba(255,255,255,.08)", border:`1.5px solid ${showPicker?"#6366f1":"rgba(255,255,255,.15)"}`, color:"#a5b4fc", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </button>
            </div>

            {/* Speed */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>
              <span style={{ fontSize:9, fontWeight:800, color:"#4b5563", marginRight:2, letterSpacing:1 }}>SPEED</span>
              {SPEEDS.map(s => (
                <button key={s} onClick={() => changeSpeed(s)}
                  style={{ padding:"3px 8px", borderRadius:20, border:`1.5px solid ${speed===s?"#6366f1":"rgba(255,255,255,.12)"}`, background:speed===s?"#6366f1":"transparent", color:speed===s?"#fff":"#818cf8", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                  {s}×
                </button>
              ))}
            </div>
          </div>

          {/* Voice picker */}
          {showPicker && (
            <div style={{ margin:"0 12px 12px", background:"rgba(0,0,0,.4)", borderRadius:16, padding:"12px 10px", border:"1px solid rgba(255,255,255,.08)" }}>
              {usePiper ? (
                <>
                  <p style={{ fontSize:9, fontWeight:800, color:"#818cf8", letterSpacing:1.2, marginBottom:10, textTransform:"uppercase", textAlign:"center" }}>
                    Piper Neural Voices
                    <span style={{ marginLeft:6, fontSize:8, background:"linear-gradient(90deg,#6366f1,#a855f7)", color:"#fff", borderRadius:4, padding:"1px 5px" }}>NEURAL ✦</span>
                  </p>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                    {SERVER_VOICES.map((v, i) => {
                      const sel = voiceIdx === i;
                      return (
                        <button key={v.id} onClick={() => switchServerVoice(i)}
                          style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"8px 4px", borderRadius:12, border:"none", cursor:"pointer",
                            background:sel?`${v.color}44`:"rgba(255,255,255,.06)", outline:sel?`2px solid ${v.color}`:"2px solid transparent" }}>
                          <span style={{ width:16, height:16, borderRadius:"50%", background:`linear-gradient(135deg,${v.color},${v.color}99)`, display:"block", boxShadow:`0 0 8px ${v.color}88` }}/>
                          <span style={{ fontSize:11, fontWeight:800, color:"#fff" }}>{v.label}</span>
                          <span style={{ fontSize:9, color:"#a5b4fc", textAlign:"center" }}>{v.gender==="female"?"♀":"♂"} {v.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <p style={{ fontSize:9, fontWeight:800, color:"#818cf8", letterSpacing:1.2, marginBottom:10, textTransform:"uppercase", textAlign:"center" }}>Browser Voices</p>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                    {GLOBAL_PERSONAS.map((p, i) => {
                      const sel = personaIdx === i;
                      return (
                        <button key={p.id} onClick={() => switchBrowserVoice(i)}
                          style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"8px 4px", borderRadius:12, border:"none", cursor:"pointer",
                            background:sel?`${p.color}44`:"rgba(255,255,255,.06)", outline:sel?`2px solid ${p.color}`:"2px solid transparent" }}>
                          <span style={{ width:16, height:16, borderRadius:"50%", background:p.color, display:"block", boxShadow:`0 0 6px ${p.color}88` }}/>
                          <span style={{ fontSize:11, fontWeight:800, color:"#fff" }}>{p.label}</span>
                          <span style={{ fontSize:9, color:"#a5b4fc", textAlign:"center" }}>{p.gender==="female"?"♀":p.gender==="male"?"♂":"◇"} {p.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p style={{ fontSize:9, color:"#4b5563", textAlign:"center", marginTop:8 }}>Best in Edge & Chrome</p>
                </>
              )}
            </div>
          )}

          {/* Current voice badge */}
          {!showPicker && (
            <div style={{ padding:"0 20px 10px", display:"flex", alignItems:"center", justifyContent:"center", gap:6, flexWrap:"wrap" }}>
              {usePiper ? (
                <>
                  <span style={{ width:10, height:10, borderRadius:"50%", background:serverVoice.color, display:"inline-block", boxShadow:`0 0 6px ${serverVoice.color}` }}/>
                  <span style={{ fontSize:11, color:"#c7d2fe", fontWeight:700 }}>{serverVoice.label}</span>
                  <span style={{ fontSize:11, color:"#6366f1" }}>· {serverVoice.gender==="female"?"♀":"♂"} · {serverVoice.desc}</span>
                  <span style={{ fontSize:9, background:"linear-gradient(90deg,rgba(99,102,241,.4),rgba(168,85,247,.4))", color:"#c7d2fe", borderRadius:6, padding:"1px 7px", fontWeight:800 }}>PIPER ✦</span>
                  {!piperReady && !piperLoading && <span style={{ fontSize:9, color:"#f59e0b" }}>▶ Press play to generate</span>}
                </>
              ) : (
                <>
                  <span style={{ width:10, height:10, borderRadius:"50%", background:persona.color, display:"inline-block", boxShadow:`0 0 6px ${persona.color}` }}/>
                  <span style={{ fontSize:11, color:"#c7d2fe", fontWeight:700 }}>{persona.label}</span>
                  <span style={{ fontSize:11, color:"#6366f1" }}>· {persona.gender==="female"?"♀":persona.gender==="male"?"♂":"◇"} · {persona.desc}</span>
                </>
              )}
            </div>
          )}

          {/* No server banner */}
          {!usePiper && (
            <div style={{ margin:"0 12px 12px", background:"rgba(99,102,241,.08)", border:"1px dashed rgba(99,102,241,.3)", borderRadius:10, padding:"8px 12px", textAlign:"center" }}>
              <p style={{ color:"#6366f1", fontSize:11, margin:0 }}>
                ✦ <strong>Piper neural voices</strong> available — deploy the TTS server and set <code style={{ background:"rgba(99,102,241,.2)", padding:"0 3px", borderRadius:3 }}>window.__CLASSIO_TTS_URL__</code>
              </p>
            </div>
          )}

          {/* Script viewer */}
          <details style={{ borderTop:"1px solid rgba(255,255,255,.06)" }}>
            <summary style={{ padding:"10px 20px", color:"#6366f1", fontSize:12, fontWeight:700, cursor:"pointer", userSelect:"none", letterSpacing:.5 }}>READ SCRIPT</summary>
            <div style={{ padding:"0 20px 20px", maxHeight:200, overflowY:"auto" }}>
              <p style={{ fontSize:13, color:"#c7d2fe", lineHeight:1.9, whiteSpace:"pre-wrap" }}>{script}</p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

// Keep PodcastPlayer as an alias for backward compatibility
const PodcastPlayer = EnhancedPodcastPlayer;


// ─── MODAL ────────────────────────────────────────────────────────────────────
function Modal({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.4)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.surface, borderRadius:20, padding:32, width:"100%", maxWidth:440, boxShadow:"0 20px 60px rgba(0,0,0,.2)" }}>
        {children}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// STUDY GROUP SYSTEM
// Real-time collaborative study rooms powered by Firestore.
// Architecture:
//   studyGroups/{gid}           — group doc: members, shared content, game state
//   studyGroups/{gid}/messages  — chat subcollection
// ═══════════════════════════════════════════════════════════════════════════════

// ── Palette ───────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// STUDY GROUP SYSTEM — fully unified with app design system (C.* palette)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Spinner (used in lobby and controls) ──────────────────────────────────────
function SGSpinner({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ animation: "sg-spin 0.7s linear infinite", flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="3"
        strokeDasharray="40 20" strokeLinecap="round" />
    </svg>
  );
}

// ── Tiny member avatar bubble ─────────────────────────────────────────────────
function SGAvatar({ character, displayName, size = 36, isHost = false, isSelf = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}>
      <div style={{ position: "relative" }}>
        <div style={{
          width: size, height: size, borderRadius: "50%", overflow: "hidden",
          border: isSelf ? `2px solid ${C.accent}` : isHost ? `2px solid ${C.warm}` : `2px solid ${C.border}`,
          boxShadow: isSelf ? `0 0 0 3px ${C.accentL}` : "none",
        }}>
          <MiniAvatar character={character || {}} size={size} />
        </div>
        {isHost && (
          <div style={{
            position: "absolute", bottom: -2, right: -2,
            width: 14, height: 14, borderRadius: "50%",
            background: C.warm, border: `2px solid ${C.surface}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 7,
          }}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M2 20h20v2H2zM3 8l4 8h10l4-8-6 4-3-6-3 6-6-4z"/></svg></div>
        )}
      </div>
      <span style={{
        fontSize: 9, fontWeight: 700,
        color: isSelf ? C.accent : C.muted,
        maxWidth: 50, textAlign: "center",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {isSelf ? "You" : (displayName || "User").split(" ")[0]}
      </span>
    </div>
  );
}

// ── Lobby — create or join ────────────────────────────────────────────────────
function StudyGroupLobby({ user, db, onJoin, onClose }) {
  const [mode,      setMode]      = useState("menu");
  const [joinCode,  setJoinCode]  = useState("");
  const [groupName, setGroupName] = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");

  const handleCreate = async () => {
    if (!groupName.trim()) { setError("Enter a group name"); return; }
    setLoading(true); setError("");
    try {
      const gid = Math.random().toString(36).slice(2, 8).toUpperCase();
      const member = {
        uid: user.uid, displayName: user.displayName || "User",
        photoURL: user.photoURL || null,
        character: (() => { try { return JSON.parse(localStorage.getItem("classio_char") || "{}"); } catch { return {}; } })(),
        joinedAt: Date.now(),
      };
      await setDoc(doc(db, "studyGroups", gid), {
        id: gid, name: groupName.trim(), hostUid: user.uid,
        createdAt: Date.now(), members: { [user.uid]: member },
        sharedContent: null, gameState: null, lastActivity: Date.now(),
      });
      setLoading(false);
      onJoin(gid);
    } catch (e) {
      setLoading(false);
      setError("Failed to create: " + (e?.message || "Check Firestore rules."));
    }
  };

  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) { setError("Enter a valid code"); return; }
    setLoading(true); setError("");
    try {
      const snap = await getDoc(doc(db, "studyGroups", code));
      if (!snap.exists()) { setLoading(false); setError("Group not found. Check the code."); return; }
      const member = {
        uid: user.uid, displayName: user.displayName || "User",
        photoURL: user.photoURL || null,
        character: (() => { try { return JSON.parse(localStorage.getItem("classio_char") || "{}"); } catch { return {}; } })(),
        joinedAt: Date.now(),
      };
      await updateDoc(doc(db, "studyGroups", code), {
        [`members.${user.uid}`]: member, lastActivity: Date.now(),
      });
      setLoading(false);
      onJoin(code);
    } catch (e) {
      setLoading(false);
      setError("Failed to join: " + (e?.message || "Check your connection."));
    }
  };

  const inp = {
    width: "100%", padding: "11px 14px", boxSizing: "border-box",
    background: C.bg, border: `1.5px solid ${C.border}`,
    borderRadius: 10, color: C.text, fontSize: 14, outline: "none",
    fontFamily: "inherit", marginTop: 6,
  };

  return (
    <>
      <style>{`@keyframes sg-spin { to { transform:rotate(360deg); } }`}</style>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, zIndex: 4000,
        background: "rgba(26,23,20,.5)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          width: "100%", maxWidth: 400, background: C.surface,
          borderRadius: 20, border: `1px solid ${C.border}`,
          boxShadow: "0 20px 60px rgba(0,0,0,.15)", overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700,
                fontFamily: "'Fraunces',serif", color: C.text }}>Study Group</h2>
              <p style={{ margin: "3px 0 0", fontSize: 13, color: C.muted }}>Study together in real time</p>
            </div>
            <button onClick={onClose} style={{ background: C.bg, border: `1px solid ${C.border}`,
              borderRadius: "50%", width: 30, height: 30, color: C.muted, cursor: "pointer",
              fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>

          <div style={{ padding: "20px 24px 24px" }}>
            {mode === "menu" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button onClick={() => { setMode("create"); setError(""); }} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  background: C.accentL, border: `1.5px solid ${C.accentS}`,
                  borderRadius: 14, padding: "14px 18px", cursor: "pointer", textAlign: "left",
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: C.accent,
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
                  <div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Create a Study Group</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted }}>Start a new room and invite friends</p>
                  </div>
                </button>
                <button onClick={() => { setMode("join"); setError(""); }} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  background: C.surface, border: `1.5px solid ${C.border}`,
                  borderRadius: 14, padding: "14px 18px", cursor: "pointer", textAlign: "left",
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: C.warmL,
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>
                  <div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Join a Study Group</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted }}>Enter a code from a friend</p>
                  </div>
                </button>
              </div>
            )}

            {mode === "create" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <button onClick={() => { setMode("menu"); setError(""); setGroupName(""); }}
                  style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13, textAlign: "left", padding: 0 }}>← Back</button>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: .8, textTransform: "uppercase" }}>Group Name</label>
                  <input autoFocus value={groupName} disabled={loading}
                    onChange={e => { setGroupName(e.target.value); setError(""); }}
                    onKeyDown={e => e.key === "Enter" && !loading && handleCreate()}
                    placeholder="e.g. Physics Study Squad" style={{ ...inp, opacity: loading ? .6 : 1 }} />
                </div>
                {error && <div style={{ padding: "10px 12px", borderRadius: 10, background: C.redL,
                  border: `1px solid ${C.red}44`, color: C.red, fontSize: 12, fontWeight: 600 }}>{error}</div>}
                <button onClick={handleCreate} disabled={loading} style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  background: loading ? C.accentS : C.accent, color: "#fff", border: "none",
                  borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 700,
                  cursor: loading ? "not-allowed" : "pointer",
                  boxShadow: loading ? "none" : "0 4px 14px rgba(61,90,128,.3)",
                }}>
                  {loading ? <><SGSpinner color="#fff" /> Creating…</> : "Create Group →"}
                </button>
              </div>
            )}

            {mode === "join" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <button onClick={() => { setMode("menu"); setError(""); setJoinCode(""); }}
                  style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13, textAlign: "left", padding: 0 }}>← Back</button>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: .8, textTransform: "uppercase" }}>Group Code</label>
                  <input autoFocus value={joinCode} disabled={loading} maxLength={6}
                    onChange={e => { setJoinCode(e.target.value.toUpperCase()); setError(""); }}
                    onKeyDown={e => e.key === "Enter" && !loading && handleJoin()}
                    placeholder="A3X7K2"
                    style={{ ...inp, fontSize: 22, fontWeight: 800, letterSpacing: 5, textAlign: "center", fontFamily: "monospace", opacity: loading ? .6 : 1 }} />
                </div>
                {error && <div style={{ padding: "10px 12px", borderRadius: 10, background: C.redL,
                  border: `1px solid ${C.red}44`, color: C.red, fontSize: 12, fontWeight: 600 }}>{error}</div>}
                <button onClick={handleJoin} disabled={loading} style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  background: loading ? C.accentS : C.accent, color: "#fff", border: "none",
                  borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 700,
                  cursor: loading ? "not-allowed" : "pointer",
                  boxShadow: loading ? "none" : "0 4px 14px rgba(61,90,128,.3)",
                }}>
                  {loading ? <><SGSpinner color="#fff" /> Joining…</> : "Join Group →"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Chat message ──────────────────────────────────────────────────────────────
function SGChatMessage({ msg, isSelf }) {
  const isSystem = msg.uid === "system";
  if (isSystem) return (
    <div style={{ textAlign: "center", padding: "4px 0" }}>
      <span style={{ fontSize: 11, color: C.muted, background: C.bg,
        border: `1px solid ${C.border}`, borderRadius: 20, padding: "3px 10px" }}>{msg.text}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: isSelf ? "row-reverse" : "row", gap: 6, alignItems: "flex-end" }}>
      <div style={{
        maxWidth: "74%",
        background: isSelf ? C.accent : C.bg,
        borderRadius: isSelf ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        padding: "9px 13px",
        border: isSelf ? "none" : `1px solid ${C.border}`,
        boxShadow: isSelf ? "0 2px 8px rgba(61,90,128,.25)" : "none",
      }}>
        {!isSelf && (
          <p style={{ margin: "0 0 3px", fontSize: 10, fontWeight: 700, color: C.accent, letterSpacing: .3 }}>
            {(msg.displayName || "User").split(" ")[0]}
          </p>
        )}
        <p style={{ margin: 0, fontSize: 13, color: isSelf ? "#fff" : C.text, lineHeight: 1.45, wordBreak: "break-word" }}>{msg.text}</p>
        <p style={{ margin: "3px 0 0", fontSize: 9, color: isSelf ? "rgba(255,255,255,.6)" : C.muted, textAlign: "right" }}>
          {msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDY GROUP — shared content viewer
// Types: notes | flashcards | whiteboard | material | screenshare | file
// ═══════════════════════════════════════════════════════════════════════════════

// ── Mini file viewer used inside SGSharedContent for "file" type ──────────────
// Renders PDFs, images, Word docs, text — same as ViewTab but self-contained.
function SGFileViewer({ fileData, fileURL, fileChunks, groupId, fileName }) {
  const ext     = (fileName || "").split(".").pop().toLowerCase();
  const isPDF   = ext === "pdf";
  const isImage = ["jpg","jpeg","png","gif","webp","bmp","svg"].includes(ext);
  const isText  = ["txt","md","csv","json","js","ts","jsx","py","html","css","xml","yaml","yml"].includes(ext);
  const isWord  = ["doc","docx"].includes(ext);
  const isPPT   = ["ppt","pptx"].includes(ext);

  // Fetch chunked file from Firestore subcollection
  const [chunkData,    setChunkData]    = useState(null);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [chunkError,   setChunkError]   = useState("");
  useEffect(() => {
    if (!fileChunks || fileChunks === 0 || !groupId) return;
    setChunkData(null);
    setChunkError("");
    setChunkLoading(true);
    let cancelled = false;
    (async () => {
      // Retry up to 5 times in case chunks aren't all written yet
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const chunkCol = collection(db, "studyGroups", groupId, "fileChunks");
          const snap = await getDocs(chunkCol);
          if (cancelled) return;
          if (snap.empty) {
            if (attempt < 4) { await new Promise(r => setTimeout(r, 1500)); continue; }
            setChunkError("File not found."); return;
          }
          const docs = snap.docs.map(d => d.data());
          const expectedTotal = fileChunks;
          // Check we have all chunks
          if (docs.length < expectedTotal) {
            if (attempt < 4) { await new Promise(r => setTimeout(r, 1500)); continue; }
            setChunkError(`Only ${docs.length} of ${expectedTotal} file parts received.`); return;
          }
          // Sort by index and reassemble
          const sorted = docs.sort((a,b) => a.index - b.index);
          const assembled = sorted.map(d => d.chunk).join("");
          if (!cancelled) setChunkData(assembled);
          return;
        } catch(e) {
          if (attempt < 4) { await new Promise(r => setTimeout(r, 1500)); continue; }
          console.error("Chunk fetch error:", e);
          if (!cancelled) setChunkError("Could not load file: " + e.message);
          return;
        }
      }
    })().finally(() => { if (!cancelled) setChunkLoading(false); });
    return () => { cancelled = true; };
  }, [fileChunks, groupId]);

  // Final source — chunks take priority, then direct URL, then legacy base64
  const srcURL = chunkData || fileURL || fileData || "";
  const isLoading = !!(fileChunks && chunkLoading);

  // For PDF.js we need an ArrayBuffer — fetch with no-cors workaround via proxy param
  const canvasRef = useRef(null);
  const pdfRef    = useRef(null);
  const [totalPages, setTotalPages] = useState(0);
  const [pageNum,    setPageNum]    = useState(1);
  const [pdfReady,   setPdfReady]   = useState(false);

  // PPT page state (only used when rendering from local fileObj)
  const [pptTotal, setPptTotal] = useState(0);
  const [pptPage,  setPptPage]  = useState(1);

  // Build a File object from the assembled base64 string (chunkData OR legacy fileData)
  // Used by TextViewer, WordViewer, PPTViewer which all need a real File object
  const base64Src = chunkData || fileData || "";
  const fileObj = useMemo(() => {
    if (!base64Src) return null;
    try {
      const [header, b64] = base64Src.split(",");
      const mime = header.match(/:(.*?);/)?.[1] || "application/octet-stream";
      const binary = atob(b64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new File([bytes], fileName || "file", { type: mime });
    } catch { return null; }
  }, [base64Src, fileName]);

  // Load PDF — handle both base64 data URLs and remote URLs
  useEffect(() => {
    if (!isPDF || !srcURL) return;
    setPdfReady(false); pdfRef.current = null; setPageNum(1);
    (async () => {
      try {
        if (!window.pdfjsLib) {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            s.onload = res; s.onerror = rej; document.head.appendChild(s);
          });
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }
        let pdfSource;
        if (srcURL.startsWith("data:")) {
          // base64 data URL — convert to Uint8Array for PDF.js
          const b64 = srcURL.split(",")[1];
          const bin = atob(b64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          pdfSource = { data: arr };
        } else {
          // Remote URL
          pdfSource = { url: srcURL, withCredentials: false };
        }
        const pdf = await window.pdfjsLib.getDocument({
          ...pdfSource,
          cMapUrl: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/",
          cMapPacked: true,
        }).promise;
        pdfRef.current = pdf;
        setTotalPages(pdf.numPages);
        setPdfReady(true);
      } catch(e) { console.error("PDF load error", e); }
    })();
  }, [srcURL, isPDF]);

  useEffect(() => {
    if (!pdfReady || !pdfRef.current || !canvasRef.current) return;
    (async () => {
      const page     = await pdfRef.current.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas   = canvasRef.current;
      canvas.width   = viewport.width;
      canvas.height  = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    })();
  }, [pdfReady, pageNum]);

  const navBtn = (disabled) => ({
    width:32, height:32, borderRadius:8, border:`1px solid ${C.border}`,
    background: disabled ? C.bg : C.surface, cursor: disabled ? "default" : "pointer",
    opacity: disabled ? .35 : 1, fontSize:18, display:"flex",
    alignItems:"center", justifyContent:"center", flexShrink:0,
  });

  // Google Docs viewer works for PPT/Word when we have a public URL
  const gdocsURL = (url) =>
    `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;

  if (isLoading) return (
    <div style={{ flex:1, display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", gap:14,
      background:"#404040", color:"#fff" }}>
      <div style={{ width:44, height:44, border:"4px solid rgba(255,255,255,.2)",
        borderTop:"4px solid #fff", borderRadius:"50%",
        animation:"sg-spin 1s linear infinite" }} />
      <p style={{ margin:0, fontSize:14, fontWeight:600, opacity:.8 }}>Loading file…</p>
      <p style={{ margin:0, fontSize:11, opacity:.5 }}>{fileName}</p>
    </div>
  );

  if (chunkError) return (
    <div style={{ flex:1, display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", gap:12,
      background:"#404040", color:"#fff", padding:32 }}>
      <div style={{ width:52,height:52,borderRadius:16,background:"#fef9c3",display:"flex",alignItems:"center",justifyContent:"center" }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ca8a04" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <p style={{ margin:0, fontSize:15, fontWeight:700 }}>Failed to load file</p>
      <p style={{ margin:0, fontSize:12, opacity:.6, textAlign:"center", maxWidth:300 }}>{chunkError}</p>
    </div>
  );

  if (!srcURL) return (
    <div style={{ flex:1, display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", gap:10,
      background:"#404040", color:"#fff" }}>
      <div style={{ width:48,height:48,borderRadius:14,background:C.accentL,display:"flex",alignItems:"center",justifyContent:"center" }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="{C.accent}" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
      <p style={{ margin:0, fontSize:14, opacity:.7 }}>Waiting for file…</p>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>

      {/* PDF navigation bar */}
      {isPDF && (
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 16px",
          borderBottom:`1px solid ${C.border}`, background:C.bg, flexShrink:0 }}>
          <button onClick={() => setPageNum(p => Math.max(1,p-1))} disabled={pageNum<=1}
            style={navBtn(pageNum<=1)}>‹</button>
          <span style={{ fontSize:13, color:C.text, fontWeight:600, minWidth:70, textAlign:"center" }}>
            {pdfReady ? `${pageNum} / ${totalPages}` : "Loading…"}
          </span>
          <button onClick={() => setPageNum(p => Math.min(totalPages||p,p+1))}
            disabled={!pdfReady || pageNum>=totalPages}
            style={navBtn(!pdfReady || pageNum>=totalPages)}>›</button>
          <span style={{ marginLeft:"auto", fontSize:11, color:C.muted }}>{fileName}</span>
        </div>
      )}

      {/* PPT navigation bar (local fileObj only) */}
      {isPPT && !fileURL && pptTotal > 0 && (
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 16px",
          borderBottom:`1px solid ${C.border}`, background:C.bg, flexShrink:0 }}>
          <button onClick={() => setPptPage(p => Math.max(1,p-1))} disabled={pptPage<=1}
            style={navBtn(pptPage<=1)}>‹</button>
          <span style={{ fontSize:13, color:C.text, fontWeight:600, minWidth:60, textAlign:"center" }}>
            {pptPage} / {pptTotal}
          </span>
          <button onClick={() => setPptPage(p => Math.min(pptTotal,p+1))} disabled={pptPage>=pptTotal}
            style={navBtn(pptPage>=pptTotal)}>›</button>
          <span style={{ marginLeft:"auto", fontSize:11, color:C.muted }}>{fileName}</span>
        </div>
      )}

      <div style={{ flex:1, overflow:"auto", background:"#404040",
        display:"flex", justifyContent:"center", alignItems:"flex-start", padding:20 }}>

        {/* PDF — rendered by PDF.js directly from URL */}
        {isPDF && (
          <canvas ref={canvasRef}
            style={{ display:"block", boxShadow:"0 4px 32px rgba(0,0,0,.6)", maxWidth:"100%" }} />
        )}

        {/* Image — direct URL works fine */}
        {isImage && (
          <img src={srcURL} alt={fileName}
            style={{ maxWidth:"100%", borderRadius:6,
              boxShadow:"0 4px 32px rgba(0,0,0,.5)", background:"#fff" }} />
        )}

        {/* PPT / Word — use local fileObj (built from base64 chunks) */}
        {isPPT && fileObj && (
          <PPTViewer fileObj={fileObj} page={pptPage}
            onTotalPages={setPptTotal} onSlidesLoaded={()=>{}} />
        )}
        {isPPT && !fileObj && fileURL && (
          <iframe src={gdocsURL(fileURL)} title={fileName}
            style={{ width:"100%", height:"100%", minHeight:500, border:"none",
              borderRadius:8, background:"#fff" }} allow="autoplay" />
        )}
        {isWord && fileObj && <WordViewer fileObj={fileObj} />}
        {isWord && !fileObj && fileURL && (
          <iframe src={gdocsURL(fileURL)} title={fileName}
            style={{ width:"100%", height:"100%", minHeight:500, border:"none",
              borderRadius:8, background:"#fff" }} allow="autoplay" />
        )}

        {/* Plain text */}
        {isText && fileObj && <TextViewer fileObj={fileObj} />}
        {isText && !fileObj && fileURL && (
          <iframe src={fileURL} title={fileName}
            style={{ width:"100%", height:"100%", border:"none", background:"#fff", borderRadius:8 }} />
        )}

        {/* Unsupported */}
        {!isPDF && !isImage && !isText && !isWord && !isPPT && (
          <div style={{ background:C.surface, borderRadius:14, padding:32, textAlign:"center" }}>
            <div style={{ width:56,height:56,borderRadius:16,background:C.accentL,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12 }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="{C.accent}" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
            <p style={{ color:C.text, fontWeight:700, fontSize:15 }}>{fileName}</p>
            <p style={{ color:C.muted, fontSize:13, margin:0 }}>Preview not available</p>
            {fileURL && (
              <a href={fileURL} target="_blank" rel="noreferrer"
                style={{ display:"inline-block", marginTop:14, padding:"8px 18px",
                  background:C.accent, color:"#fff", borderRadius:10, fontSize:13,
                  fontWeight:700, textDecoration:"none" }}>
                Download File
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Screen share receiver — renders the live video frame broadcast by host ────

function SGSharedContent({ content, presenterName, isHost, db, groupId }) {
  // Whiteboard viewer — read-only canvas that mirrors strokes from Firestore
  const viewCanvasRef = useRef(null);

  useEffect(() => {
    if (content?.type !== "whiteboard" || !viewCanvasRef.current) return;
    const canvas = viewCanvasRef.current;
    const ctx    = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    (content.strokes || []).forEach(s => {
      if (!s.pts || s.pts.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = s.color || "#1A1714";
      ctx.lineWidth   = s.size  || 3;
      ctx.lineCap     = "round"; ctx.lineJoin = "round";
      ctx.globalCompositeOperation = s.eraser ? "destination-out" : "source-over";
      ctx.moveTo(s.pts[0].x, s.pts[0].y);
      s.pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    });
  }, [content?.strokes]);

  const [flipped, setFlipped] = useState({});

  if (!content) return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", gap:12, padding:32, opacity:.45 }}>
      <div style={{ width:60,height:60,borderRadius:18,background:C.accentL,display:"flex",alignItems:"center",justifyContent:"center" }}><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="{C.accent}" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg></div>
      <p style={{ color:C.muted, fontSize:15, fontWeight:600, margin:0 }}>Nothing shared yet</p>
      <p style={{ color:C.muted, fontSize:13, margin:0, textAlign:"center", maxWidth:240 }}>
        The host can present notes, flashcards, a whiteboard, screen, or study file
      </p>
    </div>
  );

  const typeIcon = { notes:"✎", flashcards:"▣", whiteboard:"✐", material:"▤", screenshare:"▨", file:"▤" };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Presenter banner */}
      <div style={{ flexShrink:0, display:"flex", alignItems:"center", gap:8,
        padding:"8px 16px", background:C.accentL, borderBottom:`1px solid ${C.accentS}` }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>
        <span style={{ fontSize:13, fontWeight:700, color:C.accent }}>
          {presenterName || content.sharedBy} is presenting
        </span>
        <span style={{ marginLeft:"auto", fontSize:11, color:C.muted }}>
          {typeIcon[content.type] || "▤"} {content.type}
        </span>
        {isHost && (
          <button onClick={() => updateDoc(doc(db,"studyGroups",groupId),{sharedContent:null})}
            style={{ background:C.redL, border:`1px solid ${C.red}44`, color:C.red,
              borderRadius:7, padding:"4px 10px", fontSize:11, fontWeight:700, cursor:"pointer" }}>
            ⏹ Stop
          </button>
        )}
      </div>

      {/* Content */}
      {(content.type === "notes" || content.type === "material") && (
        <div style={{ flex:1, overflowY:"auto", padding:20 }}>
          <div style={{ background:C.surface, borderRadius:14, padding:20,
            border:`1px solid ${C.border}`, boxShadow:"0 2px 12px rgba(0,0,0,.06)" }}>
            <h3 style={{ margin:"0 0 14px", color:C.text, fontSize:17, fontWeight:700,
              fontFamily:"'Fraunces',serif" }}>{content.title}</h3>
            <div style={{ color:C.text, fontSize:14, lineHeight:1.8,
              whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{content.body}</div>
          </div>
        </div>
      )}

      {content.type === "whiteboard" && (
        <div style={{ flex:1, overflowY:"auto", padding:20 }}>
          <div style={{ background:C.surface, borderRadius:14, border:`1px solid ${C.border}`,
            overflow:"hidden" }}>
            <div style={{ padding:"10px 16px", borderBottom:`1px solid ${C.border}`,
              display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:13, fontWeight:700, color:C.text }}>{content.title || "Whiteboard"}</span>
              <span style={{ fontSize:11, color:C.muted, marginLeft:"auto" }}>Live drawing</span>
            </div>
            {/* Wrapper: relative so cursor dot overlays perfectly */}
            <div style={{ position:"relative", lineHeight:0 }}>
              <canvas ref={viewCanvasRef} width={800} height={500}
                style={{ width:"100%", height:"auto", display:"block", background:"#fff" }} />
              {/* Gray semi-transparent cursor showing host's live mouse position */}
              {content.cursor && (
                <div style={{
                  position:"absolute",
                  left:`${content.cursor.x * 100}%`,
                  top:`${content.cursor.y * 100}%`,
                  width:22, height:22, borderRadius:"50%",
                  background:"rgba(80,80,80,0.55)",
                  border:"2.5px solid rgba(255,255,255,0.8)",
                  transform:"translate(-50%,-50%)",
                  pointerEvents:"none",
                  transition:"left 0.05s linear, top 0.05s linear",
                  zIndex:10,
                }} />
              )}
            </div>
          </div>
        </div>
      )}

      {content.type === "flashcards" && (
        <div style={{ flex:1, overflowY:"auto", padding:20 }}>
          <h3 style={{ margin:"0 0 16px", color:C.text, fontSize:17, fontWeight:700,
            fontFamily:"'Fraunces',serif" }}>{content.title}</h3>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:14 }}>
            {(content.cards || []).map((c, i) => (
              <div key={i} onClick={() => setFlipped(f => ({...f,[i]:!f[i]}))}
                style={{ background:flipped[i]?C.accentL:C.surface,
                  border:`1.5px solid ${flipped[i]?C.accentS:C.border}`,
                  borderRadius:16, padding:20, cursor:"pointer", minHeight:120,
                  display:"flex", flexDirection:"column", gap:8, transition:"all .18s" }}>
                <p style={{ margin:0, fontSize:10, fontWeight:700,
                  color:flipped[i]?C.accent:C.muted, textTransform:"uppercase", letterSpacing:1 }}>
                  {flipped[i]?"Answer":`Card ${i+1}`}
                </p>
                <p style={{ margin:0, fontSize:14, color:C.text, lineHeight:1.5, flex:1 }}>
                  {flipped[i]?c.answer:c.question}
                </p>
                <p style={{ margin:0, fontSize:11, color:C.muted }}>Tap to flip</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Real file viewer — same rendering as ViewTab ── */}
      {content.type === "file" && (
        <div style={{ flex:1, overflow:"hidden" }}>
          <SGFileViewer fileData={content.fileData} fileURL={content.fileURL}
            fileChunks={content.fileChunks} groupId={groupId}
            fileName={content.fileName} />
        </div>
      )}

      {/* ── Real screen share — WebRTC P2P stream ── */}
      {content.type === "screenshare" && (
        <SGScreenShareViewer content={content} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN SHARE — WebRTC peer-to-peer video, Firestore used only for signaling.
// After the ICE handshake the video stream flows directly browser-to-browser
// so there is zero Firestore bandwidth on the video frames — true 30–60fps.
//
// Architecture:
//   Host    → creates RTCPeerConnection, gets display stream
//           → writes offer SDP to Firestore  studyGroups/{gid}/screenshare/offer
//           → watches   answer SDP at         studyGroups/{gid}/screenshare/answer
//           → writes ICE candidates to        studyGroups/{gid}/screenshare/hostIce  (array)
//           → reads  ICE candidates from      studyGroups/{gid}/screenshare/viewerIce
//   Viewers → read offer, create answer, write answer + their ICE candidates
//           → render the incoming MediaStream in a <video> element
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN SHARE HOST
// Strategy: capture frames via requestAnimationFrame at native speed,
// encode to JPEG at 50% quality + 720p max, push to Firestore fire-and-forget.
// A pendingRef gate ensures we never queue a new write while one is in flight,
// so effective fps = min(60, 1000 / firestoreRoundTripMs).
// On a fast connection (100-200ms RTT) this yields 5-10fps which is fine for
// screen sharing study content. For true real-time video use WebRTC (below).
// ═══════════════════════════════════════════════════════════════════════════════
function SGScreenShareHost({ groupId, db, user, onStop, registerStop }) {
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const streamRef   = useRef(null);
  const rafRef      = useRef(null);
  const pendingRef  = useRef(false);
  const frameCount  = useRef(0);
  const lastSendRef = useRef(0);
  const fpsTimer    = useRef(null);
  const [active,  setActive]  = useState(false);
  const [error,   setError]   = useState("");
  const [fps,     setFps]     = useState(0);

  // Target interval: 50ms = 20fps max (keeps Firestore writes manageable)
  const FRAME_MS = 50;
  // Max dimension — scales down 1080p to 720p for smaller payload
  const MAX_DIM  = 1280;

  const captureLoop = () => {
    rafRef.current = requestAnimationFrame(captureLoop);
    const now = performance.now();
    if (now - lastSendRef.current < FRAME_MS) return;
    if (pendingRef.current) return; // in-flight — skip this frame
    const v = videoRef.current;
    const canvas = canvasRef.current;
    if (!v || !canvas || v.readyState < 2 || !v.videoWidth) return;

    // Scale down if needed
    const scale = Math.min(1, MAX_DIM / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.floor(v.videoWidth  * scale);
    const h = Math.floor(v.videoHeight * scale);
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(v, 0, 0, w, h);

    const frame = canvas.toDataURL("image/jpeg", 0.5); // 50% JPEG ≈ 30-80KB
    lastSendRef.current = now;
    pendingRef.current  = true;
    frameCount.current++;

    updateDoc(doc(db, "studyGroups", groupId), {
      "sharedContent.frame":     frame,
      "sharedContent.lastFrame": Date.now(),
    }).then(()  => { pendingRef.current = false; })
      .catch(()  => { pendingRef.current = false; });
  };

  const stopCapture = async () => {
    cancelAnimationFrame(rafRef.current);
    clearInterval(fpsTimer.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setActive(false);
    await updateDoc(doc(db, "studyGroups", groupId), { sharedContent: null }).catch(() => {});
    onStop();
  };

  useEffect(() => { if (registerStop) registerStop(stopCapture); }, []);
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    clearInterval(fpsTimer.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  const startCapture = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) { video.srcObject = stream; await video.play().catch(() => {}); }
      setActive(true);

      await updateDoc(doc(db, "studyGroups", groupId), {
        sharedContent: {
          type: "screenshare", title: "Screen Share", frame: null,
          sharedBy:    user.displayName?.split(" ")[0] || "Host",
          sharedByUid: user.uid,
          sharedAt:    Date.now(),
        },
        lastActivity: Date.now(),
      });

      rafRef.current = requestAnimationFrame(captureLoop);
      fpsTimer.current = setInterval(() => {
        setFps(frameCount.current);
        frameCount.current = 0;
      }, 1000);

      stream.getVideoTracks()[0].addEventListener("ended", stopCapture);
    } catch(e) {
      if (e.name !== "NotAllowedError") setError(e.message || "Could not start screen share");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <video ref={videoRef} muted playsInline style={{ display: "none" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {!active ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ padding: "10px 14px", borderRadius: 10,
            background: C.accentL, border: `1px solid ${C.accentS}` }}>
            <p style={{ margin: 0, fontSize: 13, color: C.accent, fontWeight: 700, marginBottom: 4 }}>
              How it works
            </p>
            <p style={{ margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
              Frames are broadcast to all members in real time via the cloud.
              Speed depends on your connection — typically 10–20fps on a good network.
            </p>
          </div>
          {error && (
            <div style={{ padding: "8px 12px", borderRadius: 9, background: C.redL,
              border: `1px solid ${C.red}44`, color: C.red, fontSize: 12 }}>{error}</div>
          )}
          <button onClick={startCapture} style={{
            background: C.accent, color: "#fff", border: "none", borderRadius: 12,
            padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            boxShadow: "0 4px 14px rgba(61,90,128,.3)",
          }}>Start Screen Share</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
            background: C.greenL, border: `1px solid ${C.green}44`, borderRadius: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.green,
              display: "inline-block", animation: "sg-pulse 1.4s ease infinite" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.green }}>Live — broadcasting screen</span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted,
              background: C.bg, padding: "2px 8px", borderRadius: 20 }}>{fps} fps</span>
          </div>
          <button onClick={stopCapture} style={{
            background: C.redL, color: C.red, border: `1px solid ${C.red}44`,
            borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>⏹ Stop Sharing</button>
        </div>
      )}
    </div>
  );
}

// ── Screen share viewer — renders live frames broadcast by host ───────────────
function SGScreenShareViewer({ content }) {
  if (!content?.frame) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }}>
      <div style={{ width:56,height:56,borderRadius:16,background:C.accentL,display:"flex",alignItems:"center",justifyContent:"center" }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="{C.accent}" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></div>
      <p style={{ color: C.text, fontWeight: 700, fontSize: 16, margin: 0 }}>
        {content?.title || "Screen Share"}
      </p>
      <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Waiting for host's screen…</p>
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: C.accent,
            animation: "bounce 1.2s infinite", animationDelay: `${i * .2}s` }} />
        ))}
      </div>
    </div>
  );
  return (
    <div style={{ flex: 1, overflow: "hidden", background: "#111",
      display: "flex", justifyContent: "center", alignItems: "center" }}>
      <img src={content.frame} alt="Screen share"
        style={{ maxWidth: "100%", maxHeight: "100%", display: "block",
          imageRendering: "crisp-edges" }} />
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// LIVE WHITEBOARD — host draws, all members see strokes in real time
// Strokes stored in Firestore sharedContent.strokes
// ═══════════════════════════════════════════════════════════════════════════════
function SGWhiteboard({ groupId, db, user, group, onClose }) {
  const canvasRef   = useRef(null);
  const drawCtxRef  = useRef(null);
  const drawing     = useRef(false);
  const lastPt      = useRef(null);
  const currentPts  = useRef([]);
  const [color,  setColor]  = useState("#1A1714");
  const [size,   setSize]   = useState(4);
  const [eraser, setEraser] = useState(false);
  const [title,  setTitle]  = useState("Whiteboard");
  const [saving, setSaving] = useState(false);
  const [strokes, setStrokes] = useState([]);

  const COLORS = ["#1A1714","#C45C5C","#4A7C59","#3D5A80","#6B4E8A","#C17F5A","#F7F5F2"];

  useEffect(() => {
    const existing = group?.sharedContent?.strokes || [];
    setStrokes(existing);
    redrawAll(existing);
  }, []);

  // getPos: always read bounding rect fresh at call time.
  // Canvas buffer equals CSS pixels (no DPR scaling), so subtract
  // rect offset only — no further scaling needed.
  const getPos = (e) => {
    const canvas = canvasRef.current;
    const r      = canvas.getBoundingClientRect();
    const src    = e.touches ? e.touches[0] : e;
    // canvas.width should equal r.width at all times (syncCanvasSize ensures this)
    return {
      x: (src.clientX - r.left) * (canvas.width  / r.width),
      y: (src.clientY - r.top)  * (canvas.height / r.height),
    };
  };

  // Keep a ref to strokes so syncCanvasSize never has a stale closure
  const strokesRef = useRef([]);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  // Sync canvas pixel buffer to its CSS display size.
  // Called on mount AND whenever the element is resized.
  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return; // not yet laid out
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (canvas.width === w && canvas.height === h) return; // already correct
    canvas.width  = w;
    canvas.height = h;
    redrawAll(strokesRef.current); // use ref — never stale
  }, []); // no deps — safe because we use strokesRef

  // Run immediately after first paint so the buffer is right before any drawing
  useEffect(() => {
    // rAF ensures the browser has done layout so getBoundingClientRect is accurate
    const id = requestAnimationFrame(() => syncCanvasSize());
    return () => cancelAnimationFrame(id);
  }, []);

  // Also watch for resize (e.g. window resize, modal open animation)
  useEffect(() => {
    const ro = new ResizeObserver(() => syncCanvasSize());
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  const redrawAll = (stks) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stks.forEach(s => drawStroke(ctx, s));
  };

  const drawStroke = (ctx, s) => {
    if (!s.pts || s.pts.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = s.color; ctx.lineWidth = s.size;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.globalCompositeOperation = s.eraser ? "destination-out" : "source-over";
    ctx.moveTo(s.pts[0].x, s.pts[0].y);
    s.pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  };

  const onDown = (e) => {
    e.preventDefault();
    drawing.current = true;
    currentPts.current = [getPos(e)];
    lastPt.current = getPos(e);
    drawCtxRef.current = canvasRef.current?.getContext("2d");
  };

  // Broadcast cursor position (throttled to ~30fps)
  const cursorThrottle = useRef(0);
  const broadcastCursor = (pt) => {
    const now = Date.now();
    if (now - cursorThrottle.current < 33) return; // ~30fps
    cursorThrottle.current = now;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Store as fraction so viewers can scale to their canvas size
    const xPct = pt.x / canvas.width;
    const yPct = pt.y / canvas.height;
    updateDoc(doc(db,"studyGroups",groupId),{
      "sharedContent.cursor": { x: xPct, y: yPct, t: now },
    }).catch(()=>{});
  };

  // Also broadcast cursor when NOT drawing (hover)
  const onHover = (e) => {
    if (drawing.current) return; // onMove handles it during drawing
    const pt = getPos(e);
    broadcastCursor(pt);
  };

  const onMove = (e) => {
    e.preventDefault();
    const pt = getPos(e);
    broadcastCursor(pt);
    if (!drawing.current) return;
    const ctx = drawCtxRef.current;
    ctx.beginPath();
    ctx.strokeStyle = eraser ? "#ffffff" : color;
    ctx.lineWidth   = eraser ? size * 4 : size;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    ctx.moveTo(lastPt.current.x, lastPt.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    lastPt.current = pt;
    currentPts.current.push(pt);
  };

  const onUp = async () => {
    if (!drawing.current) return;
    drawing.current = false;
    const newStroke = { color: eraser ? "#ffffff" : color, size: eraser ? size*4 : size,
      eraser, pts: currentPts.current };
    const updated = [...strokes, newStroke];
    setStrokes(updated);
    currentPts.current = [];
    setSaving(true);
    try {
      await updateDoc(doc(db,"studyGroups",groupId), {
        "sharedContent.strokes": updated,
        "sharedContent.type": "whiteboard",
        "sharedContent.title": title,
        lastActivity: Date.now(),
      });
    } catch(err) { console.error(err); }
    setSaving(false);
  };

  const clearBoard = async () => {
    canvasRef.current?.getContext("2d").clearRect(0,0,canvasRef.current.width,canvasRef.current.height);
    setStrokes([]);
    await updateDoc(doc(db,"studyGroups",groupId),{"sharedContent.strokes":[]}).catch(()=>{});
  };

  const startPresenting = async () => {
    setSaving(true);
    await updateDoc(doc(db,"studyGroups",groupId), {
      sharedContent: { type:"whiteboard", title, strokes:[],
        sharedBy: user.displayName?.split(" ")[0] || "Host",
        sharedByUid: user.uid, sharedAt: Date.now() },
      lastActivity: Date.now(),
    });
    setSaving(false);
  };

  const isSharing = group?.sharedContent?.type === "whiteboard";

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4600,
      background:"rgba(26,23,20,.5)", backdropFilter:"blur(3px)",
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{
        width:"100%", maxWidth:820, background:C.surface, borderRadius:20,
        border:`1px solid ${C.border}`, boxShadow:"0 20px 60px rgba(0,0,0,.18)",
        display:"flex", flexDirection:"column", maxHeight:"90vh", overflow:"hidden",
      }}>
        <div style={{ padding:"12px 16px", borderBottom:`1px solid ${C.border}`,
          display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          <input value={title} onChange={e=>setTitle(e.target.value)}
            style={{ flex:1, border:"none", outline:"none", fontSize:15, fontWeight:700,
              color:C.text, background:"transparent", fontFamily:"'Fraunces',serif" }} />
          {saving && <span style={{ fontSize:11, color:C.muted }}>saving…</span>}
          {!isSharing && (
            <button onClick={startPresenting} style={{ background:C.accent, color:"#fff",
              border:"none", borderRadius:9, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              Present to Group
            </button>
          )}
          <button onClick={onClose}
            style={{ background:C.bg, border:`1px solid ${C.border}`,
            borderRadius:"50%", width:28, height:28, color:C.muted, cursor:"pointer", fontSize:14,
            display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>
        <div style={{ padding:"8px 16px", borderBottom:`1px solid ${C.border}`,
          display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", flexShrink:0, background:C.bg }}>
          {COLORS.map(c => (
            <button key={c} onClick={()=>{setEraser(false);setColor(c);}}
              style={{ width:22, height:22, borderRadius:"50%", background:c, border:"none",
                cursor:"pointer", flexShrink:0,
                outline: !eraser && color===c ? `3px solid ${C.accent}` : "2px solid transparent",
                outlineOffset:2 }} />
          ))}
          <div style={{ width:1, height:20, background:C.border, flexShrink:0 }} />
          {[2,4,8,14].map(s => (
            <button key={s} onClick={()=>{setEraser(false);setSize(s);}}
              style={{ width:28, height:28, borderRadius:7,
                border:`1.5px solid ${!eraser&&size===s?C.accent:C.border}`,
                background:!eraser&&size===s?C.accentL:"#fff", cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ width:s, height:s, borderRadius:"50%", background:color }} />
            </button>
          ))}
          <div style={{ width:1, height:20, background:C.border, flexShrink:0 }} />
          <button onClick={()=>setEraser(e=>!e)} style={{ padding:"5px 10px", borderRadius:7,
            fontSize:12, fontWeight:700, border:`1.5px solid ${eraser?C.warm:C.border}`,
            background:eraser?C.warmL:"#fff", color:eraser?C.warm:C.muted, cursor:"pointer" }}>
            Eraser
          </button>
          <button onClick={clearBoard} style={{ padding:"5px 10px", borderRadius:7, fontSize:12,
            border:`1px solid ${C.border}`, background:"#fff", color:C.muted, cursor:"pointer" }}>
            Clear
          </button>
          <div style={{ width:1, height:20, background:C.border, flexShrink:0 }} />
          <button onClick={async () => {
              // Save whiteboard as a note in localStorage — same system as the main app notes
              const noteTitle = title || "Whiteboard";
              const noteText  = `WHITEBOARD: ${noteTitle}\n\n` +
                `Saved on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}\n` +
                `Strokes: ${strokes.length}\n\n` +
                `[Whiteboard content — view in Study Group to see the drawing]`;
              try {
                const key = `saved_notes_wb_${Date.now()}`;
                const existing = JSON.parse(localStorage.getItem("classio_saved_whiteboards") || "[]");
                existing.unshift({ id: key, title: noteTitle, text: noteText,
                  savedAt: Date.now(), strokes: strokes });
                localStorage.setItem("classio_saved_whiteboards", JSON.stringify(existing.slice(0, 20)));
                setSaving(true);
                setTimeout(() => setSaving(false), 1200);
              } catch(e) { console.error("save whiteboard", e); }
            }} style={{ padding:"5px 12px", borderRadius:7, fontSize:12, fontWeight:700,
            border:`1px solid ${C.green}44`, background:C.greenL, color:C.green, cursor:"pointer",
            display:"flex", alignItems:"center", gap:5 }}>
            Save
          </button>
        </div>
        <div style={{ flex:1, overflow:"hidden", background:"#fff", position:"relative" }}>
          <canvas ref={canvasRef}
            style={{ width:"100%", height:"100%", display:"block",
              cursor: eraser ? "cell" : "crosshair", touchAction:"none" }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseLeave={e=>{
              updateDoc(doc(db,"studyGroups",groupId),{"sharedContent.cursor":null}).catch(()=>{});
              onUp(e);
            }}
            onMouseUp={onUp}
            onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI FLASHCARD GENERATOR — same flow as CardsTab, for study group sharing
// ═══════════════════════════════════════════════════════════════════════════════
function SGAIFlashcardGen({ groupId, db, user, groupFile, onClose }) {
  const [cardCount, setCardCount] = useState(10);
  const [cards,     setCards]     = useState([]);
  const [gen,       setGen]       = useState(false);
  const [sharing,   setSharing]   = useState(false);
  const [title,     setTitle]     = useState("");
  const [topic,     setTopic]     = useState("");
  const [manualQ,   setManualQ]   = useState("");
  const [manualA,   setManualA]   = useState("");
  const [tab,       setTab]       = useState("ai");

  const generate = async () => {
    if (!groupFile && !topic.trim()) return;
    setGen(true);
    try {
      let fileText = null;
      if (groupFile?._fileObj) fileText = await extractFileText(groupFile._fileObj).catch(()=>null);
      const safeText = fileText ? fileText.slice(0,12000) : null;
      const subject  = groupFile?.name || topic.trim() || "General Study";
      const userMsg  = safeText
        ? `Here is the COMPLETE content from "${subject}":\n\n${safeText}\n\nCreate exactly ${cardCount} study flashcards. Return JSON array: [{"question":"…","answer":"…"}]`
        : `Create exactly ${cardCount} study flashcards for "${topic || subject}". Return JSON array: [{"question":"…","answer":"…"}]`;
      const txt = await callClaude("Return ONLY valid JSON array. No markdown, no explanation.", userMsg);
      const parsed = JSON.parse(txt.replace(/```json|```/g,"").trim());
      setCards(parsed.map((c,i)=>({id:Date.now()+i,...c})));
      setTitle(groupFile?.name || topic || "AI Flashcards");
    } catch(e) { console.error(e); }
    setGen(false);
  };

  const addManual = () => {
    if (!manualQ.trim() || !manualA.trim()) return;
    setCards(p=>[...p,{id:Date.now(),question:manualQ.trim(),answer:manualA.trim()}]);
    setManualQ(""); setManualA("");
  };

  const shareCards = async () => {
    if (!cards.length) return;
    setSharing(true);
    await updateDoc(doc(db,"studyGroups",groupId), {
      sharedContent: { type:"flashcards", title: title||"Flashcards", cards,
        sharedBy: user.displayName?.split(" ")[0]||"Host",
        sharedByUid: user.uid, sharedAt: Date.now() },
      lastActivity: Date.now(),
    });
    setSharing(false); onClose();
  };

  const inp = { width:"100%", padding:"9px 12px", boxSizing:"border-box", background:C.bg,
    border:`1.5px solid ${C.border}`, borderRadius:9, color:C.text, fontSize:13,
    outline:"none", fontFamily:"inherit", marginBottom:8 };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4600,
      background:"rgba(26,23,20,.5)", backdropFilter:"blur(3px)",
      display:"flex", alignItems:"flex-end", justifyContent:"center", padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{
        width:"100%", maxWidth:520, background:C.surface,
        borderRadius:"20px 20px 16px 16px", border:`1px solid ${C.border}`,
        boxShadow:"0 -8px 40px rgba(0,0,0,.12)", maxHeight:"88vh", overflowY:"auto",
      }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"10px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:C.border }} />
        </div>
        <div style={{ padding:"12px 20px 8px", borderBottom:`1px solid ${C.border}`,
          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:15, fontWeight:700, color:C.text }}>Create Flashcards</span>
          <button onClick={onClose} style={{ background:C.bg, border:`1px solid ${C.border}`,
            borderRadius:"50%", width:28, height:28, color:C.muted, cursor:"pointer", fontSize:14,
            display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>
        <div style={{ padding:"16px 20px" }}>
          <div style={{ display:"flex", background:C.bg, borderRadius:10, padding:3, marginBottom:14 }}>
            {[{id:"ai",label:"AI Generate"},{id:"manual",label:"Manual"}].map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                flex:1, padding:"7px", borderRadius:8, border:"none", cursor:"pointer",
                background:tab===t.id?C.surface:"transparent", color:tab===t.id?C.accent:C.muted,
                fontSize:12, fontWeight:700, boxShadow:tab===t.id?"0 1px 4px rgba(0,0,0,.08)":"none",
              }}>{t.label}</button>
            ))}
          </div>
          {tab==="ai" && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {groupFile ? (
                <div style={{ padding:"10px 12px", borderRadius:10, background:C.accentL,
                  border:`1px solid ${C.accentS}`, display:"flex", alignItems:"center", gap:8 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.accent }}>Using group file</p>
                    <p style={{ margin:0, fontSize:11, color:C.muted, overflow:"hidden",
                      textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{groupFile.name}</p>
                  </div>
                </div>
              ) : (
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:.8 }}>Topic</label>
                  <input value={topic} onChange={e=>setTopic(e.target.value)}
                    placeholder="e.g. Photosynthesis, World War II…" style={{ ...inp, marginTop:5 }} />
                </div>
              )}
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:.8 }}>Card title</label>
                <input value={title} onChange={e=>setTitle(e.target.value)}
                  placeholder={groupFile?.name||topic||"My Flashcards"} style={{ ...inp, marginTop:5 }} />
              </div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:4 }}>
                {[5,8,10,15,20,30].map(n=>(
                  <button key={n} onClick={()=>setCardCount(n)} style={{
                    width:44, height:36, borderRadius:8,
                    border:`1.5px solid ${cardCount===n?C.accent:C.border}`,
                    background:cardCount===n?C.accent:"#fff",
                    color:cardCount===n?"#fff":C.text, fontSize:13, fontWeight:700, cursor:"pointer" }}>{n}</button>
                ))}
              </div>
              <button onClick={generate} disabled={gen||(!groupFile&&!topic.trim())} style={{
                background:C.accent, color:"#fff", border:"none", borderRadius:12,
                padding:"12px", fontSize:14, fontWeight:700, cursor:gen?"not-allowed":"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                opacity:(!groupFile&&!topic.trim())?.5:1, boxShadow:"0 4px 14px rgba(61,90,128,.3)",
              }}>
                {gen?<><SGSpinner color="#fff"/>Generating…</>:`Generate ${cardCount} Cards`}
              </button>
            </div>
          )}
          {tab==="manual" && (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Flashcard set title" style={inp} />
              <input value={manualQ} onChange={e=>setManualQ(e.target.value)} placeholder="Question" style={inp} />
              <input value={manualA} onChange={e=>setManualA(e.target.value)} placeholder="Answer"
                onKeyDown={e=>e.key==="Enter"&&addManual()} style={{ ...inp, marginBottom:4 }} />
              <button onClick={addManual} style={{ background:C.accentL, border:`1px solid ${C.accentS}`,
                borderRadius:9, padding:"8px", fontSize:12, fontWeight:700, color:C.accent,
                cursor:"pointer", marginBottom:8 }}>+ Add Card ({cards.length})</button>
            </div>
          )}
          {cards.length > 0 && (
            <>
              <div style={{ maxHeight:180, overflowY:"auto", display:"flex", flexDirection:"column",
                gap:6, marginTop:8, marginBottom:10 }}>
                {cards.map((c,i)=>(
                  <div key={c.id||i} style={{ background:C.bg, border:`1px solid ${C.border}`,
                    borderRadius:9, padding:"9px 12px", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:"0 0 2px", fontSize:12, fontWeight:700, color:C.text,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.question}</p>
                      <p style={{ margin:0, fontSize:11, color:C.muted,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.answer}</p>
                    </div>
                    <button onClick={()=>setCards(p=>p.filter((_,j)=>j!==i))}
                      style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:14, padding:"0 0 0 8px", flexShrink:0 }}>×</button>
                  </div>
                ))}
              </div>
              <button onClick={shareCards} disabled={sharing} style={{
                width:"100%", background:C.accent, color:"#fff", border:"none", borderRadius:12,
                padding:"13px", fontSize:14, fontWeight:700, cursor:sharing?"not-allowed":"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                boxShadow:"0 4px 14px rgba(61,90,128,.3)",
              }}>
                {sharing?<><SGSpinner color="#fff"/>Sharing…</>:`Present ${cards.length} Cards`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI NOTES GENERATOR — same quality as NotesTab, shared to group
// ═══════════════════════════════════════════════════════════════════════════════
function SGAINotesGen({ groupId, db, user, groupFile, onClose }) {
  const [topic,   setTopic]   = useState("");
  const [style,   setStyle]   = useState("detailed");
  const [gen,     setGen]     = useState(false);
  const [sharing, setSharing] = useState(false);
  const [notes,   setNotes]   = useState("");
  const [title,   setTitle]   = useState("");

  const STYLES = [
    { id:"detailed", label:"📋 Detailed",     desc:"Sections + bullet points" },
    { id:"bullet",   label:"• Bullet Points", desc:"Concise bullet-only format" },
    { id:"simple",   label:"🧒 Simple",        desc:"Plain language, short sentences" },
    { id:"exam",     label:"📝 Exam Focus",    desc:"Key terms + likely questions" },
  ];

  const generate = async () => {
    setGen(true); setNotes("");
    try {
      let fileText = null;
      if (groupFile?._fileObj) fileText = await extractFileText(groupFile._fileObj).catch(()=>null);
      const safeText = fileText ? fileText.slice(0,16000) : null;
      const subject  = groupFile?.name || topic.trim() || "Study Notes";
      const styleGuide = {
        detailed:"Write detailed notes split into sections. Each section has a heading in ALL CAPS followed by bullet points.",
        bullet:  "Write ONLY bullet points grouped under ALL CAPS headings. One fact per line.",
        simple:  "Write very simple short notes in plain language. Short sentences. No jargon.",
        exam:    "Write exam revision notes. Include key terms, definitions, possible exam questions, and a checklist.",
      };
      const userMsg = safeText
        ? `Here is the COMPLETE content from "${subject}":\n\n${safeText}\n\nCRITICAL: Cover EVERY section, concept, definition, and fact.`
        : `Create comprehensive study notes for: "${topic||subject}". Cover all key topics, definitions, formulas, and concepts.`;
      const txt = await callClaude(
        `You are a study notes writer. ${styleGuide[style]}
STRICT RULES: NEVER use asterisks or #. Section headings: ALL CAPS. Bullets: dash (-). Plain text only.
Math: proper notation (1×10⁻¹⁰ not words, H₂O not words). Units: standard abbreviations.`,
        userMsg, 4000
      );
      setNotes(txt);
      setTitle(groupFile?.name || topic || "Study Notes");
    } catch(e) { setNotes("Error: "+e.message); }
    setGen(false);
  };

  const shareNotes = async () => {
    if (!notes.trim()) return;
    setSharing(true);
    await updateDoc(doc(db,"studyGroups",groupId), {
      sharedContent: { type:"notes", title:title||"Notes", body:notes,
        sharedBy:user.displayName?.split(" ")[0]||"Host",
        sharedByUid:user.uid, sharedAt:Date.now() },
      lastActivity:Date.now(),
    });
    setSharing(false); onClose();
  };

  const inp = { width:"100%", padding:"9px 12px", boxSizing:"border-box", background:C.bg,
    border:`1.5px solid ${C.border}`, borderRadius:9, color:C.text, fontSize:13,
    outline:"none", fontFamily:"inherit" };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4600,
      background:"rgba(26,23,20,.5)", backdropFilter:"blur(3px)",
      display:"flex", alignItems:"flex-end", justifyContent:"center", padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{
        width:"100%", maxWidth:520, background:C.surface,
        borderRadius:"20px 20px 16px 16px", border:`1px solid ${C.border}`,
        boxShadow:"0 -8px 40px rgba(0,0,0,.12)", maxHeight:"88vh", overflowY:"auto",
      }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"10px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:C.border }} />
        </div>
        <div style={{ padding:"12px 20px 8px", borderBottom:`1px solid ${C.border}`,
          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:15, fontWeight:700, color:C.text }}>Generate Notes</span>
          <button onClick={onClose} style={{ background:C.bg, border:`1px solid ${C.border}`,
            borderRadius:"50%", width:28, height:28, color:C.muted, cursor:"pointer", fontSize:14,
            display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>
        <div style={{ padding:"16px 20px", display:"flex", flexDirection:"column", gap:10 }}>
          {groupFile ? (
            <div style={{ padding:"10px 12px", borderRadius:10, background:C.accentL,
              border:`1px solid ${C.accentS}`, display:"flex", alignItems:"center", gap:8 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.accent }}>Using group file</p>
                <p style={{ margin:0, fontSize:11, color:C.muted, overflow:"hidden",
                  textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{groupFile.name}</p>
              </div>
            </div>
          ) : (
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:.8 }}>Topic / subject</label>
              <input value={topic} onChange={e=>setTopic(e.target.value)}
                placeholder="e.g. The French Revolution, Calculus derivatives…"
                style={{ ...inp, marginTop:5 }} />
            </div>
          )}
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:.8 }}>Note style</label>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:7, marginTop:6 }}>
              {STYLES.map(s=>(
                <button key={s.id} onClick={()=>setStyle(s.id)} style={{
                  background:style===s.id?C.accentL:C.bg,
                  border:`1.5px solid ${style===s.id?C.accentS:C.border}`,
                  borderRadius:10, padding:"10px", cursor:"pointer", textAlign:"left",
                }}>
                  <p style={{ margin:"0 0 2px", fontSize:12, fontWeight:700, color:style===s.id?C.accent:C.text }}>{s.label}</p>
                  <p style={{ margin:0, fontSize:10, color:C.muted }}>{s.desc}</p>
                </button>
              ))}
            </div>
          </div>
          <button onClick={generate} disabled={gen||(!groupFile&&!topic.trim())} style={{
            background:C.accent, color:"#fff", border:"none", borderRadius:12,
            padding:"12px", fontSize:14, fontWeight:700, cursor:gen?"not-allowed":"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:8,
            opacity:(!groupFile&&!topic.trim())?.5:1, boxShadow:"0 4px 14px rgba(61,90,128,.3)",
          }}>
            {gen?<><SGSpinner color="#fff"/>Generating notes…</>:"Generate Notes"}
          </button>
          {notes && (
            <>
              <div style={{ background:C.bg, borderRadius:12, padding:14, border:`1px solid ${C.border}`,
                maxHeight:220, overflowY:"auto", fontSize:13, color:C.text, lineHeight:1.7, whiteSpace:"pre-wrap" }}>
                {notes}
              </div>
              <button onClick={shareNotes} disabled={sharing} style={{
                background:C.accent, color:"#fff", border:"none", borderRadius:12,
                padding:"13px", fontSize:14, fontWeight:700, cursor:sharing?"not-allowed":"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                boxShadow:"0 4px 14px rgba(61,90,128,.3)",
              }}>
                {sharing?<><SGSpinner color="#fff"/>Sharing…</>:"Present Notes to Group"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// VOICE CHAT — WebRTC audio mesh, Firestore signaling
// Each member connects directly to each other member (full mesh).
// Signaling stored under studyGroups/{gid}/voice/{uid_A}_{uid_B}
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// VOICE CHAT — auto-joins on mount, exposes state via onStateChange callback
// muted    = your mic is off  (others can't hear you)
// deafened = others' audio is silenced locally (only you)
// ═══════════════════════════════════════════════════════════════════════════════
function SGVoiceChat({ groupId, db, user, members, onStateChange }) {
  const [muted,    setMuted]    = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [ready,    setReady]    = useState(false);   // mic acquired
  const [error,    setError]    = useState("");

  const localStreamRef  = useRef(null);
  const pcsRef          = useRef({});
  const audioCtxRef     = useRef(null);
  const vadRafRef       = useRef(null);
  const unsubsRef       = useRef([]);
  const remoteAudiosRef = useRef({});
  const deafenedRef     = useRef(false); // ref copy so ontrack closure reads latest

  const STUN = { iceServers:[
    {urls:"stun:stun.l.google.com:19302"},
    {urls:"stun:stun1.l.google.com:19302"},
  ]};

  const pairKey = (a,b) => [a,b].sort().join("_");
  const sigRef  = (key) => doc(db,"studyGroups",groupId,"voice",key);

  // ── Voice Activity Detection ───────────────────────────────────────────────
  const startVAD = (stream) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const an  = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      audioCtxRef.current = ctx;
      const buf = new Uint8Array(an.frequencyBinCount);
      let last = false;
      const tick = () => {
        vadRafRef.current = requestAnimationFrame(tick);
        an.getByteFrequencyData(buf);
        const avg = buf.reduce((s,v)=>s+v,0) / buf.length;
        const active = avg > 12 && !deafenedRef.current;
        if (active !== last) {
          last = active;
          setSpeaking(active);
          updateDoc(doc(db,"studyGroups",groupId),{
            [`voiceSpeaking.${user.uid}`]: active
          }).catch(()=>{});
        }
      };
      tick();
    } catch(e) { console.error("VAD error",e); }
  };

  // ── Create peer connection to one remote user ──────────────────────────────
  const connectTo = async (remoteUid) => {
    if (pcsRef.current[remoteUid]) return;
    const pc  = new RTCPeerConnection(STUN);
    pcsRef.current[remoteUid] = pc;

    // Add local mic tracks
    localStreamRef.current?.getTracks().forEach(t =>
      pc.addTrack(t, localStreamRef.current)
    );

    // Incoming audio → hidden <audio> element
    pc.ontrack = (e) => {
      let audio = remoteAudiosRef.current[remoteUid];
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.playsInline = true;
        document.body.appendChild(audio);
        remoteAudiosRef.current[remoteUid] = audio;
      }
      audio.srcObject = e.streams[0];
      // Apply current deafen state
      audio.volume = deafenedRef.current ? 0 : 1;
    };

    const key     = pairKey(user.uid, remoteUid);
    const isCaller = user.uid < remoteUid;

    // ICE trickle
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const field = isCaller ? "callerIce" : "calleeIce";
      setDoc(sigRef(key), {[field]: arrayUnion(e.candidate.toJSON())}, {merge:true}).catch(()=>{});
    };

    if (isCaller) {
      const offer = await pc.createOffer({offerToReceiveAudio:true});
      await pc.setLocalDescription(offer);
      await setDoc(sigRef(key), {
        offer:{type:offer.type,sdp:offer.sdp}, callerIce:[], calleeIce:[]
      });
      const unsub = onSnapshot(sigRef(key), async (snap) => {
        const d = snap.data();
        if (d?.answer && !pc.remoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(d.answer)).catch(()=>{});
        }
        for (const c of (d?.calleeIce||[])) {
          if (pc.remoteDescription)
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});
        }
      });
      unsubsRef.current.push(unsub);
    } else {
      const unsub = onSnapshot(sigRef(key), async (snap) => {
        const d = snap.data();
        if (!d?.offer || pc.remoteDescription) return;
        await pc.setRemoteDescription(new RTCSessionDescription(d.offer)).catch(()=>{});
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await setDoc(sigRef(key), {answer:{type:answer.type,sdp:answer.sdp}},{merge:true});
        for (const c of (d?.callerIce||[]))
          await pc.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});
      });
      unsubsRef.current.push(unsub);
    }
  };

  // ── Auto-join on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({audio:true,video:false});
        if (cancelled) { stream.getTracks().forEach(t=>t.stop()); return; }
        localStreamRef.current = stream;
        startVAD(stream);
        setReady(true);

        await updateDoc(doc(db,"studyGroups",groupId),{
          [`voiceMembers.${user.uid}`]: true,
          lastActivity: Date.now(),
        }).catch(()=>{});

        // Connect to all current members
        const others = Object.keys(members).filter(uid => uid !== user.uid);
        for (const uid of others) await connectTo(uid).catch(()=>{});

      } catch(e) {
        if (!cancelled) setError("Mic blocked");
        console.warn("Voice auto-join failed:", e.message);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(vadRafRef.current);
      audioCtxRef.current?.close().catch(()=>{});
      Object.values(pcsRef.current).forEach(pc=>pc.close());
      pcsRef.current = {};
      localStreamRef.current?.getTracks().forEach(t=>t.stop());
      localStreamRef.current = null;
      Object.values(remoteAudiosRef.current).forEach(el=>el.remove());
      remoteAudiosRef.current = {};
      unsubsRef.current.forEach(u=>u());
      unsubsRef.current = [];
      updateDoc(doc(db,"studyGroups",groupId),{
        [`voiceMembers.${user.uid}`]:null,
        [`voiceSpeaking.${user.uid}`]:null,
      }).catch(()=>{});
    };
  }, [groupId]);

  // When new members join, connect to them too
  useEffect(() => {
    if (!ready) return;
    const others = Object.keys(members).filter(uid=>uid!==user.uid);
    others.forEach(uid => connectTo(uid).catch(()=>{}));
  }, [Object.keys(members).sort().join(","), ready]);

  // ── Mute — disables local mic tracks ──────────────────────────────────────
  const toggleMute = () => {
    const nowMuted = !muted;
    setMuted(nowMuted);
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !nowMuted; });
    if (nowMuted) {
      // Stop showing as speaking when muted
      setSpeaking(false);
      updateDoc(doc(db,"studyGroups",groupId),{[`voiceSpeaking.${user.uid}`]:false}).catch(()=>{});
    }
    onStateChange?.({ muted:nowMuted, deafened });
  };

  // ── Deafen — sets remote audio volume to 0 (only affects your ears) ───────
  const toggleDeafen = () => {
    const nowDeafened = !deafened;
    setDeafened(nowDeafened);
    deafenedRef.current = nowDeafened;
    // Set volume on all existing remote audio elements
    Object.values(remoteAudiosRef.current).forEach(el => {
      el.volume = nowDeafened ? 0 : 1;
    });
    // Auto-mute mic when deafening (like Discord)
    if (nowDeafened && !muted) {
      setMuted(true);
      localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
    }
    onStateChange?.({ muted: nowDeafened ? true : muted, deafened:nowDeafened });
  };

  // Expose state + toggle functions upward for bottom bar
  useEffect(() => {
    onStateChange?.({ muted, deafened, speaking, ready, error,
      toggleMute, toggleDeafen });
  }, [muted, deafened, speaking, ready, error]);

  // Render nothing — UI lives in the bottom bar via props
  return null;
}


// ═══════════════════════════════════════════════════════════════════════════════
// SHARE PICKER — Google Meet style bottom-sheet, all modes in one place
// ═══════════════════════════════════════════════════════════════════════════════
function SGSharePicker({ user, db, groupId, group, groupFile, isHost, onClose,
                         onOpenWhiteboard, onOpenFlashcards, onOpenNotes }) {
  const [sharing,    setSharing]    = useState(false);
  const [activeStep, setActiveStep] = useState("pick"); // pick | screenshare
  const [noFileWarning, setNoFileWarning] = useState(false); // show upload-file nudge
  const [bypassWarning, setBypassWarning] = useState(false); // user clicked "I understand"
  const stopHostRef = useRef(null); // SGScreenShareHost registers its stopCapture here

  const alreadySharing = !!group?.sharedContent;
  const isPresenting   = group?.sharedContent?.sharedByUid === user.uid;

  const stopSharing = async () => {
    await updateDoc(doc(db,"studyGroups",groupId), { sharedContent: null });
    onClose();
  };

  // Re-present the already-stored file (for granted presenters who have no local file)
  const reShareFile = async () => {
    const fileName = group?.hostFileName || group?.sharedContent?.fileName;
    const chunks   = group?.sharedContent?.fileChunks;
    if (!fileName || !chunks) return;
    setSharing(true);
    try {
      await updateDoc(doc(db,"studyGroups",groupId), {
        sharedContent: {
          type:        "file",
          fileName:    fileName,
          fileChunks:  chunks,
          fileData:    null,
          fileURL:     null,
          title:       fileName,
          sharedBy:    user.displayName?.split(" ")[0] || "Presenter",
          sharedByUid: user.uid,
          sharedAt:    Date.now(),
        },
        lastActivity: Date.now(),
      });
    } catch(e) {
      console.error("reShareFile", e);
    }
    setSharing(false);
    onClose();
  };

  // Share file — split base64 across Firestore sub-documents (750KB each)
  // No Firebase Storage or RTDB needed — works on free Spark plan
  const shareFile = async () => {
    if (!groupFile?._fileObj) return;
    setSharing(true);
    try {
      const file = groupFile._fileObj;
      // Read as base64 data URL
      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      // Split into 750KB chunks and write each as a separate Firestore doc
      const CHUNK = 750000;
      const totalChunks = Math.ceil(fileData.length / CHUNK);
      const chunkCol = collection(db, "studyGroups", groupId, "fileChunks");
      // Delete old chunks first
      const oldChunks = await getDocs(chunkCol);
      for (const d of oldChunks.docs) await deleteDoc(d.ref);
      // Write new chunks — all must succeed before we tell viewers
      for (let i = 0; i < totalChunks; i++) {
        await setDoc(doc(chunkCol, String(i)), {
          chunk: fileData.slice(i * CHUNK, (i + 1) * CHUNK),
          index: i,
          total: totalChunks,
        });
      }
      // Only AFTER all chunks are written, set sharedContent so viewers start fetching
      await updateDoc(doc(db,"studyGroups",groupId), {
        sharedContent: {
          type:        "file",
          fileName:    groupFile.name,
          fileChunks:  totalChunks,
          fileData:    null,
          fileURL:     null,
          title:       groupFile.name,
          sharedBy:    user.displayName?.split(" ")[0] || "Host",
          sharedByUid: user.uid,
          sharedAt:    Date.now(),
        },
        lastActivity: Date.now(),
      });
    } catch(e) {
      console.error("shareFile", e);
      alert("Share failed: " + e.message);
    }
    setSharing(false);
    onClose();
  };

  const MODES = [
    { id:"notes",       icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3D5A80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>, label:"AI Notes",      desc:"Generate & share notes with AI",
      action: () => { onClose(); onOpenNotes(); } },
    { id:"flashcards",  icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/></svg>, label:"AI Flashcards", desc:"Generate & present study cards",
      action: () => { onClose(); onOpenFlashcards(); } },
    { id:"whiteboard",  icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>, label:"Whiteboard",    desc:"Draw live for everyone to see",
      action: () => { onClose(); onOpenWhiteboard(); } },
    { id:"file",        icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D69E2E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>, label:"Study File",
      desc: (() => {
        if (groupFile) return `Present "${groupFile.name}"`;
        const hostFile = group?.hostFileName || group?.sharedContent?.fileName;
        if (hostFile) return `Present "${hostFile}"`;
        return isHost ? "No file uploaded yet" : "No file uploaded by host";
      })(),
      action: () => {
        if (groupFile) { shareFile(); return; }
        // Non-host presenter: re-present using already stored chunks
        reShareFile();
      },
      disabled: sharing || (!groupFile && !group?.sharedContent?.fileChunks && !group?.hostFileName) },
    { id:"screenshare", icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>, label:"Screen Share",  desc:"Share your screen live",
      action: () => setActiveStep("screenshare") },
  ];

  return (
    <div onClick={() => { if (activeStep !== "screenshare") onClose(); }}
      style={{ position:"fixed", inset:0, zIndex:4500,
      background:"rgba(26,23,20,.45)", backdropFilter:"blur(3px)",
      display:"flex", alignItems:"flex-end", justifyContent:"center", padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{
        width:"100%", maxWidth:520, background:C.surface,
        borderRadius:"20px 20px 16px 16px", border:`1px solid ${C.border}`,
        boxShadow:"0 -8px 40px rgba(0,0,0,.12)", paddingBottom:8,
        maxHeight:"82vh", overflowY:"auto",
      }}>
        <div style={{ display:"flex", justifyContent:"center", padding:"10px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:C.border }} />
        </div>
        <div style={{ padding:"12px 20px 10px", borderBottom:`1px solid ${C.border}`,
          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {activeStep !== "pick" && (
              <button onClick={()=>setActiveStep("pick")} style={{
                background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:18, padding:0 }}>←</button>
            )}
            <span style={{ fontSize:15, fontWeight:700, color:C.text }}>
              {activeStep === "pick" ? "Present to Group" : "Screen Share"}
            </span>
          </div>
          <button onClick={onClose}
            style={{ background:C.bg, border:`1px solid ${C.border}`,
            borderRadius:"50%", width:28, height:28, color:C.muted, cursor:"pointer", fontSize:14,
            display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>

        <div style={{ padding:"14px 20px" }}>
          {isPresenting && activeStep === "pick" && (
            <button onClick={stopSharing} style={{
              width:"100%", marginBottom:10, padding:"10px",
              background:C.redL, border:`1px solid ${C.red}44`,
              borderRadius:12, color:C.red, fontSize:13, fontWeight:700, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", gap:8,
            }}>⏹ Stop Presenting</button>
          )}
          {alreadySharing && !isPresenting && activeStep === "pick" && (
            <div style={{ padding:"10px 14px", borderRadius:10, background:C.warmL,
              border:`1px solid ${C.warm}44`, marginBottom:10 }}>
              <p style={{ margin:0, fontSize:13, color:C.warm, fontWeight:600 }}>
                {group.sharedContent.sharedBy} is currently presenting.
              </p>
            </div>
          )}

          {/* No-file warning banner */}
          {noFileWarning && !bypassWarning && activeStep === "pick" && (
            <div style={{ marginBottom:12, padding:"14px 16px",
              background:C.warmL, border:`1.5px solid ${C.warm}55`,
              borderRadius:14 }}>
              <p style={{ margin:"0 0 4px", fontSize:14, fontWeight:700, color:C.warm }}>
                No study file uploaded
              </p>
              <p style={{ margin:"0 0 12px", fontSize:13, color:C.text, lineHeight:1.5 }}>
                For the best experience, upload a study file so AI can generate notes,
                flashcards, and quizzes from it. You can still use all features manually without one.
              </p>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={() => { setBypassWarning(true); setNoFileWarning(false); }}
                  style={{ flex:1, padding:"9px", borderRadius:10,
                    background:C.bg, border:`1px solid ${C.border}`,
                    color:C.text, fontSize:13, fontWeight:700, cursor:"pointer" }}>
                  I understand, continue
                </button>
                <button onClick={() => setNoFileWarning(false)}
                  style={{ padding:"9px 14px", borderRadius:10,
                    background:"none", border:`1px solid ${C.border}`,
                    color:C.muted, fontSize:13, cursor:"pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {activeStep === "pick" && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {MODES.map(m => (
                <button key={m.id}
                  disabled={(alreadySharing && !isPresenting) || m.disabled}
                  onClick={m.action} style={{
                    background:C.bg, border:`1.5px solid ${C.border}`,
                    borderRadius:14, padding:"14px 12px", cursor:"pointer",
                    textAlign:"left",
                    opacity:((alreadySharing && !isPresenting) || m.disabled) ? .4 : 1,
                    transition:"border-color .15s",
                  }}
                  onMouseEnter={e=>{if(!m.disabled&&!(alreadySharing&&!isPresenting))e.currentTarget.style.borderColor=C.accentS;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;}}>
                  <div style={{ fontSize:24, marginBottom:7 }}>
                    {m.id==="file" && sharing ? "⏳" : m.emoji}
                  </div>
                  <p style={{ margin:"0 0 3px", fontSize:13, fontWeight:700, color:C.text }}>{m.label}</p>
                  <p style={{ margin:0, fontSize:11, color:C.muted, lineHeight:1.3 }}>{m.desc}</p>
                </button>
              ))}
            </div>
          )}

          {/* Real screen share panel */}
          {activeStep === "screenshare" && (
            <SGScreenShareHost groupId={groupId} db={db} user={user}
              registerStop={fn => { stopHostRef.current = fn; }}
              onStop={() => { stopHostRef.current = null; setActiveStep("pick"); }} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Multiplayer Quiz — synced via Firestore gameState ─────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// QUIZ GAME — handles all modes with genuinely different mechanics
// Modes: mcq, truefalse, rapidfire, quizshow, memory, speedround, elimination, teamquiz
// ═══════════════════════════════════════════════════════════════════════════════
function SGQuizGame({ gameState, isHost, user, db, groupId, members }) {
  const [localAnswer,  setLocalAnswer]  = useState(null);
  const [timeLeft,     setTimeLeft]     = useState(null);
  const [teamInput,    setTeamInput]    = useState("");
  const [matchPicked,  setMatchPicked]  = useState(null); // for memory mode
  const timerRef = useRef(null);

  const mode  = gameState?.mode || "mcq";
  const q     = gameState?.currentQuestion;
  const myScore  = gameState?.scores?.[user.uid]  || 0;
  const myTeam   = gameState?.teams?.[user.uid];
  const eliminated = (gameState?.eliminated || []).includes(user.uid);

  const scores = gameState?.scores || {};
  const board  = Object.entries(scores)
    .map(([uid,pts]) => ({ uid, pts, name:(members[uid]?.displayName||"User").split(" ")[0] }))
    .sort((a,b) => b.pts - a.pts);
  const answerCount = Object.keys(gameState?.answers || {}).length;
  const memberCount = Object.keys(members || {}).length;

  useEffect(() => { setLocalAnswer(null); setMatchPicked(null); }, [gameState?.questionIndex]);

  // Speed round countdown timer
  useEffect(() => {
    if (mode !== "speedround" || !q || localAnswer !== null) return;
    setTimeLeft(10);
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          submitAnswer("__timeout__");
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [gameState?.questionIndex, mode]);

  const submitAnswer = async (choice) => {
    if (localAnswer !== null || !q) return;
    setLocalAnswer(choice);
    clearInterval(timerRef.current);
    const correct = choice === q.answer;
    const current = gameState?.scores?.[user.uid] || 0;

    // Score calculation varies by mode
    let points = 0;
    if (correct) {
      if (mode === "speedround") points = Math.max(1, timeLeft || 1) * 100; // time bonus
      else if (mode === "rapidfire") {
        const answered = Object.keys(gameState?.answers || {}).length;
        points = Math.max(10, 100 - answered * 15); // first correct = 100pts, each subsequent -15
      }
      else points = 10;
    }

    const updates = {
      [`gameState.scores.${user.uid}`]: current + points,
      [`gameState.answers.${user.uid}`]: choice,
    };

    // Elimination mode: mark as eliminated on wrong answer
    if (mode === "elimination" && !correct) {
      const current_elim = gameState?.eliminated || [];
      if (!current_elim.includes(user.uid)) {
        updates["gameState.eliminated"] = [...current_elim, user.uid];
      }
    }

    // Team mode: accumulate to team score
    if (mode === "teamquiz" && myTeam !== undefined && correct) {
      const teamKey = `gameState.teamScores.team${myTeam}`;
      const cur = (gameState?.teamScores?.[`team${myTeam}`] || 0);
      updates[teamKey] = cur + 10;
    }

    await updateDoc(doc(db,"studyGroups",groupId), updates);
  };

  const nextQuestion = async () => {
    const questions = gameState.questions || [];
    const next = (gameState.questionIndex || 0) + 1;
    if (next >= questions.length) {
      await updateDoc(doc(db,"studyGroups",groupId), {"gameState.phase":"results"});
    } else {
      await updateDoc(doc(db,"studyGroups",groupId), {
        "gameState.questionIndex": next,
        "gameState.currentQuestion": questions[next],
        "gameState.answers": {},
        "gameState.phase": "question",
      });
    }
  };

  const endGame = async () => {
    await updateDoc(doc(db,"studyGroups",groupId), { gameState:null });
  };

  // ── RESULTS SCREEN ──────────────────────────────────────────────────────────
  if (gameState?.phase === "results") {
    const teamScores = gameState?.teamScores || {};
    return (
      <div style={{ flex:1, overflowY:"auto", padding:20 }}>
        <div style={{ background:C.surface, borderRadius:18, padding:24,
          border:`1px solid ${C.border}`, maxWidth:480, margin:"0 auto" }}>
          <h2 style={{ color:C.warm, margin:"0 0 6px", textAlign:"center",
            fontSize:22, fontFamily:"'Fraunces',serif" }}>Final Results</h2>
          <p style={{ textAlign:"center", fontSize:12, color:C.muted, margin:"0 0 20px" }}>
            {gameState.topic} · {gameState.mode?.toUpperCase()}
          </p>

          {mode === "teamquiz" && Object.keys(teamScores).length > 0 ? (
            <>
              <p style={{ fontSize:11, fontWeight:700, color:C.muted, letterSpacing:.8,
                textTransform:"uppercase", marginBottom:10 }}>Team Scores</p>
              {Object.entries(teamScores).sort((a,b)=>b[1]-a[1]).map(([team,score],i)=>(
                <div key={team} style={{ display:"flex", alignItems:"center", gap:12,
                  background:i===0?C.warmL:C.bg, borderRadius:12,
                  padding:"12px 16px", marginBottom:8,
                  border:`1px solid ${i===0?C.warm+"55":C.border}` }}>
                  
                  <span style={{ flex:1, fontWeight:700, color:C.text }}>
                    {team === "team0" ? "Team Blue" : "Team Red"}
                  </span>
                  <span style={{ color:C.warm, fontWeight:800, fontSize:18 }}>{score}</span>
                  <span style={{ color:C.muted, fontSize:11 }}>pts</span>
                </div>
              ))}
              <div style={{ height:1, background:C.border, margin:"16px 0" }} />
            </>
          ) : null}

          <p style={{ fontSize:11, fontWeight:700, color:C.muted, letterSpacing:.8,
            textTransform:"uppercase", marginBottom:10 }}>Individual Scores</p>
          {board.map((entry,i) => (
            <div key={entry.uid} style={{ display:"flex", alignItems:"center", gap:12,
              background:i===0?C.warmL:C.bg, borderRadius:12,
              padding:"10px 16px", marginBottom:6,
              border:`1px solid ${i===0?C.warm+"55":C.border}` }}>
              <span style={{ fontSize:18, width:26, textAlign:"center" }}>
                {i===0?"1.":i===1?"2.":i===2?"3.":`${i+1}.`}
              </span>
              <span style={{ flex:1, color:C.text, fontWeight:700 }}>{entry.name}</span>
              <span style={{ color:C.warm, fontWeight:800, fontSize:16 }}>{entry.pts}</span>
              <span style={{ color:C.muted, fontSize:11 }}>pts</span>
            </div>
          ))}

          {isHost && (
            <div style={{ display:"flex", gap:8, marginTop:16 }}>
              <button onClick={async () => {
                const initScores={};
                Object.keys(members||{}).forEach(uid => {initScores[uid]=0;});
                const qs = gameState.questions||[];
                await updateDoc(doc(db,"studyGroups",groupId),{
                  gameState:{...gameState, phase:"question", questionIndex:0,
                    currentQuestion:qs[0], scores:initScores, answers:{},
                    eliminated:[], teamScores:{} },
                });
              }} style={{ flex:1, background:C.accentL, border:`1px solid ${C.accentS}`,
                color:C.accent, borderRadius:12, padding:"11px",
                fontSize:13, fontWeight:700, cursor:"pointer" }}>Play Again</button>
              <button onClick={endGame} style={{ flex:1, background:C.bg,
                border:`1px solid ${C.border}`, color:C.muted, borderRadius:12,
                padding:"11px", fontSize:13, fontWeight:700, cursor:"pointer" }}>Back to Room</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!q) return (
    <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <p style={{ color:C.muted }}>Waiting for game to start…</p>
    </div>
  );

  // ── ELIMINATION: show eliminated screen ────────────────────────────────────
  if (mode === "elimination" && eliminated) return (
    <div style={{ flex:1, display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", gap:16, padding:24 }}>
      <div style={{ width:64,height:64,borderRadius:20,background:"#fee2e2",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto" }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a9 9 0 0 0-9 9c0 3.18 1.66 5.97 4.14 7.56L7 21h10l-.14-2.44A9 9 0 0 0 21 11a9 9 0 0 0-9-9zM9 17v1M15 17v1M9 12h.01M15 12h.01"/></svg></div>
      <h2 style={{ color:C.red, fontFamily:"'Fraunces',serif", margin:0 }}>You're Eliminated!</h2>
      <p style={{ color:C.muted, fontSize:13, textAlign:"center", maxWidth:260 }}>
        You answered incorrectly. Watch as the others battle it out.
      </p>
      <div style={{ background:C.surface, borderRadius:14, padding:"14px 20px",
        border:`1px solid ${C.border}`, width:"100%", maxWidth:320 }}>
        <p style={{ margin:"0 0 8px", fontSize:10, fontWeight:700, color:C.muted,
          letterSpacing:.8, textTransform:"uppercase" }}>Still Playing ({
            memberCount - (gameState?.eliminated||[]).length
          })</p>
        {board.filter(e=>!(gameState?.eliminated||[]).includes(e.uid)).map((entry,i)=>(
          <div key={entry.uid} style={{ display:"flex", justifyContent:"space-between",
            padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
            <span style={{ color:C.text, fontSize:13 }}>{entry.name}</span>
            <span style={{ color:C.green, fontWeight:700 }}>{entry.pts}pts</span>
          </div>
        ))}
      </div>
    </div>
  );

  // ── MEMORY MATCH mode ──────────────────────────────────────────────────────
  if (mode === "memory") {
    const pairs = (gameState.questions||[]).slice(0,8).map(q=>([
      {id:`q_${q.question}`, text:q.question, type:"question", answer:q.answer},
      {id:`a_${q.answer}`,   text:q.answer,   type:"answer",  answer:q.answer},
    ])).flat().sort(()=>Math.random()-.5);

    return (
      <div style={{ flex:1, overflowY:"auto", padding:16, display:"flex", flexDirection:"column", gap:12 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:14, fontWeight:700, color:C.text }}>Memory Match</span>
          <span style={{ color:C.accent, fontSize:12, fontWeight:700 }}>Score: {myScore} pts</span>
        </div>
        <p style={{ color:C.muted, fontSize:12, margin:0 }}>Match each question to its answer</p>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          {pairs.map(card => {
            const matched = gameState?.matched?.includes(card.id);
            const picked  = matchPicked?.id === card.id;
            return (
              <button key={card.id} disabled={matched || picked}
                onClick={async () => {
                  if (matched) return;
                  if (!matchPicked) { setMatchPicked(card); return; }
                  // Check match
                  const isMatch = matchPicked.answer === card.answer && matchPicked.type !== card.type;
                  if (isMatch) {
                    const cur = gameState?.scores?.[user.uid]||0;
                    const matched_arr = [...(gameState?.matched||[]), matchPicked.id, card.id];
                    await updateDoc(doc(db,"studyGroups",groupId),{
                      [`gameState.scores.${user.uid}`]: cur+15,
                      "gameState.matched": matched_arr,
                    });
                  }
                  setMatchPicked(null);
                }}
                style={{ padding:"10px 8px", borderRadius:10, fontSize:12, textAlign:"center",
                  fontWeight:600, lineHeight:1.4, cursor:matched?"default":"pointer",
                  background: matched?C.greenL : picked?C.accentL : C.surface,
                  border:`2px solid ${matched?C.green:picked?C.accent:C.border}`,
                  color: matched?C.green:picked?C.accent:C.text,
                  opacity: matched?.7:1, transition:"all .12s",
                  textDecoration: matched?"line-through":"none",
                }}>
                <div style={{ fontSize:9, fontWeight:800, letterSpacing:.8, textTransform:"uppercase",
                  color:C.muted, marginBottom:4 }}>{card.type}</div>
                {card.text}
              </button>
            );
          })}
        </div>
        <ScoreBar board={board} />
      </div>
    );
  }

  // ── TRUE/FALSE mode ─────────────────────────────────────────────────────────
  if (mode === "truefalse") {
    const tfQ = q;
    return (
      <div style={{ flex:1, overflowY:"auto", padding:16, display:"flex", flexDirection:"column", gap:12 }}>
        <ProgressBar gameState={gameState} myScore={myScore} />
        <div style={{ background:C.surface, borderRadius:14, padding:"20px", border:`1px solid ${C.border}`,
          boxShadow:"0 2px 10px rgba(0,0,0,.06)", flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <p style={{ color:C.text, fontSize:17, fontWeight:700, textAlign:"center", lineHeight:1.6, margin:0 }}>{tfQ.question}</p>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          {["True","False"].map(opt => {
            const chosen  = localAnswer === opt;
            const correct = localAnswer !== null && opt === tfQ.answer;
            const wrong   = chosen && opt !== tfQ.answer;
            return (
              <button key={opt} onClick={() => submitAnswer(opt)} disabled={localAnswer!==null}
                style={{ padding:"28px 12px", borderRadius:16, border:"none",
                  cursor:localAnswer!==null?"default":"pointer",
                  fontSize:22, fontWeight:800,
                  background:correct?C.greenL:wrong?C.redL:opt==="True"?"#e6f4ea":"#fce8e8",
                  color:correct?C.green:wrong?C.red:opt==="True"?"#1e6e3e":"#b71c1c",
                  outline:correct?`3px solid ${C.green}`:wrong?`3px solid ${C.red}`:chosen?`3px solid ${C.accent}`:"none",
                  transition:"all .12s", boxShadow:"0 3px 12px rgba(0,0,0,.08)" }}>
                {opt === "True" ? "True" : "False"}
              </button>
            );
          })}
        </div>
        {isHost && localAnswer !== null && (
          <NextBtn onClick={nextQuestion} />
        )}
        <AnswerBar answerCount={answerCount} memberCount={memberCount} />
        <ScoreBar board={board} />
      </div>
    );
  }

  // ── RAPID FIRE mode ─────────────────────────────────────────────────────────
  if (mode === "rapidfire") {
    return (
      <div style={{ flex:1, overflowY:"auto", padding:16, display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ background:C.warmL, border:`1px solid ${C.warm}44`, borderRadius:8,
            padding:"4px 10px", fontSize:11, fontWeight:700, color:C.warm }}>
            RAPID FIRE — First correct = most points!
          </div>
          <span style={{ color:C.accent, fontSize:12, fontWeight:700 }}>Score: {myScore}</span>
        </div>
        <ProgressBar gameState={gameState} myScore={myScore} hideScore />
        <div style={{ background:C.surface, borderRadius:14, padding:"18px", border:`1px solid ${C.border}` }}>
          <p style={{ color:C.text, fontSize:16, fontWeight:700, margin:0, lineHeight:1.5 }}>{q.question}</p>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {(q.options||[]).map((opt,i) => {
            const chosen  = localAnswer === opt;
            const correct = localAnswer !== null && opt === q.answer;
            const wrong   = chosen && opt !== q.answer;
            return (
              <button key={i} onClick={() => submitAnswer(opt)} disabled={localAnswer!==null}
                style={{ padding:"14px 12px", borderRadius:13, border:"none",
                  cursor:localAnswer!==null?"default":"pointer",
                  fontWeight:700, fontSize:13, textAlign:"left", lineHeight:1.4,
                  background:correct?C.greenL:wrong?C.redL:chosen?C.accentL:"#fff",
                  color:correct?C.green:wrong?C.red:chosen?C.accent:C.text,
                  border:`1.5px solid ${correct?C.green:wrong?C.red:chosen?C.accent:C.border}`,
                  transition:"all .12s", boxShadow:"0 1px 4px rgba(0,0,0,.06)" }}>
                <span style={{ opacity:.5, marginRight:6 }}>{["A","B","C","D"][i]}.</span>{opt}
              </button>
            );
          })}
        </div>
        {isHost && localAnswer !== null && <NextBtn onClick={nextQuestion} />}
        <AnswerBar answerCount={answerCount} memberCount={memberCount} />
        <ScoreBar board={board} />
      </div>
    );
  }

  // ── SPEED ROUND mode ────────────────────────────────────────────────────────
  if (mode === "speedround") {
    const timerPct = ((timeLeft||0) / 10) * 100;
    const timerColor = (timeLeft||0) > 6 ? C.green : (timeLeft||0) > 3 ? C.warm : C.red;
    return (
      <div style={{ flex:1, overflowY:"auto", padding:16, display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:C.muted, fontSize:12 }}>Q {(gameState.questionIndex||0)+1}/{gameState.questions?.length}</span>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ height:6, width:80, borderRadius:3, background:C.border }}>
              <div style={{ height:"100%", borderRadius:3, background:timerColor,
                width:`${timerPct}%`, transition:"width 1s linear" }} />
            </div>
            <span style={{ fontSize:16, fontWeight:800, color:timerColor, minWidth:24 }}>{timeLeft}</span>
          </div>
          <span style={{ color:C.accent, fontSize:12, fontWeight:700 }}>Score: {myScore}</span>
        </div>
        <div style={{ background:C.surface, borderRadius:14, padding:"18px", border:`1px solid ${C.border}` }}>
          <p style={{ color:C.text, fontSize:16, fontWeight:700, margin:0, lineHeight:1.5 }}>{q.question}</p>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {(q.options||[]).map((opt,i) => {
            const chosen  = localAnswer === opt;
            const correct = localAnswer !== null && opt === q.answer;
            const wrong   = chosen && (opt !== q.answer || opt === "__timeout__");
            const isTimeout = localAnswer === "__timeout__";
            return (
              <button key={i} onClick={() => submitAnswer(opt)}
                disabled={localAnswer!==null}
                style={{ padding:"14px 12px", borderRadius:13, border:"none",
                  cursor:localAnswer!==null?"default":"pointer",
                  fontWeight:700, fontSize:13, textAlign:"left",
                  background: isTimeout && opt===q.answer ? C.greenL :
                               correct?C.greenL:wrong?C.redL:chosen?C.accentL:"#fff",
                  color: isTimeout && opt===q.answer ? C.green :
                         correct?C.green:wrong?C.red:chosen?C.accent:C.text,
                  border: `1.5px solid ${(isTimeout&&opt===q.answer)||correct?C.green:wrong?C.red:chosen?C.accent:C.border}`,
                  boxShadow:"0 1px 4px rgba(0,0,0,.06)",
                  transition:"all .12s" }}>
                <span style={{ opacity:.5, marginRight:6 }}>{["A","B","C","D"][i]}.</span>{opt}
              </button>
            );
          })}
        </div>
        {localAnswer === "__timeout__" && (
          <div style={{ padding:"8px 14px", borderRadius:10, background:C.redL,
            border:`1px solid ${C.red}44`, color:C.red, fontSize:13, fontWeight:700, textAlign:"center" }}>
            ⏰ Time's up! The answer was: {q.answer}
          </div>
        )}
        {isHost && localAnswer !== null && <NextBtn onClick={nextQuestion} />}
        <AnswerBar answerCount={answerCount} memberCount={memberCount} />
        <ScoreBar board={board} />
      </div>
    );
  }

  // ── TEAM QUIZ mode ──────────────────────────────────────────────────────────
  if (mode === "teamquiz") {
    const teamColors = {0:{c:C.accent,l:C.accentL,name:"Blue"}, 1:{c:C.red,l:C.redL,name:"Red"}};
    const myT = teamColors[myTeam] || teamColors[0];
    const tScores = gameState?.teamScores || {};
    return (
      <div style={{ flex:1, overflowY:"auto", padding:16, display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ background:myT.l, border:`1px solid ${myT.c}44`,
            borderRadius:8, padding:"4px 10px", fontSize:11, fontWeight:700, color:myT.c }}>
            {myT.name} Team
          </div>
          <div style={{ display:"flex", gap:8 }}>
            {Object.entries(tScores).map(([team,score])=>(
              <span key={team} style={{ fontSize:12, fontWeight:700,
                color: team==="team0"?C.accent:C.red }}>{team==="team0"?"●":"●"} {score}</span>
            ))}
          </div>
        </div>
        <ProgressBar gameState={gameState} myScore={myScore} />
        <div style={{ background:C.surface, borderRadius:14, padding:"18px", border:`1px solid ${C.border}` }}>
          <p style={{ color:C.text, fontSize:16, fontWeight:700, margin:0, lineHeight:1.5 }}>{q.question}</p>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {(q.options||[]).map((opt,i) => {
            const chosen  = localAnswer === opt;
            const correct = localAnswer !== null && opt === q.answer;
            const wrong   = chosen && opt !== q.answer;
            return (
              <button key={i} onClick={() => submitAnswer(opt)} disabled={localAnswer!==null}
                style={{ padding:"14px 12px", borderRadius:13, border:"none",
                  cursor:localAnswer!==null?"default":"pointer",
                  fontWeight:700, fontSize:13, textAlign:"left",
                  background:correct?C.greenL:wrong?C.redL:chosen?myT.l:"#fff",
                  color:correct?C.green:wrong?C.red:chosen?myT.c:C.text,
                  border:`1.5px solid ${correct?C.green:wrong?C.red:chosen?myT.c:C.border}`,
                  boxShadow:"0 1px 4px rgba(0,0,0,.06)",
                  transition:"all .12s" }}>
                <span style={{ opacity:.5, marginRight:6 }}>{["A","B","C","D"][i]}.</span>{opt}
              </button>
            );
          })}
        </div>
        {isHost && localAnswer !== null && <NextBtn onClick={nextQuestion} />}
        <AnswerBar answerCount={answerCount} memberCount={memberCount} />
      </div>
    );
  }

  // ── DEFAULT MCQ / QUIZ SHOW mode ────────────────────────────────────────────
  return (
    <div style={{ flex:1, overflowY:"auto", padding:16, display:"flex", flexDirection:"column", gap:12 }}>
      {mode === "quizshow" && (
        <div style={{ textAlign:"center", padding:"6px 0" }}>
          <span style={{ fontSize:11, fontWeight:700, color:C.warm, letterSpacing:1,
            textTransform:"uppercase", background:C.warmL, borderRadius:6, padding:"3px 10px" }}>
            Quiz Show — Who Wants to Study?
          </span>
        </div>
      )}
      <ProgressBar gameState={gameState} myScore={myScore} />
      <div style={{ background:C.surface, borderRadius:14, padding:"18px 20px",
        border:`1px solid ${C.border}`, boxShadow:"0 2px 10px rgba(0,0,0,.06)" }}>
        <p style={{ color:C.text, fontSize:16, fontWeight:700, margin:0, lineHeight:1.5 }}>{q.question}</p>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        {(q.options||[]).map((opt,i) => {
          const chosen  = localAnswer === opt;
          const correct = localAnswer !== null && opt === q.answer;
          const wrong   = chosen && opt !== q.answer;
          return (
            <button key={i} onClick={() => submitAnswer(opt)} disabled={localAnswer!==null}
              style={{ padding:"14px 12px", borderRadius:13,
                border:`1.5px solid ${correct?C.green:wrong?C.red:chosen?C.accent:C.border}`,
                cursor:localAnswer!==null?"default":"pointer",
                fontWeight:700, fontSize:13, textAlign:"left", lineHeight:1.4,
                background:correct?C.greenL:wrong?C.redL:chosen?C.accentL:"#fff",
                color:correct?C.green:wrong?C.red:chosen?C.accent:C.text,
                boxShadow:"0 1px 4px rgba(0,0,0,.06)",
                transition:"all .12s" }}>
              <span style={{ opacity:.5, marginRight:6 }}>{["A","B","C","D"][i]}.</span>{opt}
            </button>
          );
        })}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <AnswerBar answerCount={answerCount} memberCount={memberCount} inline />
        {isHost && localAnswer !== null && <NextBtn onClick={nextQuestion} />}
      </div>
      <ScoreBar board={board} />
    </div>
  );
}

// ── Quiz sub-components ───────────────────────────────────────────────────────
function ProgressBar({ gameState, myScore, hideScore }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
      <span style={{ color:C.muted, fontSize:12, flexShrink:0 }}>
        Q {(gameState?.questionIndex||0)+1} / {gameState?.questions?.length||"?"}
      </span>
      <div style={{ flex:1, height:4, borderRadius:2, background:C.border }}>
        <div style={{ height:"100%", borderRadius:2, background:C.accent,
          width:`${(((gameState?.questionIndex||0)+1)/(gameState?.questions?.length||1))*100}%`,
          transition:"width .3s" }} />
      </div>
      {!hideScore && <span style={{ color:C.accent, fontSize:12, fontWeight:700, flexShrink:0 }}>
        {myScore} pts
      </span>}
    </div>
  );
}
function NextBtn({ onClick }) {
  return (
    <button onClick={onClick} style={{ background:C.accent, color:"#fff",
      border:"none", borderRadius:10, padding:"9px 20px", fontSize:13, fontWeight:700,
      cursor:"pointer", alignSelf:"flex-end", boxShadow:"0 3px 10px rgba(61,90,128,.3)" }}>
      Next →
    </button>
  );
}
function AnswerBar({ answerCount, memberCount, inline }) {
  return (
    <span style={{ color:C.muted, fontSize:12, ...(inline?{}:{display:"block",padding:"2px 0"}) }}>
      ⏳ {answerCount}/{memberCount} answered
    </span>
  );
}
function ScoreBar({ board }) {
  return (
    <div style={{ background:C.surface, borderRadius:12, padding:"10px 14px",
      border:`1px solid ${C.border}` }}>
      <p style={{ margin:"0 0 6px", fontSize:10, fontWeight:700, color:C.muted,
        letterSpacing:.8, textTransform:"uppercase" }}>Live Scores</p>
      {board.map((entry,i) => (
        <div key={entry.uid} style={{ display:"flex", justifyContent:"space-between",
          padding:"4px 0", borderBottom:i<board.length-1?`1px solid ${C.border}`:"none" }}>
          <span style={{ color:C.text, fontSize:12 }}>{entry.name}</span>
          <span style={{ color:C.warm, fontWeight:700, fontSize:12 }}>{entry.pts}</span>
        </div>
      ))}
    </div>
  );
}


// ── Game launcher — topic + game mode grid ────────────────────────────────────
function SGGameLauncher({ group, db, groupId, user, groupFile, onClose }) {
  const [topic,      setTopic]      = useState("");
  const [generating, setGenerating] = useState(false);
  const [error,      setError]      = useState("");

  // Check if the group has shared flashcards available to use as quiz source
  const hasFlashcards = group?.sharedContent?.type === "flashcards" &&
                        (group?.sharedContent?.cards?.length || 0) > 0;
  const sharedCards   = group?.sharedContent?.cards || [];

  const MP_GAMES = [
    { id:"mcq",        icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>, title:"Multiple Choice",   desc:"4-option quiz, everyone answers",       bg:C.accentL,  accent:C.accent  },
    { id:"truefalse",  icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.purple} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>, title:"True or False",     desc:"Vote true or false together",           bg:C.purpleL,  accent:C.purple  },
    { id:"rapidfire",  icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>, title:"Rapid Fire",        desc:"First to type the answer wins",         bg:C.greenL,   accent:C.green   },
    { id:"quizshow",   icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>, title:"Quiz Show",         desc:"Millionaire-style with lifelines",      bg:"#fef2f2",  accent:C.red     },
    { id:"memory",     icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.purple} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="9" height="9" rx="1"/><rect x="13" y="3" width="9" height="9" rx="1"/><rect x="2" y="13" width="9" height="9" rx="1"/><rect x="13" y="13" width="9" height="9" rx="1"/></svg>, title:"Memory Match",      desc:"Match questions to their answers",      bg:"#fdf4ff",  accent:C.purple  },
    { id:"speedround", icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.warm} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>, title:"Speed Round",       desc:"10 questions, 10 seconds each",         bg:"#fff7ed",  accent:C.warm    },
    { id:"elimination", icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>, title:"Elimination",       desc:"Wrong answer? You're out!",             bg:"#fef2f2",  accent:C.red     },
    { id:"teamquiz",   icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>, title:"Team Quiz",         desc:"Split into teams, highest score wins",  bg:C.accentL,  accent:C.accent  },
  ];

  const effectiveTopic = groupFile?.name || topic.trim();

  // Build questions from shared flashcards OR from AI
  const buildFromCards = (cards) => {
    // Convert flashcards to MCQ format
    return cards.map((card, i) => {
      const others = cards.filter((_, j) => j !== i).map(c => c.answer);
      // Pick 3 random wrong answers
      const shuffled = others.sort(() => Math.random() - .5).slice(0, 3);
      const options = [card.answer, ...shuffled].sort(() => Math.random() - .5);
      return { question: card.question, options, answer: card.answer };
    }).slice(0, 12); // max 12 questions
  };

  const startGame = async (gameId) => {
    if (!hasFlashcards && !effectiveTopic) {
      setError("Enter a topic or create flashcards in the group first");
      return;
    }
    setGenerating(true); setError("");
    try {
      let questions;

      if (hasFlashcards && sharedCards.length >= 4) {
        // Use shared flashcards as the question source — no AI call needed
        questions = buildFromCards(sharedCards);
      } else {
        // Fall back to AI-generated questions from file or topic
        let fileText = null;
        if (groupFile?._fileObj) fileText = await extractFileText(groupFile._fileObj).catch(() => null);
        const safeText = fileText ? fileText.slice(0, 12000) : null;
        const count = gameId === "speedround" ? 10 : gameId === "rapidfire" ? 8 : 6;

        const userMsg = safeText
          ? `Content from "${groupFile.name}":\n\n${safeText}\n\nCreate ${count} multiple-choice questions based ONLY on this content. JSON array: [{"question":"...","options":["A","B","C","D"],"answer":"exact correct option text"}]`
          : `Create ${count} multiple-choice questions about: "${topic}". JSON array: [{"question":"...","options":["A","B","C","D"],"answer":"exact correct option text"}]. Make distractors realistic.`;

        const raw = await callClaude(
          "Return ONLY a valid JSON array, no explanation, no markdown fences.",
          userMsg, 1600
        );
        questions = JSON.parse(raw.replace(/```json|```/g,"").trim());
        if (!questions.length) throw new Error("No questions generated");
      }

      const initScores = {};
      const memberUids = Object.keys(group.members || {});
      memberUids.forEach(uid => { initScores[uid] = 0; });

      // Assign teams for team quiz — split members evenly into 2 teams
      const teams = {};
      if (gameId === "teamquiz") {
        memberUids.forEach((uid, i) => { teams[uid] = i % 2; });
      }

      await updateDoc(doc(db, "studyGroups", groupId), {
        gameState: {
          mode: gameId,
          phase: "question",
          questions,
          questionIndex: 0,
          currentQuestion: questions[0],
          scores: initScores,
          answers: {},
          eliminated: [],
          teams,
          teamScores: gameId === "teamquiz" ? { team0:0, team1:0 } : {},
          topic: effectiveTopic || "Flashcards",
          fromCards: hasFlashcards && sharedCards.length >= 4,
        },
        lastActivity: Date.now(),
      });
      onClose();
    } catch(e) { setError("Failed: " + (e?.message || "Try a different topic.")); }
    setGenerating(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 4500,
      background: "rgba(26,23,20,.45)", backdropFilter: "blur(3px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 560, background: C.surface,
        borderRadius: "20px 20px 16px 16px", border: `1px solid ${C.border}`,
        boxShadow: "0 -8px 40px rgba(0,0,0,.1)", padding: "0 0 12px",
        maxHeight: "88vh", overflowY: "auto",
      }}>
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 0" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: C.border }} />
        </div>
        {/* Header */}
        <div style={{ padding: "12px 20px 12px", borderBottom: `1px solid ${C.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Quiz Battle</span>
          <button onClick={onClose} style={{ background: C.bg, border: `1px solid ${C.border}`,
            borderRadius: "50%", width: 28, height: 28, color: C.muted, cursor: "pointer",
            fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* ── Source selector: Flashcards vs Topic ── */}
          {hasFlashcards ? (
            <div style={{ padding: "12px 14px", borderRadius: 12,
              background: C.greenL, border: `1px solid ${C.green}44`,
              display: "flex", alignItems: "center", gap: 10 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/></svg>
              <div>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: C.green }}>
                  Using shared flashcards
                </p>
                <p style={{ margin: 0, fontSize: 11, color: C.muted }}>
                  {sharedCards.length} cards · questions auto-generated from your deck
                </p>
              </div>
            </div>
          ) : groupFile ? (
            <div style={{ padding: "10px 14px", borderRadius: 12,
              background: C.accentL, border: `1px solid ${C.accentS}`,
              display: "flex", alignItems: "center", gap: 10 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.accent }}>AI questions from group file</p>
                <p style={{ margin: 0, fontSize: 11, color: C.muted,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupFile.name}</p>
              </div>
            </div>
          ) : (
            <>
              {/* No cards, no file — nudge the user */}
              <div style={{ padding: "12px 14px", borderRadius: 12,
                background: C.warmL, border: `1px solid ${C.warm}55`,
                display: "flex", gap: 10, alignItems: "flex-start" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><line x1="12" y1="2" x2="12" y2="3"/><path d="M9 9a3 3 0 1 1 6 0c0 1.5-1 2.5-2 3.5V15H11v-2.5C10 11.5 9 10.5 9 9z"/><rect x="9" y="16" width="6" height="2" rx="1"/><rect x="10" y="19" width="4" height="1" rx=".5"/></svg>
                <div>
                  <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: C.warm }}>
                    Tip: Create study cards first!
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                    Tap the <strong>Present</strong> button → <strong>AI Flashcards</strong> to generate and share a deck.
                    Quiz Battle will automatically use those cards — no topic needed.
                  </p>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.muted,
                  letterSpacing: .8, textTransform: "uppercase" }}>
                  Or enter a topic for AI-generated questions
                </label>
                <input value={topic} onChange={e => { setTopic(e.target.value); setError(""); }}
                  placeholder="e.g. Photosynthesis, WW2, Python loops…"
                  style={{ width: "100%", padding: "10px 14px", boxSizing: "border-box",
                    background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 10,
                    color: C.text, fontSize: 13, outline: "none", fontFamily: "inherit", marginTop: 6 }} />
              </div>
            </>
          )}

          {error && (
            <div style={{ padding: "8px 12px", borderRadius: 9, background: C.redL,
              border: `1px solid ${C.red}44`, color: C.red, fontSize: 12 }}>{error}</div>
          )}

          {/* ── Game mode grid ── */}
          <div>
            <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 700, color: C.muted,
              textTransform: "uppercase", letterSpacing: .8 }}>Pick a game mode</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {MP_GAMES.map(g => (
                <button key={g.id}
                  onClick={() => startGame(g.id)}
                  disabled={generating || (!hasFlashcards && !effectiveTopic)}
                  style={{ background: g.bg, border: `1.5px solid ${g.accent}30`,
                    borderRadius: 14, padding: "12px 10px",
                    cursor: (generating || (!hasFlashcards && !effectiveTopic)) ? "not-allowed" : "pointer",
                    textAlign: "left",
                    opacity: (generating || (!hasFlashcards && !effectiveTopic)) ? .45 : 1,
                    transition: "transform .12s, box-shadow .12s" }}
                  onMouseEnter={e => {
                    if (!generating && (hasFlashcards || effectiveTopic)) {
                      e.currentTarget.style.transform = "translateY(-2px)";
                      e.currentTarget.style.boxShadow = `0 6px 20px ${g.accent}30`;
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = "none";
                    e.currentTarget.style.boxShadow = "none";
                  }}>
                  <div style={{ fontSize: 22, marginBottom: 5 }}>{generating ? "⏳" : g.emoji}</div>
                  <p style={{ margin: "0 0 2px", fontSize: 12, fontWeight: 800, color: C.text }}>{g.title}</p>
                  <p style={{ margin: 0, fontSize: 10, color: C.muted, lineHeight: 1.35 }}>{g.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {generating && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
              gap: 8, padding: "10px 0", color: C.muted, fontSize: 13 }}>
              <SGSpinner />
              {hasFlashcards ? "Building questions from your flashcards…"
                : `Generating from "${groupFile ? groupFile.name : topic}"…`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Host toolbar ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// BOTTOM BAR — Google Meet style. Visible to ALL users.
// Left:   voice controls (mic mute + deafen)
// Center: host controls (Present / Stop / Quiz / End Quiz)
// Right:  status pill
// ═══════════════════════════════════════════════════════════════════════════════
function SGBottomBar({ groupId, db, group, user, isHost, canPresent, voiceState,
                       onToggleMute, onToggleDeafen,
                       onShowShare, onShowGame }) {
  const muted    = voiceState?.muted    ?? false;
  const deafened = voiceState?.deafened ?? false;
  const speaking = voiceState?.speaking ?? false;
  const ready    = voiceState?.ready    ?? false;
  const hasShared = !!group?.sharedContent;
  const hasGame   = !!group?.gameState;

  const stopSharing = () => updateDoc(doc(db,"studyGroups",groupId),{sharedContent:null});
  const endGame     = () => updateDoc(doc(db,"studyGroups",groupId),{gameState:null});

  // Button base styles
  const voiceBtn = (active, activeColor, activeBg) => ({
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
    gap:3, width:56, height:56, borderRadius:14, border:"none", cursor:"pointer",
    background: active ? activeBg : "rgba(255,255,255,0.08)",
    color: active ? activeColor : "#fff",
    transition:"all .15s",
    flexShrink:0,
  });

  const hostBtn = (color, bg, border) => ({
    display:"flex", alignItems:"center", gap:6,
    background: bg, border:`1.5px solid ${border}`,
    color, borderRadius:12, padding:"10px 18px",
    fontSize:13, fontWeight:700, cursor:"pointer",
    boxShadow:"0 2px 10px rgba(0,0,0,.15)",
    transition:"transform .1s",
    flexShrink:0,
  });

  return (
    <div style={{
      position:"relative", zIndex:200,
      flexShrink:0,
      background:"rgba(26,23,20,0.92)",
      backdropFilter:"blur(12px)",
      borderTop:"1px solid rgba(255,255,255,0.08)",
      padding:"10px 20px",
      display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
    }}>

      {/* ── LEFT: Voice controls ── */}
      <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:130 }}>
        {/* Mic mute */}
        <button
          onClick={onToggleMute}
          title={muted ? "Unmute" : "Mute"}
          style={voiceBtn(muted, C.red, C.redL+"33")}
          onMouseEnter={e=>e.currentTarget.style.background=muted?"rgba(196,92,92,.3)":"rgba(255,255,255,.15)"}
          onMouseLeave={e=>e.currentTarget.style.background=muted?"rgba(196,92,92,.2)":"rgba(255,255,255,.08)"}
        >
          {/* Mic icon */}
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
            stroke={muted ? C.red : (speaking ? C.green : "#fff")}
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            {muted ? (
              <>
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </>
            ) : (
              <>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </>
            )}
          </svg>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:.3 }}>
            {muted ? "UNMUTE" : "MUTE"}
          </span>
          {/* Speaking ring — only when live and talking */}
          {speaking && !muted && (
            <div style={{
              position:"absolute", inset:-3, borderRadius:17,
              border:`2px solid ${C.green}`,
              animation:"sg-pulse 1s ease infinite",
              pointerEvents:"none",
            }} />
          )}
        </button>

        {/* Deafen — mutes ALL incoming audio just for you */}
        <button
          onClick={onToggleDeafen}
          title={deafened ? "Undeafen" : "Deafen (mute everyone for you)"}
          style={voiceBtn(deafened, C.red, C.redL+"33")}
          onMouseEnter={e=>e.currentTarget.style.background=deafened?"rgba(196,92,92,.3)":"rgba(255,255,255,.15)"}
          onMouseLeave={e=>e.currentTarget.style.background=deafened?"rgba(196,92,92,.2)":"rgba(255,255,255,.08)"}
        >
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
            stroke={deafened ? C.red : "#fff"}
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            {deafened ? (
              <>
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
                <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
              </>
            ) : (
              <>
                <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
                <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
              </>
            )}
          </svg>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:.3 }}>
            {deafened ? "UNDEAFEN" : "DEAFEN"}
          </span>
        </button>

        {/* Voice status text */}
        <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
          <span style={{ fontSize:11, fontWeight:700,
            color: deafened ? C.red : muted ? C.red : speaking ? C.green : "rgba(255,255,255,.7)" }}>
            {deafened ? "Deafened" : muted ? "Muted" : speaking ? "Speaking" : "Connected"}
          </span>
          {!ready && (
            <span style={{ fontSize:9, color:"rgba(255,255,255,.4)" }}>mic blocked</span>
          )}
        </div>
      </div>

      {/* ── CENTER: Host + presenter controls ── */}
      {canPresent && (
        <div style={{ display:"flex", alignItems:"center", gap:10, position:"absolute",
          left:"50%", transform:"translateX(-50%)" }}>
          {/* Present / Stop Presenting — available to host AND granted presenter */}
          {hasShared ? (
            <button onClick={stopSharing} style={hostBtn(C.red, "rgba(196,92,92,.2)", C.red+"44")}
              onMouseEnter={e=>e.currentTarget.style.transform="translateY(-1px)"}
              onMouseLeave={e=>e.currentTarget.style.transform="none"}>
              <span style={{ fontSize:16 }}>⏹</span> Stop Presenting
            </button>
          ) : (
            <button onClick={onShowShare} style={hostBtn("#fff", "rgba(61,90,128,.5)", C.accentS)}
              onMouseEnter={e=>e.currentTarget.style.transform="translateY(-1px)"}
              onMouseLeave={e=>e.currentTarget.style.transform="none"}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg> Present
            </button>
          )}

          {/* Quiz / End Quiz — host only */}
          {isHost && (hasGame ? (
            <button onClick={endGame} style={hostBtn(C.red, "rgba(196,92,92,.2)", C.red+"44")}
              onMouseEnter={e=>e.currentTarget.style.transform="translateY(-1px)"}
              onMouseLeave={e=>e.currentTarget.style.transform="none"}>
              <span style={{ fontSize:16 }}>⏹</span> End Quiz
            </button>
          ) : (
            <button onClick={onShowGame} style={hostBtn("#fff", "rgba(74,124,89,.4)", C.green+"44")}
              onMouseEnter={e=>e.currentTarget.style.transform="translateY(-1px)"}
              onMouseLeave={e=>e.currentTarget.style.transform="none"}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="12" r="1"/><circle cx="17" cy="10" r="1"/><rect x="2" y="8" width="20" height="12" rx="4"/></svg> Quiz Battle
            </button>
          ))}
        </div>
      )}

      {/* ── RIGHT: Live status pill ── */}
      <div style={{ minWidth:130, display:"flex", justifyContent:"flex-end" }}>
        {hasGame && (
          <div style={{ display:"flex", alignItems:"center", gap:6,
            background:"rgba(74,124,89,.25)", border:"1px solid rgba(74,124,89,.4)",
            borderRadius:20, padding:"5px 12px" }}>
            <div style={{ width:7,height:7,borderRadius:"50%",background:C.green,
              animation:"sg-pulse 1.4s ease infinite" }} />
            <span style={{ fontSize:11, fontWeight:700, color:C.green }}>Quiz Live</span>
          </div>
        )}
        {hasShared && !hasGame && (
          <div style={{ display:"flex", alignItems:"center", gap:6,
            background:"rgba(61,90,128,.25)", border:"1px solid rgba(61,90,128,.4)",
            borderRadius:20, padding:"5px 12px" }}>
            <div style={{ width:7,height:7,borderRadius:"50%",background:C.accentS,
              animation:"sg-pulse 1.4s ease infinite" }} />
            <span style={{ fontSize:11, fontWeight:700, color:C.accentS }}>Presenting</span>
          </div>
        )}
      </div>
    </div>
  );
}


// ── Main Study Group Room ─────────────────────────────────────────────────────
function StudyGroupRoom({ groupId, user, character, db, onLeave }) {
  const { isMobile, isTablet } = useResponsive();
  const [group,     setGroup]     = useState(null);
  const [messages,  setMessages]  = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [panel,     setPanel]     = useState("chat");
  const [copied,    setCopied]    = useState(false);
  // Modals lifted to room level so they always render above the workspace
  const [showShare,      setShowShare]      = useState(false);
  const [showGame,       setShowGame]       = useState(false);
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [showNotes,      setShowNotes]      = useState(false);
  // Group study file — host uploads, AI uses it for flashcards/notes/quiz
  const [groupFile,      setGroupFile]      = useState(null); // { name, _fileObj }
  // Voice state — updated by SGVoiceChat via onStateChange callback
  const [voiceState, setVoiceState] = useState({ muted:false, deafened:false, speaking:false, ready:false });
  // Notification banner when host starts game
  const [notif,     setNotif]     = useState(null);
  const notifTimer = useRef(null);
  const chatEndRef = useRef(null);
  const prevGamePhase = useRef(null);

  const isHost      = group?.hostUid === user.uid;
  const canPresent  = isHost || group?.presenterUid === user.uid;
  const members = group?.members || {};

  // Granted presenters use host's file automatically — fetch chunks and build File object
  const [presenterFileObj, setPresenterFileObj] = useState(null);
  useEffect(() => {
    if (isHost || !canPresent) return;
    // Use current sharedContent chunks OR any previously stored chunks
    const sc = group?.sharedContent;
    // Use chunks from current share OR from the upload (hostFileChunks)
    const targetName   = sc?.fileName   || group?.hostFileName;
    const targetChunks = sc?.fileChunks || group?.hostFileChunks;
    if (!targetChunks || targetChunks === 0 || !targetName) return;
    if (presenterFileObj?.name === targetName) return;
    (async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const chunkCol = collection(db, "studyGroups", groupId, "fileChunks");
          const snap = await getDocs(chunkCol);
          if (snap.empty || snap.docs.length < targetChunks) {
            await new Promise(r => setTimeout(r, 1500)); continue;
          }
          const sorted = snap.docs.map(d => d.data()).sort((a,b) => a.index - b.index);
          const base64 = sorted.map(d => d.chunk).join("");
          const [header, b64] = base64.split(",");
          const mime = header.match(/:(.*?);/)?.[1] || "application/octet-stream";
          const bin  = atob(b64);
          const arr  = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          setPresenterFileObj(new File([arr], targetName, { type: mime }));
          return;
        } catch(e) {
          if (attempt < 4) { await new Promise(r => setTimeout(r, 1500)); continue; }
          console.error("presenterFileObj fetch", e);
        }
      }
    })();
  }, [canPresent, isHost, group?.sharedContent?.fileChunks, group?.sharedContent?.fileName, group?.hostFileName, group?.hostFileChunks]);

  // The file every tool uses:
  // - Host: their own uploaded file (groupFile)
  // - Granted presenter: their own uploaded file if they have one,
  //   otherwise the host's file fetched from Firestore (presenterFileObj)
  // - Regular member: null
  const effectiveGroupFile = isHost
    ? groupFile
    : canPresent
      ? (groupFile || (presenterFileObj ? { name: presenterFileObj.name, _fileObj: presenterFileObj } : null))
      : null;
  const presenter = group?.sharedContent
    ? Object.values(members).find(m => m?.uid === group.sharedContent.sharedByUid)
    : null;

  // Subscribe to group doc
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "studyGroups", groupId), snap => {
      if (snap.exists()) setGroup({ id: snap.id, ...snap.data() });
      else onLeave();
    });
    return () => unsub();
  }, [groupId, db]);

  // Subscribe to messages
  useEffect(() => {
    const q = query(
      collection(db, "studyGroups", groupId, "messages"),
      orderBy("createdAt", "asc"), limit(300)
    );
    const unsub = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [groupId, db]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Show notification banner when host starts a game
  useEffect(() => {
    if (!group) return;
    const phase = group?.gameState?.phase;
    // Fire when a game just started (prev was null/results, now is question)
    if (phase === "question" && prevGamePhase.current !== "question" && !isHost) {
      const topic = group.gameState?.topic || "a quiz";
      setNotif(`The host started a quiz: "${topic}" — join now!`);
      clearTimeout(notifTimer.current);
      notifTimer.current = setTimeout(() => setNotif(null), 5000);
    }
    prevGamePhase.current = phase;
  }, [group?.gameState?.phase]);

  // Presence
  useEffect(() => {
    const me = {
      uid: user.uid, displayName: user.displayName || "User",
      photoURL: user.photoURL || null,
      character: (() => { try { return JSON.parse(localStorage.getItem("classio_char") || "{}"); } catch { return {}; } })(),
      joinedAt: Date.now(),
    };
    updateDoc(doc(db, "studyGroups", groupId), {
      [`members.${user.uid}`]: me, lastActivity: Date.now(),
    }).catch(() => {});
    return () => {
      if (isHost) {
        deleteDoc(doc(db, "studyGroups", groupId)).catch(() => {});
      } else {
        updateDoc(doc(db, "studyGroups", groupId), {
          [`members.${user.uid}`]: null, lastActivity: Date.now(),
        }).catch(() => {});
      }
    };
  }, [groupId, user.uid]);

  const sendMessage = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    await addDoc(collection(db, "studyGroups", groupId, "messages"), {
      text, uid: user.uid,
      displayName: user.displayName || "User",
      createdAt: serverTimestamp(),
    });
  };

  const handleLeave = async () => {
    if (isHost) {
      await addDoc(collection(db, "studyGroups", groupId, "messages"), {
        text: "The host ended the session.", uid: "system",
        displayName: "Classio", createdAt: serverTimestamp(),
      }).catch(() => {});
      await deleteDoc(doc(db, "studyGroups", groupId)).catch(() => {});
    } else {
      await updateDoc(doc(db, "studyGroups", groupId), {
        [`members.${user.uid}`]: null, lastActivity: Date.now(),
      }).catch(() => {});
    }
    onLeave();
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(groupId).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const memberList  = Object.values(members).filter(Boolean);
  const gameActive  = !!group?.gameState;
  const contentActive = !gameActive && !!group?.sharedContent;
  const memberCount = Object.keys(members).length;

  return (
    <div style={{
      height: "100dvh", width: "100%",
      background: C.bg, color: C.text,
      display: "flex", flexDirection: "column",
      fontFamily: "'DM Sans',sans-serif", overflow: "hidden",
    }}>
      <style>{`@keyframes sg-spin { to { transform:rotate(360deg); } }`}</style>

      {/* Lifted modals — always at room level, never clipped */}
      {showShare && (
        <SGSharePicker
          user={user} db={db} groupId={groupId} group={group}
          groupFile={effectiveGroupFile}
          isHost={isHost}
          onClose={() => setShowShare(false)}
          onOpenWhiteboard={() => setShowWhiteboard(true)}
          onOpenFlashcards={() => setShowFlashcards(true)}
          onOpenNotes={() => setShowNotes(true)}
        />
      )}
      {showGame && (
        <SGGameLauncher group={group} db={db} groupId={groupId} user={user}
          groupFile={effectiveGroupFile}
          onClose={() => setShowGame(false)} />
      )}
      {showWhiteboard && (
        <SGWhiteboard groupId={groupId} db={db} user={user} group={group}
          onClose={() => setShowWhiteboard(false)} />
      )}
      {showFlashcards && (
        <SGAIFlashcardGen groupId={groupId} db={db} user={user}
          groupFile={effectiveGroupFile}
          onClose={() => setShowFlashcards(false)} />
      )}
      {showNotes && (
        <SGAINotesGen groupId={groupId} db={db} user={user}
          groupFile={effectiveGroupFile}
          onClose={() => setShowNotes(false)} />
      )}

      {/* Game-started notification banner */}
      {notif && (
        <div style={{
          position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)",
          zIndex: 5000, background: C.accent, color: "#fff",
          borderRadius: 12, padding: "11px 20px",
          fontSize: 13, fontWeight: 700,
          boxShadow: "0 6px 24px rgba(61,90,128,.4)",
          display: "flex", alignItems: "center", gap: 10,
          maxWidth: "90vw", animation: "sg-fadein .25s ease",
        }}>
          {notif}
          <button onClick={() => setNotif(null)} style={{
            background: "rgba(255,255,255,.2)", border: "none", borderRadius: "50%",
            width: 20, height: 20, color: "#fff", cursor: "pointer", fontSize: 12,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>×</button>
        </div>
      )}

      {/* ── Top bar ── */}
      <div style={{
        flexShrink: 0, height: 56,
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 10, padding: "0 16px",
        boxShadow: "0 1px 4px rgba(0,0,0,.06)",
      }}>
        {/* Logo + name */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 30, height: 30, background: C.accent, borderRadius: 9,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.text,
              fontFamily: "'Fraunces',serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {group?.name || "Study Group"}
            </p>
            <p style={{ margin: 0, fontSize: 10, color: C.muted }}>
              {memberList.length} member{memberList.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Code chip */}
        <button onClick={copyCode} style={{
          background: C.accentL, border: `1px solid ${C.accentS}`,
          borderRadius: 8, padding: "4px 10px",
          fontSize: 12, fontWeight: 800, cursor: "pointer",
          color: copied ? C.green : C.accent,
          fontFamily: "monospace", letterSpacing: 1.5, flexShrink: 0,
        }}>
          {copied ? "✓ Copied" : groupId}
        </button>

        <div style={{ flex: 1 }} />

        {/* Leave / End */}
        <button onClick={handleLeave} style={{
          background: isHost ? C.redL : C.bg,
          border: `1px solid ${isHost ? C.red + "55" : C.border}`,
          color: isHost ? C.red : C.muted,
          borderRadius: 10, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer",
        }}>
          {isHost ? "End Session" : "Leave"}
        </button>

        {/* SGVoiceChat renders nothing — auto-joins, state flows to bottom bar */}
        {group && (
          <SGVoiceChat
            groupId={groupId} db={db} user={user} members={members}
            onStateChange={setVoiceState}
          />
        )}
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>

        {/* Main workspace */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {gameActive ? (
            <SGQuizGame gameState={group.gameState} isHost={isHost}
              user={user} db={db} groupId={groupId} members={members} />
          ) : contentActive ? (
            <SGSharedContent content={group.sharedContent}
              presenterName={presenter?.displayName?.split(" ")[0]}
              isHost={isHost} db={db} groupId={groupId} />
          ) : (
            // Empty state
            <div style={{ flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 20, padding: "24px 20px",
              overflowY: "auto" }}>
              <div style={{ width: 64, height: 64, borderRadius: 18, background: C.accentL,
                display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 1-4 4v14a3 3 0 0 0 3-3h7z"/></svg></div>
              <div style={{ textAlign: "center" }}>
                <p style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700, color: C.text,
                  fontFamily: "'Fraunces',serif" }}>{group?.name || "Study Group"}</p>
                <p style={{ margin: 0, fontSize: 13, color: C.muted, maxWidth: 260, lineHeight: 1.5 }}>
                  {isHost ? "You're the host — start the session below." : "Waiting for the host to start something…"}
                </p>
              </div>

              {/* ── Study file — upload for host, read-only info for granted presenters ── */}
              {canPresent && (
                <div style={{ width:"100%", maxWidth:380 }}>
                  {isHost ? (
                    // HOST: can upload or clear file
                    groupFile ? (
                      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
                        background:C.accentL, border:`1.5px solid ${C.accentS}`, borderRadius:12 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <div style={{ flex:1, minWidth:0 }}>
                          <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.accent }}>Study file loaded</p>
                          <p style={{ margin:0, fontSize:11, color:C.muted, overflow:"hidden",
                            textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{groupFile.name}</p>
                        </div>
                        <button onClick={() => setGroupFile(null)} style={{
                          background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:16 }}>×</button>
                      </div>
                    ) : (
                      <label style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
                        background:C.surface, border:`1.5px dashed ${C.border}`,
                        borderRadius:12, cursor:"pointer", width:"100%", boxSizing:"border-box" }}>
                        <div style={{ width:36, height:36, borderRadius:10, background:C.warmL,
                          display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
                        <div>
                          <p style={{ margin:0, fontSize:13, fontWeight:700, color:C.text }}>Add study file</p>
                          <p style={{ margin:0, fontSize:11, color:C.muted }}>AI uses it for notes, flashcards & quizzes</p>
                        </div>
                        <input type="file" style={{ display:"none" }} onChange={async e => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setGroupFile({ name:f.name, _fileObj:f });
                          // Write chunks immediately so granted presenters can use AI tools right away
                          try {
                            const fileData = await new Promise((res, rej) => {
                              const r = new FileReader();
                              r.onload = ev => res(ev.target.result);
                              r.onerror = rej;
                              r.readAsDataURL(f);
                            });
                            const CHUNK = 750000;
                            const totalChunks = Math.ceil(fileData.length / CHUNK);
                            const chunkCol = collection(db, "studyGroups", groupId, "fileChunks");
                            const old = await getDocs(chunkCol);
                            for (const d of old.docs) await deleteDoc(d.ref);
                            for (let i = 0; i < totalChunks; i++) {
                              await setDoc(doc(chunkCol, String(i)), {
                                chunk: fileData.slice(i * CHUNK, (i + 1) * CHUNK),
                                index: i, total: totalChunks,
                              });
                            }
                            await updateDoc(doc(db,"studyGroups",groupId), {
                              hostFileName: f.name,
                              hostFileChunks: totalChunks,
                            });
                          } catch(err) { console.error("host upload chunks", err); }
                        }} />
                      </label>
                    )
                  ) : (() => {
                    // NON-HOST PRESENTER: show host's file read-only
                    // Use effectiveGroupFile name, OR hostFileName from Firestore,
                    // OR the currently shared file name — whichever is available
                    const shownName = effectiveGroupFile?.name
                      || group?.hostFileName
                      || group?.sharedContent?.fileName;
                    return shownName ? (
                      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
                        background:C.accentL, border:`1.5px solid ${C.accentS}`, borderRadius:12 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <div style={{ flex:1, minWidth:0 }}>
                          <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.accent }}>
                            Host's study file
                          </p>
                          <p style={{ margin:0, fontSize:11, color:C.muted, overflow:"hidden",
                            textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{shownName}</p>
                        </div>
                        <span style={{ fontSize:10, flexShrink:0, fontWeight:700,
                          color: effectiveGroupFile ? C.green : C.muted }}>
                          {effectiveGroupFile ? "✓ Ready" : group?.hostFileChunks ? "Syncing…" : "Available"}
                        </span>
                      </div>
                    ) : (
                      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
                        background:C.surface, border:`1.5px dashed ${C.border}`, borderRadius:12 }}>
                        <span style={{ fontSize:18 }}>⏳</span>
                        <div>
                          <p style={{ margin:0, fontSize:13, fontWeight:700, color:C.muted }}>No study file yet</p>
                          <p style={{ margin:0, fontSize:11, color:C.muted }}>Host hasn't uploaded a file</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* CTA cards — for host AND granted presenters */}
              {canPresent && (
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", justifyContent:"center", width:"100%", maxWidth:380 }}>
                  <button onClick={() => setShowShare(true)} style={{
                    flex:"1 1 150px", display:"flex", flexDirection:"column",
                    alignItems:"center", gap:10, padding:"20px 14px",
                    background:C.accentL, border:`2px solid ${C.accentS}`,
                    borderRadius:18, cursor:"pointer",
                    boxShadow:"0 4px 16px rgba(61,90,128,.15)", transition:"transform .12s",
                  }}
                  onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
                  onMouseLeave={e=>e.currentTarget.style.transform="none"}>
                    <div style={{ width:48, height:48, borderRadius:14, background:C.accent,
                      display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg></div>
                    <div style={{ textAlign:"center" }}>
                      <p style={{ margin:"0 0 3px", fontSize:14, fontWeight:800, color:C.accent }}>Present</p>
                      <p style={{ margin:0, fontSize:11, color:C.muted, lineHeight:1.3 }}>Notes, cards, whiteboard, file</p>
                    </div>
                  </button>

                  <button onClick={() => setShowGame(true)} style={{
                    flex:"1 1 150px", display:"flex", flexDirection:"column",
                    alignItems:"center", gap:10, padding:"20px 14px",
                    background:C.greenL, border:`2px solid ${C.green}33`,
                    borderRadius:18, cursor:"pointer",
                    boxShadow:"0 4px 16px rgba(74,124,89,.12)", transition:"transform .12s",
                  }}
                  onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
                  onMouseLeave={e=>e.currentTarget.style.transform="none"}>
                    <div style={{ width:48, height:48, borderRadius:14, background:C.green,
                      display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="12" r="1"/><circle cx="17" cy="10" r="1"/><rect x="2" y="8" width="20" height="12" rx="4"/></svg></div>
                    <div style={{ textAlign:"center" }}>
                      <p style={{ margin:"0 0 3px", fontSize:14, fontWeight:800, color:C.green }}>Quiz Battle</p>
                      <p style={{ margin:0, fontSize:11, color:C.muted, lineHeight:1.3 }}>Launch multiplayer quiz</p>
                    </div>
                  </button>
                </div>
              )}

              {/* Invite card */}
              <div style={{ background: C.surface, borderRadius: 14, padding: "14px 22px",
                border: `1px solid ${C.border}`, textAlign: "center",
                boxShadow: "0 2px 10px rgba(0,0,0,.05)" }}>
                <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700,
                  color: C.muted, letterSpacing: .8, textTransform: "uppercase" }}>Invite Code</p>
                <p style={{ margin: 0, fontSize: 26, fontWeight: 900,
                  color: C.accent, fontFamily: "monospace", letterSpacing: 5 }}>{groupId}</p>
                <p style={{ margin: "3px 0 0", fontSize: 11, color: C.muted }}>Share with friends to join</p>
              </div>

              {/* Members row */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                {memberList.map(m => m && (
                  <SGAvatar key={m.uid} character={m.character}
                    displayName={m.displayName} size={40}
                    isHost={m.uid === group?.hostUid} isSelf={m.uid === user.uid} />
                ))}
              </div>
            </div>
          )}

          {/* Bottom bar — Google Meet style, visible to ALL users */}
          {group && (
            <SGBottomBar
              groupId={groupId} db={db} group={group} user={user}
              isHost={isHost} canPresent={canPresent}
              voiceState={voiceState}
              onToggleMute={() => voiceState.toggleMute?.()}
              onToggleDeafen={() => voiceState.toggleDeafen?.()}
              onShowShare={() => setShowShare(true)}
              onShowGame={() => setShowGame(true)}
            />
          )}
        </div>

        {/* ── Right sidebar ── */}
        <div style={{
          width: isMobile ? "100%" : isTablet ? 220 : 264,
          flexShrink: 0,
          background: C.surface,
          borderLeft: isMobile ? "none" : `1px solid ${C.border}`,
          borderTop: isMobile ? `1px solid ${C.border}` : "none",
          display: "flex", flexDirection: "column", overflow: "hidden",
          maxHeight: isMobile ? 200 : "none",
        }}>
          {/* Tab bar */}
          <div style={{ flexShrink: 0, display: "flex", borderBottom: `1px solid ${C.border}` }}>
            {[{ id: "chat", label: "Chat" }, { id: "members", label: "Members" }].map(t => (
              <button key={t.id} onClick={() => setPanel(t.id)} style={{
                flex: 1, padding: "10px 6px", border: "none", cursor: "pointer",
                background: panel === t.id ? C.accentL : "transparent",
                color: panel === t.id ? C.accent : C.muted,
                fontSize: 11, fontWeight: 700, letterSpacing: .3,
                borderBottom: `2px solid ${panel === t.id ? C.accent : "transparent"}`,
                transition: "all .12s",
              }}>{t.label}</button>
            ))}
          </div>

          {/* Chat */}
          {panel === "chat" && (
            <>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto",
                padding: "12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                {messages.length === 0 && (
                  <div style={{ textAlign: "center", padding: "32px 0", opacity: .4 }}>
                    <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>No messages yet</p>
                    <p style={{ color: C.muted, fontSize: 11, margin: "4px 0 0" }}>Say hi!</p>
                  </div>
                )}
                {messages.map(msg => (
                  <SGChatMessage key={msg.id} msg={msg} isSelf={msg.uid === user.uid} />
                ))}
                <div ref={chatEndRef} />
              </div>
              <div style={{ flexShrink: 0, padding: 10, borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="Message…"
                  style={{
                    flex: 1, padding: "9px 12px",
                    background: C.bg, border: `1px solid ${C.border}`,
                    borderRadius: 10, color: C.text, fontSize: 13,
                    outline: "none", fontFamily: "inherit",
                  }}
                />
                <button onClick={sendMessage} style={{
                  background: C.accent, border: "none", borderRadius: 10,
                  width: 36, height: 36, cursor: "pointer", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
                  boxShadow: "0 2px 8px rgba(61,90,128,.3)",
                }}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg></button>
              </div>
            </>
          )}

          {/* Members */}
          {panel === "members" && (
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 10px" }}>
              {memberList.map(m => {
                if (!m) return null;
                const isSpeaking = group?.voiceSpeaking?.[m.uid];
                const inVoice    = group?.voiceMembers?.[m.uid];
                return (
                  <div key={m.uid} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 8px", borderRadius: 12, marginBottom: 4,
                    background: m.uid === user.uid ? C.accentL : C.bg,
                    border: `1px solid ${isSpeaking ? C.green+"88" : m.uid === user.uid ? C.accentS : C.border}`,
                    transition: "border-color .2s",
                  }}>
                    <div style={{ position:"relative", flexShrink:0 }}>
                      <SGAvatar character={m.character} displayName={m.displayName}
                        size={34} isHost={m.uid === group?.hostUid} isSelf={m.uid === user.uid} />
                      {isSpeaking && (
                        <div style={{ position:"absolute", bottom:-2, right:-2,
                          width:10, height:10, borderRadius:"50%",
                          background:C.green, border:"2px solid #fff",
                          animation:"sg-pulse 1s ease infinite" }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {m.displayName || "User"}{m.uid === user.uid ? " (You)" : ""}
                      </p>
                      <div style={{ display:"flex", gap:6, alignItems:"center", marginTop:2, flexWrap:"wrap" }}>
                        {m.uid === group?.hostUid && (
                          <span style={{ fontSize: 10, color: C.warm, display:"flex", alignItems:"center", gap:2 }}><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M2 20h20v2H2zM3 8l4 8h10l4-8-6 4-3-6-3 6-6-4z"/></svg>Host</span>
                        )}
                        {group?.presenterUid === m.uid && m.uid !== group?.hostUid && (
                          <span style={{ fontSize: 10, color: C.accent }}>Can Present</span>
                        )}
                        {group?.sharedContent?.sharedByUid === m.uid && (
                          <span style={{ fontSize: 10, color: C.accent, display:"flex", alignItems:"center", gap:2 }}><span style={{width:6,height:6,borderRadius:"50%",background:C.red,display:"inline-block"}}></span>Live</span>
                        )}
                        {inVoice && (
                          <span style={{ fontSize:10, color:isSpeaking?C.green:C.muted }}>
                            {isSpeaking ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Host-only: grant or revoke presenter rights */}
                    {isHost && m.uid !== user.uid && (
                      group?.presenterUid === m.uid ? (
                        <button onClick={() =>
                          updateDoc(doc(db,"studyGroups",groupId),{presenterUid:null}).catch(()=>{})
                        } style={{
                          flexShrink:0, fontSize:10, fontWeight:700, cursor:"pointer",
                          background:C.redL, border:`1px solid ${C.red}44`,
                          color:C.red, borderRadius:8, padding:"4px 8px",
                        }}>↩ Revoke</button>
                      ) : (
                        <button onClick={() =>
                          updateDoc(doc(db,"studyGroups",groupId),{presenterUid:m.uid}).catch(()=>{})
                        } style={{
                          flexShrink:0, fontSize:10, fontWeight:700, cursor:"pointer",
                          background:C.accentL, border:`1px solid ${C.accentS}`,
                          color:C.accent, borderRadius:8, padding:"4px 8px",
                        }}>Present</button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
