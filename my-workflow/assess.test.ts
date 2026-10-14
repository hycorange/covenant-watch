import { describe, expect } from 'bun:test'
import { EvmMock, HttpActionsMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import { cre } from '@chainlink/cre-sdk'
import { maskOf } from './edgar'
import { parseLlmResponse, ruleAssessment } from './assess'
import { assessEvent, type Config, type IssuerEvent } from './workflow'

const issuer = { cik: '1234567', name: 'Acme' }
const ev = (items: string[]): IssuerEvent => ({ found: true, accession: '0001234567-26-000042', filingDate: 20261013, itemsMask: maskOf(items), severity: 3, primaryDocument: 'd.htm' })
const cfg = (enabled: boolean): Config =>
	({ llm: { enabled, url: 'https://llm.example/v1/chat/completions', model: 'm', secretId: 'LLM_API_KEY' } }) as any
const completion = (content: string) => JSON.stringify({ choices: [{ message: { content } }] })

const run = (enabled: boolean, opts: { key?: string; status?: number; body?: string } = {}) => {
	const calls: any[] = []
	const http = HttpActionsMock.testInstance()
	http.sendRequest = (req) => {
		calls.push(req)
		return { statusCode: opts.status ?? 200, body: new TextEncoder().encode(opts.body ?? '') }
	}
	const secrets = opts.key ? new Map([['main', new Map([['LLM_API_KEY', opts.key]])]]) : null
	const runtime = newTestRuntime(secrets, {}, cfg(enabled))
	return { runtime, calls, http: new cre.capabilities.HTTPClient() }
}

describe('rule-based assessment', () => {
	test('fixed severity per item code + templated summary', () => {
		expect(ruleAssessment('Acme', 'A-1', maskOf(['1.03', '9.01'])).severity).toBe(5)
		expect(ruleAssessment('Acme', 'A-1', maskOf(['2.04'])).severity).toBe(4)
		const r = ruleAssessment('Acme', 'A-1', maskOf(['3.01', '4.02']))
		expect(r).toEqual({ source: 'rule', severity: 3, summary: expect.stringContaining('Item 3.01') })
		expect(r.summary).toContain('Item 4.02')
	})
	test('parseLlmResponse rejects malformed output', () => {
		expect(parseLlmResponse(completion('{"severity":4,"summary":"x"}'))).toEqual({ severity: 4, summary: 'x' })
		expect(() => parseLlmResponse(completion('{"severity":9,"summary":"x"}'))).toThrow()
		expect(() => parseLlmResponse('not json')).toThrow()
	})
})

describe('assessEvent', () => {
	test('non-qualifying (WATCH-only) items: no assessment', () => {
		const { runtime, http, calls } = run(true, { key: 'k' })
		expect(assessEvent(runtime as any, http, issuer, ev(['5.01']))).toBeNull()
		expect(calls).toHaveLength(0)
	})
	test('disabled: rule-based, no HTTP call', () => {
		const { runtime, http, calls } = run(false, { key: 'k' })
		expect(assessEvent(runtime as any, http, issuer, ev(['2.04']))?.source).toBe('rule')
		expect(calls).toHaveLength(0)
	})
	test('enabled + key + valid response: LLM result, key sent only as bearer header', () => {
		const { runtime, http, calls } = run(true, { key: 'sk-test', body: completion('{"severity":4,"summary":"Debt accelerated."}') })
		expect(assessEvent(runtime as any, http, issuer, ev(['2.04']))).toEqual({ source: 'llm', severity: 4, summary: 'Debt accelerated.' })
		expect(calls).toHaveLength(1)
		expect(calls[0].method).toBe('POST')
		expect(calls[0].headers.Authorization).toBe('Bearer sk-test')
	})
	test('enabled but no API key secret: falls back', () => {
		const { runtime, http, calls } = run(true, { body: completion('{"severity":1,"summary":"x"}') })
		expect(assessEvent(runtime as any, http, issuer, ev(['1.03']))).toMatchObject({ source: 'rule', severity: 5 })
		expect(calls).toHaveLength(0)
	})
	test('HTTP error / garbage output: falls back and logs', () => {
		for (const o of [{ status: 500 }, { body: completion('nope') }]) {
			const { runtime, http } = run(true, { key: 'k', ...o })
			expect(assessEvent(runtime as any, http, issuer, ev(['4.02']))).toMatchObject({ source: 'rule', severity: 3 })
			expect(runtime.getLogs().join('\n')).toContain('using rule-based assessment')
		}
	})
})
