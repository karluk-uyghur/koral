import React, { useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  Moon,
  Plus,
  Printer,
  Settings,
  Sparkles,
  Sun,
  SunMedium,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import {
  BRIGHTNESS_DEFAULT,
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  BookRecord,
  KarlukSettings,
  PdfPageText,
  buildAiPrompt,
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

interface ExtensionSimulatorProps {
  books: BookRecord[];
  activeBookId: string | null;
  settings: KarlukSettings;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelectBook: (bookId: string) => void;
  onAddBook: (book: BookRecord) => void;
  onDeleteBook: (bookId: string) => void;
  onUpdateBookIndex: (bookId: string, nextIndex: number) => void;
  onToggleMastered: (bookId: string, itemId: number | string) => void;
  onToggleReminder: () => void;
  onToggleTheme: () => void;
  onChangeBrightness: (nextValue: number) => void;
  onTriggerStartupPreview: () => void;
  onPrintBookPdf: (book: BookRecord) => void;
  onNotify: (message: string, type: 'success' | 'error') => void;
}

type ActiveModal = 'add' | 'export' | 'prompt' | 'settings' | null;
type AddModeTab = 'auto' | 'json';

export const ExtensionSimulator: React.FC<ExtensionSimulatorProps> = ({
  books,
  activeBookId,
  settings,
  isExpanded,
  onToggleExpand,
  onSelectBook,
  onAddBook,
  onDeleteBook,
  onUpdateBookIndex,
  onToggleMastered,
  onToggleReminder,
  onToggleTheme,
  onChangeBrightness,
  onTriggerStartupPreview,
  onPrintBookPdf,
  onNotify
}) => {
  const [answerVisible, setAnswerVisible] = useState(false);
  const [modal, setModal] = useState<ActiveModal>(null);
  const [addTab, setAddTab] = useState<AddModeTab>('auto');
  const [customTitle, setCustomTitle] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const [rawStudyText, setRawStudyText] = useState('');
  const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null);
  const [pdfPages, setPdfPages] = useState<PdfPageText[]>([]);
  const [fromPage, setFromPage] = useState(1);
  const [toPage, setToPage] = useState(1);
  const [qaCount, setQaCount] = useState<10 | 20 | 30>(30);
  const [isReadingPdf, setIsReadingPdf] = useState(false);
  const [pdfStatusNote, setPdfStatusNote] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [promptTopic, setPromptTopic] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const activeBook = books.find((b) => b.id === activeBookId) || books[0] || null;
  const totalItems = activeBook ? activeBook.items.length : 0;
  const safeIndex = activeBook && totalItems > 0 ? Math.max(0, Math.min(activeBook.currentIndex, totalItems - 1)) : 0;
  const currentItem = activeBook && totalItems > 0 ? activeBook.items[safeIndex] : null;
  const masteredCount = activeBook ? activeBook.masteredIds.length : 0;
  const isCurrentMastered = Boolean(currentItem && activeBook?.masteredIds.includes(currentItem.id));
  const progressPct = totalItems > 0 ? Math.round(((safeIndex + 1) / totalItems) * 100) : 0;

  const promptText = buildAiPrompt(promptTopic);

  const handleCopyPrompt = async (openDialog: boolean) => {
    if (openDialog) {
      setModal('prompt');
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(promptText);
      }
      onNotify('30 سۇئاللىق AI پىرۇمپىتى كۆچۈرۈلدى!', 'success');
    } catch {
      onNotify('پىرۇمپىت تەييارلاندى، تېكىستنى كۆچۈرۈپ ئىشلىتىڭ.', 'success');
    }
  };

  const readJsonFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = String(ev.target?.result || '');
      setJsonInput(content);
      if (!customTitle.trim()) {
        setCustomTitle(file.name.replace(/\.json$/i, ''));
      }
      onNotify('JSON ھۆججىتى ئوقۇلدى، «ساقلاش» نى بېسىڭ', 'success');
    };
    reader.onerror = () => {
      onNotify('ھۆججەت ئوقۇشتا خاتالىق كۆرۈلدى', 'error');
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleSimPageRangeUpdate = (nextFrom: number, nextTo: number) => {
    if (pdfPages.length === 0) return;
    const total = pdfPages.length;
    const clampedFrom = Math.max(1, Math.min(total, Number.isFinite(nextFrom) ? Math.round(nextFrom) : 1));
    const clampedTo = Math.max(clampedFrom, Math.min(total, Number.isFinite(nextTo) ? Math.round(nextTo) : total));
    setFromPage(clampedFrom);
    setToPage(clampedTo);
    const sliced = joinPdfPagesInRange(pdfPages, clampedFrom, clampedTo);
    setRawStudyText(sliced);
    setPdfStatusNote(`${clampedFrom}–${clampedTo}-بەتلەر تاللاندى (${total} بەتتىن · ${sliced.length} ھەرپ)`);
  };

  const handlePdfOrTextSelect = async (file: File | undefined) => {
    if (!file) return;
    const fallbackTitle = file.name.replace(/\.(pdf|txt|md)$/i, '');
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      setSelectedPdfFile(file);
      setPdfPages([]);
      setIsReadingPdf(true);
      setPdfStatusNote('PDF ئوقۇلۇۋاتىدۇ...');
      try {
        const extracted = await extractTextFromPdfFile(file, (curr, total) => {
          setPdfStatusNote(`بەت ${curr} / ${total} ئوقۇلۇۋاتىدۇ...`);
        });
        if (!customTitle.trim()) {
          setCustomTitle(extracted.metadataTitle || fallbackTitle);
        }
        setPdfPages(extracted.pages);
        setFromPage(1);
        setToPage(Math.max(1, extracted.pageCount));
        if (!extracted.isScanned && extracted.text.length >= 20) {
          setRawStudyText(extracted.text);
          const msg = `«${file.name}» ئوقۇلدى (${extracted.pageCount} بەت، ${extracted.text.length} ھەرپ)`;
          setPdfStatusNote(msg);
          onNotify(msg, 'success');
        } else {
          const msg = `«${file.name}» (${extracted.pageCount} بەت) رەسىم شەكلىدىكى PDF ئىكەن — «AI بىلەن ياساش» نى بېسىڭ.`;
          setPdfStatusNote(msg);
          onNotify(msg, 'success');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'PDF تېكىستىنى يېشىشتە خاتالىق كۆرۈلدى';
        setPdfStatusNote('PDF نى بىۋاسىتە يېشىپ بولالمىدى — AI ئارقىلىق ئوقۇتۇڭ.');
        onNotify(msg, 'error');
      } finally {
        setIsReadingPdf(false);
      }
      return;
    }
    if (!customTitle.trim()) {
      setCustomTitle(fallbackTitle);
    }
    setSelectedPdfFile(null);
    setPdfPages([]);
    setPdfStatusNote('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      setRawStudyText(String(ev.target?.result || ''));
      onNotify('تېكىست ھۆججىتى ئوقۇلدى!', 'success');
    };
    reader.onerror = () => onNotify('ھۆججەت ئوقۇشتا خاتالىق كۆرۈلدى', 'error');
    reader.readAsText(file, 'UTF-8');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    readJsonFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const handleGenerateViaAi = async () => {
    if (!selectedPdfFile && !rawStudyText.trim()) {
      onNotify('PDF ھۆججىتى تاللاڭ ياكى دەرسلىك تېكىستىنى يېزىڭ.', 'error');
      return;
    }
    setIsGenerating(true);
    try {
      const pdfBase64 = selectedPdfFile && !rawStudyText.trim() ? await readFileAsBase64(selectedPdfFile) : undefined;
      const created = await generateQaViaServer({
        bookTitle: customTitle.trim() || undefined,
        text: rawStudyText.trim() || undefined,
        pdfBase64,
        count: qaCount
      });
      onAddBook(created);
      setRawStudyText('');
      setSelectedPdfFile(null);
      setPdfPages([]);
      setPdfStatusNote('');
      setCustomTitle('');
      setAnswerVisible(false);
      setModal(null);
      onNotify(`«${created.title}» (${created.items.length} سۇئال) AI ئارقىلىق ياسالدى!`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'AI سۇئال-جاۋاب ياساشتا خاتالىق', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateLocalOffline = () => {
    try {
      const created = generateLocalQaFromText(rawStudyText, customTitle, qaCount);
      onAddBook(created);
      setRawStudyText('');
      setSelectedPdfFile(null);
      setPdfPages([]);
      setPdfStatusNote('');
      setCustomTitle('');
      setAnswerVisible(false);
      setModal(null);
      onNotify(`«${created.title}» (${created.items.length} سۇئال) تور سىرتىدا ياسالدى!`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تېكىستتىن ياساشتا خاتالىق', 'error');
    }
  };

  const handleSaveNewBook = () => {
    try {
      const created = parseBookJson(jsonInput, customTitle);
      onAddBook(created);
      setJsonInput('');
      setCustomTitle('');
      setAnswerVisible(false);
      setModal(null);
      onNotify(`«${created.title}» (${created.items.length} سۇئال) مەڭگۈلۈك ساقلاندى!`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'JSON دەلىللەشتە خاتالىق كۆرۈلدى', 'error');
    }
  };

  const handleExportBook = (book: BookRecord) => {
    try {
      downloadBookJson(book);
      onNotify(`«${book.title}» JSON قىلىپ چۈشۈرۈلدى`, 'success');
    } catch {
      onNotify('ھۆججەت چىقىرىشتا خاتالىق كۆرۈلدى', 'error');
    }
  };

  return (
    <div
      className={`relative mx-auto w-full transition-all duration-300 ${
        isExpanded ? 'max-w-[1040px]' : 'max-w-[376px]'
      }`}
      data-testid="extension-popup-frame"
      data-expanded={isExpanded ? 'true' : 'false'}
    >
      {/* Chrome Extension Frame (Synchronized scaling between 376px Popup & Full-Screen mode) */}
      <div
        className={`glass-surface relative rounded-[26px] text-[#1A1E24] dark:text-slate-100 ${
          isExpanded ? 'p-5 sm:p-6' : 'p-3'
        }`}
      >
        {/* Top Row: Right = Logo (لوگو), Left = Tool Name (قورال ئىسمى) */}
        <div
          className={`mb-3 grid items-center transition-all duration-300 ${
            isExpanded
              ? 'grid-cols-[64px_1fr] gap-3 sm:grid-cols-[200px_1fr] sm:gap-4'
              : 'grid-cols-[54px_1fr] gap-2.5'
          }`}
          data-testid="sim-header-grid"
        >
          <div
            className={`primary-glass-cta relative flex items-center justify-center gap-2 overflow-hidden font-bold text-white transition-all duration-300 ${
              isExpanded ? 'h-[64px] w-full rounded-[20px] px-3' : 'h-[54px] w-[54px] rounded-[18px]'
            }`}
            aria-label="قارلۇق لوگوسى"
          >
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
              <path
                d="M15.5 4.5C10.5 4.5 6.5 8.5 6.5 14C6.5 19.5 10.5 23.5 15.5 23.5C12.8 21.8 11.2 18.2 11.2 14C11.2 9.8 12.8 6.2 15.5 4.5Z"
                fill="#FFFFFF"
              />
              <path
                d="M17 9.5C18.8 9.5 20.5 10.2 21.8 11.2V19.2C20.5 18.3 18.8 17.8 17 17.8C15.8 17.8 14.8 18.1 14 18.6V10.6C14.8 10 15.8 9.5 17 9.5Z"
                stroke="#FFFFFF"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
            {isExpanded && <span className="hidden text-[16px] sm:inline">قارلۇق</span>}
          </div>

          <div
            className={`glass-surface flex items-center justify-between gap-2 rounded-[20px] transition-all duration-300 ${
              isExpanded ? 'min-h-[64px] px-5 py-2.5' : 'min-h-[54px] px-3.5 py-2'
            }`}
          >
            <div className="min-w-0">
              <div
                className={`font-bold leading-snug text-[#1A1E24] dark:text-slate-100 ${
                  isExpanded ? 'text-[18px] sm:text-[20px]' : 'text-[14.5px]'
                }`}
              >
                قارلۇق ئۆگىنىش ياردەمچىسى
              </div>
              <div
                className={`tabular-nums text-[#555D6B] dark:text-slate-400 ${
                  isExpanded ? 'text-[12.5px]' : 'text-[11px]'
                }`}
              >
                {books.length} كىتاب ساقلاندى · نۆل ئىز قوغلاش
              </div>
            </div>

            <button
              type="button"
              onClick={onToggleExpand}
              aria-label={isExpanded ? 'كىچىك كۆزنەك ھالىتى (376px)' : 'چوڭ ئېكران ھالىتى'}
              title={isExpanded ? 'كىچىك كۆزنەك ھالىتى' : 'چوڭ ئېكران ھالىتى'}
              data-testid="toggle-expand-btn"
              className="glass-pill flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[11px] px-2 text-[11.5px] font-bold text-[#1A1E24] transition-transform duration-150 hover:-translate-y-0.5 active:scale-95 dark:text-slate-100"
            >
              {isExpanded ? <Minimize2 className="h-3.5 w-3.5 text-[#F05A28]" /> : <Maximize2 className="h-3.5 w-3.5 text-[#1F75FE]" />}
              {isExpanded && <span className="px-0.5">كىچىك كۆزنەك</span>}
            </button>
          </div>
        </div>

        {/* Main 2-column Grid: Right = Settings Rail, Left = Main Stack (Both scale together!) */}
        <div
          className={`grid items-stretch transition-all duration-300 ${
            isExpanded
              ? 'grid-cols-[64px_1fr] gap-3 sm:grid-cols-[200px_1fr] sm:gap-4'
              : 'grid-cols-[54px_1fr] gap-2.5'
          }`}
          data-testid="sim-workspace-grid"
        >
          {/* Right Vertical Settings Rail (تەڭشەك) */}
          <aside
            className={`glass-surface flex flex-col justify-between rounded-[22px] transition-all duration-300 ${
              isExpanded ? 'items-stretch px-2 py-4 sm:px-3.5' : 'items-center px-1.5 py-3'
            }`}
            aria-label="تەڭشەك بالدىقى"
            data-testid="sim-settings-rail"
          >
            <span
              className={`font-semibold text-[#555D6B] dark:text-slate-300 ${
                isExpanded ? 'border-b border-slate-900/10 pb-2 text-center text-[12px] sm:text-right sm:text-[14px] dark:border-white/10' : 'text-[11px]'
              }`}
            >
              تەڭشەك
            </span>

            <div className={`flex flex-col gap-3 ${isExpanded ? 'items-stretch' : 'items-center'}`}>
              {/* Startup Reminder Switch */}
              <div
                className={`flex items-center gap-1.5 ${
                  isExpanded
                    ? 'flex-col sm:flex-row sm:justify-between sm:rounded-[14px] sm:border sm:border-white/75 sm:bg-white/55 sm:px-2.5 sm:py-2 dark:sm:border-white/10 dark:sm:bg-slate-900/50'
                    : 'flex-col'
                }`}
              >
                {isExpanded && (
                  <span className="hidden text-[12px] font-semibold text-[#1A1E24] sm:inline dark:text-slate-200">
                    ئەسكەرتىش
                  </span>
                )}
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.reminderEnabled}
                    aria-label="تور كۆرگۈچ ئېچىلغاندا ئەسكەرتىش"
                    onClick={onToggleReminder}
                    className={`relative h-6 w-10 cursor-pointer rounded-full border border-white/75 transition-all duration-200 focus-visible:outline-2 focus-visible:outline-[#1F75FE] ${
                      settings.reminderEnabled
                        ? 'bg-gradient-to-b from-[#27C497] to-[#1FA982] shadow-[0_6px_14px_-4px_rgba(31,169,130,0.45)]'
                        : 'bg-slate-400/40 dark:bg-slate-600/60'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
                        settings.reminderEnabled ? '-translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  {!isExpanded && (
                    <span className="text-[10px] text-[#555D6B] dark:text-slate-400">
                      {settings.reminderEnabled ? 'ئوچۇق' : 'تاقاق'}
                    </span>
                  )}
                </div>
              </div>

              {/* Theme Toggle */}
              <button
                type="button"
                onClick={onToggleTheme}
                aria-label={settings.theme === 'dark' ? 'يورۇق ھالەتكە ئۆزگەرتىش' : 'قاراڭغۇ ھالەتكە ئۆزگەرتىش'}
                className={`glass-pill flex cursor-pointer items-center rounded-[14px] text-[#1A1E24] transition-transform duration-150 hover:-translate-y-0.5 active:scale-95 dark:text-slate-100 ${
                  isExpanded ? 'h-10 w-full justify-center gap-2.5 sm:justify-start sm:px-3' : 'h-10 w-10 justify-center'
                }`}
              >
                {settings.theme === 'dark' ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
                {isExpanded && <span className="hidden text-[12.5px] font-semibold sm:inline">كۈندۈز / تۈن</span>}
              </button>

              {/* Brightness Quick Control in Settings Rail */}
              {isExpanded ? (
                <div className="hidden flex-col gap-1.5 rounded-[14px] border border-white/75 bg-white/55 px-2.5 py-2 sm:flex dark:border-white/10 dark:bg-slate-900/50">
                  <div className="flex items-center justify-between gap-1 text-[11.5px] font-semibold text-[#1A1E24] dark:text-slate-200">
                    <span className="flex items-center gap-1">
                      <SunMedium className="h-3.5 w-3.5 text-[#F05A28]" />
                      <span>يورۇقلۇق</span>
                    </span>
                    <span className="tabular-nums text-[11px] font-bold text-[#F05A28]" data-testid="rail-brightness-value">
                      {settings.brightness}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onChangeBrightness(settings.brightness - 10)}
                      aria-label="يورۇقلۇقنى پەسەيتىش"
                      className="glass-pill flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-[13px] font-bold"
                    >
                      -
                    </button>
                    <input
                      type="range"
                      min={BRIGHTNESS_MIN}
                      max={BRIGHTNESS_MAX}
                      step={5}
                      value={settings.brightness}
                      onChange={(e) => onChangeBrightness(Number(e.target.value))}
                      aria-label="ئېكران يورۇقلۇقىنى تەڭشەش"
                      data-testid="rail-brightness-slider"
                      className="h-1.5 w-full min-w-0 cursor-pointer accent-[#F05A28]"
                    />
                    <button
                      type="button"
                      onClick={() => onChangeBrightness(settings.brightness + 10)}
                      aria-label="يورۇقلۇقنى ئاشۇرۇش"
                      className="glass-pill flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-[13px] font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setModal('settings')}
                aria-label={`يورۇقلۇق تەڭشىكى (${settings.brightness}%)`}
                title={`يورۇقلۇق: ${settings.brightness}%`}
                className={`glass-pill relative flex cursor-pointer items-center justify-center rounded-[14px] text-[#1A1E24] transition-transform duration-150 hover:-translate-y-0.5 active:scale-95 dark:text-slate-100 ${
                  isExpanded ? 'h-10 w-full sm:hidden' : 'h-10 w-10'
                }`}
              >
                <SunMedium className="h-4 w-4 shrink-0 text-[#F05A28]" />
                <span className="tabular-nums absolute -top-1 -left-1 rounded-full bg-[#1F75FE] px-1 text-[9px] font-bold text-white">
                  {settings.brightness}%
                </span>
              </button>

              {/* Books Library */}
              <button
                type="button"
                onClick={() => setModal('export')}
                aria-label="بارلىق كىتابلار تىزىملىكى"
                className={`glass-pill relative flex cursor-pointer items-center rounded-[14px] text-[#1A1E24] transition-transform duration-150 hover:-translate-y-0.5 active:scale-95 dark:text-slate-100 ${
                  isExpanded ? 'h-10 w-full justify-center gap-2.5 sm:justify-start sm:px-3' : 'h-10 w-10 justify-center'
                }`}
              >
                <BookOpen className="h-4 w-4 shrink-0" />
                {isExpanded && <span className="hidden text-[12.5px] font-semibold sm:inline">كىتابلار</span>}
                <span
                  className={`tabular-nums flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#F05A28] px-1 text-[10px] font-bold text-white ${
                    isExpanded ? 'absolute -top-1 -left-1 sm:static sm:mr-auto' : 'absolute -top-1 -left-1'
                  }`}
                >
                  {books.length}
                </span>
              </button>
            </div>

            {/* Settings Modal Button */}
            <button
              type="button"
              onClick={() => setModal('settings')}
              aria-label="تەپسىلىي تەڭشەك كۆزنىكى"
              className={`glass-pill flex cursor-pointer items-center rounded-[14px] text-[#1A1E24] transition-transform duration-150 hover:-translate-y-0.5 active:scale-95 dark:text-slate-100 ${
                isExpanded ? 'h-10 w-full justify-center gap-2.5 sm:justify-start sm:px-3' : 'h-10 w-10 justify-center'
              }`}
            >
              <Settings className="h-4 w-4 shrink-0" />
              {isExpanded && <span className="hidden text-[12.5px] font-semibold sm:inline">تەپسىلىي تەڭشەك</span>}
            </button>
          </aside>

          {/* Left Main Content Stack */}
          <div className={`flex min-w-0 flex-col ${isExpanded ? 'gap-4' : 'gap-2.5'}`} data-testid="sim-main-column">
            {/* Reminders / Study Q&A Card (ئەسكەرتىملەر) */}
            <section
              className={`glass-surface flex flex-col rounded-[22px] ${isExpanded ? 'gap-3.5 p-5 sm:p-6' : 'gap-2.5 p-3.5'}`}
              aria-label="ئەسكەرتىملەر"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className={`font-bold text-[#1A1E24] dark:text-slate-100 ${isExpanded ? 'text-[18px]' : 'text-[15px]'}`}>
                  ئەسكەرتىملەر
                </h2>
                <span className="tabular-nums text-[12px] text-[#555D6B] dark:text-slate-300" data-testid="popup-qa-counter">
                  {totalItems > 0 ? `${safeIndex + 1} / ${totalItems} · ئۆگەنگەن: ${masteredCount}` : '0 / 0'}
                </span>
              </div>

              <select
                aria-label="كىتاب تاللاش"
                value={activeBook?.id || ''}
                onChange={(e) => {
                  onSelectBook(e.target.value);
                  setAnswerVisible(false);
                }}
                className="w-full cursor-pointer rounded-[14px] border border-white/80 bg-white/65 px-3 py-1.5 text-[13px] font-semibold text-[#1A1E24] outline-none focus:border-[#1F75FE] dark:border-white/15 dark:bg-slate-900/70 dark:text-slate-100"
              >
                {books.length === 0 ? (
                  <option value="">كىتاب يوق</option>
                ) : (
                  books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title} ({b.items.length} سۇئال)
                    </option>
                  ))
                )}
              </select>

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-900/10 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-[#F78C2B] to-[#F05A28] transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {currentItem ? (
                <div
                  className={`flex flex-col rounded-[16px] border border-white/75 bg-white/60 dark:border-white/10 dark:bg-slate-900/60 ${
                    isExpanded ? 'gap-3 p-5' : 'gap-2 p-3'
                  }`}
                >
                  <div className="text-[11.5px] font-semibold text-[#F05A28]">{currentItem.category}</div>
                  <p
                    className={`uyghur-paragraph text-[#1A1E24] dark:text-slate-100 ${
                      isExpanded ? 'text-[16px]' : 'text-[13.5px]'
                    }`}
                  >
                    {currentItem.question}
                  </p>

                  <button
                    type="button"
                    onClick={() => setAnswerVisible((v) => !v)}
                    className="w-full cursor-pointer rounded-full border border-[#1F75FE]/35 bg-[#1F75FE]/10 px-3 py-1.5 text-[12.5px] font-semibold text-[#1F75FE] transition-colors hover:bg-[#1F75FE]/15 dark:text-[#7DB2FF]"
                  >
                    {answerVisible ? 'جاۋابنى يوشۇرۇش' : 'جاۋابنى كۆرۈش'}
                  </button>

                  {answerVisible && (
                    <div className="border-t border-slate-900/10 pt-2.5 dark:border-white/10">
                      <div className="mb-1 text-[11.5px] font-bold text-[#1FA982]">جاۋاب:</div>
                      <p
                        className={`uyghur-paragraph text-[#1A1E24] dark:text-slate-200 ${
                          isExpanded ? 'text-[15.5px]' : 'text-[13px]'
                        }`}
                      >
                        {currentItem.answer}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-[16px] border border-white/70 bg-white/50 p-4 text-center text-[13px] text-[#555D6B] dark:border-white/10 dark:bg-slate-900/50 dark:text-slate-300">
                  ھازىرچە كىتاب تېپىلمىدى. «كىتاپ قوشۇش» نى بېسىڭ.
                </div>
              )}

              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                <button
                  type="button"
                  disabled={!activeBook || totalItems === 0}
                  onClick={() => {
                    if (!activeBook) return;
                    setAnswerVisible(false);
                    onUpdateBookIndex(activeBook.id, (safeIndex - 1 + totalItems) % totalItems);
                  }}
                  className="glass-pill cursor-pointer rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-[#1A1E24] transition-transform duration-150 hover:-translate-y-0.5 active:scale-95 disabled:opacity-45 dark:text-slate-100"
                >
                  ئالدىنقى
                </button>

                <button
                  type="button"
                  disabled={!activeBook || !currentItem}
                  onClick={() => {
                    if (!activeBook || !currentItem) return;
                    onToggleMastered(activeBook.id, currentItem.id);
                  }}
                  className={`flex cursor-pointer items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-transform duration-150 hover:-translate-y-0.5 active:scale-95 disabled:opacity-45 ${
                    isCurrentMastered
                      ? 'border border-white/60 bg-gradient-to-b from-[#27C497] to-[#1FA982] text-white shadow-[0_6px_14px_-4px_rgba(31,169,130,0.42)]'
                      : 'glass-pill text-[#1A1E24] dark:text-slate-100'
                  }`}
                >
                  {isCurrentMastered && <Check className="h-3.5 w-3.5" />}
                  <span>{isCurrentMastered ? 'ئۆگىنىلدى' : 'ئۆگەندىم'}</span>
                </button>

                <button
                  type="button"
                  disabled={!activeBook || totalItems === 0}
                  onClick={() => {
                    if (!activeBook) return;
                    setAnswerVisible(false);
                    onUpdateBookIndex(activeBook.id, (safeIndex + 1) % totalItems);
                  }}
                  className="glass-pill cursor-pointer rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-[#1A1E24] transition-transform duration-150 hover:-translate-y-0.5 active:scale-95 disabled:opacity-45 dark:text-slate-100"
                >
                  كېيىنكى
                </button>
              </div>
            </section>

            {/* Dual Action Buttons: Add Book / Export Book */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setModal('add')}
                className="glass-pill flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-[20px] px-2.5 py-2 text-[12.5px] font-bold text-[#1A1E24] whitespace-nowrap transition-transform duration-150 hover:-translate-y-0.5 active:scale-95 dark:text-slate-100"
              >
                <Plus className="h-3.5 w-3.5 shrink-0 text-[#1F75FE]" />
                <span>كىتاپ قوشۇش</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmId(null);
                  setModal('export');
                }}
                className="glass-pill flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-[20px] px-2.5 py-2 text-[12.5px] font-bold text-[#1A1E24] whitespace-nowrap transition-transform duration-150 hover:-translate-y-0.5 active:scale-95 dark:text-slate-100"
              >
                <Download className="h-3.5 w-3.5 shrink-0 text-[#F05A28]" />
                <span>كىتاپ چىقىرىش</span>
              </button>
            </div>

            {/* Bottom Primary CTA: Prepare Prompt for AI */}
            <button
              type="button"
              onClick={() => handleCopyPrompt(true)}
              className="primary-glass-cta relative flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full px-4 py-2.5 text-[14px] font-bold text-white transition-transform duration-150 hover:-translate-y-0.5 active:scale-97"
            >
              <Copy className="h-4 w-4" />
              <span>ئىئاي ئۈچۈن پىرۇمپىت تەييارلاش</span>
            </button>
          </div>
        </div>

        {/* Popup Internal Modals */}
        {modal && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center rounded-[26px] bg-slate-950/45 p-3 backdrop-blur-md"
            role="dialog"
            aria-modal="true"
          >
            <div
              className={`flex max-h-full w-full flex-col gap-3 overflow-y-auto rounded-[22px] border border-white/75 bg-[#EEF0F4] p-4 text-[#1A1E24] shadow-2xl dark:border-white/15 dark:bg-[#151C28] dark:text-slate-100 ${
                isExpanded ? 'max-w-xl p-6' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[14.5px] font-bold">
                  {modal === 'add' && 'كىتاپ قوشۇش (PDF / تېكىست / JSON)'}
                  {modal === 'export' && 'كىتاپ چىقىرىش (JSON / PDF) ۋە باشقۇرۇش'}
                  {modal === 'prompt' && 'ئىئاي ئۈچۈن پىرۇمپىت تەييارلاش'}
                  {modal === 'settings' && 'تەڭشەك ۋە ئەسكەرتىش'}
                </h3>
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  aria-label="كۆزنەكنى تاقاش"
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-slate-900/10 bg-white/70 text-[#1A1E24] dark:border-white/15 dark:bg-slate-800 dark:text-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {modal === 'add' && (
                <>
                  <div>
                    <label htmlFor="simBookTitle" className="mb-1 block text-[12px] font-semibold text-[#555D6B] dark:text-slate-300">
                      كىتاب ياكى بىلىم نامى (ئىختىيارىي)
                    </label>
                    <input
                      id="simBookTitle"
                      type="text"
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      placeholder="مەسىلەن: شەرقىي تۈركىستان تارىخى"
                      className="w-full rounded-[14px] border border-white/80 bg-white/75 px-3 py-2 text-[13px] outline-none focus:border-[#1F75FE] dark:border-white/15 dark:bg-slate-900/70"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 rounded-[16px] border border-white/70 bg-white/50 p-1 dark:border-white/10 dark:bg-slate-900/50">
                    <button
                      type="button"
                      onClick={() => setAddTab('auto')}
                      className={`cursor-pointer rounded-[12px] px-2 py-1.5 text-[12px] font-bold transition-colors ${
                        addTab === 'auto' ? 'primary-glass-cta text-white' : 'text-[#555D6B] dark:text-slate-300'
                      }`}
                    >
                      PDF / تېكىستتىن ياساش
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddTab('json')}
                      className={`cursor-pointer rounded-[12px] px-2 py-1.5 text-[12px] font-bold transition-colors ${
                        addTab === 'json' ? 'primary-glass-cta text-white' : 'text-[#555D6B] dark:text-slate-300'
                      }`}
                    >
                      JSON يۈكلەش
                    </button>
                  </div>

                  {addTab === 'auto' ? (
                    <>
                      <label
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          handlePdfOrTextSelect(e.dataTransfer.files?.[0]);
                        }}
                        className="flex cursor-pointer items-center justify-between gap-2 rounded-[14px] border border-dashed border-[#1F75FE]/50 bg-[#1F75FE]/5 px-3 py-2.5 text-[12px]"
                      >
                        <span className="flex min-w-0 items-center gap-1.5 truncate">
                          {isReadingPdf ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#1F75FE]" /> : <FileText className="h-4 w-4 shrink-0 text-[#1F75FE]" />}
                          <span className="truncate">
                            {isReadingPdf
                              ? 'PDF تېكىستى ئوقۇلۇۋاتىدۇ...'
                              : selectedPdfFile
                                ? selectedPdfFile.name
                                : '.pdf ياكى .txt ھۆججەت قېتىش'}
                          </span>
                        </span>
                        <span className="shrink-0 font-bold text-[#1F75FE]">PDF / تېكىست</span>
                        <input
                          type="file"
                          accept=".pdf,.txt,.md,application/pdf,text/plain"
                          onChange={(e) => {
                            handlePdfOrTextSelect(e.target.files?.[0]);
                            e.target.value = '';
                          }}
                          className="hidden"
                        />
                      </label>

                      {pdfStatusNote && (
                        <div className="rounded-[12px] border border-[#1F75FE]/25 bg-[#1F75FE]/10 px-3 py-1.5 text-[11.5px] font-semibold text-[#1F75FE] dark:text-[#7DB2FF]">
                          {pdfStatusNote}
                        </div>
                      )}

                      {pdfPages.length > 1 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-white/75 bg-white/55 px-2.5 py-1.5 text-[11.5px] font-semibold dark:border-white/10 dark:bg-slate-900/50">
                          <span>بەت دائىرىسى:</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={1}
                              max={pdfPages.length}
                              value={fromPage}
                              onChange={(e) => handleSimPageRangeUpdate(Number(e.target.value), toPage)}
                              aria-label="باشلىنىش بېتى"
                              className="tabular-nums w-12 rounded-[8px] border border-white/80 bg-white/85 px-1.5 py-0.5 text-center text-[11.5px] dark:border-white/15 dark:bg-slate-800"
                            />
                            <span>—</span>
                            <input
                              type="number"
                              min={fromPage}
                              max={pdfPages.length}
                              value={toPage}
                              onChange={(e) => handleSimPageRangeUpdate(fromPage, Number(e.target.value))}
                              aria-label="ئاخىرلىشىش بېتى"
                              className="tabular-nums w-12 rounded-[8px] border border-white/80 bg-white/85 px-1.5 py-0.5 text-center text-[11.5px] dark:border-white/15 dark:bg-slate-800"
                            />
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2 text-[11.5px] font-semibold">
                        <span className="text-[#555D6B] dark:text-slate-300">سۇئال سانى:</span>
                        <div className="flex items-center gap-1">
                          {([10, 20, 30] as const).map((cnt) => (
                            <button
                              key={cnt}
                              type="button"
                              onClick={() => setQaCount(cnt)}
                              className={`tabular-nums cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                                qaCount === cnt
                                  ? 'primary-glass-cta text-white'
                                  : 'glass-pill text-[#1A1E24] dark:text-slate-200'
                              }`}
                            >
                              {cnt}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label htmlFor="simRawStudyText" className="mb-1 block text-[12px] font-semibold text-[#555D6B] dark:text-slate-300">
                          ياكى كىتاب / دەرسلىك مەزمۇنىنى چاپلاڭ:
                        </label>
                        <textarea
                          id="simRawStudyText"
                          value={rawStudyText}
                          onChange={(e) => setRawStudyText(e.target.value)}
                          placeholder={`دەرسلىك تېكىستىنى چاپلاڭ ياكى يۇقىرىدىن PDF قېتىپ بىۋاسىتە ${qaCount} سۇئال-جاۋاب ياسىتىڭ...`}
                          className="min-h-[110px] w-full rounded-[14px] border border-white/80 bg-white/75 p-2.5 text-[12.5px] leading-relaxed outline-none focus:border-[#1F75FE] dark:border-white/15 dark:bg-slate-900/70"
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          disabled={isGenerating || isReadingPdf}
                          onClick={handleGenerateViaAi}
                          className="primary-glass-cta flex cursor-pointer items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-60"
                        >
                          {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          <span>{isGenerating ? 'AI سۇئال-جاۋاب ياساۋاتىدۇ...' : `بىۋاسىتە ${qaCount} سۇئال-جاۋاب ياساش (AI)`}</span>
                        </button>

                        {rawStudyText.trim() && (
                          <button
                            type="button"
                            onClick={handleGenerateLocalOffline}
                            className="glass-pill cursor-pointer rounded-full px-4 py-2 text-[12px] font-semibold text-[#1A1E24] dark:text-slate-100"
                          >
                            تور سىرتىدا تېز ياساش ({qaCount} سۇئال)
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <label
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          readJsonFile(e.dataTransfer.files?.[0]);
                        }}
                        className="flex cursor-pointer items-center justify-between gap-2 rounded-[14px] border border-dashed border-[#1F75FE]/50 bg-[#1F75FE]/5 px-3 py-2.5 text-[12.5px]"
                      >
                        <span className="flex items-center gap-1.5">
                          <Upload className="h-4 w-4 text-[#1F75FE]" />
                          <span>.json ھۆججەت تاللاش ياكى تاشلاش</span>
                        </span>
                        <span className="font-bold text-[#1F75FE]">يۈكلەش</span>
                        <input type="file" accept=".json,application/json,text/plain" onChange={handleFileUpload} className="hidden" />
                      </label>

                      <div>
                        <label htmlFor="simJsonPaste" className="mb-1 block text-[12px] font-semibold text-[#555D6B] dark:text-slate-300">
                          ياكى JSON مەزمۇنىنى چاپلاڭ:
                        </label>
                        <textarea
                          id="simJsonPaste"
                          dir="ltr"
                          value={jsonInput}
                          onChange={(e) => setJsonInput(e.target.value)}
                          placeholder='{"bookTitle":"...","items":[{"id":1,"question":"...","answer":"..."}]}'
                          className="min-h-[120px] w-full rounded-[14px] border border-white/80 bg-white/75 p-2.5 text-left font-mono text-[12.5px] leading-relaxed outline-none focus:border-[#1F75FE] dark:border-white/15 dark:bg-slate-900/70"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={handleSaveNewBook}
                        className="primary-glass-cta cursor-pointer rounded-full px-4 py-2.5 text-[13.5px] font-bold text-white"
                      >
                        ساقلاش ۋە كىتاب قوشۇش
                      </button>
                    </>
                  )}
                </>
              )}

              {modal === 'export' && (
                <div className="flex flex-col gap-2">
                  <p className="uyghur-paragraph text-[12px] text-[#555D6B] dark:text-slate-300">
                    ھەر بىر كىتاب ئايرىم ساقلانغان بولۇپ، بىر قېتىم يۈكلەنگەندىن كېيىن يوقاپ كەتمەيدۇ. خالىغان كىتابنى JSON ياكى رەتلىك ئۇيغۇرچە PDF قىلىپ چىقىرىپ ساقلىيالايسىز.
                  </p>
                  {books.length === 0 ? (
                    <div className="py-4 text-center text-[13px] text-[#555D6B]">ساقلانغان كىتاب يوق.</div>
                  ) : (
                    books.map((book) => (
                      <div
                        key={book.id}
                        className="flex items-center justify-between gap-2 rounded-[14px] border border-white/70 bg-white/65 px-3 py-2 dark:border-white/10 dark:bg-slate-900/60"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-bold">{book.title}</div>
                          <div className="tabular-nums text-[11px] text-[#555D6B] dark:text-slate-400">
                            {book.items.length} سۇئال · ئۆگەنگەن: {book.masteredIds.length}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleExportBook(book)}
                            aria-label={`${book.title} نى JSON قىلىپ چىقىرىش`}
                            className="glass-pill cursor-pointer rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
                          >
                            JSON
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setModal(null);
                              onPrintBookPdf(book);
                            }}
                            aria-label={`${book.title} نى PDF قىلىپ چىقىرىش`}
                            className="glass-pill flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-[#1F75FE]"
                          >
                            <Printer className="h-3 w-3" />
                            <span>PDF</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (deleteConfirmId !== book.id) {
                                setDeleteConfirmId(book.id);
                                return;
                              }
                              onDeleteBook(book.id);
                              setDeleteConfirmId(null);
                              onNotify('كىتاب ئۆچۈرۈلدى', 'success');
                            }}
                            aria-label={`${book.title} نى ئۆچۈرۈش`}
                            className="glass-pill flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-semibold text-[#E03E36]"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>{deleteConfirmId === book.id ? 'جەزم' : ''}</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {modal === 'prompt' && (
                <>
                  <p className="uyghur-paragraph text-[12px] text-[#555D6B] dark:text-slate-300">
                    بۇ پىرۇمپىتنى خالىغان AI مودېلىغا كىتاب ياكى دەرسلىك مەزمۇنى بىلەن بەرسىڭىز، 30 تەپسىلىي سۇئال-جاۋابنى JSON قىلىپ چىقىرىپ بېرىدۇ.
                  </p>
                  <div>
                    <label htmlFor="simPromptTopic" className="mb-1 block text-[12px] font-semibold text-[#555D6B] dark:text-slate-300">
                      كىتاب ياكى دەرسلىك نامى:
                    </label>
                    <input
                      id="simPromptTopic"
                      type="text"
                      value={promptTopic}
                      onChange={(e) => setPromptTopic(e.target.value)}
                      placeholder="مەسىلەن: قۇتادغۇ بىلىك ئاساسلىرى"
                      className="w-full rounded-[14px] border border-white/80 bg-white/75 px-3 py-2 text-[13px] outline-none focus:border-[#1F75FE] dark:border-white/15 dark:bg-slate-900/70"
                    />
                  </div>
                  <textarea
                    readOnly
                    value={promptText}
                    aria-label="تەييارلانغان AI پىرۇمپىتى"
                    className="min-h-[150px] w-full rounded-[14px] border border-white/80 bg-white/75 p-2.5 text-[12px] leading-relaxed outline-none dark:border-white/15 dark:bg-slate-900/70"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopyPrompt(false)}
                    className="primary-glass-cta cursor-pointer rounded-full px-4 py-2 text-[13px] font-bold text-white"
                  >
                    پىرۇمپىتنى قايتا كۆچۈرۈش
                  </button>
                </>
              )}

              {modal === 'settings' && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex flex-col gap-2 rounded-[14px] border border-white/70 bg-white/65 px-3 py-2.5 dark:border-white/10 dark:bg-slate-900/60">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[13px] font-bold">ئېكران يورۇقلۇقى</div>
                        <div className="text-[11px] text-[#555D6B] dark:text-slate-400">
                          ئوقۇشقا قولايلىق يورۇقلۇقنى يۇقىرى-تۆۋەن تەڭشەڭ
                        </div>
                      </div>
                      <span className="tabular-nums rounded-full bg-[#F05A28]/15 px-2.5 py-0.5 text-[12px] font-bold text-[#F05A28]" data-testid="modal-brightness-value">
                        {settings.brightness}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onChangeBrightness(settings.brightness - 10)}
                        aria-label="يورۇقلۇقنى پەسەيتىش"
                        className="glass-pill flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-[15px] font-bold"
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min={BRIGHTNESS_MIN}
                        max={BRIGHTNESS_MAX}
                        step={5}
                        value={settings.brightness}
                        onChange={(e) => onChangeBrightness(Number(e.target.value))}
                        aria-label="ئېكران يورۇقلۇقى سىيرىلمىسى"
                        data-testid="modal-brightness-slider"
                        className="h-2 w-full cursor-pointer accent-[#F05A28]"
                      />
                      <button
                        type="button"
                        onClick={() => onChangeBrightness(settings.brightness + 10)}
                        aria-label="يورۇقلۇقنى ئاشۇرۇش"
                        className="glass-pill flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-[15px] font-bold"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => onChangeBrightness(BRIGHTNESS_DEFAULT)}
                        className="glass-pill shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-semibold text-[#1F75FE]"
                      >
                        100%
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-[14px] border border-white/70 bg-white/65 px-3 py-2.5 dark:border-white/10 dark:bg-slate-900/60">
                    <div>
                      <div className="text-[13px] font-bold">تور كۆرگۈچ ئېچىلغاندا ئەسكەرتىش</div>
                      <div className="text-[11px] text-[#555D6B] dark:text-slate-400">
                        ھەر قېتىم Chrome ئېچىلغاندا سۇئال چىقىرىدۇ
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onToggleReminder}
                      className="glass-pill cursor-pointer rounded-full px-3 py-1 text-[12px] font-semibold"
                    >
                      {settings.reminderEnabled ? 'ئېتىۋېتىش' : 'قوزغىتىش'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-[14px] border border-white/70 bg-white/65 px-3 py-2.5 dark:border-white/10 dark:bg-slate-900/60">
                    <div>
                      <div className="text-[13px] font-bold">ئەسكەرتىشنى ھازىر سىناش</div>
                      <div className="text-[11px] text-[#555D6B] dark:text-slate-400">
                        تور كۆرگۈچ ئۇقتۇرۇش كۆرۈنۈشى
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setModal(null);
                        onTriggerStartupPreview();
                      }}
                      className="glass-pill cursor-pointer rounded-full px-3 py-1 text-[12px] font-semibold text-[#1F75FE]"
                    >
                      سىناش
                    </button>
                  </div>

                  <p className="uyghur-paragraph text-[12px] text-[#555D6B] dark:text-slate-400">
                    بارلىق مەلۇماتلار پەقەت ئۆز كومپيۇتېرىڭىزدىلا ساقلىنىدۇ؛ ھېچقانداق تاشقى مۇلازىمېتىرغا ئەۋەتىلمەيدۇ.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
