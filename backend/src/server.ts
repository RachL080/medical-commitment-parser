import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { resolve } from 'node:path'
import { GoogleGenAI, Type } from '@google/genai'

const app = express()
const port = Number(process.env.PORT ?? 8787)
const frontendDistPath = resolve(__dirname, '../../frontend/dist')
const allowedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error('נתמכים קובצי PDF, PNG, JPEG ו־WebP בלבד'))
      return
    }
    callback(null, true)
  },
})

const organizationNames = [
  'שירותי בריאות כללית', 'מכבי שירותי בריאות', 'מאוחדת', 'לאומית שירותי בריאות',
  'המרכז הרפואי שיבא - תל השומר', 'המרכז הרפואי תל אביב - איכילוב',
  'המרכז הרפואי רבין - בילינסון', 'המרכז הרפואי רבין - השרון',
  'המרכז הרפואי שמיר - אסף הרופא', 'המרכז הרפואי סורוקה', 'המרכז הרפואי רמב״ם',
  'המרכז הרפואי בני ציון', 'המרכז הרפואי כרמל', 'המרכז הרפואי העמק',
  'המרכז הרפואי מאיר', 'המרכז הרפואי קפלן', 'המרכז הרפואי הלל יפה',
  'המרכז הרפואי ברזילי', 'המרכז הרפואי זיו', 'המרכז הרפואי לגליל - נהריה',
  'המרכז הרפואי צפון - פוריה', 'המרכז הרפואי יוספטל', 'המרכז הרפואי וולפסון',
  'המרכז הרפואי אסותא אשדוד', 'המרכז הרפואי הדסה - עין כרם',
  'המרכז הרפואי הדסה - הר הצופים', 'המרכז הרפואי שערי צדק',
  'המרכז הרפואי לניאדו', 'המרכז הרפואי מעייני הישועה',
  'המרכז הרפואי הצרפתי סנט וינסנט דה פול - נצרת', 'אסותא רמת החייל',
  'אסותא חיפה', 'אסותא ראשון לציון', 'אסותא באר שבע', 'הרצליה מדיקל סנטר',
  'מדיקה - תל אביב', 'בית חולים אלישע', 'רפאל בתי חולים',
  'המרכז לבריאות הנפש אברבנאל', 'המרכז לבריאות הנפש גהה',
  'המרכז לבריאות הנפש לב השרון', 'המרכז לבריאות הנפש שער מנשה',
  'המרכז לבריאות הנפש באר יעקב - נס ציונה',
  'המרכז הירושלמי לבריאות הנפש - כפר שאול ואיתנים',
  'המרכז לבריאות הנפש מעלה הכרמל', 'המרכז לבריאות הנפש טירת כרמל',
  'המרכז לבריאות הנפש מרחבים', 'המרכז לבריאות הנפש שלוותה',
  'המרכז לבריאות הנפש הרצוג', 'מרכז שניידר לרפואת ילדים',
  'בית החולים דנה-דואק לילדים', 'בית החולים לילדים ספרא - שיבא',
  'בית החולים אלי״ן', 'המרכז הרפואי לשיקום לוינשטיין',
  'בית החולים השיקומי רעות', 'המרכז הרפואי הגריאטרי בית רבקה',
  'המרכז הרפואי הגריאטרי הרצפלד', 'המרכז הרפואי הגריאטרי שמואל הרופא',
  'המרכז הרפואי הגריאטרי פלימן', 'המרכז הרפואי הגריאטרי דורות',
  'בית החולים האנגלי בנצרת', 'בית החולים האיטלקי בנצרת',
  'בית החולים הצרפתי בנצרת', 'בית החולים הסקוטי בטבריה',
]

