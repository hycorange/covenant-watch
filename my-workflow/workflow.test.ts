import { describe, expect } from 'bun:test'
import { TxStatus } from '@chainlink/cre-sdk'
import { addContractMock, EvmMock, HttpActionsMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import { type Address, decodeAbiParameters, parseAbiParameters } from 'viem'
import { CovenantRegistryABI } from '../contracts/abi/CovenantRegistry'
import { accessionHash, encodeLegalEventReport, initWorkflow, onCron, type Config } from './workflow'

const CHAIN_SELECTOR = 16015286601757825753n // ethereum-testnet-sepolia
const REGISTRY = '0x1111111111111111111111111111111111111111' as Address
// 2026-10-15 00:00:00Z
const TICK = { scheduledExecutionTime: { seconds: 1792022400n, nanos: 0 } } as any

const config = (issuers = [{ cik: '1234567', name: 'Acme Notes Issuer' }]): Config => ({
	schedule: '0 0 */6 * * *',
	chainSelectorName: 'ethereum-testnet-sepolia',
	registryAddress: REGISTRY,
	gasLimit: '400000',
	userAgent: 'CovenantWatch test test@example.com',
	lookbackDays: 7,
	breachItems: ['1.03', '2.04', '3.01', '4.02'],
	watchItems: ['1.01', '1.02', '2.03', '2.06', '3.03', '4.01', '5.01'],
	issuers,
})

// Shape of a real data.sec.gov submissions response (values made up for the test).
const edgar = (rows: Array<[string, string, string, string]>) =>
	JSON.stringify({
		cik: '1234567',
		filings: {
			recent: {
				accessionNumber: rows.map((r) => r[0]),
				form: rows.map((r) => r[1]),
				filingDate: rows.map((r) => r[2]),
				items: rows.map((r) => r[3]),
				primaryDocument: rows.map((_, i) => `d${i}.htm`),
			},
		},
	})

const setup = (bodies: Record<string, string>, seen: (h: string) => boolean = () => false) => {
	const requests: { url: string; ua?: string }[] = []
	const http = HttpActionsMock.testInstance()
	http.sendRequest = (req) => {
		requests.push({ url: req.url, ua: req.headers['User-Agent'] })
		const cik = req.url.match(/CIK(\d{10})\.json$/)?.[1] ?? ''
		const body = bodies[cik]
		return body ? { statusCode: 200, body: new TextEncoder().encode(body) } : { statusCode: 404, body: new Uint8Array() }
	}
	const evm = EvmMock.testInstance(CHAIN_SELECTOR)
	const reg = addContractMock(evm, { address: REGISTRY, abi: CovenantRegistryABI })
	reg.seen = (h) => seen(h as string)
	const writes: Uint8Array[] = []
	reg.writeReport = (input) => {
		writes.push((input.report as any).rawReport)
		return { txStatus: TxStatus.SUCCESS, txHash: new Uint8Array(32).fill(0xab) }
	}
	const runtime = newTestRuntime(null, {}, config(Object.keys(bodies).map((cik) => ({ cik, name: `Issuer ${Number(cik)}` }))))
	return { runtime, requests, writes }
}

describe('onCron', () => {
	test('records a BREACH 8-K (2.04 acceleration) and sends the SEC User-Agent', () => {
		const { runtime, requests, writes } = setup({
			'0001234567': edgar([
				['0001234567-26-000042', '8-K', '2026-10-13', '2.04,9.01'],
				['0001234567-26-000041', '8-K', '2026-10-12', '2.02,9.01'],
			]),
		})
		const out = onCron(runtime as any, TICK)
		expect(out).toContain('BREACH 0001234567-26-000042')
		expect(requests).toEqual([{ url: 'https://data.sec.gov/submissions/CIK0001234567.json', ua: 'CovenantWatch test test@example.com' }])
		expect(writes).toHaveLength(1)
		expect(runtime.getLogs().join('\n')).toContain('Triggering events that accelerate')
	})

	test('ignores INFO-only and stale filings, writes nothing', () => {
		const { runtime, writes } = setup({
			'0001234567': edgar([
				['0001234567-26-000050', '8-K', '2026-10-14', '2.02,7.01,9.01'],
				['0001234567-26-000049', '10-Q', '2026-10-14', ''],
				['0001234567-26-000010', '8-K', '2026-09-01', '1.03'],
			]),
		})
		expect(onCron(runtime as any, TICK)).toBe('Issuer 1234567: clear')
		expect(writes).toHaveLength(0)
	})

	test('skips filings already recorded on-chain (idempotent across ticks)', () => {
		const acc = '0001234567-26-000042'
		const { runtime, writes } = setup(
			{ '0001234567': edgar([[acc, '8-K', '2026-10-13', '1.03']]) },
			(h) => h === accessionHash(acc),
		)
		expect(onCron(runtime as any, TICK)).toContain('seen ' + acc)
		expect(writes).toHaveLength(0)
	})

	test('handles several issuers; WATCH items are recorded but labelled WATCH', () => {
		const { runtime, writes } = setup({
			'0000000001': edgar([['0000000001-26-000003', '8-K', '2026-10-10', '5.01']]),
			'0000000002': edgar([['0000000002-26-000007', '8-K', '2026-10-01', '4.02']]),
		})
		const out = onCron(runtime as any, TICK)
		expect(out).toContain('Issuer 1: WATCH 0000000001-26-000003')
		expect(out).toContain('Issuer 2: clear') // 10-01 is outside the 7-day lookback from 10-15
		expect(writes).toHaveLength(1)
	})

	test('throws on EDGAR HTTP errors instead of reporting a false "clear"', () => {
		const { runtime } = setup({})
		;(runtime as any).config = config([{ cik: '999', name: 'Missing' }])
		expect(() => onCron(runtime as any, TICK)).toThrow()
	})
})

describe('report encoding', () => {
	test('matches CovenantRegistry._processReport layout', () => {
		const ev = { found: true, accession: '0001234567-26-000042', filingDate: 20261013, itemsMask: 1 << 8, severity: 3, primaryDocument: 'd.htm' }
		const [cik, hash, date, mask, sev, acc] = decodeAbiParameters(
			parseAbiParameters('uint64, bytes32, uint32, uint32, uint8, string'),
			encodeLegalEventReport('1234567', ev),
		)
		expect([cik, hash, date, mask, sev, acc]).toEqual([1234567n, accessionHash(ev.accession), 20261013, 256, 3, ev.accession])
	})
})

describe('initWorkflow', () => {
	test('one cron handler on the configured schedule', () => {
		const h = initWorkflow(config())
		expect(h).toHaveLength(1)
		expect(h[0].fn).toBe(onCron)
		expect((h[0].trigger as any).config?.schedule).toBe('0 0 */6 * * *')
	})
})
