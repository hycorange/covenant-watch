// CovenantWatch — pure helpers for SEC EDGAR 8-K "legal event" detection (no CRE runtime needed; unit-tested).
//
// Source: https://data.sec.gov/submissions/CIK##########.json  (public, no key; SEC asks for a descriptive
// User-Agent with a contact address and <= 10 requests/second). `filings.recent` holds parallel arrays; for 8-Ks
// the `items` field lists the Form 8-K item numbers, e.g. "1.03,9.01".

/** Form 8-K item numbers, in the order of the SEC form. Bit i of an items mask = ITEMS[i]. */
export const ITEMS = [
	'1.01', '1.02', '1.03', '1.04', '1.05',
	'2.01', '2.02', '2.03', '2.04', '2.05', '2.06',
	'3.01', '3.02', '3.03',
	'4.01', '4.02',
	'5.01', '5.02', '5.03', '5.04', '5.05', '5.06', '5.07', '5.08',
	'6.01', '6.02', '6.03', '6.04', '6.05',
	'7.01', '8.01', '9.01',
] as const
export type Item = (typeof ITEMS)[number]

/** Plain-language meaning of the items that matter for a debt / RWA covenant. */
export const ITEM_LABELS: Partial<Record<Item, string>> = {
	'1.01': 'Entry into a material definitive agreement',
	'1.02': 'Termination of a material definitive agreement',
	'1.03': 'Bankruptcy or receivership',
	'2.03': 'Creation of a direct financial obligation',
	'2.04': 'Triggering events that accelerate or increase a financial obligation',
	'2.06': 'Material impairments',
	'3.01': 'Notice of delisting or failure to satisfy a listing rule',
	'3.03': 'Material modification to rights of security holders',
	'4.01': "Change in registrant's certifying accountant",
	'4.02': 'Non-reliance on previously issued financial statements',
	'5.01': 'Changes in control of registrant',
}

export const maskOf = (items: readonly string[]): number => {
	let m = 0
	for (const raw of items) {
		const i = ITEMS.indexOf(raw.trim() as Item)
		if (i >= 0) m |= 1 << i
	}
	return m >>> 0
}
export const itemsOf = (mask: number): Item[] => ITEMS.filter((_, i) => ((mask >>> i) & 1) === 1)

/** Default "breach" set: bankruptcy, acceleration, delisting, non-reliance. */
export const DEFAULT_BREACH_ITEMS: Item[] = ['1.03', '2.04', '3.01', '4.02']
/** Default "watch" set: material agreements/obligations, impairment, holder rights, auditor change, change of control. */
export const DEFAULT_WATCH_ITEMS: Item[] = ['1.01', '1.02', '2.03', '2.06', '3.03', '4.01', '5.01']

export enum Severity { NONE = 0, INFO = 1, WATCH = 2, BREACH = 3 }

export function severityOf(mask: number, breachMask: number, watchMask: number): Severity {
	if (mask & breachMask) return Severity.BREACH
	if (mask & watchMask) return Severity.WATCH
	return mask ? Severity.INFO : Severity.NONE
}

/** One 8-K filing, reduced to fields every DON node derives identically from the same response. */
export type Filing = {
	accession: string // e.g. 0000320193-26-000018
	form: string // 8-K or 8-K/A
	filingDate: number // YYYYMMDD
	itemsMask: number
	primaryDocument: string
}

type Recent = Partial<Record<'accessionNumber' | 'form' | 'filingDate' | 'items' | 'primaryDocument', string[]>>

const yyyymmdd = (d: string): number => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`bad filingDate ${d}`)
	return Number(d.replaceAll('-', ''))
}

/** All 8-K / 8-K/A filings in `filings.recent`, newest first (the SEC already orders them that way). */
export function eightKs(submissions: unknown): Filing[] {
	const recent = (submissions as { filings?: { recent?: Recent } })?.filings?.recent
	if (!recent?.accessionNumber || !recent.form || !recent.filingDate) throw new Error('not an EDGAR submissions document')
	const out: Filing[] = []
	for (let i = 0; i < recent.accessionNumber.length; i++) {
		const form = recent.form[i]
		if (form !== '8-K' && form !== '8-K/A') continue
		out.push({
			accession: recent.accessionNumber[i],
			form,
			filingDate: yyyymmdd(recent.filingDate[i]),
			itemsMask: maskOf((recent.items?.[i] ?? '').split(',').filter(Boolean)),
			primaryDocument: recent.primaryDocument?.[i] ?? '',
		})
	}
	return out
}

/**
 * The filing to report for an issuer: the newest 8-K on/after `sinceDate` with the highest severity
 * (breach beats watch beats info). Returns null when there is nothing new. Deterministic.
 */
export function pickEvent(filings: Filing[], sinceDate: number, breachMask: number, watchMask: number): { filing: Filing; severity: Severity } | null {
	let best: { filing: Filing; severity: Severity } | null = null
	for (const f of filings) {
		if (f.filingDate < sinceDate) continue
		const s = severityOf(f.itemsMask, breachMask, watchMask)
		if (s === Severity.NONE) continue
		if (!best || s > best.severity) best = { filing: f, severity: s }
	}
	return best
}

export const cik10 = (cik: string | number): string => {
	const s = String(cik).replace(/^CIK/i, '')
	if (!/^\d{1,10}$/.test(s)) throw new Error(`bad CIK ${cik}`)
	return s.padStart(10, '0')
}
export const submissionsUrl = (cik: string | number) => `https://data.sec.gov/submissions/CIK${cik10(cik)}.json`
export const filingUrl = (cik: string | number, f: Pick<Filing, 'accession' | 'primaryDocument'>) =>
	`https://www.sec.gov/Archives/edgar/data/${Number(cik10(cik))}/${f.accession.replaceAll('-', '')}/${f.primaryDocument}`

/** YYYYMMDD of (epoch ms - days). */
export const sinceDateFrom = (nowMs: number, lookbackDays: number): number => {
	const d = new Date(nowMs - lookbackDays * 86_400_000)
	return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}
