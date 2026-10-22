import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import writeXlsxFile from 'write-excel-file/browser'
import type { ChangeEvent } from 'react'
import type { ExtractedForm } from './types'
import {
  clearAll,
  completeExtraction,
  createBatch,
  createPendingExtraction,
  db,
  failExtraction,
  listBatches,
  listForms,
  markFieldReviewed,
  requestPersistentStorage,
  markExtractionPending,
  verifyForm,
} from './db'
import type { ExtractionFlag, FieldFlag, FormCorrections, FormFieldName, FormRecord, FormStatus } from './db'
import './App.css'
import './sheba-theme.css'


type FieldKey = keyof ExtractedForm

interface BatchForm {
  id: number | string
  batchId?: number
  fileName: string
  fileHash?: string
  pageNumber?: number
  file?: File
  previewUrl?: string
  data: ExtractedForm
  uncertainFields: FieldKey[]
  reviewedFields: FieldKey[]
  confirmedFields: FieldKey[]
  verified: boolean
  ocrStatus?: 'queued' | 'processing' | 'complete' | 'failed'
  ocrProgress?: number
  ocrError?: string
  recognizedText?: string
  extractionSource?: 'local' | 'gemini'
  organizationEvidence?: 'text' | 'logo' | 'both' | 'none' | 'uncertain'
  organizationObservedText?: string | null
  autoRotation?: number
}

interface QueuedPageTask {
  formId: number
  batchId: number
  file: File
  fileName: string
  pageNumber: number
  blob: Blob
  previewUrl: string
}

const CUSTOM_ORGANIZATION = '__custom_organization__'
const healthOrganizations = ['שירותי בריאות כללית', 'מכבי שירותי בריאות', 'מאוחדת', 'לאומית שירותי בריאות']
const publicHospitals = [
  'המרכז הרפואי שיבא - תל השומר',
  'המרכז הרפואי תל אביב - איכילוב',
  'המרכז הרפואי רבין - בילינסון',
  'המרכז הרפואי רבין - השרון',
  'המרכז הרפואי שמיר - אסף הרופא',
  'המרכז הרפואי סורוקה',
  'המרכז הרפואי רמב״ם',
  'המרכז הרפואי בני ציון',
  'המרכז הרפואי כרמל',
  'המרכז הרפואי העמק',
  'המרכז הרפואי מאיר',
  'המרכז הרפואי קפלן',
  'המרכז הרפואי הלל יפה',
  'המרכז הרפואי ברזילי',
  'המרכז הרפואי זיו',
  'המרכז הרפואי לגליל - נהריה',
  'המרכז הרפואי צפון - פוריה',
  'המרכז הרפואי יוספטל',
  'המרכז הרפואי וולפסון',
  'המרכז הרפואי אסותא אשדוד',
  'המרכז הרפואי הדסה - עין כרם',
  'המרכז הרפואי הדסה - הר הצופים',
  'המרכז הרפואי שערי צדק',
  'המרכז הרפואי לניאדו',
  'המרכז הרפואי מעייני הישועה',
  'המרכז הרפואי הצרפתי סנט וינסנט דה פול - נצרת',
]
const privateHospitals = [
  'אסותא רמת החייל',
  'אסותא חיפה',
  'אסותא ראשון לציון',
  'אסותא באר שבע',
  'הרצליה מדיקל סנטר',
  'מדיקה - תל אביב',
  'בית חולים אלישע',
  'רפאל בתי חולים',
]
const psychiatricHospitals = [
  'המרכז לבריאות הנפש אברבנאל',
  'המרכז לבריאות הנפש גהה',
  'המרכז לבריאות הנפש לב השרון',
  'המרכז לבריאות הנפש שער מנשה',
  'המרכז לבריאות הנפש באר יעקב - נס ציונה',
  'המרכז הירושלמי לבריאות הנפש - כפר שאול ואיתנים',
  'המרכז לבריאות הנפש מעלה הכרמל',
  'המרכז לבריאות הנפש טירת כרמל',
  'המרכז לבריאות הנפש מרחבים',
  'המרכז לבריאות הנפש שלוותה',
  'המרכז לבריאות הנפש הרצוג',
]
const specialtyHospitals = [
  'מרכז שניידר לרפואת ילדים',
  'בית החולים דנה-דואק לילדים',
  'בית החולים לילדים ספרא - שיבא',
  'בית החולים אלי״ן',
  'המרכז הרפואי לשיקום לוינשטיין',
  'בית החולים השיקומי רעות',
  'המרכז הרפואי הגריאטרי בית רבקה',
  'המרכז הרפואי הגריאטרי הרצפלד',
  'המרכז הרפואי הגריאטרי שמואל הרופא',
  'המרכז הרפואי הגריאטרי פלימן',
  'המרכז הרפואי הגריאטרי דורות',
  'בית החולים האנגלי בנצרת',
  'בית החולים האיטלקי בנצרת',
  'בית החולים הצרפתי בנצרת',
  'בית החולים הסקוטי בטבריה',
]

const formFieldKeys: Array<keyof ExtractedForm> = [
  'firstName', 'lastName', 'idNumber', 'sampleReceivedDate',
  'referringOrganization', 'centralNumbers', 'commitmentNumbers',
]

const fieldMeta: Record<FieldKey, { label: string; reason: string }> = {
  firstName: { label: 'שם פרטי', reason: 'הזיהוי האוטומטי דורש בדיקה' },
  lastName: { label: 'שם משפחה', reason: 'הזיהוי האוטומטי דורש בדיקה' },
  idNumber: { label: 'מספר זהות', reason: 'הספרות אינן חד-משמעיות' },
  sampleReceivedDate: { label: 'תאריך קבלת הדגימה', reason: 'התאריך דורש השוואה למסמך' },
  referringOrganization: { label: 'ארגון מפנה', reason: 'לא נמצא ארגון מפנה בטופס' },
  centralNumbers: { label: 'מספרים מרכזיים', reason: 'נמצאו כמה מספרים בטופס' },
  commitmentNumbers: { label: 'מספר התחייבות', reason: 'הספרות דורשות אימות מול המסמך' },
}

function toReviewForm(record: FormRecord, isProcessing: boolean, isQueued: boolean): BatchForm {
  const toUiField = (field: string): keyof ExtractedForm | null => field === 'sender'
    ? 'referringOrganization'
    : field === 'receivedDate' ? 'sampleReceivedDate'
      : formFieldKeys.includes(field as keyof ExtractedForm) ? field as keyof ExtractedForm : null
  const uncertainFields = record.flags
    .filter((flag) => flag.correctedValue === null)
    .map((flag) => toUiField(flag.fieldName))
    .filter((field): field is keyof ExtractedForm => field !== null)
  return {
    id: record.id!, batchId: record.batchId, fileName: record.fileName,
    fileHash: record.fileHash, pageNumber: record.pageNumber,
    data: {
      firstName: record.firstName, lastName: record.lastName, idNumber: record.idNumber,
      centralNumbers: record.centralNumbers, sampleReceivedDate: record.receivedDate,
      referringOrganization: record.sender, commitmentNumbers: record.commitmentNumbers,
    },
    uncertainFields,
    reviewedFields: record.flags.filter((flag) => flag.correctedValue !== null)
      .map((flag) => toUiField(flag.fieldName))
      .filter((field): field is keyof ExtractedForm => field !== null),
    confirmedFields: [], verified: record.status === 'verified',
    ocrStatus: record.status === 'verified' || record.extractionStatus === 'complete'
      ? 'complete'
      : isProcessing ? 'processing' : isQueued ? 'queued' : 'failed',
    ocrError: record.status === 'verified' ? undefined : record.extractionError
      ?? (record.extractionStatus === 'pending' && !isProcessing && !isQueued ? 'החילוץ הופסק. העלי שוב את הקובץ כדי להמשיך.' : undefined),
  }
}

