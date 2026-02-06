import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import dns from "dns"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const { resolve: dnsResolve } = dns.promises

const FETCH_URL = "https://chainlist.org/rpcs.json"
const CONNECT_TIMEOUT_MS = 3000
const RPC_TIMEOUT_MS = 10000
const HEX_RESULT = /^0x[0-9a-fA-F]+$/
const BATCH_SIZE = 16

function parseChainsFromFile(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath)
  const raw = fs.readFileSync(resolved, "utf8")
  const chainIds = raw
    .split(/[\n,]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n))
  return chainIds.length ? chainIds : null
}

function parseArgs() {
  const chainsFile = process.argv.find((a) => a.startsWith("--chains-file="))
  const limitChains = process.argv.find((a) => a.startsWith("--chains="))
  const out = process.argv.find((a) => a.startsWith("--out="))
  const batchArg = process.argv.find((a) => a.startsWith("--batch="))
  let chainIds = null
  if (chainsFile) {
    chainIds = parseChainsFromFile(chainsFile.split("=")[1])
  } else if (limitChains) {
    chainIds = limitChains
      .split("=")[1]
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n))
    chainIds = chainIds?.length ? chainIds : null
  }
  const batch = batchArg ? parseInt(batchArg.split("=")[1], 10) : BATCH_SIZE
  return {
    chainIds,
    outDir: out ? out.split("=")[1] : "./rpcs",
    skipExisting: process.argv.includes("--skip-existing"),
    batchSize: Number.isNaN(batch) || batch < 1 ? BATCH_SIZE : Math.min(batch, 128),
  }
}

async function batchCall(tasks, concurrency) {
  const results = []
  let index = 0
  async function worker() {
    while (index < tasks.length) {
      const i = index++
      results[i] = tasks[i]()
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
  await Promise.all(workers)
  return Promise.all(results)
}

function getRpcs(chain) {
  const rpc = chain.rpc || []
  const urls = []
  for (const entry of rpc) {
    const url = typeof entry === "string" ? entry : entry?.url
     urls.push(url)
  }
  return urls
}

function extractHost(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

async function checkConnect(url) {
  try {
    await fetch(url, {
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    })
    return true
  } catch {
    return false
  }
}

async function checkRpc(url) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_blockNumber",
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    })
    const data = await res.json()
    const result = data?.result
    return typeof result === "string" && HEX_RESULT.test(result)
  } catch {
    return false
  }
}

async function checkIpv6(host) {
  if (!host) return false
  try {
    const aaaa = await Promise.race([dnsResolve(host, "AAAA"), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000))])
    return Array.isArray(aaaa) && aaaa.length > 0
  } catch {
    return false
  }
}

async function main() {
  const { chainIds, outDir, skipExisting, batchSize: concurrency } = parseArgs()

  fs.mkdirSync(outDir, { recursive: true })
  console.log("Output directory:", path.resolve(outDir))
  console.log("Batch size:", concurrency)
  if (skipExisting) console.log("Skip existing: yes (chains with existing file will be skipped)")

  console.log("Fetching chainlist from", FETCH_URL)
  const res = await fetch(FETCH_URL)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  const allChains = await res.json()
  if (!Array.isArray(allChains)) throw new Error("Expected array from chainlist")
  const chainIdSet = chainIds != null ? new Set(chainIds) : null
  const chains = chainIdSet
    ? allChains.filter((c) => c.chainId != null && chainIdSet.has(Number(c.chainId)))
    : allChains
  const totalChains = chains.length
  console.log("Loaded", allChains.length, "chains")
  if (chainIds != null) {
    console.log("Processing only chainIds:", chainIds.join(", "))
  } else {
    console.log("Processing all chains")
  }
  console.log("Chains to process:", totalChains)

  let totalRpcChecked = 0
  let totalWorking = 0
  let chainIndex = 0
  let skipped = 0
  let written = 0
  const merged = Object.create(null)

  for (const chain of chains) {
    chainIndex++
    const name = chain.name ?? "unknown"
    const chainId = chain.chainId
    if (chainId == null || chainId === "") continue

    const filePath = path.join(outDir, `${chainId}.json`)
    if (skipExisting && fs.existsSync(filePath)) {
      const existing = JSON.parse(fs.readFileSync(filePath, "utf8"))
      merged[String(chainId)] = existing
      console.log("")
      console.log(`[${chainIndex}/${totalChains}] ${name} (chainId ${chainId}) — skipped (file exists: ${chainId}.json)`)
      skipped++
      continue
    }

    const urls = getRpcs(chain)
    if (urls.length === 0) {
      const payload = { name, chainId, rpcs: [] }
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2))
      merged[String(chainId)] = payload
      console.log("")
      console.log(`[${chainIndex}/${totalChains}] ${name} (chainId ${chainId}) — 0 HTTP(S) RPCs, written ${chainId}.json (empty)`)
      written++
      continue
    }

    console.log("")
    console.log(`[${chainIndex}/${totalChains}] ${name} (chainId ${chainId}) — ${urls.length} HTTP(S) RPCs (parallel, concurrency ${concurrency})`)

    const taskFns = urls.map((url) => async () => {
      const connected = await checkConnect(url)
      if (!connected) return null
      const rpcOk = await checkRpc(url)
      if (!rpcOk) return null
      const host = extractHost(url)
      const supportsIpv6 = await checkIpv6(host)
      return { url, supportsIpv6 }
    })
    const outcomes = await batchCall(taskFns, concurrency)
    const rpcs = []

    for (let idx = 0; idx < urls.length; idx++) {
      totalRpcChecked++
      const url = urls[idx]
      const result = outcomes[idx]
      const shortUrl = url.length > 60 ? url.slice(0, 57) + "..." : url
      console.log(`  RPC ${idx + 1}/${urls.length}: ${shortUrl}`)
      if (!result) {
        console.log("    connect or eth_blockNumber: fail")
        continue
      }
      console.log("    connect: ok")
      console.log("    eth_blockNumber: ok")
      console.log("    IPv6:", result.supportsIpv6 ? "yes" : "no")
      rpcs.push(result)
      totalWorking++
    }

    const payload = { name, chainId, rpcs }
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2))
    merged[String(chainId)] = payload
    written++
    console.log(`  → ${rpcs.length} working RPC(s), written ${chainId}.json`)
  }

  const mergedPath = path.join(outDir, "all.json")
  fs.writeFileSync(mergedPath, JSON.stringify(merged, null, 2))
  console.log("Merged file written:", mergedPath)

  console.log("")
  console.log("Done. Written:", written, "| Skipped:", skipped, "| RPCs checked:", totalRpcChecked, "| Working:", totalWorking)
  console.log("Output directory:", path.resolve(outDir))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
