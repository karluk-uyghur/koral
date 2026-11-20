/**
 * قارلۇق ئۆگىنىش ياردەمچىسى — Popup Script (Manifest V3)
 * 100% يەرلىك ساقلاش، نۆل ئىز قوغلاش، XSS دىن خالىي بىخەتەر DOM باشقۇرۇش.
 */
'use strict';

(function () {
  const STORAGE_KEYS = {
    BOOKS: 'karluk_books',
    ACTIVE_BOOK_ID: 'karluk_active_book_id',
    SETTINGS: 'karluk_settings'
  };

  function clampBrightness(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 100;
    return Math.max(50, Math.min(130, Math.round(num)));
  }

  const state = {
    books: [],
    activeBookId: null,
    settings: {
      reminderEnabled: true,
      theme: 'light',
      brightness: 100
    },
    answerVisible: false,
    deleteConfirmId: null,
    pdfPages: [],
    currentPrintBook: null,
    printMode: 'study'
  };

  const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        if (hasChromeStorage) {
          chrome.storage.local.get(keys, (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(result || {});
          });
        } else {
          const out = {};
          keys.forEach((k) => {
            const raw = window.localStorage.getItem(k);
            if (raw !== null) {
              out[k] = JSON.parse(raw);
            }
          });
          resolve(out);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  function storageSet(payload) {
    return new Promise((resolve, reject) => {
      try {
        if (hasChromeStorage) {
          chrome.storage.local.set(payload, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve();
          });
        } else {
          Object.keys(payload).forEach((k) => {
            window.localStorage.setItem(k, JSON.stringify(payload[k]));
          });
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  function getDefaultStarterBook() {
    return {
      id: 'book_starter_east_turkestan_history',
      title: 'شەرقىي تۈركىستان مەدەنىيىتى ۋە بىلىم تارىخى (ئۈلگە)',
      createdAt: new Date().toISOString(),
      currentIndex: 0,
      masteredIds: [],
      items: [
        {
          id: 1,
          category: 'مەدەنىيەت تارىخى',
          question: 'قاراخانىيلار دەۋرىدە شەرقىي تۈركىستاندا بارلىققا كەلگەن ئىككى بۈيۈك ئەسەر قايسىلار ۋە ئۇلارنىڭ ئەھمىيىتى نېمە؟',
          answer: 'يۈسۈپ خاس ھاجىپنىڭ «قۇتادغۇ بىلىك» ئەسىرى ۋە مەھمۇد قەشقىرىنىڭ «تۈركىي تىللار دىۋانى» ئەسىرىدۇر. بۇ ئەسەرلەر ئىسلامىي ئەخلاق، دۆلەت ئىدارە قىلىش پەلسەپىسى ۋە تۈركىي تىل-مەدەنىيەتنىڭ ئالتۇن خەزىنىسى ھېسابلىنىدۇ.'
        },
        {
          id: 2,
          category: 'ئىلىم-پەن ئەخلاقى',
          question: '«قۇتادغۇ بىلىك» ئەسىرىدە بىلىم ۋە ئەقىلنىڭ رولى قانداق تەسۋىرلەنگەن؟',
          answer: 'بىلىم ئىنساننى قەدىرلىك قىلىدىغان نۇر، ئەقىل بولسا قاراڭغۇدا يول باشلايدىغان مەشئەل سۈپىتىدە تەسۋىرلەنگەن؛ ھەرقانداق ئادالەت ۋە گۈللىنىش بىلىم ئۈستىگە قۇرۇلىدۇ.'
        },
        {
          id: 3,
          category: 'تىل ۋە يېزىق',
          question: 'ئۇيغۇر كىلاسسىك مەتبەئە ئەنئەنىسىدە ئىلىم ئەسەرلىرىنى قوغداشنىڭ ئەڭ مۇھىم ئۇسۇلى نېمە ئىدى؟',
          answer: 'كۆچۈرۈش، شەرھلەش، مەدرىسە دەرسلىكلىرىدە سىستېمىلىق سۇئال-جاۋاب شەكلىدە مۇزاكىرە قىلىش ۋە ئەۋلادلارغا ئامانەت سۈپىتىدە يەتكۈزۈش ئىدى.'
        }
      ]
    };
  }

  function buildAiPrompt(bookTopic) {
    const topicName = (bookTopic || '').trim() || 'بېرىلگەن كىتاب ياكى دەرسلىك مەزمۇنى';
    return [
      'سەن پەن، مائارىپ ۋە بىلىم يەكۈنلەش ساھەسىدىكى ئالىي مۇتەخەسسىس.',
      `تۆۋەندە مەن بەرگەن «${topicName}» مەزمۇنىنى چوڭقۇر تەھلىل قىلىپ، شۇ مەزمۇندىكى ئەڭ مۇھىم، ئەڭ تۈپكى ۋە ئۆگىنىشكە تېگىشلىك دەل 30 دانە تەپسىلىي سۇئال-جاۋابنى ئۇيغۇر تىلىدا تەييارلاپ بەر.`,
      '',
      'تەلەپلەر:',
      '1. سۇئاللار مەزمۇننىڭ بارلىق ئاساسىي نۇقتىلىرىنى قاپلىشى، يۈزەكى بولماي ئىلمىي ۋە تەپسىلىي بولۇشى كېرەك.',
      '2. جاۋابلار ئېنىق، لوگىكىلىق ۋە چۈشىنىشلىك ئۇيغۇرچە جۈملىلەر بىلەن يېزىلسۇن.',
      '3. جاۋابنى پەقەت تۆۋەندىكى ساپ JSON فورماتىدا قايتۇر (باشقا ئارتۇق چۈشەندۈرۈش يازما):',
      '',
      '{',
      `  "bookTitle": "${topicName}",`,
      '  "language": "ug",',
      '  "items": [',
      '    {',
      '      "id": 1,',
      '      "category": "تېما ياكى باب نامى",',
      '      "question": "1-مۇھىم سۇئال تېكىستى",',
      '      "answer": "1-سۇئالنىڭ تەپسىلىي ۋە ئىلمىي جاۋابى"',
      '    }',
      '  ]',
      '}',
      '',
      'دىققەت: "items" تىزىملىكىدە چوقۇم 1 دىن 30 غىچە تولۇق 30 دانە سۇئال-جاۋاب بولسۇن.'
    ].join('\n');
  }

  function stripBom(text) {
    return String(text || '').replace(/^\uFEFF/, '').trim();
  }

  function stripTrailingCommas(text) {
    return text.replace(/,\s*([}\]])/g, '$1');
  }

  function tryParseJson(candidate) {
    if (!candidate) return null;
    try {
      return JSON.parse(candidate);
    } catch (_e1) {
      try {
        return JSON.parse(stripTrailingCommas(candidate));
      } catch (_e2) {
        return null;
      }
    }
  }

  function cleanJsonText(rawText) {
    const trimmed = stripBom(rawText);
    if (!trimmed) return '';

    if (tryParseJson(trimmed) !== null) {
      return trimmed;
    }

    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
      const insideFence = fenceMatch[1].trim();
      if (tryParseJson(insideFence) !== null) {
        return insideFence;
      }
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');

    if (firstBrace !== -1 && lastBrace > firstBrace && (firstBracket === -1 || firstBrace < firstBracket)) {
      return trimmed.slice(firstBrace, lastBrace + 1);
    }
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      return trimmed.slice(firstBracket, lastBracket + 1);
    }
    return trimmed;
  }

  function pickStringField(obj, keys) {
    for (let i = 0; i < keys.length; i += 1) {
      const val = obj[keys[i]];
      if (typeof val === 'string' && val.trim()) {
        return val.trim();
      }
      if (typeof val === 'number' || typeof val === 'boolean') {
        return String(val);
      }
    }
    return '';
  }

  function findNestedArray(node, depth) {
    const level = depth || 0;
    if (level > 4 || !node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node;

    const priorityKeys = [
      'items', 'questions', 'qa', 'qas', 'cards', 'flashcards',
      'data', 'list', 'entries', 'records', 'results', 'content',
      'chapters', 'سۇئاللار', 'سوئاللار'
    ];

    for (let i = 0; i < priorityKeys.length; i += 1) {
      const candidate = node[priorityKeys[i]];
      if (Array.isArray(candidate) && candidate.length > 0) {
        return candidate;
      }
    }

    let bestArray = [];
    const values = Object.values(node);
    for (let i = 0; i < values.length; i += 1) {
      const val = values[i];
      if (Array.isArray(val) && val.length > bestArray.length) {
        bestArray = val;
      } else if (val && typeof val === 'object') {
        const nested = findNestedArray(val, level + 1);
        if (nested.length > bestArray.length) {
          bestArray = nested;
        }
      }
    }
    return bestArray;
  }

  function parseBookJson(rawText, overrideTitle) {
    const cleaned = cleanJsonText(rawText);
    if (!cleaned) {
      throw new Error('JSON مەزمۇنى بوش بولۇپ قالدى.');
    }

    const parsed = tryParseJson(cleaned);
    if (parsed === null) {
      throw new Error('JSON فورماتى توغرا ئەمەس. تىرناق ياكى پەشلەرنى تەكشۈرۈڭ.');
    }

    let rawItems = [];
    let detectedTitle = '';

    if (Array.isArray(parsed)) {
      rawItems = parsed;
    } else if (parsed && typeof parsed === 'object') {
      detectedTitle = pickStringField(parsed, [
        'bookTitle', 'title', 'name', 'book', 'bookName', 'subject', 'topic', 'كىتاب', 'مەنبە'
      ]);
      rawItems = findNestedArray(parsed, 0);

      if (rawItems.length === 0) {
        const skipKeys = { bookTitle: true, title: true, name: true, language: true };
        const dictEntries = Object.entries(parsed).filter(
          (pair) => typeof pair[1] === 'string' && pair[1].trim().length > 0 && !skipKeys[pair[0]]
        );
        if (dictEntries.length > 0) {
          rawItems = dictEntries.map((pair, idx) => ({
            id: idx + 1,
            question: pair[0],
            answer: pair[1]
          }));
        }
      }
    }

    const QUESTION_KEYS = ['question', 'q', 'prompt', 'front', 'title', 'ask', 'query', 'term', 'سۇئال', 'سوئال', 'سۇئال_تېكىستى'];
    const ANSWER_KEYS = ['answer', 'a', 'response', 'back', 'explanation', 'definition', 'reply', 'description', 'details', 'جاۋاب', 'جاۋاپ', 'جاۋاب_تېكىستى'];
    const CATEGORY_KEYS = ['category', 'topic', 'chapter', 'section', 'subject', 'tag', 'group', 'باب', 'تېما'];

    const items = [];
    function pushItem(entry, fallbackCategory) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const q = String(entry[0] !== undefined && entry[0] !== null ? entry[0] : '').trim();
        const a = String(entry[1] !== undefined && entry[1] !== null ? entry[1] : '').trim();
        if (q && a) {
          items.push({
            id: items.length + 1,
            category: fallbackCategory || 'ئاساسىي بىلىم',
            question: q,
            answer: a
          });
        }
        return;
      }

      if (!entry || typeof entry !== 'object') {
        return;
      }

      const nestedList = Array.isArray(entry.items)
        ? entry.items
        : Array.isArray(entry.questions)
          ? entry.questions
          : Array.isArray(entry.qa)
            ? entry.qa
            : null;

      if (nestedList && nestedList.length > 0) {
        const chName = pickStringField(entry, ['title', 'name', 'chapter', 'category', 'topic']) || fallbackCategory;
        nestedList.forEach((child) => pushItem(child, chName));
        return;
      }

      const q = pickStringField(entry, QUESTION_KEYS);
      const a = pickStringField(entry, ANSWER_KEYS);
      const cat = pickStringField(entry, CATEGORY_KEYS) || fallbackCategory || 'ئاساسىي بىلىم';
      if (q && a) {
        items.push({
          id: entry.id !== undefined && entry.id !== null ? entry.id : items.length + 1,
          category: cat,
          question: q,
          answer: a
        });
      }
    }

    rawItems.forEach((entry) => pushItem(entry, ''));

    if (items.length === 0) {
      throw new Error('JSON ئىچىدىن ئىناۋەتلىك سۇئال-جاۋاب تېپىلمىدى. ھەر بىر تۈردە question ۋە answer بولۇشى كېرەك.');
    }

    const finalTitle = String(overrideTitle || '').trim() || detectedTitle || `يېڭى كىتاب (${new Date().toLocaleDateString()})`;

    return {
      id: `book_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: finalTitle,
      createdAt: new Date().toISOString(),
      currentIndex: 0,
      masteredIds: [],
      items: items
    };
  }

  function decodeUtf16BeHex(hexStr) {
    const clean = hexStr.replace(/\s+/g, '');
    let out = '';
    for (let i = 0; i + 3 < clean.length; i += 4) {
      const code = parseInt(clean.slice(i, i + 4), 16);
      if (!Number.isNaN(code) && code !== 0xfeff) {
        out += String.fromCharCode(code);
      }
    }
    return out;
  }

  function decodePdfLiteralString(str) {
    let out = '';
    for (let i = 0; i < str.length; i += 1) {
      const ch = str[i];
      if (ch === '\\' && i + 1 < str.length) {
        const next = str[i + 1];
        if (next === 'n') { out += '\n'; i += 1; continue; }
        if (next === 'r') { out += '\r'; i += 1; continue; }
        if (next === 't') { out += '\t'; i += 1; continue; }
        if (next === '(' || next === ')' || next === '\\') { out += next; i += 1; continue; }
        if (/[0-7]/.test(next)) {
          const octMatch = str.slice(i + 1, i + 4).match(/^[0-7]{1,3}/);
          if (octMatch) {
            out += String.fromCharCode(parseInt(octMatch[0], 8));
            i += octMatch[0].length;
            continue;
          }
        }
      }
      out += ch;
    }
    return out;
  }

  function extractStringsFromPdfContent(contentText) {
    const pieces = [];
    const btBlocks = contentText.match(/BT[\s\S]*?ET/g) || [contentText];
    for (let b = 0; b < btBlocks.length; b += 1) {
      const block = btBlocks[b];
      const tokenRegex = /<([0-9A-Fa-f\s]+)>|\(((?:\\.|[^\\()])*)\)/g;
      let m;
      let lineBuf = '';
      while ((m = tokenRegex.exec(block)) !== null) {
        if (m[1]) {
          const hex = m[1].replace(/\s+/g, '');
          if (hex.toUpperCase().startsWith('FEFF') || hex.length % 4 === 0) {
            lineBuf += decodeUtf16BeHex(hex);
          }
        } else if (m[2] !== undefined) {
          lineBuf += decodePdfLiteralString(m[2]);
        }
      }
      if (lineBuf.trim()) {
        pieces.push(lineBuf.trim());
      }
    }
    return pieces.join('\n');
  }

  async function inflateDeflateBytes(bytes) {
    if (typeof DecompressionStream === 'undefined') return null;
    const formats = ['deflate', 'deflate-raw'];
    for (let i = 0; i < formats.length; i += 1) {
      try {
        const ds = new DecompressionStream(formats[i]);
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        const buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
      } catch (_e) {
        // try next format
      }
    }
    return null;
  }

  let cachedPdfJs = null;
  async function loadLocalPdfJs() {
    if (cachedPdfJs) return cachedPdfJs;
    const moduleUrl =
      typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
        ? chrome.runtime.getURL('vendor/pdf.min.mjs')
        : './vendor/pdf.min.mjs';
    const workerUrl =
      typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
        ? chrome.runtime.getURL('vendor/pdf.worker.min.mjs')
        : './vendor/pdf.worker.min.mjs';
    const mod = await import(moduleUrl);
    if (mod && mod.GlobalWorkerOptions) {
      mod.GlobalWorkerOptions.workerSrc = workerUrl;
    }
    cachedPdfJs = mod;
    return mod;
  }

  function normalizePdfExtractedText(rawText) {
    const normalized = String(rawText || '')
      .replace(/^\uFEFF/, '')
      .replace(/\u0000/g, '')
      .normalize('NFKC')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    const cleanedLines = normalized
      .split('\n')
      .map((line) =>
        line
          .replace(/[ \t]+/g, ' ')
          .replace(/\s+([،؛؟!.])/g, '$1')
          .trim()
      )
      .filter((line) => {
        if (!line) return true;
        if (/^(?:-?\s*\d{1,4}\s*-?|Page\s+\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s*-?\s*بەت)$/i.test(line)) {
          return false;
        }
        return true;
      });

    return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function joinPdfPagesInRange(pages, fromPage, toPage) {
    if (!Array.isArray(pages) || pages.length === 0) return '';
    const minPage = Math.max(1, Math.min(fromPage, toPage));
    const maxPage = Math.max(minPage, Math.max(fromPage, toPage));
    return pages
      .filter((p) => p.pageNumber >= minPage && p.pageNumber <= maxPage && p.text.trim())
      .map((p) => p.text.trim())
      .join('\n\n')
      .trim();
  }

  function filterBookItemsForPdf(book, mode) {
    if (!book || !Array.isArray(book.items)) return [];
    if (mode !== 'unmastered') return book.items;
    const masteredSet = new Set(Array.isArray(book.masteredIds) ? book.masteredIds : []);
    const pending = book.items.filter((item) => !masteredSet.has(item.id));
    return pending.length > 0 ? pending : book.items;
  }

  function buildSmartStudyQuestion(body, category, index, hasHeading) {
    const snippet = body.split(/\s+/).slice(0, 7).join(' ');
    const prefix = hasHeading ? `«${category}» تېمىسىدا` : `${index + 1}-مۇھىم نۇقتىدا`;

    if (/دېگەنلىك|دېمەكتۇر|ھېسابلىنىدۇ|ئىبارەت|ئېنىقلىمىسى|defined as|\bmeans\b|refers to/i.test(body)) {
      return `${prefix}: «${snippet}...» ئۇقۇمىنىڭ ئېنىقلىمىسى ۋە ماھىيىتى نېمە؟`;
    }
    if (/چۈنكى|سەۋەبى|مەقسىتى|ئۈچۈن|نەتىجىدە|because|therefore|purpose/i.test(body)) {
      return `${prefix}: «${snippet}...» دا بايان قىلىنغان ئاساسىي سەۋەب ياكى مەقسەت نېمە؟`;
    }
    if (/بىرىنچى|ئىككىنچى|باسقۇچ|پىرىنسىپ|قائىدە|\b1\)|•/.test(body)) {
      return `${prefix}: «${snippet}...» دائىرىسىدىكى ئاساسىي باسقۇچ ياكى تەلەپلەر قايسىلار؟`;
    }
    if (/\b(?:1[0-9]{3}|20[0-9]{2})\b|يىلى|ئەسىر/.test(body)) {
      return `${prefix}: «${snippet}...» بىلەن مۇناسىۋەتلىك مۇھىم تارىخىي پاكىت قايسى؟`;
    }
    const variants = [
      `${prefix}: «${snippet}...» مەزمۇنىنى قانداق چۈشەندۈرىسىز؟`,
      `${prefix}: «${snippet}...» نىڭ ئاساسىي پىكرى ۋە ئەھمىيىتى نېمە؟`,
      `${prefix}: «${snippet}...» دىن چىقىرىلىدىغان تۈپ خۇلاسە نېمە؟`
    ];
    return variants[index % variants.length];
  }

  async function extractTextViaPdfJs(arrayBuffer, onProgress) {
    const pdfjsLib = await loadLocalPdfJs();
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      useSystemFonts: true,
      disableFontFace: true
    });
    const pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages || 0;
    const pages = [];
    let metadataTitle = '';
    try {
      try {
        const meta = await pdfDoc.getMetadata();
        const rawTitle = meta && meta.info ? meta.info.Title : '';
        if (typeof rawTitle === 'string' && rawTitle.trim() && !/^(untitled|document|microsoft word)/i.test(rawTitle.trim())) {
          metadataTitle = normalizePdfExtractedText(rawTitle).slice(0, 120);
        }
      } catch (_metaErr) {
        // metadata optional
      }

      for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
        if (onProgress) onProgress(pageNum, totalPages);
        const page = await pdfDoc.getPage(pageNum);
        const content = await page.getTextContent();
        const lines = [];
        let currentLine = '';
        let prevY = null;
        for (let i = 0; i < content.items.length; i += 1) {
          const rawItem = content.items[i];
          if (!rawItem || typeof rawItem.str !== 'string') continue;
          const y = Array.isArray(rawItem.transform) ? rawItem.transform[5] : null;
          if (prevY !== null && y !== null && Math.abs(y - prevY) > 4 && currentLine.trim()) {
            lines.push(currentLine.trim());
            currentLine = '';
          }
          const fragment = rawItem.str;
          if (fragment) {
            currentLine = currentLine
              ? (currentLine.endsWith(' ') || fragment.startsWith(' ') ? currentLine + fragment : currentLine + ' ' + fragment)
              : fragment;
          }
          if (rawItem.hasEOL && currentLine.trim()) {
            lines.push(currentLine.trim());
            currentLine = '';
          }
          if (y !== null) prevY = y;
        }
        if (currentLine.trim()) {
          lines.push(currentLine.trim());
        }
        const pageText = normalizePdfExtractedText(lines.join('\n'));
        pages.push({ pageNumber: pageNum, text: pageText });
      }
    } finally {
      await loadingTask.destroy();
    }
    const text = pages.map((p) => p.text).filter(Boolean).join('\n\n').trim();
    return { text, pages, pageCount: totalPages, metadataTitle };
  }

  async function extractTextFromPdfBuffer(arrayBuffer, onProgress) {
    try {
      const pdfJsRes = await extractTextViaPdfJs(arrayBuffer, onProgress);
      if (pdfJsRes.text.length >= 20) {
        return pdfJsRes;
      }
      throw new Error('بۇ PDF رەسىم شەكلىدە سىكانىرلانغان (تېكىست قەۋىتى يوق) ئىكەن. تېكىستنى چاپلاڭ ياكى تور سىناق بېتىدە AI ئارقىلىق ئوقۇتۇڭ.');
    } catch (pdfJsErr) {
      if (pdfJsErr && /سىكانىرلانغان/.test(pdfJsErr.message)) {
        throw pdfJsErr;
      }
    }

    const bytes = new Uint8Array(arrayBuffer);
    const latinDecoder = new TextDecoder('latin1');
    const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
    const rawLatin = latinDecoder.decode(bytes);
    const collected = [];

    let searchIdx = 0;
    while (searchIdx < rawLatin.length) {
      const streamPos = rawLatin.indexOf('stream', searchIdx);
      if (streamPos === -1) break;
      let dataStart = streamPos + 6;
      if (rawLatin[dataStart] === '\r' && rawLatin[dataStart + 1] === '\n') {
        dataStart += 2;
      } else if (rawLatin[dataStart] === '\n' || rawLatin[dataStart] === '\r') {
        dataStart += 1;
      }
      const endPos = rawLatin.indexOf('endstream', dataStart);
      if (endPos === -1) break;

      const headerSlice = rawLatin.slice(Math.max(0, streamPos - 360), streamPos);
      const isFlate = /\/FlateDecode/i.test(headerSlice);
      const sliceBytes = bytes.slice(dataStart, endPos);

      let decodedText = '';
      if (isFlate) {
        const inflated = await inflateDeflateBytes(sliceBytes);
        if (inflated) {
          decodedText = utf8Decoder.decode(inflated);
        }
      } else {
        decodedText = utf8Decoder.decode(sliceBytes);
      }

      if (decodedText && (/BT[\s\S]*ET/.test(decodedText) || /\bTj\b|\bTJ\b/.test(decodedText))) {
        const extracted = normalizePdfExtractedText(extractStringsFromPdfContent(decodedText));
        if (extracted.trim()) {
          collected.push(extracted.trim());
        }
      }
      searchIdx = endPos + 9;
    }

    const joined = normalizePdfExtractedText(collected.join('\n\n'));
    if (joined.length < 20) {
      throw new Error('بۇ PDF تەكستى مەخسۇس كودلانغان ياكى رەسىم شەكلىدە ئىكەن. تېكىستنى چاپلاڭ ياكى تور سىناق بېتىدىكى AI ئارقىلىق PDF نى ئوقۇتۇڭ.');
    }
    return {
      text: joined,
      pages: [{ pageNumber: 1, text: joined }],
      pageCount: 1,
      metadataTitle: ''
    };
  }

  function generateLocalQaFromText(rawText, overrideTitle, maxItems) {
    const normalized = normalizePdfExtractedText(rawText);

    if (normalized.length < 15) {
      throw new Error('سۇئال-جاۋاب ياساش ئۈچۈن يېتەرلىك تېكىست يېزىڭ (ئاز دېگەندە بىر نەچچە جۈملە بولسۇن).');
    }

    const limit = Math.max(1, Math.min(30, maxItems || 30));
    const items = [];

    const qaBlockRegex =
      /(?:^|\n)\s*(?:\d+[.)\-\s]*)?(?:سۇئال|سوئال|Q|Question)\s*[:：]\s*([\s\S]+?)\n\s*(?:جاۋاب|جاۋاپ|A|Answer)\s*[:：]\s*([\s\S]+?)(?=\n\s*(?:\d+[.)\-\s]*)?(?:سۇئال|سوئال|Q|Question)\s*[:：]|$)/gi;
    let match;
    while ((match = qaBlockRegex.exec(normalized)) !== null && items.length < limit) {
      const q = match[1].trim();
      const a = match[2].trim();
      if (q && a) {
        items.push({
          id: items.length + 1,
          category: 'تېكىستتىن ئايرىلغان سۇئال',
          question: q,
          answer: a
        });
      }
    }

    if (items.length === 0) {
      const rawBlocks = normalized.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
      const paragraphs = [];
      for (let i = 0; i < rawBlocks.length; i += 1) {
        const block = rawBlocks[i];
        if (block.length <= 420) {
          paragraphs.push(block);
        } else {
          const sentences = block.split(/(?<=[.!?؟۔\n])\s+/).map((s) => s.trim()).filter(Boolean);
          let chunk = '';
          for (let j = 0; j < sentences.length; j += 1) {
            const s = sentences[j];
            if (chunk && (chunk + ' ' + s).length > 340) {
              paragraphs.push(chunk.trim());
              chunk = s;
            } else {
              chunk = chunk ? chunk + ' ' + s : s;
            }
          }
          if (chunk.trim()) paragraphs.push(chunk.trim());
        }
      }

      let chunks = [];
      if (paragraphs.length >= 3 || (paragraphs.length >= 2 && paragraphs.every((p) => p.length >= 45))) {
        chunks = paragraphs;
      } else {
        const unwrapped = normalized.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
        const bySentence = unwrapped.split(/(?<=[.!?؟۔])\s+/).map((s) => s.trim()).filter((s) => s.length >= 12);
        if (bySentence.length >= 2) {
          chunks = bySentence;
        } else {
          const words = unwrapped.split(' ').filter(Boolean);
          const targetChunks = Math.min(limit, Math.max(1, Math.ceil(words.length / 32)));
          const wordsPerChunk = Math.max(18, Math.ceil(words.length / targetChunks));
          for (let w = 0; w < words.length; w += wordsPerChunk) {
            const seg = words.slice(w, w + wordsPerChunk).join(' ').trim();
            if (seg.length >= 12) chunks.push(seg);
          }
        }
      }

      let pendingHeading = '';
      for (let i = 0; i < chunks.length && items.length < limit; i += 1) {
        const lines = chunks[i].split('\n').map((l) => l.trim()).filter(Boolean);
        const hasNext = i + 1 < chunks.length;
        if (
          paragraphs.length >= 3 &&
          hasNext &&
          lines.length === 1 &&
          lines[0].length >= 2 &&
          lines[0].length < 48 &&
          !/[.!?؟۔]$/.test(lines[0]) &&
          lines[0].split(/\s+/).length <= 6
        ) {
          pendingHeading = lines[0].replace(/[:：]+$/, '');
          continue;
        }
        const body = lines.join(' ').trim();
        if (body.length < 12) continue;

        const hasHeading = Boolean(pendingHeading);
        let category = pendingHeading || `ئاساسىي مەزمۇن · ${items.length + 1}`;
        let question = '';
        if (lines.length >= 2 && lines[0].length < 70 && lines[0].split(/\s+/).length <= 8) {
          category = lines[0].replace(/[:：]+$/, '');
          const rest = lines.slice(1).join(' ').trim();
          question = `«${category}» تېمىسىدىكى ئەڭ مۇھىم مەزمۇن نېمە؟`;
          items.push({ id: items.length + 1, category, question, answer: rest || body });
        } else if (/[؟?]$/.test(body)) {
          items.push({
            id: items.length + 1,
            category,
            question: body,
            answer: hasHeading ? `«${category}» تېمىسى دائىرىسىدە بۇ نۇقتىنى ئەستە تۇتۇش كېرەك: ${body}` : body
          });
        } else {
          question = buildSmartStudyQuestion(body, category, items.length, hasHeading);
          items.push({ id: items.length + 1, category, question, answer: body });
        }
        pendingHeading = '';
      }

      if (items.length === 0) {
        const flat = normalized.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
        const words = flat.split(' ').filter(Boolean);
        const chunkWordCount = Math.max(18, Math.ceil(words.length / limit));
        for (let w = 0; w < words.length && items.length < limit; w += chunkWordCount) {
          const segment = words.slice(w, w + chunkWordCount).join(' ').trim();
          if (segment.length < 12) continue;
          const cat = `PDF مەزمۇنى · ${items.length + 1}`;
          items.push({
            id: items.length + 1,
            category: cat,
            question: buildSmartStudyQuestion(segment, cat, items.length, false),
            answer: segment
          });
        }
      }
    }

    if (items.length === 0) {
      throw new Error('تېكىستتىن سۇئال-جاۋاب تۈزۈش مۇمكىن بولمىدى.');
    }

    const finalTitle = String(overrideTitle || '').trim() || 'تېكىستتىن تەييارلانغان كىتاب';
    return {
      id: `book_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: finalTitle,
      createdAt: new Date().toISOString(),
      currentIndex: 0,
      masteredIds: [],
      items: items
    };
  }

  let toastTimer = null;
  function showToast(message, type) {
    try {
      const bar = document.getElementById('toastBar');
      if (!bar) return;
      bar.textContent = message;
      bar.className = 'toast-bar show ' + (type || 'success');
      if (toastTimer) {
        clearTimeout(toastTimer);
      }
      toastTimer = setTimeout(() => {
        bar.className = 'toast-bar';
      }, 2800);
    } catch (err) {
      console.error('Toast error:', err);
    }
  }

  function getActiveBook() {
    if (state.books.length === 0) return null;
    return state.books.find((b) => b.id === state.activeBookId) || state.books[0];
  }

  async function persistAll() {
    try {
      await storageSet({
        [STORAGE_KEYS.BOOKS]: state.books,
        [STORAGE_KEYS.ACTIVE_BOOK_ID]: state.activeBookId,
        [STORAGE_KEYS.SETTINGS]: state.settings
      });
    } catch (err) {
      showToast('ساقلاشتا خاتالىق كۆرۈلدى: ' + err.message, 'error');
    }
  }

  function applyTheme() {
    if (state.settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  function applyBrightness() {
    const level = clampBrightness(state.settings.brightness);
    state.settings.brightness = level;
    document.documentElement.style.filter = level === 100 ? '' : `brightness(${level}%)`;
  }

  function renderSettingsControls() {
    const toggle = document.getElementById('startupReminderToggle');
    const label = document.getElementById('reminderStateLabel');
    const modalBtn = document.getElementById('modalReminderToggleBtn');
    const enabled = Boolean(state.settings.reminderEnabled);
    const brightness = clampBrightness(state.settings.brightness);

    if (toggle) {
      toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
    }
    if (label) {
      label.textContent = enabled ? 'ئوچۇق' : 'تاقاق';
    }
    if (modalBtn) {
      modalBtn.textContent = enabled ? 'ئېتىۋېتىش' : 'قوزغىتىش';
    }

    const railRange = document.getElementById('railBrightnessRange');
    const railVal = document.getElementById('railBrightnessValue');
    const railBadge = document.getElementById('railBrightnessMiniBadge');
    const modalRange = document.getElementById('modalBrightnessRange');
    const modalVal = document.getElementById('modalBrightnessValue');

    if (railRange) railRange.value = String(brightness);
    if (railVal) railVal.textContent = `${brightness}%`;
    if (railBadge) railBadge.textContent = `${brightness}%`;
    if (modalRange) modalRange.value = String(brightness);
    if (modalVal) modalVal.textContent = `${brightness}%`;
  }

  function renderMainCard() {
    const summaryEl = document.getElementById('headerBooksSummary');
    const badgeEl = document.getElementById('booksCountBadge');
    const selectEl = document.getElementById('bookSelector');
    const progressEl = document.getElementById('qaProgressText');
    const fillEl = document.getElementById('progressBarFill');
    const categoryEl = document.getElementById('qaCategoryText');
    const questionEl = document.getElementById('qaQuestionText');
    const answerEl = document.getElementById('qaAnswerText');
    const answerPanel = document.getElementById('answerPanel');
    const toggleAnswerBtn = document.getElementById('toggleAnswerBtn');
    const masterBtn = document.getElementById('masterQuestionBtn');

    if (summaryEl) {
      summaryEl.textContent = `${state.books.length} كىتاب ساقلاندى`;
    }
    if (badgeEl) {
      badgeEl.textContent = String(state.books.length);
    }

    if (selectEl) {
      selectEl.textContent = '';
      if (state.books.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'كىتاب يوق — «كىتاپ قوشۇش» نى بېسىڭ';
        selectEl.appendChild(opt);
      } else {
        state.books.forEach((book) => {
          const opt = document.createElement('option');
          opt.value = book.id;
          opt.textContent = `${book.title} (${book.items.length} سۇئال)`;
          if (book.id === state.activeBookId) {
            opt.selected = true;
          }
          selectEl.appendChild(opt);
        });
      }
    }

    const activeBook = getActiveBook();
    if (!activeBook || !Array.isArray(activeBook.items) || activeBook.items.length === 0) {
      if (progressEl) progressEl.textContent = '0 / 0';
      if (fillEl) fillEl.style.width = '0%';
      if (categoryEl) categoryEl.textContent = '';
      if (questionEl) questionEl.textContent = 'ھازىرچە كىتاب تېپىلمىدى. «كىتاپ قوشۇش» كۇنۇپكىسى ئارقىلىق JSON يۈكلەڭ.';
      if (answerEl) answerEl.textContent = '';
      if (answerPanel) answerPanel.classList.remove('visible');
      if (toggleAnswerBtn) toggleAnswerBtn.style.display = 'none';
      return;
    }

    if (toggleAnswerBtn) toggleAnswerBtn.style.display = 'block';

    const total = activeBook.items.length;
    const safeIdx = Math.max(0, Math.min(activeBook.currentIndex || 0, total - 1));
    activeBook.currentIndex = safeIdx;
    const item = activeBook.items[safeIdx];
    const masteredSet = new Set(Array.isArray(activeBook.masteredIds) ? activeBook.masteredIds : []);
    const isMastered = masteredSet.has(item.id);

    if (progressEl) {
      progressEl.textContent = `${safeIdx + 1} / ${total} · ئۆگەنگەن: ${masteredSet.size}`;
    }
    if (fillEl) {
      const pct = Math.round(((safeIdx + 1) / total) * 100);
      fillEl.style.width = `${pct}%`;
    }
    if (categoryEl) {
      categoryEl.textContent = item.category || 'ئاساسىي بىلىم';
    }
    if (questionEl) {
      questionEl.textContent = item.question;
    }
    if (answerEl) {
      answerEl.textContent = item.answer;
    }
    if (answerPanel && toggleAnswerBtn) {
      if (state.answerVisible) {
        answerPanel.classList.add('visible');
        toggleAnswerBtn.textContent = 'جاۋابنى يوشۇرۇش';
      } else {
        answerPanel.classList.remove('visible');
        toggleAnswerBtn.textContent = 'جاۋابنى كۆرۈش';
      }
    }
    if (masterBtn) {
      if (isMastered) {
        masterBtn.classList.add('mastered');
        masterBtn.textContent = 'ئۆگىنىلدى ✓';
      } else {
        masterBtn.classList.remove('mastered');
        masterBtn.textContent = 'ئۆگەندىم';
      }
    }
  }

  function renderManageBooksList() {
    const listEl = document.getElementById('manageBooksList');
    if (!listEl) return;
    listEl.textContent = '';

    if (state.books.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'ساقلانغان كىتاب يوق.';
      listEl.appendChild(empty);
      return;
    }

    state.books.forEach((book) => {
      const row = document.createElement('div');
      row.className = 'book-item';

      const info = document.createElement('div');
      info.className = 'book-item-info';

      const title = document.createElement('div');
      title.className = 'book-item-title';
      title.textContent = book.title;

      const meta = document.createElement('div');
      meta.className = 'book-item-meta';
      const masteredCount = Array.isArray(book.masteredIds) ? book.masteredIds.length : 0;
      meta.textContent = `${book.items.length} سۇئال · ئۆگەنگەن: ${masteredCount}`;

      info.appendChild(title);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'book-item-actions';

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'btn-glass';
      selectBtn.textContent = book.id === state.activeBookId ? 'ئاكتىپ' : 'ئوقۇش';
      selectBtn.addEventListener('click', async () => {
        state.activeBookId = book.id;
        state.answerVisible = false;
        await persistAll();
        renderAll();
        closeModal('exportModal');
        showToast(`«${book.title}» تاللاندى`, 'success');
      });

      const exportJsonBtn = document.createElement('button');
      exportJsonBtn.type = 'button';
      exportJsonBtn.className = 'btn-glass';
      exportJsonBtn.textContent = 'JSON';
      exportJsonBtn.addEventListener('click', () => {
        exportBookAsJson(book);
      });

      const exportPdfBtn = document.createElement('button');
      exportPdfBtn.type = 'button';
      exportPdfBtn.className = 'btn-glass';
      exportPdfBtn.textContent = 'PDF';
      exportPdfBtn.addEventListener('click', () => {
        exportBookAsPdf(book);
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-glass btn-danger';
      delBtn.textContent = state.deleteConfirmId === book.id ? 'جەزملەش' : 'ئۆچۈرۈش';
      delBtn.addEventListener('click', async () => {
        if (state.deleteConfirmId !== book.id) {
          state.deleteConfirmId = book.id;
          renderManageBooksList();
          return;
        }
        state.books = state.books.filter((b) => b.id !== book.id);
        state.deleteConfirmId = null;
        if (state.activeBookId === book.id) {
          state.activeBookId = state.books[0] ? state.books[0].id : null;
        }
        await persistAll();
        renderAll();
        showToast('كىتاب ئۆچۈرۈلدى', 'success');
      });

      actions.appendChild(selectBtn);
      actions.appendChild(exportJsonBtn);
      actions.appendChild(exportPdfBtn);
      actions.appendChild(delBtn);

      row.appendChild(info);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  function renderPrintSheet(book, mode) {
    const container = document.getElementById('printContainer');
    if (!container || !book) return;
    const activeMode = mode || state.printMode || 'study';
    state.currentPrintBook = book;
    state.printMode = activeMode;
    const modeSelect = document.getElementById('printModeSelect');
    if (modeSelect) modeSelect.value = activeMode;

    const items = filterBookItemsForPdf(book, activeMode);
    const isQuiz = activeMode === 'quiz';
    const masteredCount = Array.isArray(book.masteredIds) ? book.masteredIds.length : 0;
    const modeLabel =
      activeMode === 'quiz'
        ? 'سىناق قەغىزى'
        : activeMode === 'unmastered'
          ? 'ئۆگەنمىگەنلىرىلا'
          : 'تولۇق نۇسخا';

    container.textContent = '';

    const header = document.createElement('div');
    header.className = 'print-sheet-header';

    const titleEl = document.createElement('h1');
    titleEl.className = 'print-sheet-title';
    titleEl.textContent = book.title;

    const metaEl = document.createElement('div');
    metaEl.className = 'print-sheet-meta';
    metaEl.textContent = `قارلۇق ئۆگىنىش ياردەمچىسى · ${modeLabel} · چىقىرىلغان سۇئال: ${items.length} · ئۆگەنگەن: ${masteredCount}/${book.items.length}`;

    header.appendChild(titleEl);
    header.appendChild(metaEl);
    container.appendChild(header);

    items.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'print-qa-card';

      const head = document.createElement('div');
      head.className = 'print-qa-head';
      const numSpan = document.createElement('span');
      numSpan.textContent = `${idx + 1}-سۇئال`;
      const catSpan = document.createElement('span');
      catSpan.textContent = item.category || 'ئاساسىي بىلىم';
      head.appendChild(numSpan);
      head.appendChild(catSpan);

      const qEl = document.createElement('div');
      qEl.className = 'print-qa-q uyghur-paragraph';
      qEl.textContent = item.question;

      card.appendChild(head);
      card.appendChild(qEl);

      if (isQuiz) {
        const linesWrap = document.createElement('div');
        linesWrap.className = 'quiz-write-lines';
        linesWrap.appendChild(Object.assign(document.createElement('div'), { className: 'quiz-write-line' }));
        linesWrap.appendChild(Object.assign(document.createElement('div'), { className: 'quiz-write-line' }));
        card.appendChild(linesWrap);
      } else {
        const aEl = document.createElement('div');
        aEl.className = 'print-qa-a uyghur-paragraph';
        aEl.textContent = `جاۋاب: ${item.answer}`;
        card.appendChild(aEl);
      }
      container.appendChild(card);
    });

    if (isQuiz) {
      const keySection = document.createElement('section');
      keySection.className = 'print-answer-key';
      const keyTitle = document.createElement('h2');
      keyTitle.textContent = `جاۋاب ئاچقۇچى (${items.length} سۇئال)`;
      keySection.appendChild(keyTitle);

      items.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'print-key-row';
        const numB = document.createElement('strong');
        numB.textContent = `${idx + 1}. `;
        row.appendChild(numB);
        row.appendChild(document.createTextNode(item.answer));
        keySection.appendChild(row);
      });
      container.appendChild(keySection);
    }
  }

  function escapeHtmlForExport(raw) {
    return String(raw || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function downloadExtensionPrintHtml(book, mode) {
    if (!book) return;
    const activeMode = mode || state.printMode || 'study';
    const items = filterBookItemsForPdf(book, activeMode);
    const isQuiz = activeMode === 'quiz';
    const modeLabel =
      activeMode === 'quiz'
        ? 'سىناق قەغىزى'
        : activeMode === 'unmastered'
          ? 'ئۆگەنمىگەنلىرىلا'
          : 'تولۇق نۇسخا';

    const cardsHtml = items
      .map(
        (item, idx) =>
          `<article class="card"><div class="card-head"><span>${idx + 1}-سۇئال</span><span>${escapeHtmlForExport(item.category || 'ئاساسىي بىلىم')}</span></div><h2 class="q">${escapeHtmlForExport(item.question)}</h2>${
            isQuiz
              ? '<div class="write-lines"><div></div><div></div></div>'
              : `<p class="a"><strong>جاۋاب:</strong> ${escapeHtmlForExport(item.answer)}</p>`
          }</article>`
      )
      .join('\n');

    const keyHtml = isQuiz
      ? `<section class="answer-key"><h2>جاۋاب ئاچقۇچى (${items.length} سۇئال)</h2>${items
          .map((item, idx) => `<div class="key-row"><strong>${idx + 1}.</strong> ${escapeHtmlForExport(item.answer)}</div>`)
          .join('\n')}</section>`
      : '';

    const html = `<!doctype html><html lang="ug" dir="rtl"><head><meta charset="UTF-8"/><title>${escapeHtmlForExport(book.title)}</title><style>@page{size:A4;margin:14mm;}*{box-sizing:border-box;letter-spacing:0;}body{font-family:'UKIJ Tuz','ALKATIP Basma',Tahoma,sans-serif;color:#1A1E24;background:#fff;padding:24px;direction:rtl;line-height:1.75;}.card{border:1px solid #CBD5E1;border-radius:12px;padding:14px 16px;margin-bottom:12px;break-inside:avoid;}.card-head{display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:#F05A28;margin-bottom:6px;}.q{margin:0 0 6px;font-size:15px;text-align:justify;text-indent:1.75em;}.a{margin:0;font-size:13.5px;color:#334155;text-align:justify;text-indent:1.75em;}.write-lines div{border-bottom:1px dashed #94A3B8;height:22px;margin-top:4px;}.answer-key{break-before:page;border-top:2px solid #1F75FE;padding-top:16px;margin-top:24px;}.key-row{margin-bottom:8px;font-size:13px;}</style></head><body><header style="border-bottom:2px solid #F05A28;padding-bottom:12px;margin-bottom:18px;"><h1>${escapeHtmlForExport(book.title)}</h1><div>قارلۇق ئۆگىنىش ياردەمچىسى · ${modeLabel} · ${items.length} سۇئال</div></header>${cardsHtml}${keyHtml}</body></html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = book.title.replace(/[^\w\u0600-\u06FF-]+/g, '_').slice(0, 40) || 'karluk_book';
    a.href = url;
    a.download = `${safeName}_PDF.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('A4 HTML نۇسخىسى چۈشۈرۈلدى!', 'success');
  }

  function exportBookAsPdf(book) {
    try {
      if (!book) return;
      if (window.innerWidth < 520 && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        const targetUrl = chrome.runtime.getURL('popup.html?printBook=' + encodeURIComponent(book.id));
        chrome.tabs.create({ url: targetUrl });
        return;
      }
      renderPrintSheet(book, state.printMode);
      document.body.classList.add('print-mode');
      closeModal('exportModal');
    } catch (err) {
      showToast('PDF چىقىرىشتا خاتالىق: ' + err.message, 'error');
    }
  }

  function exportBookAsJson(book) {
    try {
      const payload = {
        bookTitle: book.title,
        language: 'ug',
        items: book.items
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = book.title.replace(/[^\w\u0600-\u06FF-]+/g, '_').slice(0, 40) || 'karluk_book';
      a.href = url;
      a.download = `${safeName}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('كىتاب JSON ھۆججىتى چۈشۈرۈلدى', 'success');
    } catch (err) {
      showToast('چىقىرىشتا خاتالىق: ' + err.message, 'error');
    }
  }

  function openModal(id) {
    state.deleteConfirmId = null;
    const modal = document.getElementById(id);
    if (modal) {
      modal.classList.add('open');
    }
    if (id === 'exportModal') {
      renderManageBooksList();
    }
  }

  function closeModal(id) {
    state.deleteConfirmId = null;
    const modal = document.getElementById(id);
    if (modal) {
      modal.classList.remove('open');
    }
  }

  function renderAll() {
    applyTheme();
    applyBrightness();
    renderSettingsControls();
    renderMainCard();
    renderManageBooksList();
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      return false;
    } catch (_e) {
      return false;
    }
  }

  function bindEvents() {
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeModal(btn.getAttribute('data-close-modal'));
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          closeModal(backdrop.id);
        }
      });
    });

    const toggleReminderHandler = async () => {
      try {
        state.settings.reminderEnabled = !state.settings.reminderEnabled;
        await persistAll();
        renderSettingsControls();
        showToast(
          state.settings.reminderEnabled
            ? 'تور كۆرگۈچ ئەسكەرتىشى قوزغىتىلدى'
            : 'تور كۆرگۈچ ئەسكەرتىشى ئېتىۋېتىلدى',
          'success'
        );
      } catch (err) {
        showToast(err.message, 'error');
      }
    };

    const startupToggle = document.getElementById('startupReminderToggle');
    if (startupToggle) startupToggle.addEventListener('click', toggleReminderHandler);

    const modalToggleBtn = document.getElementById('modalReminderToggleBtn');
    if (modalToggleBtn) modalToggleBtn.addEventListener('click', toggleReminderHandler);

    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', async () => {
        try {
          state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
          await persistAll();
          applyTheme();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    const updateBrightness = async (nextVal) => {
      try {
        state.settings.brightness = clampBrightness(nextVal);
        applyBrightness();
        renderSettingsControls();
        await persistAll();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };

    const railBrightnessQuickBtn = document.getElementById('railBrightnessQuickBtn');
    if (railBrightnessQuickBtn) {
      railBrightnessQuickBtn.addEventListener('click', () => openModal('settingsModal'));
    }

    const railBrightnessRange = document.getElementById('railBrightnessRange');
    if (railBrightnessRange) {
      railBrightnessRange.addEventListener('input', (e) => updateBrightness(e.target.value));
    }

    const railBrightnessDecBtn = document.getElementById('railBrightnessDecBtn');
    if (railBrightnessDecBtn) {
      railBrightnessDecBtn.addEventListener('click', () => updateBrightness(state.settings.brightness - 10));
    }

    const railBrightnessIncBtn = document.getElementById('railBrightnessIncBtn');
    if (railBrightnessIncBtn) {
      railBrightnessIncBtn.addEventListener('click', () => updateBrightness(state.settings.brightness + 10));
    }

    const modalBrightnessRange = document.getElementById('modalBrightnessRange');
    if (modalBrightnessRange) {
      modalBrightnessRange.addEventListener('input', (e) => updateBrightness(e.target.value));
    }

    const modalBrightnessDecBtn = document.getElementById('modalBrightnessDecBtn');
    if (modalBrightnessDecBtn) {
      modalBrightnessDecBtn.addEventListener('click', () => updateBrightness(state.settings.brightness - 10));
    }

    const modalBrightnessIncBtn = document.getElementById('modalBrightnessIncBtn');
    if (modalBrightnessIncBtn) {
      modalBrightnessIncBtn.addEventListener('click', () => updateBrightness(state.settings.brightness + 10));
    }

    const modalBrightnessResetBtn = document.getElementById('modalBrightnessResetBtn');
    if (modalBrightnessResetBtn) {
      modalBrightnessResetBtn.addEventListener('click', () => updateBrightness(100));
    }

    const booksLibraryBtn = document.getElementById('booksLibraryBtn');
    if (booksLibraryBtn) {
      booksLibraryBtn.addEventListener('click', () => openModal('exportModal'));
    }

    const openSettingsBtn = document.getElementById('openSettingsModalBtn');
    if (openSettingsBtn) {
      openSettingsBtn.addEventListener('click', () => openModal('settingsModal'));
    }

    const bookSelector = document.getElementById('bookSelector');
    if (bookSelector) {
      bookSelector.addEventListener('change', async (e) => {
        try {
          state.activeBookId = e.target.value;
          state.answerVisible = false;
          await persistAll();
          renderMainCard();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    const toggleAnswerBtn = document.getElementById('toggleAnswerBtn');
    if (toggleAnswerBtn) {
      toggleAnswerBtn.addEventListener('click', () => {
        state.answerVisible = !state.answerVisible;
        renderMainCard();
      });
    }

    const prevBtn = document.getElementById('prevQuestionBtn');
    if (prevBtn) {
      prevBtn.addEventListener('click', async () => {
        try {
          const book = getActiveBook();
          if (!book || book.items.length === 0) return;
          book.currentIndex = (book.currentIndex - 1 + book.items.length) % book.items.length;
          state.answerVisible = false;
          await persistAll();
          renderMainCard();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    const nextBtn = document.getElementById('nextQuestionBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', async () => {
        try {
          const book = getActiveBook();
          if (!book || book.items.length === 0) return;
          book.currentIndex = (book.currentIndex + 1) % book.items.length;
          state.answerVisible = false;
          await persistAll();
          renderMainCard();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    const masterBtn = document.getElementById('masterQuestionBtn');
    if (masterBtn) {
      masterBtn.addEventListener('click', async () => {
        try {
          const book = getActiveBook();
          if (!book || book.items.length === 0) return;
          const item = book.items[book.currentIndex];
          if (!Array.isArray(book.masteredIds)) {
            book.masteredIds = [];
          }
          const idx = book.masteredIds.indexOf(item.id);
          if (idx === -1) {
            book.masteredIds.push(item.id);
            showToast('ئۆگىنىلگەن سۇئالغا قوشۇلدى ✓', 'success');
          } else {
            book.masteredIds.splice(idx, 1);
          }
          await persistAll();
          renderMainCard();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    const openAddBtn = document.getElementById('openAddBookBtn');
    if (openAddBtn) {
      openAddBtn.addEventListener('click', () => openModal('addBookModal'));
    }

    const openExportBtn = document.getElementById('openExportBookBtn');
    if (openExportBtn) {
      openExportBtn.addEventListener('click', () => openModal('exportModal'));
    }

    function readJsonFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const pasteArea = document.getElementById('jsonPasteArea');
        const titleInput = document.getElementById('customBookTitleInput');
        if (pasteArea) {
          pasteArea.value = String(ev.target && ev.target.result ? ev.target.result : '');
        }
        if (titleInput && !titleInput.value.trim()) {
          titleInput.value = file.name.replace(/\.json$/i, '');
        }
        showToast('ھۆججەت ئوقۇلدى، «ساقلاش» نى بېسىڭ', 'success');
      };
      reader.onerror = () => {
        showToast('ھۆججەت ئوقۇشتا خاتالىق كۆرۈلدى', 'error');
      };
      reader.readAsText(file, 'UTF-8');
    }

    const jsonFileInput = document.getElementById('jsonFileInput');
    if (jsonFileInput) {
      jsonFileInput.addEventListener('change', (e) => {
        try {
          const file = e.target.files && e.target.files[0];
          readJsonFile(file);
          e.target.value = '';
        } catch (err) {
          showToast('ھۆججەت ئوقۇشتا خاتالىق: ' + err.message, 'error');
        }
      });
    }

    const jsonDropZone = document.getElementById('jsonDropZone');
    if (jsonDropZone) {
      jsonDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        jsonDropZone.style.borderColor = '#F05A28';
      });
      jsonDropZone.addEventListener('dragleave', () => {
        jsonDropZone.style.borderColor = '';
      });
      jsonDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        jsonDropZone.style.borderColor = '';
        try {
          const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          readJsonFile(file);
        } catch (err) {
          showToast('ھۆججەت ئوقۇشتا خاتالىق: ' + err.message, 'error');
        }
      });
    }

    const openFullScreenTab = () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
        } else {
          window.open(window.location.href, '_blank');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    };

    const openInTabBtn = document.getElementById('openInTabBtn');
    if (openInTabBtn) openInTabBtn.addEventListener('click', openFullScreenTab);

    const headerOpenTabBtn = document.getElementById('headerOpenTabBtn');
    if (headerOpenTabBtn) headerOpenTabBtn.addEventListener('click', openFullScreenTab);

    const tabAutoBtn = document.getElementById('tabAutoBtn');
    const tabJsonBtn = document.getElementById('tabJsonBtn');
    const addTabAuto = document.getElementById('addTabAuto');
    const addTabJson = document.getElementById('addTabJson');
    const switchAddTab = (mode) => {
      if (!tabAutoBtn || !tabJsonBtn || !addTabAuto || !addTabJson) return;
      const isAuto = mode === 'auto';
      tabAutoBtn.classList.toggle('active', isAuto);
      tabJsonBtn.classList.toggle('active', !isAuto);
      addTabAuto.classList.toggle('active', isAuto);
      addTabJson.classList.toggle('active', !isAuto);
    };
    if (tabAutoBtn) tabAutoBtn.addEventListener('click', () => switchAddTab('auto'));
    if (tabJsonBtn) tabJsonBtn.addEventListener('click', () => switchAddTab('json'));

    function setPdfStatus(msg) {
      const note = document.getElementById('pdfStatusNote');
      if (!note) return;
      if (msg) {
        note.textContent = msg;
        note.style.display = 'block';
      } else {
        note.textContent = '';
        note.style.display = 'none';
      }
    }

    function updatePdfRangeInputs() {
      const rangeBox = document.getElementById('pdfPageRangeBox');
      const fromInput = document.getElementById('pdfFromPageInput');
      const toInput = document.getElementById('pdfToPageInput');
      const textArea = document.getElementById('rawStudyTextArea');
      if (!rangeBox || !fromInput || !toInput || state.pdfPages.length <= 1) {
        if (rangeBox) rangeBox.style.display = 'none';
        return;
      }
      const total = state.pdfPages.length;
      const fromVal = Math.max(1, Math.min(total, parseInt(fromInput.value, 10) || 1));
      const toVal = Math.max(fromVal, Math.min(total, parseInt(toInput.value, 10) || total));
      fromInput.value = String(fromVal);
      toInput.value = String(toVal);
      const sliced = joinPdfPagesInRange(state.pdfPages, fromVal, toVal);
      if (textArea) textArea.value = sliced;
      setPdfStatus(`${fromVal}–${toVal}-بەتلەر تاللاندى (${total} بەتتىن · ${sliced.length} ھەرپ)`);
    }

    const pdfFromPageInput = document.getElementById('pdfFromPageInput');
    const pdfToPageInput = document.getElementById('pdfToPageInput');
    if (pdfFromPageInput) pdfFromPageInput.addEventListener('change', updatePdfRangeInputs);
    if (pdfToPageInput) pdfToPageInput.addEventListener('change', updatePdfRangeInputs);

    async function handlePdfOrTextFile(file) {
      if (!file) return;
      const textArea = document.getElementById('rawStudyTextArea');
      const titleInput = document.getElementById('customBookTitleInput');
      const rangeBox = document.getElementById('pdfPageRangeBox');
      const fromInput = document.getElementById('pdfFromPageInput');
      const toInput = document.getElementById('pdfToPageInput');
      const fallbackTitle = file.name.replace(/\.(pdf|txt|md)$/i, '');

      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        state.pdfPages = [];
        setPdfStatus('PDF تېكىستى ئوقۇلۇۋاتىدۇ...');
        try {
          const buf = await file.arrayBuffer();
          const extracted = await extractTextFromPdfBuffer(buf, (curr, total) => {
            setPdfStatus(`بەت ${curr} / ${total} ئوقۇلۇۋاتىدۇ...`);
          });
          if (titleInput && !titleInput.value.trim()) {
            titleInput.value = extracted.metadataTitle || fallbackTitle;
          }
          state.pdfPages = extracted.pages || [];
          if (rangeBox && fromInput && toInput) {
            if (state.pdfPages.length > 1) {
              fromInput.max = String(state.pdfPages.length);
              toInput.max = String(state.pdfPages.length);
              fromInput.value = '1';
              toInput.value = String(state.pdfPages.length);
              rangeBox.style.display = 'flex';
            } else {
              rangeBox.style.display = 'none';
            }
          }
          if (textArea) textArea.value = extracted.text;
          setPdfStatus(`«${file.name}» ئوقۇلدى (${extracted.pageCount} بەت، ${extracted.text.length} ھەرپ)`);
          showToast('PDF تېكىستى ئوقۇلدى! ئەمدى «ئاپتوماتىك سۇئال-جاۋاب ياساش» نى بېسىڭ', 'success');
        } catch (err) {
          setPdfStatus('');
          showToast(err.message, 'error');
        }
        return;
      }

      if (titleInput && !titleInput.value.trim()) {
        titleInput.value = fallbackTitle;
      }
      state.pdfPages = [];
      if (rangeBox) rangeBox.style.display = 'none';
      setPdfStatus('');
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (textArea) textArea.value = String(ev.target && ev.target.result ? ev.target.result : '');
        showToast('تېكىست ھۆججىتى ئوقۇلدى!', 'success');
      };
      reader.onerror = () => showToast('ھۆججەت ئوقۇشتا خاتالىق', 'error');
      reader.readAsText(file, 'UTF-8');
    }

    const pdfTextFileInput = document.getElementById('pdfTextFileInput');
    if (pdfTextFileInput) {
      pdfTextFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        handlePdfOrTextFile(file);
        e.target.value = '';
      });
    }

    const pdfTextDropZone = document.getElementById('pdfTextDropZone');
    if (pdfTextDropZone) {
      pdfTextDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        pdfTextDropZone.style.borderColor = '#F05A28';
      });
      pdfTextDropZone.addEventListener('dragleave', () => {
        pdfTextDropZone.style.borderColor = '';
      });
      pdfTextDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        pdfTextDropZone.style.borderColor = '';
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        handlePdfOrTextFile(file);
      });
    }

    const generateLocalBookBtn = document.getElementById('generateLocalBookBtn');
    if (generateLocalBookBtn) {
      generateLocalBookBtn.addEventListener('click', async () => {
        try {
          const textArea = document.getElementById('rawStudyTextArea');
          const titleInput = document.getElementById('customBookTitleInput');
          const countSelect = document.getElementById('qaCountSelect');
          const rawText = textArea ? textArea.value : '';
          const customTitle = titleInput ? titleInput.value : '';
          const maxCount = countSelect ? parseInt(countSelect.value, 10) || 30 : 30;

          const newBook = generateLocalQaFromText(rawText, customTitle, maxCount);
          state.books.unshift(newBook);
          state.activeBookId = newBook.id;
          state.answerVisible = false;
          state.pdfPages = [];

          await persistAll();
          renderAll();

          if (textArea) textArea.value = '';
          if (titleInput) titleInput.value = '';
          const rangeBox = document.getElementById('pdfPageRangeBox');
          if (rangeBox) rangeBox.style.display = 'none';
          setPdfStatus('');
          closeModal('addBookModal');
          showToast(`«${newBook.title}» (${newBook.items.length} سۇئال) ئاپتوماتىك ياسىلىپ ساقلاندى!`, 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    const printModeSelect = document.getElementById('printModeSelect');
    if (printModeSelect) {
      printModeSelect.addEventListener('change', (e) => {
        state.printMode = e.target.value || 'study';
        if (state.currentPrintBook) {
          renderPrintSheet(state.currentPrintBook, state.printMode);
        }
      });
    }

    const downloadPrintHtmlBtn = document.getElementById('downloadPrintHtmlBtn');
    if (downloadPrintHtmlBtn) {
      downloadPrintHtmlBtn.addEventListener('click', () => {
        if (state.currentPrintBook) {
          downloadExtensionPrintHtml(state.currentPrintBook, state.printMode);
        }
      });
    }

    const exitPrintModeBtn = document.getElementById('exitPrintModeBtn');
    if (exitPrintModeBtn) {
      exitPrintModeBtn.addEventListener('click', () => {
        document.body.classList.remove('print-mode');
      });
    }

    const triggerPrintNowBtn = document.getElementById('triggerPrintNowBtn');
    if (triggerPrintNowBtn) {
      triggerPrintNowBtn.addEventListener('click', () => {
        window.print();
      });
    }

    const saveBookBtn = document.getElementById('saveBookJsonBtn');
    if (saveBookBtn) {
      saveBookBtn.addEventListener('click', async () => {
        try {
          const pasteArea = document.getElementById('jsonPasteArea');
          const titleInput = document.getElementById('customBookTitleInput');
          const rawJson = pasteArea ? pasteArea.value : '';
          const customTitle = titleInput ? titleInput.value : '';

          const newBook = parseBookJson(rawJson, customTitle);
          state.books.unshift(newBook);
          state.activeBookId = newBook.id;
          state.answerVisible = false;

          await persistAll();
          renderAll();

          if (pasteArea) pasteArea.value = '';
          if (titleInput) titleInput.value = '';
          closeModal('addBookModal');
          showToast(`«${newBook.title}» (${newBook.items.length} سۇئال) ساقلاندى!`, 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    const preparePromptBtn = document.getElementById('preparePromptBtn');
    const promptTopicInput = document.getElementById('promptTopicInput');
    const promptPreviewArea = document.getElementById('promptPreviewArea');

    const updatePromptPreview = () => {
      if (promptPreviewArea) {
        promptPreviewArea.value = buildAiPrompt(promptTopicInput ? promptTopicInput.value : '');
      }
    };

    if (promptTopicInput) {
      promptTopicInput.addEventListener('input', updatePromptPreview);
    }

    if (preparePromptBtn) {
      preparePromptBtn.addEventListener('click', async () => {
        try {
          updatePromptPreview();
          openModal('promptModal');
          const ok = await copyText(promptPreviewArea ? promptPreviewArea.value : buildAiPrompt(''));
          if (ok) {
            showToast('30 سۇئاللىق AI پىرۇمپىتى كۆچۈرۈلدى!', 'success');
          }
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    const copyPromptAgainBtn = document.getElementById('copyPromptAgainBtn');
    if (copyPromptAgainBtn) {
      copyPromptAgainBtn.addEventListener('click', async () => {
        const text = promptPreviewArea ? promptPreviewArea.value : buildAiPrompt('');
        const ok = await copyText(text);
        showToast(ok ? 'پىرۇمپىت كۆچۈرۈلدى!' : 'تېكىستنى قولدا تاللاپ كۆچۈرۈڭ', ok ? 'success' : 'error');
      });
    }

    const testNotifBtn = document.getElementById('testNotificationBtn');
    if (testNotifBtn) {
      testNotifBtn.addEventListener('click', () => {
        try {
          const activeBook = getActiveBook();
          const msg = activeBook && activeBook.items[0]
            ? `${activeBook.title}: ${activeBook.items[0].question}`
            : 'قارلۇق ئۆگىنىش ياردەمچىسى — كۈندىلىك ئەسكەرتىش تەييار!';
          if (typeof chrome !== 'undefined' && chrome.notifications) {
            chrome.notifications.create('karluk-test-' + Date.now(), {
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: 'قارلۇق ئەسكەرتىش (سىناق)',
              message: msg,
              priority: 2
            });
          }
          showToast('سىناق ئەسكەرتىش يوللاندى', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }
  }

  async function init() {
    try {
      const data = await storageGet([
        STORAGE_KEYS.BOOKS,
        STORAGE_KEYS.ACTIVE_BOOK_ID,
        STORAGE_KEYS.SETTINGS
      ]);

      if (Array.isArray(data[STORAGE_KEYS.BOOKS]) && data[STORAGE_KEYS.BOOKS].length > 0) {
        state.books = data[STORAGE_KEYS.BOOKS];
      } else {
        const starter = getDefaultStarterBook();
        state.books = [starter];
        state.activeBookId = starter.id;
        await storageSet({
          [STORAGE_KEYS.BOOKS]: state.books,
          [STORAGE_KEYS.ACTIVE_BOOK_ID]: state.activeBookId
        });
      }

      if (data[STORAGE_KEYS.ACTIVE_BOOK_ID]) {
        state.activeBookId = data[STORAGE_KEYS.ACTIVE_BOOK_ID];
      } else if (state.books[0]) {
        state.activeBookId = state.books[0].id;
      }

      if (data[STORAGE_KEYS.SETTINGS]) {
        const savedSettings = data[STORAGE_KEYS.SETTINGS];
        state.settings = Object.assign({ reminderEnabled: true, theme: 'light', brightness: 100 }, savedSettings);
        state.settings.brightness = clampBrightness(state.settings.brightness);
      }

      bindEvents();
      renderAll();

      const params = new URLSearchParams(window.location.search);
      const printBookId = params.get('printBook');
      if (printBookId) {
        const target = state.books.find((b) => b.id === printBookId) || getActiveBook();
        if (target) {
          renderPrintSheet(target);
          document.body.classList.add('print-mode');
          setTimeout(() => window.print(), 250);
        }
      }
    } catch (err) {
      console.error('Init error:', err);
      showToast('دەسلەپكى قوزغىتىشتا خاتالىق كۆرۈلدى', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
