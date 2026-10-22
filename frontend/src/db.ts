import Dexie, { type Table } from 'dexie'

export type FormStatus = 'pending' | 'needs_review' | 'verified'
export type ExtractionStatus = 'pending' | 'complete' | 'failed'

export interface BatchRecord {
  id?: number
  createdAt: Date
}

export type FormFieldName = 'formType' | 'sender' | 'firstName' | 'lastName' | 'idNumber'
  | 'receivedDate' | 'centralNumbers' | 'commitmentNumbers'

export interface FieldFlag {
  fieldName: FormFieldName
  reason: string
  originalValue: string | string[] | null
  correctedValue: string | string[] | null
}

export interface FormRecord {
  id?: number
  batchId: number
  fileName: string
  fileHash: string
  pageNumber: number
  formType: string | null
  sender: string | null
  firstName: string | null
  lastName: string | null
  idNumber: string | null
  flags: FieldFlag[]
  status: FormStatus
  extractionStatus?: ExtractionStatus
  extractionError?: string | null
  receivedDate: string | null
  centralNumbers: string[]
  commitmentNumbers: string[]
  verifiedAt: Date | null
  exportedAt: Date | null
}

export type FormCorrections = Partial<Pick<FormRecord,
  'formType' | 'sender' | 'firstName' | 'lastName' | 'idNumber' | 'receivedDate'
  | 'centralNumbers' | 'commitmentNumbers'>>

export interface FormSearchFilters {
  status?: FormStatus
  batchId?: number
  search?: string
}

export interface ExtractionData {
  formType?: string | null
  sender?: string | null
  firstName?: string | null
  lastName?: string | null
  idNumber?: string | null
  receivedDate?: string | null
  centralNumbers?: string[]
  commitmentNumbers?: string[]
}

export interface ExtractionFlag {
  fieldName: FormFieldName
  reason: string
  originalValue?: FieldFlag['originalValue']
}

class FormsDatabase extends Dexie {
  batches!: Table<BatchRecord, number>
  forms!: Table<FormRecord, number>

  constructor() {
    super('lab-commitment-forms')
    this.version(1).stores({
      batches: '++id, createdAt',
      forms: '++id, batchId, fileHash, pageNumber, &[fileHash+pageNumber], status, verifiedAt, exportedAt, sender, firstName, lastName, idNumber, *centralNumbers',
    })
  }
}

export const db = new FormsDatabase()

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false
  return navigator.storage.persist()
}

export async function createBatch() {
  const batch: BatchRecord = { createdAt: new Date() }
  return db.batches.add(batch)
}

