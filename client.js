/**
 * Client half of Mission control: a `conversation.view` board over the live
 * agent tree.
 *
 * Tree membership and labels come from the parent-owned `subagentCatalog`
 * projection (with the durable `byId` summaries as a union so a just-created
 * child shows up immediately). Live status and token/duration metrics come
 * from the same Client session snapshot the official subagent header reads.
 * Only the latest task/output/tool excerpts and the dispatch actions travel
 * through the Host's `/mission-control/api` route.
 *
 * The module is plain JavaScript because it is loaded by the Harness package
 * loader directly; React and the module table come from the browser runtime.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-mission-control',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Client locale namespace. */
    const NS = 'mission-control'
    /** Host JSON API, resolved relative to the page so proxy prefixes survive. */
    const API_PATH = 'mission-control/api'
    /** How often the digest (latest text/tool per live session) is refreshed. */
    const DIGEST_POLL_MS = 3000
    /** Empty shared references used while the session snapshot is loading. */
    const EMPTY_BY_ID = Object.freeze({})
    const EMPTY_PROJECTIONS = Object.freeze({})
    const EMPTY_STATUS = new Map()
    const EMPTY_ARCHIVED_IDS = Object.freeze([])

    /* ---------------------------------------------------------------- */
    /* Dictionaries                                                      */
    /* ---------------------------------------------------------------- */

    const zh = {
      'view.label': '指挥台',
      'head.eyebrow': '会话视图',
      'head.title': '任务指挥台',
      'head.sub': '{total} 个子 agent · {running} 个运行中 · 主 agent 统领全局',
      'head.subEmpty': '主 agent 统领全局 · 还没有派出子 agent',
      'head.subAllArchived': '{archived} 个子 agent 已归档 · 主 agent 统领全局',
      'head.refresh': '刷新',
      'head.refreshing': '刷新中…',
      'stat.agents': '子 agent',
      'stat.running': '运行中',
      'stat.tokens': 'tokens 总量',
      'stat.work': '累计工时',
      'main.badge': '主 agent · 总指挥',
      'main.open': '打开主对话',
      'main.task': '任务',
      'main.latest': '最新动态',
      'main.openLabel': '打开主 agent 对话',
      'feed.tool': '正在调用 {tool}',
      'feed.toolError': '调用 {tool} 失败',
      'feed.lastTool': '最近调用 {tool}',
      'feed.lastToolError': '最近调用 {tool} 失败',
      'feed.thinking': '正在思考…',
      'feed.idle': '当前空闲，等待下一步指令',
      'feed.idleShort': '空闲',
      'feed.noActivity': '暂无动态',
      'section.agents': '子 agent',
      'section.new': '派出子 agent',
      'section.close': '收起',
      'card.open': '打开',
      'card.openLabel': '打开「{label}」的对话',
      'card.interrupt': '中断',
      'card.interruptPrompt': '中断这个子 agent？',
      'card.confirm': '确认中断',
      'card.archive': '归档',
      'card.archiveLabel': '归档「{label}」',
      'card.archivePrompt': '归档这个子智能体？',
      'card.archiveHint': '归档后它会从指挥台隐藏、不再接受新消息，其下级也会一并隐藏；可在「已归档」中恢复。',
      'card.confirmArchive': '确认归档',
      'card.cancel': '取消',
      'card.current': '当前查看',
      'card.depth': '第 {n} 层',
      'card.task': '任务',
      'card.latest': '动态',
      'card.waiting': '等待开始…',
      'card.noActivity': '暂无动态',
      'card.created': '派出于 {value}',
      'interrupt.success': '已请求中断「{label}」',
      'archive.section': '已归档',
      'archive.show': '展开',
      'archive.hide': '收起',
      'archive.restore': '恢复',
      'archive.restoreLabel': '恢复「{label}」',
      'archive.success': '已归档「{label}」',
      'archive.restored': '已恢复「{label}」',
      'archive.restoring': '正在恢复…',
      'create.title': '派出新的子 agent',
      'create.name': '名称（可选）',
      'create.namePlaceholder': '例如：竞品调研',
      'create.task': '任务要求',
      'create.taskPlaceholder': '写清目标、范围和交付物。例如：调研 3 家竞品的定价策略，输出对比表格和结论。',
      'create.submit': '派出子 agent',
      'create.submitting': '正在派出…',
      'create.success': '已派出「{label}」',
      'create.hint': '子 agent 拥有独立上下文，会独立完成这项任务，结束后自动向主 agent 汇报。',
      'create.disabled': '当前部署未启用子 agent 服务，无法从这里派出子 agent。',
      'create.loading': '正在检查子 agent 服务…',
      'create.close': '收起',
      'empty.title': '还没有子 agent',
      'empty.body': '写清一项任务并派出子 agent，它会带着自己的上下文独立执行；主 agent 继续统筹全局，并在子 agent 完成时收到汇报。',
      'empty.action': '派出第一名子 agent',
      'loading': '正在载入会话…',
      'error.network': '无法连接宿主，请检查 DSH 是否仍在运行。',
      'error.forbidden': '请求被宿主拒绝。',
      'error.subagents-unavailable': '当前部署未启用子 agent 服务。',
      'error.sessions-unavailable': '当前部署未启用会话存储。',
      'error.capacity': '已达到同时运行的子 agent 上限，请等待现有子 agent 完成。',
      'error.agent-unavailable': '主 agent 尚未就绪，请先在主对话中发送一条消息。',
      'error.unauthorized': '当前主 agent 无权执行此操作。',
      'error.no-provider': '没有可用的子 agent 运行时。',
      'error.persistence': '子 agent 需要会话持久化支持，当前部署未启用。',
      'error.preset': '子 agent 的预设配置不可用。',
      'error.unsupported': '当前子 agent 运行时缺少所需能力。',
      'error.duplicate': '该子 agent 已存在。',
      'error.busy': '子 agent 管理器正在收尾，请稍后重试。',
      'error.not-continuable': '这个子 agent 不支持中断。',
      'error.interrupt-failed': '中断请求未被接受。',
      'error.archive-active': '这个子智能体还有进行中的工作，先中断它再归档。',
      'error.archive-missing': '宿主已找不到这个子智能体的会话，无法归档。',
      'error.archive-failed': '归档请求未被接受。',
      'error.unarchive-failed': '恢复请求未被接受。',
      'error.archive-unavailable': '当前部署不支持归档会话。',
      'error.depth-limit': '当前委派深度设置为 0，已禁用子 agent。',
      'error.api': '宿主接口不可用，面板暂时只能查看。',
      'error.emptyTask': '请先写清任务要求。',
      'error.generic': '操作失败：{message}',
      'footer.sync': '每 3 秒同步一次实时动态 · 子 agent 完成后会自动向主 agent 汇报',
      'footer.syncError': '宿主同步中断，当前显示最后一次成功的数据。',
      'time.justNow': '刚刚',
      'time.minutes': '{n} 分钟前',
      'time.hours': '{n} 小时前',
      'time.days': '{n} 天前',
      'meta.tokens': '{value} tokens',
      'meta.duration': '{value} 工作',
      'meta.updated': '{value}更新',
    }

    const en = {
      'view.label': 'Mission control',
      'head.eyebrow': 'SESSION VIEW',
      'head.title': 'Mission control',
      'head.sub': '{total} subagents · {running} running · lead agent in command',
      'head.subEmpty': 'Lead agent in command · no subagents yet',
      'head.subAllArchived': '{archived} subagents archived · lead agent in command',
      'head.refresh': 'Refresh',
      'head.refreshing': 'Refreshing…',
      'stat.agents': 'Subagents',
      'stat.running': 'Running',
      'stat.tokens': 'Tokens',
      'stat.work': 'Work time',
      'main.badge': 'Lead agent · Commander',
      'main.open': 'Open main chat',
      'main.task': 'Task',
      'main.latest': 'Latest',
      'main.openLabel': 'Open the lead agent conversation',
      'feed.tool': 'Calling {tool}',
      'feed.toolError': 'Call to {tool} failed',
      'feed.lastTool': 'Last called {tool}',
      'feed.lastToolError': 'Last call to {tool} failed',
      'feed.thinking': 'Thinking…',
      'feed.idle': 'Idle, waiting for the next instruction',
      'feed.idleShort': 'Idle',
      'feed.noActivity': 'No activity yet',
      'section.agents': 'Subagents',
      'section.new': 'Dispatch subagent',
      'section.close': 'Collapse',
      'card.open': 'Open',
      'card.openLabel': 'Open the conversation of {label}',
      'card.interrupt': 'Interrupt',
      'card.interruptPrompt': 'Interrupt this subagent?',
      'card.confirm': 'Confirm',
      'card.archive': 'Archive',
      'card.archiveLabel': 'Archive {label}',
      'card.archivePrompt': 'Archive this subagent?',
      'card.archiveHint': 'It leaves the board, stops taking new messages, hides its descendants too, and can be restored from Archived.',
      'card.confirmArchive': 'Archive',
      'card.cancel': 'Cancel',
      'card.current': 'Open now',
      'card.depth': 'Depth {n}',
      'card.task': 'Task',
      'card.latest': 'Latest',
      'card.waiting': 'Waiting to start…',
      'card.noActivity': 'No activity yet',
      'card.created': 'Dispatched {value}',
      'interrupt.success': 'Interrupt requested for {label}',
      'archive.section': 'Archived',
      'archive.show': 'Show',
      'archive.hide': 'Hide',
      'archive.restore': 'Restore',
      'archive.restoreLabel': 'Restore {label}',
      'archive.success': 'Archived "{label}"',
      'archive.restored': 'Restored "{label}"',
      'archive.restoring': 'Restoring…',
      'create.title': 'Dispatch a new subagent',
      'create.name': 'Name (optional)',
      'create.namePlaceholder': 'e.g. Pricing research',
      'create.task': 'Task',
      'create.taskPlaceholder': 'Describe the goal, scope and deliverable. e.g. Research the pricing of three competitors and return a comparison table with a recommendation.',
      'create.submit': 'Dispatch subagent',
      'create.submitting': 'Dispatching…',
      'create.success': 'Dispatched "{label}"',
      'create.hint':
        'The subagent gets its own context, works independently, and reports back to the lead agent when it finishes.',
      'create.disabled': 'The subagent service is not enabled in this deployment.',
      'create.loading': 'Checking the subagent service…',
      'create.close': 'Collapse',
      'empty.title': 'No subagents yet',
      'empty.body':
        'Describe a task and dispatch a subagent. It runs with its own context while the lead agent keeps the whole operation on track and receives the report when the subagent finishes.',
      'empty.action': 'Dispatch the first subagent',
      'loading': 'Loading session…',
      'error.network': 'Cannot reach the Harness host. Check that DSH is still running.',
      'error.forbidden': 'The host rejected the request.',
      'error.subagents-unavailable': 'The subagent service is not enabled in this deployment.',
      'error.sessions-unavailable': 'The session store is not enabled in this deployment.',
      'error.capacity': 'The active subagent limit has been reached. Wait for one to finish.',
      'error.agent-unavailable': 'The lead agent is not ready. Send a message in the main chat first.',
      'error.unauthorized': 'The lead agent is not authorized for this operation.',
      'error.no-provider': 'No subagent runtime is available.',
      'error.persistence': 'Subagents need session persistence, which is not enabled.',
      'error.preset': 'The subagent preset is unavailable.',
      'error.unsupported': 'The subagent runtime lacks a required capability.',
      'error.duplicate': 'That subagent already exists.',
      'error.busy': 'The subagent manager is draining. Try again shortly.',
      'error.not-continuable': 'This subagent cannot be interrupted.',
      'error.interrupt-failed': 'The interrupt request was not accepted.',
      'error.archive-active': 'This subagent still has work in progress. Interrupt it before archiving.',
      'error.archive-missing': 'The Host can no longer find this subagent session, so it cannot be archived.',
      'error.archive-failed': 'The archive request was not accepted.',
      'error.unarchive-failed': 'The restore request was not accepted.',
      'error.archive-unavailable': 'Archiving sessions is not supported in this deployment.',
      'error.depth-limit': 'Delegation depth is set to 0, so subagents are disabled.',
      'error.api': 'The host API is unavailable. The board is read-only for now.',
      'error.emptyTask': 'Describe the task first.',
      'error.generic': 'Operation failed: {message}',
      'footer.sync': 'Live digest every 3 seconds · finished subagents report back to the lead agent automatically',
      'footer.syncError': 'Host sync paused; showing the last successful data.',
      'time.justNow': 'just now',
      'time.minutes': '{n} min ago',
      'time.hours': '{n} h ago',
      'time.days': '{n} d ago',
      'meta.tokens': '{value} tokens',
      'meta.duration': '{value} work',
      'meta.updated': 'updated {value}',
    }

    /* ---------------------------------------------------------------- */
    /* Host API                                                          */
    /* ---------------------------------------------------------------- */

    /** Failure from one `/mission-control/api` call. */
    class ApiClientError extends Error {
      constructor(code, message) {
        super(message)
        this.name = 'MissionControlClientError'
        this.code = code
      }
    }

    /** Resolve a host route against the page base, keeping any proxy prefix. */
    function apiUrl(method) {
      let base =
        (typeof document !== 'undefined' && typeof document.baseURI === 'string' && document.baseURI) ||
        globalThis.__DSH_TRANSPORT__?.streamBaseUrl ||
        'http://dsh.internal/'
      const url = new URL(base, 'http://dsh.internal/')
      url.search = ''
      url.hash = ''
      if (!url.pathname.endsWith('/')) url.pathname += '/'
      return new URL(`${API_PATH}/${method}`, url.href).href
    }

    /** POST one API method and unwrap the `{ ok, value }` envelope. */
    async function callApi(method, payload, signal) {
      let response
      try {
        response = await fetch(apiUrl(method), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
          credentials: 'same-origin',
          signal,
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        throw new ApiClientError('network', error instanceof Error ? error.message : String(error))
      }
      let envelope = null
      try {
        envelope = await response.json()
      } catch {
        envelope = null
      }
      if (!response.ok || envelope === null || envelope.ok !== true) {
        throw new ApiClientError(
          typeof envelope?.error?.code === 'string' ? envelope.error.code : `http-${response.status}`,
          typeof envelope?.error?.message === 'string'
            ? envelope.error.message
            : `HTTP ${response.status}`,
        )
      }
      return envelope.value
    }

    /* ---------------------------------------------------------------- */
    /* Formatting                                                        */
    /* ---------------------------------------------------------------- */

    function formatTokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
      const scaled = (next) => (next >= 100 ? String(Math.round(next)) : String(Math.round(next * 10) / 10))
      if (value < 1000) return String(Math.round(value))
      if (value < 1_000_000) return `${scaled(value / 1000)}k`
      return `${scaled(value / 1_000_000)}M`
    }

    function formatDuration(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
      const totalSeconds = Math.floor(ms / 1000)
      if (totalSeconds < 60) return `${totalSeconds}s`
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
      const hours = Math.floor(minutes / 60)
      const restMinutes = minutes % 60
      if (hours < 24) return `${hours}h ${String(restMinutes).padStart(2, '0')}m`
      const days = Math.floor(hours / 24)
      return `${days}d ${hours % 24}h`
    }

    function formatRelative(time, now, t) {
      if (typeof time !== 'number' || !Number.isFinite(time)) return null
      const delta = Math.max(0, now - time)
      if (delta < 45_000) return t('time.justNow')
      const minutes = Math.floor(delta / 60_000)
      if (minutes < 60) return t('time.minutes', { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('time.hours', { n: hours })
      return t('time.days', { n: Math.floor(hours / 24) })
    }

    function errorText(t, error) {
      const code = typeof error?.code === 'string' ? error.code : 'generic'
      const key = `error.${code}`
      const localized = t(key)
      if (typeof localized === 'string' && localized !== '' && localized !== key) return localized
      if (code === 'network') return t('error.network')
      return t('error.generic', { message: error?.message ?? String(error) })
    }

    /**
     * The Workspace service owns the durable archived-session set. It is read
     * through `ctx.get` so an older deployment that mounts only the UI half
     * still renders the board, just without archive state.
     */
    function workspacesOf(ctx) {
      try {
        const service = ctx?.get?.('workspaces')
        if (service !== undefined && service !== null) return service
        return ctx?.workspaces ?? ctx?.uiWorkspace?.workspaces
      } catch {
        return undefined
      }
    }

    /** Translate a rejected Workspace archive/unarchive request. */
    function archiveErrorText(t, error, fallbackKey) {
      const code = error?.rpcError?.code ?? error?.code
      if (code === 'workspace/session-active') return t('error.archive-active')
      if (code === 'session/not-found') return t('error.archive-missing')
      return t(fallbackKey)
    }

    /**
     * Follow the registry-global archived-session set from the shared Workspace
     * model. The snapshot array is stable between commits, so a re-render only
     * happens when the set actually changes.
     */
    function useArchivedSessionIds(workspaces) {
      const list = workspaces?.list
      const read = React.useCallback(() => {
        const snapshot = typeof list?.getSnapshot === 'function' ? list.getSnapshot() : undefined
        return Array.isArray(snapshot?.archivedSessionIds) ? snapshot.archivedSessionIds : EMPTY_ARCHIVED_IDS
      }, [list])
      const [ids, setIds] = React.useState(read)
      React.useEffect(() => {
        setIds(read())
        if (typeof list?.subscribe !== 'function') return undefined
        return list.subscribe(() => setIds(read()))
      }, [list, read])
      return ids
    }

    /* ---------------------------------------------------------------- */
    /* Data derivation                                                   */
    /* ---------------------------------------------------------------- */

    function summaryOf(byId, id) {
      return byId !== undefined && Object.hasOwn(byId, id) ? byId[id] : undefined
    }

    function runningOf(statuses, byId, id) {
      const status = statuses !== undefined && typeof statuses.get === 'function' ? statuses.get(id) : undefined
      if (typeof status?.running === 'boolean') return status.running
      return summaryOf(byId, id)?.running === true
    }

    function rootOf(byId, id) {
      let cursor = id
      const seen = new Set()
      while (typeof cursor === 'string' && cursor !== '' && !seen.has(cursor)) {
        seen.add(cursor)
        const summary = summaryOf(byId, cursor)
        if (summary === undefined) return cursor
        if (summary.origin !== 'subagent' || typeof summary.parentId !== 'string' || summary.parentId === '') {
          return cursor
        }
        cursor = summary.parentId
      }
      return cursor
    }

    function isSideThread(summary) {
      const title = typeof summary?.displayTitle === 'string' ? summary.displayTitle : ''
      return title.startsWith('Side: ') || title.startsWith('Side:')
    }

    function usageOf(byId, projections, id) {
      const summary = summaryOf(byId, id)
      const fromSummary = summary?.projectionValues?.tokenUsage
      if (fromSummary !== undefined && fromSummary !== null) return fromSummary
      return projections?.[id]?.values?.tokenUsage
    }

    function timingOf(byId, projections, id) {
      const summary = summaryOf(byId, id)
      const fromSummary = summary?.projectionValues?.subagentTiming
      if (fromSummary !== undefined && fromSummary !== null) return fromSummary
      return projections?.[id]?.values?.subagentTiming
    }

    function metricsOf(byId, projections, id, running, now) {
      const usage = usageOf(byId, projections, id)
      let tokens
      if (usage !== undefined && usage !== null) {
        tokens =
          (usage.uncachedInputTokens ?? 0) +
          (usage.outputTokens ?? 0) +
          (usage.cacheReadTokens ?? 0) +
          (usage.cacheWriteTokens ?? 0)
        if (!Number.isFinite(tokens) || tokens <= 0) tokens = undefined
      }
      const timing = timingOf(byId, projections, id)
      let duration
      if (timing !== undefined && timing !== null) {
        const settled = typeof timing.settledMs === 'number' ? timing.settledMs : 0
        const active = timing.active
        if (active !== undefined && active !== null && typeof active.since === 'number') {
          const through = typeof active.through === 'number' ? active.through : now
          const end = running ? now : through
          duration = settled + Math.max(0, end - active.since)
        } else {
          duration = settled
        }
        if (!Number.isFinite(duration) || duration <= 0) duration = undefined
      }
      return { tokens, duration }
    }

    /**
     * Build the board from the shared snapshot. Catalog entries are
     * authoritative for membership and labels; durable byId children are
     * unioned in so a child dispatched a moment ago is never invisible, and
     * side-chat threads (durable `Side: ` sessions) are filtered out.
     */
    function buildBoard(byId, projections, statuses, currentId, now, listPhase) {
      const rootId = rootOf(byId, currentId)
      const catalog = new Map()
      for (const [parentId, snapshot] of Object.entries(projections ?? {})) {
        const entries = snapshot?.values?.subagentCatalog
        if (!Array.isArray(entries) || entries.length === 0) continue
        if (!catalog.has(parentId)) catalog.set(parentId, [])
        const bucket = catalog.get(parentId)
        for (const entry of entries) {
          if (entry === null || typeof entry !== 'object') continue
          if (typeof entry.id !== 'string') continue
          bucket.push({
            id: entry.id,
            label: typeof entry.label === 'string' ? entry.label : '',
            mode: typeof entry.mode === 'string' ? entry.mode : 'unknown',
            createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : undefined,
            hasChildren: true,
          })
        }
      }

      const byIdChildren = new Map()
      for (const [id, summary] of Object.entries(byId ?? {})) {
        if (summary?.origin !== 'subagent') continue
        if (typeof summary.parentId !== 'string' || summary.parentId === '') continue
        if (isSideThread(summary)) continue
        if (!byIdChildren.has(summary.parentId)) byIdChildren.set(summary.parentId, [])
        byIdChildren.get(summary.parentId).push({
          id,
          label: typeof summary.displayTitle === 'string' ? summary.displayTitle : '',
          mode: 'continuable',
          createdAt: undefined,
        })
      }

      const rootSummary = summaryOf(byId, rootId)
      const rootTitle =
        (typeof rootSummary?.displayTitle === 'string' && rootSummary.displayTitle !== ''
          ? rootSummary.displayTitle
          : undefined) ?? rootId

      const nodes = []
      const seen = new Set([rootId])
      const visit = (parentId, depth) => {
        const merged = new Map()
        for (const entry of catalog.get(parentId) ?? []) {
          const summary = summaryOf(byId, entry.id)
          merged.set(entry.id, {
            ...entry,
            label: entry.label !== '' ? entry.label : typeof summary?.displayTitle === 'string' ? summary.displayTitle : entry.id,
          })
        }
        for (const entry of byIdChildren.get(parentId) ?? []) {
          if (merged.has(entry.id)) continue
          const summary = summaryOf(byId, entry.id)
          merged.set(entry.id, {
            ...entry,
            label: entry.label !== '' ? entry.label : typeof summary?.displayTitle === 'string' ? summary.displayTitle : entry.id,
            hasChildren: byIdChildren.has(entry.id) || catalog.has(entry.id),
          })
        }
        const children = [...merged.values()].sort((left, right) => {
          const leftTime = left.createdAt ?? 0
          const rightTime = right.createdAt ?? 0
          if (leftTime !== rightTime) return leftTime - rightTime
          return left.id.localeCompare(right.id)
        })
        for (const child of children) {
          if (seen.has(child.id)) continue
          seen.add(child.id)
          const running = runningOf(statuses, byId, child.id)
          nodes.push({
            id: child.id,
            label: child.label,
            mode: child.mode,
            createdAt: child.createdAt,
            parentId,
            depth,
            running,
            metrics: metricsOf(byId, projections, child.id, running, now),
          })
          visit(child.id, depth + 1)
        }
      }
      visit(rootId, 1)

      const byNodeId = new Map(nodes.map((node) => [node.id, node]))
      for (const node of nodes) {
        node.parentLabel =
          node.parentId === rootId
            ? rootTitle
            : byNodeId.get(node.parentId)?.label ?? node.parentId
      }

      let totalTokens = 0
      let totalDuration = 0
      const rootMetrics = metricsOf(byId, projections, rootId, runningOf(statuses, byId, rootId), now)
      if (rootMetrics.tokens !== undefined) totalTokens += rootMetrics.tokens
      if (rootMetrics.duration !== undefined) totalDuration += rootMetrics.duration
      for (const node of nodes) {
        if (node.metrics.tokens !== undefined) totalTokens += node.metrics.tokens
        if (node.metrics.duration !== undefined) totalDuration += node.metrics.duration
      }

      return {
        rootId,
        rootTitle,
        rootRunning: runningOf(statuses, byId, rootId),
        rootMetrics,
        nodes,
        totalTokens,
        totalDuration,
        loading: Object.keys(byId ?? {}).length === 0 && listPhase !== 'ready',
      }
    }

    /* ---------------------------------------------------------------- */
    /* Icons                                                             */
    /* ---------------------------------------------------------------- */

    function iconOrbit() {
      return h(
        'svg',
        { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: 12, cy: 12, r: 8.2, stroke: 'currentColor', strokeOpacity: 0.32, strokeWidth: 1.5 }),
        h('circle', { cx: 12, cy: 12, r: 4.2, stroke: 'currentColor', strokeOpacity: 0.6, strokeWidth: 1.5 }),
        h('path', { d: 'M12 12 18.2 5.8', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
        h('circle', { cx: 12, cy: 12, r: 1.8, fill: 'currentColor' }),
        h('circle', { cx: 18.2, cy: 5.8, r: 1.5, fill: 'currentColor' }),
      )
    }

    function iconRefresh() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M13 8a5 5 0 1 1-1.46-3.54M13 2.5V5h-2.5',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function iconPlus() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M8 3v10M3 8h10', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      )
    }

    function iconArrow() {
      return h(
        'svg',
        { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M5 11 11 5M6 5h5v5',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function iconStop() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 4, y: 4, width: 8, height: 8, rx: 1.6, stroke: 'currentColor', strokeWidth: 1.5 }),
      )
    }

    function iconArchive() {
      return h(
        'svg',
        { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M2.5 4.5h11v2.2h-11zM3.5 6.7h9v6.3h-9zM6.4 9.2h3.2',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function iconEmpty() {
      return h(
        'svg',
        { width: 64, height: 64, viewBox: '0 0 64 64', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: 32, cy: 32, r: 22, stroke: 'currentColor', strokeOpacity: 0.22, strokeWidth: 1.4 }),
        h('circle', { cx: 32, cy: 32, r: 13, stroke: 'currentColor', strokeOpacity: 0.38, strokeWidth: 1.4 }),
        h('path', { d: 'M32 32 46 18', stroke: 'currentColor', strokeOpacity: 0.55, strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('circle', { cx: 32, cy: 32, r: 4.2, fill: 'currentColor', fillOpacity: 0.85 }),
        h('circle', { cx: 46, cy: 18, r: 3, fill: 'currentColor', fillOpacity: 0.55 }),
        h('circle', { cx: 18, cy: 41, r: 2.6, fill: 'currentColor', fillOpacity: 0.4 }),
      )
    }

    /* ---------------------------------------------------------------- */
    /* Views                                                             */
    /* ---------------------------------------------------------------- */

    function StatusPill({ running, t }) {
      return h(
        'span',
        { className: `mc-pill ${running ? 'is-run' : 'is-idle'}` },
        h('i', { className: 'mc-dot', 'aria-hidden': 'true' }),
        running ? t('stat.running') : t('feed.idleShort'),
      )
    }

    function Stat({ label, value, title }) {
      return h(
        'div',
        { className: 'mc-stat', title: title ?? undefined },
        h('div', { className: 'mc-stat-n' }, value === undefined || value === null ? '—' : value),
        h('div', { className: 'mc-stat-l' }, label),
      )
    }

    function MetricRow({ items }) {
      const visible = items.filter((item) => item !== null && item !== undefined && item.value !== null && item.value !== undefined)
      if (visible.length === 0) return null
      return h(
        'div',
        { className: 'mc-meta' },
        visible.map((item, index) =>
          h(
            'span',
            { className: 'mc-meta-item', title: item.title ?? undefined, key: index },
            item.value,
          ),
        ),
      )
    }

    function Feed({ label, text, title }) {
      return h(
        'div',
        { className: 'mc-feed', title: title ?? undefined },
        h('span', { className: 'mc-feed-k' }, label),
        h('span', { className: 'mc-feed-v' }, text),
      )
    }

    function digestLine(digest, running, t) {
      if (digest === undefined) return running ? t('feed.thinking') : t('feed.noActivity')
      if (running && digest.tool !== undefined && digest.tool !== '') {
        return t(digest.toolError ? 'feed.toolError' : 'feed.tool', { tool: digest.tool })
      }
      if (digest.text !== undefined && digest.text !== '') return digest.text
      if (digest.tool !== undefined && digest.tool !== '') {
        return t(digest.toolError ? 'feed.lastToolError' : 'feed.lastTool', { tool: digest.tool })
      }
      return running ? t('feed.thinking') : t('feed.noActivity')
    }

    /**
     * The user-facing task excerpt of a child. The delegation tool appends its
     * own parent-id/result instructions to the prompt; those are runtime
     * plumbing, not the task, and the card title already carries the label.
     */
    function relevantTask(task, label) {
      if (typeof task !== 'string') return undefined
      let text = task
      for (const marker of ['Your parent agent id is', 'Before you finish, send your result']) {
        const index = text.indexOf(marker)
        if (index > 0) text = text.slice(0, index).trim()
      }
      text = text.trim()
      if (text === '') return undefined
      const title = typeof label === 'string' ? label.trim() : ''
      if (title !== '' && (text === title || (text.startsWith(title) && text.length <= title.length + 2))) {
        return undefined
      }
      return text
    }

    function MainCard({ board, digest, now, onOpen, t }) {
      const root = digest?.[board.rootId]
      const running = board.rootRunning
      const feed = digestLine(root, running, t)
      const metrics = board.rootMetrics
      const meta = []
      if (metrics.tokens !== undefined) {
        meta.push({ value: t('meta.tokens', { value: formatTokens(metrics.tokens) }), title: String(metrics.tokens) })
      }
      if (metrics.duration !== undefined) {
        meta.push({ value: t('meta.duration', { value: formatDuration(metrics.duration) }), title: formatDuration(metrics.duration) })
      }
      if (root?.turns !== undefined) meta.push({ value: `#${root.turns}` })
      if (root?.time !== undefined) {
        meta.push({ value: t('meta.updated', { value: formatRelative(root.time, now, t) }) })
      }

      return h(
        'section',
        { className: `mc-main${running ? ' is-running' : ''}`, 'aria-label': t('main.badge') },
        h(
          'div',
          { className: 'mc-main-head' },
          h(
            'div',
            { className: 'mc-main-id' },
            h('span', { className: 'mc-main-mark', 'aria-hidden': 'true' }, iconOrbit()),
            h(
              'div',
              { className: 'mc-main-id-text' },
              h('div', { className: 'mc-main-badge' }, t('main.badge')),
              h('div', { className: 'mc-main-title', title: board.rootTitle }, board.rootTitle),
            ),
          ),
          h(
            'div',
            { className: 'mc-main-actions' },
            h(StatusPill, { running, t }),
            h(
              'button',
              {
                type: 'button',
                className: 'mc-btn mc-btn-quiet',
                onClick: onOpen,
                title: t('main.openLabel'),
                'aria-label': t('main.openLabel'),
              },
              iconArrow(),
              h('span', null, t('main.open')),
            ),
          ),
        ),
        root?.task !== undefined && root.task !== ''
          ? h(
              'p',
              { className: 'mc-main-task', title: root.task },
              h('span', { className: 'mc-k' }, t('main.task')),
              h('span', { className: 'mc-main-task-v' }, root.task),
            )
          : null,
        h(Feed, { label: t('main.latest'), text: feed, title: root?.text ?? undefined }),
        h(MetricRow, { items: meta }),
      )
    }

    function AgentCard({
      node,
      digest,
      current,
      busy,
      confirming,
      archiveConfirming,
      now,
      onOpen,
      onAskInterrupt,
      onCancelInterrupt,
      onInterrupt,
      onAskArchive,
      onCancelArchive,
      onArchive,
      archiveEnabled,
      t,
    }) {
      const running = node.running === true
      const feed = digestLine(digest, running, t)
      const task = relevantTask(digest?.task, node.label)
      const meta = []
      if (node.metrics.tokens !== undefined) {
        meta.push({ value: t('meta.tokens', { value: formatTokens(node.metrics.tokens) }), title: String(node.metrics.tokens) })
      }
      if (node.metrics.duration !== undefined) {
        meta.push({ value: t('meta.duration', { value: formatDuration(node.metrics.duration) }) })
      }
      const updated = digest?.time ?? node.createdAt
      if (updated !== undefined) {
        meta.push({
          value:
            digest?.time !== undefined
              ? t('meta.updated', { value: formatRelative(updated, now, t) })
              : t('card.created', { value: formatRelative(updated, now, t) }),
        })
      }
      const canOpen = node.mode !== 'external'
      const canInterrupt = running && node.mode === 'continuable'
      const canArchive = archiveEnabled !== false && node.mode !== 'external' && !running
      const classes = ['mc-card', running ? 'is-run' : 'is-idle']
      if (current) classes.push('is-current')
      if (busy) classes.push('is-busy')

      return h(
        'article',
        { className: classes.join(' '), 'data-session-id': node.id },
        h(
          'div',
          { className: 'mc-card-top' },
          h(StatusPill, { running, t }),
          h('span', { className: 'mc-depth' }, t('card.depth', { n: node.depth })),
          current ? h('span', { className: 'mc-current' }, t('card.current')) : null,
          h(
            'div',
            { className: 'mc-card-actions' },
            confirming
              ? h(
                  'div',
                  { className: 'mc-confirm' },
                  h('span', { className: 'mc-confirm-q' }, t('card.interruptPrompt')),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'mc-btn mc-btn-danger',
                      onClick: () => onInterrupt(node),
                      disabled: busy,
                    },
                    t('card.confirm'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'mc-btn mc-btn-quiet',
                      onClick: onCancelInterrupt,
                      disabled: busy,
                    },
                    t('card.cancel'),
                  ),
                )
              : archiveConfirming
                ? h(
                    'div',
                    { className: 'mc-confirm' },
                    h(
                      'span',
                      { className: 'mc-confirm-q', title: t('card.archiveHint') },
                      t('card.archivePrompt'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'mc-btn mc-btn-danger',
                        onClick: () => onArchive(node),
                        disabled: busy,
                      },
                      t('card.confirmArchive'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'mc-btn mc-btn-quiet',
                        onClick: onCancelArchive,
                        disabled: busy,
                      },
                      t('card.cancel'),
                    ),
                  )
                : h(
                    'div',
                    { className: 'mc-card-buttons' },
                    canOpen
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'mc-btn mc-btn-quiet',
                            onClick: () => onOpen(node),
                            title: t('card.openLabel', { label: node.label }),
                            'aria-label': t('card.openLabel', { label: node.label }),
                          },
                          iconArrow(),
                          h('span', null, t('card.open')),
                        )
                      : null,
                    canInterrupt
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'mc-btn mc-btn-quiet',
                            onClick: () => onAskInterrupt(node),
                            disabled: busy,
                            title: t('card.interrupt'),
                          },
                          iconStop(),
                          h('span', null, t('card.interrupt')),
                        )
                      : null,
                    canArchive
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'mc-btn mc-btn-quiet',
                            onClick: () => onAskArchive(node),
                            disabled: busy,
                            title: t('card.archiveLabel', { label: node.label }),
                            'aria-label': t('card.archiveLabel', { label: node.label }),
                          },
                          iconArchive(),
                          h('span', null, t('card.archive')),
                        )
                      : null,
                  ),
          ),
        ),
        h('h3', { className: 'mc-card-title', title: node.label }, node.label),
        node.parentLabel !== undefined && node.depth > 1
          ? h('div', { className: 'mc-parent' }, node.parentLabel)
          : null,
        digest?.task !== undefined && task !== undefined
          ? h(
              'p',
              { className: 'mc-card-task', title: task },
              h('span', { className: 'mc-k' }, t('card.task')),
              h('span', { className: 'mc-card-task-v' }, task),
            )
          : null,
        h(Feed, { label: t('card.latest'), text: feed, title: digest?.text ?? undefined }),
        h(MetricRow, { items: meta }),
      )
    }

    /**
     * The archived tray. Archived cards leave the live grid but stay reachable
     * here, so tidying the board never loses the conversation.
     */
    function ArchivedSection({ nodes, open, restoringId, onToggle, onRestore, t }) {
      return h(
        'section',
        { className: 'mc-archived', 'aria-label': t('archive.section') },
        h(
          'div',
          { className: 'mc-section-head' },
          h(
            'h3',
            { className: 'mc-section-title' },
            t('archive.section'),
            h('span', { className: 'mc-count' }, nodes.length),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'mc-btn mc-btn-quiet',
              onClick: onToggle,
              'aria-expanded': open,
            },
            open ? t('archive.hide') : t('archive.show'),
          ),
        ),
        open
          ? h(
              'ul',
              { className: 'mc-archived-list' },
              nodes.map((node) =>
                h(
                  'li',
                  { className: 'mc-archived-row', key: node.id },
                  h('span', { className: 'mc-archived-label', title: node.label }, node.label),
                  h('span', { className: 'mc-archived-meta' }, t('card.depth', { n: node.depth })),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'mc-btn mc-btn-quiet',
                      onClick: () => onRestore(node),
                      disabled: restoringId === node.id,
                      title: t('archive.restoreLabel', { label: node.label }),
                      'aria-label': t('archive.restoreLabel', { label: node.label }),
                    },
                    restoringId === node.id ? t('archive.restoring') : t('archive.restore'),
                  ),
                ),
              ),
            )
          : null,
      )
    }

    function CreatePanel({ t, caps, status, busy, error, onSubmit, onClose, resetKey }) {
      const [task, setTask] = React.useState('')
      const [label, setLabel] = React.useState('')
      const [touched, setTouched] = React.useState(false)

      React.useEffect(() => {
        if (resetKey === 0) return
        setTask('')
        setLabel('')
        setTouched(false)
      }, [resetKey])

      const ready = status === 'ready' && caps.canSpawn === true
      const canSubmit = ready && !busy && task.trim() !== ''
      const disabledHint =
        status === 'loading'
          ? t('create.loading')
          : status === 'error' || !caps.canSpawn
            ? t('create.disabled')
            : null

      return h(
        'section',
        { className: 'mc-create', 'aria-label': t('create.title') },
        h(
          'div',
          { className: 'mc-create-head' },
          h(
            'div',
            { className: 'mc-create-heading' },
            h('div', { className: 'mc-create-title' }, t('create.title')),
            h('p', { className: 'mc-hint' }, ready ? t('create.hint') : disabledHint ?? t('create.hint')),
          ),
          h(
            'button',
            { type: 'button', className: 'mc-btn mc-btn-quiet', onClick: onClose, title: t('create.close') },
            t('create.close'),
          ),
        ),
        h(
          'form',
          {
            className: 'mc-create-form',
            onSubmit: (event) => {
              event.preventDefault()
              if (!canSubmit) {
                setTouched(true)
                return
              }
              onSubmit({ task: task.trim(), label: label.trim() })
            },
          },
          h(
            'div',
            { className: 'mc-field' },
            h('label', { className: 'mc-label', htmlFor: 'mc-task' }, t('create.task')),
            h('textarea', {
              id: 'mc-task',
              className: 'mc-textarea',
              value: task,
              rows: 4,
              maxLength: 20_000,
              placeholder: t('create.taskPlaceholder'),
              disabled: !ready || busy,
              onChange: (event) => setTask(event.target.value),
              onBlur: () => setTouched(true),
            }),
          ),
          h(
            'div',
            { className: 'mc-field mc-field-name' },
            h('label', { className: 'mc-label', htmlFor: 'mc-name' }, t('create.name')),
            h('input', {
              id: 'mc-name',
              className: 'mc-input',
              value: label,
              maxLength: 120,
              placeholder: t('create.namePlaceholder'),
              disabled: !ready || busy,
              onChange: (event) => setLabel(event.target.value),
            }),
          ),
          error !== null && error !== undefined
            ? h('div', { className: 'mc-banner is-error', role: 'alert' }, error)
            : null,
          touched && ready && task.trim() === ''
            ? h('div', { className: 'mc-banner is-warn', role: 'status' }, t('error.emptyTask'))
            : null,
          h(
            'div',
            { className: 'mc-create-foot' },
            h(
              'button',
              { type: 'submit', className: 'mc-btn mc-btn-primary', disabled: !canSubmit },
              iconPlus(),
              h('span', null, busy ? t('create.submitting') : t('create.submit')),
            ),
          ),
        ),
      )
    }

    function EmptyState({ t, onAction }) {
      return h(
        'div',
        { className: 'mc-empty' },
        h('div', { className: 'mc-empty-art', 'aria-hidden': 'true' }, iconEmpty()),
        h('div', { className: 'mc-empty-title' }, t('empty.title')),
        h('p', { className: 'mc-empty-body' }, t('empty.body')),
        h(
          'button',
          { type: 'button', className: 'mc-btn mc-btn-primary', onClick: onAction },
          iconPlus(),
          h('span', null, t('empty.action')),
        ),
      )
    }

    /**
     * The board component. Standard slot props provide the shared session
     * snapshot and status hooks; the plugin context is captured at apply time.
     */
    function MissionControl(props) {
      const { ctx, t } = props
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
      const useSessions = props.useSessions
      const useSessionStatus = props.useSessionStatus

      const byId = useSessions((state) => state?.byId ?? EMPTY_BY_ID)
      const projections = useSessions((state) => state?.projectionsBySession ?? EMPTY_PROJECTIONS)
      const listPhase = useSessions((state) => state?.phase)
      const statuses = useSessionStatus((value) => value ?? EMPTY_STATUS)

      const [now, setNow] = React.useState(() => Date.now())
      const [digest, setDigest] = React.useState({ items: EMPTY_BY_ID, error: null, at: 0 })
      const [caps, setCaps] = React.useState({ status: 'loading', canSpawn: false, providers: [] })
      const [formOpen, setFormOpen] = React.useState(true)
      const [creating, setCreating] = React.useState(false)
      const [createError, setCreateError] = React.useState(null)
      const [flash, setFlash] = React.useState(null)
      const [pending, setPending] = React.useState([])
      const [confirmId, setConfirmId] = React.useState(null)
      const [archiveConfirmId, setArchiveConfirmId] = React.useState(null)
      const [interruptingId, setInterruptingId] = React.useState(null)
      const [archivingId, setArchivingId] = React.useState(null)
      const [restoringId, setRestoringId] = React.useState(null)
      const [archivedOpen, setArchivedOpen] = React.useState(true)
      const [refreshing, setRefreshing] = React.useState(false)
      const [digestNonce, setDigestNonce] = React.useState(0)
      const [formReset, setFormReset] = React.useState(0)
      const rootRef = React.useRef(null)
      const headerRef = React.useRef(null)

      React.useEffect(() => {
        const root = rootRef.current
        if (root !== null && root.scrollTop !== 0) root.scrollTop = 0
        const header = headerRef.current
        if (header === null || typeof header.scrollIntoView !== 'function') return undefined
        const frame = requestAnimationFrame(() => {
          header.scrollIntoView({ block: 'start' })
        })
        return () => cancelAnimationFrame(frame)
      }, [sessionId])

      const board = React.useMemo(
        () => buildBoard(byId, projections, statuses, sessionId, now, listPhase),
        [byId, projections, statuses, sessionId, now, listPhase],
      )

      const workspaces = React.useMemo(() => workspacesOf(ctx), [ctx])
      const archiveEnabled =
        typeof ctx.uiWorkspace?.archiveSession === 'function' &&
        typeof ctx.uiWorkspace?.unarchiveSession === 'function'
      const archivedIds = useArchivedSessionIds(workspaces)
      const archivedSet = React.useMemo(() => new Set(archivedIds), [archivedIds])
      /**
       * An archived Session's subagent descendants cannot run either (the
       * Host's archived-session gate blocks their steps), so they leave the
       * live grid with it. They are not archived themselves: restoring the
       * ancestor brings them back unchanged.
       */
      const hiddenIds = React.useMemo(() => {
        const hidden = new Set()
        if (archivedSet.size === 0) return hidden
        const children = new Map()
        for (const node of board.nodes) {
          if (typeof node.parentId !== 'string') continue
          const bucket = children.get(node.parentId)
          if (bucket === undefined) children.set(node.parentId, [node.id])
          else bucket.push(node.id)
        }
        const pending = [...archivedSet]
        while (pending.length > 0) {
          for (const childId of children.get(pending.pop()) ?? []) {
            if (archivedSet.has(childId) || hidden.has(childId)) continue
            hidden.add(childId)
            pending.push(childId)
          }
        }
        return hidden
      }, [board.nodes, archivedSet])
      const activeNodes = React.useMemo(
        () => board.nodes.filter((node) => !archivedSet.has(node.id) && !hiddenIds.has(node.id)),
        [board.nodes, archivedSet, hiddenIds],
      )
      const archivedNodes = React.useMemo(() => {
        const byNodeId = new Map(board.nodes.map((node) => [node.id, node]))
        const underArchivedAncestor = (node) => {
          const seen = new Set()
          let cursor = node.parentId
          while (typeof cursor === 'string' && !seen.has(cursor)) {
            seen.add(cursor)
            if (archivedSet.has(cursor)) return true
            cursor = byNodeId.get(cursor)?.parentId
          }
          return false
        }
        return board.nodes.filter((node) => archivedSet.has(node.id) && !underArchivedAncestor(node))
      }, [board.nodes, archivedSet])
      const activeIds = React.useMemo(() => new Set(activeNodes.map((node) => node.id)), [activeNodes])

      const ids = React.useMemo(
        () => [board.rootId, ...activeNodes.map((node) => node.id)].filter((id) => typeof id === 'string'),
        [board.rootId, activeNodes],
      )
      const idsKey = ids.join('\u0001')
      const idsRef = React.useRef(ids)
      idsRef.current = ids

      const anyRunning = board.rootRunning || activeNodes.some((node) => node.running)

      React.useEffect(() => {
        setFormOpen(board.nodes.length === 0)
      }, [board.rootId])

      React.useEffect(() => {
        if (!anyRunning) return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [anyRunning])

      const loadCapabilities = React.useCallback(
        async (signal) => {
          setCaps((current) => ({ ...current, status: current.status === 'ready' ? 'ready' : 'loading' }))
          try {
            const value = await callApi('capabilities', {}, signal)
            setCaps({
              status: 'ready',
              canSpawn: value?.canSpawn === true,
              providers: Array.isArray(value?.providers) ? value.providers : [],
              defaultProvider: typeof value?.defaultProvider === 'string' ? value.defaultProvider : undefined,
            })
            return true
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return false
            setCaps({ status: 'error', canSpawn: false, providers: [] })
            setCreateError(errorText(t, error))
            return false
          }
        },
        [t],
      )

      React.useEffect(() => {
        const controller = new AbortController()
        loadCapabilities(controller.signal)
        return () => controller.abort()
      }, [loadCapabilities])

      React.useEffect(() => {
        let cancelled = false
        let timer = null
        const controller = new AbortController()
        const run = async () => {
          if (cancelled) return
          const batch = idsRef.current
          if (batch.length === 0) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            timer = setTimeout(run, DIGEST_POLL_MS)
            return
          }
          try {
            const value = await callApi('digest', { sessionIds: batch }, controller.signal)
            if (cancelled) return
            const items = value !== null && typeof value?.items === 'object' ? value.items : {}
            setDigest({ items, error: null, at: Date.now() })
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return
            if (cancelled) return
            setDigest((current) => ({ ...current, error: errorText(t, error) }))
          }
          if (!cancelled) timer = setTimeout(run, DIGEST_POLL_MS)
        }
        run()
        return () => {
          cancelled = true
          controller.abort()
          if (timer !== null) clearTimeout(timer)
        }
      }, [idsKey, digestNonce, t, ctx])

      React.useEffect(() => {
        if (flash === null) return undefined
        const timer = setTimeout(() => setFlash(null), 5000)
        return () => clearTimeout(timer)
      }, [flash])

      const nodeIdsKey = activeNodes.map((node) => node.id).join('\u0001')
      React.useEffect(() => {
        setPending((current) => {
          if (current.length === 0) return current
          const present = new Set(nodeIdsKey === '' ? [] : nodeIdsKey.split('\u0001'))
          const next = current.filter((item) => !present.has(item.id))
          return next.length === current.length ? current : next
        })
      }, [nodeIdsKey])

      React.useEffect(() => {
        if (archiveConfirmId !== null && !activeIds.has(archiveConfirmId)) setArchiveConfirmId(null)
        if (confirmId !== null && !activeIds.has(confirmId)) setConfirmId(null)
      }, [archiveConfirmId, activeIds, confirmId])

      const openSession = React.useCallback(
        (node) => {
          if (node === null || node === undefined) return
          if (node.parentId === undefined) {
            ctx.uiWorkspace.openSession(node.id)
            return
          }
          if (node.mode === 'external') return
          ctx.uiWorkspace.openSession({
            parentSessionId: node.parentId,
            childSessionId: node.id,
            mode: node.mode === 'one-shot' ? 'one-shot' : node.mode === 'unknown' ? 'unknown' : 'continuable',
          })
        },
        [ctx],
      )

      const dispatch = React.useCallback(
        async ({ task, label }) => {
          if (creating) return
          setCreating(true)
          setCreateError(null)
          try {
            const value = await callApi('spawn', {
              parentSessionId: board.rootId,
              task,
              ...(label !== '' ? { label } : {}),
            })
            const createdLabel = typeof value?.label === 'string' ? value.label : label
            setFlash({ tone: 'ok', text: t('create.success', { label: createdLabel }) })
            setFormReset((current) => current + 1)
            setPending((current) => [
              ...current,
              { id: String(value?.childId ?? ''), label: createdLabel, createdAt: Date.now() },
            ])
            ctx.sessions?.refreshProjections?.(board.rootId)
            setDigestNonce((current) => current + 1)
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return
            const text = errorText(t, error)
            setCreateError(text)
            setFlash({ tone: 'error', text })
          } finally {
            setCreating(false)
          }
        },
        [board.rootId, creating, ctx, t],
      )

      const interrupt = React.useCallback(
        async (node) => {
          if (interruptingId !== null) return
          setInterruptingId(node.id)
          setCreateError(null)
          try {
            await callApi('interrupt', {
              parentSessionId: board.rootId,
              childSessionId: node.id,
            })
            setFlash({ tone: 'ok', text: t('interrupt.success', { label: node.label }) })
            setConfirmId(null)
            setDigestNonce((current) => current + 1)
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return
            const text = errorText(t, error)
            setCreateError(text)
            setFlash({ tone: 'error', text })
          } finally {
            setInterruptingId(null)
          }
        },
        [board.rootId, interruptingId, t],
      )

      const archive = React.useCallback(
        async (node) => {
          if (archivingId !== null) return
          const service = ctx.uiWorkspace
          if (typeof service?.archiveSession !== 'function') {
            setFlash({ tone: 'error', text: t('error.archive-unavailable') })
            return
          }
          setArchivingId(node.id)
          setCreateError(null)
          try {
            await service.archiveSession(node.id)
            setArchiveConfirmId(null)
            setFlash({ tone: 'ok', text: t('archive.success', { label: node.label }) })
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return
            const text = archiveErrorText(t, error, 'error.archive-failed')
            setCreateError(text)
            setFlash({ tone: 'error', text })
          } finally {
            setArchivingId(null)
          }
        },
        [archivingId, ctx, t],
      )

      const restore = React.useCallback(
        async (node) => {
          if (restoringId !== null) return
          const service = ctx.uiWorkspace
          if (typeof service?.unarchiveSession !== 'function') {
            setFlash({ tone: 'error', text: t('error.archive-unavailable') })
            return
          }
          setRestoringId(node.id)
          setCreateError(null)
          try {
            await service.unarchiveSession(node.id)
            setFlash({ tone: 'ok', text: t('archive.restored', { label: node.label }) })
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return
            const text = archiveErrorText(t, error, 'error.unarchive-failed')
            setCreateError(text)
            setFlash({ tone: 'error', text })
          } finally {
            setRestoringId(null)
          }
        },
        [ctx, restoringId, t],
      )

      const refresh = React.useCallback(async () => {
        if (refreshing) return
        setRefreshing(true)
        const controller = new AbortController()
        ctx.sessions?.refreshProjections?.(board.rootId)
        for (const node of activeNodes) ctx.sessions?.refreshProjections?.(node.id)
        await loadCapabilities(controller.signal)
        setDigestNonce((current) => current + 1)
        setTimeout(() => setRefreshing(false), 700)
      }, [activeNodes, board.rootId, ctx, loadCapabilities, refreshing])

      if (board.loading) {
        return h(
          'div',
          { className: 'mc-root', ref: rootRef },
          h('style', null, CSS),
          h(
            'div',
            { className: 'mc-page' },
            h(
              'div',
              { className: 'mc-loading' },
              h('div', { className: 'mc-skeleton mc-skeleton-head' }),
              h('div', { className: 'mc-skeleton' }),
              h('div', { className: 'mc-skeleton' }),
              h('div', { className: 'mc-loading-text' }, t('loading')),
            ),
          ),
        )
      }

      const runningCount = activeNodes.filter((node) => node.running).length
      const totalTokens =
        (board.rootMetrics.tokens ?? 0) + activeNodes.reduce((sum, node) => sum + (node.metrics.tokens ?? 0), 0)
      const totalDuration =
        (board.rootMetrics.duration ?? 0) + activeNodes.reduce((sum, node) => sum + (node.metrics.duration ?? 0), 0)
      const totalTokensText = totalTokens > 0 ? formatTokens(totalTokens) : undefined
      const totalDurationText = totalDuration > 0 ? formatDuration(totalDuration) : undefined
      const subtitle =
        activeNodes.length > 0
          ? t('head.sub', { total: activeNodes.length, running: runningCount })
          : archivedNodes.length > 0
            ? t('head.subAllArchived', { archived: archivedNodes.length })
            : t('head.subEmpty')

      const pendingCards = pending.filter(
        (item) => item.id !== '' && !board.nodes.some((node) => node.id === item.id),
      )

      return h(
        'div',
        { className: 'mc-root', ref: rootRef },
        h('style', null, CSS),
        h(
          'div',
          { className: 'mc-page' },
          h(
            'header',
            { className: 'mc-head', ref: headerRef },
            h(
              'div',
              { className: 'mc-head-main' },
              h('div', { className: 'mc-eyebrow' }, t('head.eyebrow')),
              h('h2', { className: 'mc-title' }, t('head.title')),
              h('p', { className: 'mc-sub' }, subtitle),
            ),
            h(
              'div',
              { className: 'mc-head-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'mc-btn mc-btn-quiet',
                  onClick: refresh,
                  disabled: refreshing,
                },
                iconRefresh(),
                h('span', null, refreshing ? t('head.refreshing') : t('head.refresh')),
              ),
            ),
          ),
          h(
            'div',
            { className: 'mc-stats' },
            h(Stat, { label: t('stat.agents'), value: activeNodes.length }),
            h(Stat, {
              label: t('stat.running'),
              value: runningCount,
              title: runningCount > 0 ? t('stat.running') : undefined,
            }),
            h(Stat, {
              label: t('stat.tokens'),
              value: totalTokensText,
              title: totalTokens > 0 ? String(totalTokens) : undefined,
            }),
            h(Stat, {
              label: t('stat.work'),
              value: totalDurationText,
              title: totalDurationText ?? undefined,
            }),
          ),
          flash !== null
            ? h(
                'div',
                {
                  className: `mc-banner ${flash.tone === 'error' ? 'is-error' : 'is-ok'}`,
                  role: 'status',
                  'aria-live': 'polite',
                },
                flash.text,
              )
            : null,
          caps.status === 'error'
            ? h(
                'div',
                { className: 'mc-banner is-warn', role: 'status' },
                h('span', null, t('error.api')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'mc-btn mc-btn-quiet',
                    onClick: refresh,
                    disabled: refreshing,
                  },
                  t('head.refresh'),
                ),
              )
            : null,
          h(MainCard, {
            board,
            digest: digest.items,
            now,
            onOpen: () => ctx.uiWorkspace.openSession(board.rootId),
            t,
          }),
          h(
            'div',
            { className: 'mc-section-head' },
            h(
              'h3',
              { className: 'mc-section-title' },
              t('section.agents'),
              h('span', { className: 'mc-count' }, activeNodes.length),
            ),
            h(
              'button',
              {
                type: 'button',
                className: `mc-btn ${formOpen ? 'mc-btn-quiet' : 'mc-btn-primary'}`,
                onClick: () => setFormOpen((current) => !current),
                'aria-expanded': formOpen,
              },
              iconPlus(),
              h('span', null, formOpen ? t('section.close') : t('section.new')),
            ),
          ),
          formOpen
            ? h(CreatePanel, {
                t,
                caps,
                status: caps.status,
                busy: creating,
                error: createError,
                onSubmit: dispatch,
                onClose: () => setFormOpen(false),
                resetKey: formReset,
              })
            : null,
          pendingCards.length > 0 || activeNodes.length > 0
            ? h(
                'div',
                { className: 'mc-grid' },
                pendingCards.map((item) =>
                  h(
                    'article',
                    { className: 'mc-card is-run is-pending', key: `pending-${item.id}` },
                    h(
                      'div',
                      { className: 'mc-card-top' },
                      h('span', { className: 'mc-pill is-run' }, h('i', { className: 'mc-dot' }), t('create.submitting')),
                      h('span', { className: 'mc-depth' }, t('card.waiting')),
                    ),
                    h('h3', { className: 'mc-card-title' }, item.label),
                    h('div', { className: 'mc-pending-bar', 'aria-hidden': 'true' }),
                  ),
                ),
                activeNodes.map((node) =>
                  h(AgentCard, {
                    key: node.id,
                    node,
                    digest: digest.items[node.id],
                    current: node.id === sessionId,
                    busy: interruptingId === node.id || archivingId === node.id,
                    confirming: confirmId === node.id,
                    archiveConfirming: archiveConfirmId === node.id,
                    now,
                    onOpen: openSession,
                    onAskInterrupt: (target) => {
                      setArchiveConfirmId(null)
                      setConfirmId(target.id)
                    },
                    onCancelInterrupt: () => setConfirmId(null),
                    onInterrupt: interrupt,
                    onAskArchive: (target) => {
                      setConfirmId(null)
                      setArchiveConfirmId(target.id)
                    },
                    onCancelArchive: () => setArchiveConfirmId(null),
                    onArchive: archive,
                    archiveEnabled,
                    t,
                  }),
                ),
              )
            : archivedNodes.length === 0
              ? h(EmptyState, {
                  t,
                  onAction: () => {
                    setFormOpen(true)
                    if (typeof document !== 'undefined') {
                      const element = document.getElementById('mc-task')
                      if (element !== null && typeof element.focus === 'function') element.focus()
                    }
                  },
                })
              : null,
          archivedNodes.length > 0
            ? h(ArchivedSection, {
                nodes: archivedNodes,
                open: archivedOpen,
                restoringId,
                onToggle: () => setArchivedOpen((current) => !current),
                onRestore: restore,
                t,
              })
            : null,
          h(
            'footer',
            { className: 'mc-foot' },
            h('span', null, digest.error !== null ? t('footer.syncError') : t('footer.sync')),
            h('span', { className: 'mc-foot-meta' }, digest.at > 0 ? `${Math.max(0, Math.round((now - digest.at) / 1000))}s` : ''),
          ),
        ),
      )
    }

    /* ---------------------------------------------------------------- */
    /* Styles                                                            */
    /* ---------------------------------------------------------------- */

    const CSS = `
.mc-root {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
  scrollbar-gutter: stable;
}
.mc-root * { box-sizing: border-box; }
.mc-page {
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 clamp(18px, 4vw, 40px) 96px;
}
.mc-head {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px;
  padding: 24px 0 12px;
  background: var(--dsw-alias-bg-base);
}
.mc-head-main { min-width: 0; }
.mc-eyebrow {
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: .12em;
  margin-bottom: 4px;
}
.mc-title {
  margin: 0;
  font-size: 21px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -.01em;
}
.mc-sub {
  margin: 5px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
}
.mc-head-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.mc-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 16px;
}
.mc-stat {
  min-width: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 10px;
  padding: 8px 12px;
}
.mc-stat-n {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
}
.mc-stat-l {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  margin-top: 1px;
}
.mc-main {
  margin-top: 18px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, var(--dsw-alias-border-l1));
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-layer-1)) 0%,
      var(--dsw-alias-bg-layer-1) 58%);
  border-radius: 14px;
  padding: 15px 17px 14px;
}
.mc-main.is-running {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 52%, var(--dsw-alias-border-l1));
}
.mc-main-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.mc-main-id {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.mc-main-mark {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent);
}
.mc-main-id-text { min-width: 0; }
.mc-main-badge {
  color: var(--dsw-alias-brand-primary);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: .04em;
}
.mc-main-title {
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: min(560px, 62vw);
}
.mc-main-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.mc-main-task {
  display: flex;
  gap: 7px;
  margin: 10px 0 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary);
}
.mc-main-task-v {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  min-width: 0;
}
.mc-k {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .02em;
  padding-top: 1px;
}
.mc-section-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 24px 0 10px;
}
.mc-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.mc-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.mc-section-head > .mc-btn { margin-left: auto; }
.mc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(292px, 1fr));
  gap: 12px;
}
.mc-archived { margin-top: 22px; }
.mc-archived .mc-section-head { margin: 0 0 8px; }
.mc-archived-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1);
}
.mc-archived-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 7px 12px;
}
.mc-archived-row + .mc-archived-row {
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.mc-archived-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
}
.mc-archived-meta {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  opacity: .8;
}
.mc-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 12px;
  padding: 12px 13px 11px;
  transition: border-color .15s ease, transform .15s ease;
}
.mc-card:hover {
  border-color: var(--dsw-alias-border-l2);
  transform: translateY(-1px);
}
.mc-card.is-run {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 34%, var(--dsw-alias-border-l1));
}
.mc-card.is-current {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary) 50%, transparent);
}
.mc-card.is-busy { opacity: .72; }
.mc-card-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.mc-card-actions { margin-left: auto; }
.mc-card-buttons {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.mc-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 18px;
  white-space: nowrap;
}
.mc-pill.is-run {
  color: var(--dsw-alias-state-success-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 38%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 9%, transparent);
}
.mc-pill.is-idle {
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
}
.mc-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}
.mc-pill.is-run .mc-dot { animation: mc-pulse 1.6s ease-in-out infinite; }
@keyframes mc-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: .35; transform: scale(.78); }
}
.mc-depth {
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  white-space: nowrap;
}
.mc-current {
  color: var(--dsw-alias-brand-primary);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, transparent);
  border-radius: 999px;
  padding: 0 7px;
  font-size: 10.5px;
  line-height: 17px;
  white-space: nowrap;
}
.mc-card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mc-parent {
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  margin-top: -3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mc-card-task {
  display: flex;
  gap: 6px;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 1.5;
}
.mc-card-task-v {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  min-width: 0;
}
.mc-feed {
  display: flex;
  gap: 6px;
  border-top: 1px dashed var(--dsw-alias-border-l1);
  padding-top: 7px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  min-height: 24px;
}
.mc-feed-k {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  font-weight: 600;
  padding-top: 1px;
}
.mc-feed-v {
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.mc-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: auto;
  padding-top: 2px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.mc-meta-item { white-space: nowrap; }
.mc-meta-item + .mc-meta-item::before {
  content: "·";
  margin-right: 10px;
  color: var(--dsw-alias-label-secondary);
  opacity: .55;
}
.mc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font: inherit;
  font-size: 12px;
  line-height: 1.35;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 5px 10px;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color .15s ease, border-color .15s ease, opacity .15s ease;
}
.mc-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.mc-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.mc-btn:disabled { opacity: .5; cursor: not-allowed; }
.mc-btn:disabled:hover { background: transparent; }
.mc-btn-quiet {
  border-color: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 4px 7px;
}
.mc-btn-quiet:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
}
.mc-btn-primary {
  color: var(--dsw-alias-bg-base);
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
  font-weight: 600;
}
.mc-btn-primary:hover { filter: brightness(1.06); background: var(--dsw-alias-brand-primary); }
.mc-btn-danger {
  color: var(--dsw-alias-state-error-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 38%, var(--dsw-alias-border-l2));
}
.mc-btn-danger:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent); }
.mc-confirm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.mc-confirm-q {
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  white-space: nowrap;
}
.mc-create {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 14px;
  padding: 13px 14px 14px;
}
.mc-create-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.mc-create-heading { min-width: 0; }
.mc-create-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}
.mc-hint {
  margin: 3px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 1.5;
}
.mc-create-head > .mc-btn { margin-left: auto; }
.mc-create-form {
  display: grid;
  gap: 10px;
  margin-top: 11px;
}
.mc-field { display: grid; gap: 5px; min-width: 0; }
.mc-field-name { max-width: 360px; }
.mc-label {
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  font-weight: 500;
}
.mc-input, .mc-textarea {
  width: 100%;
  min-width: 0;
  font: inherit;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12.5px;
  line-height: 1.55;
}
.mc-textarea { min-height: 84px; resize: vertical; }
.mc-input::placeholder, .mc-textarea::placeholder { color: var(--dsw-alias-label-secondary); opacity: .8; }
.mc-input:focus, .mc-textarea:focus {
  outline: none;
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent);
}
.mc-input:disabled, .mc-textarea:disabled { opacity: .6; cursor: not-allowed; }
.mc-create-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mc-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 9px;
  padding: 7px 11px;
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.5;
}
.mc-banner.is-ok {
  color: var(--dsw-alias-state-success-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 34%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent);
}
.mc-banner.is-error {
  color: var(--dsw-alias-state-error-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 34%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
}
.mc-banner.is-warn {
  color: var(--dsw-alias-state-warn-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 34%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent);
}
.mc-banner > .mc-btn { margin-left: auto; }
.mc-create .mc-banner { margin: 0; }
.mc-empty {
  margin-top: 12px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 14px;
  padding: 30px 20px 26px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
}
.mc-empty-art {
  color: var(--dsw-alias-brand-primary);
  display: flex;
  justify-content: center;
  margin-bottom: 10px;
  opacity: .9;
}
.mc-empty-title {
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 600;
}
.mc-empty-body {
  max-width: 560px;
  margin: 6px auto 14px;
  font-size: 12.5px;
  line-height: 1.65;
}
.mc-pending-bar {
  height: 3px;
  border-radius: 999px;
  margin-top: 6px;
  background:
    linear-gradient(90deg,
      transparent 0%,
      var(--dsw-alias-brand-primary) 35%,
      var(--dsw-alias-brand-primary) 65%,
      transparent 100%);
  background-size: 200% 100%;
  animation: mc-shimmer 1.3s linear infinite;
  opacity: .7;
}
.mc-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 18px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  line-height: 1.5;
}
.mc-foot-meta {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  opacity: .65;
}
.mc-loading { display: grid; gap: 12px; }
.mc-skeleton {
  height: 104px;
  border-radius: 14px;
  background:
    linear-gradient(90deg,
      var(--dsw-alias-bg-layer-1) 0%,
      var(--dsw-alias-bg-layer-2) 50%,
      var(--dsw-alias-bg-layer-1) 100%);
  background-size: 220% 100%;
  animation: mc-shimmer 1.4s linear infinite;
}
.mc-skeleton-head { height: 86px; }
.mc-loading-text {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  text-align: center;
}
@keyframes mc-shimmer {
  0% { background-position: 120% 0; }
  100% { background-position: -120% 0; }
}
@media (max-width: 720px) {
  .mc-page { padding: 20px 14px 40px; }
  .mc-grid { grid-template-columns: 1fr; }
  .mc-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mc-main-title { max-width: 100%; }
  .mc-stat { max-width: none; }
}
@media (prefers-reduced-motion: reduce) {
  .mc-card, .mc-btn { transition: none; }
  .mc-card:hover { transform: none; }
  .mc-pill.is-run .mc-dot, .mc-pending-bar, .mc-skeleton { animation: none; }
}
`

    /* ---------------------------------------------------------------- */
    /* Plugin registration                                               */
    /* ---------------------------------------------------------------- */

    return {
      inject: ['slots', 'locale', 'sessions', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NS, { zh, en }),
          'mission-control: dictionaries',
        )
        const t = ctx.locale.bind(NS)
        const Board = (props) => h(MissionControl, { ...props, ctx, t })
        Board.displayName = 'MissionControlView'

        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            {
              name: 'conversation.view',
              id: 'mission-control',
              order: 40,
              locale: NS,
              label: () => t('view.label'),
            },
            Board,
          ),
        )
      },
    }
  },
})
