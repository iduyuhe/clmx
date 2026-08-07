import { useEffect, useRef, useState } from 'react'
import { opcuaApi, devicesApi } from '@/api'
import { Server, Plus, Trash2, Unplug, Plug, RefreshCw, AlertTriangle } from 'lucide-react'

interface SensorOption {
  id: string
  name: string
  deviceName: string
  deviceCode: string
}
interface MappingRow {
  key: number
  sensorId: string
  nodeId: string
}

export function OpcuaTab() {
  const [status, setStatus] = useState<{ connected: boolean; endpoint: string | null; nodes: number }>({
    connected: false,
    endpoint: null,
    nodes: 0,
  })
  const [sensors, setSensors] = useState<SensorOption[]>([])
  const [endpoint, setEndpoint] = useState('opc.tcp://localhost:4840')
  const [intervalMs, setIntervalMs] = useState(3000)
  const [rows, setRows] = useState<MappingRow[]>([{ key: Date.now(), sensorId: '', nodeId: '' }])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const keySeq = useRef(Date.now())

  async function loadStatus() {
    try {
      setStatus((await opcuaApi.status()).data)
    } catch {
      /* 忽略 */
    }
  }
  async function loadSensors() {
    try {
      const list = ((await devicesApi.listSensors()).data) as any[]
      setSensors(
        list.map((s) => ({
          id: s.id,
          name: s.name,
          deviceName: s.device?.name ?? '',
          deviceCode: s.device?.code ?? '',
        })),
      )
    } catch {
      /* 忽略 */
    }
  }
  useEffect(() => {
    loadStatus()
    loadSensors()
  }, [])

  function addRow() {
    keySeq.current += 1
    setRows((r) => [...r, { key: keySeq.current, sensorId: '', nodeId: '' }])
  }
  function updateRow(key: number, patch: Partial<MappingRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }
  function removeRow(key: number) {
    setRows((r) => (r.length > 1 ? r.filter((row) => row.key !== key) : r))
  }

  async function onConnect() {
    setMsg(null)
    const mappings = rows
      .filter((r) => r.sensorId && r.nodeId)
      .map((r) => ({ sensorId: r.sensorId, nodeId: r.nodeId }))
    if (!endpoint) return setMsg({ type: 'err', text: '请填写 OPC-UA 服务端地址' })
    if (mappings.length === 0) return setMsg({ type: 'err', text: '至少配置一条「节点 → 传感器」映射' })
    setBusy(true)
    try {
      const res = (await opcuaApi.connect({ endpoint, intervalMs, mappings })).data
      setStatus({ connected: res.connected, endpoint: res.endpoint, nodes: res.nodes })
      setMsg({ type: 'ok', text: `已连接 ${res.endpoint}，正在摄入 ${res.nodes} 个节点` })
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.response?.data?.message || '连接失败' })
    } finally {
      setBusy(false)
    }
  }
  async function onDisconnect() {
    setBusy(true)
    try {
      await opcuaApi.disconnect()
      await loadStatus()
      setMsg({ type: 'ok', text: '已断开 OPC-UA 连接' })
    } catch {
      setMsg({ type: 'err', text: '断开失败' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-indigo-600" />
            <h3 className="text-base font-semibold text-gray-900">OPC-UA 接入</h3>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              status.connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${status.connected ? 'bg-green-500' : 'bg-gray-400'}`} />
            {status.connected ? `已连接 · ${status.nodes} 节点` : '未连接'}
          </span>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          通过 OPC-UA 协议从工业现场（PLC / SCADA / 边缘网关）订阅变量节点，实时写入传感器遥测。
          可先用「本地模拟器」<code className="rounded bg-gray-100 px-1">opc.tcp://localhost:4840</code> 联调验证。
        </p>
      </div>

      {msg && (
        <div
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm ${
            msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {msg.type === 'err' && <AlertTriangle className="h-4 w-4" />}
          {msg.text}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">服务端地址 (Endpoint)</label>
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="opc.tcp://localhost:4840"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">采集间隔 (ms)</label>
            <input
              type="number"
              min={1000}
              step={500}
              value={intervalMs}
              onChange={(e) => setIntervalMs(Math.max(1000, +e.target.value))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">节点 → 传感器 映射</span>
            <button
              onClick={addRow}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              <Plus className="h-3.5 w-3.5" /> 添加映射
            </button>
          </div>
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <input
                  value={row.nodeId}
                  onChange={(e) => updateRow(row.key, { nodeId: e.target.value })}
                  placeholder="ns=1;s=Vibration"
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <span className="text-gray-400">→</span>
                <select
                  value={row.sensorId}
                  onChange={(e) => updateRow(row.key, { sensorId: e.target.value })}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">选择传感器…</option>
                  {sensors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}（{s.deviceCode}）
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removeRow(row.key)}
                  disabled={rows.length === 1}
                  className="rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          {sensors.length === 0 && (
            <p className="mt-2 text-xs text-amber-600">当前租户暂无传感器，请先在「设备」中创建设备并添加传感器。</p>
          )}
        </div>

        <div className="mt-5 flex items-center gap-3">
          {status.connected ? (
            <button
              onClick={onDisconnect}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              <Unplug className="h-4 w-4" /> 断开
            </button>
          ) : (
            <button
              onClick={onConnect}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Plug className="h-4 w-4" /> 连接并开始摄入
            </button>
          )}
          <button
            onClick={loadStatus}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" /> 刷新状态
          </button>
        </div>
      </div>
    </div>
  )
}
