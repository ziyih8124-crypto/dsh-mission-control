/**
 * Host half of Mission control.
 *
 * The Client half renders the `conversation.view` board. Everything the board
 * cannot derive from the shared Client session snapshot is served from here,
 * behind the Harness connection fence:
 *
 *   POST /mission-control/api/capabilities  -> providers available for dispatch
 *   POST /mission-control/api/digest        -> latest task / output / tool per session
 *   POST /mission-control/api/spawn         -> dispatch one new subagent
 *   POST /mission-control/api/interrupt      -> interrupt one running subagent
 *
 * Dispatch uses the public `ctx.subagents` seam (`startActivation`) with
 * `delivery: 'parent'`, so the child reports its result back to the lead agent
 * through the framework's normal settlement notice. The Host never parses the
 * model's tool output and never writes session events itself.
 *
 * @module @local/dsh-mission-control
 */

/** Absolute prefix of this plugin's JSON API on the Harness web server. */
const API_PREFIX = '/mission-control/api'

/** Largest JSON body accepted by the API, in bytes. */
const MAX_BODY_BYTES = 256 * 1024

/** Largest task instruction accepted by `spawn`, in characters. */
const MAX_TASK_CHARS = 20_000

/** Largest generated label accepted by `spawn`, in characters. */
const MAX_LABEL_CHARS = 120

/** Largest digest batch accepted from one call. */
const MAX_DIGEST_IDS = 120

/** Longest excerpt returned in a digest row, in characters. */
const MAX_EXCERPT_CHARS = 320

/**
 * Hard dependencies. The subagent seam, session store, agent registry and
 * session controller are read with `ctx.get` so the plugin still loads on a
 * deployment that mounts only some of them.
 */
export const inject = ['webServer', 'connection']

/**
 * Mount the Host half.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 */
export function apply(ctx) {
  /** One signal for unpublished dispatch work owned by this plugin fiber. */
  const lifecycle = new AbortController()
  ctx.effect(() => () => lifecycle.abort(), 'mission-control: dispatch lifecycle')
  const api = createApi(ctx, lifecycle)

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: (req, res) => handleRequest(ctx, api, lifecycle, req, res),
      }),
    'mission-control: /mission-control/api',
  )
}

/**
 * Build the API table once per fiber.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {AbortController} lifecycle - plugin-owned dispatch signal.
 */
function createApi(ctx, lifecycle) {
  /** Cold-session digest cache: a finished child's log does not change. */
  const coldDigests = new Map()
  return {
    capabilities: () => capabilities(ctx),
    digest: (body) => digest(ctx, body, coldDigests),
    spawn: (body) => spawn(ctx, body, lifecycle),
    interrupt: (body) => interrupt(ctx, body),
  }
}

/* ------------------------------------------------------------------ */
/* HTTP transport                                                      */
/* ------------------------------------------------------------------ */

/**
 * Reject untrusted peers and dispatch one POST method.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {Record<string, (body: unknown) => Promise<unknown> | unknown>} api - method table.
 * @param {AbortController} lifecycle - plugin-owned dispatch signal.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 */