const organizationAliases: Record<string, string[]> = {
  'שירותי בריאות כללית': ['כללית', 'שירותי בריאות כללית'],
  'מכבי שירותי בריאות': ['מכבי', 'מכבי שירותי בריאות'],
  'מאוחדת': ['מאוחדת', 'קופת חולים מאוחדת'],
  'לאומית שירותי בריאות': ['לאומית', 'לאומית שירותי בריאות'],
  'המרכז הרפואי שיבא - תל השומר': ['shiv', 'תל השומר'],
  'המרכז הרפואי תל אביב - איכילוב': ['איכילוב'],
  'המרכז הרפואי רבין - בילינסון': ['בילינסון'],
  'המרכז הרפואי רבין - השרון': ['בית חולים השרון'],
  'המרכז הרפואי שמיר - אסף הרופא': ['אסף הרופא', 'שמיר'],
  'המרכז הרפואי רמב״ם': ['רמבם', 'רמב״ם'],
  'המרכז הרפואי הדסה - עין כרם': ['הדסה עין כרם'],
  'המרכז הרפואי הדסה - הר הצופים': ['הדסה הר הצופים'],
  'המרכז הרפואי שערי צדק': ['שערי צדק'],
}

function normalizeOrganizationText(value: string) {
  return value.normalize('NFKC').replace(/[׳´׳³"']/gu, '').replace(/[ײ¾ג€“ג€”-]/gu, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ')
}

function matchKnownOrganization(observedText: string) {
  const observed = normalizeOrganizationText(observedText)
  const matches = organizationNames.filter((name) => {
    const aliases = [name, ...(organizationAliases[name] ?? [])]
    return aliases.some((alias) => {
      const normalizedAlias = normalizeOrganizationText(alias)
      return normalizedAlias.length >= 4 && (` ${observed} `).includes(` ${normalizedAlias} `)
    })
  })
  return matches.length === 1 ? matches[0] : null
}

function normalizeDigits(value: string) {
  return value.replace(/\D/gu, '')
}

function isValidIsraeliId(value: string) {
  const digits = normalizeDigits(value).padStart(9, '0')
  if (!/^\d{9}$/u.test(digits)) return false
  const checksum = [...digits].reduce((sum, digit, index) => {
    const product = Number(digit) * (index % 2 === 0 ? 1 : 2)
    return sum + (product > 9 ? product - 9 : product)
  }, 0)
  return checksum % 10 === 0
}

function parseIsraeliDate(value: string) {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(value.trim())
  const local = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/u.exec(value.trim())
  const rawYear = iso?.[1] ?? local?.[3]
  const parsedYear = Number(rawYear)
  const year = rawYear?.length === 2 ? (parsedYear >= 50 ? 1900 + parsedYear : 2000 + parsedYear) : parsedYear
  const month = Number(iso?.[2] ?? local?.[2])
  const day = Number(iso?.[3] ?? local?.[1])
  if (!year || !month || !day) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function hasDateEvidence(value: string, evidence: string) {
  const expected = parseIsraeliDate(value)
  if (!expected) return false
  if (!/התקבל|נתקבל/iu.test(evidence)) return false
  const dates = evidence.match(/(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/gu) ?? []
  return dates.some((date) => parseIsraeliDate(date) === expected)
}

function getGeminiErrorStatus(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number(error.status)
    : 0
}

function getGeminiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown Gemini error'
}

function createStatusError(status: number, message: string) {
  return Object.assign(new Error(message), { status })
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(createStatusError(504, timeoutMessage)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

function isModelUnavailableError(error: unknown) {
  const status = getGeminiErrorStatus(error)
  if (status === 404) return true
  if (status !== 400) return false
  const message = getGeminiErrorMessage(error).toLowerCase()
  return /model|unsupported|unavailable|not\s+found|not\s+supported|unknown/u.test(message)
}

function needsOrientationRetry(result: Record<string, unknown>) {
  const orientation = Number(result.orientationDegrees)
  return [90, 180, 270].includes(orientation)
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    firstName: { type: Type.STRING, nullable: true },
    firstNameEvidence: { type: Type.STRING },
    lastName: { type: Type.STRING, nullable: true },
    lastNameEvidence: { type: Type.STRING },
    idNumber: { type: Type.STRING, nullable: true },
    idNumberEvidence: { type: Type.STRING },
    centralNumbers: { type: Type.ARRAY, items: { type: Type.STRING } },
    centralNumbersEvidence: { type: Type.STRING },
    sampleReceivedDate: { type: Type.STRING, nullable: true },
    sampleReceivedDateEvidence: { type: Type.STRING },
    referringOrganization: { type: Type.STRING, nullable: true },
    referringOrganizationEvidence: {
      type: Type.STRING,
      enum: ['text', 'logo', 'both', 'none', 'uncertain'],
    },
    referringOrganizationObservedText: { type: Type.STRING, nullable: true },
    referringOrganizationContext: { type: Type.STRING, nullable: true },
    referringOrganizationLogoText: { type: Type.STRING, nullable: true },
    referringOrganizationCandidate: { type: Type.STRING, nullable: true, enum: organizationNames },
    commitmentNumbers: { type: Type.ARRAY, items: { type: Type.STRING } },
    uncertainFields: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        enum: ['firstName', 'lastName', 'idNumber', 'centralNumbers', 'sampleReceivedDate', 'referringOrganization', 'commitmentNumbers'],
      },
    },
    fieldReasons: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          fieldName: { type: Type.STRING, enum: ['firstName', 'lastName', 'idNumber', 'centralNumbers', 'sampleReceivedDate', 'referringOrganization', 'commitmentNumbers'] },
          reason: { type: Type.STRING },
        },
        required: ['fieldName', 'reason'],
      },
    },
    orientationDegrees: { type: Type.STRING, enum: ['0', '90', '180', '270'] },
  },
  required: ['firstName', 'firstNameEvidence', 'lastName', 'lastNameEvidence', 'idNumber', 'idNumberEvidence', 'centralNumbers', 'centralNumbersEvidence', 'sampleReceivedDate', 'sampleReceivedDateEvidence', 'referringOrganization', 'referringOrganizationEvidence', 'referringOrganizationObservedText', 'referringOrganizationContext', 'referringOrganizationLogoText', 'referringOrganizationCandidate', 'commitmentNumbers', 'uncertainFields', 'fieldReasons', 'orientationDegrees'],
}