async function renderUploadPages(file: File) {
  if (file.type !== 'application/pdf') return [{ pageNumber: 1, blob: file }]
  const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist')
  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const pages: Array<{ pageNumber: number; blob: Blob }> = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('לא ניתן לעבד את עמוד ה־PDF בדפדפן')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('לא ניתן להכין את עמוד ה־PDF לחילוץ')), 'image/png')
    })
    pages.push({ pageNumber, blob })
    canvas.width = 0
    canvas.height = 0
  }
  return pages
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

interface ExtractionApiResponse extends Partial<ExtractedForm> {
  uncertainFields?: FieldKey[]
  fieldReasons?: Array<{ fieldName: FieldKey; reason: string }>
  error?: string
}

async function extractPendingPage(task: QueuedPageTask, onRetry: (delaySeconds: number, attempt: number) => void) {
  try {
    await markExtractionPending(task.formId)
    let result: ExtractionApiResponse | undefined
    let response: Response | undefined
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      const requestData = new FormData()
      requestData.append('file', task.blob, `${task.fileName}.page-${task.pageNumber}.png`)
      response = await fetch('/api/extract', { method: 'POST', body: requestData, signal: AbortSignal.timeout(120_000) })
      result = await response.json() as ExtractionApiResponse
      if ((response.status !== 429 && response.status !== 503) || attempt === 3) break
      const delaySeconds = 2 ** attempt
      onRetry(delaySeconds, attempt + 1)
      await wait(delaySeconds * 1000)
    }
    if (!response || !result) throw new Error('השרת לא החזיר תשובת חילוץ תקינה.')
    const hasRequiredFields = result.firstName !== undefined
      && result.lastName !== undefined
      && result.idNumber !== undefined
      && Array.isArray(result.centralNumbers)
      && result.sampleReceivedDate !== undefined
      && result.referringOrganization !== undefined
      && Array.isArray(result.commitmentNumbers)
    if (!response.ok || !hasRequiredFields || !result.uncertainFields) {
      throw new Error(result.error ?? 'החילוץ נכשל')
    }

    const data = {
      formType: 'commitment',
      firstName: result.firstName ?? null,
      lastName: result.lastName ?? null,
      idNumber: result.idNumber ?? null,
      centralNumbers: result.centralNumbers ?? [],
      receivedDate: result.sampleReceivedDate ?? null,
      sender: result.referringOrganization ?? null,
      commitmentNumbers: result.commitmentNumbers ?? [],
    }
    const uncertainFields = new Set<FieldKey>(result.uncertainFields)
    const dbFieldByUiField: Record<FieldKey, keyof typeof data> = {
      firstName: 'firstName', lastName: 'lastName', idNumber: 'idNumber',
      sampleReceivedDate: 'receivedDate', referringOrganization: 'sender',
      centralNumbers: 'centralNumbers', commitmentNumbers: 'commitmentNumbers',
    }
    const dbFlagNameByUiField: Record<FieldKey, ExtractionFlag['fieldName']> = {
      firstName: 'firstName', lastName: 'lastName', idNumber: 'idNumber',
      sampleReceivedDate: 'receivedDate', referringOrganization: 'sender',
      centralNumbers: 'centralNumbers', commitmentNumbers: 'commitmentNumbers',
    }
    const flags: ExtractionFlag[] = formFieldKeys
      .filter((field) => uncertainFields.has(field) || isEmptyExtractionValue(data[dbFieldByUiField[field]]))
      .map((field) => ({
        fieldName: dbFlagNameByUiField[field],
        reason: result.fieldReasons?.find((entry) => entry.fieldName === field)?.reason
          ?? (isEmptyExtractionValue(data[dbFieldByUiField[field]]) ? 'הערך לא זוהה במסמך.' : fieldMeta[field].reason),
        originalValue: data[dbFieldByUiField[field]] as ExtractionFlag['originalValue'],
      }))
    await completeExtraction(task.formId, data, flags)
    return null
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'TimeoutError'
      ? 'החילוץ נמשך זמן רב מדי. העלי שוב את הקובץ כדי לחדש.'
      : error instanceof Error ? error.message : 'החילוץ נכשל'
    await failExtraction(task.formId, message)
    return message
  }
}

function isEmptyExtractionValue(value: unknown) {
  return value == null || (typeof value === 'string' && value.trim().length === 0) || (Array.isArray(value) && value.length === 0)
}

