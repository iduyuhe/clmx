/**
 * CLMX OPC-UA 本地模拟器（联调用）
 *
 * 启动一个最小 OPC-UA Server，暴露 DemoDevice 下的两个变量节点：
 *   ns=1;s=Vibration     振动 (mm/s)，随机 2~6
 *   ns=1;s=Temperature   温度 (℃)，随机 50~70
 * 每 2 秒更新一次，供 OPC-UA 适配器连接并写入 SensorData，验证整条摄入链路。
 *
 * 运行：npx tsx scripts/opcua-simulator.ts
 * 端点：opc.tcp://localhost:4840
 */
import { OPCUAServer, DataType, Variant } from 'node-opcua'

const PORT = Number(process.env.OPCUA_SIM_PORT || 4840)

async function main() {
  const server = new OPCUAServer({ port: PORT })
  await server.initialize()

  const addressSpace = server.engine.addressSpace!
  const namespace = addressSpace.getOwnNamespace()
  const device = namespace.addObject({
    browseName: 'DemoDevice',
    organizedBy: addressSpace.rootFolder.objects!,
  })

  const vibration = namespace.addVariable({
    browseName: 'Vibration',
    nodeId: 'ns=1;s=Vibration',
    dataType: DataType.Double,
    value: { dataType: DataType.Double, value: 2.5 },
    organizedBy: device,
  })
  const temperature = namespace.addVariable({
    browseName: 'Temperature',
    nodeId: 'ns=1;s=Temperature',
    dataType: DataType.Double,
    value: { dataType: DataType.Double, value: 55 },
    organizedBy: device,
  })

  setInterval(() => {
    vibration.setValueFromSource(new Variant({ dataType: DataType.Double, value: 2 + Math.random() * 4 }))
    temperature.setValueFromSource(new Variant({ dataType: DataType.Double, value: 50 + Math.random() * 20 }))
  }, 2000)

  await server.start()
  console.log(`[OPC-UA 模拟器] 已启动: ${server.getEndpointUrl()}`)
  console.log('  节点: ns=1;s=Vibration (振动), ns=1;s=Temperature (温度)')
}

main().catch((e) => {
  console.error('模拟器启动失败', e)
  process.exit(1)
})