export async function calculateFileHash(file: Blob) {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function saveExtraction(
  batchId: number,
  file: Blob,
  fileName: string,
  pageNumber: number,
  data: ExtractionData,
  flags: ExtractionFlag[] = [],
) {
  const fileHash = await calculateFileHash(file)
  const existing = await db.forms.where('[fileHash+pageNumber]').equals([fileHash, pageNumber]).first()
  if (existing) return null

  const form: FormRecord = {
    batchId,
    fileName,
    fileHash,
    pageNumber,
    formType: data.formType ?? null,
    sender: data.sender ?? null,
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null,
    idNumber: data.idNumber ?? null,
    receivedDate: data.receivedDate ?? null,
    centralNumbers: data.centralNumbers ?? [],
    commitmentNumbers: data.commitmentNumbers ?? [],
    flags: flags.map((flag) => ({
      fieldName: flag.fieldName,
      reason: flag.reason,
      originalValue: flag.originalValue ?? data[flag.fieldName as keyof ExtractionData] ?? null,
      correctedValue: null,
    })),
    status: flags.length ? 'needs_review' : 'pending',
    extractionStatus: 'complete',
    extractionError: null,
    verifiedAt: null,
    exportedAt: null,
  }

  try {
    return await db.forms.add(form)
  } catch (error) {
    if (error instanceof Dexie.ConstraintError) return null
    throw error
  }
}

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function verifyForm(formId: number, corrections: FormCorrections = {}) {
  return db.transaction('rw', db.forms, async () => {
    const form = await db.forms.get(formId)
    if (!form) throw new Error(`Form ${formId} was not found`)

    for (const [fieldName, value] of Object.entries(corrections) as Array<[keyof FormCorrections, FormCorrections[keyof FormCorrections]]>) {
      const existingFlag = form.flags.find((flag) => flag.fieldName === fieldName)
      if (valuesEqual(form[fieldName as keyof FormRecord], value)) {
        if (existingFlag) existingFlag.correctedValue = value as FieldFlag['correctedValue']
        continue
      }
      if (existingFlag) {
        existingFlag.correctedValue = value as FieldFlag['correctedValue']
      } else {
        form.flags.push({
          fieldName: fieldName as FieldFlag['fieldName'],
          reason: 'תוקן בבדיקה ידנית',
          originalValue: (form[fieldName as keyof FormRecord] as FieldFlag['originalValue']) ?? null,
          correctedValue: value as FieldFlag['correctedValue'],
        })
      }
      Object.assign(form, { [fieldName]: value })
    }

    for (const flag of form.flags) {
      if (flag.correctedValue !== null) continue
      const reviewedValue = form[flag.fieldName as keyof FormRecord]
      flag.correctedValue = (reviewedValue as FieldFlag['correctedValue']) ?? null
    }

    form.status = 'verified'
    form.verifiedAt = new Date()
    await db.forms.put(form)
    return form
  })
}

export async function listForms(filters: FormSearchFilters = {}) {
  const collection = filters.status
    ? db.forms.where('status').equals(filters.status)
    : db.forms.toCollection()
  let forms = await collection.toArray()

  if (filters.batchId !== undefined) forms = forms.filter((form) => form.batchId === filters.batchId)
  const query = filters.search?.trim().toLocaleLowerCase()
  if (query) {
    forms = forms.filter((form) => [
      form.firstName,
      form.lastName,
      form.idNumber,
      ...form.centralNumbers,
    ].some((value) => value?.toLocaleLowerCase().includes(query)))
  }
  return forms.sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
}

export function listBatches() {
  return db.batches.orderBy('createdAt').reverse().toArray()
}

export async function clearAll() {
  await db.transaction('rw', db.forms, db.batches, async () => {
    await db.forms.clear()
    await db.batches.clear()
  })
}

export async function createPendingExtraction(
  batchId: number,
  file: Blob,
  fileName: string,
  pageNumber: number,
) {
  const fileHash = await calculateFileHash(file)
  const existing = await db.forms.where('[fileHash+pageNumber]').equals([fileHash, pageNumber]).first()
  if (existing) return { id: existing.id!, form: existing, created: false }

  const form: FormRecord = {
    batchId,
    fileName,
    fileHash,
    pageNumber,
    formType: 'commitment',
    sender: null,
    firstName: null,
    lastName: null,
    idNumber: null,
    receivedDate: null,
    centralNumbers: [],
    commitmentNumbers: [],
    flags: [],
    status: 'pending',
    extractionStatus: 'pending',
    extractionError: null,
    verifiedAt: null,
    exportedAt: null,
  }
  try {
    const id = await db.forms.add(form)
    return { id, form: { ...form, id }, created: true }
  } catch (error) {
    if (!(error instanceof Dexie.ConstraintError)) throw error
    const raced = await db.forms.where('[fileHash+pageNumber]').equals([fileHash, pageNumber]).first()
    if (!raced) throw error
    return { id: raced.id!, form: raced, created: false }
  }
}

export async function markExtractionPending(formId: number) {
  await db.forms.update(formId, { extractionStatus: 'pending', extractionError: null })
}

export async function markFieldReviewed(
  formId: number,
  fieldName: FormFieldName,
  value: FieldFlag['correctedValue'],
) {
  if (value == null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)) {
    throw new Error('יש להזין ערך לפני אישור מול הטופס.')
  }
  return db.transaction('rw', db.forms, async () => {
    const form = await db.forms.get(formId)
    if (!form) throw new Error(`Form ${formId} was not found`)
    const existingFlag = form.flags.find((flag) => flag.fieldName === fieldName)
    if (existingFlag) {
      existingFlag.correctedValue = value
    } else {
      form.flags.push({
        fieldName,
        reason: 'אומת ידנית מול הטופס',
        originalValue: (form[fieldName as keyof FormRecord] as FieldFlag['originalValue']) ?? null,
        correctedValue: value,
      })
    }
    Object.assign(form, { [fieldName]: value })
    if (form.status === 'needs_review' && form.flags.every((flag) => flag.correctedValue !== null)) {
      form.status = 'pending'
    }
    await db.forms.put(form)
    return form
  })
}

export async function completeExtraction(formId: number, data: ExtractionData, flags: ExtractionFlag[] = []) {
  return db.transaction('rw', db.forms, async () => {
    const form = await db.forms.get(formId)
    if (!form) throw new Error(`Form ${formId} was not found`)
    Object.assign(form, {
      formType: data.formType ?? form.formType ?? 'commitment',
      sender: data.sender ?? null,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      idNumber: data.idNumber ?? null,
      receivedDate: data.receivedDate ?? null,
      centralNumbers: data.centralNumbers ?? [],
      commitmentNumbers: data.commitmentNumbers ?? [],
      flags: flags.map((flag) => ({
        fieldName: flag.fieldName,
        reason: flag.reason,
        originalValue: flag.originalValue ?? data[flag.fieldName as keyof ExtractionData] ?? null,
        correctedValue: null,
      })),
      status: flags.length ? 'needs_review' : 'pending',
      extractionStatus: 'complete',
      extractionError: null,
    })
    await db.forms.put(form)
    return form
  })
}

export async function failExtraction(formId: number, error: string) {
  const form = await db.forms.get(formId)
  if (!form || form.extractionStatus === 'complete') return
  await db.forms.update(formId, { extractionStatus: 'failed', extractionError: error })
}