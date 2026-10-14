// CovenantWatch — Chainlink CRE workflow: SEC EDGAR 8-K legal events -> on-chain covenant circuit breaker.
//
// Every cron tick, for each configured issuer (SEC CIK) the DON fetches the public EDGAR submissions JSON, each node
// reduces it to the single most severe new 8-K (deterministic, see edgar.ts), the nodes reach consensus on that
// reduced record (every field must be identical), the workflow checks CovenantRegistry.seen(accessionHash) on-chain,
// and only for unseen filings writes a signed report. BREACH items flag the issuer so TokenizedNote halts transfers.
import {
	bytesToHex,
	ConsensusAggregationByFields,
	type CronPayload,
	cre,
	encodeCallMsg,
	EVMClient,
	getNetwork,
	type HTTPSendRequester,
	identical,
	LAST_FINALIZED_BLOCK_NUMBER,
	prepareReportRequest,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import {
	type Address,
	decodeFunctionResult,
	encodeAbiParameters,
	encodeFunctionData,
	type Hex,
	keccak256,
	parseAbiParameters,
	stringToHex,
	zeroAddress,
} from 'viem'
import { z } from 'zod'
import { CovenantRegistryABI } from '../contracts/abi/CovenantRegistry'
import {
	cik10,
	DEFAULT_BREACH_ITEMS,
	DEFAULT_WATCH_ITEMS,
	eightKs,
	filingUrl,
	ITEM_LABELS,
	itemsOf,
	maskOf,
	pickEvent,
	Severity,
	sinceDateFrom,
	submissionsUrl,
} from './edgar'

// ─── Config ─────────────────────────────────────────────────
export const configSchema = z.object({
	schedule: z.string(),
	chainSelectorName: z.string(),
	registryAddress: z.string(),
	gasLimit: z.string().default('400000'),
	/** SEC requires a descriptive User-Agent with contact info for automated access. */
	userAgent: z.string(),
	lookbackDays: z.number().int().min(1).max(365).default(7),
	breachItems: z.array(z.string()).default(DEFAULT_BREACH_ITEMS),
	watchItems: z.array(z.string()).default(DEFAULT_WATCH_ITEMS),
	issuers: z.array(z.object({ cik: z.string(), name: z.string() })).min(1),
})
export type Config = z.infer<typeof configSchema>

/** What every node derives from the same EDGAR response; consensus requires all fields identical. */
export type IssuerEvent = {
	found: boolean
	accession: string
	filingDate: number
	itemsMask: number
	severity: number
	primaryDocument: string
}
const NONE: IssuerEvent = { found: false, accession: '', filingDate: 0, itemsMask: 0, severity: 0, primaryDocument: '' }

export const issuerEventConsensus = ConsensusAggregationByFields<IssuerEvent>({
	found: identical,
	accession: identical,
	filingDate: identical,
	itemsMask: identical,
	severity: identical,
	primaryDocument: identical,
})

type FetchArgs = { cik: string; userAgent: string; sinceDate: number; breachMask: number; watchMask: number }

/** Runs on every node: fetch EDGAR submissions and reduce to the most severe new 8-K (or NONE). */
export const fetchIssuerEvent = (sendRequester: HTTPSendRequester, a: FetchArgs): IssuerEvent => {
	const resp = sendRequester
		.sendRequest({
			url: submissionsUrl(a.cik),
			method: 'GET',
			headers: { 'User-Agent': a.userAgent, Accept: 'application/json' },
		})
		.result()
	if (resp.statusCode !== 200) throw new Error(`EDGAR ${cik10(a.cik)} HTTP ${resp.statusCode}`)
	const doc = JSON.parse(new TextDecoder().decode(resp.body))
	const ev = pickEvent(eightKs(doc), a.sinceDate, a.breachMask, a.watchMask)
	// INFO-only filings (earnings, Reg FD, exhibits) are not covenant events; don't spend gas on them.
	if (!ev || ev.severity < Severity.WATCH) return NONE
	return {
		found: true,
		accession: ev.filing.accession,
		filingDate: ev.filing.filingDate,
		itemsMask: ev.filing.itemsMask,
		severity: ev.severity,
		primaryDocument: ev.filing.primaryDocument,
	}
}

export const accessionHash = (accession: string): Hex => keccak256(stringToHex(accession))

export const encodeLegalEventReport = (cik: string, ev: IssuerEvent): Hex =>
	encodeAbiParameters(parseAbiParameters('uint64 cik, bytes32 accessionHash, uint32 filingDate, uint32 itemsMask, uint8 severity, string accession'), [
		BigInt(cik10(cik)),
		accessionHash(ev.accession),
		ev.filingDate,
		ev.itemsMask,
		ev.severity,
		ev.accession,
	])

export const describeEvent = (cik: string, name: string, ev: IssuerEvent): string => {
	const items = itemsOf(ev.itemsMask)
		.map((i) => (ITEM_LABELS[i] ? `${i} ${ITEM_LABELS[i]}` : i))
		.join('; ')
	return `${Severity[ev.severity]} ${name} (CIK ${cik10(cik)}) 8-K ${ev.accession} filed ${ev.filingDate}: ${items} — ${filingUrl(cik, ev)}`
}

const evmClientFor = (config: Config): EVMClient => {
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`Network not found: ${config.chainSelectorName}`)
	return new cre.capabilities.EVMClient(network.chainSelector.selector)
}