async function handleRequest(ctx, api, lifecycle, req, res) {
  const rejection = ctx.connection.requestRejection(req)
  if (rejection !== undefined) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'POST required' } })
    return
  }

  let method
  try {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    if (!url.pathname.startsWith(`${API_PREFIX}/`)) {
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown route' } })
      return
    }
    method = url.pathname.slice(API_PREFIX.length + 1)
    if (method === '' || method.includes('/')) {
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown method' } })
      return
    }

    const handler = Object.hasOwn(api, method) ? api[method] : undefined
    if (typeof handler !== 'function') {
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown method "${method}"` } })
      return
    }

    const body = await readJsonBody(req)
    const value = await handler(body)
    writeJson(res, 200, { ok: true, value })
  } catch (error) {
    const apiError = normalizeError(error)
    const detail = { method: method ?? '?', code: apiError.code, message: apiError.message }
    ctx.logger?.warn?.(`mission-control api failed: ${JSON.stringify(detail)}`)
    writeJson(res, apiError.status, {
      ok: false,
      error: { code: apiError.code, message: apiError.message },
    })
  } finally {
    if (lifecycle.signal.aborted && !res.writableEnded) {
      res.destroy()
    }
  }
}

/**
 * Read one bounded JSON request body.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {Promise<unknown>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      req.destroy()
      reject(error)
    }
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        fail(new ApiError('payload-too-large', 'request body is too large', 413))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      if (size === 0) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new ApiError('bad-json', 'request body must be a JSON object'))
          return
        }
        resolve(parsed)
      } catch {
        reject(new ApiError('bad-json', 'request body is not valid JSON'))
      }
    })
    req.on('error', (error) => fail(new ApiError('network', String(error?.message ?? error))))
    req.on('aborted', () => fail(new ApiError('cancelled', 'request was aborted')))
  })
}

/**
 * Write one JSON envelope.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
 * @param {unknown} payload - serializable envelope.
 */
function writeJson(res, status, payload) {
  if (res.writableEnded) return
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

/* ------------------------------------------------------------------ */
/* Methods                                                             */
/* ------------------------------------------------------------------ */

/**
 * Report whether this deployment can dispatch subagents and through which
 * providers.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 */
function capabilities(ctx) {
  const subagents = ctx.get('subagents')
  const providers = typeof subagents?.list === 'function' ? subagents.list() : []
  const canSpawn =
    typeof subagents?.startActivation === 'function' && Array.isArray(providers) && providers.length > 0
  return {
    canSpawn,
    providers: Array.isArray(providers) ? providers : [],
    defaultProvider: pickProvider(providers, undefined),
    canDigest: typeof ctx.get('sessions')?.get === 'function',
    canInterrupt: typeof subagents?.interruptByParent === 'function',
  }
}

/**
 * Return the latest task, assistant text, tool call and turn for a batch of
 * sessions. Live sessions are folded from their in-memory snapshot; a cold
 * session (a finished child) is read once from persistence and cached against
 * its revision, so its final answer still appears on the board.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {unknown} body - `{ sessionIds: string[] }`.
 * @param {Map<string, { revision: string, digest: object, at: number }>} coldDigests
 */
async function digest(ctx, body, coldDigests) {
  const record = asRecord(body)
  const raw = record.sessionIds
  if (!Array.isArray(raw)) throw new ApiError('bad-request', 'sessionIds must be an array')
  const ids = []
  const seen = new Set()
  for (const value of raw) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 200) continue
    if (seen.has(value)) continue
    seen.add(value)
    ids.push(value)
    if (ids.length >= MAX_DIGEST_IDS) break
  }

  const store = ctx.get('sessions')
  if (typeof store?.get !== 'function') {
    throw new ApiError('sessions-unavailable', 'the session store is not mounted', 503)
  }

  const items = {}
  const missing = []
  let coldReads = 0
  for (const id of ids) {
    const session = store.get(id)
    if (session !== undefined) {
      try {
        items[id] = digestOfSession(session)
        continue
      } catch {
        // fall through to the persisted read
      }
    }
    if (coldReads < 24) {
      coldReads += 1
      const cold = await digestOfColdSession(ctx, id, coldDigests)
      if (cold !== undefined) {
        items[id] = cold
        continue
      }
    }
    missing.push(id)
  }
  return { items, missing, generatedAt: Date.now() }
}

/**
 * Fold one live session.
 * @param {{ snapshotEvents?: () => readonly any[], ownEvents?: () => readonly any[] }} session
 */
function digestOfSession(session) {
  const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
  let own = []
  try {
    own = typeof session.ownEvents === 'function' ? session.ownEvents() : []
  } catch {
    own = []
  }
  return digestOfEvents(events, own)
}

/**
 * Read the tail of one cold session from durable storage and fold it. The
 * cache key is the persistence revision and an entry lives for 30 seconds, so
 * repeated board polls do not re-read every finished child.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {string} id - session id.
 * @param {Map<string, { revision: string, digest: object, at: number }>} cache
 * @returns {Promise<object | undefined>}
 */
async function digestOfColdSession(ctx, id, cache) {
  const persistence = ctx.get('sessionPersistence')
  if (typeof persistence?.stat !== 'function' || typeof persistence?.open !== 'function') return undefined

  let snapshot
  try {
    snapshot = await persistence.stat(id)
  } catch {
    return undefined
  }
  if (snapshot === undefined || snapshot === null) return undefined

  const revision = String(snapshot.revision ?? '')
  const cached = cache.get(id)
  if (cached !== undefined && cached.revision === revision && Date.now() - cached.at < 30_000) {
    return cached.digest
  }

  let handle
  try {
    handle = await persistence.open(id, 'read')
  } catch {
    return undefined
  }

  try {
    const eventCount = typeof snapshot.eventCount === 'number' ? snapshot.eventCount : 0
    const tailStart = Math.max(0, eventCount - 400)
    const tail = await handle.read(tailStart, 400)
    const inherited = typeof handle.inheritedEventCount === 'number' ? handle.inheritedEventCount : 0
    let own = tail.events.filter((event) => typeof event?.seq === 'number' && event.seq >= inherited)
    if (tailStart > 0) {
      const head = await handle.read(0, 60)
      own = head.events.filter((event) => typeof event?.seq === 'number' && event.seq >= inherited)
    }
    const digest = digestOfEvents(tail.events, own)
    cache.set(id, { revision, digest, at: Date.now() })
    if (cache.size > 160) {
      const oldest = [...cache.entries()].sort((left, right) => left[1].at - right[1].at).slice(0, 40)
      for (const [key] of oldest) cache.delete(key)
    }
    return digest
  } catch {
    return undefined
  } finally {
    try {
      await handle.close()
    } catch {
      // a read handle close failure does not invalidate the digest
    }
  }
}

/**
 * Fold an event tail plus the session's own head into a compact digest row.
 * @param {readonly any[]} events - events used for the latest activity.
 * @param {readonly any[]} ownEvents - events used to find the first task prompt.
 */
function digestOfEvents(events, ownEvents) {
  let text
  let tool
  let toolCallId
  let toolResult
  let turns = 0
  let model

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === null || typeof event !== 'object') continue
    if (model === undefined && event.type === 'assistant/message') {
      model = modelOf(event.data?.message)
    }
    if (text === undefined && event.type === 'assistant/message') {
      const candidate = clip(textOfMessage(event.data?.message), MAX_EXCERPT_CHARS)
      if (candidate !== '') text = candidate
    }
    if (tool === undefined && event.type === 'tool/call') {
      tool = typeof event.data?.name === 'string' ? event.data.name : undefined
      toolCallId = event.data?.callId
    }
    if (toolResult === undefined && event.type === 'tool/result') {
      toolResult = event.data
    }
    if (turns === 0 && event.type === 'turn/start') {
      const turn = event.data?.turn
      if (typeof turn === 'number') turns = turn
    }
    if (text !== undefined && tool !== undefined && turns !== 0 && model !== undefined) break
  }

  const toolError =
    toolResult !== undefined &&
    toolResult?.error !== undefined &&
    (toolCallId === undefined || toolResult?.message?.toolCallId === toolCallId)

  let task
  for (const event of ownEvents) {
    if (event?.type !== 'user/message') continue
    const candidate = clip(textOfMessage(event.data), 200)
    if (candidate !== '') {
      task = candidate
      break
    }
  }

  const last = events.length === 0 ? undefined : events[events.length - 1]
  return {
    ...(task === undefined ? {} : { task }),
    ...(text === undefined ? {} : { text }),
    ...(tool === undefined ? {} : { tool }),
    ...(tool === undefined ? {} : { toolError }),
    ...(model === undefined ? {} : { model }),
    ...(turns === 0 ? {} : { turns }),
    ...(typeof last?.time === 'number' ? { time: last.time } : {}),
  }
}

/**
 * Dispatch one new subagent under the live (or resumable) lead agent.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {unknown} body - `{ parentSessionId, task, label?, provider? }`.
 * @param {AbortController} lifecycle - plugin-owned dispatch signal.
 */
async function spawn(ctx, body, lifecycle) {
  const record = asRecord(body)
  const subagents = ctx.get('subagents')
  if (typeof subagents?.startActivation !== 'function') {
    throw new ApiError('subagents-unavailable', 'the subagent service is not mounted', 503)
  }

  const parentSessionId = requireId(record.parentSessionId, 'parentSessionId')
  const task = requireTask(record.task)
  const label = normalizeLabel(record.label) ?? deriveLabel(task)
  const providers = typeof subagents.list === 'function' ? subagents.list() : []
  const provider = pickProvider(providers, typeof record.provider === 'string' ? record.provider : undefined)
  if (provider === null) {
    throw new ApiError('no-provider', 'no subagent provider is registered', 503)
  }
  if (typeof subagents.resolveMaxDepth === 'function') {
    const depthLimit = subagents.resolveMaxDepth(undefined)
    if (depthLimit === 0) {
      throw new ApiError('depth-limit', 'delegation depth is configured as 0', 409)
    }
  }

  const parent = await resolveParentAgent(ctx, parentSessionId)
  let activation
  try {
    activation = await subagents.startActivation({
      provider,
      label,
      request: {
        prompt: [{ type: 'text', text: task }],
        parent,
      },
      signal: lifecycle.signal,
      delivery: 'parent',
    })
  } catch (error) {
    throw classifySpawnError(error)
  }

  return {
    childId: String(activation.childId),
    label,
    provider,
    messageId: activation.messageId === undefined ? null : String(activation.messageId),
  }
}

/**
 * Interrupt one running continuable child by durable parent address.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {unknown} body - `{ parentSessionId, childSessionId }`.
 */
function interrupt(ctx, body) {
  const record = asRecord(body)
  const subagents = ctx.get('subagents')
  if (typeof subagents?.interruptByParent !== 'function') {
    throw new ApiError('subagents-unavailable', 'the subagent service is not mounted', 503)
  }
  const parentSessionId = requireId(record.parentSessionId, 'parentSessionId')
  const childSessionId = requireId(record.childSessionId, 'childSessionId')
  try {
    subagents.interruptByParent(childSessionId, parentSessionId, 'continuable')
  } catch (error) {
    const code = errorCodeOf(error)
    if (code === 'UNAUTHORIZED') {
      throw new ApiError('unauthorized', 'the parent does not own this subagent', 403)
    }
    if (code === 'NOT_CONTINUABLE') {
      throw new ApiError('not-continuable', 'this subagent does not accept interruption', 409)
    }
    throw new ApiError('interrupt-failed', messageOf(error), 409)
  }
  return { accepted: true }
}

/* ------------------------------------------------------------------ */
/* Session / agent helpers                                             */
/* ------------------------------------------------------------------ */

/**
 * Resolve the exact live Agent, resuming a cold Session when the API session
 * controller is mounted. Starting a child requires the parent Agent identity,
 * not merely its durable id.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {string} sessionId - lead Session id.
 */
async function resolveParentAgent(ctx, sessionId) {
  const agents = ctx.get('agents')
  const live = typeof agents?.get === 'function' ? agents.get(sessionId) : undefined
  if (live !== undefined && live !== null) return live

  const controller = ctx.get('sessionController')
  if (typeof controller?.resolveAgent === 'function') {
    const result = await controller.resolveAgent(sessionId)
    if (result?.agent !== undefined) return result.agent
    const failure = result?.error
    throw new ApiError(
      'agent-unavailable',
      failure?.message ?? 'the lead agent could not be resumed',
      409,
    )
  }
  throw new ApiError('agent-unavailable', 'the lead agent is not live in this process', 409)
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

/** A transport/validation failure with a stable code and status. */
class ApiError extends Error {
  /**
   * @param {string} code - stable wire code.
   * @param {string} message - human-readable detail.
   * @param {number} [status] - HTTP status.
   */
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'MissionControlApiError'
    this.code = code
    this.status = status
  }
}

/**
 * Convert an arbitrary rejection into an envelope error.
 * @param {unknown} error
 */
function normalizeError(error) {
  if (error instanceof ApiError) return error
  const code = errorCodeOf(error)
  if (code === 'ACTIVATION_LIMIT_REACHED') {
    return new ApiError('capacity', 'the active subagent limit has been reached', 409)
  }
  return new ApiError('internal', messageOf(error), 500)
}

/**
 * Map a subagent-service rejection onto the board's stable codes.
 * @param {unknown} error
 */
function classifySpawnError(error) {
  const code = errorCodeOf(error)
  switch (code) {
    case 'ACTIVATION_LIMIT_REACHED':
      return new ApiError('capacity', 'the active subagent limit has been reached', 409)
    case 'UNAUTHORIZED':
      return new ApiError('unauthorized', 'the lead agent does not own this dispatch', 403)
    case 'CONTINUATION_UNAVAILABLE':
    case 'PERSISTENCE_UNAVAILABLE':
      return new ApiError('persistence', 'subagent dispatch requires session persistence', 503)
    case 'PRESET_UNAVAILABLE':
      return new ApiError('preset', 'the selected agent preset is unavailable', 409)
    case 'UNSUPPORTED_CAPABILITY':
      return new ApiError('unsupported', 'the subagent provider lacks a required capability', 503)
    case 'NO_PROVIDER':
      return new ApiError('no-provider', 'no subagent provider is registered', 503)
    case 'DUPLICATE_CHILD':
      return new ApiError('duplicate', 'a subagent with this identity already exists', 409)
    case 'ACTIVATION_CLOSING':
    case 'DRAINING':
      return new ApiError('busy', 'the subagent manager is draining or closing', 409)
    default:
      return new ApiError('spawn-failed', messageOf(error), 500)
  }
}

/**
 * Choose the requested provider, else `spawn`, else the first registered one.
 * @param {readonly string[]} providers
 * @param {string | undefined} requested
 * @returns {string | null}
 */
function pickProvider(providers, requested) {
  if (!Array.isArray(providers) || providers.length === 0) return null
  if (typeof requested === 'string' && requested !== '' && providers.includes(requested)) {
    return requested
  }
  if (providers.includes('spawn')) return 'spawn'
  return providers[0] ?? null
}

/** @param {unknown} value */
function asRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('bad-request', 'request body must be a JSON object')
  }
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireId(value, field) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 200) {
    throw new ApiError('bad-request', `"${field}" must be a non-empty session id`)
  }
  return value
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function requireTask(value) {
  if (typeof value !== 'string') throw new ApiError('bad-request', '"task" must be a string')
  const task = value.trim()
  if (task === '') throw new ApiError('bad-request', '"task" must not be empty')
  if (task.length > MAX_TASK_CHARS) {
    throw new ApiError('bad-request', `"task" must be at most ${MAX_TASK_CHARS} characters`)
  }
  return task
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function normalizeLabel(value) {
  if (typeof value !== 'string') return undefined
  const label = value.replace(/\s+/g, ' ').trim()
  if (label === '') return undefined
  return label.slice(0, MAX_LABEL_CHARS)
}

/**
 * Derive a readable label from the first non-empty task line.
 * @param {string} task
 */
function deriveLabel(task) {
  const line = task.split(/\r?\n/).find((entry) => entry.trim() !== '') ?? task
  return clip(line.replace(/\s+/g, ' ').trim(), 60)
}

/**
 * @param {unknown} message
 * @returns {string}
 */
function textOfMessage(message) {
  if (message === null || typeof message !== 'object') return ''
  const content = /** @type {{ content?: unknown }} */ (message).content
  if (typeof content === 'string') return normalizeText(content)
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return normalizeText(parts.join('\n'))
}

/** @param {unknown} message */
function modelOf(message) {
  if (message === null || typeof message !== 'object') return undefined
  const source = /** @type {{ source?: unknown }} */ (message).source
  if (source === null || typeof source !== 'object') return undefined
  const model = /** @type {{ model?: unknown }} */ (source).model
  return typeof model === 'string' && model !== '' ? model : undefined
}

/** Collapse whitespace so a digest row is a single readable line. */
function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * @param {string} value
 * @param {number} limit
 */
function clip(value, limit) {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

/** @param {unknown} error */
function errorCodeOf(error) {
  if (error === null || typeof error !== 'object') return undefined
  const code = /** @type {{ code?: unknown }} */ (error).code
  return typeof code === 'string' ? code : undefined
}

/** @param {unknown} error */
function messageOf(error) {
  if (error instanceof Error) return error.message
  if (error === null || typeof error !== 'object') return String(error)
  const message = /** @type {{ message?: unknown }} */ (error).message
  return typeof message === 'string' ? message : String(error)
}
