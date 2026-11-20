import React, { useState } from 'react';
import {
  Bell,
  BookMarked,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileJson2,
  FileText,
  Loader2,
  Printer,
  ShieldCheck,
  Sparkles,
  Upload
} from 'lucide-react';
import {
  BookRecord,
  PdfPageText,
  buildAiPrompt,
  buildSample30BookJson,
  generateLocalQaFromText,
  joinPdfPagesInRange,
  parseBookJson
} from '../lib/karlukCore';
import {
  downloadBookJson,
  extractTextFromPdfFile,
  generateQaViaServer,
  readFileAsBase64
} from '../lib/pdfAndAiClient';

interface TestLabPanelProps {
  books: BookRecord[];
  activeBookId: string | null;
  reminderEnabled: boolean;
  onSelectBook: (bookId: string) => void;
  onAddBook: (book: BookRecord) => void;
  onPrintBookPdf: (book: BookRecord) => void;
  onTriggerStartupPreview: () => void;
  onNotify: (message: string, type: 'success' | 'error') => void;
}

export const TestLabPanel: React.FC<TestLabPanelProps> = ({
  books,
  activeBookId,
  reminderEnabled,
  onSelectBook,
  onAddBook,
  onPrintBookPdf,
  onTriggerStartupPreview,
  onNotify
}) => {
  const [topic, setTopic] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPages, setPdfPages] = useState<PdfPageText[]>([]);
  const [fromPage, setFromPage] = useState(1);
  const [toPage, setToPage] = useState(1);
  const [qaCount, setQaCount] = useState<10 | 20 | 30>(30);
  const [isReadingPdf, setIsReadingPdf] = useState(false);
  const [pdfStatusNote, setPdfStatusNote] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showManualPrompt, setShowManualPrompt] = useState(false);

  const promptText = buildAiPrompt(topic);

  const handleLoad30Sample = () => {
    try {
      const sampleBook = parseBookJson(buildSample30BookJson());
      onAddBook(sampleBook);
      onNotify('30 سۇئاللىق سىناق كىتاب قوشۇلدى ۋە ئايرىم ساقلاندى!', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'خاتالىق كۆرۈلدى', 'error');
    }
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      onNotify('30 سۇئاللىق AI پىرۇمپىتى كۆچۈرۈلدى!', 'success');
    } catch {
      onNotify('پىرۇمپىت تەييارلاندى', 'success');
    }
  };

  const handleDirectJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = String(ev.target?.result || '');
        const fallbackTitle = file.name.replace(/\.json$/i, '');
        const book = parseBookJson(text);
        const finalBook = book.title === 'يېڭى كىتاب' && fallbackTitle ? { ...book, title: fallbackTitle } : book;
        onAddBook(finalBook);
        onNotify(`«${finalBook.title}» (${finalBook.items.length} سۇئال) مۇۋەپپەقىيەتلىك يۈكلەندى!`, 'success');
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'JSON ھۆججىتىنى ئوقۇشتا خاتالىق', 'error');
      }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handlePageRangeUpdate = (nextFrom: number, nextTo: number, pagesOverride?: PdfPageText[]) => {
    const pages = pagesOverride || pdfPages;
    if (pages.length === 0) return;
    const total = pages.length;
    const clampedFrom = Math.max(1, Math.min(total, Number.isFinite(nextFrom) ? Math.round(nextFrom) : 1));
    const clampedTo = Math.max(clampedFrom, Math.min(total, Number.isFinite(nextTo) ? Math.round(nextTo) : total));
    setFromPage(clampedFrom);
    setToPage(clampedTo);
    const sliced = joinPdfPagesInRange(pages, clampedFrom, clampedTo);
    setSourceText(sliced);
    setPdfStatusNote(`${clampedFrom}–${clampedTo}-بەتلەر تاللاندى (${total} بەتتىن · ${sliced.length} ھەرپ)`);
  };

  const handleSourceFileSelect = async (file: File | undefined) => {
    if (!file) return;
    const fallbackTitle = file.name.replace(/\.(pdf|txt|md)$/i, '');
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      setPdfFile(file);
      setPdfPages([]);
      setIsReadingPdf(true);
      setPdfStatusNote('PDF تېكىستى ئوقۇلۇۋاتىدۇ...');
      try {
        const extracted = await extractTextFromPdfFile(file, (curr, total) => {
          setPdfStatusNote(`بەت ${curr} / ${total} ئوقۇلۇۋاتىدۇ...`);
        });
        if (!topic.trim()) {
          setTopic(extracted.metadataTitle || fallbackTitle);
        }
        setPdfPages(extracted.pages);
        setFromPage(1);
        setToPage(Math.max(1, extracted.pageCount));
        if (!extracted.isScanned && extracted.text.length >= 20) {
          setSourceText(extracted.text);
          const msg = `«${file.name}» ئوقۇلدى (${extracted.pageCount} بەت، ${extracted.text.length} ھەرپ) — بەت دائىرىسى ياكى سۇئال سانىنى تاللاڭ.`;
          setPdfStatusNote(msg);
          onNotify(msg, 'success');
        } else {
          const msg = `«${file.name}» (${extracted.pageCount} بەت) رەسىم شەكلىدىكى PDF ئىكەن — «AI بىلەن ${qaCount} سۇئال-جاۋاب ياساش» نى بېسىڭ.`;
          setPdfStatusNote(msg);
          onNotify(msg, 'success');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'PDF ئوقۇشتا خاتالىق كۆرۈلدى';
        setPdfStatusNote('PDF تېكىستىنى يەرلىك يېشىپ بولالمىدى — AI بىلەن ئوقۇتۇپ سىناڭ.');
        onNotify(msg, 'error');
      } finally {
        setIsReadingPdf(false);
      }
      return;
    }
    if (!topic.trim()) {
      setTopic(fallbackTitle);
    }
    setPdfFile(null);
    setPdfPages([]);
    setPdfStatusNote('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      setSourceText(String(ev.target?.result || ''));
      onNotify('تېكىست ھۆججىتى ئوقۇلدى!', 'success');
    };
    reader.onerror = () => onNotify('ھۆججەت ئوقۇشتا خاتالىق', 'error');
    reader.readAsText(file, 'UTF-8');
  };

  const handleGenerateAiQa = async () => {
    if (!pdfFile && !sourceText.trim()) {
      onNotify('PDF ھۆججىتى قېتىڭ ياكى كىتاب/دەرسلىك تېكىستىنى يېزىڭ.', 'error');
      return;
    }
    setIsGenerating(true);
    try {
      const pdfBase64 = pdfFile && !sourceText.trim() ? await readFileAsBase64(pdfFile) : undefined;
      const created = await generateQaViaServer({
        bookTitle: topic.trim() || undefined,
        text: sourceText.trim() || undefined,
        pdfBase64,
        count: qaCount
      });
      onAddBook(created);
      setSourceText('');
      setPdfFile(null);
      setPdfPages([]);
      setPdfStatusNote('');
      onNotify(`«${created.title}» (${created.items.length} سۇئال) بىۋاسىتە ياسىلىپ ساقلاندى!`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'AI سۇئال-جاۋاب ياساشتا خاتالىق كۆرۈلدى', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateLocalOffline = () => {
    try {
      const created = generateLocalQaFromText(sourceText, topic.trim() || undefined, qaCount);
      onAddBook(created);
      setSourceText('');
      setPdfFile(null);
      setPdfPages([]);
      setPdfStatusNote('');
      onNotify(`«${created.title}» (${created.items.length} سۇئال) تور سىرتىدا ياسالدى!`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تېكىستتىن ياساشتا خاتالىق', 'error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Built-in AI & PDF 30 Q&A Generator (No external AI app needed!) */}
      <section className="glass-surface rounded-[22px] p-6" data-testid="built-in-ai-generator">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[19px] font-bold text-[#1A1E24] dark:text-slate-100">
              بىۋاسىتە 30 سۇئال-جاۋاب ياساش (PDF ياكى تېكىستتىن)
            </h2>
            <p className="mt-1 text-[13px] text-[#555D6B] dark:text-slate-400">
              سىرتقى AI پروگراممىلىرىغا بېرىپ يۈرمەستىن، .pdf ھۆججىتى ياكى دەرسلىك تېكىستىنى قېتىپ بىۋاسىتە سۇئال-جاۋاب ياساپ ساقلاڭ ۋە PDF/JSON چىقىرىڭ.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="labTopicInput" className="mb-1 block text-[12.5px] font-semibold text-[#555D6B] dark:text-slate-300">
              كىتاب ياكى دەرسلىك نامى:
            </label>
            <input
              id="labTopicInput"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="مەسىلەن: شەرقىي تۈركىستان مەدەنىيىتى"
              className="w-full rounded-[14px] border border-white/80 bg-white/70 px-3.5 py-2 text-[14px] text-[#1A1E24] outline-none focus:border-[#1F75FE] dark:border-white/15 dark:bg-slate-900/70 dark:text-slate-100"
            />
          </div>

          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleSourceFileSelect(e.dataTransfer.files?.[0]);
            }}
            className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-[16px] border border-dashed border-[#1F75FE]/50 bg-[#1F75FE]/5 px-4 py-3 text-[13px] transition-colors hover:bg-[#1F75FE]/10"
          >
            <span className="flex items-center gap-2 font-medium text-[#1A1E24] dark:text-slate-100">
              {isReadingPdf ? <Loader2 className="h-4 w-4 animate-spin text-[#1F75FE]" /> : <FileText className="h-4 w-4 text-[#1F75FE]" />}
              <span>
                {isReadingPdf
                  ? 'PDF ئوقۇلۇۋاتىدۇ...'
                  : pdfFile
                    ? `قېتىلغان PDF: ${pdfFile.name}`
                    : '.pdf ياكى .txt ھۆججەتنى بۇ يەرگە تاشلاڭ ياكى تاللاڭ'}
              </span>
            </span>
            <span className="flex items-center gap-1 font-bold text-[#1F75FE]">
              <Upload className="h-3.5 w-3.5" />
              <span>PDF / تېكىست قېتىش</span>
            </span>
            <input
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain"
              onChange={(e) => {
                handleSourceFileSelect(e.target.files?.[0]);
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>

          {pdfStatusNote && (
            <div
              data-testid="lab-pdf-status"
              className="rounded-[12px] border border-[#1F75FE]/25 bg-[#1F75FE]/10 px-3.5 py-2 text-[12.5px] font-semibold text-[#1F75FE] dark:text-[#7DB2FF]"
            >
              {pdfStatusNote}
            </div>
          )}

          {/* Smart PDF Page Range + Q&A Count Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-white/75 bg-white/55 px-3.5 py-2.5 dark:border-white/10 dark:bg-slate-900/50">
            {pdfPages.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold" data-testid="lab-pdf-page-range">
                <span className="text-[#555D6B] dark:text-slate-300">بەت دائىرىسى:</span>
                <label className="flex items-center gap-1">
                  <span className="text-[11.5px] text-[#555D6B] dark:text-slate-400">باش</span>
                  <input
                    type="number"
                    min={1}
                    max={pdfPages.length}
                    value={fromPage}
                    onChange={(e) => handlePageRangeUpdate(Number(e.target.value), toPage)}
                    data-testid="lab-from-page"
                    className="tabular-nums w-16 rounded-[10px] border border-white/80 bg-white/85 px-2 py-1 text-center text-[12.5px] font-bold text-[#1A1E24] outline-none focus:border-[#1F75FE] dark:border-white/15 dark:bg-slate-800 dark:text-slate-100"
                  />
                </label>
                <span>—</span>
                <label className="flex items-center gap-1">
                  <span className="text-[11.5px] text-[#555D6B] dark:text-slate-400">ئاخىر</span>
                  <input
                    type="number"
                    min={fromPage}
                    max={pdfPages.length}
                    value={toPage}
                    onChange={(e) => handlePageRangeUpdate(fromPage, Number(e.target.value))}
                    data-testid="lab-to-page"
                    className="tabular-nums w-16 rounded-[10px] border border-white/80 bg-white/85 px-2 py-1 text-center text-[12.5px] font-bold text-[#1A1E24] outline-none focus:border-[#1F75FE] dark:border-white/15 dark:bg-slate-800 dark:text-slate-100"
                  />
                </label>
                <span className="tabular-nums text-[11.5px] text-[#1F75FE]">({pdfPages.length} بەتتىن)</span>
              </div>
            ) : (
              <span className="text-[12px] font-semibold text-[#555D6B] dark:text-slate-300">
                تۈزۈلىدىغان سۇئال-جاۋاب سانى:
              </span>
            )}

            <div className="flex items-center gap-1.5" role="group" aria-label="سۇئال سانى">
              {([10, 20, 30] as const).map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setQaCount(cnt)}
                  data-testid={`lab-qa-count-${cnt}`}
                  className={`tabular-nums cursor-pointer rounded-full px-3 py-1 text-[12px] font-bold transition-colors ${
                    qaCount === cnt
                      ? 'primary-glass-cta text-white'
                      : 'glass-pill text-[#1A1E24] dark:text-slate-200'
                  }`}
                >
                  {cnt} سۇئال
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="labSourceTextarea" className="mb-1 block text-[12.5px] font-semibold text-[#555D6B] dark:text-slate-300">
              ياكى كىتاب / ماقالە مەزمۇنىنى بۇ يەرگە چاپلاڭ:
            </label>
            <textarea
              id="labSourceTextarea"
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="بۇ يەرگە دەرسلىك مەزمۇنىنى چاپلاڭ ياكى يۇقىرىدىن .pdf ھۆججىتى تاللاڭ..."
              className="min-h-[110px] w-full rounded-[16px] border border-white/80 bg-white/70 p-3.5 text-[13.5px] leading-relaxed text-[#1A1E24] outline-none focus:border-[#1F75FE] dark:border-white/15 dark:bg-slate-900/70 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={isGenerating || isReadingPdf}
              onClick={handleGenerateAiQa}
              className="primary-glass-cta flex cursor-pointer items-center gap-2 rounded-full px-5 py-2.5 text-[13.5px] font-bold text-white transition-transform duration-150 hover:-translate-y-0.5 active:scale-97 disabled:opacity-60"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span>{isGenerating ? 'AI تەھلىل قىلىۋاتىدۇ...' : `AI بىلەن ${qaCount} سۇئال-جاۋاب ياساش`}</span>
            </button>

            <button
              type="button"
              disabled={isReadingPdf}
              onClick={handleGenerateLocalOffline}
              data-testid="lab-generate-offline-btn"
              className="glass-pill flex cursor-pointer items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-[#1A1E24] transition-transform duration-150 hover:-translate-y-0.5 active:scale-97 disabled:opacity-60 dark:text-slate-100"
            >
              <span>تور سىرتىدا تېز ياساش ({qaCount} سۇئال)</span>
            </button>
          </div>
        </div>
      </section>

      {/* Quick Actions & Manual Tools */}
      <section className="glass-surface rounded-[22px] p-5">
        <div className="flex flex-wrap gap-2.5">
          <label className="glass-pill flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold text-[#1A1E24] transition-transform duration-150 hover:-translate-y-0.5 active:scale-97 dark:text-slate-100">
            <FileJson2 className="h-4 w-4 text-[#1FA982]" />
            <span>JSON ھۆججەت يۈكلەش</span>
            <input type="file" accept=".json,application/json,text/plain" onChange={handleDirectJsonUpload} className="hidden" />
          </label>

          <button
            type="button"
            onClick={handleLoad30Sample}
            className="glass-pill flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold text-[#1A1E24] transition-transform duration-150 hover:-translate-y-0.5 active:scale-97 dark:text-slate-100"
          >
            <FileJson2 className="h-4 w-4 text-[#1F75FE]" />
            <span>30 سۇئاللىق ئۈلگە قوشۇش</span>
          </button>

          <button
            type="button"
            onClick={onTriggerStartupPreview}
            className="glass-pill flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold text-[#1A1E24] transition-transform duration-150 hover:-translate-y-0.5 active:scale-97 dark:text-slate-100"
          >
            <Bell className="h-4 w-4 text-[#F05A28]" />
            <span>ئېچىلىش ئەسكەرتىشى سىنىقى</span>
          </button>

          <button
            type="button"
            aria-expanded={showManualPrompt}
            onClick={() => setShowManualPrompt((v) => !v)}
            className="glass-pill flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-[#555D6B] dark:text-slate-300"
          >
            <span>قولدا پىرۇمپىت كۆچۈرۈش</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${showManualPrompt ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {showManualPrompt && (
          <div className="mt-4 border-t border-slate-900/10 pt-4 dark:border-white/10">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[13px] font-bold">تاشقى AI مودېلى ئۈچۈن پىرۇمپىت:</span>
              <button
                type="button"
                onClick={handleCopyPrompt}
                className="glass-pill flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1 text-[12px] font-semibold text-[#1F75FE]"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>كۆچۈرۈش</span>
              </button>
            </div>
            <pre className="max-h-40 max-w-full overflow-x-auto overflow-y-auto rounded-[16px] border border-white/75 bg-white/60 p-3 text-[12px] leading-relaxed whitespace-pre-wrap break-words text-[#1A1E24] dark:border-white/10 dark:bg-slate-900/65 dark:text-slate-200">
              {promptText}
            </pre>
          </div>
        )}
      </section>

      {/* Persistent Separate Books Inspector with JSON + PDF Export */}
      <section className="glass-surface rounded-[22px] p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookMarked className="h-5 w-5 text-[#F05A28]" />
            <h3 className="text-[17px] font-bold text-[#1A1E24] dark:text-slate-100">
              ساقلانغان ئايرىم كىتابلار ({books.length})
            </h3>
          </div>
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#1FA982]">
            <ShieldCheck className="h-4 w-4" />
            <span>{reminderEnabled ? 'ئېچىلىش ئەسكەرتىشى: ئوچۇق' : 'ئېچىلىش ئەسكەرتىشى: تاقاق'}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {books.map((book) => {
            const isActive = book.id === activeBookId;
            return (
              <div
                key={book.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-[16px] border px-4 py-3 transition-all duration-150 ${
                  isActive
                    ? 'border-[#F05A28]/60 bg-[#F05A28]/10 dark:border-[#F78C2B]/50 dark:bg-[#F05A28]/15'
                    : 'border-white/75 bg-white/55 hover:border-[#1F75FE]/50 dark:border-white/10 dark:bg-slate-900/50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectBook(book.id)}
                  className="min-w-0 flex-1 cursor-pointer text-right"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-bold text-[#1A1E24] dark:text-slate-100">
                      {book.title}
                    </span>
                    {isActive && (
                      <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-bold text-[#F05A28]">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>ئاكتىپ</span>
                      </span>
                    )}
                  </div>
                  <div className="tabular-nums mt-0.5 text-[12px] text-[#555D6B] dark:text-slate-400">
                    {book.items.length} سۇئال · ئۆگەنگەن: {book.masteredIds.length} · نۆۋەتتىكى: {book.currentIndex + 1}
                  </div>
                </button>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      downloadBookJson(book);
                      onNotify(`«${book.title}» JSON چۈشۈرۈلدى`, 'success');
                    }}
                    aria-label={`${book.title} نى JSON چىقىرىش`}
                    className="glass-pill cursor-pointer rounded-full px-3 py-1 text-[12px] font-semibold text-[#1A1E24] dark:text-slate-100"
                  >
                    JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => onPrintBookPdf(book)}
                    aria-label={`${book.title} نى PDF چىقىرىش`}
                    className="glass-pill flex cursor-pointer items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold text-[#1F75FE]"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>PDF چىقىرىش</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
