import { describe, expect, test } from 'bun:test'
import { cik10, DEFAULT_BREACH_ITEMS, DEFAULT_WATCH_ITEMS, eightKs, filingUrl, itemsOf, maskOf, pickEvent, Severity, severityOf, sinceDateFrom, submissionsUrl } from './edgar'

const BREACH = maskOf(DEFAULT_BREACH_ITEMS), WATCH = maskOf(DEFAULT_WATCH_ITEMS)
// Shape copied from a real data.sec.gov submissions response (values made up for the test).
const subs = (rows: Array<[string, string, string, string]>) => ({
	cik: '320193', name: 'Example Issuer Inc.',
	filings: { recent: {
		accessionNumber: rows.map((r) => r[0]), form: rows.map((r) => r[1]), filingDate: rows.map((r) => r[2]),
		items: rows.map((r) => r[3]), primaryDocument: rows.map((_, i) => `doc${i}.htm`),
	} },
})

describe('item masks', () => {
	test('round-trips item numbers and ignores unknown ones', () => {
		const m = maskOf(['1.03', ' 9.01', '99.9'])
		expect(itemsOf(m)).toEqual(['1.03', '9.01'])
		expect(maskOf([])).toBe(0)
		expect(itemsOf(maskOf(['9.01']))).toEqual(['9.01']) // bit 31 stays unsigned
		expect(maskOf(['9.01'])).toBeGreaterThan(0)
	})
	test('severity: breach > watch > info > none', () => {
		expect(severityOf(maskOf(['2.02', '1.03']), BREACH, WATCH)).toBe(Severity.BREACH)
		expect(severityOf(maskOf(['1.01', '9.01']), BREACH, WATCH)).toBe(Severity.WATCH)
		expect(severityOf(maskOf(['2.02', '9.01']), BREACH, WATCH)).toBe(Severity.INFO)
		expect(severityOf(0, BREACH, WATCH)).toBe(Severity.NONE)
	})
})

describe('eightKs / pickEvent', () => {
	const doc = subs([
		['0000000001-26-000009', '10-Q', '2026-10-10', ''],
		['0000000001-26-000008', '8-K', '2026-10-09', '2.02,9.01'],
		['0000000001-26-000007', '8-K/A', '2026-10-05', '1.01'],
		['0000000001-26-000006', '8-K', '2026-10-02', '2.04,9.01'],
		['0000000001-26-000001', '8-K', '2026-01-02', '1.03'],
	])
	test('keeps only 8-K and 8-K/A, parses dates and items', () => {
		const f = eightKs(doc)
		expect(f.map((x) => x.accession)).toEqual(['0000000001-26-000008', '0000000001-26-000007', '0000000001-26-000006', '0000000001-26-000001'])
		expect(f[0]).toEqual({ accession: '0000000001-26-000008', form: '8-K', filingDate: 20261009, itemsMask: maskOf(['2.02', '9.01']), primaryDocument: 'doc1.htm' })
	})
	test('picks the most severe filing inside the window (old bankruptcy outside window is ignored)', () => {
		const e = pickEvent(eightKs(doc), 20261001, BREACH, WATCH)
		expect(e?.severity).toBe(Severity.BREACH)
		expect(e?.filing.accession).toBe('0000000001-26-000006')
		expect(pickEvent(eightKs(doc), 20261003, BREACH, WATCH)?.severity).toBe(Severity.WATCH)
		expect(pickEvent(eightKs(doc), 20261006, BREACH, WATCH)?.severity).toBe(Severity.INFO)
		expect(pickEvent(eightKs(doc), 20261011, BREACH, WATCH)).toBeNull()
	})
	test('rejects documents that are not EDGAR submissions', () => {
		expect(() => eightKs({ hello: 1 })).toThrow(/not an EDGAR/)
		expect(() => eightKs(subs([['a', '8-K', '10/02/2026', '1.03']]))).toThrow(/bad filingDate/)
	})
})

describe('urls and dates', () => {
	test('CIK padding and filing urls', () => {
		expect(cik10('320193')).toBe('0000320193')
		expect(cik10('CIK0000320193')).toBe('0000320193')
		expect(() => cik10('12345678901')).toThrow()
		expect(() => cik10('../x')).toThrow()
		expect(submissionsUrl(320193)).toBe('https://data.sec.gov/submissions/CIK0000320193.json')
		expect(filingUrl('320193', { accession: '0000320193-26-000018', primaryDocument: 'aapl-20260730.htm' }))
			.toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000018/aapl-20260730.htm')
	})
	test('sinceDateFrom', () => {
		expect(sinceDateFrom(Date.UTC(2026, 9, 15, 3), 14)).toBe(20261001)
		expect(sinceDateFrom(Date.UTC(2026, 0, 2), 3)).toBe(20251230)
	})
})
