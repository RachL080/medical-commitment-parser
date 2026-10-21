import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import { createWorker } from 'tesseract.js'
import type { ExtractedForm } from './types'

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export type OcrProgress = (progress: number, message: string) => void

export interface OcrResult {
  data: ExtractedForm
  uncertainFields: Array<keyof ExtractedForm>
  recognizedText: string
}

function normalizeDigits(value: string) {
  return value.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
}

function findLabeledValue(text: string, labels: string[], pattern: RegExp) {
  const normalized = normalizeDigits(text)
  for (const label of labels) {
    for (const line of normalized.split(/\r?\n/u)) {
      const labelIndex = line.indexOf(label)
      if (labelIndex < 0) continue
      const valueAfterLabel = line.slice(labelIndex + label.length)
      const valueBeforeLabel = line.slice(0, labelIndex)
      const match = pattern.exec(`${valueAfterLabel} ${valueBeforeLabel}`)
      if (match?.[0]) return match[0]
    }
  }
  return null
}

function findHebrewName(text: string, label: string) {
  for (const line of text.split(/\r?\n/u)) {
    const labelIndex = line.indexOf(label)
    if (labelIndex < 0) continue
    const remaining = `${line.slice(labelIndex + label.length)} ${line.slice(0, labelIndex)}`
    const words = remaining.match(/[\u05D0-\u05EA]{2,}/gu)
    if (words?.length) return words[0]
  }
  return null
}

function toIsoDate(date: string) {
  const parts = date.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/)
  if (!parts) return null
  const [, day, month, year] = parts
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function extractFields(text: string): OcrResult {
  const firstName = findHebrewName(text, 'שם פרטי')
  const lastName = findHebrewName(text, 'שם משפחה')
  const idNumber = findLabeledValue(text, ['מספר זהות', 'תעודת זהות', 'ת.ז.', 'ת"ז'], /\d{9}/u)
  const commitmentNumber = findLabeledValue(text, ['מספר התחייבות', 'התחייבות מספר'], /\d{7,12}/u)
  const centralNumber = findLabeledValue(text, ['מספר מרכזי', 'מספרים מרכזיים'], /\d{4,10}/u)
  const sampleDateText = findLabeledValue(
    text,
    ['תאריך קבלת הדגימה', 'תאריך קבלת דגימה'],
    /\d{1,2}[./-]\d{1,2}[./-]\d{4}/u,
  )
  const data: ExtractedForm = {
    firstName,
    lastName,
    idNumber,
    centralNumbers: centralNumber ? [centralNumber] : [],
    sampleReceivedDate: sampleDateText ? toIsoDate(sampleDateText) : null,
    referringOrganization: null,
    commitmentNumbers: commitmentNumber ? [commitmentNumber] : [],
  }
  const uncertainFields = Object.keys(data) as Array<keyof ExtractedForm>

  return { data, uncertainFields, recognizedText: text }
}

async function renderPdfPages(file: File, onProgress: OcrProgress) {
  const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const pages: HTMLCanvasElement[] = []
  const pageCount = Math.min(pdf.numPages, 5)

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('לא ניתן לעבד את עמוד ה־PDF בדפדפן')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    pages.push(canvas)
    onProgress(0.08 + (pageNumber / pageCount) * 0.34, `מכינה עמוד ${pageNumber} מתוך ${pdf.numPages}`)
  }

  return pages
}

async function loadImage(file: File) {
  const image = new Image()
  image.src = URL.createObjectURL(file)
  try {
    await image.decode()
    const canvas = document.createElement('canvas')
    const scale = Math.min(2, 2400 / Math.max(image.naturalWidth, image.naturalHeight))
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('לא ניתן לעבד את התמונה בדפדפן')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return [canvas]
  } finally {
    URL.revokeObjectURL(image.src)
  }
}

export async function extractFormFromFile(file: File, onProgress: OcrProgress): Promise<OcrResult> {
  const pages = file.type === 'application/pdf'
    ? await renderPdfPages(file, onProgress)
    : await loadImage(file)
  const worker = await createWorker('heb+eng', undefined, {
    logger: (status) => onProgress(0.42 + status.progress * 0.56, status.status),
  })
  const textParts: string[] = []

  try {
    for (const [index, page] of pages.entries()) {
      const result = await worker.recognize(page)
      textParts.push(result.data.text)
      onProgress(0.42 + ((index + 1) / pages.length) * 0.56, `מזהה טקסט בעמוד ${index + 1} מתוך ${pages.length}`)
    }
  } finally {
    await worker.terminate()
  }

  const recognizedText = textParts.join('\n')
  if (!recognizedText.trim()) throw new Error('לא זוהה טקסט במסמך. אפשר למלא את השדות ידנית.')
  return extractFields(recognizedText)
}
