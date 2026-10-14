// CovenantWatch — optional LLM severity/summary step with a deterministic rule-based fallback.
//
// The LLM output is advisory (logged / returned), never part of the on-chain report: the report's severity is
// always the rule-based one from edgar.ts, so a model can't move funds or halt a note on its own.
import { filingUrl, ITEM_LABELS, itemsOf } from './edgar'

export type Assessment = { source: 'llm' | 'rule'; severity: number; summary: string }

/** Fixed severity per breach item code (1-5 scale) — the deterministic fallback. */
export const RULE_SEVERITY: Record<string, number> = { '1.03': 5, '2.04': 4, '3.01': 3, '4.02': 3 }
export const QUALIFYING_ITEMS = Object.keys(RULE_SEVERITY)

export const qualifyingItems = (mask: number): string[] => itemsOf(mask).filter((i) => QUALIFYING_ITEMS.includes(i))

export function ruleAssessment(name: string, accession: string, mask: number): Assessment {
	const q = qualifyingItems(mask)
	const severity = q.reduce((m, i) => Math.max(m, RULE_SEVERITY[i]), 0)
	const labels = q.map((i) => `Item ${i} (${ITEM_LABELS[i as keyof typeof ITEM_LABELS]})`).join(', ')
	return { source: 'rule', severity, summary: `${name} filed 8-K ${accession} reporting ${labels}; noteholder covenant review required.` }
}

export function buildLlmRequest(model: string, name: string, cik: string, ev: { accession: string; itemsMask: number; primaryDocument: string }) {
	const items = itemsOf(ev.itemsMask).map((i) => `${i} ${ITEM_LABELS[i] ?? ''}`.trim())
	return {
		model,
		temperature: 0,
		max_tokens: 120,
		response_format: { type: 'json_object' },
		messages: [
			{
				role: 'system',
				content:
					'You assess SEC Form 8-K events for holders of tokenized debt notes. Reply ONLY with JSON {"severity": integer 1-5, "summary": string <= 200 chars}.',
			},
			{ role: 'user', content: `Issuer: ${name}\n8-K ${ev.accession}\nItems: ${items.join('; ')}\nURL: ${filingUrl(cik, ev)}` },
		],
	}
}

/** Parse an OpenAI-compatible chat completion; throws on anything malformed so the caller falls back. */
export function parseLlmResponse(body: string): { severity: number; summary: string } {
	const content = JSON.parse(body)?.choices?.[0]?.message?.content
	if (typeof content !== 'string') throw new Error('no completion content')
	const j = JSON.parse(content)
	const severity = Number(j.severity)
	if (!Number.isInteger(severity) || severity < 1 || severity > 5) throw new Error('bad severity')
	if (typeof j.summary !== 'string' || !j.summary.trim()) throw new Error('bad summary')
	return { severity, summary: j.summary.trim().slice(0, 200) }
}
