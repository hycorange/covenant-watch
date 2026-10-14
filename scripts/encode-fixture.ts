// Runs a recorded EDGAR submissions fixture through the SAME parsing/selection/encoding code the CRE workflow uses
// (edgar.ts eightKs + pickEvent, workflow.ts encodeLegalEventReport) and prints the report payload as hex.
// Usage: bun scripts/encode-fixture.ts <fixture.json> <sinceDate YYYYMMDD>
import { readFileSync } from 'node:fs'
import { DEFAULT_BREACH_ITEMS, DEFAULT_WATCH_ITEMS, eightKs, itemsOf, maskOf, pickEvent } from '../my-workflow/edgar'
import { encodeLegalEventReport } from '../my-workflow/workflow'

const [file, since] = process.argv.slice(2)
const doc = JSON.parse(readFileSync(file, 'utf8'))
const ev = pickEvent(eightKs(doc), Number(since), maskOf(DEFAULT_BREACH_ITEMS), maskOf(DEFAULT_WATCH_ITEMS))
if (!ev) throw new Error('no qualifying 8-K in fixture window')
const f = ev.filing
console.error(`# ${doc.name} (CIK ${doc.cik}) 8-K ${f.accession} filed ${f.filingDate} items ${itemsOf(f.itemsMask).join(',')} severity ${ev.severity}`)
console.log(encodeLegalEventReport(doc.cik, { found: true, ...f, severity: ev.severity }))