function App() {
  const [currentBatchId, setCurrentBatchId] = useState<number>()
  const [processingIds, setProcessingIds] = useState<number[]>([])
  const [queuedTasks, setQueuedTasks] = useState<QueuedPageTask[]>([])
  const [historyMode, setHistoryMode] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [historyStatus, setHistoryStatus] = useState<FormStatus | ''>('')
  const [historyBatch, setHistoryBatch] = useState<number | ''>('')
    const [edits, setEdits] = useState<Record<number, Partial<ExtractedForm>>>({})
  const [numberDrafts, setNumberDrafts] = useState<Record<number, Partial<Record<'centralNumbers' | 'commitmentNumbers', string>>>>({})
    const [fileArtifacts, setFileArtifacts] = useState<Record<number, { file: File; previewUrl: string }>>({})
  const [activeFormId, setActiveFormId] = useState<number | string | null>(null)
  const [notice, setNotice] = useState('')
  const [zoomLevel, setZoomLevel] = useState(1)
  const [isDraggingPreview, setIsDraggingPreview] = useState(false)
  const [pdfPanMode, setPdfPanMode] = useState(false)
  const [manualRotation, setManualRotation] = useState(0)
  const [dropActive, setDropActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [customOrganizationForms, setCustomOrganizationForms] = useState<Array<number | string>>([])
  const previewViewportRef = useRef<HTMLDivElement>(null)
  const [previewWidth, setPreviewWidth] = useState(0)
  const verifyActionRef = useRef<() => void>(() => undefined)
  const queuedTasksRef = useRef<QueuedPageTask[]>([])
  const activeExtractionIdRef = useRef<number | null>(null)
  const dragOriginRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const objectUrlsRef = useRef<string[]>([])
  const batches = useLiveQuery(listBatches, [], [])
  const activeBatchId = currentBatchId ?? batches[0]?.id
  const dbForms = useLiveQuery(
    () => listForms(activeBatchId === undefined ? {} : { batchId: activeBatchId }),
    [activeBatchId],
    [],
  )
  const historyRecords = useLiveQuery(
    () => listForms({
      status: historyStatus || undefined,
      batchId: historyBatch || undefined,
      search: historySearch,
    }),
    [historyStatus, historyBatch, historySearch],
    [],
  )
  function startNextQueuedTask() {
    if (activeExtractionIdRef.current !== null) return undefined
    const [task, ...remaining] = queuedTasksRef.current
    if (!task) return undefined
    queuedTasksRef.current = remaining
    setQueuedTasks(remaining)
    activeExtractionIdRef.current = task.formId
    setCurrentBatchId(task.batchId)
    setActiveFormId(task.formId)
    setProcessingIds([task.formId])
    void extractPendingPage(task, (delaySeconds, attempt) => {
      setNotice(`Gemini עמוס. מנסה שוב את ${task.fileName}, עמוד ${task.pageNumber} בעוד ${delaySeconds} שניות (${attempt}/3).`)
    }).then((error) => {
      if (error) setNotice(`החילוץ נכשל עבור ${task.fileName}, עמוד ${task.pageNumber}: ${error}. אפשר למלא ידנית או להעלות שוב.`)
    }).finally(() => {
      activeExtractionIdRef.current = null
      setProcessingIds([])
    })
    return task.formId
  }
  const forms = useMemo(() => [
    ...dbForms.map((record) => {
      const form = toReviewForm(
        record,
        record.id !== undefined && processingIds.includes(record.id),
        record.id !== undefined && queuedTasks.some((task) => task.formId === record.id),
      )
      const correction = record.id === undefined ? undefined : edits[record.id]
      const data = { ...form.data, ...correction }
      return {
        ...form,
        file: record.id === undefined ? undefined : fileArtifacts[record.id]?.file,
        previewUrl: record.id === undefined ? undefined : fileArtifacts[record.id]?.previewUrl,
        data,
        uncertainFields: form.uncertainFields.filter((field) => {
          const wasCorrected = correction !== undefined
            && Object.prototype.hasOwnProperty.call(correction, field)
            && !isEmptyFieldValue(correction[field])
          return !wasCorrected
        }),
      }
    }),
  ], [dbForms, edits, fileArtifacts, processingIds, queuedTasks])
  const selectedFormIndex = forms.findIndex((item) => item.id === activeFormId)
  const activeIndex = selectedFormIndex
  const activeForm = selectedFormIndex >= 0 ? forms[selectedFormIndex] : undefined
  const pendingForms = forms.filter((item) => !item.verified)
  const hasNextForm = pendingForms.some((item) => item.id !== activeForm?.id)
    || queuedTasks.some((task) => task.formId !== activeForm?.id)
  const previewUrl = activeForm?.previewUrl
  const isPdfPreview = activeForm?.file?.type === 'application/pdf'
  const rotation = ((activeForm?.autoRotation ?? 0) + manualRotation) % 360
  const isQuarterTurn = rotation % 180 !== 0
  const pageWidth = Math.min(410, Math.max(240, previewWidth - 48))
  const rotationFit = isQuarterTurn && previewWidth > 0 ? Math.min(1, Math.max(0.4, (previewWidth - 48) / 520)) : 1
  const frameWidth = isQuarterTurn
    ? 520 * rotationFit * zoomLevel
    : pageWidth * zoomLevel
  const frameHeight = isQuarterTurn
    ? pageWidth * rotationFit * zoomLevel
    : 520 * zoomLevel
  const form = activeForm?.data
  const verifiedCount = dbForms.filter((item) => item.status === 'verified').length
  const isBusy = saving || processingIds.length > 0
  function isEmptyFieldValue(value: ExtractedForm[FieldKey] | undefined) {
    return value == null
      || (typeof value === 'string' && value.trim().length === 0)
      || (Array.isArray(value) && value.length === 0)
  }

  function needsReview(key: FieldKey) {
    const value = form?.[key]
    const isEmpty = isEmptyFieldValue(value)
    const wasReviewed = activeForm?.reviewedFields.includes(key) === true
    const isUnclear = activeForm?.uncertainFields.includes(key) === true && !wasReviewed
    return !activeForm?.verified && (isUnclear || isEmpty)
  }

  const missingFieldKeys = formFieldKeys.filter((key) => isEmptyFieldValue(form?.[key]))
  const hasUnresolvedFields = formFieldKeys.some((key) => isEmptyFieldValue(form?.[key])
    || (activeForm?.uncertainFields.includes(key) && !activeForm.reviewedFields.includes(key)))
  const reviewFieldKeys = formFieldKeys.filter((key) => needsReview(key) || missingFieldKeys.includes(key))
  const fieldsToReview = reviewFieldKeys.length

  function startPreviewDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    if (isPdfPreview && !pdfPanMode) return
    const viewport = previewViewportRef.current
    if (!viewport) return
    dragOriginRef.current = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDraggingPreview(true)
  }

  function movePreviewDrag(event: React.PointerEvent<HTMLDivElement>) {
    const origin = dragOriginRef.current
    const viewport = previewViewportRef.current
    if (!origin || !viewport) return
    viewport.scrollLeft = origin.scrollLeft - (event.clientX - origin.x)
    viewport.scrollTop = origin.scrollTop - (event.clientY - origin.y)
  }

  function endPreviewDrag() {
    dragOriginRef.current = null
    setIsDraggingPreview(false)
  }

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  useEffect(() => {
    void requestPersistentStorage()
  }, [])

  useEffect(() => {
    const viewport = previewViewportRef.current
    if (!viewport) return
    const resizeObserver = new ResizeObserver(([entry]) => {
      setPreviewWidth(entry.contentRect.width)
    })
    resizeObserver.observe(viewport)
    return () => resizeObserver.disconnect()
  }, [activeIndex])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'Enter') {
        if (event.target instanceof HTMLInputElement) {
          event.preventDefault()
          verifyActionRef.current()
        }
        return
      }
      if (event.target instanceof HTMLInputElement) return
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        const direction = event.key === 'ArrowLeft' ? 1 : -1
        const nextIndex = Math.min(forms.length - 1, Math.max(0, activeIndex + direction))
        setActiveFormId(forms[nextIndex]?.id ?? null)
        resetDocumentPosition()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeIndex, fieldsToReview, forms, missingFieldKeys.length])

  function resetDocumentPosition() {
    setZoomLevel(1)
    setManualRotation(0)
    if (previewViewportRef.current) {
      previewViewportRef.current.scrollLeft = 0
      previewViewportRef.current.scrollTop = 0
    }
    setPdfPanMode(false)
  }

  function updateField<Key extends keyof ExtractedForm>(
    key: Key,
    value: ExtractedForm[Key],
  ) {
    if (!activeForm) return
    if (typeof activeForm.id !== 'number') return
    setEdits((current) => ({
      ...current,
      [activeForm.id as number]: { ...current[activeForm.id as number], [key]: value },
    }))
  }

  function updateOrganizationSelection(value: string) {
    if (!activeForm) return
    setCustomOrganizationForms((current) => value === CUSTOM_ORGANIZATION
      ? [...new Set([...current, activeForm.id])]
      : current.filter((id) => id !== activeForm.id))
    if (value !== CUSTOM_ORGANIZATION) {
      updateField('referringOrganization', value || null)
    } else {
      updateField('referringOrganization', null)
    }
  }

  function updateCustomOrganization(value: string) {
    updateField('referringOrganization', value || null)
  }

  async function handleFiles(files: File[]) {
    if (activeExtractionIdRef.current !== null || queuedTasksRef.current.length > 0) {
      setNotice('יש להשלים את האצווה הנוכחית לפני הוספת קבצים נוספים.')
      return
    }
    const acceptedFiles = files.filter((file) => file.type === 'application/pdf' || file.type.startsWith('image/'))
    if (!acceptedFiles.length) return
    const batchId = await createBatch()
    setCurrentBatchId(batchId)
    setEdits({})
    setCustomOrganizationForms([])
    setNotice(`${acceptedFiles.length} קבצים נוספו לתור. החילוץ נשמר תוך כדי עבודה.`)
    let createdRecordCount = 0
    let duplicateCount = 0
    let existingBatchId: number | undefined
    let firstSelectedId: number | undefined
    const tasks: QueuedPageTask[] = []

    for (const file of acceptedFiles) {
      const previewUrl = URL.createObjectURL(file)
      objectUrlsRef.current.push(previewUrl)
      let pages: Array<{ pageNumber: number; blob: Blob }>
      try {
        pages = await renderUploadPages(file)
      } catch (error) {
        setNotice(`לא ניתן לפצל את ${file.name}: ${error instanceof Error ? error.message : 'שגיאת PDF'}`)
        URL.revokeObjectURL(previewUrl)
        objectUrlsRef.current = objectUrlsRef.current.filter((url) => url !== previewUrl)
        continue
      }

      for (const page of pages) {
        let pendingId: number | undefined
        try {
          const pending = await createPendingExtraction(batchId, file, file.name, page.pageNumber)
          pendingId = pending.id
          if (pending.created) {
            createdRecordCount += 1
          } else {
            duplicateCount += 1
            existingBatchId = pending.form.batchId
          }
          firstSelectedId ??= pending.id
          setFileArtifacts((current) => ({ ...current, [pending.id]: { file, previewUrl } }))
          setCurrentBatchId(pending.form.batchId)
          setActiveFormId((currentId) => currentId ?? pending.id)

          if (!pending.created && pending.form.extractionStatus === 'complete') continue
          tasks.push({ formId: pending.id, batchId: pending.form.batchId, file, fileName: file.name, pageNumber: page.pageNumber, blob: page.blob, previewUrl })
        } catch (error) {
          const message = error instanceof DOMException && error.name === 'TimeoutError'
            ? 'החילוץ נמשך זמן רב מדי. אפשר להעלות שוב כדי לחדש.'
            : error instanceof Error ? error.message : 'החילוץ נכשל'
          if (pendingId !== undefined) {
            await failExtraction(pendingId, message)
            setFileArtifacts((current) => ({ ...current, [pendingId!]: { file, previewUrl } }))
            firstSelectedId ??= pendingId
          }
          setNotice(`לא ניתן להכין את ${file.name}, עמוד ${page.pageNumber}: ${message}.`)
        }
      }
    }
    queuedTasksRef.current = tasks
    setQueuedTasks(tasks)
    if (createdRecordCount === 0) {
      await db.batches.delete(batchId)
      setCurrentBatchId(existingBatchId)
      const firstTaskId = startNextQueuedTask()
      setActiveFormId(firstTaskId ?? firstSelectedId ?? null)
      if (firstTaskId !== undefined) setNotice('נמצאו טפסים שטרם חולצו. החילוץ מתחדש בטופס הראשון; הבא יישלח רק לאחר אישורו.')
      else if (duplicateCount > 0) setNotice('הקבצים כבר נמצאים במסד. פתחתי את הרשומות הקיימות.')
      else setNotice('לא נוצרו רשומות מהקבצים שנבחרו.')
    } else {
      setCurrentBatchId(batchId)
      const firstTaskId = startNextQueuedTask()
      if (firstTaskId === undefined) setActiveFormId(firstSelectedId ?? null)
      setNotice(tasks.length > 0
        ? `נוספו ${acceptedFiles.length} קבצים. מתחיל חילוץ של הטופס הראשון; הבא יישלח רק אחרי אישורו.`
        : 'הטפסים כבר נמצאים במסד. פתחתי את הרשומות הקיימות.')
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    void handleFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  async function verifyAndContinue() {
    if (!activeForm) return
    if (activeForm?.ocrStatus === 'processing') return
    const unresolvedFields = formFieldKeys.filter((key) => isEmptyFieldValue(activeForm?.data[key])
      || (activeForm?.uncertainFields.includes(key) && !activeForm.reviewedFields.includes(key)))
    if (unresolvedFields.length > 0) {
      setNotice('יש להשלים את כל השדות לפני אישור הטופס.')
      return
    }
    if (typeof activeForm.id !== 'number') return
    setSaving(true)
    try {
      const changes = edits[activeForm.id] ?? {}
      const corrections: FormCorrections & Partial<ExtractedForm> = { ...changes }
      if (Object.prototype.hasOwnProperty.call(changes, 'referringOrganization')) {
        corrections.sender = changes.referringOrganization ?? null
        delete corrections.referringOrganization
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'sampleReceivedDate')) {
        corrections.receivedDate = changes.sampleReceivedDate ?? null
        delete corrections.sampleReceivedDate
      }
      const nextForm = Array.from({ length: forms.length }, (_, offset) => (activeIndex + offset + 1) % forms.length)
        .map((index) => forms[index])
        .find((candidate) => {
          return candidate.id !== activeForm.id
            && (typeof candidate.id === 'string' || (typeof candidate.id === 'number' && !candidate.verified))
        })
      await verifyForm(activeForm.id, corrections)
      const nextQueuedId = startNextQueuedTask()
      setEdits((current) => {
        const next = { ...current }
        delete next[activeForm.id as number]
        return next
      })
      if (nextQueuedId !== undefined || nextForm !== undefined) {
        setActiveFormId(nextQueuedId ?? nextForm!.id)
        resetDocumentPosition()
        setNotice(nextQueuedId !== undefined
          ? 'הטופס אושר ונשמר. מתחיל עכשיו חילוץ של הטופס הבא.'
          : 'הטופס אושר ונשמר במסד. עברת לטופס הבא להשלמה.')
      } else {
        setActiveFormId(null)
        setNotice('הטופס אושר. אין עוד טפסים שטרם הושלמו.')
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'שמירת האישור נכשלה.')
    } finally {
      setSaving(false)
    }
  }

  verifyActionRef.current = verifyAndContinue

  function skipCurrent() {
    if (activeIndex < forms.length - 1) {
      setActiveFormId(forms[activeIndex + 1]?.id ?? null)
      resetDocumentPosition()
    } else {
      setNotice('זה הטופס האחרון באצווה.')
    }
  }

  async function removeForm(formId: number | string) {
    if (typeof formId !== 'number') return
    const formToRemove = await db.forms.get(formId)
    if (!formToRemove) return
    if (!window.confirm(`להסיר את ${formToRemove.fileName}, עמוד ${formToRemove.pageNumber}, מהמסד המקומי?`)) return
    await db.forms.delete(formId)
    const remainingInBatch = await db.forms.where('batchId').equals(formToRemove.batchId).count()
    if (remainingInBatch === 0) {
      await db.batches.delete(formToRemove.batchId)
      if (currentBatchId === formToRemove.batchId) setCurrentBatchId(undefined)
    }
    setEdits((current) => {
      const next = { ...current }
      delete next[formId]
      return next
    })
    const removedArtifact = fileArtifacts[formId]
    const previewStillUsed = removedArtifact && Object.entries(fileArtifacts).some(([id, artifact]) => Number(id) !== formId && artifact.previewUrl === removedArtifact.previewUrl)
    if (removedArtifact && !previewStillUsed) {
      URL.revokeObjectURL(removedArtifact.previewUrl)
      objectUrlsRef.current = objectUrlsRef.current.filter((url) => url !== removedArtifact.previewUrl)
    }
    setFileArtifacts((current) => {
      const next = { ...current }
      delete next[formId]
      return next
    })
    const nextForm = forms.find((item) => item.id !== formId)
    setActiveFormId(nextForm?.id ?? null)
  }

  function fieldStatus(key: FieldKey) {
    if (missingFieldKeys.includes(key)) return 'missing'
    if (activeForm?.confirmedFields.includes(key) || activeForm?.reviewedFields.includes(key)) return 'confirmed'
    if (activeForm?.uncertainFields.includes(key) && !activeForm.reviewedFields.includes(key)) return 'uncertain'
    return 'verified'
  }

  async function confirmFieldAgainstDocument(key: FieldKey) {
    if (!activeForm || typeof activeForm.id !== 'number') return
    const value = activeForm.data[key]
    if (isEmptyFieldValue(value)) return
    const fieldName = (key === 'sampleReceivedDate'
      ? 'receivedDate'
      : key === 'referringOrganization' ? 'sender' : key) as FormFieldName
    try {
      await markFieldReviewed(activeForm.id, fieldName, value as FieldFlag['correctedValue'])
      setNotice(`${fieldMeta[key].label} אושר מול הטופס.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'לא ניתן לשמור את אישור השדה.')
    }
  }

  function renderField(key: FieldKey) {
    if (!activeForm) return null
    const status = fieldStatus(key)
    const value = form?.[key]
    const isArray = Array.isArray(value)
    const isNumberList = key === 'centralNumbers' || key === 'commitmentNumbers'
    const inputValue = isArray
      ? (isNumberList && typeof activeForm.id === 'number' ? numberDrafts[activeForm.id]?.[key] : undefined) ?? value.join(', ')
      : value ?? ''
    const title = fieldMeta[key].reason
    const label = fieldMeta[key].label
    return (
      <div key={key} className={`field-card field-${status} ${key === 'centralNumbers' || key === 'commitmentNumbers' || key === 'referringOrganization' ? 'field-card-wide' : ''}`}>
        <label className="field-label" htmlFor={`field-${key}`}>
          <span>{label}</span>
          <span className={`confidence-dot confidence-${status}`} title={title} aria-label={title} />
          {status === 'uncertain' && <span className="field-warning">נדרשת התאמה</span>}
          {status === 'missing' && <span className="field-warning">להשלמה ידנית</span>}
          {status === 'confirmed' && <span className="field-confirmed">✓ נבדק מול הטופס</span>}
          {status === 'verified' && <span className="field-verified">✓ זוהה</span>}
          {key === 'referringOrganization' && activeForm?.organizationEvidence && <small className="organization-evidence">{activeForm.organizationEvidence === 'logo' ? 'לוגו בלבד' : activeForm.organizationEvidence === 'both' ? 'טקסט ולוגו' : activeForm.organizationEvidence === 'text' ? 'טקסט במסמך' : activeForm.organizationEvidence === 'uncertain' ? 'לא אומת מול רשימת הארגונים' : 'לא זוהה טקסט ארגון'}{activeForm.organizationObservedText ? ` · נקרא: ${activeForm.organizationObservedText}` : ''}</small>}
          {(key === 'centralNumbers' || key === 'commitmentNumbers') && <small>ניתן להפריד בפסיק</small>}
        </label>
        {key === 'referringOrganization' ? <div className="organization-inputs">
          <select
            id={`field-${key}`}
            className="field-input organization-select"
            value={customOrganizationForms.includes(activeForm.id) ? CUSTOM_ORGANIZATION : form?.referringOrganization ?? ''}
            onChange={(event) => updateOrganizationSelection(event.target.value)}
            aria-invalid={status === 'uncertain' || status === 'missing'}
          >
            <option value="">בחירה מרשימת גורמים שולחים</option>
            <optgroup label="קופות חולים">{healthOrganizations.map((organization) => <option key={organization} value={organization}>{organization}</option>)}</optgroup>
            <optgroup label="בתי חולים ציבוריים">{publicHospitals.map((organization) => <option key={organization} value={organization}>{organization}</option>)}</optgroup>
            <optgroup label="בתי חולים פרטיים">{privateHospitals.map((organization) => <option key={organization} value={organization}>{organization}</option>)}</optgroup>
            <optgroup label="בתי חולים פסיכיאטריים">{psychiatricHospitals.map((organization) => <option key={organization} value={organization}>{organization}</option>)}</optgroup>
            <optgroup label="בתי חולים לילדים, שיקום וגריאטריה">{specialtyHospitals.map((organization) => <option key={organization} value={organization}>{organization}</option>)}</optgroup>
            <option value={CUSTOM_ORGANIZATION}>אחר / לא מופיע ברשימה</option>
          </select>
          {customOrganizationForms.includes(activeForm.id) && <input
            className="field-input custom-organization-input"
            type="text"
            value={form?.referringOrganization ?? ''}
            onChange={(event) => updateCustomOrganization(event.target.value)}
            placeholder="הקלידי את שם הגורם השולח"
            aria-label="שם גורם שולח אחר"
          />}
        </div> : <input
          id={`field-${key}`}
          className="field-input"
          type={key === 'sampleReceivedDate' ? 'date' : 'text'}
          inputMode={key === 'idNumber' ? 'numeric' : undefined}
          value={inputValue as string}
          onChange={(event) => {
            if (isNumberList && typeof activeForm.id === 'number') {
              const draft = event.target.value
              setNumberDrafts((current) => ({
                ...current,
                [activeForm.id as number]: { ...current[activeForm.id as number], [key]: draft },
              }))
              const nextValue = draft.split(',').map((item) => item.trim()).filter(Boolean)
              updateField(key, nextValue as ExtractedForm[typeof key])
              return
            }
            const nextValue = isArray ? event.target.value.split(',').map((item) => item.trim()).filter(Boolean) : event.target.value || null
            updateField(key, nextValue as ExtractedForm[typeof key])
          }}
          onBlur={(event) => {
            if (!isNumberList || typeof activeForm.id !== 'number') return
            const normalized = event.currentTarget.value.split(',').map((item) => item.trim()).filter(Boolean)
            updateField(key, normalized as ExtractedForm[typeof key])
            setNumberDrafts((current) => {
              const next = { ...current }
              const formDrafts = { ...next[activeForm.id as number] }
              delete formDrafts[key]
              if (Object.keys(formDrafts).length === 0) delete next[activeForm.id as number]
              else next[activeForm.id as number] = formDrafts
              return next
            })
          }}
          placeholder="להזנה ידנית"
          title={status === 'uncertain' ? title : undefined}
          aria-invalid={status === 'uncertain' || status === 'missing'}
        />}
        {status === 'uncertain' && !isEmptyFieldValue(value) && <button
          className="field-review-button"
          type="button"
          onClick={() => void confirmFieldAgainstDocument(key)}
          aria-label={`אישור ${label} מול הטופס`}
          title="סימני שבדקת את הערך מול המסמך"
        >✓ אימתתי מול הטופס</button>}
        {(status === 'uncertain' || status === 'missing') && <span className="field-reason"><span aria-hidden="true">!</span>{status === 'missing' ? 'לא נמצא במסמך — השלימי ידנית אם ידוע' : title}</span>}
      </div>
    )
  }

  async function handleClearAll() {
    if (!window.confirm('למחוק את כל האצוות והטפסים השמורים בדפדפן?')) return
    if (!window.confirm('המחיקה אינה ניתנת לביטול. לאשר מחיקה סופית של כל הנתונים?')) return
    await clearAll()
    setCurrentBatchId(undefined)
    setEdits({})
    setFileArtifacts({})
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    objectUrlsRef.current = []
    setCustomOrganizationForms([])
    setActiveFormId(null)
    setNotice('כל הנתונים המקומיים נמחקו.')
  }

  async function exportHistory() {
    const columns = [
      { header: 'קובץ / עמוד', cell: (record: FormRecord) => ({ value: `${record.fileName} · ${record.pageNumber}` }) },
      { header: 'שם', cell: (record: FormRecord) => ({ value: [record.firstName, record.lastName].filter(Boolean).join(' ') }) },
      { header: 'תעודת זהות', cell: (record: FormRecord) => ({ value: record.idNumber ?? '' }) },
      { header: 'תאריך קבלה', cell: (record: FormRecord) => ({ value: record.receivedDate ?? '' }) },
      { header: 'ארגון מפנה', cell: (record: FormRecord) => ({ value: record.sender ?? '' }) },
      { header: 'מספרים מרכזיים', cell: (record: FormRecord) => ({ value: record.centralNumbers.join(', ') }) },
      { header: 'מספרי התחייבות', cell: (record: FormRecord) => ({ value: record.commitmentNumbers.join(', ') }) },
      { header: 'סטטוס', cell: (record: FormRecord) => ({ value: record.status === 'verified' ? 'מאומת' : record.status === 'needs_review' ? 'דורש בדיקה' : 'ממתין לבדיקה' }) },
    ]
    const date = new Date().toISOString().slice(0, 10)
    await writeXlsxFile(historyRecords, { columns, sheet: 'טפסים', rightToLeft: true })
      .toFile(`sheba-forms-${date}.xlsx`)
  }

  return (
    <div className="app-shell" dir="rtl">
      <main id="main" className="main-content">
        <div className="page-content">
          <header className="page-heading">
            <div className="heading-copy">
              <div className="brand-lockup">
                <svg className="brand-mark" viewBox="82 1 37 54" aria-hidden="true">
                  <path fill="#31b296" d="M113.05 20.09h4c0-9.28-7.52-16.8-16.8-16.8s-16.8 7.52-16.8 16.8 7.52 16.8 16.8 16.8v-4c-7.07 0-12.81-5.73-12.81-12.81s5.73-12.81 12.81-12.81 12.81 5.73 12.81 12.81" />
                  <path fill="#e6327d" d="M87.43 36.86h-4c0 9.28 7.52 16.8 16.8 16.8s16.8-7.52 16.8-16.8-7.52-16.8-16.8-16.8v4c7.07 0 12.81 5.73 12.81 12.81s-5.73 12.81-12.81 12.81-12.81-5.73-12.81-12.81" />
                </svg>
                <span className="eyebrow">שיבא · קליטת מידע למעבדה</span>
              </div>
              <h1>אצוות טפסים</h1>
              <p>בדקי כל טופס ואשרי אותו כדי להתחיל את חילוץ הטופס הבא.</p>
            </div>
            <div className="batch-counter" aria-label={`${verifiedCount} מתוך ${forms.length} טפסים אומתו`}>
              <div className="counter-copy"><strong>{verifiedCount}<span>/{forms.length}</span></strong><span>טפסים אומתו</span></div>
              <div className="batch-progress"><i style={{ width: `${forms.length ? verifiedCount / forms.length * 100 : 0}%` }} /></div>
            </div>
          </header>

          <nav className="view-tabs" aria-label="תצוגות טפסים">
            <button className={`button ${historyMode ? 'button-secondary' : 'button-primary'}`} type="button" aria-pressed={!historyMode} onClick={() => setHistoryMode(false)}>בדיקה</button>
            <button className={`button ${historyMode ? 'button-primary' : 'button-secondary'}`} type="button" aria-pressed={historyMode} onClick={() => setHistoryMode(true)}>היסטוריה</button>
          </nav>

          {historyMode ? <section className="history-view" aria-label="היסטוריית טפסים">
            <div className="history-toolbar">
              <input className="field-input" type="search" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="חיפוש לפי שם, תעודת זהות או מספר מרכזי" aria-label="חיפוש טפסים" />
              <select className="field-input" value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value as FormStatus | '')} aria-label="סינון לפי סטטוס">
                <option value="">כל הסטטוסים</option>
                <option value="pending">ממתין לבדיקה</option>
                <option value="needs_review">דורש בדיקה</option>
                <option value="verified">מאומת</option>
              </select>
              <select className="field-input" value={historyBatch} onChange={(event) => setHistoryBatch(event.target.value ? Number(event.target.value) : '')} aria-label="סינון לפי אצווה">
                <option value="">כל האצוות</option>
                {batches.map((batch) => <option key={batch.id} value={batch.id}>אצווה {batch.id}</option>)}
              </select>
              <button className="button button-secondary" type="button" onClick={() => void exportHistory()} disabled={historyRecords.length === 0}>ייצוא לאקסל</button>
              <button className="button button-secondary" type="button" onClick={() => void handleClearAll()}>מחיקת כל הנתונים</button>
            </div>
            <div className="history-table-wrap"><table className="history-table">
              <thead><tr><th>קובץ / עמוד</th><th>שם</th><th>תעודת זהות</th><th>תאריך קבלה</th><th>ארגון מפנה</th><th>מספר מרכזי</th><th>סטטוס</th></tr></thead>
              <tbody>{historyRecords.map((record) => <tr key={record.id}>
                <td>{record.fileName} · {record.pageNumber}</td>
                <td>{[record.firstName, record.lastName].filter(Boolean).join(' ') || '—'}</td>
                <td>{record.idNumber ?? '—'}</td>
                <td>{record.receivedDate ?? '—'}</td>
                <td>{record.sender ?? '—'}</td>
                <td>{record.centralNumbers.join(', ') || '—'}</td>
                <td>{record.status === 'verified' ? 'מאומת' : record.status === 'needs_review' ? 'דורש בדיקה' : 'ממתין לבדיקה'}</td>
              </tr>)}</tbody>
            </table></div>
            {historyRecords.length === 0 && <p className="history-empty">לא נמצאו טפסים.</p>}
          </section> : <>

          <section
            className={`upload-strip ${dropActive ? 'upload-active' : ''}`}
            aria-label="העלאת טפסים"
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropActive(true) }}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setDropActive(false) }}
            onDrop={(event) => { event.preventDefault(); setDropActive(false); handleFiles(Array.from(event.dataTransfer.files)) }}
          >
            <div className="upload-mark" aria-hidden="true"><span>↑</span></div>
            <div className="file-info"><strong>הוספת טפסים לאצווה</strong><span>אפשר לבחור כמה קובצי PDF או תמונות; החילוץ מתקדם טופס אחד בכל פעם</span></div>
            <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf,image/*" multiple onChange={handleFileChange} />
            <button className="button button-secondary" type="button" onClick={() => fileInputRef.current?.click()}>בחירת קבצים</button>
          </section>

          {forms.length === 0 ? <section className="empty-state" onClick={() => fileInputRef.current?.click()}>
            <div className="empty-upload-icon">↑</div><h2>גררי לכאן טפסים</h2><p>או בחרי קובצי PDF ותמונות מהמחשב</p>
            <button className="button button-primary" type="button" onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click() }}>בחירת קבצים</button>
          </section> : <div className="review-layout">
            <section className="review-panel" aria-labelledby="review-title">
              <div className="batch-list" aria-label="רשימת טפסים באצווה">
                <div className="batch-list-heading"><div><span className="section-kicker">תור עבודה</span><strong>טפסים באצווה</strong></div><span className="batch-count">{pendingForms.length}</span></div>
                <div className="batch-items">{pendingForms.map((item) => {
                  const index = forms.findIndex((formItem) => formItem.id === item.id)
                  return <div key={item.id} className={`batch-item-wrap ${index === activeIndex ? 'selected' : ''}`}>
                  <button className="batch-item" type="button" aria-current={index === activeIndex ? 'step' : undefined} onClick={() => { setActiveFormId(item.id); resetDocumentPosition() }}>
                    <span className="file-symbol">{item.file?.type.startsWith('image/') ? 'IMG' : 'PDF'}</span>
                    <span className="batch-file-info"><span className="batch-file-name">{item.fileName}</span><span className={`batch-state ${item.ocrStatus === 'failed' ? 'failed' : item.verified ? 'verified' : item.uncertainFields.length ? 'uncertain' : 'pending'}`} title={item.ocrError}><i />{item.ocrStatus === 'processing' ? 'בחילוץ' : item.ocrStatus === 'queued' ? 'ממתין בתור' : item.ocrStatus === 'failed' ? 'החילוץ נכשל' : item.verified ? 'אומת' : item.uncertainFields.length ? 'לבדיקה' : 'ממתין לבדיקה'}</span></span>
                    <span className="batch-index">{String(index + 1).padStart(2, '0')}</span>
                  </button>
                  <button className="remove-form" type="button" aria-label={`הסרת ${item.fileName}, עמוד ${item.pageNumber ?? 1}`} title="הסרת טופס מהמסד המקומי" onClick={() => void removeForm(item.id)}>×</button>
                </div>
                })}</div>
              </div>

              {activeForm ? <>
              <div className="review-heading">
                <div><div className="section-kicker">בדיקה ידנית <span className="heading-separator">/</span> טופס {String(activeIndex + 1).padStart(2, '0')}</div><h2 id="review-title">פרטים שזוהו</h2><p>בדקי מול המסמך ועדכני רק את השדות הדרושים.</p></div>
                <span className={`review-status ${activeForm?.verified ? 'status-complete' : 'status-review'}`}>
                  <i />{activeForm?.ocrStatus === 'processing' ? 'מחלצת נתונים בעזרת Gemini…' : activeForm?.ocrStatus === 'queued' ? 'ממתין לאישור הטופס הקודם' : activeForm?.ocrStatus === 'failed' ? 'החילוץ נכשל · אפשר למלא ידנית' : activeForm?.verified ? 'הטופס אומת' : `${fieldsToReview} שדות לבדיקה`}
                </span>
              </div>

              {activeForm?.ocrStatus === 'queued' && <div className="extraction-fallback" role="status">הטופס ממתין בתור. החילוץ שלו יתחיל לאחר אישור הטופס הפעיל.</div>}

              {activeForm?.recognizedText && <details className="ocr-text-details">
                <summary>הטקסט שזוהה במסמך</summary>
                <pre>{activeForm.recognizedText}</pre>
              </details>}

              {activeForm?.ocrStatus === 'failed' && <div className="extraction-fallback" role="alert">
                {activeForm.ocrError ?? 'החילוץ נכשל. אפשר להזין את הפרטים ידנית.'}
              </div>}
              {activeForm?.file && <div className="gemini-privacy-note">חילוץ אוטומטי בעזרת Gemini · המסמך נשלח לשירות חיצוני</div>}

              <div className="field-grid">{formFieldKeys.map(renderField)}</div>

              <div className="panel-footer">
                <span className="save-state"><span className="save-dot" />{saving ? 'שומרת פרטים…' : 'השינויים נשמרים באצווה'}</span>
                <div className="footer-actions">
                  <button className="button button-secondary skip-button" type="button" title="מעבר לטופס הבא בלי לאשר את הטופס הנוכחי" disabled={activeIndex >= forms.length - 1} onClick={skipCurrent}>הבא בלי לאשר</button>
                  <button className="button button-primary" type="button" onClick={verifyAndContinue} disabled={saving || activeForm?.ocrStatus === 'processing' || activeForm?.ocrStatus === 'queued' || hasUnresolvedFields}><span aria-hidden="true">✓</span> {hasNextForm ? 'אשרי, שמרי ועברי לבא' : 'סיימי ושמרי'}</button>
                </div>
              </div>
              </> : <div className="review-empty-state"><span className="review-empty-mark" aria-hidden="true">✦</span><strong>{pendingForms.length === 0 ? 'כל הטפסים אושרו ונשמרו' : 'לא נבחר טופס'}</strong><span>{pendingForms.length === 0 ? 'תור הבדיקה ריק. הרשומות נשמרו במסד וזמינות בהיסטוריה.' : 'בחרי טופס מהרשימה כדי להתחיל בבדיקה.'}</span></div>}
            </section>

            {activeForm ? <aside className="source-panel" aria-label="תצוגת מסמך מקור">
              <div className="source-heading">
                <div className="source-title"><div className="section-kicker">מסמך מקור</div><h2>{activeForm?.fileName}</h2></div>
                <div className="document-tools" aria-label="כלי מסמך">
                  <button type="button" aria-label="הקטנת המסמך" title="הקטנת המסמך" disabled={zoomLevel <= 0.5} onClick={() => setZoomLevel((level) => Math.max(0.5, Number((level - 0.25).toFixed(2))))}>−</button>
                  <span className="zoom-level" aria-live="polite">{Math.round(zoomLevel * 100)}%</span>
                  <button type="button" aria-label="הגדלת המסמך" title="הגדלת המסמך" disabled={zoomLevel >= 3} onClick={() => setZoomLevel((level) => Math.min(3, Number((level + 0.25).toFixed(2))))}>+</button>
                  <button type="button" className="tool-reset" title="החזרת גודל המסמך, הסיבוב והמיקום לברירת מחדל" onClick={resetDocumentPosition}>איפוס תצוגה</button>
                  <button type="button" className="tool-rotate" aria-label="סיבוב המסמך ב־90 מעלות" title="סיבוב המסמך ב־90 מעלות" onClick={() => setManualRotation((angle) => (angle + 90) % 360)}>↻</button>
                </div>
              </div>
              {isPdfPreview && <div className="pdf-mode-row"><span>{pdfPanMode ? 'מצב גרירה פעיל' : 'גלילה במסמך פעילה'}</span><button type="button" className={`pdf-pan-toggle ${pdfPanMode ? 'active' : ''}`} aria-pressed={pdfPanMode} title={pdfPanMode ? 'מעבר לגלילה רגילה בתוך קובץ ה־PDF' : 'גרירת המסמך עם העכבר'} onClick={() => setPdfPanMode((mode) => !mode)}>{pdfPanMode ? 'מעבר לגלילה רגילה' : 'גרירת המסמך'}</button></div>}
              <div
                ref={previewViewportRef}
                className={`document-preview ${isDraggingPreview ? 'is-dragging' : ''} ${!isPdfPreview || pdfPanMode ? 'is-pannable' : 'is-document-scroll'}`}
                onPointerDown={startPreviewDrag}
                onPointerMove={movePreviewDrag}
                onPointerUp={endPreviewDrag}
                onPointerCancel={endPreviewDrag}
                onLostPointerCapture={endPreviewDrag}
                aria-label="תצוגת מסמך מקור"
              >
                <div className={`document-frame ${isQuarterTurn ? 'frame-rotated' : ''}`} style={{ width: `${frameWidth}px`, height: `${frameHeight}px` }}>
                  <div className="document-pan-content" style={{ width: `${pageWidth}px`, height: '520px', transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${rotationFit * zoomLevel})` }}>
                    {previewUrl && isPdfPreview ? <iframe key={activeForm.id} className="uploaded-document" style={{ pointerEvents: pdfPanMode ? 'none' : 'auto' }} src={previewUrl} title={`תצוגה של ${activeForm.fileName}`} />
                      : previewUrl && activeForm?.file?.type.startsWith('image/') ? <img key={activeForm.id} className="uploaded-image" src={previewUrl} alt={`תצוגה של ${activeForm.fileName}`} />
                        : !activeForm?.file ? <div className="document-not-stored"><strong>קובץ המקור אינו נשמר</strong><span>הנתונים נשמרו מקומית. להפרטיות, הקובץ עצמו נשאר רק בזיכרון עד רענון הדף.</span></div> : <div className="paper">
                        <div className="paper-top"><b>מרכז רפואי</b><span>טופס קבלת דגימה</span></div><div className="paper-rule" />
                        <div className="paper-title">פרטי הדגימה</div><div className="paper-row"><span>תאריך קבלה</span><b>{form?.sampleReceivedDate ?? '—'}</b></div><div className="paper-row"><span>ארגון מפנה</span><b className={needsReview('referringOrganization') ? 'handwriting uncertain-text' : ''}>{form?.referringOrganization ?? 'לא נמצא'}</b></div><div className="paper-row"><span>מספר מרכזי</span><b>{form?.centralNumbers.join(', ') || '—'}</b></div><div className="paper-row"><span>התחייבות</span><b>{form?.commitmentNumbers.join(', ') || '—'}</b></div><div className="paper-signature">חתימה: ______________</div>
                        </div>}
                  </div>
                </div>
              </div>
              <div className="preview-caption"><span className="document-caption-dot" />{activeForm?.file ? 'קובץ מקומי · התצוגה לא נשלחת לשרת' : 'מסמך דוגמה · פרטי הטופס להמחשה'}</div>
              <div className="confidence-legend"><span><i className="legend-ok" /> אומת</span><span><i className="legend-review" /> לבדיקה</span><span><i className="legend-empty" /> לא נמצא</span></div>
            </aside> : <aside className="source-panel source-empty" aria-label="תצוגת מסמך מקור"><span className="source-empty-mark" aria-hidden="true">↙</span><strong>תצוגת המסמך</strong><span>המסמך יוצג כאן לאחר בחירת טופס.</span></aside>}
          </div>}

          {forms.length > 0 && activeForm && <div className="batch-bottom-bar">
            <span>טופס {String(activeIndex + 1).padStart(2, '0')} מתוך {String(forms.length).padStart(2, '0')}</span>
            <div className="bottom-progress"><i style={{ width: `${forms.length ? (verifiedCount / forms.length) * 100 : 0}%` }} /></div>
            <span>{verifiedCount} אומתו</span>
            <span className="keyboard-hint"><kbd>←</kbd><kbd>→</kbd> מעבר בין טפסים <kbd>Enter</kbd> אישור</span>
          </div>}
          </>}
        </div>
      </main>
      {notice && <div className="toast" role="status"><span>{notice}</span><button type="button" aria-label="סגירה" onClick={() => setNotice('')}>×</button></div>}
      {isBusy && <div className="thinking-overlay" role="status" aria-live="polite" aria-label={saving ? 'שומרת נתונים' : 'מחלצת נתונים'}>
        <svg className="sheba-thinking-mark" viewBox="82 1 37 54" aria-hidden="true" focusable="false">
          <g className="sheba-arc sheba-arc-green"><path fill="#31b296" d="M113.05 20.09h4c0-9.28-7.52-16.8-16.8-16.8s-16.8 7.52-16.8 16.8 7.52 16.8 16.8 16.8v-4c-7.07 0-12.81-5.73-12.81-12.81s5.73-12.81 12.81-12.81 12.81 5.73 12.81 12.81" /></g>
          <g className="sheba-arc sheba-arc-pink"><path fill="#e6327d" d="M87.43 36.86h-4c0 9.28 7.52 16.8 16.8 16.8s16.8-7.52 16.8-16.8-7.52-16.8-16.8-16.8v4c7.07 0 12.81 5.73 12.81 12.81s-5.73 12.81-12.81 12.81-12.81-5.73-12.81-12.81" /></g>
        </svg>
        <strong>{saving ? 'שומרת נתונים' : 'מחלצת נתונים מהטופס'}</strong>
        <span>{saving ? 'העדכונים נשמרים במסד המקומי' : 'העמוד מעובד כעת. אפשר להמשיך כשהחילוץ יסתיים.'}</span>
      </div>}
    </div>
  )
}

export default App