app.get('/api/health', (_request, response) => response.json({ ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY) }))

app.get('/api/models', async (_request, response) => {
  if (!process.env.GEMINI_API_KEY) {
    response.status(503).json({ error: 'מפתח Gemini אינו מוגדר.' })
    return
  }
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const models = await ai.models.list()
    const availableModels: string[] = []
    for await (const model of models) {
      if (model.name && model.supportedActions?.includes('generateContent')) {
        availableModels.push(model.name.replace(/^models\//u, ''))
      }
    }
    response.json({ models: availableModels })
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number(error.status)
      : 0
    const diagnostic = error instanceof Error ? error.message : 'Unknown Gemini error'
    const safeDiagnostic = process.env.GEMINI_API_KEY
      ? diagnostic.replaceAll(process.env.GEMINI_API_KEY, '[REDACTED]')
      : diagnostic
    response.status(502).json({ error: status === 401 || status === 403
      ? 'Google דחה את המפתח או שאין לו הרשאה לרשום מודלים.'
      : 'לא ניתן לקבל את רשימת המודלים מ־Gemini כרגע.' })
  }
})

app.post('/api/extract', upload.single('file'), async (request, response) => {
  if (!process.env.GEMINI_API_KEY) {
    response.status(503).json({ error: 'Missing Gemini API key. Set GEMINI_API_KEY in your backend environment variables.' })
    return
  }
  const uploadedFile = request.file
  if (!uploadedFile) {
    response.status(400).json({ error: 'No upload file received.' })
    return
  }

  try {
    const createImageCandidates = (degreesToTry: number[]) => Promise.all(degreesToTry.map(async (degrees) => {
      const rotated = await sharp(uploadedFile.buffer, { failOn: 'none' })
        .rotate(degrees)
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer()
      return { degrees, inlineData: { mimeType: 'image/jpeg', data: rotated.toString('base64') } }
    }))
    const candidates = uploadedFile.mimetype === 'application/pdf'
      ? [{ degrees: 0, inlineData: { mimeType: uploadedFile.mimetype, data: uploadedFile.buffer.toString('base64') } }]
      : await createImageCandidates([0])
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const requestTimeoutMs = parsePositiveInt(process.env.GEMINI_REQUEST_TIMEOUT_MS, 25_000)
    const orientationRetryTimeoutMs = parsePositiveInt(
      process.env.GEMINI_ORIENTATION_TIMEOUT_MS,
      Math.max(12_000, Math.floor(requestTimeoutMs * 0.6)),
    )
    const configuredModel = process.env.GEMINI_MODEL?.trim()
    const fallbackModel = process.env.GEMINI_FALLBACK_MODEL?.trim()
    const modelCandidates = [...new Set([
      configuredModel,
      fallbackModel,
      'gemini-3.5-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
    ].filter((model): model is string => Boolean(model)))]
    const generateExtraction = (model: string, imageCandidates: typeof candidates = candidates, timeoutMs = requestTimeoutMs) => withTimeout(
      ai.models.generateContent({
        model,
        contents: [{
          role: 'user',
          parts: imageCandidates.flatMap((candidate) => [
            ...(imageCandidates.length > 1 ? [{ text: `Candidate orientation ${candidate.degrees} degrees clockwise.` }] : []),
            { inlineData: candidate.inlineData },
          ]).concat([{
            text: [
              'Extract the form fields from the document image and return only the required JSON schema.',
              'CRITICAL NAME RULE: Read a name only from text next to a name label such as שם, שם פרטי, שם משפחה, שם מלא, or שם ופרטי. Names must contain no digits. Never copy an ID, central, commitment, phone, or other number into a name field. Do not invent, infer, autocomplete, or use common names. If a labeled name is partly legible, return only the literal candidate you can read and mark it uncertain with evidence/reason. Return null if the name label/value is absent or no candidate letters are legible.',
              'For every non-null firstName, firstNameEvidence must quote the exact visible letters/words that support it. For every non-null lastName, lastNameEvidence must quote the exact visible letters/words that support it.',
              'If evidence does not contain the returned name, the name contains any digit, or handwriting is not legible enough to read exact letters, return null for that name and include its field key in uncertainFields.',
              'ID RULE: Read an ID number only next to an explicit identity label: ת.ז, ת״ז, תעודת זהות, or מספר זהות. Never use a commitment number, referral number, phone number, or another digit sequence. Return idNumberEvidence quoting the identity label and exact digits. If some digits are visible but uncertain, return the literal candidate and mark idNumber uncertain; return null only when no ID digits are legible.',
              'DATE RULE: Read sampleReceivedDate only from the date stamped with התקבל or נתקבל on the form. Do not use a typed/printed form date, referral date, issue date, or today, even if another date is clearly printed. Return sampleReceivedDateEvidence containing the exact stamp wording (התקבל/נתקבל) and the stamped date. If some stamp digits are visible but uncertain, return the legible date candidate and mark sampleReceivedDate uncertain; return null only when no received-stamp date is legible.',
              'CENTRAL NUMBERS RULE: Inspect every sticker and field labeled מספר מרכזי, מספרים מרכזיים, or מרכזי. A document may contain more than one central number, including multiple stickers; return every distinct central number in centralNumbers, never only the first, and preserve each number exactly. centralNumbersEvidence must quote the מרכזי label/sticker wording that identifies these values. Exclude ID numbers, commitment numbers, phone numbers, and unrelated reference numbers. Mark centralNumbers uncertain if any candidate digits are ambiguous or the label/value association is unclear.',
              'If there are separate labeled first-name and family-name fields, read them independently. Only when there is one combined full-name field, use its last word as family name and preceding words as given name; never split an unlabeled text into names.',
              `REFERRING ORGANIZATION LIST (choose the canonical name before parentheses): ${organizationNames.map((name) => `${name}${organizationAliases[name]?.length ? ` (brand aliases: ${organizationAliases[name].join(', ')})` : ''}`).join(' | ')}`,
              'REFERRING ORGANIZATION RULE: Visually inspect the logo/emblem belonging to the referring organization, not the receiving lab/hospital. Transcribe its visible wording exactly into referringOrganizationLogoText, then compare that wording (including known short brand names/aliases) against the supplied organization list. Return the exact matching list item as referringOrganizationCandidate; return null if the logo cannot be matched to exactly one list item. Do not identify the organization from unrelated printed text or from a logo belonging to the receiving institution. referringOrganizationContext must describe the layout/label showing that this logo belongs to the sender/referrer. If the sender logo or its role is unclear, return null and mark referringOrganization uncertain.',
              'If a field is absent or has no legible candidate, return null. If a candidate is visible but confidence is low, return the literal candidate, include the field in uncertainFields, and explain why. Never guess characters or values.',
              'For each field key in uncertainFields, add a fieldReasons entry with a concise, specific reason based on the image (for example, label missing, handwriting illegible, digits ambiguous, or value not present). Do not include personal values in reasons.',
            ].join(' '),
          }]),
        }],
        config: {
          responseMimeType: 'application/json',
          responseSchema,
          temperature: 0,
        },
      }),
      timeoutMs,
      `Gemini request timed out after ${timeoutMs}ms`,
    )
    const runExtraction = async (imageCandidates: typeof candidates, timeoutMs = requestTimeoutMs) => {
      let lastError: unknown
      for (let index = 0; index < modelCandidates.length; index += 1) {
        const model = modelCandidates[index]
        try {
          return await generateExtraction(model, imageCandidates, timeoutMs)
        } catch (error) {
          lastError = error
          const status = getGeminiErrorStatus(error)
          const shouldRetryOnNextModel = isModelUnavailableError(error)
            || status === 429
            || status === 503
            || status === 504
          if (!shouldRetryOnNextModel || index === modelCandidates.length - 1) throw error
          console.warn('Gemini primary model failed, trying fallback model:', model, status, getGeminiErrorMessage(error).slice(0, 300))
        }
      }
      throw lastError ?? createStatusError(502, 'Gemini extraction failed without a specific error')
    }
    let result = await runExtraction(candidates)

    if (!result.text) {
      response.status(502).json({ error: 'מודל החילוץ לא החזיר תוצאה.' })
      return
    }
    let extracted = JSON.parse(result.text) as {
      firstName?: string | null
      firstNameEvidence?: string
      lastName?: string | null
      lastNameEvidence?: string
      idNumber?: string | null
      idNumberEvidence?: string
      centralNumbers?: string[]
      centralNumbersEvidence?: string
      sampleReceivedDate?: string | null
      sampleReceivedDateEvidence?: string
      referringOrganization?: string | null
      referringOrganizationEvidence?: 'text' | 'logo' | 'both' | 'none' | 'uncertain'
      referringOrganizationObservedText?: string | null
      referringOrganizationContext?: string | null
      referringOrganizationLogoText?: string | null
      referringOrganizationCandidate?: string | null
      orientationDegrees?: number | string
      uncertainFields?: string[]
        fieldReasons?: Array<{ fieldName: string; reason: string }>
      [key: string]: unknown
    }
    if (uploadedFile.mimetype !== 'application/pdf' && needsOrientationRetry(extracted)) {
      try {
        const detectedOrientation = Number(extracted.orientationDegrees)
        const rotatedCandidates = await createImageCandidates([detectedOrientation])
        const rotatedResult = await runExtraction(rotatedCandidates, orientationRetryTimeoutMs)
        if (rotatedResult.text) {
          const rotatedExtraction = JSON.parse(rotatedResult.text) as typeof extracted
          extracted = rotatedExtraction
        }
      } catch (error) {
        console.warn('Gemini orientation retry failed; keeping first extraction:', getGeminiErrorStatus(error), getGeminiErrorMessage(error).slice(0, 400))
      }
    }
    const uncertainFields = new Set(extracted.uncertainFields ?? [])
    for (const [nameKey, evidenceKey] of [['firstName', 'firstNameEvidence'], ['lastName', 'lastNameEvidence']] as const) {
      const name = extracted[nameKey]?.trim()
      const evidence = extracted[evidenceKey]?.trim() ?? ''
      const normalizedName = name?.replace(/\s+/gu, ' ').toLocaleLowerCase('he')
      const normalizedEvidence = evidence.replace(/\s+/gu, ' ').toLocaleLowerCase('he')
      if (name && /\p{N}/u.test(name)) {
        extracted[nameKey] = null
        uncertainFields.add(nameKey)
      } else if (name && (!normalizedEvidence || !normalizedEvidence.includes(normalizedName!))) {
        uncertainFields.add(nameKey)
      } else if (!name) {
        uncertainFields.add(nameKey)
      }
    }
    extracted.centralNumbers = [...new Set(extracted.centralNumbers ?? [])]
    if (extracted.centralNumbers.length > 0 && !/מרכזי/iu.test(extracted.centralNumbersEvidence ?? '')) {
      uncertainFields.add('centralNumbers')
    }
    if (extracted.idNumber) {
      const evidenceDigits = normalizeDigits(extracted.idNumberEvidence ?? '')
      const idDigits = normalizeDigits(extracted.idNumber)
      const hasIdentityLabel = /(?:ת\s*[.״"׳']?\s*ז|תעודת\s+זהות|מספר\s+זהות)/iu.test(extracted.idNumberEvidence ?? '')
      if (!isValidIsraeliId(idDigits) || evidenceDigits !== idDigits || !hasIdentityLabel) {
        uncertainFields.add('idNumber')
      }
    } else {
      uncertainFields.add('idNumber')
    }
    if (extracted.sampleReceivedDate) {
      const parsedDate = parseIsraeliDate(extracted.sampleReceivedDate)
      if (!parsedDate) {
        uncertainFields.add('sampleReceivedDate')
      } else {
        extracted.sampleReceivedDate = parsedDate
        if (!hasDateEvidence(extracted.sampleReceivedDate, extracted.sampleReceivedDateEvidence ?? '')) {
          uncertainFields.add('sampleReceivedDate')
        }
      }
    } else {
      uncertainFields.add('sampleReceivedDate')
    }
    const observedOrganizationText = extracted.referringOrganizationObservedText ?? ''
    const logoOrganizationText = extracted.referringOrganizationLogoText ?? ''
    const candidateOrganization = organizationNames.includes(extracted.referringOrganizationCandidate ?? '')
      ? extracted.referringOrganizationCandidate!
      : null
    const parsedOrientation = Number(extracted.orientationDegrees)
    extracted.orientationDegrees = [0, 90, 180, 270].includes(parsedOrientation) ? parsedOrientation : 0
    const organizationContext = extracted.referringOrganizationContext ?? ''
    const hasReferrerContext = /ארגון\s+מפנה|גורם\s+מפנה|מוסד\s+מפנה|קופת\s+החולים\s+המפנה|מבוטח\s+ב|קופה|נשלח\s+מאת|נשלח\s+על\s+ידי|שם\s+המבוטח|פרטי\s+המבוטח|לוגו|סמל|referr|sender|member|logo/iu.test(organizationContext)
    const logoMatchedOrganization = matchKnownOrganization(logoOrganizationText)
    const matchedOrganization = hasReferrerContext
      ? logoMatchedOrganization && (!candidateOrganization || candidateOrganization === logoMatchedOrganization)
        ? logoMatchedOrganization
        : null
      : null

    if (!matchedOrganization) {
      extracted.referringOrganization = null
      extracted.referringOrganizationEvidence = observedOrganizationText || logoOrganizationText ? 'uncertain' : 'none'
      uncertainFields.add('referringOrganization')
    } else {
      extracted.referringOrganization = matchedOrganization
      extracted.referringOrganizationCandidate = matchedOrganization
      if (extracted.referringOrganizationEvidence === 'logo' && !logoOrganizationText) uncertainFields.add('referringOrganization')
    }

    const reasonByField = new Map((extracted.fieldReasons ?? []).map(({ fieldName, reason }) => [fieldName, reason]))
    const fallbackReasons: Record<string, string> = {
      idNumber: 'מספר הזהות חסר, לא קריא או לא עבר אימות ספרת ביקורת.',
      centralNumbers: 'לא נמצאה ראיה ברורה שמספרי המרכזי מופיעים על מדבקת מרכזי.',
      sampleReceivedDate: 'תאריך הקבלה חסר, לא קריא או לא תאם לראיה במסמך.',
      referringOrganization: 'לא נמצאה התאמה ודאית בין שם הארגון לבין גורם מפנה במסמך.',
    }
    extracted.uncertainFields = [...uncertainFields]
    extracted.fieldReasons = [...uncertainFields].map((fieldName) => ({
      fieldName,
      reason: reasonByField.get(fieldName) ?? fallbackReasons[fieldName] ?? 'הערך חסר או לא קריא במסמך.',
    }))

    response.json(extracted)
  } catch (error) {
    const status = getGeminiErrorStatus(error)
    const diagnostic = getGeminiErrorMessage(error)
    const safeDiagnostic = process.env.GEMINI_API_KEY
      ? diagnostic.replaceAll(process.env.GEMINI_API_KEY, '[REDACTED]')
      : diagnostic
    if (status === 401) {
      response.status(502).json({ error: 'Gemini דחה את המפתח. ודאי שזה API key פעיל מ־Google AI Studio ולא OAuth token, עדכני את משתני הסביבה של השרת והפעילי מחדש.' })
      return
    }
    if (status === 403) {
      response.status(502).json({ error: 'למפתח אין הרשאה לשירות Gemini או למודל שנבחר. בדקי הרשאות ו־billing בפרויקט Google.' })
      return
    }
    if (isModelUnavailableError(error)) {
      const configuredModel = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite'
      console.error('Gemini model unavailable:', status, configuredModel, safeDiagnostic.slice(0, 1200))
      response.status(502).json({ error: 'מודל Gemini שנבחר אינו זמין בפרויקט. בדקי את GEMINI_MODEL במשתני הסביבה של השרת (לדוגמה Render) והגדירי gemini-3.5-flash-lite.' })
      return
    }
    if (status === 429) {
      response.status(429).json({ error: 'מכסת Gemini נוצלה או שקצב הבקשות גבוה מדי. בדקי מכסה וחיוב בפרויקט Google ונסי שוב מאוחר יותר.' })
      return
    }
    if (status === 504) {
      response.status(503).json({ error: 'שירות Gemini איטי כרגע והבקשה הופסקה כדי לא לחסום את התור. נסי שוב בעוד כדקה.' })
      return
    }
    console.error('Gemini extraction failed:', status, safeDiagnostic.slice(0, 1200))
    response.status(status >= 500 ? status : 502).json({ error: status >= 500 ? 'שירות Gemini אינו זמין כרגע. נסי שוב בעוד כמה דקות.' : 'החילוץ נכשל מול שירות Gemini. בדקי את החיבור והגדרות הפרויקט ונסי שוב.' })
  }
})

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'בקשת ההעלאה נכשלה.'
  response.status(400).json({ error: message })
})

app.use(express.static(frontendDistPath))
app.get('/{*path}', (request, response, next) => {
  if (request.path.startsWith('/api/')) {
    next()
    return
  }
  response.sendFile(resolve(frontendDistPath, 'index.html'), (error) => {
    if (error) next(error)
  })
})

app.listen(port, '0.0.0.0', () => console.log(`Extraction server listening on port ${port}`))