const viewSeen = (runtime: Runtime<Config>, evm: EVMClient, registry: Address, hash: Hex): boolean => {
	const data = encodeFunctionData({ abi: CovenantRegistryABI, functionName: 'seen', args: [hash] })
	const out = evm
		.callContract(runtime, {
			call: encodeCallMsg({ from: zeroAddress, to: registry, data }),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()
	return decodeFunctionResult({ abi: CovenantRegistryABI, functionName: 'seen', data: bytesToHex(out.data) }) as boolean
}

/** Execution time all nodes agree on: the cron's scheduled time (falls back to runtime.now()). */
const tickMs = (runtime: Runtime<Config>, payload?: CronPayload): number => {
	const s = payload?.scheduledExecutionTime?.seconds
	return s !== undefined ? Number(s) * 1000 : runtime.now().getTime()
}

// ─── Cron handler ───────────────────────────────────────────
export const onCron = (runtime: Runtime<Config>, payload?: CronPayload): string => {
	const c = runtime.config
	const sinceDate = sinceDateFrom(tickMs(runtime, payload), c.lookbackDays)
	const breachMask = maskOf(c.breachItems)
	const watchMask = maskOf(c.watchItems)
	const http = new cre.capabilities.HTTPClient()
	const evm = evmClientFor(c)
	const registry = c.registryAddress as Address
	const results: string[] = []

	for (const issuer of c.issuers) {
		const ev = http
			.sendRequest(runtime, fetchIssuerEvent, issuerEventConsensus)({
				cik: issuer.cik,
				userAgent: c.userAgent,
				sinceDate,
				breachMask,
				watchMask,
			})
			.result()
		if (!ev.found) {
			runtime.log(`${issuer.name}: no covenant-relevant 8-K since ${sinceDate}`)
			results.push(`${issuer.name}: clear`)
			continue
		}
		const hash = accessionHash(ev.accession)
		if (viewSeen(runtime, evm, registry, hash)) {
			runtime.log(`${issuer.name}: ${ev.accession} already recorded on-chain`)
			results.push(`${issuer.name}: seen ${ev.accession}`)
			continue
		}
		runtime.log(describeEvent(issuer.cik, issuer.name, ev))
		const report = runtime.report(prepareReportRequest(encodeLegalEventReport(issuer.cik, ev))).result()
		const w = evm.writeReport(runtime, { receiver: registry, report, gasConfig: { gasLimit: c.gasLimit } }).result()
		if (w.txStatus !== TxStatus.SUCCESS) throw new Error(`writeReport failed for ${issuer.name}: ${w.errorMessage || w.txStatus}`)
		const tx = bytesToHex(w.txHash || new Uint8Array(32))
		runtime.log(`${issuer.name}: recorded ${Severity[ev.severity]} ${ev.accession} tx ${tx}`)
		results.push(`${issuer.name}: ${Severity[ev.severity]} ${ev.accession} tx ${tx}`)
	}
	return results.join(' | ')
}

export function initWorkflow(config: Config) {
	const cron = new cre.capabilities.CronCapability()
	return [cre.handler(cron.trigger({ schedule: config.schedule }), onCron)]
}
